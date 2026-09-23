#include <cassert>
#include <chrono>
#include <cstdio>
#include <fstream>
#include <iostream>
#include <random>
#include <unistd.h>

#include <QCoreApplication>
#include <QElapsedTimer>
#include <QFile>
#include <QFileInfo>
#include <QProcess>
#include <QString>
#include <QStringList>
#include <QUrl>

#include "core/adult_content_protection.h"
#include "core/compact_domain_table.h"

using dalinira::core::AdultContentProtectionService;
using dalinira::core::CompactDomainTable;
using dalinira::core::DomainListStats;

static size_t getCurrentRSSBytes() {
  FILE *fp = fopen("/proc/self/statm", "r");
  if (!fp) return 0;
  long size = 0, resident = 0;
  if (fscanf(fp, "%ld %ld", &size, &resident) == 2) {
    fclose(fp);
    return static_cast<size_t>(resident) * static_cast<size_t>(sysconf(_SC_PAGESIZE));
  }
  fclose(fp);
  return 0;
}

// Generate the 250k+ dataset if it doesn't already exist
static void ensureDatasetGenerated(const QString &blocklistFile) {
  if (QFile::exists(blocklistFile)) {
    return;
  }

  std::cout << "[Setup] Generating realistic production dataset (" << blocklistFile.toStdString() << ")...\n";

  QFile outFile(blocklistFile);
  if (!outFile.open(QIODevice::WriteOnly | QIODevice::Text)) {
    std::cerr << "Failed to create benchmark dataset file at " << blocklistFile.toStdString() << "\n";
    return;
  }
  QTextStream out(&outFile);

  out << "# ================================================================\n";
  out << "# Title: The Block List Project - Porn (Benchmark Dataset)\n";
  out << "# Description: Block list for adult / porn websites (Domain-only, No-IP)\n";
  out << "# Homepage: https://blocklistproject.github.io/Lists/\n";
  out << "# License: MIT\n";
  out << "# ================================================================\n\n";

  const QStringList tlds = {
      QStringLiteral(".com"), QStringLiteral(".net"), QStringLiteral(".org"),
      QStringLiteral(".xxx"), QStringLiteral(".adult"), QStringLiteral(".cam"),
      QStringLiteral(".live"), QStringLiteral(".tube"), QStringLiteral(".tv"),
      QStringLiteral(".me"), QStringLiteral(".site"), QStringLiteral(".top")
  };
  const QStringList prefixes = {
      QStringLiteral("porn"), QStringLiteral("adult"), QStringLiteral("sex"),
      QStringLiteral("tube"), QStringLiteral("cam"), QStringLiteral("strip"),
      QStringLiteral("erotic"), QStringLiteral("hardcore"), QStringLiteral("hot"),
      QStringLiteral("sensual"), QStringLiteral("fetish"), QStringLiteral("nsfw")
  };

  const int targetDomains = 250000;
  for (int i = 0; i < targetDomains; ++i) {
    const QString prefix = prefixes.at(i % prefixes.size());
    const QString tld = tlds.at((i / prefixes.size()) % tlds.size());
    out << prefix << "-site-" << i << tld << "\n";
  }

  // Add duplicates (~2,500 duplicates)
  for (int i = 0; i < 2500; ++i) {
    out << prefixes.at(i % prefixes.size()) << "-site-" << (i * 10) << tlds.at(0) << "\n";
  }

  // Add invalid entries (~16 invalid items: IPs, schemes, paths, localhost, .local, malformed)
  out << "127.0.0.1\n";
  out << "192.168.1.100\n";
  out << "10.0.0.1\n";
  out << "::1\n";
  out << "fe80::1ff:fe23:4567:890a\n";
  out << "localhost\n";
  out << "myrouter.local\n";
  out << "internal-server.internal\n";
  out << "company.corp\n";
  out << "http://sample-porn-site.com\n";
  out << "https://sample-adult-site.net/path/video\n";
  out << "adult-video.com/gallery?id=99\n";
  out << "bad_character_site.com\n";
  out << "-leading-hyphen.com\n";
  out << "trailing-hyphen-.com\n";
  out << "dalinira://blocked/adult\n";
  out << "# comment line inside list\n";
  out << "\n";

  outFile.close();
  std::cout << "        Generated 250,000 primary domains + 2,500 duplicates + invalid entries.\n";
}

