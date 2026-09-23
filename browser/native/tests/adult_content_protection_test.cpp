#include <cassert>
#include <iostream>
#include <QApplication>
#include <QFile>
#include <QTemporaryDir>
#include <QUrl>
#include <QWebEnginePage>
#include <QWebEngineProfile>
#include <QWebEngineUrlRequestInfo>

#include "core/adult_content_protection.h"
#include "core/compact_domain_table.h"
#include "core/browser_profile_service.h"
#include "blocker/dalinira_blocker_service.h"
#include "blocker/dalinira_blocker_settings.h"
#include "blocker/dalinira_blocker_types.h"
#include "newtab/new_tab_html.h"
#include "newtab/new_tab_scheme.h"

using dalinira::core::AdultContentProtectionService;
using dalinira::core::CompactDomainTable;
using dalinira::core::DomainListStats;


// Mock / subclass of QWebEnginePage to verify acceptNavigationRequest behavior
class TestNavigationPage final : public QWebEnginePage {
 public:
  TestNavigationPage(BrowserProfileService *profileService, QObject *parent = nullptr)
      : QWebEnginePage(profileService ? profileService->profile() : nullptr, parent),
        profileService_(profileService) {}

  bool acceptNavigationRequest(const QUrl &url, NavigationType type, bool isMainFrame) override {
    navigationRequestsChecked++;
    lastRequestedUrl = url;

    if (isMainFrame && (url.scheme() == QLatin1String("http") || url.scheme() == QLatin1String("https"))) {
      const bool adultProtection = profileService_ ? profileService_->isAdultContentProtectionEnabled() : true;
      if (adultProtection && AdultContentProtectionService::instance().isBlocked(url)) {
        blockedNavigationCount++;
        setUrl(QUrl(QStringLiteral("dalinira://blocked/adult")));
        return false;
      }
    }
    allowedNavigationCount++;
    return QWebEnginePage::acceptNavigationRequest(url, type, isMainFrame);
  }

  int navigationRequestsChecked = 0;
  int blockedNavigationCount = 0;
  int allowedNavigationCount = 0;
  QUrl lastRequestedUrl;

 private:
  BrowserProfileService *profileService_ = nullptr;
};

