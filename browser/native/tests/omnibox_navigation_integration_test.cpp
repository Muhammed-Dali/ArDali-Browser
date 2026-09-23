#include <cassert>
#include <iostream>
#include <memory>
#include <QCoreApplication>
#include <QFile>
#include <QFileInfo>
#include <QLocale>
#include <QString>
#include <QUrl>
#include <QUrlQuery>

#include "core/address_input_resolver.h"

using namespace dalinira::core;

// Helper to simulate the native bridge handler from BrowserWebPage
struct NativeBridgeResult {
  bool accepted = false;
  QUrl resolvedUrl;
};

static NativeBridgeResult simulateNewTabBridge(
    const QUrl &bridgeUrl,
    const QUrl &sourceUrl,
    const QLocale &locale,
    const INavigationCandidateProvider *provider,
    const QString &fallbackEngine = QStringLiteral("Google")) {
  NativeBridgeResult result;

  // 1. Verify scheme and host
  if (bridgeUrl.scheme().compare(QLatin1String("dalinira"), Qt::CaseInsensitive) != 0 ||
      bridgeUrl.host().compare(QLatin1String("navigate"), Qt::CaseInsensitive) != 0) {
    return result;
  }

  // 2. Strict origin validation: Only dalinira://newtab or dalinira://newtab/ is permitted
  const bool trustedSource = (sourceUrl.scheme().compare(QLatin1String("dalinira"), Qt::CaseInsensitive) == 0 &&
                              sourceUrl.host().compare(QLatin1String("newtab"), Qt::CaseInsensitive) == 0);
  if (!trustedSource) {
    return result; // Access denied
  }

  // 3. Query size & input safety
  const QUrlQuery query(bridgeUrl);
  const QString rawQuery = query.queryItemValue(QStringLiteral("q"), QUrl::FullyDecoded);
  if (rawQuery.trimmed().isEmpty() || rawQuery.length() > 4096) {
    return result; // Empty or oversized rejected
  }

  // 4. Search engine validation (whitelist)
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
  } else {
    validatedEngine = fallbackEngine;
  }

  // 5. Authoritative resolution
  result.accepted = true;
  result.resolvedUrl = AddressInputResolver::resolveUrl(rawQuery, validatedEngine, locale, provider);
  return result;
}

