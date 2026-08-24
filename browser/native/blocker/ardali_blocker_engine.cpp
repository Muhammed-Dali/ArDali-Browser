#include "ardali_blocker_engine.h"
#include "ardali_blocker_list_manager.h"

#include <algorithm>
#include <QDateTime>
#include <QMutexLocker>
#include <QUrlQuery>

namespace {
const QStringList kCommonTlds = {
    QStringLiteral("com.tr"), QStringLiteral("org.tr"), QStringLiteral("net.tr"), QStringLiteral("edu.tr"),
    QStringLiteral("gov.tr"), QStringLiteral("co.uk"), QStringLiteral("org.uk"), QStringLiteral("com.au"),
    QStringLiteral("co.jp"), QStringLiteral("co.kr")
};

bool isGoogleAuthBypass(const QUrl &url, const QString &initiatorHost) {
  auto isGoogleAuthHostOrPath = [](const QString &host, const QString &path) -> bool {
    if (host.isEmpty()) return false;
    if (host == QLatin1String("gstatic.com") || host.endsWith(QLatin1String(".gstatic.com")) ||
        host == QLatin1String("googleusercontent.com") || host.endsWith(QLatin1String(".googleusercontent.com")) ||
        host == QLatin1String("googleapis.com") || host.endsWith(QLatin1String(".googleapis.com"))) {
      return true;
    }
    if (host == QLatin1String("accounts.google.com") || host == QLatin1String("myaccount.google.com") ||
        host == QLatin1String("oauth2.googleapis.com") || host == QLatin1String("accounts.youtube.com")) {
      return true;
    }
    if ((host == QLatin1String("google.com") || host == QLatin1String("www.google.com")) &&
        (path.contains(QLatin1String("/signin")) || path.contains(QLatin1String("/servicelogin")) || path.contains(QLatin1String("/accountchooser")))) {
      return true;
    }
    return false;
  };

  const QString host = url.host().toLower();
  const QString path = url.path().toLower();
  if (isGoogleAuthHostOrPath(host, path)) return true;

  if (!initiatorHost.isEmpty() && isGoogleAuthHostOrPath(initiatorHost.toLower(), QString())) {
    return true;
  }
  return false;
}

struct PlatformCoreDomainEntry {
  QStringList page;
  QStringList assets;
};

// Source of Truth: ArDali-WebMedia/main.js lines 4366-4469
const PlatformCoreDomainEntry kPlatformCoreDomains[] = {
    {{QStringLiteral("deezer.com")},
     {QStringLiteral("deezer.com"), QStringLiteral("dzcdn.net")}},
    {{QStringLiteral("soundcloud.com")},
     {QStringLiteral("soundcloud.com"), QStringLiteral("sndcdn.com")}},
    {{QStringLiteral("facebook.com"), QStringLiteral("instagram.com")},
     {QStringLiteral("facebook.com"), QStringLiteral("fbcdn.com"), QStringLiteral("fbcdn.net"), QStringLiteral("fbsbx.com"), QStringLiteral("facebook.net"), QStringLiteral("instagram.com"), QStringLiteral("cdninstagram.com")}},
    {{QStringLiteral("tiktok.com")},
     {QStringLiteral("tiktok.com"), QStringLiteral("tiktokcdn.com"), QStringLiteral("tiktokcdn-us.com"), QStringLiteral("tiktokv.com"), QStringLiteral("ttwstatic.com"), QStringLiteral("byteoversea.com"), QStringLiteral("ibyteimg.com"), QStringLiteral("byteimg.com"), QStringLiteral("ibytedtos.com"), QStringLiteral("muscdn.com")}},
    {{QStringLiteral("x.com"), QStringLiteral("twitter.com")},
     {QStringLiteral("x.com"), QStringLiteral("twitter.com"), QStringLiteral("twimg.com")}},
    {{QStringLiteral("reddit.com")},
     {QStringLiteral("reddit.com"), QStringLiteral("redditstatic.com"), QStringLiteral("redditmedia.com"), QStringLiteral("redd.it")}},
    {{QStringLiteral("twitch.tv")},
     {QStringLiteral("twitch.tv"), QStringLiteral("jtvnw.net"), QStringLiteral("ttvnw.net"), QStringLiteral("twitchcdn.net"), QStringLiteral("ext-twitch.tv")}},
    {{QStringLiteral("telegram.org"), QStringLiteral("t.me")},
     {QStringLiteral("telegram.org"), QStringLiteral("t.me")}},
    {{QStringLiteral("whatsapp.com")},
     {QStringLiteral("whatsapp.com"), QStringLiteral("whatsapp.net")}},
    {{QStringLiteral("mixcloud.com")},
     {QStringLiteral("mixcloud.com"), QStringLiteral("mxcdn.net")}},
    {{QStringLiteral("spotify.com")},
     {QStringLiteral("spotify.com"), QStringLiteral("scdn.co"), QStringLiteral("spotifycdn.com"), QStringLiteral("spotifycdn.net"), QStringLiteral("akamaized.net")}},
    {{QStringLiteral("amazon.com.tr"), QStringLiteral("amazon.com"), QStringLiteral("amazon.de"), QStringLiteral("amazon.co.uk"), QStringLiteral("amazon.fr"), QStringLiteral("amazon.it"), QStringLiteral("amazon.es")},
     {QStringLiteral("amazon.com.tr"), QStringLiteral("amazon.com"), QStringLiteral("amazon.de"), QStringLiteral("amazon.co.uk"), QStringLiteral("amazon.fr"), QStringLiteral("amazon.it"), QStringLiteral("amazon.es"), QStringLiteral("media-amazon.com"), QStringLiteral("ssl-images-amazon.com"), QStringLiteral("a2z.com")}},
    {{QStringLiteral("duckduckgo.com"), QStringLiteral("google.com"), QStringLiteral("bing.com"), QStringLiteral("brave.com"), QStringLiteral("github.com")},
     {QStringLiteral("duckduckgo.com"), QStringLiteral("google.com"), QStringLiteral("gstatic.com"), QStringLiteral("bing.com"), QStringLiteral("brave.com"), QStringLiteral("github.com"), QStringLiteral("githubassets.com")}}
};

bool hostMatchesAny(const QString &host, const QStringList &domains) {
  for (const QString &d : domains) {
    if (host == d || host.endsWith(QLatin1Char('.') + d)) return true;
  }
  return false;
}

bool cosmeticDomainApplies(const QString &host, const QString &domainExpression) {
  if (domainExpression.trimmed().isEmpty()) return true;
  bool hasPositive = false;
  bool positiveMatch = false;
  const QStringList domains = domainExpression.split(QLatin1Char(','), Qt::SkipEmptyParts);
  for (QString domain : domains) {
    domain = domain.trimmed().toLower();
    const bool excluded = domain.startsWith(QLatin1Char('~'));
    if (excluded) domain.remove(0, 1);
    const bool matches = host == domain || host.endsWith(QLatin1Char('.') + domain);
    if (excluded && matches) return false;
    if (!excluded) {
      hasPositive = true;
      if (matches) positiveMatch = true;
    }
  }
  return !hasPositive || positiveMatch;
}

bool isPlatformCoreAssetBypass(const QUrl &url, ArDaliBlockerResourceType resourceType, const QString &initiatorHost) {
  if (initiatorHost.isEmpty() || resourceType == ArDaliBlockerResourceType::MainFrame) return false;
  const QString targetHost = url.host().toLower();
  const QString initHost = initiatorHost.toLower();

  for (const auto &entry : kPlatformCoreDomains) {
    if (hostMatchesAny(initHost, entry.page) && hostMatchesAny(targetHost, entry.assets)) {
      return true;
    }
  }
  return false;
}

QString transformedRedirectUrl(const FilterRule &rule, const QUrl &sourceUrl) {
  if (!rule.redirectUrl.isEmpty()) return rule.redirectUrl;
  if (!rule.redirectTransform.isEmpty()) {
    QUrl target = sourceUrl;
    const QJsonObject transform = rule.redirectTransform;
    if (transform.contains(QStringLiteral("scheme"))) target.setScheme(transform.value(QStringLiteral("scheme")).toString().remove(QLatin1Char(':')));
    if (transform.contains(QStringLiteral("host"))) target.setHost(transform.value(QStringLiteral("host")).toString());
    if (transform.contains(QStringLiteral("port"))) {
      const QJsonValue portValue = transform.value(QStringLiteral("port"));
      bool ok = false;
      const int port = portValue.isDouble() ? portValue.toInt(-1) : portValue.toString().toInt(&ok);
      target.setPort(portValue.isDouble() || ok ? port : -1);
    }
    if (transform.contains(QStringLiteral("path"))) {
      QString path = transform.value(QStringLiteral("path")).toString();
      if (!path.startsWith(QLatin1Char('/'))) path.prepend(QLatin1Char('/'));
      target.setPath(path);
    }
    if (transform.contains(QStringLiteral("query"))) target.setQuery(transform.value(QStringLiteral("query")).toString().remove(QLatin1Char('?')));
    const QJsonObject queryTransform = transform.value(QStringLiteral("queryTransform")).toObject();
    if (!queryTransform.isEmpty()) {
      QUrlQuery query(target);
      for (const QJsonValue &value : queryTransform.value(QStringLiteral("removeParams")).toArray())
        query.removeAllQueryItems(value.toString());
      for (const QJsonValue &value : queryTransform.value(QStringLiteral("addOrReplaceParams")).toArray()) {
        const QJsonObject entry = value.toObject();
        const QString key = entry.value(QStringLiteral("key")).toString();
        if (key.isEmpty()) continue;
        if (entry.value(QStringLiteral("replaceOnly")).toBool() && !query.hasQueryItem(key)) continue;
        query.removeAllQueryItems(key);
        query.addQueryItem(key, entry.value(QStringLiteral("value")).toVariant().toString());
      }
      target.setQuery(query);
    }
    if (transform.contains(QStringLiteral("fragment"))) target.setFragment(transform.value(QStringLiteral("fragment")).toString().remove(QLatin1Char('#')));
    if (transform.contains(QStringLiteral("username"))) target.setUserName(transform.value(QStringLiteral("username")).toString());
    if (transform.contains(QStringLiteral("password"))) target.setPassword(transform.value(QStringLiteral("password")).toString());
    return target.toString();
  }
  if (!rule.regexSubstitution.isEmpty() && !rule.regexFilter.isEmpty()) {
    const QRegularExpression expression(rule.regexFilter,
        rule.isCaseSensitive ? QRegularExpression::NoPatternOption : QRegularExpression::CaseInsensitiveOption);
    if (expression.isValid()) {
      QString replacement = rule.regexSubstitution;
      QString result = sourceUrl.toString();
      result.replace(expression, replacement);
      if (result != sourceUrl.toString()) return result;
    }
  }
  return QString();
}
} // namespace

