#pragma once

#include <QDateTime>
#include <QHash>
#include <QJsonObject>
#include <QList>
#include <QMutex>
#include <QObject>
#include <QPair>
#include <QString>

#include "ardali_blocker_types.h"

struct FilterListInfo {
  QString id;
  QString name;
  QString group;
  QString description;
  bool enabled = true;
  int ruleCount = 0;
  QDateTime lastUpdated;
  QString localFilePath;
  QString downloadUrl;
  QString version;
};

class ArDaliBlockerListManager final : public QObject {
  Q_OBJECT
 public:
  explicit ArDaliBlockerListManager(const QString &dataDir, QObject *parent = nullptr);
  ~ArDaliBlockerListManager() override = default;

  QList<FilterListInfo> availableLists() const;
  QStringList resolveRulesetIds(ArDaliBlockerMode mode, const QStringList &enabledIds,
                                bool selectionConfigured) const;
  QList<FilterRule> loadRulesForModeAndSelection(ArDaliBlockerMode mode, const QStringList &enabledIds,
                                                  bool selectionConfigured = false,
                                                  bool strictBlock = false);
  QString loadCosmeticCssForSelection(const QStringList &enabledIds, bool selectionConfigured = false) const;
  QString loadSpecificCosmeticCssForHost(const QString &host, const QStringList &enabledIds,
                                         bool selectionConfigured = false) const;
  QJsonArray loadProceduralRulesForHost(const QString &host, const QStringList &enabledIds,
                                        bool selectionConfigured = false) const;
  // Returns generated assets as {world, source}.
  QList<QPair<QString, QString>> loadScriptingSourcesForHost(const QString &host,
                                                             const QStringList &enabledIds,
                                                             bool selectionConfigured = false) const;

  void invalidateCaches();
  QString rulesetDir() const;

 signals:
 private:
  void initRulesetCatalog();
  QString findRulesetFilePath(const QString &fileName) const;
  QList<FilterRule> parseRulesetFile(const QString &filePath, const QString &rulesetId);
  QJsonObject cachedScriptingJson(const QString &path) const;

  QString dataDir_;
  mutable QMutex mutex_;
  QList<FilterListInfo> lists_;
  mutable QHash<QString, QString> scriptingSourceCache_;
  mutable QHash<QString, QJsonObject> scriptingJsonCache_;
  mutable QHash<QString, bool> scriptingApplicabilityCache_;
};

using AdBlockFilterListManager = ArDaliBlockerListManager;
