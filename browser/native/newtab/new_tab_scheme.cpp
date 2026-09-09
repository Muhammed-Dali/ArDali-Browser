#include <QCache>
#include "new_tab_scheme.h"

#include <QBuffer>
#include <QFile>
#include <QFileInfo>
#include <QStringList>
#include <QUrlQuery>
#include <QWebEngineUrlRequestJob>
#include <QWebEngineUrlScheme>
#include <QWebEngineUrlSchemeHandler>
#include <QJsonArray>
#include <QJsonObject>
#include <QIcon>
#include <QPointer>
#include <QWebEngineProfile>
#include <QHash>
#include <QUuid>

#include <algorithm>

#include "core/browser_profile_data_provider.h"
#include "core/security_utils.h"
#include "new_tab_html.h"

namespace {
// LocalScheme documents can have an opaque ("null") initiator. A per-handler
// capability authenticates their image requests without trusting opaque origins.
QHash<const ardali::core::IBrowserProfileDataProvider *, QString> faviconCapabilities;
}

QString newTabFaviconUrl(const ardali::core::IBrowserProfileDataProvider *profileData, const QUrl &page) {
  const QUrl safe = BrowserSecurity::sanitizeUrlForPersistence(page);
  if (!safe.isValid() || safe.host().isEmpty() ||
      (safe.scheme() != QLatin1String("http") && safe.scheme() != QLatin1String("https")) ||
      !faviconCapabilities.contains(profileData)) return {};
  QUrl icon(QStringLiteral("ardali://newtab/favicon"));
  QUrlQuery query;
  query.addQueryItem(QStringLiteral("page"), safe.toString(QUrl::FullyEncoded));
  query.addQueryItem(QStringLiteral("cap"), faviconCapabilities.value(profileData));
  icon.setQuery(query);
  return icon.toString(QUrl::FullyEncoded);
}

QJsonArray collectNewTabFrequentSites(const ardali::core::IBrowserProfileDataProvider *profileData,
                                      int limit) {
  QJsonArray result;
  const int cappedLimit = std::clamp(limit, 0, 6);
  if (!profileData || cappedLimit == 0) return result;

  for (const BrowserFrequentSite &site : profileData->frequentSites(100)) {
    const QUrl url = BrowserSecurity::sanitizeUrlForPersistence(site.url).adjusted(QUrl::RemoveFragment);
    const QString scheme = url.scheme().toLower();
    if (!url.isValid() || url.host().isEmpty()
        || (scheme != QLatin1String("http") && scheme != QLatin1String("https"))) {
      continue;
    }

    QString title = site.title.trimmed().left(180);
    if (title.isEmpty() || title == QLatin1String("Yeni Sekme")) title = url.host();
    QUrl lookup = BrowserSecurity::sanitizeUrlForPersistence(site.iconLookupUrl);
    if (!lookup.isValid() || lookup.host() != url.host()
        || (lookup.scheme() != QLatin1String("http") && lookup.scheme() != QLatin1String("https"))) lookup = url;
    QUrl icon(QStringLiteral("ardali://newtab/favicon"));
    QUrlQuery iconQuery;
    iconQuery.addQueryItem(QStringLiteral("page"), lookup.toString(QUrl::FullyEncoded));
    iconQuery.addQueryItem(QStringLiteral("cap"), faviconCapabilities.value(profileData));
    icon.setQuery(iconQuery);
    result.append(QJsonObject{
        {QStringLiteral("icon"), icon.toString(QUrl::FullyEncoded)},
        {QStringLiteral("url"), url.toString(QUrl::FullyEncoded)},
        {QStringLiteral("name"), title},
        {QStringLiteral("title"), title},
        {QStringLiteral("visitCount"), std::max(1, site.visitCount)}});
    if (result.size() >= cappedLimit) break;
  }
  return result;
}

QJsonArray collectNewTabBookmarks(const ardali::core::IBrowserProfileDataProvider *profileData,
                                  int limit) {
  QJsonArray result;
  const int cappedLimit = std::clamp(limit, 0, 6);
  if (!profileData || cappedLimit == 0) return result;

  for (const QUrl &bookmark : profileData->bookmarks()) {
    const QUrl url = BrowserSecurity::sanitizeUrlForPersistence(bookmark).adjusted(QUrl::RemoveFragment);
    const QString scheme = url.scheme().toLower();
    if (!url.isValid() || url.host().isEmpty()
        || (scheme != QLatin1String("http") && scheme != QLatin1String("https"))) {
      continue;
    }

    result.append(QJsonObject{
        {QStringLiteral("url"), url.toString(QUrl::FullyEncoded)},
        {QStringLiteral("name"), url.host()},
        {QStringLiteral("title"), url.host()}});
    if (result.size() >= cappedLimit) break;
  }
  return result;
}

