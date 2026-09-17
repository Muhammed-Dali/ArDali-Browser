#include "cosmetic_runtime.h"
#include "ardali_blocker_service.h"

#include <QDate>
#include <QElapsedTimer>
#include <QFile>
#include <QFileInfo>
#include <QHostAddress>
#include <QJsonDocument>
#include <QJsonParseError>
#include <QMutexLocker>
#include <QSettings>
#include <QUrlQuery>
#include <QtConcurrent>
#include <algorithm>
#include <chrono>

ArDaliBlockerService::ArDaliBlockerService(const QString &dataDir, QObject *parent)
    : QObject(parent), dataDir_(dataDir) {
  settings_ = new ArDaliBlockerSettings(dataDir + QStringLiteral("/adblock-settings.ini"), this);
  QFile::setPermissions(dataDir + QStringLiteral("/adblock-settings.ini"), QFileDevice::ReadOwner | QFileDevice::WriteOwner);
  filterEngine_ = new ArDaliBlockerEngine();
  listManager_ = new ArDaliBlockerListManager(dataDir, this);
  interceptor_ = new ArDaliBlockerRequestInterceptor(this, this);

  statsPersistTimer_.setSingleShot(true);
  statsPersistTimer_.setInterval(5000);
  connect(&statsPersistTimer_, &QTimer::timeout, this, &ArDaliBlockerService::persistStats);
  loadPersistentStats();

  auto onRulesModified = [this]() {
    reloadRules();
    if (settings_->autoReloadOnModeChange()) {
      emit autoReloadRequested();
    }
  };

  connect(settings_, &ArDaliBlockerSettings::filteringPlanChanged, this, onRulesModified);
  // These are the only persisted settings that alter the compiled plan.  Do
  // not rebuild the entire ruleset for toolbar/developer/strict toggles, and
  // do not also listen to the umbrella settingsChanged signal: that caused
  // every mode/custom-list edit to parse and sort the rules twice on the GUI
  // thread.
  connect(settings_, &ArDaliBlockerSettings::sitePoliciesChanged, this, [this]() {
    if (settings_->autoReloadOnModeChange()) emit autoReloadRequested();
  });
  reloadRules();
}

ArDaliBlockerService::~ArDaliBlockerService() {
  // The worker captures listManager_.  Finish it before QObject child
  // destruction so closing the browser during a refresh cannot dereference a
  // deleted manager. This wait is only on shutdown, never in the UI workflow.
  if (filterUpdateWatcher_ && !filterUpdateWatcher_->isFinished())
    filterUpdateWatcher_->waitForFinished();
  persistStats();
}

ArDaliBlockerSettings *ArDaliBlockerService::settings() const { return settings_; }
ArDaliBlockerEngine *ArDaliBlockerService::filterEngine() const { return filterEngine_; }
ArDaliBlockerListManager *ArDaliBlockerService::listManager() const { return listManager_; }
ArDaliBlockerRequestInterceptor *ArDaliBlockerService::requestInterceptor() const { return interceptor_; }
SitePolicy ArDaliBlockerService::sitePolicy(const QString &host) const {
  return settings_ ? settings_->sitePolicy(host) : SitePolicy{};
}

QStringList ArDaliBlockerService::activeRulesetIds() const {
  return listManager_->resolveRulesetIds(settings_->mode(), settings_->enabledRulesetIds(),
                                         settings_->rulesetSelectionConfigured());
}

void ArDaliBlockerService::reloadRules() {
  ++planGeneration_;
  const ArDaliBlockerMode mode = settings_->mode();
  const QStringList enabledIds = activeRulesetIds();
  const QStringList customLines = settings_->customFilters();

  const bool selectionConfigured = true;
  QList<FilterRule> rules = listManager_->loadRulesForModeAndSelection(
      mode, enabledIds, selectionConfigured, settings_->strictBlock());
  const QString listCosmeticCss = listManager_->loadCosmeticCssForSelection(enabledIds, selectionConfigured);

  filterEngine_->applyCompiledPlan(ArDaliBlockerEngine::compilePlan(
      std::move(rules), listCosmeticCss, customLines));
  if (qEnvironmentVariableIntValue("ARDALI_FEATURE_DIAGNOSTICS") == 1) {
    qInfo().noquote() << "[BLOCKER] filters loaded";
  }
}

