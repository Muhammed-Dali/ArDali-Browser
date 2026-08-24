#include "ardali_blocker_settings.h"

#include <QJsonArray>
#include <QUrl>

namespace {
constexpr char kFormatName[] = "ardali-blocker-settings";
constexpr int kFormatVersion = 1;
}

ArDaliBlockerSettings::ArDaliBlockerSettings(const QString &iniPath, QObject *parent)
    : QObject(parent), settings_(iniPath, QSettings::IniFormat) {
  load();
}

ArDaliBlockerMode ArDaliBlockerSettings::mode() const { return mode_; }

void ArDaliBlockerSettings::setMode(ArDaliBlockerMode mode) {
  if (mode_ == mode && (settings_.contains(QStringLiteral("blocker/mode")) || settings_.contains(QStringLiteral("adblock/mode")))) return;
  mode_ = mode;
  settings_.setValue(QStringLiteral("blocker/mode"), modeToString(mode_));
  settings_.setValue(QStringLiteral("adblock/mode"), modeToString(mode_));
  settings_.sync();
  emit modeChanged(mode_);
  emit filteringPlanChanged();
  emit settingsChanged();
}

bool ArDaliBlockerSettings::protectionEnabled() const { return protectionEnabled_; }

void ArDaliBlockerSettings::setProtectionEnabled(bool enabled) {
  if (protectionEnabled_ == enabled &&
      (settings_.contains(QStringLiteral("blocker/protectionEnabled")) || settings_.contains(QStringLiteral("adblock/protectionEnabled")))) return;
  protectionEnabled_ = enabled;
  settings_.setValue(QStringLiteral("blocker/protectionEnabled"), protectionEnabled_);
  settings_.setValue(QStringLiteral("adblock/protectionEnabled"), protectionEnabled_);
  settings_.sync();
  emit protectionEnabledChanged(protectionEnabled_);
  emit settingsChanged();
}

bool ArDaliBlockerSettings::autoReloadOnModeChange() const { return autoReload_; }

void ArDaliBlockerSettings::setAutoReloadOnModeChange(bool enable) {
  if (autoReload_ == enable && (settings_.contains(QStringLiteral("blocker/autoReload")) || settings_.contains(QStringLiteral("adblock/autoReload")))) return;
  autoReload_ = enable;
  settings_.setValue(QStringLiteral("blocker/autoReload"), autoReload_);
  settings_.setValue(QStringLiteral("adblock/autoReload"), autoReload_);
  settings_.sync();
  emit settingsChanged();
}

bool ArDaliBlockerSettings::showBlockedCountOnToolbar() const { return showCount_; }

void ArDaliBlockerSettings::setShowBlockedCountOnToolbar(bool enable) {
  if (showCount_ == enable && (settings_.contains(QStringLiteral("blocker/showBlockedCount")) || settings_.contains(QStringLiteral("adblock/showBlockedCount")))) return;
  showCount_ = enable;
  settings_.setValue(QStringLiteral("blocker/showBlockedCount"), showCount_);
  settings_.setValue(QStringLiteral("adblock/showBlockedCount"), showCount_);
  settings_.sync();
  emit toolbarCountVisibilityChanged(showCount_);
  emit settingsChanged();
}

bool ArDaliBlockerSettings::strictBlock() const { return strictBlock_; }

void ArDaliBlockerSettings::setStrictBlock(bool enable) {
  if (strictBlock_ == enable && (settings_.contains(QStringLiteral("blocker/strictBlock")) || settings_.contains(QStringLiteral("adblock/strictBlock")))) return;
  strictBlock_ = enable;
  settings_.setValue(QStringLiteral("blocker/strictBlock"), strictBlock_);
  settings_.setValue(QStringLiteral("adblock/strictBlock"), strictBlock_);
  settings_.sync();
  emit filteringPlanChanged();
  emit settingsChanged();
}

bool ArDaliBlockerSettings::popupBlock() const { return popupBlock_; }