// -------------------------------------------------------------
// Engine A: QSet<QString> Benchmark Runner
// -------------------------------------------------------------
static void runQSetBenchmark(const QString &blocklistFile) {
  std::cout << "========================================================\n";
  std::cout << "  ENGINE A: Existing QSet<QString> Benchmark\n";
  std::cout << "========================================================\n";

  QFileInfo fileInfo(blocklistFile);
  const qint64 fileSizeBytes = fileInfo.size();
  std::cout << "Dataset File: " << fileInfo.absoluteFilePath().toStdString() << "\n";
  std::cout << "File Size:    " << fileSizeBytes << " bytes ("
            << (fileSizeBytes / (1024.0 * 1024.0)) << " MB)\n\n";

  const size_t rssBeforeBytes = getCurrentRSSBytes();

  auto &service = AdultContentProtectionService::instance();
  service.clear();

  QElapsedTimer loadTimer;
  loadTimer.start();
  const DomainListStats stats = service.loadFromFileWithStats(blocklistFile);
  const qint64 elapsedMs = loadTimer.elapsed();

  const size_t rssAfterBytes = getCurrentRSSBytes();
  const double ramDeltaMb = (rssAfterBytes > rssBeforeBytes)
      ? (rssAfterBytes - rssBeforeBytes) / (1024.0 * 1024.0) : 0.0;
  const double bytesPerDomain = (stats.validCount > 0 && rssAfterBytes > rssBeforeBytes)
      ? static_cast<double>(rssAfterBytes - rssBeforeBytes) / stats.validCount : 0.0;

  std::cout << "[Load & Memory Metrics]\n";
  std::cout << "  Valid Domains Stored:     " << stats.validCount << "\n";
  std::cout << "  Duplicate Lines Skipped:  " << stats.duplicateCount << "\n";
  std::cout << "  Invalid Lines Rejected:   " << stats.invalidCount << "\n";
  std::cout << "  Total Load Time:          " << elapsedMs << " ms (" << (elapsedMs / 1000.0) << " s)\n";
  std::cout << "  Process RSS Before:       " << (rssBeforeBytes / (1024.0 * 1024.0)) << " MB\n";
  std::cout << "  Process RSS After:        " << (rssAfterBytes / (1024.0 * 1024.0)) << " MB\n";
  std::cout << "  RSS Delta (RAM Increase): " << ramDeltaMb << " MB\n";
  std::cout << "  Approx Bytes / Domain:    " << bytesPerDomain << " bytes/domain\n\n";

  // Allowlist setup
  service.loadAllowlistFromLines({
      QStringLiteral("safe-adult-exception.com"),
      QStringLiteral("whitelisted-education.org")
  });

  std::cout << "[Lookup Performance (10,000 iterations each)]\n";
  const int iterations = 10000;

  // 1. Exact Match
  {
    QElapsedTimer t;
    t.start();
    int hits = 0;
    for (int i = 0; i < iterations; ++i) {
      const QString host = QStringLiteral("porn-site-") + QString::number(i % 140) + QStringLiteral(".com");
      if (service.isBlockedHost(host)) hits++;
    }
    const qint64 ns = t.nsecsElapsed();
    std::cout << "  [Exact Match]   Total: " << (ns / 1000000.0) << " ms, Hits: " << hits
              << "/" << iterations << ", Avg: " << (static_cast<double>(ns) / iterations) << " ns/op\n";
  }

  // 2. Subdomain
  {
    QElapsedTimer t;
    t.start();
    int hits = 0;
    for (int i = 0; i < iterations; ++i) {
      const QString host = QStringLiteral("video.stream.porn-site-") + QString::number(i % 140) + QStringLiteral(".com");
      if (service.isBlockedHost(host)) hits++;
    }
    const qint64 ns = t.nsecsElapsed();
    std::cout << "  [Subdomain]     Total: " << (ns / 1000000.0) << " ms, Hits: " << hits
              << "/" << iterations << ", Avg: " << (static_cast<double>(ns) / iterations) << " ns/op\n";
  }

  // 3. Non-Match
  {
    QElapsedTimer t;
    t.start();
    int misses = 0;
    for (int i = 0; i < iterations; ++i) {
      const QString host = QStringLiteral("clean-non-adult-domain-") + QString::number(i) + QStringLiteral(".org");
      if (!service.isBlockedHost(host)) misses++;
    }
    const qint64 ns = t.nsecsElapsed();
    std::cout << "  [Non-Match]     Total: " << (ns / 1000000.0) << " ms, Misses: " << misses
              << "/" << iterations << ", Avg: " << (static_cast<double>(ns) / iterations) << " ns/op\n";
  }

  // 4. Allowlist Bypass
  {
    QElapsedTimer t;
    t.start();
    int allowed = 0;
    for (int i = 0; i < iterations; ++i) {
      const QString host = QStringLiteral("sub.safe-adult-exception.com");
      if (!service.isBlockedHost(host)) allowed++;
    }
    const qint64 ns = t.nsecsElapsed();
    std::cout << "  [Allowlist]     Total: " << (ns / 1000000.0) << " ms, Allowed: " << allowed
              << "/" << iterations << ", Avg: " << (static_cast<double>(ns) / iterations) << " ns/op\n";
  }
}