ArDaliBlockerEngine::ArDaliBlockerEngine() = default;

namespace {
int dnrActionRank(const QString &action) {
  if (action == QLatin1String("allow") || action == QLatin1String("allowAllRequests")) return 4;
  if (action == QLatin1String("block")) return 3;
  if (action == QLatin1String("redirect")) return 2;
  return 1;
}

void sortDnrRules(QList<FilterRule> &rules) {
  std::stable_sort(rules.begin(), rules.end(), [](const FilterRule &a, const FilterRule &b) {
    if (a.priority != b.priority) return a.priority > b.priority;
    const int rankA = dnrActionRank(a.actionType);
    const int rankB = dnrActionRank(b.actionType);
    if (rankA != rankB) return rankA > rankB;
    return a.id > b.id;
  });
}

std::array<QVector<int>, 14> buildResourceIndices(const QList<FilterRule> &rules) {
  std::array<QVector<int>, 14> result;
  for (int index = 0; index < rules.size(); ++index) {
    const FilterRule &rule = rules.at(index);
    for (int typeIndex = 0; typeIndex < static_cast<int>(result.size()); ++typeIndex) {
      const auto type = static_cast<ArDaliBlockerResourceType>(typeIndex);
      if ((!rule.resourceTypes.isEmpty() && !rule.resourceTypes.contains(type)) ||
          rule.excludedResourceTypes.contains(type)) continue;
      result[static_cast<size_t>(typeIndex)].append(index);
    }
  }
  return result;
}

QString anchoredDomain(const QString &filter) {
  if (!filter.startsWith(QStringLiteral("||"))) return {};
  const QString rest = filter.mid(2);
  int end = 0;
  while (end < rest.size()) {
    const QChar c = rest.at(end);
    if (c == QLatin1Char('^') || c == QLatin1Char('/') ||
        c == QLatin1Char('*') || c == QLatin1Char('|')) break;
    ++end;
  }
  QString domain = rest.left(end).trimmed().toLower();
  while (domain.startsWith(QLatin1Char('.'))) domain.remove(0, 1);
  while (domain.endsWith(QLatin1Char('.'))) domain.chop(1);
  return domain;
}

QString requiredUrlToken(const QString &filter) {
  QString longest;
  QString current;
  for (const QChar c : filter) {
    if (c.isLetterOrNumber()) current.append(c.toLower());
    else {
      if (current.size() > longest.size()) longest = current;
      current.clear();
    }
  }
  if (current.size() > longest.size()) longest = current;
  return longest.size() >= 3 ? longest.left(3) : QString();
}

void buildCandidateIndices(const QList<FilterRule> &rules,
                           QHash<QString, QVector<int>> &byDomain,
                           QHash<QString, QVector<int>> &byToken,
                           QVector<int> &universal) {
  byDomain.clear();
  byToken.clear();
  universal.clear();
  for (int index = 0; index < rules.size(); ++index) {
    const FilterRule &rule = rules.at(index);
    if (!rule.requestDomains.isEmpty()) {
      for (const QString &domain : rule.requestDomains) byDomain[domain.toLower()].append(index);
      continue;
    }
    const QString domain = anchoredDomain(rule.urlFilter);
    if (!domain.isEmpty()) {
      byDomain[domain].append(index);
      continue;
    }
    const QString token = requiredUrlToken(rule.urlFilter);
    if (!token.isEmpty()) {
      byToken[token].append(index);
      continue;
    }
    universal.append(index);
  }
}

const QStringList &proceduralOperatorNames() {
  static const QStringList names = {
      QStringLiteral("matches-css-before"), QStringLiteral("matches-css-after"),
      QStringLiteral("min-text-length"), QStringLiteral("matches-attr"),
      QStringLiteral("matches-prop"), QStringLiteral("matches-path"),
      QStringLiteral("matches-media"), QStringLiteral("remove-attr"),
      QStringLiteral("remove-class"), QStringLiteral("has-text"),
      QStringLiteral("watch-attr"), QStringLiteral("matches-css"),
      QStringLiteral("if-not"), QStringLiteral("upward"),
      QStringLiteral("xpath"), QStringLiteral("shadow"),
      QStringLiteral("others"), QStringLiteral("remove"),
      QStringLiteral("style"), QStringLiteral("spath"),
      QStringLiteral("has"), QStringLiteral("not"), QStringLiteral("if")};
  return names;
}

int firstProceduralOperator(const QString &expression) {
  int first = -1;
  for (const QString &name : proceduralOperatorNames()) {
    const int position = expression.indexOf(QLatin1Char(':') + name + QLatin1Char('('));
    if (position >= 0 && (first < 0 || position < first)) first = position;
  }
  return first;
}

bool readProceduralCall(const QString &expression, int position, QString *name,
                        QString *argument, int *nextPosition) {
  if (position < 0 || position >= expression.size() || expression.at(position) != QLatin1Char(':')) return false;
  const int open = expression.indexOf(QLatin1Char('('), position + 1);
  if (open < 0) return false;
  const QString candidate = expression.mid(position + 1, open - position - 1);
  if (!proceduralOperatorNames().contains(candidate)) return false;
  int depth = 1;
  QChar quote;
  bool escaped = false;
  for (int index = open + 1; index < expression.size(); ++index) {
    const QChar ch = expression.at(index);
    if (escaped) { escaped = false; continue; }
    if (ch == QLatin1Char('\\')) { escaped = true; continue; }
    if (!quote.isNull()) {
      if (ch == quote) quote = QChar();
      continue;
    }
    if (ch == QLatin1Char('\'') || ch == QLatin1Char('"')) { quote = ch; continue; }
    if (ch == QLatin1Char('(')) ++depth;
    else if (ch == QLatin1Char(')') && --depth == 0) {
      *name = candidate;
      *argument = expression.mid(open + 1, index - open - 1).trimmed();
      *nextPosition = index + 1;
      return true;
    }
  }
  return false;
}

QString compileProceduralExpression(const QString &expression, QJsonObject *compiled) {
  const int first = firstProceduralOperator(expression);
  if (first < 0) return QStringLiteral("Prosedürel seçici desteklenen bir işlem içermiyor.");
  const QString selector = expression.left(first).trimmed();
  if (selector.isEmpty()) return QStringLiteral("Prosedürel temel seçici boş olamaz.");

  QJsonArray tasks;
  QJsonArray action{QStringLiteral("style"), QStringLiteral("display:none!important;")};
  bool hasAction = false;
  int position = first;
  while (position < expression.size()) {
    while (position < expression.size() && expression.at(position).isSpace()) ++position;
    if (position >= expression.size()) break;
    QString name;
    QString argument;
    int next = position;
    if (!readProceduralCall(expression, position, &name, &argument, &next))
      return QStringLiteral("Geçersiz veya desteklenmeyen prosedürel işlem.");

    const bool actionOperator = name == QLatin1String("remove") || name == QLatin1String("style") ||
                                name == QLatin1String("remove-attr") || name == QLatin1String("remove-class");
    if (actionOperator) {
      if (hasAction) return QStringLiteral("Bir prosedürel kural yalnızca bir eylem içerebilir.");
      if (name == QLatin1String("remove")) action = QJsonArray{QStringLiteral("remove")};
      else action = QJsonArray{name, argument};
      hasAction = true;
    } else {
      if (hasAction) return QStringLiteral("Prosedürel eylem kuralın sonunda olmalıdır.");
      QJsonValue value(argument);
      if (name == QLatin1String("has") || name == QLatin1String("not") ||
          name == QLatin1String("if") || name == QLatin1String("if-not")) {
        value = QJsonObject{{QStringLiteral("selector"), argument}, {QStringLiteral("tasks"), QJsonArray{}}};
      } else if (name == QLatin1String("matches-css") || name == QLatin1String("matches-css-before") ||
                 name == QLatin1String("matches-css-after") || name == QLatin1String("matches-attr") ||
                 name == QLatin1String("matches-prop")) {
        const int separator = argument.indexOf(QLatin1Char('='));
        const int colon = argument.indexOf(QLatin1Char(':'));
        const int split = separator >= 0 ? separator : colon;
        if (split <= 0) return QStringLiteral("%1 işlemi ad/değer çifti gerektiriyor.").arg(name);
        const QString key = (name == QLatin1String("matches-css") || name.startsWith(QStringLiteral("matches-css-")))
            ? QStringLiteral("name") : QStringLiteral("attr");
        value = QJsonObject{{key, argument.left(split).trimmed()},
                            {QStringLiteral("value"), argument.mid(split + 1).trimmed()}};
      } else if (name == QLatin1String("upward") || name == QLatin1String("min-text-length")) {
        bool ok = false;
        const int number = argument.toInt(&ok);
        if (ok) value = number;
      }
      tasks.append(QJsonArray{name, value});
    }
    position = next;
  }

  *compiled = QJsonObject{{QStringLiteral("selector"), selector},
                          {QStringLiteral("tasks"), tasks},
                          {QStringLiteral("action"), action}};
  return QString();
}

void compileCustomLines(const QStringList &lines, QList<FilterRule> &customRules,
                        QList<CosmeticRule> &cosmeticRules,
                        QList<ProceduralCosmeticRule> &proceduralRules) {
  qint64 idCounter = 900000;
  for (const QString &raw : lines) {
    const QString line = raw.trimmed();
    if (line.isEmpty() || line.startsWith(QLatin1Char('!'))) continue;
    if (!ArDaliBlockerEngine::validateCustomFilterLine(line).isEmpty()) continue;
    int exceptionIndex = line.indexOf(QStringLiteral("#@?#"));
    int cosmeticIndex = line.indexOf(QStringLiteral("#?#"));
    int delimiterLength = exceptionIndex >= 0 ? 4 : 3;
    if (exceptionIndex < 0 && cosmeticIndex < 0) {
      exceptionIndex = line.indexOf(QStringLiteral("#@#"));
      cosmeticIndex = line.indexOf(QStringLiteral("##"));
      delimiterLength = exceptionIndex >= 0 ? 3 : 2;
    }
    if (exceptionIndex >= 0 || cosmeticIndex >= 0) {
      const bool exception = exceptionIndex >= 0;
      const int index = exception ? exceptionIndex : cosmeticIndex;
      const QString expression = line.mid(index + delimiterLength).trimmed();
      QJsonObject procedural;
      if (firstProceduralOperator(expression) >= 0 && compileProceduralExpression(expression, &procedural).isEmpty()) {
        proceduralRules.append(ProceduralCosmeticRule{line.left(index).trimmed().toLower(), expression,
                                                       procedural, exception});
        continue;
      }
      CosmeticRule rule;
      rule.domain = line.left(index).trimmed().toLower();
      rule.selector = expression;
      rule.isException = exception;
      if (!rule.selector.isEmpty()) cosmeticRules.append(rule);
      continue;
    }
    FilterRule rule;
    rule.id = ++idCounter;
    rule.priority = line.startsWith(QStringLiteral("@@")) ? 1000 : 900;
    rule.rulesetId = QStringLiteral("custom-user");
    rule.actionType = line.startsWith(QStringLiteral("@@")) ? QStringLiteral("allow") : QStringLiteral("block");
    QString body = line.startsWith(QStringLiteral("@@")) ? line.mid(2) : line;
    int optionIndex = -1;
    if (body.startsWith(QLatin1Char('/'))) {
      const int regexEnd = body.lastIndexOf(QLatin1Char('/'));
      if (regexEnd > 0 && regexEnd + 1 < body.size() && body.at(regexEnd + 1) == QLatin1Char('$'))
        optionIndex = regexEnd + 1;
    } else {
      optionIndex = body.lastIndexOf(QLatin1Char('$'));
    }
    const QStringList options = optionIndex >= 0
        ? body.mid(optionIndex + 1).split(QLatin1Char(','), Qt::SkipEmptyParts)
        : QStringList{};
    if (optionIndex >= 0) body = body.left(optionIndex);
    if (body.size() > 2 && body.startsWith(QLatin1Char('/')) && body.endsWith(QLatin1Char('/')))
      rule.regexFilter = body.mid(1, body.size() - 2);
    else
      rule.urlFilter = body;

    static const QHash<QString, ArDaliBlockerResourceType> resourceOptions = {
        {QStringLiteral("document"), ArDaliBlockerResourceType::MainFrame},
        {QStringLiteral("subdocument"), ArDaliBlockerResourceType::SubFrame},
        {QStringLiteral("stylesheet"), ArDaliBlockerResourceType::Stylesheet},
        {QStringLiteral("script"), ArDaliBlockerResourceType::Script},
        {QStringLiteral("image"), ArDaliBlockerResourceType::Image},
        {QStringLiteral("font"), ArDaliBlockerResourceType::Font},
        {QStringLiteral("object"), ArDaliBlockerResourceType::Object},
        {QStringLiteral("media"), ArDaliBlockerResourceType::Media},
        {QStringLiteral("xmlhttprequest"), ArDaliBlockerResourceType::Xhr},
        {QStringLiteral("xhr"), ArDaliBlockerResourceType::Xhr},
        {QStringLiteral("ping"), ArDaliBlockerResourceType::Ping},
        {QStringLiteral("websocket"), ArDaliBlockerResourceType::WebSocket},
        {QStringLiteral("other"), ArDaliBlockerResourceType::Other}
    };
    for (const QString &rawOption : options) {
      QString option = rawOption.trimmed().toLower();
      const bool excluded = option.startsWith(QLatin1Char('~'));
      if (excluded) option.remove(0, 1);
      if (resourceOptions.contains(option)) {
        if (excluded) rule.excludedResourceTypes.insert(resourceOptions.value(option));
        else rule.resourceTypes.insert(resourceOptions.value(option));
      } else if (option == QLatin1String("third-party")) {
        rule.domainType = excluded ? QStringLiteral("firstParty") : QStringLiteral("thirdParty");
      } else if (option == QLatin1String("match-case")) {
        rule.isCaseSensitive = !excluded;
      } else if (option == QLatin1String("important")) {
        rule.priority += 100;
      } else if (option.startsWith(QStringLiteral("domain="))) {
        const QStringList domains = option.mid(7).split(QLatin1Char('|'), Qt::SkipEmptyParts);
        for (QString domain : domains) {
          const bool domainExcluded = domain.startsWith(QLatin1Char('~'));
          if (domainExcluded) domain.remove(0, 1);
          if (domainExcluded) rule.excludedInitiatorDomains.insert(domain);
          else rule.initiatorDomains.insert(domain);
        }
      }
    }
    customRules.append(rule);
  }
}
}  // namespace

