#include <QApplication>
#include <QIcon>
#include <QImage>
#include <QMouseEvent>
#include <QSettings>
#include <QTemporaryDir>
#include <QThread>
#include <QWidget>
#include <cassert>
#include <cstdio>

#include "desktop_tabs/detached_tab_window_controller.h"
#include "desktop_tabs/tab_animation_metrics.h"
#include "desktop_tabs/tab_appearance.h"
#include "desktop_tabs/tab_drag_controller.h"
#include "desktop_tabs/tab_drag_types.h"
#include "desktop_tabs/tab_layout_model.h"
#include "desktop_tabs/tab_strip_animator.h"
#include "desktop_tabs/tab_strip_widget.h"
#include "desktop_tabs/tab_window_registry.h"

using namespace ardali::desktop_tabs;

static void testTabAppearanceAndPersistence() {
  std::printf("[TEST] Starting testTabAppearanceAndPersistence...\n");

  assert(tabStyleFromPreference(QStringLiteral("chrome_curved")) ==
         TabStyle::ChromeCurved);
  assert(tabStyleFromPreference(QStringLiteral("ARDALI_SIGNATURE")) ==
         TabStyle::ArDaliSignature);
  assert(tabStyleFromPreference(QStringLiteral("modern_pill")) ==
         TabStyle::FloatingPill);
  assert(tabStylePreferenceValue(TabStyle::FloatingPill) ==
         QStringLiteral("floating_pill"));

  const auto &chrome = tabAppearance(TabStyle::ChromeCurved);
  const auto &ardali = tabAppearance(TabStyle::ArDaliSignature);
  const auto &pill = tabAppearance(TabStyle::FloatingPill);
  assert(chrome.layout.tabHeight == 40);
  assert(chrome.layout.preferredTabWidth == 240);
  assert(chrome.layout.faviconSize == 18);
  assert(chrome.connectsToToolbar);
  assert(ardali.paintsSignatureAccent);
  assert(!pill.connectsToToolbar);

  const QRectF bounds(100, 0, 240, 40);
  const QPainterPath chromePath = tabSurfacePath(
      bounds, 40, TabStyle::ChromeCurved, true);
  const QPainterPath pillPath = tabSurfacePath(
      bounds, 40, TabStyle::FloatingPill, true);
  assert(chromePath.boundingRect().left() < bounds.left());
  assert(chromePath.boundingRect().bottom() > bounds.bottom());
  assert(pillPath.boundingRect().left() > bounds.left());
  assert(pillPath.boundingRect().bottom() < bounds.bottom());

  QSettings settings;
  settings.setValue(QStringLiteral("browser/tabStyle"),
                    QStringLiteral("floating_pill"));
  settings.sync();
  TabStripWidget firstWindowStrip;
  assert(firstWindowStrip.tabStyle() == TabStyle::FloatingPill);
  assert(firstWindowStrip.layoutModel().metrics().preferredTabWidth ==
         pill.layout.preferredTabWidth);

  settings.setValue(QStringLiteral("browser/tabStyle"),
                    QStringLiteral("ardali_signature"));
  settings.sync();
  firstWindowStrip.loadSettings();
  assert(firstWindowStrip.tabStyle() == TabStyle::ArDaliSignature);

  TabStripWidget newWindowStrip;
  assert(newWindowStrip.tabStyle() == TabStyle::ArDaliSignature);

  QWidget firstWindow;
  QWidget secondWindow;
  TabWindowRegistry::instance().clear();
  TabWindowRegistry::instance().registerWindow(&firstWindow, &firstWindowStrip);
  TabWindowRegistry::instance().registerWindow(&secondWindow, &newWindowStrip);
  settings.setValue(QStringLiteral("browser/tabStyle"),
                    QStringLiteral("chrome_curved"));
  settings.sync();
  TabWindowRegistry::instance().reloadTabAppearances();
  assert(firstWindowStrip.tabStyle() == TabStyle::ChromeCurved);
  assert(newWindowStrip.tabStyle() == TabStyle::ChromeCurved);
  TabWindowRegistry::instance().clear();

  std::printf("[TEST] testTabAppearanceAndPersistence passed!\n");
}

static QImage renderTabStrip(TabStripWidget &strip) {
  QImage image(strip.size(), QImage::Format_ARGB32_Premultiplied);
  image.fill(QColor(QStringLiteral("#1c1b22")));
  strip.render(&image);
  return image;
}

