#pragma once

#include <QDateTime>
#include <QJsonArray>
#include <QJsonObject>
#include <QSet>
#include <QString>
#include <QUrl>

enum class ArDaliBlockerMode {
  Basic = 0,     // Hafif filtreleme, site uyumluluğu yüksek
  Ideal = 1,     // Dengeli filtreleme (Varsayılan)
  Aggressive = 2 // Güçlü / Kapsamlı filtreleme, YouTube sinyalleri, görünür temizlik
};

using BlockerMode = ArDaliBlockerMode;
using AdBlockMode = ArDaliBlockerMode;

enum class ArDaliBlockerResourceType {
  MainFrame,
  SubFrame,
  Stylesheet,
  Script,
  Image,
  Font,
  Object,
  Xhr,
  Ping,
  CspReport,
  Media,
  WebSocket,
  Favicon,
  Other
};

using BlockerResourceType = ArDaliBlockerResourceType;
using AdBlockResourceType = ArDaliBlockerResourceType;

enum class ArDaliBlockerAction {
  Allow,
  Block,
  Redirect,
  ModifyHeaders
};

using BlockerAction = ArDaliBlockerAction;
using AdBlockAction = ArDaliBlockerAction;

struct SitePolicy {
  bool adBlocking = true;
  bool trackerProtection = true;
  bool whitelisted = false;
  qint64 temporaryDisabledUntil = 0;
};

struct FilterRule {
  qint64 id = 0;
  int priority = 1;
  QString actionType; // "allow", "block", "redirect", "modifyHeaders", "upgradeScheme"
  QString urlFilter;
  QString regexFilter;
  bool isCaseSensitive = false;
  QSet<QString> requestDomains;
  QSet<QString> excludedRequestDomains;
  QSet<QString> initiatorDomains;
  QSet<QString> excludedInitiatorDomains;
  QSet<ArDaliBlockerResourceType> resourceTypes;
  QSet<ArDaliBlockerResourceType> excludedResourceTypes;
  QSet<QString> requestMethods;
  QSet<QString> excludedRequestMethods;
  QString domainType; // "thirdParty", "firstParty", ""
  QString rulesetId;
  QString redirectUrl;
  QJsonObject redirectTransform;
  QString regexSubstitution;
  bool unsupportedHeaderCondition = false;
};

using BlockerRule = FilterRule;

struct RequestDecision {
  ArDaliBlockerAction action = ArDaliBlockerAction::Allow;
  QString reason;
  qint64 ruleId = 0;
  QString rulesetId;
  QString redirectUrl;
};

using BlockerDecision = RequestDecision;

struct TabBlockerStats {
  quint64 blockedRequests = 0;
  quint64 allowedRequests = 0;
  quint64 redirectedRequests = 0;
  quint64 blockedAds = 0;
  quint64 blockedTrackers = 0;
};

using TabAdBlockStats = TabBlockerStats;
using TabArDaliBlockerStats = TabBlockerStats;

struct NetworkLogEntry {
  QDateTime timestamp;
  quint64 tabId = 0;
  QString siteHost; // Compatibility alias for requestHost.
  QString requestHost;
  QString initiatorHost;
  QString topLevelSite;
  QString requestMethod;
  QString resourceTypeStr;
  QString requestUrl;
  ArDaliBlockerAction action = ArDaliBlockerAction::Allow;
  QString reason;
  QString rulesetId;
  qint64 ruleId = 0;
};

inline QString modeToString(ArDaliBlockerMode mode) {
  switch (mode) {
    case ArDaliBlockerMode::Basic: return QStringLiteral("basic");
    case ArDaliBlockerMode::Aggressive: return QStringLiteral("aggressive");
    case ArDaliBlockerMode::Ideal:
    default: return QStringLiteral("ideal");
  }
}

inline ArDaliBlockerMode modeFromString(const QString &str) {
  const QString lower = str.trimmed().toLower();
  if (lower == QLatin1String("basic")) return ArDaliBlockerMode::Basic;
  if (lower == QLatin1String("aggressive") || lower == QLatin1String("kapsamli")) return ArDaliBlockerMode::Aggressive;
  return ArDaliBlockerMode::Ideal;
}

