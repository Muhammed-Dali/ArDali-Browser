#include "tab_hover_card.h"

#include <QFile>
#include <QGuiApplication>
#include <QHBoxLayout>
#include <QPainter>
#include <QPainterPath>
#include <QScreen>
#include <QTextStream>
#include <QVBoxLayout>
#include <QWebEnginePage>
#include <QWebEngineView>
#include <unistd.h>

namespace {
QString formatBytes(qint64 bytes) {
  if (bytes < 1024 * 1024) {
    return QStringLiteral("%1 KB").arg(bytes / 1024);
  }
  const double mb = static_cast<double>(bytes) / (1024.0 * 1024.0);
  if (mb >= 1024.0) {
    return QStringLiteral("%1 GB").arg(mb / 1024.0, 0, 'f', 1);
  }
  return QStringLiteral("%1 MB").arg(qRound(mb));
}
}  // namespace

TabHoverCard::TabHoverCard(QWidget *parent) : QFrame(parent) {
  setWindowFlags(Qt::ToolTip | Qt::FramelessWindowHint | Qt::NoDropShadowWindowHint);
  setAttribute(Qt::WA_ShowWithoutActivating, true);
  setAttribute(Qt::WA_TransparentForMouseEvents, true);

  setStyleSheet(QStringLiteral(
      "TabHoverCard {"
      "  background-color: #1c242e;"
      "  border: 1px solid #364554;"
      "  border-radius: 10px;"
      "}"
      "QLabel#hover-title {"
      "  color: #e8eef5;"
      "  font-size: 12px;"
      "  font-weight: bold;"
      "}"
      "QLabel#hover-domain {"
      "  color: #9aa0a6;"
      "  font-size: 11px;"
      "}"
      "QFrame#hover-sep {"
      "  background-color: #2c3846;"
      "  max-height: 1px;"
      "  min-height: 1px;"
      "}"
      "QLabel#hover-memory-dot {"
      "  color: #8ab4f8;"
      "  font-size: 11px;"
      "}"
      "QLabel#hover-memory-text {"
      "  color: #c4c7c5;"
      "  font-size: 11px;"
      "}"
  ));

  auto *mainLayout = new QVBoxLayout(this);
  mainLayout->setContentsMargins(12, 10, 12, 10);
  mainLayout->setSpacing(4);

  auto *topLayout = new QHBoxLayout;
  topLayout->setContentsMargins(0, 0, 0, 0);
  topLayout->setSpacing(8);

  iconLabel_ = new QLabel(this);
  iconLabel_->setFixedSize(16, 16);
  iconLabel_->hide();

  auto *textLayout = new QVBoxLayout;
  textLayout->setContentsMargins(0, 0, 0, 0);
  textLayout->setSpacing(2);

  titleLabel_ = new QLabel(this);
  titleLabel_->setObjectName(QStringLiteral("hover-title"));

  domainLabel_ = new QLabel(this);
  domainLabel_->setObjectName(QStringLiteral("hover-domain"));

  textLayout->addWidget(titleLabel_);
  textLayout->addWidget(domainLabel_);

  topLayout->addWidget(iconLabel_, 0, Qt::AlignTop);
  topLayout->addLayout(textLayout, 1);

  mainLayout->addLayout(topLayout);

  separator_ = new QFrame(this);
  separator_->setObjectName(QStringLiteral("hover-sep"));
  mainLayout->addWidget(separator_);

  auto *memLayout = new QHBoxLayout;
  memLayout->setContentsMargins(0, 2, 0, 0);
  memLayout->setSpacing(6);

  memoryDotLabel_ = new QLabel(QStringLiteral("●"), this);
  memoryDotLabel_->setObjectName(QStringLiteral("hover-memory-dot"));

  memoryTextLabel_ = new QLabel(this);
  memoryTextLabel_->setObjectName(QStringLiteral("hover-memory-text"));

  memLayout->addWidget(memoryDotLabel_, 0, Qt::AlignLeft | Qt::AlignVCenter);
  memLayout->addWidget(memoryTextLabel_, 1, Qt::AlignLeft | Qt::AlignVCenter);

  mainLayout->addLayout(memLayout);

  setFixedWidth(280);

  memoryPollTimer_.setInterval(1500);
  connect(&memoryPollTimer_, &QTimer::timeout, this, &TabHoverCard::refreshMemoryInfo);
}

