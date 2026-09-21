#include <QApplication>
#include <QDateTime>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QSettings>
#include <QTemporaryDir>
#include <QUrl>
#include <QUrlQuery>
#include <QWebEnginePage>
#include <QWebEngineProfile>
#include <QWebEngineSettings>
#include <QTcpServer>
#include <QTcpSocket>
#include <QEventLoop>
#include <QTimer>
#include <QImage>
#include <QIcon>
#include <QBuffer>

#include <cassert>
#include <iostream>

#include "core/browser_profile_data_provider.h"
#include "core/browser_profile_service.h"
#include "core/navigation_candidate.h"
#include "core/search_engine_definition.h"
#include "newtab/new_tab_html.h"
#include "newtab/new_tab_background_store.h"
#include "newtab/new_tab_scheme.h"
#include "blocker/ardali_blocker_service.h"
#include "blocker/ardali_blocker_settings.h"
#include "blocker/ardali_blocker_types.h"

namespace {

class EvidencePage final : public QWebEnginePage {
 public:
  using QWebEnginePage::QWebEnginePage;
 protected:
  void javaScriptConsoleMessage(JavaScriptConsoleMessageLevel, const QString &message, int, const QString &) override {
    std::cerr << "JS: " << message.toStdString() << std::endl;
  }
};

class MockProfileDataProvider final : public ardali::core::IBrowserProfileDataProvider {
 public:
  QList<BrowserHistoryEntry> history;
  QList<BrowserFrequentSite> frequent;
  QList<QUrl> bookmarkUrls;

