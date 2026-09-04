#include <cassert>
#include <cstdlib>
#include <QCoreApplication>
#include <QDir>
#include <QTemporaryDir>
#include <QFile>

#include "../core/web_engine_hardware_acceleration.h"

using namespace ardali;

int main(int argc, char *argv[]) {
  QCoreApplication app(argc, argv);

  // 1. Live System Capability Detection
  {
    WebEngineHardwareAcceleration::resetForTesting();
    const HardwareAccelerationStatus liveStatus = WebEngineHardwareAcceleration::detectCapability();
    
    // On this Linux system with Intel UHD 630 and /usr/lib/dri/iHD_drv_video.so, it must be Supported
    if (QFile::exists(QStringLiteral("/usr/lib/dri/iHD_drv_video.so")) &&
        QFile::exists(QStringLiteral("/dev/dri/renderD128"))) {
      assert(liveStatus.videoDecodeCapability == HardwareVideoDecodeCapability::Supported);
      assert(liveStatus.drmRenderNodeFound);
      assert(liveStatus.vaapiDriverFound);
    }
  }

  // 2. Mock Unsupported Environment (Empty directories)
  {
    WebEngineHardwareAcceleration::resetForTesting();
    QTemporaryDir emptyDri;
    QTemporaryDir emptyDevDri;
    assert(emptyDri.isValid() && emptyDevDri.isValid());

    const HardwareAccelerationStatus status = WebEngineHardwareAcceleration::detectCapability(
        emptyDri.path(), emptyDevDri.path());
    assert(status.videoDecodeCapability == HardwareVideoDecodeCapability::Unsupported);
    assert(!status.drmRenderNodeFound);
    assert(!status.vaapiDriverFound);

    const QStringList flags = WebEngineHardwareAcceleration::standardHardwareFlags(status);
    assert(flags.isEmpty());
  }

  // 3. Mock Supported Environment
  {
    WebEngineHardwareAcceleration::resetForTesting();
    QTemporaryDir mockDri;
    QTemporaryDir mockDevDri;
    assert(mockDri.isValid() && mockDevDri.isValid());

    // Create mock driver and mock render node
    QFile driverFile(QDir(mockDri.path()).filePath(QStringLiteral("iHD_drv_video.so")));
    assert(driverFile.open(QIODevice::WriteOnly));
    driverFile.close();

    QFile renderNodeFile(QDir(mockDevDri.path()).filePath(QStringLiteral("renderD128")));
    assert(renderNodeFile.open(QIODevice::WriteOnly));
    renderNodeFile.close();

    const HardwareAccelerationStatus status = WebEngineHardwareAcceleration::detectCapability(
        mockDri.path(), mockDevDri.path());
    assert(status.videoDecodeCapability == HardwareVideoDecodeCapability::Supported);
    assert(status.drmRenderNodeFound);
    assert(status.vaapiDriverFound);

    const QStringList flags = WebEngineHardwareAcceleration::standardHardwareFlags(status);
    assert(!flags.isEmpty());
    assert(flags.contains(QStringLiteral("--enable-features=AcceleratedVideoDecoder,AcceleratedVideoDecodeLinuxGL,AcceleratedVideoDecodeLinuxZeroCopyGL")));
    assert(flags.contains(QStringLiteral("--use-gl=angle")));
    assert(flags.contains(QStringLiteral("--use-angle=gl")));
    assert(flags.contains(QStringLiteral("--enable-gpu-rasterization")));
  }

  // 4. Disable by Environment Override
  {
    WebEngineHardwareAcceleration::resetForTesting();
    qputenv("ARDALI_DISABLE_VAAPI", "1");
    const HardwareAccelerationStatus status = WebEngineHardwareAcceleration::detectCapability();
    assert(status.videoDecodeCapability == HardwareVideoDecodeCapability::DisabledByDriver);
    const QStringList flags = WebEngineHardwareAcceleration::standardHardwareFlags(status);
    assert(flags.isEmpty());
    qunsetenv("ARDALI_DISABLE_VAAPI");
  }

  // 5. Flag Merging and Deduplication
  {
    const QString existing = QStringLiteral("--remote-debugging-port=9222 --enable-features=ExistingFeatA,ExistingFeatB --disable-features=OldDisable --custom-flag");
    const QStringList hwFlags = {
        QStringLiteral("--enable-features=AcceleratedVideoDecoder,AcceleratedVideoDecodeLinuxGL,AcceleratedVideoDecodeLinuxZeroCopyGL"),
        QStringLiteral("--use-gl=angle"),
        QStringLiteral("--use-angle=gl"),
        QStringLiteral("--enable-gpu-rasterization"),
    };

    const QString merged = WebEngineHardwareAcceleration::mergeChromiumFlags(existing, hwFlags);
    
    // Check that existing features and new features are merged into single --enable-features and --disable-features
    assert(merged.contains(QStringLiteral("AcceleratedVideoDecoder")));
    assert(merged.contains(QStringLiteral("AcceleratedVideoDecodeLinuxGL")));
    assert(merged.contains(QStringLiteral("AcceleratedVideoDecodeLinuxZeroCopyGL")));
    assert(merged.contains(QStringLiteral("ExistingFeatA")));
    assert(merged.contains(QStringLiteral("ExistingFeatB")));
    assert(merged.contains(QStringLiteral("OldDisable")));
    assert(merged.contains(QStringLiteral("--use-gl=angle")));
    assert(merged.contains(QStringLiteral("--use-angle=gl")));
    assert(merged.contains(QStringLiteral("--enable-gpu-rasterization")));
    assert(merged.contains(QStringLiteral("--remote-debugging-port=9222")));
    assert(merged.contains(QStringLiteral("--custom-flag")));

    // Ensure no duplicate --enable-features flags exist
    assert(merged.count(QStringLiteral("--enable-features=")) == 1);
    assert(merged.count(QStringLiteral("--disable-features=")) == 1);
    
    // Security check: must NEVER contain --no-sandbox
    assert(!merged.contains(QStringLiteral("--no-sandbox")));
    assert(!merged.contains(QStringLiteral("--disable-web-security")));
  }

  // 6. Early Runtime Initialization
  {
    WebEngineHardwareAcceleration::resetForTesting();
    qputenv("QTWEBENGINE_CHROMIUM_FLAGS", "--initial-user-flag");
    WebEngineHardwareAcceleration::initializeEarlyRuntime();

    const HardwareAccelerationStatus cached = WebEngineHardwareAcceleration::currentStatus();
    assert(cached.videoDecodeCapability != HardwareVideoDecodeCapability::Unknown);

    const QString envFlags = QString::fromLocal8Bit(qgetenv("QTWEBENGINE_CHROMIUM_FLAGS"));
    assert(envFlags.contains(QStringLiteral("--initial-user-flag")));
    if (cached.videoDecodeCapability == HardwareVideoDecodeCapability::Supported) {
      assert(envFlags.contains(QStringLiteral("AcceleratedVideoDecoder")));
      assert(envFlags.contains(QStringLiteral("AcceleratedVideoDecodeLinuxZeroCopyGL")));
    }
  }

  return 0;
}
