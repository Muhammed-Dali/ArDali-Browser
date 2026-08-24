#include "ardali_blocker_list_manager.h"

#include <QCoreApplication>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QMimeDatabase>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QMutexLocker>
#include <QRegularExpression>

ArDaliBlockerListManager::ArDaliBlockerListManager(const QString &dataDir, QObject *parent)
    : QObject(parent), dataDir_(dataDir) {
  initRulesetCatalog();
}

QString ArDaliBlockerListManager::rulesetDir() const {
  const QStringList candidates = {
      dataDir_ + QStringLiteral("/adblock/rulesets"),
      dataDir_ + QStringLiteral("/rulesets"),
      QCoreApplication::applicationDirPath() + QStringLiteral("/resources/adblock/rulesets"),
      QCoreApplication::applicationDirPath() + QStringLiteral("/../resources/adblock/rulesets")
  };
  for (const QString &path : candidates) {
    if (QDir(path).exists()) return path;
  }
  return QString();
}

QString ArDaliBlockerListManager::findRulesetFilePath(const QString &fileName) const {
  const QString baseDir = rulesetDir();
  if (baseDir.isEmpty()) return QString();

  const QStringList subPaths = {
      baseDir + QStringLiteral("/main/") + fileName,
      baseDir + QStringLiteral("/") + fileName
  };
  for (const QString &p : subPaths) {
    if (QFileInfo::exists(p)) return p;
  }
  return QString();
}

void ArDaliBlockerListManager::initRulesetCatalog() {
  QMutexLocker locker(&mutex_);
  lists_.clear();

  const QString baseDir = rulesetDir();
  const QString detailsPath = baseDir + QStringLiteral("/ruleset-details.json");

  if (QFileInfo::exists(detailsPath)) {
    const QFileInfo detailsInfo(detailsPath);
    const QDateTime packageTimestamp = detailsInfo.lastModified();
    QFile file(detailsPath);
    if (file.open(QIODevice::ReadOnly)) {
      const QJsonDocument doc = QJsonDocument::fromJson(file.readAll());
      if (doc.isArray()) {
        for (const auto &val : doc.array()) {
          if (!val.isObject()) continue;
          const QJsonObject obj = val.toObject();
          FilterListInfo info;
          info.id = obj.value(QStringLiteral("id")).toString();
          info.name = obj.value(QStringLiteral("name")).toString(info.id);
          info.group = obj.value(QStringLiteral("group")).toString(QStringLiteral("default"));
          info.enabled = obj.value(QStringLiteral("enabled")).toBool(true);
          info.downloadUrl = obj.value(QStringLiteral("homeURL")).toString();
          info.version = packageTimestamp.isValid()
              ? QStringLiteral("bundled-%1").arg(packageTimestamp.date().toString(QStringLiteral("yyyyMMdd")))
              : QStringLiteral("bundled");
          info.localFilePath = info.id + QStringLiteral(".json");
          info.lastUpdated = packageTimestamp;

          const QJsonObject rulesObj = obj.value(QStringLiteral("rules")).toObject();
          info.ruleCount = rulesObj.value(QStringLiteral("total")).toInt(1000);

          lists_.append(info);
        }
      }
    }
  }

  if (lists_.isEmpty()) {
    // Fallback standard catalog
    lists_.append(FilterListInfo{
        QStringLiteral("default-0"), QStringLiteral("ArDali Temel Reklam Engelleyici"), QStringLiteral("default"),
        QStringLiteral("Genel web reklamlarını engellemeye yönelik temel kural seti."), true, 24500,
        QDateTime::currentDateTime(), QStringLiteral("default-0.json"), QString(), QStringLiteral("bundled")});

    lists_.append(FilterListInfo{
        QStringLiteral("easyprivacy"), QStringLiteral("EasyPrivacy - Gizlilik ve İzleyici Koruması"), QStringLiteral("privacy"),
        QStringLiteral("Web sitelerindeki izleme ve analitik komut dosyalarını engeller."), true, 18200,
        QDateTime::currentDateTime(), QStringLiteral("easyprivacy.json"), QString(), QStringLiteral("bundled")});

    lists_.append(FilterListInfo{
        QStringLiteral("tur-0"), QStringLiteral("Türkçe Filtre Listesi (ArDali TR)"), QStringLiteral("regional"),
        QStringLiteral("Türkiye odaklı web sitelerindeki özel reklam ve popup kuralları."), true, 4100,
        QDateTime::currentDateTime(), QStringLiteral("tur-0.json"), QString(), QStringLiteral("bundled")});

    lists_.append(FilterListInfo{
        QStringLiteral("annoyances-cookies"), QStringLiteral("Rahatsız Edici Çerez Uyarıları Koruması"), QStringLiteral("annoyances"),
        QStringLiteral("Çerez uyarıları, haber bülteni açılır pencereleri ve rahatsız edici öğeleri engeller."), false, 9500,
        QDateTime::currentDateTime(), QStringLiteral("annoyances-cookies.json"), QString(), QStringLiteral("bundled")});

    lists_.append(FilterListInfo{
        QStringLiteral("annoyances-social"), QStringLiteral("Sosyal Medya Düğmeleri ve Widget'ları"), QStringLiteral("social"),
        QStringLiteral("Sayfalara gömülü sosyal takip butonlarını engeller."), false, 3200,
        QDateTime::currentDateTime(), QStringLiteral("annoyances-social.json"), QString(), QStringLiteral("bundled")});
  }
}

QList<FilterListInfo> ArDaliBlockerListManager::availableLists() const {
  QMutexLocker locker(&mutex_);
  return lists_;
}

