#pragma once

#include <QEasingCurve>
#include <QSettings>
#include <QString>

struct SideWidgetConfig {
  // Animation Timing
  int openDurationMs = 360;
  int closeDurationMs = 280;
  int openStaggerMs = 10;
  int closeStaggerMs = 7;

  // Easing Curves
  QEasingCurve::Type openEasing = QEasingCurve::OutCubic;
  QEasingCurve::Type closeEasing = QEasingCurve::InCubic;

  // Transform Dynamics
  double startScale = 0.22;
  double hoverScale = 1.10;
  double startRotation = -18.0; // degrees

  // Geometry
  double radiusX = 188.0;
  double radiusY = 285.0;
  double startAngle = -78.0; // degrees
  double endAngle = 78.0;   // degrees

  // Appearance
  int buttonDiameter = 48;
  double buttonGlow = 1.0;  // 0.0 to 1.0
  double triggerGlow = 1.0; // 0.0 to 1.0
  bool animationsEnabled = true;

  static SideWidgetConfig defaults();
  void save(QSettings &settings) const;
  void load(QSettings &settings);

  static QString easingToString(QEasingCurve::Type type);
  static QEasingCurve::Type stringToEasing(const QString &str);
};
