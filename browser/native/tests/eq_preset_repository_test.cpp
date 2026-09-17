#include "eq_preset_repository.h"

#include <QCoreApplication>
#include <QHash>
#include <cstdio>

int main(int argc, char *argv[]) {
  QCoreApplication app(argc, argv);
  EqPresetRepository repository;
  if (!repository.load() || repository.presets().size() != 1776 || repository.invalidCount() != 0) {
    std::fprintf(stderr, "load %s %lld %d\n", qPrintable(repository.dataPath()), static_cast<long long>(repository.presets().size()), repository.invalidCount());
    return 1;
  }
  if (repository.presets().front().id != QStringLiteral("__flat__")
      || repository.presets().front().bands != QVector<double>(32, 0.0)) return 1;
  bool foundSony = false;
  QHash<QString, int> categoryCounts;
  for (const EqPreset &preset : repository.presets()) {
    for (const QString &group : preset.groups) ++categoryCounts[group];
    if (preset.name == QStringLiteral("Sony WF-1000XM4 (Mellow preset)")) {
      foundSony = foundSony || (preset.bands.size() == 32 && preset.bands[0] == -6.4 && preset.bands[31] == -7.0);
    }
  }
  for (const QString &group : {QStringLiteral("bass"), QStringLiteral("treble"), QStringLiteral("vocal"),
                               QStringLiteral("jazz"), QStringLiteral("classical"), QStringLiteral("electronic"),
                               QStringLiteral("pop"), QStringLiteral("rock"), QStringLiteral("vshape"),
                               QStringLiteral("flat"), QStringLiteral("other")}) {
    if (categoryCounts.value(group) < 2) {
      std::fprintf(stderr, "category %s has only %d presets\n", qPrintable(group), categoryCounts.value(group));
      return 1;
    }
  }
  if (!foundSony) std::fputs("Sony preset missing or malformed\n", stderr);
  return foundSony ? 0 : 1;
}
