#pragma once

#include <QHostAddress>
#include <QString>
#include <QStringList>
#include <QUrl>

namespace ardali::core {

struct ExtractedHostTokens {
  QString primaryDomainToken;
  QStringList subdomainTokens;
  QString canonicalHost;
  bool isValid = false;
};

class DomainNormalizer {
 public:
  // Normalizes a host by lowercasing, trimming, and removing standard infrastructure prefixes (www, m, mobile)
  static QString normalizeHost(const QString &host);

  // Checks if a host is localhost or private IP address
  static bool isLocalOrPrivateHost(const QString &host);

  // Extracts primary domain token and subdomain tokens without relying on a full/hardcoded PSL table
  static ExtractedHostTokens extractTokens(const QString &host);

  // Derives the canonical host root URL (e.g. https://www.ebay.com/)
  static QUrl canonicalRootUrl(const QUrl &url);

  // Evaluates whether normalized input token matches candidate tokens
  static bool matchesToken(
      const QString &userInputToken,
      const ExtractedHostTokens &tokens,
      bool &outIsExactDomain,
      bool &outIsExactSubdomain);
};

}  // namespace ardali::core
