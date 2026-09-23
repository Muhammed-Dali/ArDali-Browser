#include <QEventLoopLocker>
#include <QDir>
#include <QDateTime>
#include <QFileInfo>
#include <QStandardPaths>
#include <QTemporaryDir>
#include <QCompleter>
#include <QStandardItemModel>
#include <QAbstractItemView>
#include "core/search_suggestion_service.h"
#include "core/search_engine_definition.h"
#include "browser_window.h"
#include "browser_window_internal.h"
#include "i18n/i18n.h"
#include "i18n/language_manager.h"

using dalinira::i18n::LanguageManager;
using dalinira::i18n::I18n;

#include <QApplication>
#include <QHBoxLayout>
#include <QIcon>
#include <QKeyEvent>
#include <QLineEdit>
#include <QMenu>
#include <QAction>
#include <QClipboard>
#include <QContextMenuEvent>
#include <QWebEngineContextMenuRequest>
#include <QMessageBox>
#include <QInputDialog>
#include <QMouseEvent>
#include <QProgressBar>
#include <QStackedWidget>
#include <QStyle>
#include <QPainter>
#include <QPainterPath>
#include <QParallelAnimationGroup>
#include <QGraphicsOpacityEffect>
#include <QPropertyAnimation>
#include <QSettings>
#include <QToolButton>
#include <QToolBar>
#include <QUrl>
#include <QUrlQuery>
#include <QJsonObject>
#include <QJsonArray>
#include <QJsonDocument>
#include <QWebEngineHistory>
#include <QWebEngineProfile>
#include <QWebEngineSettings>
#include <QWebEngineScriptCollection>
#include <QWindow>
#include <atomic>
#include <algorithm>
#include <utility>

#include "desktop_tabs/tab_drag_controller.h"
#include "desktop_tabs/tab_strip_widget.h"
#include "desktop_tabs/tab_window_registry.h"
#include "desktop_tabs/tab_search_popup.h"
#include "desktop_tabs/tab_group_model.h"
#include "desktop_tabs/tab_group_popup.h"
#include "desktop_tabs/tab_group_launcher_popup.h"
#include "desktop_tabs/tab_hover_card.h"
#include "desktop_tabs/tab_performance_manager.h"
#include "desktop_tabs/tab_throbber.h"
#include "core/browser_icons.h"
#if QT_VERSION < QT_VERSION_CHECK(6, 8, 0)
#include "core/browser_permission_policy.h"
#endif
#include "core/browser_ui_metrics.h"
#include "core/address_input_resolver.h"
#include "core/domain_normalizer.h"
#include "core/composite_navigation_candidate_provider.h"
#include "core/history_candidate_provider.h"
#include "core/bookmark_candidate_provider.h"
#include "core/frequent_sites_candidate_provider.h"
#include "core/adult_content_protection.h"
#include "newtab/new_tab_html.h"
#include "newtab/new_tab_background_store.h"
#include "newtab/new_tab_scheme.h"
#include "blocker/dalinira_blocker_service.h"
#include "passwords/credential_vault_manager.h"
#include "passwords/credential_autofill_controller.h"
#include "pulse/song_finder_settings_page.h"
#include "downloads/download_toolbar_ui.h"
#include "downloads/download_ui_model.h"
#include "downloads/local_media_player_page.h"
#include "downloads/media_page_url_resolver.h"
#include "translate/translate_service.h"
#include "desktop_tabs/find_bar_widget.h"
#include <QShortcut>
#include <QPrinter>
#include <QPrintDialog>
#include <QFileDialog>
#include <QPushButton>
#include <QTextBrowser>
#include <QVBoxLayout>
#include <QWebEngineFindTextResult>

namespace {
static std::atomic<uint64_t> s_tabIdSequence{1};

// NOTE: isNewTabUrl is defined inline in browser_window_internal.h


QString navigationUrlKey(const QUrl &url) {
  if (!url.isValid()) return {};
  return url.adjusted(QUrl::NormalizePathSegments | QUrl::RemoveFragment | QUrl::StripTrailingSlash)
      .toString(QUrl::FullyEncoded);
}

bool isInternalOrNonWebUrl(const QUrl &url) {
  if (!url.isValid() || url.isEmpty()) return true;
  const QString scheme = url.scheme().toLower();
  if (scheme == QLatin1String("dalinira") ||
      scheme == QLatin1String("about") ||
      scheme == QLatin1String("data") ||
      scheme == QLatin1String("file") ||
      scheme == QLatin1String("chrome") ||
      scheme == QLatin1String("edge")) {
    return true;
  }
  return isNewTabUrl(url);
}


QString bookmarkDisplayName(const QUrl &url) {
  const QString host = url.host().toLower();
  if (host.endsWith(QStringLiteral("youtube.com"))) return QStringLiteral("YouTube");
  if (host.endsWith(QStringLiteral("github.com"))) return QStringLiteral("GitHub");
  if (host.endsWith(QStringLiteral("wikipedia.org"))) return QStringLiteral("Wikipedia");
  if (host.endsWith(QStringLiteral("google.com"))) return QStringLiteral("Google");
  if (host.endsWith(QStringLiteral("duckduckgo.com"))) return QStringLiteral("DuckDuckGo");
  if (host.endsWith(QStringLiteral("startpage.com"))) return QStringLiteral("Startpage");
  if (host.endsWith(QStringLiteral("mojeek.com"))) return QStringLiteral("Mojeek");
  if (host.endsWith(QStringLiteral("facebook.com"))) return QStringLiteral("Facebook");
  if (host.endsWith(QStringLiteral("instagram.com"))) return QStringLiteral("Instagram");
  if (host.endsWith(QStringLiteral("openai.com")) || host.endsWith(QStringLiteral("chatgpt.com"))) return QStringLiteral("ChatGPT");
  if (host.endsWith(QStringLiteral("gitlab.com"))) return QStringLiteral("GitLab");
  if (host.endsWith(QStringLiteral("twitter.com")) || host.endsWith(QStringLiteral("x.com"))) return QStringLiteral("X");
  if (host.endsWith(QStringLiteral("threads.net"))) return QStringLiteral("Threads");
  if (host.endsWith(QStringLiteral("reddit.com"))) return QStringLiteral("Reddit");
  if (host.endsWith(QStringLiteral("tiktok.com"))) return QStringLiteral("TikTok");
  if (host.endsWith(QStringLiteral("linkedin.com"))) return QStringLiteral("LinkedIn");
  QString clean = host;
  if (clean.startsWith(QStringLiteral("www."))) clean.remove(0, 4);
  return clean.isEmpty() ? url.toDisplayString() : clean;
}

QIcon bookmarkIcon(bool bookmarked) {
  QPixmap pixmap(32, 32);
  pixmap.fill(Qt::transparent);
  QPainter painter(&pixmap);
  painter.setRenderHint(QPainter::Antialiasing);
  const QColor color = bookmarked ? QColor(QStringLiteral("#4fc3f7")) : QColor(QStringLiteral("#d8dce0"));
  QPainterPath ribbon;
  ribbon.moveTo(10.0, 5.5);
  ribbon.lineTo(22.0, 5.5);
  ribbon.lineTo(22.0, 25.0);
  ribbon.lineTo(16.0, 20.7);
  ribbon.lineTo(10.0, 25.0);
  ribbon.closeSubpath();
  painter.setPen(QPen(color, 2.0, Qt::SolidLine, Qt::RoundCap, Qt::RoundJoin));
  painter.setBrush(bookmarked ? QBrush(color) : Qt::NoBrush);
  painter.drawPath(ribbon);
  return QIcon(pixmap);
}

QIcon platformIconForBookmark(const QUrl &url) {
  const QString host = url.host().toLower();
  QPixmap pixmap(24, 24);
  pixmap.fill(Qt::transparent);
  QPainter painter(&pixmap);
  painter.setRenderHint(QPainter::Antialiasing);

  if (host.endsWith(QStringLiteral("duckduckgo.com"))) {
    return BrowserIcons::searchEngineIcon(QStringLiteral("DuckDuckGo"));
  }
  if (host.endsWith(QStringLiteral("gitlab.com"))) {
    painter.setPen(Qt::NoPen);
    painter.setBrush(QColor(QStringLiteral("#fc6d26")));
    painter.drawRoundedRect(QRectF(1, 1, 22, 22), 4, 4);
    painter.setPen(Qt::white);
    QFont font = painter.font();
    font.setBold(true);
    font.setPixelSize(10);
    painter.setFont(font);
    painter.drawText(pixmap.rect(), Qt::AlignCenter, QStringLiteral("GL"));
    return QIcon(pixmap);
  }
  if (host.endsWith(QStringLiteral("openai.com")) || host.endsWith(QStringLiteral("chatgpt.com"))) {
    painter.setPen(Qt::NoPen);
    painter.setBrush(QColor(QStringLiteral("#10a37f")));
    painter.drawEllipse(QRectF(1, 1, 22, 22));
    painter.setPen(Qt::white);
    QFont font = painter.font();
    font.setBold(true);
    font.setPixelSize(10);
    painter.setFont(font);
    painter.drawText(pixmap.rect(), Qt::AlignCenter, QStringLiteral("AI"));
    return QIcon(pixmap);
  }
  if (host.endsWith(QStringLiteral("youtube.com"))) {
    painter.setPen(Qt::NoPen);
    painter.setBrush(QColor(QStringLiteral("#ff0000")));
    painter.drawRoundedRect(QRectF(1, 4, 22, 16), 4, 4);
    painter.setBrush(Qt::white);
    QPolygonF triangle;
    triangle << QPointF(9.5, 8.5) << QPointF(16, 12) << QPointF(9.5, 15.5);
    painter.drawPolygon(triangle);
    return QIcon(pixmap);
  }
  if (host.endsWith(QStringLiteral("github.com"))) {
    painter.setPen(Qt::NoPen);
    painter.setBrush(QColor(QStringLiteral("#24292f")));
    painter.drawEllipse(QRectF(1, 1, 22, 22));
    painter.setPen(Qt::white);
    QFont font = painter.font();
    font.setBold(true);
    font.setPixelSize(10);
    painter.setFont(font);
    painter.drawText(pixmap.rect(), Qt::AlignCenter, QStringLiteral("GH"));
    return QIcon(pixmap);
  }
  if (host.endsWith(QStringLiteral("facebook.com"))) {
    painter.setPen(Qt::NoPen);
    painter.setBrush(QColor(QStringLiteral("#1877f2")));
    painter.drawEllipse(QRectF(1, 1, 22, 22));
    painter.setPen(Qt::white);
    QFont font = painter.font();
    font.setBold(true);
    font.setPixelSize(15);
    painter.setFont(font);
    painter.drawText(QRectF(3, 0, 20, 24), Qt::AlignCenter, QStringLiteral("f"));
    return QIcon(pixmap);
  }
  if (host.endsWith(QStringLiteral("instagram.com"))) {
    QLinearGradient grad(0, 24, 24, 0);
    grad.setColorAt(0.0, QColor(QStringLiteral("#f09433")));
    grad.setColorAt(0.3, QColor(QStringLiteral("#e6683c")));
    grad.setColorAt(0.6, QColor(QStringLiteral("#dc2743")));
    grad.setColorAt(1.0, QColor(QStringLiteral("#bc1888")));
    painter.setPen(Qt::NoPen);
    painter.setBrush(grad);
    painter.drawRoundedRect(QRectF(1, 1, 22, 22), 5, 5);
    painter.setPen(QPen(Qt::white, 1.6));
    painter.setBrush(Qt::NoBrush);
    painter.drawRoundedRect(QRectF(4.5, 4.5, 15, 15), 3.5, 3.5);
    painter.drawEllipse(QRectF(8, 8, 8, 8));
    painter.setBrush(Qt::white);
    painter.drawEllipse(QRectF(15.5, 6.5, 1.8, 1.8));
    return QIcon(pixmap);
  }
  if (host.endsWith(QStringLiteral("google.com"))) {
    painter.setPen(Qt::NoPen);
    painter.setBrush(QColor(QStringLiteral("#4285f4")));
    painter.drawEllipse(QRectF(1, 1, 22, 22));
    painter.setPen(Qt::white);
    QFont font = painter.font();
    font.setBold(true);
    font.setPixelSize(14);
    painter.setFont(font);
    painter.drawText(pixmap.rect(), Qt::AlignCenter, QStringLiteral("G"));
    return QIcon(pixmap);
  }
  if (host.endsWith(QStringLiteral("wikipedia.org"))) {
    painter.setPen(Qt::NoPen);
    painter.setBrush(QColor(QStringLiteral("#eef0f2")));
    painter.drawEllipse(QRectF(1, 1, 22, 22));
    painter.setPen(QColor(QStringLiteral("#202122")));
    QFont font = painter.font();
    font.setBold(true);
    font.setPixelSize(13);
    painter.setFont(font);
    painter.drawText(pixmap.rect(), Qt::AlignCenter, QStringLiteral("W"));
    return QIcon(pixmap);
  }
  if (host.endsWith(QStringLiteral("threads.net"))) {
    painter.setPen(Qt::NoPen);
    painter.setBrush(QColor(QStringLiteral("#101010")));
    painter.drawEllipse(QRectF(1, 1, 22, 22));
    painter.setPen(Qt::white);
    QFont font = painter.font();
    font.setBold(true);
    font.setPixelSize(14);
    painter.setFont(font);
    painter.drawText(pixmap.rect(), Qt::AlignCenter, QStringLiteral("@"));
    return QIcon(pixmap);
  }

  // Fallback initial icon
  QString initial = host.section(QLatin1Char('.'), 0, 0).left(1).toUpper();
  if (initial.isEmpty()) initial = QStringLiteral("★");
  const QColor bg = QColor::fromHsv(int(qHash(host) % 360), 140, 180);
  painter.setPen(Qt::NoPen);
  painter.setBrush(bg);
  painter.drawRoundedRect(QRectF(1, 1, 22, 22), 4, 4);
  painter.setPen(Qt::white);
  QFont font = painter.font();
  font.setBold(true);
  font.setPixelSize(12);
  painter.setFont(font);
  painter.drawText(pixmap.rect(), Qt::AlignCenter, initial);
  return QIcon(pixmap);
}

class BrowserWebPage final : public QWebEnginePage {
 public:
  BrowserWebPage(QWebEngineProfile *profile, BrowserWindow *window, QObject *parent = nullptr)
      : QWebEnginePage(profile, parent), window_(window) {
    setBackgroundColor(QColor(7, 17, 31));
    installMediaCaptureHook();
    scripts().insert(CredentialAutofillController::candidateCaptureScript());
  }

  void setMediaCaptureCallback(std::function<void(bool, bool)> cb) {
    onMediaCaptureChanged_ = std::move(cb);
  }

  void resetMediaCapture() {
    if (onMediaCaptureChanged_) onMediaCaptureChanged_(false, false);
  }

 protected:
  void javaScriptConsoleMessage(JavaScriptConsoleMessageLevel level,
                                const QString &message,
                                int lineNumber,
                                const QString &sourceID) override {
    if (message.startsWith(QLatin1String("__DALINIRA_MEDIA_CAPTURE__:"))) {
      const bool v = message.contains(QLatin1String("V1"));
      const bool a = message.contains(QLatin1String("A1"));
      if (onMediaCaptureChanged_) onMediaCaptureChanged_(v, a);
      return;
    }
    if (message.startsWith(QLatin1String("__DALINIRA_ADBLOCK_HIT__:"))) {
      const QStringList parts = message.split(QLatin1Char(':'));
      quint64 count = 1;
      if (parts.size() > 1) {
        bool ok = false;
        const quint64 parsed = parts[1].toULongLong(&ok);
        if (ok && parsed > 0) count = parsed;
      }
      auto *view = qobject_cast<QWebEngineView *>(parent());
      if (view && window_) {
        const quint64 tabId = reinterpret_cast<quintptr>(view);
        auto *blocker = window_->services().profileService ? window_->services().profileService->adBlockService() : nullptr;
        if (blocker) {
          const QString subType = parts.value(2);
          blocker->reportBlockedEvent(tabId, DaliNiraBlockType::Cosmetic, count, subType);
        }
      }
      return;
    }
    if (window_ && window_->autofillController() &&
        window_->autofillController()->handleConsoleMessage(this, message)) {
      return;
    }
    QWebEnginePage::javaScriptConsoleMessage(level, message, lineNumber, sourceID);
  }

  bool acceptNavigationRequest(const QUrl &url, NavigationType type, bool isMainFrame) override {
    if (isMainFrame && onMediaCaptureChanged_) {
      onMediaCaptureChanged_(false, false);
    }
    if (url.scheme() == QLatin1String("dalinira") && url.host() == QLatin1String("suggest")) {
      const QUrlQuery params(url);
      const QString capability = property("dalinira-suggest-capability").toString();
      auto *view = qobject_cast<QWebEngineView *>(parent());
      auto *window = view ? qobject_cast<BrowserWindow *>(view->window()) : nullptr;
      if (!isNewTabUrl(this->url()) || capability.isEmpty() ||
          params.queryItemValue(QStringLiteral("cap")) != capability || !window ||
          window->currentView() != view || profile() != window->services().profile || url.toString().size() > 4096)
        return false;
      const QString command = params.queryItemValue(QStringLiteral("op"));
      auto *service = window->services().profileService;
      if (command == QLatin1String("consent") && service && !profile()->isOffTheRecord()) {
        const QString value = params.queryItemValue(QStringLiteral("enabled"));
        if (value == QLatin1String("true") || value == QLatin1String("false"))
          service->setSearchSuggestionsEnabled(value == QLatin1String("true"));
      } else if (command == QLatin1String("query")) {
        bool ok = false;
        const int id = params.queryItemValue(QStringLiteral("id")).toInt(&ok);
        const QString text = params.queryItemValue(QStringLiteral("q"), QUrl::FullyDecoded);
        if (ok && id >= 0 && text.size() <= 256 &&
            (view->hasFocus() || view->isAncestorOf(QApplication::focusWidget())))
          window->requestNewTabSuggestions(this, text, id);
      } else if (command == QLatin1String("activate")) {
        const QString text = params.queryItemValue(QStringLiteral("q"), QUrl::FullyDecoded).simplified().left(256);
        const QPointer<QWebEngineView> guardedView(view);
        if (!text.isEmpty()) {
          QMetaObject::invokeMethod(view, [guardedView, text] {
            if (!guardedView || !isNewTabUrl(guardedView->url())) return;
            if (auto *owner = qobject_cast<BrowserWindow *>(guardedView->window());
                owner && owner->currentView() == guardedView)
              owner->navigateFromUserInput(text);
          }, Qt::QueuedConnection);
        }
      } else if (command == QLatin1String("delete-history") && service && !profile()->isOffTheRecord()) {
        bool ok = false;
        const int id = params.queryItemValue(QStringLiteral("id")).toInt(&ok);
        const QString text = params.queryItemValue(QStringLiteral("q"), QUrl::FullyDecoded).simplified().left(256);
        const QString input = params.queryItemValue(QStringLiteral("input"), QUrl::FullyDecoded).left(256);
        if (ok && id >= 0 && !text.isEmpty() && service->removeSearchHistory(text))
          window->requestNewTabSuggestions(this, input, id);
      }
      return false;
    }
    if (url.scheme() == QLatin1String("dalinira") && url.host() == QLatin1String("search-engine")) {
      const QString engine = QUrlQuery(url).queryItemValue(QStringLiteral("engine"));
      const bool allowed = QStringList{QStringLiteral("Google"), QStringLiteral("DuckDuckGo"), QStringLiteral("Startpage"), QStringLiteral("Mojeek")}.contains(engine);
      const QPointer<QWebEngineView> view(qobject_cast<QWebEngineView *>(parent()));
      const QString capability = property("dalinira-suggest-capability").toString();
      if (isMainFrame && isNewTabUrl(this->url()) && allowed && view && !capability.isEmpty() &&
          QUrlQuery(url).queryItemValue(QStringLiteral("cap")) == capability) {
        QMetaObject::invokeMethod(view, [view, engine] {
          if (!view || !isNewTabUrl(view->url())) return;
          if (auto *window = qobject_cast<BrowserWindow *>(view->window())) window->setSearchEngine(engine);
        }, Qt::QueuedConnection);
      }
      return false;
    }
    if (url.scheme() == QLatin1String("dalinira") && url.host() == QLatin1String("card-settings")) {
      const QUrlQuery q(url);
      const bool downloads = q.queryItemValue(QStringLiteral("downloads")) == QLatin1String("1");
      const bool blocked = q.queryItemValue(QStringLiteral("blocked")) == QLatin1String("1");
      QString mode = q.queryItemValue(QStringLiteral("mode"));
      if (mode != QLatin1String("session") && mode != QLatin1String("all_time")) mode = QStringLiteral("all_time");

      const QPointer<QWebEngineView> view(qobject_cast<QWebEngineView *>(parent()));
      const QString capability = property("dalinira-suggest-capability").toString();
      if (isMainFrame && isNewTabUrl(this->url()) && view && !capability.isEmpty() &&
          q.queryItemValue(QStringLiteral("cap")) == capability) {
        QMetaObject::invokeMethod(view, [view, downloads, blocked, mode] {
          if (!view || !isNewTabUrl(view->url())) return;
          QSettings settings;
          settings.setValue(QStringLiteral("browser/showDownloadsCard"), downloads);
          settings.setValue(QStringLiteral("browser/showBlockedCard"), blocked);
          settings.setValue(QStringLiteral("browser/blockedCounterMode"), mode);
          settings.setValue(QStringLiteral("browser/cards"), downloads || blocked);
          settings.sync();
          if (auto *window = qobject_cast<BrowserWindow *>(view->window())) {
            window->syncNewTabViews();
          }
        }, Qt::QueuedConnection);
      }
      return false;
    }
    if (url.scheme() == QLatin1String("dalinira") && url.host() == QLatin1String("newtab-background")) {
      const QUrlQuery query(url);
      const QString command = query.queryItemValue(QStringLiteral("op"));
      const QString capability = property("dalinira-suggest-capability").toString();
      auto *view = qobject_cast<QWebEngineView *>(parent());
      auto *window = view ? qobject_cast<BrowserWindow *>(view->window()) : nullptr;
      if (isMainFrame && isNewTabUrl(this->url()) && view && window &&
          window->currentView() == view && profile() == window->services().profile &&
          !profile()->isOffTheRecord() && !capability.isEmpty() &&
          query.queryItemValue(QStringLiteral("cap")) == capability &&
          (command == QLatin1String("pick") || command == QLatin1String("remove")) &&
          url.toString().size() <= 1024) {
        const QPointer<QWebEnginePage> guardedPage(this);
        QMetaObject::invokeMethod(view, [guardedPage, command, capability] {
          if (!guardedPage) return;
          auto *guardedView = qobject_cast<QWebEngineView *>(guardedPage->parent());
          auto *owner = guardedView ? qobject_cast<BrowserWindow *>(guardedView->window()) : nullptr;
          if (owner) owner->handleNewTabBackgroundCommand(guardedPage, command, capability);
        }, Qt::QueuedConnection);
      }
      return false;
    }
    if (url.scheme().compare(QLatin1String("dalinira"), Qt::CaseInsensitive) == 0 &&
        url.host().compare(QLatin1String("navigate"), Qt::CaseInsensitive) == 0) {
      // 1. Strict origin validation: Only dalinira://newtab or dalinira://newtab/ is permitted
      const QUrl sourceUrl = this->url();
      const QString capability = property("dalinira-suggest-capability").toString();
      auto *sourceView = qobject_cast<QWebEngineView *>(parent());
      auto *owner = sourceView ? qobject_cast<BrowserWindow *>(sourceView->window()) : nullptr;
      const bool trustedSource = isNewTabUrl(sourceUrl) && !capability.isEmpty() && owner &&
          owner->currentView() == sourceView && profile() == owner->services().profile &&
          QUrlQuery(url).queryItemValue(QStringLiteral("cap")) == capability;
      if (!trustedSource) {
        qWarning() << "[Security] Denied unauthorized internal navigation";
        return false;
      }

      // 2. Query size & input safety
      const QUrlQuery query(url);
      const QString rawQuery = query.queryItemValue(QStringLiteral("q"), QUrl::FullyDecoded);
      if (rawQuery.trimmed().isEmpty() || rawQuery.length() > 4096) {
        return false;
      }

      // 3. Search engine parameter validation (whitelist)
      const QString rawEngine = query.queryItemValue(QStringLiteral("engine"), QUrl::FullyDecoded).trimmed();
      QString validatedEngine;
      if (rawEngine.compare(QLatin1String("Google"), Qt::CaseInsensitive) == 0) {
        validatedEngine = QStringLiteral("Google");
      } else if (rawEngine.compare(QLatin1String("DuckDuckGo"), Qt::CaseInsensitive) == 0) {
        validatedEngine = QStringLiteral("DuckDuckGo");
      } else if (rawEngine.compare(QLatin1String("Startpage"), Qt::CaseInsensitive) == 0) {
        validatedEngine = QStringLiteral("Startpage");
      } else if (rawEngine.compare(QLatin1String("Mojeek"), Qt::CaseInsensitive) == 0) {
        validatedEngine = QStringLiteral("Mojeek");
      } else if (rawEngine.compare(QLatin1String("Brave Search"), Qt::CaseInsensitive) == 0 ||
                 rawEngine.compare(QLatin1String("Brave"), Qt::CaseInsensitive) == 0 ||
                 rawEngine.compare(QLatin1String("Bing"), Qt::CaseInsensitive) == 0) {
        validatedEngine = QStringLiteral("Google");
      } else if (window_) {
        validatedEngine = window_->currentSearchEngine();
      } else {
        validatedEngine = QStringLiteral("DuckDuckGo");
      }

      // Revalidate the current native owner at execution time (tabs may move).
      const QPointer<QWebEngineView> view(qobject_cast<QWebEngineView *>(parent()));
      if (view) {
        QMetaObject::invokeMethod(view, [view, rawQuery, validatedEngine, capability] {
          if (!view || !isNewTabUrl(view->url()) ||
              view->page()->property("dalinira-suggest-capability").toString() != capability) return;
          auto *window = qobject_cast<BrowserWindow *>(view->window());
          if (window && window->currentView() == view && view->page()->profile() == window->services().profile)
            window->navigateFromUserInput(rawQuery, validatedEngine);
        }, Qt::QueuedConnection);
      }
      return false;
    }
    if (isMainFrame) {
      if (url.scheme() == QLatin1String("http") || url.scheme() == QLatin1String("https")) {
        auto *view = qobject_cast<QWebEngineView *>(parent());
        auto *window = window_ ? window_.data() : (view ? qobject_cast<BrowserWindow *>(view->window()) : nullptr);
        auto *profileService = window ? window->services().profileService : nullptr;
        const bool adultProtection = profileService ? profileService->isAdultContentProtectionEnabled() : true;
        if (adultProtection && dalinira::core::AdultContentProtectionService::instance().isBlocked(url)) {
          const QPointer<BrowserWebPage> guardedPage(this);
          QMetaObject::invokeMethod(this, [guardedPage] {
            if (guardedPage) {
              guardedPage->setUrl(QUrl(QStringLiteral("dalinira://blocked/adult")));
            }
          }, Qt::QueuedConnection);
          return false;
        }
      }
      if (auto *view = qobject_cast<QWebEngineView *>(parent())) {
        if (auto *window = window_ ? window_.data() : qobject_cast<BrowserWindow *>(view->window())) {
          if ((url.scheme() == QLatin1String("http") || url.scheme() == QLatin1String("https")) &&
              profile() == window->services().profile) {
            window->prepareAdBlockScripts(this, url);
          }
          window->notifyNavigationStarted(view, url);
        }
      }
    }
    return QWebEnginePage::acceptNavigationRequest(url, type, isMainFrame);
  }

 private:
  void installMediaCaptureHook() {
    static const QString s_hookScript = QStringLiteral(R"JS(
(function() {
  if (!window.location || (window.location.protocol !== 'http:' && window.location.protocol !== 'https:')) return;
  if (window.__daliniraMediaHookInstalled) return;
  window.__daliniraMediaHookInstalled = true;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
  var origGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  var activeVideoTracks = 0;
  var activeAudioTracks = 0;
  function updateCapture() {
    console.debug('__DALINIRA_MEDIA_CAPTURE__:V' + (activeVideoTracks > 0 ? '1' : '0') + 'A' + (activeAudioTracks > 0 ? '1' : '0'));
  }
  navigator.mediaDevices.getUserMedia = function(constraints) {
    return origGetUserMedia(constraints).then(function(stream) {
      var vt = stream.getVideoTracks();
      var at = stream.getAudioTracks();
      if (vt.length > 0) {
        activeVideoTracks += vt.length;
        vt.forEach(function(t) {
          t.addEventListener('ended', function() {
            activeVideoTracks = Math.max(0, activeVideoTracks - 1);
            updateCapture();
          });
          var origStop = t.stop.bind(t);
          t.stop = function() {
            activeVideoTracks = Math.max(0, activeVideoTracks - 1);
            updateCapture();
            return origStop();
          };
        });
      }
      if (at.length > 0) {
        activeAudioTracks += at.length;
        at.forEach(function(t) {
          t.addEventListener('ended', function() {
            activeAudioTracks = Math.max(0, activeAudioTracks - 1);
            updateCapture();
          });
          var origStop = t.stop.bind(t);
          t.stop = function() {
            activeAudioTracks = Math.max(0, activeAudioTracks - 1);
            updateCapture();
            return origStop();
          };
        });
      }
      updateCapture();
      return stream;
    });
  };
})();
)JS");

    QWebEngineScript script;
    script.setName(QStringLiteral("dalinira-media-capture-hook"));
    script.setInjectionPoint(QWebEngineScript::DocumentCreation);
    script.setWorldId(QWebEngineScript::MainWorld);
    script.setRunsOnSubFrames(true);
    script.setSourceCode(s_hookScript);
    scripts().insert(script);
  }

  QWebEnginePage *createWindow(WebWindowType type) override {
    if (!window_) return nullptr;
    if (type == WebBrowserWindow) {
      auto *newWin = new BrowserWindow(window_->services());
      newWin->addNewTab();
      newWin->show();
      return newWin->currentView() ? newWin->currentView()->page() : nullptr;
    }
    int newIdx = window_->addNewTab();
    if (newIdx >= 0 && newIdx < window_->tabCount()) {
      auto v = window_->allTabs()[newIdx].view;
      if (v) return v->page();
    }
    return nullptr;
  }