void ArDaliBlockerService::updateFiltersAsync() {
  if (filterUpdateInProgress_) return;
  filterUpdateInProgress_ = true;
  const quint64 generation = ++planGeneration_;
  const ArDaliBlockerMode mode = settings_->mode();
  const QStringList enabledIds = activeRulesetIds();
  constexpr bool selectionConfigured = true;
  const bool strictBlock = settings_->strictBlock();
  const QStringList customLines = settings_->customFilters();
  listManager_->invalidateCaches();
  emit filterUpdateStarted();
  emit filterUpdateProgress(0, 3, QStringLiteral("prepare"));

  auto progress = [this, generation](int completed, const QString &stage) {
    QMetaObject::invokeMethod(this, [this, generation, completed, stage]() {
      if (filterUpdateInProgress_ && generation == planGeneration_)
        emit filterUpdateProgress(completed, 3, stage);
    }, Qt::QueuedConnection);
  };
  auto future = QtConcurrent::run([this, mode, enabledIds, strictBlock, customLines, progress]() {
    const QString baseDir = listManager_->rulesetDir();
    if (baseDir.isEmpty() || !QFileInfo::exists(baseDir + QStringLiteral("/ruleset-details.json"))) {
      return FilterUpdateResult{false, QStringLiteral("Bundled filtre paketi bulunamadı."), {}};
    }
    auto validJsonArray = [](const QString &path) {
      QFile file(path);
      if (!file.open(QIODevice::ReadOnly)) return false;
      QJsonParseError error;
      const QJsonDocument document = QJsonDocument::fromJson(file.readAll(), &error);
      return error.error == QJsonParseError::NoError && document.isArray();
    };
    for (const QString &id : enabledIds) {
      const QString mainPath = baseDir + QStringLiteral("/main/") + id + QStringLiteral(".json");
      if (!validJsonArray(mainPath)) {
        return FilterUpdateResult{false,
            QStringLiteral("Filtre paketi doğrulanamadı: %1").arg(id), {}};
      }
      const QString regexPath = baseDir + QStringLiteral("/regex/") + id + QStringLiteral(".json");
      if (QFileInfo::exists(regexPath) && !validJsonArray(regexPath)) {
        return FilterUpdateResult{false,
            QStringLiteral("Regex paketi doğrulanamadı: %1").arg(id), {}};
      }
    }
    QList<FilterRule> rules = listManager_->loadRulesForModeAndSelection(
        mode, enabledIds, selectionConfigured, strictBlock);
    progress(1, QStringLiteral("parse"));
    const QString css = listManager_->loadCosmeticCssForSelection(enabledIds, selectionConfigured);
    progress(2, QStringLiteral("cosmetic"));
    return FilterUpdateResult{true, QStringLiteral("Yerel filtreler doğrulandı ve yeniden derlendi."),
        ArDaliBlockerEngine::compilePlan(std::move(rules), css, customLines)};
  });

  auto *watcher = new QFutureWatcher<FilterUpdateResult>(this);
  filterUpdateWatcher_ = watcher;
  connect(watcher, &QFutureWatcher<FilterUpdateResult>::finished, this, [this, watcher, generation]() {
    const bool current = generation == planGeneration_;
    FilterUpdateResult result = watcher->result();
    if (current && result.success) filterEngine_->applyCompiledPlan(std::move(result.plan));
    watcher->deleteLater();
    if (filterUpdateWatcher_ == watcher) filterUpdateWatcher_ = nullptr;
    filterUpdateInProgress_ = false;
    if (!current) {
      emit filterUpdateFinished(false, QStringLiteral("Ayarlar değişti; eski güncelleme sonucu kullanılmadı."));
      return;
    }
    if (!result.success) {
      emit filterUpdateFinished(false, result.message);
      return;
    }
    emit filterUpdateProgress(3, 3, QStringLiteral("swap"));
    emit filterUpdateFinished(true, result.message);
    if (settings_->autoReloadOnModeChange()) emit autoReloadRequested();
  });
  watcher->setFuture(future);
}

bool ArDaliBlockerService::isUpdatingFilters() const { return filterUpdateInProgress_; }

// ---------------- Tab Context Registry ----------------

void ArDaliBlockerService::registerTab(quint64 tabId, const QUrl &url) {
  if (tabId == 0) return;
  QMutexLocker locker(&tabRegistryMutex_);
  TabRequestContext ctx;
  ctx.tabId = tabId;
  ctx.currentUrl = url;
  ctx.currentHost = url.host().toLower();
  emit siteOpened(ArDaliBlockerSettings::normalizeSiteHost(ctx.currentHost));
  ctx.lastActiveTimestamp = QDateTime::currentMSecsSinceEpoch();
  tabRegistry_[tabId] = ctx;
  if (activeTabId_ == 0) activeTabId_ = tabId;
}

void ArDaliBlockerService::unregisterTab(quint64 tabId) {
  if (tabId == 0) return;
  QString closedHost;
  {
    QMutexLocker locker(&tabRegistryMutex_);
    closedHost = ArDaliBlockerSettings::normalizeSiteHost(tabRegistry_.value(tabId).currentHost);
    tabRegistry_.remove(tabId);
    for (const auto &context : std::as_const(tabRegistry_)) {
      if (ArDaliBlockerSettings::normalizeSiteHost(context.currentHost) == closedHost) { closedHost.clear(); break; }
    }
    if (activeTabId_ == tabId) {
      activeTabId_ = tabRegistry_.isEmpty() ? 0 : tabRegistry_.keys().first();
    }
  }
  clearTabStats(tabId);
  if (!closedHost.isEmpty()) emit siteClosed(closedHost);
}

void ArDaliBlockerService::updateTabUrl(quint64 tabId, const QUrl &url) {
  if (tabId == 0) return;
  QMutexLocker locker(&tabRegistryMutex_);
  if (!tabRegistry_.contains(tabId)) {
    TabRequestContext ctx;
    ctx.tabId = tabId;
    ctx.currentUrl = url;
    ctx.currentHost = url.host().toLower();
    ctx.lastActiveTimestamp = QDateTime::currentMSecsSinceEpoch();
    tabRegistry_[tabId] = ctx;
    return;
  }
  TabRequestContext &ctx = tabRegistry_[tabId];
  const QString newHost = url.host().toLower();
  emit siteOpened(ArDaliBlockerSettings::normalizeSiteHost(newHost));
  const QString scheme = url.scheme().toLower();
  const bool wentInternal = (scheme == QLatin1String("ardali") ||
                             scheme == QLatin1String("about") ||
                             scheme == QLatin1String("data") ||
                             scheme == QLatin1String("file"));
  const QString oldNorm = ArDaliBlockerSettings::normalizeSiteHost(ctx.currentHost);
  const QString newNorm = ArDaliBlockerSettings::normalizeSiteHost(newHost);
  const bool hostChanged = (!oldNorm.isEmpty() && !newNorm.isEmpty() && oldNorm != newNorm);

  ctx.currentUrl = url;
  ctx.currentHost = newHost;
  ctx.lastActiveTimestamp = QDateTime::currentMSecsSinceEpoch();

  if (hostChanged || wentInternal) {
    locker.unlock();
    clearTabStats(tabId);
  }
}

void ArDaliBlockerService::setActiveTabId(quint64 tabId) {
  QMutexLocker locker(&tabRegistryMutex_);
  activeTabId_ = tabId;
  if (tabRegistry_.contains(tabId)) {
    tabRegistry_[tabId].lastActiveTimestamp = QDateTime::currentMSecsSinceEpoch();
  }
}

quint64 ArDaliBlockerService::activeTabId() const {
  QMutexLocker locker(&tabRegistryMutex_);
  return activeTabId_;
}

