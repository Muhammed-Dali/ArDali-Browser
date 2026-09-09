#pragma once

#include <QHostAddress>
#include <QLocale>
#include <QString>
#include <QUrl>
#include <optional>

#include "navigation_candidate.h"

namespace ardali::core {

enum class AddressInputClassification {
  DirectUrl,       // Explicit allowed scheme (http, https, ardali)
  WellKnownAlias,  // Bootstrap site alias (e.g. amazon, youtube, github)
  Localhost,       // Localhost development server (localhost, 127.0.0.1, [::1])
  IpAddress,       // IPv4 or IPv6 address with optional port/path
  Domain,          // Schemeless internet domain (e.g. amazon.com.tr, sub.example.co.uk)
  Search           // Search query fallback for the active search engine
};

struct AddressResolutionResult {
  AddressInputClassification classification = AddressInputClassification::Search;
  QUrl url;
  QString searchQuery;
  bool isValid = true;
};

// Interface for navigation candidate providers (Phase 2 extension point for History, Bookmarks, etc.)
class INavigationCandidateProvider {
 public:
  virtual ~INavigationCandidateProvider() = default;
  virtual std::optional<QUrl> findNavigationCandidate(
      const QString &normalizedToken,
      const QLocale &locale) const = 0;
  virtual QVector<NavigationCandidate> findCandidates(
      const QString &normalizedToken,
      const QLocale &locale) const {
    Q_UNUSED(normalizedToken);
    Q_UNUSED(locale);
    return {};
  }
};

// Bootstrap well-known site candidate provider
class BootstrapWellKnownSiteProvider final : public INavigationCandidateProvider {
 public:
  std::optional<QUrl> findNavigationCandidate(
      const QString &normalizedToken,
      const QLocale &locale) const override;

  QVector<NavigationCandidate> findCandidates(
      const QString &normalizedToken,
      const QLocale &locale) const override;

  static bool isTurkeyLocale(const QLocale &locale);
};

class AddressInputResolver {
 public:
  // Main resolution entry points
  static AddressResolutionResult resolve(
      const QString &rawInput,
      const QString &searchEngine = QStringLiteral("Google"),
      const QLocale &locale = QLocale::system(),
      const INavigationCandidateProvider *candidateProvider = nullptr);

  static QUrl resolveUrl(
      const QString &rawInput,
      const QString &searchEngine = QStringLiteral("Google"),
      const QLocale &locale = QLocale::system(),
      const INavigationCandidateProvider *candidateProvider = nullptr);

  // Search URL generation (single authoritative implementation)
  static QUrl searchUrlForEngine(const QString &engine, const QString &queryText);

  // Scheme security checks
  static bool isDangerousScheme(const QString &scheme);
  static bool isAllowedExplicitScheme(const QString &scheme);

  // Host and port validation helpers
  static bool isLocalhostHost(const QString &host);
  static bool isIpAddress(const QString &host);
  static bool isValidPort(int port);
  static bool isValidDomainHost(const QString &host);

  // Search classification policy
  static bool shouldTreatAsSearch(const QString &trimmedInput);

 private:
  static void splitAuthorityAndPath(
      const QString &input,
      QString &outAuthority,
      QString &outPathQuery);

  static bool parseHostAndPort(
      const QString &authority,
      QString &outHost,
      int &outPort);
};

}  // namespace ardali::core