  QList<BrowserHistoryEntry> recentHistory() const override { return history; }
  QList<BrowserFrequentSite> frequentSites(int limit) const override {
    return limit > 0 ? frequent.mid(0, limit) : QList<BrowserFrequentSite>{};
  }
  QList<QUrl> bookmarks() const override { return bookmarkUrls; }
};

QJsonObject storedHistoryEntry(const QString &directory) {
  QSettings settings(directory + QStringLiteral("/browser-preferences.ini"), QSettings::IniFormat);
  settings.sync();
  const QJsonDocument document = QJsonDocument::fromJson(
      settings.value(QStringLiteral("history/entries")).toByteArray());
  assert(document.isArray() && !document.array().isEmpty());
  return document.array().first().toObject();
}

void testHistoryTitleAndTypedEvidence() {
  QTemporaryDir directory;
  assert(directory.isValid());
  BrowserProfileService service(directory.path(), nullptr);
  const QUrl url(QStringLiteral("https://www.ebay.com/item/42#details"));

  service.recordHistory(url, QString{}, false);
  const auto initialHistory = service.recentHistory();
  const auto initialSites = service.frequentSites();
  assert(initialHistory.size() == 1);
  assert(initialSites.size() == 1);
  assert(initialHistory.first().title == QStringLiteral("www.ebay.com"));
  const QDateTime visitedAt = initialHistory.first().visitedAt;
  const QDateTime lastVisitedAt = initialSites.first().lastVisitedAt;
  const int visitCount = initialSites.first().visitCount;

  assert(service.updateHistoryTitle(url, QStringLiteral("  eBay — Electronics  ")));
  const auto updatedHistory = service.recentHistory();
  const auto updatedSites = service.frequentSites();
  assert(updatedHistory.first().title == QStringLiteral("eBay — Electronics"));
  assert(updatedSites.first().title == QStringLiteral("eBay — Electronics"));
  assert(updatedHistory.first().visitedAt == visitedAt);
  assert(updatedSites.first().lastVisitedAt == lastVisitedAt);
  assert(updatedSites.first().visitCount == visitCount);

  assert(!service.updateHistoryTitle(url, QString{}));
  assert(!service.updateHistoryTitle(url, QStringLiteral("Yeni Sekme")));
  assert(service.recentHistory().first().title == QStringLiteral("eBay — Electronics"));

  service.recordHistory(url, QString{}, true);
  assert(service.frequentSites().first().typedCount == 1);
  QJsonObject stored = storedHistoryEntry(directory.path());
  assert(stored.value(QStringLiteral("isTyped")).toBool());
  assert(stored.value(QStringLiteral("typedCount")).toInt() == 1);

  service.recordHistory(url, QString{}, true);
  assert(service.frequentSites().first().typedCount == 2);
  stored = storedHistoryEntry(directory.path());
  assert(stored.value(QStringLiteral("typedCount")).toInt() == 2);
}

void testBackwardCompatibleTypedCount() {
  QTemporaryDir directory;
  assert(directory.isValid());
  const QString preferencesPath = directory.path() + QStringLiteral("/browser-preferences.ini");
  {
    QSettings settings(preferencesPath, QSettings::IniFormat);
    const QJsonObject oldSite{
        {QStringLiteral("key"), QStringLiteral("example.com")},
        {QStringLiteral("url"), QStringLiteral("https://example.com/")},
        {QStringLiteral("iconLookupUrl"), QStringLiteral("https://example.com/page")},
        {QStringLiteral("title"), QStringLiteral("Example")},
        {QStringLiteral("visitCount"), 3},
        {QStringLiteral("lastVisitedAt"), QDateTime::currentDateTimeUtc().toString(Qt::ISODate)}};
    settings.setValue(QStringLiteral("history/frequentSites"),
                      QJsonDocument(QJsonArray{oldSite}).toJson(QJsonDocument::Compact));
    settings.sync();
  }

  BrowserProfileService service(directory.path(), nullptr);
  const auto sites = service.frequentSites();
  assert(sites.size() == 1);
  assert(sites.first().typedCount == 0);
}

void testSearchHistoryPersistenceAndClearing() {
  QTemporaryDir directory;
  assert(directory.isValid());
  BrowserProfileService service(directory.path(), nullptr);

  service.recordSearch(QStringLiteral("  arch   aur giriş  "));
  service.recordSearch(QStringLiteral("youtube müzik"));
  service.recordSearch(QStringLiteral("arch aur giriş"));
  const QStringList recent = service.recentSearches();
  assert(recent.size() == 2);
  assert(recent.first() == QStringLiteral("arch aur giriş"));
  assert(service.recentSearches(QStringLiteral("aur"), 5) == QStringList{QStringLiteral("arch aur giriş")});
  assert(service.removeSearchHistory(QStringLiteral("youtube müzik")));
  assert(!service.removeSearchHistory(QStringLiteral("bulunmayan sorgu")));
  assert(service.recentSearches() == QStringList{QStringLiteral("arch aur giriş")});
  {
    BrowserProfileService reloaded(directory.path(), nullptr);
    assert(reloaded.recentSearches() == QStringList{QStringLiteral("arch aur giriş")});
  }

  service.clearSearchHistory();
  assert(service.recentSearches().isEmpty());
  service.recordSearch(QStringLiteral("temizlenecek sorgu"));
  service.clearHistory();
  assert(service.recentSearches().isEmpty());

  BrowserProfileService privateService(directory.path() + QStringLiteral("/private"), nullptr, nullptr, true);
  privateService.recordSearch(QStringLiteral("gizli sorgu"));
  assert(privateService.recentSearches().isEmpty());
}

void testAntiPoisoningConfidence() {
  ardali::core::NavigationCandidate passive;
  passive.hasExactTokenMatch = true;
  passive.isExactDomainMatch = true;
  passive.visitCount = 1;
  assert(ardali::core::CandidateScoringConfig::calculateConfidence(passive) == 0.40);
  assert(ardali::core::CandidateScoringConfig::calculateConfidence(passive)
         < ardali::core::CandidateScoringConfig::kMinConfidenceThreshold);

  ardali::core::NavigationCandidate typed = passive;
  typed.typedCount = 1;
  typed.hasTypedEvidence = true;
  assert(ardali::core::CandidateScoringConfig::calculateConfidence(typed) == 0.85);
  assert(ardali::core::CandidateScoringConfig::calculateConfidence(typed)
         >= ardali::core::CandidateScoringConfig::kMinConfidenceThreshold);
}

void testNewTabDataAndScriptSafety() {
  MockProfileDataProvider profile;
  profile.frequent.append({QStringLiteral("Yeni Sekme"), QUrl(QStringLiteral("file:///tmp/nope")),
                           QUrl{}, 99, 0, QDateTime::currentDateTimeUtc()});
  profile.frequent.append({QStringLiteral("  Example  "),
                           QUrl(QStringLiteral("https://user:password@example.com/?token=secret#section")),
                           QUrl{}, 8, 2, QDateTime::currentDateTimeUtc()});
  for (int i = 0; i < 7; ++i) {
    profile.frequent.append({QStringLiteral("Site %1").arg(i),
                             QUrl(QStringLiteral("https://site%1.example/").arg(i)), QUrl{},
                             i + 1, 0, QDateTime::currentDateTimeUtc()});
  }
  profile.bookmarkUrls = {
      QUrl(QStringLiteral("javascript:alert(1)")),
      QUrl(QStringLiteral("https://user:password@bookmark.example/path#private")),
      QUrl(QStringLiteral("http://two.example/")), QUrl(QStringLiteral("https://three.example/")),
      QUrl(QStringLiteral("https://four.example/")), QUrl(QStringLiteral("https://five.example/")),
      QUrl(QStringLiteral("https://six.example/")), QUrl(QStringLiteral("https://seven.example/"))};

  const QJsonArray frequent = collectNewTabFrequentSites(&profile);
  const QJsonArray bookmarks = collectNewTabBookmarks(&profile);
  assert(frequent.size() == 6);
  assert(bookmarks.size() == 6);
  assert(frequent.first().toObject().value(QStringLiteral("name")).toString() == QStringLiteral("Example"));
  const QString frequentUrl = frequent.first().toObject().value(QStringLiteral("url")).toString();
  assert(!frequentUrl.contains(QStringLiteral("user")));
  assert(!frequentUrl.contains(QStringLiteral("password")));
  assert(!frequentUrl.contains(QStringLiteral("token")));
  const QUrl faviconUrl(frequent.first().toObject().value(QStringLiteral("icon")).toString());
  const QUrl faviconPage(QUrlQuery(faviconUrl).queryItemValue(QStringLiteral("page"), QUrl::FullyDecoded));
  assert(faviconPage.scheme() == QStringLiteral("https"));
  assert(faviconPage.host() == QStringLiteral("example.com"));
  assert(faviconPage.userName().isEmpty() && faviconPage.password().isEmpty());
  assert(!faviconPage.toString().contains(QStringLiteral("token")));
  const QString bookmarkUrl = bookmarks.first().toObject().value(QStringLiteral("url")).toString();
  assert(!bookmarkUrl.contains(QStringLiteral("user")));
  assert(!bookmarkUrl.contains(QStringLiteral("password")));
  assert(!bookmarkUrl.contains(QLatin1Char('#')));

  const QString maliciousTitle = QStringLiteral("attack</script><script>alert(1)</script>");
  const QJsonArray malicious{QJsonObject{{QStringLiteral("url"), QStringLiteral("https://safe.example/")},
                                         {QStringLiteral("name"), maliciousTitle},
                                         {QStringLiteral("title"), maliciousTitle}}};
  const QString html = newTabHtml(QStringLiteral("Google"), malicious, bookmarks, 37, 4);
  assert(html.contains(QStringLiteral("search-history")));
  assert(html.contains(QStringLiteral("suggestionCommand('activate'")));
  assert(html.contains(QStringLiteral("suggestion-remove")));
  assert(html.contains(QStringLiteral("suggestionCommandUrl('delete-history'")));
  assert(html.contains(QStringLiteral("attack<\\/script><script>alert(1)<\\/script>")));
  assert(!html.contains(maliciousTitle));
  assert(html.contains(QStringLiteral("window.ardaliTopSiteSources")));
  assert(html.contains(QStringLiteral("id=\"protection-card-value\">37")));
  assert(html.contains(QStringLiteral("Engellenen öğeler")));
  assert(html.contains(QStringLiteral("id=\"downloads-card-value\">4")));
  assert(html.contains(QStringLiteral("İstatistik kartlarını göster")));
  assert(html.contains(QStringLiteral("const button=document.createElement('a')")));
  assert(html.contains(QStringLiteral("button.href=suggestionCommandUrl('activate'")));
  assert(html.contains(QStringLiteral("button.onpointerdown=event=>")));
  assert(html.contains(QStringLiteral("remove.onpointerdown=event=>")));
  assert(html.contains(QStringLiteral("query.addEventListener('input',scheduleSuggestions)")));
  assert(html.contains(QStringLiteral("suggestionRequestTimer=setTimeout(requestSuggestions,80)")));
  assert(html.contains(QStringLiteral("if(document.activeElement!==query&&!suggestionList.matches(':hover'))closeSuggestions()")));
  assert(html.contains(QStringLiteral("query.setSelectionRange(suggestionTypedValue.length,completion.length)")));

  const QString updateScript = newTabTopSitesUpdateScript(frequent, bookmarks);
  assert(updateScript.contains(QStringLiteral("window.renderFrequentSites")));
  assert(updateScript.contains(QStringLiteral("https://example.com/")));
  assert(newTabProtectionStatsUpdateScript(91, 6).contains(QStringLiteral("ardaliSetProtectionStats(91,6)")));
}

}  // namespace