QStringList ArDaliBlockerListManager::resolveRulesetIds(ArDaliBlockerMode mode, const QStringList &enabledIds,
                                                         bool selectionConfigured) const {
  if (selectionConfigured) return enabledIds;
  QList<FilterListInfo> lists;
  {
    QMutexLocker locker(&mutex_);
    lists = lists_;
  }
  const QString baseDir = rulesetDir();
  QStringList resolved;
  for (const auto &info : lists) {
    const bool defaultId = info.enabled &&
        QFileInfo::exists(baseDir + QStringLiteral("/main/") + info.id + QStringLiteral(".json"));
    bool include = false;
    if (mode == ArDaliBlockerMode::Basic)
      include = defaultId && info.group == QLatin1String("default");
    else if (mode == ArDaliBlockerMode::Ideal)
      include = defaultId || info.id == QLatin1String("tur-0");
    else
      include = defaultId || info.id == QLatin1String("tur-0") ||
                info.id == QLatin1String("ublock-experimental");
    if (include) resolved.append(info.id);
  }
  return resolved;
}

QList<FilterRule> ArDaliBlockerListManager::parseRulesetFile(const QString &filePath, const QString &rulesetId) {
  QList<FilterRule> out;
  QFile file(filePath);
  if (!file.open(QIODevice::ReadOnly)) return out;
  const QJsonDocument doc = QJsonDocument::fromJson(file.readAll());
  if (!doc.isArray()) return out;

  const QJsonArray arr = doc.array();
  qint64 idCounter = 1;
  for (const auto &val : arr) {
    if (!val.isObject()) continue;
    const QJsonObject obj = val.toObject();
    const QJsonObject action = obj.value(QStringLiteral("action")).toObject();
    const QJsonObject condition = obj.value(QStringLiteral("condition")).toObject();

    FilterRule rule;
    rule.id = obj.value(QStringLiteral("id")).toVariant().toLongLong();
    if (rule.id <= 0) rule.id = ++idCounter;
    rule.priority = obj.value(QStringLiteral("priority")).toInt(1);
    rule.actionType = action.value(QStringLiteral("type")).toString(QStringLiteral("block"));
    rule.urlFilter = condition.value(QStringLiteral("urlFilter")).toString();
    rule.regexFilter = condition.value(QStringLiteral("regexFilter")).toString();
    rule.isCaseSensitive = condition.value(QStringLiteral("isUrlFilterCaseSensitive")).toBool(false);
    rule.rulesetId = rulesetId;
    rule.domainType = condition.value(QStringLiteral("domainType")).toString();

    if (action.value(QStringLiteral("redirect")).isObject()) {
      const QJsonObject redirect = action.value(QStringLiteral("redirect")).toObject();
      rule.redirectUrl = redirect.value(QStringLiteral("url")).toString();
      rule.redirectTransform = redirect.value(QStringLiteral("transform")).toObject();
      rule.regexSubstitution = redirect.value(QStringLiteral("regexSubstitution")).toString();
      // uBO-Lite DNR files commonly refer to web-accessible resources through
      // extensionPath. Resolve those assets at compile time just as the legacy
      // engine does, so redirect rules are not silently converted into blocks
      // or no-ops.
      if (rule.redirectUrl.isEmpty()) {
        const QString extensionPath = redirect.value(QStringLiteral("extensionPath")).toString();
        const QString name = QFileInfo(extensionPath).fileName();
        if (!name.isEmpty()) {
          const QDir adblockDir(QDir(QFileInfo(filePath).dir()).absoluteFilePath(QStringLiteral("../..")));
          QFile resource(adblockDir.absoluteFilePath(QStringLiteral("web_accessible_resources/") + name));
          if (resource.open(QIODevice::ReadOnly)) {
            const QString mime = QMimeDatabase().mimeTypeForFile(name).name();
            rule.redirectUrl = QStringLiteral("data:%1;base64,%2")
                .arg(mime.isEmpty() ? QStringLiteral("application/octet-stream") : mime,
                     QString::fromLatin1(resource.readAll().toBase64()));
          }
        }
      }
    }

    // Resource Types
    const QJsonArray resTypes = condition.value(QStringLiteral("resourceTypes")).toArray();
    for (const auto &t : resTypes) rule.resourceTypes.insert(resourceTypeFromString(t.toString()));

    const QJsonArray excResTypes = condition.value(QStringLiteral("excludedResourceTypes")).toArray();
    for (const auto &t : excResTypes) rule.excludedResourceTypes.insert(resourceTypeFromString(t.toString()));

    const QJsonArray requestMethods = condition.value(QStringLiteral("requestMethods")).toArray();
    for (const auto &method : requestMethods) rule.requestMethods.insert(method.toString().toLower());
    const QJsonArray excludedRequestMethods = condition.value(QStringLiteral("excludedRequestMethods")).toArray();
    for (const auto &method : excludedRequestMethods) rule.excludedRequestMethods.insert(method.toString().toLower());
    // QWebEngineUrlRequestInterceptor runs before response headers exist. Such
    // conditions must fail open; evaluating them as unconditional rules causes
    // false blocks (including media/player requests).
    rule.unsupportedHeaderCondition = !condition.value(QStringLiteral("requestHeaders")).toArray().isEmpty() ||
                                      !condition.value(QStringLiteral("responseHeaders")).toArray().isEmpty();

    // Domains
    const QJsonArray reqDomains = condition.value(QStringLiteral("requestDomains")).toArray();
    for (const auto &d : reqDomains) rule.requestDomains.insert(d.toString().toLower());

    const QJsonArray excReqDomains = condition.value(QStringLiteral("excludedRequestDomains")).toArray();
    for (const auto &d : excReqDomains) rule.excludedRequestDomains.insert(d.toString().toLower());

    const QJsonArray initDomains = condition.value(QStringLiteral("initiatorDomains")).toArray();
    for (const auto &d : initDomains) rule.initiatorDomains.insert(d.toString().toLower());

    const QJsonArray excInitDomains = condition.value(QStringLiteral("excludedInitiatorDomains")).toArray();
    for (const auto &d : excInitDomains) rule.excludedInitiatorDomains.insert(d.toString().toLower());

    out.append(rule);
  }
  return out;
}