quint64 ArDaliBlockerService::resolveTabId(const QUrl &firstPartyUrl, const QUrl &requestUrl) const {
  QMutexLocker locker(&tabRegistryMutex_);
  if (tabRegistry_.isEmpty()) return 0;
  if (tabRegistry_.size() == 1) return tabRegistry_.keys().first();

  const QString firstPartyHost = firstPartyUrl.host().toLower();
  const QString requestHost = requestUrl.host().toLower();

  // 1. Exact match on full firstPartyUrl
  if (firstPartyUrl.isValid() && !firstPartyUrl.isEmpty()) {
    for (auto it = tabRegistry_.constBegin(); it != tabRegistry_.constEnd(); ++it) {
      if (it.value().currentUrl == firstPartyUrl) {
        return it.key();
      }
    }
  }

  // 2. Match on firstParty host with most recent activity (normalized and subdomain matching)
  if (!firstPartyHost.isEmpty()) {
    const QString firstPartyNorm = ArDaliBlockerSettings::normalizeSiteHost(firstPartyHost);
    quint64 bestTab = 0;
    qint64 latestTs = -1;
    for (auto it = tabRegistry_.constBegin(); it != tabRegistry_.constEnd(); ++it) {
      const QString tabNorm = ArDaliBlockerSettings::normalizeSiteHost(it.value().currentHost);
      if (it.value().currentHost == firstPartyHost || tabNorm == firstPartyNorm ||
          (!firstPartyNorm.isEmpty() && !tabNorm.isEmpty() &&
           (firstPartyNorm.endsWith(QLatin1String(".") + tabNorm) ||
            tabNorm.endsWith(QLatin1String(".") + firstPartyNorm)))) {
        if (it.value().lastActiveTimestamp > latestTs) {
          latestTs = it.value().lastActiveTimestamp;
          bestTab = it.key();
        }
      }
    }
    if (bestTab != 0) return bestTab;
  }

  // 3. Match on requestHost for main frame navigations or direct requests
  if (!requestHost.isEmpty()) {
    const QString requestNorm = ArDaliBlockerSettings::normalizeSiteHost(requestHost);
    for (auto it = tabRegistry_.constBegin(); it != tabRegistry_.constEnd(); ++it) {
      const QString tabNorm = ArDaliBlockerSettings::normalizeSiteHost(it.value().currentHost);
      if (it.value().currentHost == requestHost ||
          (!requestNorm.isEmpty() && tabNorm == requestNorm)) {
        return it.key();
      }
    }
  }

  // 4. Fallback to active tab
  return activeTabId_ != 0 ? activeTabId_ : tabRegistry_.keys().first();
}

// ---------------- Strict Bypass ----------------

void ArDaliBlockerService::allowTemporaryStrictBypass(const QString &host, int durationMinutes) {
  QString clean = host.trimmed().toLower();
  if (clean.startsWith(QStringLiteral("www."))) clean.remove(0, 4);
  if (clean.isEmpty()) return;
  QMutexLocker locker(&bypassMutex_);
  strictBypassMap_[clean] = QDateTime::currentMSecsSinceEpoch() + (durationMinutes * 60 * 1000);
}

bool ArDaliBlockerService::isStrictBypassActive(const QString &host) const {
  QString clean = host.trimmed().toLower();
  if (clean.startsWith(QStringLiteral("www."))) clean.remove(0, 4);
  if (clean.isEmpty()) return false;
  QMutexLocker locker(&bypassMutex_);
  const qint64 exp = strictBypassMap_.value(clean, 0);
  return exp > QDateTime::currentMSecsSinceEpoch();
}

// ---------------- Request Evaluation ----------------

