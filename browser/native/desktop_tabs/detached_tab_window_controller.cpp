#include "detached_tab_window_controller.h"
#include "tab_animation_metrics.h"
#include "tab_strip_widget.h"

#include <QApplication>
#include <QGuiApplication>
#include <QLayout>
#include <QPropertyAnimation>
#include <QScreen>
#include <algorithm>
#include <cstdio>

namespace ardali::desktop_tabs {

namespace {
// Sizing constants for the detached window (Chromium parity).
// kDetachSizeRatio: detached window is this fraction of the source window size.
// Chromium uses the "restored" (pre-maximised) window size directly; ArDali
// defaults to 1200×800 which is visually too heavy for a freshly-torn tab, so
// we cap at 75 %.
constexpr double kDetachSizeRatio   = 0.75;
constexpr int    kDetachMinWidth    = 640;
constexpr int    kDetachMinHeight   = 420;
constexpr int    kDetachScreenMargin = 40;  // keep this far from screen edges
}  // namespace

static bool isDiagnosticsEnabled() {
  static const bool enabled = qEnvironmentVariableIntValue(
                                  "ARDALI_DESKTOP_TAB_DIAGNOSTICS") == 1 ||
                              qEnvironmentVariableIntValue(
                                  "ARDALI_TAB_DIAGNOSTICS") == 1;
  return enabled;
}

DetachedTabWindowController::DetachedTabWindowController(
    std::unique_ptr<TabDragPlatformBackend> platformBackend,
    QObject *parent)
    : QObject(parent),
      platformBackend_(platformBackend ? std::move(platformBackend) : TabDragPlatformBackend::create()) {}

DetachedTabWindowController::~DetachedTabWindowController() {
  finalizeDetachedWindow();
}

QWidget *DetachedTabWindowController::createDetachedWindow(
    QWidget *originWindow,
    uint64_t tabId,
    const QPoint &globalCursorPos,
    const QPoint &preferredHeldPointInWindow,
    const QPoint &pressOffsetInTab) {
  if (!windowFactory_) {
    return nullptr;
  }

  // Step 1: Create the shell window (initially empty)
  QPointer<QWidget> shell = windowFactory_(originWindow, tabId);
  if (!shell) {
    return nullptr;
  }
  shell->unsetCursor();

  if (isDiagnosticsEnabled()) {
    std::fprintf(stderr,
                 "[TRANSFER] begin tabId=%llu originWindow=%p shell=%p\n",
                 static_cast<unsigned long long>(tabId),
                 static_cast<void *>(originWindow),
                 static_cast<void *>(shell.data()));
  }

  // Step 2: Transfer the actual tab content into the shell.
  // This must happen BEFORE show() so the window has real content when it
  // first becomes visible — otherwise the compositor shows a black frame.
  if (detachTransferDelegate_) {
    const bool transferred = detachTransferDelegate_(shell.data(), originWindow, tabId, 0);
    if (!transferred) {
      if (isDiagnosticsEnabled()) {
        std::fprintf(stderr, "[TRANSFER] rollback — transfer delegate returned false\n");
      }
      if (shell) shell->deleteLater();
      return nullptr;
    }
    if (isDiagnosticsEnabled()) {
      std::fprintf(stderr, "[TRANSFER] commit — tab transferred into shell=%p\n",
                   static_cast<void *>(shell.data()));
    }
  } else {
    // A shell without transferred content is the original black-window bug.
    // Treat missing integration as a failed transaction instead of exposing
    // an empty window.
    if (isDiagnosticsEnabled()) {
      std::fprintf(stderr,
                   "[TRANSFER] rollback — no detachTransferDelegate set\n");
    }
    if (shell) shell->deleteLater();
    return nullptr;
  }

  // Step 3: Match Chromium detached window sizing and positioning:
  // Detached windows MUST open as normal floating windows, never maximized or fullscreen.
  QScreen *screen = QGuiApplication::screenAt(globalCursorPos);
  if (!screen && originWindow) screen = originWindow->screen();
  const QRect avail = screen ? screen->availableGeometry() : QRect(0, 0, 1920, 1080);

  QSize targetSize;
  const bool isOriginMaximized = originWindow &&
      (originWindow->isMaximized() || originWindow->isFullScreen() ||
       (originWindow->windowState() & (Qt::WindowMaximized | Qt::WindowFullScreen)));

  if (isOriginMaximized) {
    // 1. Check if the window provides a restoredSize property or normalGeometry
    const QVariant customRestored = originWindow->property("ardaliRestoredSize");
    if (customRestored.isValid() && customRestored.toSize().isValid() &&
        customRestored.toSize().width() >= 600 && customRestored.toSize().height() >= 400) {
      targetSize = customRestored.toSize();
    } else {
      const QRect norm = originWindow->normalGeometry();
      if (norm.isValid() && norm.width() >= 600 && norm.height() >= 400 &&
          norm.width() < avail.width() && norm.height() < avail.height()) {
        targetSize = norm.size();
      } else {
        const int w = std::clamp(static_cast<int>(avail.width() * 0.72), 800, 1200);
        const int h = std::clamp(static_cast<int>(avail.height() * 0.72), 560, 800);
        targetSize = QSize(w, h);
      }
    }
    // Chromium reference: ensure at least 50% of the maximized window size
    const QSize maxSz = originWindow->size();
    targetSize.setWidth(std::clamp(std::max(maxSz.width() / 2, targetSize.width()), 600, avail.width() - 40));
    targetSize.setHeight(std::clamp(std::max(maxSz.height() / 2, targetSize.height()), 400, avail.height() - 40));
  } else if (originWindow) {
    // Chromium reference: CalculateDraggedWindowSize() uses initial_window_size_
    // (restored bounds) and caps to work-area. For non-maximised sources we
    // apply kDetachSizeRatio so the new window is noticeably smaller than the
    // source — dragging a full-size clone feels wrong and heavy.
    const QSize sourceSize = originWindow->size();
    const int w = std::clamp(
        static_cast<int>(sourceSize.width()  * kDetachSizeRatio),
        kDetachMinWidth,
        avail.width() - kDetachScreenMargin);
    const int h = std::clamp(
        static_cast<int>(sourceSize.height() * kDetachSizeRatio),
        kDetachMinHeight,
        avail.height() - kDetachScreenMargin);
    targetSize = QSize(w, h);
  } else {
    targetSize = QSize(1000, 700);
  }

  shell->setWindowState(Qt::WindowNoState);
  shell->resize(targetSize);
  shell->ensurePolished();
  if (shell->layout()) shell->layout()->activate();

  // Step 4: Calculate cursor anchor (heldPointInWindow) and tab X offset — Chromium parity.
  // In Chrome, when a tab is detached:
  // 1. The tab in the detached window stays at its current grab position (initialTabX_).
  // 2. The detached window is positioned so that the grabbed tab pixel stays directly under the cursor.
  // 3. The tab does NOT slide or jump while holding the mouse.
  // 4. On release, it settles to the left (index 0).
  detachedWindow_ = shell;
  heldPointInWindow_ = preferredHeldPointInWindow;
  initialTabX_ = 0;

  if (pressOffsetInTab.x() >= 0 && pressOffsetInTab.y() >= 0) {
    auto *destStrip = shell->findChild<TabStripWidget *>();
    auto *originStrip = originWindow ? originWindow->findChild<TabStripWidget *>() : nullptr;

    // Origin tab X within the source strip
    int originTabXInStrip = 0;
    const int originTabXInWindow = preferredHeldPointInWindow.x() - pressOffsetInTab.x();
    if (originStrip) {
      const QPoint originStripTopLeft = originStrip->mapTo(originWindow, QPoint(0, 0));
      originTabXInStrip = std::max(0, originTabXInWindow - originStripTopLeft.x());
    } else {
      originTabXInStrip = std::max(0, originTabXInWindow);
    }

    const int destStripXInShell = destStrip ? destStrip->mapTo(shell.data(), QPoint(0, 0)).x() : 36;
    const int destStripYInShell = destStrip ? destStrip->mapTo(shell.data(), QPoint(0, 0)).y() : 4;
    const int destStripWidth = std::max(200, targetSize.width() - destStripXInShell - 140);

    const int tabWidth = destStrip
        ? std::min(destStrip->layoutModel().metrics().preferredTabWidth, destStripWidth)
        : 240;
    const int maxTabX = std::max(0, destStripWidth - tabWidth - 30);

    int tabX = originTabXInStrip;
    if (originStrip && originStrip->width() > 0 && originStrip->width() > destStripWidth) {
      const float ratio = static_cast<float>(originTabXInStrip) / static_cast<float>(originStrip->width());
      if (tabX > maxTabX) {
        tabX = std::min(static_cast<int>(ratio * destStripWidth), maxTabX);
      }
    }
    tabX = std::clamp(tabX, 0, maxTabX);
    initialTabX_ = tabX;

    heldPointInWindow_ = QPoint(
        destStripXInShell + tabX + pressOffsetInTab.x(),
        destStripYInShell + pressOffsetInTab.y());
  }

  // Clamp the anchor to sensible bounds within the window.
  heldPointInWindow_.setX(std::clamp(heldPointInWindow_.x(), 10,
                                      std::max(20, shell->width() - 20)));
  heldPointInWindow_.setY(std::clamp(heldPointInWindow_.y(), 5,
                                      std::max(15, std::min(shell->height() - 20, 80))));

  // Step 5: Position the window so the grabbed tab pixel stays under the cursor.
  QPoint targetTopLeft = globalCursorPos - heldPointInWindow_;
  if (targetTopLeft.y() < avail.top()) {
    targetTopLeft.setY(avail.top());
  }

  platformBackend_->moveWindow(detachedWindow_, targetTopLeft);
  platformBackend_->bringToFront(detachedWindow_);

  const bool useOpacityTrick =
      qgetenv("QT_QPA_PLATFORM") != "offscreen" &&
      TabAnimationMetrics::animationsEnabled();

  if (useOpacityTrick) {
    shell->setWindowOpacity(TabAnimationMetrics::detachedWindowInitialOpacity);
  }
  shell->show();

  if (useOpacityTrick) {
    auto *fadeAnim = new QPropertyAnimation(shell, "windowOpacity", shell);
    fadeAnim->setDuration(TabAnimationMetrics::windowTransitionDurationMs);
    fadeAnim->setStartValue(TabAnimationMetrics::detachedWindowInitialOpacity);
    fadeAnim->setEndValue(1.0);
    fadeAnim->setEasingCurve(QEasingCurve::OutCubic);
    fadeAnim->start(QAbstractAnimation::DeleteWhenStopped);
  }

  if (isDiagnosticsEnabled()) {
    std::fprintf(stderr,
                 "[WINDOW] DetachedCreated window=%p cursor=(%d,%d) "
                 "held=(%d,%d) tabX=%d topLeft=(%d,%d)\n",
                 static_cast<void *>(detachedWindow_.data()),
                 globalCursorPos.x(), globalCursorPos.y(),
                 heldPointInWindow_.x(), heldPointInWindow_.y(),
                 initialTabX_,
                 targetTopLeft.x(), targetTopLeft.y());
  }

  return detachedWindow_;
}

void DetachedTabWindowController::moveDetachedWindow(
    const QPoint &globalCursorPos,
    const QPoint &heldPointInWindow) {
  if (!detachedWindow_) return;

  const QPoint targetTopLeft = globalCursorPos - heldPointInWindow;
  platformBackend_->moveWindow(detachedWindow_, targetTopLeft);
  platformBackend_->bringToFront(detachedWindow_);

  if (isDiagnosticsEnabled()) {
    const QPoint actualTopLeft = detachedWindow_->pos();
    const QPoint delta = actualTopLeft - targetTopLeft;
    std::fprintf(stderr, "[WINDOW] Move window=%p cursor=(%d,%d) anchorDelta=(%d,%d)\n",
                 static_cast<void *>(detachedWindow_.data()),
                 globalCursorPos.x(), globalCursorPos.y(),
                 delta.x(), delta.y());
  }
}

void DetachedTabWindowController::finalizeDetachedWindow() {
  if (detachedWindow_) {
    detachedWindow_->unsetCursor();
    if (qgetenv("QT_QPA_PLATFORM") != "offscreen") {
      detachedWindow_->setWindowOpacity(1.0);
    }
    detachedWindow_->setProperty("ardaliDragCaptureShell", false);
    detachedWindow_ = nullptr;
  }
  heldPointInWindow_ = {};
}

bool DetachedTabWindowController::verifyHeldPointInvariant(
    const QPoint &globalCursorPos,
    const QPoint &heldPointInWindow) const {
  if (!detachedWindow_) return false;
  const QPoint expectedTopLeft = globalCursorPos - heldPointInWindow;
  const QPoint actualTopLeft = detachedWindow_->pos();
  const QPoint delta = actualTopLeft - expectedTopLeft;
  // Allow a tiny 2px tolerance for window decoration margins on some WMs
  return delta.manhattanLength() <= 2;
}

}  // namespace ardali::desktop_tabs