namespace {

class NewTabSchemeHandler final : public QWebEngineUrlSchemeHandler {
 public:
  NewTabSchemeHandler(const QString &assetsDirectory, const QString &managedBackgroundPath,
                      const QString &managedThumbnailPath,
                      ardali::core::IBrowserProfileDataProvider *profileData, QObject *parent,
                      QWebEngineProfile *webProfile)
      : QWebEngineUrlSchemeHandler(parent), assetsDirectory_(assetsDirectory),
        managedBackgroundPath_(managedBackgroundPath), managedThumbnailPath_(managedThumbnailPath),
        profileData_(profileData), webProfile_(webProfile),
        faviconCapability_(QUuid::createUuid().toString(QUuid::WithoutBraces)) {
    if (profileData_) faviconCapabilities.insert(profileData_, faviconCapability_);
  }

  ~NewTabSchemeHandler() override {
    if (faviconCapabilities.value(profileData_) == faviconCapability_)
      faviconCapabilities.remove(profileData_);
  }

  void requestStarted(QWebEngineUrlRequestJob *job) override {
    const QUrl url = job->requestUrl();
    if (url.host() == QLatin1String("bypass-strictblock")) {
      if (!isAuthorizedStrictBlockBypass(url, job->initiator())) {
        job->fail(QWebEngineUrlRequestJob::RequestDenied);
        return;
      }
      const QUrlQuery query(url);
      const QString domain = query.queryItemValue(QStringLiteral("domain"), QUrl::FullyDecoded);
      const QUrl target = validatedStrictBlockTarget(domain, query.queryItemValue(QStringLiteral("target"), QUrl::FullyDecoded));
      const QString redirectHtml = QStringLiteral(
          "<!doctype html><html><head><meta http-equiv=\"refresh\" content=\"0;url=%1\"></head>"
          "<body style=\"background:#0c1017;color:#fff;font-family:sans-serif;display:grid;place-items:center;height:100vh;\">"
          "<p>Geçici izin sağlandı, yönlendiriliyor...</p></body></html>"
      ).arg(target.toString(QUrl::FullyEncoded).toHtmlEscaped());
      auto *buffer = new QBuffer(job);
      buffer->setData(redirectHtml.toUtf8());
      buffer->open(QIODevice::ReadOnly);
      job->reply("text/html; charset=utf-8", buffer);
      return;
    }
    if (url.host() == QLatin1String("navigate")) {
      job->fail(QWebEngineUrlRequestJob::RequestDenied);
      return;
    }
    if (url.host() != QLatin1String("newtab")) { job->fail(QWebEngineUrlRequestJob::UrlNotFound); return; }
    const QString requested = url.path();
    if (requested == QLatin1String("/favicon")) {
      const QUrl page = BrowserSecurity::sanitizeUrlForPersistence(
          QUrl(QUrlQuery(url).queryItemValue(QStringLiteral("page"), QUrl::FullyDecoded)));
      if (!webProfile_ || url.toString().size() > 8192 || QUrlQuery(url).queryItemValue(QStringLiteral("cap")) != faviconCapability_
          || !page.isValid()
          || page.host().isEmpty() || (page.scheme() != QLatin1String("http")
                                    && page.scheme() != QLatin1String("https"))) {
        job->fail(QWebEngineUrlRequestJob::RequestDenied);
        return;
      }
      const QString cacheKey = page.toString(QUrl::FullyEncoded);
      if (const auto *cached = faviconCache_.object(cacheKey)) {
        if (cached->isEmpty()) { job->fail(QWebEngineUrlRequestJob::UrlNotFound); return; }
        auto *buffer = new QBuffer(job); buffer->setData(*cached); buffer->open(QIODevice::ReadOnly);
        job->reply("image/png", buffer); return;
      }
      if (pendingFavicons_ >= 16) { job->fail(QWebEngineUrlRequestJob::RequestFailed); return; }
      ++pendingFavicons_;
      const QPointer<NewTabSchemeHandler> handler(this);
      const QPointer<QWebEngineUrlRequestJob> guardedJob(job);
      webProfile_->requestIconForPageURL(page, 64,
          [guardedJob,handler,cacheKey](const QIcon &icon, const QUrl &iconUrl, const QUrl &) {
        if (!handler) return;
        --handler->pendingFavicons_;
        if (!guardedJob) return;
        const QUrl safe = BrowserSecurity::sanitizeUrlForPersistence(iconUrl);
        if (icon.isNull() || !safe.isValid() || safe.host().isEmpty()
            || (safe.scheme() != QLatin1String("http") && safe.scheme() != QLatin1String("https"))) {
          handler->faviconCache_.insert(cacheKey, new QByteArray());
          guardedJob->fail(QWebEngineUrlRequestJob::UrlNotFound);
          return;
        }
        auto *buffer = new QBuffer(guardedJob);
        buffer->open(QIODevice::ReadWrite);
        if (!icon.pixmap(64, 64).save(buffer, "PNG")) {
          guardedJob->fail(QWebEngineUrlRequestJob::RequestFailed);
          return;
        }
        handler->faviconCache_.insert(cacheKey, new QByteArray(buffer->data()));
        buffer->seek(0);
        guardedJob->reply("image/png", buffer);
      });
      return;
    }
    if (requested.isEmpty() || requested == QLatin1String("/")) {
      const QUrlQuery query(url);
      if (query.hasQueryItem(QStringLiteral("strictblock"))) {
        const QString domain = query.queryItemValue(QStringLiteral("domain"), QUrl::FullyDecoded);
        const QString targetUrl = query.queryItemValue(QStringLiteral("url"), QUrl::FullyDecoded);
        if (!validatedStrictBlockTarget(domain, targetUrl).isValid()) {
          job->fail(QWebEngineUrlRequestJob::RequestDenied);
          return;
        }
        auto *buffer = new QBuffer(job);
        buffer->setData(strictBlockWarningHtml(domain, targetUrl).toUtf8());
        buffer->open(QIODevice::ReadOnly);
        job->reply("text/html; charset=utf-8", buffer);
        return;
      }
      QString engine = profileData_ ? profileData_->searchEngine() : QStringLiteral("Google");
      if (engine != QLatin1String("Google") && engine != QLatin1String("DuckDuckGo")
          && engine != QLatin1String("Brave Search") && engine != QLatin1String("Bing")) {
        engine = QStringLiteral("Google");
      }
      const QJsonArray frequentSitesArray = collectNewTabFrequentSites(profileData_);
      const QJsonArray bookmarksArray = collectNewTabBookmarks(profileData_);
      auto *buffer = new QBuffer(job);
      buffer->setData(newTabHtml(engine, frequentSitesArray, bookmarksArray).toUtf8());
      buffer->open(QIODevice::ReadOnly);
      job->reply("text/html; charset=utf-8", buffer);
      return;
    }
    // The handler is intentionally an allow-list: no path from an URL is ever
    // joined directly into the filesystem path.
    static const QStringList iconPaths{
        QStringLiteral("/icons/appearance.svg"), QStringLiteral("/icons/search.svg"),
        QStringLiteral("/icons/grid.svg"), QStringLiteral("/icons/clock.svg"),
        QStringLiteral("/icons/cards.svg"), QStringLiteral("/icons/close.svg"),
        QStringLiteral("/icons/settings.svg")};
    const bool managedImage = requested == QLatin1String("/managed-background");
    const bool managedThumbnail = requested == QLatin1String("/managed-background-thumbnail");
    if ((managedImage || managedThumbnail)
        && (job->initiator().scheme() != QLatin1String("ardali") || job->initiator().host() != QLatin1String("newtab"))) {
      job->fail(QWebEngineUrlRequestJob::RequestDenied);
      return;
    }
    const QByteArray mimeType = (requested == QLatin1String("/ardali-flow-blue.png")
                                 || requested == QLatin1String("/ardali-browser.png")) ? "image/png"
        : (requested == QLatin1String("/google.ico") || requested == QLatin1String("/duckduckgo.ico")
           || requested == QLatin1String("/brave.ico") || requested == QLatin1String("/bing.ico"))
            ? "image/x-icon" : iconPaths.contains(requested) ? "image/svg+xml"
            : managedImage ? "image/png" : managedThumbnail ? "image/jpeg" : QByteArray{};
    if (mimeType.isEmpty()) { job->fail(QWebEngineUrlRequestJob::UrlNotFound); return; }
    QFile file(managedImage ? managedBackgroundPath_ : managedThumbnail ? managedThumbnailPath_ : assetsDirectory_ + requested);
    if (!file.open(QIODevice::ReadOnly)) { job->fail(QWebEngineUrlRequestJob::UrlNotFound); return; }
    auto *buffer = new QBuffer(job);
    buffer->setData(file.readAll());
    buffer->open(QIODevice::ReadOnly);
    job->reply(mimeType, buffer);
  }