  QPointer<BrowserWindow> window_;
  std::function<void(bool, bool)> onMediaCaptureChanged_;
};

class BrowserWebView final : public QWebEngineView {
 public:
  explicit BrowserWebView(BrowserWindow *window, QWidget *parent = nullptr)
      : QWebEngineView(parent), window_(window) {
    setStyleSheet(QStringLiteral("background-color: #07111f;"));
    QPalette pal = palette();
    pal.setColor(QPalette::Window, QColor(7, 17, 31));
    pal.setColor(QPalette::Base, QColor(7, 17, 31));
    setPalette(pal);
    setAutoFillBackground(true);
  }

 protected:
  void contextMenuEvent(QContextMenuEvent *event) override {
    const auto *req = lastContextMenuRequest();
    if (req && !req->linkUrl().isEmpty() && req->linkUrl().isValid()) {
      showLinkContextMenu(req->linkUrl(), req->linkText(), event->globalPos());
      event->accept();
      return;
    }
    if (req && !req->selectedText().trimmed().isEmpty()) {
      showSelectionContextMenu(req->selectedText().trimmed(), event->globalPos());
      event->accept();
      return;
    }
    showPageContextMenu(event->globalPos());
    event->accept();
  }

 private:
  void showLinkContextMenu(const QUrl &linkUrl, const QString &linkText, const QPoint &globalPos) {
    QMenu menu(this);
    menu.setStyleSheet(QStringLiteral(
        "QMenu { background-color: #1b232d; color: #e8eef5; border: 1px solid #3a4857; border-radius: 9px; padding: 6px 4px; font-size: 13px; }"
        "QMenu::item { min-height: 25px; padding: 4px 26px 4px 12px; border-radius: 6px; margin: 1px 3px; }"
        "QMenu::item:selected { background-color: #2b3947; color: #ffffff; }"
        "QMenu::item:disabled { color: #6f7b87; background-color: transparent; }"
        "QMenu::separator { height: 1px; background-color: #33404d; margin: 5px 8px; }"
        "QMenu::icon { padding-left: 6px; }"
    ));

    // 1. Bağlantıyı yeni sekmede aç
    QAction *openTabAct = menu.addAction(BrowserIcons::icon(BrowserIcon::NewTab), I18n::text(QStringLiteral("context.open_link_tab"), QStringLiteral("Bağlantıyı yeni sekmede aç")));
    QObject::connect(openTabAct, &QAction::triggered, [this, linkUrl] {
      if (window_) {
        int nextSlot = window_->tabStrip() ? window_->tabStrip()->currentIndex() + 1 : -1;
        window_->addNewTab(linkUrl, nextSlot);
      }
    });

    // 2. Bağlantıyı yeni pencerede aç
    QAction *openWinAct = menu.addAction(BrowserIcons::icon(BrowserIcon::Window), I18n::text(QStringLiteral("context.open_link_window"), QStringLiteral("Bağlantıyı yeni pencerede aç")));
    QObject::connect(openWinAct, &QAction::triggered, [this, linkUrl] {
      if (window_) {
        auto *newWin = new BrowserWindow(window_->services());
        newWin->addNewTab(linkUrl);
        newWin->show();
      }
    });

    // 3. Bağlantıyı bölünmüş görünümde aç
    QAction *splitAct = menu.addAction(BrowserIcons::icon(BrowserIcon::Cards), I18n::text(QStringLiteral("context.open_link_split"), QStringLiteral("Bağlantıyı bölünmüş görünümde aç")));
    splitAct->setEnabled(false);

    // 4. Bağlantıyı Gizli pencerede aç
    QAction *incognitoAct = menu.addAction(BrowserIcons::icon(BrowserIcon::Incognito), I18n::text(QStringLiteral("context.open_link_incognito"), QStringLiteral("Bağlantıyı Gizli pencerede aç")));
    QObject::connect(incognitoAct, &QAction::triggered, [this, linkUrl] {
      if (window_) {
        window_->openIncognitoWindow(linkUrl);
      }
    });

    // 5. Bağlantıyı farklı aç
    QAction *openAsAct = menu.addAction(I18n::text(QStringLiteral("context.open_link_as"), QStringLiteral("Bağlantıyı farklı aç")));
    openAsAct->setEnabled(false);

    menu.addSeparator();

    // 6. Bağlantıyı farklı kaydet...
    QAction *saveAct = menu.addAction(BrowserIcons::icon(BrowserIcon::Save), I18n::text(QStringLiteral("context.save_link_as"), QStringLiteral("Bağlantıyı farklı kaydet...")));
    QObject::connect(saveAct, &QAction::triggered, [this, linkUrl] {
      if (page()) {
        page()->download(linkUrl);
      }
    });

    // 7. Bağlantı adresini kopyala
    QAction *copyAct = menu.addAction(BrowserIcons::icon(BrowserIcon::Clipboard), I18n::text(QStringLiteral("context.copy_link_address"), QStringLiteral("Bağlantı adresini kopyala")));
    QObject::connect(copyAct, &QAction::triggered, [linkUrl] {
      QGuiApplication::clipboard()->setText(linkUrl.toString());
    });

    // 8. Bağlantıyı okuma listesine ekle
    QAction *readingListAct = menu.addAction(BrowserIcons::icon(BrowserIcon::Bookmark), I18n::text(QStringLiteral("context.add_link_reading_list"), QStringLiteral("Bağlantıyı okuma listesine ekle")));
    QObject::connect(readingListAct, &QAction::triggered, [this, linkUrl] {
      if (window_ && window_->services().profileService) {
        window_->services().profileService->toggleBookmark(linkUrl);
        window_->updateBookmarkButtonState();
        window_->renderBookmarks();
      }
    });

    menu.addSeparator();

    // 9. İncele
    QAction *inspectAct = menu.addAction(BrowserIcons::icon(BrowserIcon::Tools), I18n::text(QStringLiteral("context.inspect"), QStringLiteral("İncele")));
    QObject::connect(inspectAct, &QAction::triggered, [this] {
      if (window_ && page()) {
        window_->openDevToolsForPage(page());
      }
    });

    menu.exec(globalPos);
  }

  void showSelectionContextMenu(const QString &selectedText, const QPoint &globalPos) {
    QMenu menu(this);
    menu.setStyleSheet(QStringLiteral(
        "QMenu { background-color: #1b232d; color: #e8eef5; border: 1px solid #3a4857; border-radius: 9px; padding: 6px 4px; font-size: 13px; }"
        "QMenu::item { min-height: 25px; padding: 4px 26px 4px 12px; border-radius: 6px; margin: 1px 3px; }"
        "QMenu::item:selected { background-color: #2b3947; color: #ffffff; }"
        "QMenu::item:disabled { color: #6f7b87; background-color: transparent; }"
        "QMenu::separator { height: 1px; background-color: #33404d; margin: 5px 8px; }"
        "QMenu::icon { padding-left: 6px; }"
    ));

    QAction *copyAct = menu.addAction(BrowserIcons::icon(BrowserIcon::Clipboard), I18n::text(QStringLiteral("context.copy"), QStringLiteral("Kopyala")));
    copyAct->setShortcut(QKeySequence::Copy);
    QObject::connect(copyAct, &QAction::triggered, [selectedText] {
      QGuiApplication::clipboard()->setText(selectedText);
    });

    const QString engine = window_ ? window_->currentSearchEngine() : QStringLiteral("DuckDuckGo");
    const QString truncated = selectedText.length() > 24 ? selectedText.left(21) + QStringLiteral("...") : selectedText;
    QAction *searchAct = menu.addAction(BrowserIcons::icon(BrowserIcon::Search),
                                        I18n::text(QStringLiteral("context.search_for"), QStringLiteral("%1 ile \"%2\" ara")).arg(engine, truncated));
    QObject::connect(searchAct, &QAction::triggered, [this, selectedText] {
      if (window_) {
        int nextSlot = window_->tabStrip() ? window_->tabStrip()->currentIndex() + 1 : -1;
        window_->addNewTab(QUrl(QStringLiteral("dalinira://newtab/")), nextSlot);
        window_->navigateFromUserInput(selectedText);
      }
    });

    menu.addSeparator();

    QAction *inspectAct = menu.addAction(BrowserIcons::icon(BrowserIcon::Tools), I18n::text(QStringLiteral("context.inspect"), QStringLiteral("İncele")));
    QObject::connect(inspectAct, &QAction::triggered, [this] {
      if (window_ && page()) {
        window_->openDevToolsForPage(page());
      }
    });

    menu.exec(globalPos);
  }

  void showPageContextMenu(const QPoint &globalPos) {
    QMenu menu(this);
    menu.setStyleSheet(QStringLiteral(
        "QMenu { background-color: #1b232d; color: #e8eef5; border: 1px solid #3a4857; border-radius: 9px; padding: 6px 4px; font-size: 13px; }"
        "QMenu::item { min-height: 25px; padding: 4px 26px 4px 12px; border-radius: 6px; margin: 1px 3px; }"
        "QMenu::item:selected { background-color: #2b3947; color: #ffffff; }"
        "QMenu::item:disabled { color: #6f7b87; background-color: transparent; }"
        "QMenu::separator { height: 1px; background-color: #33404d; margin: 5px 8px; }"
        "QMenu::icon { padding-left: 6px; }"
    ));

    QAction *backAct = menu.addAction(BrowserIcons::icon(BrowserIcon::ArrowLeft), I18n::text(QStringLiteral("context.back"), QStringLiteral("Geri")));
    backAct->setEnabled(history() ? history()->canGoBack() : false);
    QObject::connect(backAct, &QAction::triggered, this, &QWebEngineView::back);

    QAction *forwardAct = menu.addAction(I18n::text(QStringLiteral("context.forward"), QStringLiteral("İleri")));
    forwardAct->setEnabled(history() ? history()->canGoForward() : false);
    QObject::connect(forwardAct, &QAction::triggered, this, &QWebEngineView::forward);

    QAction *reloadAct = menu.addAction(I18n::text(QStringLiteral("context.reload"), QStringLiteral("Yeniden Yükle")));
    reloadAct->setShortcut(QKeySequence(Qt::CTRL | Qt::Key_R));
    QObject::connect(reloadAct, &QAction::triggered, this, &QWebEngineView::reload);

    menu.addSeparator();

    QAction *savePageAct = menu.addAction(BrowserIcons::icon(BrowserIcon::Save), I18n::text(QStringLiteral("context.save_page_as"), QStringLiteral("Farklı kaydet...")));
    savePageAct->setShortcut(QKeySequence::Save);
    QObject::connect(savePageAct, &QAction::triggered, [this] {
      if (page()) page()->triggerAction(QWebEnginePage::SavePage);
    });

    QAction *printAct = menu.addAction(BrowserIcons::icon(BrowserIcon::Print), I18n::text(QStringLiteral("context.print"), QStringLiteral("Yazdır...")));
    printAct->setShortcut(QKeySequence::Print);
    printAct->setEnabled(true);
    QObject::connect(printAct, &QAction::triggered, [this] {
      if (window_) window_->printCurrentPage();
    });

    QAction *captureAct = menu.addAction(I18n::text(QStringLiteral("context.capture_page"), QStringLiteral("Görünür alanın ekran görüntüsünü al...")));
    QObject::connect(captureAct, &QAction::triggered, [this] {
      if (window_) window_->captureVisiblePage();
    });

    QAction *readerAct = menu.addAction(I18n::text(QStringLiteral("context.reader_mode"), QStringLiteral("Okuyucu Modunda Aç")));
    const QUrl pageUrl = url();
    readerAct->setEnabled(pageUrl.scheme() == QLatin1String("http") || pageUrl.scheme() == QLatin1String("https"));
    QObject::connect(readerAct, &QAction::triggered, [this] {
      if (window_) window_->showReaderMode();
    });

    QAction *translateAct = menu.addAction(BrowserIcons::icon(BrowserIcon::Language),
        I18n::text(QStringLiteral("context.translate_page"), QStringLiteral("Sayfayı Çevir")));
    translateAct->setObjectName(QStringLiteral("contextTranslatePageAction"));
    translateAct->setEnabled(pageUrl.scheme() == QLatin1String("http") || pageUrl.scheme() == QLatin1String("https"));
    QObject::connect(translateAct, &QAction::triggered, [this] {
      if (window_) window_->showTranslatePopup();
    });

    menu.addSeparator();

    QAction *viewSourceAct = menu.addAction(I18n::text(QStringLiteral("context.view_source"), QStringLiteral("Sayfa kaynağını görüntüle")));
    viewSourceAct->setShortcut(QKeySequence(Qt::CTRL | Qt::Key_U));
    QObject::connect(viewSourceAct, &QAction::triggered, [this] {
      if (page()) page()->triggerAction(QWebEnginePage::ViewSource);
    });

    QAction *inspectAct = menu.addAction(BrowserIcons::icon(BrowserIcon::Tools), I18n::text(QStringLiteral("context.inspect"), QStringLiteral("İncele")));
    QObject::connect(inspectAct, &QAction::triggered, [this] {
      if (window_ && page()) {
        window_->openDevToolsForPage(page());
      }
    });

    menu.exec(globalPos);
  }

  QPointer<BrowserWindow> window_;
};
}  // namespace

BrowserWindow::BrowserWindow(const BrowserServices &services, bool isCaptureShell, QWidget *parent)
    : QMainWindow(parent), services_(services), isCaptureShell_(isCaptureShell) {
  setObjectName(QStringLiteral("BrowserWindow"));
  setWindowFlag(Qt::FramelessWindowHint, true);
  setAttribute(Qt::WA_Hover, true);
  setMouseTracking(true);
  setMinimumSize(640, 420);
  resize(1200, 800);
  lastNormalSize_ = size();
  lastNormalGeometry_ = geometry();
  setProperty("daliniraRestoredSize", lastNormalSize_);

  if (!services_.profile) {
    services_.profile = QWebEngineProfile::defaultProfile();
  }

  auto composite = std::make_unique<dalinira::core::CompositeNavigationCandidateProvider>(this);
  composite->addProvider(std::make_shared<dalinira::core::BookmarkCandidateProvider>(services_.profileService, services_.profileService, composite.get()));
  composite->addProvider(std::make_shared<dalinira::core::FrequentSitesCandidateProvider>(services_.profileService, services_.profileService, composite.get()));
  composite->addProvider(std::make_shared<dalinira::core::HistoryCandidateProvider>(services_.profileService, services_.profileService, composite.get()));
  composite->addProvider(std::make_shared<dalinira::core::BootstrapWellKnownSiteProvider>());
  candidateProvider_ = std::move(composite);
  autofillController_ = std::make_unique<CredentialAutofillController>(
      services_.profileService ? services_.profileService->credentialVault() : nullptr, this, this);
  connect(autofillController_.get(), &CredentialAutofillController::openPasswordManagerRequested,
          this, &BrowserWindow::showPasswords);

  setupUi();
  downloadUiModel_ = new DownloadUiModel(services_.profileService, services_.mediaDownload, this);
  downloadPopup_ = new DownloadPopup(downloadUiModel_, this);
  connect(downloadUiModel_, &DownloadUiModel::changed, this, &BrowserWindow::updateDownloadToolbar);
  connect(downloadUiModel_, &DownloadUiModel::downloadStarted, this, [this](const QString &) {
    if (QApplication::activeWindow() == this || isActiveWindow()) showDownloadStartedAnimation();
  });
  connect(downloadUiModel_, &DownloadUiModel::downloadCompleted, this, [this](const QString &) {
    if (mediaDownload_) mediaDownload_->acknowledge(downloadAnimationsEnabled());
  });
  connect(downloadUiModel_, &DownloadUiModel::downloadFailed, this, [this](const QString &) {
    if (mediaDownload_) mediaDownload_->acknowledge(downloadAnimationsEnabled());
  });
  connect(downloadPopup_, &DownloadPopup::openDownloadsRequested, this,
          [this] { showMediaDownloads(); });
  connect(downloadPopup_, &DownloadPopup::openMediaDownloadRequested, this,
          [this](const QUrl &url) { showMediaDownloads(url, true); });
  updateDownloadToolbar();
  connect(autofillController_.get(), &CredentialAutofillController::saveBubbleShown,
          this, [this] {
            QTimer::singleShot(0, this, [this] { updateSaveBubblePosition(); });
          });
  setupStyle();
  setupTabStripSignals();
  if (services_.profileService) {
    connect(services_.profileService, &BrowserProfileService::searchSuggestionsChanged, this, [this](bool) {
      syncNewTabViews();
      if (omnibox_->hasFocus()) updateOmniboxSuggestions(omnibox_->text());
    });
    connect(services_.profileService, &BrowserProfileService::searchEngineChanged, this, [this](const QString &) {
      services_.profileService->searchSuggestions()->cancel();
      syncNewTabViews();
      if (omnibox_->hasFocus()) updateOmniboxSuggestions(omnibox_->text());
    });
    connect(services_.profileService, &BrowserProfileService::downloadsChanged,
            this, &BrowserWindow::syncNewTabViews);
    if (auto *blocker = services_.profileService->blockerService()) {
      connect(blocker, &DaliNiraBlockerService::globalStatsChanged, this,
              [this](quint64 sessionBlocked, quint64 totalBlocked) {
        const QString script = newTabProtectionStatsUpdateScript(
            totalBlocked, services_.profileService->recentDownloadCount(), sessionBlocked);
        for (const BrowserTabInfo &tab : std::as_const(tabs_)) {
          if (tab.view && isNewTabUrl(tab.view->url())) tab.view->page()->runJavaScript(script);
        }
      });
    }
  }

  connect(&TabThrobber::instance(), &TabThrobber::throbberTick, this, &BrowserWindow::onThrobberTick);

  // Register in global registry for tab drag & attach
  dalinira::desktop_tabs::TabWindowRegistry::instance().registerWindow(this, tabStrip_);

  if (services_.privateProfileOwner) {
    // Keep the shared private profile alive until this window's page children
    // have been destroyed, including when its tabs move to another window.
    auto *lifetime = new QObject(this);
    connect(lifetime, &QObject::destroyed, [owner = services_.privateProfileOwner] {});
  }
  if (isCaptureShell_) {
    setProperty("daliniraDragCaptureShell", true);
  }

  if (qApp) {
    qApp->installEventFilter(this);
  }
}

BrowserWindow::~BrowserWindow() {
  if (hasOverrideCursor_) {
    QGuiApplication::restoreOverrideCursor();
    hasOverrideCursor_ = false;
  }
  if (autofillController_) {
    autofillController_->clearAllSensitiveData();
  }
  if (qApp) {
    qApp->removeEventFilter(this);
  }
  if (hoverCard_) {
    hoverCard_->hideCard();
    delete hoverCard_;
    hoverCard_ = nullptr;
  }
  for (const auto &tab : std::as_const(tabs_)) {
    if (tab.view) {
      TabThrobber::instance().removeView(tab.view.data());
    }
  }
#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
  if (currentActivePermissionRequest_.has_value()) {
    if (currentActivePermissionRequest_->permission.isValid()) {
      currentActivePermissionRequest_->permission.deny();
    }
    currentActivePermissionRequest_.reset();
  }
  for (auto &req : pendingPermissionQueue_) {
    if (req.permission.isValid()) req.permission.deny();
  }
  pendingPermissionQueue_.clear();
#endif
  tabSessionGrants_.clear();
  dalinira::desktop_tabs::TabWindowRegistry::instance().unregisterWindow(this);
}