CompiledBlockerPlan ArDaliBlockerEngine::compilePlan(QList<FilterRule> rules, const QString &listCosmeticCss,
                                                       const QStringList &customLines) {
  CompiledBlockerPlan plan;
  plan.rules = std::move(rules);
  sortDnrRules(plan.rules);
  plan.ruleIndicesByResource = buildResourceIndices(plan.rules);
  buildCandidateIndices(plan.rules, plan.ruleIndicesByDomain,
                        plan.ruleIndicesByToken, plan.universalRuleIndices);
  plan.listCosmeticCss = listCosmeticCss;
  compileCustomLines(customLines, plan.customRules, plan.cosmeticRules, plan.proceduralRules);
  return plan;
}

void ArDaliBlockerEngine::applyCompiledPlan(CompiledBlockerPlan plan) {
  QMutexLocker locker(&mutex_);
  rules_.swap(plan.rules);
  ruleIndicesByResource_.swap(plan.ruleIndicesByResource);
  ruleIndicesByDomain_.swap(plan.ruleIndicesByDomain);
  ruleIndicesByToken_.swap(plan.ruleIndicesByToken);
  universalRuleIndices_.swap(plan.universalRuleIndices);
  customRules_.swap(plan.customRules);
  cosmeticRules_.swap(plan.cosmeticRules);
  proceduralRules_.swap(plan.proceduralRules);
  listCosmeticCss_.swap(plan.listCosmeticCss);
  regexCache_.clear();
}