void ArDaliBlockerSettings::setPopupBlock(bool enable) {
  if (popupBlock_ == enable && (settings_.contains(QStringLiteral("blocker/popupBlock")) || settings_.contains(QStringLiteral("adblock/popupBlock")))) return;
  popupBlock_ = enable;
  settings_.setValue(QStringLiteral("blocker/popupBlock"), popupBlock_);
  settings_.setValue(QStringLiteral("adblock/popupBlock"), popupBlock_);
  settings_.sync();
  emit popupBlockChanged(popupBlock_);
  emit settingsChanged();
}

bool ArDaliBlockerSettings::developerMode() const { return developerMode_; }

void ArDaliBlockerSettings::setDeveloperMode(bool enable) {
  if (developerMode_ == enable && (settings_.contains(QStringLiteral("blocker/developerMode")) || settings_.contains(QStringLiteral("adblock/developerMode")))) return;
  developerMode_ = enable;
  settings_.setValue(QStringLiteral("blocker/developerMode"), developerMode_);
  settings_.setValue(QStringLiteral("adblock/developerMode"), developerMode_);
  settings_.sync();
  emit settingsChanged();
}

bool ArDaliBlockerSettings::autoUpdateRulesets() const { return autoUpdateRulesets_; }

void ArDaliBlockerSettings::setAutoUpdateRulesets(bool enable) {
  if (autoUpdateRulesets_ == enable && (settings_.contains(QStringLiteral("blocker/autoUpdateRulesets")) || settings_.contains(QStringLiteral("adblock/autoUpdateRulesets")))) return;
  autoUpdateRulesets_ = enable;
  settings_.setValue(QStringLiteral("blocker/autoUpdateRulesets"), autoUpdateRulesets_);
  settings_.setValue(QStringLiteral("adblock/autoUpdateRulesets"), autoUpdateRulesets_);
  settings_.sync();
  emit settingsChanged();
}

QStringList ArDaliBlockerSettings::customFilters() const { return customFilters_; }

void ArDaliBlockerSettings::setCustomFilters(const QStringList &filters) {
  customFilters_ = filters;
  settings_.setValue(QStringLiteral("blocker/customFilters"), customFilters_);
  settings_.setValue(QStringLiteral("adblock/customFilters"), customFilters_);
  settings_.sync();
  emit customFiltersChanged();
  emit filteringPlanChanged();
  emit settingsChanged();
}

QHash<QString, SitePolicy> ArDaliBlockerSettings::sitePolicies() const { return sitePolicies_; }

QString ArDaliBlockerSettings::sanitizeHost(const QString &host) const {
  QString clean = host.trimmed().toLower();
  if (clean.startsWith(QStringLiteral("http://")) || clean.startsWith(QStringLiteral("https://"))) {
    clean = QUrl(clean).host().toLower();
  }
  if (clean.startsWith(QStringLiteral("www."))) clean.remove(0, 4);
  return clean;
}

SitePolicy ArDaliBlockerSettings::sitePolicy(const QString &rawHost) const {
  const QString clean = sanitizeHost(rawHost);
  if (clean.isEmpty()) return SitePolicy{};
  // Policy lookup walks from the full hostname toward its parents, so
  // a policy for example.com also governs www.example.com and deeper hosts.
  QString candidate = clean;
  while (!candidate.isEmpty()) {
    const auto it = sitePolicies_.constFind(candidate);
    if (it != sitePolicies_.constEnd()) return it.value();
    const int dot = candidate.indexOf(QLatin1Char('.'));
    if (dot < 0) break;
    candidate.remove(0, dot + 1);
  }
  return SitePolicy{};
}

void ArDaliBlockerSettings::setSitePolicy(const QString &rawHost, const SitePolicy &policy) {
  const QString clean = sanitizeHost(rawHost);
  if (clean.isEmpty()) return;
  sitePolicies_[clean] = policy;
  save();
  emit sitePoliciesChanged();
  emit settingsChanged();
}

void ArDaliBlockerSettings::removeSitePolicy(const QString &rawHost) {
  const QString clean = sanitizeHost(rawHost);
  if (clean.isEmpty() || !sitePolicies_.contains(clean)) return;
  sitePolicies_.remove(clean);
  save();
  emit sitePoliciesChanged();
  emit settingsChanged();
}

QStringList ArDaliBlockerSettings::enabledRulesetIds() const { return enabledRulesetIds_; }
bool ArDaliBlockerSettings::rulesetSelectionConfigured() const { return rulesetSelectionConfigured_; }

