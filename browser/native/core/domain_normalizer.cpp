#include "domain_normalizer.h"

#include <QHostAddress>
#include <QSet>

namespace ardali::core {

QString DomainNormalizer::normalizeHost(const QString &host) {
  QString h = host.trimmed().toLower();
  if (h.isEmpty()) return {};

  // Strip port if present
  const int colon = h.lastIndexOf(QLatin1Char(':'));
  if (colon > 0 && !h.contains(QLatin1Char(']'))) {
    h = h.left(colon);
  }

  // Strip standard infrastructure prefixes
  if (h.startsWith(QStringLiteral("www."))) {
    h = h.mid(4);
  } else if (h.startsWith(QStringLiteral("m."))) {
    h = h.mid(2);
  } else if (h.startsWith(QStringLiteral("mobile."))) {
    h = h.mid(7);
  }
  return h;
}

bool DomainNormalizer::isLocalOrPrivateHost(const QString &host) {
  const QString h = host.trimmed().toLower();
  if (h.isEmpty()) return true;
  if (h == QLatin1String("localhost") || h.endsWith(QLatin1String(".localhost"))) {
    return true;
  }
  QHostAddress addr(h);
  if (!addr.isNull()) {
    if (addr.isLoopback()) return true;
    if (addr.protocol() == QAbstractSocket::IPv4Protocol) {
      const quint32 ip = addr.toIPv4Address();
      // 10.0.0.0/8
      if ((ip & 0xFF000000) == 0x0A000000) return true;
      // 172.16.0.0/12
      if ((ip & 0xFFF00000) == 0xAC100000) return true;
      // 192.168.0.0/16
      if ((ip & 0xFFFF0000) == 0xC0A80000) return true;
    }
  }
  return false;
}

ExtractedHostTokens DomainNormalizer::extractTokens(const QString &host) {
  ExtractedHostTokens result;
  if (isLocalOrPrivateHost(host)) {
    return result;
  }

  const QString normalized = normalizeHost(host);
  if (normalized.isEmpty()) return result;

  const QStringList segments = normalized.split(QLatin1Char('.'), Qt::SkipEmptyParts);
  const int n = segments.size();
  if (n < 2) return result;

  result.canonicalHost = normalized;

  // Check if second-to-last segment is a common delegation label (e.g. com, co, org, net, edu, gov, ac)
  static const QSet<QString> delegationLabels = {
      QStringLiteral("com"), QStringLiteral("co"), QStringLiteral("org"),
      QStringLiteral("net"), QStringLiteral("edu"), QStringLiteral("gov"),
      QStringLiteral("ac")
  };

  int primaryDomainIndex = n - 2;
  if (n >= 3 && delegationLabels.contains(segments.at(n - 2))) {
    primaryDomainIndex = n - 3;
  }

  if (primaryDomainIndex < 0 || primaryDomainIndex >= n) {
    return result;
  }

  result.primaryDomainToken = segments.at(primaryDomainIndex);
  for (int i = 0; i < primaryDomainIndex; ++i) {
    const QString sub = segments.at(i);
    if (sub != QLatin1String("www") && sub != QLatin1String("m") && sub != QLatin1String("mobile")) {
      result.subdomainTokens.append(sub);
    }
  }

  result.isValid = !result.primaryDomainToken.isEmpty();
  return result;
}

QUrl DomainNormalizer::canonicalRootUrl(const QUrl &url) {
  if (!url.isValid()) return {};
  QUrl root;
  const QString scheme = url.scheme().toLower();
  root.setScheme(scheme == QLatin1String("http") ? QStringLiteral("http") : QStringLiteral("https"));

  const QString host = url.host().toLower();
  root.setHost(host);
  const int port = url.port();
  if (port > 0 && port != 80 && port != 443) {
    root.setPort(port);
  }
  root.setPath(QStringLiteral("/"));
  return root;
}

bool DomainNormalizer::matchesToken(
    const QString &userInputToken,
    const ExtractedHostTokens &tokens,
    bool &outIsExactDomain,
    bool &outIsExactSubdomain) {
  outIsExactDomain = false;
  outIsExactSubdomain = false;
  if (!tokens.isValid) return false;

  const QString token = userInputToken.trimmed().toLower();
  if (token.isEmpty()) return false;

  if (token == tokens.primaryDomainToken) {
    outIsExactDomain = true;
    return true;
  }

  for (const QString &sub : tokens.subdomainTokens) {
    if (token == sub) {
      outIsExactSubdomain = true;
      return true;
    }
  }

  return false;
}

}  // namespace ardali::core