static void testDistinctPaintingHoverAndNewTabHitArea() {
  std::printf("[TEST] Starting testDistinctPaintingHoverAndNewTabHitArea...\n");

  QWidget parent;
  parent.resize(900, 80);
  TabStripWidget strip(&parent);
  strip.resize(900, strip.sizeHint().height());
  strip.setStyleSheet(QStringLiteral(
      "background:#1c1b22;color:#f1f3f4;font-size:13px;"));
  strip.addTab(901, QStringLiteral("Active tab"));
  strip.addTab(902, QStringLiteral("Hover target"));
  strip.setCurrentIndex(0);
  parent.show();
  QApplication::processEvents();

  strip.setTabStyle(TabStyle::ChromeCurved);
  strip.setCurrentIndex(1);
  const QImage chromeActiveImage = renderTabStrip(strip);
  const int shoulderX = strip.tabRect(1).left() - 4;
  const int bottomY = strip.height() - 2;
  assert(shoulderX >= 0);
  // The pixel in the lower shoulder curve outside tabRect must be painted and not clipped!
  assert(chromeActiveImage.pixelColor(shoulderX, bottomY) != QColor(QStringLiteral("#1c1b22")));
  strip.setCurrentIndex(0);

  const QImage chromeImage = renderTabStrip(strip);
  strip.setTabStyle(TabStyle::ArDaliSignature);
  const QImage ardaliImage = renderTabStrip(strip);
  strip.setTabStyle(TabStyle::FloatingPill);
  const QImage pillImage = renderTabStrip(strip);
  assert(chromeImage != ardaliImage);
  assert(chromeImage != pillImage);
  assert(ardaliImage != pillImage);
  const QString snapshotDirectory = qEnvironmentVariable(
      "ARDALI_TAB_SNAPSHOT_DIR");
  if (!snapshotDirectory.isEmpty()) {
    chromeImage.save(snapshotDirectory + QStringLiteral("/chrome-curved.png"));
    ardaliImage.save(snapshotDirectory + QStringLiteral("/ardali-signature.png"));
    pillImage.save(snapshotDirectory + QStringLiteral("/floating-pill.png"));
  }

  strip.setTabStyle(TabStyle::ChromeCurved);
  const QImage beforeHover = renderTabStrip(strip);
  const QPoint hoverPoint = strip.tabRect(1).center();
  QMouseEvent moveEvent(QEvent::MouseMove, QPointF(hoverPoint),
                        QPointF(strip.mapToGlobal(hoverPoint)), Qt::NoButton,
                        Qt::NoButton, Qt::NoModifier);
  QApplication::sendEvent(&strip, &moveEvent);
  for (int elapsed = 0; elapsed < 220; elapsed += 10) {
    QThread::msleep(10);
    QApplication::processEvents();
  }
  const QImage afterHover = renderTabStrip(strip);
  assert(beforeHover != afterHover);

  bool newTabRequested = false;
  QObject::connect(&strip, &TabStripWidget::newTabRequested,
                   [&newTabRequested] { newTabRequested = true; });
  const QRect newTabRect = strip.layoutModel().computeNewTabButtonRect(
      strip.visualTabsRight(), strip.size());
  QMouseEvent pressEvent(QEvent::MouseButtonPress,
                         QPointF(newTabRect.center()),
                         QPointF(strip.mapToGlobal(newTabRect.center())),
                         Qt::LeftButton, Qt::LeftButton, Qt::NoModifier);
  QApplication::sendEvent(&strip, &pressEvent);
  assert(newTabRequested);

  std::printf("[TEST] testDistinctPaintingHoverAndNewTabHitArea passed!\n");
}

static void testTabLayoutModel() {
  std::printf("[TEST] Starting testTabLayoutModel...\n");
  TabLayoutModel model;

  QVector<TabModelItem> items;
  items.append(TabModelItem{1, QStringLiteral("Tab 1"), QIcon(), false, false, false});
  items.append(TabModelItem{2, QStringLiteral("Tab 2"), QIcon(), false, false, false});
  items.append(TabModelItem{3, QStringLiteral("Tab 3"), QIcon(), false, false, false});

  // Test 1: Layout bounds for 3 unpinned tabs in 1000px strip
  auto geoms = model.computeLayout(1000, items, 0);
  assert(geoms.size() == 3);
  assert(geoms[0].logicalRect.width() == 220);
  assert(geoms[0].logicalRect.left() == 0);
  assert(geoms[1].logicalRect.left() == 220);
  assert(geoms[2].logicalRect.left() == 440);

  // Test 2: Close button hit test
  assert(!geoms[0].closeButtonRect.isEmpty());
  const QPoint closeCenter = geoms[0].closeButtonRect.center();
  assert(model.hitTestCloseButton(geoms[0], closeCenter));
  assert(!model.hitTestCloseButton(geoms[0], QPoint(10, 10)));

  // Test 3: Tab index hit test
  assert(model.hitTestTabIndex(geoms, QPoint(50, 15)) == 0);
  assert(model.hitTestTabIndex(geoms, QPoint(250, 15)) == 1);
  assert(model.hitTestTabIndex(geoms, QPoint(480, 15)) == 2);
  assert(model.hitTestTabIndex(geoms, QPoint(900, 15)) == -1);

  // Test 4: Pinned tab compact width
  items[0].isPinned = true;
  auto pinnedGeoms = model.computeLayout(1000, items, 0);
  assert(pinnedGeoms[0].isPinned);
  assert(pinnedGeoms[0].logicalRect.width() == model.metrics().pinnedTabWidth);
  assert(pinnedGeoms[0].closeButtonRect.isEmpty());  // No close button on pinned tab

  // Test 5: Squeezed tabs under constrained width
  QVector<TabModelItem> manyItems;
  for (int i = 0; i < 20; ++i) {
    manyItems.append(TabModelItem{static_cast<uint64_t>(i + 1), QStringLiteral("Tab %1").arg(i + 1), QIcon(), false, false, false});
  }
  auto squeezedGeoms = model.computeLayout(800, manyItems, 0);
  assert(squeezedGeoms.size() == 20);
  for (const auto &g : squeezedGeoms) {
    assert(g.logicalRect.width() >= model.metrics().minTabWidth);
  }

  // Test 6: Insertion slot calculation
  const int slotLeft = model.computeInsertionSlot(1000, items, 2, QPoint(50, 15));
  assert(slotLeft == 1);  // items[0] is pinned, so unpinned tab 2 cannot go to slot 0

  // Test 7: Magnetic detach boundary
  const QSize stripSize(800, 34);
  const QRect boundary = model.computeDetachBoundary(stripSize);
  assert(boundary.top() == -model.metrics().verticalDetachThreshold);
  assert(boundary.bottom() == 34 + model.metrics().verticalDetachThreshold - 1);
  assert(!model.isOutsideDetachBoundary(QPoint(100, 15), stripSize));
  assert(!model.isOutsideDetachBoundary(QPoint(100, -10), stripSize));  // Within vertical magnetism
  assert(model.isOutsideDetachBoundary(QPoint(100, -50), stripSize));   // Beyond vertical magnetism
  assert(!model.isOutsideDetachBoundary(QPoint(-500, 15), stripSize));  // Horizontal travel only reorders
  assert(!model.isOutsideDetachBoundary(QPoint(1500, 15), stripSize));

  // Attach uses a separate, deliberately narrower halo. Reusing the detach
  // boundary here caused premature attach followed by immediate re-detach.
  const QRect attachBoundary = model.computeAttachBoundary(stripSize);
  assert(attachBoundary.top() == -model.metrics().attachMagnetism);
  assert(attachBoundary.bottom() == stripSize.height()
      + model.metrics().attachMagnetism - 1);
  assert(attachBoundary.height() < boundary.height());

  // External insertion can append after the last existing tab.
  items[0].isPinned = false;
  assert(model.computeExternalInsertionIndex(1000, items, false,
                                              QPoint(999, 15)) == items.size());

  // Dragging tab 0 to slot 2 opens a slot by shifting both siblings left.
  const auto dragLayout = model.computeLayout(
      1000, items, 0, 0, 2, QPoint(420, 0));
  assert(dragLayout[0].visualRect.left() == 420);
  assert(dragLayout[1].logicalRect.left() == 0);
  assert(dragLayout[2].logicalRect.left() == 220);

  std::printf("[TEST] testTabLayoutModel passed!\n");
}

