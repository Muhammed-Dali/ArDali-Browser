#include <cassert>
#include <chrono>
#include <iostream>
#include <memory>
#include <QDateTime>
#include <QList>
#include <QLocale>
#include <QObject>
#include <QString>
#include <QUrl>

#include "core/address_input_resolver.h"
#include "core/bookmark_candidate_provider.h"
#include "core/browser_profile_data_provider.h"
#include "core/composite_navigation_candidate_provider.h"
#include "core/domain_normalizer.h"
#include "core/frequent_sites_candidate_provider.h"
#include "core/history_candidate_provider.h"
#include "core/navigation_candidate.h"

using namespace ardali::core;

class MockProfileDataProvider : public QObject, public IBrowserProfileDataProvider {
  Q_OBJECT
 public:
  explicit MockProfileDataProvider(QObject *parent = nullptr) : QObject(parent) {}

  QList<BrowserHistoryEntry> historyList;
  QList<BrowserFrequentSite> frequentList;
  QList<QUrl> bookmarkList;

  QList<BrowserHistoryEntry> recentHistory() const override { return historyList; }
  QList<BrowserFrequentSite> frequentSites(int limit) const override {
    if (limit <= 0) return {};
    return frequentList.mid(0, std::min<qsizetype>(limit, frequentList.size()));
  }
  QList<QUrl> bookmarks() const override { return bookmarkList; }

  void triggerHistoryChanged() { emit historyChanged(); }
  void triggerBookmarksChanged() { emit bookmarksChanged(); }

 signals:
  void historyChanged();
  void bookmarksChanged();
};