namespace {
QJsonArray generatedArray(const QString &source, const QString &name) {
  const QString marker = QStringLiteral("const %1").arg(name);
  const int declaration = source.indexOf(marker);
  if (declaration < 0) return {};
  const int begin = source.indexOf(QLatin1Char('['), declaration + marker.size());
  if (begin < 0) return {};
  const int end = source.indexOf(QStringLiteral("];"), begin);
  if (end < 0) return {};
  const QJsonDocument document = QJsonDocument::fromJson(source.mid(begin, end - begin + 1).toUtf8());
  return document.isArray() ? document.array() : QJsonArray{};
}

bool generatedScriptletAppliesToHost(const QString &source, const QString &rawHost) {
  const QString host = rawHost.trimmed().toLower();
  if (host.isEmpty()) return false;
  const QJsonArray indexedHosts = generatedArray(source, QStringLiteral("$scriptletHostnames$"));
  if (indexedHosts.isEmpty()) return false;

  QSet<QString> candidates{host, QStringLiteral("*")};
  const QStringList parts = host.split(QLatin1Char('.'), Qt::SkipEmptyParts);
  for (int i = 0; i < parts.size(); ++i) candidates.insert(parts.mid(i).join(QLatin1Char('.')));
  if (parts.size() > 1) {
    const int n = parts.size() - 1;
    for (int i = 0; i < n; ++i)
      for (int j = n; j > i; --j)
        candidates.insert(parts.mid(i, j - i).join(QLatin1Char('.')) + QStringLiteral(".*"));
  }
  for (const QJsonValue &value : indexedHosts) {
    if (candidates.contains(value.toString())) return true;
  }

  const QJsonArray regexEntries = generatedArray(source, QStringLiteral("$scriptletFromRegexes$"));
  for (int i = 0; i + 2 < regexEntries.size(); i += 3) {
    if (!host.contains(regexEntries.at(i).toString())) continue;
    const QRegularExpression expression(regexEntries.at(i + 1).toString());
    if (expression.isValid() && expression.match(host).hasMatch()) return true;
  }
  return false;
}

const QString kNoopJs = QStringLiteral("data:application/javascript;base64,InVzZSBzdHJpY3QiOwp2b2lkIDA7Cg==");
const QString kNoopJson = QStringLiteral("data:application/json;base64,e30=");
// uBOL's safe resource substitution for doubleclick.net/instream/ad_status.js.
// It preserves the tiny player-facing API without loading the remote ad script
// and does not emit any impression, completion, playback, or click telemetry.
const QString kDoubleClickInstreamStatusJs =
    QStringLiteral("data:application/javascript;base64,d2luZG93Lmdvb2dsZV9hZF9zdGF0dXMgPSAxOwo=");

const QSet<QString> kYouTubeInitiators = {
    QStringLiteral("youtube.com"),
    QStringLiteral("www.youtube.com"),
    QStringLiteral("m.youtube.com"),
    QStringLiteral("music.youtube.com")
};

QList<FilterRule> getBuiltinCoreRules() {
  QList<FilterRule> list;

  // 1. ADBLOCK_NOOP_DNR_RULES (priority: 65)
  {
    FilterRule r;
    r.id = 1100003; r.priority = 65; r.actionType = QStringLiteral("redirect");
    r.urlFilter = QStringLiteral("||www.googletagservices.com/tag/js/gpt.js");
    r.resourceTypes = {ArDaliBlockerResourceType::Script};
    r.redirectUrl = kNoopJs;
    r.rulesetId = QStringLiteral("ardali-noop");
    list.append(r);
  }
  {
    FilterRule r;
    r.id = 1100004; r.priority = 65; r.actionType = QStringLiteral("redirect");
    r.urlFilter = QStringLiteral("||www.google-analytics.com/analytics.js");
    r.resourceTypes = {ArDaliBlockerResourceType::Script};
    r.redirectUrl = kNoopJs;
    r.rulesetId = QStringLiteral("ardali-noop");
    list.append(r);
  }
  {
    FilterRule r;
    r.id = 1100005; r.priority = 65; r.actionType = QStringLiteral("redirect");
    r.urlFilter = QStringLiteral("||www.google-analytics.com/gtag/js");
    r.resourceTypes = {ArDaliBlockerResourceType::Script};
    r.redirectUrl = kNoopJs;
    r.rulesetId = QStringLiteral("ardali-noop");
    list.append(r);
  }
  {
    FilterRule r;
    r.id = 1100006; r.priority = 65; r.actionType = QStringLiteral("redirect");
    r.urlFilter = QStringLiteral("/pagead/ppub_config");
    r.resourceTypes = {ArDaliBlockerResourceType::Xhr};
    r.redirectUrl = kNoopJson;
    r.rulesetId = QStringLiteral("ardali-noop");
    list.append(r);
  }

  // 2. ADBLOCK_YOUTUBE_DNR_RULES (Source of Truth: ArDali-WebMedia/main.js lines 3740-3890)
  // 2a. YouTube Core Allow Rules (priority: 90)
  {
    FilterRule r;
    r.id = 1000000; r.priority = 90; r.actionType = QStringLiteral("allow");
    r.initiatorDomains = kYouTubeInitiators;
    r.requestDomains = {
        QStringLiteral("i.ytimg.com"),
        QStringLiteral("yt3.ggpht.com"),
        QStringLiteral("ggpht.com"),
        QStringLiteral("youtube.com"),
        QStringLiteral("www.youtube.com"),
        QStringLiteral("m.youtube.com"),
        QStringLiteral("music.youtube.com"),
        QStringLiteral("youtubei.googleapis.com")
    };
    r.resourceTypes = {
        ArDaliBlockerResourceType::Script,
        ArDaliBlockerResourceType::Xhr,
        ArDaliBlockerResourceType::Image,
        ArDaliBlockerResourceType::Stylesheet,
        ArDaliBlockerResourceType::Font
    };
    r.rulesetId = QStringLiteral("ardali-youtube-core");
    list.append(r);
  }
  {
    FilterRule r;
    r.id = 1000011; r.priority = 90; r.actionType = QStringLiteral("allow");
    r.initiatorDomains = kYouTubeInitiators;
    r.requestDomains = {QStringLiteral("googlevideo.com")};
    r.resourceTypes = {ArDaliBlockerResourceType::Media, ArDaliBlockerResourceType::Xhr};
    r.rulesetId = QStringLiteral("ardali-youtube-core");
    list.append(r);
  }

  // 2b. YouTube Targeted Ad Blocks & Redirects (priority: 110)
  {
    FilterRule r;
    r.id = 1000006; r.priority = 120; r.actionType = QStringLiteral("redirect");
    r.initiatorDomains = kYouTubeInitiators;
    r.urlFilter = QStringLiteral("||static.doubleclick.net/instream/ad_status.js|");
    r.resourceTypes = {ArDaliBlockerResourceType::Script, ArDaliBlockerResourceType::Xhr};
    r.redirectUrl = kDoubleClickInstreamStatusJs;
    r.rulesetId = QStringLiteral("ardali-youtube-safe-resource");
    list.append(r);
  }
  {
    FilterRule r;
    r.id = 1000001; r.priority = 110; r.actionType = QStringLiteral("block");
    r.initiatorDomains = kYouTubeInitiators;
    r.requestDomains = {
        QStringLiteral("ad.doubleclick.net"),
        QStringLiteral("googleads.g.doubleclick.net"),
        QStringLiteral("pagead2.googlesyndication.com"),
        QStringLiteral("tpc.googlesyndication.com"),
        QStringLiteral("static.doubleclick.net")
    };
    r.resourceTypes = {
        ArDaliBlockerResourceType::Script,
        ArDaliBlockerResourceType::Xhr,
        ArDaliBlockerResourceType::SubFrame,
        ArDaliBlockerResourceType::Image,
        ArDaliBlockerResourceType::Media
    };
    r.rulesetId = QStringLiteral("ardali-youtube");
    list.append(r);
  }
  {
    FilterRule r;
    r.id = 1000002; r.priority = 110; r.actionType = QStringLiteral("block");
    r.initiatorDomains = kYouTubeInitiators;
    r.urlFilter = QStringLiteral("||youtube.com/pagead/");
    r.resourceTypes = {
        ArDaliBlockerResourceType::Script,
        ArDaliBlockerResourceType::Xhr,
        ArDaliBlockerResourceType::SubFrame,
        ArDaliBlockerResourceType::Image
    };
    r.rulesetId = QStringLiteral("ardali-youtube");
    list.append(r);
  }
  {
    FilterRule r;
    r.id = 1000003; r.priority = 110; r.actionType = QStringLiteral("block");
    r.initiatorDomains = kYouTubeInitiators;
    r.urlFilter = QStringLiteral("/api/stats/ads");
    r.resourceTypes = {ArDaliBlockerResourceType::Xhr, ArDaliBlockerResourceType::Ping};
    r.rulesetId = QStringLiteral("ardali-youtube");
    list.append(r);
  }
  {
    FilterRule r;
    r.id = 1000004; r.priority = 110; r.actionType = QStringLiteral("block");
    r.initiatorDomains = kYouTubeInitiators;
    r.urlFilter = QStringLiteral("||youtube.com/youtubei/v1/log_event");
    r.resourceTypes = {ArDaliBlockerResourceType::Xhr, ArDaliBlockerResourceType::Ping};
    r.rulesetId = QStringLiteral("ardali-youtube");
    list.append(r);
  }
  {
    FilterRule r;
    r.id = 1000005; r.priority = 110; r.actionType = QStringLiteral("block");
    r.requestDomains = {QStringLiteral("ads.youtube.com")};
    r.rulesetId = QStringLiteral("ardali-youtube");
    list.append(r);
  }
  {
    FilterRule r;
    r.id = 1000009; r.priority = 110; r.actionType = QStringLiteral("block");
    r.initiatorDomains = kYouTubeInitiators;
    r.urlFilter = QStringLiteral("ctier=l");
    r.requestDomains = {QStringLiteral("googlevideo.com")};
    r.resourceTypes = {ArDaliBlockerResourceType::Xhr, ArDaliBlockerResourceType::Media};
    r.rulesetId = QStringLiteral("ardali-youtube");
    list.append(r);
  }
  {
    FilterRule r;
    r.id = 1000010; r.priority = 110; r.actionType = QStringLiteral("block");
    r.initiatorDomains = kYouTubeInitiators;
    r.urlFilter = QStringLiteral("adformat=");
    r.requestDomains = {QStringLiteral("googlevideo.com")};
    r.resourceTypes = {ArDaliBlockerResourceType::Xhr, ArDaliBlockerResourceType::Media};
    r.rulesetId = QStringLiteral("ardali-youtube");
    list.append(r);
  }

  // 3. ADBLOCK_PLATFORM_CORE_DNR_RULES (Source of Truth: ArDali-WebMedia/main.js lines 3891-4050, priority: 95)
  const QSet<ArDaliBlockerResourceType> standardPlatformTypes = {
      ArDaliBlockerResourceType::Stylesheet,
      ArDaliBlockerResourceType::Script,
      ArDaliBlockerResourceType::Font,
      ArDaliBlockerResourceType::Image,
      ArDaliBlockerResourceType::Media,
      ArDaliBlockerResourceType::Xhr
  };

  auto addPlatformCore = [&list, &standardPlatformTypes](qint64 id, const QSet<QString> &initiators, const QSet<QString> &requests) {
    FilterRule r;
    r.id = id;
    r.priority = 95;
    r.actionType = QStringLiteral("allow");
    r.initiatorDomains = initiators;
    r.requestDomains = requests;
    r.resourceTypes = standardPlatformTypes;
    r.rulesetId = QStringLiteral("ardali-platform-core");
    list.append(r);
  };

  // Deezer
  addPlatformCore(1010000, {QStringLiteral("deezer.com"), QStringLiteral("www.deezer.com")},
                  {QStringLiteral("deezer.com"), QStringLiteral("www.deezer.com"), QStringLiteral("dzcdn.net")});

  // SoundCloud
  addPlatformCore(1010001, {QStringLiteral("soundcloud.com"), QStringLiteral("www.soundcloud.com")},
                  {QStringLiteral("soundcloud.com"), QStringLiteral("www.soundcloud.com"), QStringLiteral("sndcdn.com")});

  // Facebook & Instagram
  addPlatformCore(1010002, {
      QStringLiteral("facebook.com"), QStringLiteral("www.facebook.com"), QStringLiteral("m.facebook.com"),
      QStringLiteral("instagram.com"), QStringLiteral("www.instagram.com")
  }, {
      QStringLiteral("facebook.com"), QStringLiteral("www.facebook.com"), QStringLiteral("m.facebook.com"),
      QStringLiteral("web.facebook.com"), QStringLiteral("graph.facebook.com"), QStringLiteral("static.xx.fbcdn.net"),
      QStringLiteral("fbcdn.net"), QStringLiteral("fbcdn.com"), QStringLiteral("fbsbx.com"),
      QStringLiteral("facebook.net"), QStringLiteral("instagram.com"), QStringLiteral("www.instagram.com"),
      QStringLiteral("cdninstagram.com")
  });

  // TikTok
  addPlatformCore(1010003, {QStringLiteral("tiktok.com"), QStringLiteral("www.tiktok.com"), QStringLiteral("m.tiktok.com")}, {
      QStringLiteral("tiktok.com"), QStringLiteral("www.tiktok.com"), QStringLiteral("m.tiktok.com"),
      QStringLiteral("tiktokcdn.com"), QStringLiteral("tiktokcdn-us.com"), QStringLiteral("tiktokv.com"),
      QStringLiteral("ttwstatic.com"), QStringLiteral("byteoversea.com"), QStringLiteral("ibyteimg.com"),
      QStringLiteral("byteimg.com"), QStringLiteral("ibytedtos.com"), QStringLiteral("muscdn.com")
  });

  // X / Twitter
  addPlatformCore(1010004, {QStringLiteral("x.com"), QStringLiteral("www.x.com"), QStringLiteral("twitter.com"), QStringLiteral("www.twitter.com")}, {
      QStringLiteral("x.com"), QStringLiteral("www.x.com"), QStringLiteral("twitter.com"), QStringLiteral("www.twitter.com"), QStringLiteral("twimg.com")
  });

  // Reddit
  addPlatformCore(1010005, {QStringLiteral("reddit.com"), QStringLiteral("www.reddit.com"), QStringLiteral("old.reddit.com")}, {
      QStringLiteral("reddit.com"), QStringLiteral("www.reddit.com"), QStringLiteral("old.reddit.com"),
      QStringLiteral("redditstatic.com"), QStringLiteral("redditmedia.com"), QStringLiteral("redd.it")
  });

  // Twitch
  addPlatformCore(1010006, {QStringLiteral("twitch.tv"), QStringLiteral("www.twitch.tv")}, {
      QStringLiteral("twitch.tv"), QStringLiteral("www.twitch.tv"), QStringLiteral("jtvnw.net"),
      QStringLiteral("ttvnw.net"), QStringLiteral("twitchcdn.net"), QStringLiteral("ext-twitch.tv")
  });

  // Telegram
  addPlatformCore(1010007, {QStringLiteral("telegram.org"), QStringLiteral("www.telegram.org"), QStringLiteral("web.telegram.org"), QStringLiteral("t.me"), QStringLiteral("www.t.me")}, {
      QStringLiteral("telegram.org"), QStringLiteral("www.telegram.org"), QStringLiteral("web.telegram.org"), QStringLiteral("t.me"), QStringLiteral("www.t.me")
  });

  // WhatsApp
  addPlatformCore(1010008, {QStringLiteral("whatsapp.com"), QStringLiteral("www.whatsapp.com"), QStringLiteral("web.whatsapp.com")}, {
      QStringLiteral("whatsapp.com"), QStringLiteral("www.whatsapp.com"), QStringLiteral("web.whatsapp.com"), QStringLiteral("whatsapp.net")
  });

  // Mixcloud
  addPlatformCore(1010009, {QStringLiteral("mixcloud.com"), QStringLiteral("www.mixcloud.com")}, {
      QStringLiteral("mixcloud.com"), QStringLiteral("www.mixcloud.com"), QStringLiteral("mxcdn.net")
  });

  // Spotify
  addPlatformCore(1010010, {
      QStringLiteral("spotify.com"), QStringLiteral("www.spotify.com"), QStringLiteral("open.spotify.com"), QStringLiteral("accounts.spotify.com")
  }, {
      QStringLiteral("spotify.com"), QStringLiteral("www.spotify.com"), QStringLiteral("open.spotify.com"),
      QStringLiteral("accounts.spotify.com"), QStringLiteral("scdn.co"), QStringLiteral("spotifycdn.com"),
      QStringLiteral("spotifycdn.net"), QStringLiteral("akamaized.net")
  });

  return list;
}
} // namespace

