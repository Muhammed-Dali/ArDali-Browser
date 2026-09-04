#ifndef ARDALI_DESKTOP_TABS_TAB_DRAG_CONTROLLER_H_
#define ARDALI_DESKTOP_TABS_TAB_DRAG_CONTROLLER_H_

#include <QObject>
#include <QEvent>
#include <QPoint>
#include <QPointer>
#include <QRect>
#include <QVector>
#include <QWidget>
#include <functional>
#include <memory>

#include "detached_tab_window_controller.h"
#include "platform/tab_drag_platform.h"
#include "tab_drag_session.h"
#include "tab_drag_types.h"
#include "tab_window_registry.h"

namespace ardali::desktop_tabs {

class TabStripWidget;

class TabDragController : public QObject {
  Q_OBJECT
 public:
  using TabTransferDelegate = std::function<bool(
      QWidget *fromWindow,
      QWidget *toWindow,
      uint64_t tabId,
      int targetIndex)>;

  using TabMoveDelegate = std::function<void(
      QWidget *window,
      int fromIndex,
      int toIndex)>;

  explicit TabDragController(
      std::unique_ptr<TabDragPlatformBackend> platformBackend = nullptr,
      QObject *parent = nullptr);
  ~TabDragController() override;

  static TabDragController &instance();

  bool isActive() const { return session_.isActive(); }
  DragState state() const { return session_.state(); }
  const TabDragSession &session() const { return session_; }

  void setDetachedWindowFactory(DetachedTabWindowController::WindowFactory factory);

  // Called immediately after the capture shell is created to transfer the
  // dragged tab's QWebEngineView into the new window. Must be set alongside
  // setDetachedWindowFactory. Without it, the detached window will be empty.
  void setDetachTransferDelegate(DetachedTabWindowController::DetachTransferDelegate delegate);

  void setTabTransferDelegate(TabTransferDelegate delegate) { transferDelegate_ = std::move(delegate); }
  void setTabMoveDelegate(TabMoveDelegate delegate) { moveDelegate_ = std::move(delegate); }

  // Drag lifecycle entrypoints
  void handleMousePress(
      QWidget *window,
      TabStripWidget *strip,
      int tabIndex,
      const QPoint &globalPos,
      const QPoint &offsetInTab,
      const QPoint &offsetInWindow);

  void handleMouseMove(const QPoint &globalPos);
  void handleMouseRelease(const QPoint &globalPos);
  void handleCancel();

 signals:
  void dragStarted();
  void dragFinished(EndDragReason reason);
  void stateChanged(DragState newState);

 protected:
  bool eventFilter(QObject *watched, QEvent *event) override;

 private:
  TabDragSession session_;
  DetachedTabWindowController detachedWindowController_;
  std::unique_ptr<TabDragPlatformBackend> platformBackend_;

  TabTransferDelegate transferDelegate_;
  TabMoveDelegate moveDelegate_;
  QPointer<QWidget> pointerCaptureOwner_;
  bool applicationFilterInstalled_ = false;

  void ensureApplicationEventFilter();
  void beginPointerCapture();
  void handoffPointerCapture(QWidget *targetWidget);
  void endPointerCapture();
  void startInStripDrag();
  void updateInStripDrag(const QPoint &globalPos);
  void updateInStripDragAt(const QPoint &stripLocalPos, const QPoint &globalPos);
  void performDetach(const QPoint &globalPos);
  void updateDetachedDrag(const QPoint &globalPos);
  void attachToTarget(QWidget *targetWindow, TabStripWidget *targetStrip, const QPoint &globalPos);
  void attachToTargetAt(
      QWidget *targetWindow,
      TabStripWidget *targetStrip,
      const QPoint &stripLocalPos,
      const QPoint &globalPos);
  void performRedetach(const QPoint &globalPos);
  void completeDrag(const QPoint &globalPos);
  void cancelDrag();
  void cleanUpCursorState();

  uint64_t initialSessionId_ = 0;
  uint64_t initialTabId_ = 0;
};

}  // namespace ardali::desktop_tabs

#endif  // ARDALI_DESKTOP_TABS_TAB_DRAG_CONTROLLER_H_
