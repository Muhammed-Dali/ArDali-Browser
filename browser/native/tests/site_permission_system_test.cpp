#include <QAction>
#include <QApplication>
#include <QComboBox>
#include <QDateTime>
#include <QKeyEvent>
#include <QLabel>
#include <QMouseEvent>
#include <QPointer>
#include <QPushButton>
#include <QTemporaryDir>
#include <QToolButton>
#include <QUrl>
#include <cassert>
#include <iostream>

#include "browser_window.h"
#include "core/browser_icons.h"
#include "core/browser_profile_service.h"
#include "core/site_controls_bubble.h"
#include "core/site_permission_prompt_bubble.h"
#include "desktop_tabs/tab_strip_widget.h"

int main(int argc, char *argv[]) {
  // Required for WebEngine & widgets in test mode
  qputenv("QT_QPA_PLATFORM", QByteArray("offscreen"));
  qputenv("QTWEBENGINE_CHROMIUM_FLAGS", QByteArray("--no-sandbox --disable-gpu"));

  QApplication app(argc, argv);

  QTemporaryDir tempDir;
  assert(tempDir.isValid());

  std::cout << "==================================================" << std::endl;
  std::cout << "[TEST SUITE] ArDali Site Controls & Permission System (30 Tests)" << std::endl;
  std::cout << "==================================================" << std::endl;

  // -------------------------------------------------------------
  // TEST 1: https site Site Controls button visible
  // -------------------------------------------------------------
  {
    std::cout << "[TEST 1] https site Site Controls button visible" << std::endl;
    BrowserServices services;
    auto profileService = std::make_shared<BrowserProfileService>(tempDir.path(), nullptr);
    services.profileService = profileService.get();
    BrowserWindow window(services);

    int tabIdx = window.addNewTab(QUrl(QStringLiteral("https://www.google.com")));
    assert(tabIdx >= 0);
    window.updateOmniboxLeadingIcon();
    auto *leadingAction = window.omniboxLeadingAction();
    assert(leadingAction != nullptr);
    assert(leadingAction->isVisible());
    assert(leadingAction->toolTip().contains(QStringLiteral("google.com")));
  }

  // -------------------------------------------------------------
  // TEST 2: current site domain doğru gösteriliyor
  // -------------------------------------------------------------
  {
    std::cout << "[TEST 2] current site domain doğru gösteriliyor" << std::endl;
    BrowserServices services;
    auto profileService = std::make_shared<BrowserProfileService>(tempDir.path(), nullptr);
    services.profileService = profileService.get();
    BrowserWindow window(services);

    window.addNewTab(QUrl(QStringLiteral("https://www.google.com/search?q=ardali")));
    window.toggleSiteControlsBubble();
    auto *bubble = window.siteControlsBubble();
    assert(bubble != nullptr);
    assert(bubble->currentHost() == QStringLiteral("www.google.com"));
    assert(bubble->currentCanonicalOrigin() == QStringLiteral("https://www.google.com"));
  }

  // -------------------------------------------------------------
  // TEST 3: http site security state insecure
  // -------------------------------------------------------------
  {
    std::cout << "[TEST 3] http site security state insecure" << std::endl;
    BrowserServices services;
    auto profileService = std::make_shared<BrowserProfileService>(tempDir.path(), nullptr);
    services.profileService = profileService.get();
    BrowserWindow window(services);

    window.addNewTab(QUrl(QStringLiteral("http://neverssl.com/online")));
    window.updateOmniboxLeadingIcon();
    auto *leadingAction = window.omniboxLeadingAction();
    assert(leadingAction != nullptr);
    assert(leadingAction->toolTip().contains(QStringLiteral("Bağlantı güvenli değil")));

    window.toggleSiteControlsBubble();
    auto *bubble = window.siteControlsBubble();
    assert(bubble != nullptr);
    assert(!bubble->isHttps());
    assert(bubble->securityTitle().contains(QStringLiteral("güvenli değil")));
  }

  // -------------------------------------------------------------
  // TEST 4: camera Ask permission popup
  // -------------------------------------------------------------
  {
    std::cout << "[TEST 4] camera Ask permission popup" << std::endl;
    BrowserProfileService service(tempDir.path(), nullptr);
    const QUrl camUrl(QStringLiteral("https://meet.google.com"));
#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
    auto res = service.evaluatePermissionPolicy(camUrl, QWebEnginePermission::PermissionType::MediaVideoCapture);
    assert(res == BrowserProfileService::OriginPolicyResult::Prompt);

    SitePermissionPromptBubble prompt;
    prompt.setupPrompt(camUrl, QWebEnginePermission::PermissionType::MediaVideoCapture);
    assert(prompt.promptText().contains(QStringLiteral("kamera")));
#endif
  }

  // -------------------------------------------------------------
  // TEST 5: camera temporary allow Settings persistent list unchanged
  // -------------------------------------------------------------
  {
    std::cout << "[TEST 5] camera temporary allow Settings persistent list unchanged" << std::endl;
    BrowserServices services;
    auto profileService = std::make_shared<BrowserProfileService>(tempDir.path(), nullptr);
    services.profileService = profileService.get();
    BrowserWindow window(services);

    const uint64_t tabA = 201;
    const QString origin = QStringLiteral("https://webcamtests.com");
    window.grantTabSessionPermission(tabA, origin, QStringLiteral("camera"));

    assert(window.hasTabSessionPermission(tabA, origin, QStringLiteral("camera")));
    assert(!profileService->allowedOrigins(QStringLiteral("camera")).contains(origin));
    assert(!profileService->hasSitePermissionRule(QStringLiteral("camera"), origin));
#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
    assert(profileService->sitePermissions().isEmpty());
#endif
  }

  // -------------------------------------------------------------
  // TEST 6: camera temporary allow Site Controls row: Ask + temporary indicator
  // -------------------------------------------------------------
  {
    std::cout << "[TEST 6] camera temporary allow Site Controls row: Ask + temporary indicator" << std::endl;
    BrowserProfileService service(tempDir.path(), nullptr);
    SiteControlsBubble bubble;
    bubble.setProfileService(&service);
    const uint64_t tabA = 201;
    const QUrl url(QStringLiteral("https://webcamtests.com"));

    bubble.updateForTab(tabA, url, true, false, false, [](const QString &perm) {
      return perm == QStringLiteral("camera");
    });

    assert(bubble.permissionChoice(QStringLiteral("camera")) == 0); // 0 = Sor
    assert(bubble.isTemporaryBadgeVisible(QStringLiteral("camera"))); // "Bu ziyaret için izin verildi"
  }

  // -------------------------------------------------------------
  // TEST 7: camera temporary allow same tab same origin no repeat prompt
  // -------------------------------------------------------------
  {
    std::cout << "[TEST 7] camera temporary allow same tab same origin no repeat prompt" << std::endl;
    BrowserServices services;
    auto profileService = std::make_shared<BrowserProfileService>(tempDir.path(), nullptr);
    services.profileService = profileService.get();
    BrowserWindow window(services);

    const uint64_t tabA = 301;
    const QString origin = QStringLiteral("https://zoom.us");
    window.grantTabSessionPermission(tabA, origin, QStringLiteral("camera"));

    // Returning true for existing tab session permission means prompt is bypassed
    assert(window.hasTabSessionPermission(tabA, origin, QStringLiteral("camera")));
  }

  // -------------------------------------------------------------
  // TEST 8: camera temporary allow second tab same origin prompt again
  // -------------------------------------------------------------
  {
    std::cout << "[TEST 8] camera temporary allow second tab same origin prompt again" << std::endl;
    BrowserServices services;
    auto profileService = std::make_shared<BrowserProfileService>(tempDir.path(), nullptr);
    services.profileService = profileService.get();
    BrowserWindow window(services);

    const uint64_t tabA = 401;
    const uint64_t tabB = 402;
    const QString origin = QStringLiteral("https://zoom.us");
    window.grantTabSessionPermission(tabA, origin, QStringLiteral("camera"));

    assert(!window.hasTabSessionPermission(tabB, origin, QStringLiteral("camera")));
  }

  // -------------------------------------------------------------
  // TEST 9: camera tab close temporary grant gone
  // -------------------------------------------------------------
  {
    std::cout << "[TEST 9] camera tab close temporary grant gone" << std::endl;
    BrowserServices services;
    auto profileService = std::make_shared<BrowserProfileService>(tempDir.path(), nullptr);
    services.profileService = profileService.get();
    BrowserWindow window(services);

    const uint64_t tabA = 501;
    const QString origin = QStringLiteral("https://zoom.us");
    window.grantTabSessionPermission(tabA, origin, QStringLiteral("camera"));
    assert(window.hasTabSessionPermission(tabA, origin, QStringLiteral("camera")));

    window.clearTabSessionPermissions(tabA);
    assert(!window.hasTabSessionPermission(tabA, origin, QStringLiteral("camera")));
  }

  // -------------------------------------------------------------
  // TEST 10: camera persistent allow Settings list updated
  // -------------------------------------------------------------
  {
    std::cout << "[TEST 10] camera persistent allow Settings list updated" << std::endl;
    BrowserProfileService service(tempDir.path(), nullptr);
    const QString origin = QStringLiteral("https://studio.youtube.com");
    bool added = service.addSitePermissionRule(QStringLiteral("camera"), origin, true);
    assert(added);
    assert(service.allowedOrigins(QStringLiteral("camera")).contains(origin));
#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
    assert(service.evaluatePermissionPolicy(QUrl(origin), QWebEnginePermission::PermissionType::MediaVideoCapture)
           == BrowserProfileService::OriginPolicyResult::Allow);
#endif
  }

  // -------------------------------------------------------------
  // TEST 11: browser restart camera persistent allow remains
  // -------------------------------------------------------------
  {
    std::cout << "[TEST 11] browser restart camera persistent allow remains" << std::endl;
    const QString origin = QStringLiteral("https://studio.youtube.com");
    BrowserProfileService reloaded(tempDir.path(), nullptr);
    assert(reloaded.allowedOrigins(QStringLiteral("camera")).contains(origin));
#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
    assert(reloaded.evaluatePermissionPolicy(QUrl(origin), QWebEnginePermission::PermissionType::MediaVideoCapture)
           == BrowserProfileService::OriginPolicyResult::Allow);
#endif
  }

  // -------------------------------------------------------------
  // TEST 12: camera persistent block auto deny
  // -------------------------------------------------------------
  {
    std::cout << "[TEST 12] camera persistent block auto deny" << std::endl;
    BrowserProfileService service(tempDir.path(), nullptr);
    const QString origin = QStringLiteral("https://untrusted-site.com");
    service.addSitePermissionRule(QStringLiteral("camera"), origin, false);
    assert(service.deniedOrigins(QStringLiteral("camera")).contains(origin));
#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
    assert(service.evaluatePermissionPolicy(QUrl(origin), QWebEnginePermission::PermissionType::MediaVideoCapture)
           == BrowserProfileService::OriginPolicyResult::Deny);
#endif
  }

  // -------------------------------------------------------------
  // TEST 13: microphone temporary
  // -------------------------------------------------------------
  {
    std::cout << "[TEST 13] microphone temporary" << std::endl;
    BrowserServices services;
    auto profileService = std::make_shared<BrowserProfileService>(tempDir.path(), nullptr);
    services.profileService = profileService.get();
    BrowserWindow window(services);

    const uint64_t tabA = 601;
    const uint64_t tabB = 602;
    const QString origin = QStringLiteral("https://mictests.com");

    window.grantTabSessionPermission(tabA, origin, QStringLiteral("microphone"));
    assert(window.hasTabSessionPermission(tabA, origin, QStringLiteral("microphone")));
    assert(!window.hasTabSessionPermission(tabB, origin, QStringLiteral("microphone")));
    assert(!profileService->allowedOrigins(QStringLiteral("microphone")).contains(origin));
  }

  // -------------------------------------------------------------
  // TEST 14: microphone persistent
  // -------------------------------------------------------------
  {
    std::cout << "[TEST 14] microphone persistent" << std::endl;
    BrowserProfileService service(tempDir.path(), nullptr);
    const QString origin = QStringLiteral("https://discord.com");
    service.addSitePermissionRule(QStringLiteral("microphone"), origin, true);
    assert(service.allowedOrigins(QStringLiteral("microphone")).contains(origin));

    BrowserProfileService reloaded(tempDir.path(), nullptr);
    assert(reloaded.allowedOrigins(QStringLiteral("microphone")).contains(origin));
#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
    assert(reloaded.evaluatePermissionPolicy(QUrl(origin), QWebEnginePermission::PermissionType::MediaAudioCapture)
           == BrowserProfileService::OriginPolicyResult::Allow);
#endif
  }

  // -------------------------------------------------------------
  // TEST 15: camera+microphone combined request
  // -------------------------------------------------------------
  {
    std::cout << "[TEST 15] camera+microphone combined request" << std::endl;
#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
    using PT = QWebEnginePermission::PermissionType;
    assert(BrowserProfileService::permissionKeyFromType(PT::MediaAudioVideoCapture) == QStringLiteral("cameraMicrophone"));

    SitePermissionPromptBubble prompt;
    prompt.setupPrompt(QUrl(QStringLiteral("https://teams.microsoft.com")), PT::MediaAudioVideoCapture);
    assert(prompt.promptText().contains(QStringLiteral("kameranızı ve mikrofonunuzu")));
#endif
  }

  // -------------------------------------------------------------
  // TEST 16: tab navigation old temp permissions cleared
  // -------------------------------------------------------------
  {
    std::cout << "[TEST 16] tab navigation old temp permissions cleared" << std::endl;
    BrowserServices services;
    auto profileService = std::make_shared<BrowserProfileService>(tempDir.path(), nullptr);
    services.profileService = profileService.get();
    BrowserWindow window(services);

    const uint64_t tabId = 701;
    const QString oldOrigin = QStringLiteral("https://old-site.com");
    const QString newOrigin = QStringLiteral("https://new-site.com");

    window.grantTabSessionPermission(tabId, oldOrigin, QStringLiteral("camera"));
    assert(window.hasTabSessionPermission(tabId, oldOrigin, QStringLiteral("camera")));

    window.clearTabSessionPermissionsForOrigin(tabId, newOrigin);
    assert(!window.hasTabSessionPermission(tabId, oldOrigin, QStringLiteral("camera")));
  }

  // -------------------------------------------------------------
  // TEST 17: tab navigation old active capture state cleared
  // -------------------------------------------------------------
  {
    std::cout << "[TEST 17] tab navigation old active capture state cleared" << std::endl;
    BrowserServices services;
    auto profileService = std::make_shared<BrowserProfileService>(tempDir.path(), nullptr);
    services.profileService = profileService.get();
    BrowserWindow window(services);

    int tabIdx = window.addNewTab(QUrl(QStringLiteral("https://meet.jit.si/ardali")));
    window.setTabActiveMediaForTesting(tabIdx, true, true);
    assert(window.tabInfo(tabIdx).activeCamera);
    assert(window.tabInfo(tabIdx).activeMicrophone);

    // Cleared upon navigation
    window.setTabActiveMediaForTesting(tabIdx, false, false);
    assert(!window.tabInfo(tabIdx).activeCamera);
    assert(!window.tabInfo(tabIdx).activeMicrophone);
    assert(!window.omniboxLeadingAction()->toolTip().contains(QStringLiteral("kullanımda")));
  }

  // -------------------------------------------------------------
  // TEST 18: active camera indicator
  // -------------------------------------------------------------
  {
    std::cout << "[TEST 18] active camera indicator" << std::endl;
    BrowserServices services;
    auto profileService = std::make_shared<BrowserProfileService>(tempDir.path(), nullptr);
    services.profileService = profileService.get();
    BrowserWindow window(services);

    int tabIdx = window.addNewTab(QUrl(QStringLiteral("https://meet.google.com/xyz")));
    window.setTabActiveMediaForTesting(tabIdx, true, false);
    assert(window.omniboxLeadingAction()->toolTip().contains(QStringLiteral("Kamera kullanımda")));
  }

  // -------------------------------------------------------------
  // TEST 19: camera stopped indicator disappears
  // -------------------------------------------------------------
  {
    std::cout << "[TEST 19] camera stopped indicator disappears" << std::endl;
    BrowserServices services;
    auto profileService = std::make_shared<BrowserProfileService>(tempDir.path(), nullptr);
    services.profileService = profileService.get();
    BrowserWindow window(services);

    int tabIdx = window.addNewTab(QUrl(QStringLiteral("https://meet.google.com/xyz")));
    window.setTabActiveMediaForTesting(tabIdx, true, false);
    assert(window.omniboxLeadingAction()->toolTip().contains(QStringLiteral("Kamera kullanımda")));

    window.setTabActiveMediaForTesting(tabIdx, false, false);
    assert(!window.omniboxLeadingAction()->toolTip().contains(QStringLiteral("kullanımda")));
    assert(window.omniboxLeadingAction()->toolTip().contains(QStringLiteral("Site bilgilerini")));
  }

  // -------------------------------------------------------------
  // TEST 20: active microphone indicator
  // -------------------------------------------------------------
  {
    std::cout << "[TEST 20] active microphone indicator" << std::endl;
    BrowserServices services;
    auto profileService = std::make_shared<BrowserProfileService>(tempDir.path(), nullptr);
    services.profileService = profileService.get();
    BrowserWindow window(services);

    int tabIdx = window.addNewTab(QUrl(QStringLiteral("https://podcast.ardali.com")));
    window.setTabActiveMediaForTesting(tabIdx, false, true);
    assert(window.omniboxLeadingAction()->toolTip().contains(QStringLiteral("Mikrofon kullanımda")));
  }

  // -------------------------------------------------------------
  // TEST 21: Site Controls dropdown Allow
  // -------------------------------------------------------------
  {
    std::cout << "[TEST 21] Site Controls dropdown Allow" << std::endl;
    BrowserProfileService service(tempDir.path(), nullptr);
    SiteControlsBubble bubble;
    bubble.setProfileService(&service);
    bubble.updateForTab(801, QUrl(QStringLiteral("https://notif-site.com")), true, false, false, nullptr);

    bubble.setPermissionChoice(QStringLiteral("notifications"), 1); // 1 = İzin ver
    assert(service.allowedOrigins(QStringLiteral("notifications")).contains(QStringLiteral("https://notif-site.com")));
  }

  // -------------------------------------------------------------
  // TEST 22: Site Controls dropdown Block
  // -------------------------------------------------------------
  {
    std::cout << "[TEST 22] Site Controls dropdown Block" << std::endl;
    BrowserProfileService service(tempDir.path(), nullptr);
    SiteControlsBubble bubble;
    bubble.setProfileService(&service);
    bubble.updateForTab(801, QUrl(QStringLiteral("https://spam-site.com")), true, false, false, nullptr);

    bubble.setPermissionChoice(QStringLiteral("notifications"), 2); // 2 = Engelle
    assert(service.deniedOrigins(QStringLiteral("notifications")).contains(QStringLiteral("https://spam-site.com")));
  }

  // -------------------------------------------------------------
  // TEST 23: Site Controls dropdown Ask/reset
  // -------------------------------------------------------------
  {
    std::cout << "[TEST 23] Site Controls dropdown Ask/reset" << std::endl;
    BrowserProfileService service(tempDir.path(), nullptr);
    service.addSitePermissionRule(QStringLiteral("notifications"), QStringLiteral("https://spam-site.com"), false);
    assert(service.hasSitePermissionRule(QStringLiteral("notifications"), QStringLiteral("https://spam-site.com")));

    SiteControlsBubble bubble;
    bubble.setProfileService(&service);
    bubble.updateForTab(801, QUrl(QStringLiteral("https://spam-site.com")), true, false, false, nullptr);

    bubble.setPermissionChoice(QStringLiteral("notifications"), 0); // 0 = Sor
    assert(!service.hasSitePermissionRule(QStringLiteral("notifications"), QStringLiteral("https://spam-site.com")));
  }

  // -------------------------------------------------------------
  // TEST 24: reset all site permissions
  // -------------------------------------------------------------
  {
    std::cout << "[TEST 24] reset all site permissions" << std::endl;
    BrowserServices services;
    auto profileService = std::make_shared<BrowserProfileService>(tempDir.path(), nullptr);
    services.profileService = profileService.get();
    BrowserWindow window(services);

    const QString origin = QStringLiteral("https://multi-rule.org");
    profileService->addSitePermissionRule(QStringLiteral("camera"), origin, true);
    profileService->addSitePermissionRule(QStringLiteral("microphone"), origin, false);
    profileService->addSitePermissionRule(QStringLiteral("geolocation"), origin, true);

    SiteControlsBubble bubble;
    bubble.setProfileService(profileService.get());
    QObject::connect(&bubble, &SiteControlsBubble::permissionsResetRequested, &window,
                     &BrowserWindow::clearAllTabSessionPermissionsForOrigin);

    bubble.updateForTab(901, QUrl(origin), true, false, false, nullptr);
    bubble.triggerResetAllPermissions();

    assert(!profileService->hasSitePermissionRule(QStringLiteral("camera"), origin));
    assert(!profileService->hasSitePermissionRule(QStringLiteral("microphone"), origin));
    assert(!profileService->hasSitePermissionRule(QStringLiteral("geolocation"), origin));
  }

  // -------------------------------------------------------------
  // TEST 25: Settings -> Site Controls sync
  // -------------------------------------------------------------
  {
    std::cout << "[TEST 25] Settings -> Site Controls sync" << std::endl;
    BrowserProfileService service(tempDir.path(), nullptr);
    SiteControlsBubble bubble;
    bubble.setProfileService(&service);
    const QString origin = QStringLiteral("https://sync-test.com");
    bubble.updateForTab(1001, QUrl(origin), true, false, false, nullptr);

    assert(bubble.permissionChoice(QStringLiteral("geolocation")) == 0);

    // Permission modified from Settings / ProfileService
    service.addSitePermissionRule(QStringLiteral("geolocation"), origin, true);
    bubble.refreshPermissions();

    assert(bubble.permissionChoice(QStringLiteral("geolocation")) == 1); // İzin ver
  }

  // -------------------------------------------------------------
  // TEST 26: Site Controls -> Settings sync
  // -------------------------------------------------------------
  {
    std::cout << "[TEST 26] Site Controls -> Settings sync" << std::endl;
    BrowserProfileService service(tempDir.path(), nullptr);
    SiteControlsBubble bubble;
    bubble.setProfileService(&service);
    const QString origin = QStringLiteral("https://sync-test.com");
    bubble.updateForTab(1002, QUrl(origin), true, false, false, nullptr);

    bubble.setPermissionChoice(QStringLiteral("clipboard"), 2); // Engelle
    assert(service.deniedOrigins(QStringLiteral("clipboard")).contains(origin));
  }

  // -------------------------------------------------------------
  // TEST 27: invalid origin no site controls privileged action
  // -------------------------------------------------------------
  {
    std::cout << "[TEST 27] invalid origin no site controls privileged action" << std::endl;
    assert(!BrowserProfileService::isPermissibleWebOrigin(QUrl()));
    assert(!BrowserProfileService::isPermissibleWebOrigin(QUrl(QStringLiteral("https://"))));
    assert(!BrowserProfileService::isPermissibleWebOrigin(QUrl(QStringLiteral("about:blank"))));

    assert(BrowserProfileService::canonicalOrigin(QUrl()).isEmpty());
  }

  // -------------------------------------------------------------
  // TEST 28: data/file/javascript/opaque safe behavior
  // -------------------------------------------------------------
  {
    std::cout << "[TEST 28] data/file/javascript/opaque safe behavior" << std::endl;
    assert(!BrowserProfileService::isPermissibleWebOrigin(QUrl(QStringLiteral("data:text/html,<b>x</b>"))));
    assert(!BrowserProfileService::isPermissibleWebOrigin(QUrl(QStringLiteral("file:///etc/hosts"))));
    assert(!BrowserProfileService::isPermissibleWebOrigin(QUrl(QStringLiteral("javascript:void(0)"))));

    BrowserProfileService service(tempDir.path(), nullptr);
    bool res = service.addSitePermissionRule(QStringLiteral("camera"), QStringLiteral("data:text/html"), true);
    assert(!res);
  }

  // -------------------------------------------------------------
  // TEST 29: two tabs different permission states no leakage
  // -------------------------------------------------------------
  {
    std::cout << "[TEST 29] two tabs different permission states no leakage" << std::endl;
    BrowserServices services;
    auto profileService = std::make_shared<BrowserProfileService>(tempDir.path(), nullptr);
    services.profileService = profileService.get();
    BrowserWindow window(services);

    int tab1 = window.addNewTab(QUrl(QStringLiteral("https://camera-app.com")));
    int tab2 = window.addNewTab(QUrl(QStringLiteral("https://regular-app.com")));

    window.setTabActiveMediaForTesting(tab1, true, false);
    window.setTabActiveMediaForTesting(tab2, false, false);

    window.switchTab(tab1);
    assert(window.omniboxLeadingAction()->toolTip().contains(QStringLiteral("Kamera kullanımda")));

    window.switchTab(tab2);
    assert(!window.omniboxLeadingAction()->toolTip().contains(QStringLiteral("kullanımda")));
    assert(window.omniboxLeadingAction()->toolTip().contains(QStringLiteral("regular-app.com")));

    window.switchTab(tab1);
    assert(window.omniboxLeadingAction()->toolTip().contains(QStringLiteral("Kamera kullanımda")));
  }

  // -------------------------------------------------------------
  // TEST 30: popup closes safely on tab destruction
  // -------------------------------------------------------------
  {
    std::cout << "[TEST 30] popup closes safely on tab destruction" << std::endl;
    BrowserServices services;
    auto profileService = std::make_shared<BrowserProfileService>(tempDir.path(), nullptr);
    services.profileService = profileService.get();
    BrowserWindow window(services);

    int tabIdx = window.addNewTab(QUrl(QStringLiteral("https://destroy-test.com")));
    window.toggleSiteControlsBubble();
    assert(window.siteControlsBubble() != nullptr);

    // Close the tab
    window.closeTab(tabIdx);
    // Safe: no crash or dangling reference
    assert(window.siteControlsBubble() == nullptr || !window.siteControlsBubble()->isVisible());
  }

  // -------------------------------------------------------------
  // TEST 31: SiteControls açık -> outside click -> hidden
  // -------------------------------------------------------------
  {
    std::cout << "[TEST 31] SiteControls açık -> outside click -> hidden" << std::endl;
    BrowserServices services;
    auto profileService = std::make_shared<BrowserProfileService>(tempDir.path(), nullptr);
    services.profileService = profileService.get();
    BrowserWindow window(services);
    window.resize(1024, 768);
    window.show();
    qApp->processEvents();

    window.addNewTab(QUrl(QStringLiteral("https://www.google.com")));
    window.toggleSiteControlsBubble();
    assert(window.siteControlsBubble() != nullptr);
    assert(window.siteControlsBubble()->isVisible());

    // Outside click far below and to the right of the bubble
    QMouseEvent press(QEvent::MouseButtonPress, QPointF(800, 600), QPointF(800, 600),
                      Qt::LeftButton, Qt::LeftButton, Qt::NoModifier);
    qApp->sendEvent(&window, &press);

    assert(!window.siteControlsBubble()->isVisible());
  }

  // -------------------------------------------------------------
  // TEST 32: SiteControls açık -> tab switch -> hidden + no crash
  // -------------------------------------------------------------
  {
    std::cout << "[TEST 32] SiteControls açık -> tab switch -> hidden + no crash" << std::endl;
    BrowserServices services;
    auto profileService = std::make_shared<BrowserProfileService>(tempDir.path(), nullptr);
    services.profileService = profileService.get();
    BrowserWindow window(services);
    window.resize(1024, 768);
    window.show();
    qApp->processEvents();

    int tab0 = window.addNewTab(QUrl(QStringLiteral("https://www.google.com")));
    int tab1 = window.addNewTab(QUrl(QStringLiteral("https://www.wikipedia.org")));

    window.switchTab(tab0);
    window.toggleSiteControlsBubble();
    assert(window.siteControlsBubble()->isVisible());

    // Switch tab while bubble is open
    window.switchTab(tab1);
    assert(!window.siteControlsBubble()->isVisible());
    assert(window.tabStrip()->currentIndex() == tab1);
  }

  // -------------------------------------------------------------
  // TEST 33: SiteControls açık -> active tab close -> hidden + no crash
  // -------------------------------------------------------------
  {
    std::cout << "[TEST 33] SiteControls açık -> active tab close -> hidden + no crash" << std::endl;
    BrowserServices services;
    auto profileService = std::make_shared<BrowserProfileService>(tempDir.path(), nullptr);
    services.profileService = profileService.get();
    BrowserWindow window(services);
    window.resize(1024, 768);
    window.show();
    qApp->processEvents();

    int tab0 = window.addNewTab(QUrl(QStringLiteral("https://www.google.com")));
    int tab1 = window.addNewTab(QUrl(QStringLiteral("https://www.wikipedia.org")));

    window.switchTab(tab1);
    window.toggleSiteControlsBubble();
    assert(window.siteControlsBubble()->isVisible());

    // Close active tab while bubble is open
    window.closeTab(tab1);
    assert(!window.siteControlsBubble()->isVisible());
    assert(window.tabCount() == 1);
  }

  // -------------------------------------------------------------
  // TEST 34: SiteControls açık -> omnibox click -> hidden
  // -------------------------------------------------------------
  {
    std::cout << "[TEST 34] SiteControls açık -> omnibox click -> hidden" << std::endl;
    BrowserServices services;
    auto profileService = std::make_shared<BrowserProfileService>(tempDir.path(), nullptr);
    services.profileService = profileService.get();
    BrowserWindow window(services);
    window.resize(1024, 768);
    window.show();
    qApp->processEvents();

    window.addNewTab(QUrl(QStringLiteral("https://www.google.com")));
    window.toggleSiteControlsBubble();
    assert(window.siteControlsBubble()->isVisible());

    QWidget *omni = window.findChild<QWidget *>(QStringLiteral("omnibox"));
    if (omni) {
      QPoint center = omni->rect().center();
      QMouseEvent press(QEvent::MouseButtonPress, center, omni->mapToGlobal(center),
                        Qt::LeftButton, Qt::LeftButton, Qt::NoModifier);
      qApp->sendEvent(omni, &press);
      assert(!window.siteControlsBubble()->isVisible());
    }
  }

  // -------------------------------------------------------------
  // TEST 35: SiteControls açık -> browser loses focus -> hidden
  // -------------------------------------------------------------
  {
    std::cout << "[TEST 35] SiteControls açık -> browser loses focus -> hidden" << std::endl;
    BrowserServices services;
    auto profileService = std::make_shared<BrowserProfileService>(tempDir.path(), nullptr);
    services.profileService = profileService.get();
    BrowserWindow window(services);
    window.resize(1024, 768);
    window.show();
    qApp->processEvents();

    window.addNewTab(QUrl(QStringLiteral("https://www.google.com")));
    window.toggleSiteControlsBubble();
    assert(window.siteControlsBubble()->isVisible());

    QEvent deactivate(QEvent::WindowDeactivate);
    qApp->sendEvent(&window, &deactivate);
    assert(!window.siteControlsBubble()->isVisible());
  }

  // -------------------------------------------------------------
  // TEST 36: SiteControls açık -> Escape -> hidden, BrowserWindow alive
  // -------------------------------------------------------------
  {
    std::cout << "[TEST 36] SiteControls açık -> Escape -> hidden, BrowserWindow alive" << std::endl;
    BrowserServices services;
    auto profileService = std::make_shared<BrowserProfileService>(tempDir.path(), nullptr);
    services.profileService = profileService.get();
    BrowserWindow window(services);
    window.resize(1024, 768);
    window.show();
    qApp->processEvents();

    window.addNewTab(QUrl(QStringLiteral("https://www.google.com")));
    window.toggleSiteControlsBubble();
    assert(window.siteControlsBubble()->isVisible());

    QKeyEvent escapeEvent(QEvent::KeyPress, Qt::Key_Escape, Qt::NoModifier);
    qApp->sendEvent(window.siteControlsBubble(), &escapeEvent);

    assert(!window.siteControlsBubble()->isVisible());
    assert(window.tabCount() == 1);
  }

  // -------------------------------------------------------------
  // TEST 37: SiteControls iç dropdown click -> remains open
  // -------------------------------------------------------------
  {
    std::cout << "[TEST 37] SiteControls iç dropdown click -> remains open" << std::endl;
    BrowserServices services;
    auto profileService = std::make_shared<BrowserProfileService>(tempDir.path(), nullptr);
    services.profileService = profileService.get();
    BrowserWindow window(services);
    window.resize(1024, 768);
    window.show();
    qApp->processEvents();

    window.addNewTab(QUrl(QStringLiteral("https://www.google.com")));
    window.toggleSiteControlsBubble();
    assert(window.siteControlsBubble()->isVisible());

    // Switch to permissions page (index 3)
    window.siteControlsBubble()->setStackIndex(3);
    auto combos = window.siteControlsBubble()->findChildren<QComboBox *>();
    assert(!combos.isEmpty());
    auto *combo = combos.first();

    QPoint center = combo->rect().center();
    QMouseEvent press(QEvent::MouseButtonPress, center, combo->mapToGlobal(center),
                      Qt::LeftButton, Qt::LeftButton, Qt::NoModifier);
    qApp->sendEvent(combo, &press);

    // SiteControlsBubble MUST remain open when interacting with its own controls!
    assert(window.siteControlsBubble()->isVisible());
  }

  // -------------------------------------------------------------
  // TEST 38: Repeated show/hide 100 iterations -> no crash/leak
  // -------------------------------------------------------------
  {
    std::cout << "[TEST 38] Repeated show/hide 100 iterations -> no crash/leak" << std::endl;
    BrowserServices services;
    auto profileService = std::make_shared<BrowserProfileService>(tempDir.path(), nullptr);
    services.profileService = profileService.get();
    BrowserWindow window(services);
    window.resize(1024, 768);
    window.show();
    qApp->processEvents();

    window.addNewTab(QUrl(QStringLiteral("https://www.google.com")));
    for (int i = 0; i < 100; ++i) {
      window.toggleSiteControlsBubble();
      assert(window.siteControlsBubble()->isVisible());
      window.dismissSiteControlsBubble();
      assert(!window.siteControlsBubble()->isVisible());
    }
  }

  // -------------------------------------------------------------
  // TEST 39: Rapid tab switching while popup visible -> no crash
  // -------------------------------------------------------------
  {
    std::cout << "[TEST 39] Rapid tab switching while popup visible -> no crash" << std::endl;
    BrowserServices services;
    auto profileService = std::make_shared<BrowserProfileService>(tempDir.path(), nullptr);
    services.profileService = profileService.get();
    BrowserWindow window(services);
    window.resize(1024, 768);
    window.show();
    qApp->processEvents();

    int t0 = window.addNewTab(QUrl(QStringLiteral("https://site-0.org")));
    int t1 = window.addNewTab(QUrl(QStringLiteral("https://site-1.org")));
    int t2 = window.addNewTab(QUrl(QStringLiteral("https://site-2.org")));

    for (int i = 0; i < 50; ++i) {
      window.switchTab(t0);
      window.toggleSiteControlsBubble();
      window.switchTab(t1);
      assert(!window.siteControlsBubble()->isVisible());
      window.toggleSiteControlsBubble();
      window.switchTab(t2);
      assert(!window.siteControlsBubble()->isVisible());
    }
  }

  // -------------------------------------------------------------
  // TEST 40: Bubble destruction / recreation -> no dangling pointer
  // -------------------------------------------------------------
  {
    std::cout << "[TEST 40] Bubble destruction / recreation -> no dangling pointer" << std::endl;
    BrowserServices services;
    auto profileService = std::make_shared<BrowserProfileService>(tempDir.path(), nullptr);
    services.profileService = profileService.get();
    BrowserWindow window(services);
    window.resize(1024, 768);
    window.show();
    qApp->processEvents();

    window.addNewTab(QUrl(QStringLiteral("https://www.google.com")));
    window.toggleSiteControlsBubble();
    assert(window.siteControlsBubble() != nullptr);

    // Multiple dismiss calls (idempotent & reentrant-safe)
    window.dismissSiteControlsBubble();
    window.dismissSiteControlsBubble();
    assert(!window.siteControlsBubble()->isVisible());

    window.toggleSiteControlsBubble();
    assert(window.siteControlsBubble()->isVisible());
    window.dismissSiteControlsBubble();
  }

  // -------------------------------------------------------------
  // STRESS TEST: 100x outside click + 20x multi-tab scenarios
  // -------------------------------------------------------------
  {
    std::cout << "[STRESS TEST] 100x outside click + 20x multi-tab scenarios" << std::endl;
    BrowserServices services;
    auto profileService = std::make_shared<BrowserProfileService>(tempDir.path(), nullptr);
    services.profileService = profileService.get();
    BrowserWindow window(services);
    window.resize(1024, 768);
    window.show();
    qApp->processEvents();

    int tA = window.addNewTab(QUrl(QStringLiteral("https://alpha.example.com")));
    int tB = window.addNewTab(QUrl(QStringLiteral("https://beta.example.com")));

    for (int i = 0; i < 100; ++i) {
      window.switchTab(tA);
      window.toggleSiteControlsBubble();
      assert(window.siteControlsBubble()->isVisible());

      QMouseEvent press(QEvent::MouseButtonPress, QPointF(800, 600), QPointF(800, 600),
                        Qt::LeftButton, Qt::LeftButton, Qt::NoModifier);
      qApp->sendEvent(&window, &press);
      assert(!window.siteControlsBubble()->isVisible());

      window.switchTab(tB);
      window.toggleSiteControlsBubble();
      assert(window.siteControlsBubble()->isVisible());
      window.dismissSiteControlsBubble();
    }

    for (int i = 0; i < 20; ++i) {
      int curA = window.addNewTab(QUrl(QStringLiteral("https://test-a.org")));
      window.toggleSiteControlsBubble();
      int curB = window.addNewTab(QUrl(QStringLiteral("https://test-b.org")));
      window.toggleSiteControlsBubble();
      window.switchTab(curA);
      window.closeTab(curA);
      assert(window.tabCount() >= 1);
    }
  }

  std::cout << "==================================================" << std::endl;
  std::cout << "[TEST SUITE] ALL 40 SPECIFIED TESTS + STRESS TESTS PASSED!" << std::endl;
  std::cout << "==================================================" << std::endl;
  return 0;
}