void BrowserWindow::setupUi() {
  using Metrics = dalinira::ui::BrowserChromeMetrics;

  auto *central = new QWidget(this);
  central->setObjectName(QStringLiteral("centralRoot"));
  central->setMouseTracking(true);
  auto *rootLayout = new QVBoxLayout(central);
  rootLayout->setContentsMargins(0, 0, 0, 0);
  rootLayout->setSpacing(0);

  // 1. Chrome Unified Titlebar / Top Bar
  topBar_ = new QWidget(central);
  topBar_->setObjectName(QStringLiteral("topBar"));
  topBar_->setFixedHeight(Metrics::topBarHeight);
  topBar_->setMouseTracking(true);
  auto *topLayout = new QHBoxLayout(topBar_);
  topLayout->setContentsMargins(8, 0, 0, 0);
  topLayout->setSpacing(4);

  // Tab Search Button (Chrome top-left)
  tabSearchBtn_ = new QToolButton(topBar_);
  tabSearchBtn_->setObjectName(QStringLiteral("tabSearchBtn"));
  tabSearchBtn_->setText(QString::fromUtf8("⌵"));
  tabSearchBtn_->setToolTip(QStringLiteral("Sekmelerde ara (Ctrl+Shift+A)"));
  tabSearchBtn_->setFixedSize(Metrics::tabSearchButtonSize,
                              Metrics::tabSearchButtonSize);
  connect(tabSearchBtn_, &QToolButton::clicked, this, &BrowserWindow::toggleTabSearchPopup);
  topLayout->addWidget(tabSearchBtn_, 0, Qt::AlignVCenter);

  auto *tabSearchShortcut = new QShortcut(QKeySequence(Qt::CTRL | Qt::SHIFT | Qt::Key_A), this);
  connect(tabSearchShortcut, &QShortcut::activated, this, &BrowserWindow::toggleTabSearchPopup);

  auto *groupShortcut = new QShortcut(QKeySequence(Qt::ALT | Qt::SHIFT | Qt::Key_P), this);
  connect(groupShortcut, &QShortcut::activated, this, [this] {
    if (tabGroupLauncherPopup_ && tabGroupLauncherPopup_->isVisible()) {
      tabGroupLauncherPopup_->close();
    }
    createNewTabGroupWithNewTab();
  });

  auto *addTabInGroupShortcut = new QShortcut(QKeySequence(Qt::ALT | Qt::SHIFT | Qt::Key_C), this);
  connect(addTabInGroupShortcut, &QShortcut::activated, this, [this] {
    const int currentIdx = tabStrip_->currentIndex();
    if (currentIdx >= 0 && currentIdx < tabs_.size() && tabs_[currentIdx].groupId.has_value()) {
      addTabToGroup(*tabs_[currentIdx].groupId);
    }
  });

  auto *closeGroupShortcut = new QShortcut(QKeySequence(Qt::ALT | Qt::SHIFT | Qt::Key_W), this);
  connect(closeGroupShortcut, &QShortcut::activated, this, [this] {
    const int currentIdx = tabStrip_->currentIndex();
    if (currentIdx >= 0 && currentIdx < tabs_.size() && tabs_[currentIdx].groupId.has_value()) {
      closeTabGroup(*tabs_[currentIdx].groupId);
    }
  });

  auto *bookmarkBarShortcut = new QShortcut(QKeySequence(Qt::CTRL | Qt::SHIFT | Qt::Key_B), this);
  connect(bookmarkBarShortcut, &QShortcut::activated, this, &BrowserWindow::toggleBookmarkBar);

  auto *newTabShortcut = new QShortcut(QKeySequence(Qt::CTRL | Qt::Key_T), this);
  connect(newTabShortcut, &QShortcut::activated, this, [this] {
    addNewTab(QUrl(QStringLiteral("dalinira://newtab/")));
  });

  auto *newWindowShortcut = new QShortcut(QKeySequence(Qt::CTRL | Qt::Key_N), this);
  connect(newWindowShortcut, &QShortcut::activated, this, [this] {
    openNewWindow();
  });

  auto *incognitoWindowShortcut = new QShortcut(QKeySequence(Qt::CTRL | Qt::SHIFT | Qt::Key_N), this);
  connect(incognitoWindowShortcut, &QShortcut::activated, this, [this] {
    openIncognitoWindow();
  });

  auto *closeTabShortcut = new QShortcut(QKeySequence(Qt::CTRL | Qt::Key_W), this);
  connect(closeTabShortcut, &QShortcut::activated, this, [this] {
    if (tabStrip_ && tabStrip_->currentIndex() >= 0 && tabStrip_->currentIndex() < tabs_.size()) {
      closeTab(tabStrip_->currentIndex());
    }
  });

  auto *reopenClosedTabShortcut = new QShortcut(QKeySequence(Qt::CTRL | Qt::SHIFT | Qt::Key_T), this);
  connect(reopenClosedTabShortcut, &QShortcut::activated, this, &BrowserWindow::restoreLastClosedTab);

  auto *findShortcut = new QShortcut(QKeySequence::Find, this);
  connect(findShortcut, &QShortcut::activated, this, &BrowserWindow::showFindBar);

  auto *findNextShortcut = new QShortcut(QKeySequence::FindNext, this);
  connect(findNextShortcut, &QShortcut::activated, this, [this] {
    if (findBar_ && findBar_->isVisible()) {
      handleFindRequest(findBar_->findText(), true, findBar_->isCaseSensitive());
    } else {
      showFindBar();
    }
  });

  auto *findPrevShortcut = new QShortcut(QKeySequence::FindPrevious, this);
  connect(findPrevShortcut, &QShortcut::activated, this, [this] {
    if (findBar_ && findBar_->isVisible()) {
      handleFindRequest(findBar_->findText(), false, findBar_->isCaseSensitive());
    }
  });

  auto *printShortcut = new QShortcut(QKeySequence::Print, this);
  connect(printShortcut, &QShortcut::activated, this, &BrowserWindow::printCurrentPage);

  auto *historyShortcut = new QShortcut(QKeySequence(Qt::CTRL | Qt::Key_H), this);
  connect(historyShortcut, &QShortcut::activated, this, [this] {
    showSettings(SettingsPage::Category::History);
  });

  auto *focusLocationShortcut = new QShortcut(QKeySequence(Qt::CTRL | Qt::Key_L), this);
  connect(focusLocationShortcut, &QShortcut::activated, this, [this] {
    omnibox_->setFocus();
    omnibox_->selectAll();
  });
  auto *reloadShortcut = new QShortcut(QKeySequence(Qt::CTRL | Qt::Key_R), this);
  connect(reloadShortcut, &QShortcut::activated, this, &BrowserWindow::onReloadOrStopClicked);
  auto *reloadF5Shortcut = new QShortcut(QKeySequence(Qt::Key_F5), this);
  connect(reloadF5Shortcut, &QShortcut::activated, this, &BrowserWindow::onReloadOrStopClicked);
  auto *backShortcut = new QShortcut(QKeySequence(Qt::ALT | Qt::Key_Left), this);
  connect(backShortcut, &QShortcut::activated, this, &BrowserWindow::onBackClicked);
  auto *forwardShortcut = new QShortcut(QKeySequence(Qt::ALT | Qt::Key_Right), this);
  connect(forwardShortcut, &QShortcut::activated, this, &BrowserWindow::onForwardClicked);
  auto *bookmarkShortcut = new QShortcut(QKeySequence(Qt::CTRL | Qt::Key_D), this);
  connect(bookmarkShortcut, &QShortcut::activated, this, &BrowserWindow::toggleCurrentBookmark);
  auto *nextTabShortcut = new QShortcut(QKeySequence(Qt::CTRL | Qt::Key_Tab), this);
  connect(nextTabShortcut, &QShortcut::activated, this, [this] {
    if (tabStrip_ && !tabs_.isEmpty()) switchTab((tabStrip_->currentIndex() + 1) % tabs_.size());
  });
  auto *previousTabShortcut = new QShortcut(QKeySequence(Qt::CTRL | Qt::SHIFT | Qt::Key_Tab), this);
  connect(previousTabShortcut, &QShortcut::activated, this, [this] {
    if (tabStrip_ && !tabs_.isEmpty()) switchTab((tabStrip_->currentIndex() + tabs_.size() - 1) % tabs_.size());
  });
  auto *fullScreenShortcut = new QShortcut(QKeySequence(Qt::Key_F11), this);
  connect(fullScreenShortcut, &QShortcut::activated, this, &BrowserWindow::toggleBrowserFullScreen);

  // Tab Strip (Chromium TabStripWidget)
  tabStrip_ = new dalinira::desktop_tabs::TabStripWidget(topBar_);
  tabStrip_->setObjectName(QStringLiteral("tabStrip"));
  tabStrip_->setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Fixed);
  groupModel_ = new dalinira::desktop_tabs::TabGroupModel(this);
  tabStrip_->setGroupModel(groupModel_);
  connect(tabStrip_, &dalinira::desktop_tabs::TabStripWidget::groupChipClicked,
          this, [this](const QUuid &groupId, const QPoint &globalPos) {
    showTabGroupPopup(groupId, globalPos);
  });
  topLayout->addWidget(tabStrip_, 1);

  // Window Caption Controls (Chrome top-right: Minimize, Maximize, Close)
  auto *captionBox = new QWidget(topBar_);
  captionBox->setObjectName(QStringLiteral("captionBox"));
  captionBox->setFixedHeight(Metrics::topBarHeight);
  auto *captionLayout = new QHBoxLayout(captionBox);
  captionLayout->setContentsMargins(0, 0, 0, 0);
  captionLayout->setSpacing(0);

  minBtn_ = new QToolButton(captionBox);
  minBtn_->setObjectName(QStringLiteral("windowControlMin"));
  minBtn_->setText(QString::fromUtf8("−"));
  minBtn_->setToolTip(QStringLiteral("Simge Durumuna Küçült"));
  minBtn_->setFixedSize(46, Metrics::topBarHeight);

  maxBtn_ = new QToolButton(captionBox);
  maxBtn_->setObjectName(QStringLiteral("windowControlMax"));
  maxBtn_->setText(QString::fromUtf8("□"));
  maxBtn_->setToolTip(QStringLiteral("Ekranı Kapla / Geri Yükle"));
  maxBtn_->setFixedSize(46, Metrics::topBarHeight);

  closeBtn_ = new QToolButton(captionBox);
  closeBtn_->setObjectName(QStringLiteral("windowControlClose"));
  closeBtn_->setText(QString::fromUtf8("✕"));
  closeBtn_->setToolTip(QStringLiteral("Kapat"));
  closeBtn_->setFixedSize(46, Metrics::topBarHeight);

  captionLayout->addWidget(minBtn_);
  captionLayout->addWidget(maxBtn_);
  captionLayout->addWidget(closeBtn_);
  topLayout->addWidget(captionBox, 0, Qt::AlignTop | Qt::AlignRight);

  rootLayout->addWidget(topBar_);

  // Connect Window Caption Buttons
  connect(minBtn_, &QToolButton::clicked, this, &BrowserWindow::onMinimizeClicked);
  connect(maxBtn_, &QToolButton::clicked, this, &BrowserWindow::onMaximizeRestoreClicked);
  connect(closeBtn_, &QToolButton::clicked, this, &BrowserWindow::onCloseWindowClicked);

  // 2. Navigation Bar
  navBar_ = new QWidget(central);
  navBar_->setObjectName(QStringLiteral("navBar"));
  navBar_->setFixedHeight(Metrics::navigationBarHeight);
  auto *navLayout = new QHBoxLayout(navBar_);
  navLayout->setContentsMargins(10, 6, 10, 6);
  navLayout->setSpacing(7);

  const auto configureNavigationButton = [](QToolButton *button) {
    button->setFixedSize(Metrics::navigationButtonSize,
                         Metrics::navigationButtonSize);
    button->setIconSize(QSize(Metrics::navigationIconSize,
                              Metrics::navigationIconSize));
  };

  backBtn_ = new QToolButton(navBar_);
  backBtn_->setObjectName(QStringLiteral("backBtn"));
  backBtn_->setIcon(BrowserIcons::backIcon());
  backBtn_->setToolTip(I18n::text(QStringLiteral("toolbar.back"), QStringLiteral("Geri (Alt+Sol)")));
  backBtn_->setEnabled(false);
  configureNavigationButton(backBtn_);
  navLayout->addWidget(backBtn_);

  forwardBtn_ = new QToolButton(navBar_);
  forwardBtn_->setObjectName(QStringLiteral("forwardBtn"));
  forwardBtn_->setIcon(BrowserIcons::forwardIcon());
  forwardBtn_->setToolTip(I18n::text(QStringLiteral("toolbar.forward"), QStringLiteral("İleri (Alt+Sağ)")));
  forwardBtn_->setEnabled(false);
  configureNavigationButton(forwardBtn_);
  navLayout->addWidget(forwardBtn_);

  reloadBtn_ = new QToolButton(navBar_);
  reloadBtn_->setObjectName(QStringLiteral("reloadBtn"));
  reloadBtn_->setIcon(BrowserIcons::reloadIcon());
  reloadBtn_->setToolTip(I18n::text(QStringLiteral("toolbar.reload"), QStringLiteral("Bu sayfayı yeniden yükleyin")));
  configureNavigationButton(reloadBtn_);
  navLayout->addWidget(reloadBtn_);

  bookmarkBtn_ = new QToolButton(navBar_);
  bookmarkBtn_->setObjectName(QStringLiteral("bookmark-button"));
  bookmarkBtn_->setIcon(BrowserIcons::icon(BrowserIcon::Bookmark));
  bookmarkBtn_->setToolTip(QStringLiteral("Yer imi ekle"));
  configureNavigationButton(bookmarkBtn_);
  navLayout->addWidget(bookmarkBtn_);

  // Google Search / Omnibox
  omnibox_ = new QLineEdit(navBar_);
  omnibox_->setObjectName(QStringLiteral("omnibox"));
  omnibox_->setPlaceholderText(searchEnginePlaceholder(currentSearchEngine()));
  omnibox_->setClearButtonEnabled(true);
  omnibox_->setFixedHeight(Metrics::omniboxHeight);
  searchEngineAction_ = omnibox_->addAction(BrowserIcons::searchEngineIcon(currentSearchEngine()), QLineEdit::LeadingPosition);
  searchEngineAction_->setToolTip(QStringLiteral("Arama motoru: %1").arg(currentSearchEngine()));
  connect(searchEngineAction_, &QAction::triggered, this, [this] {
    toggleSiteControlsBubble();
  });
  if (services_.profileService) {
    connect(services_.profileService, &BrowserProfileService::searchEngineChanged, this, [this](const QString &) {
      updateSearchEngineIcon();
    });
  }
  navLayout->addWidget(omnibox_, 1);

  // Feature buttons in Toolbar
  zoomButton_ = new QToolButton(navBar_);
  zoomButton_->setObjectName(QStringLiteral("zoomButton"));
  zoomButton_->setIcon(BrowserIcons::icon(BrowserIcon::Zoom));
  zoomButton_->setToolTip(QStringLiteral("Sayfa yakınlaştırma"));
  configureNavigationButton(zoomButton_);
  zoomButton_->hide();
  navLayout->addWidget(zoomButton_);

  translateButton_ = new QToolButton(navBar_);
  translateButton_->setObjectName(QStringLiteral("translateButton"));
  translateButton_->setIcon(BrowserIcons::icon(BrowserIcon::Language));
  translateButton_->setToolTip(QStringLiteral("Bu sayfayı Türkçeye çevir"));
  configureNavigationButton(translateButton_);
  translateButton_->hide();
  navLayout->addWidget(translateButton_);

  // AdBlock Shield Button
  auto *adblock = services_.profileService ? services_.profileService->adBlockService() : nullptr;
  adBlockShield_ = new DaliNiraBlockerShieldButton(adblock, navBar_);
  configureNavigationButton(adBlockShield_);
  navLayout->addWidget(adBlockShield_);

  // Pulse (Song recognition) Button
  pulseButton_ = new PulseToolbarButton(services_.songRecognition, services_.songFinderSettings, navBar_);
  configureNavigationButton(pulseButton_);
  navLayout->addWidget(pulseButton_);

  // Unified Downloads entry point; media analysis remains opt-in/event-driven.
  mediaDownload_ = new DownloadToolbarButton(navBar_);
  mediaDownload_->setObjectName(QStringLiteral("mediaDownloadButton"));
  configureNavigationButton(mediaDownload_);
  navLayout->addWidget(mediaDownload_);

  // Password Manager Button
  passwordsBtn_ = new QToolButton(navBar_);
  passwordsBtn_->setObjectName(QStringLiteral("passwordsButton"));
  passwordsBtn_->setIcon(BrowserIcons::icon(BrowserIcon::Password));
  passwordsBtn_->setToolTip(QStringLiteral("Şifre Yöneticisi"));
  configureNavigationButton(passwordsBtn_);
  navLayout->addWidget(passwordsBtn_);

  // Main Menu (Hamburger) Button
  mainMenuBtn_ = new QToolButton(navBar_);
  mainMenuBtn_->setObjectName(QStringLiteral("mainMenuButton"));
  mainMenuBtn_->setText(QString::fromUtf8("☰"));
  mainMenuBtn_->setToolTip(QStringLiteral("Ana menü"));
  configureNavigationButton(mainMenuBtn_);
  navLayout->addWidget(mainMenuBtn_);

  rootLayout->addWidget(navBar_);

  // Bookmark Bar (Under navigation bar)
  bookmarkBar_ = new QToolBar(central);
  bookmarkBar_->setObjectName(QStringLiteral("bookmark-bar"));
  bookmarkBar_->setMovable(false);
  bookmarkBar_->setIconSize(QSize(Metrics::bookmarkIconSize,
                                  Metrics::bookmarkIconSize));
  bookmarkBar_->setFixedHeight(Metrics::bookmarkBarHeight);
  bookmarkBar_->setToolButtonStyle(Qt::ToolButtonTextBesideIcon);
  if (bookmarkBar_->layout()) {
    bookmarkBar_->layout()->setContentsMargins(6, 0, 6, 0);
    bookmarkBar_->layout()->setSpacing(3);
  }
  bookmarkBar_->setContextMenuPolicy(Qt::CustomContextMenu);
  connect(bookmarkBar_, &QWidget::customContextMenuRequested, this, [this](const QPoint &pos) {
    showBookmarkContextMenu(QUrl(), QString(), bookmarkBar_->mapToGlobal(pos));
  });
  rootLayout->addWidget(bookmarkBar_);

  renderBookmarks();
  bookmarkBar_->setVisible(false);
  updateBookmarkBarVisibility();

  // 3. Thin loading progress bar (Chrome blue accent)
  progressBar_ = new QProgressBar(central);
  progressBar_->setObjectName(QStringLiteral("loadProgressBar"));
  progressBar_->setFixedHeight(2);
  progressBar_->setTextVisible(false);
  progressBar_->setRange(0, 100);
  progressBar_->hide();
  rootLayout->addWidget(progressBar_);

  // 4. Page Content Stack
  pageStack_ = new QStackedWidget(central);
  pageStack_->setObjectName(QStringLiteral("pageStack"));
  pageStack_->setStyleSheet(QStringLiteral("#pageStack { background-color: #07111f; }"));
  rootLayout->addWidget(pageStack_, 1);

  setCentralWidget(central);

  // Connect navigation buttons
  connect(backBtn_, &QToolButton::clicked, this, &BrowserWindow::onBackClicked);
  connect(forwardBtn_, &QToolButton::clicked, this, &BrowserWindow::onForwardClicked);
  connect(reloadBtn_, &QToolButton::clicked, this, &BrowserWindow::onReloadOrStopClicked);
  if (homeBtn_) connect(homeBtn_, &QToolButton::clicked, this, &BrowserWindow::onHomeClicked);
  suggestionModel_ = new QStandardItemModel(this);
  suggestionCompleter_ = new QCompleter(suggestionModel_, this);
  suggestionCompleter_->setCompletionMode(QCompleter::UnfilteredPopupCompletion);
  suggestionCompleter_->setMaxVisibleItems(10);
  suggestionPopup_ = suggestionCompleter_->popup();
  omnibox_->setCompleter(suggestionCompleter_);
  connect(suggestionCompleter_, qOverload<const QModelIndex &>(&QCompleter::activated), this,
          [this](const QModelIndex &index) {
            activateSuggestion(index.data(Qt::UserRole + 1).toUrl(), index.data(Qt::DisplayRole).toString(),
                               index.data(Qt::UserRole + 2).toString());
          });
  connect(omnibox_, &QLineEdit::textEdited, this, &BrowserWindow::updateOmniboxSuggestions);
  connect(omnibox_, &QLineEdit::returnPressed, this, &BrowserWindow::onOmniboxReturnPressed);

  // Connect feature buttons
  connect(adBlockShield_, &DaliNiraBlockerShieldButton::openSettingsRequested, this, [this] {
    showDaliNiraBlockerSettings(DaliNiraBlockerPage::Tab::Settings);
  });
  connect(adBlockShield_, &DaliNiraBlockerShieldButton::openRulesetsRequested, this, [this] {
    showDaliNiraBlockerSettings(DaliNiraBlockerPage::Tab::Rulesets);
  });
  connect(adBlockShield_, &DaliNiraBlockerShieldButton::openLoggerRequested, this, [this] {
    showDaliNiraBlockerSettings(DaliNiraBlockerPage::Tab::Logger);
  });
  connect(adBlockShield_, &DaliNiraBlockerShieldButton::reloadRequested, this, [this] {
    if (auto *view = currentView()) {
      prepareAdBlockScripts(view->page(), view->url(), true);
      view->reload();
    }
  });
  if (adblock) {
    connect(adblock->settings(), &DaliNiraBlockerSettings::settingsChanged, this, [this] {
      for (const auto &tab : std::as_const(tabs_)) {
        if (tab.view && (tab.view->url().scheme() == QLatin1String("http") || tab.view->url().scheme() == QLatin1String("https")))
          prepareAdBlockScripts(tab.view->page(), tab.view->url(), true);
      }
    });
    connect(adblock, &DaliNiraBlockerService::tabStatsChanged, this, [this](quint64 tabId, const TabBlockerStats &stats) {
      if (auto *view = currentView()) {
        const quint64 currentId = reinterpret_cast<quintptr>(view);
        if (tabId == currentId && adBlockShield_) {
          if (isInternalOrNonWebUrl(view->url())) {
            adBlockShield_->setInternalPage(true);
            adBlockShield_->setActiveHost(QString());
            adBlockShield_->setBlockedCount(0);
          } else {
            adBlockShield_->setInternalPage(false);
            adBlockShield_->setActiveHost(view->url().host().toLower());
            const quint64 total = stats.totalBlocked();
            adBlockShield_->setBlockedCount(total);
            adBlockShield_->setToolTip(total > 0
                ? QStringLiteral("DaliNira Koruma: %1 (%2 öğe engellendi)").arg(view->url().host()).arg(total)
                : QStringLiteral("DaliNira Koruma: %1 (Etkin)").arg(view->url().host()));
          }
        }
      }
    });
    connect(adblock, &DaliNiraBlockerService::autoReloadRequested, this, [this] {
      if (auto *view = currentView()) {
        prepareAdBlockScripts(view->page(), view->url(), true);
        view->reload();
      }
    });
  }

  connect(pulseButton_, &PulseToolbarButton::openFullPageRequested, this, &BrowserWindow::showSongFinder);
  connect(pulseButton_, &PulseToolbarButton::openSettingsRequested, this, &BrowserWindow::showSongFinderSettings);
  connect(pulseButton_, &PulseToolbarButton::openUrlRequested, this, [this](const QUrl &url) {
    addNewTab(url);
  });
  if (services_.songRecognition) {
    connect(services_.songRecognition, &SongRecognitionService::stateChanged, this,
            [this](SongRecognitionService::State state, const QString &) {
      if (state != SongRecognitionService::State::Listening) return;
      QWidget *active = qApp ? qApp->activeWindow() : nullptr;
      bool belongsToThisWindow = isActiveWindow();
      for (QWidget *widget = active; widget && !belongsToThisWindow; widget = widget->parentWidget()) {
        belongsToThisWindow = widget == this;
      }
      if (!belongsToThisWindow) return;
      const int index = tabStrip_ ? tabStrip_->currentIndex() : -1;
      if (index < 0 || index >= tabs_.size() || !tabs_[index].view) {
        services_.songRecognition->clearWebContextMetadata();
        return;
      }
      QString cleanTitle = tabs_[index].title.trimmed();
      if (cleanTitle.endsWith(QStringLiteral(" - YouTube"), Qt::CaseInsensitive)) cleanTitle.chop(10);
      const QStringList parts = cleanTitle.split(QStringLiteral(" - "));
      if (parts.size() >= 2) {
        services_.songRecognition->setWebContextMetadata(
            parts.mid(1).join(QStringLiteral(" - ")).trimmed(), parts.first().trimmed());
      } else {
        services_.songRecognition->setWebContextMetadata(cleanTitle, QString());
      }
    });
  }

  connect(mediaDownload_, &QToolButton::clicked, this, [this] {
    if (!downloadPopup_) return;
    if (downloadPopup_->isVisible()) {
      downloadPopup_->hide();
    } else {
      const QUrl activeUrl = (currentView() && !isNewTabUrl(currentView()->url()) && currentView()->url().scheme() != QLatin1String("dalinira"))
          ? currentView()->url() : lastActiveWebUrl_;
      const bool pageHasMedia = currentView() && currentView()->page() && currentView()->page()->recentlyAudible();
      if (!activeUrl.isEmpty() && MediaPlatformRegistry::shouldAutoAnalyzeMedia(activeUrl, pageHasMedia)) {
        const QString pageTitle = currentView() ? currentView()->title() : QString{};
        // Resolve while the source page is still the active tab. The popup's
        // second click must only forward this captured permalink; it must not
        // depend on whichever tab happens to be active later.
        resolveActiveMediaPageUrl(activeUrl, [this, activeUrl, pageTitle](const QUrl &resolvedUrl) {
          if (!downloadPopup_ || !mediaDownload_) return;
          if (MediaPlatformRegistry::isGenericPlatformFeedUrl(resolvedUrl)) {
            downloadPopup_->setSuggestedMedia(QUrl{}, QString{});
          } else {
            const QString popupDetail = resolvedUrl != activeUrl
                ? resolvedUrl.toDisplayString(QUrl::RemoveScheme | QUrl::RemoveQuery
                                              | QUrl::RemoveFragment).left(160)
                : pageTitle;
            downloadPopup_->setSuggestedMedia(resolvedUrl, popupDetail);
          }
          downloadPopup_->showAnchored(mediaDownload_, false);
        });
        return;
      } else {
        downloadPopup_->setSuggestedMedia(QUrl{}, QString{});
      }
      downloadPopup_->showAnchored(mediaDownload_, false);
    }
  });

  connect(passwordsBtn_, &QToolButton::clicked, this, &BrowserWindow::showPasswords);
  connect(bookmarkBtn_, &QToolButton::clicked, this, &BrowserWindow::toggleCurrentBookmark);
  connect(mainMenuBtn_, &QToolButton::clicked, this, &BrowserWindow::showMainMenu);
  if (services_.profileService) {
    connect(services_.profileService, &BrowserProfileService::bookmarksChanged, this, &BrowserWindow::renderBookmarks);
    connect(services_.profileService, &BrowserProfileService::bookmarksChanged, this, &BrowserWindow::syncNewTabViews);
    connect(services_.profileService, &BrowserProfileService::historyChanged, this, &BrowserWindow::syncNewTabViews);
  }

  connect(translateButton_, &QToolButton::clicked, this, &BrowserWindow::showTranslatePopup);
  connect(zoomButton_, &QToolButton::clicked, this, &BrowserWindow::showZoomPopup);
}

void BrowserWindow::setupStyle() {
  setStyleSheet(QStringLiteral(
      "QMainWindow { background-color: #1c1b22; }"
      "#centralRoot { background-color: #1c1b22; }"
      "#topBar { background-color: #1c1b22; }"
      "#tabStrip { background-color: #1c1b22; }"
      "#pageStack { background-color: #07111f; }"
      "#tabSearchBtn {"
      "  color: #c4c7c5;"
      "  background: transparent;"
      "  border: none;"
      "  border-radius: 14px;"
      "  font-size: 13px;"
      "  font-weight: bold;"
      "}"
      "#tabSearchBtn:hover { background-color: rgba(255, 255, 255, 0.12); }"
      "#captionBox { background: transparent; }"
      "#windowControlMin, #windowControlMax, #windowControlClose {"
      "  color: #c4c7c5;"
      "  background: transparent;"
      "  border: none;"
      "  font-size: 15px;"
      "  font-family: monospace, sans-serif;"
      "}"
      "#windowControlMin:hover, #windowControlMax:hover {"
      "  background-color: rgba(255, 255, 255, 0.12);"
      "  color: #ffffff;"
      "}"
      "#windowControlClose:hover {"
      "  background-color: #e81123;"
      "  color: #ffffff;"
      "}"
      "#navBar {"
      "  background-color: #2b2a33;"
      "  border: none;"
      "}"
      "#bookmark-bar {"
      "  background-color: #2b2a33;"
      "  border: none;"
      "  border-bottom: 1px solid #1c1b22;"
      "  spacing: 3px;"
      "  padding: 0px 6px;"
      "  min-height: 34px;"
      "  max-height: 34px;"
      "}"
      "#bookmark-bar QToolButton {"
      "  color: #d8dce0;"
      "  background: transparent;"
      "  border: none;"
      "  border-radius: 4px;"
      "  padding: 2px 7px;"
      "  font-size: 12px;"
      "  font-weight: 500;"
      "  min-width: 20px;"
      "  max-width: 220px;"
      "  min-height: 22px;"
      "  max-height: 22px;"
      "  qproperty-toolButtonStyle: ToolButtonTextBesideIcon;"
      "}"
      "#bookmark-bar QToolButton:hover {"
      "  background-color: rgba(255, 255, 255, 0.12);"
      "  color: #ffffff;"
      "}"
      "#bookmark-bar #appsButton {"
      "  min-width: 28px;"
      "  max-width: 28px;"
      "  min-height: 22px;"
      "  max-height: 22px;"
      "  padding: 2px;"
      "  border-radius: 4px;"
      "  qproperty-toolButtonStyle: ToolButtonIconOnly;"
      "}"
      "#bookmark-bar #bookmarkItemButton {"
      "  padding-right: 3px;"
      "  border-top-right-radius: 0px;"
      "  border-bottom-right-radius: 0px;"
      "}"
      "#bookmark-bar #bookmarkRemoveButton {"
      "  color: #aeb7c2;"
      "  min-width: 20px; max-width: 20px;"
      "  min-height: 22px; max-height: 22px;"
      "  padding: 2px;"
      "  border-top-left-radius: 0px;"
      "  border-bottom-left-radius: 0px;"
      "  qproperty-toolButtonStyle: ToolButtonIconOnly;"
      "}"
      "#bookmark-bar #bookmarkRemoveButton:hover {"
      "  color: #ffffff;"
      "  background-color: rgba(220, 65, 65, 0.42);"
      "}"
      "#mediaDownloadButton[activeMedia=\"true\"] {"
      "  color: #4fc3f7;"
      "  background-color: rgba(79, 195, 247, 0.22);"
      "  border-radius: 14px;"
      "}"
      "#navBar > QToolButton, #tabSearchBtn {"
      "  color: #fbfbfe;"
      "  background: transparent;"
      "  border: none;"
      "  border-radius: 16px;"
      "  min-width: 32px;"
      "  max-width: 32px;"
      "  min-height: 32px;"
      "  max-height: 32px;"
      "  font-size: 18px;"
      "  font-weight: bold;"
      "}"
      "#navBar > QToolButton:hover, #tabSearchBtn:hover {"
      "  background-color: rgba(255, 255, 255, 0.12);"
      "}"
      "#navBar > QToolButton:disabled, #tabSearchBtn:disabled { color: #5b5b66; }"
      "#omnibox {"
      "  background-color: #1c1b22;"
      "  color: #fbfbfe;"
      "  border: 1px solid #3c4043;"
      "  border-radius: 17px;"
      "  padding: 0px 10px;"
      "  font-size: 14px;"
      "  selection-background-color: #8ab4f8;"
      "  selection-color: #1c1b22;"
      "}"
      "#omnibox:focus {"
      "  border: 2px solid #8ab4f8;"
      "  background-color: #16151d;"
      "  padding: 0px 9px;"
      "}"
      "#omnibox QToolButton {"
      "  background: transparent;"
      "  border: none;"
      "  border-radius: 4px;"
      "  min-width: 16px;"
      "  max-width: 24px;"
      "  min-height: 16px;"
      "  max-height: 24px;"
      "  padding: 0px;"
      "  margin: 0px;"
      "}"
      "#omnibox QToolButton:hover {"
      "  background-color: rgba(255, 255, 255, 0.10);"
      "}"
      "#loadProgressBar {"
      "  border: none;"
      "  background: transparent;"
      "  height: 2px;"
      "}"
      "#loadProgressBar::chunk {"
      "  background-color: #8ab4f8;"
      "}"
  ));
}

void BrowserWindow::setupTabStripSignals() {
  connect(tabStrip_, &dalinira::desktop_tabs::TabStripWidget::newTabRequested, this, [this] {
    addNewTab(QUrl(QStringLiteral("dalinira://newtab/")));
  });

  connect(tabStrip_, &dalinira::desktop_tabs::TabStripWidget::tabCloseRequested, this, [this](int index) {
    closeTab(index);
  });

  connect(tabStrip_, &dalinira::desktop_tabs::TabStripWidget::currentChanged, this, [this](int index) {
    switchTab(index);
  });

  connect(tabStrip_, &dalinira::desktop_tabs::TabStripWidget::tabMoved, this, [this](int from, int to) {
    moveTab(from, to);
  });

  connect(tabStrip_, &dalinira::desktop_tabs::TabStripWidget::tabHovered, this,
          &BrowserWindow::onTabHovered);

  connect(tabStrip_, &dalinira::desktop_tabs::TabStripWidget::tabHoverLeave, this,
          &BrowserWindow::onTabHoverLeave);

  connect(tabStrip_, &dalinira::desktop_tabs::TabStripWidget::dragInitiated, this,
          [this](int index, const QPoint &screenPosition, const QPoint &pressOffsetInTab, const QSize &) {
    if (hoverCard_) hoverCard_->hideCard();
    if (index < 0 || index >= tabs_.size()) return;
    const QPoint offsetInWindow = mapFromGlobal(screenPosition);
    dalinira::desktop_tabs::TabDragController::instance().handleMousePress(
        this, tabStrip_, index, screenPosition, pressOffsetInTab, offsetInWindow);
  });

  connect(tabStrip_, &dalinira::desktop_tabs::TabStripWidget::tabContextMenuRequested,
          this, &BrowserWindow::onTabContextMenuRequested);

  connect(&LanguageManager::instance(), &LanguageManager::languageChanged,
          this, &BrowserWindow::retranslateUi);
  retranslateUi();
}

void BrowserWindow::retranslateUi() {
  if (backBtn_) {
    backBtn_->setToolTip(I18n::text(QStringLiteral("toolbar.back"), QStringLiteral("Geri (Alt+Sol)")));
  }
  if (forwardBtn_) {
    forwardBtn_->setToolTip(I18n::text(QStringLiteral("toolbar.forward"), QStringLiteral("İleri (Alt+Sağ)")));
  }
  if (reloadBtn_) {
    updateReloadStopButton(isCurrentTabLoading());
  }
  if (zoomButton_) {
    zoomButton_->setToolTip(I18n::text(QStringLiteral("toolbar.zoom"), QStringLiteral("Sayfa yakınlaştırma")));
  }
  if (translateButton_) {
    translateButton_->setToolTip(I18n::text(QStringLiteral("toolbar.translate_page"), QStringLiteral("Bu sayfayı çevir")));
  }
  if (passwordsBtn_) {
    passwordsBtn_->setToolTip(I18n::text(QStringLiteral("toolbar.passwords"), QStringLiteral("Şifre Yöneticisi")));
  }
  if (mainMenuBtn_) {
    mainMenuBtn_->setToolTip(I18n::text(QStringLiteral("toolbar.main_menu"), QStringLiteral("Ana menü")));
  }
  if (omnibox_) {
    // Keep Omnibox / address bar / URL input strictly LeftToRight even in RTL languages
    omnibox_->setLayoutDirection(Qt::LeftToRight);
    omnibox_->setAlignment(Qt::AlignLeft | Qt::AlignVCenter);
  }
  updateBookmarkButtonState();
  updateBlockerControls();
  updateOmniboxLeadingIcon();
}

void BrowserWindow::prepareAdBlockScripts(QWebEnginePage *page, const QUrl &url, bool force) {
  if (!page) return;
  const QString planKey = QStringLiteral("%1://%2").arg(url.scheme().toLower(), url.host().toLower());
  if (!force && page->property("dalinira-adblock-script-plan").toString() == planKey) return;
  page->setProperty("dalinira-adblock-script-plan", planKey);
  const bool refreshDocument = force || page->url() == url;

  static const QStringList names = {
      QStringLiteral("dalinira-adblock-cosmetic"),
      QStringLiteral("dalinira-adblock-scriptlets-main"),
      QStringLiteral("dalinira-adblock-scriptlets-isolated"),
      QStringLiteral("dalinira-adblock-procedural"),
      QStringLiteral("dalinira-adblock-youtube-guardian"),
      QStringLiteral("dalinira-fingerprint-protection"),
      QStringLiteral("dalinira-forget-site-storage")};
  for (const QString &name : names) {
    const auto installed = page->scripts().find(name);
    for (const QWebEngineScript &script : installed) page->scripts().remove(script);
  }
  if (!services_.profileService || !services_.profileService->adBlockService()) return;
  const QString scheme = url.scheme().toLower();
  if (scheme != QLatin1String("http") && scheme != QLatin1String("https")) return;
  const auto policy = services_.profileService->adBlockService()->sitePolicy(url.host().toLower());
  const bool jsEnabled = services_.profileService->isJavascriptEnabled() &&
      !(services_.profileService->adBlockService()->settings()->protectionEnabled() && !policy.whitelisted && policy.blockScripts);
  page->settings()->setAttribute(QWebEngineSettings::JavascriptEnabled, jsEnabled);
  if (refreshDocument) page->runJavaScript(QStringLiteral("if(window.__daliniraCosmeticRuntime){window.__daliniraCosmeticRuntime.pause();}window.__daliniraProceduralRules=0;"), QWebEngineScript::ApplicationWorld);
  for (const QWebEngineScript &script :
       services_.profileService->adBlockService()->createScriptingScriptsForHost(url.host().toLower())) {
    page->scripts().insert(script);
    if (refreshDocument && (script.name() == QLatin1String("dalinira-adblock-cosmetic") || script.name() == QLatin1String("dalinira-adblock-procedural")))
      page->runJavaScript(script.sourceCode(), script.worldId());
  }
}

