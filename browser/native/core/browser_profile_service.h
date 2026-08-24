#pragma once

#include <QObject>
#include <QDateTime>
#include <QList>
#include <QSettings>
#include <QUrl>
#include <QWebEnginePermission>

#include <optional>
#include <memory>

class BrowserPolicy;
class QWebEngineDownloadRequest;
class QWebEnginePermission;
class QWebEngineProfile;
class QWebEngineUrlRequestInterceptor;
class NewTabBackgroundStore;
class ArDaliBlockerService;
using AdBlockService = ArDaliBlockerService;
class CredentialVaultManager;

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

  void handleDownload(QWebEngineDownloadRequest *download);
  void handlePermission(const QWebEnginePermission &permission);

  bool stripsTrackingParameters() const;
  void setStripsTrackingParameters(bool enabled);

  QString configuredDownloadDirectory() const;
  void setDownloadDirectory(const QString &directory);
  bool asksDownloadLocation() const;
  void setAsksDownloadLocation(bool enabled);
  void clearHttpCache();
  void clearCookies();

  QList<QWebEnginePermission> sitePermissions() const;
  bool resetSitePermission(const QUrl &origin, QWebEnginePermission::PermissionType type);

  void recordHistory(const QUrl &url, const QString &title);
  QList<BrowserHistoryEntry> recentHistory() const;
  QList<BrowserFrequentSite> frequentSites(int limit = 6) const;
  void clearHistory();

  QList<BrowserDownloadEntry> recentDownloads() const;

  void rememberClosedTab(const QUrl &url, const QString &title);
  bool hasClosedTabs() const;
  std::optional<ClosedTabEntry> takeMostRecentClosedTab();

  QList<QUrl> bookmarks() const;
  bool isBookmarked(const QUrl &url) const;
  bool toggleBookmark(const QUrl &url);

 signals:
  void downloadsChanged();
  void bookmarksChanged();
  void trackingProtectionChanged();

 private:
  QString downloadDirectory() const;

  const BrowserPolicy *policy_ = nullptr;
  QSettings preferences_;
  QWebEngineProfile *profile_ = nullptr;
  ArDaliBlockerService *blockerService_ = nullptr;
  CredentialVaultManager *credentialVault_ = nullptr;
  QWebEngineUrlRequestInterceptor *interceptor_ = nullptr;
  std::unique_ptr<NewTabBackgroundStore> newTabBackgroundStore_;
  QList<BrowserDownloadEntry> downloads_;
  QList<ClosedTabEntry> closedTabs_;
};
