#include "tab_drag_platform.h"

#include <QGuiApplication>
#include <QScreen>
#include <QWindow>
#include <QWidget>

#include <cstdio>

namespace {

bool diagnosticsEnabled() {
  return qEnvironmentVariableIntValue("ARDALI_DESKTOP_TAB_DIAGNOSTICS") == 1 ||
         qEnvironmentVariableIntValue("ARDALI_TAB_DIAGNOSTICS") == 1;
}

}  // namespace

namespace ardali::desktop_tabs {

// ============================================================
// X11 backend
// Uses explicit grabMouse() for pointer continuity.
// QWidget::move() is reliable on X11/XCB.
// bringToFront: raise() + activateWindow() for compositor stacking.
// ============================================================
class X11PlatformBackend : public TabDragPlatformBackend {
 public:
  bool isX11() const override { return true; }
  bool isWayland() const override { return false; }

  QPoint globalCursorPosition() const override {
    return QCursor::pos();
  }

  void moveWindow(QWidget *window, const QPoint &globalTopLeft) override {
    if (!window) return;
    // Skip trivial moves to avoid unnecessary XMoveWindow round-trips
    if (window->pos() == globalTopLeft) return;
    window->move(globalTopLeft);
  }

  void bringToFront(QWidget *window) override {
    if (!window) return;
    window->raise();
    window->activateWindow();
    // Explicitly request focus so the detached window receives keyboard input
    // and the WM places it above the source window in stacking order.
    window->activateWindow();
  }

  // X11: grabMouse() provides explicit pointer capture so Move/Release
  // events reach the grabbing widget even when the cursor leaves it.
  bool beginPointerCapture(QWidget *widget) override {
    if (!widget) return false;
    if (QWidget::mouseGrabber() != widget) widget->grabMouse();
    return QWidget::mouseGrabber() == widget;
  }

  void endPointerCapture(QWidget *widget) override {
    if (widget && QWidget::mouseGrabber() == widget) widget->releaseMouse();
  }
};

// ============================================================
// Wayland backend
//
// Constraints (Wayland security model):
//   - No explicit pointer capture via grabMouse (rejected by compositor)
//   - startSystemMove() gives the compositor control — live re-attach is
//     impossible after this because the compositor swallows mouse events
//   - Global cursor position via QCursor::pos() is best-effort (may lag)
//   - Window positions cannot be set by the client after show()
//
// Strategy:
//   - Rely on the compositor's implicit press-grab that started at
//     mousePressEvent to continue routing Move events to our widget
//   - Use window->move() at creation time (before show) when it is reliable
//   - Accept that window move tracking precision is lower than X11
//   - DO NOT call startSystemMove() — it terminates our event stream
// ============================================================
class WaylandPlatformBackend : public TabDragPlatformBackend {
 public:
  bool isX11() const override { return false; }
  bool isWayland() const override { return true; }

  QPoint globalCursorPosition() const override {
    // QCursor::pos() is unreliable on Wayland but is the safest available API.
    return QCursor::pos();
  }

  void moveWindow(QWidget *window, const QPoint &globalTopLeft) override {
    if (!window) return;
    // On Wayland, move() is only effective before the window is shown.
    // After show(), the compositor controls window position. We still call it
    // so that creation-time positioning works correctly.
    window->move(globalTopLeft);
  }

  void bringToFront(QWidget *window) override {
    if (!window) return;
    window->raise();
    if (window->windowHandle()) window->windowHandle()->requestActivate();
    window->activateWindow();
  }

  // Wayland: compositor holds the implicit press grab — explicit capture would
  // conflict and is rejected by the protocol. Return false to signal that
  // no explicit capture was established; the caller must not attempt releaseMouse().
  bool beginPointerCapture(QWidget *) override { return false; }
  void endPointerCapture(QWidget *) override {}
};

// ============================================================
// Generic / unknown platform fallback
// ============================================================
class GenericPlatformBackend : public TabDragPlatformBackend {
 public:
  bool isX11() const override { return false; }
  bool isWayland() const override { return false; }

  QPoint globalCursorPosition() const override {
    return QCursor::pos();
  }

  void moveWindow(QWidget *window, const QPoint &globalTopLeft) override {
    if (!window) return;
    window->move(globalTopLeft);
  }

  void bringToFront(QWidget *window) override {
    if (!window) return;
    window->raise();
    window->activateWindow();
  }
};

// ============================================================
// Base-class default implementations
// ============================================================
QPoint TabDragPlatformBackend::globalCursorPosition() const {
  return QCursor::pos();
}

void TabDragPlatformBackend::moveWindow(QWidget *window, const QPoint &globalTopLeft) {
  if (window) window->move(globalTopLeft);
}

void TabDragPlatformBackend::bringToFront(QWidget *window) {
  if (window) { window->raise(); window->activateWindow(); }
}

bool TabDragPlatformBackend::beginPointerCapture(QWidget *widget) {
  Q_UNUSED(widget);
  return false;
}

void TabDragPlatformBackend::endPointerCapture(QWidget *) {}

bool TabDragPlatformBackend::isWayland() const {
  const QString platform = QGuiApplication::platformName().toLower();
  return platform.contains(QLatin1String("wayland"));
}

bool TabDragPlatformBackend::isX11() const {
  const QString platform = QGuiApplication::platformName().toLower();
  return platform.contains(QLatin1String("xcb")) || platform.contains(QLatin1String("x11"));
}

std::unique_ptr<TabDragPlatformBackend> TabDragPlatformBackend::create() {
  const QString platform = QGuiApplication::platformName().toLower();
  if (platform.contains(QLatin1String("wayland"))) {
    return std::make_unique<WaylandPlatformBackend>();
  } else if (platform.contains(QLatin1String("xcb")) || platform.contains(QLatin1String("x11"))) {
    return std::make_unique<X11PlatformBackend>();
  }
  return std::make_unique<GenericPlatformBackend>();
}

}  // namespace ardali::desktop_tabs