int BrowserWindow::addNewTab(const QUrl &url, int insertIndex, bool initiallyPinned,
                             const QString &initialTitle) {
  QUrl targetUrl = url;
  if (targetUrl.isEmpty()) {
    targetUrl = QUrl(QStringLiteral("dalinira://newtab/"));
  }

  // Handle internal scheme navigations directly
  const QString scheme = targetUrl.scheme().toLower();
  const QString host = targetUrl.host().toLower();
  if (scheme == QLatin1String("dalinira") && host != QLatin1String("newtab")) {
    if (host == QLatin1String("settings")) { showSettings(); return tabStrip_->currentIndex(); }
    if (host == QLatin1String("passwords")) { showPasswords(); return tabStrip_->currentIndex(); }
    if (host == QLatin1String("audio-effects")) { showAudioEffects(); return tabStrip_->currentIndex(); }
    if (host == QLatin1String("eq-presets")) { showEqPresetBrowser(); return tabStrip_->currentIndex(); }
    if (host == QLatin1String("blocker")) { showDaliNiraBlockerSettings(); return tabStrip_->currentIndex(); }
    if (host == QLatin1String("downloads")) { showMediaDownloads(); return tabStrip_->currentIndex(); }
    if (host == QLatin1String("listen") || host == QLatin1String("pulse")) { showSongFinder(); return tabStrip_->currentIndex(); }
    if (host == QLatin1String("listen-settings")) { showSongFinderSettings(); return tabStrip_->currentIndex(); }
  }

  auto *view = new BrowserWebView(this, pageStack_);
  auto *page = new BrowserWebPage(services_.profile ? services_.profile : QWebEngineProfile::defaultProfile(), this, view);
  page->setBackgroundColor(QColor(7, 17, 31));
  view->setPage(page);

  // Audio Effects registration
  if (services_.audioEffects) {
    services_.audioEffects->registerWebView(view, targetUrl);
  }

  // Blocker tab registration
  if (services_.profileService && services_.profileService->adBlockService()) {
    const quint64 adBlockTabId = reinterpret_cast<quintptr>(view);
    services_.profileService->adBlockService()->registerTab(adBlockTabId, targetUrl);
    services_.profileService->adBlockService()->setActiveTabId(adBlockTabId);
  }

  // Permission handling (microphone, media capture, fullscreen)
  if (view->page()) {
    view->page()->settings()->setAttribute(QWebEngineSettings::FullScreenSupportEnabled, true);
    connect(view->page(), &QWebEnginePage::fullScreenRequested, this,
            [this, view](const QWebEngineFullScreenRequest &request) {
      handleFullScreenRequest(view, request);
    });
#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
    connect(view->page(), &QWebEnginePage::permissionRequested, this,
            [this, view](const QWebEnginePermission &permission) {
      handleTabPermissionRequested(view, permission);
    });
#else
    connect(view->page(), &QWebEnginePage::featurePermissionRequested, this,
            [this, view](const QUrl &origin, QWebEnginePage::Feature feature) {
      if (!view || !view->page()) return;
      if (!permissionBubble_) {
        permissionBubble_ = new SitePermissionPromptBubble(this);
      }
      permissionBubble_->setupPromptLegacy(origin, BrowserPermissionPolicy::featureName(feature), BrowserIcon::Privacy);
      updatePermissionBubblePosition();
      permissionBubble_->show();
      permissionBubble_->raise();
      auto conn = std::make_shared<QMetaObject::Connection>();
      *conn = connect(permissionBubble_, &SitePermissionPromptBubble::choiceMade, this,
                      [this, view, origin, feature, conn](SitePermissionChoice choice) {
        disconnect(*conn);
        if (!view || !view->page()) return;
        const bool grant = (choice == SitePermissionChoice::AllowThisVisit || choice == SitePermissionChoice::AlwaysAllow);
        view->page()->setFeaturePermission(
            origin, feature,
            grant ? QWebEnginePage::PermissionGrantedByUser : QWebEnginePage::PermissionDeniedByUser);
      });
    });
#endif
  }

  const uint64_t tabId = s_tabIdSequence.fetch_add(1);
  BrowserTabInfo info;
  info.id = tabId;
  info.title = initialTitle.trimmed().isEmpty()
      ? (isIncognito() ? QStringLiteral("Yeni Gizli Sekme") : QStringLiteral("Yeni Sekme"))
      : initialTitle.trimmed();
  info.url = targetUrl;
  info.view = view;
  info.isInternal = false;
  info.isPinned = initiallyPinned;
  info.icon = isIncognito() ? BrowserIcons::incognitoIcon() : BrowserIcons::appIcon();
  info.uuid = services_.tabManager
      ? services_.tabManager->registerTab(view, this, false, info.title)
      : QUuid::createUuid();

  wireViewSignals(view, tabId);

  if (auto *bp = dynamic_cast<BrowserWebPage *>(view->page())) {
    bp->setMediaCaptureCallback([this, tabId](bool activeCam, bool activeMic) {
      const int idx = findIndexByTabId(tabId);
      if (idx != -1) {
        tabs_[idx].activeCamera = activeCam;
        tabs_[idx].activeMicrophone = activeMic;
        if (tabStrip_ && idx == tabStrip_->currentIndex()) {
          updateOmniboxLeadingIcon();
          if (siteControlsBubble_ && siteControlsBubble_->isVisible()) {
            const auto &t = tabs_[idx];
            const QString canon = BrowserProfileService::canonicalOrigin(t.url);
            siteControlsBubble_->updateForTab(
                t.id, t.url, t.url.scheme() == QLatin1String("https"),
                t.activeCamera, t.activeMicrophone,
                [this, id = t.id, canon](const QString &k) {
                  return hasTabSessionPermission(id, canon, k);
                });
          }
        }
      }
    });
  }

  const int index = (insertIndex >= 0 && insertIndex <= tabs_.size())
      ? insertIndex : tabs_.size();

  tabs_.insert(index, info);
  pageStack_->insertWidget(index, view);
  tabStrip_->insertTab(index, tabId, info.title, info.icon, info.isPinned);

  prepareAdBlockScripts(view->page(), targetUrl);
  view->load(targetUrl);
  switchTab(index);

  return index;
}

int BrowserWindow::addInternalTab(QWidget *page, const QString &title, const QIcon &icon,
                                  const QString &internalId, int insertIndex) {
  if (!page) return -1;

  const uint64_t tabId = s_tabIdSequence.fetch_add(1);
  BrowserTabInfo info;
  info.id = tabId;
  info.title = title;
  info.icon = icon.isNull() ? BrowserIcons::appIcon() : icon;
  info.content = page;
  info.view = nullptr;
  info.isInternal = true;
  info.internalId = internalId;
  info.uuid = services_.tabManager
      ? services_.tabManager->registerInternalTab(page, this, title, internalId, {true, true, false, false})
      : QUuid::createUuid();

  const int index = (insertIndex >= 0 && insertIndex <= tabs_.size())
      ? insertIndex : tabs_.size();

  tabs_.insert(index, info);
  pageStack_->insertWidget(index, page);
  tabStrip_->insertTab(index, tabId, title, info.icon);

  switchTab(index);
  return index;
}

void BrowserWindow::closeTab(int index) {
  if (translateBubble_ && translateBubble_->isVisible()) {
    translateBubble_->close();
  }
  dismissSiteControlsBubble();
  if (hoverCard_) hoverCard_->hideCard();
  if (tabStrip_) tabStrip_->cancelHover();
  if (index < 0 || index >= tabs_.size()) return;

  BrowserTabInfo info = tabs_.takeAt(index);
  clearTabSessionPermissions(info.id);
#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
  if (currentActivePermissionRequest_.has_value() && currentActivePermissionRequest_->tabId == info.id) {
    dismissActivePermissionPrompt(true);
  }
  for (int i = pendingPermissionQueue_.size() - 1; i >= 0; --i) {
    if (pendingPermissionQueue_[i].tabId == info.id) {
      if (pendingPermissionQueue_[i].permission.isValid()) {
        pendingPermissionQueue_[i].permission.deny();
      }
      pendingPermissionQueue_.removeAt(i);
    }
  }
#endif
  if (info.groupId.has_value() && groupModel_) {
    const QUuid gid = *info.groupId;
    groupModel_->removeTabFromGroup(info.id);
    if (groupModel_->groupTabCount(gid) == 0) {
      groupModel_->removeGroup(gid);
    }
  }
  if (services_.profileService && !info.url.isEmpty() && info.url.isValid()) {
    services_.profileService->rememberClosedTab(info.url, info.title);
  }
  if (services_.tabManager && !info.uuid.isNull()) {
    services_.tabManager->remove(info.uuid);
  }

  if (info.view) {
    info.view->stop();
    info.view->disconnect(this);
    if (info.view->page()) {
      info.view->page()->disconnect(this);
    }
    if (services_.audioEffects) {
      services_.audioEffects->unregisterWebView(info.view.data());
    }
    if (autofillController_) {
      autofillController_->onViewClosed(info.view.data());
    }
    TabThrobber::instance().removeView(info.view.data());
    if (services_.profileService && services_.profileService->adBlockService()) {
      const quint64 adBlockTabId = reinterpret_cast<quintptr>(info.view.data());
      services_.profileService->adBlockService()->unregisterTab(adBlockTabId);
    }
    pageStack_->removeWidget(info.view);
    if (!beginForgetClosedView(info.view)) info.view->deleteLater();
  } else if (info.content) {
    if (info.internalId == QLatin1String("song-finder")
        && services_.songRecognition && services_.songRecognition->isListening()) {
      services_.songRecognition->stopListening();
    }
    pageStack_->removeWidget(info.content);
    info.content->deleteLater();
  }
  tabStrip_->removeTab(index);

  if (tabs_.isEmpty()) {
    close();
  } else {
    const int newIndex = std::min(index, static_cast<int>(tabs_.size()) - 1);
    switchTab(newIndex);
  }
}

void BrowserWindow::switchTab(int index) {
  if (translateBubble_ && translateBubble_->isVisible()) {
    translateBubble_->close();
  }
  dismissSiteControlsBubble();
  if (suggestionCompleter_ && suggestionCompleter_->popup()) suggestionCompleter_->popup()->hide();
  if (hoverCard_) hoverCard_->hideCard();
  if (index < 0 || index >= tabs_.size()) return;

  tabStrip_->setCurrentIndex(index);
  auto &info = tabs_[index];

  if (info.view) {
    pageStack_->setCurrentWidget(info.view);
    updateOmniboxForCurrentTab();
    updateNavButtons();
    updateReloadStopButton(TabThrobber::instance().isLoading(info.view));
    if (findBar_ && findBar_->isVisible()) {
      if (!findBar_->findText().isEmpty()) {
        handleFindRequest(findBar_->findText(), true, findBar_->isCaseSensitive());
      } else {
        findBar_->clearMatchCount();
      }
    }
    if (bookmarkBtn_ && services_.profileService) {
      const bool bm = services_.profileService->isBookmarked(info.url);
      bookmarkBtn_->setToolTip(bm ? QStringLiteral("Yer imi kaldır") : QStringLiteral("Yer imi ekle"));
    }
    updateBlockerControls();
    if (services_.songRecognition) {
      QString cleanTitle = info.title.trimmed();
      if (cleanTitle.endsWith(QStringLiteral(" - YouTube"), Qt::CaseInsensitive)) cleanTitle.chop(10);
      const QStringList parts = cleanTitle.split(QStringLiteral(" - "));
      if (parts.size() >= 2) {
        services_.songRecognition->setWebContextMetadata(parts.mid(1).join(QStringLiteral(" - ")).trimmed(), parts.first().trimmed());
      } else {
        services_.songRecognition->setWebContextMetadata(cleanTitle, QString());
      }
    }
    if (services_.audioEffects) {
      services_.audioEffects->applyToView(info.view.data());
    }
  } else if (info.content) {
    pageStack_->setCurrentWidget(info.content);
    omnibox_->setText(QStringLiteral("dalinira://") + info.internalId);
    backBtn_->setEnabled(false);
    forwardBtn_->setEnabled(false);
    updateBlockerControls();
  }

  updateOmniboxLeadingIcon();

#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
  if (currentActivePermissionRequest_.has_value()) {
    if (currentActivePermissionRequest_->tabId == info.id) {
      if (permissionBubble_) {
        updatePermissionBubblePosition();
        permissionBubble_->show();
        permissionBubble_->raise();
      }
    } else {
      if (permissionBubble_) {
        permissionBubble_->hide();
      }
    }
  } else {
    processNextPermissionRequest();
  }
  syncProfilePermissionsForTab(info.id);
#endif

  updateBookmarkBarVisibility();

  if (translateButton_) {
    if (info.translator && (info.translator->state() == PageTranslator::State::Detected ||
                            info.translator->state() == PageTranslator::State::Translated ||
                            info.translator->state() == PageTranslator::State::Translating)) {
      translateButton_->show();
      if (!info.translationOffered && info.translator->state() == PageTranslator::State::Detected) {
        info.translationOffered = true;
        showTranslatePopup();
      }
    } else {
      translateButton_->hide();
    }
  }

  if (autofillController_ && autofillController_->activeSaveBubble()) {
    auto *bubble = autofillController_->activeSaveBubble();
    if (info.view && autofillController_->activeBubbleView() == info.view.data()) {
      bubble->show();
      updateSaveBubblePosition();
    } else {
      bubble->hide();
    }
  }

  if (services_.tabManager && !info.uuid.isNull()) {
    services_.tabManager->activate(info.uuid);
  }
}

void BrowserWindow::moveTab(int fromIndex, int toIndex) {
  if (isMovingTab_) return;
  if (hoverCard_) hoverCard_->hideCard();
  if (fromIndex < 0 || fromIndex >= tabs_.size() ||
      toIndex < 0 || toIndex >= tabs_.size() || fromIndex == toIndex) {
    return;
  }

  isMovingTab_ = true;

  tabs_.move(fromIndex, toIndex);

  if (tabStrip_ && fromIndex < tabStrip_->count() && toIndex < tabStrip_->count()) {
    if (tabStrip_->tabId(toIndex) != tabs_[toIndex].id) {
      tabStrip_->moveTab(fromIndex, toIndex);
    }
  }

  if (services_.tabManager) {
    QVector<TabManager::TabId> orderedIds;
    orderedIds.reserve(tabs_.size());
    for (const auto &tab : std::as_const(tabs_)) orderedIds.push_back(tab.uuid);
    services_.tabManager->reorder(this, orderedIds);
  }

  isMovingTab_ = false;
}

bool BrowserWindow::transferTabTo(uint64_t tabId, BrowserWindow *destination, int targetIndex) {
  if (!destination || destination == this || destination->services_.profile != services_.profile) return false;

  int sourceIndex = findIndexByTabId(tabId);
  if (sourceIndex < 0) {
    const auto &session = dalinira::desktop_tabs::TabDragController::instance().session();
    if (session.isActive() && session.sourceWindow() == this) {
      sourceIndex = session.sourceTabIndex();
    }
  }
  if (sourceIndex < 0 && tabStrip_) {
    sourceIndex = tabStrip_->currentIndex();
  }
  if (sourceIndex < 0 || sourceIndex >= tabs_.size()) return false;

  BrowserTabInfo info = tabs_.takeAt(sourceIndex);
  if (info.groupId.has_value() && groupModel_) {
    const QUuid oldGid = *info.groupId;
    groupModel_->removeTabFromGroup(info.id);
    if (groupModel_->groupTabCount(oldGid) == 0) {
      groupModel_->removeGroup(oldGid);
    }
    info.groupId = std::nullopt; // Single detached tab leaves old group
  }
  if (info.view) {
    info.view->disconnect(this);
    pageStack_->removeWidget(info.view);
  } else if (info.content) {
    info.content->disconnect(this);
    pageStack_->removeWidget(info.content);
  }
  tabStrip_->removeTab(sourceIndex);

  destination->adoptTab(info, targetIndex);

  if (tabs_.isEmpty()) {
    if (!isCaptureShell_) {
      close();
    } else {
      hide();
    }
  } else {
    const int newIdx = std::clamp(sourceIndex, 0, static_cast<int>(tabs_.size()) - 1);
    switchTab(newIdx);
  }

  return true;
}

void BrowserWindow::adoptTab(BrowserTabInfo info, int targetIndex) {
  const int idx = (targetIndex >= 0 && targetIndex <= tabs_.size())
      ? targetIndex : tabs_.size();

  if (info.icon.isNull()) {
    info.icon = BrowserIcons::appIcon();
  }

  tabs_.insert(idx, info);
  if (info.view) {
    info.view->setParent(pageStack_);
    pageStack_->insertWidget(idx, info.view);
    wireViewSignals(info.view, info.id);
    if (services_.audioEffects) {
      services_.audioEffects->registerWebView(info.view.data(), info.url);
      services_.audioEffects->applyToView(info.view.data());
    }
    if (services_.profileService && services_.profileService->adBlockService()) {
      const quint64 adBlockTabId = reinterpret_cast<quintptr>(info.view.data());
      services_.profileService->adBlockService()->registerTab(adBlockTabId, info.url);
      services_.profileService->adBlockService()->setActiveTabId(adBlockTabId);
    }
    if (info.view->page()) {
#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
      auto *view = info.view.data();
      connect(info.view->page(), &QWebEnginePage::permissionRequested, this,
              [this, view](const QWebEnginePermission &permission) {
        handleTabPermissionRequested(view, permission);
      });
#else
      auto *view = info.view.data();
      connect(view->page(), &QWebEnginePage::featurePermissionRequested, this,
              [this, view](const QUrl &origin, QWebEnginePage::Feature feature) {
        if (!view || !view->page()) return;
        if (!permissionBubble_) {
          permissionBubble_ = new SitePermissionPromptBubble(this);
        }
        permissionBubble_->setupPromptLegacy(origin, BrowserPermissionPolicy::featureName(feature), BrowserIcon::Privacy);
        updatePermissionBubblePosition();
        permissionBubble_->show();
        permissionBubble_->raise();
        auto conn = std::make_shared<QMetaObject::Connection>();
        *conn = connect(permissionBubble_, &SitePermissionPromptBubble::choiceMade, this,
                        [this, view, origin, feature, conn](SitePermissionChoice choice) {
          disconnect(*conn);
          if (!view || !view->page()) return;
          const bool grant = (choice == SitePermissionChoice::AllowThisVisit || choice == SitePermissionChoice::AlwaysAllow);
          view->page()->setFeaturePermission(
              origin, feature,
              grant ? QWebEnginePage::PermissionGrantedByUser : QWebEnginePage::PermissionDeniedByUser);
        });
      });
#endif
    }
  } else if (info.content) {
    info.content->setParent(pageStack_);
    pageStack_->insertWidget(idx, info.content);
  }

  tabStrip_->insertTab(idx, info.id, info.title, info.icon, info.isPinned);
  if (info.groupId.has_value() && groupModel_ && groupModel_->hasGroup(*info.groupId)) {
    groupModel_->setTabGroup(info.id, *info.groupId);
  }
  switchTab(idx);
  if (!isVisible()) show();
  raise();
}

int BrowserWindow::findIndexByTabId(uint64_t tabId) const {
  for (int i = 0; i < tabs_.size(); ++i) {
    if (tabs_[i].id == tabId) return i;
  }
  return -1;
}

uint64_t BrowserWindow::findTabIdByIndex(int index) const {
  if (index >= 0 && index < tabs_.size()) {
    return tabs_[index].id;
  }
  return 0;
}

QWebEngineView *BrowserWindow::currentView() const {
  const int idx = tabStrip_->currentIndex();
  if (idx >= 0 && idx < tabs_.size() && !tabs_[idx].isInternal) {
    return tabs_[idx].view.data();
  }
  return nullptr;
}

void BrowserWindow::wireViewSignals(QWebEngineView *view, uint64_t tabId) {
  if (!view) return;

  connect(view, &QWebEngineView::titleChanged, this, [this, tabId, view](const QString &title) {
    const int idx = findIndexByTabId(tabId);
    if (idx >= 0 && tabs_[idx].view == view) {
      if (title.isEmpty() || isNewTabUrl(view->url()) || title == QLatin1String("Yeni Sekme")) {
        tabs_[idx].title = isIncognito() ? QStringLiteral("Yeni Gizli Sekme") : QStringLiteral("Yeni Sekme");
      } else {
        tabs_[idx].title = title;
      }
      tabStrip_->setTabText(idx, tabs_[idx].title);
      if (services_.tabManager && !tabs_[idx].uuid.isNull()) {
        services_.tabManager->updateTitle(tabs_[idx].uuid, tabs_[idx].title);
      }
      if (idx == tabStrip_->currentIndex() && services_.songRecognition) {
        QString cleanTitle = tabs_[idx].title.trimmed();
        if (cleanTitle.endsWith(QStringLiteral(" - YouTube"), Qt::CaseInsensitive)) cleanTitle.chop(10);
        const QStringList parts = cleanTitle.split(QStringLiteral(" - "));
        if (parts.size() >= 2) {
          services_.songRecognition->setWebContextMetadata(parts.mid(1).join(QStringLiteral(" - ")).trimmed(), parts.first().trimmed());
        } else {
          services_.songRecognition->setWebContextMetadata(cleanTitle, QString());
        }
      }
      if (services_.profileService) {
        services_.profileService->updateHistoryTitle(view->url(), title);
      }
    }
  });

  connect(view, &QWebEngineView::loadStarted, this, [this, tabId, view] {
    const int idx = findIndexByTabId(tabId);
    if (idx >= 0 && !tabs_[idx].isInternal && !isNewTabUrl(view->url())) {
      TabThrobber::instance().startLoading(view, this);
      tabStrip_->setTabLoading(idx, true);
    }
    if (idx == tabStrip_->currentIndex()) {
      updateReloadStopButton(true);
      updateBookmarkBarVisibility();
    }
  });

  connect(view, &QWebEngineView::iconChanged, this, [this, tabId, view](const QIcon &icon) {
    const int idx = findIndexByTabId(tabId);
    if (idx >= 0) {
      if (!icon.isNull() && !isNewTabUrl(tabs_[idx].url) && !tabs_[idx].isInternal) {
        tabs_[idx].icon = icon;
        TabThrobber::instance().cacheFavicon(view, icon);
      } else {
        tabs_[idx].icon = isIncognito() ? BrowserIcons::incognitoIcon() : BrowserIcons::appIcon();
      }
      if (!TabThrobber::instance().isLoading(view)) {
        tabStrip_->setTabIcon(idx, tabs_[idx].icon);
      }
      syncNewTabViews();
      if (services_.tabManager && !tabs_[idx].uuid.isNull()) {
        services_.tabManager->updateIcon(tabs_[idx].uuid, tabs_[idx].icon);
      }
    }
  });

  connect(view, &QWebEngineView::urlChanged, this, [this, tabId, view](const QUrl &url) {
    const int idx = findIndexByTabId(tabId);
    if (idx >= 0) {
      tabs_[idx].url = url;
      tabs_[idx].activeCamera = false;
      tabs_[idx].activeMicrophone = false;
      if (auto *bp = dynamic_cast<BrowserWebPage *>(view->page())) {
        bp->resetMediaCapture();
      }
      const QString newCanon = BrowserProfileService::canonicalOrigin(url);
      clearTabSessionPermissionsForOrigin(tabId, newCanon);
#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
      if (currentActivePermissionRequest_.has_value() &&
          currentActivePermissionRequest_->tabId == tabId &&
          currentActivePermissionRequest_->canonicalOrigin != newCanon) {
        dismissActivePermissionPrompt(true);
      }
      for (int i = pendingPermissionQueue_.size() - 1; i >= 0; --i) {
        if (pendingPermissionQueue_[i].tabId == tabId &&
            pendingPermissionQueue_[i].canonicalOrigin != newCanon) {
          if (pendingPermissionQueue_[i].permission.isValid()) {
            pendingPermissionQueue_[i].permission.deny();
          }
          pendingPermissionQueue_.removeAt(i);
        }
      }
#endif
      if (isNewTabUrl(url) || url.isEmpty()) {
        tabs_[idx].icon = isIncognito() ? BrowserIcons::incognitoIcon() : BrowserIcons::appIcon();
        tabStrip_->setTabIcon(idx, tabs_[idx].icon);
      }
      if (!isNewTabUrl(url) && url.scheme() != QLatin1String("dalinira") && url.isValid()) {
        lastActiveWebUrl_ = url;
      }
      if (services_.profileService) {
        bool isTyped = false;
        const QString scheme = url.scheme().toLower();
        if (scheme == QLatin1String("http") || scheme == QLatin1String("https")) {
          isTyped = !tabs_[idx].expectedTypedUrl.isEmpty()
              && navigationUrlKey(tabs_[idx].expectedTypedUrl) == navigationUrlKey(url);
          tabs_[idx].expectedTypedUrl = QUrl{};
        }
        services_.profileService->recordHistory(url, url.host(), isTyped);
        if (services_.profileService->adBlockService()) {
          const quint64 adBlockTabId = reinterpret_cast<quintptr>(view);
          services_.profileService->adBlockService()->updateTabUrl(adBlockTabId, url);
        }
      }
      if (idx == tabStrip_->currentIndex()) {
        updateOmniboxForCurrentTab();
        updateOmniboxLeadingIcon();
        updateNavButtons();
        updateBlockerControls();
        updateBookmarkBarVisibility();
        if (translateBubble_ && translateBubble_->isVisible()) {
          translateBubble_->close();
        }
        if (translateButton_) {
          translateButton_->hide();
        }
        if (siteControlsBubble_ && siteControlsBubble_->isVisible()) {
          const auto &t = tabs_[idx];
          const QString canon = BrowserProfileService::canonicalOrigin(t.url);
          siteControlsBubble_->updateForTab(
              t.id, t.url, t.url.scheme() == QLatin1String("https"),
              t.activeCamera, t.activeMicrophone,
              [this, id = t.id, canon](const QString &k) {
                return hasTabSessionPermission(id, canon, k);
              });
        }
      }
      prepareAdBlockScripts(tabs_[idx].view ? tabs_[idx].view->page() : nullptr, url);
      if (services_.tabManager && !tabs_[idx].uuid.isNull()) {
        services_.tabManager->updateUrl(tabs_[idx].uuid, url);
      }
      if (services_.audioEffects) {
        services_.audioEffects->applyToView(view);
      }
      if (autofillController_) {
        autofillController_->onUrlChanged(view, url);
      }
      tabs_[idx].translationOffered = false;
      if (tabs_[idx].translator) {
        tabs_[idx].translator->reset();
      }
    }
  });

  connect(view, &QWebEngineView::loadProgress, this, [this, tabId](int progress) {
    const int idx = findIndexByTabId(tabId);
    if (idx == tabStrip_->currentIndex()) {
      const bool loading = (progress < 100);
      if (loading) {
        progressBar_->setValue(progress);
        progressBar_->show();
      } else {
        progressBar_->hide();
      }
      updateReloadStopButton(loading);
    }
  });

  connect(view, &QWebEngineView::loadFinished, this, [this, tabId, view](bool success) {
    const int idx = findIndexByTabId(tabId);
    if (idx >= 0) {
      // QWebEngineView::icon() may dereference an already-detached WebContents
      // adapter while a navigation is finishing. iconChanged has already cached
      // any favicon that arrived, so preserve that value before finishLoading()
      // removes the throbber state and avoid querying WebEngine synchronously.
      const QIcon cachedLoadIcon = TabThrobber::instance().cachedFavicon(view);
      TabThrobber::instance().finishLoading(view, success);
      tabStrip_->setTabLoading(idx, false);

      if (!isNewTabUrl(view->url()) && !tabs_[idx].isInternal) {
        QIcon finalIcon;
        if (!cachedLoadIcon.isNull()) {
          finalIcon = cachedLoadIcon;
        } else if (!tabs_[idx].icon.isNull() &&
                   tabs_[idx].icon.cacheKey() != BrowserIcons::appIcon().cacheKey() &&
                   tabs_[idx].icon.cacheKey() != BrowserIcons::incognitoIcon().cacheKey()) {
          finalIcon = tabs_[idx].icon;
        } else {
          const QIcon pIcon = platformIconForBookmark(view->url());
          if (!pIcon.isNull()) {
            finalIcon = pIcon;
          }
        }

        if (!finalIcon.isNull()) {
          tabs_[idx].icon = finalIcon;
        } else {
          tabs_[idx].icon = isIncognito() ? BrowserIcons::incognitoIcon() : BrowserIcons::appIcon();
        }
        tabStrip_->setTabIcon(idx, tabs_[idx].icon);

        if (services_.profile) {
          const QPointer<QWebEngineView> guardedView(view);
          const QUrl pageUrl = view->url();
          services_.profile->requestIconForPageURL(pageUrl, 32, [this, tabId, guardedView, pageUrl](const QIcon &ico, const QUrl &, const QUrl &) {
            if (!ico.isNull() && guardedView && guardedView->url() == pageUrl) {
              const int curIdx = findIndexByTabId(tabId);
              if (curIdx >= 0) {
                tabs_[curIdx].icon = ico;
                if (!TabThrobber::instance().isLoading(guardedView)) {
                  tabStrip_->setTabIcon(curIdx, ico);
                }
                if (services_.tabManager && !tabs_[curIdx].uuid.isNull()) {
                  services_.tabManager->updateIcon(tabs_[curIdx].uuid, ico);
                }
              }
            }
          });
        }
      } else {
        tabs_[idx].icon = isIncognito() ? BrowserIcons::incognitoIcon() : BrowserIcons::appIcon();
        tabStrip_->setTabIcon(idx, tabs_[idx].icon);
      }

      if (services_.tabManager && !tabs_[idx].uuid.isNull()) {
        services_.tabManager->updateIcon(tabs_[idx].uuid, tabs_[idx].icon);
      }
    }

    if (success) {
      if (isNewTabUrl(view->url())) {
        const QString capability = QUuid::createUuid().toString(QUuid::WithoutBraces);
        view->page()->setProperty("dalinira-suggest-capability", capability);
        const QString json = QString::fromUtf8(QJsonDocument(QJsonArray{capability}).toJson(QJsonDocument::Compact));
        view->page()->runJavaScript(QStringLiteral(
            "window.navigationCapability=%1[0];"
            "if(window.daliniraSuggestionBridge)window.daliniraSuggestionBridge(%1[0]);").arg(json));
      }
      syncNewTabViews();
      updateSearchEngineIcon();
      if (autofillController_) {
        autofillController_->onPageLoadFinished(view, success);
      }
      if (idx >= 0 && idx < tabs_.size() && !tabs_[idx].isInternal && !isNewTabUrl(view->url())) {
        const QString scheme = view->url().scheme().toLower();
        if (scheme == QLatin1String("http") || scheme == QLatin1String("https")) {
          if (services_.profileService && services_.profileService->translateService() &&
              services_.profileService->translateService()->isEnabled()) {
            auto *translator = getOrCreatePageTranslator(idx);
            if (translator) {
              translator->detectLanguage();
            }
          }
        }
      }
    }
    // Always reset the button to Reload after load finishes (success or failure)
    if (findIndexByTabId(tabId) == tabStrip_->currentIndex()) {
      updateReloadStopButton(false);
    }
  });
}

void BrowserWindow::syncNewTabViews() {
  if (!services_.profileService) return;
  const QString script = newTabTopSitesUpdateScript(
      collectNewTabFrequentSites(services_.profileService),
      collectNewTabBookmarks(services_.profileService));
  const QString protectionScript = newTabProtectionStatsUpdateScript(
      services_.profileService->totalBlockedCount(),
      services_.profileService->recentDownloadCount(),
      services_.profileService->sessionBlockedCount());

  QSettings settings;
  const bool legacyCards = settings.value(QStringLiteral("browser/cards"), true).toBool();
  const bool showDownloads = settings.value(QStringLiteral("browser/showDownloadsCard"), legacyCards).toBool();
  const bool showBlocked = settings.value(QStringLiteral("browser/showBlockedCard"), legacyCards).toBool();
  const QString counterMode = settings.value(QStringLiteral("browser/blockedCounterMode"), QStringLiteral("all_time")).toString();
  const QString cardSettingsScript = newTabCardSettingsUpdateScript(showDownloads, showBlocked, counterMode);
  auto *backgroundStore = services_.profileService->newTabBackgroundStore();
  const bool backgroundAvailable = backgroundStore && backgroundStore->hasValidManagedImage();
  const QFileInfo backgroundInfo(backgroundStore ? backgroundStore->managedImagePath() : QString{});
  const quint64 backgroundRevision = backgroundAvailable
      ? static_cast<quint64>(backgroundInfo.lastModified().toMSecsSinceEpoch())
          ^ static_cast<quint64>(backgroundInfo.size())
      : 0;
  const QString backgroundScript = newTabBackgroundStateUpdateScript(backgroundAvailable, backgroundRevision);

  for (const BrowserTabInfo &tab : std::as_const(tabs_)) {
    if (!tab.view || !isNewTabUrl(tab.view->url())) continue;
    tab.view->page()->runJavaScript(script);
    tab.view->page()->runJavaScript(protectionScript);
    tab.view->page()->runJavaScript(cardSettingsScript);
    tab.view->page()->runJavaScript(backgroundScript);
    const bool enabled = services_.profileService->searchSuggestions()->isEnabled() && !tab.view->page()->profile()->isOffTheRecord();
    tab.view->page()->runJavaScript(QStringLiteral("if(window.daliniraSuggestionConsent)window.daliniraSuggestionConsent(%1,%2);")
        .arg(enabled ? QStringLiteral("true") : QStringLiteral("false"), tab.view->page()->profile()->isOffTheRecord() ? QStringLiteral("false") : QStringLiteral("true")));
  }
}

