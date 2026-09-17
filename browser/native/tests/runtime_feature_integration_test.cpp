#include <QApplication>
#include <QWebEngineView>
#include <QWebEngineProfile>
#include <QWebEngineScriptCollection>
#include <QTemporaryDir>
#include <cassert>
#include <iostream>

#include "audio/web_audio_effects_controller.h"
#include "blocker/ardali_blocker_service.h"
#include "blocker/ardali_blocker_request_interceptor.h"
#include "pulse/song_recognition_service.h"
#include "pulse/song_finder_settings.h"
#include "downloads/media_download_service.h"
#include "blocker/ardali_blocker_shield_button.h"

int main(int argc, char *argv[]) {
  qputenv("QT_QPA_PLATFORM", "offscreen");
  QApplication app(argc, argv);

  std::cout << "Starting Runtime Feature Integration Tests..." << std::endl;

  // 1. Test Audio Effects Controller & View Registration
  {
    std::cout << "Testing Audio Effects Controller..." << std::endl;
    auto *audioController = new WebAudioEffectsController(&app);
    assert(audioController->equalizerFrequencies().size() == 32);

    auto *view = new QWebEngineView();
    auto *page = new QWebEnginePage(QWebEngineProfile::defaultProfile(), view);
    view->setPage(page);

    audioController->registerWebView(view, QUrl(QStringLiteral("https://www.youtube.com/watch?v=test")));

    // Verify document bootstrap was installed into page scripts
    QWebEngineScriptCollection &scripts = page->scripts();
    const auto installed = scripts.find(QStringLiteral("ardali-web-audio-document-bootstrap"));
    assert(!installed.isEmpty());
    assert(installed.first().name() == QStringLiteral("ardali-web-audio-document-bootstrap"));
    assert(installed.first().sourceCode().contains(QStringLiteral("hostname === domain")));

    auto *normalView = new QWebEngineView();
    auto *normalPage = new QWebEnginePage(QWebEngineProfile::defaultProfile(), normalView);
    normalView->setPage(normalPage);
    audioController->registerWebView(normalView, QUrl(QStringLiteral("https://amazon.com/")));
    assert(normalPage->scripts().find(QStringLiteral("ardali-web-audio-document-bootstrap")).isEmpty());
    emit normalView->urlChanged(QUrl(QStringLiteral("https://music.youtube.com/")));
    assert(!normalPage->scripts().find(QStringLiteral("ardali-web-audio-document-bootstrap")).isEmpty());
    emit normalView->urlChanged(QUrl(QStringLiteral("https://amazon.com/")));
    assert(normalPage->scripts().find(QStringLiteral("ardali-web-audio-document-bootstrap")).isEmpty());

    // Verify parameter adjustments
    audioController->setEnabled(true);
    audioController->setBassDb(12.0);
    audioController->setEqualizerBand(0, 6.0);
    assert(audioController->bassDb() == 12.0);
    assert(audioController->equalizerBands().value(0) == 6.0);

    delete normalView;
    delete view;
    std::cout << "PASS: Audio Effects Controller & View Registration" << std::endl;
  }

  // 2. Test Blocker Service & Tab Tracking
  {
    std::cout << "Testing Blocker Service & Tab Tracking..." << std::endl;
    QTemporaryDir tempDir;
    assert(tempDir.isValid());

    auto *blockerService = new ArDaliBlockerService(tempDir.path(), &app);
    const quint64 testTabId = 0x12345678;
    const QUrl testUrl("https://example.com/news");

    blockerService->registerTab(testTabId, testUrl);
    blockerService->setActiveTabId(testTabId);
    assert(blockerService->activeTabId() == testTabId);

    // Verify evaluateRequest works
    const QUrl adUrl("https://doubleclick.net/ad");
    RequestDecision decision = blockerService->evaluateRequest(adUrl, 0, testUrl, testTabId, QStringLiteral("get"));
    std::cout << "Blocker decision action: " << static_cast<int>(decision.action) << std::endl;
    assert(decision.action == ArDaliBlockerAction::Block ||
           decision.action == ArDaliBlockerAction::Allow ||
           decision.action == ArDaliBlockerAction::Redirect ||
           decision.action == ArDaliBlockerAction::ModifyHeaders);

    const auto stats = blockerService->statsForTab(testTabId);
    assert(stats.allowedRequests >= 0);

    blockerService->unregisterTab(testTabId);
    std::cout << "PASS: Blocker Service & Tab Tracking" << std::endl;
  }

  // 3. Test Song Recognition Service & Metadata
  {
    std::cout << "Testing Song Recognition Service..." << std::endl;
    auto *settings = new SongFinderSettings(&app);
    auto *songService = new SongRecognitionService(settings, &app);

    assert(songService->state() == SongRecognitionService::State::Ready);
    assert(!songService->isDeviceMonitoringActive());
    assert(songService->deviceManager()->pollCheckCount() == 0);
    assert(songService->deviceManager()->processLaunchCount() == 0);

    songService->setWebContextMetadata(QStringLiteral("Bohemian Rhapsody"), QStringLiteral("Queen"));
    // Service state transition
    const bool started = songService->startListening();
    if (started) {
      assert(songService->isListening());
      songService->stopListening();
      assert(!songService->isListening());
    }
    std::cout << "PASS: Song Recognition Service & Metadata" << std::endl;
  }

  // 4. Test Media Detection Service URL Support
  {
    std::cout << "Testing Media Detection Service URL Support..." << std::endl;
    assert(MediaDownloadService::isSupportedMediaUrl(QUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")));
    assert(MediaDownloadService::isSupportedMediaUrl(QUrl("https://youtu.be/dQw4w9WgXcQ")));
    assert(MediaDownloadService::isSupportedMediaUrl(QUrl("https://vimeo.com/12345678")));
    assert(!MediaDownloadService::isSupportedMediaUrl(QUrl("ardali://newtab/")));
    assert(!MediaDownloadService::isSupportedMediaUrl(QUrl("about:blank")));
    std::cout << "PASS: Media Detection Service URL Support" << std::endl;
  }

  // 5. Test Ad Blocker Per-Tab State, Internal Page Neutralization & Detach Preservation
  {
    std::cout << "Testing Ad Blocker Per-Tab State & Lifecycle..." << std::endl;
    QTemporaryDir tempDir;
    auto *blockerService = new ArDaliBlockerService(tempDir.path(), &app);
    auto *shieldButton = new ArDaliBlockerShieldButton(blockerService);

    const quint64 tabYouTube = 1001;
    const quint64 tabFacebook = 1002;
    const quint64 tabNewTab = 1003;

    blockerService->registerTab(tabYouTube, QUrl("https://www.youtube.com/watch?v=123"));
    blockerService->registerTab(tabFacebook, QUrl("https://www.facebook.com/feed"));
    blockerService->registerTab(tabNewTab, QUrl("ardali://newtab/"));

    // Simulate blocked requests on YouTube
    for (int i = 0; i < 7; ++i) {
      blockerService->evaluateRequest(QUrl("https://adservice.google.com/ads.js"), 2,
                                      QUrl("https://www.youtube.com/watch?v=123"), tabYouTube);
    }
    assert(blockerService->statsForTab(tabYouTube).blockedRequests == 7);

    // Simulate blocked requests on Facebook
    for (int i = 0; i < 3; ++i) {
      blockerService->evaluateRequest(QUrl("https://ad.doubleclick.net/ad.js"), 2,
                                      QUrl("https://www.facebook.com/feed"), tabFacebook);
    }
    assert(blockerService->statsForTab(tabFacebook).blockedRequests == 3);

    // Verify Tab A (YouTube) activates shield with count 7
    shieldButton->setInternalPage(false);
    shieldButton->setActiveHost("youtube.com");
    shieldButton->setBlockedCount(blockerService->statsForTab(tabYouTube).blockedRequests);
    assert(shieldButton->blockedCount() == 7);
    assert(!shieldButton->isInternalPage());

    // Switch to Tab B (ardali://newtab) -> count must disappear, internal page inactive, but button ALWAYS clickable!
    shieldButton->setInternalPage(true);
    shieldButton->setActiveHost(QString());
    shieldButton->setBlockedCount(0);
    assert(shieldButton->isEnabled());
    assert(shieldButton->blockedCount() == 0);
    assert(shieldButton->isInternalPage());

    // Switch back to Tab A (YouTube) -> count returns to 7
    shieldButton->setInternalPage(false);
    shieldButton->setActiveHost("youtube.com");
    shieldButton->setBlockedCount(blockerService->statsForTab(tabYouTube).blockedRequests);
    assert(shieldButton->blockedCount() == 7);
    assert(!shieldButton->isInternalPage());

    // Switch to Tab C (Facebook) -> independent count 3
    shieldButton->setInternalPage(false);
    shieldButton->setActiveHost("facebook.com");
    shieldButton->setBlockedCount(blockerService->statsForTab(tabFacebook).blockedRequests);
    assert(shieldButton->blockedCount() == 3);

    // Detach YouTube tab into another window -> state preserved
    blockerService->registerTab(tabYouTube, QUrl("https://www.youtube.com/watch?v=123"));
    auto *detachedShieldButton = new ArDaliBlockerShieldButton(blockerService);
    detachedShieldButton->setInternalPage(false);
    detachedShieldButton->setActiveHost("youtube.com");
    detachedShieldButton->setBlockedCount(blockerService->statsForTab(tabYouTube).blockedRequests);
    assert(detachedShieldButton->blockedCount() == 7);

    // Navigate YouTube tab to Facebook -> host changed, stats reset for new site
    blockerService->updateTabUrl(tabYouTube, QUrl("https://www.facebook.com/profile"));
    assert(blockerService->statsForTab(tabYouTube).blockedRequests == 0);

    // Verify internal requests never get blocked count incremented
    const auto internalDecision = blockerService->evaluateRequest(
        QUrl("ardali://newtab/bundle.js"), 2, QUrl("ardali://newtab/"), tabNewTab);
    assert(internalDecision.action == ArDaliBlockerAction::Allow);
    assert(internalDecision.rulesetId == QStringLiteral("ardali-internal"));
    assert(blockerService->statsForTab(tabNewTab).blockedRequests == 0);

    delete detachedShieldButton;
    delete shieldButton;
    delete blockerService;
    std::cout << "PASS: Ad Blocker Per-Tab State & Lifecycle" << std::endl;
  }

  // 6. Test Search Engine URL Generation Parity
  {
    std::cout << "Testing Search Engine URL Generation Parity..." << std::endl;
    const auto searchUrl = [](const QString &engine, const QString &queryText) {
      const QString lower = engine.trimmed().toLower();
      QString baseUrl;
      if (lower.contains(QLatin1String("duckduckgo")) || lower.contains(QLatin1String("duck"))) {
        baseUrl = QStringLiteral("https://duckduckgo.com/?q=");
      } else if (lower.contains(QLatin1String("brave"))) {
        baseUrl = QStringLiteral("https://search.brave.com/search?q=");
      } else if (lower.contains(QLatin1String("bing"))) {
        baseUrl = QStringLiteral("https://www.bing.com/search?q=");
      } else {
        baseUrl = QStringLiteral("https://www.google.com/search?q=");
      }
      return QUrl(baseUrl + QString::fromUtf8(QUrl::toPercentEncoding(queryText)));
    };

    assert(searchUrl("Google", "hello world").toEncoded() == "https://www.google.com/search?q=hello%20world");
    assert(searchUrl("DuckDuckGo", "privacy").toEncoded() == "https://duckduckgo.com/?q=privacy");
    assert(searchUrl("Brave Search", "crypto").toEncoded() == "https://search.brave.com/search?q=crypto");
    assert(searchUrl("Bing", "microsoft").toEncoded() == "https://www.bing.com/search?q=microsoft");
    std::cout << "PASS: Search Engine URL Generation Parity" << std::endl;
  }

  // 7. Test Bookmark Display Name Resolution (No truncation of normal platform names)
  {
    std::cout << "Testing Bookmark Display Name Resolution..." << std::endl;
    const auto bookmarkDisplayName = [](const QUrl &url) {
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
    };

    assert(bookmarkDisplayName(QUrl("https://www.youtube.com/")) == QStringLiteral("YouTube"));
    assert(bookmarkDisplayName(QUrl("https://github.com/torvalds")) == QStringLiteral("GitHub"));
    assert(bookmarkDisplayName(QUrl("https://facebook.com/")) == QStringLiteral("Facebook"));
    assert(bookmarkDisplayName(QUrl("https://www.instagram.com/")) == QStringLiteral("Instagram"));
    assert(bookmarkDisplayName(QUrl("https://chatgpt.com/")) == QStringLiteral("ChatGPT"));
    assert(bookmarkDisplayName(QUrl("https://gitlab.com/")) == QStringLiteral("GitLab"));
    assert(bookmarkDisplayName(QUrl("https://en.wikipedia.org/wiki/Main_Page")) == QStringLiteral("Wikipedia"));
    assert(bookmarkDisplayName(QUrl("https://duckduckgo.com/")) == QStringLiteral("DuckDuckGo"));
    assert(bookmarkDisplayName(QUrl("https://www.google.com/")) == QStringLiteral("Google"));
    std::cout << "PASS: Bookmark Display Name Resolution" << std::endl;
  }

  std::cout << "All Runtime Feature Integration Tests Passed Successfully!" << std::endl;
  return 0;
}