QList<FilterRule> ArDaliBlockerListManager::loadRulesForModeAndSelection(ArDaliBlockerMode mode, const QStringList &enabledIds,
                                                                           bool selectionConfigured,
                                                                           bool strictBlock) {
  QList<FilterRule> rules;
  QList<FilterListInfo> lists;
  {
    QMutexLocker locker(&mutex_);
    lists = lists_;
  }

  // Always include built-in core rules (YouTube core allows & ad blocks, platform core allows, noop redirects)
  rules.append(getBuiltinCoreRules());

  // One resolver feeds every network/cosmetic/procedural/scriptlet realm.
  const QStringList resolvedIds = resolveRulesetIds(mode, enabledIds, selectionConfigured);
  const QSet<QString> activeIds(resolvedIds.begin(), resolvedIds.end());

  const QString baseDir = rulesetDir();
  for (const auto &info : lists) {
    if (!activeIds.contains(info.id)) continue;

    const QString mainPath = baseDir + QStringLiteral("/main/") + info.id + QStringLiteral(".json");
    if (QFileInfo::exists(mainPath)) rules.append(parseRulesetFile(mainPath, info.id));

    const QString regexPath = baseDir + QStringLiteral("/regex/") + info.id + QStringLiteral(".json");
    if (QFileInfo::exists(regexPath)) rules.append(parseRulesetFile(regexPath, info.id));

    // Legacy strictblock realms are always active for malware lists, and are
    // additionally enabled by strict protection or the aggressive preset.
    const bool includeStrict = strictBlock || mode == ArDaliBlockerMode::Aggressive ||
                               info.group == QLatin1String("malware");
    const QString strictPath = baseDir + QStringLiteral("/strictblock/") + info.id + QStringLiteral(".json");
    if (includeStrict && QFileInfo::exists(strictPath)) {
      QList<FilterRule> strictRules = parseRulesetFile(strictPath, QStringLiteral("strictblock-") + info.id);
      for (FilterRule &rule : strictRules) {
        rule.id = 1200000 + rule.id;
        rule.priority = qMax(80, rule.priority);
        rule.actionType = QStringLiteral("block");
        rule.redirectUrl.clear();
      }
      rules.append(strictRules);
    }
  }

  return rules;
}

