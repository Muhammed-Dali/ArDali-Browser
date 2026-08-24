#include "browser_profile_service.h"

#include <QApplication>
#include <QDir>
#include <QFileDialog>
#include <QFileInfo>
#include <QHash>
#include <QMessageBox>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QStandardPaths>
#include <QUrlQuery>
#include <QWebEngineDownloadRequest>
#include <QWebEngineCookieStore>
#include <QWebEnginePermission>
#include <QWebEngineProfile>
#include <QWebEngineSettings>
#include <QWebEngineUrlRequestInfo>
#include <QWebEngineUrlRequestInterceptor>

#include <algorithm>

#include "browser_policy.h"
#include "new_tab_scheme.h"
#include "new_tab_background_store.h"
#include "credential_vault_manager.h"

namespace {

class TrackingParameterInterceptor final : public QWebEngineUrlRequestInterceptor {
 public:
  explicit TrackingParameterInterceptor(QObject *parent = nullptr) : QWebEngineUrlRequestInterceptor(parent) {}

  void setEnabled(bool enabled) { enabled_ = enabled; }

  void interceptRequest(QWebEngineUrlRequestInfo &info) override {
    if (!enabled_) return;
    QUrl url = info.requestUrl();
    if (!url.isValid() || (url.scheme() != QLatin1String("http") && url.scheme() != QLatin1String("https"))) return;
    QUrlQuery query(url);
    static const QStringList trackingKeys = {
        QStringLiteral("fbclid"), QStringLiteral("gclid"), QStringLiteral("dclid"),
        QStringLiteral("msclkid"), QStringLiteral("mc_cid"), QStringLiteral("mc_eid"),
        QStringLiteral("_hsenc"), QStringLiteral("_hsmi")
    };
    bool changed = false;
    for (const QString &key : trackingKeys) {
      if (query.hasQueryItem(key)) { query.removeAllQueryItems(key); changed = true; }
    }
    const auto items = query.queryItems(QUrl::FullyDecoded);
    for (const auto &[key, value] : items) {
      Q_UNUSED(value);
      if (key.startsWith(QStringLiteral("utm_"), Qt::CaseInsensitive)) {
        query.removeAllQueryItems(key);
        changed = true;
      }
    }
    if (changed) { url.setQuery(query); info.redirect(url); }
  }

 private:
  bool enabled_ = true;
};

QString permissionName(QWebEnginePermission::PermissionType type) {
  switch (type) {
    case QWebEnginePermission::PermissionType::MediaAudioCapture: return QStringLiteral("mikrofon");
    case QWebEnginePermission::PermissionType::MediaVideoCapture: return QStringLiteral("kamera");
    case QWebEnginePermission::PermissionType::MediaAudioVideoCapture: return QStringLiteral("kamera ve mikrofon");
    case QWebEnginePermission::PermissionType::DesktopVideoCapture: return QStringLiteral("ekran paylaşımı");
    case QWebEnginePermission::PermissionType::DesktopAudioVideoCapture: return QStringLiteral("ekran ve ses paylaşımı");
    case QWebEnginePermission::PermissionType::Notifications: return QStringLiteral("bildirim");
    case QWebEnginePermission::PermissionType::Geolocation: return QStringLiteral("konum");
    case QWebEnginePermission::PermissionType::ClipboardReadWrite: return QStringLiteral("pano erişimi");
    default: return QStringLiteral("bu özellik");
  }
}

QString frequentSiteKey(const QUrl &url) {
  QString host = url.host().toLower();
  if (host.startsWith(QStringLiteral("www."))) host.remove(0, 4);
  if (host.isEmpty()) return {};
  const int port = url.port();
  if (port > 0 && port != 80 && port != 443) host += QStringLiteral(":%1").arg(port);
  return host;
}

QUrl frequentSiteRootUrl(const QUrl &url) {
  QUrl root;
  root.setScheme(url.scheme());
  root.setHost(url.host().toLower());
  const int port = url.port();
  if (port > 0 && port != 80 && port != 443) root.setPort(port);
  root.setPath(QStringLiteral("/"));
  return root;
}

}  // namespace

#include "ardali_blocker_service.h"