RequestDecision ArDaliBlockerService::evaluateRequest(const QUrl &requestUrl, int resourceTypeInt,
                                                const QUrl &firstPartyUrl, quint64 tabId,
                                                const QString &requestMethod) {
  const auto start = std::chrono::high_resolution_clock::now();

  const quint64 resolvedTab = (tabId > 0) ? tabId : resolveTabId(firstPartyUrl, requestUrl);
  const ArDaliBlockerResourceType resType = resourceTypeFromWebEngine(resourceTypeInt);
  const QString initiatorHost = firstPartyUrl.host().toLower();
  const QString siteHost = requestUrl.host().toLower();
  SitePolicy policy = settings_->sitePolicy(initiatorHost.isEmpty() ? siteHost : initiatorHost);
  if (!policy.whitelisted && !siteHost.isEmpty()) {
    const SitePolicy siteSelfPolicy = settings_->sitePolicy(siteHost);
    if (siteSelfPolicy.whitelisted) policy = siteSelfPolicy;
  }

  const QString firstScheme = firstPartyUrl.scheme().toLower();
  const QString reqScheme = requestUrl.scheme().toLower();
  if (firstScheme == QLatin1String("ardali") || firstScheme == QLatin1String("about") ||
      firstScheme == QLatin1String("data") || firstScheme == QLatin1String("file") ||
      reqScheme == QLatin1String("ardali") || reqScheme == QLatin1String("about") ||
      reqScheme == QLatin1String("data") || reqScheme == QLatin1String("file") ||
      reqScheme == QLatin1String("qrc")) {
    return RequestDecision{ArDaliBlockerAction::Allow, QStringLiteral("internal-scheme"),
                           0, QStringLiteral("ardali-internal"), QString()};
  }

  RequestDecision decision;
  bool isLocal = false;
  const QString reqHost = requestUrl.host().toLower();
  if (reqHost.isEmpty() || reqHost == QLatin1String("localhost") || reqHost.endsWith(QLatin1String(".local")) ||
      reqHost.endsWith(QLatin1String(".test")) || reqHost.endsWith(QLatin1String(".invalid")) ||
      reqHost.endsWith(QLatin1String(".onion"))) {
    isLocal = true;
  } else {
    const QHostAddress addr(reqHost);
    if (!addr.isNull() || reqHost.contains(QLatin1Char(':'))) {
      isLocal = true;
    }
  }

  if (!settings_->protectionEnabled()) {
    decision = RequestDecision{ArDaliBlockerAction::Allow, QStringLiteral("global-protection-disabled"),
                               0, QStringLiteral("ardali-global"), QString()};
  } else if (!policy.whitelisted && policy.upgradeHttps && reqScheme == QLatin1String("http") && !isLocal && !requestUrl.isLocalFile()) {
    QUrl upgraded = requestUrl;
    upgraded.setScheme(QStringLiteral("https"));
    decision = RequestDecision{ArDaliBlockerAction::Redirect, QStringLiteral("https-upgrade-by-policy"),
                               0, QStringLiteral("ardali-https-upgrade"), upgraded.toString()};
  } else if (!policy.whitelisted && policy.blockScripts && resType == ArDaliBlockerResourceType::Script) {
    decision = RequestDecision{ArDaliBlockerAction::Block, QStringLiteral("scripts-blocked-by-policy"),
                               0, QStringLiteral("ardali-script-block"), QString()};
  } else {
    const ArDaliBlockerMode activeMode = (policy.perSiteMode >= 0) ?
        static_cast<ArDaliBlockerMode>(policy.perSiteMode) : settings_->mode();
    decision = filterEngine_->evaluate(
        requestUrl, resType, initiatorHost, activeMode, policy, requestMethod);
  }

  // Strict blocking redirection logic for dangerous/strict-block matches
  if (decision.action == ArDaliBlockerAction::Block && resType == ArDaliBlockerResourceType::MainFrame) {
    const bool compiledStrict = decision.rulesetId.startsWith(QStringLiteral("strictblock-"));
    const bool strictMatch = compiledStrict || (settings_->strictBlock() &&
        (decision.rulesetId.contains(QStringLiteral("malware"), Qt::CaseInsensitive) ||
         decision.rulesetId.contains(QStringLiteral("strict"), Qt::CaseInsensitive)));
    if (strictMatch) {
      if (isStrictBypassActive(siteHost)) {
        // A bypass must permit the navigation. Returning Block here made the
        // warning page's "continue" action loop into a cancelled request.
        decision = RequestDecision{ArDaliBlockerAction::Allow, QStringLiteral("strict-temporary-bypass"),
                                   decision.ruleId, decision.rulesetId, QString()};
      } else {
        decision.action = ArDaliBlockerAction::Redirect;
        decision.redirectUrl = QStringLiteral("ardali://newtab?strictblock=1&domain=%1&url=%2")
                                   .arg(QUrl::toPercentEncoding(siteHost), QUrl::toPercentEncoding(requestUrl.toString()));
      }
    }
  }

  // Update real evaluation timer metrics
  const auto end = std::chrono::high_resolution_clock::now();
  const double elapsedMs = std::chrono::duration<double, std::milli>(end - start).count();
  {
    QMutexLocker locker(&timingMutex_);
    evaluationCount_++;
    totalEvaluationTimeMs_ += elapsedMs;
    lastEvaluationTimeMs_ = elapsedMs;
    maxEvaluationTimeMs_ = std::max(maxEvaluationTimeMs_, elapsedMs);
  }

  // Update tab and global statistics
  if (decision.action == ArDaliBlockerAction::Block) {
    const bool isTracker = decision.rulesetId.contains(QStringLiteral("privacy"), Qt::CaseInsensitive) ||
                           decision.rulesetId.contains(QStringLiteral("tracker"), Qt::CaseInsensitive);
    reportBlockedEvent(resolvedTab, isTracker ? ArDaliBlockType::Tracker : ArDaliBlockType::NetworkAd, 1,
                       decision.rulesetId.isEmpty() ? QStringLiteral("default") : decision.rulesetId);
  } else {
    bool statsChanged = false;
    bool persistNeeded = false;
    TabBlockerStats changedStats;
    quint64 changedSessionBlocked = 0;
    quint64 changedTotalBlocked = 0;
    {
      QMutexLocker locker(&statsMutex_);
      TabBlockerStats &tStats = tabStats_[resolvedTab];
      if (decision.action == ArDaliBlockerAction::Redirect) {
        tStats.redirectedRequests++;
        totalRedirected_++;
        recordRulesetMatch(decision.rulesetId.isEmpty() ? QStringLiteral("default") : decision.rulesetId);
        statsChanged = true;
        changedStats = tStats;
        changedSessionBlocked = sessionBlocked_;
        changedTotalBlocked = totalBlocked_;
        persistNeeded = true;
      } else {
        tStats.allowedRequests++;
        totalAllowed_++;
        if (decision.reason == QLatin1String("site-whitelisted")) {
          whitelistAllowed_++;
          persistNeeded = true;
        }
      }
      if (persistNeeded) statsDirty_ = true;
    }
    if (persistNeeded) scheduleStatsPersistence();
    if (statsChanged) {
      emit tabStatsChanged(resolvedTab, changedStats);
      emit globalStatsChanged(changedSessionBlocked, changedTotalBlocked);
    }
  }

  // Log to ring buffer
  NetworkLogEntry entry;
  entry.timestamp = QDateTime::currentDateTime();
  entry.tabId = resolvedTab;
  entry.siteHost = siteHost.isEmpty() ? initiatorHost : siteHost;
  entry.requestHost = siteHost;
  entry.initiatorHost = initiatorHost;
  entry.topLevelSite = firstPartyUrl.host().toLower();
  entry.requestMethod = requestMethod.trimmed().toUpper();
  entry.resourceTypeStr = resourceTypeToString(resType);
  entry.requestUrl = requestUrl.adjusted(QUrl::RemoveUserInfo | QUrl::RemoveQuery | QUrl::RemoveFragment).toString();
  entry.action = decision.action;
  entry.reason = decision.reason;
  entry.rulesetId = decision.rulesetId;
  entry.ruleId = decision.ruleId;
  logEntry(entry);

  return decision;
}

double ArDaliBlockerService::averageEvaluationTimeMs() const {
  QMutexLocker locker(&timingMutex_);
  if (evaluationCount_ == 0) return 0.0;
  return totalEvaluationTimeMs_ / evaluationCount_;
}

double ArDaliBlockerService::lastEvaluationTimeMs() const {
  QMutexLocker locker(&timingMutex_);
  return lastEvaluationTimeMs_;
}

double ArDaliBlockerService::maxEvaluationTimeMs() const {
  QMutexLocker locker(&timingMutex_);
  return maxEvaluationTimeMs_;
}

quint64 ArDaliBlockerService::evaluationCount() const {
  QMutexLocker locker(&timingMutex_);
  return evaluationCount_;
}