TabMemoryInfo TabHoverCard::measureMemory(QWebEnginePage *page, const QVector<QWebEngineView *> &allViews) {
  TabMemoryInfo info;
  if (!page) return info;

  const qint64 pid = page->renderProcessPid();
  if (pid <= 0) return info;

  int sharedCount = 0;
  for (const QWebEngineView *v : allViews) {
    if (v && v->page() && v->page()->renderProcessPid() == pid) {
      ++sharedCount;
    }
  }
  info.isShared = (sharedCount > 1);

  // Primary metric: PSS from /proc/<pid>/smaps_rollup
  const QString rollupPath = QStringLiteral("/proc/%1/smaps_rollup").arg(pid);
  QFile rollupFile(rollupPath);
  if (rollupFile.open(QIODevice::ReadOnly | QIODevice::Text)) {
    QTextStream in(&rollupFile);
    QString line;
    qint64 pssKb = -1;
    while (in.readLineInto(&line)) {
      if (line.startsWith(QLatin1String("Pss:"))) {
        const auto parts = line.split(QLatin1Char(' '), Qt::SkipEmptyParts);
        if (parts.size() >= 2) {
          bool ok = false;
          pssKb = parts.at(1).toLongLong(&ok);
          if (ok && pssKb >= 0) break;
        }
      }
    }
    rollupFile.close();

    if (pssKb >= 0) {
      info.valid = true;
      info.bytes = pssKb * 1024;
      info.isRssFallback = false;
      if (info.isShared) {
        info.text = QStringLiteral("Renderer belleği: %1 (paylaşılan)").arg(formatBytes(info.bytes));
      } else {
        info.text = QStringLiteral("Bellek kullanımı: %1").arg(formatBytes(info.bytes));
      }
      return info;
    }
  }

  // Fallback metric: RSS from /proc/<pid>/statm
  const QString statmPath = QStringLiteral("/proc/%1/statm").arg(pid);
  QFile statmFile(statmPath);
  if (statmFile.open(QIODevice::ReadOnly | QIODevice::Text)) {
    QTextStream in(&statmFile);
    qint64 pages = 0;
    qint64 rssPages = 0;
    in >> pages >> rssPages;
    statmFile.close();

    if (rssPages > 0) {
      const long pageSize = sysconf(_SC_PAGESIZE);
      const qint64 rssBytes = rssPages * (pageSize > 0 ? pageSize : 4096);
      info.valid = true;
      info.bytes = rssBytes;
      info.isRssFallback = true;
      if (info.isShared) {
        info.text = QStringLiteral("Renderer RSS: %1 (paylaşılan)").arg(formatBytes(info.bytes));
      } else {
        info.text = QStringLiteral("Bellek kullanımı (RSS): %1").arg(formatBytes(info.bytes));
      }
      return info;
    }
  }

  info.valid = false;
  info.text = QStringLiteral("Bellek kullanımı: Kullanılamıyor");
  return info;
}

void TabHoverCard::refreshMemoryInfo() {
  if (!currentView_ || !currentView_->page()) {
    separator_->hide();
    memoryDotLabel_->hide();
    memoryTextLabel_->hide();
    return;
  }

  const TabMemoryInfo info = measureMemory(currentView_->page(), currentAllViews_);
  if (info.valid && !info.text.isEmpty()) {
    memoryTextLabel_->setText(info.text);
    separator_->show();
    memoryDotLabel_->show();
    memoryTextLabel_->show();
  } else {
    separator_->hide();
    memoryDotLabel_->hide();
    memoryTextLabel_->hide();
  }
}

void TabHoverCard::showForTab(const QString &title, const QUrl &url, const QIcon &icon,
                              QWebEngineView *view, const QVector<QWebEngineView *> &allViews,
                              const QRect &globalTabRect, QWidget *anchorWidget) {
  Q_UNUSED(anchorWidget);
  currentView_ = view;
  currentAllViews_ = allViews;

  const QString displayTitle = title.isEmpty() ? QStringLiteral("Yeni Sekme") : title;
  titleLabel_->setText(fontMetrics().elidedText(displayTitle, Qt::ElideRight, 220));

  if (!icon.isNull()) {
    iconLabel_->setPixmap(icon.pixmap(16, 16));
    iconLabel_->show();
  } else {
    iconLabel_->hide();
  }

  const bool isNewTab = (url.scheme() == QLatin1String("ardali") && url.host() == QLatin1String("newtab"))
                     || url.host() == QLatin1String("ardali-browser.local")
                     || url.isEmpty();
  if (isNewTab) {
    domainLabel_->setText(QStringLiteral("ArDaliBrowser"));
  } else if (!url.host().isEmpty()) {
    QString host = url.host().toLower();
    if (host.startsWith(QStringLiteral("www."))) host.remove(0, 4);
    domainLabel_->setText(host);
  } else {
    domainLabel_->setText(QStringLiteral("ArDaliBrowser"));
  }

  refreshMemoryInfo();
  adjustSize();

  // Position Card below tab
  const int cardWidth = width();
  const int cardHeight = height();
  int targetX = globalTabRect.left() + 8;
  int targetY = globalTabRect.bottom() + 4;

  QScreen *screen = QGuiApplication::screenAt(globalTabRect.center());
  if (!screen) screen = QGuiApplication::primaryScreen();
  if (screen) {
    const QRect available = screen->availableGeometry();
    if (targetX + cardWidth > available.right() - 8) {
      targetX = available.right() - cardWidth - 8;
    }
    if (targetX < available.left() + 8) {
      targetX = available.left() + 8;
    }
    if (targetY + cardHeight > available.bottom() - 8) {
      targetY = globalTabRect.top() - cardHeight - 4;
    }
  }

  move(targetX, targetY);
  show();
  raise();

  if (!memoryPollTimer_.isActive()) {
    memoryPollTimer_.start();
  }
}

void TabHoverCard::hideCard() {
  memoryPollTimer_.stop();
  currentView_ = nullptr;
  currentAllViews_.clear();
  hide();
}

void TabHoverCard::paintEvent(QPaintEvent *event) {
  Q_UNUSED(event);
  QPainter painter(this);
  painter.setRenderHint(QPainter::Antialiasing);

  QPainterPath path;
  path.addRoundedRect(rect(), 10, 10);

  painter.fillPath(path, QColor(QStringLiteral("#1c242e")));
  QPen pen(QColor(QStringLiteral("#364554")));
  pen.setWidth(1);
  painter.setPen(pen);
  painter.drawPath(path);
}