// -------------------------------------------------------------
// Engine B: CompactDomainTable Benchmark Runner
// -------------------------------------------------------------
static void runCompactBenchmark(const QString &blocklistFile) {
  std::cout << "========================================================\n";
  std::cout << "  ENGINE B: Compact Sorted Domain Table Benchmark\n";
  std::cout << "========================================================\n";

  QFileInfo fileInfo(blocklistFile);
  const qint64 fileSizeBytes = fileInfo.size();
  std::cout << "Dataset File: " << fileInfo.absoluteFilePath().toStdString() << "\n";
  std::cout << "File Size:    " << fileSizeBytes << " bytes ("
            << (fileSizeBytes / (1024.0 * 1024.0)) << " MB)\n\n";

  const size_t rssBeforeBytes = getCurrentRSSBytes();

  CompactDomainTable compactTable;
  qint64 parseTimeMs = 0;
  qint64 buildTimeMs = 0;

  const DomainListStats stats = compactTable.loadFromFile(blocklistFile, &parseTimeMs, &buildTimeMs);
  const qint64 totalLoadMs = parseTimeMs + buildTimeMs;

  const size_t rssAfterBytes = getCurrentRSSBytes();
  const double ramDeltaMb = (rssAfterBytes > rssBeforeBytes)
      ? (rssAfterBytes - rssBeforeBytes) / (1024.0 * 1024.0) : 0.0;
  const double bytesPerDomain = (stats.validCount > 0 && rssAfterBytes > rssBeforeBytes)
      ? static_cast<double>(rssAfterBytes - rssBeforeBytes) / stats.validCount : 0.0;

  std::cout << "[Load & Memory Metrics]\n";
  std::cout << "  Valid Domains Stored:     " << stats.validCount << "\n";
  std::cout << "  Duplicate Lines Skipped:  " << stats.duplicateCount << "\n";
  std::cout << "  Invalid Lines Rejected:   " << stats.invalidCount << "\n";
  std::cout << "  Parse & Validation Time:  " << parseTimeMs << " ms\n";
  std::cout << "  Sort & Structure Build:   " << buildTimeMs << " ms\n";
  std::cout << "  Total Load Time:          " << totalLoadMs << " ms (" << (totalLoadMs / 1000.0) << " s)\n";
  std::cout << "  Raw Contiguous Buffer:    " << compactTable.bufferBytes() << " bytes ("
            << (compactTable.bufferBytes() / (1024.0 * 1024.0)) << " MB)\n";
  std::cout << "  Offset/Length Index:      " << compactTable.indexBytes() << " bytes ("
            << (compactTable.indexBytes() / (1024.0 * 1024.0)) << " MB)\n";
  std::cout << "  Total Structure Size:     " << compactTable.totalStructureBytes() << " bytes ("
            << (compactTable.totalStructureBytes() / (1024.0 * 1024.0)) << " MB)\n";
  std::cout << "  Process RSS Before:       " << (rssBeforeBytes / (1024.0 * 1024.0)) << " MB\n";
  std::cout << "  Process RSS After:        " << (rssAfterBytes / (1024.0 * 1024.0)) << " MB\n";
  std::cout << "  RSS Delta (RAM Increase): " << ramDeltaMb << " MB\n";
  std::cout << "  Approx Bytes / Domain:    " << bytesPerDomain << " bytes/domain\n\n";

  // Allowlist setup via service
  auto &service = AdultContentProtectionService::instance();
  service.clearAllowlist();
  service.loadAllowlistFromLines({
      QStringLiteral("safe-adult-exception.com"),
      QStringLiteral("whitelisted-education.org")
  });

  std::cout << "[Lookup Performance (10,000 iterations each)]\n";
  const int iterations = 10000;

  // 1. Exact Match
  {
    QElapsedTimer t;
    t.start();
    int hits = 0;
    for (int i = 0; i < iterations; ++i) {
      const QString host = QStringLiteral("porn-site-") + QString::number(i % 140) + QStringLiteral(".com");
      if (compactTable.isBlockedHost(host, service)) hits++;
    }
    const qint64 ns = t.nsecsElapsed();
    std::cout << "  [Exact Match]   Total: " << (ns / 1000000.0) << " ms, Hits: " << hits
              << "/" << iterations << ", Avg: " << (static_cast<double>(ns) / iterations) << " ns/op\n";
  }

  // 2. Subdomain
  {
    QElapsedTimer t;
    t.start();
    int hits = 0;
    for (int i = 0; i < iterations; ++i) {
      const QString host = QStringLiteral("video.stream.porn-site-") + QString::number(i % 140) + QStringLiteral(".com");
      if (compactTable.isBlockedHost(host, service)) hits++;
    }
    const qint64 ns = t.nsecsElapsed();
    std::cout << "  [Subdomain]     Total: " << (ns / 1000000.0) << " ms, Hits: " << hits
              << "/" << iterations << ", Avg: " << (static_cast<double>(ns) / iterations) << " ns/op\n";
  }

  // 3. Non-Match
  {
    QElapsedTimer t;
    t.start();
    int misses = 0;
    for (int i = 0; i < iterations; ++i) {
      const QString host = QStringLiteral("clean-non-adult-domain-") + QString::number(i) + QStringLiteral(".org");
      if (!compactTable.isBlockedHost(host, service)) misses++;
    }
    const qint64 ns = t.nsecsElapsed();
    std::cout << "  [Non-Match]     Total: " << (ns / 1000000.0) << " ms, Misses: " << misses
              << "/" << iterations << ", Avg: " << (static_cast<double>(ns) / iterations) << " ns/op\n";
  }

  // 4. Allowlist Bypass
  {
    QElapsedTimer t;
    t.start();
    int allowed = 0;
    for (int i = 0; i < iterations; ++i) {
      const QString host = QStringLiteral("sub.safe-adult-exception.com");
      if (!compactTable.isBlockedHost(host, service)) allowed++;
    }
    const qint64 ns = t.nsecsElapsed();
    std::cout << "  [Allowlist]     Total: " << (ns / 1000000.0) << " ms, Allowed: " << allowed
              << "/" << iterations << ", Avg: " << (static_cast<double>(ns) / iterations) << " ns/op\n";
  }
}