static void testPlaceholdersAndCachedFavicon() {
  const QString generatedNewTab = newTabHtml(
      QStringLiteral("DuckDuckGo"), {}, {}, 0, 0, 0, true, true,
      QStringLiteral("all_time"), QStringLiteral("asset-capability"));
  assert(generatedNewTab.contains(QStringLiteral("ardali://newtab-background?op=")));
  assert(generatedNewTab.contains(QStringLiteral("const managedBackgroundCapability=\"asset-capability\"")));
  assert(generatedNewTab.contains(QStringLiteral("managed-background-thumbnail'+managedQuery")));
  assert(!generatedNewTab.contains(QStringLiteral("window.ardaliNewTabCommand=")));
  assert(ardali::core::searchEngineIconAsset(QStringLiteral("Google")) == QStringLiteral("google.ico"));
  assert(ardali::core::searchEngineIconAsset(QStringLiteral("DuckDuckGo")) == QStringLiteral("duckduckgo.ico"));
  assert(ardali::core::searchEngineIconAsset(QStringLiteral("Brave Search")) == QStringLiteral("brave.ico"));
  assert(ardali::core::searchEngineIconAsset(QStringLiteral("Bing")) == QStringLiteral("bing.ico"));
  assert(ardali::core::searchEngineResourcePath(QStringLiteral("Google")) == QStringLiteral(":/search-engines/google.ico"));
  assert(searchEnginePlaceholder(QStringLiteral("Google")) == QStringLiteral("Google'da arayın veya URL'yi yazın"));
  assert(searchEnginePlaceholder(QStringLiteral("DuckDuckGo")) == QStringLiteral("DuckDuckGo'da arayın veya URL'yi yazın"));
  assert(searchEnginePlaceholder(QStringLiteral("Brave Search")) == QStringLiteral("Brave Search'te arayın veya URL'yi yazın"));
  assert(searchEnginePlaceholder(QStringLiteral("Bing")) == QStringLiteral("Bing'de arayın veya URL'yi yazın"));
  QTemporaryDir dir;
  BrowserProfileService service(dir.path(), nullptr);
  assert(service.searchEngine() == QStringLiteral("DuckDuckGo"));
  service.setSearchEngine(QStringLiteral("DuckDuckGo"));
  QImage image(32, 32, QImage::Format_ARGB32);
  image.fill(Qt::green);
  const QString managedBackgroundFixture = dir.path() + QStringLiteral("/managed-background.png");
  assert(image.save(managedBackgroundFixture, "PNG"));
  assert(service.newTabBackgroundStore()->importImage(managedBackgroundFixture).ok());
  QByteArray png;
  QBuffer buffer(&png);
  buffer.open(QIODevice::WriteOnly);
  assert(image.save(&buffer, "PNG"));
  QTcpServer server;
  assert(server.listen(QHostAddress::LocalHost));
  int requests = 0;
  QObject::connect(&server, &QTcpServer::newConnection, &server, [&] {
    while (auto *socket = server.nextPendingConnection()) {
      QObject::connect(socket, &QTcpSocket::readyRead, socket, [&, socket] {
        const QByteArray request = socket->readAll();
        if (request.isEmpty()) return;
        ++requests;
        const bool icon = request.startsWith("GET /favicon.png ");
        const QByteArray body = icon ? png : QByteArray("<html><head><link rel='icon' href='/favicon.png'></head><body>Local fixture</body></html>");
        socket->write("HTTP/1.1 200 OK\r\nContent-Type: " + QByteArray(icon ? "image/png" : "text/html")
            + "\r\nContent-Length: " + QByteArray::number(body.size()) + "\r\nConnection: close\r\n\r\n" + body);
        socket->disconnectFromHost();
      });
      QObject::connect(socket, &QTcpSocket::disconnected, socket, &QObject::deleteLater);
    }
  });
  EvidencePage page(service.profile());
  const QUrl url(QStringLiteral("http://127.0.0.1:%1/").arg(server.serverPort()));
  QEventLoop iconLoop;
  QObject::connect(&page, &QWebEnginePage::iconChanged, &iconLoop, &QEventLoop::quit);
  QTimer::singleShot(10000, &iconLoop, &QEventLoop::quit);
  page.load(url);
  iconLoop.exec();
  assert(!page.icon().isNull());
  QEventLoop cacheLoop;
  bool cacheHit = false;
  service.profile()->requestIconForPageURL(url, 64, [&](const QIcon &cached, const QUrl &, const QUrl &cachedPage) {
    cacheHit = !cached.isNull() && cachedPage == url;
    cacheLoop.quit();
  });
  QTimer::singleShot(5000, &cacheLoop, &QEventLoop::quit);
  cacheLoop.exec();
  assert(cacheHit);
  service.recordHistory(url, QStringLiteral("Fixture"));
  service.recordHistory(url, QStringLiteral("Fixture"));
  service.recordHistory(QUrl(QStringLiteral("https://uncached.invalid/")), QStringLiteral("Uncached"));
  const int before = requests;
  QEventLoop loadLoop;
  QObject::connect(&page, &QWebEnginePage::loadFinished, &loadLoop, &QEventLoop::quit);
  QTimer::singleShot(10000, &loadLoop, &QEventLoop::quit);
  // A stale URL parameter must not override the profile's authoritative engine.
  page.load(QUrl(QStringLiteral("ardali://newtab/?engine=Google")));
  loadLoop.exec();
  QEventLoop evalLoop;
  bool passed = false;
  page.runJavaScript(QStringLiteral("JSON.stringify({placeholder:document.querySelector('#query')?.placeholder,fallback:Array.from(document.querySelectorAll('.shortcut-icon')).some(x=>x.textContent==='U'&&!x.querySelector('img')),width:document.querySelector('.shortcut-icon img')?.naturalWidth,strip:document.querySelector('#shortcuts')?.classList.contains('top-sites-strip'),siteCards:document.querySelectorAll('#shortcut-list .shortcut').length,oldPanel:!!document.querySelector('#top-sites-title, #frequent-settings, .module'),gear:document.querySelector('#customize img')?.getAttribute('src'),backgroundHidden:document.body.classList.contains('background-hidden'),backgroundToggle:document.querySelector('#background-toggle')?.checked,colorBackgrounds:document.querySelectorAll('.color-background-card').length,uploadIcon:!!document.querySelector('#background-upload .upload-icon path'),clockToggle:document.querySelector('#clock-toggle')?.checked,clockCentered:document.querySelector('#clock-widget')?.classList.contains('position-center'),clockStyles:document.querySelectorAll('[data-clock-style]').length,clockPositions:document.querySelectorAll('[data-clock-position]').length})"),
      [&](const QVariant &value) {
        std::cerr << "New Tab evidence: " << value.toString().toStdString() << std::endl;
        const auto result = QJsonDocument::fromJson(value.toString().toUtf8()).object();
        passed = result.value(QStringLiteral("placeholder")).toString() == searchEnginePlaceholder(QStringLiteral("DuckDuckGo"))
            && result.value(QStringLiteral("fallback")).toBool()
            && result.value(QStringLiteral("width")).toInt() > 0
            && result.value(QStringLiteral("strip")).toBool()
            && result.value(QStringLiteral("siteCards")).toInt() > 0
            && !result.value(QStringLiteral("oldPanel")).toBool()
            && result.value(QStringLiteral("gear")).toString() == QStringLiteral("icons/settings.svg")
            && result.value(QStringLiteral("backgroundHidden")).toBool()
            && !result.value(QStringLiteral("backgroundToggle")).toBool()
            && result.value(QStringLiteral("colorBackgrounds")).toInt() == 8
            && result.value(QStringLiteral("uploadIcon")).toBool()
            && result.value(QStringLiteral("clockToggle")).toBool()
            && result.value(QStringLiteral("clockCentered")).toBool()
            && result.value(QStringLiteral("clockStyles")).toInt() == 4
            && result.value(QStringLiteral("clockPositions")).toInt() == 6;
        evalLoop.quit();
      });
  QTimer::singleShot(5000, &evalLoop, &QEventLoop::quit);
  evalLoop.exec();
  assert(passed);
  assert(requests == before); // New Tab reads only the existing favicon database.

  QEventLoop runtimeLoop;
  bool runtimePassed = false;
  page.runJavaScript(QStringLiteral(R"JS((()=>{
    const input=document.querySelector('#query');
    const clockWidget=document.querySelector('#clock-widget');
    const colorfulBackground=document.querySelector('[data-background="gradient-violet"]');
    colorfulBackground.click();
    if(!clockWidget.classList.contains('position-top-left'))return false;
    document.querySelector('[data-clock-style="digital"]').click();
    document.querySelector('[data-clock-position="bottom-right"]').click();
    document.querySelector('#clock-toggle').click();
    if(!clockWidget.hidden)return false;
    document.querySelector('#clock-toggle').click();
    document.querySelector('#cards-toggle').click();
    const saved=JSON.parse(localStorage.getItem('ardali.newtab')||'{}');
    if(!saved.backgroundVisible||!saved.backgroundPreferenceSet||saved.backgroundSource!=='gradient-violet'||document.body.classList.contains('background-hidden')||saved.clockStyle!=='digital'||saved.clockPosition!=='bottom-right'||!saved.clock||saved.cards!==false||!document.querySelector('#cards').hidden||!clockWidget.classList.contains('style-digital')||!clockWidget.classList.contains('position-bottom-right'))return false;
    window.ardaliBackgroundResult(true,'',true,123,true);
    if(JSON.parse(localStorage.getItem('ardali.newtab')).backgroundSource!=='custom'||!document.documentElement.style.getPropertyValue('--new-tab-background').includes('managed-background?v=123')||document.querySelector('#custom-background-card').hidden||document.querySelector('#background-remove').hidden)return false;
    document.querySelector('#background-toggle').click();
    if(JSON.parse(localStorage.getItem('ardali.newtab')).backgroundSource!=='custom'||!document.body.classList.contains('background-hidden'))return false;
    document.querySelector('[data-background="builtin"]').click();
    document.querySelector('[data-background="custom"]').click();
    if(JSON.parse(localStorage.getItem('ardali.newtab')).backgroundSource!=='custom'||document.body.classList.contains('background-hidden'))return false;
    window.ardaliSetSearchEngine('Google');
    if(input.placeholder!=="Google'da arayın veya URL'yi yazın" || !input.matches(':placeholder-shown'))return false;
    input.value='keep this text';
    window.ardaliSetSearchEngine('DuckDuckGo');
    if(input.value!=='keep this text' || input.matches(':placeholder-shown'))return false;
    input.value='';
    return input.matches(':placeholder-shown') && input.placeholder==="DuckDuckGo'da arayın veya URL'yi yazın";
  })())JS"), [&](const QVariant &value) { runtimePassed = value.toBool(); runtimeLoop.quit(); });
  QTimer::singleShot(5000, &runtimeLoop, &QEventLoop::quit);
  runtimeLoop.exec();
  assert(runtimePassed);

  QEventLoop backgroundImageLoop;
  QTimer backgroundPoll;
  backgroundPoll.setInterval(50);
  bool backgroundImageLoaded = false;
  QObject::connect(&backgroundPoll, &QTimer::timeout, &page, [&] {
    page.runJavaScript(QStringLiteral("document.querySelector('#custom-background-thumbnail')?.naturalWidth>0"),
        [&](const QVariant &value) {
          if (!value.toBool()) return;
          backgroundImageLoaded = true;
          backgroundImageLoop.quit();
        });
  });
  QTimer::singleShot(5000, &backgroundImageLoop, &QEventLoop::quit);
  backgroundPoll.start();
  backgroundImageLoop.exec();
  backgroundPoll.stop();
  assert(backgroundImageLoaded);

  QEventLoop focusLoop;
  bool focusPassed = false;
  page.runJavaScript(QStringLiteral(R"JS((()=>{
    const fail=step=>{console.log('focus-mode-failure:'+step);return false};
    const pageRoot=document.querySelector('#page');
    const input=document.querySelector('#query');
    const strip=document.querySelector('#shortcuts');
    const current=document.querySelector('#engine-current');
    const gear=document.querySelector('#customize');
    gear.click();
    if(document.querySelector('#customization-overlay').hidden)return fail('gear-open');
    document.querySelector('#customization-close').click();
    if(!document.querySelector('#customization-overlay').hidden)return fail('gear-close');
    input.value='';
    input.focus();
    input.dispatchEvent(new FocusEvent('focus'));
    if(!pageRoot.classList.contains('search-focused'))return fail('focus-state');
    if(!strip.matches('.top-sites-strip'))return fail('strip-class');
    input.blur();
    updateSearchMode();
    if(pageRoot.classList.contains('search-focused'))return fail('blur-exit');
    input.dispatchEvent(new FocusEvent('focus'));
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    if(pageRoot.classList.contains('search-focused'))return fail('escape-exit');
    input.dispatchEvent(new FocusEvent('focus'));
    const searchWidth=document.querySelector('#search').getBoundingClientRect().width;
    current.click();
    if(document.querySelector('#engine-menu').hidden||!pageRoot.classList.contains('search-focused'))return fail('picker-state');
    if(document.querySelector('#search').getBoundingClientRect().width!==searchWidth)return fail('picker-layout');
    document.querySelector('.engine-option[data-engine="Bing"]').click();
    return (pageRoot.classList.contains('search-focused')
      && document.querySelector('#engine-current-icon').getAttribute('src')==='bing.ico'
      && input.placeholder==="Bing'de arayın veya URL'yi yazın")||fail('picker-update');
  })())JS"), [&](const QVariant &value) { focusPassed = value.toBool(); focusLoop.quit(); });
  QTimer::singleShot(5000, &focusLoop, &QEventLoop::quit);
  focusLoop.exec();
  assert(focusPassed);

  const QUrl iconUrl(collectNewTabFrequentSites(&service).first().toObject().value(QStringLiteral("icon")).toString());
  for (bool unsafePage : {false, true}) {
    QUrl deniedUrl(iconUrl);
    QUrlQuery query(deniedUrl);
    if (unsafePage) {
      query.removeAllQueryItems(QStringLiteral("page"));
      query.addQueryItem(QStringLiteral("page"), QStringLiteral("file:///tmp/nope"));
    } else {
      query.removeAllQueryItems(QStringLiteral("cap"));
    }
    deniedUrl.setQuery(query);
    EvidencePage denied(service.profile());
    QEventLoop deniedLoop;
    bool rejected = false;
    QObject::connect(&denied, &QWebEnginePage::loadFinished, &deniedLoop, [&](bool ok) {
      rejected = !ok;
      deniedLoop.quit();
    });
    QTimer::singleShot(5000, &deniedLoop, &QEventLoop::quit);
    denied.load(deniedUrl);
    deniedLoop.exec();
    assert(rejected);
  }
}