quint64 ArDaliBlockerService::estimatedMemoryBytes() const {
  // Calculated estimated memory of adblock data structures
  quint64 bytes = 0;
  bytes += sizeof(ArDaliBlockerService) + sizeof(ArDaliBlockerEngine) + sizeof(ArDaliBlockerListManager);
  bytes += filterEngine_->ruleCount() * 128ULL; // Approx bytes per FilterRule + parsed strings
  bytes += filterEngine_->customRuleCount() * 96ULL;
  bytes += logsRingBuffer_.size() * 256ULL; // NetworkLogEntry and URL strings
  bytes += tabStats_.size() * sizeof(TabBlockerStats);
  bytes += blockedByHost_.size() * 48ULL;
  bytes += matchedByRuleset_.size() * 48ULL;
  return bytes;
}

void ArDaliBlockerService::recordHostBlock(const QString &host) {
  if (host.isEmpty()) return;
  blockedByHost_[host]++;
}

void ArDaliBlockerService::recordRulesetMatch(const QString &rulesetId) {
  if (rulesetId.isEmpty()) return;
  matchedByRuleset_[rulesetId]++;
}

void ArDaliBlockerService::loadPersistentStats() {
  QSettings persisted(dataDir_ + QStringLiteral("/adblock-statistics.ini"), QSettings::IniFormat);
  QMutexLocker locker(&statsMutex_);
  totalBlocked_ = persisted.value(QStringLiteral("statistics/totalBlocked"), 0).toULongLong();
  totalAllowed_ = persisted.value(QStringLiteral("statistics/totalAllowed"), 0).toULongLong();
  totalRedirected_ = persisted.value(QStringLiteral("statistics/totalRedirected"), 0).toULongLong();
  totalTrackersBlocked_ = persisted.value(QStringLiteral("statistics/trackersBlocked"), 0).toULongLong();
  whitelistAllowed_ = persisted.value(QStringLiteral("statistics/whitelistAllowed"), 0).toULongLong();
  const int size = persisted.beginReadArray(QStringLiteral("daily"));
  for (int index = 0; index < size; ++index) {
    persisted.setArrayIndex(index);
    const QString day = persisted.value(QStringLiteral("date")).toString();
    const quint64 count = persisted.value(QStringLiteral("count"), 0).toULongLong();
    if (QDate::fromString(day, Qt::ISODate).isValid() && count > 0) dailyBlocked_.insert(day, count);
  }
  persisted.endArray();
  while (dailyBlocked_.size() > 120) dailyBlocked_.erase(dailyBlocked_.begin());
}

void ArDaliBlockerService::scheduleStatsPersistence() {
  QMetaObject::invokeMethod(this, [this]() {
    if (!statsPersistTimer_.isActive()) statsPersistTimer_.start();
  }, Qt::QueuedConnection);
}

void ArDaliBlockerService::persistStats() {
  quint64 blocked = 0;
  quint64 allowed = 0;
  quint64 redirected = 0;
  quint64 trackers = 0;
  quint64 whitelist = 0;
  QMap<QString, quint64> daily;
  {
    QMutexLocker locker(&statsMutex_);
    blocked = totalBlocked_;
    allowed = totalAllowed_;
    redirected = totalRedirected_;
    trackers = totalTrackersBlocked_;
    whitelist = whitelistAllowed_;
    daily = dailyBlocked_;
    statsDirty_ = false;
  }
  QSettings persisted(dataDir_ + QStringLiteral("/adblock-statistics.ini"), QSettings::IniFormat);
  persisted.setValue(QStringLiteral("statistics/totalBlocked"), blocked);
  persisted.setValue(QStringLiteral("statistics/totalAllowed"), allowed);
  persisted.setValue(QStringLiteral("statistics/totalRedirected"), redirected);
  persisted.setValue(QStringLiteral("statistics/trackersBlocked"), trackers);
  persisted.setValue(QStringLiteral("statistics/whitelistAllowed"), whitelist);
  persisted.remove(QStringLiteral("daily"));
  persisted.beginWriteArray(QStringLiteral("daily"), daily.size());
  int index = 0;
  for (auto it = daily.cbegin(); it != daily.cend(); ++it, ++index) {
    persisted.setArrayIndex(index);
    persisted.setValue(QStringLiteral("date"), it.key());
    persisted.setValue(QStringLiteral("count"), it.value());
  }
  persisted.endArray();
  persisted.sync();
  QFile::setPermissions(dataDir_ + QStringLiteral("/adblock-statistics.ini"), QFileDevice::ReadOwner | QFileDevice::WriteOwner);
  if (persisted.status() != QSettings::NoError) statsDirty_ = true;
}

void ArDaliBlockerService::reportBlockedEvent(quint64 tabId, ArDaliBlockType type, quint64 count,
                                             const QString &ruleOrUrl) {
  if (count == 0 || !settings_->protectionEnabled()) return;

  QString tabHost;
  {
    QMutexLocker locker(&tabRegistryMutex_);
    if (tabId != 0 && tabRegistry_.contains(tabId)) {
      tabHost = tabRegistry_.value(tabId).currentHost;
    } else if (activeTabId_ != 0 && tabRegistry_.contains(activeTabId_)) {
      tabHost = tabRegistry_.value(activeTabId_).currentHost;
      tabId = activeTabId_;
    }
  }

  const QString normHost = ArDaliBlockerSettings::normalizeSiteHost(tabHost);
  if (!normHost.isEmpty()) {
    const SitePolicy policy = settings_->sitePolicy(normHost);
    if (policy.whitelisted) return;
    if (policy.temporaryDisabledUntil > QDateTime::currentMSecsSinceEpoch()) return;
    if ((type == ArDaliBlockType::NetworkAd || type == ArDaliBlockType::Cosmetic) && !policy.adBlocking) return;
    if (type == ArDaliBlockType::Tracker && !policy.trackerProtection) return;
  }

  bool statsChanged = false;
  TabBlockerStats changedStats;
  quint64 changedSessionBlocked = 0;
  quint64 changedTotalBlocked = 0;

  {
    QMutexLocker locker(&statsMutex_);
    TabBlockerStats &tStats = tabStats_[tabId];
    const QString todayKey = QDate::currentDate().toString(Qt::ISODate);

    switch (type) {
      case ArDaliBlockType::NetworkAd:
        tStats.blockedRequests += count;
        tStats.blockedAds += count;
        break;
      case ArDaliBlockType::Tracker:
        tStats.blockedRequests += count;
        tStats.blockedTrackers += count;
        totalTrackersBlocked_ += count;
        break;
      case ArDaliBlockType::Cosmetic:
        tStats.blockedCosmetics += count;
        tStats.blockedAds += count;
        break;
      case ArDaliBlockType::Scriptlet:
        tStats.blockedScriptlets += count;
        tStats.blockedAds += count;
        break;
    }

    sessionBlocked_ += count;
    totalBlocked_ += count;
    dailyBlocked_[todayKey] += count;

    if (!normHost.isEmpty()) {
      for (quint64 i = 0; i < count; ++i) recordHostBlock(normHost);
    }
    if (!ruleOrUrl.isEmpty()) {
      for (quint64 i = 0; i < count; ++i) recordRulesetMatch(ruleOrUrl);
    }

    statsChanged = true;
    changedStats = tStats;
    changedSessionBlocked = sessionBlocked_;
    changedTotalBlocked = totalBlocked_;
    statsDirty_ = true;
  }

  scheduleStatsPersistence();

  if (statsChanged) {
    emit tabStatsChanged(tabId, changedStats);
    emit globalStatsChanged(changedSessionBlocked, changedTotalBlocked);
  }
}

