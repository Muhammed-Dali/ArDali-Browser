#include "audio_effects_page.h"
#include "web_audio_effects_controller.h"
#include "tab_performance_manager.h"

#include <QApplication>
#include <QSettings>
#include <QTemporaryDir>
#include <QVector>
#include <cmath>

int main(int argc, char *argv[]) {
  QApplication app(argc, argv);
  QTemporaryDir directory;
  if (!directory.isValid()) return 1;
  QSettings::setDefaultFormat(QSettings::IniFormat);
  QSettings::setPath(QSettings::IniFormat, QSettings::UserScope, directory.path());
  QCoreApplication::setOrganizationName(QStringLiteral("ArDaliTest"));
  QCoreApplication::setApplicationName(QStringLiteral("AdaptiveAudioDspTest"));

  // 1. Activity Checks
  {
    WebAudioEffectsController controller;
    if (controller.isEqualizerActive()) return 2;
    if (controller.isToneActive()) return 3;
    if (controller.isSpatialActive()) return 4;

    // EQ Activity
    controller.setEqualizerBand(10, 4.5);
    if (!controller.isEqualizerActive()) return 5;
    controller.setEqualizerBand(10, 0.0);
    if (controller.isEqualizerActive()) return 6;

    // Tone Activity
    controller.setBassDb(3.0);
    if (!controller.isToneActive()) return 7;
    controller.setBassDb(0.0);
    if (controller.isToneActive()) return 8;
    controller.setMidDb(-2.0);
    if (!controller.isToneActive()) return 9;
    controller.setMidDb(0.0);
    controller.setTrebleDb(1.5);
    if (!controller.isToneActive()) return 10;
    controller.setTrebleDb(0.0);
    if (controller.isToneActive()) return 11;

    // Spatial Activity
    controller.setStereoExpanderPercent(140.0);
    if (!controller.isSpatialActive()) return 12;
    controller.setStereoExpanderPercent(100.0);
    if (controller.isSpatialActive()) return 13;
    controller.setBalance(30.0);
    if (!controller.isSpatialActive()) return 14;
    controller.setBalance(0.0);
    if (controller.isSpatialActive()) return 15;
  }

  // 2. Performance Policy Mode Integration
  {
    WebAudioEffectsController controller;
    if (controller.performancePolicyMode() != ardali::PerformancePolicyMode::Balanced) return 16;

    controller.setPerformancePolicyMode(ardali::PerformancePolicyMode::MemorySaver);
    if (controller.performancePolicyMode() != ardali::PerformancePolicyMode::MemorySaver) return 17;

    const QString scriptMem = controller.parameterUpdateScript();
    if (!scriptMem.contains(QStringLiteral("policyMode: 'memory_saver'"))) return 18;

    controller.setPerformancePolicyMode(ardali::PerformancePolicyMode::MaximumPerformance);
    if (controller.performancePolicyMode() != ardali::PerformancePolicyMode::MaximumPerformance) return 19;

    const QString scriptMax = controller.parameterUpdateScript();
    if (!scriptMax.contains(QStringLiteral("policyMode: 'maximum_performance'"))) return 20;

    controller.setPerformancePolicyMode(ardali::PerformancePolicyMode::Balanced);
    const QString scriptBal = controller.parameterUpdateScript();
    if (!scriptBal.contains(QStringLiteral("policyMode: 'balanced'"))) return 21;
  }

  // 3. Panel Visibility & Meter Gating
  {
    WebAudioEffectsController controller;
    if (controller.isPanelVisible()) return 22;

    controller.setPanelVisible(true, QStringLiteral("compressor"));
    if (!controller.isPanelVisible()) return 23;
    if (controller.activeSubpanelId() != QStringLiteral("compressor")) return 24;

    const QString visibleScript = controller.parameterUpdateScript();
    if (!visibleScript.contains(QStringLiteral("panelVisible: true"))) return 25;
    if (!visibleScript.contains(QStringLiteral("activeSubpanel: 'compressor'"))) return 26;

    controller.setPanelVisible(false);
    if (controller.isPanelVisible()) return 27;

    const QString hiddenScript = controller.parameterUpdateScript();
    if (!hiddenScript.contains(QStringLiteral("panelVisible: false"))) return 28;

    // Meter requests should be guarded and ignored when panel is hidden
    controller.requestCompressorGainReduction();
    controller.requestLimiterReduction();
  }

  // 4. JS Script Invariants
  {
    WebAudioEffectsController controller;
    const QString injection = controller.injectionScript();
    if (!injection.contains(QStringLiteral("pruneStaleGraphs"))) return 29;
    if (!injection.contains(QStringLiteral("needsGraphRebuild"))) return 30;
    if (!injection.contains(QStringLiteral("disconnectEqGraph"))) return 31;
    if (!injection.contains(QStringLiteral("rebuildActiveGraph"))) return 32;
    if (!injection.contains(QStringLiteral("graph.source.connect(graph.ctx.destination)"))) return 33;
  }

  // 5. Rapid 20x ON/OFF Toggle Stress
  {
    WebAudioEffectsController controller;
    controller.setEqualizerBand(0, 5.0);
    controller.setBassDb(3.0);
    controller.setModuleEnabled(QStringLiteral("reverb"), true);

    for (int i = 0; i < 20; ++i) {
      controller.setEnabled(false);
      if (controller.enabled()) return 34;
      controller.setEnabled(true);
      if (!controller.enabled()) return 35;
    }

    // State must remain preserved after 20 toggles
    if (controller.equalizerBand(0) != 5.0) return 36;
    if (controller.bassDb() != 3.0) return 37;
    if (!controller.reverbEnabled()) return 38;
  }

  // 6. UI Integration Visibility Sync
  {
    WebAudioEffectsController controller;
    AudioEffectsPage page(&controller);
    if (controller.isPanelVisible()) return 39;

    page.show();
    QApplication::processEvents();
    if (!controller.isPanelVisible()) return 40;

    page.hide();
    QApplication::processEvents();
    if (controller.isPanelVisible()) return 41;
  }

  return 0;
}