void testPrivacyAndContentSettingsPolicies() {
  QTemporaryDir directory;
  assert(directory.isValid());

  BrowserProfileService service(directory.path(), nullptr);

  // 1. Permission Defaults
  assert(service.permissionDefaultPolicy(QStringLiteral("geolocation")) == QStringLiteral("prompt"));
  assert(service.permissionDefaultPolicy(QStringLiteral("camera")) == QStringLiteral("prompt"));
  assert(service.permissionDefaultPolicy(QStringLiteral("microphone")) == QStringLiteral("prompt"));
  assert(service.permissionDefaultPolicy(QStringLiteral("notifications")) == QStringLiteral("quiet"));

  service.setPermissionDefaultPolicy(QStringLiteral("geolocation"), QStringLiteral("deny"));
  assert(service.permissionDefaultPolicy(QStringLiteral("geolocation")) == QStringLiteral("deny"));

  service.setPermissionDefaultPolicy(QStringLiteral("camera"), QStringLiteral("deny"));
  assert(service.permissionDefaultPolicy(QStringLiteral("camera")) == QStringLiteral("deny"));

  service.setPermissionDefaultPolicy(QStringLiteral("notifications"), QStringLiteral("deny"));
  assert(service.permissionDefaultPolicy(QStringLiteral("notifications")) == QStringLiteral("deny"));

  // 2. Auto-revoke unused permissions
  assert(service.autoRevokeUnusedPermissions() == true);
  service.setAutoRevokeUnusedPermissions(false);
  assert(service.autoRevokeUnusedPermissions() == false);
  service.setAutoRevokeUnusedPermissions(true);
  assert(service.autoRevokeUnusedPermissions() == true);

  // 3. Content Settings: Cookies
  assert(service.cookiePolicy() == QStringLiteral("third_party"));
  service.setCookiePolicy(QStringLiteral("block_all"));
  assert(service.cookiePolicy() == QStringLiteral("block_all"));
  assert(service.profile()->persistentCookiesPolicy() == QWebEngineProfile::NoPersistentCookies);
  service.setCookiePolicy(QStringLiteral("allow_all"));
  assert(service.cookiePolicy() == QStringLiteral("allow_all"));
  assert(service.profile()->persistentCookiesPolicy() == QWebEngineProfile::ForcePersistentCookies);

  // 4. Content Settings: JavaScript
  assert(service.isJavascriptEnabled() == true);
  assert(service.profile()->settings()->testAttribute(QWebEngineSettings::JavascriptEnabled) == true);
  service.setJavascriptEnabled(false);
  assert(service.isJavascriptEnabled() == false);
  assert(service.profile()->settings()->testAttribute(QWebEngineSettings::JavascriptEnabled) == false);

  // 5. Content Settings: Images
  assert(service.isAutoLoadImagesEnabled() == true);
  assert(service.profile()->settings()->testAttribute(QWebEngineSettings::AutoLoadImages) == true);
  service.setAutoLoadImagesEnabled(false);
  assert(service.isAutoLoadImagesEnabled() == false);
  assert(service.profile()->settings()->testAttribute(QWebEngineSettings::AutoLoadImages) == false);

  // 6. Content Settings: Pop-ups
  assert(service.arePopupsAllowed() == false);
  assert(service.profile()->settings()->testAttribute(QWebEngineSettings::JavascriptCanOpenWindows) == false);
  service.setPopupsAllowed(true);
  assert(service.arePopupsAllowed() == true);
  assert(service.profile()->settings()->testAttribute(QWebEngineSettings::JavascriptCanOpenWindows) == true);

  // 7. Content Settings: Sound & PDF
  assert(service.isSoundAllowed() == true);
  service.setSoundAllowed(false);
  assert(service.isSoundAllowed() == false);

  assert(service.openPdfInBrowser() == true);
  assert(service.profile()->settings()->testAttribute(QWebEngineSettings::PdfViewerEnabled) == true);
  service.setOpenPdfInBrowser(false);
  assert(service.openPdfInBrowser() == false);
  assert(service.profile()->settings()->testAttribute(QWebEngineSettings::PdfViewerEnabled) == false);

  // 8. Persistence across profile reload
  {
    BrowserProfileService reloaded(directory.path(), nullptr);
    assert(reloaded.permissionDefaultPolicy(QStringLiteral("geolocation")) == QStringLiteral("deny"));
    assert(reloaded.permissionDefaultPolicy(QStringLiteral("camera")) == QStringLiteral("deny"));
    assert(reloaded.permissionDefaultPolicy(QStringLiteral("notifications")) == QStringLiteral("deny"));
    assert(reloaded.cookiePolicy() == QStringLiteral("allow_all"));
    assert(reloaded.isJavascriptEnabled() == false);
    assert(reloaded.isAutoLoadImagesEnabled() == false);
    assert(reloaded.arePopupsAllowed() == true);
    assert(reloaded.isSoundAllowed() == false);
    assert(reloaded.openPdfInBrowser() == false);
    assert(reloaded.autoRevokeUnusedPermissions() == true);
  }
}