TabBlockerStats ArDaliBlockerService::statsForTab(quint64 tabId) const {
  QMutexLocker locker(&statsMutex_);
  return tabStats_.value(tabId, TabBlockerStats{});
}

void ArDaliBlockerService::clearTabStats(quint64 tabId) {
  {
    QMutexLocker locker(&statsMutex_);
    tabStats_.remove(tabId);
  }
  emit tabStatsChanged(tabId, TabBlockerStats{});
}

void ArDaliBlockerService::resetAllStats() {
  {
    QMutexLocker locker(&statsMutex_);
    tabStats_.clear();
    sessionBlocked_ = 0;
    totalBlocked_ = 0;
    totalAllowed_ = 0;
    totalRedirected_ = 0;
    totalTrackersBlocked_ = 0;
    whitelistAllowed_ = 0;
    blockedByHost_.clear();
    matchedByRuleset_.clear();
    dailyBlocked_.clear();
    statsDirty_ = true;
  }
  persistStats();
  {
    QMutexLocker locker(&timingMutex_);
    evaluationCount_ = 0;
    totalEvaluationTimeMs_ = 0.0;
    lastEvaluationTimeMs_ = 0.0;
    maxEvaluationTimeMs_ = 0.0;
  }
  emit globalStatsChanged(0, 0);
}

quint64 ArDaliBlockerService::sessionBlockedCount() const {
  QMutexLocker locker(&statsMutex_);
  return sessionBlocked_;
}

quint64 ArDaliBlockerService::totalBlockedCount() const {
  QMutexLocker locker(&statsMutex_);
  return totalBlocked_;
}

quint64 ArDaliBlockerService::totalAllowedCount() const {
  QMutexLocker locker(&statsMutex_);
  return totalAllowed_;
}

quint64 ArDaliBlockerService::totalRedirectedCount() const {
  QMutexLocker locker(&statsMutex_);
  return totalRedirected_;
}

quint64 ArDaliBlockerService::totalTrackersBlockedCount() const {
  QMutexLocker locker(&statsMutex_);
  return totalTrackersBlocked_;
}

quint64 ArDaliBlockerService::whitelistAllowedCount() const {
  QMutexLocker locker(&statsMutex_);
  return whitelistAllowed_;
}

quint64 ArDaliBlockerService::estimatedBytesSaved() const {
  QMutexLocker locker(&statsMutex_);
  // Heuristic estimation: ~35 KB per blocked ad/tracker request
  return totalBlocked_ * 35840ULL;
}

quint64 ArDaliBlockerService::todayBlockedCount() const {
  QMutexLocker locker(&statsMutex_);
  const QString todayKey = QDate::currentDate().toString(Qt::ISODate);
  return dailyBlocked_.value(todayKey, 0);
}

quint64 ArDaliBlockerService::weekBlockedCount() const {
  QMutexLocker locker(&statsMutex_);
  const QDate today = QDate::currentDate();
  quint64 sum = 0;
  for (int i = 0; i < 7; ++i) {
    sum += dailyBlocked_.value(today.addDays(-i).toString(Qt::ISODate), 0);
  }
  return sum;
}

quint64 ArDaliBlockerService::monthBlockedCount() const {
  QMutexLocker locker(&statsMutex_);
  const QDate today = QDate::currentDate();
  quint64 sum = 0;
  for (int i = 0; i < 30; ++i) {
    sum += dailyBlocked_.value(today.addDays(-i).toString(Qt::ISODate), 0);
  }
  return sum;
}

QList<QPair<QString, quint64>> ArDaliBlockerService::topBlockedHosts(int limit) const {
  QMutexLocker locker(&statsMutex_);
  QList<QPair<QString, quint64>> list;
  for (auto it = blockedByHost_.constBegin(); it != blockedByHost_.constEnd(); ++it) {
    list.append(qMakePair(it.key(), it.value()));
  }
  std::sort(list.begin(), list.end(), [](const auto &a, const auto &b) {
    return a.second > b.second;
  });
  if (limit > 0 && list.size() > limit) list = list.mid(0, limit);
  return list;
}

QList<QPair<QString, quint64>> ArDaliBlockerService::topMatchedRulesets(int limit) const {
  QMutexLocker locker(&statsMutex_);
  QList<QPair<QString, quint64>> list;
  for (auto it = matchedByRuleset_.constBegin(); it != matchedByRuleset_.constEnd(); ++it) {
    list.append(qMakePair(it.key(), it.value()));
  }
  std::sort(list.begin(), list.end(), [](const auto &a, const auto &b) {
    return a.second > b.second;
  });
  if (limit > 0 && list.size() > limit) list = list.mid(0, limit);
  return list;
}

QString ArDaliBlockerService::cosmeticCssForHost(const QString &host) const {
  if (!settings_->protectionEnabled()) return {};
  QString css = filterEngine_->cosmeticCssForHost(host);
  if (listManager_) {
    const QString specificCss = listManager_->loadSpecificCosmeticCssForHost(
        host, activeRulesetIds(), true);
    if (!specificCss.isEmpty()) css += (css.isEmpty() ? QString() : QStringLiteral("\n")) + specificCss;
  }
  return filterEngine_->applyCosmeticExceptions(host, css);
}

