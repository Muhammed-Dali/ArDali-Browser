#include <QEventLoopLocker>
#include <QTemporaryDir>
#include <QCompleter>
#include <QStandardItemModel>
#include <QAbstractItemView>
#include "core/search_suggestion_service.h"
#include "core/search_engine_definition.h"
#include "browser_window.h"
#include "i18n/i18n.h"
#include "i18n/language_manager.h"

using ardali::i18n::LanguageManager;
using ardali::i18n::I18n;

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
#include "newtab/new_tab_html.h"
#include "newtab/new_tab_scheme.h"
#include "blocker/ardali_blocker_service.h"
#include "passwords/credential_vault_manager.h"
#include "passwords/credential_autofill_controller.h"
#include "pulse/song_finder_settings_page.h"
#include "downloads/download_toolbar_ui.h"
#include "downloads/download_ui_model.h"
#include "translate/translate_service.h"
#include <QShortcut>

namespace {
static std::atomic<uint64_t> s_tabIdSequence{1};

bool isNewTabUrl(const QUrl &url) {
  const QString scheme = url.scheme().toLower();
  const QString host = url.host().toLower();
  return scheme == QLatin1String("ardali") &&
      (host == QLatin1String("newtab") || host == QLatin1String("incognito")) &&
      (url.path().isEmpty() || url.path() == QLatin1String("/")) &&
      !url.hasQuery() && !url.hasFragment() && url.userInfo().isEmpty() && url.port() == -1;
}

QString navigationUrlKey(const QUrl &url) {
  if (!url.isValid()) return {};
  return url.adjusted(QUrl::NormalizePathSegments | QUrl::RemoveFragment | QUrl::StripTrailingSlash)
      .toString(QUrl::FullyEncoded);
}

bool isInternalOrNonWebUrl(const QUrl &url) {
  if (!url.isValid() || url.isEmpty()) return true;
  const QString scheme = url.scheme().toLower();
  if (scheme == QLatin1String("ardali") ||
      scheme == QLatin1String("about") ||
      scheme == QLatin1String("data") ||
      scheme == QLatin1String("file") ||
      scheme == QLatin1String("chrome") ||
      scheme == QLatin1String("edge")) {
    return true;
  }
  return isNewTabUrl(url);
}

QUrl searchUrlForEngine(const QString &engine, const QString &queryText) {
  return ardali::core::AddressInputResolver::searchUrlForEngine(engine, queryText);
}

QString bookmarkDisplayName(const QUrl &url) {
  const QString host = url.host().toLower();
  if (host.endsWith(QStringLiteral("youtube.com"))) return QStringLiteral("YouTube");
  if (host.endsWith(QStringLiteral("github.com"))) return QStringLiteral("GitHub");
  if (host.endsWith(QStringLiteral("wikipedia.org"))) return QStringLiteral("Wikipedia");
  if (host.endsWith(QStringLiteral("google.com"))) return QStringLiteral("Google");
  if (host.endsWith(QStringLiteral("duckduckgo.com"))) return QStringLiteral("DuckDuckGo");
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
    if (message.startsWith(QLatin1String("__ARDALI_MEDIA_CAPTURE__:"))) {
      const bool v = message.contains(QLatin1String("V1"));
      const bool a = message.contains(QLatin1String("A1"));
      if (onMediaCaptureChanged_) onMediaCaptureChanged_(v, a);
      return;
    }
    if (message.startsWith(QLatin1String("__ARDALI_ADBLOCK_HIT__:"))) {
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
          blocker->reportBlockedEvent(tabId, ArDaliBlockType::Cosmetic, count, subType);
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
    if (url.scheme() == QLatin1String("ardali") && url.host() == QLatin1String("suggest")) {
      const QUrlQuery params(url);
      const QString capability = property("ardali-suggest-capability").toString();
      auto *view = qobject_cast<QWebEngineView *>(parent());
      auto *window = view ? qobject_cast<BrowserWindow *>(view->window()) : nullptr;
      if (!isMainFrame || !isNewTabUrl(this->url()) || capability.isEmpty() ||
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
      }
      return false;
    }
    if (url.scheme() == QLatin1String("ardali") && url.host() == QLatin1String("search-engine")) {
      const QString engine = QUrlQuery(url).queryItemValue(QStringLiteral("engine"));
      const bool allowed = QStringList{QStringLiteral("Google"), QStringLiteral("DuckDuckGo"),
          QStringLiteral("Brave Search"), QStringLiteral("Bing")}.contains(engine);
      const QPointer<QWebEngineView> view(qobject_cast<QWebEngineView *>(parent()));
      const QString capability = property("ardali-suggest-capability").toString();
      if (isMainFrame && isNewTabUrl(this->url()) && allowed && view && !capability.isEmpty() &&
          QUrlQuery(url).queryItemValue(QStringLiteral("cap")) == capability) {
        QMetaObject::invokeMethod(view, [view, engine] {
          if (!view || !isNewTabUrl(view->url())) return;
          if (auto *window = qobject_cast<BrowserWindow *>(view->window())) window->setSearchEngine(engine);
        }, Qt::QueuedConnection);
      }
      return false;
    }
    if (isMainFrame && url.scheme().compare(QLatin1String("ardali"), Qt::CaseInsensitive) == 0 &&
        url.host().compare(QLatin1String("navigate"), Qt::CaseInsensitive) == 0) {
      // 1. Strict origin validation: Only ardali://newtab or ardali://newtab/ is permitted
      const QUrl sourceUrl = this->url();
      const QString capability = property("ardali-suggest-capability").toString();
      const bool trustedSource = isNewTabUrl(sourceUrl) && !capability.isEmpty() &&
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
      } else if (rawEngine.compare(QLatin1String("Brave Search"), Qt::CaseInsensitive) == 0 ||
                 rawEngine.compare(QLatin1String("Brave"), Qt::CaseInsensitive) == 0) {
        validatedEngine = QStringLiteral("Brave Search");
      } else if (rawEngine.compare(QLatin1String("Bing"), Qt::CaseInsensitive) == 0) {
        validatedEngine = QStringLiteral("Bing");
      } else if (window_) {
        validatedEngine = window_->currentSearchEngine();
      } else {
        validatedEngine = QStringLiteral("Google");
      }

      // Revalidate the current native owner at execution time (tabs may move).
      const QPointer<QWebEngineView> view(qobject_cast<QWebEngineView *>(parent()));
      if (view) {
        QMetaObject::invokeMethod(view, [view, rawQuery, validatedEngine, capability] {
          if (!view || !isNewTabUrl(view->url()) ||
              view->page()->property("ardali-suggest-capability").toString() != capability) return;
          auto *window = qobject_cast<BrowserWindow *>(view->window());
          if (window && window->currentView() == view && view->page()->profile() == window->services().profile)
            window->navigateFromUserInput(rawQuery, validatedEngine);
        }, Qt::QueuedConnection);
      }
      return false;
    }
    if (isMainFrame && (url.scheme() == QLatin1String("http") || url.scheme() == QLatin1String("https"))) {
      if (auto *view = qobject_cast<QWebEngineView *>(parent())) {
        if (auto *window = qobject_cast<BrowserWindow *>(view->window())) {
          if (profile() == window->services().profile) window->prepareAdBlockScripts(this, url);
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
  if (window.__ardaliMediaHookInstalled) return;
  window.__ardaliMediaHookInstalled = true;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
  var origGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  var activeVideoTracks = 0;
  var activeAudioTracks = 0;
  function updateCapture() {
    console.debug('__ARDALI_MEDIA_CAPTURE__:V' + (activeVideoTracks > 0 ? '1' : '0') + 'A' + (activeAudioTracks > 0 ? '1' : '0'));
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
    script.setName(QStringLiteral("ardali-media-capture-hook"));
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
      : QWebEngineView(parent), window_(window) {}

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

    const QString engine = window_ ? window_->currentSearchEngine() : QStringLiteral("Google");
    const QString truncated = selectedText.length() > 24 ? selectedText.left(21) + QStringLiteral("...") : selectedText;
    QAction *searchAct = menu.addAction(BrowserIcons::icon(BrowserIcon::Search),
                                        I18n::text(QStringLiteral("context.search_for"), QStringLiteral("%1 ile \"%2\" ara")).arg(engine, truncated));
    QObject::connect(searchAct, &QAction::triggered, [this, selectedText] {
      if (window_) {
        int nextSlot = window_->tabStrip() ? window_->tabStrip()->currentIndex() + 1 : -1;
        window_->addNewTab(QUrl(QStringLiteral("ardali://newtab/")), nextSlot);
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
    printAct->setEnabled(false);

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
  setProperty("ardaliRestoredSize", lastNormalSize_);

  if (!services_.profile) {
    services_.profile = QWebEngineProfile::defaultProfile();
  }

  auto composite = std::make_unique<ardali::core::CompositeNavigationCandidateProvider>(this);
  composite->addProvider(std::make_shared<ardali::core::BookmarkCandidateProvider>(services_.profileService, services_.profileService, composite.get()));
  composite->addProvider(std::make_shared<ardali::core::FrequentSitesCandidateProvider>(services_.profileService, services_.profileService, composite.get()));
  composite->addProvider(std::make_shared<ardali::core::HistoryCandidateProvider>(services_.profileService, services_.profileService, composite.get()));
  composite->addProvider(std::make_shared<ardali::core::BootstrapWellKnownSiteProvider>());
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
  }

  connect(&TabThrobber::instance(), &TabThrobber::throbberTick, this, &BrowserWindow::onThrobberTick);

  // Register in global registry for tab drag & attach
  ardali::desktop_tabs::TabWindowRegistry::instance().registerWindow(this, tabStrip_);

  if (services_.privateProfileOwner) {
    // Keep the shared private profile alive until this window's page children
    // have been destroyed, including when its tabs move to another window.
    auto *lifetime = new QObject(this);
    connect(lifetime, &QObject::destroyed, [owner = services_.privateProfileOwner] {});
  }
  if (isCaptureShell_) {
    setProperty("ardaliDragCaptureShell", true);
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
  ardali::desktop_tabs::TabWindowRegistry::instance().unregisterWindow(this);
}

void BrowserWindow::setupUi() {
  using Metrics = ardali::ui::BrowserChromeMetrics;

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

  // Tab Strip (Chromium TabStripWidget)
  tabStrip_ = new ardali::desktop_tabs::TabStripWidget(topBar_);
  tabStrip_->setObjectName(QStringLiteral("tabStrip"));
  tabStrip_->setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Fixed);
  groupModel_ = new ardali::desktop_tabs::TabGroupModel(this);
  tabStrip_->setGroupModel(groupModel_);
  connect(tabStrip_, &ardali::desktop_tabs::TabStripWidget::groupChipClicked,
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
  backBtn_->setText(QString::fromUtf8("←"));
  backBtn_->setToolTip(QStringLiteral("Geri (Alt+Sol)"));
  backBtn_->setEnabled(false);
  configureNavigationButton(backBtn_);
  navLayout->addWidget(backBtn_);

  forwardBtn_ = new QToolButton(navBar_);
  forwardBtn_->setObjectName(QStringLiteral("forwardBtn"));
  forwardBtn_->setText(QString::fromUtf8("→"));
  forwardBtn_->setToolTip(QStringLiteral("İleri (Alt+Sağ)"));
  forwardBtn_->setEnabled(false);
  configureNavigationButton(forwardBtn_);
  navLayout->addWidget(forwardBtn_);

  reloadBtn_ = new QToolButton(navBar_);
  reloadBtn_->setObjectName(QStringLiteral("reloadBtn"));
  reloadBtn_->setText(QString::fromUtf8("↻"));
  reloadBtn_->setToolTip(QStringLiteral("Yenile (Ctrl+R)"));
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
  adBlockShield_ = new ArDaliBlockerShieldButton(adblock, navBar_);
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

  // Seed default bookmarks if empty on startup
  if (services_.profileService && services_.profileService->bookmarks().isEmpty()) {
    services_.profileService->toggleBookmark(QUrl(QStringLiteral("https://github.com/")));
    services_.profileService->toggleBookmark(QUrl(QStringLiteral("https://www.youtube.com/")));
    services_.profileService->toggleBookmark(QUrl(QStringLiteral("https://www.facebook.com/")));
    services_.profileService->toggleBookmark(QUrl(QStringLiteral("https://www.instagram.com/")));
  }
  renderBookmarks();
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
  omnibox_->setCompleter(suggestionCompleter_);
  connect(suggestionCompleter_, qOverload<const QModelIndex &>(&QCompleter::activated), this,
          [this](const QModelIndex &index) { activateSuggestion(index.data(Qt::UserRole + 1).toUrl()); });
  connect(omnibox_, &QLineEdit::textEdited, this, &BrowserWindow::updateOmniboxSuggestions);
  connect(omnibox_, &QLineEdit::returnPressed, this, &BrowserWindow::onOmniboxReturnPressed);

  // Connect feature buttons
  connect(adBlockShield_, &ArDaliBlockerShieldButton::openSettingsRequested, this, [this] {
    showArDaliBlockerSettings(ArDaliBlockerPage::Tab::Settings);
  });
  connect(adBlockShield_, &ArDaliBlockerShieldButton::openRulesetsRequested, this, [this] {
    showArDaliBlockerSettings(ArDaliBlockerPage::Tab::Rulesets);
  });
  connect(adBlockShield_, &ArDaliBlockerShieldButton::openLoggerRequested, this, [this] {
    showArDaliBlockerSettings(ArDaliBlockerPage::Tab::Logger);
  });
  connect(adBlockShield_, &ArDaliBlockerShieldButton::reloadRequested, this, [this] {
    if (auto *view = currentView()) {
      prepareAdBlockScripts(view->page(), view->url(), true);
      view->reload();
    }
  });
  if (adblock) {
    connect(adblock->settings(), &ArDaliBlockerSettings::settingsChanged, this, [this] {
      for (const auto &tab : std::as_const(tabs_)) {
        if (tab.view && (tab.view->url().scheme() == QLatin1String("http") || tab.view->url().scheme() == QLatin1String("https")))
          prepareAdBlockScripts(tab.view->page(), tab.view->url(), true);
      }
    });
    connect(adblock, &ArDaliBlockerService::tabStatsChanged, this, [this](quint64 tabId, const TabBlockerStats &stats) {
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
                ? QStringLiteral("ArDali Koruma: %1 (%2 öğe engellendi)").arg(view->url().host()).arg(total)
                : QStringLiteral("ArDali Koruma: %1 (Etkin)").arg(view->url().host()));
          }
        }
      }
    });
    connect(adblock, &ArDaliBlockerService::autoReloadRequested, this, [this] {
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

  connect(mediaDownload_, &QToolButton::clicked, this, [this] {
    if (!downloadPopup_) return;
    if (downloadPopup_->isVisible()) {
      downloadPopup_->hide();
    } else {
      const QUrl activeUrl = (currentView() && !isNewTabUrl(currentView()->url()) && currentView()->url().scheme() != QLatin1String("ardali"))
          ? currentView()->url() : lastActiveWebUrl_;
      const bool pageHasMedia = currentView() && currentView()->page() && currentView()->page()->recentlyAudible();
      if (!activeUrl.isEmpty() && MediaPlatformRegistry::shouldAutoAnalyzeMedia(activeUrl, pageHasMedia)) {
        downloadPopup_->setSuggestedMedia(activeUrl, currentView() ? currentView()->title() : QString{});
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
  connect(tabStrip_, &ardali::desktop_tabs::TabStripWidget::newTabRequested, this, [this] {
    addNewTab(QUrl(QStringLiteral("ardali://newtab/")));
  });

  connect(tabStrip_, &ardali::desktop_tabs::TabStripWidget::tabCloseRequested, this, [this](int index) {
    closeTab(index);
  });

  connect(tabStrip_, &ardali::desktop_tabs::TabStripWidget::currentChanged, this, [this](int index) {
    switchTab(index);
  });

  connect(tabStrip_, &ardali::desktop_tabs::TabStripWidget::tabMoved, this, [this](int from, int to) {
    moveTab(from, to);
  });

  connect(tabStrip_, &ardali::desktop_tabs::TabStripWidget::tabHovered, this,
          &BrowserWindow::onTabHovered);

  connect(tabStrip_, &ardali::desktop_tabs::TabStripWidget::tabHoverLeave, this,
          &BrowserWindow::onTabHoverLeave);

  connect(tabStrip_, &ardali::desktop_tabs::TabStripWidget::dragInitiated, this,
          [this](int index, const QPoint &screenPosition, const QPoint &pressOffsetInTab, const QSize &) {
    if (hoverCard_) hoverCard_->hideCard();
    if (index < 0 || index >= tabs_.size()) return;
    const QPoint offsetInWindow = mapFromGlobal(screenPosition);
    ardali::desktop_tabs::TabDragController::instance().handleMousePress(
        this, tabStrip_, index, screenPosition, pressOffsetInTab, offsetInWindow);
  });

  connect(tabStrip_, &ardali::desktop_tabs::TabStripWidget::tabContextMenuRequested,
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
    reloadBtn_->setToolTip(I18n::text(QStringLiteral("toolbar.reload"), QStringLiteral("Yenile (Ctrl+R)")));
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
  if (!force && page->property("ardali-adblock-script-plan").toString() == planKey) return;
  page->setProperty("ardali-adblock-script-plan", planKey);
  const bool refreshDocument = force || page->url() == url;

  static const QStringList names = {
      QStringLiteral("ardali-adblock-cosmetic"),
      QStringLiteral("ardali-adblock-scriptlets-main"),
      QStringLiteral("ardali-adblock-scriptlets-isolated"),
      QStringLiteral("ardali-adblock-procedural"),
      QStringLiteral("ardali-adblock-youtube-guardian"),
      QStringLiteral("ardali-fingerprint-protection"),
      QStringLiteral("ardali-forget-site-storage")};
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
  if (refreshDocument) page->runJavaScript(QStringLiteral("if(window.__ardaliCosmeticRuntime){window.__ardaliCosmeticRuntime.pause();}window.__ardaliProceduralRules=0;"), QWebEngineScript::ApplicationWorld);
  for (const QWebEngineScript &script :
       services_.profileService->adBlockService()->createScriptingScriptsForHost(url.host().toLower())) {
    page->scripts().insert(script);
    if (refreshDocument && (script.name() == QLatin1String("ardali-adblock-cosmetic") || script.name() == QLatin1String("ardali-adblock-procedural")))
      page->runJavaScript(script.sourceCode(), script.worldId());
  }
}

int BrowserWindow::addNewTab(const QUrl &url, int insertIndex) {
  QUrl targetUrl = url;
  if (targetUrl.isEmpty()) {
    targetUrl = QUrl(QStringLiteral("ardali://newtab/"));
  }

  // Handle internal scheme navigations directly
  const QString scheme = targetUrl.scheme().toLower();
  const QString host = targetUrl.host().toLower();
  if (scheme == QLatin1String("ardali") && host != QLatin1String("newtab")) {
    if (host == QLatin1String("settings")) { showSettings(); return tabStrip_->currentIndex(); }
    if (host == QLatin1String("passwords")) { showPasswords(); return tabStrip_->currentIndex(); }
    if (host == QLatin1String("audio-effects")) { showAudioEffects(); return tabStrip_->currentIndex(); }
    if (host == QLatin1String("eq-presets")) { showEqPresetBrowser(); return tabStrip_->currentIndex(); }
    if (host == QLatin1String("blocker")) { showArDaliBlockerSettings(); return tabStrip_->currentIndex(); }
    if (host == QLatin1String("downloads")) { showMediaDownloads(); return tabStrip_->currentIndex(); }
    if (host == QLatin1String("listen") || host == QLatin1String("pulse")) { showSongFinder(); return tabStrip_->currentIndex(); }
    if (host == QLatin1String("listen-settings")) { showSongFinderSettings(); return tabStrip_->currentIndex(); }
  }

  auto *view = new BrowserWebView(this, pageStack_);
  auto *page = new BrowserWebPage(services_.profile ? services_.profile : QWebEngineProfile::defaultProfile(), this, view);
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
  info.title = isIncognito() ? QStringLiteral("Yeni Gizli Sekme") : QStringLiteral("Yeni Sekme");
  info.url = targetUrl;
  info.view = view;
  info.isInternal = false;
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
  dismissSiteControlsBubble();
  dismissCredentialSaveBubble();
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
  dismissSiteControlsBubble();
  dismissCredentialSaveBubble();
  if (hoverCard_) hoverCard_->hideCard();
  if (index < 0 || index >= tabs_.size()) return;

  tabStrip_->setCurrentIndex(index);
  auto &info = tabs_[index];

  if (info.view) {
    pageStack_->setCurrentWidget(info.view);
    updateOmniboxForCurrentTab();
    updateNavButtons();
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
    omnibox_->setText(QStringLiteral("ardali://") + info.internalId);
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

  if (services_.tabManager && !info.uuid.isNull()) {
    services_.tabManager->activate(info.uuid);
  }
}

void BrowserWindow::moveTab(int fromIndex, int toIndex) {
  if (hoverCard_) hoverCard_->hideCard();
  if (fromIndex < 0 || fromIndex >= tabs_.size() ||
      toIndex < 0 || toIndex >= tabs_.size() || fromIndex == toIndex) {
    return;
  }
  tabs_.move(fromIndex, toIndex);
}

bool BrowserWindow::transferTabTo(uint64_t tabId, BrowserWindow *destination, int targetIndex) {
  if (!destination || destination == this || destination->services_.profile != services_.profile) return false;

  int sourceIndex = findIndexByTabId(tabId);
  if (sourceIndex < 0) {
    const auto &session = ardali::desktop_tabs::TabDragController::instance().session();
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
      if (!isNewTabUrl(url) && url.scheme() != QLatin1String("ardali") && url.isValid()) {
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
    }
  });

  connect(view, &QWebEngineView::loadProgress, this, [this, tabId](int progress) {
    const int idx = findIndexByTabId(tabId);
    if (idx == tabStrip_->currentIndex()) {
      if (progress < 100) {
        progressBar_->setValue(progress);
        progressBar_->show();
        reloadBtn_->setText(QString::fromUtf8("✕"));
        reloadBtn_->setToolTip(QStringLiteral("Durdur (Esc)"));
      } else {
        progressBar_->hide();
        reloadBtn_->setText(QString::fromUtf8("⟳"));
        reloadBtn_->setToolTip(QStringLiteral("Yenile (F5 / Ctrl+R)"));
      }
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
        view->page()->setProperty("ardali-suggest-capability", capability);
        const QString json = QString::fromUtf8(QJsonDocument(QJsonArray{capability}).toJson(QJsonDocument::Compact));
        view->page()->runJavaScript(QStringLiteral("if(window.ardaliSuggestionBridge)window.ardaliSuggestionBridge(%1[0]);").arg(json));
      }
      syncNewTabViews();
      updateSearchEngineIcon();
      if (autofillController_) {
        autofillController_->onPageLoadFinished(view, success);
      }
    }
  });
}

void BrowserWindow::syncNewTabViews() {
  if (!services_.profileService) return;
  const QString script = newTabTopSitesUpdateScript(
      collectNewTabFrequentSites(services_.profileService),
      collectNewTabBookmarks(services_.profileService));
  for (const BrowserTabInfo &tab : std::as_const(tabs_)) {
    if (!tab.view || !isNewTabUrl(tab.view->url())) continue;
    tab.view->page()->runJavaScript(script);
    const bool enabled = services_.profileService->searchSuggestions()->isEnabled() && !tab.view->page()->profile()->isOffTheRecord();
    tab.view->page()->runJavaScript(QStringLiteral("if(window.ardaliSuggestionConsent)window.ardaliSuggestionConsent(%1,%2);")
        .arg(enabled ? QStringLiteral("true") : QStringLiteral("false"), tab.view->page()->profile()->isOffTheRecord() ? QStringLiteral("false") : QStringLiteral("true")));
  }
}

void BrowserWindow::onOmniboxReturnPressed() {
  if (suggestionActivated_) return;
  const auto index = suggestionCompleter_->popup()->currentIndex();
  if (suggestionCompleter_->popup()->isVisible() && index.isValid()) {
    activateSuggestion(index.data(Qt::UserRole + 1).toUrl());
    return;
  }
  navigateFromUserInput(omnibox_->text());
}

void BrowserWindow::navigateFromUserInput(const QString &rawInput, const QString &searchEngine) {
  const QString input = rawInput.trimmed();
  if (input.isEmpty()) return;

  // Prevent recursion or loop if ardali://navigate is passed
  if (input.startsWith(QStringLiteral("ardali://navigate"), Qt::CaseInsensitive)) {
    return;
  }

  // Check for internal ardali:// schemes
  if (input.startsWith(QStringLiteral("ardali://"), Qt::CaseInsensitive)) {
    const QUrl internalUrl(input);
    const QString host = internalUrl.host().toLower();
    if (host == QLatin1String("settings")) { showSettings(); return; }
    if (host == QLatin1String("passwords")) { showPasswords(); return; }
    if (host == QLatin1String("audio-effects")) { showAudioEffects(); return; }
    if (host == QLatin1String("eq-presets")) { showEqPresetBrowser(); return; }
    if (host == QLatin1String("blocker")) { showArDaliBlockerSettings(); return; }
    if (host == QLatin1String("downloads")) { showMediaDownloads(); return; }
    if (host == QLatin1String("listen") || host == QLatin1String("pulse")) { showSongFinder(); return; }
    if (host == QLatin1String("listen-settings")) { showSongFinderSettings(); return; }
    if (host == QLatin1String("newtab")) {
      if (auto *view = currentView()) {
        view->load(QUrl(QStringLiteral("ardali://newtab/")));
      } else {
        addNewTab(QUrl(QStringLiteral("ardali://newtab/")));
      }
      return;
    }
  }

  const QString engine = searchEngine.isEmpty() ? currentSearchEngine() : searchEngine;
  const auto resolution = ardali::core::AddressInputResolver::resolve(
      input, engine, QLocale::system(), candidateProvider_.get());
  const QUrl url = resolution.url;
  if (!url.isValid() || url.isEmpty()) return;

  if (auto *view = currentView()) {
    const int idx = tabStrip_->currentIndex();
    if (idx >= 0 && idx < tabs_.size() && tabs_[idx].view == view) {
      tabs_[idx].expectedTypedUrl =
          resolution.classification == ardali::core::AddressInputClassification::Search ? QUrl{} : url;
      tabs_[idx].url = url;
      updateBookmarkBarVisibility();
    }
    prepareAdBlockScripts(view->page(), url);
    view->load(url);
  } else {
    const int idx = addNewTab(url);
    if (idx >= 0 && idx < tabs_.size() && !tabs_[idx].isInternal) {
      tabs_[idx].expectedTypedUrl =
          resolution.classification == ardali::core::AddressInputClassification::Search ? QUrl{} : url;
    }
  }
}

void BrowserWindow::onBackClicked() {
  if (auto *view = currentView()) {
    view->back();
  }
}

void BrowserWindow::onForwardClicked() {
  if (auto *view = currentView()) {
    view->forward();
  }
}

void BrowserWindow::onReloadOrStopClicked() {
  if (auto *view = currentView()) {
    if (progressBar_->isVisible()) {
      view->stop();
    } else {
      view->reload();
    }
  }
}

void BrowserWindow::onHomeClicked() {
  if (auto *view = currentView()) {
    view->load(QUrl(QStringLiteral("ardali://newtab/")));
  } else {
    addNewTab(QUrl(QStringLiteral("ardali://newtab/")));
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
                         view->url().scheme() != QLatin1String("ardali");
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
    const QUrl activeUrl = (currentView() && !isNewTabUrl(currentView()->url()) && currentView()->url().scheme() != QLatin1String("ardali"))
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
    ardali::desktop_tabs::TabWindowRegistry::instance().reloadTabAppearances();
  };
  hooks.performanceManager = [this] { return services_.tabManager ? services_.tabManager->performanceManager() : nullptr; };

  auto *page = new SettingsPage(services_.profileService, std::move(hooks));
  page->setCategory(category);
  connect(page, &SettingsPage::navigateRequested, this, [this](const QUrl &url) {
    if (url == QUrl(QStringLiteral("ardali://passwords"))) showPasswords();
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

void BrowserWindow::showArDaliBlockerSettings(ArDaliBlockerPage::Tab tab) {
  if (!services_.profileService || !services_.profileService->adBlockService()) return;
  if (services_.tabManager) {
    const auto existingId = services_.tabManager->findInternal(this, QStringLiteral("blocker"));
    if (!existingId.isNull()) {
      const auto *record = services_.tabManager->record(existingId);
      if (record && record->content) {
        const int idx = pageStack_->indexOf(record->content);
        if (idx >= 0) {
          if (auto *page = qobject_cast<ArDaliBlockerPage *>(record->content.data())) page->setActiveTab(tab);
          switchTab(idx);
          return;
        }
      }
    }
  }
  auto *page = new ArDaliBlockerPage(services_.profileService->adBlockService());
  page->setActiveTab(tab);
  addInternalTab(page, QStringLiteral("ArDali Blocker"), QIcon(QStringLiteral(":/side-widget-icons/deliblock.svg")), QStringLiteral("blocker"));
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
  addInternalTab(page, QStringLiteral("ArDali Pulse"), QIcon(QStringLiteral(":/side-widget-icons/pulse.svg")), QStringLiteral("song-finder"));
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
    const QUrl activeUrl = (currentView() && !isNewTabUrl(currentView()->url()) && currentView()->url().scheme() != QLatin1String("ardali"))
        ? currentView()->url() : lastActiveWebUrl_;
    const bool pageHasMedia = currentView() && currentView()->page() && currentView()->page()->recentlyAudible();
    if (!activeUrl.isEmpty() && MediaPlatformRegistry::shouldAutoAnalyzeMedia(activeUrl, pageHasMedia)) {
      targetUrl = activeUrl;
      shouldAnalyze = true;
    }
  } else {
    shouldAnalyze = analyzeImmediately || MediaPlatformRegistry::shouldAutoAnalyzeMedia(targetUrl, false);
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
  if (!targetUrl.isEmpty()) {
    page->setSourceUrl(targetUrl, shouldAnalyze);
  }
  addInternalTab(page, QStringLiteral("İndirmeler"), BrowserIcons::icon(BrowserIcon::Download), QStringLiteral("downloads"));
}

void BrowserWindow::showTranslatePopup() {
  auto *view = currentView();
  if (!view) return;
  if (!translateBubble_) {
    translateBubble_ = new TranslateBubblePopup(this);
  }
  if (!pageTranslator_ && services_.profileService) {
    pageTranslator_ = new PageTranslator(view, services_.profileService->translateService(), this);
  }
  translateBubble_->setTranslator(pageTranslator_);
  translateBubble_->showAtAnchor(translateButton_->mapToGlobal(QPoint(0, translateButton_->height())));
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
  for (const auto &tab : savedTabs) {
    const int idx = addNewTab(tab.url);
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
  if (tabs_.isEmpty()) {
    ensureInitialTab();
  }
  if (tabStrip_) {
    tabStrip_->update();
  }
}

void BrowserWindow::ensureInitialTab() {
  if (tabs_.isEmpty()) {
    addNewTab(QUrl(QStringLiteral("ardali://newtab/")));
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
  saveSessionNow();
  ardali::desktop_tabs::TabWindowRegistry::instance().unregisterWindow(this);
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
  if (event->modifiers() & Qt::ControlModifier) {
    if (event->key() == Qt::Key_T) {
      addNewTab(QUrl(QStringLiteral("ardali://newtab/")));
      event->accept();
      return;
    }
    if (event->key() == Qt::Key_W) {
      closeTab(tabStrip_->currentIndex());
      event->accept();
      return;
    }
    if (event->key() == Qt::Key_R) {
      onReloadOrStopClicked();
      event->accept();
      return;
    }
    if (event->key() == Qt::Key_L) {
      omnibox_->setFocus();
      omnibox_->selectAll();
      event->accept();
      return;
    }
  }
  if (event->key() == Qt::Key_F5) {
    onReloadOrStopClicked();
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
    dismissCredentialSaveBubble();
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
    dismissCredentialSaveBubble();
  }
  QMainWindow::changeEvent(event);
}

void BrowserWindow::resizeEvent(QResizeEvent *event) {
  if (hoverCard_) hoverCard_->hideCard();
  QMainWindow::resizeEvent(event);
  updatePermissionBubblePosition();
  updateSiteControlsBubblePosition();
  updateSaveBubblePosition();
  if (downloadPopup_ && downloadPopup_->isVisible()) downloadPopup_->reposition(mediaDownload_);
  if (!isMaximized() && !isFullScreen() && !(windowState() & (Qt::WindowMaximized | Qt::WindowFullScreen))) {
    lastNormalSize_ = size();
    lastNormalGeometry_ = geometry();
    setProperty("ardaliRestoredSize", lastNormalSize_);
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
    setProperty("ardaliRestoredSize", lastNormalSize_);
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
      property("ardaliDragCaptureShell").toBool() ||
      ardali::desktop_tabs::TabDragController::instance().isActive()) {
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
  if (!property("ardaliDragCaptureShell").toBool() &&
      !ardali::desktop_tabs::TabDragController::instance().isActive()) {
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
  const bool isNewTab = (info.view && (isNewTabUrl(info.view->url()) || info.view->property("ardali-is-newtab-intent").toBool()))
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
    adBlockShield_->setToolTip(I18n::text(QStringLiteral("toolbar.adblock"), QStringLiteral("ArDali Koruma (Reklam Engelleyici)")));
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
        ? I18n::text(QStringLiteral("toolbar.adblock_status"), QStringLiteral("ArDali Koruma: %1")).arg(host) + QStringLiteral(" (") + I18n::text(QStringLiteral("toolbar.adblock_blocked_count"), QStringLiteral("%1 öğe engellendi")).arg(total) + QStringLiteral(")")
        : I18n::text(QStringLiteral("toolbar.adblock_status"), QStringLiteral("ArDali Koruma: %1")).arg(host));
  } else {
    adBlockShield_->setBlockedCount(0);
    adBlockShield_->setToolTip(I18n::text(QStringLiteral("toolbar.adblock_status"), QStringLiteral("ArDali Koruma: %1")).arg(host));
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
  using Metrics = ardali::ui::BrowserChromeMetrics;
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

  // 2. Bookmark items with icon, site name, and a directly accessible remove button.
  for (const QUrl &url : services_.profileService->bookmarks()) {
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
      services_.profileService->toggleBookmark(url);
      updateBookmarkButtonState();
    });
  }
}

bool BrowserWindow::isCurrentTabNewTab() const {
  if (tabs_.isEmpty()) return false;
  const int idx = tabStrip_ ? tabStrip_->currentIndex() : -1;
  if (idx < 0 || idx >= tabs_.size()) return false;
  const auto &info = tabs_[idx];
  if (info.isInternal) return false;

  if (info.view) {
    const QUrl viewUrl = info.view->url();
    if (!viewUrl.isEmpty() && viewUrl.toString() != QLatin1String("about:blank")) {
      return isNewTabUrl(viewUrl);
    }
  }
  return isNewTabUrl(info.url) || info.url.isEmpty();
}

void BrowserWindow::updateBookmarkBarVisibility() {
  if (!bookmarkBar_) return;

  const QString mode = QSettings().value(
      QStringLiteral("browser/bookmarkBarVisibility"),
      QStringLiteral("new_tab")).toString();

  bool shouldBeVisible = false;
  if (mode == QLatin1String("always")) {
    shouldBeVisible = true;
  } else if (mode == QLatin1String("never")) {
    shouldBeVisible = false;
  } else { // "new_tab" (default, Brave style)
    shouldBeVisible = isCurrentTabNewTab();
  }

  if (bookmarkBar_->isVisible() != shouldBeVisible) {
    bookmarkBar_->setVisible(shouldBeVisible);
  }
}

void BrowserWindow::toggleBookmarkBar() {
  QSettings settings;
  const QString currentMode = settings.value(
      QStringLiteral("browser/bookmarkBarVisibility"),
      QStringLiteral("new_tab")).toString();

  QString newMode;
  if (currentMode == QLatin1String("always")) {
    newMode = QStringLiteral("new_tab");
  } else {
    newMode = QStringLiteral("always");
  }

  settings.setValue(QStringLiteral("browser/bookmarkBarVisibility"), newMode);
  settings.sync();
  updateBookmarkBarVisibility();
}

void BrowserWindow::showMainMenu() {
  QMenu menu(this);
  menu.setStyleSheet(QStringLiteral("QMenu{background:#1b232d;color:#e8eef5;border:1px solid #3a4857;border-radius:9px;padding:6px;} QMenu::item{min-height:25px;padding:5px 30px 5px 30px;border-radius:6px;} QMenu::item:selected{background:#2b3947;} QMenu::item:disabled{color:#6f7b87;} QMenu::separator{height:1px;background:#33404d;margin:6px 8px;} QMenu::icon{padding-left:7px;}"));

  QAction *newTab = menu.addAction(BrowserIcons::icon(BrowserIcon::NewTab), I18n::text(QStringLiteral("menu.new_tab"), QStringLiteral("Yeni sekme")));
  newTab->setShortcut(QKeySequence(Qt::CTRL | Qt::Key_T));
  QAction *newWindow = menu.addAction(BrowserIcons::icon(BrowserIcon::Window), I18n::text(QStringLiteral("menu.new_window"), QStringLiteral("Yeni pencere")));
  newWindow->setShortcut(QKeySequence(Qt::CTRL | Qt::Key_N));
  QAction *incognito = menu.addAction(BrowserIcons::icon(BrowserIcon::Incognito), I18n::text(QStringLiteral("menu.new_incognito_window"), QStringLiteral("Yeni gizli pencere")));
  incognito->setShortcut(QKeySequence(Qt::CTRL | Qt::SHIFT | Qt::Key_N));
  incognito->setToolTip(I18n::text(QStringLiteral("menu.new_incognito_tooltip"), QStringLiteral("Yeni gizli pencere aç (Ctrl+Shift+N)")));

  menu.addSeparator();
  QAction *passwords = menu.addAction(BrowserIcons::icon(BrowserIcon::Password), I18n::text(QStringLiteral("menu.passwords"), QStringLiteral("Şifreler ve otomatik doldurma")));
  QAction *fillPassword = menu.addAction(BrowserIcons::icon(BrowserIcon::Password), I18n::text(QStringLiteral("menu.fill_password"), QStringLiteral("Bu sayfayı kayıtlı girişle doldur")));
  fillPassword->setEnabled(currentView() != nullptr && services_.profileService && services_.profileService->credentialVault() && !services_.profileService->credentialVault()->isLocked());
  QAction *history = menu.addAction(BrowserIcons::icon(BrowserIcon::History), I18n::text(QStringLiteral("menu.history"), QStringLiteral("Geçmiş")));
  history->setShortcut(QKeySequence(Qt::CTRL | Qt::Key_H));

  QMenu *bookmarksMenu = menu.addMenu(BrowserIcons::icon(BrowserIcon::Bookmark), I18n::text(QStringLiteral("menu.bookmarks"), QStringLiteral("Yer işaretleri")));
  QAction *toggleBar = bookmarksMenu->addAction(I18n::text(QStringLiteral("menu.bookmarks_bar"), QStringLiteral("Yer işaretleri çubuğunu göster")));
  toggleBar->setShortcut(QKeySequence(Qt::CTRL | Qt::SHIFT | Qt::Key_B));
  toggleBar->setCheckable(true);
  const QString bmMode = QSettings().value(QStringLiteral("browser/bookmarkBarVisibility"), QStringLiteral("new_tab")).toString();
  toggleBar->setChecked(bmMode == QLatin1String("always") || (bmMode == QLatin1String("new_tab") && isCurrentTabNewTab()));
  connect(toggleBar, &QAction::triggered, this, &BrowserWindow::toggleBookmarkBar);

  QAction *bookmarks = bookmarksMenu->addAction(BrowserIcons::icon(BrowserIcon::Bookmark), I18n::text(QStringLiteral("menu.bookmarks_manager"), QStringLiteral("Yer işaretleri yöneticisi")));
  bookmarks->setShortcut(QKeySequence(Qt::CTRL | Qt::SHIFT | Qt::Key_O));

  QAction *downloads = menu.addAction(BrowserIcons::icon(BrowserIcon::Download), I18n::text(QStringLiteral("menu.downloads"), QStringLiteral("İndirilenler")));
  downloads->setShortcut(QKeySequence(Qt::CTRL | Qt::Key_J));

  menu.addSeparator();
  QMenu *zoom = menu.addMenu(BrowserIcons::icon(BrowserIcon::Zoom), I18n::text(QStringLiteral("menu.zoom"), QStringLiteral("Yakınlaştır")));
  QAction *zoomOut = zoom->addAction(QStringLiteral("−"));
  QAction *zoomReset = zoom->addAction(QStringLiteral("%%%1").arg(currentView() ? qRound(currentView()->zoomFactor() * 100.0) : 100));
  QAction *zoomIn = zoom->addAction(QStringLiteral("+"));
  const bool hasWebContent = currentView() != nullptr;
  zoomOut->setEnabled(hasWebContent);
  zoomReset->setEnabled(hasWebContent);
  zoomIn->setEnabled(hasWebContent);

  menu.addSeparator();
  QAction *print = menu.addAction(BrowserIcons::icon(BrowserIcon::Print), I18n::text(QStringLiteral("menu.print"), QStringLiteral("Yazdır"))); print->setEnabled(false);
  QAction *find = menu.addAction(BrowserIcons::icon(BrowserIcon::Search), I18n::text(QStringLiteral("menu.find"), QStringLiteral("Bul ve düzenle"))); find->setEnabled(false);
  QAction *save = menu.addAction(BrowserIcons::icon(BrowserIcon::Save), I18n::text(QStringLiteral("menu.save"), QStringLiteral("Kaydet ve paylaş"))); save->setEnabled(false);
  QAction *tools = menu.addAction(BrowserIcons::icon(BrowserIcon::Tools), I18n::text(QStringLiteral("menu.other_tools"), QStringLiteral("Diğer araçlar"))); tools->setEnabled(false);

  menu.addSeparator();
  QAction *help = menu.addAction(BrowserIcons::icon(BrowserIcon::Help), I18n::text(QStringLiteral("menu.help"), QStringLiteral("Yardım"))); help->setEnabled(false);
  QAction *audioEffectsAction = menu.addAction(QIcon(QStringLiteral(":/side-widget-icons/sound-effects.svg")), I18n::text(QStringLiteral("menu.audio_effects"), QStringLiteral("Ses Efektleri")));
  QAction *eqPresetsAction = menu.addAction(QIcon(QStringLiteral(":/side-widget-icons/eq-presets.svg")), I18n::text(QStringLiteral("menu.eq_presets"), QStringLiteral("Hazır Ses Efektleri")));
  QAction *settings = menu.addAction(BrowserIcons::icon(BrowserIcon::Settings), I18n::text(QStringLiteral("menu.settings"), QStringLiteral("Ayarlar")));
  QAction *quit = menu.addAction(BrowserIcons::icon(BrowserIcon::Exit), I18n::text(QStringLiteral("menu.exit"), QStringLiteral("Çıkış")));

  connect(newTab, &QAction::triggered, this, [this] { addNewTab(); });
  connect(newWindow, &QAction::triggered, this, [this] {
    auto *window = new BrowserWindow(services_);
    window->ensureInitialTab();
    window->show();
  });
  connect(incognito, &QAction::triggered, this, [this] {
    openIncognitoWindow();
  });
  connect(passwords, &QAction::triggered, this, &BrowserWindow::showPasswords);
  connect(fillPassword, &QAction::triggered, this, &BrowserWindow::fillCurrentPageFromVault);
  connect(history, &QAction::triggered, this, [this] { showHistoryMenu(); });
  connect(bookmarks, &QAction::triggered, this, [this] { showSettings(SettingsPage::Category::Bookmarks); });
  connect(downloads, &QAction::triggered, this, [this] { showDownloadsMenu(); });
  connect(zoomOut, &QAction::triggered, this, [this] { changeCurrentZoom(-0.1); });
  connect(zoomReset, &QAction::triggered, this, [this] { setCurrentZoom(1.0); });
  connect(zoomIn, &QAction::triggered, this, [this] { changeCurrentZoom(0.1); });
  connect(audioEffectsAction, &QAction::triggered, this, &BrowserWindow::showAudioEffects);
  connect(eqPresetsAction, &QAction::triggered, this, &BrowserWindow::showEqPresetBrowser);
  connect(settings, &QAction::triggered, this, [this] { showSettings(); });
  connect(quit, &QAction::triggered, qApp, &QCoreApplication::quit);

  const QPoint execPos = mainMenuBtn_ ? mainMenuBtn_->mapToGlobal(QPoint(0, mainMenuBtn_->height())) : QCursor::pos();
  menu.exec(execPos);
}

void BrowserWindow::showHistoryMenu() {
  if (!services_.profileService) return;
  QMenu menu(this);
  menu.setStyleSheet(QStringLiteral("QMenu{background:#1b232d;color:#e8eef5;border:1px solid #3a4857;border-radius:9px;padding:6px;} QMenu::item{min-height:25px;padding:5px 30px 5px 30px;border-radius:6px;} QMenu::item:disabled{color:#6f7b87;}"));
  const auto entries = services_.profileService->recentHistory();
  if (entries.isEmpty()) {
    QAction *empty = menu.addAction(I18n::text(QStringLiteral("menu.history_empty"), QStringLiteral("Geçmiş henüz boş")));
    empty->setEnabled(false);
  } else {
    for (const auto &entry : entries.mid(0, std::min<qsizetype>(30, entries.size()))) {
      const QString label = entry.title.isEmpty() ? entry.url.host() : entry.title;
      QAction *action = menu.addAction(label.left(90));
      action->setToolTip(QStringLiteral("%1\n%2").arg(entry.url.toDisplayString(), entry.visitedAt.toLocalTime().toString(QStringLiteral("dd.MM.yyyy HH:mm"))));
      connect(action, &QAction::triggered, this, [this, url = entry.url] {
        if (auto *view = currentView()) {
          view->load(url);
        } else {
          addNewTab(url);
        }
      });
    }
    menu.addSeparator();
    QAction *clear = menu.addAction(I18n::text(QStringLiteral("menu.clear_history"), QStringLiteral("Geçmişi temizle")));
    connect(clear, &QAction::triggered, this, [this] {
      if (services_.profileService) services_.profileService->clearHistory();
    });
  }
  menu.exec(QCursor::pos());
}

void BrowserWindow::showDownloadsMenu() {
  showMediaDownloads();
}

void BrowserWindow::fillCurrentPageFromVault() {
  if (autofillController_ && currentView()) {
    autofillController_->triggerFillForView(currentView());
  }
}

QString BrowserWindow::currentSearchEngine() const {
  if (services_.profileService) {
    return services_.profileService->searchEngine();
  }
  return QSettings().value(QStringLiteral("browser/searchEngine"), QStringLiteral("Google")).toString();
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
      tab.view->page()->runJavaScript(QStringLiteral("if(location.protocol==='ardali:'&&location.hostname==='newtab'&&window.ardaliSetSearchEngine)window.ardaliSetSearchEngine(%1[0]);").arg(json));
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

  if (autofillController_ && autofillController_->activeSaveBubble() && autofillController_->activeSaveBubble()->isVisible()) {
    if (event->type() == QEvent::MouseButtonPress) {
      auto *mouseEvent = static_cast<QMouseEvent *>(event);
      const QPoint globalPos = mouseEvent->globalPosition().toPoint();
      auto *widget = qobject_cast<QWidget *>(watched);
      auto *bubble = autofillController_->activeSaveBubble();
      if (widget != bubble && !bubble->isAncestorOf(widget)) {
        const QRect bubbleGlobalRect(bubble->mapToGlobal(QPoint(0, 0)), bubble->size());
        if (!bubbleGlobalRect.contains(globalPos)) {
          dismissCredentialSaveBubble();
        }
      }
    } else if (event->type() == QEvent::WindowDeactivate) {
      if (watched == this) {
        dismissCredentialSaveBubble();
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

  if (!property("ardaliDragCaptureShell").toBool() &&
      !ardali::desktop_tabs::TabDragController::instance().isActive() &&
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
    tabSearchPopup_ = new ardali::desktop_tabs::TabSearchPopup(this);
  }
  tabSearchPopup_->showBelow(tabSearchBtn_);
}

void BrowserWindow::toggleTabGroupLauncher() {
  if (tabGroupLauncherPopup_ && tabGroupLauncherPopup_->isVisible()) {
    tabGroupLauncherPopup_->close();
    return;
  }
  if (!tabGroupLauncherPopup_) {
    tabGroupLauncherPopup_ = new ardali::desktop_tabs::TabGroupLauncherPopup(this);
    connect(tabGroupLauncherPopup_, &ardali::desktop_tabs::TabGroupLauncherPopup::createGroupRequested,
            this, &BrowserWindow::createNewTabGroupWithNewTab);
  }
  tabGroupLauncherPopup_->showBelow(appsBtn_);
}

void BrowserWindow::createNewTabGroupWithNewTab() {
  if (!groupModel_) return;

  // 1. Create a brand new normal ArDali tab at the end of tabs using existing creation path
  const int newIdx = addNewTab(QUrl(QStringLiteral("ardali://newtab/")), -1);
  if (newIdx < 0 || newIdx >= tabs_.size()) return;

  // 2. Generate a new stable Group UID
  const QColor defaultColor = ardali::desktop_tabs::tabGroupColorPalette().value(0, QColor("#757b82"));
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
    const QColor defaultColor = ardali::desktop_tabs::tabGroupColorPalette().value(0, QColor("#757b82"));
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
    tabGroupPopup_ = new ardali::desktop_tabs::TabGroupPopup(groupModel_, this);
    connect(tabGroupPopup_, &ardali::desktop_tabs::TabGroupPopup::newTabInGroupRequested,
            this, &BrowserWindow::addTabToGroup);
    connect(tabGroupPopup_, &ardali::desktop_tabs::TabGroupPopup::moveGroupToNewWindowRequested,
            this, &BrowserWindow::moveGroupToNewWindow);
    connect(tabGroupPopup_, &ardali::desktop_tabs::TabGroupPopup::closeGroupRequested,
            this, &BrowserWindow::closeTabGroup);
    connect(tabGroupPopup_, &ardali::desktop_tabs::TabGroupPopup::ungroupRequested,
            this, &BrowserWindow::ungroupTabs);
    connect(tabGroupPopup_, &ardali::desktop_tabs::TabGroupPopup::deleteGroupRequested,
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
  const int newIdx = addNewTab(QUrl(QStringLiteral("ardali://newtab/")), insertIdx);
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

  const ardali::desktop_tabs::TabGroup groupToMove = *optGroup;

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

std::optional<ardali::desktop_tabs::TabGroup> BrowserWindow::groupForTab(uint64_t tabId) const {
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
  if (ardali::desktop_tabs::TabDragController::instance().isActive()) {
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
  const auto regWindows = ardali::desktop_tabs::TabWindowRegistry::instance().registeredWindows();
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
      const QIcon throbberIcon = TabThrobber::renderThrobberIcon(throbber.frameStep(), pal, isActive, dpr);
      tabStrip_->setTabIcon(i, throbberIcon);
    }
  }
}

QJsonArray BrowserWindow::searchRows(const QString &query, const QStringList &remote) const {
  QJsonArray rows;
  if (query.trimmed().isEmpty() || query.size() > 256) return rows;
  QSet<QString> seen;
  auto append = [&](const QString &text, const QUrl &url, const QString &type) {
    if (rows.size() >= 12 || !url.isValid() || url.host().isEmpty() || !url.userInfo().isEmpty() ||
        (url.scheme() != QLatin1String("https") && url.scheme() != QLatin1String("http"))) return;
    const QString key = url.toString(QUrl::FullyEncoded);
    if (seen.contains(key)) return;
    seen.insert(key);
    QJsonObject row{{"text",text.left(256)},{"url",key},{"type",type}};
    if (type != QLatin1String("remote") && type != QLatin1String("search"))
      row.insert(QStringLiteral("icon"), newTabFaviconUrl(services_.profileService, url));
    rows.append(row);
  };
  const auto search = [&](const QString &text, const QString &type) {
    append(text, ardali::core::AddressInputResolver::searchUrlForEngine(currentSearchEngine(), text), type);
  };
  search(query, QStringLiteral("search"));
  // Local data is available only to its owning regular profile.
  if (services_.profileService && services_.profile == services_.profileService->profile() && !services_.profile->isOffTheRecord()) {
    for (const auto &tab : tabs_) {
      if (tab.title.contains(query, Qt::CaseInsensitive) || tab.url.host().contains(query, Qt::CaseInsensitive))
        append(tab.title.isEmpty() ? tab.url.host() : tab.title, tab.url, QStringLiteral("tab"));
      if (rows.size() >= 3) break;
    }
    for (const auto &url : services_.profileService->bookmarks()) {
      if (url.host().contains(query, Qt::CaseInsensitive)) append(url.host(), url, QStringLiteral("bookmark"));
      if (rows.size() >= 4) break;
    }
    for (const auto &site : services_.profileService->frequentSites(30)) {
      if (site.title.contains(query, Qt::CaseInsensitive) || site.url.host().contains(query, Qt::CaseInsensitive))
        append(site.title.isEmpty() ? site.url.host() : site.title, site.url, QStringLiteral("frequent"));
      if (rows.size() >= 5) break;
    }
    for (const auto &entry : services_.profileService->recentHistory()) {
      if (entry.title.contains(query, Qt::CaseInsensitive) || entry.url.host().contains(query, Qt::CaseInsensitive))
        append(entry.title.isEmpty() ? entry.url.host() : entry.title, entry.url, QStringLiteral("history"));
      if (rows.size() >= 6) break;
    }
  }
  for (const auto &text : remote) search(text, QStringLiteral("remote"));
  return rows;
}

void BrowserWindow::activateSuggestion(const QUrl &url) {
  if (suggestionActivated_ || !url.isValid() || url.host().isEmpty() || !url.userInfo().isEmpty() ||
      (url.scheme() != QLatin1String("https") && url.scheme() != QLatin1String("http"))) return;
  suggestionActivated_ = true;
  QTimer::singleShot(0, this, [this] { suggestionActivated_ = false; });
  suggestionCompleter_->popup()->hide();
  navigateFromUserInput(url.toString(QUrl::FullyEncoded));
}

void BrowserWindow::updateOmniboxSuggestions(const QString &query) {
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
      if (row.value("type") != QLatin1String("remote") && row.value("type") != QLatin1String("search")) {
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
  if (!page || !services_.profileService || !currentView() || currentView()->page() != page || !isNewTabUrl(page->url())) return;
  const QPointer<QWebEnginePage> target(page);
  const QPointer<BrowserWindow> guard(this);
  const QString capability = page->property("ardali-suggest-capability").toString();
  const QString engine = currentSearchEngine();
  page->setProperty("ardali-suggest-id", requestId);
  auto render = [guard,target,capability,engine,query,requestId](const QStringList &remote) {
    if (!guard || !target || !isNewTabUrl(target->url()) || target->property("ardali-suggest-capability").toString()!=capability ||
        target->property("ardali-suggest-id").toInt()!=requestId || guard->currentSearchEngine()!=engine) return;
    const QString json = QString::fromUtf8(QJsonDocument(QJsonArray{requestId,query,guard->searchRows(query,remote)}).toJson(QJsonDocument::Compact));
    target->runJavaScript(QStringLiteral("if(window.ardaliShowSuggestions)window.ardaliShowSuggestions(...%1);").arg(json));
  };
  render({});
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
    Promise.allSettled(tasks).then(()=>{window.__ardaliForgetDone=true});
  })())JS"), QWebEngineScript::ApplicationWorld);
  const QPointer<QWebEngineView> guard(view);
  auto *timer = new QTimer(view);
  timer->setInterval(200);
  connect(timer, &QTimer::timeout, view, [guard,timer] {
    timer->stop();
    if (!guard) return;
    guard->page()->runJavaScript(QStringLiteral("window.__ardaliForgetDone===true"), QWebEngineScript::ApplicationWorld,
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

BrowserWindow *BrowserWindow::openIncognitoWindow(const QUrl &url) {
  auto incognitoServices = services_;
  const auto directory = std::make_shared<QTemporaryDir>();
  if (!directory->isValid()) return nullptr;
  auto privateOwner = std::shared_ptr<BrowserProfileService>(
      new BrowserProfileService(directory->path(), services_.policy, nullptr, true),
      [directory](BrowserProfileService *service) { delete service; });
  auto *privateService = privateOwner.get();
  incognitoServices.privateProfileOwner = privateOwner;
  incognitoServices.profileService = privateService;
  incognitoServices.profile = privateService->profile();
  incognitoServices.sessionStore = nullptr;
  auto *window = new BrowserWindow(incognitoServices);

  window->setAttribute(Qt::WA_DeleteOnClose);
  window->setWindowTitle(QStringLiteral("Gizli Pencere — ArDaliBrowser"));
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
  devWindow->setWindowTitle(QStringLiteral("Geliştirici Araçları (İncele) — ArDaliBrowser"));
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

void BrowserWindow::onTabContextMenuRequested(int index, const QPoint &globalPos) {
  if (index < 0 || index >= tabs_.size()) return;
  const auto &tab = tabs_[index];
  const uint64_t tabId = tab.id;

  QMenu menu(this);
  menu.setStyleSheet(QStringLiteral(
      "QMenu { background-color: #1b232d; color: #e8eef5; border: 1px solid #3a4857; border-radius: 9px; padding: 6px 4px; font-size: 13px; }"
      "QMenu::item { min-height: 25px; padding: 4px 26px 4px 12px; border-radius: 6px; margin: 1px 3px; }"
      "QMenu::item:selected { background-color: #2b3947; color: #ffffff; }"
      "QMenu::item:disabled { color: #6f7b87; background-color: transparent; }"
      "QMenu::separator { height: 1px; background-color: #33404d; margin: 5px 8px; }"
      "QMenu::icon { padding-left: 6px; }"
  ));

  // 1. Sağa yeni sekme
  QAction *newTabRight = menu.addAction(BrowserIcons::icon(BrowserIcon::NewTab), I18n::text(QStringLiteral("tab.context.new_tab_right"), QStringLiteral("Sağa yeni sekme")));
  connect(newTabRight, &QAction::triggered, this, [this, index] {
    addNewTab(QUrl(QStringLiteral("ardali://newtab/")), index + 1);
  });

  // 2. Mevcut sekmeyle yeni bölünmüş görünüm
  QAction *splitViewAction = menu.addAction(BrowserIcons::icon(BrowserIcon::Cards), I18n::text(QStringLiteral("tab.context.split_view"), QStringLiteral("Mevcut sekmeyle yeni bölünmüş görünüm")));
  splitViewAction->setEnabled(false);

  // 3. Sekmeyi yeni gruba ekle / Sekmeyi gruptan çıkar / Gruplar alt menüsü
  if (tab.groupId.has_value() && groupModel_ && groupModel_->hasGroup(*tab.groupId)) {
    QAction *ungroup = menu.addAction(BrowserIcons::icon(BrowserIcon::Grid), I18n::text(QStringLiteral("tab.context.ungroup"), QStringLiteral("Sekmeyi gruptan çıkar")));
    connect(ungroup, &QAction::triggered, this, [this, tabId] {
      if (groupModel_) {
        const int idx = findIndexByTabId(tabId);
        if (idx >= 0 && tabs_[idx].groupId.has_value()) {
          const QUuid gid = *tabs_[idx].groupId;
          groupModel_->removeTabFromGroup(tabId);
          tabs_[idx].groupId = std::nullopt;
          if (groupModel_->groupTabCount(gid) == 0) {
            groupModel_->removeGroup(gid);
          }
          tabStrip_->update();
        }
      }
    });
  } else {
    const auto groups = groupModel_ ? groupModel_->allGroups() : QList<ardali::desktop_tabs::TabGroup>{};
    if (groups.isEmpty()) {
      QAction *newGroup = menu.addAction(BrowserIcons::icon(BrowserIcon::Grid), I18n::text(QStringLiteral("tab.context.add_to_new_group"), QStringLiteral("Sekmeyi yeni gruba ekle")));
      connect(newGroup, &QAction::triggered, this, [this, tabId] {
        createGroupFromExistingTab(tabId);
      });
    } else {
      QMenu *groupSub = menu.addMenu(BrowserIcons::icon(BrowserIcon::Grid), I18n::text(QStringLiteral("tab.context.add_to_group"), QStringLiteral("Sekmeyi gruba ekle")));
      groupSub->setStyleSheet(menu.styleSheet());
      QAction *createGroupAct = groupSub->addAction(I18n::text(QStringLiteral("tab.context.new_group"), QStringLiteral("Yeni grup")));
      connect(createGroupAct, &QAction::triggered, this, [this, tabId] {
        createGroupFromExistingTab(tabId);
      });
      groupSub->addSeparator();
      for (const auto &g : groups) {
        QString title = g.name.trimmed().isEmpty() ? I18n::text(QStringLiteral("tab.context.new_group"), QStringLiteral("Grup")) : g.name;
        QAction *gAct = groupSub->addAction(title);
        const QUuid gid = g.id;
        connect(gAct, &QAction::triggered, this, [this, tabId, gid] {
          if (groupModel_) {
            const int idx = findIndexByTabId(tabId);
            if (idx >= 0) {
              tabs_[idx].groupId = gid;
              groupModel_->setTabGroup(tabId, gid);
              tabStrip_->update();
            }
          }
        });
      }
    }
  }

  // 4. Sekmeyi yeni pencereye taşı
  QAction *moveWindow = menu.addAction(BrowserIcons::icon(BrowserIcon::Window), I18n::text(QStringLiteral("tab.context.move_to_new_window"), QStringLiteral("Sekmeyi yeni pencereye taşı")));
  moveWindow->setEnabled(tabs_.size() > 1);
  connect(moveWindow, &QAction::triggered, this, [this, tabId] {
    auto *newWin = new BrowserWindow(services_);
    newWin->show();
    transferTabTo(tabId, newWin, 0);
  });

  menu.addSeparator();

  // 5. Yeniden Yükle
  QAction *reloadAct = menu.addAction(I18n::text(QStringLiteral("tab.context.reload"), QStringLiteral("Yeniden Yükle")));
  reloadAct->setShortcut(QKeySequence(Qt::CTRL | Qt::Key_R));
  connect(reloadAct, &QAction::triggered, this, [this, tabId] {
    const int idx = findIndexByTabId(tabId);
    if (idx >= 0 && tabs_[idx].view) {
      tabs_[idx].view->reload();
    }
  });

  // 6. Yinele
  QAction *duplicateAct = menu.addAction(I18n::text(QStringLiteral("tab.context.duplicate"), QStringLiteral("Yinele")));
  connect(duplicateAct, &QAction::triggered, this, [this, tabId] {
    const int idx = findIndexByTabId(tabId);
    if (idx >= 0) {
      addNewTab(tabs_[idx].url, idx + 1);
    }
  });

  // 7. Sabitle / Sabitlemeyi kaldır
  const bool isPinned = tab.isPinned;
  QAction *pinAct = menu.addAction(isPinned
      ? I18n::text(QStringLiteral("tab.context.unpin"), QStringLiteral("Sabitlemeyi kaldır"))
      : I18n::text(QStringLiteral("tab.context.pin"), QStringLiteral("Sabitle")));
  connect(pinAct, &QAction::triggered, this, [this, tabId] {
    const int idx = findIndexByTabId(tabId);
    if (idx >= 0) {
      toggleTabPin(idx);
    }
  });

  // 8. Sitenin sesini kapat / Sitenin sesini aç
  bool isMuted = tab.view && tab.view->page() && tab.view->page()->isAudioMuted();
  QAction *muteAct = menu.addAction(BrowserIcons::icon(BrowserIcon::Audio),
                                    isMuted
                                        ? I18n::text(QStringLiteral("tab.context.unmute"), QStringLiteral("Sitenin sesini aç"))
                                        : I18n::text(QStringLiteral("tab.context.mute"), QStringLiteral("Sitenin sesini kapat")));
  connect(muteAct, &QAction::triggered, this, [this, tabId, isMuted] {
    const int idx = findIndexByTabId(tabId);
    if (idx >= 0 && tabs_[idx].view && tabs_[idx].view->page()) {
      const bool newMuted = !isMuted;
      tabs_[idx].view->page()->setAudioMuted(newMuted);
      tabStrip_->setTabAudible(idx, !newMuted && tabs_[idx].view->page()->recentlyAudible());
    }
  });

  menu.addSeparator();

  // 9. Okuma listesine sekme ekle
  QAction *readingListAct = menu.addAction(BrowserIcons::icon(BrowserIcon::Bookmark), I18n::text(QStringLiteral("tab.context.add_to_reading_list"), QStringLiteral("Okuma listesine sekme ekle")));
  connect(readingListAct, &QAction::triggered, this, [this, tabId] {
    const int idx = findIndexByTabId(tabId);
    if (idx >= 0 && services_.profileService) {
      services_.profileService->toggleBookmark(tabs_[idx].url);
      updateBookmarkButtonState();
      renderBookmarks();
    }
  });

  // 10. Cihazıma gönder
  QAction *sendDeviceAct = menu.addAction(I18n::text(QStringLiteral("tab.context.send_to_device"), QStringLiteral("Cihazıma gönder")));
  sendDeviceAct->setEnabled(false);

  menu.addSeparator();

  // 11. Sekmeleri dikey olarak göster
  QAction *verticalTabsAct = menu.addAction(I18n::text(QStringLiteral("tab.context.vertical_tabs"), QStringLiteral("Sekmeleri dikey olarak göster")));
  verticalTabsAct->setEnabled(false);

  menu.addSeparator();

  // 12. Kapat
  QAction *closeAct = menu.addAction(BrowserIcons::icon(BrowserIcon::Close), I18n::text(QStringLiteral("tab.context.close"), QStringLiteral("Kapat")));
  closeAct->setShortcut(QKeySequence(Qt::CTRL | Qt::Key_W));
  connect(closeAct, &QAction::triggered, this, [this, tabId] {
    const int idx = findIndexByTabId(tabId);
    if (idx >= 0) {
      closeTab(idx);
    }
  });

  // 13. Diğer sekmeleri kapat
  QAction *closeOthersAct = menu.addAction(I18n::text(QStringLiteral("tab.context.close_others"), QStringLiteral("Diğer sekmeleri kapat")));
  closeOthersAct->setEnabled(tabs_.size() > 1);
  connect(closeOthersAct, &QAction::triggered, this, [this, tabId] {
    const int idx = findIndexByTabId(tabId);
    if (idx >= 0) {
      closeOtherTabs(idx);
    }
  });

  // 14. Sağdaki sekmeleri kapat
  QAction *closeRightAct = menu.addAction(I18n::text(QStringLiteral("tab.context.close_right"), QStringLiteral("Sağdaki sekmeleri kapat")));
  closeRightAct->setEnabled(index < tabs_.size() - 1);
  connect(closeRightAct, &QAction::triggered, this, [this, tabId] {
    const int idx = findIndexByTabId(tabId);
    if (idx >= 0) {
      closeTabsToRight(idx);
    }
  });

  menu.exec(globalPos);
}

void BrowserWindow::showBookmarkContextMenu(const QUrl &url, const QString &title, const QPoint &globalPos) {
  Q_UNUSED(title);
  QMenu menu(this);
  menu.setStyleSheet(QStringLiteral(
      "QMenu { background-color: #1b232d; color: #e8eef5; border: 1px solid #3a4857; border-radius: 9px; padding: 6px 4px; font-size: 13px; }"
      "QMenu::item { min-height: 25px; padding: 4px 26px 4px 12px; border-radius: 6px; margin: 1px 3px; }"
      "QMenu::item:selected { background-color: #2b3947; color: #ffffff; }"
      "QMenu::item:disabled { color: #6f7b87; background-color: transparent; }"
      "QMenu::separator { height: 1px; background-color: #33404d; margin: 5px 8px; }"
  ));

  const bool hasUrl = url.isValid() && !url.isEmpty();

  if (hasUrl) {
    // 1. Yeni sekmede aç
    QAction *newTabAct = menu.addAction(I18n::text(QStringLiteral("bookmark.open_tab"), QStringLiteral("Yeni sekmede aç")));
    connect(newTabAct, &QAction::triggered, this, [this, url] {
      addNewTab(url);
    });

    // 2. Yeni pencerede aç
    QAction *newWinAct = menu.addAction(I18n::text(QStringLiteral("bookmark.open_window"), QStringLiteral("Yeni pencerede aç")));
    connect(newWinAct, &QAction::triggered, this, [this, url] {
      auto *newWin = new BrowserWindow(services_);
      newWin->addNewTab(url);
      newWin->show();
    });

    // 3. Bölünmüş görünümde aç
    QAction *splitAct = menu.addAction(I18n::text(QStringLiteral("bookmark.open_split"), QStringLiteral("Bölünmüş görünümde aç")));
    splitAct->setEnabled(false);

    // 4. Gizli pencerede aç
    QAction *incognitoAct = menu.addAction(I18n::text(QStringLiteral("bookmark.open_incognito"), QStringLiteral("Gizli pencerede aç")));
    connect(incognitoAct, &QAction::triggered, this, [this, url] {
      openIncognitoWindow(url);
    });

    menu.addSeparator();

    // 5. Düzenle...
    QAction *editAct = menu.addAction(I18n::text(QStringLiteral("bookmark.edit"), QStringLiteral("Düzenle...")));
    connect(editAct, &QAction::triggered, this, [this, url] {
      QInputDialog dlg(this);
      dlg.setWindowTitle(I18n::text(QStringLiteral("bookmark.edit_dialog_title"), QStringLiteral("Yer işaretini düzenle")));
      dlg.setLabelText(I18n::text(QStringLiteral("bookmark.url_label"), QStringLiteral("URL:")));
      dlg.setTextValue(url.toString());
      dlg.setStyleSheet(QStringLiteral(
          "QDialog { background-color: #1b232d; color: #e8eef5; border: 1px solid #3a4857; border-radius: 8px; }"
          "QLabel { color: #e8eef5; font-size: 13px; }"
          "QLineEdit { background: #121820; color: #ffffff; border: 1px solid #3a4857; border-radius: 6px; padding: 6px; font-size: 13px; }"
          "QPushButton { background: #263342; color: #ffffff; border: 1px solid #3a4857; border-radius: 6px; padding: 6px 14px; font-size: 13px; }"
          "QPushButton:hover { background: #324458; }"
      ));
      if (dlg.exec() == QDialog::Accepted) {
        const QString newText = dlg.textValue().trimmed();
        if (!newText.isEmpty()) {
          const QUrl newUrl = QUrl::fromUserInput(newText);
          if (newUrl.isValid() && services_.profileService) {
            services_.profileService->toggleBookmark(url);
            services_.profileService->toggleBookmark(newUrl);
            updateBookmarkButtonState();
            renderBookmarks();
          }
        }
      }
    });

    menu.addSeparator();

    // 6. Kes
    QAction *cutAct = menu.addAction(I18n::text(QStringLiteral("bookmark.cut"), QStringLiteral("Kes")));
    connect(cutAct, &QAction::triggered, this, [this, url] {
      QGuiApplication::clipboard()->setText(url.toString());
      if (services_.profileService) {
        services_.profileService->toggleBookmark(url);
        updateBookmarkButtonState();
        renderBookmarks();
      }
    });

    // 7. Kopyala
    QAction *copyAct = menu.addAction(I18n::text(QStringLiteral("bookmark.copy"), QStringLiteral("Kopyala")));
    connect(copyAct, &QAction::triggered, this, [url] {
      QGuiApplication::clipboard()->setText(url.toString());
    });
  }

  // 8. Yapıştır
  const QString clipText = QGuiApplication::clipboard()->text().trimmed();
  const QUrl clipUrl = QUrl::fromUserInput(clipText);
  const bool canPaste = !clipText.isEmpty() && clipUrl.isValid() &&
                        (clipUrl.scheme() == QLatin1String("http") || clipUrl.scheme() == QLatin1String("https"));
  QAction *pasteAct = menu.addAction(I18n::text(QStringLiteral("bookmark.paste"), QStringLiteral("Yapıştır")));
  pasteAct->setEnabled(canPaste);
  connect(pasteAct, &QAction::triggered, this, [this, clipUrl] {
    if (services_.profileService && !services_.profileService->isBookmarked(clipUrl)) {
      services_.profileService->toggleBookmark(clipUrl);
      updateBookmarkButtonState();
      renderBookmarks();
    }
  });

  if (hasUrl) {
    menu.addSeparator();

    // 9. Sil
    QAction *deleteAct = menu.addAction(I18n::text(QStringLiteral("bookmark.delete"), QStringLiteral("Sil")));
    connect(deleteAct, &QAction::triggered, this, [this, url] {
      if (services_.profileService) {
        services_.profileService->toggleBookmark(url);
        updateBookmarkButtonState();
        renderBookmarks();
      }
    });
  }

  menu.addSeparator();

  // 10. Sayfa ekle...
  QAction *addPageAct = menu.addAction(I18n::text(QStringLiteral("bookmark.add_page"), QStringLiteral("Sayfa ekle...")));
  connect(addPageAct, &QAction::triggered, this, [this] {
    QInputDialog dlg(this);
    dlg.setWindowTitle(I18n::text(QStringLiteral("bookmark.add_page_title"), QStringLiteral("Sayfa ekle")));
    dlg.setLabelText(I18n::text(QStringLiteral("bookmark.url_label"), QStringLiteral("URL:")));
    const QUrl cur = currentView() ? currentView()->url() : QUrl{};
    dlg.setTextValue(cur.isValid() && !isNewTabUrl(cur) ? cur.toString() : QStringLiteral("https://"));
    dlg.setStyleSheet(QStringLiteral(
        "QDialog { background-color: #1b232d; color: #e8eef5; border: 1px solid #3a4857; border-radius: 8px; }"
        "QLabel { color: #e8eef5; font-size: 13px; }"
        "QLineEdit { background: #121820; color: #ffffff; border: 1px solid #3a4857; border-radius: 6px; padding: 6px; font-size: 13px; }"
        "QPushButton { background: #263342; color: #ffffff; border: 1px solid #3a4857; border-radius: 6px; padding: 6px 14px; font-size: 13px; }"
        "QPushButton:hover { background: #324458; }"
    ));
    if (dlg.exec() == QDialog::Accepted) {
      const QString newText = dlg.textValue().trimmed();
      if (!newText.isEmpty()) {
        const QUrl newUrl = QUrl::fromUserInput(newText);
        if (newUrl.isValid() && (newUrl.scheme() == QLatin1String("http") || newUrl.scheme() == QLatin1String("https"))) {
          if (services_.profileService && !services_.profileService->isBookmarked(newUrl)) {
            services_.profileService->toggleBookmark(newUrl);
            updateBookmarkButtonState();
            renderBookmarks();
          }
        }
      }
    }
  });

  // 11. Klasör ekle...
  QAction *addFolderAct = menu.addAction(I18n::text(QStringLiteral("bookmark.add_folder"), QStringLiteral("Klasör ekle...")));
  addFolderAct->setEnabled(false);

  menu.addSeparator();

  // 12. Yer işareti yöneticisini aç
  QAction *managerAct = menu.addAction(I18n::text(QStringLiteral("bookmark.open_manager"), QStringLiteral("Yer işareti yöneticisini aç")));
  connect(managerAct, &QAction::triggered, this, [this] {
    showSettings(SettingsPage::Category::Bookmarks);
  });

  // 13. Uygulamalar kısayolunu göster
  QAction *appsShortcutAct = menu.addAction(I18n::text(QStringLiteral("bookmark.show_apps_shortcut"), QStringLiteral("Uygulamalar kısayolunu göster")));
  appsShortcutAct->setCheckable(true);
  const bool showApps = QSettings().value(QStringLiteral("browser/showAppsShortcut"), false).toBool();
  appsShortcutAct->setChecked(showApps);
  connect(appsShortcutAct, &QAction::toggled, this, [](bool checked) {
    QSettings settings;
    settings.setValue(QStringLiteral("browser/showAppsShortcut"), checked);
    settings.sync();
  });

  // 14. Sekme gruplarını göster
  QAction *tabGroupsAct = menu.addAction(I18n::text(QStringLiteral("bookmark.show_tab_groups"), QStringLiteral("Sekme gruplarını göster")));
  tabGroupsAct->setCheckable(true);
  const bool showGroups = QSettings().value(QStringLiteral("browser/showTabGroupsOnBookmarkBar"), true).toBool();
  tabGroupsAct->setChecked(showGroups);
  connect(tabGroupsAct, &QAction::toggled, this, [this](bool checked) {
    QSettings settings;
    settings.setValue(QStringLiteral("browser/showTabGroupsOnBookmarkBar"), checked);
    settings.sync();
    if (appsBtn_) {
      appsBtn_->setVisible(checked);
    }
  });

  // 15. Yer işaretleri çubuğunu göster
  QAction *toggleBarAct = menu.addAction(I18n::text(QStringLiteral("bookmark.show_bar"), QStringLiteral("Yer işaretleri çubuğunu göster")));
  toggleBarAct->setCheckable(true);
  const QString bmMode = QSettings().value(QStringLiteral("browser/bookmarkBarVisibility"), QStringLiteral("new_tab")).toString();
  const bool barVisible = (bmMode == QLatin1String("always") || (bmMode == QLatin1String("new_tab") && isCurrentTabNewTab()));
  toggleBarAct->setChecked(barVisible);
  connect(toggleBarAct, &QAction::triggered, this, &BrowserWindow::toggleBookmarkBar);

  menu.exec(globalPos);
}