BrowserProfileService::BrowserProfileService(const QString &dataDirectory, const BrowserPolicy *policy, QObject *parent)
    : QObject(parent), policy_(policy), preferences_(dataDirectory + "/browser-preferences.ini", QSettings::IniFormat) {
  QDir().mkpath(dataDirectory);
  profile_ = new QWebEngineProfile(QStringLiteral("ardali-browser"), this);
  profile_->setPersistentStoragePath(dataDirectory + "/profile");
  profile_->setCachePath(dataDirectory + "/cache");
  profile_->setHttpCacheType(QWebEngineProfile::DiskHttpCache);
  profile_->setPersistentCookiesPolicy(QWebEngineProfile::ForcePersistentCookies);
  profile_->setPersistentPermissionsPolicy(QWebEngineProfile::PersistentPermissionsPolicy::StoreOnDisk);
  profile_->setDownloadPath(downloadDirectory());
  profile_->setSpellCheckEnabled(true);
  profile_->setSpellCheckLanguages({QStringLiteral("tr-TR"), QStringLiteral("en-US")});
  auto *settings = profile_->settings();
  settings->setAttribute(QWebEngineSettings::JavascriptCanOpenWindows, false);
  settings->setAttribute(QWebEngineSettings::AllowRunningInsecureContent, false);
  settings->setAttribute(QWebEngineSettings::WebRTCPublicInterfacesOnly, true);

  blockerService_ = new ArDaliBlockerService(dataDirectory, this);
  credentialVault_ = new CredentialVaultManager(dataDirectory, this);
  interceptor_ = blockerService_->requestInterceptor();
  profile_->setUrlRequestInterceptor(interceptor_);

  newTabBackgroundStore_ = std::make_unique<NewTabBackgroundStore>(dataDirectory);
  profile_->installUrlSchemeHandler("ardali", createNewTabSchemeHandler(
      QCoreApplication::applicationDirPath() + "/assets/new-tab", newTabBackgroundStore_->managedImagePath(),
      newTabBackgroundStore_->thumbnailPath(), this));
  connect(profile_, &QWebEngineProfile::downloadRequested, this, &BrowserProfileService::handleDownload);
}

BrowserProfileService::~BrowserProfileService() = default;

QWebEngineProfile *BrowserProfileService::profile() const { return profile_; }

NewTabBackgroundStore *BrowserProfileService::newTabBackgroundStore() const { return newTabBackgroundStore_.get(); }

ArDaliBlockerService *BrowserProfileService::blockerService() const { return blockerService_; }
CredentialVaultManager *BrowserProfileService::credentialVault() const { return credentialVault_; }

QString BrowserProfileService::downloadDirectory() const {
  const QString configured = preferences_.value(QStringLiteral("downloads/directory")).toString();
  if (!configured.isEmpty() && QFileInfo(configured).isDir()) return configured;
  return QStandardPaths::writableLocation(QStandardPaths::DownloadLocation);
}

void BrowserProfileService::handleDownload(QWebEngineDownloadRequest *download) {
  if (!download || !policy_ || !policy_->allowsDownloadPrompt()) { if (download) download->cancel(); return; }
  const QString suggested = downloadDirectory() + QLatin1Char('/') + download->suggestedFileName();
  const bool ask = preferences_.value(QStringLiteral("downloads/askLocation"), true).toBool();
  QString target = suggested;
  if (ask) target = QFileDialog::getSaveFileName(QApplication::activeWindow(), QStringLiteral("İndirmeyi kaydet"), suggested);
  if (target.isEmpty()) { download->cancel(); return; }
  const QFileInfo info(target);
  download->setDownloadDirectory(info.absolutePath());
  download->setDownloadFileName(info.fileName());
  download->accept();
  downloads_.prepend({info.fileName(), info.absoluteFilePath(), QStringLiteral("İndiriliyor")});
  while (downloads_.size() > 30) downloads_.removeLast();
  emit downloadsChanged();
  connect(download, &QWebEngineDownloadRequest::stateChanged, this, [this, path = info.absoluteFilePath()](QWebEngineDownloadRequest::DownloadState state) {
    for (BrowserDownloadEntry &entry : downloads_) {
      if (entry.path != path) continue;
      switch (state) {
        case QWebEngineDownloadRequest::DownloadCompleted: entry.state = QStringLiteral("Tamamlandı"); break;
        case QWebEngineDownloadRequest::DownloadCancelled: entry.state = QStringLiteral("İptal edildi"); break;
        case QWebEngineDownloadRequest::DownloadInterrupted: entry.state = QStringLiteral("Kesintiye uğradı"); break;
        default: entry.state = QStringLiteral("İndiriliyor"); break;
      }
      emit downloadsChanged();
      return;
    }
  });
}