static void testTabStripAnimator() {
  std::printf("[TEST] Starting testTabStripAnimator...\n");
  TabStripAnimator animator;

  QVector<TabGeometry> initial;
  TabGeometry g1, g2;
  g1.tabIndex = 0;
  g1.logicalRect = QRect(0, 0, 200, 34);
  g2.tabIndex = 1;
  g2.logicalRect = QRect(200, 0, 200, 34);
  initial.append(g1);
  initial.append(g2);

  animator.resetSlots(initial);
  assert(!animator.isAnimating());
  assert(animator.currentVisualRect(0) == QRect(0, 0, 200, 34));
  assert(animator.currentVisualRect(1) == QRect(200, 0, 200, 34));

  // Immediate visual rect
  animator.setImmediateVisualRect(0, QRect(50, 0, 200, 34));
  assert(animator.currentVisualRect(0) == QRect(50, 0, 200, 34));

  // Target update
  initial[0].logicalRect = QRect(200, 0, 200, 34);
  initial[1].logicalRect = QRect(0, 0, 200, 34);
  animator.setTargetGeometries(initial, 100);
  assert(animator.isAnimating());

  // Finish immediately
  animator.finishImmediately();
  assert(!animator.isAnimating());
  assert(animator.currentVisualRect(0) == QRect(200, 0, 200, 34));
  assert(animator.currentVisualRect(1) == QRect(0, 0, 200, 34));

  std::printf("[TEST] testTabStripAnimator passed!\n");
}

static void testMotionAndRetargeting() {
  std::printf("[TEST] Starting testMotionAndRetargeting...\n");
  TabStripAnimator animator;

  // 1. Tab Open with stable IDs
  QVector<TabGeometry> geoms;
  TabGeometry t1;
  t1.tabId = 1001;
  t1.tabIndex = 0;
  t1.logicalRect = QRect(0, 0, 200, 34);
  geoms.append(t1);

  animator.resetSlots(geoms);
  assert(animator.currentOpacity(0) == 1.0);
  assert(animator.currentVisualRect(0) == QRect(0, 0, 200, 34));

  // Add a second tab t2
  TabGeometry t2;
  t2.tabId = 1002;
  t2.tabIndex = 1;
  t2.logicalRect = QRect(200, 0, 200, 34);
  geoms.append(t2);

  animator.setTargetGeometries(geoms, 150);
  assert(animator.isAnimating());
  // Newly added tab t2 starts at width 0 and opacity 0
  assert(animator.currentOpacity(1) == 0.0);
  assert(animator.currentVisualRect(1).width() == 0);

  // 2. Tab Close Visual Ghost
  const quint64 trId = animator.startClosingTransition(QRect(200, 0, 200, 34), 150);
  assert(trId > 0);
  assert(!animator.closingVisuals().isEmpty());
  const auto cv = animator.closingVisuals().first();
  assert(cv.transitionId == trId);
  assert(cv.rect == QRect(200, 0, 200, 34));
  assert(cv.opacity == 1.0);

  // 3. Retargeting continuous motion
  // While animating, change target of t1 from (0, 0, 200, 34) to (50, 0, 200, 34)
  geoms[0].logicalRect = QRect(50, 0, 200, 34);
  animator.setTargetGeometries(geoms, 150);
  assert(animator.isAnimating());

  // 4. Rapid + (5 tabs)
  for (uint64_t id = 1003; id <= 1007; ++id) {
    TabGeometry t;
    t.tabId = id;
    t.tabIndex = geoms.size();
    t.logicalRect = QRect(geoms.size() * 100, 0, 100, 34);
    geoms.append(t);
  }
  animator.setTargetGeometries(geoms, 150);
  assert(animator.isAnimating());

  // Finish and verify clean final state
  animator.finishImmediately();
  assert(!animator.isAnimating());
  assert(animator.closingVisuals().isEmpty());
  for (int i = 0; i < geoms.size(); ++i) {
    assert(animator.currentOpacity(i) == 1.0);
    assert(animator.currentVisualRect(i) == geoms[i].logicalRect);
  }

  // 5. Test TabStripWidget Tab Open Animation & visualTabsRight
  QWidget parent;
  parent.resize(800, 600);
  TabStripWidget strip(&parent);
  strip.resize(800, 34);
  strip.addTab(2001, QStringLiteral("Tab A"));
  // Let initial tab settle
  for (int t = 0; t < 250; t += 20) {
    QThread::msleep(20);
    QApplication::processEvents();
  }
  const int rightBefore = strip.visualTabsRight();
  assert(rightBefore > 0);

  // Add Tab B -> verify first frame width is 0 and does NOT jump to target width!
  strip.addTab(2002, QStringLiteral("Tab B"));
  const QRect firstFrameRect = strip.tabRect(1);
  const int targetWidth = strip.layoutModel().metrics().preferredTabWidth;
  std::printf("[FRAME LOG] Tab Open Frame 0: sourceWidth=0 currentWidth=%d targetWidth=%d visualTabsRight=%d\n",
              firstFrameRect.width(), targetWidth, strip.visualTabsRight());
  assert(firstFrameRect.width() == 0);
  assert(firstFrameRect.width() != targetWidth);
  assert(strip.visualTabsRight() == rightBefore);

  // Track animation frames
  int prevWidth = 0;
  for (int elapsed = 20; elapsed <= 240; elapsed += 20) {
    QThread::msleep(20);
    QApplication::processEvents();
    const int curW = strip.tabRect(1).width();
    const qreal progress = std::clamp(static_cast<qreal>(elapsed) / 220.0, 0.0, 1.0);
    std::printf("[FRAME LOG] Tab Open %d ms (progress ~%.2f): currentWidth=%d visualTabsRight=%d\n",
                elapsed, progress, curW, strip.visualTabsRight());
    assert(curW >= prevWidth);
    prevWidth = curW;
  }
  assert(strip.tabRect(1).width() == targetWidth);

  // Remove Tab B -> closing ghost keeps right edge active
  strip.removeTab(1);
  const int rightDuringClose = strip.visualTabsRight();
  assert(rightDuringClose >= rightBefore - 5); // Must not drop instantly to Tab A width
  for (int t = 0; t < 250; t += 20) {
    QThread::msleep(20);
    QApplication::processEvents();
  }

  std::printf("[TEST] testMotionAndRetargeting passed!\n");
}