// -------------------------------------------------------------
// Engine Correctness Verification: 1-to-1 Equivalence Check
// -------------------------------------------------------------
static bool runCorrectnessVerification(const QString &blocklistFile) {
  std::cout << "========================================================\n";
  std::cout << "  CORRECTNESS TEST: QSet vs CompactDomainTable 1-to-1\n";
  std::cout << "========================================================\n";

  auto &service = AdultContentProtectionService::instance();
  service.clear();
  service.clearAllowlist();
  const DomainListStats statsQSet = service.loadFromFileWithStats(blocklistFile);

  CompactDomainTable compactTable;
  const DomainListStats statsCompact = compactTable.loadFromFile(blocklistFile);

  std::cout << "1. Dataset Ingestion Verification:\n";
  std::cout << "   QSet Valid: " << statsQSet.validCount << ", Compact Valid: " << statsCompact.validCount << "\n";
  std::cout << "   QSet Duplicate: " << statsQSet.duplicateCount << ", Compact Duplicate: " << statsCompact.duplicateCount << "\n";
  std::cout << "   QSet Invalid: " << statsQSet.invalidCount << ", Compact Invalid: " << statsCompact.invalidCount << "\n";
  assert(statsQSet.validCount == statsCompact.validCount);
  assert(statsQSet.duplicateCount == statsCompact.duplicateCount);
  assert(statsQSet.invalidCount == statsCompact.invalidCount);
  std::cout << "   [PASS] Exact parity in domain parsing, deduplication and validation.\n\n";

  // Setup Allowlist in both
  service.loadAllowlistFromLines({
      QStringLiteral("safe-adult-exception.com"),
      QStringLiteral("sub.another-safe.example")
  });

  std::cout << "2. Edge Cases & Boundary Equivalence:\n";
  const QList<QPair<QString, bool>> edgeCases = {
      // Allowlist precedence
      {QStringLiteral("safe-adult-exception.com"), false},
      {QStringLiteral("sub.safe-adult-exception.com"), false},
      {QStringLiteral("deep.sub.safe-adult-exception.com"), false},
      {QStringLiteral("sub.another-safe.example"), false},

      // Boundary false positive checks
      {QStringLiteral("notadult-site-0.com"), false},
      {QStringLiteral("evil-porn-site-0.com"), false},
      {QStringLiteral("porn-site-0.com.safe.example"), false},
      {QStringLiteral("porn-site-0.com.evil.org"), false},

      // Subdomains of blocked domains
      {QStringLiteral("sub.porn-site-0.com"), true},
      {QStringLiteral("video.deep.porn-site-0.com"), true},
      {QStringLiteral("www.porn-site-0.com"), true},

      // Normalization: ports and trailing dots
      {QStringLiteral("porn-site-0.com."), true},
      {QStringLiteral("porn-site-0.com:8080"), true},
      {QStringLiteral("PORN-SITE-0.COM"), true},
      {QStringLiteral("Sub.Porn-Site-0.Com:443"), true},

      // Invalid inputs
      {QStringLiteral("127.0.0.1"), false},
      {QStringLiteral("::1"), false},
      {QStringLiteral("localhost"), false},
      {QStringLiteral("router.local"), false},
      {QStringLiteral("server.internal"), false},
      {QStringLiteral(""), false}
  };

  int edgePass = 0;
  for (const auto &pair : edgeCases) {
    const QString &host = pair.first;
    const bool expected = pair.second;
    const bool qsetRes = service.isBlockedHost(host);
    const bool compactRes = compactTable.isBlockedHost(host, service);

    if (qsetRes != expected || compactRes != expected || qsetRes != compactRes) {
      std::cerr << "   [FAIL] Edge case mismatch for '" << host.toStdString() << "': "
                << "Expected=" << expected << ", QSet=" << qsetRes << ", Compact=" << compactRes << "\n";
      return false;
    }
    edgePass++;
  }
  std::cout << "   [PASS] " << edgePass << "/" << edgeCases.size() << " edge case checks passed identically.\n\n";

  // Large-scale sampling (30,000 deterministically chosen tests)
  std::cout << "3. Large-Scale Dataset Sampling (30,000 queries):\n";
  int sampleHits = 0;
  int sampleSubdomainHits = 0;
  int sampleMisses = 0;
  int mismatches = 0;

  // 10k exact lookups
  for (int i = 0; i < 10000; ++i) {
    const QString host = QStringLiteral("porn-site-") + QString::number(i * 17 % 250000) + QStringLiteral(".com");
    const bool qsetRes = service.isBlockedHost(host);
    const bool compactRes = compactTable.isBlockedHost(host, service);
    if (qsetRes != compactRes) {
      mismatches++;
    }
    if (qsetRes) sampleHits++;
  }

  // 10k subdomain lookups
  for (int i = 0; i < 10000; ++i) {
    const QString host = QStringLiteral("cdn") + QString::number(i % 5) + QStringLiteral(".sub.porn-site-")
                       + QString::number(i * 13 % 250000) + QStringLiteral(".com");
    const bool qsetRes = service.isBlockedHost(host);
    const bool compactRes = compactTable.isBlockedHost(host, service);
    if (qsetRes != compactRes) {
      mismatches++;
    }
    if (qsetRes) sampleSubdomainHits++;
  }

  // 10k non-match lookups
  for (int i = 0; i < 10000; ++i) {
    const QString host = QStringLiteral("non-match-safe-site-") + QString::number(i) + QStringLiteral(".edu");
    const bool qsetRes = service.isBlockedHost(host);
    const bool compactRes = compactTable.isBlockedHost(host, service);
    if (qsetRes != compactRes) {
      mismatches++;
    }
    if (!qsetRes) sampleMisses++;
  }

  std::cout << "   Exact Match Tested:     10,000 (Hits: " << sampleHits << ")\n";
  std::cout << "   Subdomain Match Tested: 10,000 (Hits: " << sampleSubdomainHits << ")\n";
  std::cout << "   Non-Match Tested:       10,000 (Misses: " << sampleMisses << ")\n";
  std::cout << "   Total Lookups Evaluated: 30,000\n";
  std::cout << "   Total Mismatches:        " << mismatches << "\n";

  if (mismatches > 0) {
    std::cerr << "   [CRITICAL] Correctness check failed with " << mismatches << " mismatches!\n";
    return false;
  }

  std::cout << "   [PASS] 100% (30,000/30,000) decision equivalence confirmed!\n\n";
  return true;
}