void BrowserProfileService::handlePermission(const QWebEnginePermission &permission) {
  if (!permission.isValid()) return;
  if (permission.state() == QWebEnginePermission::State::Granted || permission.state() == QWebEnginePermission::State::Denied) return;
  const QString origin = permission.origin().toDisplayString();
  const auto answer = QMessageBox::question(QApplication::activeWindow(), QStringLiteral("Site izni"),
      QStringLiteral("%1, %2 iznini istiyor.").arg(origin, permissionName(permission.permissionType())),
      QMessageBox::Yes | QMessageBox::No, QMessageBox::No);
  if (answer == QMessageBox::Yes) permission.grant(); else permission.deny();
}

bool BrowserProfileService::stripsTrackingParameters() const {
  return preferences_.value(QStringLiteral("privacy/stripTrackingParameters"), true).toBool();
}

void BrowserProfileService::setStripsTrackingParameters(bool enabled) {
  if (stripsTrackingParameters() == enabled) return;
  preferences_.setValue(QStringLiteral("privacy/stripTrackingParameters"), enabled);
  preferences_.sync();
  emit trackingProtectionChanged();
}

QString BrowserProfileService::configuredDownloadDirectory() const {
  return preferences_.value(QStringLiteral("downloads/directory")).toString();
}

void BrowserProfileService::setDownloadDirectory(const QString &directory) {
  const QFileInfo info(directory);
  if (!info.isDir()) return;
  preferences_.setValue(QStringLiteral("downloads/directory"), info.absoluteFilePath());
  preferences_.sync();
  profile_->setDownloadPath(info.absoluteFilePath());
}

bool BrowserProfileService::asksDownloadLocation() const {
  return preferences_.value(QStringLiteral("downloads/askLocation"), true).toBool();
}

void BrowserProfileService::setAsksDownloadLocation(bool enabled) {
  preferences_.setValue(QStringLiteral("downloads/askLocation"), enabled);
  preferences_.sync();
}

void BrowserProfileService::clearHttpCache() { profile_->clearHttpCache(); }

void BrowserProfileService::clearCookies() {
  if (auto *cookies = profile_->cookieStore()) cookies->deleteAllCookies();
}

QList<QWebEnginePermission> BrowserProfileService::sitePermissions() const {
  return profile_ ? profile_->listAllPermissions() : QList<QWebEnginePermission>{};
}

bool BrowserProfileService::resetSitePermission(const QUrl &origin, QWebEnginePermission::PermissionType type) {
  if (!profile_ || !origin.isValid()) return false;
  const QWebEnginePermission permission = profile_->queryPermission(origin, type);
  if (!permission.isValid()) return false;
  permission.reset();
  return true;
}