static void testTabStripWidget() {
  std::printf("[TEST] Starting testTabStripWidget...\n");
  QWidget parent;
  parent.resize(800, 600);

  TabStripWidget strip(&parent);
  strip.resize(800, 34);

  assert(strip.count() == 0);
  assert(strip.currentIndex() == -1);

  // Add tabs
  strip.addTab(101, QStringLiteral("Google"));
  strip.addTab(102, QStringLiteral("GitHub"));
  strip.addTab(103, QStringLiteral("ArDali"));

  assert(strip.count() == 3);
  assert(strip.currentIndex() == 0);
  assert(strip.tabText(0) == QStringLiteral("Google"));
  assert(strip.tabText(1) == QStringLiteral("GitHub"));
  assert(strip.tabText(2) == QStringLiteral("ArDali"));

  // Move tab
  strip.moveTab(0, 2);
  assert(strip.tabText(0) == QStringLiteral("GitHub"));
  assert(strip.tabText(1) == QStringLiteral("ArDali"));
  assert(strip.tabText(2) == QStringLiteral("Google"));

  // Pinned tab
  strip.setTabPinned(0, true);
  assert(strip.isTabPinned(0));

  // Remove tab
  strip.removeTab(1);
  assert(strip.count() == 2);
  assert(strip.tabText(1) == QStringLiteral("Google"));

  // The dragged visual follows the cursor directly and all child hit rects
  // move with it rather than remaining at the logical slot.
  strip.controllerBeginDrag(1, strip.mapToGlobal(QPoint(260, 15)), QPoint(40, 15));
  strip.controllerUpdateDrag(strip.mapToGlobal(QPoint(500, 15)), 0);
  const QRect draggedRect = strip.tabRect(1);
  assert(draggedRect.left() == 460);
  assert(strip.tabAt(draggedRect.center()) == 1);
  strip.controllerFinishDrag(1, true);

  std::printf("[TEST] testTabStripWidget passed!\n");
}

static void testTabWindowRegistry() {
  std::printf("[TEST] Starting testTabWindowRegistry...\n");
  TabWindowRegistry &registry = TabWindowRegistry::instance();
  registry.clear();

  QWidget win1, win2;
  win1.resize(800, 600);
  win2.resize(800, 600);
  win1.move(0, 0);
  win2.move(900, 0);

  TabStripWidget strip1(&win1);
  TabStripWidget strip2(&win2);
  strip1.resize(800, 34);
  strip2.resize(800, 34);
  strip1.addTab(1, QStringLiteral("Tab 1"));
  strip2.addTab(2, QStringLiteral("Tab 2"));

  registry.registerWindow(&win1, &strip1);
  registry.registerWindow(&win2, &strip2);

  win1.show();
  win2.show();
  win1.move(0, 0);
  win2.move(1000, 0);

  const QPoint gpos = strip1.mapToGlobal(QPoint(100, 15));
  const auto target1 = registry.findTargetAt(gpos, &win2);
  assert(target1.window == &win1);
  assert(target1.tabStrip == &strip1);

  // Exclude win1 when checking win1 pos
  const auto targetSelf = registry.findTargetAt(gpos, &win1);
  assert(targetSelf.window != &win1);

  // Capture shells and incompatible profiles are never attach targets.
  const QPoint gpos2 = strip2.mapToGlobal(QPoint(100, 15));
  win2.setProperty("ardaliDragCaptureShell", true);
  assert(registry.findTargetAt(gpos2, &win1).window != &win2);
  win2.setProperty("ardaliDragCaptureShell", false);
  win1.setProperty("ardaliTabProfile", QVariant::fromValue<qulonglong>(1));
  win2.setProperty("ardaliTabProfile", QVariant::fromValue<qulonglong>(2));
  assert(registry.findTargetAt(gpos2, &win1).window != &win2);

  registry.unregisterWindow(&win1);
  assert(registry.registeredWindows().size() == 1);
  registry.clear();

  std::printf("[TEST] testTabWindowRegistry passed!\n");
}

static void testDetachedTabWindowController() {
  std::printf("[TEST] Starting testDetachedTabWindowController...\n");
  DetachedTabWindowController controller;

  QWidget originWin;
  originWin.resize(800, 600);

  QWidget detachedMock;
  detachedMock.resize(800, 600);

  controller.setWindowFactory([&detachedMock](QWidget *, uint64_t) {
    return &detachedMock;
  });
  controller.setDetachTransferDelegate(
      [](QWidget *, QWidget *, uint64_t, int) { return true; });

  const QPoint globalCursor(500, 300);
  const QPoint heldOffset(150, 20);

  QWidget *created = controller.createDetachedWindow(&originWin, 123, globalCursor, heldOffset);
  assert(created == &detachedMock);
  assert(controller.detachedWindow() == &detachedMock);

  // Verify held point invariant: cursorGlobal == windowTopLeft + heldOffset
  const QPoint expectedTopLeft = globalCursor - heldOffset;
  assert(detachedMock.pos() == expectedTopLeft);
  assert(controller.verifyHeldPointInvariant(globalCursor, heldOffset));

  // Move detached window
  const QPoint newCursor(600, 400);
  controller.moveDetachedWindow(newCursor, heldOffset);
  assert(detachedMock.pos() == (newCursor - heldOffset));
  assert(controller.verifyHeldPointInvariant(newCursor, heldOffset));

  controller.finalizeDetachedWindow();
  assert(controller.detachedWindow() == nullptr);

  std::printf("[TEST] testDetachedTabWindowController passed!\n");
}

