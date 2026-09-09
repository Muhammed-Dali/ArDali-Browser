#include "search_engine_definition.h"
#include <QUrlQuery>
#include "address_input_resolver.h"

#include <QUrlQuery>

namespace ardali::core {

bool BootstrapWellKnownSiteProvider::isTurkeyLocale(const QLocale &locale) {
  return locale.territory() == QLocale::Turkey ||
         locale.language() == QLocale::Turkish ||
         locale.name().startsWith(QStringLiteral("tr_"), Qt::CaseInsensitive) ||
         locale.name().compare(QStringLiteral("tr"), Qt::CaseInsensitive) == 0;
}

std::optional<QUrl> BootstrapWellKnownSiteProvider::findNavigationCandidate(
    const QString &normalizedToken,
    const QLocale &locale) const {
  const QString token = normalizedToken.trimmed().toLower();
  if (token.isEmpty()) return std::nullopt;

  if (token == QLatin1String("amazon")) {
    if (isTurkeyLocale(locale)) {
      return QUrl(QStringLiteral("https://www.amazon.com.tr/"));
    }
    const auto territory = locale.territory();
    if (territory == QLocale::Germany || locale.language() == QLocale::German) {
      return QUrl(QStringLiteral("https://www.amazon.de/"));
    }
    if (territory == QLocale::UnitedKingdom) {
      return QUrl(QStringLiteral("https://www.amazon.co.uk/"));
    }
    if (territory == QLocale::France || locale.language() == QLocale::French) {
      return QUrl(QStringLiteral("https://www.amazon.fr/"));
    }
    if (territory == QLocale::Italy || locale.language() == QLocale::Italian) {
      return QUrl(QStringLiteral("https://www.amazon.it/"));
    }
    if (territory == QLocale::Spain || locale.language() == QLocale::Spanish) {
      return QUrl(QStringLiteral("https://www.amazon.es/"));
    }
    // Canonical fallback for all other locales (e.g. US / international)
    return QUrl(QStringLiteral("https://www.amazon.com/"));
  }

  if (token == QLatin1String("youtube")) {
    return QUrl(QStringLiteral("https://www.youtube.com/"));
  }
  if (token == QLatin1String("github")) {
    return QUrl(QStringLiteral("https://github.com/"));
  }
  if (token == QLatin1String("reddit")) {
    return QUrl(QStringLiteral("https://www.reddit.com/"));
  }
  if (token == QLatin1String("instagram")) {
    return QUrl(QStringLiteral("https://www.instagram.com/"));
  }
  if (token == QLatin1String("facebook")) {
    return QUrl(QStringLiteral("https://www.facebook.com/"));
  }
  if (token == QLatin1String("twitter") || token == QLatin1String("x")) {
    return QUrl(QStringLiteral("https://x.com/"));
  }
  if (token == QLatin1String("wikipedia")) {
    return QUrl(QStringLiteral("https://www.wikipedia.org/"));
  }
  if (token == QLatin1String("linkedin")) {
    return QUrl(QStringLiteral("https://www.linkedin.com/"));
  }
  if (token == QLatin1String("twitch")) {
    return QUrl(QStringLiteral("https://www.twitch.tv/"));
  }
  if (token == QLatin1String("spotify")) {
    return QUrl(QStringLiteral("https://open.spotify.com/"));
  }

  return std::nullopt;
}

QVector<NavigationCandidate> BootstrapWellKnownSiteProvider::findCandidates(
    const QString &normalizedToken,
    const QLocale &locale) const {
  const auto optUrl = findNavigationCandidate(normalizedToken, locale);
  if (!optUrl.has_value() || !optUrl->isValid()) {
    return {};
  }

  NavigationCandidate c;
  c.url = *optUrl;
  c.displayHost = optUrl->host();
  c.source = QStringLiteral("bootstrap");
  c.score = CandidateScoringConfig::kBootstrapScore;
  c.confidence = 0.75;
  c.isBootstrap = true;
  c.hasExactTokenMatch = true;
  c.isExactDomainMatch = true;
  c.isRootCanonical = true;
  return {c};
}

QUrl AddressInputResolver::searchUrlForEngine(const QString &engine, const QString &queryText) {
  QUrl url(QString::fromLatin1(searchEngineDefinition(engine).searchUrl));
  QUrlQuery params;
  params.addQueryItem(QStringLiteral("q"), queryText.trimmed());
  url.setQuery(params);
  return url;
}

bool AddressInputResolver::isDangerousScheme(const QString &scheme) {
  const QString s = scheme.trimmed().toLower();
  return s == QLatin1String("javascript") ||
         s == QLatin1String("data") ||
         s == QLatin1String("file") ||
         s == QLatin1String("chrome") ||
         s == QLatin1String("edge") ||
         s == QLatin1String("vbscript") ||
         s == QLatin1String("about");
}

bool AddressInputResolver::isAllowedExplicitScheme(const QString &scheme) {
  const QString s = scheme.trimmed().toLower();
  return s == QLatin1String("http") ||
         s == QLatin1String("https") ||
         s == QLatin1String("ardali");
}

bool AddressInputResolver::isLocalhostHost(const QString &host) {
  const QString lower = host.trimmed().toLower();
  return lower == QLatin1String("localhost") ||
         lower == QLatin1String("127.0.0.1") ||
         lower == QLatin1String("::1") ||
         lower == QLatin1String("[::1]");
}

bool AddressInputResolver::isIpAddress(const QString &host) {
  QString clean = host.trimmed();
  if (clean.startsWith(QLatin1Char('[')) && clean.endsWith(QLatin1Char(']'))) {
    clean = clean.mid(1, clean.length() - 2);
  }
  QHostAddress addr;
  if (addr.setAddress(clean)) {
    return addr.protocol() == QAbstractSocket::IPv4Protocol ||
           addr.protocol() == QAbstractSocket::IPv6Protocol;
  }
  return false;
}

bool AddressInputResolver::isValidPort(int port) {
  return port >= 1 && port <= 65535;
}

bool AddressInputResolver::isValidDomainHost(const QString &host) {
  if (host.isEmpty()) return false;
  if (host.startsWith(QLatin1Char('.')) || host.endsWith(QLatin1Char('.'))) return false;
  if (host.contains(QStringLiteral(".."))) return false;

  // Utilize Qt's IDN/Punycode conversion to validate international domains cleanly
  const QString ace = QUrl::toAce(host.trimmed().toLower());
  if (ace.isEmpty() || !ace.contains(QLatin1Char('.'))) return false;

  const QStringList labels = ace.split(QLatin1Char('.'), Qt::KeepEmptyParts);
  if (labels.size() < 2) return false;

  for (const QString &label : labels) {
    if (label.isEmpty() || label.length() > 63) return false;
    if (label.startsWith(QLatin1Char('-')) || label.endsWith(QLatin1Char('-'))) return false;
    for (const QChar &ch : label) {
      if (!ch.isLetterOrNumber() && ch != QLatin1Char('-')) return false;
    }
  }

  const QString tld = labels.last();
  if (tld.length() < 2) return false;

  // TLD cannot be purely numeric (e.g. 3.14, 1.2)
  bool allDigits = true;
  for (const QChar &ch : tld) {
    if (!ch.isDigit()) {
      allDigits = false;
      break;
    }
  }
  if (allDigits) return false;

  // Standard TLD must only be ASCII letters or Punycode (xn--)
  if (!tld.startsWith(QStringLiteral("xn--"))) {
    for (const QChar &ch : tld) {
      const char latin = ch.toLatin1();
      if (!((latin >= 'a' && latin <= 'z') || (latin >= 'A' && latin <= 'Z'))) {
        return false;
      }
    }
  }

  return true;
}

bool AddressInputResolver::shouldTreatAsSearch(const QString &trimmedInput) {
  return trimmedInput.contains(QLatin1Char(' ')) ||
         trimmedInput.contains(QLatin1Char('\t')) ||
         trimmedInput.contains(QLatin1Char('\n')) ||
         trimmedInput.contains(QLatin1Char('\r'));
}

void AddressInputResolver::splitAuthorityAndPath(
    const QString &input,
    QString &outAuthority,
    QString &outPathQuery) {
  int firstDelim = -1;
  for (int i = 0; i < input.length(); ++i) {
    const QChar c = input.at(i);
    if (c == QLatin1Char('/') || c == QLatin1Char('?') || c == QLatin1Char('#')) {
      firstDelim = i;
      break;
    }
  }
  if (firstDelim >= 0) {
    outAuthority = input.left(firstDelim);
    outPathQuery = input.mid(firstDelim);
  } else {
    outAuthority = input;
    outPathQuery.clear();
  }
}

bool AddressInputResolver::parseHostAndPort(
    const QString &authority,
    QString &outHost,
    int &outPort) {
  outPort = -1;
  if (authority.isEmpty()) return false;

  if (authority.startsWith(QLatin1Char('['))) {
    const int closingBracket = authority.indexOf(QLatin1Char(']'));
    if (closingBracket < 0) return false;
    outHost = authority.left(closingBracket + 1);
    if (closingBracket + 1 < authority.length()) {
      if (authority.at(closingBracket + 1) != QLatin1Char(':')) return false;
      const QString portStr = authority.mid(closingBracket + 2);
      bool ok = false;
      const int port = portStr.toInt(&ok);
      if (!ok || !isValidPort(port)) return false;
      outPort = port;
    }
    return true;
  }

  const int colonIdx = authority.lastIndexOf(QLatin1Char(':'));
  if (colonIdx >= 0) {
    outHost = authority.left(colonIdx);
    const QString portStr = authority.mid(colonIdx + 1);
    if (portStr.isEmpty()) return false;
    bool ok = false;
    const int port = portStr.toInt(&ok);
    if (!ok || !isValidPort(port)) return false;
    outPort = port;
  } else {
    outHost = authority;
  }

  return !outHost.isEmpty();
}

AddressResolutionResult AddressInputResolver::resolve(
    const QString &rawInput,
    const QString &searchEngine,
    const QLocale &locale,
    const INavigationCandidateProvider *candidateProvider) {
  AddressResolutionResult res;
  const QString trimmed = rawInput.trimmed();
  if (trimmed.isEmpty()) {
    res.isValid = false;
    return res;
  }

  // 1. Dangerous scheme check (javascript:, data:, file:, etc.)
  const int colonIndex = trimmed.indexOf(QLatin1Char(':'));
  if (colonIndex > 0) {
    const QString possibleScheme = trimmed.left(colonIndex).toLower();
    if (isDangerousScheme(possibleScheme)) {
      // Must NEVER produce or navigate to dangerous schemes via omnibox
      res.classification = AddressInputClassification::Search;
      res.searchQuery = trimmed;
      res.url = searchUrlForEngine(searchEngine, trimmed);
      return res;
    }
  }

  // 2. Explicit allowed scheme check (http://, https://, ardali://)
  if (colonIndex > 0) {
    const QString possibleScheme = trimmed.left(colonIndex).toLower();
    if (isAllowedExplicitScheme(possibleScheme)) {
      const QUrl parsedUrl(trimmed);
      if (parsedUrl.isValid()) {
        res.classification = AddressInputClassification::DirectUrl;
        res.url = parsedUrl;
        return res;
      }
    }
  }

  // 3. Multi-word search policy check
  if (shouldTreatAsSearch(trimmed)) {
    res.classification = AddressInputClassification::Search;
    res.searchQuery = trimmed;
    res.url = searchUrlForEngine(searchEngine, trimmed);
    return res;
  }

  // 4. Split authority and path/query
  QString authority;
  QString pathQuery;
  splitAuthorityAndPath(trimmed, authority, pathQuery);

  QString host;
  int port = -1;
  const bool hostPortOk = parseHostAndPort(authority, host, port);

  // If authority contains ':' but host/port parsing fails, it's malformed -> safe fallback to search
  if (authority.contains(QLatin1Char(':')) && (!hostPortOk || (port != -1 && !isValidPort(port)))) {
    res.classification = AddressInputClassification::Search;
    res.searchQuery = trimmed;
    res.url = searchUrlForEngine(searchEngine, trimmed);
    return res;
  }

  // 5. Localhost check
  if (hostPortOk && isLocalhostHost(host)) {
    res.classification = AddressInputClassification::Localhost;
    QString urlStr = QStringLiteral("http://") + host;
    if (port > 0) {
      urlStr += QStringLiteral(":") + QString::number(port);
    }
    if (!pathQuery.isEmpty()) {
      if (!pathQuery.startsWith(QLatin1Char('/')) && !pathQuery.startsWith(QLatin1Char('?')) && !pathQuery.startsWith(QLatin1Char('#'))) {
        urlStr += QLatin1Char('/');
      }
      urlStr += pathQuery;
    } else {
      urlStr += QLatin1Char('/');
    }
    res.url = QUrl(urlStr);
    return res;
  }

  // 6. IP address check
  if (hostPortOk && isIpAddress(host)) {
    res.classification = AddressInputClassification::IpAddress;
    QString urlStr = QStringLiteral("http://") + host;
    if (port > 0) {
      urlStr += QStringLiteral(":") + QString::number(port);
    }
    if (!pathQuery.isEmpty()) {
      if (!pathQuery.startsWith(QLatin1Char('/')) && !pathQuery.startsWith(QLatin1Char('?')) && !pathQuery.startsWith(QLatin1Char('#'))) {
        urlStr += QLatin1Char('/');
      }
      urlStr += pathQuery;
    } else {
      urlStr += QLatin1Char('/');
    }
    res.url = QUrl(urlStr);
    return res;
  }

  // 7. Well-known site alias candidate check (exact single token, no path/query/port)
  if (pathQuery.isEmpty() && port == -1) {
    BootstrapWellKnownSiteProvider defaultProvider;
    const INavigationCandidateProvider *provider = candidateProvider ? candidateProvider : &defaultProvider;
    const auto candidate = provider->findNavigationCandidate(trimmed, locale);
    if (candidate.has_value() && candidate->isValid()) {
      res.classification = AddressInputClassification::WellKnownAlias;
      res.url = *candidate;
      return res;
    }
  }

  // 8. Schemeless domain check
  if (hostPortOk && isValidDomainHost(host)) {
    res.classification = AddressInputClassification::Domain;
    QString urlStr = QStringLiteral("https://") + host;
    if (port > 0) {
      urlStr += QStringLiteral(":") + QString::number(port);
    }
    if (!pathQuery.isEmpty()) {
      if (!pathQuery.startsWith(QLatin1Char('/')) && !pathQuery.startsWith(QLatin1Char('?')) && !pathQuery.startsWith(QLatin1Char('#'))) {
        urlStr += QLatin1Char('/');
      }
      urlStr += pathQuery;
    }
    res.url = QUrl(urlStr);
    return res;
  }

  // 9. Fallback to search query
  res.classification = AddressInputClassification::Search;
  res.searchQuery = trimmed;
  res.url = searchUrlForEngine(searchEngine, trimmed);
  return res;
}

QUrl AddressInputResolver::resolveUrl(
    const QString &rawInput,
    const QString &searchEngine,
    const QLocale &locale,
    const INavigationCandidateProvider *candidateProvider) {
  const auto res = resolve(rawInput, searchEngine, locale, candidateProvider);
  return res.url;
}

}  // namespace ardali::core
