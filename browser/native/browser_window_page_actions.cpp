#include "browser_window.h"
#include "browser_window_internal.h"
#include "core/browser_icons.h"
#include "desktop_tabs/tab_strip_widget.h"
#include "desktop_tabs/find_bar_widget.h"
#include "i18n/i18n.h"

#include <QAction>
#include <QDir>
#include <QFileDialog>
#include <QMessageBox>
#include <QPrintDialog>
#include <QPrinter>
#include <QPushButton>
#include <QRegularExpression>
#include <QSettings>
#include <QTextBrowser>
#include <QToolBar>
#include <QVBoxLayout>
#include <QWebEngineFindTextResult>
#include <QWebEngineFullScreenRequest>

using ardali::i18n::I18n;

void BrowserWindow::showFindBar() {
  if (!findBar_) {
    findBar_ = new ardali::desktop_tabs::FindBarWidget(this);
    connect(findBar_, &ardali::desktop_tabs::FindBarWidget::findRequested,
            this, &BrowserWindow::handleFindRequest);
    connect(findBar_, &ardali::desktop_tabs::FindBarWidget::clearFindRequested,
            this, &BrowserWindow::handleClearFind);
    connect(findBar_, &ardali::desktop_tabs::FindBarWidget::closeRequested,
            this, &BrowserWindow::hideFindBar);
  }
  updateFindBarPosition();
  findBar_->show();
  findBar_->raise();

  if (auto *view = currentView()) {
    const QString selected = view->selectedText().trimmed();
    if (!selected.isEmpty() && !selected.contains(QLatin1Char('\n'))) {
      findBar_->setFindText(selected);
      handleFindRequest(selected, true, findBar_->isCaseSensitive());
    }
  }
  findBar_->focusAndSelectAll();
}

void BrowserWindow::hideFindBar() {
  if (findBar_) {
    findBar_->hide();
  }
  handleClearFind();
  if (auto *view = currentView()) {
    view->setFocus();
  }
}

void BrowserWindow::updateFindBarPosition() {
  if (!findBar_) return;
  const int w = findBar_->width();
  const int h = findBar_->height();
  const int top = (navBar_ ? navBar_->geometry().bottom() : 80) + 6;
  const int right = width() - w - 24;
  findBar_->setGeometry(std::max(10, right), top, w, h);
}

void BrowserWindow::handleFindRequest(const QString &text, bool forward, bool caseSensitive) {
  auto *view = currentView();
  if (!view || !view->page()) return;

  if (text.isEmpty()) {
    handleClearFind();
    return;
  }

  QWebEnginePage::FindFlags flags;
  if (!forward) flags |= QWebEnginePage::FindBackward;
  if (caseSensitive) flags |= QWebEnginePage::FindCaseSensitively;

  view->page()->findText(text, flags, [this](const QWebEngineFindTextResult &result) {
    if (findBar_) {
      findBar_->setMatchCount(result.activeMatch(), result.numberOfMatches());
    }
  });
}

void BrowserWindow::handleClearFind() {
  if (auto *view = currentView()) {
    if (view->page()) {
      view->page()->findText(QString());
    }
  }
  if (findBar_) {
    findBar_->clearMatchCount();
  }
}

void BrowserWindow::printCurrentPage() {
  auto *view = currentView();
  if (!view || !view->page()) return;
  auto printer = std::make_shared<QPrinter>(QPrinter::HighResolution);
  QPrintDialog dialog(printer.get(), this);
  dialog.setWindowTitle(I18n::text(QStringLiteral("print.dialog_title"), QStringLiteral("Yazdır")));
  if (dialog.exec() == QDialog::Accepted) {
    auto conn = std::make_shared<QMetaObject::Connection>();
    *conn = connect(view, &QWebEngineView::printFinished, view, [printer, conn](bool success) {
      Q_UNUSED(success);
      QObject::disconnect(*conn);
    });
    view->print(printer.get());
  }
}