void ArDaliBlockerListManager::invalidateCaches() {
  QMutexLocker locker(&mutex_);
  scriptingSourceCache_.clear();
  scriptingJsonCache_.clear();
  scriptingApplicabilityCache_.clear();
}

QJsonObject ArDaliBlockerListManager::cachedScriptingJson(const QString &path) const {
  {
    QMutexLocker locker(&mutex_);
    const auto found = scriptingJsonCache_.constFind(path);
    if (found != scriptingJsonCache_.constEnd()) return found.value();
  }
  QFile file(path);
  QJsonObject object;
  if (file.open(QIODevice::ReadOnly)) object = QJsonDocument::fromJson(file.readAll()).object();
  QMutexLocker locker(&mutex_);
  scriptingJsonCache_.insert(path, object);
  return object;
}

QString ArDaliBlockerListManager::loadCosmeticCssForSelection(const QStringList &enabledIds, bool selectionConfigured) const {
  const QString baseDir = rulesetDir();
  if (baseDir.isEmpty()) return QString();

  QString combinedCss;
  const QString genericHighDir = baseDir + QStringLiteral("/scripting/generichigh");
  if (QDir(genericHighDir).exists()) {
    QStringList targetIds = enabledIds;
    if (!selectionConfigured && targetIds.isEmpty()) {
      targetIds = {QStringLiteral("easylist"), QStringLiteral("annoyances-others"), QStringLiteral("ublock-filters")};
    }
    for (const QString &id : targetIds) {
      const QString cssFile = genericHighDir + QStringLiteral("/") + id + QStringLiteral(".css");
      QFile f(cssFile);
      if (f.exists() && f.open(QIODevice::ReadOnly | QIODevice::Text)) {
        combinedCss += QString::fromUtf8(f.readAll()) + QStringLiteral("\n\n");
      }
    }
  }
  return combinedCss;
}

