#pragma once

#include <QObject>
#include <QReadWriteLock>
#include <QSet>
#include <QString>
#include <QStringList>
#include <QUrl>

#include <memory>

namespace dalinira::core {

class CompactDomainTable;

struct DomainListStats {
  int validCount = 0;
  int duplicateCount = 0;
  int invalidCount = 0;
};

class AdultContentProtectionService final {
 public:
  static AdultContentProtectionService &instance();

  // Host normalization: lowercases, trims, removes port and trailing dots
  static QString normalizeHost(const QString &rawHost);

  // Strict domain validation: rejects IPs, localhost, .local, internal domains,
  // paths, schemes, query parameters and malformed DNS characters
  static bool isValidCanonicalDomain(const QString &domain);

  // Safe boundary check: host matches ruleDomain exactly or as a subdomain (.ruleDomain)
  static bool matchesDomain(const QString &normalizedHost, const QString &ruleDomain);

  // Decision flow:
  // 1. Normalize host
  // 2. Check allowlist -> if match, ALLOW (return false)
  // 3. Check blocklist -> if match, BLOCK (return true)
  // 4. Default -> ALLOW (return false)
  bool isBlockedHost(const QString &rawHost) const;
  bool isBlocked(const QUrl &url) const;

  // Allowlist checks (same domain-boundary logic)
  bool isAllowedHost(const QString &rawHost) const;

  // Blocklist Configuration & Data management
  bool loadFromFile(const QString &filePath);
  bool loadSnapshot(const QString &filePath, qint64 *loadTimeMs = nullptr);
  void loadFromLines(const QStringList &lines);
  DomainListStats loadFromFileWithStats(const QString &filePath);
  DomainListStats loadFromLinesWithStats(const QStringList &lines);
  void addDomain(const QString &domain);
  void clear();
  int domainCount() const;
  void reload();
  void setCustomFilePath(const QString &path);

  // Allowlist Configuration & Data management
  bool loadAllowlistFromFile(const QString &filePath);
  void loadAllowlistFromLines(const QStringList &lines);
  void addAllowDomain(const QString &domain);
  void clearAllowlist();
  int allowlistDomainCount() const;
  void reloadAllowlist();
  void setCustomAllowlistFilePath(const QString &path);

 private:
  AdultContentProtectionService();
  ~AdultContentProtectionService();
  AdultContentProtectionService(const AdultContentProtectionService &) = delete;
  AdultContentProtectionService &operator=(const AdultContentProtectionService &) = delete;

  QString resolveSnapshotPath() const;
  QString resolveAllowlistFilePath() const;

  mutable QReadWriteLock lock_;
  QSet<QString> canonicalDomains_;
  std::unique_ptr<CompactDomainTable> compactDomains_;
  QSet<QString> allowlistDomains_;
  QString customFilePath_;
  QString customAllowlistFilePath_;
};

}  // namespace dalinira::core
