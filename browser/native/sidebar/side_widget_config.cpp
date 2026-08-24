#include "side_widget_config.h"

SideWidgetConfig SideWidgetConfig::defaults() {
  SideWidgetConfig cfg;
  cfg.openDurationMs = 360;
  cfg.closeDurationMs = 280;
  cfg.openStaggerMs = 10;
  cfg.closeStaggerMs = 7;
  cfg.openEasing = QEasingCurve::OutCubic;
  cfg.closeEasing = QEasingCurve::InCubic;
  cfg.startScale = 0.22;
  cfg.hoverScale = 1.10;
  cfg.startRotation = -18.0;
  cfg.radiusX = 188.0;
  cfg.radiusY = 285.0;
  cfg.startAngle = -78.0;
  cfg.endAngle = 78.0;
  cfg.buttonDiameter = 48;
  cfg.buttonGlow = 1.0;
  cfg.triggerGlow = 1.0;
  cfg.animationsEnabled = true;
  return cfg;
}

QString SideWidgetConfig::easingToString(QEasingCurve::Type type) {
  switch (type) {
    case QEasingCurve::Linear: return QStringLiteral("Linear");
    case QEasingCurve::OutCubic: return QStringLiteral("OutCubic");
    case QEasingCurve::InCubic: return QStringLiteral("InCubic");
    case QEasingCurve::OutQuad: return QStringLiteral("OutQuad");
    case QEasingCurve::OutQuint: return QStringLiteral("OutQuint");
    case QEasingCurve::OutBack: return QStringLiteral("OutBack");
    case QEasingCurve::OutBounce: return QStringLiteral("OutBounce");
    case QEasingCurve::InOutCubic: return QStringLiteral("InOutCubic");
    default: return QStringLiteral("OutCubic");
  }
}

QEasingCurve::Type SideWidgetConfig::stringToEasing(const QString &str) {
  if (str == QStringLiteral("Linear")) return QEasingCurve::Linear;
  if (str == QStringLiteral("InCubic")) return QEasingCurve::InCubic;
  if (str == QStringLiteral("OutQuad")) return QEasingCurve::OutQuad;
  if (str == QStringLiteral("OutQuint")) return QEasingCurve::OutQuint;
  if (str == QStringLiteral("OutBack")) return QEasingCurve::OutBack;
  if (str == QStringLiteral("OutBounce")) return QEasingCurve::OutBounce;
  if (str == QStringLiteral("InOutCubic")) return QEasingCurve::InOutCubic;
  return QEasingCurve::OutCubic;
}

void SideWidgetConfig::save(QSettings &settings) const {
  settings.setValue(QStringLiteral("sideWidget/layoutVersion"), 2);
  settings.setValue(QStringLiteral("sideWidget/animation/openDuration"), openDurationMs);
  settings.setValue(QStringLiteral("sideWidget/animation/closeDuration"), closeDurationMs);
  settings.setValue(QStringLiteral("sideWidget/animation/openStagger"), openStaggerMs);
  settings.setValue(QStringLiteral("sideWidget/animation/closeStagger"), closeStaggerMs);
  settings.setValue(QStringLiteral("sideWidget/animation/openEasing"), easingToString(openEasing));
  settings.setValue(QStringLiteral("sideWidget/animation/closeEasing"), easingToString(closeEasing));
  settings.setValue(QStringLiteral("sideWidget/transform/startScale"), startScale);
  settings.setValue(QStringLiteral("sideWidget/transform/hoverScale"), hoverScale);
  settings.setValue(QStringLiteral("sideWidget/transform/startRotation"), startRotation);
  settings.setValue(QStringLiteral("sideWidget/geometry/radiusX"), radiusX);
  settings.setValue(QStringLiteral("sideWidget/geometry/radiusY"), radiusY);
  settings.setValue(QStringLiteral("sideWidget/geometry/startAngle"), startAngle);
  settings.setValue(QStringLiteral("sideWidget/geometry/endAngle"), endAngle);
  settings.setValue(QStringLiteral("sideWidget/appearance/buttonDiameter"), buttonDiameter);
  settings.setValue(QStringLiteral("sideWidget/appearance/buttonGlow"), buttonGlow);
  settings.setValue(QStringLiteral("sideWidget/appearance/triggerGlow"), triggerGlow);
  settings.setValue(QStringLiteral("sideWidget/appearance/animationsEnabled"), animationsEnabled);
}

void SideWidgetConfig::load(QSettings &settings) {
  // Restore the compact WebMedia radial-menu timing once. Older builds saved
  // experimental 500/28 values, which made the menu noticeably too slow.
  if (settings.value(QStringLiteral("sideWidget/layoutVersion"), 0).toInt() < 2) {
    *this = defaults();
    save(settings);
    settings.setValue(QStringLiteral("sideWidget/layoutVersion"), 2);
    return;
  }
  openDurationMs = settings.value(QStringLiteral("sideWidget/animation/openDuration"), openDurationMs).toInt();
  closeDurationMs = settings.value(QStringLiteral("sideWidget/animation/closeDuration"), closeDurationMs).toInt();
  openStaggerMs = settings.value(QStringLiteral("sideWidget/animation/openStagger"), openStaggerMs).toInt();
  closeStaggerMs = settings.value(QStringLiteral("sideWidget/animation/closeStagger"), closeStaggerMs).toInt();

  const QString openEasingStr = settings.value(QStringLiteral("sideWidget/animation/openEasing"), easingToString(openEasing)).toString();
  openEasing = stringToEasing(openEasingStr);

  const QString closeEasingStr = settings.value(QStringLiteral("sideWidget/animation/closeEasing"), easingToString(closeEasing)).toString();
  closeEasing = stringToEasing(closeEasingStr);

  startScale = settings.value(QStringLiteral("sideWidget/transform/startScale"), startScale).toDouble();
  hoverScale = settings.value(QStringLiteral("sideWidget/transform/hoverScale"), hoverScale).toDouble();
  startRotation = settings.value(QStringLiteral("sideWidget/transform/startRotation"), startRotation).toDouble();
  radiusX = settings.value(QStringLiteral("sideWidget/geometry/radiusX"), radiusX).toDouble();
  radiusY = settings.value(QStringLiteral("sideWidget/geometry/radiusY"), radiusY).toDouble();
  startAngle = settings.value(QStringLiteral("sideWidget/geometry/startAngle"), startAngle).toDouble();
  endAngle = settings.value(QStringLiteral("sideWidget/geometry/endAngle"), endAngle).toDouble();
  buttonDiameter = settings.value(QStringLiteral("sideWidget/appearance/buttonDiameter"), buttonDiameter).toInt();
  buttonGlow = settings.value(QStringLiteral("sideWidget/appearance/buttonGlow"), buttonGlow).toDouble();
  triggerGlow = settings.value(QStringLiteral("sideWidget/appearance/triggerGlow"), triggerGlow).toDouble();
  animationsEnabled = settings.value(QStringLiteral("sideWidget/appearance/animationsEnabled"), animationsEnabled).toBool();
}
