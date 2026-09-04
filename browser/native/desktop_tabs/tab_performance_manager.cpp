#include "tab_performance_manager.h"

#include <QSettings>
#include <QWebEnginePage>
#include <QWidget>
#include <algorithm>
#include <chrono>

namespace ardali {

TabPerformanceManager::TabPerformanceManager(TabManager *tabManager, QObject *parent)
    : QObject(parent),
      tabManager_(tabManager),
      memoryMonitor_(std::make_unique<SystemMemoryPressureMonitor>(nullptr)) {
  deadlineTimer_ = new QTimer(this);
  deadlineTimer_->setSingleShot(true);
  connect(deadlineTimer_, &QTimer::timeout, this, &TabPerformanceManager::onDeadlineTimeout);

  if (memoryMonitor_) {
    connect(memoryMonitor_.get(), &SystemMemoryPressureMonitor::pressureLevelChanged,
            this, [this](MemoryPressureLevel) {
              onDeadlineTimeout();
            });
  }

  if (tabManager_) {
    connect(tabManager_, &TabManager::tabRegistered, this, &TabPerformanceManager::onTabRegistered);
    connect(tabManager_, &TabManager::tabActivated, this, &TabPerformanceManager::onTabActivated);
    connect(tabManager_, &TabManager::tabTransferred, this, &TabPerformanceManager::onTabTransferred);
    connect(tabManager_, &TabManager::tabRemoved, this, &TabPerformanceManager::onTabRemoved);
    connect(tabManager_, &TabManager::tabUrlChanged, this, &TabPerformanceManager::onTabUrlChanged);
  }

  loadPersistedSettings();
}

TabPerformanceManager::~TabPerformanceManager() {
  isTearingDown_ = true;
  if (deadlineTimer_) {
    deadlineTimer_->stop();
  }
}

void TabPerformanceManager::loadPersistedSettings() {
  QSettings settings;
  const QString modeStr = settings.value(QStringLiteral("performance/policyMode"), QStringLiteral("balanced")).toString().toLower();
  if (modeStr == QLatin1String("memory_saver")) {
    setPolicyMode(PerformancePolicyMode::MemorySaver);
  } else if (modeStr == QLatin1String("maximum_performance")) {
    setPolicyMode(PerformancePolicyMode::MaximumPerformance);
  } else {
    setPolicyMode(PerformancePolicyMode::Balanced);
  }

  const bool discardEnabled = settings.value(QStringLiteral("performance/discardEnabled"), true).toBool();
  setDiscardEnabled(discardEnabled);

  const QStringList allowlist = settings.value(QStringLiteral("performance/siteAllowlist")).toStringList();
  if (!allowlist.isEmpty()) {
    setSiteAllowlist(allowlist);
  }
}

int64_t TabPerformanceManager::currentMonotonicMs() {
  return std::chrono::duration_cast<std::chrono::milliseconds>(
      std::chrono::steady_clock::now().time_since_epoch()).count();
}

int64_t TabPerformanceManager::backgroundFreezeDelayMs() const {
  return backgroundFreezeDelayMs_;
}

void TabPerformanceManager::setBackgroundFreezeDelayMs(int64_t delayMs) {
  backgroundFreezeDelayMs_ = std::max<int64_t>(0, delayMs);
  scheduleNextDeadlineCheck();
}

int64_t TabPerformanceManager::backgroundDiscardDelayMs() const {
  return backgroundDiscardDelayMs_;
}

void TabPerformanceManager::setBackgroundDiscardDelayMs(int64_t delayMs) {
  backgroundDiscardDelayMs_ = std::max<int64_t>(0, delayMs);
  scheduleNextDeadlineCheck();
}

DiscardPolicyRequirement TabPerformanceManager::discardPolicyRequirement() const {
  return discardRequirement_;
}

void TabPerformanceManager::setDiscardPolicyRequirement(DiscardPolicyRequirement req) {
  discardRequirement_ = req;
  scheduleNextDeadlineCheck();
}

PerformancePolicyMode TabPerformanceManager::policyMode() const {
  return policyMode_;
}

void TabPerformanceManager::setPolicyMode(PerformancePolicyMode mode) {
  policyMode_ = mode;
  QSettings settings;
  switch (mode) {
    case PerformancePolicyMode::Balanced:
      backgroundFreezeDelayMs_ = kDefaultBackgroundFreezeDelayMs;
      backgroundDiscardDelayMs_ = kDefaultBackgroundDiscardDelayMs;
      discardRequirement_ = DiscardPolicyRequirement::IdleOnly;
      settings.setValue(QStringLiteral("performance/policyMode"), QStringLiteral("balanced"));
      break;
    case PerformancePolicyMode::MemorySaver:
      backgroundFreezeDelayMs_ = 0;
      backgroundDiscardDelayMs_ = 30 * 1000;
      discardRequirement_ = DiscardPolicyRequirement::IdleOnly;
      settings.setValue(QStringLiteral("performance/policyMode"), QStringLiteral("memory_saver"));
      break;
    case PerformancePolicyMode::MaximumPerformance:
      backgroundFreezeDelayMs_ = 0;
      backgroundDiscardDelayMs_ = 2 * kDefaultBackgroundDiscardDelayMs;
      discardRequirement_ = DiscardPolicyRequirement::IdleOnly;
      settings.setValue(QStringLiteral("performance/policyMode"), QStringLiteral("maximum_performance"));
      break;
  }
  emit policyModeChanged(mode);
  scheduleNextDeadlineCheck();
}

bool TabPerformanceManager::isDiscardEnabled() const {
  return discardEnabled_;
}

void TabPerformanceManager::setDiscardEnabled(bool enabled) {
  if (discardEnabled_ != enabled) {
    discardEnabled_ = enabled;
    QSettings().setValue(QStringLiteral("performance/discardEnabled"), enabled);
    emit discardEnabledChanged(enabled);
    scheduleNextDeadlineCheck();
  }
}

SystemMemoryPressureMonitor *TabPerformanceManager::memoryPressureMonitor() const {
  return memoryMonitor_.get();
}

bool TabPerformanceManager::hasMetadata(TabManager::TabId id) const {
  return metadataMap_.contains(id);
}

TabPerformanceMetadata TabPerformanceManager::metadata(TabManager::TabId id) const {
  auto it = metadataMap_.constFind(id);
  if (it != metadataMap_.cend()) {
    return it.value();
  }

  // If queried for an internal tab or untracked tab, return a safe internal representation
  TabPerformanceMetadata fallback;
  fallback.tabId = id;
  if (tabManager_) {
    const TabManager::TabRecord *record = tabManager_->record(id);
    if (record) {
      fallback.tabKind = record->kind;
      fallback.visible = record->active;
      fallback.activationSerial = record->activationSerial;
    }
  }
  if (fallback.tabKind == TabManager::TabKind::Internal) {
    fallback.protectedReasons = ProtectedReason::Visible;
  }
  return fallback;
}

bool TabPerformanceManager::isTabProtected(TabManager::TabId id) const {
  const TabManager::TabRecord *record = tabManager_ ? tabManager_->record(id) : nullptr;
  if (record && record->kind == TabManager::TabKind::Internal) {
    return true; // Native internal tabs are inherently protected from web lifecycle actions
  }

  auto it = metadataMap_.constFind(id);
  if (it == metadataMap_.cend()) {
    return false;
  }
  return it->protectedReasons != ProtectedReason::None;
}

ProtectedReasons TabPerformanceManager::protectedReasons(TabManager::TabId id) const {
  const TabManager::TabRecord *record = tabManager_ ? tabManager_->record(id) : nullptr;
  if (record && record->kind == TabManager::TabKind::Internal) {
    return ProtectedReason::Visible;
  }

  auto it = metadataMap_.constFind(id);
  if (it == metadataMap_.cend()) {
    return ProtectedReason::None;
  }
  return it->protectedReasons;
}

QList<TabManager::TabId> TabPerformanceManager::trackedWebTabs() const {
  return metadataMap_.keys();
}

bool TabPerformanceManager::isAggressiveStatePermitted(
    TabManager::TabId id, QWebEnginePage::LifecycleState targetState) const {
  auto it = metadataMap_.constFind(id);
  if (it == metadataMap_.cend() || it->tabKind != TabManager::TabKind::Web) {
    return false;
  }

  if (isTabProtected(id) && targetState != QWebEnginePage::LifecycleState::Active) {
    return false;
  }

  const auto recState = it->recommendedState;
  switch (recState) {
    case QWebEnginePage::LifecycleState::Active:
      return targetState == QWebEnginePage::LifecycleState::Active;
    case QWebEnginePage::LifecycleState::Frozen:
      return targetState == QWebEnginePage::LifecycleState::Active ||
             targetState == QWebEnginePage::LifecycleState::Frozen;
    case QWebEnginePage::LifecycleState::Discarded:
      return true;
    default:
      return targetState == QWebEnginePage::LifecycleState::Active;
  }
}

bool TabPerformanceManager::canFreeze(TabManager::TabId id) const {
  if (isTearingDown_) return false;

  auto it = metadataMap_.constFind(id);
  if (it == metadataMap_.cend() || it->tabKind != TabManager::TabKind::Web) {
    return false;
  }

  // 1. Must not be visible/active
  if (it->visible) {
    return false;
  }

  // 2. Must not be producing audio
  if (it->recentlyAudible) {
    return false;
  }

  // 3. Must not have any active protected reasons
  if (isTabProtected(id)) {
    return false;
  }

  // 4. Must be idle for at least backgroundFreezeDelayMs_
  const int64_t now = currentMonotonicMs();
  if (it->elapsedSinceLastVisibleMs(now) < backgroundFreezeDelayMs_) {
    return false;
  }

  // 5. Must satisfy Qt recommendedState boundary (Active is forbidden; Frozen/Discarded permitted)
  if (!isAggressiveStatePermitted(id, QWebEnginePage::LifecycleState::Frozen)) {
    return false;
  }

  // 6. Page/view must still be valid
  if (!tabManager_) return false;
  const TabManager::TabRecord *record = tabManager_->record(id);
  if (!isLifecycleEligible(record) || record->page->isLoading()) {
    return false;
  }

  // 7. Must currently be in Active lifecycle state (not already Frozen or Discarded)
  if (it->lifecycleState != QWebEnginePage::LifecycleState::Active) {
    return false;
  }

  return true;
}

bool TabPerformanceManager::freezeTab(TabManager::TabId id) {
  if (!canFreeze(id)) {
    return false;
  }

  const TabManager::TabRecord *record = tabManager_->record(id);
  if (!record || !record->page) {
    return false;
  }

  auto it = metadataMap_.find(id);
  if (it == metadataMap_.end()) {
    return false;
  }

  const int64_t now = currentMonotonicMs();

  // Apply Frozen lifecycle to the underlying Qt WebEnginePage
  record->page->setLifecycleState(QWebEnginePage::LifecycleState::Frozen);

  it->lifecycleState = QWebEnginePage::LifecycleState::Frozen;
  it->frozenByArDali = true;
  it->lastFreezeMonotonicMs = now;
  it->freezeCount++;

  emit tabFrozen(id);
  emit tabLifecycleStateChanged(id, QWebEnginePage::LifecycleState::Frozen);
  emit tabMetadataChanged(id, it.value());

  scheduleNextDeadlineCheck();
  return true;
}

bool TabPerformanceManager::canDiscard(TabManager::TabId id) const {
  if (isTearingDown_ || !discardEnabled_) return false;

  auto it = metadataMap_.constFind(id);
  if (it == metadataMap_.cend() || it->tabKind != TabManager::TabKind::Web) {
    return false;
  }

  // 1. Must not be visible/active in any window
  if (it->visible) {
    return false;
  }

  // 2. Must not be producing audio
  if (it->recentlyAudible) {
    return false;
  }

  // 3. Must not have any active protected reasons (no dirty forms, allowlist, media, etc.)
  if (isTabProtected(id)) {
    return false;
  }

  // 4. Form dirty latch check
  if (isTabFormDirty(id)) {
    return false;
  }

  // 5. Must satisfy Qt recommendedState boundary (Discarded must be permitted by Qt)
  if (!isAggressiveStatePermitted(id, QWebEnginePage::LifecycleState::Discarded)) {
    return false;
  }

  // 6. Page/view must still be valid
  if (!tabManager_) return false;
  const TabManager::TabRecord *record = tabManager_->record(id);
  if (!isLifecycleEligible(record) || record->page->isLoading()) {
    return false;
  }

  // 7. Site must not be in user allowlist
  if (record->url.isValid() && isUrlAllowlisted(record->url)) {
    return false;
  }

  // 8. Must not already be Discarded
  if (it->lifecycleState == QWebEnginePage::LifecycleState::Discarded) {
    return false;
  }

  // 9. Idle threshold and Memory Pressure criteria
  const int64_t now = currentMonotonicMs();
  const int64_t elapsed = it->elapsedSinceLastVisibleMs(now);
  if (elapsed < backgroundDiscardDelayMs_) {
    return false;
  }

  if (discardRequirement_ == DiscardPolicyRequirement::IdleAndMemoryPressure) {
    const auto pressure = memoryMonitor_ ? memoryMonitor_->currentPressureLevel() : MemoryPressureLevel::Normal;
    if (policyMode_ == PerformancePolicyMode::MaximumPerformance) {
      if (pressure != MemoryPressureLevel::Critical) {
        return false;
      }
    } else {
      if (pressure == MemoryPressureLevel::Normal) {
        return false;
      }
    }
  }

  return true;
}

bool TabPerformanceManager::discardTab(TabManager::TabId id) {
  if (!canDiscard(id)) {
    return false;
  }

  const TabManager::TabRecord *record = tabManager_ ? tabManager_->record(id) : nullptr;
  if (!record || !record->page) {
    return false;
  }

  auto it = metadataMap_.find(id);
  if (it == metadataMap_.end()) {
    return false;
  }

  const int64_t now = currentMonotonicMs();

  // Apply Discarded lifecycle state via centralized performance manager
  record->page->setLifecycleState(QWebEnginePage::LifecycleState::Discarded);

  it->lifecycleState = QWebEnginePage::LifecycleState::Discarded;
  it->discardedByArDali = true;
  it->frozenByArDali = false;
  it->lastDiscardMonotonicMs = now;
  it->discardCount++;

  emit tabDiscarded(id);
  emit tabLifecycleStateChanged(id, QWebEnginePage::LifecycleState::Discarded);
  emit tabMetadataChanged(id, it.value());

  scheduleNextDeadlineCheck();
  return true;
}

bool TabPerformanceManager::resumeTab(TabManager::TabId id) {
  auto it = metadataMap_.find(id);
  if (it == metadataMap_.end() || it->tabKind != TabManager::TabKind::Web) {
    return false;
  }

  if (it->lifecycleState == QWebEnginePage::LifecycleState::Active) {
    return false; // Already active
  }

  if (!tabManager_) return false;
  const TabManager::TabRecord *record = tabManager_->record(id);
  if (!record || !record->page) {
    return false;
  }

  const int64_t now = currentMonotonicMs();
  const bool wasDiscarded = (it->lifecycleState == QWebEnginePage::LifecycleState::Discarded);

  // Restore Active lifecycle on the underlying Qt WebEnginePage
  // (Qt automatically triggers native reload if page was Discarded)
  record->page->setLifecycleState(QWebEnginePage::LifecycleState::Active);

  it->lifecycleState = QWebEnginePage::LifecycleState::Active;
  it->frozenByArDali = false;
  it->discardedByArDali = false;
  it->lastResumeMonotonicMs = now;

  if (wasDiscarded) {
    it->lastRestoreMonotonicMs = now;
    it->restoreCount++;
    emit tabRestored(id);
  } else {
    emit tabResumed(id);
  }

  emit tabLifecycleStateChanged(id, QWebEnginePage::LifecycleState::Active);
  emit tabMetadataChanged(id, it.value());

  scheduleNextDeadlineCheck();
  return true;
}

bool TabPerformanceManager::isTabFrozen(TabManager::TabId id) const {
  auto it = metadataMap_.constFind(id);
  if (it == metadataMap_.cend()) return false;
  return it->lifecycleState == QWebEnginePage::LifecycleState::Frozen;
}

bool TabPerformanceManager::isTabDiscarded(TabManager::TabId id) const {
  auto it = metadataMap_.constFind(id);
  if (it == metadataMap_.cend()) return false;
  return it->lifecycleState == QWebEnginePage::LifecycleState::Discarded;
}

QString TabPerformanceManager::normalizeSitePattern(const QString &pattern) {
  QString normalized = pattern.trimmed().toLower();
  if (normalized.startsWith(QLatin1String("http://"))) {
    normalized = normalized.mid(7);
  } else if (normalized.startsWith(QLatin1String("https://"))) {
    normalized = normalized.mid(8);
  }
  const int slashIdx = normalized.indexOf(QLatin1Char('/'));
  if (slashIdx != -1) {
    normalized = normalized.left(slashIdx);
  }
  const int colonIdx = normalized.indexOf(QLatin1Char(':'));
  if (colonIdx != -1) {
    normalized = normalized.left(colonIdx);
  }
  if (normalized.startsWith(QLatin1String("*."))) {
    normalized = normalized.mid(2);
  }
  if (normalized.startsWith(QLatin1String("www."))) {
    normalized = normalized.mid(4);
  }
  return QUrl::fromAce(normalized.toUtf8());
}

bool TabPerformanceManager::matchesAllowlistPattern(const QString &host, const QString &pattern) {
  const QString normalizedHost = normalizeSitePattern(host);
  const QString normalizedPattern = normalizeSitePattern(pattern);

  if (normalizedHost.isEmpty() || normalizedPattern.isEmpty()) {
    return false;
  }

  if (normalizedHost == normalizedPattern) {
    return true;
  }

  const QString suffix = QLatin1Char('.') + normalizedPattern;
  return normalizedHost.endsWith(suffix);
}

void TabPerformanceManager::setSiteAllowlist(const QStringList &patterns) {
  QStringList cleanList;
  for (const QString &pat : patterns) {
    const QString norm = normalizeSitePattern(pat);
    if (!norm.isEmpty() && !cleanList.contains(norm)) {
      cleanList.append(norm);
    }
  }
  siteAllowlist_ = cleanList;
  QSettings().setValue(QStringLiteral("performance/siteAllowlist"), siteAllowlist_);

  if (tabManager_) {
    for (auto it = metadataMap_.begin(); it != metadataMap_.end(); ++it) {
      const TabManager::TabRecord *record = tabManager_->record(it.key());
      recomputeProtectedReasons(it.value(), record);
    }
  }

  emit siteAllowlistChanged(siteAllowlist_);
  scheduleNextDeadlineCheck();
}

QStringList TabPerformanceManager::siteAllowlist() const {
  return siteAllowlist_;
}

bool TabPerformanceManager::isUrlAllowlisted(const QUrl &url) const {
  if (siteAllowlist_.isEmpty() || !url.isValid()) {
    return false;
  }
  const QString host = url.host().toLower();
  if (host.isEmpty()) {
    return false;
  }
  for (const QString &pattern : siteAllowlist_) {
    if (matchesAllowlistPattern(host, pattern)) {
      return true;
    }
  }
  return false;
}

void TabPerformanceManager::setTabFormDirty(TabManager::TabId id, bool dirty) {
  auto it = metadataMap_.find(id);
  if (it == metadataMap_.end()) return;

  const bool current = explicitFormDirty_.value(id, false);
  if (current == dirty) return;

  explicitFormDirty_[id] = dirty;
  const TabManager::TabRecord *record = tabManager_ ? tabManager_->record(id) : nullptr;
  recomputeProtectedReasons(it.value(), record);

  emit tabFormDirtyChanged(id, dirty);
}

bool TabPerformanceManager::isTabFormDirty(TabManager::TabId id) const {
  return explicitFormDirty_.value(id, false);
}

void TabPerformanceManager::setTabVisible(TabManager::TabId id, bool visible) {
  auto it = metadataMap_.find(id);
  if (it == metadataMap_.end()) return;

  const int64_t now = currentMonotonicMs();
  if (it->visible != visible) {
    it->visible = visible;
    it->lastVisibleMonotonicMs = now;
    const TabManager::TabRecord *record = tabManager_ ? tabManager_->record(id) : nullptr;
    recomputeProtectedReasons(it.value(), record);

    if (visible && (isTabFrozen(id) || isTabDiscarded(id))) {
      resumeTab(id);
    }
    scheduleNextDeadlineCheck();
  }
}

void TabPerformanceManager::setMediaPlaybackActive(TabManager::TabId id, bool active) {
  explicitMediaPlayback_[id] = active;
  auto it = metadataMap_.find(id);
  if (it != metadataMap_.end()) {
    const TabManager::TabRecord *record = tabManager_ ? tabManager_->record(id) : nullptr;
    recomputeProtectedReasons(it.value(), record);

    if (active && (isTabFrozen(id) || isTabDiscarded(id))) {
      resumeTab(id);
    }
    scheduleNextDeadlineCheck();
  }
}

void TabPerformanceManager::setBrowserDownloadActive(TabManager::TabId id, bool active) {
  explicitBrowserDownload_[id] = active;
  auto it = metadataMap_.find(id);
  if (it != metadataMap_.end()) {
    const TabManager::TabRecord *record = tabManager_ ? tabManager_->record(id) : nullptr;
    recomputeProtectedReasons(it.value(), record);

    if (active && (isTabFrozen(id) || isTabDiscarded(id))) {
      resumeTab(id);
    }
    scheduleNextDeadlineCheck();
  }
}

void TabPerformanceManager::setTabPinned(TabManager::TabId id, bool pinned) {
  explicitPinned_[id] = pinned;
  auto it = metadataMap_.find(id);
  if (it != metadataMap_.end()) {
    const TabManager::TabRecord *record = tabManager_ ? tabManager_->record(id) : nullptr;
    recomputeProtectedReasons(it.value(), record);

    if (pinned && (isTabFrozen(id) || isTabDiscarded(id))) {
      resumeTab(id);
    }
    scheduleNextDeadlineCheck();
  }
}

void TabPerformanceManager::onTabRegistered(TabManager::TabId id, TabManager::TabKind kind) {
  if (kind != TabManager::TabKind::Web || !tabManager_) return;

  const TabManager::TabRecord *record = tabManager_->record(id);
  if (!record || !record->page) return;

  const int64_t now = currentMonotonicMs();
  TabPerformanceMetadata meta;
  meta.tabId = id;
  meta.tabKind = TabManager::TabKind::Web;
  meta.creationMonotonicMs = now;
  meta.lastActivationMonotonicMs = now;
  meta.lastVisibleMonotonicMs = now;
  meta.lastAudibleChangeMonotonicMs = now;
  meta.visible = record->active;
  meta.recentlyAudible = record->page->recentlyAudible();
  meta.recommendedState = record->page->recommendedState();
  meta.lifecycleState = record->page->lifecycleState();
  meta.activationSerial = record->activationSerial;

  metadataMap_.insert(id, meta);
  pageToIdMap_.insert(record->page.data(), id);

  wirePageSignals(id, record->page.data());
  recomputeProtectedReasons(metadataMap_[id], record);

  scheduleNextDeadlineCheck();
}

void TabPerformanceManager::onTabActivated(TabManager::TabId id) {
  if (!tabManager_) return;

  const TabManager::TabRecord *targetRecord = tabManager_->record(id);
  if (!targetRecord) return;

  // If the activated tab was Frozen or Discarded, resume it to Active BEFORE foreground usage begins
  if (isTabFrozen(id) || isTabDiscarded(id)) {
    resumeTab(id);
  }

  const int64_t now = currentMonotonicMs();
  const QObject *ownerWindow = targetRecord->ownerWindow.data();

  // If another web tab in the same window was visible, update its visibility to false
  for (auto it = metadataMap_.begin(); it != metadataMap_.end(); ++it) {
    if (it.key() != id) {
      const TabManager::TabRecord *otherRecord = tabManager_->record(it.key());
      if (otherRecord && otherRecord->ownerWindow == ownerWindow && it->visible) {
        it->visible = false;
        it->lastVisibleMonotonicMs = now;
        recomputeProtectedReasons(it.value(), otherRecord);
      }
    }
  }

  // Update target tab
  auto it = metadataMap_.find(id);
  if (it != metadataMap_.end()) {
    it->visible = true;
    it->lastActivationMonotonicMs = now;
    it->lastVisibleMonotonicMs = now;
    it->activationSerial = targetRecord->activationSerial;
    recomputeProtectedReasons(it.value(), targetRecord);
  }

  scheduleNextDeadlineCheck();
}

void TabPerformanceManager::onTabTransferred(TabManager::TabId id, QObject *newOwner, bool detached) {
  Q_UNUSED(detached);
  if (!tabManager_) return;

  const TabManager::TabRecord *targetRecord = tabManager_->record(id);
  if (!targetRecord) return;

  if (targetRecord->active && (isTabFrozen(id) || isTabDiscarded(id))) {
    resumeTab(id);
  }

  const int64_t now = currentMonotonicMs();

  // Update visibility of any other tabs in newOwner
  for (auto it = metadataMap_.begin(); it != metadataMap_.end(); ++it) {
    if (it.key() != id) {
      const TabManager::TabRecord *otherRecord = tabManager_->record(it.key());
      if (otherRecord && otherRecord->ownerWindow == newOwner && it->visible) {
        it->visible = false;
        it->lastVisibleMonotonicMs = now;
        recomputeProtectedReasons(it.value(), otherRecord);
      }
    }
  }

  auto it = metadataMap_.find(id);
  if (it != metadataMap_.end()) {
    it->visible = targetRecord->active;
    it->activationSerial = targetRecord->activationSerial;
    if (targetRecord->active) {
      it->lastActivationMonotonicMs = now;
      it->lastVisibleMonotonicMs = now;
    }
    recomputeProtectedReasons(it.value(), targetRecord);
  }

  scheduleNextDeadlineCheck();
}

void TabPerformanceManager::onTabRemoved(TabManager::TabId id) {
  metadataMap_.remove(id);
  explicitMediaPlayback_.remove(id);
  explicitBrowserDownload_.remove(id);
  explicitPinned_.remove(id);
  explicitFormDirty_.remove(id);

  for (auto it = pageToIdMap_.begin(); it != pageToIdMap_.end();) {
    if (it.value() == id) {
      it = pageToIdMap_.erase(it);
    } else {
      ++it;
    }
  }

  scheduleNextDeadlineCheck();
}

void TabPerformanceManager::onTabUrlChanged(TabManager::TabId id, const QUrl &url) {
  Q_UNUSED(url);
  auto it = metadataMap_.find(id);
  if (it == metadataMap_.end()) return;

  const TabManager::TabRecord *record = tabManager_ ? tabManager_->record(id) : nullptr;
  recomputeProtectedReasons(it.value(), record);
  scheduleNextDeadlineCheck();
}

void TabPerformanceManager::onPageUrlChanged(const QUrl &url) {
  Q_UNUSED(url);
  auto *page = qobject_cast<QWebEnginePage *>(sender());
  if (!page) return;

  const TabManager::TabId id = pageToIdMap_.value(page);
  if (id.isNull()) return;

  auto it = metadataMap_.find(id);
  if (it == metadataMap_.end()) return;

  const TabManager::TabRecord *record = tabManager_ ? tabManager_->record(id) : nullptr;
  recomputeProtectedReasons(it.value(), record);
  scheduleNextDeadlineCheck();
}

void TabPerformanceManager::wirePageSignals(TabManager::TabId id, QWebEnginePage *page) {
  Q_UNUSED(id);
  if (!page) return;

  connect(page, &QWebEnginePage::recentlyAudibleChanged,
          this, &TabPerformanceManager::onPageRecentlyAudibleChanged, Qt::UniqueConnection);
  connect(page, &QWebEnginePage::recommendedStateChanged,
          this, &TabPerformanceManager::onPageRecommendedStateChanged, Qt::UniqueConnection);
  connect(page, &QWebEnginePage::lifecycleStateChanged,
          this, &TabPerformanceManager::onPageLifecycleStateChanged, Qt::UniqueConnection);
  connect(page, &QWebEnginePage::loadStarted,
          this, &TabPerformanceManager::onPageLoadStarted, Qt::UniqueConnection);
  connect(page, &QWebEnginePage::urlChanged,
          this, &TabPerformanceManager::onPageUrlChanged, Qt::UniqueConnection);
}

void TabPerformanceManager::onPageRecentlyAudibleChanged(bool audible) {
  auto *page = qobject_cast<QWebEnginePage *>(sender());
  if (!page) return;

  const TabManager::TabId id = pageToIdMap_.value(page);
  if (id.isNull()) return;

  auto it = metadataMap_.find(id);
  if (it == metadataMap_.end()) return;

  it->recentlyAudible = audible;
  it->lastAudibleChangeMonotonicMs = currentMonotonicMs();
  const TabManager::TabRecord *record = tabManager_ ? tabManager_->record(id) : nullptr;
  recomputeProtectedReasons(it.value(), record);
  emit tabRecentlyAudibleChanged(id, audible);

  if (audible && (isTabFrozen(id) || isTabDiscarded(id))) {
    resumeTab(id);
  }

  scheduleNextDeadlineCheck();
}

void TabPerformanceManager::onPageRecommendedStateChanged(QWebEnginePage::LifecycleState state) {
  auto *page = qobject_cast<QWebEnginePage *>(sender());
  if (!page) return;

  const TabManager::TabId id = pageToIdMap_.value(page);
  if (id.isNull()) return;

  auto it = metadataMap_.find(id);
  if (it == metadataMap_.end()) return;

  it->recommendedState = state;
  const TabManager::TabRecord *record = tabManager_ ? tabManager_->record(id) : nullptr;
  recomputeProtectedReasons(it.value(), record);
  emit tabRecommendedStateChanged(id, state);

  if (state == QWebEnginePage::LifecycleState::Active && (isTabFrozen(id) || isTabDiscarded(id))) {
    resumeTab(id);
  }

  scheduleNextDeadlineCheck();
}

void TabPerformanceManager::onPageLifecycleStateChanged(QWebEnginePage::LifecycleState state) {
  auto *page = qobject_cast<QWebEnginePage *>(sender());
  if (!page) return;

  const TabManager::TabId id = pageToIdMap_.value(page);
  if (id.isNull()) return;

  auto it = metadataMap_.find(id);
  if (it == metadataMap_.end()) return;

  it->lifecycleState = state;
  if (state != QWebEnginePage::LifecycleState::Frozen) {
    it->frozenByArDali = false;
  }
  if (state != QWebEnginePage::LifecycleState::Discarded) {
    it->discardedByArDali = false;
  }
  const TabManager::TabRecord *record = tabManager_ ? tabManager_->record(id) : nullptr;
  recomputeProtectedReasons(it.value(), record);
  emit tabLifecycleStateChanged(id, state);

  scheduleNextDeadlineCheck();
}

void TabPerformanceManager::onPageLoadStarted() {
  auto *page = qobject_cast<QWebEnginePage *>(sender());
  if (!page) return;

  const TabManager::TabId id = pageToIdMap_.value(page);
  if (id.isNull()) return;

  // Trusted native lifecycle reset: on new document navigation/reload, form dirty state is reset
  if (explicitFormDirty_.value(id, false)) {
    setTabFormDirty(id, false);
  }
}

void TabPerformanceManager::recomputeProtectedReasons(
    TabPerformanceMetadata &meta, const TabManager::TabRecord *record) {
  ProtectedReasons reasons = ProtectedReason::None;

  if (!record || !isLifecycleEligible(record)) {
    reasons |= ProtectedReason::InternalScheme;
  }
  if (meta.visible) {
    reasons |= ProtectedReason::Visible;
  }
  if (meta.recentlyAudible) {
    reasons |= ProtectedReason::RecentlyAudible;
  }
  if (meta.recommendedState == QWebEnginePage::LifecycleState::Active) {
    reasons |= ProtectedReason::RecommendedActive;
  }
  if (explicitMediaPlayback_.value(meta.tabId, false)) {
    reasons |= ProtectedReason::MediaPlayback;
  }
  if (explicitBrowserDownload_.value(meta.tabId, false)) {
    reasons |= ProtectedReason::BrowserDownload;
  }
  if (explicitPinned_.value(meta.tabId, false) || (record && !record->capabilities.closable)) {
    reasons |= ProtectedReason::UserPinned;
  }
  if (explicitFormDirty_.value(meta.tabId, false)) {
    reasons |= ProtectedReason::FormOrEditState;
  }
  if (record && record->url.isValid() && isUrlAllowlisted(record->url)) {
    reasons |= ProtectedReason::UserAllowlisted;
    meta.allowlisted = true;
  } else {
    meta.allowlisted = false;
  }

  meta.formDirty = explicitFormDirty_.value(meta.tabId, false);

  const ProtectedReasons oldReasons = meta.protectedReasons;
  meta.protectedReasons = reasons;

  if (oldReasons != reasons) {
    emit tabProtectionChanged(meta.tabId, reasons != ProtectedReason::None, reasons);
    emit tabMetadataChanged(meta.tabId, meta);
  }
}

bool TabPerformanceManager::isSupportedWebScheme(const QUrl &url) {
  if (!url.isValid() || url.isEmpty()) {
    return false;
  }
  const QString scheme = url.scheme().toLower();
  if (scheme != QLatin1String("http") && scheme != QLatin1String("https")) {
    return false;
  }
  const QString host = url.host().toLower();
  if (host == QLatin1String("newtab") || host == QLatin1String("ardali-browser.local") ||
      (url.isLocalFile() && url.path().contains(QStringLiteral("/assets/new-tab/"))) ||
      url.toString().startsWith(QLatin1String("about:")) ||
      url.toString().startsWith(QLatin1String("ardali:")) ||
      url.toString().startsWith(QLatin1String("chrome:")) ||
      url.toString().startsWith(QLatin1String("qrc:"))) {
    return false;
  }
  return true;
}

bool TabPerformanceManager::isTabLifecycleEligible(TabManager::TabId id) const {
  if (!tabManager_) return false;
  return isLifecycleEligible(tabManager_->record(id));
}

bool TabPerformanceManager::isLifecycleEligible(const TabManager::TabRecord *record) const {
  if (!record || record->kind != TabManager::TabKind::Web || !record->page || !record->view) {
    return false;
  }
  return isSupportedWebScheme(record->url);
}

void TabPerformanceManager::scheduleNextDeadlineCheck() {
  if (isTearingDown_ || !deadlineTimer_) return;

  const int64_t now = currentMonotonicMs();
  int64_t minRemainingMs = -1;

  for (auto it = metadataMap_.cbegin(); it != metadataMap_.cend(); ++it) {
    const TabManager::TabId id = it.key();
    const TabPerformanceMetadata &meta = it.value();

    if (meta.tabKind != TabManager::TabKind::Web) continue;
    if (meta.visible) continue;
    if (isTabProtected(id)) continue;
    if (meta.recentlyAudible) continue;

    const int64_t elapsed = meta.elapsedSinceLastVisibleMs(now);

    // 1. Check Freeze eligibility deadline
    if (meta.lifecycleState == QWebEnginePage::LifecycleState::Active &&
        isAggressiveStatePermitted(id, QWebEnginePage::LifecycleState::Frozen)) {
      const int64_t remainingFreeze = backgroundFreezeDelayMs_ - elapsed;
      if (remainingFreeze <= 0) {
        minRemainingMs = 0;
        break;
      } else {
        if (minRemainingMs < 0 || remainingFreeze < minRemainingMs) {
          minRemainingMs = remainingFreeze;
        }
      }
    }

    // 2. Check Discard eligibility deadline
    if (discardEnabled_ &&
        meta.lifecycleState != QWebEnginePage::LifecycleState::Discarded &&
        isAggressiveStatePermitted(id, QWebEnginePage::LifecycleState::Discarded)) {
      const int64_t remainingDiscard = backgroundDiscardDelayMs_ - elapsed;
      if (remainingDiscard <= 0) {
        // If memory pressure condition is satisfied, immediate deadline
        if (discardRequirement_ == DiscardPolicyRequirement::IdleOnly ||
            (memoryMonitor_ && memoryMonitor_->currentPressureLevel() != MemoryPressureLevel::Normal)) {
          minRemainingMs = 0;
          break;
        }
      } else {
        if (minRemainingMs < 0 || remainingDiscard < minRemainingMs) {
          minRemainingMs = remainingDiscard;
        }
      }
    }
  }

  if (minRemainingMs == 0) {
    deadlineTimer_->start(0);
  } else if (minRemainingMs > 0) {
    deadlineTimer_->start(static_cast<int>(minRemainingMs));
  } else {
    deadlineTimer_->stop();
  }
}

void TabPerformanceManager::onDeadlineTimeout() {
  if (isTearingDown_) return;

  const int64_t now = currentMonotonicMs();
  const QList<TabManager::TabId> ids = metadataMap_.keys();

  // Phase 1: Freeze Pass for eligible background active tabs
  for (const TabManager::TabId &id : ids) {
    auto it = metadataMap_.constFind(id);
    if (it == metadataMap_.cend()) continue;

    if (it->tabKind == TabManager::TabKind::Web &&
        !it->visible &&
        it->lifecycleState == QWebEnginePage::LifecycleState::Active &&
        it->elapsedSinceLastVisibleMs(now) >= backgroundFreezeDelayMs_) {
      if (canFreeze(id)) {
        freezeTab(id);
      }
    }
  }

  // Phase 2: Discard Pass for eligible background tabs (Ordered & Rate Limited)
  if (discardEnabled_) {
    QList<TabManager::TabId> discardCandidates;
    for (const TabManager::TabId &id : ids) {
      if (canDiscard(id)) {
        discardCandidates.append(id);
      }
    }

    if (!discardCandidates.isEmpty()) {
      // Discard Candidate Prioritization:
      // 1. Already Frozen tabs first
      // 2. Oldest inactive / least recently active
      std::sort(discardCandidates.begin(), discardCandidates.end(),
                [this](const TabManager::TabId &a, const TabManager::TabId &b) {
                  const auto metaA = metadataMap_.value(a);
                  const auto metaB = metadataMap_.value(b);
                  const bool aFrozen = (metaA.lifecycleState == QWebEnginePage::LifecycleState::Frozen);
                  const bool bFrozen = (metaB.lifecycleState == QWebEnginePage::LifecycleState::Frozen);
                  if (aFrozen != bFrozen) {
                    return aFrozen; // Frozen tabs have higher discard priority
                  }
                  return metaA.lastActivationMonotonicMs < metaB.lastActivationMonotonicMs; // Oldest first
                });

      int discardedInThisBurst = 0;
      for (const TabManager::TabId &id : discardCandidates) {
        if (discardedInThisBurst >= kMaxDiscardPerEvaluation) {
          break; // Enforce burst rate limit
        }
        if (discardTab(id)) {
          discardedInThisBurst++;
        }
      }
    }
  }

  scheduleNextDeadlineCheck();
}

} // namespace ardali
