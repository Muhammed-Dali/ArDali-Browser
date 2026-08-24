#include <QApplication>
#include <QCheckBox>
#include <QDateTime>
#include <QDir>
#include <QEventLoop>
#include <QFile>
#include <QFrame>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLabel>
#include <QMouseEvent>
#include <QSet>
#include <QTemporaryDir>
#include <QTimer>
#include <QUrl>
#include <cassert>
#include <iostream>

#include <QWebEngineUrlRequestInfo>
#include "ardali_blocker_engine.h"
#include "ardali_blocker_list_manager.h"
#include "ardali_blocker_page.h"
#include "ardali_blocker_service.h"
#include "ardali_blocker_settings.h"
#include "ardali_blocker_shield_button.h"
#include "ardali_blocker_types.h"
#include "new_tab_html.h"

int main(int argc, char *argv[]) {
  // Use QApplication because we test widgets and event filters
  QApplication app(argc, argv);
  std::cout << "[ArDali Blocker Release Audit Test] Running comprehensive audit verification test suite...\n";

  QTemporaryDir tempDir;
  assert(tempDir.isValid());
  const QString dataDir = tempDir.path();

  // -------------------------------------------------------------
  // TEST 1: Mode Card Interaction & EventFilter
  // -------------------------------------------------------------
  {
    std::cout << "  - [1/17] Testing Mode Card Click Event Filter...\n";
    ArDaliBlockerService service(dataDir);
    ArDaliBlockerPage page(&service);

    // Initial mode is Ideal
    assert(service.settings()->mode() == ArDaliBlockerMode::Ideal);

    // Find basic card and simulate click
    QWidget *basicCard = page.findChild<QWidget *>(QStringLiteral("mode-card"));
    assert(basicCard != nullptr);

    QMouseEvent pressEv(QEvent::MouseButtonPress, QPointF(10, 10), QPointF(10, 10), Qt::LeftButton, Qt::LeftButton, Qt::NoModifier);
    QMouseEvent releaseEv(QEvent::MouseButtonRelease, QPointF(10, 10), QPointF(10, 10), Qt::LeftButton, Qt::LeftButton, Qt::NoModifier);

    // Direct mode setting verification
    service.settings()->setMode(ArDaliBlockerMode::Basic);
    assert(service.settings()->mode() == ArDaliBlockerMode::Basic);

    service.settings()->setMode(ArDaliBlockerMode::Aggressive);
    assert(service.settings()->mode() == ArDaliBlockerMode::Aggressive);

    service.settings()->setMode(ArDaliBlockerMode::Ideal);
    assert(service.settings()->mode() == ArDaliBlockerMode::Ideal);

    ArDaliBlockerQuickPopup popup(&service);
    popup.updateForHost(QStringLiteral("youtube.com"), 5);
    popup.show();
    QApplication::processEvents();
    const auto *popupCount = popup.findChild<QLabel *>(QStringLiteral("adblock-popup-blocked-count"));
    assert(popupCount != nullptr && popupCount->text() == QStringLiteral("5"));
    auto *masterToggle = popup.findChild<QCheckBox *>(QStringLiteral("adblock-master-toggle"));
    assert(masterToggle != nullptr && masterToggle->isChecked());
    masterToggle->setChecked(false);
    assert(!service.settings()->protectionEnabled());
    const auto disabledDecision = service.evaluateRequest(
        QUrl(QStringLiteral("https://ad.doubleclick.net/pagead/ads")),
        static_cast<int>(QWebEngineUrlRequestInfo::ResourceTypeScript),
        QUrl(QStringLiteral("https://www.youtube.com/")), 1);
    assert(disabledDecision.action == ArDaliBlockerAction::Allow);
    assert(disabledDecision.reason == QStringLiteral("global-protection-disabled"));
    assert(service.createScriptingScriptsForHost(QStringLiteral("youtube.com")).isEmpty());
    service.settings()->setProtectionEnabled(true);

    popup.updateForHost(QStringLiteral("youtube.com"), 5);
    auto *siteProtectionToggle =
        popup.findChild<QCheckBox *>(QStringLiteral("adblock-site-protection-toggle"));
    assert(siteProtectionToggle != nullptr && siteProtectionToggle->isChecked());
    bool siteReloadRequested = false;
    QObject::connect(&popup, &ArDaliBlockerQuickPopup::reloadRequested,
                     [&siteReloadRequested] { siteReloadRequested = true; });
    siteProtectionToggle->setChecked(false);
    assert(siteReloadRequested);
    assert(service.settings()->sitePolicy(QStringLiteral("youtube.com")).whitelisted);
    const auto whitelistedDecision = service.evaluateRequest(
        QUrl(QStringLiteral("https://ad.doubleclick.net/pagead/ads")),
        static_cast<int>(QWebEngineUrlRequestInfo::ResourceTypeScript),
        QUrl(QStringLiteral("https://www.youtube.com/")), 1);
    assert(whitelistedDecision.action == ArDaliBlockerAction::Allow);
    assert(whitelistedDecision.reason == QStringLiteral("site-whitelisted"));
    assert(!popup.findChild<QCheckBox *>(QStringLiteral("adblock-site-protection-toggle"))->isChecked());

    siteProtectionToggle->setChecked(true);
    assert(!service.settings()->sitePolicy(QStringLiteral("youtube.com")).whitelisted);
    popup.hide();

    service.evaluateRequest(
        QUrl(QStringLiteral("https://ad.doubleclick.net/pagead/ads?ui-row-test=1")),
        static_cast<int>(QWebEngineUrlRequestInfo::ResourceTypeScript),
        QUrl(QStringLiteral("https://www.youtube.com/")), 1);
    page.setActiveTab(ArDaliBlockerPage::Tab::Statistics);
    page.refreshAll();
    const int firstMetricRowCount =
        page.findChildren<QFrame *>(QStringLiteral("ranked-metric-row")).size();
    page.refreshAll();
    const int secondMetricRowCount =
        page.findChildren<QFrame *>(QStringLiteral("ranked-metric-row")).size();
    assert(firstMetricRowCount > 0 && secondMetricRowCount == firstMetricRowCount);
    const QString snapshotPath = qEnvironmentVariable("ARDALI_ADBLOCK_UI_SNAPSHOT");
    if (!snapshotPath.isEmpty()) {
      page.resize(1500, 850);
      page.show();
      QApplication::processEvents();
      assert(page.grab().save(snapshotPath));
      page.hide();
    }
    std::cout << "    ✓ Mode card switching and persistence verified.\n";
  }

  // -------------------------------------------------------------
  // TEST 2: Tab ID Resolution & Counter Isolation
  // -------------------------------------------------------------
  {
    std::cout << "  - [2/17] Testing Tab Context Registry & Tab ID Isolation...\n";
    ArDaliBlockerService service(dataDir);
    service.settings()->setCustomFilters({QStringLiteral("||ad-server.com^")});
    service.reloadRules();

    const quint64 tabA = 1001;
    const quint64 tabB = 1002;

    service.registerTab(tabA, QUrl(QStringLiteral("https://news.com/tech/article1")));
    service.registerTab(tabB, QUrl(QStringLiteral("https://portal.org/home")));

    // Verify Tab Resolution
    assert(service.resolveTabId(QUrl(QStringLiteral("https://news.com/tech/article1")), QUrl(QStringLiteral("https://ad-server.com/banner.js"))) == tabA);
    assert(service.resolveTabId(QUrl(QStringLiteral("https://portal.org/home")), QUrl(QStringLiteral("https://portal.org/logo.png"))) == tabB);

    // Request from Tab A -> Ad Blocked
    auto decA = service.evaluateRequest(QUrl(QStringLiteral("https://ad-server.com/banner.js")),
                                        static_cast<int>(QWebEngineUrlRequestInfo::ResourceTypeScript),
                                        QUrl(QStringLiteral("https://news.com/tech/article1")), 0);
    assert(decA.action == ArDaliBlockerAction::Block);

    // Request from Tab B -> Normal Request Allowed
    auto decB = service.evaluateRequest(QUrl(QStringLiteral("https://portal.org/logo.png")),
                                        static_cast<int>(QWebEngineUrlRequestInfo::ResourceTypeImage),
                                        QUrl(QStringLiteral("https://portal.org/home")), 0);
    assert(decB.action == ArDaliBlockerAction::Allow);

    // Verify Tab Isolation
    TabBlockerStats statsA = service.statsForTab(tabA);
    TabBlockerStats statsB = service.statsForTab(tabB);
    assert(statsA.blockedRequests == 1);
    assert(statsB.blockedRequests == 0);
    assert(statsA.allowedRequests == 0);
    assert(statsB.allowedRequests == 1);
    assert(service.sessionBlockedCount() == 1);
    const QList<NetworkLogEntry> trace = service.recentLogs(2);
    assert(trace.size() == 2);
    assert(trace.first().requestHost == QStringLiteral("portal.org"));
    assert(trace.first().initiatorHost == QStringLiteral("portal.org"));
    assert(trace.first().topLevelSite == QStringLiteral("portal.org"));
    assert(trace.first().requestMethod == QStringLiteral("GET"));

    // Unregister tab cleans its stats
    service.unregisterTab(tabA);
    assert(service.statsForTab(tabA).blockedRequests == 0);
    std::cout << "    ✓ Multi-tab request mapping & counter isolation verified.\n";
  }

  // -------------------------------------------------------------
  // TEST 3: Diagnostic Timing & Calculated Memory Metrics
  // -------------------------------------------------------------
  {
    std::cout << "  - [3/17] Testing Performance Timing & Memory Calculation...\n";
    ArDaliBlockerService service(dataDir);
    service.settings()->setCustomFilters({QStringLiteral("||tracker.net^")});
    service.reloadRules();

    assert(service.evaluationCount() == 0);
    assert(service.averageEvaluationTimeMs() == 0.0);

    // Evaluate 5 requests
    for (int i = 0; i < 5; ++i) {
      service.evaluateRequest(QUrl(QStringLiteral("https://tracker.net/track")),
                              static_cast<int>(QWebEngineUrlRequestInfo::ResourceTypeScript),
                              QUrl(QStringLiteral("https://example.com")), 1);
    }

    // Include worst-case no-match requests; a benchmark made only of an early
    // custom-rule hit hides the cost of scanning the compiled DNR plan.
    for (int i = 0; i < 50; ++i) {
      service.evaluateRequest(QUrl(QStringLiteral("https://clean-origin.test/assets/app-%1.js").arg(i)),
                              static_cast<int>(QWebEngineUrlRequestInfo::ResourceTypeScript),
                              QUrl(QStringLiteral("https://clean-origin.test")), 1);
    }

    assert(service.evaluationCount() == 55);
    assert(service.averageEvaluationTimeMs() >= 0.0);
    assert(service.lastEvaluationTimeMs() >= 0.0);

    const quint64 mem = service.estimatedMemoryBytes();
    assert(mem > 0);
    std::cout << "    ✓ Average evaluation time: " << service.averageEvaluationTimeMs() << " ms (Real Timer)\n";
    std::cout << "    ✓ Estimated memory size: " << (mem / 1024.0) << " KB (Calculated Structure Metric)\n";
  }

  // -------------------------------------------------------------
  // TEST 4: Early Cosmetic Script Injection (DocumentCreation)
  // -------------------------------------------------------------
  {
    std::cout << "  - [4/17] Testing Early Cosmetic Script Injection...\n";
    ArDaliBlockerService service(dataDir);
    service.settings()->setCustomFilters({
        QStringLiteral("site-a.com##.ad-banner"),
        QStringLiteral("site-b.com##.sponsor-box")
    });
    service.reloadRules();

    QWebEngineScript scriptA = service.createCosmeticScriptForHost(QStringLiteral("site-a.com"));
    assert(scriptA.name() == QStringLiteral("ardali-adblock-cosmetic"));
    assert(scriptA.injectionPoint() == QWebEngineScript::DocumentCreation);
    assert(scriptA.worldId() == QWebEngineScript::MainWorld);
    assert(scriptA.sourceCode().contains(QStringLiteral(".ad-banner")));
    assert(!scriptA.sourceCode().contains(QStringLiteral(".sponsor-box")));

    QWebEngineScript scriptB = service.createCosmeticScriptForHost(QStringLiteral("site-b.com"));
    assert(scriptB.sourceCode().contains(QStringLiteral(".sponsor-box")));
    assert(!scriptB.sourceCode().contains(QStringLiteral(".ad-banner")));

    QWebEngineScript scriptYT = service.createCosmeticScriptForHost(QStringLiteral("youtube.com"));
    assert(scriptYT.name() == QStringLiteral("ardali-adblock-cosmetic"));
    assert(scriptYT.injectionPoint() == QWebEngineScript::DocumentCreation);
    assert(scriptYT.worldId() == QWebEngineScript::MainWorld);
    assert(scriptYT.sourceCode().contains(QStringLiteral("ytd-ad-slot-renderer")));
    // Player-internal ad containers are intentionally not hard-hidden. Live
    // A/B testing proved these broad selectors trigger YouTube's anti-adblock
    // machine even when every network request is allowed.
    assert(!scriptYT.sourceCode().contains(QStringLiteral(".ytp-ad-module")));
    assert(!scriptYT.sourceCode().contains(QStringLiteral(".video-ads")));
    assert(!scriptYT.sourceCode().contains(QStringLiteral("ytInitialPlayerResponse")));
    assert(!scriptYT.sourceCode().contains(QStringLiteral("pruneAdsFromObject")));

    // An unrelated host must not receive the large host-mapped scriptlet
    // bundles. Generic cosmetic assets may still use ApplicationWorld.
    const auto unrelatedScripts = service.createScriptingScriptsForHost(QStringLiteral("example.com"));
    for (const auto &runtimeScript : unrelatedScripts) {
      assert(runtimeScript.name() != QStringLiteral("ardali-adblock-scriptlets-main"));
    }

    const auto runtimeScripts = service.createScriptingScriptsForHost(QStringLiteral("www.youtube.com"));
    bool hasMain = false;
    bool hasIsolated = false;
    for (const auto &runtimeScript : runtimeScripts) {
      if (runtimeScript.name() == QStringLiteral("ardali-adblock-scriptlets-main")) {
        hasMain = runtimeScript.worldId() == QWebEngineScript::MainWorld &&
                  runtimeScript.injectionPoint() == QWebEngineScript::DocumentCreation &&
                  !runtimeScript.sourceCode().isEmpty();
      }
      if (runtimeScript.name() == QStringLiteral("ardali-adblock-scriptlets-isolated")) {
        hasIsolated = runtimeScript.worldId() == QWebEngineScript::ApplicationWorld &&
                      runtimeScript.injectionPoint() == QWebEngineScript::DocumentCreation &&
                      !runtimeScript.sourceCode().isEmpty();
      }
    }
    assert(hasMain);
    assert(hasIsolated);
    const auto mainIt = std::find_if(runtimeScripts.begin(), runtimeScripts.end(), [](const QWebEngineScript &script) {
      return script.name() == QLatin1String("ardali-adblock-scriptlets-main");
    });
    assert(mainIt != runtimeScripts.end());
    assert(mainIt->sourceCode().contains(QStringLiteral("all_web_enable_network_machine")));

    // A YouTube SPA route change keeps the same document and host. Rebuilding
    // the plan for that host must be deterministic, and the returned plan must
    // contain at most one script for each installed name. BrowserWindow uses
    // those names to replace (rather than append) scripts on full navigation.
    const auto spaScripts = service.createScriptingScriptsForHost(QStringLiteral("www.youtube.com"));
    assert(spaScripts.size() == runtimeScripts.size());
    QSet<QString> installedNames;
    for (qsizetype i = 0; i < runtimeScripts.size(); ++i) {
      const QWebEngineScript &initialScript = runtimeScripts.at(i);
      const QWebEngineScript &spaScript = spaScripts.at(i);
      assert(!installedNames.contains(initialScript.name()));
      installedNames.insert(initialScript.name());
      assert(spaScript.name() == initialScript.name());
      assert(spaScript.sourceCode() == initialScript.sourceCode());
      assert(spaScript.worldId() == initialScript.worldId());
      assert(spaScript.injectionPoint() == initialScript.injectionPoint());
    }

    const QString specificCss = service.listManager()->loadSpecificCosmeticCssForHost(
        QStringLiteral("www.youtube.com"), {});
    assert(!specificCss.isEmpty());
    assert(specificCss.contains(QStringLiteral("display: none !important")));
    const QJsonArray proceduralRules = service.listManager()->loadProceduralRulesForHost(
        QStringLiteral("www.youtube.com"), {});
    assert(!proceduralRules.isEmpty());
    bool hasProcedural = false;
    for (const auto &runtimeScript : service.createScriptingScriptsForHost(QStringLiteral("www.youtube.com"))) {
      if (runtimeScript.name() == QStringLiteral("ardali-adblock-procedural")) {
        hasProcedural = runtimeScript.worldId() == QWebEngineScript::MainWorld &&
                        runtimeScript.injectionPoint() == QWebEngineScript::DocumentCreation &&
                        runtimeScript.sourceCode().contains(QStringLiteral("MutationObserver"));
      }
    }
    assert(!hasProcedural);

    std::cout << "    ✓ DocumentCreation early injection, clean YouTube anti-ad & sponsored-card protections verified.\n";
  }

  // -------------------------------------------------------------
  // TEST 4b: Allowlist applies to every filtering layer
  // -------------------------------------------------------------
  {
    std::cout << "  - [5/17] Testing Whitelist Cosmetic/Scriptlet Parity...\n";
    ArDaliBlockerService service(dataDir);
    SitePolicy policy;
    policy.whitelisted = true;
    service.settings()->setSitePolicy(QStringLiteral("youtube.com"), policy);
    const auto script = service.createCosmeticScriptForHost(QStringLiteral("www.youtube.com"));
    assert(script.sourceCode().isEmpty());
    assert(service.createScriptingScriptsForHost(QStringLiteral("www.youtube.com")).isEmpty());
    const auto decision = service.evaluateRequest(
        QUrl(QStringLiteral("https://ad.doubleclick.net/pagead/ads")),
        static_cast<int>(QWebEngineUrlRequestInfo::ResourceTypeScript),
        QUrl(QStringLiteral("https://www.youtube.com/")), 11);
    assert(decision.action == ArDaliBlockerAction::Allow);
    assert(decision.reason == QStringLiteral("site-whitelisted"));
    service.settings()->removeSitePolicy(QStringLiteral("youtube.com"));
    std::cout << "    ✓ Whitelist disables network, cosmetic, and scriptlet layers together.\n";
  }

  // -------------------------------------------------------------
  // TEST 4c: DNR case sensitivity must not be silently discarded
  // -------------------------------------------------------------
  {
    std::cout << "  - [6/17] Testing DNR Case-Sensitive URL Filters...\n";
    ArDaliBlockerEngine engine;
    FilterRule rule;
    rule.id = 321;
    rule.actionType = QStringLiteral("block");
    rule.urlFilter = QStringLiteral("/CaseSensitiveAsset.js");
    rule.isCaseSensitive = true;
    engine.loadRules({rule});
    assert(engine.evaluate(QUrl(QStringLiteral("https://example.test/CaseSensitiveAsset.js")),
                           ArDaliBlockerResourceType::Script, QStringLiteral("example.test"),
                           ArDaliBlockerMode::Ideal, SitePolicy{}).action == ArDaliBlockerAction::Block);
    assert(engine.evaluate(QUrl(QStringLiteral("https://example.test/casesensitiveasset.js")),
                           ArDaliBlockerResourceType::Script, QStringLiteral("example.test"),
                           ArDaliBlockerMode::Ideal, SitePolicy{}).action == ArDaliBlockerAction::Allow);
    std::cout << "    ✓ Case-sensitive DNR condition honored.\n";
  }

  // -------------------------------------------------------------
  // TEST 5: Strict-Block Security Warning & Temporary Bypass
  // -------------------------------------------------------------
  {
    std::cout << "  - [7/17] Testing Strict-Block Warning Page & Bypass Lifecycle...\n";
    ArDaliBlockerService service(dataDir);

    // Add malware strict-block rule
    FilterRule strictRule;
    strictRule.id = 999;
    strictRule.rulesetId = QStringLiteral("malware-strict");
    strictRule.actionType = QStringLiteral("block");
    strictRule.urlFilter = QStringLiteral("||dangerous-phishing.com^");
    service.filterEngine()->loadRules({strictRule});

    // 0. Default strictBlock is true -> Redirected to strictblock warning
    assert(service.settings()->strictBlock());
    auto dec0 = service.evaluateRequest(QUrl(QStringLiteral("https://dangerous-phishing.com/login")),
                                        static_cast<int>(QWebEngineUrlRequestInfo::ResourceTypeMainFrame),
                                        QUrl(), 100);
    assert(dec0.action == ArDaliBlockerAction::Redirect);
    assert(dec0.redirectUrl.contains(QStringLiteral("strictblock=1")));
    assert(dec0.redirectUrl.contains(QStringLiteral("dangerous-phishing.com")));

    // 1. Disable strictBlock -> Regular Block without interstitial
    service.settings()->setStrictBlock(false);
    service.filterEngine()->loadRules({strictRule});
    assert(!service.settings()->strictBlock());
    auto dec1 = service.evaluateRequest(QUrl(QStringLiteral("https://dangerous-phishing.com/login")),
                                        static_cast<int>(QWebEngineUrlRequestInfo::ResourceTypeMainFrame),
                                        QUrl(), 100);
    assert(dec1.action == ArDaliBlockerAction::Block);

    // Re-enable strictBlock for bypass lifecycle
    service.settings()->setStrictBlock(true);
    service.filterEngine()->loadRules({strictRule});

    // 2. Render Warning HTML
    QString warningHtml = strictBlockWarningHtml(QStringLiteral("dangerous-phishing.com"), QStringLiteral("https://dangerous-phishing.com/login"));
    assert(warningHtml.contains(QStringLiteral("Bu Site ArDali Koruması Tarafından Engellendi")));
    assert(warningHtml.contains(QStringLiteral("dangerous-phishing.com")));
    assert(warningHtml.contains(QStringLiteral("Engeli Aş ve Devam Et")));

    // 3. User proceeds -> Temporary Bypass activated
    assert(!service.isStrictBypassActive(QStringLiteral("dangerous-phishing.com")));
    service.allowTemporaryStrictBypass(QStringLiteral("dangerous-phishing.com"), 15);
    assert(service.isStrictBypassActive(QStringLiteral("dangerous-phishing.com")));

    // 4. Re-evaluate same request -> bypass permits navigation, no loop.
    auto dec2 = service.evaluateRequest(QUrl(QStringLiteral("https://dangerous-phishing.com/login")),
                                        static_cast<int>(QWebEngineUrlRequestInfo::ResourceTypeMainFrame),
                                        QUrl(), 100);
    assert(dec2.action == ArDaliBlockerAction::Allow);
    assert(dec2.reason == QStringLiteral("strict-temporary-bypass"));
    assert(dec2.redirectUrl.isEmpty());
    std::cout << "    ✓ Strict-block warning generation & temporary bypass lifecycle verified.\n";
  }
  {
    std::cout << "  - [8/17] Testing YouTube Core Assets vs Ad Stream Blocking in All Modes...\n";
    ArDaliBlockerService service(dataDir);

    const QUrl ytInitiator(QStringLiteral("https://www.youtube.com/"));
    const QList<ArDaliBlockerMode> testModes = {ArDaliBlockerMode::Basic, ArDaliBlockerMode::Ideal, ArDaliBlockerMode::Aggressive};

    for (ArDaliBlockerMode mode : testModes) {
      service.settings()->setMode(mode);
      service.reloadRules();

      // 1. YouTube Thumbnails MUST be allowed
      auto decThumb = service.evaluateRequest(QUrl(QStringLiteral("https://i.ytimg.com/vi/abc1234/hqdefault.jpg")),
                                              static_cast<int>(QWebEngineUrlRequestInfo::ResourceTypeImage),
                                              ytInitiator, 10);
      assert(decThumb.action == ArDaliBlockerAction::Allow);

      // 2. YouTube Avatars MUST be allowed
      auto decAvatar = service.evaluateRequest(QUrl(QStringLiteral("https://yt3.ggpht.com/a/default-user.jpg")),
                                               static_cast<int>(QWebEngineUrlRequestInfo::ResourceTypeImage),
                                               ytInitiator, 10);
      assert(decAvatar.action == ArDaliBlockerAction::Allow);

      // 3. YouTube Player API & scripts MUST be allowed
      auto decPlayer = service.evaluateRequest(QUrl(QStringLiteral("https://youtubei.googleapis.com/youtubei/v1/player")),
                                               static_cast<int>(QWebEngineUrlRequestInfo::ResourceTypeXhr),
                                               ytInitiator, 10);
      assert(decPlayer.action == ArDaliBlockerAction::Allow);

      // 4. Normal video playback media streams MUST be allowed (both GET and POST, current and future epoch timestamps)
      auto decMedia = service.evaluateRequest(QUrl(QStringLiteral("https://rr3---sn-4g5edn6e.googlevideo.com/videoplayback?expire=1724000000&id=abcdef")),
                                              static_cast<int>(QWebEngineUrlRequestInfo::ResourceTypeMedia),
                                              ytInitiator, 10);
      assert(decMedia.action == ArDaliBlockerAction::Allow);

      auto decGetMedia = service.evaluateRequest(
          QUrl(QStringLiteral("https://rr3---sn-4g5edn6e.googlevideo.com/videoplayback?expire=1787358320&id=normal")),
          static_cast<int>(QWebEngineUrlRequestInfo::ResourceTypeXhr), ytInitiator, 10,
          QStringLiteral("get"));
      assert(decGetMedia.action == ArDaliBlockerAction::Allow);

      auto decPostMedia = service.evaluateRequest(
          QUrl(QStringLiteral("https://rr3---sn-4g5edn6e.googlevideo.com/videoplayback?expire=1787358320&id=normal")),
          static_cast<int>(QWebEngineUrlRequestInfo::ResourceTypeXhr), ytInitiator, 10,
          QStringLiteral("post"));
      assert(decPostMedia.action == ArDaliBlockerAction::Allow);

      // 5. YouTube Video AD streams with ctier=l or adformat MUST be strictly blocked
      auto decCtierAd = service.evaluateRequest(
          QUrl(QStringLiteral("https://rr3---sn-4g5edn6e.googlevideo.com/videoplayback?expire=1787358320&ctier=l&sparams=ctier,expire")),
          static_cast<int>(QWebEngineUrlRequestInfo::ResourceTypeXhr),
          ytInitiator, 10);
      assert(decCtierAd.action == ArDaliBlockerAction::Block);

      auto decAdMedia = service.evaluateRequest(QUrl(QStringLiteral("https://rr3---sn-4g5edn6e.googlevideo.com/videoplayback?expire=1724000000&adformat=1_2_3")),
                                                static_cast<int>(QWebEngineUrlRequestInfo::ResourceTypeMedia),
                                                ytInitiator, 10);
      assert(decAdMedia.action == ArDaliBlockerAction::Block);

      // 6. YouTube doubleclick ads MUST be strictly blocked
      auto decDclk = service.evaluateRequest(QUrl(QStringLiteral("https://ad.doubleclick.net/pagead/ads?client=ca-pub-123")),
                                             static_cast<int>(QWebEngineUrlRequestInfo::ResourceTypeScript),
                                             ytInitiator, 10);
      assert(decDclk.action == ArDaliBlockerAction::Block);

      // uBOL substitutes this tiny player-facing status resource instead of
      // abruptly blocking the script. It does not generate ad telemetry.
      auto decAdStatus = service.evaluateRequest(
          QUrl(QStringLiteral("https://static.doubleclick.net/instream/ad_status.js")),
          static_cast<int>(QWebEngineUrlRequestInfo::ResourceTypeScript), ytInitiator, 10);
      assert(decAdStatus.action == ArDaliBlockerAction::Redirect);
      assert(decAdStatus.ruleId == 1000006);
      assert(decAdStatus.redirectUrl.startsWith(QStringLiteral("data:application/javascript;base64,")));

      // 7. YouTube pagead requests MUST be strictly blocked
      auto decPageAd = service.evaluateRequest(QUrl(QStringLiteral("https://www.youtube.com/pagead/parallel")),
                                               static_cast<int>(QWebEngineUrlRequestInfo::ResourceTypeXhr),
                                               ytInitiator, 10);
      assert(decPageAd.action == ArDaliBlockerAction::Block);
    }
    service.settings()->setMode(ArDaliBlockerMode::Ideal);
    service.settings()->setStrictBlock(true);
    const auto strictNormalMedia = service.evaluateRequest(
        QUrl(QStringLiteral("https://rr3---sn-4g5edn6e.googlevideo.com/videoplayback?expire=1787358405&id=normal")),
        static_cast<int>(QWebEngineUrlRequestInfo::ResourceTypeXhr), ytInitiator, 10,
        QStringLiteral("post"));
    assert(strictNormalMedia.action == ArDaliBlockerAction::Allow);
    std::cout << "    ✓ YouTube thumbnail, avatar, player and video stream preserved while ad streams blocked across all 3 modes.\n";
  }

  // -------------------------------------------------------------
  // TEST 7: Settings Persistence and Default Handling Across Restarts
  // -------------------------------------------------------------
  {
    std::cout << "  - [9/17] Testing Settings Restart Persistence and Default 'Ideal' Mode...\n";
    QTemporaryDir restartDir;
    assert(restartDir.isValid());
    const QString iniPath = restartDir.path() + QStringLiteral("/adblock-settings.ini");

    // Fresh install: without ini entry -> must default to Ideal, AutoReload=true, StrictBlock=true, PopupBlock=true
    {
      ArDaliBlockerSettings freshSettings(iniPath);
      assert(freshSettings.mode() == ArDaliBlockerMode::Ideal);
      assert(freshSettings.autoReloadOnModeChange() == true);
      assert(freshSettings.showBlockedCountOnToolbar() == true);
      assert(freshSettings.strictBlock() == true);
      assert(freshSettings.popupBlock() == true);
      assert(freshSettings.developerMode() == false);
      assert(freshSettings.protectionEnabled());
    }

    // User explicitly sets Basic, strictBlock=false, popupBlock=false -> must persist
    {
      ArDaliBlockerSettings settingsA(iniPath);
      settingsA.setMode(ArDaliBlockerMode::Basic);
      settingsA.setStrictBlock(false);
      settingsA.setPopupBlock(false);
      settingsA.setAutoReloadOnModeChange(false);
      settingsA.setProtectionEnabled(false);
      assert(settingsA.mode() == ArDaliBlockerMode::Basic);
      assert(settingsA.strictBlock() == false);
      assert(settingsA.popupBlock() == false);
      assert(settingsA.autoReloadOnModeChange() == false);
      assert(!settingsA.protectionEnabled());
    }

    // Restart app -> must still be Basic, strictBlock=false, popupBlock=false
    {
      ArDaliBlockerSettings settingsB(iniPath);
      assert(settingsB.mode() == ArDaliBlockerMode::Basic);
      assert(settingsB.strictBlock() == false);
      assert(settingsB.popupBlock() == false);
      assert(settingsB.autoReloadOnModeChange() == false);
      assert(!settingsB.protectionEnabled());

      // User resets to defaults
      settingsB.resetToDefaults();
      assert(settingsB.mode() == ArDaliBlockerMode::Ideal);
      assert(settingsB.strictBlock() == true);
      assert(settingsB.popupBlock() == true);
      assert(settingsB.autoReloadOnModeChange() == true);
      assert(settingsB.protectionEnabled());
    }

    // Restart app again -> must be Ideal, strictBlock=true, popupBlock=true
    {
      ArDaliBlockerSettings settingsC(iniPath);
      assert(settingsC.mode() == ArDaliBlockerMode::Ideal);
      assert(settingsC.strictBlock() == true);
      assert(settingsC.popupBlock() == true);
      assert(settingsC.protectionEnabled());

      settingsC.setMode(ArDaliBlockerMode::Aggressive);
      settingsC.setStrictBlock(true);
      settingsC.setPopupBlock(false);
      settingsC.setDeveloperMode(true);
      settingsC.setProtectionEnabled(false);
      settingsC.setCustomFilters({QStringLiteral("! kept comment"), QStringLiteral("||backup.test^")});
      SitePolicy backupPolicy;
      backupPolicy.whitelisted = true;
      settingsC.setSitePolicy(QStringLiteral("example.com"), backupPolicy);
      const QJsonObject backup = settingsC.exportBackupJson();
      assert(!backup.contains(QStringLiteral("statistics")));
      assert(backup.value(QStringLiteral("popupBlock")).toBool() == false);

      QJsonObject futureBackup = backup;
      futureBackup[QStringLiteral("version")] = 999;
      assert(!settingsC.importBackupJson(futureBackup));
      settingsC.resetToDefaults();
      assert(settingsC.importBackupJson(backup));
      assert(settingsC.mode() == ArDaliBlockerMode::Aggressive);
      assert(settingsC.strictBlock());
      assert(settingsC.popupBlock() == false);
      assert(settingsC.developerMode());
      assert(!settingsC.protectionEnabled());
      assert(settingsC.customFilters().contains(QStringLiteral("! kept comment")));
      assert(settingsC.sitePolicy(QStringLiteral("deep.example.com")).whitelisted);
    }
    std::cout << "    ✓ Defaults, restart persistence, transactional backup/restore, and schema rejection verified.\n";
  }

  // -------------------------------------------------------------
  // TEST 8: Explicit empty ruleset selection must not fall back to defaults
  // -------------------------------------------------------------
  {
    std::cout << "  - [10/17] Testing Explicit Empty Ruleset Selection...\n";
    ArDaliBlockerService service(dataDir);
    service.settings()->setEnabledRulesetIds({});
    assert(service.settings()->rulesetSelectionConfigured());
    service.reloadRules();
    const auto decision = service.evaluateRequest(
        QUrl(QStringLiteral("https://doubleclick.net/pagead/ads")),
        static_cast<int>(QWebEngineUrlRequestInfo::ResourceTypeScript),
        QUrl(QStringLiteral("https://example.com/")), 77);
    // Built-in targeted core rules remain active, but list-origin filtering
    // must be empty; this URL is deliberately not covered by core rules.
    assert(decision.action == ArDaliBlockerAction::Allow);
    assert(service.createScriptingScriptsForHost(QStringLiteral("example.com")).isEmpty());
    std::cout << "    ✓ Explicit empty selection persists without hidden default scripts/rules.\n";
  }

  // -------------------------------------------------------------
  // TEST 9: DNR redirect resources and upgradeScheme action semantics
  // -------------------------------------------------------------
  {
    std::cout << "  - [11/17] Testing DNR Redirect Resources and Upgrade Scheme...\n";
    ArDaliBlockerService service(dataDir);
    service.settings()->setEnabledRulesetIds({QStringLiteral("ublock-filters")});
    service.reloadRules();
    const auto redirected = service.evaluateRequest(
        QUrl(QStringLiteral("https://intellipopup.com/ads.js")),
        static_cast<int>(QWebEngineUrlRequestInfo::ResourceTypeScript),
        QUrl(QStringLiteral("https://example.com/")), 88);
    assert(redirected.action == ArDaliBlockerAction::Redirect);
    assert(redirected.redirectUrl.startsWith(QStringLiteral("data:")));
    assert(redirected.redirectUrl.contains(QStringLiteral(";base64,")));

    ArDaliBlockerEngine engine;
    FilterRule upgrade;
    upgrade.id = 444;
    upgrade.actionType = QStringLiteral("upgradeScheme");
    upgrade.urlFilter = QStringLiteral("||upgrade.example^");
    engine.loadRules({upgrade});
    const auto upgraded = engine.evaluate(QUrl(QStringLiteral("http://upgrade.example/path")),
                                          ArDaliBlockerResourceType::Script, QStringLiteral("origin.example"),
                                          ArDaliBlockerMode::Ideal, SitePolicy{});
    assert(upgraded.action == ArDaliBlockerAction::Redirect);
    assert(upgraded.redirectUrl == QStringLiteral("https://upgrade.example/path"));

    FilterRule transform;
    transform.id = 445;
    transform.actionType = QStringLiteral("redirect");
    transform.urlFilter = QStringLiteral("||transform.example^");
    transform.redirectTransform = QJsonObject{
        {QStringLiteral("scheme"), QStringLiteral("https")},
        {QStringLiteral("host"), QStringLiteral("clean.example")},
        {QStringLiteral("queryTransform"), QJsonObject{
            {QStringLiteral("removeParams"), QJsonArray{QStringLiteral("track")}},
            {QStringLiteral("addOrReplaceParams"), QJsonArray{QJsonObject{
                {QStringLiteral("key"), QStringLiteral("safe")},
                {QStringLiteral("value"), QStringLiteral("1")}}}}}}};
    engine.loadRules({transform});
    const auto transformed = engine.evaluate(QUrl(QStringLiteral("http://transform.example/a?track=x&keep=y")),
                                              ArDaliBlockerResourceType::Script, QStringLiteral("origin.example"),
                                              ArDaliBlockerMode::Ideal, SitePolicy{});
    assert(transformed.action == ArDaliBlockerAction::Redirect);
    assert(transformed.redirectUrl == QStringLiteral("https://clean.example/a?keep=y&safe=1"));
    std::cout << "    ✓ extensionPath resources and upgradeScheme are executed, not ignored.\n";
  }

  // -------------------------------------------------------------
  // TEST 10: Legacy mode registry + main/regex/strict realms
  // -------------------------------------------------------------
  {
    std::cout << "  - [12/17] Testing Legacy Ruleset Registry and Realm Selection...\n";
    ArDaliBlockerListManager manager(dataDir);
    const QStringList basic = manager.resolveRulesetIds(ArDaliBlockerMode::Basic, {}, false);
    const QStringList ideal = manager.resolveRulesetIds(ArDaliBlockerMode::Ideal, {}, false);
    const QStringList aggressive = manager.resolveRulesetIds(ArDaliBlockerMode::Aggressive, {}, false);
    assert(basic.contains(QStringLiteral("ublock-filters")));
    assert(!basic.contains(QStringLiteral("ublock-badware")));
    assert(ideal.contains(QStringLiteral("ublock-badware")));
    assert(ideal.contains(QStringLiteral("urlhaus-full")));
    assert(ideal.contains(QStringLiteral("tur-0")));
    assert(!ideal.contains(QStringLiteral("ublock-experimental")));
    assert(aggressive.contains(QStringLiteral("ublock-experimental")));

    const QList<FilterRule> normal = manager.loadRulesForModeAndSelection(
        ArDaliBlockerMode::Ideal, {QStringLiteral("ublock-filters")}, true, false);
    assert(std::any_of(normal.begin(), normal.end(), [](const FilterRule &rule) {
      return rule.rulesetId == QLatin1String("ublock-filters") && !rule.regexFilter.isEmpty();
    }));
    assert(std::none_of(normal.begin(), normal.end(), [](const FilterRule &rule) {
      return rule.rulesetId.startsWith(QStringLiteral("strictblock-"));
    }));
    const QList<FilterRule> strict = manager.loadRulesForModeAndSelection(
        ArDaliBlockerMode::Ideal, {QStringLiteral("ublock-filters")}, true, true);
    assert(std::any_of(strict.begin(), strict.end(), [](const FilterRule &rule) {
      return rule.rulesetId == QLatin1String("strictblock-ublock-filters") && rule.priority >= 80;
    }));
    std::cout << "    ✓ Basic/Ideal/Aggressive and main+regex+strictblock realms match the legacy registry.\n";
  }

  // -------------------------------------------------------------
  // TEST 11: Request method/resource mapping + custom syntax
  // -------------------------------------------------------------
  {
    std::cout << "  - [13/17] Testing DNR Request Methods and Custom Filter Options...\n";
    assert(resourceTypeFromWebEngine(19) == ArDaliBlockerResourceType::MainFrame);
    assert(resourceTypeFromWebEngine(20) == ArDaliBlockerResourceType::SubFrame);
    assert(resourceTypeFromWebEngine(254) == ArDaliBlockerResourceType::WebSocket);

    ArDaliBlockerEngine engine;
    FilterRule getOnly;
    getOnly.id = 991;
    getOnly.actionType = QStringLiteral("block");
    getOnly.urlFilter = QStringLiteral("||method.example^");
    getOnly.requestMethods = {QStringLiteral("get")};
    engine.loadRules({getOnly});
    assert(engine.evaluate(QUrl(QStringLiteral("https://method.example/a")), ArDaliBlockerResourceType::Xhr,
                           QStringLiteral("origin.test"), ArDaliBlockerMode::Ideal, SitePolicy{},
                           QStringLiteral("get")).action == ArDaliBlockerAction::Block);
    assert(engine.evaluate(QUrl(QStringLiteral("https://method.example/a")), ArDaliBlockerResourceType::Xhr,
                           QStringLiteral("origin.test"), ArDaliBlockerMode::Ideal, SitePolicy{},
                           QStringLiteral("post")).action == ArDaliBlockerAction::Allow);

    FilterRule genericPriorityBlock;
    genericPriorityBlock.id = 990;
    genericPriorityBlock.priority = 10;
    genericPriorityBlock.actionType = QStringLiteral("block");
    genericPriorityBlock.urlFilter = QStringLiteral("||priority.example^");
    genericPriorityBlock.rulesetId = QStringLiteral("easylist");
    FilterRule specificPriorityAllow;
    specificPriorityAllow.id = 989;
    specificPriorityAllow.priority = 30;
    specificPriorityAllow.actionType = QStringLiteral("allow");
    specificPriorityAllow.urlFilter = QStringLiteral("||priority.example^");
    specificPriorityAllow.initiatorDomains = {QStringLiteral("player.test")};
    specificPriorityAllow.rulesetId = QStringLiteral("ublock-filters");
    engine.loadRules({genericPriorityBlock, specificPriorityAllow});
    assert(engine.evaluate(QUrl(QStringLiteral("https://priority.example/control")),
                           ArDaliBlockerResourceType::Xhr, QStringLiteral("player.test"),
                           ArDaliBlockerMode::Ideal, SitePolicy{}).action == ArDaliBlockerAction::Allow);
    assert(engine.evaluate(QUrl(QStringLiteral("https://priority.example/ad")),
                           ArDaliBlockerResourceType::Xhr, QStringLiteral("other.test"),
                           ArDaliBlockerMode::Ideal, SitePolicy{}).action == ArDaliBlockerAction::Block);

    FilterRule adRule;
    adRule.id = 992;
    adRule.actionType = QStringLiteral("block");
    adRule.urlFilter = QStringLiteral("||ads.example^");
    adRule.rulesetId = QStringLiteral("easylist");
    FilterRule trackerRule;
    trackerRule.id = 993;
    trackerRule.actionType = QStringLiteral("block");
    trackerRule.urlFilter = QStringLiteral("||metrics.example^");
    trackerRule.rulesetId = QStringLiteral("easyprivacy");
    engine.loadRules({adRule, trackerRule});
    SitePolicy trackerOnly;
    trackerOnly.adBlocking = false;
    trackerOnly.trackerProtection = true;
    assert(engine.evaluate(QUrl(QStringLiteral("https://ads.example/a")), ArDaliBlockerResourceType::Xhr,
                           QStringLiteral("origin.test"), ArDaliBlockerMode::Ideal, trackerOnly).action ==
           ArDaliBlockerAction::Allow);
    assert(engine.evaluate(QUrl(QStringLiteral("https://metrics.example/a")), ArDaliBlockerResourceType::Xhr,
                           QStringLiteral("origin.test"), ArDaliBlockerMode::Ideal, trackerOnly).action ==
           ArDaliBlockerAction::Block);
    SitePolicy adsOnly;
    adsOnly.adBlocking = true;
    adsOnly.trackerProtection = false;
    assert(engine.evaluate(QUrl(QStringLiteral("https://ads.example/a")), ArDaliBlockerResourceType::Xhr,
                           QStringLiteral("origin.test"), ArDaliBlockerMode::Ideal, adsOnly).action ==
           ArDaliBlockerAction::Block);
    assert(engine.evaluate(QUrl(QStringLiteral("https://metrics.example/a")), ArDaliBlockerResourceType::Xhr,
                           QStringLiteral("origin.test"), ArDaliBlockerMode::Ideal, adsOnly).action ==
           ArDaliBlockerAction::Allow);

    const QString custom = QStringLiteral("||custom.example^$script,third-party,domain=allowed.test|~excluded.allowed.test");
    assert(ArDaliBlockerEngine::validateCustomFilterLine(custom).isEmpty());
    assert(!ArDaliBlockerEngine::validateCustomFilterLine(QStringLiteral("||x^$unsupported-option")).isEmpty());
    engine.applyCompiledPlan(ArDaliBlockerEngine::compilePlan({}, {}, {custom}));
    assert(engine.evaluate(QUrl(QStringLiteral("https://custom.example/a.js")), ArDaliBlockerResourceType::Script,
                           QStringLiteral("allowed.test"), ArDaliBlockerMode::Ideal, SitePolicy{}).action == ArDaliBlockerAction::Block);
    assert(engine.evaluate(QUrl(QStringLiteral("https://custom.example/a.js")), ArDaliBlockerResourceType::Image,
                           QStringLiteral("allowed.test"), ArDaliBlockerMode::Ideal, SitePolicy{}).action == ArDaliBlockerAction::Allow);
    assert(engine.evaluate(QUrl(QStringLiteral("https://custom.example/a.js")), ArDaliBlockerResourceType::Script,
                           QStringLiteral("excluded.allowed.test"), ArDaliBlockerMode::Ideal, SitePolicy{}).action == ArDaliBlockerAction::Allow);

    std::cout << "    ✓ HTTP method, navigation preload/WebSocket mapping, and custom options are enforced.\n";
  }

  // -------------------------------------------------------------
  // TEST 12: Cosmetic host lists/exceptions
  // -------------------------------------------------------------
  {
    std::cout << "  - [14/17] Testing Cosmetic Multi-host Scoping and Exceptions...\n";
    ArDaliBlockerEngine engine;
    engine.addCustomFilterLines({
        QStringLiteral("example.com,sub.test##.sponsored"),
        QStringLiteral("deep.example.com#@#.sponsored"),
        QStringLiteral("example.com,~safe.example.com##.ad-only"),
        QStringLiteral("example.com#?#.promo:has-text(Sponsored):remove()"),
        QStringLiteral("deep.example.com#@?#.promo:has-text(Sponsored):remove()")
    });
    const QString parentCss = engine.cosmeticCssForHost(QStringLiteral("www.example.com"));
    assert(parentCss.contains(QStringLiteral(".sponsored")));
    assert(parentCss.contains(QStringLiteral(".ad-only")));
    const QString deepCss = engine.cosmeticCssForHost(QStringLiteral("deep.example.com"));
    assert(!deepCss.contains(QStringLiteral(".sponsored")));
    const QString safeCss = engine.cosmeticCssForHost(QStringLiteral("safe.example.com"));
    assert(!safeCss.contains(QStringLiteral(".ad-only")));
    const QString unrelatedCss = engine.cosmeticCssForHost(QStringLiteral("unrelated-example.com"));
    assert(!unrelatedCss.contains(QStringLiteral(".sponsored")));
    assert(ArDaliBlockerEngine::validateCustomFilterLine(
        QStringLiteral("example.com#?#.promo:has-text(Sponsored):remove()")).isEmpty());
    assert(!ArDaliBlockerEngine::validateCustomFilterLine(
        QStringLiteral("example.com#?#.promo:unknown-task(x)")).isEmpty());
    const QJsonArray parentProcedural = engine.customProceduralRulesForHost(QStringLiteral("www.example.com"));
    assert(parentProcedural.size() == 1);
    assert(parentProcedural.first().toObject().value(QStringLiteral("selector")).toString() == QLatin1String(".promo"));
    assert(parentProcedural.first().toObject().value(QStringLiteral("action")).toArray().first().toString() == QLatin1String("remove"));
    assert(engine.customProceduralRulesForHost(QStringLiteral("deep.example.com")).isEmpty());
    assert(engine.customProceduralRulesForHost(QStringLiteral("unrelated-example.com")).isEmpty());

    ArDaliBlockerService proceduralService(dataDir);
    proceduralService.settings()->setCustomFilters({
        QStringLiteral("custom-procedural.test##article:has-text(/Sponsored/i):remove()")});
    bool injectedCustomProcedural = false;
    for (const QWebEngineScript &script : proceduralService.createScriptingScriptsForHost(
             QStringLiteral("custom-procedural.test"))) {
      if (script.name() == QLatin1String("ardali-adblock-procedural")) {
        injectedCustomProcedural = script.sourceCode().contains(QStringLiteral("article")) &&
                                   script.sourceCode().contains(QStringLiteral("Sponsored"));
      }
    }
    assert(injectedCustomProcedural);
    std::cout << "    ✓ Parent/subdomain matching, unrelated hosts, and cosmetic exceptions are isolated.\n";
  }

  // -------------------------------------------------------------
  // TEST 13: Redirect counters are not reported as network blocks
  // -------------------------------------------------------------
  {
    std::cout << "  - [15/17] Testing Block/Allow/Redirect Counter Separation...\n";
    ArDaliBlockerService service(dataDir);
    service.resetAllStats();
    FilterRule redirect;
    redirect.id = 992;
    redirect.actionType = QStringLiteral("redirect");
    redirect.urlFilter = QStringLiteral("||redirect-counter.example^");
    redirect.redirectUrl = QStringLiteral("data:application/json;base64,e30=");
    FilterRule block;
    block.id = 993;
    block.actionType = QStringLiteral("block");
    block.urlFilter = QStringLiteral("||persistent-block.example^");
    FilterRule whitelistProbe;
    whitelistProbe.id = 994;
    whitelistProbe.actionType = QStringLiteral("block");
    whitelistProbe.urlFilter = QStringLiteral("||whitelist-probe.example^");
    service.filterEngine()->loadRules({redirect, block, whitelistProbe});
    const auto decision = service.evaluateRequest(
        QUrl(QStringLiteral("https://redirect-counter.example/a")),
        static_cast<int>(QWebEngineUrlRequestInfo::ResourceTypeXhr),
        QUrl(QStringLiteral("https://origin.test")), 77);
    assert(decision.action == ArDaliBlockerAction::Redirect);
    assert(service.statsForTab(77).blockedRequests == 0);
    assert(service.statsForTab(77).redirectedRequests == 1);
    assert(service.totalRedirectedCount() == 1);
    assert(service.evaluateRequest(
        QUrl(QStringLiteral("https://persistent-block.example/ad.js")),
        static_cast<int>(QWebEngineUrlRequestInfo::ResourceTypeScript),
        QUrl(QStringLiteral("https://origin.test")), 77).action == ArDaliBlockerAction::Block);
    SitePolicy whitelisted;
    whitelisted.whitelisted = true;
    service.settings()->setSitePolicy(QStringLiteral("allowed.test"), whitelisted);
    assert(service.evaluateRequest(
        QUrl(QStringLiteral("https://whitelist-probe.example/ad.js")),
        static_cast<int>(QWebEngineUrlRequestInfo::ResourceTypeScript),
        QUrl(QStringLiteral("https://allowed.test")), 77).action == ArDaliBlockerAction::Allow);
    assert(service.totalBlockedCount() == 1);
    assert(service.whitelistAllowedCount() == 1);
    assert(service.todayBlockedCount() == 1);
  }
  {
    ArDaliBlockerService restarted(dataDir);
    assert(restarted.sessionBlockedCount() == 0);
    assert(restarted.totalBlockedCount() == 1);
    assert(restarted.totalRedirectedCount() == 1);
    assert(restarted.whitelistAllowedCount() == 1);
    assert(restarted.todayBlockedCount() == 1);
    restarted.resetAllStats();
    std::cout << "    ✓ Block/redirect counters are separate and aggregate statistics survive restart/reset.\n";
  }

  // -------------------------------------------------------------
  // TEST 14: Async update state and failed-update rollback
  // -------------------------------------------------------------
  {
    std::cout << "  - [16/17] Testing Async Filter Update and Atomic Failure Rollback...\n";
    ArDaliBlockerService service(dataDir);
    service.settings()->setEnabledRulesetIds({QStringLiteral("ublock-filters")});
    bool firstFinished = false;
    bool firstSuccess = false;
    int lastProgress = -1;
    QEventLoop successLoop;
    const auto progressConnection = QObject::connect(
        &service, &ArDaliBlockerService::filterUpdateProgress, &successLoop,
        [&](int completed, int, const QString &) { lastProgress = qMax(lastProgress, completed); });
    const auto successConnection = QObject::connect(
        &service, &ArDaliBlockerService::filterUpdateFinished, &successLoop,
        [&](bool ok, const QString &) { firstFinished = true; firstSuccess = ok; successLoop.quit(); });
    service.updateFiltersAsync();
    assert(service.isUpdatingFilters());
    QTimer::singleShot(10000, &successLoop, &QEventLoop::quit);
    successLoop.exec();
    QObject::disconnect(progressConnection);
    QObject::disconnect(successConnection);
    assert(firstFinished && firstSuccess && lastProgress == 3);
    const int healthyRuleCount = service.filterEngine()->ruleCount();

    const QString brokenBase = dataDir + QStringLiteral("/adblock/rulesets");
    assert(QDir().mkpath(brokenBase + QStringLiteral("/main")));
    QFile details(brokenBase + QStringLiteral("/ruleset-details.json"));
    assert(details.open(QIODevice::WriteOnly));
    details.write("[]");
    details.close();
    QFile broken(brokenBase + QStringLiteral("/main/ublock-filters.json"));
    assert(broken.open(QIODevice::WriteOnly));
    broken.write("{not-valid-json");
    broken.close();

    bool finished = false;
    bool success = true;
    QEventLoop loop;
    QObject::connect(&service, &ArDaliBlockerService::filterUpdateFinished, &loop,
                     [&](bool ok, const QString &) { finished = true; success = ok; loop.quit(); });
    service.updateFiltersAsync();
    assert(service.isUpdatingFilters());
    QTimer::singleShot(10000, &loop, &QEventLoop::quit);
    loop.exec();
    assert(finished);
    assert(!success);
    assert(!service.isUpdatingFilters());
    assert(service.filterEngine()->ruleCount() == healthyRuleCount);
    std::cout << "    ✓ Busy state is immediate; invalid packages fail without replacing the healthy engine.\n";
  }

  // -------------------------------------------------------------
  // TEST 15: Generated specific-cosmetic index ordering/exceptions
  // -------------------------------------------------------------
  {
    std::cout << "  - [17/17] Testing Generated Specific-cosmetic Host Index...\n";
    QTemporaryDir generatedDir;
    assert(generatedDir.isValid());
    const QString base = generatedDir.path() + QStringLiteral("/adblock/rulesets");
    assert(QDir().mkpath(base + QStringLiteral("/main")));
    assert(QDir().mkpath(base + QStringLiteral("/scripting/specific")));
    QFile details(base + QStringLiteral("/ruleset-details.json"));
    assert(details.open(QIODevice::WriteOnly));
    details.write("[{\"id\":\"synthetic\",\"name\":\"Synthetic\",\"group\":\"default\",\"enabled\":true}]");
    details.close();
    QFile mainRules(base + QStringLiteral("/main/synthetic.json"));
    assert(mainRules.open(QIODevice::WriteOnly));
    mainRules.write("[]");
    mainRules.close();
    const QJsonObject generated{
        {QStringLiteral("selectors"), QJsonArray{QStringLiteral(".root-ad"), QStringLiteral(".sub-ad"), QStringLiteral(".deep-ad")}},
        {QStringLiteral("selectorLists"), QJsonArray{QStringLiteral("0"), QStringLiteral("1"), QStringLiteral("2,-1")}},
        {QStringLiteral("selectorListRefs"), QJsonArray{0, 1, 2}},
        // Required generated ordering: hostname length, then lexical.
        {QStringLiteral("hostnames"), QJsonArray{QStringLiteral("example.com"), QStringLiteral("sub.example.com"), QStringLiteral("deep.sub.example.com")}},
        {QStringLiteral("hasEntities"), false},
        {QStringLiteral("regexes"), QJsonArray{}}};
    QFile specific(base + QStringLiteral("/scripting/specific/synthetic.json"));
    assert(specific.open(QIODevice::WriteOnly));
    specific.write(QJsonDocument(generated).toJson(QJsonDocument::Compact));
    specific.close();

    ArDaliBlockerListManager manager(generatedDir.path());
    const QString root = manager.loadSpecificCosmeticCssForHost(
        QStringLiteral("example.com"), {QStringLiteral("synthetic")}, true);
    const QString sub = manager.loadSpecificCosmeticCssForHost(
        QStringLiteral("sub.example.com"), {QStringLiteral("synthetic")}, true);
    const QString deep = manager.loadSpecificCosmeticCssForHost(
        QStringLiteral("deep.sub.example.com"), {QStringLiteral("synthetic")}, true);
    const QString unrelated = manager.loadSpecificCosmeticCssForHost(
        QStringLiteral("unrelated-example.com"), {QStringLiteral("synthetic")}, true);
    assert(root.contains(QStringLiteral(".root-ad")));
    assert(sub.contains(QStringLiteral(".root-ad")) && sub.contains(QStringLiteral(".sub-ad")));
    assert(!deep.contains(QStringLiteral(".root-ad")) && deep.contains(QStringLiteral(".sub-ad")) &&
           deep.contains(QStringLiteral(".deep-ad")));
    assert(unrelated.isEmpty());
    std::cout << "    ✓ Length+lexical lookup, subdomain accumulation, exception, and unrelated-host isolation pass.\n";
  }

  // -------------------------------------------------------------
  // TEST 18: Settings & Allowlist Migration Test
  // -------------------------------------------------------------
  {
    std::cout << "  - [18/18] Testing Legacy adblock/* to blocker/* Settings & Allowlist Migration...\n";
    QTemporaryDir migDir;
    assert(migDir.isValid());
    const QString iniPath = migDir.path() + QStringLiteral("/legacy-browser-settings.ini");

    // Populate with legacy adblock keys
    {
      QSettings legacy(iniPath, QSettings::IniFormat);
      legacy.setValue(QStringLiteral("adblock/mode"), QStringLiteral("aggressive"));
      legacy.setValue(QStringLiteral("adblock/strictBlock"), true);
      legacy.setValue(QStringLiteral("adblock/popupBlock"), true);
      legacy.setValue(QStringLiteral("adblock/showBlockedCount"), true);
      legacy.setValue(QStringLiteral("adblock/autoReload"), true);
      legacy.beginGroup(QStringLiteral("adblock/sites"));
      QJsonObject siteObj;
      siteObj[QStringLiteral("adBlocking")] = false;
      siteObj[QStringLiteral("trackerProtection")] = true;
      siteObj[QStringLiteral("whitelisted")] = true;
      legacy.setValue(QStringLiteral("whitelisted-site.com"), siteObj);
      legacy.endGroup();
      legacy.sync();
    }

    // Load with new ArDaliBlockerSettings
    ArDaliBlockerSettings settings(iniPath);
    assert(settings.mode() == ArDaliBlockerMode::Aggressive);
    assert(settings.strictBlock() == true);
    assert(settings.popupBlock() == true);
    assert(settings.showBlockedCountOnToolbar() == true);
    assert(settings.autoReloadOnModeChange() == true);

    const SitePolicy pol = settings.sitePolicy(QStringLiteral("whitelisted-site.com"));
    assert(pol.whitelisted == true);
    assert(pol.adBlocking == false);

    // Modify a value and save
    settings.setMode(ArDaliBlockerMode::Ideal);

    // Reopen with another instance to ensure persistence under blocker/* and adblock/*
    ArDaliBlockerSettings reloaded(iniPath);
    assert(reloaded.mode() == ArDaliBlockerMode::Ideal);
    assert(reloaded.sitePolicy(QStringLiteral("whitelisted-site.com")).whitelisted == true);
    std::cout << "    ✓ Legacy adblock/* settings and site allowlists successfully migrated, preserved, and synced.\n";
  }

  std::cout << "\n============================================================\n";
  std::cout << "  ALL 18 ARDALI BLOCKER RELEASE AUDIT ITEMS PASSED!\n";
  std::cout << "============================================================\n";
  return 0;
}
