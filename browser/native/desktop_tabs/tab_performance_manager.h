#pragma once

#include <QFlags>
#include <QHash>
#include <QList>
#include <QObject>
#include <QPointer>
#include <QStringList>
#include <QTimer>
#include <QUuid>
#include <QUrl>
#include <QWebEnginePage>
#include <cstdint>
#include <memory>

#include "system_memory_pressure_monitor.h"
#include "tab_manager.h"

namespace ardali {

/**
 * @brief Categorized reasons why a tab is protected from aggressive lifecycle actions.
 */
enum class ProtectedReason : uint32_t {
  None              = 0,
  Visible           = 1 << 0,  ///< Supported & Detected: Tab is active/visible in its window
  RecentlyAudible   = 1 << 1,  ///< Supported & Detected: Tab is producing or recently produced audio
  RecommendedActive = 1 << 2,  ///< Supported & Detected: Qt WebEngine recommendedState is Active
  MediaPlayback     = 1 << 3,  ///< Supported & Detected: Active media/audio playback detected
  WebRTC            = 1 << 4,  ///< Supported in Model (NOT YET DETECTED): Active WebRTC session
  Camera            = 1 << 5,  ///< Supported in Model (NOT YET DETECTED): Active camera capture
  Microphone        = 1 << 6,  ///< Supported in Model (NOT YET DETECTED): Active microphone capture
  ScreenCapture     = 1 << 7,  ///< Supported in Model (NOT YET DETECTED): Active screen capture
  BrowserDownload   = 1 << 8,  ///< Supported in Model (NOT YET DETECTED): Tab-bound active browser download
  UserPinned        = 1 << 9,  ///< Supported & Detected: Tab is pinned/non-closable by user
  UserAllowlisted   = 1 << 10, ///< Supported & Detected (Phase 2C-1): Domain is user-allowlisted
  FormOrEditState   = 1 << 11, ///< Supported & Detected (Phase 2C-1): Unsaved form/input/edit state latched
  InternalScheme    = 1 << 12, ///< Supported & Detected: Non-http/https URL or internal/New Tab page
};
Q_DECLARE_FLAGS(ProtectedReasons, ProtectedReason)
Q_DECLARE_OPERATORS_FOR_FLAGS(ProtectedReasons)

/**
 * @brief Policy requirements for discard eligibility.
 */
enum class DiscardPolicyRequirement {
  IdleAndMemoryPressure, ///< Requires idle delay AND moderate/critical memory pressure (Default)
  IdleOnly               ///< Requires idle delay only (e.g. For extreme idle duration)
};

/**
 * @brief High-level performance policy mode.
 */
enum class PerformancePolicyMode {
  Balanced,           ///< Production default: freeze when safe, discard after one minute
  MemorySaver,        ///< More aggressive: freeze when safe, discard after 30 seconds
  MaximumPerformance  ///< Less aggressive: freeze when safe, discard after two minutes
};

/**
 * @brief Performance and activity metadata tracked for each tab.
 * Uses monotonic time to remain immune to wall-clock / NTP shifts.
 */
struct TabPerformanceMetadata {
  TabManager::TabId tabId;
  TabManager::TabKind tabKind = TabManager::TabKind::Web;
  int64_t creationMonotonicMs = 0;
  int64_t lastActivationMonotonicMs = 0;
  int64_t lastVisibleMonotonicMs = 0;
  int64_t lastAudibleChangeMonotonicMs = 0;
  int64_t lastFreezeMonotonicMs = 0;
  int64_t lastResumeMonotonicMs = 0;
  int64_t lastDiscardMonotonicMs = 0;
  int64_t lastRestoreMonotonicMs = 0;
  uint32_t freezeCount = 0;
  uint32_t discardCount = 0;
  uint32_t restoreCount = 0;
  bool visible = false;
  bool recentlyAudible = false;
  bool frozenByArDali = false;
  bool discardedByArDali = false;
  bool formDirty = false;
  bool allowlisted = false;
  quint64 activationSerial = 0;
  QWebEnginePage::LifecycleState lifecycleState = QWebEnginePage::LifecycleState::Active;
  QWebEnginePage::LifecycleState recommendedState = QWebEnginePage::LifecycleState::Active;
  ProtectedReasons protectedReasons = ProtectedReason::None;

