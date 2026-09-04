#ifndef ARDALI_DESKTOP_TABS_TAB_APPEARANCE_H_
#define ARDALI_DESKTOP_TABS_TAB_APPEARANCE_H_

#include <QColor>
#include <QPainterPath>
#include <QRectF>
#include <QString>

#include "tab_drag_types.h"

namespace ardali::desktop_tabs {

// Visual and layout values are kept together so painting, hit testing, and
// dragging all derive from the same logical tab geometry. Values are Qt
// logical pixels (DIPs); Qt performs the device-pixel conversion.
struct TabAppearance {
  LayoutMetrics layout;
  int surfaceTopInset = 2;
  int surfaceSideInset = 3;
  int surfaceBottomInset = 0;
  int separatorTopInset = 10;
  int separatorBottomInset = 9;
  qreal topCornerRadius = 10.0;
  qreal bottomCornerRadius = 10.0;
  qreal hoverCornerRadius = 8.0;
  int hoverDurationMs = 180;
  qreal hoverMaximumOpacity = 1.0;
  QColor activeFill;
  QColor hoverFill;
  QColor outline;
  QColor separator;
  QColor activeText;
  QColor inactiveText;
  QColor hoverText;
  bool connectsToToolbar = true;
  bool paintsSignatureAccent = false;
};

TabStyle tabStyleFromPreference(const QString &value);
QString tabStylePreferenceValue(TabStyle style);
const TabAppearance &tabAppearance(TabStyle style);

// Returns the actual painted surface inside a tab's logical/drag rect.
QRectF tabSurfaceRect(const QRectF &logicalRect, TabStyle style,
                      bool activeOrDragged);

// Chrome/ArDali active tabs use toolbar-connected lower shoulders; pill tabs
// remain a true rounded rectangle on all four sides.
QPainterPath tabSurfacePath(const QRectF &logicalRect, int stripHeight,
                            TabStyle style, bool activeOrDragged);

} // namespace ardali::desktop_tabs

#endif // ARDALI_DESKTOP_TABS_TAB_APPEARANCE_H_
