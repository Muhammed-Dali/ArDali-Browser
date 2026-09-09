#pragma once

#include <QObject>
#include <QDateTime>
#include <QList>
#include <QSettings>
#include <QSet>
#include <QUrl>
#include <QNetworkCookie>
#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
#include <QWebEnginePermission>
#endif

#include <optional>
#include <memory>

#include "browser_profile_data_provider.h"

class SearchSuggestionService;
class QNetworkAccessManager;
class BrowserPolicy;
class QWebEngineDownloadRequest;
class QWebEngineProfile;
class QWebEngineUrlRequestInterceptor;
class NewTabBackgroundStore;
class ArDaliBlockerService;
using AdBlockService = ArDaliBlockerService;
class CredentialVaultManager;
class TranslateService;
class GeneralDownloadManager;

struct BrowserDownloadEntry {
  QString fileName;
  QString path;
  QString state;
};

struct ClosedTabEntry {
  QString title;
  QUrl url;
  QDateTime closedAt;
};

// Owns the persistent Chromium profile and the browser-wide policies that are
// independent of an individual tab or window.
class BrowserProfileService final : public QObject, public ardali::core::IBrowserProfileDataProvider {
  Q_OBJECT
 public:
  BrowserProfileService(const QString &dataDirectory, const BrowserPolicy *policy, QObject *parent = nullptr, bool privateMode = false, QNetworkAccessManager *suggestionNetwork = nullptr);
  ~BrowserProfileService() override;

  QWebEngineProfile *profile() const;
  NewTabBackgroundStore *newTabBackgroundStore() const;
  ArDaliBlockerService *blockerService() const;
  ArDaliBlockerService *adBlockService() const { return blockerService(); }
  CredentialVaultManager *credentialVault() const;
  TranslateService *translateService() const;
  QString dataDirectory() const;
  GeneralDownloadManager *downloadManager() const;

  void handleDownload(QWebEngineDownloadRequest *download);
#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
  void handlePermission(const QWebEnginePermission &permission);
  enum class OriginPolicyResult { Allow, Deny, Prompt };
  OriginPolicyResult evaluatePermissionPolicy(const QUrl &origin, QWebEnginePermission::PermissionType type) const;
  static QString permissionKeyFromType(QWebEnginePermission::PermissionType type);
  static QWebEnginePermission::PermissionType permissionTypeFromKey(const QString &key);
  void sanitizeStoredPermissions();
#endif

  static QString canonicalOrigin(const QUrl &url);
  static bool isPermissibleWebOrigin(const QUrl &url);
  static bool isTrustedInternalScheme(const QUrl &url);

  bool stripsTrackingParameters() const;
  void setStripsTrackingParameters(bool enabled);

  // Permission policies
  QString permissionDefaultPolicy(const QString &permissionKey) const;
  void setPermissionDefaultPolicy(const QString &permissionKey, const QString &policy);
  bool autoRevokeUnusedPermissions() const;
  void setAutoRevokeUnusedPermissions(bool enabled);
  void revokeUnusedPermissionsNow();

  // Customized site behaviors / exceptions
  QStringList allowedOrigins(const QString &permissionKey) const;
  QStringList deniedOrigins(const QString &permissionKey) const;
  bool addSitePermissionRule(const QString &permissionKey, const QString &origin, bool allow);
  bool removeSitePermissionRule(const QString &permissionKey, const QString &origin);
  bool hasSitePermissionRule(const QString &permissionKey, const QString &origin) const;

  // Request display mode ("collapsed", "quiet", "expanded")
  QString requestDisplayMode(const QString &permissionKey) const;
  void setRequestDisplayMode(const QString &permissionKey, const QString &mode);

  // Preferred audio input device
  QString preferredAudioInputDevice() const;
  void setPreferredAudioInputDevice(const QString &deviceName);