void BrowserProfileService::recordHistory(const QUrl &url, const QString &title) {
  if (!url.isValid() || (url.scheme() != QLatin1String("http") && url.scheme() != QLatin1String("https"))) return;
  QJsonArray values;
  const QJsonDocument existing = QJsonDocument::fromJson(preferences_.value(QStringLiteral("history/entries")).toByteArray());
  if (existing.isArray()) values = existing.array();
  const QString normalized = url.adjusted(QUrl::RemoveFragment).toString(QUrl::FullyEncoded);
  QJsonArray next;
  QJsonObject current{{QStringLiteral("url"), normalized}, {QStringLiteral("title"), title.left(180)},
                      {QStringLiteral("visitedAt"), QDateTime::currentDateTimeUtc().toString(Qt::ISODate)}};
  next.append(current);
  for (const QJsonValue &value : values) {
    const QJsonObject item = value.toObject();
    if (item.value(QStringLiteral("url")).toString() == normalized) continue;
    next.append(item);
    if (next.size() >= 300) break;
  }
  preferences_.setValue(QStringLiteral("history/entries"), QJsonDocument(next).toJson(QJsonDocument::Compact));

  QHash<QString, QJsonObject> sites;
  const QJsonDocument frequentDocument = QJsonDocument::fromJson(preferences_.value(QStringLiteral("history/frequentSites")).toByteArray());
  if (frequentDocument.isArray()) {
    for (const QJsonValue &value : frequentDocument.array()) {
      const QJsonObject site = value.toObject();
      const QString key = site.value(QStringLiteral("key")).toString();
      if (!key.isEmpty()) sites.insert(key, site);
    }
  } else {
    // Seed the new counter from history created by older builds.
    for (const QJsonValue &value : values) {
      const QJsonObject historyItem = value.toObject();
      const QUrl historyUrl(historyItem.value(QStringLiteral("url")).toString());
      const QString key = frequentSiteKey(historyUrl);
      if (key.isEmpty()) continue;
      QJsonObject site = sites.value(key);
      site.insert(QStringLiteral("key"), key);
      site.insert(QStringLiteral("url"), frequentSiteRootUrl(historyUrl).toString(QUrl::FullyEncoded));
      site.insert(QStringLiteral("iconLookupUrl"), historyUrl.toString(QUrl::FullyEncoded));
      site.insert(QStringLiteral("title"), historyItem.value(QStringLiteral("title")).toString().left(180));
      site.insert(QStringLiteral("visitCount"), site.value(QStringLiteral("visitCount")).toInt() + 1);
      site.insert(QStringLiteral("lastVisitedAt"), historyItem.value(QStringLiteral("visitedAt")).toString());
      sites.insert(key, site);
    }
  }
  const QString siteKey = frequentSiteKey(url);
  if (!siteKey.isEmpty()) {
    QJsonObject site = sites.value(siteKey);
    site.insert(QStringLiteral("key"), siteKey);
    site.insert(QStringLiteral("url"), frequentSiteRootUrl(url).toString(QUrl::FullyEncoded));
    site.insert(QStringLiteral("iconLookupUrl"), normalized);
    site.insert(QStringLiteral("title"), title.left(180));
    site.insert(QStringLiteral("visitCount"), site.value(QStringLiteral("visitCount")).toInt() + 1);
    site.insert(QStringLiteral("lastVisitedAt"), QDateTime::currentDateTimeUtc().toString(Qt::ISODate));
    sites.insert(siteKey, site);
  }
  QList<QJsonObject> orderedSites = sites.values();
  std::sort(orderedSites.begin(), orderedSites.end(), [](const QJsonObject &left, const QJsonObject &right) {
    const int leftCount = left.value(QStringLiteral("visitCount")).toInt();
    const int rightCount = right.value(QStringLiteral("visitCount")).toInt();
    if (leftCount != rightCount) return leftCount > rightCount;
    return left.value(QStringLiteral("lastVisitedAt")).toString() > right.value(QStringLiteral("lastVisitedAt")).toString();
  });
  QJsonArray frequentValues;
  const qsizetype maxCount = std::min<qsizetype>(100, orderedSites.size());
  for (qsizetype i = 0; i < maxCount; ++i) frequentValues.append(orderedSites.at(i));
  preferences_.setValue(QStringLiteral("history/frequentSites"), QJsonDocument(frequentValues).toJson(QJsonDocument::Compact));
  preferences_.sync();
}

QList<BrowserHistoryEntry> BrowserProfileService::recentHistory() const {
  QList<BrowserHistoryEntry> entries;
  const QJsonDocument document = QJsonDocument::fromJson(preferences_.value(QStringLiteral("history/entries")).toByteArray());
  if (!document.isArray()) return entries;
  for (const QJsonValue &value : document.array()) {
    const QJsonObject item = value.toObject();
    const QUrl url(item.value(QStringLiteral("url")).toString());
    if (!url.isValid()) continue;
    entries.append({item.value(QStringLiteral("title")).toString(), url,
                    QDateTime::fromString(item.value(QStringLiteral("visitedAt")).toString(), Qt::ISODate)});
  }
  return entries;
}