QString ArDaliBlockerListManager::loadSpecificCosmeticCssForHost(const QString &rawHost,
                                                                  const QStringList &enabledIds,
                                                                  bool selectionConfigured) const {
  const QString baseDir = rulesetDir();
  const QString host = rawHost.trimmed().toLower();
  if (baseDir.isEmpty() || host.isEmpty()) return QString();

  QStringList ids = enabledIds;
  if (!selectionConfigured && ids.isEmpty()) ids = {QStringLiteral("ublock-filters"), QStringLiteral("easylist"),
                             QStringLiteral("easyprivacy"), QStringLiteral("tur-0")};
  QSet<QString> selectors;
  QSet<QString> exceptions;

  auto addList = [&selectors, &exceptions](const QJsonObject &data, int listIndex) {
    const QJsonArray selectorLists = data.value(QStringLiteral("selectorLists")).toArray();
    const QJsonArray sourceSelectors = data.value(QStringLiteral("selectors")).toArray();
    if (listIndex < 0 || listIndex >= selectorLists.size()) return;
    const QJsonDocument fragment = QJsonDocument::fromJson(
        (QStringLiteral("[") + selectorLists.at(listIndex).toString() + QStringLiteral("]")).toUtf8());
    if (!fragment.isArray()) return;
    for (const QJsonValue &value : fragment.array()) {
      const int selectorIndex = value.toInt();
      const int resolved = selectorIndex >= 0 ? selectorIndex : ~selectorIndex;
      if (resolved < 0 || resolved >= sourceSelectors.size()) continue;
      const QString selector = sourceSelectors.at(resolved).toString().trimmed();
      if (selector.isEmpty()) continue;
      if (selectorIndex >= 0) selectors.insert(selector);
      else exceptions.insert(selector);
    }
  };

  for (const QString &id : ids) {
    const QJsonObject data = cachedScriptingJson(
        baseDir + QStringLiteral("/scripting/specific/") + id + QStringLiteral(".json"));
    if (data.isEmpty()) continue;
    const QJsonArray hostnames = data.value(QStringLiteral("hostnames")).toArray();
    const QJsonArray refs = data.value(QStringLiteral("selectorListRefs")).toArray();
    if (hostnames.size() != refs.size()) continue;

    QStringList variants;
    const QStringList parts = host.split(QLatin1Char('.'), Qt::SkipEmptyParts);
    for (int i = 0; i < parts.size(); ++i) variants.append(parts.mid(i).join(QLatin1Char('.')));
    if (data.value(QStringLiteral("hasEntities")).toBool() && parts.size() > 1) {
      const int n = parts.size() - 1;
      for (int i = 0; i < n; ++i)
        for (int j = n; j > i; --j) variants.append(parts.mid(i, j - i).join(QLatin1Char('.')) + QStringLiteral(".*"));
    }
    variants.removeDuplicates();
    auto compareIndexedHostname = [](const QString &left, const QString &right) {
      if (left.size() != right.size()) return left.size() < right.size() ? -1 : 1;
      if (left == right) return 0;
      return left < right ? -1 : 1;
    };
    for (const QString &variant : variants) {
      int low = 0;
      int high = hostnames.size();
      while (low < high) {
        const int mid = (low + high) / 2;
        if (compareIndexedHostname(hostnames.at(mid).toString(), variant) < 0) low = mid + 1;
        else high = mid;
      }
      if (low < hostnames.size() && hostnames.at(low).toString() == variant) addList(data, refs.at(low).toInt(-1));
    }
    const QJsonArray regexes = data.value(QStringLiteral("regexes")).toArray();
    for (int i = 0; i + 2 < regexes.size(); i += 3) {
      if (!host.contains(regexes.at(i).toString())) continue;
      const QRegularExpression regex(regexes.at(i + 1).toString());
      if (regex.isValid() && regex.match(host).hasMatch()) addList(data, regexes.at(i + 2).toInt(-1));
    }
  }
  for (const QString &exception : exceptions) selectors.remove(exception);
  return selectors.isEmpty() ? QString() : selectors.values().join(QStringLiteral(",\n")) +
      QStringLiteral(" { display: none !important; }");
}