  int64_t elapsedSinceCreationMs(int64_t nowMonotonicMs) const {
    return nowMonotonicMs >= creationMonotonicMs ? nowMonotonicMs - creationMonotonicMs : 0;
  }
  int64_t elapsedSinceLastActiveMs(int64_t nowMonotonicMs) const {
    return nowMonotonicMs >= lastActivationMonotonicMs ? nowMonotonicMs - lastActivationMonotonicMs : 0;
  }
  int64_t elapsedSinceLastVisibleMs(int64_t nowMonotonicMs) const {
    return nowMonotonicMs >= lastVisibleMonotonicMs ? nowMonotonicMs - lastVisibleMonotonicMs : 0;
  }
};

/**
 * @brief Central event-driven performance and lifecycle manager.
 */
class TabPerformanceManager : public QObject {
  Q_OBJECT

 public:
  // One central product policy: an eligible background page is frozen first,
  // then discarded after this interval. Qt's recommendedState remains the
  // final safety boundary for either transition.
  static constexpr int64_t kDefaultBackgroundFreezeDelayMs = 0;
  static constexpr int64_t kDefaultBackgroundDiscardDelayMs = 60 * 1000;
  static constexpr int kMaxDiscardPerEvaluation = 2;                           // Rate limiting burst max

  explicit TabPerformanceManager(TabManager *tabManager, QObject *parent = nullptr);
  ~TabPerformanceManager() override;

  /// Monotonic timestamp in milliseconds since steady_clock epoch.
  static int64_t currentMonotonicMs();

  // Delays and policy configuration
  int64_t backgroundFreezeDelayMs() const;
  void setBackgroundFreezeDelayMs(int64_t delayMs);

  int64_t backgroundDiscardDelayMs() const;
  void setBackgroundDiscardDelayMs(int64_t delayMs);

  DiscardPolicyRequirement discardPolicyRequirement() const;
  void setDiscardPolicyRequirement(DiscardPolicyRequirement req);

  PerformancePolicyMode policyMode() const;
  void setPolicyMode(PerformancePolicyMode mode);

  bool isDiscardEnabled() const;
  void setDiscardEnabled(bool enabled);

  void loadPersistedSettings();

  SystemMemoryPressureMonitor *memoryPressureMonitor() const;

  // Metadata and protection
  bool hasMetadata(TabManager::TabId id) const;
  TabPerformanceMetadata metadata(TabManager::TabId id) const;
  bool isTabProtected(TabManager::TabId id) const;
  ProtectedReasons protectedReasons(TabManager::TabId id) const;

  /// Returns list of all tracked web tab IDs.
  QList<TabManager::TabId> trackedWebTabs() const;

  /// Safety gate query for lifecycle policies:
  /// Verifies that targetState is not more aggressive than Qt's recommendedState.
  bool isAggressiveStatePermitted(TabManager::TabId id, QWebEnginePage::LifecycleState targetState) const;

  // Phase 2B & 2C: Freeze, Discard & Restore
  bool canFreeze(TabManager::TabId id) const;
  bool freezeTab(TabManager::TabId id);
  bool canDiscard(TabManager::TabId id) const;
  bool discardTab(TabManager::TabId id);
  bool resumeTab(TabManager::TabId id); // Restores either Frozen or Discarded tab to Active

  bool isTabFrozen(TabManager::TabId id) const;
  bool isTabDiscarded(TabManager::TabId id) const;
  bool isTabLifecycleEligible(TabManager::TabId id) const;
  static bool isSupportedWebScheme(const QUrl &url);

