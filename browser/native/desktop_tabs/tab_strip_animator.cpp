#include "tab_strip_animator.h"
#include "tab_animation_metrics.h"

#include <QHash>
#include <QSet>
#include <algorithm>
#include <cmath>

namespace ardali::desktop_tabs {

TabStripAnimator::TabStripAnimator(QObject *parent)
    : QObject(parent) {
  timer_.setInterval(TabAnimationMetrics::frameIntervalMs);  // ~60 FPS
  timer_.setTimerType(Qt::PreciseTimer);
  connect(&timer_, &QTimer::timeout, this, &TabStripAnimator::onTick);
}

TabStripAnimator::~TabStripAnimator() {
  timer_.stop();
}

bool TabStripAnimator::isAnimating() const {
  if (!closingSlots_.isEmpty()) return true;
  for (const auto &slot : slots_) {
    if (slot.isAnimating) return true;
  }
  return false;
}

void TabStripAnimator::resetSlots(const QVector<TabGeometry> &geometries) {
  slots_.resize(geometries.size());
  for (int i = 0; i < geometries.size(); ++i) {
    slots_[i].tabId = geometries[i].tabId;
    slots_[i].fromRect = geometries[i].logicalRect;
    slots_[i].currentRect = geometries[i].logicalRect;
    slots_[i].targetRect = geometries[i].logicalRect;
    slots_[i].fromOpacity = 1.0;
    slots_[i].currentOpacity = 1.0;
    slots_[i].targetOpacity = 1.0;
    slots_[i].isAnimating = false;
    slots_[i].startTimeMs = 0;
  }
  if (closingSlots_.isEmpty()) {
    timer_.stop();
  }
}

void TabStripAnimator::setTargetGeometries(const QVector<TabGeometry> &geometries, int durationMs) {
  if (!TabAnimationMetrics::animationsEnabled()) {
    finishImmediately();
    resetSlots(geometries);
    return;
  }

  if (!clock_.isValid()) {
    clock_.start();
  }

  if (geometries.isEmpty()) {
    slots_.clear();
    if (closingSlots_.isEmpty()) timer_.stop();
    return;
  }

  if (slots_.isEmpty()) {
    resetSlots(geometries);
    return;
  }

  QSet<uint64_t> geometryIds;
  QSet<uint64_t> slotIds;
  bool stableIds = true;
  for (const auto &geometry : geometries) {
    if (geometry.tabId == 0 || geometryIds.contains(geometry.tabId)) {
      stableIds = false;
      break;
    }
    geometryIds.insert(geometry.tabId);
  }
  if (stableIds) {
    for (const auto &slot : slots_) {
      if (slot.tabId == 0 || slotIds.contains(slot.tabId)) {
        stableIds = false;
        break;
      }
      slotIds.insert(slot.tabId);
    }
  }

  const qint64 now = clock_.elapsed();
  bool anyStarted = false;
  if (stableIds) {
    QHash<uint64_t, AnimatedSlot> oldSlots;
    for (const auto &slot : slots_) oldSlots.insert(slot.tabId, slot);

    QVector<AnimatedSlot> reordered;
    reordered.reserve(geometries.size());
    for (const auto &geometry : geometries) {
      const QRect target = geometry.logicalRect;
      auto found = oldSlots.constFind(geometry.tabId);
      if (found == oldSlots.cend()) {
        AnimatedSlot added;
        added.tabId = geometry.tabId;
        added.fromRect = QRect(target.left(), target.top(), 0, target.height());
        added.currentRect = added.fromRect;
        added.targetRect = target;
        added.fromOpacity = 0.0;
        added.currentOpacity = 0.0;
        added.targetOpacity = 1.0;
        added.durationMs = std::max(10, TabAnimationMetrics::tabOpenDurationMs);
        added.startTimeMs = now;
        added.isAnimating = true;
        reordered.append(added);
        anyStarted = true;
        continue;
      }

      AnimatedSlot slot = found.value();
      if (slot.targetRect != target) {
        slot.fromRect = slot.currentRect.isValid() ? slot.currentRect : target;
        slot.targetRect = target;
        slot.fromOpacity = slot.currentOpacity;
        slot.targetOpacity = 1.0;
        slot.durationMs = std::max(10, durationMs);
        slot.startTimeMs = now;
        slot.isAnimating = true;
      }
      anyStarted = anyStarted || slot.isAnimating;
      reordered.append(slot);
    }
    slots_ = std::move(reordered);
  } else {
    // Compatibility for lightweight tests and callers that use tabId == 0.
    // Production browser tabs always have stable, non-zero IDs.
    if (geometries.size() != slots_.size()) {
      const int oldSize = slots_.size();
      slots_.resize(geometries.size());
      for (int i = oldSize; i < geometries.size(); ++i) {
        const QRect target = geometries[i].logicalRect;
        slots_[i].fromRect = QRect(target.left(), target.top(), 0, target.height());
        slots_[i].currentRect = slots_[i].fromRect;
        slots_[i].currentOpacity = 0.0;
      }
    }
    for (int i = 0; i < geometries.size(); ++i) {
      auto &slot = slots_[i];
      const QRect target = geometries[i].logicalRect;
      slot.tabId = geometries[i].tabId;
      if (slot.targetRect != target || slot.currentOpacity < 1.0) {
        slot.fromRect = slot.currentRect.isValid() ? slot.currentRect : target;
        slot.targetRect = target;
        slot.fromOpacity = slot.currentOpacity;
        slot.targetOpacity = 1.0;
        slot.durationMs = std::max(10, durationMs);
        slot.startTimeMs = now;
        slot.isAnimating = true;
        anyStarted = true;
      }
    }
  }

  if (anyStarted) ensureTimerRunning();
}

void TabStripAnimator::setSlotTarget(int index, const QRect &targetRect, int durationMs) {
  if (index < 0 || index >= slots_.size()) return;

  if (!clock_.isValid()) {
    clock_.start();
  }

  auto &slot = slots_[index];
  if (slot.targetRect != targetRect) {
    slot.fromRect = slot.currentRect.isValid() ? slot.currentRect : targetRect;
    slot.targetRect = targetRect;
    slot.durationMs = std::max(10, durationMs);
    slot.startTimeMs = clock_.elapsed();
    slot.isAnimating = true;

    if (!timer_.isActive()) {
      timer_.start();
    }
  }
}

void TabStripAnimator::setImmediateVisualRect(int index, const QRect &rect) {
  if (index < 0 || index >= slots_.size()) return;

  auto &slot = slots_[index];
  slot.currentRect = rect;
  slot.fromRect = rect;
  slot.targetRect = rect;
  slot.isAnimating = false;
}

void TabStripAnimator::startSettle(int index, const QRect &fromRect, const QRect &targetRect, int durationMs) {
  if (index < 0 || index >= slots_.size()) return;

  if (!clock_.isValid()) {
    clock_.start();
  }

  auto &slot = slots_[index];
  slot.fromRect = fromRect;
  slot.currentRect = fromRect;
  slot.targetRect = targetRect;
  slot.durationMs = std::max(10, durationMs);
  slot.startTimeMs = clock_.elapsed();
  slot.isAnimating = true;

  if (!timer_.isActive()) {
    timer_.start();
  }
}

void TabStripAnimator::finishImmediately() {
  timer_.stop();
  for (auto &slot : slots_) {
    slot.currentRect = slot.targetRect;
    slot.fromRect = slot.targetRect;
    slot.currentOpacity = slot.targetOpacity;
    slot.fromOpacity = slot.targetOpacity;
    slot.isAnimating = false;
  }
  QVector<quint64> finishedTransitions;
  for (const auto &cs : closingSlots_) {
    finishedTransitions.append(cs.transitionId);
  }
  closingSlots_.clear();
  emit animationProgressed();
  for (quint64 trId : finishedTransitions) {
    emit closingTransitionFinished(trId);
  }
  emit animationFinished();
}

QRect TabStripAnimator::currentVisualRect(int index, const QRect &fallback) const {
  if (index >= 0 && index < slots_.size() &&
      (slots_[index].isAnimating || slots_[index].currentRect.isValid())) {
    return slots_[index].currentRect;
  }
  return fallback;
}

QRect TabStripAnimator::interpolateRect(const QRect &from, const QRect &to, qreal progress) const {
  const int x = from.x() + static_cast<int>(std::round((to.x() - from.x()) * progress));
  const int y = from.y() + static_cast<int>(std::round((to.y() - from.y()) * progress));
  const int w = from.width() + static_cast<int>(std::round((to.width() - from.width()) * progress));
  const int h = from.height() + static_cast<int>(std::round((to.height() - from.height()) * progress));
  return QRect(x, y, w, h);
}

void TabStripAnimator::ensureTimerRunning() {
  if (!clock_.isValid()) {
    clock_.start();
  }
  if (!timer_.isActive()) {
    timer_.start();
  }
}

qreal TabStripAnimator::currentOpacity(int index) const {
  if (index >= 0 && index < slots_.size()) {
    return slots_[index].currentOpacity;
  }
  return 1.0;
}

quint64 TabStripAnimator::startClosingTransition(const QRect &fromRect, int durationMs) {
  if (!TabAnimationMetrics::animationsEnabled() || fromRect.isEmpty()) {
    return 0;
  }
  ensureTimerRunning();
  const qint64 now = clock_.elapsed();
  ClosingSlot slot;
  slot.transitionId = nextClosingTransitionId_++;
  slot.fromRect = fromRect;
  slot.currentRect = fromRect;
  slot.targetRect = QRect(fromRect.left(), fromRect.top(), 0, fromRect.height());
  slot.currentOpacity = 1.0;
  slot.startTimeMs = now;
  slot.durationMs = std::max(10, durationMs);
  closingSlots_.append(slot);
  emit animationProgressed();
  return slot.transitionId;
}

QVector<ClosingSlotVisual> TabStripAnimator::closingVisuals() const {
  QVector<ClosingSlotVisual> visuals;
  visuals.reserve(closingSlots_.size());
  for (const auto &cs : closingSlots_) {
    visuals.append({cs.transitionId, cs.currentRect, cs.currentOpacity});
  }
  return visuals;
}

void TabStripAnimator::onTick() {
  if (!clock_.isValid()) return;

  const qint64 now = clock_.elapsed();
  bool stillAnimating = false;

  for (auto &slot : slots_) {
    if (!slot.isAnimating) continue;

    const qint64 elapsed = now - slot.startTimeMs;
    if (elapsed >= slot.durationMs) {
      slot.currentRect = slot.targetRect;
      slot.fromRect = slot.targetRect;
      slot.currentOpacity = slot.targetOpacity;
      slot.fromOpacity = slot.targetOpacity;
      slot.isAnimating = false;
    } else {
      stillAnimating = true;
      const qreal rawProgress = static_cast<qreal>(elapsed) / static_cast<qreal>(slot.durationMs);
      const qreal easedProgress = easing_.valueForProgress(std::clamp(rawProgress, 0.0, 1.0));
      slot.currentRect = interpolateRect(slot.fromRect, slot.targetRect, easedProgress);
      slot.currentOpacity = slot.fromOpacity + (slot.targetOpacity - slot.fromOpacity) * easedProgress;
    }
  }

  QVector<quint64> finishedTransitions;
  for (int i = closingSlots_.size() - 1; i >= 0; --i) {
    auto &cs = closingSlots_[i];
    const qint64 elapsed = now - cs.startTimeMs;
    if (elapsed >= cs.durationMs) {
      finishedTransitions.append(cs.transitionId);
      closingSlots_.removeAt(i);
    } else {
      stillAnimating = true;
      const qreal rawProgress = static_cast<qreal>(elapsed) / static_cast<qreal>(cs.durationMs);
      const qreal easedProgress = easing_.valueForProgress(std::clamp(rawProgress, 0.0, 1.0));
      cs.currentRect = interpolateRect(cs.fromRect, cs.targetRect, easedProgress);
      cs.currentOpacity = std::clamp(1.0 - easedProgress, 0.0, 1.0);
    }
  }

  emit animationProgressed();

  for (quint64 trId : finishedTransitions) {
    emit closingTransitionFinished(trId);
  }

  if (!stillAnimating) {
    timer_.stop();
    emit animationFinished();
  }
}

}  // namespace ardali::desktop_tabs

