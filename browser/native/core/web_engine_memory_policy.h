#pragma once

#include <QString>

namespace ardali {

struct WebEngineMemoryPolicyStatus {
  bool configured = false;
  QString launcherPath;
  QString realProcessPath;
  QString error;
};

class WebEngineMemoryPolicy {
 public:
  static constexpr int kArenaMax = 2;
  static constexpr int kTrimThresholdBytes = 128 * 1024;

  // Routes QtWebEngine subprocesses through the allocator launcher. The
  // browser process itself deliberately receives no MALLOC_* overrides.
  static WebEngineMemoryPolicyStatus configureSubprocessLauncher(
      const QString &applicationDir,
      const QString &qtLibraryExecutablesDir = QString());
};

}  // namespace ardali