int main(int argc, char *argv[]) {
  Q_UNUSED(argc);
  Q_UNUSED(argv);

  std::cout << "--- Starting Smart Omnibox Phase 2 Test Suite ---" << std::endl;
  const QLocale trLocale(QLocale::Turkish, QLocale::Turkey);

  // =========================================================================
  // Test A: Exact history evidence
  // ebay.com with sufficient local evidence (visitCount >= 2) + input "ebay" -> https://www.ebay.com/
  // =========================================================================
  {
    auto historyProvider = std::make_shared<HistoryCandidateProvider>();
    historyProvider->addHistoryEntry(QUrl(QStringLiteral("https://www.ebay.com/")), QStringLiteral("eBay"), QDateTime::currentDateTimeUtc(), 5);

    CompositeNavigationCandidateProvider composite;
    composite.addProvider(historyProvider);
    composite.addProvider(std::make_shared<BootstrapWellKnownSiteProvider>());

    const auto res = AddressInputResolver::resolve(
        QStringLiteral("ebay"), QStringLiteral("Google"), trLocale, &composite);
    assert(res.classification == AddressInputClassification::WellKnownAlias);
    assert(res.url == QUrl(QStringLiteral("https://www.ebay.com/")));
    std::cout << "  [PASS] Test A: Exact history evidence (ebay -> ebay.com)" << std::endl;
  }

  // =========================================================================
  // Test B: Single accidental history
  // single visit (visitCount = 1), weak evidence -> drops safely to Search
  // =========================================================================
  {
    auto historyProvider = std::make_shared<HistoryCandidateProvider>();
    // Single accidental visit
    historyProvider->addHistoryEntry(QUrl(QStringLiteral("https://www.accidental-typo-site.org/")), QStringLiteral("Typo"), QDateTime::currentDateTimeUtc(), 1);

    CompositeNavigationCandidateProvider composite;
    composite.addProvider(historyProvider);

    const auto res = AddressInputResolver::resolve(
        QStringLiteral("accidental-typo-site"), QStringLiteral("Google"), trLocale, &composite);
    assert(res.classification == AddressInputClassification::Search);
    assert(res.searchQuery == QStringLiteral("accidental-typo-site"));
    std::cout << "  [PASS] Test B: Single accidental history drops safely to Search" << std::endl;
  }

  // =========================================================================
  // Test C: Bookmark host
  // bookmark https://example.org/my-docs + input "example" -> canonical host root https://example.org/
  // =========================================================================
  {
    auto bookmarkProvider = std::make_shared<BookmarkCandidateProvider>();
    bookmarkProvider->addBookmark(QUrl(QStringLiteral("https://example.org/my-docs")), QStringLiteral("Documentation"));

    CompositeNavigationCandidateProvider composite;
    composite.addProvider(bookmarkProvider);

    const auto res = AddressInputResolver::resolve(
        QStringLiteral("example"), QStringLiteral("Google"), trLocale, &composite);
    assert(res.classification == AddressInputClassification::WellKnownAlias);
    assert(res.url == QUrl(QStringLiteral("https://example.org/")));
    std::cout << "  [PASS] Test C: Bookmark host token resolves to canonical host root" << std::endl;
  }

  // =========================================================================
  // Test D: Bookmark title
  // title "Muhasebe", URL https://portal.example.org/accounting + input "muhasebe" -> preserves specific path
  // =========================================================================
  {
    auto bookmarkProvider = std::make_shared<BookmarkCandidateProvider>();
    bookmarkProvider->addBookmark(QUrl(QStringLiteral("https://portal.example.org/accounting")), QStringLiteral("Muhasebe"));

    CompositeNavigationCandidateProvider composite;
    composite.addProvider(bookmarkProvider);

    const auto res = AddressInputResolver::resolve(
        QStringLiteral("muhasebe"), QStringLiteral("Google"), trLocale, &composite);
    assert(res.classification == AddressInputClassification::WellKnownAlias);
    assert(res.url == QUrl(QStringLiteral("https://portal.example.org/accounting")));
    std::cout << "  [PASS] Test D: Bookmark title match preserves specific path" << std::endl;
  }

  // =========================================================================
  // Test E: Frequency scoring
  // same token "ebay": ebay.com x20 vs ebay.de x1 -> ebay.com wins decisively
  // =========================================================================
  {
    auto historyProvider = std::make_shared<HistoryCandidateProvider>();
    historyProvider->addHistoryEntry(QUrl(QStringLiteral("https://www.ebay.com/")), QStringLiteral("eBay US"), QDateTime::currentDateTimeUtc().addDays(-2), 20);
    historyProvider->addHistoryEntry(QUrl(QStringLiteral("https://www.ebay.de/")), QStringLiteral("eBay DE"), QDateTime::currentDateTimeUtc().addDays(-2), 1);

    CompositeNavigationCandidateProvider composite;
    composite.addProvider(historyProvider);

    const auto res = AddressInputResolver::resolve(
        QStringLiteral("ebay"), QStringLiteral("Google"), trLocale, &composite);
    assert(res.classification == AddressInputClassification::WellKnownAlias);
    assert(res.url == QUrl(QStringLiteral("https://www.ebay.com/")));
    std::cout << "  [PASS] Test E: Higher frequency candidate wins (ebay.com x20 vs ebay.de x1)" << std::endl;
  }

  // =========================================================================
  // Test F: Ambiguity handling
  // two strong candidates producing the exact same token with close scores (e.g. shop.example.com vs shop.example.org)
  // -> ambiguous, drops to Search!
  // =========================================================================
  {
    auto historyProvider = std::make_shared<HistoryCandidateProvider>();
    historyProvider->addHistoryEntry(QUrl(QStringLiteral("https://shop.example.com/")), QStringLiteral("Shop COM"), QDateTime::currentDateTimeUtc(), 10);
    historyProvider->addHistoryEntry(QUrl(QStringLiteral("https://shop.example.org/")), QStringLiteral("Shop ORG"), QDateTime::currentDateTimeUtc(), 10);

    CompositeNavigationCandidateProvider composite;
    composite.addProvider(historyProvider);

    const auto res = AddressInputResolver::resolve(
        QStringLiteral("shop"), QStringLiteral("Google"), trLocale, &composite);
    assert(res.classification == AddressInputClassification::Search);
    assert(res.searchQuery == QStringLiteral("shop"));
    std::cout << "  [PASS] Test F: Competing candidates with identical token trigger safe Search fallback" << std::endl;
  }

  // =========================================================================
  // Test G: Multi-word query
  // "ebay telefon" -> Search
  // =========================================================================
  {
    auto historyProvider = std::make_shared<HistoryCandidateProvider>();
    historyProvider->addHistoryEntry(QUrl(QStringLiteral("https://www.ebay.com/")), QStringLiteral("eBay"), QDateTime::currentDateTimeUtc(), 20);

    CompositeNavigationCandidateProvider composite;
    composite.addProvider(historyProvider);
    composite.addProvider(std::make_shared<BootstrapWellKnownSiteProvider>());

    const auto res = AddressInputResolver::resolve(
        QStringLiteral("ebay telefon"), QStringLiteral("Google"), trLocale, &composite);
    assert(res.classification == AddressInputClassification::Search);
    assert(res.searchQuery == QStringLiteral("ebay telefon"));
    std::cout << "  [PASS] Test G: Multi-word query always resolves to Search" << std::endl;
  }

  // =========================================================================
  // Test H: Unknown word
  // "mikrofon" -> Search
  // =========================================================================
  {
    CompositeNavigationCandidateProvider composite;
    composite.addProvider(std::make_shared<BootstrapWellKnownSiteProvider>());

    const auto res = AddressInputResolver::resolve(
        QStringLiteral("mikrofon"), QStringLiteral("Google"), trLocale, &composite);
    assert(res.classification == AddressInputClassification::Search);
    assert(res.searchQuery == QStringLiteral("mikrofon"));
    std::cout << "  [PASS] Test H: Unknown single word with no candidate drops to Search" << std::endl;
  }

  // =========================================================================
  // Test I: Substring safety
  // "notebay" with history containing ebay.com -> does NOT match, resolves to Search
  // =========================================================================
  {
    auto historyProvider = std::make_shared<HistoryCandidateProvider>();
    historyProvider->addHistoryEntry(QUrl(QStringLiteral("https://www.ebay.com/")), QStringLiteral("eBay"), QDateTime::currentDateTimeUtc(), 50);

    CompositeNavigationCandidateProvider composite;
    composite.addProvider(historyProvider);
    composite.addProvider(std::make_shared<BootstrapWellKnownSiteProvider>());

    const auto res = AddressInputResolver::resolve(
        QStringLiteral("notebay"), QStringLiteral("Google"), trLocale, &composite);
    assert(res.classification == AddressInputClassification::Search);
    assert(res.searchQuery == QStringLiteral("notebay"));
    std::cout << "  [PASS] Test I: Substring safety verified (notebay does not match ebay)" << std::endl;
  }

  // =========================================================================
  // Test J: Bootstrap fallback & Local evidence priority
  // youtube without history -> youtube.com
  // youtube with custom local candidate (e.g. internal video portal) -> local candidate takes priority!
  // =========================================================================
  {
    CompositeNavigationCandidateProvider compositeOnlyBootstrap;
    compositeOnlyBootstrap.addProvider(std::make_shared<BootstrapWellKnownSiteProvider>());

    const auto resBootstrap = AddressInputResolver::resolve(
        QStringLiteral("youtube"), QStringLiteral("Google"), trLocale, &compositeOnlyBootstrap);
    assert(resBootstrap.classification == AddressInputClassification::WellKnownAlias);
    assert(resBootstrap.url == QUrl(QStringLiteral("https://www.youtube.com/")));

    // Now test with local evidence override:
    auto customBookmark = std::make_shared<BookmarkCandidateProvider>();
    customBookmark->addBookmark(QUrl(QStringLiteral("https://custom-youtube.internal/")), QStringLiteral("youtube"));

    CompositeNavigationCandidateProvider compositeWithLocal;
    compositeWithLocal.addProvider(customBookmark);
    compositeWithLocal.addProvider(std::make_shared<BootstrapWellKnownSiteProvider>());

    const auto resLocal = AddressInputResolver::resolve(
        QStringLiteral("youtube"), QStringLiteral("Google"), trLocale, &compositeWithLocal);
    assert(resLocal.classification == AddressInputClassification::WellKnownAlias);
    assert(resLocal.url == QUrl(QStringLiteral("https://custom-youtube.internal/")));
    std::cout << "  [PASS] Test J: Bootstrap fallback functions and local evidence takes priority" << std::endl;
  }

  // =========================================================================
  // Test K: Deep history canonicalization
  // history only has https://www.ebay.com/itm/987654321?ref=test + input "ebay"
  // -> canonical root https://www.ebay.com/
  // =========================================================================
  {
    auto historyProvider = std::make_shared<HistoryCandidateProvider>();
    historyProvider->addHistoryEntry(QUrl(QStringLiteral("https://www.ebay.com/itm/987654321?ref=test")), QStringLiteral("Item"), QDateTime::currentDateTimeUtc(), 10);

    CompositeNavigationCandidateProvider composite;
    composite.addProvider(historyProvider);

    const auto res = AddressInputResolver::resolve(
        QStringLiteral("ebay"), QStringLiteral("Google"), trLocale, &composite);
    assert(res.classification == AddressInputClassification::WellKnownAlias);
    assert(res.url == QUrl(QStringLiteral("https://www.ebay.com/")));
    std::cout << "  [PASS] Test K: Deep path history entries resolve to canonical root URL" << std::endl;
  }

  // =========================================================================
  // Test L: Dangerous schemes
  // javascript:, data:, file: must NEVER navigate directly
  // =========================================================================
  {
    CompositeNavigationCandidateProvider composite;
    composite.addProvider(std::make_shared<BootstrapWellKnownSiteProvider>());

    const auto res1 = AddressInputResolver::resolve(
        QStringLiteral("javascript:alert(1)"), QStringLiteral("Google"), trLocale, &composite);
    assert(res1.classification == AddressInputClassification::Search);

    const auto res2 = AddressInputResolver::resolve(
        QStringLiteral("data:text/html,<h1>test</h1>"), QStringLiteral("Google"), trLocale, &composite);
    assert(res2.classification == AddressInputClassification::Search);

    const auto res3 = AddressInputResolver::resolve(
        QStringLiteral("file:///etc/passwd"), QStringLiteral("Google"), trLocale, &composite);
    assert(res3.classification == AddressInputClassification::Search);
    std::cout << "  [PASS] Test L: Dangerous schemes security policy strictly preserved" << std::endl;
  }

  // =========================================================================
  // Test M: Top Omnibox / New Tab parity
  // AddressInputResolver::resolveUrl produces identical URL for identical inputs
  // =========================================================================
  {
    auto historyProvider = std::make_shared<HistoryCandidateProvider>();
    historyProvider->addHistoryEntry(QUrl(QStringLiteral("https://www.ebay.com/")), QStringLiteral("eBay"), QDateTime::currentDateTimeUtc(), 5);

    CompositeNavigationCandidateProvider composite;
    composite.addProvider(historyProvider);
    composite.addProvider(std::make_shared<BootstrapWellKnownSiteProvider>());

    const QString input = QStringLiteral("ebay");
    const QUrl topOmniboxUrl = AddressInputResolver::resolveUrl(input, QStringLiteral("Google"), trLocale, &composite);
    const QUrl newTabUrl = AddressInputResolver::resolveUrl(input, QStringLiteral("Google"), trLocale, &composite);
    assert(topOmniboxUrl == newTabUrl);
    assert(topOmniboxUrl == QUrl(QStringLiteral("https://www.ebay.com/")));
    std::cout << "  [PASS] Test M: Top Omnibox and New Tab address input parity verified" << std::endl;
  }

  // =========================================================================
  // Test N: Multi-window provider consistency
  // Two CompositeNavigationCandidateProvider instances connected to the same MockProfileDataProvider
  // see identical candidate intelligence and both refresh upon signal
  // =========================================================================
  {
    MockProfileDataProvider mockProfile;
    mockProfile.historyList.append({QStringLiteral("eBay"), QUrl(QStringLiteral("https://www.ebay.com/")), QDateTime::currentDateTimeUtc()});
    mockProfile.frequentList.append({QStringLiteral("eBay"), QUrl(QStringLiteral("https://www.ebay.com/")), QUrl(QStringLiteral("https://www.ebay.com/")), 10, 0, QDateTime::currentDateTimeUtc()});

    CompositeNavigationCandidateProvider window1Composite;
    window1Composite.addProvider(std::make_shared<HistoryCandidateProvider>(&mockProfile, &mockProfile));

    CompositeNavigationCandidateProvider window2Composite;
    window2Composite.addProvider(std::make_shared<HistoryCandidateProvider>(&mockProfile, &mockProfile));

    const auto resWin1 = AddressInputResolver::resolve(QStringLiteral("ebay"), QStringLiteral("Google"), trLocale, &window1Composite);
    const auto resWin2 = AddressInputResolver::resolve(QStringLiteral("ebay"), QStringLiteral("Google"), trLocale, &window2Composite);
    assert(resWin1.url == resWin2.url);
    assert(resWin1.url == QUrl(QStringLiteral("https://www.ebay.com/")));

    // Update profile data and trigger signal
    mockProfile.historyList.append({QStringLiteral("Amazon"), QUrl(QStringLiteral("https://www.amazon.com/")), QDateTime::currentDateTimeUtc()});
    mockProfile.frequentList.append({QStringLiteral("Amazon"), QUrl(QStringLiteral("https://www.amazon.com/")), QUrl(QStringLiteral("https://www.amazon.com/")), 15, 0, QDateTime::currentDateTimeUtc()});
    mockProfile.triggerHistoryChanged();

    const auto resWin1Updated = AddressInputResolver::resolve(QStringLiteral("amazon"), QStringLiteral("Google"), trLocale, &window1Composite);
    const auto resWin2Updated = AddressInputResolver::resolve(QStringLiteral("amazon"), QStringLiteral("Google"), trLocale, &window2Composite);
    assert(resWin1Updated.url == resWin2Updated.url);
    assert(resWin1Updated.url == QUrl(QStringLiteral("https://www.amazon.com/")));
    std::cout << "  [PASS] Test N: Multi-window consistency and signal propagation verified" << std::endl;
  }

  // =========================================================================
  // Test O: 10k history indexed lookup benchmark & correctness
  // Verify indexed lookup correctness and output informational benchmark timing
  // =========================================================================
  {
    auto bigHistoryProvider = std::make_shared<HistoryCandidateProvider>();
    const auto startTime = std::chrono::steady_clock::now();

    // Insert 10,000 synthetic entries
    for (int i = 0; i < 10000; ++i) {
      const QString host = QStringLiteral("site%1.example.org").arg(i);
      const QUrl url(QStringLiteral("https://") + host + QStringLiteral("/page/%1").arg(i));
      bigHistoryProvider->addHistoryEntry(url, QStringLiteral("Site %1").arg(i), QDateTime::currentDateTimeUtc().addSecs(-i), 2);
    }
    // Add targeted entry
    bigHistoryProvider->addHistoryEntry(QUrl(QStringLiteral("https://www.targetsite.com/deep/path")), QStringLiteral("Target"), QDateTime::currentDateTimeUtc(), 25);

    const auto indexBuiltTime = std::chrono::steady_clock::now();
    const auto buildMs = std::chrono::duration_cast<std::chrono::milliseconds>(indexBuiltTime - startTime).count();

    CompositeNavigationCandidateProvider composite;
    composite.addProvider(bigHistoryProvider);

    // Query targeted entry
    const auto queryStart = std::chrono::steady_clock::now();
    const auto res = AddressInputResolver::resolve(QStringLiteral("targetsite"), QStringLiteral("Google"), trLocale, &composite);
    const auto queryEnd = std::chrono::steady_clock::now();
    const auto queryUs = std::chrono::duration_cast<std::chrono::microseconds>(queryEnd - queryStart).count();

    assert(res.classification == AddressInputClassification::WellKnownAlias);
    assert(res.url == QUrl(QStringLiteral("https://www.targetsite.com/")));

    std::cout << "  [PASS] Test O: 10,000 synthetic history entries verified." << std::endl;
    std::cout << "         Index build time: " << buildMs << " ms" << std::endl;
    std::cout << "         Indexed lookup query time: " << queryUs << " microseconds" << std::endl;
  }

  std::cout << "\nAll Smart Omnibox Phase 2 tests passed successfully!" << std::endl;
  return 0;
}

#include "smart_omnibox_phase2_test.moc"
