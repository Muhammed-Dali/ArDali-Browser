#ifndef ARDALI_DESKTOP_TABS_DETACHED_TAB_WINDOW_CONTROLLER_H_
#define ARDALI_DESKTOP_TABS_DETACHED_TAB_WINDOW_CONTROLLER_H_

#include <QObject>
#include <QPoint>
#include <QPointer>
#include <QRect>
#include <QWidget>
#include <functional>
#include <memory>

#include "platform/tab_drag_platform.h"
#include "tab_drag_types.h"

namespace ardali::desktop_tabs {

class DetachedTabWindowController : public QObject {
  Q_OBJECT
 public:
  using WindowFactory = std::function<QWidget *(QWidget *originWindow, uint64_t tabId)>;

  // Called after the shell window is created.
  // Returns true if the tab was successfully transferred into destWindow.
  // destWindow: the newly created capture shell
  // originWindow: the source BrowserWindow
  // tabId: the drag-session tabId (see TabDragSession::tabItem().tabId)
  // insertionIndex: always 0 for a fresh detach
  using DetachTransferDelegate = std::function<bool(
      QWidget *destWindow,
      QWidget *originWindow,
      uint64_t tabId,
      int insertionIndex)>;

  explicit DetachedTabWindowController(
      std::unique_ptr<TabDragPlatformBackend> platformBackend = nullptr,
      QObject *parent = nullptr);
  ~DetachedTabWindowController() override;

  void setWindowFactory(WindowFactory factory) { windowFactory_ = std::move(factory); }
  void setDetachTransferDelegate(DetachTransferDelegate delegate) {
    detachTransferDelegate_ = std::move(delegate);
  }

  QWidget *detachedWindow() const { return detachedWindow_.data(); }
  const QPoint &heldPointInWindow() const { return heldPointInWindow_; }
  int initialTabX() const { return initialTabX_; }

  // Creates the detached window, transfers the tab content into it, then
  // positions it so heldPoint aligns with the cursor.
  // Returns nullptr if either the window creation or the tab transfer fails.
  QWidget *createDetachedWindow(
      QWidget *originWindow,
      uint64_t tabId,
      const QPoint &globalCursorPos,
      const QPoint &preferredHeldPointInWindow,
      const QPoint &pressOffsetInTab = QPoint(-1, -1));

  // Moves the detached window maintaining the heldPoint invariant
  void moveDetachedWindow(const QPoint &globalCursorPos, const QPoint &heldPointInWindow);

  // Closes or transfers the detached window
  void finalizeDetachedWindow();

  // Verifies the held point invariant
  bool verifyHeldPointInvariant(const QPoint &globalCursorPos, const QPoint &heldPointInWindow) const;

 private:
  std::unique_ptr<TabDragPlatformBackend> platformBackend_;
  WindowFactory windowFactory_;
  DetachTransferDelegate detachTransferDelegate_;
  QPointer<QWidget> detachedWindow_;
  QPoint heldPointInWindow_;
  int initialTabX_ = 0;
};

}  // namespace ardali::desktop_tabs

#endif  // ARDALI_DESKTOP_TABS_DETACHED_TAB_WINDOW_CONTROLLER_H_