QJsonArray ArDaliBlockerListManager::loadProceduralRulesForHost(const QString &rawHost,
                                                                  const QStringList &enabledIds,
                                                                  bool selectionConfigured) const {
  const QString baseDir = rulesetDir();
  const QString host = rawHost.trimmed().toLower();
  if (baseDir.isEmpty() || host.isEmpty()) return {};
  QStringList ids = enabledIds;
  if (!selectionConfigured && ids.isEmpty()) ids = {QStringLiteral("ublock-filters"), QStringLiteral("easylist"),
                             QStringLiteral("easyprivacy"), QStringLiteral("tur-0")};
  QSet<QString> entries;
  QSet<QString> exceptions;
  auto addList = [&entries, &exceptions](const QJsonObject &data, int listIndex) {
    const QJsonArray lists = data.value(QStringLiteral("selectorLists")).toArray();
    const QJsonArray source = data.value(QStringLiteral("selectors")).toArray();
    if (listIndex < 0 || listIndex >= lists.size()) return;
    const QJsonDocument fragment = QJsonDocument::fromJson(
        (QStringLiteral("[") + lists.at(listIndex).toString() + QStringLiteral("]")).toUtf8());
    if (!fragment.isArray()) return;
    for (const QJsonValue &value : fragment.array()) {
      const int index = value.toInt();
      const int resolved = index >= 0 ? index : ~index;
      if (resolved < 0 || resolved >= source.size()) continue;
      const QString item = source.at(resolved).toString();
      if (index >= 0) entries.insert(item); else exceptions.insert(item);
    }
  };
  auto compareIndexedHostname = [](const QString &left, const QString &right) {
    if (left.size() != right.size()) return left.size() < right.size() ? -1 : 1;
    if (left == right) return 0;
    return left < right ? -1 : 1;
  };
  for (const QString &id : ids) {
    const QJsonObject data = cachedScriptingJson(
        baseDir + QStringLiteral("/scripting/procedural/") + id + QStringLiteral(".json"));
    if (data.isEmpty()) continue;
    const QJsonArray hosts = data.value(QStringLiteral("hostnames")).toArray();
    const QJsonArray refs = data.value(QStringLiteral("selectorListRefs")).toArray();
    if (hosts.size() != refs.size()) continue;
    QStringList variants;
    const QStringList parts = host.split(QLatin1Char('.'), Qt::SkipEmptyParts);
    for (int i = 0; i < parts.size(); ++i) variants.append(parts.mid(i).join(QLatin1Char('.')));
    if (data.value(QStringLiteral("hasEntities")).toBool() && parts.size() > 1) {
      const int n = parts.size() - 1;
      for (int i = 0; i < n; ++i)
        for (int j = n; j > i; --j) variants.append(parts.mid(i, j - i).join(QLatin1Char('.')) + QStringLiteral(".*"));
    }
    variants.removeDuplicates();
    for (const QString &variant : variants) {
      int low = 0, high = hosts.size();
      while (low < high) {
        const int mid = (low + high) / 2;
        if (compareIndexedHostname(hosts.at(mid).toString(), variant) < 0) low = mid + 1; else high = mid;
      }
      if (low < hosts.size() && hosts.at(low).toString() == variant) addList(data, refs.at(low).toInt(-1));
    }
    const QJsonArray regexes = data.value(QStringLiteral("regexes")).toArray();
    for (int i = 0; i + 2 < regexes.size(); i += 3) {
      if (!host.contains(regexes.at(i).toString())) continue;
      const QRegularExpression regex(regexes.at(i + 1).toString());
      if (regex.isValid() && regex.match(host).hasMatch()) addList(data, regexes.at(i + 2).toInt(-1));
    }
  }
  QJsonArray rules;
  for (const QString &entry : entries) {
    if (exceptions.contains(entry)) continue;
    const QJsonDocument parsed = QJsonDocument::fromJson(entry.toUtf8());
    if (parsed.isObject()) rules.append(parsed.object());
    if (rules.size() >= 600) break;
  }
  return rules;
}

