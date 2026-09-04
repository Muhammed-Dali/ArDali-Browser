#pragma once

#include <QDateTime>
#include <QHash>
#include <QList>
#include <QMap>
#include <QMutex>
#include <QObject>
#include <QPair>
#include <QSet>
#include <QTimer>
#include <QUrl>
#include <QWebEngineScript>
#include <QFutureWatcher>

#include "ardali_blocker_engine.h"
#include "ardali_blocker_list_manager.h"
#include "ardali_blocker_request_interceptor.h"
#include "ardali_blocker_settings.h"
#include "ardali_blocker_types.h"

struct TabRequestContext {
  quint64 tabId = 0;
  QUrl currentUrl;
  QString currentHost;
  qint64 lastActiveTimestamp = 0;
};

struct FilterUpdateResult {
  bool success = false;
  QString message;
  CompiledBlockerPlan plan;
};

class ArDaliBlockerService final : public QObject {
  Q_OBJECT
 public:
  explicit ArDaliBlockerService(const QString &dataDir, QObject *parent = nullptr);
  ~ArDaliBlockerService() override;

  ArDaliBlockerSettings *settings() const;
  ArDaliBlockerEngine *filterEngine() const;
  ArDaliBlockerListManager *listManager() const;
  ArDaliBlockerRequestInterceptor *requestInterceptor() const;

  // Tab Context Registry (Thread-safe tab resolution from IO interceptor)
  void registerTab(quint64 tabId, const QUrl &url = QUrl());
  void unregisterTab(quint64 tabId);
  void updateTabUrl(quint64 tabId, const QUrl &url);
  void setActiveTabId(quint64 tabId);
  quint64 activeTabId() const;
  quint64 resolveTabId(const QUrl &firstPartyUrl, const QUrl &requestUrl) const;

  // Interceptor entry point (Thread-safe)
  RequestDecision evaluateRequest(const QUrl &requestUrl, int resourceTypeInt,
                                  const QUrl &firstPartyUrl, quint64 tabId,
                                  const QString &requestMethod = QStringLiteral("get"));

  // Tab stats management
  TabBlockerStats statsForTab(quint64 tabId) const;
  void clearTabStats(quint64 tabId);
  void resetAllStats();

  // Session & Global stats
  quint64 sessionBlockedCount() const;
  quint64 totalBlockedCount() const;
  quint64 totalTrackersBlockedCount() const;
  quint64 whitelistAllowedCount() const;
  quint64 estimatedBytesSaved() const;
  quint64 todayBlockedCount() const;
  quint64 weekBlockedCount() const;
  quint64 monthBlockedCount() const;
  quint64 totalAllowedCount() const;
  quint64 totalRedirectedCount() const;

  QList<QPair<QString, quint64>> topBlockedHosts(int limit = 10) const;
  QList<QPair<QString, quint64>> topMatchedRulesets(int limit = 10) const;

  // Ring buffer Network Logs
  QList<NetworkLogEntry> recentLogs(int maxCount = 100) const;

  // Real Diagnostic Performance & Memory Metrics
  double averageEvaluationTimeMs() const;
  double lastEvaluationTimeMs() const;
  double maxEvaluationTimeMs() const;
  quint64 evaluationCount() const;
  quint64 estimatedMemoryBytes() const;

  // Strict Blocking Temporary Bypass
  void allowTemporaryStrictBypass(const QString &host, int durationMinutes = 15);
  bool isStrictBypassActive(const QString &host) const;

  // Cosmetic stylesheet & Early Injection Script
  QString cosmeticCssForHost(const QString &host) const;
  QWebEngineScript createCosmeticScriptForHost(const QString &host) const;
  QList<QWebEngineScript> createScriptingScriptsForHost(const QString &host) const;

  // Re-build engine ruleset when settings or lists change
  void reloadRules();
  void updateFiltersAsync();
  bool isUpdatingFilters() const;

 signals:
  void tabStatsChanged(quint64 tabId, const TabBlockerStats &stats);
  void globalStatsChanged(quint64 sessionBlocked, quint64 totalBlocked);
  void requestLogged(const NetworkLogEntry &entry);
  void autoReloadRequested();
  void filterUpdateStarted();
  void filterUpdateProgress(int completed, int total, const QString &stage);
  void filterUpdateFinished(bool success, const QString &message);

 private:
  QStringList activeRulesetIds() const;
  void logEntry(const NetworkLogEntry &entry);
  void recordHostBlock(const QString &host);
  void recordRulesetMatch(const QString &rulesetId);
  void loadPersistentStats();
  void scheduleStatsPersistence();
  void persistStats();

  QString dataDir_;
  ArDaliBlockerSettings *settings_ = nullptr;
  ArDaliBlockerEngine *filterEngine_ = nullptr;
  ArDaliBlockerListManager *listManager_ = nullptr;
  ArDaliBlockerRequestInterceptor *interceptor_ = nullptr;

  mutable QMutex tabRegistryMutex_;
  QHash<quint64, TabRequestContext> tabRegistry_;
  quint64 activeTabId_ = 0;

  mutable QMutex statsMutex_;
  QHash<quint64, TabBlockerStats> tabStats_;
  quint64 sessionBlocked_ = 0;
  quint64 totalBlocked_ = 0;
  quint64 totalAllowed_ = 0;
  quint64 totalRedirected_ = 0;
  quint64 totalTrackersBlocked_ = 0;
  quint64 whitelistAllowed_ = 0;
  QHash<QString, quint64> blockedByHost_;
  QHash<QString, quint64> matchedByRuleset_;
  QMap<QString, quint64> dailyBlocked_;
  QTimer statsPersistTimer_;
  bool statsDirty_ = false;

  // Diagnostics timing metrics
  mutable QMutex timingMutex_;
  quint64 evaluationCount_ = 0;
  double totalEvaluationTimeMs_ = 0.0;
  double lastEvaluationTimeMs_ = 0.0;
  double maxEvaluationTimeMs_ = 0.0;

  // Strict block bypass map (host -> expiry msecs)
  mutable QMutex bypassMutex_;
  QHash<QString, qint64> strictBypassMap_;

  static constexpr int kMaxRingBufferLogs = 1000;
  mutable QMutex logMutex_;
  QList<NetworkLogEntry> logsRingBuffer_;
  QFutureWatcher<FilterUpdateResult> *filterUpdateWatcher_ = nullptr;
  quint64 planGeneration_ = 0;
  bool filterUpdateInProgress_ = false;
};

using AdBlockService = ArDaliBlockerService;