void ArDaliBlockerEngine::clearRules() {
  QMutexLocker locker(&mutex_);
  rules_.clear();
  for (auto &indices : ruleIndicesByResource_) indices.clear();
  ruleIndicesByDomain_.clear();
  ruleIndicesByToken_.clear();
  universalRuleIndices_.clear();
  customRules_.clear();
  cosmeticRules_.clear();
  proceduralRules_.clear();
  listCosmeticCss_.clear();
  regexCache_.clear();
}

void ArDaliBlockerEngine::setListCosmeticCss(const QString &css) {
  QMutexLocker locker(&mutex_);
  listCosmeticCss_ = css;
}

void ArDaliBlockerEngine::loadRules(const QList<FilterRule> &rules) {
  QMutexLocker locker(&mutex_);
  rules_ = rules;
  sortDnrRules(rules_);
  ruleIndicesByResource_ = buildResourceIndices(rules_);
  buildCandidateIndices(rules_, ruleIndicesByDomain_, ruleIndicesByToken_, universalRuleIndices_);
}

void ArDaliBlockerEngine::addCustomFilterLines(const QStringList &lines) {
  QMutexLocker locker(&mutex_);
  customRules_.clear();
  cosmeticRules_.clear();
  proceduralRules_.clear();
  compileCustomLines(lines, customRules_, cosmeticRules_, proceduralRules_);
}