QWebEngineScript ArDaliBlockerService::createCosmeticScriptForHost(const QString &host) const {
  QWebEngineScript script;
  script.setName(QStringLiteral("ardali-adblock-cosmetic"));
  script.setInjectionPoint(QWebEngineScript::DocumentCreation);
  script.setWorldId(QWebEngineScript::MainWorld);
  script.setRunsOnSubFrames(false);

  if (!settings_->protectionEnabled()) return script;

  const QString lowerHost = host.trimmed().toLower();
  const SitePolicy policy = settings_->sitePolicy(lowerHost);
  // Network allowlisting in the old webview preload also suppresses cosmetic
  // and scriptlet injection. Keeping this check at script construction makes
  // the Qt layer obey the same all-layer whitelist contract.
  if (policy.whitelisted || !policy.adBlocking ||
      policy.temporaryDisabledUntil > QDateTime::currentMSecsSinceEpoch()) {
    return script;
  }
  const QString css = cosmeticCssForHost(host);

  // CSS automatically re-evaluates recycled nodes, including attribute/text
  // replacement; no sticky per-node hidden flag or destructive inline style.
  QString combined = css;
  const QString json = QString::fromUtf8(QJsonDocument(QJsonArray{combined}).toJson(QJsonDocument::Compact));
  script.setWorldId(QWebEngineScript::ApplicationWorld);
  const QString expectedHost = QString::fromUtf8(QJsonDocument(QJsonArray{lowerHost}).toJson(QJsonDocument::Compact));
  script.setSourceCode(QStringLiteral("(()=>{const start=()=>{const h=location.hostname.toLowerCase();const exp=%1[0];if(h===exp||h.replace(/^www\\./,'')===exp.replace(/^www\\./,'')||h.endsWith('.'+exp.replace(/^www\\./,''))){\n").arg(expectedHost) +
      QString::fromUtf8(kArDaliCosmeticRuntime).arg(json + QStringLiteral("[0]")) +
      QStringLiteral("\n}};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});start();})();"));

  return script;
}