void BrowserWindow::handleNewTabBackgroundCommand(QWebEnginePage *sourcePage,
                                                   const QString &command,
                                                   const QString &capability) {
  auto *sourceView = sourcePage ? qobject_cast<QWebEngineView *>(sourcePage->parent()) : nullptr;
  if (!sourcePage || !sourceView || currentView() != sourceView ||
      !isNewTabUrl(sourcePage->url()) || sourcePage->profile() != services_.profile ||
      sourcePage->profile()->isOffTheRecord() || capability.isEmpty() ||
      sourcePage->property("dalinira-suggest-capability").toString() != capability ||
      !services_.profileService) return;

  auto *store = services_.profileService->newTabBackgroundStore();
  if (!store) return;
  bool ok = false;
  bool selectCustom = false;
  QString message;

  if (command == QLatin1String("pick")) {
    const QString selectedPath = QFileDialog::getOpenFileName(
        this, tr("Yeni sekme arka planı seç"),
        QStandardPaths::writableLocation(QStandardPaths::PicturesLocation),
        tr("Görseller (*.png *.jpg *.jpeg *.webp)"));
    if (selectedPath.isEmpty()) {
      if (sourcePage && isNewTabUrl(sourcePage->url()))
        sourcePage->runJavaScript(QStringLiteral("if(window.daliniraBackgroundCancelled)window.daliniraBackgroundCancelled();"));
      return;
    }
    const auto result = store->importImage(selectedPath);
    ok = result.ok();
    selectCustom = ok;
    message = ok ? tr("Özel arka plan uygulandı.") : result.message;
  } else if (command == QLatin1String("remove")) {
    ok = store->removeManagedImage();
    message = ok ? tr("Özel arka plan kaldırıldı.") : tr("Özel arka plan kaldırılamadı.");
  } else {
    return;
  }

  const bool available = store->hasValidManagedImage();
  const QFileInfo backgroundInfo(store->managedImagePath());
  const quint64 revision = available
      ? static_cast<quint64>(backgroundInfo.lastModified().toMSecsSinceEpoch())
          ^ static_cast<quint64>(backgroundInfo.size())
      : 0;
  const QString resultScript = newTabBackgroundResultScript(ok, message, available, revision, selectCustom);

  for (const auto &registered : dalinira::desktop_tabs::TabWindowRegistry::instance().registeredWindows()) {
    auto *window = registered.window ? qobject_cast<BrowserWindow *>(registered.window.data()) : nullptr;
    if (!window || window->services().profileService != services_.profileService) continue;
    for (const BrowserTabInfo &tab : window->allTabs()) {
      if (tab.view && isNewTabUrl(tab.view->url())) tab.view->page()->runJavaScript(resultScript);
    }
  }
}

void BrowserWindow::onOmniboxReturnPressed() {
  if (suggestionActivated_) return;
  const auto index = suggestionCompleter_->popup()->currentIndex();
  if (suggestionCompleter_->popup()->isVisible() && index.isValid()) {
    activateSuggestion(index.data(Qt::UserRole + 1).toUrl(), index.data(Qt::DisplayRole).toString(),
                       index.data(Qt::UserRole + 2).toString());
    return;
  }
  navigateFromUserInput(omnibox_->text());
}

void BrowserWindow::navigateFromUserInput(const QString &rawInput, const QString &searchEngine) {
  const QString input = rawInput.trimmed();
  if (input.isEmpty()) return;

  // Prevent recursion or loop if dalinira://navigate is passed
  if (input.startsWith(QStringLiteral("dalinira://navigate"), Qt::CaseInsensitive)) {
    return;
  }

  // Check for internal dalinira:// schemes
  if (input.startsWith(QStringLiteral("dalinira://"), Qt::CaseInsensitive)) {
    const QUrl internalUrl(input);
    const QString host = internalUrl.host().toLower();
    if (host == QLatin1String("settings")) { showSettings(); return; }
    if (host == QLatin1String("passwords")) { showPasswords(); return; }
    if (host == QLatin1String("audio-effects")) { showAudioEffects(); return; }
    if (host == QLatin1String("eq-presets")) { showEqPresetBrowser(); return; }
    if (host == QLatin1String("blocker")) { showDaliNiraBlockerSettings(); return; }
    if (host == QLatin1String("downloads")) { showMediaDownloads(); return; }
    if (host == QLatin1String("listen") || host == QLatin1String("pulse")) { showSongFinder(); return; }
    if (host == QLatin1String("listen-settings")) { showSongFinderSettings(); return; }
    if (host == QLatin1String("newtab") || host == QLatin1String("incognito")) {
      const QUrl newTabUrl(isIncognito() ? QStringLiteral("dalinira://incognito/") : QStringLiteral("dalinira://newtab/"));
      if (auto *view = currentView()) {
        const int idx = tabStrip_ ? tabStrip_->currentIndex() : -1;
        if (idx >= 0 && idx < tabs_.size() && tabs_[idx].view == view) {
          tabs_[idx].url = newTabUrl;
          updateBookmarkBarVisibility();
        }
        view->load(newTabUrl);
      } else {
        addNewTab(newTabUrl);
      }
      return;
    }
  }

  const QString engine = searchEngine.isEmpty() ? currentSearchEngine() : searchEngine;
  auto resolution = dalinira::core::AddressInputResolver::resolve(
      input, engine, QLocale::system(), candidateProvider_.get());
  if (resolution.classification == dalinira::core::AddressInputClassification::Search
      && services_.profileService) {
    const QUrl customUrl = services_.profileService->searchUrlForEngine(
        engine, resolution.searchQuery.isEmpty() ? input : resolution.searchQuery);
    if (customUrl.isValid()) resolution.url = customUrl;
  }
  QUrl url = resolution.url;
  if (!url.isValid() || url.isEmpty()) return;

  const bool adultProtection = services_.profileService
      ? services_.profileService->isAdultContentProtectionEnabled() : true;
  if (adultProtection && dalinira::core::AdultContentProtectionService::instance().isBlocked(url)) {
    url = QUrl(QStringLiteral("dalinira://blocked/adult"));
  }

  if (resolution.classification == dalinira::core::AddressInputClassification::Search &&
      services_.profileService && services_.profile == services_.profileService->profile() &&
      !services_.profile->isOffTheRecord()) {
    services_.profileService->recordSearch(resolution.searchQuery.isEmpty() ? input : resolution.searchQuery);
  }

  if (auto *view = currentView()) {
    const int idx = tabStrip_->currentIndex();
    if (idx >= 0 && idx < tabs_.size() && tabs_[idx].view == view) {
      tabs_[idx].expectedTypedUrl =
          resolution.classification == dalinira::core::AddressInputClassification::Search ? QUrl{} : url;
      tabs_[idx].url = url;
      updateBookmarkBarVisibility();
    }
    prepareAdBlockScripts(view->page(), url);
    view->load(url);
  } else {
    const int idx = addNewTab(url);
    if (idx >= 0 && idx < tabs_.size() && !tabs_[idx].isInternal) {
      tabs_[idx].expectedTypedUrl =
          resolution.classification == dalinira::core::AddressInputClassification::Search ? QUrl{} : url;
    }
  }
}

void BrowserWindow::onBackClicked() {
  if (auto *view = currentView()) {
    if (view->history() && view->history()->canGoBack()) {
      const QUrl backUrl = view->history()->backItem().url();
      const int idx = tabStrip_ ? tabStrip_->currentIndex() : -1;
      if (idx >= 0 && idx < tabs_.size() && tabs_[idx].view == view) {
        tabs_[idx].url = backUrl;
        updateBookmarkBarVisibility();
      }
    }
    view->back();
  }
}

void BrowserWindow::onForwardClicked() {
  if (auto *view = currentView()) {
    if (view->history() && view->history()->canGoForward()) {
      const QUrl forwardUrl = view->history()->forwardItem().url();
      const int idx = tabStrip_ ? tabStrip_->currentIndex() : -1;
      if (idx >= 0 && idx < tabs_.size() && tabs_[idx].view == view) {
        tabs_[idx].url = forwardUrl;
        updateBookmarkBarVisibility();
      }
    }
    view->forward();
  }
}

void BrowserWindow::onReloadOrStopClicked() {
  if (auto *view = currentView()) {
    if (isCurrentTabLoading()) {
      view->stop();
    } else {
      view->reload();
    }
  }
}

void BrowserWindow::onHomeClicked() {
  const QUrl homeUrl(isIncognito() ? QStringLiteral("dalinira://incognito/") : QStringLiteral("dalinira://newtab/"));
  if (auto *view = currentView()) {
    const int idx = tabStrip_ ? tabStrip_->currentIndex() : -1;
    if (idx >= 0 && idx < tabs_.size() && tabs_[idx].view == view) {
      tabs_[idx].url = homeUrl;
      updateBookmarkBarVisibility();
    }
    view->load(homeUrl);
  } else {
    addNewTab(homeUrl);
  }
}

void BrowserWindow::updateNavButtons() {
  if (auto *view = currentView()) {
    if (auto *hist = view->history()) {
      backBtn_->setEnabled(hist->canGoBack());
      forwardBtn_->setEnabled(hist->canGoForward());
    } else {
      backBtn_->setEnabled(false);
      forwardBtn_->setEnabled(false);
    }
    const bool isMedia = MediaDownloadService::isSupportedMediaUrl(view->url()) &&
                         !isNewTabUrl(view->url()) &&
                         view->url().scheme() != QLatin1String("dalinira");
    if (mediaDownload_) {
      mediaDownload_->setEnabled(true);
      mediaDownload_->setProperty("activeMedia", isMedia);
      mediaDownload_->style()->unpolish(mediaDownload_);
      mediaDownload_->style()->polish(mediaDownload_);
      updateDownloadToolbar();
    }
  } else {
    backBtn_->setEnabled(false);
    forwardBtn_->setEnabled(false);
    if (mediaDownload_) {
      mediaDownload_->setEnabled(true);
      mediaDownload_->setProperty("activeMedia", false);
      mediaDownload_->style()->unpolish(mediaDownload_);
      mediaDownload_->style()->polish(mediaDownload_);
      updateDownloadToolbar();
    }
  }
  updateBookmarkButtonState();
  updateBlockerControls();
}

bool BrowserWindow::isCurrentTabLoading() const {
  if (auto *view = currentView()) {
    return TabThrobber::instance().isLoading(view);
  }
  return false;
}

void BrowserWindow::updateReloadStopButton(bool isLoading) {
  if (!reloadBtn_) return;
  if (isLoading) {
    reloadBtn_->setIcon(BrowserIcons::stopIcon());
    reloadBtn_->setToolTip(I18n::text(QStringLiteral("toolbar.stop"), QStringLiteral("Durdur (Esc)")));
  } else {
    reloadBtn_->setIcon(BrowserIcons::reloadIcon());
    reloadBtn_->setToolTip(I18n::text(QStringLiteral("toolbar.reload"), QStringLiteral("Bu sayfayı yeniden yükleyin (F5 / Ctrl+R)")));
  }
}

void BrowserWindow::updateOmniboxForCurrentTab() {
  if (auto *view = currentView()) {
    const QString urlStr = view->url().toString();
    if (!urlStr.isEmpty() && urlStr != QLatin1String("about:blank") && !isNewTabUrl(view->url())) {
      omnibox_->setText(urlStr);
    } else {
      omnibox_->clear();
    }
  }
}

// -----------------------------------------------------------------
// Feature Page Navigations
// -----------------------------------------------------------------
void BrowserWindow::updateDownloadToolbar() {
  if (!mediaDownload_ || !downloadUiModel_) return;
  mediaDownload_->setModelState(downloadUiModel_->activeCount(),
                                downloadUiModel_->aggregateProgress(),
                                downloadUiModel_->hasPaused(),
                                downloadUiModel_->hasErrors());
}

bool BrowserWindow::downloadAnimationsEnabled() const {
  const QSettings settings;
  if (settings.value(QStringLiteral("ui/reduceMotion"), false).toBool()) return false;
  return settings.value(QStringLiteral("ui/animationsEnabled"), true).toBool();
}

void BrowserWindow::showDownloadStartedAnimation() {
  if (!mediaDownload_ || !downloadPopup_) return;
  const auto finishAcknowledgement = [this] {
    if (!mediaDownload_ || !downloadPopup_) return;
    const bool wasAlreadyOpen = downloadPopup_->isVisible();
    const QUrl activeUrl = (currentView() && !isNewTabUrl(currentView()->url()) && currentView()->url().scheme() != QLatin1String("dalinira"))
        ? currentView()->url() : lastActiveWebUrl_;
    const bool pageHasMedia = currentView() && currentView()->page() && currentView()->page()->recentlyAudible();
    if (!activeUrl.isEmpty() && MediaPlatformRegistry::shouldAutoAnalyzeMedia(activeUrl, pageHasMedia)) {
      downloadPopup_->setSuggestedMedia(activeUrl, currentView() ? currentView()->title() : QString{});
    } else {
      downloadPopup_->setSuggestedMedia(QUrl{}, QString{});
    }
    mediaDownload_->acknowledge(downloadAnimationsEnabled());
    downloadPopup_->showAnchored(mediaDownload_, !wasAlreadyOpen);
  };
  if (!downloadAnimationsEnabled() || !pageStack_) {
    finishAcknowledgement();
    return;
  }

  auto *ghost = new QLabel(this);
  ghost->setAttribute(Qt::WA_TransparentForMouseEvents);
  ghost->setAlignment(Qt::AlignCenter);
  ghost->setPixmap(BrowserIcons::icon(BrowserIcon::Download).pixmap(20, 20));
  ghost->setStyleSheet(QStringLiteral(
      "background:rgba(31,45,58,225);border:1px solid #4fc3f7;border-radius:10px;"));
  ghost->resize(38, 38);
  const QPoint source = pageStack_->mapTo(this, pageStack_->rect().center()) - QPoint(19, 19);
  const QPoint target = mediaDownload_->mapTo(this, mediaDownload_->rect().center()) - QPoint(8, 8);
  ghost->setGeometry(QRect(source, QSize(38, 38)));
  ghost->show();
  ghost->raise();

  auto *opacity = new QGraphicsOpacityEffect(ghost);
  ghost->setGraphicsEffect(opacity);
  auto *group = new QParallelAnimationGroup(ghost);
  auto *geometry = new QPropertyAnimation(ghost, "geometry", group);
  geometry->setDuration(430);
  geometry->setStartValue(ghost->geometry());
  geometry->setEndValue(QRect(target, QSize(16, 16)));
  geometry->setEasingCurve(QEasingCurve::InOutCubic);
  auto *fade = new QPropertyAnimation(opacity, "opacity", group);
  fade->setDuration(430);
  fade->setStartValue(0.92);
  fade->setKeyValueAt(0.68, 0.82);
  fade->setEndValue(0.0);
  connect(group, &QParallelAnimationGroup::finished, this, [ghost, finishAcknowledgement] {
    ghost->deleteLater();
    finishAcknowledgement();
  });
  group->start();
}

void BrowserWindow::showSettings(SettingsPage::Category category) {
  if (services_.tabManager) {
    const auto existingId = services_.tabManager->findInternal(this, QStringLiteral("settings"));
    if (!existingId.isNull()) {
      const auto *record = services_.tabManager->record(existingId);
      if (record && record->content) {
        const int idx = pageStack_->indexOf(record->content);
        if (idx >= 0) {
          if (auto *page = qobject_cast<SettingsPage *>(record->content.data())) {
            page->setCategory(category);
          }
          switchTab(idx);
          return;
        }
      }
    }
  }

  SettingsPage::Hooks hooks;
  hooks.searchEngine = [this] { return currentSearchEngine(); };
  hooks.setSearchEngine = [this](const QString &engine) { setSearchEngine(engine); };
  hooks.syncNewTabs = [this] { syncNewTabViews(); };
  hooks.refreshBookmarks = [this] { renderBookmarks(); };
  hooks.refreshBookmarkBarVisibility = [this] { updateBookmarkBarVisibility(); };
  hooks.refreshTabStyle = [] {
    dalinira::desktop_tabs::TabWindowRegistry::instance().reloadTabAppearances();
  };
  hooks.performanceManager = [this] { return services_.tabManager ? services_.tabManager->performanceManager() : nullptr; };

  auto *page = new SettingsPage(services_.profileService, std::move(hooks));
  page->setCategory(category);
  connect(page, &SettingsPage::navigateRequested, this, [this](const QUrl &url) {
    if (url == QUrl(QStringLiteral("dalinira://passwords"))) showPasswords();
    else addNewTab(url);
  });

  addInternalTab(page, QStringLiteral("Ayarlar"), BrowserIcons::icon(BrowserIcon::Settings), QStringLiteral("settings"));
}

void BrowserWindow::showPasswords() {
  if (services_.tabManager) {
    const auto existingId = services_.tabManager->findInternal(this, QStringLiteral("passwords"));
    if (!existingId.isNull()) {
      const auto *record = services_.tabManager->record(existingId);
      if (record && record->content) {
        const int idx = pageStack_->indexOf(record->content);
        if (idx >= 0) {
          if (auto *passwords = qobject_cast<PasswordManagerPage *>(record->content.data())) {
            passwords->refresh();
          }
          switchTab(idx);
          return;
        }
      }
    }
  }
  if (!services_.profileService || !services_.profileService->credentialVault()) return;
  auto *page = new PasswordManagerPage(services_.profileService->credentialVault(),
                                       services_.profileService->profile());
  addInternalTab(page, QStringLiteral("Şifre Yöneticisi"), BrowserIcons::icon(BrowserIcon::Password), QStringLiteral("passwords"));
}

void BrowserWindow::showAudioEffects() {
  if (services_.tabManager) {
    const auto existingId = services_.tabManager->findInternal(this, QStringLiteral("audio-effects"));
    if (!existingId.isNull()) {
      const auto *record = services_.tabManager->record(existingId);
      if (record && record->content) {
        const int idx = pageStack_->indexOf(record->content);
        if (idx >= 0) { switchTab(idx); return; }
      }
    }
  }
  auto *page = new AudioEffectsPage(services_.audioEffects);
  connect(page, &AudioEffectsPage::eqPresetBrowserRequested, this, &BrowserWindow::showEqPresetBrowser);
  addInternalTab(page, QStringLiteral("Ses Efektleri"), QIcon(QStringLiteral(":/side-widget-icons/sound-effects.svg")), QStringLiteral("audio-effects"));
}

void BrowserWindow::showEqPresetBrowser() {
  if (services_.tabManager) {
    const auto existingId = services_.tabManager->findInternal(this, QStringLiteral("eq-presets"));
    if (!existingId.isNull()) {
      const auto *record = services_.tabManager->record(existingId);
      if (record && record->content) {
        const int idx = pageStack_->indexOf(record->content);
        if (idx >= 0) { switchTab(idx); return; }
      }
    }
  }
  auto *page = new EqPresetPage(services_.audioEffects);
  addInternalTab(page, QStringLiteral("Hazır Ses Efektleri"), QIcon(QStringLiteral(":/side-widget-icons/eq-presets.svg")), QStringLiteral("eq-presets"));
}

void BrowserWindow::showDaliNiraBlockerSettings(DaliNiraBlockerPage::Tab tab) {
  if (!services_.profileService || !services_.profileService->adBlockService()) return;
  if (services_.tabManager) {
    const auto existingId = services_.tabManager->findInternal(this, QStringLiteral("blocker"));
    if (!existingId.isNull()) {
      const auto *record = services_.tabManager->record(existingId);
      if (record && record->content) {
        const int idx = pageStack_->indexOf(record->content);
        if (idx >= 0) {
          if (auto *page = qobject_cast<DaliNiraBlockerPage *>(record->content.data())) page->setActiveTab(tab);
          switchTab(idx);
          return;
        }
      }
    }
  }
  auto *page = new DaliNiraBlockerPage(services_.profileService->adBlockService());
  page->setActiveTab(tab);
  addInternalTab(page, QStringLiteral("DaliNira Blocker"), QIcon(QStringLiteral(":/side-widget-icons/deliblock.svg")), QStringLiteral("blocker"));
}

void BrowserWindow::showSongFinder() {
  if (services_.tabManager) {
    const auto existingId = services_.tabManager->findInternal(this, QStringLiteral("song-finder"));
    if (!existingId.isNull()) {
      const auto *record = services_.tabManager->record(existingId);
      if (record && record->content) {
        const int idx = pageStack_->indexOf(record->content);
        if (idx >= 0) { switchTab(idx); return; }
      }
    }
  }
  auto *page = new SongFinderPage(services_.songRecognition);
  connect(page, &SongFinderPage::openPreferencesRequested, this, &BrowserWindow::showSongFinderSettings);
  connect(page, &SongFinderPage::openUrlRequested, this, [this](const QUrl &url) { addNewTab(url); });
  addInternalTab(page, QStringLiteral("DaliNira Pulse"), QIcon(QStringLiteral(":/side-widget-icons/pulse.svg")), QStringLiteral("song-finder"));
}

void BrowserWindow::showSongFinderSettings() {
  if (services_.tabManager) {
    const auto existingId = services_.tabManager->findInternal(this, QStringLiteral("song-finder-settings"));
    if (!existingId.isNull()) {
      const auto *record = services_.tabManager->record(existingId);
      if (record && record->content) {
        const int idx = pageStack_->indexOf(record->content);
        if (idx >= 0) { switchTab(idx); return; }
      }
    }
  }
  auto *page = new SongFinderSettingsPage(services_.songFinderSettings);
  connect(page, &SongFinderSettingsPage::closeTabRequested, this, [this] { showSongFinder(); });
  addInternalTab(page, QStringLiteral("Pulse Ayarları"), BrowserIcons::icon(BrowserIcon::Settings), QStringLiteral("song-finder-settings"));
}

void BrowserWindow::showMediaDownloads(const QUrl &sourceUrl, bool analyzeImmediately) {
  if (!services_.mediaDownload) return;

  QUrl targetUrl = sourceUrl;
  bool shouldAnalyze = analyzeImmediately;

  if (targetUrl.isEmpty()) {
    const QUrl activeUrl = (currentView() && !isNewTabUrl(currentView()->url()) && currentView()->url().scheme() != QLatin1String("dalinira"))
        ? currentView()->url() : lastActiveWebUrl_;
    const bool pageHasMedia = currentView() && currentView()->page() && currentView()->page()->recentlyAudible();
    if (!activeUrl.isEmpty() && MediaPlatformRegistry::shouldAutoAnalyzeMedia(activeUrl, pageHasMedia)
        && !MediaPlatformRegistry::isGenericPlatformFeedUrl(activeUrl)) {
      targetUrl = activeUrl;
      shouldAnalyze = true;
    }
  } else {
    shouldAnalyze = analyzeImmediately || (MediaPlatformRegistry::shouldAutoAnalyzeMedia(targetUrl, false)
                                           && !MediaPlatformRegistry::isGenericPlatformFeedUrl(targetUrl));
    if (!shouldAnalyze && !MediaPlatformRegistry::shouldAutoAnalyzeMedia(targetUrl, false)) {
      targetUrl.clear();
    }
  }

  if (services_.tabManager) {
    const auto existingId = services_.tabManager->findInternal(this, QStringLiteral("downloads"));
    if (!existingId.isNull()) {
      const auto *record = services_.tabManager->record(existingId);
      if (record && record->content) {
        const int idx = pageStack_->indexOf(record->content);
        if (idx >= 0) {
          if (auto *page = qobject_cast<MediaDownloadPage *>(record->content.data())) {
            if (!targetUrl.isEmpty()) {
              page->setSourceUrl(targetUrl, shouldAnalyze);
            }
          }
          switchTab(idx);
          return;
        }
      }
    }
  }
  auto *page = new MediaDownloadPage(services_.mediaDownload, services_.profileService);
  connect(page, &MediaDownloadPage::internalMediaOpenRequested,
          this, &BrowserWindow::openLocalMedia);
  if (!targetUrl.isEmpty()) {
    page->setSourceUrl(targetUrl, shouldAnalyze);
  }
  addInternalTab(page, QStringLiteral("İndirmeler"), BrowserIcons::icon(BrowserIcon::Download), QStringLiteral("downloads"));
}

void BrowserWindow::resolveActiveMediaPageUrl(
    const QUrl &fallbackUrl, std::function<void(const QUrl &)> callback) {
  if (!callback) return;
  QPointer<BrowserWindow> guard(this);
  QPointer<QWebEngineView> sourceView(currentView());
  QPointer<QWebEnginePage> sourcePage(sourceView ? sourceView->page() : nullptr);
  if (!sourcePage || fallbackUrl.isEmpty() || sourceView->url() != fallbackUrl) {
    callback(fallbackUrl);
    return;
  }

  sourcePage->runJavaScript(
      MediaPageUrlResolver::extractionScript(), QWebEngineScript::ApplicationWorld,
      [guard, sourceView, fallbackUrl, callback = std::move(callback)](const QVariant &result) {
        if (!guard) return;
        const QUrl resolved = MediaPageUrlResolver::validatedResult(result, fallbackUrl);
        QUrl logUrl(resolved);
        logUrl.setQuery(QString{});
        logUrl.setFragment(QString{});
        qInfo().noquote() << "[MediaDownload] Çözülen aktif medya URL'si:"
                          << logUrl.toString(QUrl::FullyEncoded);
        // Holding the guarded view until completion prevents its page from
        // disappearing midway through resolution; never dereference it here.
        Q_UNUSED(sourceView);
        callback(resolved);
      });
}

void BrowserWindow::openLocalMedia(const LocalMediaOpenRequest &request) {
  if (!LocalMediaRouting::isSafeDownloadedFile(request.path, request.allowedRoot)
      || request.playerKind == LocalMediaPlayerKind::External) {
    return;
  }
  const QString canonicalPath = QFileInfo(request.path).canonicalFilePath();
  const QString id = QStringLiteral("local-media-player");
  const bool audio = request.playerKind == LocalMediaPlayerKind::Audio;
  const QString title = request.title.trimmed().isEmpty()
      ? QFileInfo(canonicalPath).completeBaseName() : request.title;
  const QIcon icon = BrowserIcons::icon(audio ? BrowserIcon::Music : BrowserIcon::Video);
  if (services_.tabManager) {
    const QUuid existingId = services_.tabManager->findInternal(this, id);
    if (!existingId.isNull()) {
      const auto *record = services_.tabManager->record(existingId);
      const int index = record && record->content ? pageStack_->indexOf(record->content) : -1;
      if (index >= 0) {
        if (auto *page = qobject_cast<LocalMediaPlayerPage *>(record->content.data())) {
          page->loadMedia(request);
        }
        tabs_[index].title = title.left(80);
        tabs_[index].icon = icon;
        tabStrip_->setTabTitle(index, tabs_[index].title);
        tabStrip_->setTabIcon(index, icon);
        services_.tabManager->updateTitle(existingId, tabs_[index].title);
        services_.tabManager->updateIcon(existingId, icon);
        switchTab(index);
        return;
      }
    }
  }
  auto *page = new LocalMediaPlayerPage(
      request, services_.profile, services_.audioEffects,
      services_.mediaDownload ? services_.mediaDownload->ffmpegPath() : QString{});
  connect(page, &LocalMediaPlayerPage::audioEffectsRequested,
          this, &BrowserWindow::showAudioEffects);
  addInternalTab(page, title.left(80), icon, id);
}

PageTranslator *BrowserWindow::getOrCreatePageTranslator(int tabIndex) {
  if (tabIndex < 0 || tabIndex >= tabs_.size()) return nullptr;
  auto &info = tabs_[tabIndex];
  if (info.isInternal || !info.view) return nullptr;
  if (!services_.profileService || !services_.profileService->translateService()) return nullptr;

  if (!info.translator) {
    info.translator = new PageTranslator(info.view.data(), services_.profileService->translateService(), info.view.data());

    connect(info.translator, &PageTranslator::languageDetected, this, [this, tabId = info.id](const QString &sourceLang, const QString &targetLang) {
      Q_UNUSED(targetLang);
      const int idx = findIndexByTabId(tabId);
      if (idx < 0) return;

      if (idx == tabStrip_->currentIndex()) {
        if (translateButton_) {
          translateButton_->show();
        }
        if (!tabs_[idx].translationOffered) {
          tabs_[idx].translationOffered = true;
          showTranslatePopup();
        }
      }
    });

    connect(info.translator, &PageTranslator::stateChanged, this, [this, tabId = info.id](PageTranslator::State state) {
      const int idx = findIndexByTabId(tabId);
      if (idx < 0) return;
      if (idx == tabStrip_->currentIndex() && translateButton_) {
        if (state == PageTranslator::State::Detected || state == PageTranslator::State::Translated || state == PageTranslator::State::Translating) {
          translateButton_->show();
        } else if (state == PageTranslator::State::Idle) {
          translateButton_->hide();
        }
      }
    });
  }

  return info.translator.data();
}

void BrowserWindow::showTranslatePopup() {
  auto *view = currentView();
  QUrl targetUrl = view ? view->url() : QUrl{};
  const int currentTabIndex = tabStrip_ ? tabStrip_->currentIndex() : -1;
  if ((targetUrl.isEmpty() || !targetUrl.isValid())
      && currentTabIndex >= 0 && currentTabIndex < tabs_.size()) {
    targetUrl = tabs_[currentTabIndex].url;
  }
  if (!view || currentTabIndex < 0 || currentTabIndex >= tabs_.size()) return;
  if (tabs_[currentTabIndex].isInternal || isNewTabUrl(targetUrl)) return;
  const QString scheme = targetUrl.scheme().toLower();
  if (scheme != QLatin1String("http") && scheme != QLatin1String("https")) return;

  if (!translateBubble_) {
    translateBubble_ = new TranslateBubblePopup(this);
    connect(translateBubble_, &TranslateBubblePopup::openSettingsRequested, this, [this] {
      showSettings(SettingsPage::Category::Languages);
    });
  }

  auto *translator = getOrCreatePageTranslator(currentTabIndex);
  if (!translator) return;

  pageTranslator_ = translator;
  translateBubble_->setTranslator(translator);

  if (translator->sourceLanguage().isEmpty() && translator->state() == PageTranslator::State::Idle) {
    translator->detectLanguage();
  }

  QToolButton *anchor = (translateButton_ && translateButton_->isVisible())
      ? translateButton_ : mainMenuBtn_;
  const int popupWidth = translateBubble_->width() > 0 ? translateBubble_->width() : 290;
  const QPoint anchorPos = anchor
      ? anchor->mapToGlobal(QPoint(anchor->width() - popupWidth, anchor->height() + 4))
      : QCursor::pos();
  translateBubble_->showAtAnchor(anchorPos);
}