int ArDaliBlockerEngine::ruleCount() const {
  QMutexLocker locker(&mutex_);
  return rules_.size() + customRules_.size();
}

int ArDaliBlockerEngine::customRuleCount() const {
  QMutexLocker locker(&mutex_);
  return customRules_.size() + cosmeticRules_.size() + proceduralRules_.size();
}

QString ArDaliBlockerEngine::validateCustomFilterLine(const QString &rawLine) {
  QString line = rawLine.trimmed();
  if (line.isEmpty() || line.startsWith(QLatin1Char('!'))) return QString();
  if (line.size() > 8192 || line.contains(QRegularExpression(QStringLiteral("[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]"))))
    return QStringLiteral("Filtre geçersiz kontrol karakterleri içeriyor.");

  int exceptionIndex = line.indexOf(QStringLiteral("#@?#"));
  int cosmeticIndex = line.indexOf(QStringLiteral("#?#"));
  int delimiterLength = exceptionIndex >= 0 ? 4 : 3;
  if (exceptionIndex < 0 && cosmeticIndex < 0) {
    exceptionIndex = line.indexOf(QStringLiteral("#@#"));
    cosmeticIndex = line.indexOf(QStringLiteral("##"));
    delimiterLength = exceptionIndex >= 0 ? 3 : 2;
  }
  if (exceptionIndex >= 0 || cosmeticIndex >= 0) {
    const bool exception = exceptionIndex >= 0;
    const int index = exception ? exceptionIndex : cosmeticIndex;
    const QString expression = line.mid(index + delimiterLength).trimmed();
    if (expression.isEmpty())
      return QStringLiteral("Kozmetik seçici boş olamaz.");
    if (firstProceduralOperator(expression) >= 0) {
      QJsonObject compiled;
      return compileProceduralExpression(expression, &compiled);
    }
    if (delimiterLength > 3 || (delimiterLength == 3 && !exception))
      return QStringLiteral("Prosedürel filtre desteklenen bir işlem içermiyor.");
    return QString();
  }

  if (line.startsWith(QStringLiteral("@@"))) line.remove(0, 2);
  if (line.isEmpty()) return QStringLiteral("Ağ filtresi deseni boş olamaz.");

  int optionIndex = -1;
  if (line.startsWith(QLatin1Char('/'))) {
    const int regexEnd = line.lastIndexOf(QLatin1Char('/'));
    if (regexEnd <= 0) return QStringLiteral("Düzenli ifade kapanış '/' karakterini içermiyor.");
    const QRegularExpression expression(line.mid(1, regexEnd - 1));
    if (!expression.isValid()) return QStringLiteral("Geçersiz düzenli ifade: %1").arg(expression.errorString());
    if (regexEnd + 1 < line.size()) {
      if (line.at(regexEnd + 1) != QLatin1Char('$'))
        return QStringLiteral("Düzenli ifadeden sonra yalnızca '$' seçenekleri kullanılabilir.");
      optionIndex = regexEnd + 1;
    }
  } else {
    optionIndex = line.lastIndexOf(QLatin1Char('$'));
    const QString pattern = optionIndex >= 0 ? line.left(optionIndex) : line;
    if (pattern.trimmed().isEmpty()) return QStringLiteral("Ağ filtresi deseni boş olamaz.");
  }

  if (optionIndex < 0) return QString();
  static const QSet<QString> supported = {
      QStringLiteral("document"), QStringLiteral("subdocument"), QStringLiteral("stylesheet"),
      QStringLiteral("script"), QStringLiteral("image"), QStringLiteral("font"),
      QStringLiteral("object"), QStringLiteral("media"), QStringLiteral("xmlhttprequest"),
      QStringLiteral("xhr"), QStringLiteral("ping"), QStringLiteral("websocket"),
      QStringLiteral("other"), QStringLiteral("third-party"), QStringLiteral("match-case"),
      QStringLiteral("important")
  };
  const QStringList options = line.mid(optionIndex + 1).split(QLatin1Char(','), Qt::SkipEmptyParts);
  for (QString option : options) {
    option = option.trimmed().toLower();
    if (option.startsWith(QLatin1Char('~'))) option.remove(0, 1);
    if (!supported.contains(option) && !option.startsWith(QStringLiteral("domain=")))
      return QStringLiteral("Desteklenmeyen filtre seçeneği: %1").arg(option);
  }
  return QString();
}

