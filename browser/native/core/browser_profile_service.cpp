#include <QNetworkCookie>
#include <QTimer>
#include "search_suggestion_service.h"
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
#include <QWebEnginePage>
#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
#include <QWebEnginePermission>
#endif
#include <QWebEngineProfile>
#include <QWebEngineSettings>
#include <QWebEngineUrlRequestInfo>
#include <QWebEngineUrlRequestInterceptor>

#include <algorithm>

#include "browser_policy.h"
#include "security_utils.h"
#include "new_tab_scheme.h"
#include "new_tab_background_store.h"
#include "credential_vault_manager.h"
#include "downloads/general_download_manager.h"
#include "translate/translate_service.h"

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

#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
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
#endif

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

BrowserProfileService::BrowserProfileService(const QString &dataDirectory, const BrowserPolicy *policy, QObject *parent, bool privateMode, QNetworkAccessManager *suggestionNetwork)
    : QObject(parent), policy_(policy), dataDirectory_(QFileInfo(dataDirectory).absoluteFilePath()),
      preferences_(dataDirectory_ + "/browser-preferences.ini", QSettings::IniFormat) {
  QDir().mkpath(dataDirectory);
  QFile::setPermissions(dataDirectory_, QFileDevice::ReadOwner | QFileDevice::WriteOwner | QFileDevice::ExeOwner);
  QFile::setPermissions(dataDirectory_ + QStringLiteral("/browser-preferences.ini"), QFileDevice::ReadOwner | QFileDevice::WriteOwner);
  sanitizeStoredPersistentUrls();
  profile_ = privateMode ? new QWebEngineProfile(this) : new QWebEngineProfile(QStringLiteral("ardali-browser"), this);
  if (!privateMode) {
  profile_->setPersistentStoragePath(dataDirectory + "/profile");
  profile_->setCachePath(dataDirectory + "/cache");
  profile_->setHttpCacheType(QWebEngineProfile::DiskHttpCache);
  const QString cookiePol = preferences_.value(QStringLiteral("content/cookiePolicy"), QStringLiteral("third_party")).toString();
  if (cookiePol == QStringLiteral("block_all")) {
    profile_->setPersistentCookiesPolicy(QWebEngineProfile::NoPersistentCookies);
  } else {
    profile_->setPersistentCookiesPolicy(QWebEngineProfile::ForcePersistentCookies);
  }
#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
  profile_->setPersistentPermissionsPolicy(QWebEngineProfile::PersistentPermissionsPolicy::StoreOnDisk);
#endif
  }
  profile_->setDownloadPath(downloadDirectory());
  profile_->setSpellCheckEnabled(true);
  profile_->setSpellCheckLanguages({QStringLiteral("tr-TR"), QStringLiteral("en-US")});
  auto *settings = profile_->settings();
  const bool jsEnabled = preferences_.value(QStringLiteral("content/javascriptEnabled"), true).toBool();
  settings->setAttribute(QWebEngineSettings::JavascriptEnabled, jsEnabled);
  const bool autoImages = preferences_.value(QStringLiteral("content/autoLoadImages"), true).toBool();
  settings->setAttribute(QWebEngineSettings::AutoLoadImages, autoImages);
  const bool popupsAllowed = preferences_.value(QStringLiteral("content/popupsAllowed"), false).toBool();
  settings->setAttribute(QWebEngineSettings::JavascriptCanOpenWindows, popupsAllowed);
  settings->setAttribute(QWebEngineSettings::AllowWindowActivationFromJavaScript, popupsAllowed);
  const bool pdfViewer = preferences_.value(QStringLiteral("content/openPdfInBrowser"), true).toBool();
  settings->setAttribute(QWebEngineSettings::PdfViewerEnabled, pdfViewer);
  settings->setAttribute(QWebEngineSettings::JavascriptCanAccessClipboard, false);
  settings->setAttribute(QWebEngineSettings::LocalContentCanAccessFileUrls, false);
  settings->setAttribute(QWebEngineSettings::AllowRunningInsecureContent, false);
  settings->setAttribute(QWebEngineSettings::WebRTCPublicInterfacesOnly, true);
  settings->setAttribute(QWebEngineSettings::FullScreenSupportEnabled, true);
  settings->setUnknownUrlSchemePolicy(QWebEngineSettings::DisallowUnknownUrlSchemes);

  if (autoRevokeUnusedPermissions()) {
    revokeUnusedPermissionsNow();
  }

#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
  sanitizeStoredPermissions();
#endif

  searchSuggestions_ = new SearchSuggestionService(this, suggestionNetwork);
  searchSuggestions_->setEnabled(!privateMode && QSettings().value(QStringLiteral("browser/searchSuggestionsEnabled"), false).toBool());
  blockerService_ = new ArDaliBlockerService(dataDirectory, this);
  credentialVault_ = new CredentialVaultManager(dataDirectory, this);
  translateService_ = new TranslateService(this, nullptr, credentialVault_);
  translateService_->loadPreferences(preferences_);
  connect(blockerService_->settings(), &ArDaliBlockerSettings::settingsChanged, this, &BrowserProfileService::refreshCookieFilter);
  connect(this, &BrowserProfileService::contentSettingsChanged, this, &BrowserProfileService::refreshCookieFilter);
  refreshCookieFilter();
  connect(blockerService_, &ArDaliBlockerService::siteOpened, this, [this](const QString &host) { forgetHosts_.remove(host); });
  connect(blockerService_, &ArDaliBlockerService::siteClosed, this, [this](const QString &host) {
    const auto policy = blockerService_->sitePolicy(host);
    if (!blockerService_->settings()->protectionEnabled() || policy.whitelisted || !policy.forgetOnClose) return;
    if (forgetHosts_.size() >= 128) return;
    forgetHosts_.insert(host);
    profile_->cookieStore()->loadAllCookies();
    QTimer::singleShot(5000, this, [this,host] { forgetHosts_.remove(host); });
  });
  connect(profile_->cookieStore(), &QWebEngineCookieStore::cookieAdded, this, [this](const QNetworkCookie &cookie) {
    QString domain = cookie.domain();
    if (domain.startsWith(QLatin1Char('.'))) domain.remove(0,1);
    domain = ArDaliBlockerSettings::normalizeSiteHost(domain);
    for (const auto &host : std::as_const(forgetHosts_)) {
      if (domain == host || domain.endsWith(QLatin1Char('.') + host)) {
        profile_->cookieStore()->deleteCookie(cookie);
        break;
      }
    }
    for (int i = 0; i < cookies_.size(); ++i) {
      if (cookies_[i].name() == cookie.name() && cookies_[i].domain() == cookie.domain() && cookies_[i].path() == cookie.path()) {
        cookies_.removeAt(i);
        break;
      }
    }
    cookies_.append(cookie);
  });
  connect(profile_->cookieStore(), &QWebEngineCookieStore::cookieRemoved, this, [this](const QNetworkCookie &cookie) {
    for (int i = 0; i < cookies_.size(); ++i) {
      if (cookies_[i].name() == cookie.name() && cookies_[i].domain() == cookie.domain() && cookies_[i].path() == cookie.path()) {
        cookies_.removeAt(i);
        break;
      }
    }
  });
  profile_->cookieStore()->loadAllCookies();
  interceptor_ = blockerService_->requestInterceptor();
  profile_->setUrlRequestInterceptor(interceptor_);
  if (qEnvironmentVariableIntValue("ARDALI_FEATURE_DIAGNOSTICS") == 1) {
    qInfo().noquote() << "[BLOCKER] interceptor attached";
  }

  newTabBackgroundStore_ = std::make_unique<NewTabBackgroundStore>(dataDirectory);
  profile_->installUrlSchemeHandler("ardali", createNewTabSchemeHandler(
      QCoreApplication::applicationDirPath() + "/assets/new-tab", newTabBackgroundStore_->managedImagePath(),
      newTabBackgroundStore_->thumbnailPath(), this, this, profile_));
  generalDownloadManager_ = new GeneralDownloadManager(
      dataDirectory_ + QStringLiteral("/general-downloads.json"), nullptr, this);
  connect(generalDownloadManager_, &GeneralDownloadManager::jobsChanged,
          this, &BrowserProfileService::downloadsChanged);
  connect(profile_, &QWebEngineProfile::downloadRequested, this, &BrowserProfileService::handleDownload);
}