void ArDaliBlockerSettings::setEnabledRulesetIds(const QStringList &ids) {
  enabledRulesetIds_ = ids;
  rulesetSelectionConfigured_ = true;
  settings_.setValue(QStringLiteral("blocker/enabledRulesetIds"), enabledRulesetIds_);
  settings_.setValue(QStringLiteral("blocker/rulesetSelectionConfigured"), true);
  settings_.setValue(QStringLiteral("adblock/enabledRulesetIds"), enabledRulesetIds_);
  settings_.setValue(QStringLiteral("adblock/rulesetSelectionConfigured"), true);
  settings_.sync();
  emit rulesetsChanged();
  emit filteringPlanChanged();
  emit settingsChanged();
}

void ArDaliBlockerSettings::load() {
  auto readSetting = [this](const QString &suffix, const QVariant &def) {
    if (settings_.contains(QStringLiteral("blocker/") + suffix)) {
      return settings_.value(QStringLiteral("blocker/") + suffix, def);
    }
    return settings_.value(QStringLiteral("adblock/") + suffix, def);
  };

  if (settings_.contains(QStringLiteral("blocker/mode")) || settings_.contains(QStringLiteral("adblock/mode"))) {
    mode_ = modeFromString(readSetting(QStringLiteral("mode"), QStringLiteral("ideal")).toString());
  } else {
    mode_ = ArDaliBlockerDefaults::Mode;
  }
  protectionEnabled_ = readSetting(QStringLiteral("protectionEnabled"),
                                   ArDaliBlockerDefaults::ProtectionEnabled).toBool();
  autoReload_ = readSetting(QStringLiteral("autoReload"), ArDaliBlockerDefaults::AutoReload).toBool();
  showCount_ = readSetting(QStringLiteral("showBlockedCount"), ArDaliBlockerDefaults::ShowCount).toBool();
  strictBlock_ = readSetting(QStringLiteral("strictBlock"), ArDaliBlockerDefaults::StrictBlock).toBool();
  popupBlock_ = readSetting(QStringLiteral("popupBlock"), ArDaliBlockerDefaults::PopupBlock).toBool();
  developerMode_ = readSetting(QStringLiteral("developerMode"), ArDaliBlockerDefaults::DeveloperMode).toBool();
  autoUpdateRulesets_ = readSetting(QStringLiteral("autoUpdateRulesets"), ArDaliBlockerDefaults::AutoUpdateRulesets).toBool();
  customFilters_ = readSetting(QStringLiteral("customFilters"), QStringList{}).toStringList();
  enabledRulesetIds_ = readSetting(QStringLiteral("enabledRulesetIds"), QStringList{}).toStringList();
  rulesetSelectionConfigured_ = readSetting(QStringLiteral("rulesetSelectionConfigured"), ArDaliBlockerDefaults::RulesetSelectionConfigured).toBool();

  sitePolicies_.clear();
  auto readSiteGroup = [this](const QString &group) -> bool {
    settings_.beginGroup(group);
    const QStringList keys = settings_.childKeys();
    if (keys.isEmpty()) {
      settings_.endGroup();
      return false;
    }
    for (const QString &host : keys) {
      QJsonObject obj = settings_.value(host).toJsonObject();
      SitePolicy p;
      p.adBlocking = obj.value(QStringLiteral("adBlocking")).toBool(true);
      p.trackerProtection = obj.value(QStringLiteral("trackerProtection")).toBool(true);
      p.whitelisted = obj.value(QStringLiteral("whitelisted")).toBool(false);
      p.temporaryDisabledUntil = obj.value(QStringLiteral("temporaryDisabledUntil")).toVariant().toLongLong();
      sitePolicies_[host] = p;
    }
    settings_.endGroup();
    return true;
  };

  if (!readSiteGroup(QStringLiteral("blocker/sites"))) {
    readSiteGroup(QStringLiteral("adblock/sites"));
  }
}

