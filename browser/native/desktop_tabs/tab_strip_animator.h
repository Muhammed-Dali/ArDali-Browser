#ifndef ARDALI_DESKTOP_TABS_TAB_STRIP_ANIMATOR_H_
#define ARDALI_DESKTOP_TABS_TAB_STRIP_ANIMATOR_H_

#include <QEasingCurve>
#include <QElapsedTimer>
#include <QObject>
#include <QRect>
#include <QTimer>
#include <QVector>
#include <cstdint>

#include "tab_drag_types.h"

namespace ardali::desktop_tabs {

struct AnimatedSlot {
  uint64_t tabId = 0;
  QRect fromRect;
  QRect currentRect;
  QRect targetRect;
  qreal fromOpacity = 1.0;
  qreal currentOpacity = 1.0;
  qreal targetOpacity = 1.0;
  qint64 startTimeMs = 0;
  int durationMs = 200;
  bool isAnimating = false;
};

struct ClosingSlotVisual {
  quint64 transitionId = 0;
  QRect rect;
  qreal opacity = 0.0;
};

class TabStripAnimator : public QObject {
  Q_OBJECT
 public:
  explicit TabStripAnimator(QObject *parent = nullptr);
  ~TabStripAnimator() override;

  bool isAnimating() const;

  // Resets slot count and assigns initial rects immediately
  void resetSlots(const QVector<TabGeometry> &geometries);

  // Updates targets for all slots. If a slot's targetRect changed, smoothly animates to it.
  void setTargetGeometries(const QVector<TabGeometry> &geometries, int durationMs = 200);

  // Retarget a single slot
  void setSlotTarget(int index, const QRect &targetRect, int durationMs = 200);

  // Directly sets the visual rect of a tab (e.g. dragged tab tracking cursor)
  void setImmediateVisualRect(int index, const QRect &rect);

  // Begins settle animation for a dragged tab from dropRect to targetRect
  void startSettle(int index, const QRect &fromRect, const QRect &targetRect, int durationMs = 200);

  // Forces immediate completion of all running animations
  void finishImmediately();

  // Retrieves the current interpolated rect for tab index
  QRect currentVisualRect(int index, const QRect &fallback = QRect()) const;

  // Opacity is animated with a newly inserted slot, matching Chromium's
  // add/remove transition without making paint code own another timer.
  qreal currentOpacity(int index) const;

  // Keeps a removed tab's last pixels alive independently of the logical
  // model while it collapses. The caller owns the associated title/icon data.
  quint64 startClosingTransition(const QRect &fromRect, int durationMs = 190);
  QVector<ClosingSlotVisual> closingVisuals() const;

 signals:
  void animationProgressed();
  void animationFinished();
  void closingTransitionFinished(quint64 transitionId);

 private slots:
  void onTick();

 private:
  QVector<AnimatedSlot> slots_;
  struct ClosingSlot {
    quint64 transitionId = 0;
    QRect fromRect;
    QRect currentRect;
    QRect targetRect;
    qreal currentOpacity = 1.0;
    qint64 startTimeMs = 0;
    int durationMs = 190;
  };
  QVector<ClosingSlot> closingSlots_;
  quint64 nextClosingTransitionId_ = 1;
  QTimer timer_;
  QElapsedTimer clock_;
  QEasingCurve easing_{QEasingCurve::OutCubic};

  QRect interpolateRect(const QRect &from, const QRect &to, qreal progress) const;
  void ensureTimerRunning();
};

}  // namespace ardali::desktop_tabs

#endif  // ARDALI_DESKTOP_TABS_TAB_STRIP_ANIMATOR_H_