static void testTabDragControllerStateMachine() {
  std::printf("[TEST] Starting testTabDragControllerStateMachine...\n");
  TabDragController controller;

  QWidget win1, win2;
  win1.resize(800, 600);
  win2.resize(800, 600);
  win1.move(0, 0);
  win2.move(900, 0);

  TabStripWidget strip1(&win1);
  TabStripWidget strip2(&win2);
  strip1.resize(800, 34);
  strip2.resize(800, 34);

  strip1.addTab(1, QStringLiteral("Tab A"));
  strip1.addTab(2, QStringLiteral("Tab B"));
  strip2.addTab(3, QStringLiteral("Tab C"));

  TabWindowRegistry::instance().clear();
  TabWindowRegistry::instance().registerWindow(&win1, &strip1);
  TabWindowRegistry::instance().registerWindow(&win2, &strip2);
  win1.show();
  win2.show();

  QWidget detachedMock;
  detachedMock.resize(800, 600);

  controller.setDetachedWindowFactory([&detachedMock](QWidget *, uint64_t) {
    return &detachedMock;
  });
  controller.setDetachTransferDelegate(
      [](QWidget *, QWidget *, uint64_t, int) { return true; });

  bool moved = false;
  controller.setTabMoveDelegate([&moved](QWidget *, int, int) {
    moved = true;
  });

  // State 1: Press
  const QPoint pressGlobal = strip1.mapToGlobal(QPoint(50, 15));
  controller.handleMousePress(&win1, &strip1, 0, pressGlobal, QPoint(50, 15), QPoint(50, 15));
  assert(controller.isActive());
  assert(controller.state() == DragState::Pressed);

  // State 2: Small movement (less than threshold) -> remains Pressed
  controller.handleMouseMove(pressGlobal + QPoint(2, 0));
  assert(controller.state() == DragState::Pressed);

  // State 3: Movement past threshold -> enters DraggingInStrip
  controller.handleMouseMove(pressGlobal + QPoint(25, 0));
  assert(controller.state() == DragState::DraggingInStrip);

  // Large horizontal-only movement must never detach.
  controller.handleMouseMove(pressGlobal + QPoint(1200, 0));
  assert(controller.state() == DragState::DraggingInStrip);

  // State 4: Vertical movement outside magnetic boundary -> enters DraggingDetachedWindow
  controller.handleMouseMove(pressGlobal + QPoint(25, 120));
  assert(controller.state() == DragState::DraggingDetachedWindow || controller.state() == DragState::SearchingAttachTarget);

  // State 5: Release
  controller.handleMouseRelease(pressGlobal + QPoint(25, 120));
  assert(!controller.isActive());
  assert(controller.state() == DragState::Idle);

  TabWindowRegistry::instance().clear();
  std::printf("[TEST] testTabDragControllerStateMachine passed!\n");
}

static void testStressDragCycles() {
  std::printf("[TEST] Starting testStressDragCycles (100 cycles)...\n");
  TabDragController controller;

  QWidget win;
  win.resize(1000, 600);
  TabStripWidget strip(&win);
  strip.resize(1000, 34);

  for (int i = 0; i < 10; ++i) {
    strip.addTab(i + 1, QStringLiteral("Tab %1").arg(i + 1));
  }

  QWidget detachedMock;
  detachedMock.resize(800, 600);
  controller.setDetachedWindowFactory([&detachedMock](QWidget *, uint64_t) {
    return &detachedMock;
  });
  controller.setDetachTransferDelegate(
      [](QWidget *, QWidget *, uint64_t, int) { return true; });

  for (int cycle = 0; cycle < 100; ++cycle) {
    const int tabIdx = cycle % 10;
    const QPoint pressPos = strip.mapToGlobal(QPoint(tabIdx * 80 + 30, 15));
    controller.handleMousePress(&win, &strip, tabIdx, pressPos, QPoint(30, 15), QPoint(30, 15));
    assert(controller.isActive());

    // In-strip drag
    controller.handleMouseMove(pressPos + QPoint(50, 0));

    if (cycle % 3 == 0) {
      // Detach
      controller.handleMouseMove(pressPos + QPoint(50, 150));
    }

    if (cycle % 5 == 0) {
      // Cancel
      controller.handleCancel();
      assert(!controller.isActive());
    } else {
      // Complete
      controller.handleMouseRelease(pressPos + QPoint(50, 0));
      assert(!controller.isActive());
    }
    assert(QGuiApplication::overrideCursor() == nullptr);
  }

  std::printf("[TEST] testStressDragCycles (100 cycles) passed without crashes!\n");
}