void ArDaliBlockerSettings::save() {
  auto writeSites = [this](const QString &group) {
    settings_.remove(group);
    settings_.beginGroup(group);
    for (auto it = sitePolicies_.constBegin(); it != sitePolicies_.constEnd(); ++it) {
      QJsonObject obj;
      obj[QStringLiteral("adBlocking")] = it.value().adBlocking;
      obj[QStringLiteral("trackerProtection")] = it.value().trackerProtection;
      obj[QStringLiteral("whitelisted")] = it.value().whitelisted;
      obj[QStringLiteral("temporaryDisabledUntil")] = it.value().temporaryDisabledUntil;
      settings_.setValue(it.key(), obj);
    }
    settings_.endGroup();
  };

  writeSites(QStringLiteral("blocker/sites"));
  writeSites(QStringLiteral("adblock/sites"));
  settings_.sync();
}

QJsonObject ArDaliBlockerSettings::exportBackupJson() const {
  QJsonObject root;
  root[QStringLiteral("format")] = QString::fromLatin1(kFormatName);
  root[QStringLiteral("version")] = kFormatVersion;
  root[QStringLiteral("mode")] = modeToString(mode_);
  root[QStringLiteral("protectionEnabled")] = protectionEnabled_;
  root[QStringLiteral("autoReload")] = autoReload_;
  root[QStringLiteral("showBlockedCount")] = showCount_;
  root[QStringLiteral("strictBlock")] = strictBlock_;
  root[QStringLiteral("popupBlock")] = popupBlock_;
  root[QStringLiteral("developerMode")] = developerMode_;
  root[QStringLiteral("autoUpdateRulesets")] = autoUpdateRulesets_;
  root[QStringLiteral("customFilters")] = QJsonArray::fromStringList(customFilters_);
  root[QStringLiteral("enabledRulesetIds")] = QJsonArray::fromStringList(enabledRulesetIds_);
  root[QStringLiteral("rulesetSelectionConfigured")] = rulesetSelectionConfigured_;

  QJsonObject sitesObj;
  for (auto it = sitePolicies_.constBegin(); it != sitePolicies_.constEnd(); ++it) {
    QJsonObject s;
    s[QStringLiteral("adBlocking")] = it.value().adBlocking;
    s[QStringLiteral("trackerProtection")] = it.value().trackerProtection;
    s[QStringLiteral("whitelisted")] = it.value().whitelisted;
    s[QStringLiteral("temporaryDisabledUntil")] = it.value().temporaryDisabledUntil;
    sitesObj[it.key()] = s;
  }
  root[QStringLiteral("sitePolicies")] = sitesObj;
  return root;
}

