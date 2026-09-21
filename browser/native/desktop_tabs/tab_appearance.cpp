#include "tab_appearance.h"

#include <algorithm>

// The toolbar-connected shoulder geometry and adjacency-aware separator
// behavior are a Qt adaptation of Chromium HorizontalTabStyleViews concepts.
// Chromium source: Copyright The Chromium Authors, BSD-style license. The
// original attribution headers remain intact in browser/native/tabs-complete.

namespace ardali::desktop_tabs {
namespace {

LayoutMetrics chromeLayout() {
  LayoutMetrics metrics;
  metrics.minTabWidth = 116;
  metrics.preferredTabWidth = 240;
  metrics.pinnedTabWidth = 44;
  metrics.tabHeight = 40;
  metrics.closeButtonSize = 20;
  metrics.faviconSize = 18;
  metrics.activeContentLeftPadding = 16;
  metrics.inactiveContentLeftPadding = 14;
  metrics.faviconTitleSpacing = 8;
  metrics.closeButtonTrailingPadding = 8;
  metrics.closeButtonHitMargin = 3;
  metrics.newTabButtonWidth = 32;
  metrics.newTabButtonGap = 6;
  return metrics;
}

TabAppearance chromeAppearance() {
  TabAppearance result;
  result.layout = chromeLayout();
  result.surfaceTopInset = 2;
  result.surfaceSideInset = 3;
  result.surfaceBottomInset = 0;
  result.separatorTopInset = 11;
  result.separatorBottomInset = 10;
  result.topCornerRadius = 10.0;
  result.bottomCornerRadius = 10.0;
  result.hoverCornerRadius = 9.0;
  result.hoverDurationMs = 180;
  result.hoverMaximumOpacity = 1.0;
  result.activeFill = QColor(QStringLiteral("#2b2a33"));
  result.hoverFill = QColor(255, 255, 255, 25);
  result.outline = QColor(255, 255, 255, 18);
  result.separator = QColor(154, 160, 166, 105);
  result.activeText = QColor(QStringLiteral("#f1f3f4"));
  result.inactiveText = QColor(QStringLiteral("#c7cbd1"));
  result.hoverText = QColor(QStringLiteral("#f0f2f4"));
  return result;
}

TabAppearance ardaliAppearance() {
  TabAppearance result = chromeAppearance();
  result.layout.preferredTabWidth = 236;
  result.surfaceTopInset = 2;
  result.topCornerRadius = 11.0;
  result.activeFill = QColor(QStringLiteral("#283541"));
  result.hoverFill = QColor(66, 165, 245, 34);
  result.outline = QColor(79, 195, 247, 96);
  result.separator = QColor(105, 160, 202, 115);
  result.paintsSignatureAccent = true;
  return result;
}

TabAppearance floatingPillAppearance() {
  TabAppearance result = chromeAppearance();
  result.layout.minTabWidth = 112;
  result.layout.preferredTabWidth = 224;
  result.surfaceTopInset = 4;
  result.surfaceSideInset = 4;
  result.surfaceBottomInset = 4;
  result.separatorTopInset = 12;
  result.separatorBottomInset = 11;
  result.topCornerRadius = 10.0;
  result.bottomCornerRadius = 10.0;
  result.hoverCornerRadius = 10.0;
  result.hoverMaximumOpacity = 1.0;
  result.activeFill = QColor(QStringLiteral("#393842"));
  result.hoverFill = QColor(255, 255, 255, 28);
  result.outline = QColor(138, 180, 248, 78);
  result.separator = QColor(154, 160, 166, 78);
  result.connectsToToolbar = false;
  return result;
}

TabAppearance ardaliConnectedAppearance() {
  TabAppearance result = floatingPillAppearance();
  result.layout.preferredTabWidth = 236;
  result.surfaceTopInset = 4;
  result.surfaceSideInset = 4;
  result.surfaceBottomInset = 4;
  result.separatorTopInset = 12;
  result.separatorBottomInset = 11;
  result.topCornerRadius = 10.0;
  result.bottomCornerRadius = 10.0;
  result.hoverCornerRadius = 10.0;
  result.hoverMaximumOpacity = 1.0;
  result.activeFill = QColor(QStringLiteral("#393842"));
  result.hoverFill = QColor(255, 255, 255, 28);
  result.outline = QColor(138, 180, 248, 190);
  result.separator = QColor(165, 172, 180, 150);
  result.activeText = QColor(QStringLiteral("#f1f3f4"));
  result.inactiveText = QColor(QStringLiteral("#c7cbd1"));
  result.hoverText = QColor(QStringLiteral("#f0f2f4"));
  result.connectsToToolbar = false;
  return result;
}

} // namespace

TabStyle tabStyleFromPreference(const QString &value) {
  const QString normalized = value.trimmed().toLower();
  if (normalized == QLatin1String("chrome_curved") ||
      normalized == QLatin1String("chrome") ||
      normalized == QLatin1String("standart") ||
      normalized == QLatin1String("standard")) {
    return TabStyle::ChromeCurved;
  }
  if (normalized == QLatin1String("ardali_signature")) {
    return TabStyle::ArDaliSignature;
  }
  if (normalized == QLatin1String("floating_pill") ||
      normalized == QLatin1String("modern_pill")) {
    return TabStyle::FloatingPill;
  }
  if (normalized == QLatin1String("ardali_connected") ||
      normalized == QLatin1String("connected") ||
      normalized == QLatin1String("ardali_baglantili")) {
    return TabStyle::ArDaliConnected;
  }
  return TabStyle::ArDaliConnected;
}

QString tabStylePreferenceValue(TabStyle style) {
  switch (style) {
  case TabStyle::ArDaliSignature:
    return QStringLiteral("ardali_signature");
  case TabStyle::FloatingPill:
    return QStringLiteral("floating_pill");
  case TabStyle::ArDaliConnected:
    return QStringLiteral("ardali_connected");
  case TabStyle::ChromeCurved:
    return QStringLiteral("chrome_curved");
  }
  return QStringLiteral("chrome_curved");
}

const TabAppearance &tabAppearance(TabStyle style) {
  static const TabAppearance chrome = chromeAppearance();
  static const TabAppearance ardali = ardaliAppearance();
  static const TabAppearance floatingPill = floatingPillAppearance();
  static const TabAppearance ardaliConnected = ardaliConnectedAppearance();
  switch (style) {
  case TabStyle::ArDaliSignature:
    return ardali;
  case TabStyle::FloatingPill:
    return floatingPill;
  case TabStyle::ArDaliConnected:
    return ardaliConnected;
  case TabStyle::ChromeCurved:
    return chrome;
  }
  return chrome;
}

QRectF tabSurfaceRect(const QRectF &logicalRect, TabStyle style,
                      bool activeOrDragged) {
  const TabAppearance &appearance = tabAppearance(style);
  if (activeOrDragged && appearance.connectsToToolbar) {
    return logicalRect.adjusted(0.0, appearance.surfaceTopInset, 0.0, 1.0);
  }
  return logicalRect.adjusted(
      appearance.surfaceSideInset, appearance.surfaceTopInset,
      -appearance.surfaceSideInset, -appearance.surfaceBottomInset);
}

QPainterPath tabSurfacePath(const QRectF &logicalRect, int stripHeight,
                            TabStyle style, bool activeOrDragged) {
  const TabAppearance &appearance = tabAppearance(style);
  const QRectF surface = tabSurfaceRect(logicalRect, style, activeOrDragged);
  QPainterPath path;

  if (style == TabStyle::ArDaliConnected) {
    // 1. Clean capsule-like tab body on all tabs
    path.addRoundedRect(surface, appearance.hoverCornerRadius,
                        appearance.hoverCornerRadius);

    if (!activeOrDragged) {
      return path;
    }

    // 2. Signature active tab connector on the RIGHT side only:
    // Starts at roughly 50% vertical center of the capsule's right edge,
    // smoothly transitions outward and curves down to meet the toolbar boundary.
    const qreal right = surface.right();
    const qreal centerY = surface.center().y();
    const qreal stripBottom = qreal(stripHeight);
    const qreal connectorX = right + 8.2;

    // Visually emerges from the right border at vertical center with an extended neck
    path.moveTo(right, centerY - 1.0);
    path.lineTo(right, centerY);
    path.lineTo(right + 5.2, centerY);
    // Smooth rounded transition from horizontal emergence to vertical connector
    path.cubicTo(right + 6.8, centerY,
                 connectorX, centerY + 0.8,
                 connectorX, centerY + 2.8);
    // Vertical connector continuing straight downward to the browser/toolbar separator
    path.lineTo(connectorX, stripBottom);
    return path;
  }

  if (!activeOrDragged || !appearance.connectsToToolbar) {
    path.addRoundedRect(surface, appearance.hoverCornerRadius,
                        appearance.hoverCornerRadius);
    return path;
  }

  // Adapted from Chromium's horizontal tab geometry: the active surface ends
  // in lower shoulders and continues through the strip's lower clip edge so it
  // reads as one surface with the toolbar below.
  const qreal top = surface.top();
  const qreal bottom = std::max(surface.bottom(), qreal(stripHeight + 1));
  const qreal left = surface.left();
  const qreal right = surface.right() + 1.0;
  const qreal topRadius = std::min<qreal>(
      appearance.topCornerRadius, std::max<qreal>(0.0, surface.width() / 6.0));
  const qreal shoulder = appearance.bottomCornerRadius;

  path.moveTo(left - shoulder, bottom);
  path.cubicTo(left - shoulder * 0.52, bottom, left, bottom - shoulder * 0.45,
               left, bottom - shoulder);
  path.lineTo(left, top + topRadius);
  path.cubicTo(left, top + topRadius * 0.42, left + topRadius * 0.42, top,
               left + topRadius, top);
  path.lineTo(right - topRadius, top);
  path.cubicTo(right - topRadius * 0.42, top, right, top + topRadius * 0.42,
               right, top + topRadius);
  path.lineTo(right, bottom - shoulder);
  path.cubicTo(right, bottom - shoulder * 0.45, right + shoulder * 0.52, bottom,
               right + shoulder, bottom);
  path.closeSubpath();
  return path;
}

} // namespace ardali::desktop_tabs