void BrowserWindow::showZoomPopup() {
  if (auto *view = currentView()) {
    setCurrentZoom(view->zoomFactor() == 1.0 ? 1.25 : 1.0);
  }
}

void BrowserWindow::changeCurrentZoom(qreal delta) {
  if (auto *view = currentView()) {
    setCurrentZoom(view->zoomFactor() + delta);
  }
}

void BrowserWindow::setCurrentZoom(qreal factor) {
  if (auto *view = currentView()) {
    const qreal clamped = std::clamp(factor, 0.25, 5.0);
    view->setZoomFactor(clamped);
    if (clamped != 1.0) zoomButton_->show();
    else zoomButton_->hide();
  }
}

void BrowserWindow::saveSessionNow() {
  if (services_.sessionStore && services_.tabManager) {
    services_.sessionStore->save(*services_.tabManager, this);
  }
}

void BrowserWindow::restoreSession(const QVector<SavedTab> &savedTabs) {
  uint64_t activeTabId = 0;
  // TabLayoutModel reserves the first N slots for pinned-tab geometry. Restore
  // pinned tabs first (stable within each class), and insert each item with its
  // final presentation state so a normal tab is never placed in a pinned slot.
  for (const bool restorePinned : {true, false}) {
    for (const auto &tab : savedTabs) {
      if (tab.pinned != restorePinned) continue;
      const int idx = addNewTab(tab.url, -1, tab.pinned, tab.title);
      if (idx >= 0 && idx < tabs_.size() && tab.active) activeTabId = tabs_[idx].id;
      if (idx >= 0 && idx < tabs_.size() && tab.groupId.has_value() && !tab.groupId->isNull()) {
        tabs_[idx].groupId = *tab.groupId;
        if (groupModel_) {
          if (!groupModel_->hasGroup(*tab.groupId)) {
            groupModel_->addOrUpdateGroup({*tab.groupId, tab.groupName, tab.groupColor, tab.groupCollapsed});
          }
          groupModel_->setTabGroup(tabs_[idx].id, *tab.groupId);
        }
      }
    }
  }
  if (tabs_.isEmpty()) {
    ensureInitialTab();
  }
  if (tabStrip_) {
    tabStrip_->update();
  }
  const int activeIndex = findIndexByTabId(activeTabId);
  if (activeIndex >= 0) {
    switchTab(activeIndex);
  } else if (!tabs_.isEmpty()) {
    switchTab(0);
  }
  updateBookmarkBarVisibility();
}

void BrowserWindow::ensureInitialTab() {
  if (tabs_.isEmpty()) {
    addNewTab(QUrl(QStringLiteral("dalinira://newtab/")));
  }
}

void BrowserWindow::openStartupUrl(const QUrl &url) {
  addNewTab(url);
}

// -----------------------------------------------------------------
// Window events, Edge Resizing & Window Caption Controls
// -----------------------------------------------------------------
void BrowserWindow::closeEvent(QCloseEvent *event) {
  if (hoverCard_) hoverCard_->hideCard();
  if (services_.songRecognition && services_.songRecognition->isListening()) {
    const bool ownsOpenPulsePage = std::any_of(tabs_.cbegin(), tabs_.cend(), [](const BrowserTabInfo &tab) {
      return tab.isInternal && tab.internalId == QLatin1String("song-finder");
    });
    if (ownsOpenPulsePage) services_.songRecognition->stopListening();
  }
  saveSessionNow();
  dalinira::desktop_tabs::TabWindowRegistry::instance().unregisterWindow(this);
  QMainWindow::closeEvent(event);
  if (event->isAccepted() && services_.profileService) {
    auto *blocker = services_.profileService->blockerService();
    for (const auto &tab : std::as_const(tabs_))
      if (tab.view) blocker->unregisterTab(reinterpret_cast<quintptr>(tab.view.data()));
    for (const auto &tab : std::as_const(tabs_))
      if (tab.view) beginForgetClosedView(tab.view);
  }
}

void BrowserWindow::keyPressEvent(QKeyEvent *event) {
  if (event->key() == Qt::Key_Escape && isWebFullScreen_) {
    if (auto *view = currentView()) {
      if (view->page()) {
        view->page()->triggerAction(QWebEnginePage::ExitFullScreen);
      }
    }
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
    event->accept();
    return;
  }
  if (event->key() == Qt::Key_Escape && progressBar_->isVisible()) {
    if (auto *view = currentView()) {
      view->stop();
    }
    event->accept();
    return;
  }
  QMainWindow::keyPressEvent(event);
}

void BrowserWindow::onMinimizeClicked() {
  showMinimized();
}

void BrowserWindow::onMaximizeRestoreClicked() {
  if (isMaximized()) {
    showNormal();
    if (maxBtn_) maxBtn_->setText(QString::fromUtf8("□"));
  } else {
    showMaximized();
    if (maxBtn_) maxBtn_->setText(QString::fromUtf8("❐"));
  }
}

void BrowserWindow::onCloseWindowClicked() {
  close();
}

void BrowserWindow::changeEvent(QEvent *event) {
  if (event->type() == QEvent::WindowStateChange) {
    if (maxBtn_) {
      maxBtn_->setText(isMaximized() ? QString::fromUtf8("❐") : QString::fromUtf8("□"));
    }
    if (isMaximized() || isFullScreen()) {
      if (hasOverrideCursor_) {
        QGuiApplication::restoreOverrideCursor();
        hasOverrideCursor_ = false;
      }
      if (resizing_) {
        resizing_ = false;
        resizeEdges_ = {};
        releaseMouse();
      }
    }
    if (hoverCard_) hoverCard_->hideCard();
    dismissSiteControlsBubble();
  } else if (event->type() == QEvent::ActivationChange && !isActiveWindow()) {
    if (hasOverrideCursor_) {
      QGuiApplication::restoreOverrideCursor();
      hasOverrideCursor_ = false;
    }
    if (resizing_) {
      resizing_ = false;
      resizeEdges_ = {};
      releaseMouse();
    }
    if (hoverCard_) hoverCard_->hideCard();
    dismissSiteControlsBubble();
  }
  QMainWindow::changeEvent(event);
}

void BrowserWindow::showEvent(QShowEvent *event) {
  QMainWindow::showEvent(event);
  updateBookmarkBarVisibility();
}

void BrowserWindow::resizeEvent(QResizeEvent *event) {
  if (hoverCard_) hoverCard_->hideCard();
  QMainWindow::resizeEvent(event);
  updatePermissionBubblePosition();
  updateSiteControlsBubblePosition();
  updateSaveBubblePosition();
  updateFindBarPosition();
  if (downloadPopup_ && downloadPopup_->isVisible()) downloadPopup_->reposition(mediaDownload_);
  if (!isMaximized() && !isFullScreen() && !(windowState() & (Qt::WindowMaximized | Qt::WindowFullScreen))) {
    lastNormalSize_ = size();
    lastNormalGeometry_ = geometry();
    setProperty("daliniraRestoredSize", lastNormalSize_);
  }
}

void BrowserWindow::moveEvent(QMoveEvent *event) {
  if (hoverCard_) hoverCard_->hideCard();
  QMainWindow::moveEvent(event);
  updatePermissionBubblePosition();
  updateSiteControlsBubblePosition();
  updateSaveBubblePosition();
  if (downloadPopup_ && downloadPopup_->isVisible()) downloadPopup_->reposition(mediaDownload_);
  if (!isMaximized() && !isFullScreen() && !(windowState() & (Qt::WindowMaximized | Qt::WindowFullScreen))) {
    lastNormalGeometry_ = geometry();
    lastNormalSize_ = size();
    setProperty("daliniraRestoredSize", lastNormalSize_);
  }
}

QSize BrowserWindow::restoredSize() const {
  if (lastNormalSize_.isValid() && lastNormalSize_.width() >= 600 && lastNormalSize_.height() >= 400) {
    return lastNormalSize_;
  }
  const QRect norm = normalGeometry();
  if (norm.isValid() && norm.width() >= 600 && norm.height() >= 400) {
    return norm.size();
  }
  return QSize(1200, 800);
}

QRect BrowserWindow::restoredGeometry() const {
  if (lastNormalGeometry_.isValid() && lastNormalGeometry_.width() >= 600 && lastNormalGeometry_.height() >= 400) {
    return lastNormalGeometry_;
  }
  const QRect norm = normalGeometry();
  if (norm.isValid() && norm.width() >= 600 && norm.height() >= 400) {
    return norm;
  }
  return QRect(100, 100, 1200, 800);
}

Qt::Edges BrowserWindow::calculateEdges(const QPoint &pos) const {
  if (isMaximized() || isFullScreen() || (windowState() & (Qt::WindowMaximized | Qt::WindowFullScreen))) {
    return {};
  }
  Qt::Edges edges;
  const int margin = 6;
  if (pos.x() <= margin) edges |= Qt::LeftEdge;
  if (pos.x() >= width() - margin) edges |= Qt::RightEdge;
  if (pos.y() <= margin) edges |= Qt::TopEdge;
  if (pos.y() >= height() - margin) edges |= Qt::BottomEdge;
  return edges;
}

void BrowserWindow::updateCursorShape(const QPoint &pos) {
  if (isMaximized() || isFullScreen() ||
      property("daliniraDragCaptureShell").toBool() ||
      dalinira::desktop_tabs::TabDragController::instance().isActive()) {
    if (hasOverrideCursor_) {
      QGuiApplication::restoreOverrideCursor();
      hasOverrideCursor_ = false;
    }
    unsetCursor();
    return;
  }
  const Qt::Edges edges = calculateEdges(pos);
  if (edges != 0) {
    Qt::CursorShape shape = Qt::ArrowCursor;
    if ((edges & Qt::LeftEdge && edges & Qt::TopEdge) ||
        (edges & Qt::RightEdge && edges & Qt::BottomEdge)) {
      shape = Qt::SizeFDiagCursor;
    } else if ((edges & Qt::RightEdge && edges & Qt::TopEdge) ||
               (edges & Qt::LeftEdge && edges & Qt::BottomEdge)) {
      shape = Qt::SizeBDiagCursor;
    } else if (edges & (Qt::LeftEdge | Qt::RightEdge)) {
      shape = Qt::SizeHorCursor;
    } else if (edges & (Qt::TopEdge | Qt::BottomEdge)) {
      shape = Qt::SizeVerCursor;
    }
    if (!hasOverrideCursor_) {
      QGuiApplication::setOverrideCursor(shape);
      hasOverrideCursor_ = true;
      currentOverrideShape_ = shape;
    } else if (currentOverrideShape_ != shape) {
      QGuiApplication::changeOverrideCursor(shape);
      currentOverrideShape_ = shape;
    }
  } else {
    if (hasOverrideCursor_) {
      QGuiApplication::restoreOverrideCursor();
      hasOverrideCursor_ = false;
    }
    unsetCursor();
  }
}

void BrowserWindow::handleManualResize(const QPoint &globalPos) {
  if (!resizing_ || resizeEdges_ == 0) return;
  const QPoint diff = globalPos - resizeStartPos_;
  QRect newGeo = resizeStartGeometry_;
  const QSize minSz = minimumSizeHint().expandedTo(minimumSize());
  const int minW = std::max(640, minSz.width());
  const int minH = std::max(420, minSz.height());

  if (resizeEdges_ & Qt::LeftEdge) {
    const int newWidth = std::max(minW, resizeStartGeometry_.width() - diff.x());
    newGeo.setLeft(resizeStartGeometry_.right() - newWidth + 1);
  }
  if (resizeEdges_ & Qt::RightEdge) {
    const int newWidth = std::max(minW, resizeStartGeometry_.width() + diff.x());
    newGeo.setWidth(newWidth);
  }
  if (resizeEdges_ & Qt::TopEdge) {
    const int newHeight = std::max(minH, resizeStartGeometry_.height() - diff.y());
    newGeo.setTop(resizeStartGeometry_.bottom() - newHeight + 1);
  }
  if (resizeEdges_ & Qt::BottomEdge) {
    const int newHeight = std::max(minH, resizeStartGeometry_.height() + diff.y());
    newGeo.setHeight(newHeight);
  }

  setGeometry(newGeo);
}

void BrowserWindow::mousePressEvent(QMouseEvent *event) {
  if (event->button() == Qt::LeftButton) {
    const QPoint pos = event->position().toPoint();
    const Qt::Edges edges = calculateEdges(pos);
    if (edges != 0) {
      bool started = false;
      if (windowHandle()) {
        started = windowHandle()->startSystemResize(edges);
      }
      if (!started) {
        resizing_ = true;
        resizeEdges_ = edges;
        resizeStartPos_ = event->globalPosition().toPoint();
        resizeStartGeometry_ = geometry();
        grabMouse();
      }
      event->accept();
      return;
    }
    if (pos.y() <= 40) {
      if (windowHandle()) {
        windowHandle()->startSystemMove();
        event->accept();
        return;
      }
    }
  }
  QMainWindow::mousePressEvent(event);
}

void BrowserWindow::mouseMoveEvent(QMouseEvent *event) {
  if (resizing_) {
    handleManualResize(event->globalPosition().toPoint());
    event->accept();
    return;
  }
  if (!property("daliniraDragCaptureShell").toBool() &&
      !dalinira::desktop_tabs::TabDragController::instance().isActive()) {
    updateCursorShape(event->position().toPoint());
  } else {
    if (hasOverrideCursor_) {
      QGuiApplication::restoreOverrideCursor();
      hasOverrideCursor_ = false;
    }
    unsetCursor();
  }
  QMainWindow::mouseMoveEvent(event);
}

void BrowserWindow::mouseReleaseEvent(QMouseEvent *event) {
  if (resizing_) {
    resizing_ = false;
    resizeEdges_ = {};
    releaseMouse();
    event->accept();
    return;
  }
  if (hasOverrideCursor_) {
    QGuiApplication::restoreOverrideCursor();
    hasOverrideCursor_ = false;
  }
  unsetCursor();
  QMainWindow::mouseReleaseEvent(event);
}

QIcon BrowserWindow::tabIconForRecord(const BrowserTabInfo &info) const {
  if (info.isInternal && !info.icon.isNull()) {
    return info.icon;
  }
  const bool isNewTab = (info.view && (isNewTabUrl(info.view->url()) || info.view->property("dalinira-is-newtab-intent").toBool()))
                     || isNewTabUrl(info.url) || info.url.isEmpty();
  if (isNewTab) {
    return BrowserIcons::appIcon();
  }
  if (!info.icon.isNull()) {
    return info.icon;
  }
  return BrowserIcons::appIcon();
}

void BrowserWindow::updateBookmarkButtonState() {
  if (!bookmarkBtn_) return;
  const QUrl url = currentView() ? currentView()->url() : (tabStrip_->currentIndex() >= 0 && tabStrip_->currentIndex() < tabs_.size() ? tabs_[tabStrip_->currentIndex()].url : QUrl{});
  const bool bookmarked = services_.profileService && !isNewTabUrl(url) && url.isValid() && services_.profileService->isBookmarked(url);
  bookmarkBtn_->setIcon(bookmarkIcon(bookmarked));
  bookmarkBtn_->setToolTip(bookmarked
      ? I18n::text(QStringLiteral("toolbar.bookmark_remove"), QStringLiteral("Yer imi kaldır"))
      : I18n::text(QStringLiteral("toolbar.bookmark_add"), QStringLiteral("Yer imi ekle")));
}

void BrowserWindow::updateBlockerControls() {
  if (!adBlockShield_) return;

  // The blocker shield button must ALWAYS remain enabled and clickable
  adBlockShield_->setEnabled(true);

  auto *view = currentView();
  const int idx = tabStrip_ ? tabStrip_->currentIndex() : -1;
  const bool isInternalTab = (idx >= 0 && idx < tabs_.size() && tabs_[idx].content != nullptr);

  if (!view || isInternalTab || isInternalOrNonWebUrl(view->url())) {
    adBlockShield_->setInternalPage(true);
    adBlockShield_->setActiveHost(QString());
    adBlockShield_->setBlockedCount(0);
    adBlockShield_->setToolTip(I18n::text(QStringLiteral("toolbar.adblock"), QStringLiteral("DaliNira Koruma (Reklam Engelleyici)")));
    return;
  }

  // Normal supported web tab
  const QUrl url = view->url();
  const QString host = url.host().toLower();
  adBlockShield_->setInternalPage(false);
  adBlockShield_->setActiveHost(host);

  const quint64 tabId = reinterpret_cast<quintptr>(view);
  if (services_.profileService && services_.profileService->adBlockService()) {
    services_.profileService->adBlockService()->setActiveTabId(tabId);
    const auto stats = services_.profileService->adBlockService()->statsForTab(tabId);
    const quint64 total = stats.totalBlocked();
    adBlockShield_->setBlockedCount(total);
    adBlockShield_->setToolTip(total > 0
        ? I18n::text(QStringLiteral("toolbar.adblock_status"), QStringLiteral("DaliNira Koruma: %1")).arg(host) + QStringLiteral(" (") + I18n::text(QStringLiteral("toolbar.adblock_blocked_count"), QStringLiteral("%1 öğe engellendi")).arg(total) + QStringLiteral(")")
        : I18n::text(QStringLiteral("toolbar.adblock_status"), QStringLiteral("DaliNira Koruma: %1")).arg(host));
  } else {
    adBlockShield_->setBlockedCount(0);
    adBlockShield_->setToolTip(I18n::text(QStringLiteral("toolbar.adblock_status"), QStringLiteral("DaliNira Koruma: %1")).arg(host));
  }
}

void BrowserWindow::toggleCurrentBookmark() {
  if (!services_.profileService) return;
  const QUrl url = currentView() ? currentView()->url() : (tabStrip_->currentIndex() >= 0 && tabStrip_->currentIndex() < tabs_.size() ? tabs_[tabStrip_->currentIndex()].url : QUrl{});
  if (!url.isValid() || isNewTabUrl(url)) return;
  services_.profileService->toggleBookmark(url);
  updateBookmarkButtonState();
  renderBookmarks();
}

void BrowserWindow::renderBookmarks() {
  using Metrics = dalinira::ui::BrowserChromeMetrics;
  if (!bookmarkBar_ || !services_.profileService) return;
  bookmarkBar_->clear();

  // 1. Far-left Tab Group button ("Yeni sekme grubu oluştur")
  appsBtn_ = new QToolButton(bookmarkBar_);
  appsBtn_->setObjectName(QStringLiteral("appsButton"));
  appsBtn_->setIcon(BrowserIcons::icon(BrowserIcon::Grid));
  appsBtn_->setToolTip(QStringLiteral("Yeni sekme grubu oluştur"));
  appsBtn_->setFixedSize(28, Metrics::bookmarkButtonHeight);
  appsBtn_->setIconSize(QSize(Metrics::bookmarkIconSize,
                              Metrics::bookmarkIconSize));
  appsBtn_->setAutoRaise(true);
  const bool showTabGroups = QSettings().value(QStringLiteral("browser/showTabGroupsOnBookmarkBar"), true).toBool();
  appsBtn_->setVisible(showTabGroups);
  appsBtn_->setContextMenuPolicy(Qt::CustomContextMenu);
  connect(appsBtn_, &QWidget::customContextMenuRequested, this, [this](const QPoint &pos) {
    showBookmarkContextMenu(QUrl(), QString(), appsBtn_->mapToGlobal(pos));
  });
  connect(appsBtn_, &QToolButton::clicked, this, &BrowserWindow::toggleTabGroupLauncher);
  bookmarkBar_->addWidget(appsBtn_);

  // 2. Bookmark Folders
  const QStringList folders = services_.profileService->bookmarkFolders();
  const auto allItems = services_.profileService->bookmarkItems();

  for (const QString &folderName : folders) {
    auto *folderBtn = new QToolButton(bookmarkBar_);
    folderBtn->setObjectName(QStringLiteral("bookmarkFolderButton"));
    folderBtn->setText(folderName);
    folderBtn->setToolTip(QStringLiteral("%1 (Klasör)").arg(folderName));
    folderBtn->setIcon(BrowserIcons::icon(BrowserIcon::Folder));
    folderBtn->setToolButtonStyle(Qt::ToolButtonTextBesideIcon);
    folderBtn->setSizePolicy(QSizePolicy::Preferred, QSizePolicy::Fixed);
    folderBtn->setIconSize(QSize(Metrics::bookmarkIconSize, Metrics::bookmarkIconSize));
    folderBtn->setFixedHeight(Metrics::bookmarkButtonHeight);
    folderBtn->setCursor(Qt::PointingHandCursor);
    folderBtn->setPopupMode(QToolButton::InstantPopup);

    auto *menu = new QMenu(folderBtn);
    menu->setStyleSheet(QStringLiteral("QMenu{background:#1b232d;color:#e8eef5;border:1px solid #3a4857;border-radius:6px;padding:4px;} QMenu::item{padding:4px 24px;} QMenu::item:selected{background:#2a3644;}"));

    int count = 0;
    for (const auto &item : allItems) {
      if (item.folder.trimmed() == folderName) {
        count++;
        const QString title = item.title.isEmpty() ? bookmarkDisplayName(item.url) : item.title;
        QAction *act = menu->addAction(platformIconForBookmark(item.url), title);
        act->setToolTip(item.url.toDisplayString());
        connect(act, &QAction::triggered, this, [this, url = item.url] {
          if (auto *view = currentView()) {
            const int idx = tabStrip_->currentIndex();
            if (idx >= 0 && idx < tabs_.size()) {
              tabs_[idx].url = url;
              updateBookmarkBarVisibility();
            }
            prepareAdBlockScripts(view->page(), url);
            view->load(url);
          } else {
            addNewTab(url);
          }
        });
      }
    }
    if (count == 0) {
      QAction *empty = menu->addAction(QStringLiteral("(Klasör boş)"));
      empty->setEnabled(false);
    }
    folderBtn->setMenu(menu);

    folderBtn->setContextMenuPolicy(Qt::CustomContextMenu);
    connect(folderBtn, &QWidget::customContextMenuRequested, this, [this, folderName, folderBtn](const QPoint &pos) {
      QMenu ctxMenu(folderBtn);
      ctxMenu.setStyleSheet(QStringLiteral("QMenu{background:#1b232d;color:#e8eef5;border:1px solid #3a4857;border-radius:6px;padding:4px;} QMenu::item{padding:4px 20px;} QMenu::item:selected{background:#2a3644;}"));
      QAction *openAll = ctxMenu.addAction(QStringLiteral("Tümünü Yeni Sekmelerde Aç"));
      ctxMenu.addSeparator();
      QAction *delFolder = ctxMenu.addAction(BrowserIcons::icon(BrowserIcon::Close), QStringLiteral("Klasörü Sil"));
      QAction *chosen = ctxMenu.exec(folderBtn->mapToGlobal(pos));
      if (chosen == openAll) {
        for (const auto &item : services_.profileService->bookmarkItems()) {
          if (item.folder.trimmed() == folderName) addNewTab(item.url);
        }
      } else if (chosen == delFolder) {
        services_.profileService->removeBookmarkFolder(folderName, true);
        renderBookmarks();
      }
    });

    bookmarkBar_->addWidget(folderBtn);
  }

  // 3. Root Bookmark items with icon, site name, and remove button.
  QList<QUrl> rootUrls;
  for (const auto &item : allItems) {
    if (item.folder.isEmpty() && !rootUrls.contains(item.url)) {
      rootUrls.append(item.url);
    }
  }
  for (const QUrl &url : services_.profileService->bookmarks()) {
    bool inFolder = false;
    for (const auto &item : allItems) {
      if (item.url == url && !item.folder.isEmpty()) {
        inFolder = true;
        break;
      }
    }
    if (!inFolder && !rootUrls.contains(url)) {
      rootUrls.append(url);
    }
  }

  for (const QUrl &url : rootUrls) {
    const QString title = bookmarkDisplayName(url);
    auto *item = new QWidget(bookmarkBar_);
    item->setContextMenuPolicy(Qt::CustomContextMenu);
    auto *itemLayout = new QHBoxLayout(item);
    itemLayout->setContentsMargins(0, 0, 0, 0);
    itemLayout->setSpacing(0);
    auto *btn = new QToolButton(item);
    btn->setObjectName(QStringLiteral("bookmarkItemButton"));
    btn->setText(title);
    btn->setToolTip(url.toDisplayString());
    btn->setIcon(platformIconForBookmark(url));
    btn->setToolButtonStyle(Qt::ToolButtonTextBesideIcon);
    btn->setSizePolicy(QSizePolicy::Preferred, QSizePolicy::Fixed);
    btn->setIconSize(QSize(Metrics::bookmarkIconSize, Metrics::bookmarkIconSize));
    btn->setFixedHeight(Metrics::bookmarkButtonHeight);
    btn->setCursor(Qt::PointingHandCursor);
    btn->setContextMenuPolicy(Qt::CustomContextMenu);

    connect(btn, &QWidget::customContextMenuRequested, this, [this, url, title, btn](const QPoint &pos) {
      showBookmarkContextMenu(url, title, btn->mapToGlobal(pos));
    });
    connect(item, &QWidget::customContextMenuRequested, this, [this, url, title, item](const QPoint &pos) {
      showBookmarkContextMenu(url, title, item->mapToGlobal(pos));
    });

    auto *remove = new QToolButton(item);
    remove->setObjectName(QStringLiteral("bookmarkRemoveButton"));
    remove->setIcon(BrowserIcons::icon(BrowserIcon::Close));
    remove->setIconSize(QSize(12, 12));
    remove->setFixedSize(20, Metrics::bookmarkButtonHeight);
    remove->setToolTip(QStringLiteral("%1 yer imini kaldır").arg(title));
    remove->setCursor(Qt::PointingHandCursor);
    itemLayout->addWidget(btn);
    itemLayout->addWidget(remove);
    bookmarkBar_->addWidget(item);

    if (services_.profile) {
      const QPointer<QToolButton> guardedButton(btn);
      services_.profile->requestIconForPageURL(url, 64, [guardedButton](const QIcon &icon, const QUrl &, const QUrl &) {
        if (guardedButton && !icon.isNull()) {
          guardedButton->setIcon(icon);
        }
      });
    }

    connect(btn, &QToolButton::clicked, this, [this, url] {
      if (auto *view = currentView()) {
        const int idx = tabStrip_->currentIndex();
        if (idx >= 0 && idx < tabs_.size()) {
          tabs_[idx].url = url;
          updateBookmarkBarVisibility();
        }
        prepareAdBlockScripts(view->page(), url);
        view->load(url);
      } else {
        addNewTab(url);
      }
    });
    connect(remove, &QToolButton::clicked, this, [this, url] {
      if (!services_.profileService || !services_.profileService->isBookmarked(url)) return;
      services_.profileService->removeBookmark(url);
      updateBookmarkButtonState();
      renderBookmarks();
    });
  }
}

void BrowserWindow::notifyNavigationStarted(QWebEngineView *view, const QUrl &url) {
  if (!view) return;
  for (int i = 0; i < tabs_.size(); ++i) {
    if (tabs_[i].view == view) {
      tabs_[i].url = url;
      if (i == tabStrip_->currentIndex()) {
        updateBookmarkBarVisibility();
      }
      break;
    }
  }
}

bool BrowserWindow::isCurrentTabNewTab() const {
  if (tabs_.isEmpty()) return false;
  const int idx = tabStrip_ ? tabStrip_->currentIndex() : -1;
  if (idx < 0 || idx >= tabs_.size()) return false;
  const auto &info = tabs_[idx];
  if (info.isInternal) return false;

  // If the target or pending tab URL is set and is NOT a new tab URL, it cannot be a new tab.
  if (!info.url.isEmpty() && !isNewTabUrl(info.url)) {
    return false;
  }

  // If the web view has loaded a URL and it is NOT a new tab URL, it cannot be a new tab.
  if (info.view) {
    const QUrl viewUrl = info.view->url();
    if (!viewUrl.isEmpty() && viewUrl.toString() != QLatin1String("about:blank")) {
      if (!isNewTabUrl(viewUrl)) {
        return false;
      }
    }
  }

  return isNewTabUrl(info.url);
}

void BrowserWindow::updateBookmarkBarVisibility() {
  if (!bookmarkBar_) return;

  const QString mode = QSettings().value(
      QStringLiteral("browser/bookmarkBarVisibility"),
      QStringLiteral("new_tab")).toString();

  // Show the bookmark bar ONLY while the active tab is the DaliNira New Tab page.
  // Hide it on every normal website, search results page, internal non-New-Tab page, and local page.
  const bool shouldBeVisible = (mode != QLatin1String("never")) && isCurrentTabNewTab();

  bookmarkBar_->setVisible(shouldBeVisible);
}

void BrowserWindow::toggleBookmarkBar() {
  QSettings settings;
  const QString currentMode = settings.value(
      QStringLiteral("browser/bookmarkBarVisibility"),
      QStringLiteral("new_tab")).toString();

  const QString newMode = (currentMode == QLatin1String("never"))
      ? QStringLiteral("new_tab")
      : QStringLiteral("never");

  settings.setValue(QStringLiteral("browser/bookmarkBarVisibility"), newMode);
  settings.sync();
  updateBookmarkBarVisibility();
}


// Menus extracted to browser_window_menus.cpp


void BrowserWindow::fillCurrentPageFromVault() {
  if (autofillController_ && currentView()) {
    autofillController_->triggerFillForView(currentView());
  }
}

QString BrowserWindow::currentSearchEngine() const {
  if (services_.profileService) {
    return services_.profileService->searchEngine();
  }
  return QSettings().value(QStringLiteral("browser/searchEngine"), QStringLiteral("DuckDuckGo")).toString();
}

void BrowserWindow::setSearchEngine(const QString &engine) {
  if (services_.profileService) {
    services_.profileService->setSearchEngine(engine);
  } else {
    QSettings().setValue(QStringLiteral("browser/searchEngine"), engine);
    updateSearchEngineIcon();
  }
}