BrowserProfileService::~BrowserProfileService() = default;

QWebEngineProfile *BrowserProfileService::profile() const { return profile_; }
QString BrowserProfileService::dataDirectory() const { return dataDirectory_; }
GeneralDownloadManager *BrowserProfileService::downloadManager() const { return generalDownloadManager_; }

NewTabBackgroundStore *BrowserProfileService::newTabBackgroundStore() const { return newTabBackgroundStore_.get(); }

ArDaliBlockerService *BrowserProfileService::blockerService() const { return blockerService_; }
CredentialVaultManager *BrowserProfileService::credentialVault() const { return credentialVault_; }
TranslateService *BrowserProfileService::translateService() const { return translateService_; }

QString BrowserProfileService::downloadDirectory() const {
  const QString configured = preferences_.value(QStringLiteral("downloads/directory")).toString();
  if (!configured.isEmpty() && QFileInfo(configured).isDir()) return configured;
  return QStandardPaths::writableLocation(QStandardPaths::DownloadLocation);
}

void BrowserProfileService::handleDownload(QWebEngineDownloadRequest *download) {
  if (!download || !policy_ || !policy_->allowsDownloadPrompt()) { if (download) download->cancel(); return; }
  const QString safeFileName = BrowserSecurity::sanitizeDownloadFileName(download->suggestedFileName());
  const QString suggested = QDir(downloadDirectory()).filePath(safeFileName);
  const bool ask = preferences_.value(QStringLiteral("downloads/askLocation"), true).toBool();
  QString target = suggested;
  if (ask) target = QFileDialog::getSaveFileName(QApplication::activeWindow(), QStringLiteral("İndirmeyi kaydet"), suggested);
  if (target.isEmpty()) { download->cancel(); return; }
  const QFileInfo info(target);
  if (generalDownloadManager_ && !download->isSavePageDownload()
      && GeneralDownloadManager::canHandleUrl(download->url())) {
    GeneralDownloadRequest request;
    request.url = download->url();
    request.suggestedFileName = info.fileName();
    request.targetDirectory = info.absolutePath();
    request.mimeType = download->mimeType();
    request.expectedBytes = download->totalBytes();
    request.connectionCount = 4;
    request.allowParallel = true;
    // The native dialog already obtained explicit overwrite consent for this
    // exact path. The old file remains intact until atomic finalization.
    request.overwriteExisting = true;
    request.userAgent = profile_->httpUserAgent().toUtf8();
    if (download->page()) request.referrer = download->page()->url().toEncoded(QUrl::FullyEncoded);
    const QString host = request.url.host().toLower();
    const QString path = request.url.path().isEmpty() ? QStringLiteral("/") : request.url.path();
    for (const QNetworkCookie &cookie : std::as_const(cookies_)) {
      QString domain = cookie.domain().toLower();
      if (domain.startsWith(QLatin1Char('.'))) domain.remove(0, 1);
      const bool domainMatches = host == domain || host.endsWith(QLatin1Char('.') + domain);
      const bool pathMatches = path.startsWith(cookie.path().isEmpty()
          ? QStringLiteral("/") : cookie.path());
      if (domainMatches && pathMatches && (!cookie.isSecure() || request.url.scheme() == QLatin1String("https")))
        request.cookies.append(cookie);
    }
    if (!generalDownloadManager_->enqueue(request).isNull()) {
      download->cancel();
      return;
    }
  }
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

#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
QString BrowserProfileService::permissionKeyFromType(QWebEnginePermission::PermissionType type) {
  switch (type) {
    case QWebEnginePermission::PermissionType::Geolocation: return QStringLiteral("geolocation");
    case QWebEnginePermission::PermissionType::MediaVideoCapture: return QStringLiteral("camera");
    case QWebEnginePermission::PermissionType::MediaAudioCapture: return QStringLiteral("microphone");
    case QWebEnginePermission::PermissionType::MediaAudioVideoCapture: return QStringLiteral("cameraMicrophone");
    case QWebEnginePermission::PermissionType::Notifications: return QStringLiteral("notifications");
    case QWebEnginePermission::PermissionType::ClipboardReadWrite: return QStringLiteral("clipboard");
    case QWebEnginePermission::PermissionType::LocalFontsAccess: return QStringLiteral("localFonts");
    case QWebEnginePermission::PermissionType::MouseLock: return QStringLiteral("mouseLock");
    case QWebEnginePermission::PermissionType::DesktopVideoCapture:
    case QWebEnginePermission::PermissionType::DesktopAudioVideoCapture: return QStringLiteral("screenShare");
    default: return {};
  }
}

QWebEnginePermission::PermissionType BrowserProfileService::permissionTypeFromKey(const QString &key) {
  if (key == QStringLiteral("geolocation")) return QWebEnginePermission::PermissionType::Geolocation;
  if (key == QStringLiteral("camera")) return QWebEnginePermission::PermissionType::MediaVideoCapture;
  if (key == QStringLiteral("microphone")) return QWebEnginePermission::PermissionType::MediaAudioCapture;
  if (key == QStringLiteral("cameraMicrophone")) return QWebEnginePermission::PermissionType::MediaAudioVideoCapture;
  if (key == QStringLiteral("notifications")) return QWebEnginePermission::PermissionType::Notifications;
  if (key == QStringLiteral("clipboard")) return QWebEnginePermission::PermissionType::ClipboardReadWrite;
  if (key == QStringLiteral("localFonts")) return QWebEnginePermission::PermissionType::LocalFontsAccess;
  if (key == QStringLiteral("mouseLock")) return QWebEnginePermission::PermissionType::MouseLock;
  if (key == QStringLiteral("screenShare")) return QWebEnginePermission::PermissionType::DesktopVideoCapture;
  return QWebEnginePermission::PermissionType::Unsupported;
}

BrowserProfileService::OriginPolicyResult BrowserProfileService::evaluatePermissionPolicy(
    const QUrl &origin, QWebEnginePermission::PermissionType type) const {
  if (type == QWebEnginePermission::PermissionType::MediaAudioVideoCapture) {
    const auto camResult = evaluatePermissionPolicy(origin, QWebEnginePermission::PermissionType::MediaVideoCapture);
    const auto micResult = evaluatePermissionPolicy(origin, QWebEnginePermission::PermissionType::MediaAudioCapture);
    if (camResult == OriginPolicyResult::Deny || micResult == OriginPolicyResult::Deny) {
      return OriginPolicyResult::Deny;
    }
    const QString canon = canonicalOrigin(origin);
    const QString host = origin.host().toLower();
    const QString originStr = origin.toDisplayString();
    const QStringList denied = deniedOrigins(QStringLiteral("cameraMicrophone"));
    for (const QString &d : denied) {
      const QString dClean = d.trimmed().toLower();
      if (dClean == canon || dClean == host || dClean == originStr.toLower() ||
          (dClean.startsWith(QStringLiteral("[*.]")) && host.endsWith(dClean.mid(4)))) {
        return OriginPolicyResult::Deny;
      }
    }
    const QStringList allowed = allowedOrigins(QStringLiteral("cameraMicrophone"));
    for (const QString &a : allowed) {
      const QString aClean = a.trimmed().toLower();
      if (aClean == canon || aClean == host || aClean == originStr.toLower() ||
          (aClean.startsWith(QStringLiteral("[*.]")) && host.endsWith(aClean.mid(4)))) {
        return OriginPolicyResult::Allow;
      }
    }
    if (camResult == OriginPolicyResult::Allow && micResult == OriginPolicyResult::Allow) {
      return OriginPolicyResult::Allow;
    }
    return OriginPolicyResult::Prompt;
  }

  const QString permKey = permissionKeyFromType(type);
  if (permKey.isEmpty()) return OriginPolicyResult::Deny;

  const QString canon = canonicalOrigin(origin);
  const QString host = origin.host().toLower();
  const QString originStr = origin.toDisplayString();

  const QStringList denied = deniedOrigins(permKey);
  for (const QString &d : denied) {
    const QString dClean = d.trimmed().toLower();
    if (dClean == canon || dClean == host || dClean == originStr.toLower() ||
        (dClean.startsWith(QStringLiteral("[*.]")) && host.endsWith(dClean.mid(4)))) {
      return OriginPolicyResult::Deny;
    }
  }

  const QStringList allowed = allowedOrigins(permKey);
  for (const QString &a : allowed) {
    const QString aClean = a.trimmed().toLower();
    if (aClean == canon || aClean == host || aClean == originStr.toLower() ||
        (aClean.startsWith(QStringLiteral("[*.]")) && host.endsWith(aClean.mid(4)))) {
      return OriginPolicyResult::Allow;
    }
  }

  const QString policy = permissionDefaultPolicy(permKey);
  if (policy == QStringLiteral("deny")) {
    return OriginPolicyResult::Deny;
  } else if (policy == QStringLiteral("allow")) {
    return OriginPolicyResult::Allow;
  }

  return OriginPolicyResult::Prompt;
}

void BrowserProfileService::sanitizeStoredPermissions() {
  if (!profile_) return;
  const auto all = profile_->listAllPermissions();
  for (const auto &perm : all) {
    if (!perm.isValid()) continue;
    const QString permKey = permissionKeyFromType(perm.permissionType());
    if (permKey.isEmpty()) {
      perm.reset();
      continue;
    }
    const QString canon = canonicalOrigin(perm.origin());
    const QString host = perm.origin().host().toLower();
    const QString disp = perm.origin().toDisplayString();
    const QStringList allowed = allowedOrigins(permKey);
    const QStringList denied = deniedOrigins(permKey);
    bool hasPermanent = false;
    for (const QString &item : allowed) {
      if (item.compare(canon, Qt::CaseInsensitive) == 0 ||
          item.compare(host, Qt::CaseInsensitive) == 0 ||
          item.compare(disp, Qt::CaseInsensitive) == 0) {
        hasPermanent = true;
        break;
      }
    }
    if (!hasPermanent) {
      for (const QString &item : denied) {
        if (item.compare(canon, Qt::CaseInsensitive) == 0 ||
            item.compare(host, Qt::CaseInsensitive) == 0 ||
            item.compare(disp, Qt::CaseInsensitive) == 0) {
          hasPermanent = true;
          break;
        }
      }
    }
    if (!hasPermanent) {
      perm.reset();
    }
  }
}

void BrowserProfileService::handlePermission(const QWebEnginePermission &permission) {
  if (!permission.isValid()) return;
  if (permission.state() == QWebEnginePermission::State::Granted || permission.state() == QWebEnginePermission::State::Denied) return;

  const OriginPolicyResult result = evaluatePermissionPolicy(permission.origin(), permission.permissionType());
  if (result == OriginPolicyResult::Allow) {
    permission.grant();
  } else if (result == OriginPolicyResult::Deny) {
    permission.deny();
  }
}
#endif

QString BrowserProfileService::canonicalOrigin(const QUrl &url) {
  if (!url.isValid()) return {};
  const QString scheme = url.scheme().toLower();
  const QString host = url.host().toLower();
  if (host.isEmpty()) return {};
  const int port = url.port();
  if (port > 0 && port != 80 && port != 443) {
    return QStringLiteral("%1://%2:%3").arg(scheme, host).arg(port);
  }
  return QStringLiteral("%1://%2").arg(scheme, host);
}

bool BrowserProfileService::isPermissibleWebOrigin(const QUrl &url) {
  if (!url.isValid()) return false;
  const QString scheme = url.scheme().toLower();
  if (scheme == QLatin1String("http") || scheme == QLatin1String("https")) {
    return !url.host().trimmed().isEmpty();
  }
  return false;
}

bool BrowserProfileService::isTrustedInternalScheme(const QUrl &url) {
  if (!url.isValid()) return false;
  return url.scheme().toLower() == QLatin1String("ardali");
}

QStringList BrowserProfileService::allowedOrigins(const QString &permissionKey) const {
  return preferences_.value(QStringLiteral("customPermissions/") + permissionKey + QStringLiteral("/allowed")).toStringList();
}

QStringList BrowserProfileService::deniedOrigins(const QString &permissionKey) const {
  return preferences_.value(QStringLiteral("customPermissions/") + permissionKey + QStringLiteral("/denied")).toStringList();
}

bool BrowserProfileService::addSitePermissionRule(const QString &permissionKey, const QString &origin, bool allow) {
  QString clean = origin.trimmed();
  if (clean.isEmpty()) return false;

  QUrl testUrl(clean);
  if (testUrl.scheme().isEmpty()) {
    testUrl = QUrl(QStringLiteral("https://") + clean);
  }
  if (!isPermissibleWebOrigin(testUrl)) return false;
  clean = canonicalOrigin(testUrl);
  if (clean.isEmpty()) return false;

  QStringList allowed = allowedOrigins(permissionKey);
  QStringList denied = deniedOrigins(permissionKey);
  allowed.removeAll(clean);
  denied.removeAll(clean);
  if (allow) {
    allowed.append(clean);
  } else {
    denied.append(clean);
  }
  preferences_.setValue(QStringLiteral("customPermissions/") + permissionKey + QStringLiteral("/allowed"), allowed);
  preferences_.setValue(QStringLiteral("customPermissions/") + permissionKey + QStringLiteral("/denied"), denied);
  preferences_.sync();

#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
  if (profile_) {
    const QUrl targetUrl(clean.startsWith(QStringLiteral("http")) ? clean : QStringLiteral("https://") + clean);
    if (targetUrl.isValid()) {
      const QWebEnginePermission::PermissionType pType = permissionTypeFromKey(permissionKey);
      if (pType != QWebEnginePermission::PermissionType::Unsupported) {
        QWebEnginePermission perm = profile_->queryPermission(targetUrl, pType);
        if (perm.isValid()) {
          if (allow) perm.grant(); else perm.deny();
        }
      }
    }
  }
#endif

  emit permissionsPolicyChanged();
  return true;
}

bool BrowserProfileService::removeSitePermissionRule(const QString &permissionKey, const QString &origin) {
  QString clean = origin.trimmed();
  if (clean.isEmpty()) return false;
  QStringList allowed = allowedOrigins(permissionKey);
  QStringList denied = deniedOrigins(permissionKey);
  const int removedCount = allowed.removeAll(clean) + denied.removeAll(clean);
  if (removedCount == 0) return false;
  preferences_.setValue(QStringLiteral("customPermissions/") + permissionKey + QStringLiteral("/allowed"), allowed);
  preferences_.setValue(QStringLiteral("customPermissions/") + permissionKey + QStringLiteral("/denied"), denied);
  preferences_.sync();

#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
  if (profile_) {
    const QUrl targetUrl(clean.startsWith(QStringLiteral("http")) ? clean : QStringLiteral("https://") + clean);
    if (targetUrl.isValid()) {
      const QWebEnginePermission::PermissionType pType = permissionTypeFromKey(permissionKey);
      if (pType != QWebEnginePermission::PermissionType::Unsupported) {
        const QWebEnginePermission permission = profile_->queryPermission(targetUrl, pType);
        if (permission.isValid()) {
          permission.reset();
        }
      }
    }
  }
#endif

  emit permissionsPolicyChanged();
  return true;
}

bool BrowserProfileService::hasSitePermissionRule(const QString &permissionKey, const QString &origin) const {
  const QString clean = origin.trimmed().toLower();
  if (clean.isEmpty() || permissionKey.isEmpty()) return false;
  const QString canon = canonicalOrigin(QUrl(clean.startsWith(QStringLiteral("http")) ? clean : QStringLiteral("https://") + clean));
  const QString host = QUrl(clean.startsWith(QStringLiteral("http")) ? clean : QStringLiteral("https://") + clean).host().toLower();

  const QStringList allowed = allowedOrigins(permissionKey);
  for (const QString &item : allowed) {
    const QString c = item.trimmed().toLower();
    if (c == clean || c == canon || c == host ||
        (c.startsWith(QStringLiteral("[*.]")) && (host.endsWith(c.mid(4)) || clean.endsWith(c.mid(4))))) {
      return true;
    }
  }

  const QStringList denied = deniedOrigins(permissionKey);
  for (const QString &item : denied) {
    const QString c = item.trimmed().toLower();
    if (c == clean || c == canon || c == host ||
        (c.startsWith(QStringLiteral("[*.]")) && (host.endsWith(c.mid(4)) || clean.endsWith(c.mid(4))))) {
      return true;
    }
  }

  return false;
}

QString BrowserProfileService::requestDisplayMode(const QString &permissionKey) const {
  return preferences_.value(QStringLiteral("permissionsDisplayMode/") + permissionKey, QStringLiteral("quiet")).toString();
}

void BrowserProfileService::setRequestDisplayMode(const QString &permissionKey, const QString &mode) {
  if (requestDisplayMode(permissionKey) == mode) return;
  preferences_.setValue(QStringLiteral("permissionsDisplayMode/") + permissionKey, mode);
  preferences_.sync();
  emit permissionsPolicyChanged();
}

QString BrowserProfileService::preferredAudioInputDevice() const {
  return preferences_.value(QStringLiteral("hardware/preferredAudioInputDevice"), QStringLiteral("Sistem varsayılanı")).toString();
}

void BrowserProfileService::setPreferredAudioInputDevice(const QString &deviceName) {
  if (preferredAudioInputDevice() == deviceName) return;
  preferences_.setValue(QStringLiteral("hardware/preferredAudioInputDevice"), deviceName);
  preferences_.sync();
}

QString BrowserProfileService::permissionDefaultPolicy(const QString &permissionKey) const {
  if (permissionKey == QStringLiteral("notifications")) {
    return preferences_.value(QStringLiteral("permissions/notifications"), QStringLiteral("quiet")).toString();
  }
  return preferences_.value(QStringLiteral("permissions/") + permissionKey, QStringLiteral("prompt")).toString();
}

void BrowserProfileService::setPermissionDefaultPolicy(const QString &permissionKey, const QString &policy) {
  if (permissionDefaultPolicy(permissionKey) == policy) return;
  preferences_.setValue(QStringLiteral("permissions/") + permissionKey, policy);
  preferences_.sync();
  emit permissionsPolicyChanged();
}

bool BrowserProfileService::autoRevokeUnusedPermissions() const {
  return preferences_.value(QStringLiteral("privacy/autoRevokeUnusedPermissions"), true).toBool();
}

void BrowserProfileService::setAutoRevokeUnusedPermissions(bool enabled) {
  if (autoRevokeUnusedPermissions() == enabled) return;
  preferences_.setValue(QStringLiteral("privacy/autoRevokeUnusedPermissions"), enabled);
  preferences_.sync();
  emit permissionsPolicyChanged();
  if (enabled) {
    revokeUnusedPermissionsNow();
  }
}

void BrowserProfileService::revokeUnusedPermissionsNow() {
#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
  if (!profile_) return;
  const auto permissions = sitePermissions();
  if (permissions.isEmpty()) return;
  const auto history = recentHistory();
  QSet<QString> activeHosts;
  const QDateTime threshold = QDateTime::currentDateTimeUtc().addDays(-30);
  for (const auto &entry : history) {
    if (entry.visitedAt >= threshold) {
      activeHosts.insert(entry.url.host().toLower());
    }
  }
  for (const auto &perm : permissions) {
    if (!perm.isValid()) continue;
    const QString host = perm.origin().host().toLower();
    if (!host.isEmpty() && !activeHosts.contains(host)) {
      perm.reset();
    }
  }
#endif
}

QString BrowserProfileService::cookiePolicy() const {
  return preferences_.value(QStringLiteral("content/cookiePolicy"), QStringLiteral("third_party")).toString();
}

void BrowserProfileService::setCookiePolicy(const QString &policy) {
  if (cookiePolicy() == policy) return;
  preferences_.setValue(QStringLiteral("content/cookiePolicy"), policy);
  preferences_.sync();
  if (profile_) {
    if (policy == QStringLiteral("block_all")) {
      profile_->setPersistentCookiesPolicy(QWebEngineProfile::NoPersistentCookies);
      clearCookies();
    } else {
      profile_->setPersistentCookiesPolicy(QWebEngineProfile::ForcePersistentCookies);
    }
  }
  emit contentSettingsChanged();
}

bool BrowserProfileService::isJavascriptEnabled() const {
  return preferences_.value(QStringLiteral("content/javascriptEnabled"), true).toBool();
}

void BrowserProfileService::setJavascriptEnabled(bool enabled) {
  if (isJavascriptEnabled() == enabled) return;
  preferences_.setValue(QStringLiteral("content/javascriptEnabled"), enabled);
  preferences_.sync();
  if (profile_ && profile_->settings()) {
    profile_->settings()->setAttribute(QWebEngineSettings::JavascriptEnabled, enabled);
  }
  emit contentSettingsChanged();
}

bool BrowserProfileService::isAutoLoadImagesEnabled() const {
  return preferences_.value(QStringLiteral("content/autoLoadImages"), true).toBool();
}

void BrowserProfileService::setAutoLoadImagesEnabled(bool enabled) {
  if (isAutoLoadImagesEnabled() == enabled) return;
  preferences_.setValue(QStringLiteral("content/autoLoadImages"), enabled);
  preferences_.sync();
  if (profile_ && profile_->settings()) {
    profile_->settings()->setAttribute(QWebEngineSettings::AutoLoadImages, enabled);
  }
  emit contentSettingsChanged();
}

bool BrowserProfileService::arePopupsAllowed() const {
  return preferences_.value(QStringLiteral("content/popupsAllowed"), false).toBool();
}

void BrowserProfileService::setPopupsAllowed(bool allowed) {
  if (arePopupsAllowed() == allowed) return;
  preferences_.setValue(QStringLiteral("content/popupsAllowed"), allowed);
  preferences_.sync();
  if (profile_ && profile_->settings()) {
    profile_->settings()->setAttribute(QWebEngineSettings::JavascriptCanOpenWindows, allowed);
    profile_->settings()->setAttribute(QWebEngineSettings::AllowWindowActivationFromJavaScript, allowed);
  }
  emit contentSettingsChanged();
}

bool BrowserProfileService::isSoundAllowed() const {
  return preferences_.value(QStringLiteral("content/soundAllowed"), true).toBool();
}

void BrowserProfileService::setSoundAllowed(bool allowed) {
  if (isSoundAllowed() == allowed) return;
  preferences_.setValue(QStringLiteral("content/soundAllowed"), allowed);
  preferences_.sync();
  emit contentSettingsChanged();
}

bool BrowserProfileService::openPdfInBrowser() const {
  return preferences_.value(QStringLiteral("content/openPdfInBrowser"), true).toBool();
}

void BrowserProfileService::setOpenPdfInBrowser(bool enabled) {
  if (openPdfInBrowser() == enabled) return;
  preferences_.setValue(QStringLiteral("content/openPdfInBrowser"), enabled);
  preferences_.sync();
  if (profile_ && profile_->settings()) {
    profile_->settings()->setAttribute(QWebEngineSettings::PdfViewerEnabled, enabled);
  }
  emit contentSettingsChanged();
}

bool BrowserProfileService::isProtectedContentEnabled() const {
  return preferences_.value(QStringLiteral("content/protectedContentEnabled"), true).toBool();
}

void BrowserProfileService::setProtectedContentEnabled(bool enabled) {
  preferences_.setValue(QStringLiteral("content/protectedContentEnabled"), enabled);
  preferences_.sync();
  emit contentSettingsChanged();
}

QString BrowserProfileService::insecureContentPolicy() const {
  return preferences_.value(QStringLiteral("content/insecureContentPolicy"), QStringLiteral("block")).toString();
}

void BrowserProfileService::setInsecureContentPolicy(const QString &policy) {
  preferences_.setValue(QStringLiteral("content/insecureContentPolicy"), policy);
  preferences_.sync();
  emit contentSettingsChanged();
}

QString BrowserProfileService::siteDataPolicy() const {
  return preferences_.value(QStringLiteral("content/siteDataPolicy"), QStringLiteral("allow")).toString();
}

void BrowserProfileService::setSiteDataPolicy(const QString &policy) {
  preferences_.setValue(QStringLiteral("content/siteDataPolicy"), policy);
  preferences_.sync();
  emit contentSettingsChanged();
}

bool BrowserProfileService::isJsOptimizationEnabled() const {
  return preferences_.value(QStringLiteral("content/jsOptimizationEnabled"), true).toBool();
}

void BrowserProfileService::setJsOptimizationEnabled(bool enabled) {
  preferences_.setValue(QStringLiteral("content/jsOptimizationEnabled"), enabled);
  preferences_.sync();
  emit contentSettingsChanged();
}

bool BrowserProfileService::isAutoFullscreenAllowed() const {
  return preferences_.value(QStringLiteral("content/autoFullscreenAllowed"), false).toBool();
}

void BrowserProfileService::setAutoFullscreenAllowed(bool allowed) {
  preferences_.setValue(QStringLiteral("content/autoFullscreenAllowed"), allowed);
  preferences_.sync();
  if (profile_ && profile_->settings()) {
    profile_->settings()->setAttribute(QWebEngineSettings::FullScreenSupportEnabled, allowed);
  }
  emit contentSettingsChanged();
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
  cookies_.clear();
  if (auto *cookies = profile_->cookieStore()) cookies->deleteAllCookies();
}

int BrowserProfileService::cookiesCountForHost(const QString &host) const {
  const QString cleanHost = host.trimmed().toLower();
  if (cleanHost.isEmpty()) return 0;
  int count = 0;
  for (const auto &c : cookies_) {
    QString d = c.domain().toLower();
    if (d.startsWith(QLatin1Char('.'))) d.remove(0, 1);
    if (d == cleanHost || cleanHost.endsWith(QLatin1Char('.') + d) || d.endsWith(QLatin1Char('.') + cleanHost)) {
      ++count;
    }
  }
  return count;
}

void BrowserProfileService::clearCookiesForHost(const QString &host) {
  const QString cleanHost = host.trimmed().toLower();
  if (cleanHost.isEmpty() || !profile_ || !profile_->cookieStore()) return;
  QList<QNetworkCookie> toDelete;
  for (int i = cookies_.size() - 1; i >= 0; --i) {
    const auto &c = cookies_.at(i);
    QString d = c.domain().toLower();
    if (d.startsWith(QLatin1Char('.'))) d.remove(0, 1);
    if (d == cleanHost || cleanHost.endsWith(QLatin1Char('.') + d) || d.endsWith(QLatin1Char('.') + cleanHost)) {
      toDelete.append(c);
      cookies_.removeAt(i);
    }
  }
  for (const auto &c : toDelete) {
    profile_->cookieStore()->deleteCookie(c);
  }
}

#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
QList<QWebEnginePermission> BrowserProfileService::sitePermissions() const {
  if (!profile_) return {};
  QList<QWebEnginePermission> result;
  QSet<QString> seenKeys;

  static const QStringList kAllPermissionKeys = {
    QStringLiteral("geolocation"),
    QStringLiteral("camera"),
    QStringLiteral("microphone"),
    QStringLiteral("cameraMicrophone"),
    QStringLiteral("notifications"),
    QStringLiteral("clipboard"),
    QStringLiteral("localFonts"),
    QStringLiteral("mouseLock"),
    QStringLiteral("screenShare")
  };

  for (const QString &key : kAllPermissionKeys) {
    const QWebEnginePermission::PermissionType pType = permissionTypeFromKey(key);
    if (pType == QWebEnginePermission::PermissionType::Unsupported) continue;

    const QStringList allowed = allowedOrigins(key);
    for (const QString &originStr : allowed) {
      const QString trimmed = originStr.trimmed();
      if (trimmed.isEmpty()) continue;
      const QUrl url(trimmed.startsWith(QStringLiteral("http")) ? trimmed : QStringLiteral("https://") + trimmed);
      if (!url.isValid()) continue;
      const QString uniqueKey = QStringLiteral("%1|%2").arg(url.toDisplayString(), QString::number(static_cast<int>(pType)));
      if (seenKeys.contains(uniqueKey)) continue;
      seenKeys.insert(uniqueKey);

      QWebEnginePermission perm = profile_->queryPermission(url, pType);
      if (perm.isValid()) {
        if (perm.state() != QWebEnginePermission::State::Granted) {
          perm.grant();
        }
        result.append(perm);
      }
    }

    const QStringList denied = deniedOrigins(key);
    for (const QString &originStr : denied) {
      const QString trimmed = originStr.trimmed();
      if (trimmed.isEmpty()) continue;
      const QUrl url(trimmed.startsWith(QStringLiteral("http")) ? trimmed : QStringLiteral("https://") + trimmed);
      if (!url.isValid()) continue;
      const QString uniqueKey = QStringLiteral("%1|%2").arg(url.toDisplayString(), QString::number(static_cast<int>(pType)));
      if (seenKeys.contains(uniqueKey)) continue;
      seenKeys.insert(uniqueKey);

      QWebEnginePermission perm = profile_->queryPermission(url, pType);
      if (perm.isValid()) {
        if (perm.state() != QWebEnginePermission::State::Denied) {
          perm.deny();
        }
        result.append(perm);
      }
    }
  }

  return result;
}

bool BrowserProfileService::resetSitePermission(const QUrl &origin, QWebEnginePermission::PermissionType type) {
  if (!origin.isValid()) return false;
  if (profile_) {
    const QWebEnginePermission permission = profile_->queryPermission(origin, type);
    if (permission.isValid()) {
      permission.reset();
    }
  }
  const QString permKey = permissionKeyFromType(type);
  if (!permKey.isEmpty()) {
    QStringList allowed = allowedOrigins(permKey);
    QStringList denied = deniedOrigins(permKey);
    const QString canon = canonicalOrigin(origin);
    const QString raw = origin.toDisplayString();
    const QString host = origin.host();
    bool changed = false;
    for (const QString &item : {canon, raw, host}) {
      if (!item.isEmpty()) {
        if (allowed.removeAll(item) > 0) changed = true;
        if (denied.removeAll(item) > 0) changed = true;
      }
    }
    if (changed) {
      preferences_.setValue(QStringLiteral("customPermissions/") + permKey + QStringLiteral("/allowed"), allowed);
      preferences_.setValue(QStringLiteral("customPermissions/") + permKey + QStringLiteral("/denied"), denied);
      preferences_.sync();
    }
  }
  emit permissionsPolicyChanged();
  return true;
}
#endif

void BrowserProfileService::recordHistory(const QUrl &url, const QString &title, bool isTyped) {
  const QUrl persistentUrl = BrowserSecurity::sanitizeUrlForPersistence(url);
  if (!persistentUrl.isValid() || (persistentUrl.scheme() != QLatin1String("http") && persistentUrl.scheme() != QLatin1String("https"))) return;
  QJsonArray values;
  const QJsonDocument existing = QJsonDocument::fromJson(preferences_.value(QStringLiteral("history/entries")).toByteArray());
  if (existing.isArray()) values = existing.array();
  const QString normalized = persistentUrl.adjusted(QUrl::RemoveFragment).toString(QUrl::FullyEncoded);
  const QString cleanTitle = title.trimmed().left(180);
  const QString recordTitle = (cleanTitle.isEmpty() || cleanTitle == QStringLiteral("Yeni Sekme"))
      ? persistentUrl.host() : cleanTitle;
  int typedCount = 0;
  for (const QJsonValue &value : values) {
    const QJsonObject item = value.toObject();
    if (item.value(QStringLiteral("url")).toString() == normalized) {
      typedCount = std::max(0, item.value(QStringLiteral("typedCount")).toInt());
      break;
    }
  }
  if (isTyped) ++typedCount;
  QJsonArray next;
  QJsonObject current{{QStringLiteral("url"), normalized}, {QStringLiteral("title"), recordTitle},
                      {QStringLiteral("visitedAt"), QDateTime::currentDateTimeUtc().toString(Qt::ISODate)},
                      {QStringLiteral("isTyped"), isTyped},
                      {QStringLiteral("typedCount"), typedCount}};
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
      if (historyItem.value(QStringLiteral("isTyped")).toBool()) {
        site.insert(QStringLiteral("typedCount"), site.value(QStringLiteral("typedCount")).toInt() + 1);
      }
      sites.insert(key, site);
    }
  }
  const QString siteKey = frequentSiteKey(persistentUrl);
  if (!siteKey.isEmpty()) {
    QJsonObject site = sites.value(siteKey);
    site.insert(QStringLiteral("key"), siteKey);
    site.insert(QStringLiteral("url"), frequentSiteRootUrl(persistentUrl).toString(QUrl::FullyEncoded));
    site.insert(QStringLiteral("iconLookupUrl"), normalized);
    site.insert(QStringLiteral("title"), recordTitle);
    site.insert(QStringLiteral("visitCount"), site.value(QStringLiteral("visitCount")).toInt() + 1);
    site.insert(QStringLiteral("lastVisitedAt"), QDateTime::currentDateTimeUtc().toString(Qt::ISODate));
    if (isTyped) {
      site.insert(QStringLiteral("typedCount"), site.value(QStringLiteral("typedCount")).toInt() + 1);
    }
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
  emit historyChanged();
}