QList<QWebEngineScript> ArDaliBlockerService::createScriptingScriptsForHost(const QString &host) const {
  QList<QWebEngineScript> scripts;
  if (!settings_->protectionEnabled()) return scripts;
  const QWebEngineScript cosmetic = createCosmeticScriptForHost(host);
  if (!cosmetic.sourceCode().isEmpty()) scripts.append(cosmetic);

  const SitePolicy policy = settings_->sitePolicy(host);
  if (!policy.whitelisted && policy.temporaryDisabledUntil <= QDateTime::currentMSecsSinceEpoch()) {
    if (policy.blockFingerprinting) {
      QWebEngineScript privacy;
      privacy.setName(QStringLiteral("ardali-fingerprint-protection"));
      privacy.setInjectionPoint(QWebEngineScript::DocumentCreation);
      privacy.setWorldId(QWebEngineScript::MainWorld);
      privacy.setRunsOnSubFrames(true);
      privacy.setSourceCode(QStringLiteral(R"JS((()=>{
        const deny=()=>{throw new DOMException('Canvas readback blocked by site privacy policy','SecurityError')};
        for(const [prototype,names] of [[HTMLCanvasElement.prototype,['toDataURL','toBlob']],[CanvasRenderingContext2D.prototype,['getImageData']]]){
          for(const name of names)try{Object.defineProperty(prototype,name,{value:deny,writable:false,configurable:false})}catch(_){}
        }
        for(const prototype of [window.WebGLRenderingContext?.prototype,window.WebGL2RenderingContext?.prototype]){
          if(!prototype)continue;const original=prototype.getParameter;
          try{Object.defineProperty(prototype,'getParameter',{value:function(p){if(p===37445||p===37446)return 'ArDali';return original.call(this,p)},writable:false,configurable:false})}catch(_){}
        }
      })())JS"));
      scripts.append(privacy);
    }

  }
  if (policy.whitelisted || !policy.adBlocking ||
      policy.temporaryDisabledUntil > QDateTime::currentMSecsSinceEpoch()) {
    return scripts;
  }

  for (const auto &asset : listManager_->loadScriptingSourcesForHost(
      host, activeRulesetIds(), true)) {
    QWebEngineScript script;
    const bool mainWorld = asset.first == QLatin1String("main");
    script.setName(mainWorld ? QStringLiteral("ardali-adblock-scriptlets-main")
                             : QStringLiteral("ardali-adblock-scriptlets-isolated"));
    script.setInjectionPoint(QWebEngineScript::DocumentCreation);
    script.setWorldId(mainWorld ? QWebEngineScript::MainWorld : QWebEngineScript::ApplicationWorld);
    script.setRunsOnSubFrames(false);
    script.setSourceCode(asset.second);
    scripts.append(script);
  }

  QJsonArray proceduralRules = listManager_->loadProceduralRulesForHost(host, activeRulesetIds(), true);
  const QJsonArray customProcedural = filterEngine_->customProceduralRulesForHost(host);
  for (const QJsonValue &rule : customProcedural) proceduralRules.append(rule);
  if (!proceduralRules.isEmpty()) {
    const QString json = QString::fromUtf8(QJsonDocument(proceduralRules).toJson(QJsonDocument::Compact));
    QWebEngineScript procedural;
    procedural.setName(QStringLiteral("ardali-adblock-procedural"));
    procedural.setInjectionPoint(QWebEngineScript::DocumentCreation);
    procedural.setWorldId(QWebEngineScript::ApplicationWorld);
    procedural.setRunsOnSubFrames(false);
    // This is the procedural subset used by the legacy webview preload:
    // selector/tasks/action plus re-evaluation on SPA DOM mutation. Unknown
    // task names fail closed (do not hide content), never as broad selectors.
    procedural.setSourceCode(QStringLiteral(R"JS(
(function(){
 const runtime=window.__ardaliCosmeticRuntime;
 if(!runtime||window.__ardaliProceduralRules)return;window.__ardaliProceduralRules=1;
 const rules=%1;
 const rx=v=>{const s=String(v||'');const m=/^\/([\s\S]*)\/([a-z]*)$/i.exec(s);if(s.length>512||(m&&/[(){}]/.test(m[1])))return /$a/;try{return m?new RegExp(m[1],m[2]):new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i')}catch(_){return /^$/}};
 const query=(root,sel)=>{try{if(!sel)return root&&root.nodeType===1?[root]:[];if(sel==='*')return [];const list=Array.from((root||document).querySelectorAll(sel)).slice(0,512);if(root?.nodeType===1&&root.matches(sel))list.unshift(root);return list}catch(_){return[]}};
 const relative=(node,sel)=>{try{if(/^[>+~]/.test(sel))return Array.from(node.parentElement.querySelectorAll(':scope '+sel));return query(node,sel)}catch(_){return[]}};
 const filter=(nodes,tasks)=>{let out=nodes.filter(Boolean);for(const task of(tasks||[])){const n=String(task[0]||''),a=task[1],next=[];for(const node of out){try{
  if(n==='has-text'){if(rx(a).test(String(node.textContent||'').slice(0,8192)))next.push(node)}
  else if(n==='matches-path'){if(rx(a).test(location.pathname+location.search))next.push(node)}
  else if(n==='matches-media'){if(matchMedia(String(a||'')).matches)next.push(node)}
  else if(n==='matches-css'||n==='matches-css-before'||n==='matches-css-after'){const pseudo=n.endsWith('before')?'::before':n.endsWith('after')?'::after':null;const st=getComputedStyle(node,pseudo);if(rx(a&&a.value).test(st.getPropertyValue(a&&a.name)))next.push(node)}
  else if(n==='matches-attr'){const nr=rx(a&&a.attr),vr=rx(a&&a.value);if(Array.from(node.attributes||[]).some(x=>nr.test(x.name)&&vr.test(x.value)))next.push(node)}
  else if(n==='matches-prop'){try{let v=node;for(const p of String(a&&a.attr||'').split('.'))v=v==null?undefined:v[p];if(rx(a&&a.value).test(String(v??'')))next.push(node)}catch(_){}}
  else if(n==='min-text-length'){if(String(node.textContent||'').slice(0,8192).length>=Number(a||0))next.push(node)}
  else if(n==='has'||n==='if'){const o=a&&typeof a==='object'?a:{selector:String(a||'*'),tasks:[]};if(filter(relative(node,o.selector||'*'),o.tasks).length)next.push(node)}
  else if(n==='not'||n==='if-not'){const o=a&&typeof a==='object'?a:{selector:String(a||''),tasks:[]};if(!filter(o.selector?relative(node,o.selector):[node],o.tasks).length)next.push(node)}
  else if(n==='upward'){let x=node;if(typeof a==='number'){for(let i=0;i<a&&x;i++)x=x.parentElement}else x=node.closest(String(a||''));if(x)next.push(x)}
  else if(n==='spath'){const s=String(a||'');if(!s)next.push(node);else if(s.startsWith(':')){if(node.matches(s))next.push(node)}else next.push(...relative(node,s))}
  else if(n==='xpath'){try{const it=document.evaluate(String(a||''),node,null,XPathResult.ORDERED_NODE_ITERATOR_TYPE,null);let x;while((x=it.iterateNext()))if(x.nodeType===1)next.push(x)}catch(_){}}
  else if(n==='shadow'){next.push(...query(node.shadowRoot,String(a||'*')))}
  else if(n==='others'){if(node.parentElement)next.push(...Array.from(node.parentElement.children).filter(x=>x!==node))}
  else if(n==='watch-attr')next.push(node)
 }catch(_){}}out=[...new Set(next)];if(!out.length)break}return out};
  const apply=(node,rule)=>{try{
   if(runtime.hiddenNodes&&!runtime.hiddenNodes.has(node)){
    runtime.hiddenNodes.add(node);
    if(runtime.reportBlock)runtime.reportBlock(1,'procedural');
   }
   const a=Array.isArray(rule.action)?rule.action:['style','display:none!important;'];
   if(a[0]==='remove')node.remove();
   else if(a[0]==='remove-attr')node.removeAttribute(String(a[1]||''));
   else if(a[0]==='remove-class')node.classList.remove(...String(a[1]||'').split(/\s+/));
   else if(a[0]==='style')node.style.cssText=String(a[1]||'display:none!important;');
   else node.style.setProperty('display','none','important');
  }catch(_){}};
 let cursor=0;
 runtime.callbacks.push((roots)=>{
  const deadline=performance.now()+12;let count=0;
  while(count<rules.length){
   const r=rules[cursor];cursor=(cursor+1)%rules.length;count++;
   const candidates=new Set();
   for(const root of roots){for(const node of query(root===document?document:(root?.parentElement||root),r.selector||''))candidates.add(node);if(candidates.size>=512)break;}
   for(const n of filter(Array.from(candidates).slice(0,512),r.tasks).slice(0,512))apply(n,r);
   // Resume at the next rule on a later DOM event, never a timer loop.
   if(performance.now()>deadline)break;
  }
 });
 runtime.schedule(document);
})();
)JS").arg(json));
    scripts.append(procedural);
  }
  return scripts;
}

void ArDaliBlockerService::logEntry(const NetworkLogEntry &entry) {
  {
    QMutexLocker locker(&logMutex_);
    logsRingBuffer_.prepend(entry);
    if (logsRingBuffer_.size() > kMaxRingBufferLogs) logsRingBuffer_.removeLast();
  }
  emit requestLogged(entry);
}

QList<NetworkLogEntry> ArDaliBlockerService::recentLogs(int maxCount) const {
  QMutexLocker locker(&logMutex_);
  if (maxCount <= 0 || maxCount >= logsRingBuffer_.size()) return logsRingBuffer_;
  return logsRingBuffer_.mid(0, maxCount);
}

bool ArDaliBlockerService::shouldForgetClosedHost(const QString &host) const {
  const QString key = ArDaliBlockerSettings::normalizeSiteHost(host);
  const auto policy = settings_->sitePolicy(key);
  if (key.isEmpty() || !settings_->protectionEnabled() || policy.whitelisted || !policy.forgetOnClose) return false;
  QMutexLocker locker(&tabRegistryMutex_);
  for (const auto &context : tabRegistry_)
    if (ArDaliBlockerSettings::normalizeSiteHost(context.currentHost) == key) return false;
  return true;
}
