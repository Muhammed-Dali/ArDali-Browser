#include "eq_preset_repository.h"

#include <QCoreApplication>
#include <cstdio>

int main(int argc, char *argv[]) {
  QCoreApplication app(argc, argv);
  EqPresetRepository repository;
  if (!repository.load() || repository.presets().size() != 1765 || repository.invalidCount() != 0) {
    std::fprintf(stderr, "load %s %lld %d\n", qPrintable(repository.dataPath()), static_cast<long long>(repository.presets().size()), repository.invalidCount());
    return 1;
  }
  if (repository.presets().front().id != QStringLiteral("__flat__")
      || repository.presets().front().bands != QVector<double>(32, 0.0)) return 1;
  bool foundSony = false;
  for (const EqPreset &preset : repository.presets()) {
    if (preset.name == QStringLiteral("Sony WF-1000XM4 (Mellow preset)")) {
      foundSony = foundSony || (preset.bands.size() == 32 && preset.bands[0] == -6.4 && preset.bands[31] == -7.0);
    }
  }
  if (!foundSony) std::fputs("Sony preset missing or malformed\n", stderr);
  return foundSony ? 0 : 1;
}
