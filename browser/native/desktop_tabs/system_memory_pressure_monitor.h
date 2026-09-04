#pragma once

#include <QObject>
#include <cstdint>
#include <optional>

namespace ardali {

enum class MemoryPressureLevel {
  Normal,    ///< Plenty of memory available (> 20% free/available)
  Moderate,  ///< Memory becoming constrained (10% - 20% free/available)
  Critical   ///< Severe memory pressure (< 10% free/available)
};

/**
 * @brief Cross-platform system memory pressure monitor.
 *
 * Provides low-overhead, event-driven memory pressure detection.
 * On Linux, evaluates /proc/meminfo (MemAvailable / MemTotal).
 * On unsupported platforms, safely falls back to MemoryPressureLevel::Normal.
 */
class SystemMemoryPressureMonitor : public QObject {
  Q_OBJECT

 public:
  explicit SystemMemoryPressureMonitor(QObject *parent = nullptr);
  ~SystemMemoryPressureMonitor() override = default;

  /// Returns the current evaluated system memory pressure level.
  MemoryPressureLevel currentPressureLevel() const;

  /// Returns available memory in megabytes (if determinable, else -1).
  int64_t availableMemoryMb() const;

  /// Returns total physical memory in megabytes (if determinable, else -1).
  int64_t totalMemoryMb() const;

  /// Returns the fraction of memory available [0.0, 1.0] (or -1.0 if unknown).
  double availableMemoryRatio() const;

  /// Manually re-evaluates system memory pressure.
  void refresh();

  /// Sets a simulated pressure level for deterministic testing.
  void setSimulatedPressureLevel(std::optional<MemoryPressureLevel> level);

 signals:
  void pressureLevelChanged(ardali::MemoryPressureLevel level);

 private:
  void evaluateSystemPressure();

  MemoryPressureLevel currentLevel_ = MemoryPressureLevel::Normal;
  std::optional<MemoryPressureLevel> simulatedLevel_;
  int64_t availableMemoryMb_ = -1;
  int64_t totalMemoryMb_ = -1;
};

} // namespace ardali