inline ArDaliBlockerResourceType resourceTypeFromWebEngine(int type) {
  switch (type) {
    case 0: return ArDaliBlockerResourceType::MainFrame;
    case 1: return ArDaliBlockerResourceType::SubFrame;
    case 2: return ArDaliBlockerResourceType::Stylesheet;
    case 3: return ArDaliBlockerResourceType::Script;
    case 4: return ArDaliBlockerResourceType::Image;
    case 5: return ArDaliBlockerResourceType::Font;
    case 6: return ArDaliBlockerResourceType::SubFrame;
    case 7: return ArDaliBlockerResourceType::Object;
    case 8: return ArDaliBlockerResourceType::Media;
    case 9: return ArDaliBlockerResourceType::Other;
    case 10: return ArDaliBlockerResourceType::Other;
    case 11: return ArDaliBlockerResourceType::Other;
    case 12: return ArDaliBlockerResourceType::Favicon;
    case 13: return ArDaliBlockerResourceType::Xhr;
    case 14: return ArDaliBlockerResourceType::Ping;
    case 15: return ArDaliBlockerResourceType::Other;
    case 16: return ArDaliBlockerResourceType::CspReport;
    case 17: return ArDaliBlockerResourceType::Other;
    case 18: return ArDaliBlockerResourceType::Other;
    case 19: return ArDaliBlockerResourceType::MainFrame; // navigation preload
    case 20: return ArDaliBlockerResourceType::SubFrame;  // navigation preload
    case 254: return ArDaliBlockerResourceType::WebSocket;
    default: return ArDaliBlockerResourceType::Other;
  }
}

inline QString resourceTypeToString(ArDaliBlockerResourceType type) {
  switch (type) {
    case ArDaliBlockerResourceType::MainFrame: return QStringLiteral("main_frame");
    case ArDaliBlockerResourceType::SubFrame: return QStringLiteral("sub_frame");
    case ArDaliBlockerResourceType::Stylesheet: return QStringLiteral("stylesheet");
    case ArDaliBlockerResourceType::Script: return QStringLiteral("script");
    case ArDaliBlockerResourceType::Image: return QStringLiteral("image");
    case ArDaliBlockerResourceType::Font: return QStringLiteral("font");
    case ArDaliBlockerResourceType::Object: return QStringLiteral("object");
    case ArDaliBlockerResourceType::Xhr: return QStringLiteral("xmlhttprequest");
    case ArDaliBlockerResourceType::Ping: return QStringLiteral("ping");
    case ArDaliBlockerResourceType::CspReport: return QStringLiteral("csp_report");
    case ArDaliBlockerResourceType::Media: return QStringLiteral("media");
    case ArDaliBlockerResourceType::WebSocket: return QStringLiteral("websocket");
    case ArDaliBlockerResourceType::Favicon: return QStringLiteral("favicon");
    case ArDaliBlockerResourceType::Other:
    default: return QStringLiteral("other");
  }
}

inline ArDaliBlockerResourceType resourceTypeFromString(const QString &str) {
  const QString s = str.trimmed().toLower();
  if (s == QLatin1String("main_frame") || s == QLatin1String("mainframe")) return ArDaliBlockerResourceType::MainFrame;
  if (s == QLatin1String("sub_frame") || s == QLatin1String("subframe") || s == QLatin1String("subdocument") || s == QLatin1String("frame")) return ArDaliBlockerResourceType::SubFrame;
  if (s == QLatin1String("stylesheet")) return ArDaliBlockerResourceType::Stylesheet;
  if (s == QLatin1String("script")) return ArDaliBlockerResourceType::Script;
  if (s == QLatin1String("image")) return ArDaliBlockerResourceType::Image;
  if (s == QLatin1String("font")) return ArDaliBlockerResourceType::Font;
  if (s == QLatin1String("object")) return ArDaliBlockerResourceType::Object;
  if (s == QLatin1String("xmlhttprequest") || s == QLatin1String("xhr") || s == QLatin1String("fetch")) return ArDaliBlockerResourceType::Xhr;
  if (s == QLatin1String("ping")) return ArDaliBlockerResourceType::Ping;
  if (s == QLatin1String("csp_report")) return ArDaliBlockerResourceType::CspReport;
  if (s == QLatin1String("media")) return ArDaliBlockerResourceType::Media;
  if (s == QLatin1String("websocket")) return ArDaliBlockerResourceType::WebSocket;
  if (s == QLatin1String("favicon")) return ArDaliBlockerResourceType::Favicon;
  return ArDaliBlockerResourceType::Other;
}