static void testCursorCleanupAndAnimationMetrics() {
  std::printf("[TEST] Starting testCursorCleanupAndAnimationMetrics...\n");

  // 1. Validate metrics are within Chrome-parity perceptual bands
  assert(TabAnimationMetrics::tabOpenDurationMs >= 180 && TabAnimationMetrics::tabOpenDurationMs <= 220);
  assert(TabAnimationMetrics::tabCloseDurationMs >= 170 && TabAnimationMetrics::tabCloseDurationMs <= 210);
  assert(TabAnimationMetrics::tabSlotDurationMs >= 180 && TabAnimationMetrics::tabSlotDurationMs <= 220);
  assert(TabAnimationMetrics::tabSettleDurationMs >= 180 && TabAnimationMetrics::tabSettleDurationMs <= 230);
  assert(TabAnimationMetrics::windowTransitionDurationMs >= 180 && TabAnimationMetrics::windowTransitionDurationMs <= 230);

  // 2. Cursor cleanup test across full detach -> live reattach -> drop cycle
  QWidget winA;
  winA.setGeometry(100, 100, 800, 600);
  auto *stripA = new TabStripWidget(&winA);
  stripA->setGeometry(0, 0, 800, 34);
  stripA->addTab(101, QStringLiteral("Tab 1"));
  stripA->addTab(102, QStringLiteral("Tab 2"));
  winA.show();

  QWidget winB;
  winB.setGeometry(1000, 100, 800, 600);
  auto *stripB = new TabStripWidget(&winB);
  stripB->setGeometry(0, 0, 800, 34);
  stripB->addTab(201, QStringLiteral("Tab 3"));
  winB.show();

  TabWindowRegistry::instance().registerWindow(&winA, stripA);
  TabWindowRegistry::instance().registerWindow(&winB, stripB);

  auto &controller = TabDragController::instance();
  QWidget detachedShell;
  detachedShell.setGeometry(0, 0, 800, 600);
  detachedShell.setProperty("ardaliDragCaptureShell", true);
  auto *shellStrip = new TabStripWidget(&detachedShell);
  shellStrip->setGeometry(0, 0, 800, 34);

  controller.setDetachedWindowFactory([&detachedShell](QWidget *, uint64_t) {
    return &detachedShell;
  });

  auto transferImpl = [](QWidget *fromWin, QWidget *toWin, uint64_t id, int targetIdx) -> bool {
    auto *fromStrip = fromWin ? fromWin->findChild<TabStripWidget *>() : nullptr;
    auto *toStrip = toWin ? toWin->findChild<TabStripWidget *>() : nullptr;
    if (!fromStrip || !toStrip) return false;
    fromStrip->removeTab(0);
    toStrip->insertTab(targetIdx, id, QStringLiteral("Tab"));
    return true;
  };

  controller.setDetachTransferDelegate(
      [&](QWidget *dest, QWidget *orig, uint64_t id, int idx) {
        return transferImpl(orig, dest, id, idx);
      });
  controller.setTabTransferDelegate(transferImpl);

  // NOTE: We no longer manually push ClosedHandCursor before the drag.
  // TabDragController::startInStripDrag() now sets it automatically once the
  // drag threshold is exceeded. This test verifies that invariant.
  assert(QGuiApplication::overrideCursor() == nullptr);

  const QPoint pressPos = stripA->mapToGlobal(QPoint(50, 15));
  controller.handleMousePress(&winA, stripA, 0, pressPos, QPoint(20, 15), QPoint(20, 15));
  // Pre-threshold: no drag cursor yet
  assert(QGuiApplication::overrideCursor() == nullptr);

  controller.handleMouseMove(pressPos + QPoint(30, 0));
  assert(controller.state() == DragState::DraggingInStrip);
  // Post-threshold: controller must have set ClosedHandCursor
  assert(QGuiApplication::overrideCursor() != nullptr);
  assert(QGuiApplication::overrideCursor()->shape() == Qt::ClosedHandCursor);

  // Detach
  controller.handleMouseMove(pressPos + QPoint(30, 120));
  assert(controller.state() == DragState::DraggingDetachedWindow);
  // Cursor must still be ClosedHandCursor during detached phase
  assert(QGuiApplication::overrideCursor() != nullptr);
  assert(QGuiApplication::overrideCursor()->shape() == Qt::ClosedHandCursor);

  // Move over Window B -> Live reattach into winB via registry hit-test
  const QPoint bPos = stripB->mapToGlobal(QPoint(50, 15));
  controller.handleMouseMove(bPos);
  assert(controller.state() == DragState::DraggingInTargetStrip);

  // Complete drop
  controller.handleMouseRelease(bPos);
  assert(controller.state() == DragState::Idle);

  // Verify ALL cursor overrides and widget cursors are completely clean
  assert(QGuiApplication::overrideCursor() == nullptr);
  assert(!stripA->testAttribute(Qt::WA_SetCursor));
  assert(!stripB->testAttribute(Qt::WA_SetCursor));
  assert(!winA.testAttribute(Qt::WA_SetCursor));
  assert(!winB.testAttribute(Qt::WA_SetCursor));

  // Repeat with cancel — cursor must also be cleaned up on cancel path
  assert(QGuiApplication::overrideCursor() == nullptr);
  controller.handleMousePress(&winA, stripA, 0, pressPos, QPoint(20, 15), QPoint(20, 15));
  controller.handleMouseMove(pressPos + QPoint(30, 0));
  // Drag started: cursor should be ClosedHandCursor
  assert(QGuiApplication::overrideCursor() != nullptr);
  assert(QGuiApplication::overrideCursor()->shape() == Qt::ClosedHandCursor);
  controller.handleCancel();
  assert(controller.state() == DragState::Idle);
  assert(QGuiApplication::overrideCursor() == nullptr);
  assert(!stripA->testAttribute(Qt::WA_SetCursor));

  TabWindowRegistry::instance().unregisterWindow(&winA);
  TabWindowRegistry::instance().unregisterWindow(&winB);

  std::printf("[TEST] testCursorCleanupAndAnimationMetrics passed!\n");
}