static void testPhase2_2C_NewTabCardHidingOnSearchFocus() {
  const QString html = newTabHtml(QStringLiteral("Google"));
  assert(html.contains(QStringLiteral(".cards{position:relative;")));
  assert(html.contains(QStringLiteral("transition:opacity .2s ease,transform .2s ease,visibility 0s linear 0s")));
  assert(html.contains(QStringLiteral(".page.search-focused .cards{opacity:0;transform:translateY(-10px);visibility:hidden;pointer-events:none;")));
  assert(html.contains(QStringLiteral("transition:opacity .18s ease,transform .2s ease,visibility 0s linear .2s")));
  assert(html.contains(QStringLiteral("id=\"cards\"")));
  assert(html.contains(QStringLiteral("id=\"downloads-card-value\"")));
  assert(html.contains(QStringLiteral("id=\"protection-card-value\"")));
  assert(html.contains(QStringLiteral("İndirmeler")));
  assert(html.contains(QStringLiteral("Engellenen öğeler")));
  assert(!html.contains(QStringLiteral("İzleme parametresi koruması")));
  assert(html.contains(QStringLiteral("query.addEventListener('focus'")));
  assert(html.contains(QStringLiteral("classList.add('search-focused')")));
  assert(html.contains(QStringLiteral("query.addEventListener('blur'")));
}