 private:
  QString assetsDirectory_;
  QString managedBackgroundPath_;
  QString managedThumbnailPath_;
  ardali::core::IBrowserProfileDataProvider *profileData_ = nullptr;
  QPointer<QWebEngineProfile> webProfile_;
  QString faviconCapability_;
  QCache<QString, QByteArray> faviconCache_{64};
  int pendingFavicons_ = 0;
};

}  // namespace

void registerArdaliUrlSchemes() {
  QWebEngineUrlScheme scheme("ardali");
  scheme.setSyntax(QWebEngineUrlScheme::Syntax::Host);
  // LocalAccessAllowed is required for relative packaged assets on this
  // scheme. Profile-wide LocalContentCanAccessFileUrls remains disabled, and
  // the handler itself serves only an explicit path allow-list.
  scheme.setFlags(QWebEngineUrlScheme::SecureScheme | QWebEngineUrlScheme::LocalScheme
      | QWebEngineUrlScheme::LocalAccessAllowed);
  QWebEngineUrlScheme::registerScheme(scheme);
}

QWebEngineUrlSchemeHandler *createNewTabSchemeHandler(const QString &assetsDirectory, const QString &managedBackgroundPath,
                                                      const QString &managedThumbnailPath,
                                                      ardali::core::IBrowserProfileDataProvider *profileData,
                                                      QObject *parent, QWebEngineProfile *webProfile) {
  return new NewTabSchemeHandler(assetsDirectory, managedBackgroundPath, managedThumbnailPath, profileData, parent, webProfile);
}