bool ArDaliBlockerEngine::domainMatches(const QString &host, const QString &ruleDomain) const {
  if (host.isEmpty() || ruleDomain.isEmpty()) return false;
  return host == ruleDomain || host.endsWith(QLatin1Char('.') + ruleDomain);
}

QString ArDaliBlockerEngine::getSiteDomain(const QString &host) const {
  const QString clean = host.trimmed().toLower();
  if (clean.isEmpty()) return QString();

  for (const QString &tld : kCommonTlds) {
    if (clean.endsWith(QLatin1Char('.') + tld)) {
      const QString rest = clean.left(clean.length() - tld.length() - 1);
      const int dot = rest.lastIndexOf(QLatin1Char('.'));
      if (dot != -1) return rest.mid(dot + 1) + QLatin1Char('.') + tld;
      return clean;
    }
  }

  const QStringList parts = clean.split(QLatin1Char('.'));
  if (parts.size() <= 2) return clean;
  return parts.at(parts.size() - 2) + QLatin1Char('.') + parts.last();
}

bool ArDaliBlockerEngine::isSameSite(const QString &hostA, const QString &hostB) const {
  if (hostA.isEmpty() || hostB.isEmpty()) return false;
  return getSiteDomain(hostA) == getSiteDomain(hostB);
}

bool ArDaliBlockerEngine::urlFilterMatches(const QString &rawFilter, const QString &url, const QString &host,
                                           bool caseSensitive) const {
  QString filter = rawFilter.trimmed();
  if (!caseSensitive) filter = filter.toLower();
  const QString cacheKey = QStringLiteral("url:%1:%2").arg(caseSensitive ? QLatin1Char('s') : QLatin1Char('i'), filter);
  if (filter.isEmpty()) return true;

  if (filter.startsWith(QStringLiteral("||"))) {
    const QString rest = filter.mid(2);
    int markerIndex = -1;
    for (int i = 0; i < rest.size(); ++i) {
      const QChar c = rest.at(i);
      if (c == QLatin1Char('^') || c == QLatin1Char('/') ||
          c == QLatin1Char('*') || c == QLatin1Char('|')) {
        markerIndex = i;
        break;
      }
    }
    QString domain = (markerIndex == -1 ? rest : rest.left(markerIndex)).toLower();
    while (domain.startsWith(QLatin1Char('.'))) domain.remove(0, 1);
    while (domain.endsWith(QLatin1Char('.'))) domain.chop(1);
    if (!domain.isEmpty() && !domainMatches(host, domain)) return false;
    const QString suffix = markerIndex == -1 ? QString() : rest.mid(markerIndex);
    if (suffix.isEmpty() || suffix == QLatin1String("^") || suffix == QLatin1String("|")) return true;
    QString nextFilter = suffix;
    if (nextFilter.startsWith(QLatin1Char('^'))) nextFilter.remove(0, 1);
    return urlFilterMatches(nextFilter, url, host, caseSensitive);
  }

  bool anchoredStart = false;
  bool anchoredEnd = false;
  if (filter.startsWith(QLatin1Char('|'))) {
    anchoredStart = true;
    filter.remove(0, 1);
  }
  if (filter.endsWith(QLatin1Char('|'))) {
    anchoredEnd = true;
    filter.chop(1);
  }

  if (!filter.contains(QLatin1Char('*')) && !filter.contains(QLatin1Char('^'))) {
    if (anchoredStart && anchoredEnd) return url == filter;
    if (anchoredStart) return url.startsWith(filter);
    if (anchoredEnd) return url.endsWith(filter);
    return url.contains(filter);
  }

  if (regexCache_.contains(cacheKey)) {
    return regexCache_.value(cacheKey).match(url).hasMatch();
  }

  QString escaped;
  for (int i = 0; i < filter.length(); ++i) {
    const QChar c = filter.at(i);
    if (c == QLatin1Char('*')) escaped.append(QStringLiteral(".*"));
    else if (c == QLatin1Char('^')) escaped.append(QStringLiteral("(?:[^A-Za-z0-9_.%-]|$)"));
    else escaped.append(QRegularExpression::escape(QString(c)));
  }
  QRegularExpression regex((anchoredStart ? QStringLiteral("^") : QString()) + escaped + (anchoredEnd ? QStringLiteral("$") : QString()),
                           caseSensitive ? QRegularExpression::NoPatternOption : QRegularExpression::CaseInsensitiveOption);
  if (regexCache_.size() < 2000) {
    regexCache_.insert(cacheKey, regex);
  }
  return regex.match(url).hasMatch();
}