  // Content settings
  QString cookiePolicy() const;
  void setCookiePolicy(const QString &policy);
  bool isJavascriptEnabled() const;
  void setJavascriptEnabled(bool enabled);
  bool isAutoLoadImagesEnabled() const;
  void setAutoLoadImagesEnabled(bool enabled);
  bool arePopupsAllowed() const;
  void setPopupsAllowed(bool allowed);
  bool isSoundAllowed() const;
  void setSoundAllowed(bool allowed);
  bool openPdfInBrowser() const;
  void setOpenPdfInBrowser(bool enabled);
  bool isProtectedContentEnabled() const;
  void setProtectedContentEnabled(bool enabled);
  QString insecureContentPolicy() const;
  void setInsecureContentPolicy(const QString &policy);
  QString siteDataPolicy() const;
  void setSiteDataPolicy(const QString &policy);
  bool isJsOptimizationEnabled() const;
  void setJsOptimizationEnabled(bool enabled);
  bool isAutoFullscreenAllowed() const;
  void setAutoFullscreenAllowed(bool allowed);

  QString configuredDownloadDirectory() const;
  void setDownloadDirectory(const QString &directory);
  bool asksDownloadLocation() const;
  void setAsksDownloadLocation(bool enabled);
  void clearHttpCache();
  void clearCookies();
  int cookiesCountForHost(const QString &host) const;
  void clearCookiesForHost(const QString &host);

#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
  QList<QWebEnginePermission> sitePermissions() const;
  bool resetSitePermission(const QUrl &origin, QWebEnginePermission::PermissionType type);
#endif

  void recordHistory(const QUrl &url, const QString &title = QString{}, bool isTyped = false);
  bool updateHistoryTitle(const QUrl &url, const QString &title);
  QList<BrowserHistoryEntry> recentHistory() const override;
  QList<BrowserFrequentSite> frequentSites(int limit = 6) const override;
  void clearHistory();

  QList<BrowserDownloadEntry> recentDownloads() const;
  QList<BrowserDownloadEntry> nativeDownloads() const;

  void rememberClosedTab(const QUrl &url, const QString &title);
  bool hasClosedTabs() const;
  std::optional<ClosedTabEntry> takeMostRecentClosedTab();
  const QList<ClosedTabEntry> &closedTabs() const;
  std::optional<ClosedTabEntry> takeClosedTab(int index);

  SearchSuggestionService *searchSuggestions() const;
  void setSearchSuggestionsEnabled(bool enabled);
  QString searchEngine() const override;
  void setSearchEngine(const QString &engine);

  QList<QUrl> bookmarks() const override;
  bool isBookmarked(const QUrl &url) const;
  bool toggleBookmark(const QUrl &url);

 signals:
  void downloadsChanged();
  void bookmarksChanged();
  void historyChanged();
  void trackingProtectionChanged();
  void contentSettingsChanged();
  void permissionsPolicyChanged();
  void searchSuggestionsChanged(bool enabled);
  void searchEngineChanged(const QString &engine);
  void closedTabsChanged();

 private:
  QString downloadDirectory() const;
  void sanitizeStoredPersistentUrls();
  void refreshCookieFilter();

  const BrowserPolicy *policy_ = nullptr;
  QString dataDirectory_;
  QSettings preferences_;
  QWebEngineProfile *profile_ = nullptr;
  ArDaliBlockerService *blockerService_ = nullptr;
  CredentialVaultManager *credentialVault_ = nullptr;
  TranslateService *translateService_ = nullptr;
  GeneralDownloadManager *generalDownloadManager_ = nullptr;
  SearchSuggestionService *searchSuggestions_ = nullptr;
  QWebEngineUrlRequestInterceptor *interceptor_ = nullptr;
  std::unique_ptr<NewTabBackgroundStore> newTabBackgroundStore_;
  QList<BrowserDownloadEntry> downloads_;
  QList<ClosedTabEntry> closedTabs_;
  QSet<QString> forgetHosts_;
  QList<QNetworkCookie> cookies_;
};