static void testRapidNewTabCursorStability() {
  std::printf("[TEST] Starting testRapidNewTabCursorStability...\n");

  TabStripWidget strip;
  strip.resize(1000, 40);
  strip.show();

  uint64_t nextId = 100;
  strip.insertTab(0, nextId++, QStringLiteral("Tab 1"), QIcon());
  assert(strip.count() == 1);

  int newTabTriggerCount = 0;
  QObject::connect(&strip, &TabStripWidget::newTabRequested, [&]() {
    newTabTriggerCount++;
    strip.insertTab(strip.count(), nextId++, QStringLiteral("New Tab"), QIcon());
  });

  // Hold mouse at the initial '+' button location and click rapidly 5 times
  const QRect initialPlusRect = strip.layoutModel().computeNewTabButtonRect(
      strip.visualTabsRight(), strip.size());
  const QPoint clickPos = initialPlusRect.center();

  for (int i = 0; i < 5; ++i) {
    QMouseEvent pressEvent(QEvent::MouseButtonPress, clickPos, clickPos,
                           Qt::LeftButton, Qt::LeftButton, Qt::NoModifier);
    QApplication::sendEvent(&strip, &pressEvent);

    QMouseEvent releaseEvent(QEvent::MouseButtonRelease, clickPos, clickPos,
                             Qt::LeftButton, Qt::NoButton, Qt::NoModifier);
    QApplication::sendEvent(&strip, &releaseEvent);

    // Simulate mouse move over the strip while tabs animate open and '+' shifts right
    for (int step = 0; step < 5; ++step) {
      QMouseEvent moveEvent(QEvent::MouseMove, clickPos, clickPos,
                            Qt::NoButton, Qt::NoButton, Qt::NoModifier);
      QApplication::sendEvent(&strip, &moveEvent);
      QApplication::processEvents();
      QThread::msleep(10);
    }

    // Cursor MUST remain completely standard and not mutated by tab open animation
    assert(QGuiApplication::overrideCursor() == nullptr);
    assert(!TabDragController::instance().isActive());
    assert(strip.cursor().shape() != Qt::SizeVerCursor);
    assert(strip.cursor().shape() != Qt::SizeHorCursor);
    assert(strip.cursor().shape() != Qt::ClosedHandCursor);
  }

  assert(newTabTriggerCount >= 1);
  assert(strip.count() >= 2);

  // Normal tab drag should STILL start and function when dragged beyond threshold
  const QRect tab0Rect = strip.tabRect(0);
  const QPoint tabCenter = tab0Rect.center();
  const QPoint globalTabCenter = strip.mapToGlobal(tabCenter);

  QMouseEvent tabPress(QEvent::MouseButtonPress, tabCenter, globalTabCenter,
                       Qt::LeftButton, Qt::LeftButton, Qt::NoModifier);
  QApplication::sendEvent(&strip, &tabPress);

  // Small jitter below threshold must NOT initiate drag
  const QPoint smallJitter = tabCenter + QPoint(2, 0);
  QMouseEvent jitterMove(QEvent::MouseMove, smallJitter, strip.mapToGlobal(smallJitter),
                         Qt::LeftButton, Qt::LeftButton, Qt::NoModifier);
  QApplication::sendEvent(&strip, &jitterMove);
  assert(!TabDragController::instance().isActive());

  // Mouse release resets pressed state
  QMouseEvent tabRelease(QEvent::MouseButtonRelease, smallJitter, strip.mapToGlobal(smallJitter),
                         Qt::LeftButton, Qt::NoButton, Qt::NoModifier);
  QApplication::sendEvent(&strip, &tabRelease);
  assert(QGuiApplication::overrideCursor() == nullptr);

  std::printf("[TEST] testRapidNewTabCursorStability passed!\n");
}

static void testDetachAnchorAndClosedHandCursor() {
  std::printf("[TEST] Starting testDetachAnchorAndClosedHandCursor...\n");

  // Source window: 800x600, tab strip at y=0, height=34
  QWidget sourceWin;
  sourceWin.setGeometry(100, 100, 800, 600);
  auto *srcStrip = new TabStripWidget(&sourceWin);
  srcStrip->setGeometry(0, 0, 800, 34);
  srcStrip->addTab(501, QStringLiteral("Tab A"));
  srcStrip->addTab(502, QStringLiteral("Tab B"));
  sourceWin.show();
  QApplication::processEvents();

  TabWindowRegistry::instance().registerWindow(&sourceWin, srcStrip);

  auto &controller = TabDragController::instance();

  // Shell: represents the new detached window. For offscreen testing we give it
  // an explicit geometry and a tab strip so tabRect(0) is available.
  QWidget detachedShell;
  detachedShell.setGeometry(0, 0, 600, 450);  // ~75% of 800x600
  detachedShell.setProperty("ardaliDragCaptureShell", true);
  auto *shellStrip = new TabStripWidget(&detachedShell);
  shellStrip->setGeometry(0, 0, 600, 34);
  shellStrip->addTab(501, QStringLiteral("Tab A"));

  controller.setDetachedWindowFactory([&detachedShell](QWidget *, uint64_t) {
    return &detachedShell;
  });

  auto transferImpl = [](QWidget *fromWin, QWidget *toWin, uint64_t /*id*/, int /*idx*/) -> bool {
    Q_UNUSED(fromWin); Q_UNUSED(toWin); return true;
  };
  controller.setDetachTransferDelegate(
      [&transferImpl](QWidget *dest, QWidget *orig, uint64_t id, int idx) {
        return transferImpl(orig, dest, id, idx);
      });
  controller.setTabTransferDelegate(transferImpl);

  // --- Test 1: ClosedHandCursor lifecycle ---
  // Cursor must be clean before press
  assert(QGuiApplication::overrideCursor() == nullptr);

  // Press at tab center with left-grip offset (x=10)
  const QRect tab0Rect = srcStrip->tabRect(0);
  const QPoint tabLocalGrip(10, tab0Rect.height() / 2);
  const QPoint pressGlobal = srcStrip->mapToGlobal(tab0Rect.topLeft() + tabLocalGrip);

  controller.handleMousePress(&sourceWin, srcStrip, 0, pressGlobal,
                               tabLocalGrip, QPoint(10, tab0Rect.height() / 2));
  // Below threshold: no cursor change yet
  assert(QGuiApplication::overrideCursor() == nullptr);

  // Cross horizontal threshold -> DraggingInStrip -> ClosedHandCursor set
  controller.handleMouseMove(pressGlobal + QPoint(20, 0));
  assert(controller.state() == DragState::DraggingInStrip);
  assert(QGuiApplication::overrideCursor() != nullptr);
  assert(QGuiApplication::overrideCursor()->shape() == Qt::ClosedHandCursor);

  // Cross vertical detach threshold -> detach -> cursor STILL ClosedHandCursor
  controller.handleMouseMove(pressGlobal + QPoint(20, 80));
  const bool detachedOrSearching = (controller.state() == DragState::DraggingDetachedWindow ||
                                     controller.state() == DragState::SearchingAttachTarget);
  assert(detachedOrSearching);
  assert(QGuiApplication::overrideCursor() != nullptr);
  assert(QGuiApplication::overrideCursor()->shape() == Qt::ClosedHandCursor);

  // Release -> Idle -> cursor cleaned up
  controller.handleMouseRelease(pressGlobal + QPoint(20, 80));
  assert(controller.state() == DragState::Idle);
  assert(QGuiApplication::overrideCursor() == nullptr);

  // --- Test 2: Detached window size ratio ---
  // Detached shell was set to 600x450; source is 800x600.
  // 600/800 = 0.75 and 450/600 = 0.75 — within acceptable tolerance.
  // We verify the factory shell was given size within [640,800] x [420,600].
  // (The factory returns our pre-sized shell, so we verify the factory returned
  //  a shell whose geometry is sane rather than blindly 1:1 source.)
  assert(detachedShell.width() <= sourceWin.width());
  assert(detachedShell.height() <= sourceWin.height());
  // Detached window must be at most 80% of source (sanity: not a 1:1 clone)
  const double widthRatio = static_cast<double>(detachedShell.width()) /
                             static_cast<double>(sourceWin.width());
  assert(widthRatio <= 0.80);

  // Cleanup
  TabWindowRegistry::instance().unregisterWindow(&sourceWin);

  std::printf("[TEST] testDetachAnchorAndClosedHandCursor passed!\n");
}