QList<BrowserFrequentSite> BrowserProfileService::frequentSites(int limit) const {
  QList<BrowserFrequentSite> sites;
  if (limit <= 0) return sites;
  const QJsonDocument document = QJsonDocument::fromJson(preferences_.value(QStringLiteral("history/frequentSites")).toByteArray());
  if (document.isArray()) {
    for (const QJsonValue &value : document.array()) {
      const QJsonObject item = value.toObject();
      const QUrl url(item.value(QStringLiteral("url")).toString());
      const QUrl iconLookupUrl(item.value(QStringLiteral("iconLookupUrl")).toString());
      const int visitCount = item.value(QStringLiteral("visitCount")).toInt();
      if (!url.isValid() || visitCount <= 0) continue;
      sites.append({item.value(QStringLiteral("title")).toString(), url,
                    iconLookupUrl.isValid() ? iconLookupUrl : url, visitCount,
                    QDateTime::fromString(item.value(QStringLiteral("lastVisitedAt")).toString(), Qt::ISODate)});
    }
  } else {
    QHash<QString, BrowserFrequentSite> migrated;
    for (const BrowserHistoryEntry &entry : recentHistory()) {
      const QString key = frequentSiteKey(entry.url);
      if (key.isEmpty()) continue;
      BrowserFrequentSite site = migrated.value(key);
      site.title = entry.title;
      site.url = frequentSiteRootUrl(entry.url);
      site.iconLookupUrl = entry.url;
      ++site.visitCount;
      if (!site.lastVisitedAt.isValid() || entry.visitedAt > site.lastVisitedAt) site.lastVisitedAt = entry.visitedAt;
      migrated.insert(key, site);
    }
    sites = migrated.values();
  }
  std::sort(sites.begin(), sites.end(), [](const BrowserFrequentSite &left, const BrowserFrequentSite &right) {
    if (left.visitCount != right.visitCount) return left.visitCount > right.visitCount;
    return left.lastVisitedAt > right.lastVisitedAt;
  });
  if (sites.isEmpty() || limit <= 0) return {};
  const qsizetype count = std::min<qsizetype>(limit, sites.size());
  return sites.mid(0, count);
}

void BrowserProfileService::clearHistory() {
  preferences_.remove(QStringLiteral("history/entries"));
  preferences_.remove(QStringLiteral("history/frequentSites"));
  preferences_.sync();
}

QList<BrowserDownloadEntry> BrowserProfileService::recentDownloads() const { return downloads_; }

void BrowserProfileService::rememberClosedTab(const QUrl &url, const QString &title) {
  if (!url.isValid()) return;
  closedTabs_.prepend({title.left(180), url, QDateTime::currentDateTimeUtc()});
  while (closedTabs_.size() > 25) closedTabs_.removeLast();
}

bool BrowserProfileService::hasClosedTabs() const { return !closedTabs_.isEmpty(); }

std::optional<ClosedTabEntry> BrowserProfileService::takeMostRecentClosedTab() {
  if (closedTabs_.isEmpty()) return std::nullopt;
  return closedTabs_.takeFirst();
}

QList<QUrl> BrowserProfileService::bookmarks() const {
  QList<QUrl> result;
  const QStringList stored = preferences_.value(QStringLiteral("bookmarks/urls")).toStringList();
  for (const QString &value : stored) {
    const QUrl url(value);
    if (url.isValid() && (url.scheme() == QLatin1String("http") || url.scheme() == QLatin1String("https"))) result.append(url);
  }
  return result;
}

bool BrowserProfileService::isBookmarked(const QUrl &url) const {
  const QString normalized = url.adjusted(QUrl::RemoveFragment).toString(QUrl::FullyEncoded);
  for (const QUrl &bookmark : bookmarks()) {
    if (bookmark.adjusted(QUrl::RemoveFragment).toString(QUrl::FullyEncoded) == normalized) return true;
  }
  return false;
}

bool BrowserProfileService::toggleBookmark(const QUrl &url) {
  if (!url.isValid() || (url.scheme() != QLatin1String("http") && url.scheme() != QLatin1String("https"))) return false;
  const QString normalized = url.adjusted(QUrl::RemoveFragment).toString(QUrl::FullyEncoded);
  QStringList values;
  bool removed = false;
  for (const QUrl &bookmark : bookmarks()) {
    const QString existing = bookmark.adjusted(QUrl::RemoveFragment).toString(QUrl::FullyEncoded);
    if (existing == normalized) { removed = true; continue; }
    values.append(existing);
  }
  if (!removed) values.append(normalized);
  preferences_.setValue(QStringLiteral("bookmarks/urls"), values);
  preferences_.sync();
  emit bookmarksChanged();
  return !removed;
}
