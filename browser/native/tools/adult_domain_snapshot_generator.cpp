#include <iostream>

#include <QCoreApplication>
#include <QFileInfo>

#include "core/compact_domain_table.h"

int main(int argc, char *argv[]) {
  QCoreApplication app(argc, argv);
  if (argc == 3 && QString::fromLocal8Bit(argv[1]) == QLatin1String("--validate")) {
    const QString snapshot = QString::fromLocal8Bit(argv[2]);
    dalinira::core::CompactDomainTable verified;
    qint64 loadMs = 0;
    if (!verified.loadSnapshot(snapshot, &loadMs)) {
      std::cerr << "adult snapshot validation failed: "
                << snapshot.toStdString() << '\n';
      return 1;
    }
    std::cout << "adult snapshot validated: " << verified.domainCount()
              << " domains, " << QFileInfo(snapshot).size()
              << " bytes, " << loadMs << " ms\n";
    return 0;
  }
  if (argc != 3) {
    std::cerr << "usage: dalinira-adult-domain-snapshot-generator <input.txt> <output.bin>\n"
                 "   or: dalinira-adult-domain-snapshot-generator --validate <snapshot.bin>\n";
    return 2;
  }

  const QString input = QString::fromLocal8Bit(argv[1]);
  const QString output = QString::fromLocal8Bit(argv[2]);
  dalinira::core::CompactDomainTable table;
  qint64 parseMs = 0;
  qint64 buildMs = 0;
  const dalinira::core::DomainListStats stats =
      table.loadFromFile(input, &parseMs, &buildMs);
  if (stats.validCount == 0) {
    std::cerr << "adult snapshot generation failed: no valid domains in "
              << input.toStdString() << '\n';
    return 1;
  }
  if (!table.saveSnapshot(output)) {
    std::cerr << "adult snapshot generation failed: cannot write "
              << output.toStdString() << '\n';
    return 1;
  }

  // Re-open through the production validator before accepting the artifact.
  dalinira::core::CompactDomainTable verified;
  qint64 verifyMs = 0;
  if (!verified.loadSnapshot(output, &verifyMs) ||
      verified.domainCount() != table.domainCount() ||
      verified.totalStructureBytes() != table.totalStructureBytes()) {
    std::cerr << "adult snapshot generation failed: validation mismatch\n";
    return 1;
  }

  std::cout << "adult snapshot: " << stats.validCount << " valid, "
            << stats.duplicateCount << " duplicate, "
            << stats.invalidCount << " invalid; parse " << parseMs
            << " ms, build " << buildMs << " ms, verify " << verifyMs
            << " ms, " << QFileInfo(output).size() << " bytes\n";
  return 0;
}