static void testPhase2_2C_SitePolicyPersistenceAndExtendedFields() {
  QTemporaryDir dir;
  const QString iniPath = dir.path() + QStringLiteral("/test-adblock.ini");
  {
    ArDaliBlockerSettings settings(iniPath);
    SitePolicy p;
    p.adBlocking = true;
    p.trackerProtection = false;
    p.whitelisted = false;
    p.perSiteMode = 2; // Aggressive
    p.blockScripts = true;
    p.blockFingerprinting = true;
    p.upgradeHttps = true;
    p.forgetOnClose = true;
    p.cookiePolicy = QStringLiteral("block_all");
    settings.setSitePolicy(QStringLiteral("youtube.com"), p);
  }
  {
    ArDaliBlockerSettings reloaded(iniPath);
    const auto loaded = reloaded.sitePolicy(QStringLiteral("youtube.com"));
    assert(loaded.adBlocking == true);
    assert(loaded.trackerProtection == false);
    assert(loaded.whitelisted == false);
    assert(loaded.perSiteMode == 2);
    assert(loaded.blockScripts == true);
    assert(loaded.blockFingerprinting == true);
    assert(loaded.upgradeHttps == true);
    assert(loaded.forgetOnClose == true);
    assert(loaded.cookiePolicy == QStringLiteral("block_all"));
  }
}

