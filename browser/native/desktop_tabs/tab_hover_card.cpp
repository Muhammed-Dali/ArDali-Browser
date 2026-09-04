#include "tab_hover_card.h"
#include "browser_icons.h"

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

#if defined(Q_OS_WIN)
#include <windows.h>
#include <psapi.h>
#else
#include <unistd.h>
#endif

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
      "  font-size: 13px;"
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
      "QLabel#hover-status-text {"
      "  color: #c4c7c5;"
      "  font-size: 11px;"
      "}"
  ));

  auto *mainLayout = new QVBoxLayout(this);
  mainLayout->setContentsMargins(12, 10, 12, 10);
  mainLayout->setSpacing(5);

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
  titleLabel_->setWordWrap(true);

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

  // Audio status row
  audioContainer_ = new QWidget(this);
  auto *audioLayout = new QHBoxLayout(audioContainer_);
  audioLayout->setContentsMargins(0, 1, 0, 1);
  audioLayout->setSpacing(6);

  audioIconLabel_ = new QLabel(audioContainer_);
  audioIconLabel_->setFixedSize(14, 14);
  audioIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::Audio).pixmap(14, 14));

  audioTextLabel_ = new QLabel(QStringLiteral("Bu sekmede ses çalınıyor"), audioContainer_);
  audioTextLabel_->setObjectName(QStringLiteral("hover-status-text"));

  audioLayout->addWidget(audioIconLabel_, 0, Qt::AlignLeft | Qt::AlignVCenter);
  audioLayout->addWidget(audioTextLabel_, 1, Qt::AlignLeft | Qt::AlignVCenter);
  mainLayout->addWidget(audioContainer_);

  // Memory usage row
  memoryContainer_ = new QWidget(this);
  auto *memLayout = new QHBoxLayout(memoryContainer_);
  memLayout->setContentsMargins(0, 1, 0, 1);
  memLayout->setSpacing(6);

  memoryIconLabel_ = new QLabel(memoryContainer_);
  memoryIconLabel_->setFixedSize(14, 14);
  memoryIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::Memory).pixmap(14, 14));

  memoryTextLabel_ = new QLabel(memoryContainer_);
  memoryTextLabel_->setObjectName(QStringLiteral("hover-status-text"));

  memLayout->addWidget(memoryIconLabel_, 0, Qt::AlignLeft | Qt::AlignVCenter);
  memLayout->addWidget(memoryTextLabel_, 1, Qt::AlignLeft | Qt::AlignVCenter);
  mainLayout->addWidget(memoryContainer_);

  setFixedWidth(300);

  pollTimer_.setInterval(1500);
  connect(&pollTimer_, &QTimer::timeout, this, &TabHoverCard::refreshCardInfo);
}

QString TabHoverCard::extractDomain(const QUrl &url) {
  if (url.isEmpty()) return QStringLiteral("ArDaliBrowser");

  if (url.scheme() == QLatin1String("ardali")) {
    const QString host = url.host().toLower();
    const QString path = url.path().toLower();
    if (host == QLatin1String("newtab") || host == QLatin1String("ardali-browser.local")) {
      return QStringLiteral("ArDaliBrowser");
    }
    if (host == QLatin1String("settings") || path.contains(QLatin1String("settings"))) {
      return QStringLiteral("Ayarlar");
    }
    if (host == QLatin1String("audio-effects") || path.contains(QLatin1String("audio-effects"))) {
      return QStringLiteral("Ses Efektleri");
    }
    if (host == QLatin1String("eq-presets") || path.contains(QLatin1String("eq-presets"))) {
      return QStringLiteral("Hazır Ses Efektleri");
    }
    if (host == QLatin1String("passwords") || path.contains(QLatin1String("passwords"))) {
      return QStringLiteral("Şifre Yöneticisi");
    }
    if (host == QLatin1String("downloads") || path.contains(QLatin1String("downloads"))) {
      return QStringLiteral("İndirmeler");
    }
    if (host == QLatin1String("blocker") || path.contains(QLatin1String("blocker"))) {
      return QStringLiteral("Kalkan");
    }
    if (host == QLatin1String("listen") || host == QLatin1String("listen-settings")) {
      return QStringLiteral("ArDali Pulse");
    }
    return QStringLiteral("ArDali");
  }

  if (url.host() == QLatin1String("ardali-browser.local")) {
    return QStringLiteral("ArDaliBrowser");
  }

  if (!url.host().isEmpty()) {
    QString host = url.host().toLower();
    if (host.startsWith(QStringLiteral("www."))) {
      host.remove(0, 4);
    }
    return host;
  }

  return QStringLiteral("ArDaliBrowser");
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

#if defined(Q_OS_WIN)
  HANDLE process = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, FALSE, static_cast<DWORD>(pid));
  if (process) {
    PROCESS_MEMORY_COUNTERS_EX pmc;
    if (GetProcessMemoryInfo(process, reinterpret_cast<PROCESS_MEMORY_COUNTERS *>(&pmc), sizeof(pmc))) {
      info.valid = true;
      info.bytes = static_cast<qint64>(pmc.WorkingSetSize);
      info.isRssFallback = false;
      if (info.isShared) {
        info.text = QStringLiteral("Renderer belleği: %1 (paylaşılan)").arg(formatBytes(info.bytes));
      } else {
        info.text = QStringLiteral("Bellek kullanımı: %1").arg(formatBytes(info.bytes));
      }
      CloseHandle(process);
      return info;
    }
    CloseHandle(process);
  }
#else
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
#endif

  info.valid = false;
  info.text = QStringLiteral("Bellek kullanımı: Kullanılamıyor");
  return info;
}

void TabHoverCard::refreshCardInfo() {
  if (!currentView_ || !currentView_->page()) {
    audioContainer_->hide();
    memoryContainer_->hide();
    separator_->hide();
    return;
  }

  // Audio status
  const bool isAudible = currentView_->page()->recentlyAudible();
  audioContainer_->setVisible(isAudible);

  // Memory usage
  const TabMemoryInfo info = measureMemory(currentView_->page(), currentAllViews_);
  if (info.valid && !info.text.isEmpty()) {
    memoryTextLabel_->setText(info.text);
    memoryContainer_->show();
  } else {
    memoryContainer_->hide();
  }

  // Separator visibility
  separator_->setVisible(audioContainer_->isVisible() || memoryContainer_->isVisible());
  adjustSize();
}

void TabHoverCard::showForTab(const QString &title, const QUrl &url, const QIcon &icon,
                              QWebEngineView *view, const QVector<QWebEngineView *> &allViews,
                              const QRect &globalTabRect, QWidget *anchorWidget) {
  Q_UNUSED(anchorWidget);
  currentView_ = view;
  currentAllViews_ = allViews;

  const QString displayTitle = title.isEmpty() ? QStringLiteral("Yeni Sekme") : title;
  titleLabel_->setText(displayTitle);

  if (!icon.isNull()) {
    iconLabel_->setPixmap(icon.pixmap(16, 16));
    iconLabel_->show();
  } else {
    iconLabel_->hide();
  }

  domainLabel_->setText(extractDomain(url));

  refreshCardInfo();
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

  if (!pollTimer_.isActive()) {
    pollTimer_.start();
  }
}

void TabHoverCard::hideCard() {
  pollTimer_.stop();
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