bool ArDaliBlockerSettings::importBackupJson(const QJsonObject &json) {
  // Support "ardali-blocker-settings", "ardali-deliblock-settings" and legacy formats
  const QString fmt = json.value(QStringLiteral("format")).toString();
  if (!fmt.isEmpty() && fmt != QLatin1String(kFormatName) && fmt != QLatin1String("ardali-deliblock-settings") && fmt != QLatin1String("ardali-adblock-settings")) {
    return false;
  }
  if (fmt == QLatin1String(kFormatName) || fmt == QLatin1String("ardali-deliblock-settings")) {
    const int version = json.value(QStringLiteral("version")).toInt(0);
    if (version < 1 || version > kFormatVersion) return false;
  }

  QJsonObject blockerObj = json.contains(QStringLiteral("blocker")) ? json.value(QStringLiteral("blocker")).toObject() :
                           (json.contains(QStringLiteral("adblock")) ? json.value(QStringLiteral("adblock")).toObject() : json);
  if (blockerObj.isEmpty() ||
      (!blockerObj.contains(QStringLiteral("mode")) &&
       !blockerObj.contains(QStringLiteral("customFilters")) &&
       !blockerObj.contains(QStringLiteral("sitePolicies")) &&
       !blockerObj.contains(QStringLiteral("enabledRulesetIds")))) return false;

  mode_ = modeFromString(blockerObj.value(QStringLiteral("mode")).toString());
  protectionEnabled_ = blockerObj.value(QStringLiteral("protectionEnabled"))
                           .toBool(ArDaliBlockerDefaults::ProtectionEnabled);
  autoReload_ = blockerObj.value(QStringLiteral("autoReload")).toBool(
      blockerObj.value(QStringLiteral("autoRefreshOnModeChange")).toBool(ArDaliBlockerDefaults::AutoReload));
  showCount_ = blockerObj.value(QStringLiteral("showBlockedCount")).toBool(ArDaliBlockerDefaults::ShowCount);
  strictBlock_ = blockerObj.value(QStringLiteral("strictBlock")).toBool(ArDaliBlockerDefaults::StrictBlock);
  popupBlock_ = blockerObj.value(QStringLiteral("popupBlock")).toBool(ArDaliBlockerDefaults::PopupBlock);
  developerMode_ = blockerObj.value(QStringLiteral("developerMode")).toBool(ArDaliBlockerDefaults::DeveloperMode);
  autoUpdateRulesets_ = blockerObj.value(QStringLiteral("autoUpdateRulesets")).toBool(ArDaliBlockerDefaults::AutoUpdateRulesets);

  QStringList custom;
  if (blockerObj.value(QStringLiteral("customFilters")).isArray()) {
    for (const auto &val : blockerObj.value(QStringLiteral("customFilters")).toArray()) {
      if (val.isString()) custom.append(val.toString());
      else if (val.isObject()) custom.append(val.toObject().value(QStringLiteral("text")).toString());
    }
  }
  customFilters_ = custom;

  rulesetSelectionConfigured_ = blockerObj.value(QStringLiteral("rulesetSelectionConfigured")).toBool(
      blockerObj.contains(QStringLiteral("enabledRulesetIds")));
  QStringList rulesets;
  for (const auto &val : blockerObj.value(QStringLiteral("enabledRulesetIds")).toArray()) rulesets.append(val.toString());
  if (rulesetSelectionConfigured_) {
    enabledRulesetIds_ = rulesets;
  } else {
    enabledRulesetIds_.clear();
    settings_.remove(QStringLiteral("blocker/enabledRulesetIds"));
    settings_.remove(QStringLiteral("adblock/enabledRulesetIds"));
  }

  sitePolicies_.clear();
  QJsonObject sites = blockerObj.value(QStringLiteral("sitePolicies")).toObject();
  for (auto it = sites.constBegin(); it != sites.constEnd(); ++it) {
    QJsonObject s = it.value().toObject();
    SitePolicy p;
    p.adBlocking = s.value(QStringLiteral("adBlocking")).toBool(true);
    p.trackerProtection = s.value(QStringLiteral("trackerProtection")).toBool(true);
    p.whitelisted = s.value(QStringLiteral("whitelisted")).toBool(false);
    p.temporaryDisabledUntil = s.value(QStringLiteral("temporaryDisabledUntil")).toVariant().toLongLong();
    sitePolicies_[it.key()] = p;
  }
  save();
  settings_.setValue(QStringLiteral("blocker/mode"), modeToString(mode_));
  settings_.setValue(QStringLiteral("blocker/protectionEnabled"), protectionEnabled_);
  settings_.setValue(QStringLiteral("blocker/autoReload"), autoReload_);
  settings_.setValue(QStringLiteral("blocker/showBlockedCount"), showCount_);
  settings_.setValue(QStringLiteral("blocker/strictBlock"), strictBlock_);
  settings_.setValue(QStringLiteral("blocker/popupBlock"), popupBlock_);
  settings_.setValue(QStringLiteral("blocker/developerMode"), developerMode_);
  settings_.setValue(QStringLiteral("blocker/autoUpdateRulesets"), autoUpdateRulesets_);
  settings_.setValue(QStringLiteral("blocker/customFilters"), customFilters_);
  if (rulesetSelectionConfigured_) {
    settings_.setValue(QStringLiteral("blocker/enabledRulesetIds"), enabledRulesetIds_);
  }
  settings_.setValue(QStringLiteral("blocker/rulesetSelectionConfigured"), rulesetSelectionConfigured_);

  // Legacy mirrors
  settings_.setValue(QStringLiteral("adblock/mode"), modeToString(mode_));
  settings_.setValue(QStringLiteral("adblock/protectionEnabled"), protectionEnabled_);
  settings_.setValue(QStringLiteral("adblock/autoReload"), autoReload_);
  settings_.setValue(QStringLiteral("adblock/showBlockedCount"), showCount_);
  settings_.setValue(QStringLiteral("adblock/strictBlock"), strictBlock_);
  settings_.setValue(QStringLiteral("adblock/popupBlock"), popupBlock_);
  settings_.setValue(QStringLiteral("adblock/developerMode"), developerMode_);
  settings_.setValue(QStringLiteral("adblock/autoUpdateRulesets"), autoUpdateRulesets_);
  settings_.setValue(QStringLiteral("adblock/customFilters"), customFilters_);
  if (rulesetSelectionConfigured_) {
    settings_.setValue(QStringLiteral("adblock/enabledRulesetIds"), enabledRulesetIds_);
  }
  settings_.setValue(QStringLiteral("adblock/rulesetSelectionConfigured"), rulesetSelectionConfigured_);

  settings_.sync();
  emit modeChanged(mode_);
  emit protectionEnabledChanged(protectionEnabled_);
  emit toolbarCountVisibilityChanged(showCount_);
  emit popupBlockChanged(popupBlock_);
  emit customFiltersChanged();
  emit rulesetsChanged();
  emit sitePoliciesChanged();
  emit filteringPlanChanged();
  emit settingsChanged();
  return true;
}