void BrowserWindow::printCurrentPageToPdf() {
  auto *view = currentView();
  if (!view || !view->page()) return;
  QString title = view->title().trimmed();
  if (title.isEmpty()) title = QStringLiteral("sayfa");
  title.replace(QRegularExpression(QStringLiteral("[/\\\\?%*:|\"<>]")), QStringLiteral("_"));
  const QString defaultPath = QDir::homePath() + QLatin1Char('/') + title + QStringLiteral(".pdf");
  const QString filePath = QFileDialog::getSaveFileName(this,
      I18n::text(QStringLiteral("print.pdf_save_title"), QStringLiteral("PDF Olarak Kaydet")),
      defaultPath,
      QStringLiteral("PDF Dosyaları (*.pdf)"));
  if (!filePath.isEmpty()) {
    view->page()->printToPdf(filePath);
  }
}

void BrowserWindow::captureVisiblePage() {
  auto *view = currentView();
  if (!view || !view->page()) return;
  QString title = view->title().trimmed();
  if (title.isEmpty()) title = QStringLiteral("sayfa");
  title.replace(QRegularExpression(QStringLiteral("[/\\\\?%*:|\"<>]")), QStringLiteral("_"));
  const QString filePath = QFileDialog::getSaveFileName(
      this,
      I18n::text(QStringLiteral("capture.save_title"), QStringLiteral("Ekran Görüntüsünü Kaydet")),
      QDir::homePath() + QLatin1Char('/') + title + QStringLiteral(".png"),
      QStringLiteral("PNG Görüntüsü (*.png)"));
  if (filePath.isEmpty()) return;
  QString target = filePath;
  if (!target.endsWith(QStringLiteral(".png"), Qt::CaseInsensitive)) target += QStringLiteral(".png");
  const QPixmap capture = view->grab();
  if (capture.isNull() || !capture.save(target, "PNG")) {
    QMessageBox::warning(this,
        I18n::text(QStringLiteral("capture.error_title"), QStringLiteral("Ekran Görüntüsü")),
        I18n::text(QStringLiteral("capture.error"), QStringLiteral("Görüntü kaydedilemedi.")));
  }
}

void BrowserWindow::showReaderMode() {
  auto *sourceView = currentView();
  const int sourceIndex = tabStrip_ ? tabStrip_->currentIndex() : -1;
  if (!sourceView || !sourceView->page() || sourceIndex < 0 || sourceIndex >= tabs_.size()) return;
  const QUrl sourceUrl = sourceView->url();
  if (sourceUrl.scheme() != QLatin1String("http") && sourceUrl.scheme() != QLatin1String("https")) return;
  const uint64_t sourceTabId = tabs_[sourceIndex].id;
  const QPointer<BrowserWindow> guard(this);
  sourceView->page()->runJavaScript(QStringLiteral(R"JS((() => {
    const root = document.querySelector('article, main, [role="main"]') || document.body;
    if (!root) return null;
    const blocks = [...root.querySelectorAll('h1,h2,h3,p,blockquote,pre,li')]
      .map(node => ({tag: node.tagName.toLowerCase(), text: (node.innerText || '').replace(/\s+/g, ' ').trim()}))
      .filter(item => item.text.length >= 20).slice(0, 500);
    const length = blocks.reduce((total, item) => total + item.text.length, 0);
    if (blocks.length < 3 || length < 300) return null;
    return {title: (document.querySelector('article h1, main h1, h1')?.innerText || document.title || '').trim(),
            site: location.hostname, url: location.href, blocks};
  })())JS"), [guard, sourceTabId](const QVariant &value) {
    if (!guard) return;
    const QVariantMap article = value.toMap();
    const QVariantList blocks = article.value(QStringLiteral("blocks")).toList();
    if (blocks.isEmpty()) {
      QMessageBox::information(guard,
          I18n::text(QStringLiteral("reader.title"), QStringLiteral("Okuyucu Modu")),
          I18n::text(QStringLiteral("reader.unsupported"), QStringLiteral("Bu sayfada okunabilir bir makale bulunamadı.")));
      return;
    }

    auto *readerPage = new QWidget;
    readerPage->setObjectName(QStringLiteral("reader-mode-page"));
    auto *layout = new QVBoxLayout(readerPage);
    layout->setContentsMargins(56, 28, 56, 28);
    layout->setSpacing(14);
    auto *exit = new QPushButton(I18n::text(QStringLiteral("reader.exit"), QStringLiteral("Okuyucu Modundan Çık")), readerPage);
    exit->setObjectName(QStringLiteral("reader-exit-button"));
    exit->setMaximumWidth(220);
    layout->addWidget(exit, 0, Qt::AlignLeft);
    auto *content = new QTextBrowser(readerPage);
    content->setObjectName(QStringLiteral("reader-content"));
    content->setOpenExternalLinks(true);
    content->setStyleSheet(QStringLiteral("QTextBrowser{background:#f7f3e8;color:#24211d;border:0;padding:24px;font:18px serif;}"));
    QString html = QStringLiteral("<h1>%1</h1><p><small>%2</small></p>")
        .arg(article.value(QStringLiteral("title")).toString().toHtmlEscaped(),
             article.value(QStringLiteral("site")).toString().toHtmlEscaped());
    for (const QVariant &itemValue : blocks) {
      const QVariantMap item = itemValue.toMap();
      const QString tag = item.value(QStringLiteral("tag")).toString();
      const QString text = item.value(QStringLiteral("text")).toString().left(12000).toHtmlEscaped();
      if (tag.startsWith(QLatin1Char('h'))) html += QStringLiteral("<h2>%1</h2>").arg(text);
      else if (tag == QLatin1String("blockquote")) html += QStringLiteral("<blockquote>%1</blockquote>").arg(text);
      else html += QStringLiteral("<p>%1</p>").arg(text);
    }
    content->setHtml(html);
    layout->addWidget(content, 1);
    const int readerIndex = guard->addInternalTab(readerPage,
        article.value(QStringLiteral("title")).toString().left(80),
        BrowserIcons::icon(BrowserIcon::Cards), QStringLiteral("reader-mode"));
    if (readerIndex < 0) { readerPage->deleteLater(); return; }
    const uint64_t readerTabId = guard->tabs_[readerIndex].id;
    QObject::connect(exit, &QPushButton::clicked, guard, [guard, sourceTabId, readerTabId] {
      if (!guard) return;
      const int reader = guard->findIndexByTabId(readerTabId);
      if (reader >= 0) guard->closeTab(reader);
      const int source = guard->findIndexByTabId(sourceTabId);
      if (source >= 0) guard->switchTab(source);
    });
  });
}