bool BrowserProfileService::updateHistoryTitle(const QUrl &url, const QString &title) {
  const QUrl persistentUrl = BrowserSecurity::sanitizeUrlForPersistence(url);
  if (!persistentUrl.isValid() || (persistentUrl.scheme() != QLatin1String("http") && persistentUrl.scheme() != QLatin1String("https"))) return false;

  const QString cleanTitle = title.trimmed().left(180);
  if (cleanTitle.isEmpty() || cleanTitle == QStringLiteral("Yeni Sekme")
      || cleanTitle == persistentUrl.toString()) return false;

  const QString normalized = persistentUrl.adjusted(QUrl::RemoveFragment).toString(QUrl::FullyEncoded);
  bool changed = false;

  // 1. Update title in history/entries in-place (do not modify visitedAt or visit count)
  const QJsonDocument existing = QJsonDocument::fromJson(preferences_.value(QStringLiteral("history/entries")).toByteArray());
  if (existing.isArray()) {
    QJsonArray next;
    for (const QJsonValue &value : existing.array()) {
      QJsonObject item = value.toObject();
      if (item.value(QStringLiteral("url")).toString() == normalized) {
        if (item.value(QStringLiteral("title")).toString() != cleanTitle) {
          item.insert(QStringLiteral("title"), cleanTitle);
          changed = true;
        }
      }
      next.append(item);
    }
    if (changed) {
      preferences_.setValue(QStringLiteral("history/entries"), QJsonDocument(next).toJson(QJsonDocument::Compact));
    }
  }

  // 2. Update title in history/frequentSites in-place (do not modify visitCount or lastVisitedAt)
  const QString siteKey = frequentSiteKey(persistentUrl);
  if (!siteKey.isEmpty()) {
    const QJsonDocument frequentDoc = QJsonDocument::fromJson(preferences_.value(QStringLiteral("history/frequentSites")).toByteArray());
    if (frequentDoc.isArray()) {
      QJsonArray nextFrequent;
      bool frequentUpdated = false;
      for (const QJsonValue &val : frequentDoc.array()) {
        QJsonObject site = val.toObject();
        if (site.value(QStringLiteral("key")).toString() == siteKey) {
          if (site.value(QStringLiteral("title")).toString() != cleanTitle) {
            site.insert(QStringLiteral("title"), cleanTitle);
            frequentUpdated = true;
            changed = true;
          }
        }
        nextFrequent.append(site);
      }
      if (frequentUpdated) {
        preferences_.setValue(QStringLiteral("history/frequentSites"), QJsonDocument(nextFrequent).toJson(QJsonDocument::Compact));
      }
    }
  }

  if (changed) {
    preferences_.sync();
    emit historyChanged();
    return true;
  }
  return false;
}