QList<QPair<QString, QString>> ArDaliBlockerListManager::loadScriptingSourcesForHost(const QString &host,
                                                                                       const QStringList &enabledIds,
                                                                                       bool selectionConfigured) const {
  const QString baseDir = rulesetDir();
  if (baseDir.isEmpty()) return {};

  // Preflight the generated hostname/entity map so irrelevant large bundles
  // are not injected into every site. The selected program remains the source
  // of truth for argument references and exceptions.
  QStringList ids = enabledIds;
  if (!selectionConfigured && ids.isEmpty()) {
    ids = {QStringLiteral("ublock-filters"), QStringLiteral("easylist"),
           QStringLiteral("easyprivacy"), QStringLiteral("tur-0")};
  }
  const QString lowerHost = host.trimmed().toLower();
  const bool isYouTubeHost = lowerHost == QLatin1String("youtube.com") ||
                             lowerHost == QLatin1String("www.youtube.com") ||
                             lowerHost == QLatin1String("m.youtube.com") ||
                             lowerHost == QLatin1String("music.youtube.com") ||
                             lowerHost.endsWith(QLatin1String(".youtube.com")) ||
                             lowerHost == QLatin1String("youtu.be");
  if (isYouTubeHost && !ids.contains(QStringLiteral("ublock-experimental"))) {
    ids.append(QStringLiteral("ublock-experimental"));
  }

  QString mainSource;
  QString isolatedSource;
  auto readAsset = [this](const QString &path) {
    {
      QMutexLocker locker(&mutex_);
      const auto found = scriptingSourceCache_.constFind(path);
      if (found != scriptingSourceCache_.constEnd()) return found.value();
    }
    QFile file(path);
    QString source;
    if (file.open(QIODevice::ReadOnly | QIODevice::Text)) source = QString::fromUtf8(file.readAll());
    QMutexLocker locker(&mutex_);
    scriptingSourceCache_.insert(path, source);
    return source;
  };
  auto appendMappedAsset = [this, &readAsset, &host](QString &target, const QString &path) {
    const QString source = readAsset(path);
    const QString cacheKey = path + QLatin1Char('\n') + host.toLower();
    bool applies = false;
    bool cached = false;
    {
      QMutexLocker locker(&mutex_);
      const auto found = scriptingApplicabilityCache_.constFind(cacheKey);
      if (found != scriptingApplicabilityCache_.constEnd()) {
        applies = found.value();
        cached = true;
      }
    }
    if (!cached) {
      applies = generatedScriptletAppliesToHost(source, host);
      QMutexLocker locker(&mutex_);
      scriptingApplicabilityCache_.insert(cacheKey, applies);
    }
    if (applies) target += source + QStringLiteral("\n;\n");
  };
  auto appendGenericAsset = [&readAsset](QString &target, const QString &path) {
    const QString source = readAsset(path);
    if (!source.trimmed().isEmpty()) target += source + QStringLiteral("\n;\n");
  };
  for (const QString &id : ids) {
    appendMappedAsset(mainSource, baseDir + QStringLiteral("/scripting/scriptlet/main/") + id + QStringLiteral(".js"));
    appendMappedAsset(isolatedSource, baseDir + QStringLiteral("/scripting/scriptlet/isolated/") + id + QStringLiteral(".js"));
    appendGenericAsset(isolatedSource, baseDir + QStringLiteral("/scripting/generic/") + id + QStringLiteral(".js"));
    appendGenericAsset(isolatedSource, baseDir + QStringLiteral("/scripting/popup/") + id + QStringLiteral(".js"));
  }

  QList<QPair<QString, QString>> result;
  if (!mainSource.trimmed().isEmpty()) result.append(qMakePair(QStringLiteral("main"), mainSource));
  if (!isolatedSource.trimmed().isEmpty()) result.append(qMakePair(QStringLiteral("isolated"), isolatedSource));
  return result;
}