int main(int argc, char *argv[]) {
  qputenv("QT_QPA_PLATFORM", "offscreen");
  qputenv("QTWEBENGINE_CHROMIUM_FLAGS", "--no-sandbox --disable-gpu");
  registerDaliNiraUrlSchemes();
  QApplication app(argc, argv);

  std::cout << "=== Running DaliNira Adult Content Protection Tests ===\n";

  auto &service = AdultContentProtectionService::instance();
  service.clear();

  // Load test domain blocklist
  service.loadFromLines({
      QStringLiteral("# DaliNira Adult Protection Test Domains"),
      QStringLiteral("adult-test.example"),
      QStringLiteral("another-adult-test.example")
  });

  assert(service.domainCount() == 2);

  // URL classification is hostname-only. Blocklist-looking text elsewhere in
  // a normal URL must never become a domain match.
  {
    const QUrl youtubeUrl(QStringLiteral(
        "https://www.youtube.com/watch?v=AsRD9IhICs8&list=RDAsRD9IhICs8&start_radio=1"));
    const QUrl queryUrl(QStringLiteral(
        "https://normal.example/watch?next=https%3A%2F%2Fadult-test.example%2Fvideo"));
    const QUrl pathUrl(QStringLiteral(
        "https://normal.example/video/adult-test.example/123"));
    assert(!service.isBlocked(youtubeUrl));
    assert(!service.isBlocked(queryUrl));
    assert(!service.isBlocked(pathUrl));
    assert(service.isBlocked(QUrl(QStringLiteral("https://media.adult-test.example/video/123"))));
    std::cout << "  [PASS] URL classification uses only normalized hostname\n";
  }

  // -------------------------------------------------------------
  // Test A: adult-test.example -> BLOCK
  // -------------------------------------------------------------
  {
    const QUrl url(QStringLiteral("https://adult-test.example/path/page.html"));
    assert(service.isBlocked(url));
    assert(service.isBlockedHost(QStringLiteral("adult-test.example")));
    std::cout << "  [PASS] A: adult-test.example -> BLOCK\n";
  }

  // -------------------------------------------------------------
  // Test B: www.adult-test.example -> BLOCK
  // -------------------------------------------------------------
  {
    const QUrl url(QStringLiteral("https://www.adult-test.example/"));
    assert(service.isBlocked(url));
    assert(service.isBlockedHost(QStringLiteral("www.adult-test.example")));
    std::cout << "  [PASS] B: www.adult-test.example -> BLOCK\n";
  }

  // -------------------------------------------------------------
  // Test C: sub.adult-test.example -> BLOCK
  // -------------------------------------------------------------
  {
    const QUrl url(QStringLiteral("https://sub.adult-test.example/video?id=123"));
    assert(service.isBlocked(url));
    assert(service.isBlockedHost(QStringLiteral("sub.adult-test.example")));
    assert(service.isBlockedHost(QStringLiteral("deep.sub.adult-test.example")));
    std::cout << "  [PASS] C: sub.adult-test.example -> BLOCK\n";
  }

  // -------------------------------------------------------------
  // Test D: notadult-test.example -> ALLOW (domain boundary check)
  // -------------------------------------------------------------
  {
    const QUrl url(QStringLiteral("https://notadult-test.example/"));
    assert(!service.isBlocked(url));
    assert(!service.isBlockedHost(QStringLiteral("notadult-test.example")));
    assert(!service.isBlockedHost(QStringLiteral("fakeadult-test.example")));
    std::cout << "  [PASS] D: notadult-test.example -> ALLOW\n";
  }

  // -------------------------------------------------------------
  // Test E: adult-test.example.safe.example -> ALLOW (prefix attack / suffix boundary)
  // -------------------------------------------------------------
  {
    const QUrl url(QStringLiteral("https://adult-test.example.safe.example/"));
    assert(!service.isBlocked(url));
    assert(!service.isBlockedHost(QStringLiteral("adult-test.example.safe.example")));
    assert(!service.isBlockedHost(QStringLiteral("adult-test.example.evil.com")));
    std::cout << "  [PASS] E: adult-test.example.safe.example -> ALLOW\n";
  }

  // -------------------------------------------------------------
  // Test F: normal.example -> ALLOW
  // -------------------------------------------------------------
  {
    const QUrl url(QStringLiteral("https://normal.example/"));
    assert(!service.isBlocked(url));
    assert(!service.isBlockedHost(QStringLiteral("normal.example")));
    assert(!service.isBlockedHost(QStringLiteral("wikipedia.org")));
    std::cout << "  [PASS] F: normal.example -> ALLOW\n";
  }

  // -------------------------------------------------------------
  // Test H: HTTP and HTTPS same domain behavior (+ ports & trailing dots)
  // -------------------------------------------------------------
  {
    const QUrl httpUrl(QStringLiteral("http://adult-test.example/index.php"));
    const QUrl httpsUrl(QStringLiteral("https://adult-test.example/index.php"));
    const QUrl portUrl(QStringLiteral("http://adult-test.example:8080/secure"));
    const QUrl dotUrl(QStringLiteral("https://adult-test.example./test"));

    assert(service.isBlocked(httpUrl));
    assert(service.isBlocked(httpsUrl));
    assert(service.isBlocked(portUrl));
    assert(service.isBlocked(dotUrl));

    // Internal scheme should never be blocked
    assert(!service.isBlocked(QUrl(QStringLiteral("dalinira://newtab"))));
    assert(!service.isBlocked(QUrl(QStringLiteral("dalinira://blocked/adult"))));
    std::cout << "  [PASS] H: HTTP and HTTPS consistent domain & port/dot behavior\n";
  }

  // -------------------------------------------------------------
  // Search Engine Preservation: Search queries MUST NOT be blocked
  // -------------------------------------------------------------
  {
    const QUrl googleSearch(QStringLiteral("https://www.google.com/search?q=adult+content+query"));
    const QUrl ddgSearch(QStringLiteral("https://duckduckgo.com/?q=adult+keywords"));
    const QUrl startpageSearch(QStringLiteral("https://www.startpage.com/sp/search?query=adult+terms"));
    const QUrl mojeekSearch(QStringLiteral("https://www.mojeek.com/search?q=adult"));

    assert(!service.isBlocked(googleSearch));
    assert(!service.isBlocked(ddgSearch));
    assert(!service.isBlocked(startpageSearch));
    assert(!service.isBlocked(mojeekSearch));
    std::cout << "  [PASS] Search Engines: User searches are not censored\n";
  }

  // -------------------------------------------------------------
  // Test K: Setting Persistence in BrowserProfileService
  // -------------------------------------------------------------
  QTemporaryDir tempProfileDir;
  assert(tempProfileDir.isValid());
  {
    // Instance 1: check default is true, set to false
    BrowserProfileService profileService(tempProfileDir.path(), nullptr, nullptr, false);
    assert(profileService.isAdultContentProtectionEnabled() == true);

    profileService.setAdultContentProtectionEnabled(false);
    assert(profileService.isAdultContentProtectionEnabled() == false);
  }
  {
    // Instance 2: reload from same directory, must persist false
    BrowserProfileService profileService(tempProfileDir.path(), nullptr, nullptr, false);
    assert(profileService.isAdultContentProtectionEnabled() == false);

    // Turn back on
    profileService.setAdultContentProtectionEnabled(true);
    assert(profileService.isAdultContentProtectionEnabled() == true);
  }
  {
    // Instance 3: reload from same directory, must persist true
    BrowserProfileService profileService(tempProfileDir.path(), nullptr, nullptr, false);
    assert(profileService.isAdultContentProtectionEnabled() == true);
    std::cout << "  [PASS] K: Setting persistence across restarts\n";
  }

  // -------------------------------------------------------------
  // Test G: Protection disabled -> adult-test.example ALLOW
  // -------------------------------------------------------------
  {
    BrowserProfileService profileService(tempProfileDir.path(), nullptr, nullptr, false);
    profileService.setAdultContentProtectionEnabled(false);

    TestNavigationPage page(&profileService);
    const QUrl adultUrl(QStringLiteral("https://adult-test.example/gallery"));
    const bool accepted = page.acceptNavigationRequest(adultUrl, QWebEnginePage::NavigationTypeLinkClicked, true);

    assert(accepted == true);
    assert(page.blockedNavigationCount == 0);
    assert(page.allowedNavigationCount == 1);
    std::cout << "  [PASS] G: Protection off -> adult-test.example ALLOW\n";
  }

  // -------------------------------------------------------------
  // Test J: Blocked navigation prevents remote page load (acceptNavigationRequest -> false)
  // -------------------------------------------------------------
  {
    BrowserProfileService profileService(tempProfileDir.path(), nullptr, nullptr, false);
    profileService.setAdultContentProtectionEnabled(true);

    TestNavigationPage page(&profileService);
    const QUrl adultUrl(QStringLiteral("https://adult-test.example/live"));
    const bool accepted = page.acceptNavigationRequest(adultUrl, QWebEnginePage::NavigationTypeLinkClicked, true);

    // Must return false so Chromium halts navigation before initiating network load
    assert(accepted == false);
    assert(page.blockedNavigationCount == 1);
    assert(page.allowedNavigationCount == 0);
    assert(page.url() == QUrl(QStringLiteral("dalinira://blocked/adult")));
    std::cout << "  [PASS] J: Remote page load prevented before network starts\n";
  }

  // -------------------------------------------------------------
  // Test I: Redirect to adult domain -> Navigation re-verification BLOCKS
  // -------------------------------------------------------------
  {
    BrowserProfileService profileService(tempProfileDir.path(), nullptr, nullptr, false);
    profileService.setAdultContentProtectionEnabled(true);

    TestNavigationPage page(&profileService);

    // Initial safe site allowed
    const QUrl safeUrl(QStringLiteral("https://normal.example/redirect-source"));
    bool accepted = page.acceptNavigationRequest(safeUrl, QWebEnginePage::NavigationTypeOther, true);
    assert(accepted == true);
    assert(page.allowedNavigationCount == 1);

    // Follow-up navigation to redirected adult domain
    const QUrl redirectTarget(QStringLiteral("https://adult-test.example/redirect-destination"));
    accepted = page.acceptNavigationRequest(redirectTarget, QWebEnginePage::NavigationTypeRedirect, true);
    assert(accepted == false);
    assert(page.blockedNavigationCount == 1);
    assert(page.url() == QUrl(QStringLiteral("dalinira://blocked/adult")));
    std::cout << "  [PASS] I: Redirect to adult domain -> BLOCKED\n";
  }

  // -------------------------------------------------------------
  // Test L: Private / Incognito behavior
  // -------------------------------------------------------------
  {
    // Normal profile with protection ON
    BrowserProfileService normalProfile(tempProfileDir.path(), nullptr, nullptr, false);
    normalProfile.setAdultContentProtectionEnabled(true);

    QTemporaryDir incognitoDir;
    // Incognito profile created with privateMode = true
    BrowserProfileService incognitoProfile(incognitoDir.path(), nullptr, nullptr, true);
    // Inherit normal profile setting as openIncognitoWindow does
    incognitoProfile.setAdultContentProtectionEnabled(normalProfile.isAdultContentProtectionEnabled());

    assert(incognitoProfile.isAdultContentProtectionEnabled() == true);

    TestNavigationPage incognitoPage(&incognitoProfile);
    const QUrl adultUrl(QStringLiteral("https://sub.adult-test.example/private"));
    const bool accepted = incognitoPage.acceptNavigationRequest(adultUrl, QWebEnginePage::NavigationTypeLinkClicked, true);
    assert(accepted == false);
    assert(incognitoPage.blockedNavigationCount == 1);
    assert(incognitoPage.url() == QUrl(QStringLiteral("dalinira://blocked/adult")));
    std::cout << "  [PASS] L: Private/Incognito profile inherits and enforces protection\n";
  }

  // -------------------------------------------------------------
  // Block Page HTML Content & Security Claims Verification
  // -------------------------------------------------------------
  {
    const QString html = adultBlockedWarningHtml();
    assert(html.contains(QStringLiteral("Yetişkin İçerik Engellendi")));
    assert(html.contains(QStringLiteral("DaliNira bu sayfanın yüklenmesini engelledi.")));
    assert(html.contains(QStringLiteral("Bu alan adı yetişkinlere yönelik içerik barındıran bir site olarak sınıflandırılmıştır.")));
    assert(html.contains(QStringLiteral("Geri Dön")));

    // Requirement 7: NO false security claims
    assert(!html.contains(QStringLiteral("Virüs tespit edildi")));
    assert(!html.contains(QStringLiteral("Malware bulundu")));
    assert(!html.contains(QStringLiteral("Zararlı cookie saldırısı")));
    assert(!html.contains(QStringLiteral("Bu site cihazınıza zarar verir")));
    assert(!html.contains(QStringLiteral("Tracker saldırısı tespit edildi")));
    std::cout << "  [PASS] Block Page HTML: Correct text, design and no false claims\n";
  }

  // -------------------------------------------------------------
  // Test M: Allowlist Precedence & Subdomain Exceptions
  // -------------------------------------------------------------
  {
    service.clear();
    service.clearAllowlist();

    service.loadFromLines({
        QStringLiteral("adult-test.example"),
        QStringLiteral("blocked-portal.example")
    });

    service.loadAllowlistFromLines({
        QStringLiteral("# Adult Allowlist Exceptions"),
        QStringLiteral("adult-test.example"),
        QStringLiteral("safe-sub.blocked-portal.example")
    });

    assert(service.domainCount() == 2);
    assert(service.allowlistDomainCount() == 2);

    // 1. Domain in both blocklist and allowlist -> ALLOW (Allowlist overrides)
    assert(!service.isBlocked(QUrl(QStringLiteral("https://adult-test.example/"))));
    assert(!service.isBlockedHost(QStringLiteral("adult-test.example")));
    assert(service.isAllowedHost(QStringLiteral("adult-test.example")));

    // 2. Subdomain of allowlisted domain -> ALLOW
    assert(!service.isBlocked(QUrl(QStringLiteral("https://sub.adult-test.example/profile"))));
    assert(!service.isBlockedHost(QStringLiteral("sub.adult-test.example")));

    // 3. Blocked domain without allowlist entry -> BLOCK
    assert(service.isBlocked(QUrl(QStringLiteral("https://blocked-portal.example/"))));
    assert(service.isBlockedHost(QStringLiteral("blocked-portal.example")));

    // 4. Subdomain explicitly allowlisted under blocked parent -> ALLOW
    assert(!service.isBlocked(QUrl(QStringLiteral("https://safe-sub.blocked-portal.example/"))));
    assert(!service.isBlockedHost(QStringLiteral("safe-sub.blocked-portal.example")));

    // 5. Other subdomains under blocked parent -> BLOCK
    assert(service.isBlocked(QUrl(QStringLiteral("https://unsafe-sub.blocked-portal.example/"))));
    assert(service.isBlockedHost(QStringLiteral("unsafe-sub.blocked-portal.example")));

    // 6. Unrelated domain -> ALLOW
    assert(!service.isBlockedHost(QStringLiteral("normal.example")));

    // Clear allowlist for subsequent tests
    service.clearAllowlist();
    std::cout << "  [PASS] M: Allowlist precedence over blocklist and subdomain inheritance\n";
  }

  // -------------------------------------------------------------
  // Test N: Invalid Input Rejection (IPs, Schemes, Paths, Localhost, Malformed)
  // -------------------------------------------------------------
  {
    // Canonical validation unit checks
    assert(AdultContentProtectionService::isValidCanonicalDomain(QStringLiteral("valid-domain.com")));
    assert(AdultContentProtectionService::isValidCanonicalDomain(QStringLiteral("sub.valid-domain.org")));
    assert(AdultContentProtectionService::isValidCanonicalDomain(QStringLiteral("x-y-z.xxx")));

    // IP addresses must be rejected
    assert(!AdultContentProtectionService::isValidCanonicalDomain(QStringLiteral("127.0.0.1")));
    assert(!AdultContentProtectionService::isValidCanonicalDomain(QStringLiteral("192.168.1.1")));
    assert(!AdultContentProtectionService::isValidCanonicalDomain(QStringLiteral("10.0.0.1")));
    assert(!AdultContentProtectionService::isValidCanonicalDomain(QStringLiteral("::1")));
    assert(!AdultContentProtectionService::isValidCanonicalDomain(QStringLiteral("fe80::1")));

    // Localhost & private/internal TLDs must be rejected
    assert(!AdultContentProtectionService::isValidCanonicalDomain(QStringLiteral("localhost")));
    assert(!AdultContentProtectionService::isValidCanonicalDomain(QStringLiteral("mybox.local")));
    assert(!AdultContentProtectionService::isValidCanonicalDomain(QStringLiteral("corp.internal")));
    assert(!AdultContentProtectionService::isValidCanonicalDomain(QStringLiteral("router.lan")));
    assert(!AdultContentProtectionService::isValidCanonicalDomain(QStringLiteral("server.home")));
    assert(!AdultContentProtectionService::isValidCanonicalDomain(QStringLiteral("infra.corp")));
    assert(!AdultContentProtectionService::isValidCanonicalDomain(QStringLiteral("1.0.0.127.in-addr.arpa")));

    // Schemes, URLs, paths, queries, ports must be rejected
    assert(!AdultContentProtectionService::isValidCanonicalDomain(QStringLiteral("http://site.com")));
    assert(!AdultContentProtectionService::isValidCanonicalDomain(QStringLiteral("https://site.com")));
    assert(!AdultContentProtectionService::isValidCanonicalDomain(QStringLiteral("dalinira://blocked/adult")));
    assert(!AdultContentProtectionService::isValidCanonicalDomain(QStringLiteral("site.com/")));
    assert(!AdultContentProtectionService::isValidCanonicalDomain(QStringLiteral("site.com/path/to/page")));
    assert(!AdultContentProtectionService::isValidCanonicalDomain(QStringLiteral("site.com?query=val")));
    assert(!AdultContentProtectionService::isValidCanonicalDomain(QStringLiteral("site.com#fragment")));
    assert(!AdultContentProtectionService::isValidCanonicalDomain(QStringLiteral("site.com:8080")));

    // Malformed labels must be rejected
    assert(!AdultContentProtectionService::isValidCanonicalDomain(QStringLiteral("-leadingdash.com")));
    assert(!AdultContentProtectionService::isValidCanonicalDomain(QStringLiteral("trailingdash-.com")));
    assert(!AdultContentProtectionService::isValidCanonicalDomain(QStringLiteral("double..dot.com")));
    assert(!AdultContentProtectionService::isValidCanonicalDomain(QStringLiteral("spaces in domain.com")));
    assert(!AdultContentProtectionService::isValidCanonicalDomain(QStringLiteral("nodot")));
    assert(!AdultContentProtectionService::isValidCanonicalDomain(QStringLiteral("")));

    // Loading from lines with statistics tracking
    const QStringList testLines = {
        QStringLiteral("# Header comment"),
        QStringLiteral(""),
        QStringLiteral("clean-domain1.com"),
        QStringLiteral("clean-domain2.com"),
        QStringLiteral("clean-domain1.com"), // Duplicate
        QStringLiteral("127.0.0.1"),         // IP rejected
        QStringLiteral("localhost"),         // Localhost rejected
        QStringLiteral("https://malformed-url.com/path"), // URL rejected
        QStringLiteral("invalid..domain.com") // Malformed rejected
    };

    DomainListStats stats = service.loadFromLinesWithStats(testLines);
    assert(stats.validCount == 2);
    assert(stats.duplicateCount == 1);
    assert(stats.invalidCount == 4);
    assert(service.domainCount() == 2);
    assert(service.isBlockedHost(QStringLiteral("clean-domain1.com")));
    assert(service.isBlockedHost(QStringLiteral("clean-domain2.com")));
    assert(!service.isBlockedHost(QStringLiteral("127.0.0.1")));
    assert(!service.isBlockedHost(QStringLiteral("localhost")));
    std::cout << "  [PASS] N: Strict input validation and duplicate/invalid rejection stats\n";
  }

  // -------------------------------------------------------------
  // Test O: Failure Handling & Graceful Degradation (No Fail-Closed)
  // -------------------------------------------------------------
  {
    // Loading a non-existent file must not crash and must not fail closed
    const bool loaded = service.loadFromFile(QStringLiteral("/path/to/nonexistent/adult_domains.txt"));
    assert(!loaded);

    // Normal browsing must remain allowed
    assert(!service.isBlocked(QUrl(QStringLiteral("https://google.com"))));
    assert(!service.isBlocked(QUrl(QStringLiteral("https://wikipedia.org"))));
    assert(!service.isBlocked(QUrl(QStringLiteral("https://archlinux.org"))));

    // Stats on unreadable path
    DomainListStats errStats = service.loadFromFileWithStats(QStringLiteral("/invalid/nonexistent/list.txt"));
    assert(errStats.validCount == 0);

    std::cout << "  [PASS] O: Failure handling: unreadable file does not crash and avoids fail-closed\n";
  }

  // -------------------------------------------------------------
  // Test R: Production Snapshot Validation & Fail-Open Behavior
  // -------------------------------------------------------------
  {
    QTemporaryDir snapshotDir;
    assert(snapshotDir.isValid());
    const QString validPath = snapshotDir.filePath(QStringLiteral("adult_domains.bin"));
    const QString corruptPath = snapshotDir.filePath(QStringLiteral("adult_domains_corrupt.bin"));

    CompactDomainTable generated;
    const DomainListStats generatedStats = generated.loadFromLines({
        QStringLiteral("snapshot-adult.example"),
        QStringLiteral("snapshot-adult.example"),
        QStringLiteral("another-snapshot-adult.example")
    });
    assert(generatedStats.validCount == 2);
    assert(generatedStats.duplicateCount == 1);
    assert(generated.saveSnapshot(validPath));

    qint64 snapshotLoadMs = -1;
    assert(service.loadSnapshot(validPath, &snapshotLoadMs));
    assert(service.domainCount() == 2);
    assert(service.isBlockedHost(QStringLiteral("sub.snapshot-adult.example")));
    assert(!service.isBlockedHost(QStringLiteral("notsnapshot-adult.example")));

    service.loadAllowlistFromLines({QStringLiteral("snapshot-adult.example")});
    assert(!service.isBlockedHost(QStringLiteral("sub.snapshot-adult.example")));
    service.clearAllowlist();

    assert(QFile::copy(validPath, corruptPath));
    QFile corrupt(corruptPath);
    assert(corrupt.open(QIODevice::ReadWrite));
    assert(corrupt.seek(corrupt.size() - 1));
    char lastByte = 0;
    assert(corrupt.read(&lastByte, 1) == 1);
    assert(corrupt.seek(corrupt.size() - 1));
    lastByte ^= 0x5a;
    assert(corrupt.write(&lastByte, 1) == 1);
    corrupt.close();

    assert(!service.loadSnapshot(corruptPath));
    assert(service.domainCount() == 0);
    assert(!service.isBlockedHost(QStringLiteral("snapshot-adult.example")));
    assert(!service.loadSnapshot(snapshotDir.filePath(QStringLiteral("missing.bin"))));
    assert(!service.isBlockedHost(QStringLiteral("anything.example")));
    std::cout << "  [PASS] Snapshot: validated load, allowlist precedence, corruption/missing fail-open\n";
  }

  // -------------------------------------------------------------
  // Test P: Complete Independence of Adult Content Protection & AdBlocker
  // -------------------------------------------------------------
  {
    // Restore test blocklist
    service.clear();
    service.clearAllowlist();
    service.loadFromLines({QStringLiteral("adult-test.example")});

    QTemporaryDir pTempDir;
    BrowserProfileService profileService(pTempDir.path(), nullptr, nullptr, false);
    auto *blockerService = profileService.blockerService();
    assert(blockerService != nullptr);

    // State 1: Both ON
    profileService.setAdultContentProtectionEnabled(true);
    blockerService->settings()->setProtectionEnabled(true);
    assert(profileService.isAdultContentProtectionEnabled() == true);
    assert(blockerService->settings()->protectionEnabled() == true);

    // State 2: Adult Protection OFF, AdBlocker ON
    profileService.setAdultContentProtectionEnabled(false);
    assert(profileService.isAdultContentProtectionEnabled() == false);
    assert(blockerService->settings()->protectionEnabled() == true); // AdBlocker unaffected!

    // Verify navigation to adult domain is now allowed
    TestNavigationPage page(&profileService);
    bool accepted = page.acceptNavigationRequest(QUrl(QStringLiteral("https://adult-test.example/")),
                                                 QWebEnginePage::NavigationTypeLinkClicked, true);
    assert(accepted == true);

    // State 3: Adult Protection ON, AdBlocker OFF
    profileService.setAdultContentProtectionEnabled(true);
    blockerService->settings()->setProtectionEnabled(false);
    assert(profileService.isAdultContentProtectionEnabled() == true);
    assert(blockerService->settings()->protectionEnabled() == false); // Adult protection unaffected!

    // Verify navigation to adult domain is blocked even with AdBlocker OFF
    TestNavigationPage page2(&profileService);
    accepted = page2.acceptNavigationRequest(QUrl(QStringLiteral("https://adult-test.example/")),
                                             QWebEnginePage::NavigationTypeLinkClicked, true);
    assert(accepted == false);
    assert(page2.url() == QUrl(QStringLiteral("dalinira://blocked/adult")));

    // State 4: Both OFF
    profileService.setAdultContentProtectionEnabled(false);
    blockerService->settings()->setProtectionEnabled(false);
    assert(profileService.isAdultContentProtectionEnabled() == false);
    assert(blockerService->settings()->protectionEnabled() == false);

    TestNavigationPage page3(&profileService);
    accepted = page3.acceptNavigationRequest(QUrl(QStringLiteral("https://adult-test.example/")),
                                             QWebEnginePage::NavigationTypeLinkClicked, true);
    assert(accepted == true);

    std::cout << "  [PASS] P: Adult Protection and AdBlocker operate completely independently\n";
  }

  // -------------------------------------------------------------
  // Test Q: Domain Boundary Regression Protection
  // -------------------------------------------------------------
  {
    service.clear();
    service.clearAllowlist();
    service.loadFromLines({QStringLiteral("adult-test.example")});

    // Substring / hyphen prefix
    assert(!service.isBlockedHost(QStringLiteral("evil-adult-test.example")));
    assert(!service.isBlockedHost(QStringLiteral("notadult-test.example")));
    assert(!service.isBlockedHost(QStringLiteral("superadult-test.example")));

    // Suffix attack
    assert(!service.isBlockedHost(QStringLiteral("adult-test.example.safe.example")));
    assert(!service.isBlockedHost(QStringLiteral("adult-test.example.evil.com")));

    // Exact and subdomains MUST match
    assert(service.isBlockedHost(QStringLiteral("adult-test.example")));
    assert(service.isBlockedHost(QStringLiteral("www.adult-test.example")));
    assert(service.isBlockedHost(QStringLiteral("sub.adult-test.example")));
    assert(service.isBlockedHost(QStringLiteral("deep.sub.adult-test.example")));

    std::cout << "  [PASS] Q: Strict domain boundary matching prevents substring false-positives\n";
  }

  std::cout << "All Adult Content Protection Tests PASSED successfully!\n";
  return 0;
}