RequestDecision ArDaliBlockerEngine::evaluate(const QUrl &url, ArDaliBlockerResourceType resourceType,
                                              const QString &initiatorHost, ArDaliBlockerMode mode,
                                              const SitePolicy &policy,
                                              const QString &requestMethod) const {
  if (!url.isValid()) return RequestDecision{ArDaliBlockerAction::Allow, QStringLiteral("invalid-url"), 0, QString(), QString()};
  const QString scheme = url.scheme().toLower();
  if (scheme != QLatin1String("http") && scheme != QLatin1String("https")) {
    return RequestDecision{ArDaliBlockerAction::Allow, QStringLiteral("internal-scheme"), 0, QString(), QString()};
  }

  // Full site protection and temporary bypasses disable every filtering layer.
  // Ad and tracker toggles remain independent below at matched-rule time.
  if (policy.whitelisted || policy.temporaryDisabledUntil > QDateTime::currentMSecsSinceEpoch()) {
    return RequestDecision{ArDaliBlockerAction::Allow, QStringLiteral("site-whitelisted"), 0, QString(), QString()};
  }
  if (!policy.adBlocking && !policy.trackerProtection) {
    return RequestDecision{ArDaliBlockerAction::Allow, QStringLiteral("site-filtering-disabled"), 0, QString(), QString()};
  }

  // Google Auth bypass
  if (isGoogleAuthBypass(url, initiatorHost)) {
    return RequestDecision{ArDaliBlockerAction::Allow, QStringLiteral("google-auth-bypass"), 0, QString(), QString()};
  }

  // Platform Core Asset bypass (Source of Truth: ArDali-WebMedia isPlatformCoreAssetBypassRequest)
  if (isPlatformCoreAssetBypass(url, resourceType, initiatorHost)) {
    return RequestDecision{ArDaliBlockerAction::Allow, QStringLiteral("platform-core-asset-bypass"), 0, QString(), QString()};
  }

  // Search engines subresource bypass (Source of Truth: ArDali-WebMedia lines 5197-5201)
  if (resourceType != ArDaliBlockerResourceType::MainFrame && !initiatorHost.isEmpty()) {
    const QString targetHost = url.host().toLower();
    const QString initHost = initiatorHost.toLower();
    if ((initHost.contains(QLatin1String("google.com")) || initHost.contains(QLatin1String("duckduckgo.com")) ||
         initHost.contains(QLatin1String("bing.com")) || initHost.contains(QLatin1String("brave.com"))) &&
        (targetHost.contains(QLatin1String("google.com")) || targetHost.contains(QLatin1String("duckduckgo.com")) ||
         targetHost.contains(QLatin1String("bing.com")) || targetHost.contains(QLatin1String("brave.com")))) {
      return RequestDecision{ArDaliBlockerAction::Allow, QStringLiteral("search-engine-subresource-allow"), 0, QString(), QString()};
    }
  }

  // Basic Mode Policy: Do not block main frame navigation in basic mode
  if (mode == ArDaliBlockerMode::Basic && resourceType == ArDaliBlockerResourceType::MainFrame) {
    return RequestDecision{ArDaliBlockerAction::Allow, QStringLiteral("basic-mode-mainframe-pass"), 0, QString(), QString()};
  }

  QMutexLocker locker(&mutex_);
  const QString urlString = url.toString();
  const QString urlLower = urlString.toLower();
  const QString host = url.host().toLower();
  const QString method = requestMethod.trimmed().toLower();

  // 1. Evaluate Custom User Rules (Allow rules first to override block rules)
  auto customMatches = [&](const FilterRule &rule) {
    if (!rule.resourceTypes.isEmpty() && !rule.resourceTypes.contains(resourceType)) return false;
    if (rule.excludedResourceTypes.contains(resourceType)) return false;
    if (!rule.requestMethods.isEmpty() && !rule.requestMethods.contains(method)) return false;
    if (rule.excludedRequestMethods.contains(method)) return false;
    if (!rule.domainType.isEmpty() && !initiatorHost.isEmpty()) {
      const bool same = isSameSite(host, initiatorHost);
      if (rule.domainType == QLatin1String("thirdParty") && same) return false;
      if (rule.domainType == QLatin1String("firstParty") && !same) return false;
    }
    if (!rule.initiatorDomains.isEmpty()) {
      bool included = false;
      for (const QString &domain : rule.initiatorDomains) {
        if (domainMatches(initiatorHost, domain)) { included = true; break; }
      }
      if (!included) return false;
    }
    for (const QString &domain : rule.excludedInitiatorDomains)
      if (domainMatches(initiatorHost, domain)) return false;
    const QString &candidateUrl = rule.isCaseSensitive ? urlString : urlLower;
    if (!rule.urlFilter.isEmpty() &&
        !urlFilterMatches(rule.urlFilter, candidateUrl, host, rule.isCaseSensitive)) return false;
    if (!rule.regexFilter.isEmpty()) {
      const QRegularExpression expression(rule.regexFilter,
          rule.isCaseSensitive ? QRegularExpression::NoPatternOption : QRegularExpression::CaseInsensitiveOption);
      if (!expression.match(candidateUrl).hasMatch()) return false;
    }
    return true;
  };
  for (const auto &rule : customRules_) {
    if (rule.actionType == QLatin1String("allow") && customMatches(rule)) {
      return RequestDecision{ArDaliBlockerAction::Allow, QStringLiteral("user-allow"), rule.id, rule.rulesetId, QString()};
    }
  }
  for (const auto &rule : customRules_) {
    if (rule.actionType == QLatin1String("block") && customMatches(rule)) {
      if (!policy.adBlocking) return RequestDecision{ArDaliBlockerAction::Allow, QStringLiteral("ad-blocking-off"), 0, QString(), QString()};
      return RequestDecision{ArDaliBlockerAction::Block, QStringLiteral("user-block"), rule.id, rule.rulesetId, QString()};
    }
  }

  // 2. Evaluate Engine Sorted DNR Rules (Highest rank / priority rule matches first)
  QVector<quint8> hostAndUrlCandidates(rules_.size(), 0);
  for (const int index : universalRuleIndices_) hostAndUrlCandidates[index] = 1;
  QString domainVariant = host;
  while (!domainVariant.isEmpty()) {
    const auto found = ruleIndicesByDomain_.constFind(domainVariant);
    if (found != ruleIndicesByDomain_.constEnd())
      for (const int index : found.value()) hostAndUrlCandidates[index] = 1;
    const int dot = domainVariant.indexOf(QLatin1Char('.'));
    if (dot < 0) break;
    domainVariant.remove(0, dot + 1);
  }
  QSet<QString> urlTokens;
  for (int i = 0; i + 2 < urlLower.size(); ++i) urlTokens.insert(urlLower.mid(i, 3));
  for (const QString &token : urlTokens) {
    const auto found = ruleIndicesByToken_.constFind(token);
    if (found != ruleIndicesByToken_.constEnd())
      for (const int index : found.value()) hostAndUrlCandidates[index] = 1;
  }

  const auto &candidateIndices = ruleIndicesByResource_.at(static_cast<size_t>(resourceType));
  for (const int ruleIndex : candidateIndices) {
    if (!hostAndUrlCandidates.at(ruleIndex)) continue;
    const FilterRule &rule = rules_.at(ruleIndex);
    // Keep this before the exception checks: those checks use goto to skip a
    // rule, and C++ may not jump across a later reference initialization.
    const QString &urlForRule = rule.isCaseSensitive ? urlString : urlLower;
    const bool trackerRule = rule.rulesetId.contains(QStringLiteral("privacy"), Qt::CaseInsensitive) ||
                             rule.rulesetId.contains(QStringLiteral("tracker"), Qt::CaseInsensitive);
    if (rule.unsupportedHeaderCondition) continue;
    // Check resource type
    if (!rule.resourceTypes.isEmpty() && !rule.resourceTypes.contains(resourceType)) continue;
    if (rule.excludedResourceTypes.contains(resourceType)) continue;
    if (!rule.requestMethods.isEmpty() && !rule.requestMethods.contains(method)) continue;
    if (rule.excludedRequestMethods.contains(method)) continue;

    // Check firstParty / thirdParty domain type
    if (!rule.domainType.isEmpty() && !initiatorHost.isEmpty()) {
      const bool same = isSameSite(host, initiatorHost);
      if (rule.domainType == QLatin1String("thirdParty") && same) continue;
      if (rule.domainType == QLatin1String("firstParty") && !same) continue;
    }

    // Check initiator domains
    if (!rule.initiatorDomains.isEmpty()) {
      bool matchedInit = false;
      for (const QString &d : rule.initiatorDomains) {
        if (domainMatches(initiatorHost, d)) { matchedInit = true; break; }
      }
      if (!matchedInit) continue;
    }
    for (const QString &d : rule.excludedInitiatorDomains) {
      if (domainMatches(initiatorHost, d)) goto skipRule;
    }

    // Check request domain
    if (!rule.requestDomains.isEmpty()) {
      bool matched = false;
      for (const QString &d : rule.requestDomains) {
        if (domainMatches(host, d)) { matched = true; break; }
      }
      if (!matched) continue;
    }
    for (const QString &d : rule.excludedRequestDomains) {
      if (domainMatches(host, d)) goto skipRule;
    }

    // Check URL filter
    if (!rule.urlFilter.isEmpty() && !urlFilterMatches(rule.urlFilter, urlForRule, host, rule.isCaseSensitive)) continue;

    // Check Regex filter
    if (!rule.regexFilter.isEmpty()) {
      const QString regexKey = QStringLiteral("regex:%1:%2").arg(
          rule.isCaseSensitive ? QLatin1Char('s') : QLatin1Char('i'), rule.regexFilter);
      if (!regexCache_.contains(regexKey)) {
        regexCache_.insert(regexKey, QRegularExpression(rule.regexFilter,
            rule.isCaseSensitive ? QRegularExpression::NoPatternOption : QRegularExpression::CaseInsensitiveOption));
      }
      if (!regexCache_.value(regexKey).match(urlForRule).hasMatch()) continue;
    }

    // Rule matches! Top priority decision
    if (rule.actionType == QLatin1String("allow") || rule.actionType == QLatin1String("allowAllRequests")) {
      return RequestDecision{ArDaliBlockerAction::Allow, QStringLiteral("dnr-allow"), rule.id, rule.rulesetId, QString()};
    }
    if ((trackerRule && !policy.trackerProtection) || (!trackerRule && !policy.adBlocking)) continue;
    if (rule.actionType == QLatin1String("block")) {
      return RequestDecision{ArDaliBlockerAction::Block, QStringLiteral("dnr-block"), rule.id, rule.rulesetId, QString()};
    }
    if (rule.actionType == QLatin1String("redirect")) {
      const QString redirectUrl = transformedRedirectUrl(rule, url);
      if (!redirectUrl.isEmpty()) {
        return RequestDecision{ArDaliBlockerAction::Redirect, QStringLiteral("dnr-redirect"), rule.id, rule.rulesetId, redirectUrl};
      }
      // A malformed/unsupported redirect must fail open, consistent with the
      // legacy evaluator, rather than being counted as a false redirect.
      continue;
    }
    if (rule.actionType == QLatin1String("upgradeScheme") && url.scheme().compare(QStringLiteral("http"), Qt::CaseInsensitive) == 0) {
      QUrl upgraded = url;
      upgraded.setScheme(QStringLiteral("https"));
      return RequestDecision{ArDaliBlockerAction::Redirect, QStringLiteral("dnr-upgrade-scheme"), rule.id, rule.rulesetId, upgraded.toString()};
    }

  skipRule:;
  }

  return RequestDecision{ArDaliBlockerAction::Allow, QStringLiteral("no-rule-matched"), 0, QString(), QString()};
}