static void testPhase2_2D_YouTubeCentralCosmeticLifecycle() {
  QTemporaryDir dir;
  ArDaliBlockerService service(dir.path());
  
  const QString css = service.cosmeticCssForHost(QStringLiteral("www.youtube.com"));
  assert(!css.isEmpty());
  assert(css.contains(QStringLiteral("#masthead-ad")));
  assert(css.contains(QStringLiteral("ytd-in-feed-ad-layout-renderer")));
  assert(css.contains(QStringLiteral("ytd-rich-item-renderer:has(ytd-in-feed-ad-layout-renderer)")));
  assert(css.contains(QStringLiteral("ytd-rich-item-renderer:has(ytd-ad-slot-renderer)")));
  assert(!css.contains(QStringLiteral("{\"")));
  assert(!css.contains(QStringLiteral("ytd-rich-item-renderer { display: none")));

  const auto ytScripts = service.createScriptingScriptsForHost(QStringLiteral("www.youtube.com"));
  bool hasRuntime = false;
  for (const auto &s : ytScripts) {
    if (s.name() == QStringLiteral("ardali-adblock-cosmetic")) {
      hasRuntime = true;
      assert(s.worldId() == QWebEngineScript::ApplicationWorld);
      assert(s.injectionPoint() == QWebEngineScript::DocumentCreation);
      const QString code = s.sourceCode();
      assert(code.contains(QStringLiteral("__ardaliCosmeticRuntime")));
      assert(code.contains(QStringLiteral("yt-navigate-finish")));
      assert(code.contains(QStringLiteral("yt-page-data-updated")));
      assert(code.contains(QStringLiteral("MutationObserver")));
      assert(code.contains(QStringLiteral("180")));
    }
  }
  assert(hasRuntime);

  const auto exampleScripts = service.createScriptingScriptsForHost(QStringLiteral("example.com"));
  for (const auto &s : exampleScripts) {
    assert(s.name() != QStringLiteral("ardali-adblock-youtube-guardian"));
  }
}

