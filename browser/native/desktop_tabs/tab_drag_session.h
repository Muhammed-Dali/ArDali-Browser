#ifndef ARDALI_DESKTOP_TABS_TAB_DRAG_SESSION_H_
#define ARDALI_DESKTOP_TABS_TAB_DRAG_SESSION_H_

#include <QObject>
#include <QPoint>
#include <QPointer>
#include <QRect>
#include <QWidget>

#include "tab_drag_types.h"
#include "tab_layout_model.h"
#include "tab_strip_widget.h"

namespace ardali::desktop_tabs {

class TabDragSession {
 public:
  TabDragSession() = default;

  void startSession(
      QWidget *sourceWindow,
      TabStripWidget *sourceStrip,
      int tabIndex,
      const TabModelItem &item,
      const QPoint &globalPos,
      const QPoint &offsetInTab,
      const QPoint &offsetInWindow,
      bool isLastTab = false);

  void reset();

  bool isActive() const { return state_ != DragState::Idle; }
  DragState state() const { return state_; }
  void setState(DragState state);

  uint64_t sessionId() const { return sessionId_; }

  QWidget *sourceWindow() const { return sourceWindow_.data(); }
  TabStripWidget *sourceStrip() const { return sourceStrip_.data(); }

  QWidget *currentWindow() const { return currentWindow_.data(); }
  void setCurrentWindow(QWidget *window) { currentWindow_ = window; }

  TabStripWidget *currentStrip() const { return currentStrip_.data(); }
  void setCurrentStrip(TabStripWidget *strip) { currentStrip_ = strip; }

  int sourceTabIndex() const { return sourceTabIndex_; }
  int currentTabIndex() const { return currentTabIndex_; }
  void setCurrentTabIndex(int index) { currentTabIndex_ = index; }
  const TabModelItem &tabItem() const { return tabItem_; }
  void setTabItem(const TabModelItem &item) { tabItem_ = item; }
  bool isMovingLastTab() const { return isMovingLastTab_; }
  void setMovingLastTab(bool moving) { isMovingLastTab_ = moving; }
  bool sourceWasLastTab() const { return sourceWasLastTab_; }
  const QPoint &sourceWindowTopLeft() const { return sourceWindowTopLeft_; }

  const QPoint &pressGlobalPos() const { return pressGlobalPos_; }
  const QPoint &detachReferenceGlobalPos() const { return detachReferenceGlobalPos_; }
  void setDetachReferenceGlobalPos(const QPoint &p) { detachReferenceGlobalPos_ = p; }
  const QPoint &pressOffsetInTab() const { return pressOffsetInTab_; }
  const QPoint &heldPointInWindow() const { return heldPointInWindow_; }
  void setHeldPointInWindow(const QPoint &p) { heldPointInWindow_ = p; }

  int currentInsertionSlot() const { return currentInsertionSlot_; }
  void setCurrentInsertionSlot(int slot) { currentInsertionSlot_ = slot; }

  bool hasMovedPastThreshold() const { return hasMovedPastThreshold_; }
  void setMovedPastThreshold(bool moved) { hasMovedPastThreshold_ = moved; }

  bool isDetached() const { return isDetached_; }
  void setDetached(bool detached) { isDetached_ = detached; }

  bool requiresTargetStripEntry() const { return requiresTargetStripEntry_; }
  void setRequiresTargetStripEntry(bool required) { requiresTargetStripEntry_ = required; }
  int attachGeneration() const { return attachGeneration_; }
  const QPoint &lastAttachGlobalPos() const { return lastAttachGlobalPos_; }
  void markAttached(const QPoint &globalPos) {
    ++attachGeneration_;
    lastAttachGlobalPos_ = globalPos;
    detachReferenceGlobalPos_ = globalPos;
    requiresTargetStripEntry_ = true;
  }

 private:
  DragState state_ = DragState::Idle;
  QPointer<QWidget> sourceWindow_;
  QPointer<TabStripWidget> sourceStrip_;
  QPointer<QWidget> currentWindow_;
  QPointer<TabStripWidget> currentStrip_;

  int sourceTabIndex_ = -1;
  int currentTabIndex_ = -1;
  TabModelItem tabItem_;
  bool isMovingLastTab_ = false;
  bool sourceWasLastTab_ = false;
  QPoint sourceWindowTopLeft_;

  QPoint pressGlobalPos_;
  QPoint detachReferenceGlobalPos_;
  QPoint pressOffsetInTab_;
  QPoint heldPointInWindow_;

  int currentInsertionSlot_ = -1;
  bool hasMovedPastThreshold_ = false;
  bool isDetached_ = false;
  bool requiresTargetStripEntry_ = false;
  int attachGeneration_ = 0;
  QPoint lastAttachGlobalPos_;
  uint64_t sessionId_ = 0;
};

}  // namespace ardali::desktop_tabs

#endif  // ARDALI_DESKTOP_TABS_TAB_DRAG_SESSION_H_
