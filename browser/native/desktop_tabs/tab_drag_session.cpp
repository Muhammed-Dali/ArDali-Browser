#include "tab_drag_session.h"
#include <atomic>
#include <cstdio>
#include <cstdlib>

namespace ardali::desktop_tabs {

static std::atomic<uint64_t> s_sessionSequence{1};

static bool isDiagnosticsEnabled() {
  static const bool enabled = qEnvironmentVariableIntValue(
                                  "ARDALI_DESKTOP_TAB_DIAGNOSTICS") == 1 ||
                              qEnvironmentVariableIntValue(
                                  "ARDALI_TAB_DIAGNOSTICS") == 1;
  return enabled;
}

void TabDragSession::startSession(
    QWidget *sourceWindow,
    TabStripWidget *sourceStrip,
    int tabIndex,
    const TabModelItem &item,
    const QPoint &globalPos,
    const QPoint &offsetInTab,
    const QPoint &offsetInWindow,
    bool isLastTab) {
  sessionId_ = s_sessionSequence.fetch_add(1);
  sourceWindow_ = sourceWindow;
  sourceStrip_ = sourceStrip;
  currentWindow_ = sourceWindow;
  currentStrip_ = sourceStrip;

  sourceTabIndex_ = tabIndex;
  currentTabIndex_ = tabIndex;
  tabItem_ = item;
  isMovingLastTab_ = isLastTab;
  sourceWasLastTab_ = isLastTab;
  sourceWindowTopLeft_ = sourceWindow ? sourceWindow->pos() : QPoint{};

  pressGlobalPos_ = globalPos;
  detachReferenceGlobalPos_ = globalPos;
  pressOffsetInTab_ = offsetInTab;
  heldPointInWindow_ = offsetInWindow;

  currentInsertionSlot_ = tabIndex;
  hasMovedPastThreshold_ = false;
  isDetached_ = false;

  setState(DragState::Pressed);
}

void TabDragSession::reset() {
  if (state_ != DragState::Idle) {
    setState(DragState::Idle);
  }
  sourceWindow_ = nullptr;
  sourceStrip_ = nullptr;
  currentWindow_ = nullptr;
  currentStrip_ = nullptr;

  sourceTabIndex_ = -1;
  currentTabIndex_ = -1;
  tabItem_ = {};
  isMovingLastTab_ = false;
  sourceWasLastTab_ = false;
  sourceWindowTopLeft_ = {};

  pressGlobalPos_ = {};
  detachReferenceGlobalPos_ = {};
  pressOffsetInTab_ = {};
  heldPointInWindow_ = {};

  currentInsertionSlot_ = -1;
  hasMovedPastThreshold_ = false;
  isDetached_ = false;
  requiresTargetStripEntry_ = false;
  attachGeneration_ = 0;
  lastAttachGlobalPos_ = {};
  sessionId_ = 0;
}

void TabDragSession::setState(DragState state) {
  if (state_ != state) {
    if (isDiagnosticsEnabled()) {
      std::fprintf(stderr, "[DRAG] State transition: %s -> %s\n",
                   dragStateToString(state_), dragStateToString(state));
    }
    state_ = state;
  }
}

}  // namespace ardali::desktop_tabs