void BrowserWindow::updateSearchEngineIcon() {
  const QString engine = currentSearchEngine();
  if (omnibox_) omnibox_->setPlaceholderText(searchEnginePlaceholder(engine));
  const QString json = QString::fromUtf8(QJsonDocument(QJsonArray{engine}).toJson(QJsonDocument::Compact));
  for (const auto &tab : std::as_const(tabs_)) {
    if (tab.view && isNewTabUrl(tab.view->url())) {
      tab.view->page()->runJavaScript(QStringLiteral("if(location.protocol==='dalinira:'&&location.hostname==='newtab'&&window.daliniraSetSearchEngine)window.daliniraSetSearchEngine(%1[0]);").arg(json));
    }
  }
  updateOmniboxLeadingIcon();
}

void BrowserWindow::updateOmniboxLeadingIcon() {
  if (!searchEngineAction_ || !omnibox_) return;
  const int idx = tabStrip_ ? tabStrip_->currentIndex() : -1;
  if (idx < 0 || idx >= tabs_.size()) {
    searchEngineAction_->setIcon(BrowserIcons::searchEngineIcon(currentSearchEngine()));
    searchEngineAction_->setToolTip(I18n::text(QStringLiteral("toolbar.search_engine"), QStringLiteral("Arama motoru: %1")).arg(currentSearchEngine()));
    return;
  }

  const auto &tab = tabs_.at(idx);
  const bool isWeb = (!tab.isInternal && !isNewTabUrl(tab.url) && !tab.url.isEmpty() &&
                      (tab.url.scheme() == QLatin1String("http") || tab.url.scheme() == QLatin1String("https") || tab.url.scheme() == QLatin1String("file")));

  if (!isWeb) {
    searchEngineAction_->setIcon(BrowserIcons::searchEngineIcon(currentSearchEngine()));
    searchEngineAction_->setToolTip(I18n::text(QStringLiteral("toolbar.search_engine"), QStringLiteral("Arama motoru: %1")).arg(currentSearchEngine()));
    return;
  }

  const QString host = tab.url.host().isEmpty() ? tab.url.toString() : tab.url.host();

  if (tab.activeCamera && tab.activeMicrophone) {
    searchEngineAction_->setIcon(BrowserIcons::combinedMediaCaptureIcon());
    searchEngineAction_->setToolTip(I18n::text(QStringLiteral("toolbar.camera_mic_in_use"), QStringLiteral("Kamera ve mikrofon kullanımda — %1")).arg(host));
  } else if (tab.activeCamera) {
    searchEngineAction_->setIcon(BrowserIcons::icon(BrowserIcon::Camera));
    searchEngineAction_->setToolTip(I18n::text(QStringLiteral("toolbar.camera_in_use"), QStringLiteral("Kamera kullanımda — %1")).arg(host));
  } else if (tab.activeMicrophone) {
    searchEngineAction_->setIcon(BrowserIcons::icon(BrowserIcon::Microphone));
    searchEngineAction_->setToolTip(I18n::text(QStringLiteral("toolbar.mic_in_use"), QStringLiteral("Mikrofon kullanımda — %1")).arg(host));
  } else if (tab.url.scheme() == QLatin1String("http")) {
    searchEngineAction_->setIcon(BrowserIcons::icon(BrowserIcon::InsecureContent));
    searchEngineAction_->setToolTip(I18n::text(QStringLiteral("toolbar.insecure_connection"), QStringLiteral("Bağlantı güvenli değil — %1")).arg(host));
  } else {
    searchEngineAction_->setIcon(BrowserIcons::icon(BrowserIcon::Tune));
    searchEngineAction_->setToolTip(I18n::text(QStringLiteral("toolbar.site_info"), QStringLiteral("Site bilgilerini ve izinlerini görüntüle — %1")).arg(host));
  }
}

void BrowserWindow::toggleSiteControlsBubble() {
  const int idx = tabStrip_ ? tabStrip_->currentIndex() : -1;
  if (idx < 0 || idx >= tabs_.size()) return;
  const auto &tab = tabs_.at(idx);
  const bool isWeb = (!tab.isInternal && !isNewTabUrl(tab.url) && !tab.url.isEmpty() &&
                      (tab.url.scheme() == QLatin1String("http") || tab.url.scheme() == QLatin1String("https") || tab.url.scheme() == QLatin1String("file")));
  if (!isWeb) {
    showSettings(SettingsPage::Category::Search);
    return;
  }

  if (siteControlsBubble_ && siteControlsBubble_->isVisible()) {
    dismissSiteControlsBubble();
    return;
  }

  if (!siteControlsBubble_) {
    siteControlsBubble_ = new SiteControlsBubble(this);
    siteControlsBubble_->setProfileService(services_.profileService);
    connect(siteControlsBubble_, &SiteControlsBubble::permissionsResetRequested, this,
            &BrowserWindow::clearAllTabSessionPermissionsForOrigin);
    connect(siteControlsBubble_, &SiteControlsBubble::permissionRuleChanged, this,
            [this](const QString &key, const QString &origin, int choice) {
      if (choice != 0) {
        const int cIdx = tabStrip_ ? tabStrip_->currentIndex() : -1;
        if (cIdx != -1) {
          tabSessionGrants_.remove(TabSessionPermissionKey{tabs_[cIdx].id, origin, key});
        }
      }
    });
  }

  const QString canon = BrowserProfileService::canonicalOrigin(tab.url);
  const uint64_t currentId = tab.id;
  siteControlsBubble_->updateForTab(
      tab.id, tab.url, tab.url.scheme() == QLatin1String("https"),
      tab.activeCamera, tab.activeMicrophone,
      [this, currentId, canon](const QString &permKey) {
        return hasTabSessionPermission(currentId, canon, permKey);
      });

  siteControlsBubble_->show();
  updateSiteControlsBubblePosition();
  siteControlsBubble_->raise();
  siteControlsBubble_->setFocus();
}

void BrowserWindow::dismissSiteControlsBubble() {
  if (siteControlsBubble_ && siteControlsBubble_->isVisible()) {
    siteControlsBubble_->hide();
  }
}

bool BrowserWindow::isInsideSiteControls(QWidget *target, const QPoint &globalPos) const {
  if (!siteControlsBubble_ || !siteControlsBubble_->isVisible()) return false;

  if (target) {
    if (target == siteControlsBubble_ || siteControlsBubble_->isAncestorOf(target)) {
      return true;
    }
    const auto combos = siteControlsBubble_->findChildren<QComboBox *>();
    for (auto *combo : combos) {
      if (!combo) continue;
      QWidget *v = combo->view();
      if (v && (target == v || v->isAncestorOf(target))) {
        return true;
      }
      QWidget *w = v ? v->window() : nullptr;
      if (w && (target == w || w->isAncestorOf(target))) {
        return true;
      }
    }
  }

  const QRect bubbleGlobalRect(siteControlsBubble_->mapToGlobal(QPoint(0, 0)), siteControlsBubble_->size());
  if (bubbleGlobalRect.contains(globalPos)) {
    return true;
  }

  const auto combos = siteControlsBubble_->findChildren<QComboBox *>();
  for (auto *combo : combos) {
    if (!combo) continue;
    QWidget *v = combo->view();
    if (v && v->isVisible()) {
      const QRect vRect(v->mapToGlobal(QPoint(0, 0)), v->size());
      if (vRect.contains(globalPos)) {
        return true;
      }
      QWidget *w = v->window();
      if (w && w->isVisible()) {
        const QRect wRect(w->mapToGlobal(QPoint(0, 0)), w->size());
        if (wRect.contains(globalPos)) {
          return true;
        }
      }
    }
  }

  return false;
}

bool BrowserWindow::eventFilter(QObject *watched, QEvent *event) {
  static thread_local bool inEventFilter = false;
  if (inEventFilter) return false;
  struct FilterGuard {
    bool &flag;
    FilterGuard(bool &f) : flag(f) { flag = true; }
    ~FilterGuard() { flag = false; }
  } filterGuard(inEventFilter);

  if (watched == omnibox_ && event->type() == QEvent::FocusIn && omnibox_->text().trimmed().isEmpty()) {
    QTimer::singleShot(0, this, [this] {
      if (omnibox_ && omnibox_->hasFocus() && omnibox_->text().trimmed().isEmpty()) {
        updateOmniboxSuggestions(QString{});
      }
    });
  }

  if (watched == omnibox_ && event->type() == QEvent::FocusOut) {
    QTimer::singleShot(150, this, [this] {
      if (!omnibox_) return;
      if (suggestionPopup_ && suggestionPopup_->isVisible()) {
        if (!omnibox_->hasFocus() && !suggestionPopup_->hasFocus()) {
          suggestionPopup_->hide();
        }
      }
    });
  }

  if (event->type() == QEvent::KeyPress) {
    auto *keyEvent = static_cast<QKeyEvent *>(event);
    if (keyEvent->key() == Qt::Key_Escape) {
      if (suggestionPopup_ && suggestionPopup_->isVisible()) {
        suggestionPopup_->hide();
        return true;
      }
    }
  }

  if (suggestionPopup_ && suggestionPopup_->isVisible()) {
    if (event->type() == QEvent::MouseButtonPress) {
      auto *mouseEvent = static_cast<QMouseEvent *>(event);
      const QPoint globalPos = mouseEvent->globalPosition().toPoint();
      auto *widget = qobject_cast<QWidget *>(watched);

      bool isOmniOrPopup = false;
      if (widget == omnibox_ || widget == suggestionPopup_ || suggestionPopup_->isAncestorOf(widget)) {
        isOmniOrPopup = true;
      } else {
        if (omnibox_) {
          const QRect omniRect(omnibox_->mapToGlobal(QPoint(0, 0)), omnibox_->size());
          if (omniRect.contains(globalPos)) isOmniOrPopup = true;
        }
        if (suggestionPopup_) {
          const QRect popupRect(suggestionPopup_->mapToGlobal(QPoint(0, 0)), suggestionPopup_->size());
          if (popupRect.contains(globalPos)) isOmniOrPopup = true;
        }
      }

      if (!isOmniOrPopup) {
        suggestionPopup_->hide();
      }
    } else if (event->type() == QEvent::WindowDeactivate) {
      suggestionPopup_->hide();
    }
  }

  if (siteControlsBubble_ && siteControlsBubble_->isVisible()) {
    if (event->type() == QEvent::MouseButtonPress) {
      auto *mouseEvent = static_cast<QMouseEvent *>(event);
      const QPoint globalPos = mouseEvent->globalPosition().toPoint();
      auto *widget = qobject_cast<QWidget *>(watched);

      // If the click is on the omnibox leading action (toggle button), let toggleSiteControlsBubble handle it
      if (searchEngineAction_ && omnibox_) {
        const QPoint omniGlobal = omnibox_->mapToGlobal(QPoint(0, 0));
        const QRect leadingActionRect(omniGlobal.x(), omniGlobal.y(), 42, omnibox_->height());
        if (leadingActionRect.contains(globalPos)) {
          return false;
        }
      }

      if (!isInsideSiteControls(widget, globalPos)) {
        dismissSiteControlsBubble();
        // Do not consume the event; allow it to reach the target widget (e.g. tabs, page, toolbar)
        return false;
      }
    } else if (event->type() == QEvent::WindowDeactivate) {
      if (watched == this) {
        dismissSiteControlsBubble();
      }
    }
  }


  if (watched == this && event->type() == QEvent::WindowDeactivate) {
    if (hasOverrideCursor_) {
      QGuiApplication::restoreOverrideCursor();
      hasOverrideCursor_ = false;
    }
    if (resizing_) {
      resizing_ = false;
      resizeEdges_ = {};
      releaseMouse();
    }
  }

  if (!property("daliniraDragCaptureShell").toBool() &&
      !dalinira::desktop_tabs::TabDragController::instance().isActive() &&
      !isMaximized() && !isFullScreen() && !(windowState() & (Qt::WindowMaximized | Qt::WindowFullScreen))) {
    auto *widget = qobject_cast<QWidget *>(watched);
    if (widget && (widget == this || this->isAncestorOf(widget)) && (!widget->isWindow() || widget == this)) {
      if (event->type() == QEvent::MouseMove) {
        auto *mouseEvent = static_cast<QMouseEvent *>(event);
        const QPoint globalPos = mouseEvent->globalPosition().toPoint();
        if (resizing_) {
          handleManualResize(globalPos);
          return true;
        }
        const QPoint localPos = mapFromGlobal(globalPos);
        if (rect().contains(localPos)) {
          updateCursorShape(localPos);
        } else if (hasOverrideCursor_) {
          QGuiApplication::restoreOverrideCursor();
          hasOverrideCursor_ = false;
        }
      } else if (event->type() == QEvent::MouseButtonPress) {
        auto *mouseEvent = static_cast<QMouseEvent *>(event);
        if (mouseEvent->button() == Qt::LeftButton) {
          const QPoint globalPos = mouseEvent->globalPosition().toPoint();
          const QPoint localPos = mapFromGlobal(globalPos);
          if (rect().contains(localPos)) {
            const Qt::Edges edges = calculateEdges(localPos);
            if (edges != 0) {
              bool started = false;
              if (windowHandle()) {
                started = windowHandle()->startSystemResize(edges);
              }
              if (!started) {
                resizing_ = true;
                resizeEdges_ = edges;
                resizeStartPos_ = globalPos;
                resizeStartGeometry_ = geometry();
                grabMouse();
              }
              return true;
            }
          }
        }
      } else if (event->type() == QEvent::MouseButtonRelease) {
        if (resizing_) {
          resizing_ = false;
          resizeEdges_ = {};
          releaseMouse();
          if (hasOverrideCursor_) {
            QGuiApplication::restoreOverrideCursor();
            hasOverrideCursor_ = false;
          }
          return true;
        }
      } else if (event->type() == QEvent::Leave) {
        if (watched == this && hasOverrideCursor_ && !resizing_) {
          QGuiApplication::restoreOverrideCursor();
          hasOverrideCursor_ = false;
        }
      }
    }
  }

  return QMainWindow::eventFilter(watched, event);
}

// ============================================================================
// INVARIANT (Credential Save Bubble Lifetime & Isolation):
// - Once a valid credential save decision is pending, post-login navigation or
//   redirects MUST NOT dismiss the bubble before explicit user resolution
//   (Save / Not Now / close button).
// - Switching tabs hides and re-shows the bubble appropriately based on the active view.
// - Verified origin remains bound to the candidate throughout decision lifetime.
// - Tab destruction safely cleans pending decision without leaks.
// ============================================================================
void BrowserWindow::dismissCredentialSaveBubble() {
  if (autofillController_) {
    if (auto *bubble = autofillController_->activeSaveBubble()) {
      bubble->clickClose();
    } else {
      autofillController_->dismissSaveBubble();
    }
  }
}

void BrowserWindow::updateSaveBubblePosition() {
  if (!autofillController_ || !autofillController_->activeSaveBubble() || !omnibox_) return;
  auto *bubble = autofillController_->activeSaveBubble();
  if (currentView() != autofillController_->activeBubbleView()) {
    bubble->hide();
    return;
  }
  if (!bubble->isVisible()) return;
  QPoint omniLocal = omnibox_->mapTo(this, QPoint(0, omnibox_->height() + 4));
  omniLocal.setX(std::max(10, (width() - bubble->width()) / 2));
  bubble->move(omniLocal);
  bubble->raise();
}

void BrowserWindow::updateSiteControlsBubblePosition() {
  if (!siteControlsBubble_ || !omnibox_) return;
  QPoint omniLocal = omnibox_->mapTo(this, QPoint(4, omnibox_->height() + 4));
  if (omniLocal.x() + siteControlsBubble_->width() > width() - 10) {
    omniLocal.setX(std::max(10, width() - 10 - siteControlsBubble_->width()));
  }
  if (omniLocal.x() < 10) omniLocal.setX(10);
  siteControlsBubble_->move(omniLocal);
  siteControlsBubble_->raise();
}

void BrowserWindow::toggleTabSearchPopup() {
  if (tabSearchPopup_ && tabSearchPopup_->isVisible()) {
    tabSearchPopup_->close();
    return;
  }
  if (!tabSearchPopup_) {
    tabSearchPopup_ = new dalinira::desktop_tabs::TabSearchPopup(this);
  }
  tabSearchPopup_->showBelow(tabSearchBtn_);
}

void BrowserWindow::toggleTabGroupLauncher() {
  if (tabGroupLauncherPopup_ && tabGroupLauncherPopup_->isVisible()) {
    tabGroupLauncherPopup_->close();
    return;
  }
  if (!tabGroupLauncherPopup_) {
    tabGroupLauncherPopup_ = new dalinira::desktop_tabs::TabGroupLauncherPopup(this);
    connect(tabGroupLauncherPopup_, &dalinira::desktop_tabs::TabGroupLauncherPopup::createGroupRequested,
            this, &BrowserWindow::createNewTabGroupWithNewTab);
  }
  tabGroupLauncherPopup_->showBelow(appsBtn_);
}

void BrowserWindow::createNewTabGroupWithNewTab() {
  if (!groupModel_) return;

  // 1. Create a brand new normal DaliNira tab at the end of tabs using existing creation path
  const int newIdx = addNewTab(QUrl(QStringLiteral("dalinira://newtab/")), -1);
  if (newIdx < 0 || newIdx >= tabs_.size()) return;

  // 2. Generate a new stable Group UID
  const QColor defaultColor = dalinira::desktop_tabs::tabGroupColorPalette().value(0, QColor("#757b82"));
  const QUuid groupId = groupModel_->createGroup(QString(), defaultColor);

  // 3. Associate NEW Tab UID -> Group UID
  auto &newTab = tabs_[newIdx];
  newTab.groupId = groupId;
  groupModel_->setTabGroup(newTab.id, groupId);

  // 4. Update tab strip rendering
  tabStrip_->update();

  // 5. Open TabGroupPopup anchored below the group chip / new tab header
  QPoint targetPos;
  const QRect chipRect = tabStrip_->groupChipRect(groupId);
  if (!chipRect.isEmpty()) {
    targetPos = tabStrip_->mapToGlobal(QPoint(chipRect.left(), tabStrip_->height()));
  } else {
    const QRect tr = tabStrip_->tabRect(newIdx);
    targetPos = tabStrip_->mapToGlobal(QPoint(tr.left(), tabStrip_->height()));
  }

  showTabGroupPopup(groupId, targetPos);
}

void BrowserWindow::createGroupFromExistingTab(uint64_t tabId) {
  if (!groupModel_ || tabId == 0) return;
  const int idx = findIndexByTabId(tabId);
  if (idx < 0 || idx >= tabs_.size()) return;

  auto &tab = tabs_[idx];
  QUuid groupId;
  if (tab.groupId.has_value() && groupModel_->hasGroup(*tab.groupId)) {
    groupId = *tab.groupId;
  } else {
    const QColor defaultColor = dalinira::desktop_tabs::tabGroupColorPalette().value(0, QColor("#757b82"));
    groupId = groupModel_->createGroup(QString(), defaultColor);
    tab.groupId = groupId;
    groupModel_->setTabGroup(tab.id, groupId);
    tabStrip_->update();
  }

  QPoint targetPos;
  const QRect chipRect = tabStrip_->groupChipRect(groupId);
  if (!chipRect.isEmpty()) {
    targetPos = tabStrip_->mapToGlobal(QPoint(chipRect.left(), tabStrip_->height()));
  } else {
    const QRect tr = tabStrip_->tabRect(idx);
    targetPos = tabStrip_->mapToGlobal(QPoint(tr.left(), tabStrip_->height()));
  }

  showTabGroupPopup(groupId, targetPos);
}

void BrowserWindow::showTabGroupPopup(const QUuid &groupId, const QPoint &globalPos) {
  if (!groupModel_ || groupId.isNull()) return;
  if (!tabGroupPopup_) {
    tabGroupPopup_ = new dalinira::desktop_tabs::TabGroupPopup(groupModel_, this);
    connect(tabGroupPopup_, &dalinira::desktop_tabs::TabGroupPopup::newTabInGroupRequested,
            this, &BrowserWindow::addTabToGroup);
    connect(tabGroupPopup_, &dalinira::desktop_tabs::TabGroupPopup::moveGroupToNewWindowRequested,
            this, &BrowserWindow::moveGroupToNewWindow);
    connect(tabGroupPopup_, &dalinira::desktop_tabs::TabGroupPopup::closeGroupRequested,
            this, &BrowserWindow::closeTabGroup);
    connect(tabGroupPopup_, &dalinira::desktop_tabs::TabGroupPopup::ungroupRequested,
            this, &BrowserWindow::ungroupTabs);
    connect(tabGroupPopup_, &dalinira::desktop_tabs::TabGroupPopup::deleteGroupRequested,
            this, &BrowserWindow::deleteTabGroup);
  }

  QPoint targetPos = globalPos;
  if (targetPos.isNull()) {
    const QRect chipRect = tabStrip_->groupChipRect(groupId);
    if (!chipRect.isEmpty()) {
      targetPos = tabStrip_->mapToGlobal(QPoint(chipRect.left(), tabStrip_->height()));
    } else {
      const int idx = tabStrip_->currentIndex();
      const QRect tr = tabStrip_->tabRect(idx >= 0 ? idx : 0);
      targetPos = tabStrip_->mapToGlobal(QPoint(tr.left(), tabStrip_->height()));
    }
  }

  tabGroupPopup_->showForGroup(groupId, targetPos);
}

void BrowserWindow::addTabToGroup(const QUuid &groupId) {
  if (!groupModel_ || groupId.isNull()) return;

  int lastGroupIdx = -1;
  for (int i = 0; i < tabs_.size(); ++i) {
    if (tabs_[i].groupId == groupId) {
      lastGroupIdx = i;
    }
  }

  const int insertIdx = (lastGroupIdx >= 0) ? lastGroupIdx + 1 : tabs_.size();
  const int newIdx = addNewTab(QUrl(QStringLiteral("dalinira://newtab/")), insertIdx);
  if (newIdx >= 0 && newIdx < tabs_.size()) {
    tabs_[newIdx].groupId = groupId;
    groupModel_->setTabGroup(tabs_[newIdx].id, groupId);
    tabStrip_->update();
  }
}

void BrowserWindow::moveGroupToNewWindow(const QUuid &groupId) {
  if (!groupModel_ || groupId.isNull()) return;
  const auto optGroup = groupModel_->group(groupId);
  if (!optGroup.has_value()) return;

  const QList<uint64_t> memberTabIds = groupModel_->tabsInGroup(groupId);
  if (memberTabIds.isEmpty()) return;

  const dalinira::desktop_tabs::TabGroup groupToMove = *optGroup;

  auto *newWindow = new BrowserWindow(services_);
  newWindow->groupModel()->addOrUpdateGroup(groupToMove);

  for (uint64_t tid : memberTabIds) {
    const int idx = findIndexByTabId(tid);
    if (idx < 0 || idx >= tabs_.size()) continue;

    BrowserTabInfo info = tabs_.takeAt(idx);
    if (info.view) {
      info.view->disconnect(this);
      pageStack_->removeWidget(info.view);
    } else if (info.content) {
      info.content->disconnect(this);
      pageStack_->removeWidget(info.content);
    }
    tabStrip_->removeTab(idx);
    groupModel_->removeTabFromGroup(info.id);

    info.groupId = groupId;
    newWindow->adoptTab(info, -1);
    newWindow->groupModel()->setTabGroup(info.id, groupId);
  }

  groupModel_->removeGroup(groupId);

  if (tabs_.isEmpty()) {
    if (!isCaptureShell_) {
      close();
    } else {
      hide();
    }
  } else {
    const int current = std::clamp(tabStrip_->currentIndex(), 0, static_cast<int>(tabs_.size()) - 1);
    switchTab(current);
  }

  newWindow->show();
  newWindow->raise();
}

void BrowserWindow::closeTabGroup(const QUuid &groupId) {
  if (!groupModel_ || groupId.isNull()) return;
  const QList<uint64_t> memberTabIds = groupModel_->tabsInGroup(groupId);
  for (uint64_t tid : memberTabIds) {
    const int idx = findIndexByTabId(tid);
    if (idx >= 0) {
      closeTab(idx);
    }
  }
  groupModel_->removeGroup(groupId);
  tabStrip_->update();
}

void BrowserWindow::ungroupTabs(const QUuid &groupId) {
  if (!groupModel_ || groupId.isNull()) return;
  for (auto &tab : tabs_) {
    if (tab.groupId == groupId) {
      tab.groupId = std::nullopt;
    }
  }
  groupModel_->removeGroup(groupId);
  tabStrip_->update();
}

void BrowserWindow::deleteTabGroup(const QUuid &groupId) {
  closeTabGroup(groupId);
}

std::optional<dalinira::desktop_tabs::TabGroup> BrowserWindow::groupForTab(uint64_t tabId) const {
  if (!groupModel_) return std::nullopt;
  const auto optGid = groupModel_->groupIdForTab(tabId);
  if (!optGid.has_value() || optGid->isNull()) return std::nullopt;
  return groupModel_->group(*optGid);
}

void BrowserWindow::onTabHovered(int index, const QPoint &globalPos, const QRect &globalTabRect) {
  Q_UNUSED(globalPos);
  if (index < 0 || index >= tabs_.size()) {
    if (hoverCard_) hoverCard_->hideCard();
    return;
  }
  if (dalinira::desktop_tabs::TabDragController::instance().isActive()) {
    if (hoverCard_) hoverCard_->hideCard();
    return;
  }

  const auto &info = tabs_[index];
  if (!hoverCard_) {
    hoverCard_ = new TabHoverCard(this);
  }

  // 1. Authoritative lifecycle state source: TabPerformanceManager
  const QUuid tabUuid = info.uuid;
  QPointer<QWebEngineView> viewPtr = info.view;
  auto lifecycleProvider = [this, tabUuid, viewPtr]() -> QWebEnginePage::LifecycleState {
    if (services_.tabManager && services_.tabManager->performanceManager()) {
      auto *perf = services_.tabManager->performanceManager();
      if (perf->hasMetadata(tabUuid)) {
        return perf->metadata(tabUuid).lifecycleState;
      }
    }
    if (viewPtr && viewPtr->page()) {
      return viewPtr->page()->lifecycleState();
    }
    return QWebEnginePage::LifecycleState::Active;
  };

  const auto allViews = collectAllWebViewsAcrossWindows();

  hoverCard_->showForTab(info.title, info.url, tabIconForRecord(info),
                         info.view.data(), allViews,
                         globalTabRect, tabStrip_,
                         lifecycleProvider, info.isInternal);
}

void BrowserWindow::onTabHoverLeave() {
  if (hoverCard_) {
    hoverCard_->hideCard();
  }
}

QVector<QPointer<QWebEngineView>> BrowserWindow::collectAllWebViewsAcrossWindows() const {
  QVector<QPointer<QWebEngineView>> views;
  const auto regWindows = dalinira::desktop_tabs::TabWindowRegistry::instance().registeredWindows();
  for (const auto &rw : regWindows) {
    if (rw.window.isNull()) continue;
    if (!rw.window->isVisible()) continue;
    auto *bw = qobject_cast<BrowserWindow *>(rw.window.data());
    if (!bw) continue;

    for (int i = 0; i < bw->tabCount(); ++i) {
      const auto &info = bw->tabInfo(i);
      if (info.isInternal) continue;
      if (info.view.isNull()) continue;
      QWebEngineView *v = info.view.data();
      if (!v || !v->page()) continue;
      if (v->parent() == nullptr && v != bw->currentView()) continue;
      views.append(v);
    }
  }
  return views;
}

void BrowserWindow::onThrobberTick() {
  if (!tabStrip_) return;
  auto &throbber = TabThrobber::instance();
  const int activeIndex = tabStrip_->currentIndex();
  const qreal dpr = devicePixelRatioF();
  const QPalette pal = palette();

  for (int i = 0; i < tabs_.size(); ++i) {
    const auto *view = tabs_[i].view.data();
    if (!view) continue;

    if (throbber.isThrobberVisible(view)) {
      const bool isActive = (i == activeIndex);
      const QIcon throbberIcon = TabThrobber::renderThrobberIcon(throbber.frameStep(), pal, isActive, dpr, 16);
      tabStrip_->setTabIcon(i, throbberIcon);
    }
  }
}

QJsonArray BrowserWindow::searchRows(const QString &query, const QStringList &remote) const {
  QJsonArray rows;
  if (query.size() > 256) return rows;
  const QString cleanQuery = query.trimmed();
  QSet<QString> seen;
  auto append = [&](const QString &text, const QUrl &url, const QString &type) {
    if (rows.size() >= 12 || !url.isValid() || url.host().isEmpty() || !url.userInfo().isEmpty() ||
        (url.scheme() != QLatin1String("https") && url.scheme() != QLatin1String("http"))) return;
    const QString key = url.toString(QUrl::FullyEncoded);
    if (seen.contains(key)) return;
    seen.insert(key);
    QJsonObject row{{"text",text.left(256)},{"url",key},{"type",type}};
    if (type != QLatin1String("remote") && type != QLatin1String("search") &&
        type != QLatin1String("search-history"))
      row.insert(QStringLiteral("icon"), newTabFaviconUrl(services_.profileService, url));
    rows.append(row);
  };
  const auto search = [&](const QString &text, const QString &type) {
    const QUrl url = services_.profileService
        ? services_.profileService->searchUrlForEngine(currentSearchEngine(), text)
        : dalinira::core::AddressInputResolver::searchUrlForEngine(currentSearchEngine(), text);
    append(text, url, type);
  };
  if (!cleanQuery.isEmpty()) {
    const auto resolution = dalinira::core::AddressInputResolver::resolve(
        cleanQuery, currentSearchEngine(), QLocale::system(), candidateProvider_.get());
    if (resolution.classification != dalinira::core::AddressInputClassification::Search &&
        resolution.url.isValid() && (resolution.url.scheme() == QLatin1String("https") || resolution.url.scheme() == QLatin1String("http"))) {
      append(cleanQuery, resolution.url, QStringLiteral("site"));
    }
  }
  if (!cleanQuery.isEmpty()) search(cleanQuery, QStringLiteral("search"));
  // Local data is available only to its owning regular profile.
  if (services_.profileService && services_.profile == services_.profileService->profile() && !services_.profile->isOffTheRecord()) {
    for (const QString &savedQuery : services_.profileService->recentSearches(cleanQuery, 8)) {
      search(savedQuery, QStringLiteral("search-history"));
    }
    for (const auto &tab : tabs_) {
      if (!cleanQuery.isEmpty() && (tab.title.contains(cleanQuery, Qt::CaseInsensitive) || tab.url.host().contains(cleanQuery, Qt::CaseInsensitive)))
        append(tab.title.isEmpty() ? tab.url.host() : tab.title, tab.url, QStringLiteral("tab"));
      if (rows.size() >= 3) break;
    }
    for (const auto &url : services_.profileService->bookmarks()) {
      if (!cleanQuery.isEmpty() && url.host().contains(cleanQuery, Qt::CaseInsensitive)) append(url.host(), url, QStringLiteral("bookmark"));
      if (rows.size() >= 4) break;
    }
    for (const auto &site : services_.profileService->frequentSites(30)) {
      if (!cleanQuery.isEmpty() && (site.title.contains(cleanQuery, Qt::CaseInsensitive) || site.url.host().contains(cleanQuery, Qt::CaseInsensitive)))
        append(site.title.isEmpty() ? site.url.host() : site.title, site.url, QStringLiteral("frequent"));
      if (rows.size() >= 5) break;
    }
    for (const auto &entry : services_.profileService->recentHistory()) {
      if (!cleanQuery.isEmpty() && (entry.title.contains(cleanQuery, Qt::CaseInsensitive) || entry.url.host().contains(cleanQuery, Qt::CaseInsensitive)))
        append(entry.title.isEmpty() ? entry.url.host() : entry.title, entry.url, QStringLiteral("history"));
      if (rows.size() >= 6) break;
    }
  }
  if (!cleanQuery.isEmpty()) for (const auto &text : remote) search(text, QStringLiteral("remote"));
  return rows;
}

