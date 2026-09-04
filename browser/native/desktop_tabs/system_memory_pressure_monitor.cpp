#include "system_memory_pressure_monitor.h"

#include <QFile>
#include <QTextStream>

namespace ardali {

SystemMemoryPressureMonitor::SystemMemoryPressureMonitor(QObject *parent)
    : QObject(parent) {
  evaluateSystemPressure();
}

MemoryPressureLevel SystemMemoryPressureMonitor::currentPressureLevel() const {
  if (simulatedLevel_.has_value()) {
    return simulatedLevel_.value();
  }
  return currentLevel_;
}

int64_t SystemMemoryPressureMonitor::availableMemoryMb() const {
  return availableMemoryMb_;
}

int64_t SystemMemoryPressureMonitor::totalMemoryMb() const {
  return totalMemoryMb_;
}

double SystemMemoryPressureMonitor::availableMemoryRatio() const {
  if (totalMemoryMb_ <= 0 || availableMemoryMb_ < 0) {
    return -1.0;
  }
  return static_cast<double>(availableMemoryMb_) / static_cast<double>(totalMemoryMb_);
}

void SystemMemoryPressureMonitor::refresh() {
  evaluateSystemPressure();
}

void SystemMemoryPressureMonitor::setSimulatedPressureLevel(std::optional<MemoryPressureLevel> level) {
  simulatedLevel_ = level;
  emit pressureLevelChanged(currentPressureLevel());
}

void SystemMemoryPressureMonitor::evaluateSystemPressure() {
  MemoryPressureLevel newLevel = MemoryPressureLevel::Normal;
  availableMemoryMb_ = -1;
  totalMemoryMb_ = -1;

#if defined(Q_OS_LINUX)
  QFile file(QStringLiteral("/proc/meminfo"));
  if (file.open(QIODevice::ReadOnly | QIODevice::Text)) {
    QTextStream in(&file);
    int64_t memTotalKb = -1;
    int64_t memAvailableKb = -1;
    int64_t memFreeKb = -1;
    int64_t buffersKb = 0;
    int64_t cachedKb = 0;

    auto extractKb = [](const QString &line) -> int64_t {
      const int colon = line.indexOf(QLatin1Char(':'));
      if (colon == -1) return -1;
      const QString rest = line.mid(colon + 1).trimmed();
      const int space = rest.indexOf(QLatin1Char(' '));
      const QString numStr = (space != -1) ? rest.left(space) : rest;
      return numStr.toLongLong();
    };

    while (!in.atEnd()) {
      const QString line = in.readLine();
      if (line.startsWith(QLatin1String("MemTotal:"))) {
        memTotalKb = extractKb(line);
      } else if (line.startsWith(QLatin1String("MemAvailable:"))) {
        memAvailableKb = extractKb(line);
      } else if (line.startsWith(QLatin1String("MemFree:"))) {
        memFreeKb = extractKb(line);
      } else if (line.startsWith(QLatin1String("Buffers:"))) {
        buffersKb = extractKb(line);
      } else if (line.startsWith(QLatin1String("Cached:"))) {
        cachedKb = extractKb(line);
      }
    }
    file.close();

    if (memTotalKb > 0) {
      totalMemoryMb_ = memTotalKb / 1024;

      if (memAvailableKb < 0 && memFreeKb >= 0) {
        memAvailableKb = memFreeKb + buffersKb + cachedKb;
      }

      if (memAvailableKb >= 0) {
        availableMemoryMb_ = memAvailableKb / 1024;
        const double ratio = static_cast<double>(memAvailableKb) / static_cast<double>(memTotalKb);

        if (ratio < 0.10) {
          newLevel = MemoryPressureLevel::Critical;
        } else if (ratio < 0.20) {
          newLevel = MemoryPressureLevel::Moderate;
        } else {
          newLevel = MemoryPressureLevel::Normal;
        }
      }
    }
  }
#else
  // On Windows / macOS / other platforms without specific implementation,
  // safe fallback is strictly Normal. Unknown state is NEVER assumed Moderate or Critical.
  newLevel = MemoryPressureLevel::Normal;
#endif

  if (currentLevel_ != newLevel) {
    currentLevel_ = newLevel;
    if (!simulatedLevel_.has_value()) {
      emit pressureLevelChanged(currentLevel_);
    }
  }
}

} // namespace ardali
