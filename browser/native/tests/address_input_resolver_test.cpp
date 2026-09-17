#include <cassert>
#include <iostream>
#include <QCoreApplication>
#include <QLocale>

#include "core/address_input_resolver.h"

using namespace ardali::core;

int main(int argc, char *argv[]) {
  QCoreApplication app(argc, argv);

  std::cout << "--- Starting AddressInputResolver Test Suite ---" << std::endl;

  const QLocale trLocale(QLocale::Turkish, QLocale::Turkey);
  const QLocale usLocale(QLocale::English, QLocale::UnitedStates);
  const QLocale deLocale(QLocale::German, QLocale::Germany);
  const QLocale ukLocale(QLocale::English, QLocale::UnitedKingdom);

  // 1. amazon [TR locale] -> amazon.com.tr
  {
    const auto res = AddressInputResolver::resolve(
        QStringLiteral("amazon"), QStringLiteral("Google"), trLocale);
    assert(res.classification == AddressInputClassification::WellKnownAlias);
    assert(res.url.toString() == QStringLiteral("https://www.amazon.com.tr/"));
    std::cout << "  [PASS] 1. amazon [TR locale] -> https://www.amazon.com.tr/" << std::endl;
  }

  // 2. amazon [non-TR locale] -> canonical domain (NOT forced to TR)
  {
    const auto resUS = AddressInputResolver::resolve(
        QStringLiteral("amazon"), QStringLiteral("Google"), usLocale);
    assert(resUS.classification == AddressInputClassification::WellKnownAlias);
    assert(resUS.url.toString() == QStringLiteral("https://www.amazon.com/"));

    const auto resDE = AddressInputResolver::resolve(
        QStringLiteral("amazon"), QStringLiteral("Google"), deLocale);
    assert(resDE.classification == AddressInputClassification::WellKnownAlias);
    assert(resDE.url.toString() == QStringLiteral("https://www.amazon.de/"));

    const auto resUK = AddressInputResolver::resolve(
        QStringLiteral("amazon"), QStringLiteral("Google"), ukLocale);
    assert(resUK.classification == AddressInputClassification::WellKnownAlias);
    assert(resUK.url.toString() == QStringLiteral("https://www.amazon.co.uk/"));

    std::cout << "  [PASS] 2. amazon [non-TR locales] -> canonical/locale domain (US, DE, UK)" << std::endl;
  }

  // 3. youtube -> youtube.com
  {
    const auto res = AddressInputResolver::resolve(
        QStringLiteral("youtube"), QStringLiteral("Google"), trLocale);
    assert(res.classification == AddressInputClassification::WellKnownAlias);
    assert(res.url.toString() == QStringLiteral("https://www.youtube.com/"));
    std::cout << "  [PASS] 3. youtube -> https://www.youtube.com/" << std::endl;
  }

  // 4. github -> github.com
  {
    const auto res = AddressInputResolver::resolve(
        QStringLiteral("github"), QStringLiteral("Google"), trLocale);
    assert(res.classification == AddressInputClassification::WellKnownAlias);
    assert(res.url.toString() == QStringLiteral("https://github.com/"));
    std::cout << "  [PASS] 4. github -> https://github.com/" << std::endl;
  }

  // 5. amazon.com.tr -> direct domain navigation
  {
    const auto res = AddressInputResolver::resolve(
        QStringLiteral("amazon.com.tr"), QStringLiteral("Google"), trLocale);
    assert(res.classification == AddressInputClassification::Domain);
    assert(res.url.toString() == QStringLiteral("https://amazon.com.tr"));
    std::cout << "  [PASS] 5. amazon.com.tr -> https://amazon.com.tr" << std::endl;
  }

  // 6. https://amazon.com.tr -> direct URL navigation
  {
    const auto res = AddressInputResolver::resolve(
        QStringLiteral("https://amazon.com.tr"), QStringLiteral("Google"), trLocale);
    assert(res.classification == AddressInputClassification::DirectUrl);
    assert(res.url.toString() == QStringLiteral("https://amazon.com.tr"));
    std::cout << "  [PASS] 6. https://amazon.com.tr -> https://amazon.com.tr" << std::endl;
  }

  // 7. localhost:3000 and localhost -> direct navigation
  {
    const auto res1 = AddressInputResolver::resolve(
        QStringLiteral("localhost:3000"), QStringLiteral("Google"), trLocale);
    assert(res1.classification == AddressInputClassification::Localhost);
    assert(res1.url.toString() == QStringLiteral("http://localhost:3000/"));

    const auto res2 = AddressInputResolver::resolve(
        QStringLiteral("localhost"), QStringLiteral("Google"), trLocale);
    assert(res2.classification == AddressInputClassification::Localhost);
    assert(res2.url.toString() == QStringLiteral("http://localhost/"));

    const auto res3 = AddressInputResolver::resolve(
        QStringLiteral("127.0.0.1:8080/dashboard"), QStringLiteral("Google"), trLocale);
    assert(res3.classification == AddressInputClassification::Localhost);
    assert(res3.url.toString() == QStringLiteral("http://127.0.0.1:8080/dashboard"));

    std::cout << "  [PASS] 7. localhost and 127.0.0.1 with port/path verified." << std::endl;
  }

  // 8. IP Address navigation
  {
    const auto res1 = AddressInputResolver::resolve(
        QStringLiteral("192.168.1.1"), QStringLiteral("Google"), trLocale);
    assert(res1.classification == AddressInputClassification::IpAddress);
    assert(res1.url.toString() == QStringLiteral("http://192.168.1.1/"));

    const auto res2 = AddressInputResolver::resolve(
        QStringLiteral("192.168.1.1:8443/admin"), QStringLiteral("Google"), trLocale);
    assert(res2.classification == AddressInputClassification::IpAddress);
    assert(res2.url.toString() == QStringLiteral("http://192.168.1.1:8443/admin"));

    std::cout << "  [PASS] 8. IPv4 direct navigation verified." << std::endl;
  }

  // 9. Multi-word search queries
  {
    const auto res1 = AddressInputResolver::resolve(
        QStringLiteral("amazon telefon"), QStringLiteral("Google"), trLocale);
    assert(res1.classification == AddressInputClassification::Search);
    assert(res1.url.toEncoded() == "https://www.google.com/search?q=amazon%20telefon");

    const auto res2 = AddressInputResolver::resolve(
        QStringLiteral("youtube video"), QStringLiteral("Google"), trLocale);
    assert(res2.classification == AddressInputClassification::Search);
    assert(res2.url.toEncoded() == "https://www.google.com/search?q=youtube%20video");

    const auto res3 = AddressInputResolver::resolve(
        QStringLiteral("en iyi laptop"), QStringLiteral("DuckDuckGo"), trLocale);
    assert(res3.classification == AddressInputClassification::Search);
    assert(res3.url.toEncoded() == "https://duckduckgo.com/?q=en%20iyi%20laptop");

    std::cout << "  [PASS] 9. Multi-word queries correctly classified as Search." << std::endl;
  }

  // 10. Security: Substring and non-alias single words fall back to search
  {
    const auto res1 = AddressInputResolver::resolve(
        QStringLiteral("notamazon"), QStringLiteral("Google"), trLocale);
    assert(res1.classification == AddressInputClassification::Search);
    assert(res1.url.toString() == QStringLiteral("https://www.google.com/search?q=notamazon"));

    const auto res2 = AddressInputResolver::resolve(
        QStringLiteral("myyoutube"), QStringLiteral("Google"), trLocale);
    assert(res2.classification == AddressInputClassification::Search);
    assert(res2.url.toString() == QStringLiteral("https://www.google.com/search?q=myyoutube"));

    const auto res3 = AddressInputResolver::resolve(
        QStringLiteral("github-malware"), QStringLiteral("Google"), trLocale);
    assert(res3.classification == AddressInputClassification::Search);
    assert(res3.url.toString() == QStringLiteral("https://www.google.com/search?q=github-malware"));

    std::cout << "  [PASS] 10. Security: Substrings (notamazon, myyoutube, github-malware) evaluate as Search." << std::endl;
  }

  // 11. Domain precedence over alias: youtube.example.com
  {
    const auto res = AddressInputResolver::resolve(
        QStringLiteral("youtube.example.com"), QStringLiteral("Google"), trLocale);
    assert(res.classification == AddressInputClassification::Domain);
    assert(res.url.toString() == QStringLiteral("https://youtube.example.com"));
    std::cout << "  [PASS] 11. youtube.example.com is classified as Domain, NOT alias." << std::endl;
  }

  // 12. Security: Dangerous schemes (javascript:, data:, file:) must NOT be navigation URLs
  {
    const auto res1 = AddressInputResolver::resolve(
        QStringLiteral("javascript:alert(1)"), QStringLiteral("Google"), trLocale);
    assert(res1.classification == AddressInputClassification::Search);
    assert(!res1.url.scheme().startsWith(QStringLiteral("javascript")));

    const auto res2 = AddressInputResolver::resolve(
        QStringLiteral("data:text/html,<h1>test</h1>"), QStringLiteral("Google"), trLocale);
    assert(res2.classification == AddressInputClassification::Search);
    assert(!res2.url.scheme().startsWith(QStringLiteral("data")));

    const auto res3 = AddressInputResolver::resolve(
        QStringLiteral("file:///etc/passwd"), QStringLiteral("Google"), trLocale);
    assert(res3.classification == AddressInputClassification::Search);
    assert(!res3.url.scheme().startsWith(QStringLiteral("file")));

    std::cout << "  [PASS] 12. Security: Dangerous schemes safely neutralized to search." << std::endl;
  }

  // 13. Invalid/malformed port handling
  {
    const auto res1 = AddressInputResolver::resolve(
        QStringLiteral("example.com:99999"), QStringLiteral("Google"), trLocale);
    assert(res1.classification == AddressInputClassification::Search);

    const auto res2 = AddressInputResolver::resolve(
        QStringLiteral("localhost:abc"), QStringLiteral("Google"), trLocale);
    assert(res2.classification == AddressInputClassification::Search);

    const auto res3 = AddressInputResolver::resolve(
        QStringLiteral("example.com:"), QStringLiteral("Google"), trLocale);
    assert(res3.classification == AddressInputClassification::Search);

    std::cout << "  [PASS] 13. Malformed ports safely fallback to Search." << std::endl;
  }

  // 14. Complex paths and queries: example.com/path, sub.example.co.uk/test?q=1
  {
    const auto res1 = AddressInputResolver::resolve(
        QStringLiteral("example.com/path"), QStringLiteral("Google"), trLocale);
    assert(res1.classification == AddressInputClassification::Domain);
    assert(res1.url.toString() == QStringLiteral("https://example.com/path"));

    const auto res2 = AddressInputResolver::resolve(
        QStringLiteral("sub.example.co.uk/test?q=1"), QStringLiteral("Google"), trLocale);
    assert(res2.classification == AddressInputClassification::Domain);
    assert(res2.url.toString() == QStringLiteral("https://sub.example.co.uk/test?q=1"));

    std::cout << "  [PASS] 14. Path and query parameters on schemeless domains preserved." << std::endl;
  }

  // 15. Whitespace normalization
  {
    const auto res = AddressInputResolver::resolve(
        QStringLiteral("   amazon   "), QStringLiteral("Google"), trLocale);
    assert(res.classification == AddressInputClassification::WellKnownAlias);
    assert(res.url.toString() == QStringLiteral("https://www.amazon.com.tr/"));
    std::cout << "  [PASS] 15. Whitespace trimming / normalization verified." << std::endl;
  }

  // 16. Search engine URL generation
  {
    assert(AddressInputResolver::searchUrlForEngine(QStringLiteral("Google"), QStringLiteral("qt webengine")).toEncoded()
           == "https://www.google.com/search?q=qt%20webengine");
    assert(AddressInputResolver::searchUrlForEngine(QStringLiteral("Brave"), QStringLiteral("qt webengine")).toEncoded()
           == "https://search.brave.com/search?q=qt%20webengine");
    assert(AddressInputResolver::searchUrlForEngine(QStringLiteral("DuckDuckGo"), QStringLiteral("qt webengine")).toEncoded()
           == "https://duckduckgo.com/?q=qt%20webengine");
    assert(AddressInputResolver::searchUrlForEngine(QStringLiteral("Bing"), QStringLiteral("qt webengine")).toEncoded()
           == "https://www.bing.com/search?q=qt%20webengine");
    std::cout << "  [PASS] 16. Configured search engines (Google, Brave, DuckDuckGo, Bing) verified." << std::endl;
  }

  // 17. Pluggable Navigation Candidate Provider (Phase 2 extension interface)
  {
    class MockCustomProvider final : public INavigationCandidateProvider {
     public:
      std::optional<QUrl> findNavigationCandidate(
          const QString &token,
          const QLocale &) const override {
        if (token == QLatin1String("myintranet")) {
          return QUrl(QStringLiteral("https://intranet.company.internal/"));
        }
        return std::nullopt;
      }
    };

    MockCustomProvider customProvider;
    const auto res = AddressInputResolver::resolve(
        QStringLiteral("myintranet"), QStringLiteral("Google"), trLocale, &customProvider);
    assert(res.classification == AddressInputClassification::WellKnownAlias);
    assert(res.url.toString() == QStringLiteral("https://intranet.company.internal/"));
    std::cout << "  [PASS] 17. Custom INavigationCandidateProvider pluggability verified." << std::endl;
  }

  std::cout << "\n=== ALL 17 ADDRESS INPUT RESOLVER TESTS PASSED SUCCESSFULLY! ===" << std::endl;
  return 0;
}