// -------------------------------------------------------------
// Engine C: Full Official Production Dataset Benchmark (953k+ Domains)
// -------------------------------------------------------------
static bool runFullProductionBenchmark(const QString &productionFile) {
  std::cout << "======================================================================\n";
  std::cout << "  FULL PRODUCTION DATASET FINAL BENCHMARK\n";
  std::cout << "  Upstream Source: The Block List Project (blocklistproject/Lists)\n";
  std::cout << "  Category:        Porn / Adult Content\n";
  std::cout << "  Format:          domain-only / No-IP (Format: domains)\n";
  std::cout << "======================================================================\n\n";

  QFileInfo fi(productionFile);
  if (!fi.exists()) {
    std::cerr << "Production file not found at " << productionFile.toStdString() << "\n";
    return false;
  }

  // Count total lines in source file
  qint64 totalUpstreamLines = 0;
  {
    QFile f(productionFile);
    if (f.open(QIODevice::ReadOnly)) {
      char buf[65536];
      while (!f.atEnd()) {
        const qint64 read = f.read(buf, sizeof(buf));
        for (qint64 i = 0; i < read; ++i) {
          if (buf[i] == '\n') totalUpstreamLines++;
        }
      }
    }
  }

  std::cout << "[1. Kaynak ve Dosya Bilgileri]\n";
  std::cout << "  Kaynak:                The Block List Project (alt-version/porn-nl.txt)\n";
  std::cout << "  Indirme Tarihi:        2026-09-23 (Upstream: 2026-07-18 01:36:51 UTC)\n";
  std::cout << "  Dosya Konumu:          " << fi.absoluteFilePath().toStdString() << "\n";
  std::cout << "  Dosya Boyutu:          " << fi.size() << " bayt ("
            << (fi.size() / (1024.0 * 1024.0)) << " MB)\n";
  std::cout << "  Upstream Toplam Satir: " << totalUpstreamLines << "\n\n";

  const size_t rssBeforeBytes = getCurrentRSSBytes();

  std::cout << "[2. Full Dataset Sanitization & Load (CompactDomainTable)]\n";
  CompactDomainTable table;
  qint64 parseTimeMs = 0;
  qint64 buildTimeMs = 0;

  const DomainListStats stats = table.loadFromFile(productionFile, &parseTimeMs, &buildTimeMs);
  const qint64 totalLoadMs = parseTimeMs + buildTimeMs;

  const size_t rssAfterBytes = getCurrentRSSBytes();
  const double ramDeltaMb = (rssAfterBytes > rssBeforeBytes)
      ? (rssAfterBytes - rssBeforeBytes) / (1024.0 * 1024.0) : 0.0;
  const double bytesPerDomain = (stats.validCount > 0 && rssAfterBytes > rssBeforeBytes)
      ? static_cast<double>(rssAfterBytes - rssBeforeBytes) / stats.validCount : 0.0;

  std::cout << "  Gecerli Domain Sayisi:        " << stats.validCount << "\n";
  std::cout << "  Duplicate (Tekillesen):       " << stats.duplicateCount << "\n";
  std::cout << "  Gecersiz / Reddedilen:        " << stats.invalidCount << "\n";
  std::cout << "  Parse & Dogrulama Suresi:     " << parseTimeMs << " ms\n";
  std::cout << "  Siralama & Indeksleme Suresi: " << buildTimeMs << " ms\n";
  std::cout << "  Toplam Senkron Load Suresi:   " << totalLoadMs << " ms ("
            << (totalLoadMs / 1000.0) << " s) [Startup Impact]\n";
  std::cout << "  Contiguous Buffer Boyutu:     " << table.bufferBytes() << " bayt ("
            << (table.bufferBytes() / (1024.0 * 1024.0)) << " MB)\n";
  std::cout << "  Offset/Length Indeks Boyutu:  " << table.indexBytes() << " bayt ("
            << (table.indexBytes() / (1024.0 * 1024.0)) << " MB)\n";
  std::cout << "  Toplam Yapi Gercek Boyutu:    " << table.totalStructureBytes() << " bayt ("
            << (table.totalStructureBytes() / (1024.0 * 1024.0)) << " MB)\n";
  std::cout << "  Process RSS Once:             " << (rssBeforeBytes / (1024.0 * 1024.0)) << " MB\n";
  std::cout << "  Process RSS Sonra:            " << (rssAfterBytes / (1024.0 * 1024.0)) << " MB\n";
  std::cout << "  RSS Delta (RAM Artisi):       " << ramDeltaMb << " MB\n";
  std::cout << "  Domain Basina Bellek:         " << bytesPerDomain << " bayt / domain\n\n";

  // Setup Allowlist
  auto &service = AdultContentProtectionService::instance();
  service.clearAllowlist();
  service.loadAllowlistFromLines({
      QStringLiteral("safe-adult-exception.com"),
      QStringLiteral("sub.another-safe.example")
  });

  std::cout << "[3. Full Dataset Lookup Benchmarks (10.000 iterasyon)]\n";
  const int iterations = 10000;
  const size_t totalDomains = table.domainCount();
  const size_t stride = (totalDomains > iterations) ? (totalDomains / iterations) : 1;

  // A) Exact Match
  {
    QElapsedTimer t;
    t.start();
    int hits = 0;
    for (int i = 0; i < iterations; ++i) {
      const size_t idx = (i * stride) % totalDomains;
      const std::string_view domain = table.domainAt(idx);
      if (table.contains(domain)) {
        hits++;
      }
    }
    const qint64 ns = t.nsecsElapsed();
    const double avgNs = static_cast<double>(ns) / iterations;
    std::cout << "  [Exact Match]   Toplam: " << (ns / 1000000.0) << " ms, Hits: "
              << hits << "/" << iterations << ", Ortalama: " << avgNs << " ns/op ("
              << (avgNs / 1000.0) << " µs/op)\n";
    assert(hits == iterations);
  }

  // B) Subdomain Match
  {
    QElapsedTimer t;
    t.start();
    int hits = 0;
    for (int i = 0; i < iterations; ++i) {
      const size_t idx = (i * stride) % totalDomains;
      const std::string domain = std::string("video.stream.") + std::string(table.domainAt(idx));
      if (table.matchesDomain(std::string_view(domain))) {
        hits++;
      }
    }
    const qint64 ns = t.nsecsElapsed();
    const double avgNs = static_cast<double>(ns) / iterations;
    std::cout << "  [Subdomain]     Toplam: " << (ns / 1000000.0) << " ms, Hits: "
              << hits << "/" << iterations << ", Ortalama: " << avgNs << " ns/op ("
              << (avgNs / 1000.0) << " µs/op)\n";
    assert(hits == iterations);
  }

  // C) Non-Match
  {
    QElapsedTimer t;
    t.start();
    int misses = 0;
    for (int i = 0; i < iterations; ++i) {
      const std::string host = "clean-verified-gov-site-" + std::to_string(i) + ".gov";
      if (!table.matchesDomain(std::string_view(host))) {
        misses++;
      }
    }
    const qint64 ns = t.nsecsElapsed();
    const double avgNs = static_cast<double>(ns) / iterations;
    std::cout << "  [Non-Match]     Toplam: " << (ns / 1000000.0) << " ms, Misses: "
              << misses << "/" << iterations << ", Ortalama: " << avgNs << " ns/op ("
              << (avgNs / 1000.0) << " µs/op)\n";
    assert(misses == iterations);
  }

  // D) Allowlist Bypass
  {
    QElapsedTimer t;
    t.start();
    int allowed = 0;
    for (int i = 0; i < iterations; ++i) {
      const QString host = QStringLiteral("sub.safe-adult-exception.com");
      if (!table.isBlockedHost(host, service)) {
        allowed++;
      }
    }
    const qint64 ns = t.nsecsElapsed();
    const double avgNs = static_cast<double>(ns) / iterations;
    std::cout << "  [Allowlist]     Toplam: " << (ns / 1000000.0) << " ms, Allowed: "
              << allowed << "/" << iterations << ", Ortalama: " << avgNs << " ns/op ("
              << (avgNs / 1000.0) << " µs/op)\n\n";
    assert(allowed == iterations);
  }

  std::cout << "[4. Full Dataset Dogruluk ve Guvenlik Testleri]\n";
  // 1. Exact match on known first & last domain in table
  const std::string_view firstDom = table.domainAt(0);
  const std::string_view midDom = table.domainAt(totalDomains / 2);
  const std::string_view lastDom = table.domainAt(totalDomains - 1);
  assert(table.contains(firstDom));
  assert(table.contains(midDom));
  assert(table.contains(lastDom));
  std::cout << "  [PASS] Exact domain: Ilk, orta ve son domainler tam eslesti.\n";

  // 2. Subdomain check
  assert(table.matchesDomain(std::string("sub.") + std::string(midDom)));
  assert(table.matchesDomain(std::string("deep.video.hd.") + std::string(midDom)));
  std::cout << "  [PASS] Subdomain: Cok katmanli alt domainler basariyla engellendi.\n";

  // 3. Safe non-match (search engines and critical platforms)
  assert(!table.matchesDomain("google.com"));
  assert(!table.matchesDomain("www.google.com"));
  assert(!table.matchesDomain("duckduckgo.com"));
  assert(!table.matchesDomain("startpage.com"));
  assert(!table.matchesDomain("mojeek.com"));
  assert(!table.matchesDomain("youtube.com"));
  assert(!table.matchesDomain("wikipedia.org"));
  assert(!table.matchesDomain("archlinux.org"));

  assert(!table.isBlockedHost(QStringLiteral("google.com"), service));
  assert(!table.isBlockedHost(QStringLiteral("www.google.com"), service));
  assert(!table.isBlockedHost(QStringLiteral("duckduckgo.com"), service));
  assert(!table.isBlockedHost(QStringLiteral("startpage.com"), service));
  assert(!table.isBlockedHost(QStringLiteral("mojeek.com"), service));
  assert(!table.isBlockedHost(QStringLiteral("youtube.com"), service));
  std::cout << "  [PASS] Safe non-match: Mesru siteler ve arama motorlari serbest.\n";


  // 4. Domain boundary & prefix attacks
  const std::string midStr(midDom);
  assert(!table.matchesDomain(std::string("not") + midStr));
  assert(!table.matchesDomain(std::string("evil-") + midStr));
  assert(!table.matchesDomain(midStr + ".safe.example"));
  assert(!table.matchesDomain(midStr + ".evil.org"));
  std::cout << "  [PASS] Domain boundary: Suffix/Prefix ve yanlis-pozitif saldirilari engellendi.\n";

  // 5. Uppercase normalization
  QString midUpper = QString::fromUtf8(midStr.c_str()).toUpper();
  assert(table.isBlockedHost(midUpper, service));
  std::cout << "  [PASS] Uppercase: Buyuk harfli domainler normalize edilip engellendi.\n";

  // 6. Trailing dot and port
  QString midDotPort = QString::fromUtf8(midStr.c_str()) + QStringLiteral(".:8080");
  assert(table.isBlockedHost(midDotPort, service));
  std::cout << "  [PASS] Trailing dot & Port: Port ve nokta temizligi dogrulandi.\n";

  // 7. Allowlist precedence
  assert(!table.isBlockedHost(QStringLiteral("safe-adult-exception.com"), service));
  assert(!table.isBlockedHost(QStringLiteral("sub.safe-adult-exception.com"), service));
  std::cout << "  [PASS] Allowlist precedence: Allowlist blocklist'i basariyla ezdi.\n\n";

  std::cout << "======================================================================\n";
  std::cout << "  FULL PRODUCTION BENCHMARK COMPLETE!\n";
  std::cout << "  NOT: Production blocklist DaliNira'ya henuz ship edilmedi.\n";
  std::cout << "======================================================================\n";
  return true;
}

