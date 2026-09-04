#pragma once

#include <QObject>
#include <QDateTime>
#include <QList>
#include <QSettings>
#include <QUrl>
#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
#include <QWebEnginePermission>
#endif

#include <optional>
#include <memory>

class BrowserPolicy;
class QWebEngineDownloadRequest;
class QWebEngineProfile;
class QWebEngineUrlRequestInterceptor;
class NewTabBackgroundStore;
class ArDaliBlockerService;
using AdBlockService = ArDaliBlockerService;
class CredentialVaultManager;
class TranslateService;

struct BrowserHistoryEntry {
  QString title;
  QUrl url;
  QDateTime visitedAt;
};

struct BrowserFrequentSite {
  QString title;
  QUrl url;
  QUrl iconLookupUrl;
  int visitCount = 0;
  QDateTime lastVisitedAt;
};

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
class BrowserProfileService final : public QObject {
  Q_OBJECT
 public:
  BrowserProfileService(const QString &dataDirectory, const BrowserPolicy *policy, QObject *parent = nullptr);
  ~BrowserProfileService() override;

  QWebEngineProfile *profile() const;
  NewTabBackgroundStore *newTabBackgroundStore() const;
  ArDaliBlockerService *blockerService() const;
  ArDaliBlockerService *adBlockService() const { return blockerService(); }
  CredentialVaultManager *credentialVault() const;
  TranslateService *translateService() const;
  QString dataDirectory() const;

  void handleDownload(QWebEngineDownloadRequest *download);
#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
  void handlePermission(const QWebEnginePermission &permission);
#endif

  bool stripsTrackingParameters() const;
  void setStripsTrackingParameters(bool enabled);

  QString configuredDownloadDirectory() const;
  void setDownloadDirectory(const QString &directory);
  bool asksDownloadLocation() const;
  void setAsksDownloadLocation(bool enabled);
  void clearHttpCache();
  void clearCookies();

#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
  QList<QWebEnginePermission> sitePermissions() const;
  bool resetSitePermission(const QUrl &origin, QWebEnginePermission::PermissionType type);
#endif

  void recordHistory(const QUrl &url, const QString &title);
  QList<BrowserHistoryEntry> recentHistory() const;
  QList<BrowserFrequentSite> frequentSites(int limit = 6) const;
  void clearHistory();

  QList<BrowserDownloadEntry> recentDownloads() const;

  void rememberClosedTab(const QUrl &url, const QString &title);
  bool hasClosedTabs() const;
  std::optional<ClosedTabEntry> takeMostRecentClosedTab();
  const QList<ClosedTabEntry> &closedTabs() const;
  std::optional<ClosedTabEntry> takeClosedTab(int index);

  QString searchEngine() const;
  void setSearchEngine(const QString &engine);

  QList<QUrl> bookmarks() const;
  bool isBookmarked(const QUrl &url) const;
  bool toggleBookmark(const QUrl &url);

 signals:
  void downloadsChanged();
  void bookmarksChanged();
  void trackingProtectionChanged();
  void searchEngineChanged(const QString &engine);
  void closedTabsChanged();

 private:
  QString downloadDirectory() const;
  void sanitizeStoredPersistentUrls();

  const BrowserPolicy *policy_ = nullptr;
  QString dataDirectory_;
  QSettings preferences_;
  QWebEngineProfile *profile_ = nullptr;
  ArDaliBlockerService *blockerService_ = nullptr;
  CredentialVaultManager *credentialVault_ = nullptr;
  TranslateService *translateService_ = nullptr;
  QWebEngineUrlRequestInterceptor *interceptor_ = nullptr;
  std::unique_ptr<NewTabBackgroundStore> newTabBackgroundStore_;
  QList<BrowserDownloadEntry> downloads_;
  QList<ClosedTabEntry> closedTabs_;
};