QString ArDaliBlockerEngine::cosmeticCssForHost(const QString &host) const {
  QMutexLocker locker(&mutex_);
  QStringList selectors;
  QSet<QString> exceptions;

  const QString lowerHost = host.trimmed().toLower();
  QString combined;
  if (!listCosmeticCss_.isEmpty()) {
    combined += listCosmeticCss_ + QStringLiteral("\n");
  }

  for (const auto &cr : cosmeticRules_) {
    if (cr.isException) {
      if (cosmeticDomainApplies(lowerHost, cr.domain)) {
        exceptions.insert(cr.selector);
      }
    }
  }

  for (const auto &cr : cosmeticRules_) {
    if (!cr.isException) {
      if (cosmeticDomainApplies(lowerHost, cr.domain) && !exceptions.contains(cr.selector)) {
        selectors.append(cr.selector);
      }
    }
  }

  if (!selectors.isEmpty()) {
    combined += selectors.join(QStringLiteral(",\n")) + QStringLiteral(" { display: none !important; }\n");
  }

  return combined.trimmed();
}

QJsonArray ArDaliBlockerEngine::customProceduralRulesForHost(const QString &host) const {
  QMutexLocker locker(&mutex_);
  const QString lowerHost = host.trimmed().toLower();
  QSet<QString> exceptions;
  for (const ProceduralCosmeticRule &rule : proceduralRules_) {
    if (rule.isException && cosmeticDomainApplies(lowerHost, rule.domain))
      exceptions.insert(rule.signature);
  }
  QJsonArray result;
  QSet<QString> seen;
  for (const ProceduralCosmeticRule &rule : proceduralRules_) {
    if (rule.isException || !cosmeticDomainApplies(lowerHost, rule.domain) ||
        exceptions.contains(rule.signature) || seen.contains(rule.signature)) continue;
    result.append(rule.rule);
    seen.insert(rule.signature);
  }
  return result;
}