// -------------------------------------------------------------
// Binary Snapshot Build/Load Benchmark
// -------------------------------------------------------------
static bool runSnapshotBenchmark(const QString &sourceFile) {
  if (!QFile::exists(sourceFile)) {
    std::cerr << "Snapshot source file not found: " << sourceFile.toStdString() << "\n";
    return false;
  }
  const QString snapshotFile = QStringLiteral("build/adult_domains_benchmark.bin");
  const QString corruptFile = QStringLiteral("build/adult_domains_benchmark_corrupt.bin");

  CompactDomainTable built;
  qint64 parseMs = 0, buildMs = 0;
  const DomainListStats stats = built.loadFromFile(sourceFile, &parseMs, &buildMs);
  if (stats.validCount <= 0) return false;

  QElapsedTimer writeTimer;
  writeTimer.start();
  if (!built.saveSnapshot(snapshotFile)) {
    std::cerr << "Failed to write snapshot.\n";
    return false;
  }
  const qint64 writeMs = writeTimer.elapsed();

  const size_t rssBefore = getCurrentRSSBytes();
  CompactDomainTable loaded;
  qint64 loadMs = 0;
  if (!loaded.loadSnapshot(snapshotFile, &loadMs)) {
    std::cerr << "Failed to load valid snapshot.\n";
    return false;
  }
  const size_t rssAfter = getCurrentRSSBytes();

  if (loaded.domainCount() != built.domainCount() ||
      loaded.totalStructureBytes() != built.totalStructureBytes()) {
    std::cerr << "Snapshot round-trip structure mismatch.\n";
    return false;
  }
  const size_t probes[] = {0, built.domainCount() / 2, built.domainCount() - 1};
  for (size_t i : probes) {
    if (loaded.domainAt(i) != built.domainAt(i) || !loaded.contains(built.domainAt(i))) {
      std::cerr << "Snapshot round-trip lookup mismatch.\n";
      return false;
    }
  }

  // Corruption must fail safely, never produce a partially trusted table.
  QFile::remove(corruptFile);
  if (!QFile::copy(snapshotFile, corruptFile)) return false;
  QFile corrupt(corruptFile);
  if (!corrupt.open(QIODevice::ReadWrite) || corrupt.size() < 40) return false;
  corrupt.seek(corrupt.size() - 1);
  char byte = 0;
  if (corrupt.read(&byte, 1) != 1) return false;
  corrupt.seek(corrupt.size() - 1);
  byte ^= 0x5a;
  if (corrupt.write(&byte, 1) != 1) return false;
  corrupt.close();
  CompactDomainTable rejected;
  if (rejected.loadSnapshot(corruptFile)) {
    std::cerr << "Corrupted snapshot was incorrectly accepted.\n";
    return false;
  }
  QFile::remove(corruptFile);

  const QFileInfo snapInfo(snapshotFile);
  std::cout << "========================================================\n";
  std::cout << "  BINARY SNAPSHOT PROTOTYPE BENCHMARK\n";
  std::cout << "========================================================\n";
  std::cout << "Source:             " << sourceFile.toStdString() << "\n";
  std::cout << "Valid domains:      " << stats.validCount << "\n";
  std::cout << "Text parse:         " << parseMs << " ms\n";
  std::cout << "Sort/index build:   " << buildMs << " ms\n";
  std::cout << "Snapshot write:     " << writeMs << " ms\n";
  std::cout << "Snapshot file size: " << snapInfo.size() << " bytes\n";
  std::cout << "Snapshot load:      " << loadMs << " ms\n";
  std::cout << "RSS delta on load:  "
            << ((rssAfter > rssBefore) ? (rssAfter - rssBefore) / (1024.0 * 1024.0) : 0.0)
            << " MB\n";
  std::cout << "Round-trip:         PASS\n";
  std::cout << "Corruption reject:  PASS\n";
  std::cout << "Runtime integration: ENABLED\n";
  return true;
}