void BrowserWindow::activateSuggestion(const QUrl &url, const QString &text, const QString &type) {
  if (suggestionActivated_ || !url.isValid() || url.host().isEmpty() || !url.userInfo().isEmpty() ||
      (url.scheme() != QLatin1String("https") && url.scheme() != QLatin1String("http"))) return;
  suggestionActivated_ = true;
  QTimer::singleShot(0, this, [this] { suggestionActivated_ = false; });
  suggestionCompleter_->popup()->hide();
  if ((type == QLatin1String("search") || type == QLatin1String("remote") ||
       type == QLatin1String("search-history")) && services_.profileService &&
      services_.profile == services_.profileService->profile() && !services_.profile->isOffTheRecord()) {
    services_.profileService->recordSearch(text);
  }
  navigateFromUserInput(url.toString(QUrl::FullyEncoded));
}

void BrowserWindow::updateOmniboxSuggestions(const QString &query) {
  if (!services_.profileService || !services_.profileService->searchSuggestions()->isEnabled()) {
    if (suggestionModel_) suggestionModel_->clear();
    if (suggestionCompleter_ && suggestionCompleter_->popup()) suggestionCompleter_->popup()->hide();
    return;
  }
  const QPointer<BrowserWindow> guard(this);
  const QString engine = currentSearchEngine();
  auto render = [guard, query, engine](const QStringList &remote) {
    if (!guard || !guard->omnibox_->hasFocus() || guard->omnibox_->text() != query || guard->currentSearchEngine() != engine) return;
    guard->suggestionModel_->clear();
    for (const auto &value : guard->searchRows(query, remote)) {
      const auto row = value.toObject();
      auto *item = new QStandardItem(BrowserIcons::searchEngineIcon(engine), row.value("text").toString());
      item->setData(QUrl(row.value("url").toString()), Qt::UserRole + 1);
      item->setData(row.value("type").toString(), Qt::UserRole + 2);
      guard->suggestionModel_->appendRow(item);
      if (row.value("type") != QLatin1String("remote") && row.value("type") != QLatin1String("search") &&
          row.value("type") != QLatin1String("search-history")) {
        const QString key = row.value("url").toString();
        if (const auto *cached = guard->suggestionIconCache_.object(key)) {
          if (!cached->isNull()) item->setIcon(*cached);
        } else if (guard->pendingSuggestionIcons_ < 16) {
          ++guard->pendingSuggestionIcons_;
          const QPersistentModelIndex index(item->index());
          guard->services_.profile->requestIconForPageURL(QUrl(key), 24,
            [guard,index,key](const QIcon &icon, const QUrl &, const QUrl &) {
              if (!guard) return;
              --guard->pendingSuggestionIcons_;
              guard->suggestionIconCache_.insert(key, new QIcon(icon));
              if (index.isValid() && !icon.isNull()) guard->suggestionModel_->setData(index, icon, Qt::DecorationRole);
            });
        }
      }
    }
    if (guard->suggestionModel_->rowCount()) guard->suggestionCompleter_->complete();
    else guard->suggestionCompleter_->popup()->hide();
  };
  render({});
  if (services_.profileService) services_.profileService->searchSuggestions()->request(
      this, query, engine, services_.profile->isOffTheRecord() || services_.profile != services_.profileService->profile(), render);
}

void BrowserWindow::requestNewTabSuggestions(QWebEnginePage *page, const QString &query, int requestId) {
  if (!page || !services_.profileService || !services_.profileService->searchSuggestions()->isEnabled()
      || !currentView() || currentView()->page() != page || !isNewTabUrl(page->url())
      || query.trimmed().isEmpty()) return;
  const QPointer<QWebEnginePage> target(page);
  const QPointer<BrowserWindow> guard(this);
  const QString capability = page->property("dalinira-suggest-capability").toString();
  const QString engine = currentSearchEngine();
  page->setProperty("dalinira-suggest-id", requestId);
  auto render = [guard,target,capability,engine,query,requestId](const QStringList &remote) {
    if (!guard || !target || !isNewTabUrl(target->url()) || target->property("dalinira-suggest-capability").toString()!=capability ||
        target->property("dalinira-suggest-id").toInt()!=requestId || guard->currentSearchEngine()!=engine) return;
    const QJsonArray rows = guard->searchRows(query, remote);
    bool hasSuggestions = false;
    for (const auto &val : rows) {
      const auto obj = val.toObject();
      const QString type = obj.value(QStringLiteral("type")).toString();
      if (type != QLatin1String("search") || obj.value(QStringLiteral("text")).toString().trimmed() != query.trimmed()) {
        hasSuggestions = true;
        break;
      }
    }
    const QString json = QString::fromUtf8(QJsonDocument(QJsonArray{requestId,query,hasSuggestions ? rows : QJsonArray{}}).toJson(QJsonDocument::Compact));
    target->runJavaScript(QStringLiteral("if(window.daliniraShowSuggestions)window.daliniraShowSuggestions(...%1);").arg(json));
  };
  const QJsonArray localRows = searchRows(query, {});
  bool hasLocal = false;
  for (const auto &val : localRows) {
    if (val.toObject().value(QStringLiteral("type")).toString() != QLatin1String("search")) {
      hasLocal = true;
      break;
    }
  }
  if (hasLocal) {
    render({});
  }
  services_.profileService->searchSuggestions()->request(page,query,engine,
      page->profile()->isOffTheRecord() || page->profile()!=services_.profileService->profile(),render);
}

bool BrowserWindow::beginForgetClosedView(QWebEngineView *view) {
  if (!view || !services_.profileService ||
      !services_.profileService->blockerService()->shouldForgetClosedHost(view->url().host())) return false;
  pageStack_->removeWidget(view);
  view->hide();
  view->setParent(nullptr);
  // Finish bounded, origin-local cleanup before the page/profile is destroyed.
  // A reload or same-document route does not invoke this path.
  const auto quitLock = std::make_shared<QEventLoopLocker>();
  connect(view, &QObject::destroyed, [owner=services_.privateProfileOwner,quitLock] {});
  view->page()->runJavaScript(QStringLiteral(R"JS((()=>{
    try{localStorage.clear();sessionStorage.clear()}catch(_){}
    const tasks=[];
    try{tasks.push(indexedDB.databases().then(list=>Promise.all(list.slice(0,256).map(db=>new Promise(resolve=>{const request=indexedDB.deleteDatabase(db.name);request.onsuccess=request.onerror=request.onblocked=resolve})))))}catch(_){}
    try{tasks.push(caches.keys().then(keys=>Promise.all(keys.slice(0,256).map(key=>caches.delete(key)))))}catch(_){}
    try{tasks.push(navigator.serviceWorker.getRegistrations().then(list=>Promise.all(list.slice(0,256).map(reg=>reg.unregister()))))}catch(_){}
    Promise.allSettled(tasks).then(()=>{window.__daliniraForgetDone=true});
  })())JS"), QWebEngineScript::ApplicationWorld);
  const QPointer<QWebEngineView> guard(view);
  auto *timer = new QTimer(view);
  timer->setInterval(200);
  connect(timer, &QTimer::timeout, view, [guard,timer] {
    timer->stop();
    if (!guard) return;
    guard->page()->runJavaScript(QStringLiteral("window.__daliniraForgetDone===true"), QWebEngineScript::ApplicationWorld,
      [guard,timer](const QVariant &done) { if (!guard) return; if (done.toBool()) guard->deleteLater(); else timer->start(); });
  });
  timer->start();
  QTimer::singleShot(2000, view, &QObject::deleteLater);
  return true;
}

void BrowserWindow::updatePermissionBubblePosition() {
  if (!permissionBubble_ || !permissionBubble_->isVisible() || !omnibox_) return;
  const QPoint omniLocal = omnibox_->mapTo(this, QPoint(12, omnibox_->height() + 4));
  permissionBubble_->move(omniLocal);
  permissionBubble_->raise();
}

bool BrowserWindow::hasTabSessionPermission(uint64_t tabId, const QString &canonicalOrigin, const QString &permissionKey) const {
  return tabSessionGrants_.contains(TabSessionPermissionKey{tabId, canonicalOrigin, permissionKey});
}

void BrowserWindow::clearTabSessionPermissions(uint64_t tabId) {
  QList<TabSessionPermissionKey> removedGrants;
  for (auto it = tabSessionGrants_.begin(); it != tabSessionGrants_.end();) {
    if (it->tabId == tabId) {
      removedGrants.append(*it);
      it = tabSessionGrants_.erase(it);
    } else {
      ++it;
    }
  }

#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
  bool anyReset = false;
  for (const auto &grant : removedGrants) {
    bool otherTabHasGrant = false;
    for (const auto &remaining : tabSessionGrants_) {
      if (remaining.canonicalOrigin == grant.canonicalOrigin &&
          remaining.permissionKey == grant.permissionKey) {
        otherTabHasGrant = true;
        break;
      }
    }
    if (otherTabHasGrant) continue;

    bool hasPersistentAllow = false;
    if (services_.profileService) {
      hasPersistentAllow = services_.profileService->hasSitePermissionRule(grant.permissionKey, grant.canonicalOrigin);
    }

    if (!hasPersistentAllow) {
      QWebEngineProfile *targetProfile = services_.profile
          ? services_.profile
          : (services_.profileService ? services_.profileService->profile() : QWebEngineProfile::defaultProfile());
      if (targetProfile) {
        const QWebEnginePermission::PermissionType pType =
            BrowserProfileService::permissionTypeFromKey(grant.permissionKey);
        if (pType != QWebEnginePermission::PermissionType::Unsupported) {
          const QUrl targetUrl(grant.canonicalOrigin.startsWith(QStringLiteral("http"))
                                   ? grant.canonicalOrigin
                                   : QStringLiteral("https://") + grant.canonicalOrigin);
          QWebEnginePermission p = targetProfile->queryPermission(targetUrl, pType);
          if (p.isValid()) {
            p.reset();
            anyReset = true;
          }
        }
      }
    }
  }
  if (anyReset && services_.profileService) {
    emit services_.profileService->permissionsPolicyChanged();
  }
#endif
}

void BrowserWindow::clearTabSessionPermissionsForOrigin(uint64_t tabId, const QString &canonicalOrigin) {
  QList<TabSessionPermissionKey> removedGrants;
  for (auto it = tabSessionGrants_.begin(); it != tabSessionGrants_.end();) {
    if (it->tabId == tabId && it->canonicalOrigin != canonicalOrigin) {
      removedGrants.append(*it);
      it = tabSessionGrants_.erase(it);
    } else {
      ++it;
    }
  }

#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
  bool anyReset = false;
  for (const auto &grant : removedGrants) {
    bool otherTabHasGrant = false;
    for (const auto &remaining : tabSessionGrants_) {
      if (remaining.canonicalOrigin == grant.canonicalOrigin &&
          remaining.permissionKey == grant.permissionKey) {
        otherTabHasGrant = true;
        break;
      }
    }
    if (otherTabHasGrant) continue;

    bool hasPersistentAllow = false;
    if (services_.profileService) {
      hasPersistentAllow = services_.profileService->hasSitePermissionRule(grant.permissionKey, grant.canonicalOrigin);
    }

    if (!hasPersistentAllow) {
      QWebEngineProfile *targetProfile = services_.profile
          ? services_.profile
          : (services_.profileService ? services_.profileService->profile() : QWebEngineProfile::defaultProfile());
      if (targetProfile) {
        const QWebEnginePermission::PermissionType pType =
            BrowserProfileService::permissionTypeFromKey(grant.permissionKey);
        if (pType != QWebEnginePermission::PermissionType::Unsupported) {
          const QUrl targetUrl(grant.canonicalOrigin.startsWith(QStringLiteral("http"))
                                   ? grant.canonicalOrigin
                                   : QStringLiteral("https://") + grant.canonicalOrigin);
          QWebEnginePermission p = targetProfile->queryPermission(targetUrl, pType);
          if (p.isValid()) {
            p.reset();
            anyReset = true;
          }
        }
      }
    }
  }
  if (anyReset && services_.profileService) {
    emit services_.profileService->permissionsPolicyChanged();
  }
#endif
}

void BrowserWindow::grantTabSessionPermission(uint64_t tabId, const QString &canonicalOrigin, const QString &permissionKey) {
  tabSessionGrants_.insert(TabSessionPermissionKey{tabId, canonicalOrigin, permissionKey});
}

void BrowserWindow::clearAllTabSessionPermissionsForOrigin(const QString &canonicalOrigin) {
  for (auto it = tabSessionGrants_.begin(); it != tabSessionGrants_.end();) {
    if (it->canonicalOrigin == canonicalOrigin) {
      it = tabSessionGrants_.erase(it);
    } else {
      ++it;
    }
  }

#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
  QWebEngineProfile *targetProfile = services_.profile
      ? services_.profile
      : (services_.profileService ? services_.profileService->profile() : QWebEngineProfile::defaultProfile());
  if (targetProfile) {
    const QUrl originUrl(canonicalOrigin.startsWith(QStringLiteral("http")) ? canonicalOrigin : QStringLiteral("https://") + canonicalOrigin);
    if (originUrl.isValid()) {
      static const QWebEnginePermission::PermissionType kTypes[] = {
        QWebEnginePermission::PermissionType::Geolocation,
        QWebEnginePermission::PermissionType::MediaVideoCapture,
        QWebEnginePermission::PermissionType::MediaAudioCapture,
        QWebEnginePermission::PermissionType::MediaAudioVideoCapture,
        QWebEnginePermission::PermissionType::Notifications,
        QWebEnginePermission::PermissionType::ClipboardReadWrite,
        QWebEnginePermission::PermissionType::LocalFontsAccess,
        QWebEnginePermission::PermissionType::MouseLock,
        QWebEnginePermission::PermissionType::DesktopVideoCapture
      };
      for (auto t : kTypes) {
        QWebEnginePermission p = targetProfile->queryPermission(originUrl, t);
        if (p.isValid()) p.reset();
      }
    }
  }
  if (services_.profileService) {
    emit services_.profileService->permissionsPolicyChanged();
  }
#endif
}

void BrowserWindow::setTabActiveMediaForTesting(int tabIndex, bool camera, bool mic) {
  if (tabIndex >= 0 && tabIndex < tabs_.size()) {
    tabs_[tabIndex].activeCamera = camera;
    tabs_[tabIndex].activeMicrophone = mic;
    updateOmniboxLeadingIcon();
    if (siteControlsBubble_ && siteControlsBubble_->isVisible()) {
      const auto &t = tabs_[tabIndex];
      const QString cOrig = BrowserProfileService::canonicalOrigin(t.url);
      const uint64_t tId = t.id;
      siteControlsBubble_->updateForTab(
          t.id, t.url, t.url.scheme() == QLatin1String("https"),
          t.activeCamera, t.activeMicrophone,
          [this, tId, cOrig](const QString &permKey) {
            return hasTabSessionPermission(tId, cOrig, permKey);
          });
    }
  }
}

#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
void BrowserWindow::syncProfilePermissionsForTab(uint64_t tabId) {
  QWebEngineProfile *targetProfile = services_.profile
      ? services_.profile
      : (services_.profileService ? services_.profileService->profile() : QWebEngineProfile::defaultProfile());
  if (!targetProfile) return;

  for (const auto &grant : tabSessionGrants_) {
    if (services_.profileService &&
        services_.profileService->hasSitePermissionRule(grant.permissionKey, grant.canonicalOrigin)) {
      continue;
    }

    const QWebEnginePermission::PermissionType pType =
        BrowserProfileService::permissionTypeFromKey(grant.permissionKey);
    if (pType == QWebEnginePermission::PermissionType::Unsupported) continue;

    const QUrl targetUrl(grant.canonicalOrigin.startsWith(QStringLiteral("http"))
                             ? grant.canonicalOrigin
                             : QStringLiteral("https://") + grant.canonicalOrigin);
    QWebEnginePermission p = targetProfile->queryPermission(targetUrl, pType);
    if (!p.isValid()) continue;

    if (hasTabSessionPermission(tabId, grant.canonicalOrigin, grant.permissionKey)) {
      if (p.state() != QWebEnginePermission::State::Granted) {
        p.grant();
      }
    } else {
      if (p.state() != QWebEnginePermission::State::Ask) {
        p.reset();
      }
    }
  }
}

void BrowserWindow::handleTabPermissionRequested(QWebEngineView *view, const QWebEnginePermission &permission) {
  if (!permission.isValid()) return;
  if (permission.state() == QWebEnginePermission::State::Granted ||
      permission.state() == QWebEnginePermission::State::Denied) {
    return;
  }
  if (!view || !view->page()) {
    permission.deny();
    return;
  }

  const QUrl origin = permission.origin();
  if (!BrowserProfileService::isPermissibleWebOrigin(origin)) {
    if (!BrowserProfileService::isTrustedInternalScheme(origin)) {
      permission.deny();
      return;
    }
  }

  uint64_t viewTabId = 0;
  for (const auto &tab : tabs_) {
    if (tab.view == view) {
      viewTabId = tab.id;
      break;
    }
  }
  if (viewTabId == 0) {
    permission.deny();
    return;
  }

  const QString canon = BrowserProfileService::canonicalOrigin(origin);
  const QString permKey = BrowserProfileService::permissionKeyFromType(permission.permissionType());

  // 1. Check tab-scoped session permission
  const bool hasTemp = hasTabSessionPermission(viewTabId, canon, permKey) ||
                       (permission.permissionType() == QWebEnginePermission::PermissionType::MediaAudioVideoCapture &&
                        hasTabSessionPermission(viewTabId, canon, QStringLiteral("camera")) &&
                        hasTabSessionPermission(viewTabId, canon, QStringLiteral("microphone")));
  if (hasTemp) {
    permission.grant();
    return;
  }

  // 2. Check profile policy (permanent rules or default policy)
  if (services_.profileService) {
    const auto policyResult = services_.profileService->evaluatePermissionPolicy(origin, permission.permissionType());
    if (policyResult == BrowserProfileService::OriginPolicyResult::Allow) {
      permission.grant();
      return;
    } else if (policyResult == BrowserProfileService::OriginPolicyResult::Deny) {
      permission.deny();
      return;
    }
  }

  // 3. Prevent duplicate prompts for the same (tabId, canonicalOrigin, type)
  if (currentActivePermissionRequest_.has_value() &&
      currentActivePermissionRequest_->tabId == viewTabId &&
      currentActivePermissionRequest_->canonicalOrigin == canon &&
      currentActivePermissionRequest_->type == permission.permissionType()) {
    return;
  }
  for (const auto &pending : pendingPermissionQueue_) {
    if (pending.tabId == viewTabId &&
        pending.canonicalOrigin == canon &&
        pending.type == permission.permissionType()) {
      return;
    }
  }

  PendingPermissionRequest req;
  req.permission = permission;
  req.view = view;
  req.page = view->page();
  req.tabId = viewTabId;
  req.requestedOrigin = origin;
  req.canonicalOrigin = canon;
  req.type = permission.permissionType();
  req.requestedAt = QDateTime::currentDateTimeUtc();

  pendingPermissionQueue_.append(req);

  if (!currentActivePermissionRequest_.has_value()) {
    processNextPermissionRequest();
  }
}

void BrowserWindow::processNextPermissionRequest() {
  if (currentActivePermissionRequest_.has_value()) return;
  if (pendingPermissionQueue_.isEmpty()) {
    if (permissionBubble_) permissionBubble_->hide();
    return;
  }

  const int activeIndex = tabStrip_->currentIndex();
  const uint64_t activeTabId = (activeIndex >= 0 && activeIndex < tabs_.size()) ? tabs_[activeIndex].id : 0;

  int chosenIndex = -1;
  for (int i = 0; i < pendingPermissionQueue_.size(); ++i) {
    if (pendingPermissionQueue_[i].tabId == activeTabId) {
      chosenIndex = i;
      break;
    }
  }
  if (chosenIndex == -1) {
    chosenIndex = 0;
  }

  PendingPermissionRequest req = pendingPermissionQueue_.takeAt(chosenIndex);

  if (!req.view || !req.page || !req.permission.isValid() || findIndexByTabId(req.tabId) == -1) {
    if (req.permission.isValid()) req.permission.deny();
    processNextPermissionRequest();
    return;
  }
  const QString currentCanon = BrowserProfileService::canonicalOrigin(req.view->url());
  if (currentCanon != req.canonicalOrigin) {
    if (req.permission.isValid()) req.permission.deny();
    processNextPermissionRequest();
    return;
  }

  currentActivePermissionRequest_ = req;

  if (!permissionBubble_) {
    permissionBubble_ = new SitePermissionPromptBubble(this);
    connect(permissionBubble_, &SitePermissionPromptBubble::choiceMade, this,
            &BrowserWindow::resolveActivePermissionRequest);
  }

  permissionBubble_->setupPrompt(req.requestedOrigin, req.type);

  if (req.tabId == activeTabId) {
    updatePermissionBubblePosition();
    permissionBubble_->show();
    permissionBubble_->raise();
  } else {
    permissionBubble_->hide();
  }
}

void BrowserWindow::resolveActivePermissionRequest(SitePermissionChoice choice) {
  if (!currentActivePermissionRequest_.has_value()) return;

  PendingPermissionRequest req = *currentActivePermissionRequest_;
  currentActivePermissionRequest_.reset();

  if (permissionBubble_) {
    permissionBubble_->hide();
  }

  const bool viewValid = (!req.view.isNull() && !req.page.isNull() && req.permission.isValid());
  const bool tabValid = (findIndexByTabId(req.tabId) != -1);
  const QString currentCanon = (viewValid) ? BrowserProfileService::canonicalOrigin(req.view->url()) : QString{};
  const bool originMatches = (currentCanon == req.canonicalOrigin);

  if (!viewValid || !tabValid || !originMatches) {
    if (req.permission.isValid()) {
      req.permission.deny();
    }
    processNextPermissionRequest();
    return;
  }

  const QString permKey = BrowserProfileService::permissionKeyFromType(req.type);

  switch (choice) {
    case SitePermissionChoice::AllowThisVisit: {
      tabSessionGrants_.insert(TabSessionPermissionKey{req.tabId, req.canonicalOrigin, permKey});
      if (req.type == QWebEnginePermission::PermissionType::MediaAudioVideoCapture) {
        tabSessionGrants_.insert(TabSessionPermissionKey{req.tabId, req.canonicalOrigin, QStringLiteral("camera")});
        tabSessionGrants_.insert(TabSessionPermissionKey{req.tabId, req.canonicalOrigin, QStringLiteral("microphone")});
      }
      req.permission.grant();
      break;
    }
    case SitePermissionChoice::AlwaysAllow: {
      req.permission.grant();
      if (services_.profileService && !permKey.isEmpty()) {
        services_.profileService->addSitePermissionRule(permKey, req.canonicalOrigin, true);
        if (req.type == QWebEnginePermission::PermissionType::MediaAudioVideoCapture) {
          services_.profileService->addSitePermissionRule(QStringLiteral("camera"), req.canonicalOrigin, true);
          services_.profileService->addSitePermissionRule(QStringLiteral("microphone"), req.canonicalOrigin, true);
        }
      }
      break;
    }
    case SitePermissionChoice::Block: {
      req.permission.deny();
      if (services_.profileService && !permKey.isEmpty()) {
        services_.profileService->addSitePermissionRule(permKey, req.canonicalOrigin, false);
        if (req.type == QWebEnginePermission::PermissionType::MediaAudioVideoCapture) {
          services_.profileService->addSitePermissionRule(QStringLiteral("camera"), req.canonicalOrigin, false);
          services_.profileService->addSitePermissionRule(QStringLiteral("microphone"), req.canonicalOrigin, false);
        }
      }
      break;
    }
    case SitePermissionChoice::Dismissed: {
      req.permission.deny();
      break;
    }
  }

  if (siteControlsBubble_ && siteControlsBubble_->isVisible()) {
    siteControlsBubble_->refreshPermissions();
  }

  processNextPermissionRequest();
}

void BrowserWindow::dismissActivePermissionPrompt(bool cancelRequest) {
  if (!currentActivePermissionRequest_.has_value()) return;
  auto req = *currentActivePermissionRequest_;
  currentActivePermissionRequest_.reset();
  if (permissionBubble_) {
    permissionBubble_->hide();
  }
  if (cancelRequest && req.permission.isValid()) {
    req.permission.deny();
  }
  processNextPermissionRequest();
}
#endif

BrowserWindow *BrowserWindow::openNewWindow(const QUrl &url) {
  auto *window = new BrowserWindow(services_);
  if (url.isValid() && !url.isEmpty()) {
    window->addNewTab(url);
  } else {
    window->ensureInitialTab();
  }
  window->show();
  return window;
}

BrowserWindow *BrowserWindow::openIncognitoWindow(const QUrl &url) {
  auto incognitoServices = services_;
  const auto directory = std::make_shared<QTemporaryDir>();
  if (!directory->isValid()) return nullptr;
  auto privateOwner = std::shared_ptr<BrowserProfileService>(
      new BrowserProfileService(directory->path(), services_.policy, nullptr, true),
      [directory](BrowserProfileService *service) { delete service; });
  auto *privateService = privateOwner.get();
  if (services_.profileService) {
    privateService->setAdultContentProtectionEnabled(services_.profileService->isAdultContentProtectionEnabled());
  }
  incognitoServices.privateProfileOwner = privateOwner;
  incognitoServices.profileService = privateService;
  incognitoServices.profile = privateService->profile();
  incognitoServices.sessionStore = nullptr;
  incognitoServices.audioEffects = new WebAudioEffectsController(privateService, false);
  incognitoServices.songFinderSettings = new SongFinderSettings(privateService, false);
  incognitoServices.songRecognition = new SongRecognitionService(
      incognitoServices.songFinderSettings, privateService, false);
  const QString privateMediaHistory = QDir(directory->path()).filePath(
      QStringLiteral("media-download-history.json"));
  const QString downloadDirectory = services_.mediaDownload
      ? services_.mediaDownload->defaultDownloadDirectory()
      : privateService->profile()->downloadPath();
  incognitoServices.mediaDownload = new MediaDownloadService(
      downloadDirectory, privateService, {}, {}, privateMediaHistory);
  auto *window = new BrowserWindow(incognitoServices);

  window->setAttribute(Qt::WA_DeleteOnClose);
  window->setWindowTitle(QStringLiteral("Gizli Pencere — DaliNiraBrowser"));
  if (url.isValid() && !url.isEmpty()) {
    window->addNewTab(url);
  } else {
    window->ensureInitialTab();
  }
  window->show();
  return window;
}

void BrowserWindow::openDevToolsForPage(QWebEnginePage *page) {
  if (!page) return;
  auto *devWindow = new QMainWindow(this);
  devWindow->setAttribute(Qt::WA_DeleteOnClose);
  devWindow->setWindowTitle(QStringLiteral("Geliştirici Araçları (İncele) — DaliNiraBrowser"));
  devWindow->resize(960, 640);
  devWindow->setStyleSheet(QStringLiteral("QMainWindow { background: #121820; color: #e6edf3; }"));
  auto *devView = new QWebEngineView(devWindow);
  devWindow->setCentralWidget(devView);
  page->setDevToolsPage(devView->page());
  page->triggerAction(QWebEnginePage::InspectElement);
  connect(page, &QObject::destroyed, devWindow, &QWidget::close);
  devWindow->show();
  devWindow->raise();
  devWindow->activateWindow();
}

void BrowserWindow::toggleTabPin(int index) {
  if (index < 0 || index >= tabs_.size()) return;
  const bool willBePinned = !tabs_[index].isPinned;
  tabs_[index].isPinned = willBePinned;
  tabStrip_->setTabPinned(index, willBePinned);

  if (willBePinned) {
    int targetSlot = 0;
    for (int i = 0; i < tabs_.size(); ++i) {
      if (i != index && tabs_[i].isPinned) {
        targetSlot++;
      }
    }
    if (index != targetSlot) {
      tabStrip_->moveTab(index, targetSlot);
      switchTab(targetSlot);
    }
  } else {
    int firstUnpinnedSlot = 0;
    for (int i = 0; i < tabs_.size(); ++i) {
      if (i != index && tabs_[i].isPinned) {
        firstUnpinnedSlot++;
      }
    }
    if (index != firstUnpinnedSlot) {
      tabStrip_->moveTab(index, firstUnpinnedSlot);
      switchTab(firstUnpinnedSlot);
    }
  }
}

void BrowserWindow::closeOtherTabs(int index) {
  if (index < 0 || index >= tabs_.size()) return;
  const uint64_t keepId = tabs_[index].id;
  for (int i = tabs_.size() - 1; i >= 0; --i) {
    if (tabs_[i].id != keepId && !tabs_[i].isPinned) {
      closeTab(i);
    }
  }
}

void BrowserWindow::closeTabsToRight(int index) {
  if (index < 0 || index >= tabs_.size()) return;
  for (int i = tabs_.size() - 1; i > index; --i) {
    if (!tabs_[i].isPinned) {
      closeTab(i);
    }
  }
}


// Context menus extracted to browser_window_menus.cpp


void BrowserWindow::restoreLastClosedTab() {
  if (isIncognito() || !services_.profileService) return;
  const auto closed = services_.profileService->takeMostRecentClosedTab();
  if (!closed.has_value()) return;
  addNewTab(closed->url);
}


// Page actions (FindBar, Print, PDF, Capture, Reader Mode, Fullscreen) extracted to browser_window_page_actions.cpp