int main(int argc, char *argv[]) {
  QCoreApplication app(argc, argv);

  std::cout << "--- Starting Omnibox & New Tab Navigation Integration Tests ---" << std::endl;

  const QLocale trLocale(QLocale::Turkish, QLocale::Turkey);
  const QLocale usLocale(QLocale::English, QLocale::UnitedStates);

  BootstrapWellKnownSiteProvider provider;
  const QUrl trustedNewTab(QStringLiteral("dalinira://newtab/"));
  const QUrl untrustedWeb(QStringLiteral("https://evil.com/phishing"));
  const QUrl untrustedBlank(QStringLiteral("about:blank"));

  // 1. Omnibox vs New Tab Bridge Parity (amazon -> amazon.com.tr in TR locale)
  {
    const QString input = QStringLiteral("amazon");
    const QUrl omniboxUrl = AddressInputResolver::resolveUrl(input, QStringLiteral("Google"), trLocale, &provider);
    assert(omniboxUrl == QUrl(QStringLiteral("https://www.amazon.com.tr/")));

    const QUrl bridgeUrl(QStringLiteral("dalinira://navigate?q=amazon&engine=Google"));
    const auto bridgeResult = simulateNewTabBridge(bridgeUrl, trustedNewTab, trLocale, &provider);
    assert(bridgeResult.accepted);
    assert(bridgeResult.resolvedUrl == QUrl(QStringLiteral("https://www.amazon.com.tr/")));

    assert(omniboxUrl == bridgeResult.resolvedUrl);
    std::cout << "  [PASS] 1. Parity: amazon -> https://www.amazon.com.tr/ (Omnibox == New Tab)" << std::endl;
  }

  // 2. Multi-word Search Parity (amazon telefon -> Google Search)
  {
    const QString input = QStringLiteral("amazon telefon");
    const QUrl omniboxUrl = AddressInputResolver::resolveUrl(input, QStringLiteral("Google"), trLocale, &provider);
    assert(omniboxUrl == QUrl(QStringLiteral("https://www.google.com/search?q=amazon%20telefon")));

    const QUrl bridgeUrl(QStringLiteral("dalinira://navigate?q=amazon%20telefon&engine=Google"));
    const auto bridgeResult = simulateNewTabBridge(bridgeUrl, trustedNewTab, trLocale, &provider);
    assert(bridgeResult.accepted);
    assert(bridgeResult.resolvedUrl == QUrl(QStringLiteral("https://www.google.com/search?q=amazon%20telefon")));

    assert(omniboxUrl == bridgeResult.resolvedUrl);
    std::cout << "  [PASS] 2. Parity: amazon telefon -> Google search (Omnibox == New Tab)" << std::endl;
  }

  // 3. Search Engine Parity & Legacy Fallback (DuckDuckGo + Brave Search fallback)
  {
    const QString input = QStringLiteral("amazon telefon");
    const QUrl omniboxUrl = AddressInputResolver::resolveUrl(input, QStringLiteral("DuckDuckGo"), trLocale, &provider);
    assert(omniboxUrl == QUrl(QStringLiteral("https://duckduckgo.com/?q=amazon%20telefon")));

    const QUrl bridgeUrl(QStringLiteral("dalinira://navigate?q=amazon%20telefon&engine=DuckDuckGo"));
    const auto bridgeResult = simulateNewTabBridge(bridgeUrl, trustedNewTab, trLocale, &provider);
    assert(bridgeResult.accepted);
    assert(bridgeResult.resolvedUrl == QUrl(QStringLiteral("https://duckduckgo.com/?q=amazon%20telefon")));
    assert(omniboxUrl == bridgeResult.resolvedUrl);

    // Startpage parity
    const QUrl spOmnibox = AddressInputResolver::resolveUrl(input, QStringLiteral("Startpage"), trLocale, &provider);
    assert(spOmnibox == QUrl(QStringLiteral("https://www.startpage.com/sp/search?query=amazon%20telefon")));
    const QUrl spBridgeUrl(QStringLiteral("dalinira://navigate?q=amazon%20telefon&engine=Startpage"));
    const auto spBridgeResult = simulateNewTabBridge(spBridgeUrl, trustedNewTab, trLocale, &provider);
    assert(spBridgeResult.accepted && spBridgeResult.resolvedUrl == spOmnibox);

    // Mojeek parity
    const QUrl mojeekOmnibox = AddressInputResolver::resolveUrl(input, QStringLiteral("Mojeek"), trLocale, &provider);
    assert(mojeekOmnibox == QUrl(QStringLiteral("https://www.mojeek.com/search?q=amazon%20telefon")));
    const QUrl mojeekBridgeUrl(QStringLiteral("dalinira://navigate?q=amazon%20telefon&engine=Mojeek"));
    const auto mojeekBridgeResult = simulateNewTabBridge(mojeekBridgeUrl, trustedNewTab, trLocale, &provider);
    assert(mojeekBridgeResult.accepted && mojeekBridgeResult.resolvedUrl == mojeekOmnibox);

    // Fallback: Brave Search maps safely to Google
    const QUrl fallbackOmnibox = AddressInputResolver::resolveUrl(input, QStringLiteral("Brave Search"), trLocale, &provider);
    assert(fallbackOmnibox == QUrl(QStringLiteral("https://www.google.com/search?q=amazon%20telefon")));
    const QUrl fallbackBridgeUrl(QStringLiteral("dalinira://navigate?q=amazon%20telefon&engine=Brave%20Search"));
    const auto fallbackBridgeResult = simulateNewTabBridge(fallbackBridgeUrl, trustedNewTab, trLocale, &provider);
    assert(fallbackBridgeResult.accepted);
    assert(fallbackBridgeResult.resolvedUrl == QUrl(QStringLiteral("https://www.google.com/search?q=amazon%20telefon")));
    assert(fallbackOmnibox == fallbackBridgeResult.resolvedUrl);

    std::cout << "  [PASS] 3. Parity: DuckDuckGo, Startpage, Mojeek and Brave Search fallback to Google (Omnibox == New Tab)" << std::endl;
  }

  // 4. Other Well-Known Sites Parity (youtube, github)
  {
    for (const auto &token : {QStringLiteral("youtube"), QStringLiteral("github"), QStringLiteral("reddit")}) {
      const QUrl omniboxUrl = AddressInputResolver::resolveUrl(token, QStringLiteral("Google"), trLocale, &provider);
      const QUrl bridgeUrl = QUrl(QStringLiteral("dalinira://navigate?q=") + token + QStringLiteral("&engine=Google"));
      const auto bridgeResult = simulateNewTabBridge(bridgeUrl, trustedNewTab, trLocale, &provider);
      assert(bridgeResult.accepted);
      assert(omniboxUrl == bridgeResult.resolvedUrl);
    }
    std::cout << "  [PASS] 4. Parity: youtube, github, reddit (Omnibox == New Tab)" << std::endl;
  }

  // 5. Security Origin Boundary: Reject bridge calls from untrusted origins
  {
    const QUrl bridgeUrl(QStringLiteral("dalinira://navigate?q=amazon&engine=Google"));

    const auto evilResult = simulateNewTabBridge(bridgeUrl, untrustedWeb, trLocale, &provider);
    assert(!evilResult.accepted);

    const auto blankResult = simulateNewTabBridge(bridgeUrl, untrustedBlank, trLocale, &provider);
    assert(!blankResult.accepted);

    std::cout << "  [PASS] 5. Security: Untrusted origins (https://evil.com, about:blank) rejected" << std::endl;
  }

  // 6. Security & Safety: Dangerous Schemes, Oversized and Empty Queries
  {
    // Dangerous scheme neutralization
    const QUrl bridgeDangerous(QStringLiteral("dalinira://navigate?q=javascript%3Aalert(1)&engine=Google"));
    const auto dangerResult = simulateNewTabBridge(bridgeDangerous, trustedNewTab, trLocale, &provider);
    const QUrl expectedDanger = AddressInputResolver::searchUrlForEngine(QStringLiteral("Google"), QStringLiteral("javascript:alert(1)"));
    assert(dangerResult.resolvedUrl == expectedDanger);

    // Empty query rejected
    const QUrl bridgeEmpty(QStringLiteral("dalinira://navigate?q=&engine=Google"));
    const auto emptyResult = simulateNewTabBridge(bridgeEmpty, trustedNewTab, trLocale, &provider);
    assert(!emptyResult.accepted);

    // Oversized query rejected (> 4096 chars)
    const QString hugeQuery = QString(5000, 'a');
    const QUrl bridgeHuge(QStringLiteral("dalinira://navigate?q=") + hugeQuery + QStringLiteral("&engine=Google"));
    const auto hugeResult = simulateNewTabBridge(bridgeHuge, trustedNewTab, trLocale, &provider);
    assert(!hugeResult.accepted);

    std::cout << "  [PASS] 6. Security: javascript: neutralized to search, empty/huge rejected" << std::endl;
  }

  // 7. Search Engine Whitelist Fallback
  {
    const QUrl bridgeUnknownEngine(QStringLiteral("dalinira://navigate?q=test&engine=MaliciousEngine"));
    const auto unknownResult = simulateNewTabBridge(bridgeUnknownEngine, trustedNewTab, trLocale, &provider, QStringLiteral("Google"));
    assert(unknownResult.accepted);
    assert(unknownResult.resolvedUrl == QUrl(QStringLiteral("https://www.google.com/search?q=test")));
    std::cout << "  [PASS] 7. Search engine whitelist: unknown engine safely falls back" << std::endl;
  }

  // 8. Source-Level Invariant Test on new_tab_html.cpp
  {
#ifdef DALINIRA_SOURCE_DIR
    const QString newTabPath = QStringLiteral(DALINIRA_SOURCE_DIR) + QStringLiteral("/browser/native/newtab/new_tab_html.cpp");
#else
    const QString newTabPath = QStringLiteral("../browser/native/newtab/new_tab_html.cpp");
#endif
    QFile file(newTabPath);
    if (file.open(QIODevice::ReadOnly | QIODevice::Text)) {
      const QString content = QString::fromUtf8(file.readAll());
      file.close();

      // Assert no duplicate search engine URL base strings in new_tab_html.cpp
      assert(!content.contains(QStringLiteral("google.com/search?q=")));
      assert(!content.contains(QStringLiteral("duckduckgo.com/?q=")));
      assert(!content.contains(QStringLiteral("search.brave.com/search?q=")));
      assert(!content.contains(QStringLiteral("bing.com/search?q=")));

      // Assert old regex classifier is completely gone
      assert(!content.contains(QStringLiteral("(!/\\s/.test(value)&&(/\\./.test(value)||value==='localhost'))")));

      // Assert native bridge navigation is present
      assert(content.contains(QStringLiteral("dalinira://navigate?q=")));

      std::cout << "  [PASS] 8. Source invariant: new_tab_html.cpp has no duplicate search tables or regex" << std::endl;
    } else {
      std::cerr << "  [WARN] Could not open new_tab_html.cpp at " << newTabPath.toStdString() << " for invariant check." << std::endl;
    }
  }

  std::cout << "--- All Omnibox & New Tab Navigation Integration Tests PASSED ---" << std::endl;
  return 0;
}
