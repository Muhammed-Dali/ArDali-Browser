#ifndef ARDALI_DESKTOP_TABS_TAB_ANIMATION_METRICS_H_
#define ARDALI_DESKTOP_TABS_TAB_ANIMATION_METRICS_H_

#include <QSettings>
#include <QtGlobal>

namespace ardali::desktop_tabs {

// Central timings for tab-strip and tear-off transitions. Keeping these in
// one place also gives tests and reduced-motion users a deterministic instant
// fallback without changing the drag state machine.
struct TabAnimationMetrics {
  static constexpr int frameIntervalMs = 16;
  static constexpr int tabOpenDurationMs = 220;
  static constexpr int tabCloseDurationMs = 190;
  static constexpr int tabSlotDurationMs = 200;
  static constexpr int tabSettleDurationMs = 200;
  static constexpr int windowTransitionDurationMs = 200;
  static constexpr qreal detachedWindowInitialScale = 0.92;
  static constexpr qreal detachedWindowInitialOpacity = 0.88;

  static bool animationsEnabled() {
    if (qEnvironmentVariableIntValue("ARDALI_DISABLE_ANIMATIONS") == 1) {
      return false;
    }
    return QSettings().value(QStringLiteral("browser/animationsEnabled"), true)
        .toBool();
  }
};

}  // namespace ardali::desktop_tabs

#endif  // ARDALI_DESKTOP_TABS_TAB_ANIMATION_METRICS_H_