void ArDaliBlockerSettings::resetToDefaults() {
  mode_ = ArDaliBlockerDefaults::Mode;
  protectionEnabled_ = ArDaliBlockerDefaults::ProtectionEnabled;
  autoReload_ = ArDaliBlockerDefaults::AutoReload;
  showCount_ = ArDaliBlockerDefaults::ShowCount;
  strictBlock_ = ArDaliBlockerDefaults::StrictBlock;
  popupBlock_ = ArDaliBlockerDefaults::PopupBlock;
  developerMode_ = ArDaliBlockerDefaults::DeveloperMode;
  autoUpdateRulesets_ = ArDaliBlockerDefaults::AutoUpdateRulesets;
  customFilters_.clear();
  sitePolicies_.clear();
  enabledRulesetIds_.clear();
  rulesetSelectionConfigured_ = ArDaliBlockerDefaults::RulesetSelectionConfigured;

  settings_.remove(QStringLiteral("blocker"));
  settings_.remove(QStringLiteral("adblock"));

  settings_.setValue(QStringLiteral("blocker/mode"), modeToString(mode_));
  settings_.setValue(QStringLiteral("blocker/protectionEnabled"), protectionEnabled_);
  settings_.setValue(QStringLiteral("blocker/autoReload"), autoReload_);
  settings_.setValue(QStringLiteral("blocker/showBlockedCount"), showCount_);
  settings_.setValue(QStringLiteral("blocker/strictBlock"), strictBlock_);
  settings_.setValue(QStringLiteral("blocker/popupBlock"), popupBlock_);
  settings_.setValue(QStringLiteral("blocker/developerMode"), developerMode_);
  settings_.setValue(QStringLiteral("blocker/autoUpdateRulesets"), autoUpdateRulesets_);

  // Legacy mirrors
  settings_.setValue(QStringLiteral("adblock/mode"), modeToString(mode_));
  settings_.setValue(QStringLiteral("adblock/protectionEnabled"), protectionEnabled_);
  settings_.setValue(QStringLiteral("adblock/autoReload"), autoReload_);
  settings_.setValue(QStringLiteral("adblock/showBlockedCount"), showCount_);
  settings_.setValue(QStringLiteral("adblock/strictBlock"), strictBlock_);
  settings_.setValue(QStringLiteral("adblock/popupBlock"), popupBlock_);
  settings_.setValue(QStringLiteral("adblock/developerMode"), developerMode_);
  settings_.setValue(QStringLiteral("adblock/autoUpdateRulesets"), autoUpdateRulesets_);
  settings_.sync();

  emit modeChanged(mode_);
  emit protectionEnabledChanged(protectionEnabled_);
  emit toolbarCountVisibilityChanged(showCount_);
  emit popupBlockChanged(popupBlock_);
  emit customFiltersChanged();
  emit sitePoliciesChanged();
  emit rulesetsChanged();
  emit filteringPlanChanged();
  emit settingsChanged();
}
