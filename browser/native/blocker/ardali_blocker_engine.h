#pragma once

#include <QHash>
#include <QList>
#include <QMutex>
#include <QRegularExpression>
#include <QSet>
#include <QString>
#include <QStringList>
#include <QUrl>
#include <QVector>
#include <array>

#include "ardali_blocker_types.h"

struct CosmeticRule {
  QString domain; // Empty for generic rules
  QString selector;
  bool isException = false;
};

struct ProceduralCosmeticRule {
  QString domain;
  QString signature;
  QJsonObject rule;
  bool isException = false;
};

struct CompiledBlockerPlan {
  QList<FilterRule> rules;
  QList<FilterRule> customRules;
  QList<CosmeticRule> cosmeticRules;
  QList<ProceduralCosmeticRule> proceduralRules;
  QString listCosmeticCss;
  std::array<QVector<int>, 14> ruleIndicesByResource;
  QHash<QString, QVector<int>> ruleIndicesByDomain;
  QHash<QString, QVector<int>> ruleIndicesByToken;
  QVector<int> universalRuleIndices;
};

using CompiledAdBlockPlan = CompiledBlockerPlan;

class ArDaliBlockerEngine final {
 public:
  ArDaliBlockerEngine();
  ~ArDaliBlockerEngine() = default;

  void clearRules();
  void loadRules(const QList<FilterRule> &rules);
  void setListCosmeticCss(const QString &css);
  void addCustomFilterLines(const QStringList &lines);
  static CompiledBlockerPlan compilePlan(QList<FilterRule> rules, const QString &listCosmeticCss,
                                         const QStringList &customLines);
  void applyCompiledPlan(CompiledBlockerPlan plan);

  RequestDecision evaluate(const QUrl &url, ArDaliBlockerResourceType resourceType,
                           const QString &initiatorHost, ArDaliBlockerMode mode,
                           const SitePolicy &policy,
                           const QString &requestMethod = QStringLiteral("get")) const;

  QString cosmeticCssForHost(const QString &host) const;
  QJsonArray customProceduralRulesForHost(const QString &host) const;
  int ruleCount() const;
  int customRuleCount() const;
  // Empty means valid; otherwise this is suitable for showing beside the editor.
  static QString validateCustomFilterLine(const QString &line);

 private:
  bool domainMatches(const QString &host, const QString &ruleDomain) const;
  bool isSameSite(const QString &hostA, const QString &hostB) const;
  QString getSiteDomain(const QString &host) const;
  bool urlFilterMatches(const QString &urlFilter, const QString &url, const QString &host,
                        bool caseSensitive = false) const;

  mutable QMutex mutex_;
  QList<FilterRule> rules_;
  std::array<QVector<int>, 14> ruleIndicesByResource_;
  QHash<QString, QVector<int>> ruleIndicesByDomain_;
  QHash<QString, QVector<int>> ruleIndicesByToken_;
  QVector<int> universalRuleIndices_;
  QList<FilterRule> customRules_;
  QList<CosmeticRule> cosmeticRules_;
  QList<ProceduralCosmeticRule> proceduralRules_;
  QString listCosmeticCss_;
  mutable QHash<QString, QRegularExpression> regexCache_;
};

using AdBlockFilterEngine = ArDaliBlockerEngine;