QList<BrowserHistoryEntry> BrowserProfileService::recentHistory() const {
  QList<BrowserHistoryEntry> entries;
  const QJsonDocument document = QJsonDocument::fromJson(preferences_.value(QStringLiteral("history/entries")).toByteArray());
  if (!document.isArray()) return entries;
  for (const QJsonValue &value : document.array()) {
    const QJsonObject item = value.toObject();
    const QUrl url = BrowserSecurity::sanitizeUrlForPersistence(QUrl(item.value(QStringLiteral("url")).toString()));
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
      const QUrl url = BrowserSecurity::sanitizeUrlForPersistence(QUrl(item.value(QStringLiteral("url")).toString()));
      const QUrl iconLookupUrl = BrowserSecurity::sanitizeUrlForPersistence(QUrl(item.value(QStringLiteral("iconLookupUrl")).toString()));
      const int visitCount = item.value(QStringLiteral("visitCount")).toInt();
      const int typedCount = item.value(QStringLiteral("typedCount")).toInt();
      if (!url.isValid() || visitCount <= 0) continue;
      sites.append({item.value(QStringLiteral("title")).toString(), url,
                    iconLookupUrl.isValid() ? iconLookupUrl : url, visitCount, typedCount,
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
  emit historyChanged();
}

QList<BrowserDownloadEntry> BrowserProfileService::recentDownloads() const {
  QList<BrowserDownloadEntry> result = downloads_;
  if (generalDownloadManager_) {
    for (const GeneralDownloadJob &job : generalDownloadManager_->jobs())
      result.prepend({job.fileName, job.targetPath, GeneralDownloadManager::stateText(job.state)});
  }
  return result;
}

QList<BrowserDownloadEntry> BrowserProfileService::nativeDownloads() const { return downloads_; }

void BrowserProfileService::rememberClosedTab(const QUrl &url, const QString &title) {
  if (!url.isValid()) return;
  closedTabs_.prepend({title.left(180), url, QDateTime::currentDateTimeUtc()});
  while (closedTabs_.size() > 25) closedTabs_.removeLast();
  emit closedTabsChanged();
}

bool BrowserProfileService::hasClosedTabs() const { return !closedTabs_.isEmpty(); }

std::optional<ClosedTabEntry> BrowserProfileService::takeMostRecentClosedTab() {
  if (closedTabs_.isEmpty()) return std::nullopt;
  const auto entry = closedTabs_.takeFirst();
  emit closedTabsChanged();
  return entry;
}

const QList<ClosedTabEntry> &BrowserProfileService::closedTabs() const {
  return closedTabs_;
}

std::optional<ClosedTabEntry> BrowserProfileService::takeClosedTab(int index) {
  if (index < 0 || index >= closedTabs_.size()) return std::nullopt;
  const auto entry = closedTabs_.takeAt(index);
  emit closedTabsChanged();
  return entry;
}

QString BrowserProfileService::searchEngine() const {
  return preferences_.value(QStringLiteral("browser/searchEngine"), QStringLiteral("Google")).toString();
}

void BrowserProfileService::setSearchEngine(const QString &engine) {
  const QString trimmed = engine.trimmed();
  if (trimmed.isEmpty()) return;
  if (searchEngine() == trimmed) return;
  preferences_.setValue(QStringLiteral("browser/searchEngine"), trimmed);
  preferences_.sync();
  emit searchEngineChanged(trimmed);
}


QList<QUrl> BrowserProfileService::bookmarks() const {
  QList<QUrl> result;
  const QStringList stored = preferences_.value(QStringLiteral("bookmarks/urls")).toStringList();
  for (const QString &value : stored) {
    const QUrl url = BrowserSecurity::sanitizeUrlForPersistence(QUrl(value));
    if (url.isValid() && (url.scheme() == QLatin1String("http") || url.scheme() == QLatin1String("https"))) result.append(url);
  }
  return result;
}

bool BrowserProfileService::isBookmarked(const QUrl &url) const {
  const QString normalized = BrowserSecurity::sanitizeUrlForPersistence(url).adjusted(QUrl::RemoveFragment).toString(QUrl::FullyEncoded);
  for (const QUrl &bookmark : bookmarks()) {
    if (bookmark.adjusted(QUrl::RemoveFragment).toString(QUrl::FullyEncoded) == normalized) return true;
  }
  return false;
}

bool BrowserProfileService::toggleBookmark(const QUrl &url) {
  const QUrl persistentUrl = BrowserSecurity::sanitizeUrlForPersistence(url);
  if (!persistentUrl.isValid() || (persistentUrl.scheme() != QLatin1String("http") && persistentUrl.scheme() != QLatin1String("https"))) return false;
  const QString normalized = persistentUrl.adjusted(QUrl::RemoveFragment).toString(QUrl::FullyEncoded);
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

void BrowserProfileService::sanitizeStoredPersistentUrls() {
  const auto isPersistentWebUrl = [](const QUrl &url) {
    return url.isValid() && (url.scheme() == QLatin1String("http") || url.scheme() == QLatin1String("https"));
  };
  bool changed = false;
  QJsonArray history;
  const QJsonDocument historyDocument = QJsonDocument::fromJson(preferences_.value(QStringLiteral("history/entries")).toByteArray());
  if (historyDocument.isArray()) {
    for (const QJsonValue &value : historyDocument.array()) {
      QJsonObject item = value.toObject();
      const QString original = item.value(QStringLiteral("url")).toString();
      const QUrl safe = BrowserSecurity::sanitizeUrlForPersistence(QUrl(original));
      if (!isPersistentWebUrl(safe)) { changed = true; continue; }
      const QString encoded = safe.toString(QUrl::FullyEncoded);
      if (encoded != original) { item.insert(QStringLiteral("url"), encoded); changed = true; }
      history.append(item);
    }
    if (changed) preferences_.setValue(QStringLiteral("history/entries"), QJsonDocument(history).toJson(QJsonDocument::Compact));
  }

  bool frequentChanged = false;
  QJsonArray frequent;
  const QJsonDocument frequentDocument = QJsonDocument::fromJson(preferences_.value(QStringLiteral("history/frequentSites")).toByteArray());
  if (frequentDocument.isArray()) {
    for (const QJsonValue &value : frequentDocument.array()) {
      QJsonObject item = value.toObject();
      for (const QString &field : {QStringLiteral("url"), QStringLiteral("iconLookupUrl")}) {
        const QString original = item.value(field).toString();
        if (original.isEmpty()) continue;
        const QUrl safe = BrowserSecurity::sanitizeUrlForPersistence(QUrl(original));
        if (!isPersistentWebUrl(safe)) { item.remove(field); frequentChanged = true; continue; }
        const QString encoded = safe.toString(QUrl::FullyEncoded);
        if (encoded != original) { item.insert(field, encoded); frequentChanged = true; }
      }
      frequent.append(item);
    }
    if (frequentChanged) preferences_.setValue(QStringLiteral("history/frequentSites"), QJsonDocument(frequent).toJson(QJsonDocument::Compact));
  }

  QStringList safeBookmarks;
  const QStringList bookmarks = preferences_.value(QStringLiteral("bookmarks/urls")).toStringList();
  for (const QString &original : bookmarks) {
    const QUrl safe = BrowserSecurity::sanitizeUrlForPersistence(QUrl(original));
    if (isPersistentWebUrl(safe)) safeBookmarks.append(safe.toString(QUrl::FullyEncoded));
  }
  if (safeBookmarks != bookmarks) { preferences_.setValue(QStringLiteral("bookmarks/urls"), safeBookmarks); changed = true; }
  if (changed || frequentChanged) preferences_.sync();
}

SearchSuggestionService *BrowserProfileService::searchSuggestions() const { return searchSuggestions_; }
void BrowserProfileService::setSearchSuggestionsEnabled(bool enabled) {
  if (profile_->isOffTheRecord()) return;
  QSettings().setValue(QStringLiteral("browser/searchSuggestionsEnabled"), enabled);
  searchSuggestions_->setEnabled(enabled);
  emit searchSuggestionsChanged(enabled);
}

void BrowserProfileService::refreshCookieFilter() {
  if (!profile_ || !blockerService_) return;
  // Qt invokes the filter on its IO thread: capture immutable policy values.
  const auto policies = blockerService_->settings()->sitePolicies();
  const bool protection = blockerService_->settings()->protectionEnabled();
  const QString global = cookiePolicy();
  profile_->cookieStore()->setCookieFilter([policies,protection,global](const QWebEngineCookieStore::FilterRequest &request) {
    QString effective = global;
    if (protection) {
      const auto policy = ArDaliBlockerSettings::findSitePolicy(request.firstPartyUrl.host(), policies);
      if (policy && !policy->whitelisted) effective = policy->cookiePolicy;
    }
    if (effective == QLatin1String("block_all")) return false;
    return effective == QLatin1String("allow_all") || !request.thirdParty;
  });
}