void BrowserWindow::toggleBrowserFullScreen() {
  if (isFullScreen()) {
    isWebFullScreen_ = false;
    if (topBar_) topBar_->show();
    if (navBar_) navBar_->show();
    showNormal();
    if (windowStateBeforeFullScreen_.testFlag(Qt::WindowMaximized)) showMaximized();
    else if (!geometryBeforeFullScreen_.isNull()) setGeometry(geometryBeforeFullScreen_);
    updateBookmarkBarVisibility();
    return;
  }
  windowStateBeforeFullScreen_ = windowState();
  geometryBeforeFullScreen_ = geometry();
  isWebFullScreen_ = true;
  if (topBar_) topBar_->hide();
  if (navBar_) navBar_->hide();
  if (bookmarkBar_) bookmarkBar_->hide();
  showFullScreen();
}

void BrowserWindow::handleFullScreenRequest(QWebEngineView *view, const QWebEngineFullScreenRequest &request) {
  Q_UNUSED(view);
  auto req = const_cast<QWebEngineFullScreenRequest &>(request);
  req.accept();

  if (req.toggleOn()) {
    if (!isWebFullScreen_) {
      windowStateBeforeFullScreen_ = windowState();
      geometryBeforeFullScreen_ = geometry();
      isWebFullScreen_ = true;
      if (topBar_) topBar_->hide();
      if (navBar_) navBar_->hide();
      if (bookmarkBar_) bookmarkBar_->hide();
      showFullScreen();
    }
  } else {
    if (isWebFullScreen_) {
      isWebFullScreen_ = false;
      if (topBar_) topBar_->show();
      if (navBar_) navBar_->show();
      updateBookmarkBarVisibility();
      const Qt::WindowStates prevState = windowStateBeforeFullScreen_ & ~Qt::WindowFullScreen;
      if (prevState.testFlag(Qt::WindowMaximized)) {
        showMaximized();
      } else {
        showNormal();
        if (!geometryBeforeFullScreen_.isNull()) {
          setGeometry(geometryBeforeFullScreen_);
        }
      }
    }
  }
}
