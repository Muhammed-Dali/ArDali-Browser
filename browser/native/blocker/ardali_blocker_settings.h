#pragma once

#include <QHash>
#include <QJsonObject>
#include <QObject>
#include <QSet>
#include <QSettings>
#include <QStringList>

#include "ardali_blocker_types.h"

namespace ArDaliBlockerDefaults {
inline constexpr ArDaliBlockerMode Mode = ArDaliBlockerMode::Ideal;
inline constexpr bool ProtectionEnabled = true;
inline constexpr bool AutoReload = true;
inline constexpr bool ShowCount = true;
inline constexpr bool StrictBlock = true;
inline constexpr bool PopupBlock = true;
inline constexpr bool DeveloperMode = false;
inline constexpr bool AutoUpdateRulesets = false;
inline constexpr bool RulesetSelectionConfigured = false;
}

namespace AdBlockDefaults = ArDaliBlockerDefaults;

class ArDaliBlockerSettings final : public QObject {
  Q_OBJECT
 public:
  explicit ArDaliBlockerSettings(const QString &iniPath, QObject *parent = nullptr);
  ~ArDaliBlockerSettings() override = default;

  ArDaliBlockerMode mode() const;
  void setMode(ArDaliBlockerMode mode);

  bool protectionEnabled() const;
  void setProtectionEnabled(bool enabled);

  bool autoReloadOnModeChange() const;
  void setAutoReloadOnModeChange(bool enable);

  bool showBlockedCountOnToolbar() const;
  void setShowBlockedCountOnToolbar(bool enable);

  bool strictBlock() const;
  void setStrictBlock(bool enable);

  bool popupBlock() const;
  void setPopupBlock(bool enable);

  bool developerMode() const;
  void setDeveloperMode(bool enable);

  bool autoUpdateRulesets() const;
  void setAutoUpdateRulesets(bool enable);

  QStringList customFilters() const;
  void setCustomFilters(const QStringList &filters);

  QHash<QString, SitePolicy> sitePolicies() const;
  SitePolicy sitePolicy(const QString &host) const;
  void setSitePolicy(const QString &host, const SitePolicy &policy);
  void removeSitePolicy(const QString &host);

  QStringList enabledRulesetIds() const;
  bool rulesetSelectionConfigured() const;
  void setEnabledRulesetIds(const QStringList &ids);

  // Backup, Restore & Reset
  QJsonObject exportBackupJson() const;
  bool importBackupJson(const QJsonObject &json);
  void resetToDefaults();

 signals:
  void settingsChanged();
  // Emitted exactly once for each logical change that requires recompiling
  // the network/cosmetic plan.  UI-only and site-policy changes deliberately
  // do not rebuild the engine.
  void filteringPlanChanged();
  void modeChanged(ArDaliBlockerMode mode);
  void protectionEnabledChanged(bool enabled);
  void toolbarCountVisibilityChanged(bool visible);
  void popupBlockChanged(bool enabled);
  void customFiltersChanged();
  void sitePoliciesChanged();
  void rulesetsChanged();

 private:
  void load();
  void save();
  QString sanitizeHost(const QString &host) const;

  mutable QSettings settings_;
  ArDaliBlockerMode mode_ = ArDaliBlockerDefaults::Mode;
  bool protectionEnabled_ = ArDaliBlockerDefaults::ProtectionEnabled;
  bool autoReload_ = ArDaliBlockerDefaults::AutoReload;
  bool showCount_ = ArDaliBlockerDefaults::ShowCount;
  bool strictBlock_ = ArDaliBlockerDefaults::StrictBlock;
  bool popupBlock_ = ArDaliBlockerDefaults::PopupBlock;
  bool developerMode_ = ArDaliBlockerDefaults::DeveloperMode;
  bool autoUpdateRulesets_ = ArDaliBlockerDefaults::AutoUpdateRulesets;
  QStringList customFilters_;
  QHash<QString, SitePolicy> sitePolicies_;
  QStringList enabledRulesetIds_;
  bool rulesetSelectionConfigured_ = ArDaliBlockerDefaults::RulesetSelectionConfigured;
};

using AdBlockSettings = ArDaliBlockerSettings;