static void testPhase2_2C_EvaluateRequestPolicyEnforcement() {
  QTemporaryDir dir;
  ArDaliBlockerService service(dir.path());

  {
    SitePolicy p;
    p.blockScripts = true;
    p.whitelisted = false;
    service.settings()->setSitePolicy(QStringLiteral("script-test.com"), p);
    
    auto dec = service.evaluateRequest(QUrl(QStringLiteral("https://script-test.com/app.js")),
                                       static_cast<int>(ArDaliBlockerResourceType::Script),
                                       QUrl(QStringLiteral("https://script-test.com/")), 10);
    assert(dec.action == ArDaliBlockerAction::Block);

    p.whitelisted = true;
    service.settings()->setSitePolicy(QStringLiteral("script-test.com"), p);
    auto decAllowed = service.evaluateRequest(QUrl(QStringLiteral("https://script-test.com/app.js")),
                                             static_cast<int>(ArDaliBlockerResourceType::Script),
                                             QUrl(QStringLiteral("https://script-test.com/")), 10);
    assert(decAllowed.action == ArDaliBlockerAction::Allow);
  }

  {
    SitePolicy up;
    up.upgradeHttps = true;
    up.whitelisted = false;
    service.settings()->setSitePolicy(QStringLiteral("upgrade-test.com"), up);

    auto decUp = service.evaluateRequest(QUrl(QStringLiteral("http://upgrade-test.com/page.html")),
                                         static_cast<int>(ArDaliBlockerResourceType::MainFrame),
                                         QUrl(QStringLiteral("http://upgrade-test.com/")), 20);
    assert(decUp.action == ArDaliBlockerAction::Redirect);
    assert(decUp.redirectUrl == QStringLiteral("https://upgrade-test.com/page.html"));

    auto decLocal = service.evaluateRequest(QUrl(QStringLiteral("http://127.0.0.1:8080/test")),
                                           static_cast<int>(ArDaliBlockerResourceType::MainFrame),
                                           QUrl(QStringLiteral("http://127.0.0.1:8080/")), 30);
    assert(decLocal.action != ArDaliBlockerAction::Redirect);
  }
}

int main(int argc, char *argv[]) {
  qputenv("QT_QPA_PLATFORM", "offscreen");
  qputenv("QTWEBENGINE_CHROMIUM_FLAGS", "--no-sandbox --disable-gpu");
  registerArdaliUrlSchemes();
  QApplication app(argc, argv);

  std::cerr << "Running testHistoryTitleAndTypedEvidence" << std::endl;
  testHistoryTitleAndTypedEvidence();
  std::cerr << "Running testBackwardCompatibleTypedCount" << std::endl;
  testBackwardCompatibleTypedCount();
  std::cerr << "Running testSearchHistoryPersistenceAndClearing" << std::endl;
  testSearchHistoryPersistenceAndClearing();
  std::cerr << "Running testAntiPoisoningConfidence" << std::endl;
  testAntiPoisoningConfidence();
  std::cerr << "Running testNewTabDataAndScriptSafety" << std::endl;
  testNewTabDataAndScriptSafety();
  std::cerr << "Running testPlaceholdersAndCachedFavicon" << std::endl;
  testPlaceholdersAndCachedFavicon();
  std::cerr << "Running testPrivacyAndContentSettingsPolicies" << std::endl;
  testPrivacyAndContentSettingsPolicies();
  std::cerr << "Running testPhase2_2C_NewTabCardHidingOnSearchFocus" << std::endl;
  testPhase2_2C_NewTabCardHidingOnSearchFocus();
  std::cerr << "Running testPhase2_2C_SitePolicyPersistenceAndExtendedFields" << std::endl;
  testPhase2_2C_SitePolicyPersistenceAndExtendedFields();
  std::cerr << "Running testPhase2_2D_YouTubeCentralCosmeticLifecycle" << std::endl;
  testPhase2_2D_YouTubeCentralCosmeticLifecycle();
  std::cerr << "Running testPhase2_2C_EvaluateRequestPolicyEnforcement" << std::endl;
  testPhase2_2C_EvaluateRequestPolicyEnforcement();

  std::cout << "Smart Omnibox Phase 2.1 and Phase 2.2C tests passed" << std::endl;
  return 0;
}