// -------------------------------------------------------------
// Main Dispatcher
// -------------------------------------------------------------
int main(int argc, char *argv[]) {
  QCoreApplication app(argc, argv);

  const QString defaultSampleFile = QStringLiteral("build/production_benchmark_sample.txt");
  const QString fullProductionFile = QStringLiteral("build/upstream_porn_blocklist_production.txt");

  if (argc > 1) {
    const QString mode = QString::fromUtf8(argv[1]);
    if (mode == QStringLiteral("--snapshot")) {
      const QString source = (argc > 2) ? QString::fromUtf8(argv[2]) : defaultSampleFile;
      if (!QFile::exists(source) && source == defaultSampleFile) ensureDatasetGenerated(defaultSampleFile);
      return runSnapshotBenchmark(source) ? 0 : 1;
    }
    if (mode == QStringLiteral("--full")) {
      const bool ok = runFullProductionBenchmark(fullProductionFile);
      return ok ? 0 : 1;
    }
    if (mode == QStringLiteral("--qset")) {
      runQSetBenchmark(defaultSampleFile);
      return 0;
    }
    if (mode == QStringLiteral("--compact")) {
      runCompactBenchmark(defaultSampleFile);
      return 0;
    }
    if (mode == QStringLiteral("--correctness")) {
      const bool ok = runCorrectnessVerification(defaultSampleFile);
      return ok ? 0 : 1;
    }
  }

  ensureDatasetGenerated(defaultSampleFile);


  // If invoked without mode flags, run each in isolated subprocess to get unpolluted RSS metrics
  const QString execPath = QCoreApplication::applicationFilePath();
  std::cout << "========================================================\n";
  std::cout << "  DaliNira Adult Content Protection A/B Benchmark\n";
  std::cout << "  Target: The Block List Project (250k+ Domains)\n";
  std::cout << "========================================================\n\n";

  // 1. Run QSet in isolated process
  {
    QProcess proc;
    proc.setProcessChannelMode(QProcess::ForwardedChannels);
    proc.start(execPath, {QStringLiteral("--qset")});
    proc.waitForFinished(-1);
  }
  std::cout << "\n";

  // 2. Run Compact in isolated process
  {
    QProcess proc;
    proc.setProcessChannelMode(QProcess::ForwardedChannels);
    proc.start(execPath, {QStringLiteral("--compact")});
    proc.waitForFinished(-1);
  }
  std::cout << "\n";

  // 3. Run Correctness Verification
  {
    QProcess proc;
    proc.setProcessChannelMode(QProcess::ForwardedChannels);
    proc.start(execPath, {QStringLiteral("--correctness")});
    proc.waitForFinished(-1);
    if (proc.exitCode() != 0) {
      std::cerr << "Correctness verification failed with code " << proc.exitCode() << "\n";
      return 1;
    }
  }

  return 0;
}