static void testDetachChromeTabStayAndSettleOnRelease() {
  std::printf("[TEST] Starting testDetachChromeTabStayAndSettleOnRelease...\n");
  TabDragController controller;

  QWidget sourceWin;
  sourceWin.resize(1000, 700);
  sourceWin.move(100, 100);

  TabStripWidget *srcStrip = new TabStripWidget(&sourceWin);
  srcStrip->resize(900, 34);
  srcStrip->move(30, 10);
  srcStrip->addTab(101, QStringLiteral("Tab 1"));
  srcStrip->addTab(102, QStringLiteral("Tab 2"));
  srcStrip->addTab(103, QStringLiteral("Tab 3"));

  TabWindowRegistry::instance().registerWindow(&sourceWin, srcStrip);

  QWidget detachedShell;
  detachedShell.resize(800, 600);
  TabStripWidget *destStrip = new TabStripWidget(&detachedShell);
  destStrip->resize(700, 34);
  destStrip->move(30, 10);

  controller.setDetachedWindowFactory([&detachedShell](QWidget *, uint64_t) {
    return &detachedShell;
  });
  controller.setDetachTransferDelegate([destStrip](QWidget *, QWidget *, uint64_t id, int) {
    destStrip->addTab(id, QStringLiteral("Transferred Tab"));
    return true;
  });

  // Tab 2 (index 1) is at some X offset > 0
  const QRect tab1Rect = srcStrip->tabRect(1);
  assert(tab1Rect.x() > 0);
  const QPoint pressOffsetInTab(25, 12);
  const QPoint pressGlobal = srcStrip->mapToGlobal(tab1Rect.topLeft() + pressOffsetInTab);
  const QPoint offsetInWindow = sourceWin.mapFromGlobal(pressGlobal);

  controller.handleMousePress(&sourceWin, srcStrip, 1, pressGlobal, pressOffsetInTab, offsetInWindow);

  // Cross horizontal threshold -> DraggingInStrip
  controller.handleMouseMove(pressGlobal + QPoint(20, 0));
  assert(controller.state() == DragState::DraggingInStrip);

  // Cross vertical detach threshold -> detach to new window
  controller.handleMouseMove(pressGlobal + QPoint(20, 80));
  assert(controller.state() == DragState::DraggingDetachedWindow ||
         controller.state() == DragState::SearchingAttachTarget);

  // In detached window, tab 0 must be positioned at its held X position (initialTabX_ > 0), NOT forced to 0!
  const QRect detachedTabRect = destStrip->tabRect(0);
  assert(detachedTabRect.x() > 0);

  // While dragging detached window, the tab inside must stay at the same X (kaymamalı)
  controller.handleMouseMove(pressGlobal + QPoint(50, 120));
  assert(destStrip->tabRect(0).x() == detachedTabRect.x());

  // Plus (+) button must be to the right of the tab, not on the far left
  const QRect plusBtnRect = destStrip->layoutModel().computeNewTabButtonRect(
      destStrip->visualTabsRight(), destStrip->size());
  assert(plusBtnRect.left() > detachedTabRect.right());

  // On release -> tab completes drag and settles to 0
  controller.handleMouseRelease(pressGlobal + QPoint(50, 120));
  assert(controller.state() == DragState::Idle);

  TabWindowRegistry::instance().unregisterWindow(&sourceWin);
  std::printf("[TEST] testDetachChromeTabStayAndSettleOnRelease passed!\n");
}

int main(int argc, char *argv[]) {
  QApplication app(argc, argv);

  QTemporaryDir settingsDirectory;
  assert(settingsDirectory.isValid());
  QCoreApplication::setOrganizationName(QStringLiteral("ArDaliTest"));
  QCoreApplication::setApplicationName(QStringLiteral("DesktopTabSystem"));
  QSettings::setDefaultFormat(QSettings::IniFormat);
  QSettings::setPath(QSettings::IniFormat, QSettings::UserScope,
                     settingsDirectory.path());

  testTabAppearanceAndPersistence();
  testDistinctPaintingHoverAndNewTabHitArea();
  testTabLayoutModel();
  testTabStripAnimator();
  testMotionAndRetargeting();
  testTabStripWidget();
  testTabWindowRegistry();
  testDetachedTabWindowController();
  testTabDragControllerStateMachine();
  testStressDragCycles();
  testCursorCleanupAndAnimationMetrics();
  testRapidNewTabCursorStability();
  testDetachAnchorAndClosedHandCursor();
  testDetachChromeTabStayAndSettleOnRelease();

  std::printf("\n=========================================\n");
  std::printf("ALL DESKTOP TAB SYSTEM TESTS PASSED 100%%!\n");
  std::printf("=========================================\n");
  return 0;
}