  // Site allowlist model
  static QString normalizeSitePattern(const QString &pattern);
  static bool matchesAllowlistPattern(const QString &host, const QString &pattern);
  void setSiteAllowlist(const QStringList &patterns);
  QStringList siteAllowlist() const;
  bool isUrlAllowlisted(const QUrl &url) const;

  // Form dirty state (spoof-safe latching)
  void setTabFormDirty(TabManager::TabId id, bool dirty);
  bool isTabFormDirty(TabManager::TabId id) const;

  // External explicit signal hooks (for testing or controller integration)
  void setTabVisible(TabManager::TabId id, bool visible);
  void setMediaPlaybackActive(TabManager::TabId id, bool active);
  void setBrowserDownloadActive(TabManager::TabId id, bool active);
  void setTabPinned(TabManager::TabId id, bool pinned);

 signals:
  void tabMetadataChanged(TabManager::TabId id, const ardali::TabPerformanceMetadata &metadata);
  void tabProtectionChanged(TabManager::TabId id, bool isProtected, ardali::ProtectedReasons reasons);
  void tabRecentlyAudibleChanged(TabManager::TabId id, bool audible);
  void tabRecommendedStateChanged(TabManager::TabId id, QWebEnginePage::LifecycleState state);
  void tabLifecycleStateChanged(TabManager::TabId id, QWebEnginePage::LifecycleState state);
  void tabFrozen(TabManager::TabId id);
  void tabResumed(TabManager::TabId id);
  void tabDiscarded(TabManager::TabId id);
  void tabRestored(TabManager::TabId id);
  void tabFormDirtyChanged(TabManager::TabId id, bool dirty);
  void siteAllowlistChanged(const QStringList &patterns);
  void policyModeChanged(ardali::PerformancePolicyMode mode);
  void discardEnabledChanged(bool enabled);

 public slots:
  void onTabRegistered(TabManager::TabId id, TabManager::TabKind kind);
  void onTabActivated(TabManager::TabId id);
  void onTabTransferred(TabManager::TabId id, QObject *newOwner, bool detached);
  void onTabRemoved(TabManager::TabId id);
  void onTabUrlChanged(TabManager::TabId id, const QUrl &url);

 private slots:
  void onPageRecentlyAudibleChanged(bool audible);
  void onPageRecommendedStateChanged(QWebEnginePage::LifecycleState state);
  void onPageLifecycleStateChanged(QWebEnginePage::LifecycleState state);
  void onPageLoadStarted();
  void onPageUrlChanged(const QUrl &url);
  void onDeadlineTimeout();

 private:
  void wirePageSignals(TabManager::TabId id, QWebEnginePage *page);
  void recomputeProtectedReasons(TabPerformanceMetadata &meta, const TabManager::TabRecord *record);
  bool isLifecycleEligible(const TabManager::TabRecord *record) const;
  void scheduleNextDeadlineCheck();

  TabManager *tabManager_ = nullptr;
  std::unique_ptr<SystemMemoryPressureMonitor> memoryMonitor_;
  int64_t backgroundFreezeDelayMs_ = kDefaultBackgroundFreezeDelayMs;
  int64_t backgroundDiscardDelayMs_ = kDefaultBackgroundDiscardDelayMs;
  DiscardPolicyRequirement discardRequirement_ = DiscardPolicyRequirement::IdleOnly;
  PerformancePolicyMode policyMode_ = PerformancePolicyMode::Balanced;
  bool discardEnabled_ = true;

  QTimer *deadlineTimer_ = nullptr;
  bool isTearingDown_ = false;

  QStringList siteAllowlist_;

  QHash<TabManager::TabId, TabPerformanceMetadata> metadataMap_;
  QHash<const QWebEnginePage *, TabManager::TabId> pageToIdMap_;
  QHash<TabManager::TabId, bool> explicitMediaPlayback_;
  QHash<TabManager::TabId, bool> explicitBrowserDownload_;
  QHash<TabManager::TabId, bool> explicitPinned_;
  QHash<TabManager::TabId, bool> explicitFormDirty_;
};

} // namespace ardali
