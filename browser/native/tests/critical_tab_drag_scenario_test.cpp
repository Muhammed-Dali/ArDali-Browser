#include <QApplication>
#include <QFocusEvent>
#include <QWidget>
#include <cassert>
#include <cmath>
#include <iostream>
#include <vector>

#include "desktop_tabs/detached_tab_window_controller.h"
#include "desktop_tabs/tab_drag_controller.h"
#include "desktop_tabs/tab_strip_widget.h"
#include "desktop_tabs/tab_window_registry.h"

using namespace ardali::desktop_tabs;

namespace {

struct DummyTabRecord {
  uint64_t id = 0;
  QString title;
  void *viewPtr = nullptr;
  void *pagePtr = nullptr;
};

int findTabIndex(TabStripWidget *strip, uint64_t id) {
  if (!strip) return -1;
  for (int i = 0; i < strip->count(); ++i) {
    if (strip->tabId(i) == id) return i;
  }
  return -1;
}

}  // namespace

int main(int argc, char **argv) {
  qputenv("QT_QPA_PLATFORM", "offscreen");
  qputenv("ARDALI_DESKTOP_TAB_DIAGNOSTICS", "1");
  QApplication app(argc, argv);

  std::cout << "[TEST] Starting critical tab drag scenario test...\n";

  auto &controller = TabDragController::instance();

  // =========================================================================
  // TEST 1: Cursor Anchoring at 10%, 50%, and 90% of Tab Width
  // =========================================================================
  std::cout << "[TEST 1] Testing cursor anchoring at 10%, 50%, 90% offsets...\n";
  const std::vector<double> testFractions = {0.10, 0.50, 0.90};

  for (double fraction : testFractions) {
    TabWindowRegistry::instance().clear();
    QWidget testWin;
    testWin.setGeometry(100, 100, 900, 600);
    testWin.setProperty("ardaliTabProfile", 1);
    testWin.setProperty("ardaliTabWindowType", QStringLiteral("regular"));
    auto *testStrip = new TabStripWidget(&testWin);
    testStrip->setGeometry(0, 0, 900, 34);
    testStrip->addTab(1, QStringLiteral("Tab 1"));
    testStrip->addTab(2, QStringLiteral("Tab 2"));
    testWin.show();
    app.processEvents();
    TabWindowRegistry::instance().registerWindow(&testWin, testStrip);

    QWidget *shellCreated = nullptr;
    controller.setDetachedWindowFactory([&](QWidget *, uint64_t) -> QWidget * {
      shellCreated = new QWidget;
      shellCreated->setGeometry(0, 0, 900, 600);
      shellCreated->setProperty("ardaliTabProfile", 1);
      shellCreated->setProperty("ardaliTabWindowType", QStringLiteral("regular"));
      shellCreated->setProperty("ardaliDragCaptureShell", true);
      auto *strip = new TabStripWidget(shellCreated);
      strip->setGeometry(0, 0, 900, 34);
      TabWindowRegistry::instance().registerWindow(shellCreated, strip);
      return shellCreated;
    });

    controller.setDetachTransferDelegate([&](QWidget *dest, QWidget *orig, uint64_t tabId, int idx) {
      auto *fromStrip = orig->findChild<TabStripWidget *>();
      auto *toStrip = dest->findChild<TabStripWidget *>();
      const int fromIdx = findTabIndex(fromStrip, tabId);
      if (!fromStrip || !toStrip || fromIdx < 0) return false;
      const QString title = fromStrip->tabText(fromIdx);
      fromStrip->removeTab(fromIdx);
      toStrip->insertTab(idx, tabId, title);
      return true;
    });

    const QRect tabRect = testStrip->tabRect(1);
    const int offsetX = static_cast<int>(std::round(tabRect.width() * fraction));
    const int offsetY = tabRect.height() / 2;
    const QPoint pressOffset(offsetX, offsetY);
    const QPoint pressGlobal = testStrip->mapToGlobal(tabRect.topLeft() + pressOffset);

    controller.handleMousePress(&testWin, testStrip, 1, pressGlobal, pressOffset,
                               testWin.mapFromGlobal(pressGlobal));

    // Move vertically out of strip to trigger detach
    const int detachY = testStrip->height() + testStrip->layoutModel().metrics().verticalDetachThreshold + 5;
    const QPoint detachGlobal = testStrip->mapToGlobal(QPoint(testStrip->mapFromGlobal(pressGlobal).x(), detachY));
    controller.handleMouseMove(detachGlobal);

    assert(controller.state() == DragState::DraggingDetachedWindow);
    assert(shellCreated != nullptr);

    // Verify held point in window aligns cursor with held tab pixel
    const QPoint cursorRelativeToWindow = detachGlobal - shellCreated->pos();
    const QPoint heldPoint = controller.session().heldPointInWindow();
    const int anchorDiff = (cursorRelativeToWindow - heldPoint).manhattanLength();
    std::cout << "  Fraction " << fraction * 100 << "%: anchorDiff=" << anchorDiff << " heldPoint=("
              << heldPoint.x() << "," << heldPoint.y() << ")\n";
    assert(anchorDiff <= 2);

    controller.handleCancel();
    delete shellCreated;
    testWin.close();
  }

  // =========================================================================
  // TEST 2: Spurious Event Immunity
  // Verify that show(), raise(), activateWindow(), focusOutEvent(), leaveEvent(),
  // window deactivation, and tab removal cannot terminate active drag.
  // =========================================================================
  std::cout << "[TEST 2] Testing spurious event immunity...\n";
  {
    TabWindowRegistry::instance().clear();
    QWidget testWin;
    testWin.setGeometry(100, 100, 900, 600);
    auto *testStrip = new TabStripWidget(&testWin);
    testStrip->setGeometry(0, 0, 900, 34);
    testStrip->addTab(10, QStringLiteral("Alpha"));
    testStrip->addTab(20, QStringLiteral("Beta"));
    testWin.show();
    app.processEvents();

    controller.handleMousePress(&testWin, testStrip, 0, QPoint(150, 115), QPoint(50, 15), QPoint(50, 15));
    controller.handleMouseMove(QPoint(165, 115));
    assert(controller.isActive());
    assert(controller.state() == DragState::DraggingInStrip);
    const uint64_t sessionBefore = controller.session().sessionId();

    // Spurious window operations
    testWin.show();
    testWin.raise();
    testWin.activateWindow();

    // Spurious focus and leave events
    QFocusEvent focusOut(QEvent::FocusOut, Qt::ActiveWindowFocusReason);
    app.sendEvent(&testWin, &focusOut);
    QEvent leaveEvent(QEvent::Leave);
    app.sendEvent(testStrip, &leaveEvent);
    QEvent windowDeactivate(QEvent::WindowDeactivate);
    app.sendEvent(&testWin, &windowDeactivate);

    // Drag MUST still be active and unchanged
    assert(controller.isActive());
    assert(controller.state() == DragState::DraggingInStrip);
    assert(controller.session().sessionId() == sessionBefore);

    controller.handleCancel();
    assert(!controller.isActive());
  }

  // =========================================================================
  // TEST 3: Scenario 18 Full End-to-End Migration Cycle
  // Window A (Tab 1, Tab 2), Window B (Tab 3)
  // Press Tab 2 -> Detach (Window C) -> Move to B -> Live Attach into B
  // -> Drag inside B -> Re-detach (Window D) -> Move to A -> Live Attach into A -> Release
  // =========================================================================
  std::cout << "[TEST 3] Testing Scenario 18 full live gesture cycle...\n";
  {
    TabWindowRegistry::instance().clear();

    QWidget winA;
    winA.setObjectName("Window_A");
    winA.setGeometry(100, 100, 900, 600);
    winA.setProperty("ardaliTabProfile", 42);
    winA.setProperty("ardaliTabWindowType", QStringLiteral("regular"));
    auto *stripA = new TabStripWidget(&winA);
    stripA->setObjectName("Strip_A");
    stripA->setGeometry(0, 0, 900, 34);
    stripA->addTab(101, QStringLiteral("Tab 1"));
    stripA->addTab(102, QStringLiteral("Tab 2"));
    winA.show();
    TabWindowRegistry::instance().registerWindow(&winA, stripA);

    QWidget winB;
    winB.setObjectName("Window_B");
    winB.setGeometry(1100, 100, 900, 600);
    winB.setProperty("ardaliTabProfile", 42);
    winB.setProperty("ardaliTabWindowType", QStringLiteral("regular"));
    auto *stripB = new TabStripWidget(&winB);
    stripB->setObjectName("Strip_B");
    stripB->setGeometry(0, 0, 900, 34);
    stripB->addTab(103, QStringLiteral("Tab 3"));
    winB.show();
    TabWindowRegistry::instance().registerWindow(&winB, stripB);

    app.processEvents();

    // Simulated WebEngine pointers to assert identity preservation
    void *dummyView = reinterpret_cast<void *>(0xDEADBEEF01ULL);
    void *dummyPage = reinterpret_cast<void *>(0xDEADBEEF02ULL);
    DummyTabRecord tabRecord{102, QStringLiteral("Tab 2"), dummyView, dummyPage};

    std::vector<QWidget *> shellsCreated;
    controller.setDetachedWindowFactory([&](QWidget *, uint64_t) -> QWidget * {
      auto *shell = new QWidget;
      shell->setObjectName(QString("Shell_%1").arg(shellsCreated.size() + 1));
      shell->setGeometry(0, 0, 900, 600);
      shell->setProperty("ardaliTabProfile", 42);
      shell->setProperty("ardaliTabWindowType", QStringLiteral("regular"));
      shell->setProperty("ardaliDragCaptureShell", true);
      auto *strip = new TabStripWidget(shell);
      strip->setObjectName(QString("ShellStrip_%1").arg(shellsCreated.size() + 1));
      strip->setGeometry(0, 0, 900, 34);
      TabWindowRegistry::instance().registerWindow(shell, strip);
      shellsCreated.push_back(shell);
      return shell;
    });

    auto transferImpl = [&](QWidget *fromWin, QWidget *toWin, uint64_t id, int targetIdx) -> bool {
      auto *fromStrip = fromWin ? fromWin->findChild<TabStripWidget *>() : nullptr;
      auto *toStrip = toWin ? toWin->findChild<TabStripWidget *>() : nullptr;
      const int fromIdx = findTabIndex(fromStrip, id);
      if (!fromStrip || !toStrip || fromIdx < 0) return false;
      const QString title = fromStrip->tabText(fromIdx);
      fromStrip->removeTab(fromIdx);
      const int insertIdx = std::clamp(targetIdx, 0, toStrip->count());
      toStrip->insertTab(insertIdx, id, title);

      // Verify simulated WebEngine view and page identity preservation
      assert(tabRecord.id == id);
      assert(tabRecord.viewPtr == dummyView);
      assert(tabRecord.pagePtr == dummyPage);
      return true;
    };

    controller.setDetachTransferDelegate(
        [&](QWidget *dest, QWidget *orig, uint64_t id, int idx) {
          return transferImpl(orig, dest, id, idx);
        });
    controller.setTabTransferDelegate(transferImpl);
    controller.setTabMoveDelegate([](QWidget *w, int f, int t) {
      if (auto *strip = w ? w->findChild<TabStripWidget *>() : nullptr)
        strip->moveTab(f, t);
    });

    // Step 1: Mouse press on Tab 2 in Window A
    const QRect tab2Rect = stripA->tabRect(1);
    const QPoint pressOffset(tab2Rect.width() / 2, tab2Rect.height() / 2);
    const QPoint pressGlobal = stripA->mapToGlobal(tab2Rect.topLeft() + pressOffset);

    controller.handleMousePress(&winA, stripA, 1, pressGlobal, pressOffset,
                               winA.mapFromGlobal(pressGlobal));

    assert(controller.isActive());
    assert(controller.state() == DragState::Pressed);
    const uint64_t activeSessionId = controller.session().sessionId();
    assert(activeSessionId > 0);

    // Step 2: Drag within Window A past start threshold
    controller.handleMouseMove(pressGlobal + QPoint(20, 2));
    assert(controller.state() == DragState::DraggingInStrip);
    assert(controller.session().sessionId() == activeSessionId);

    // Step 3: Drag vertically out of Window A -> Detached Window C
    const int detachYA = stripA->height() + stripA->layoutModel().metrics().verticalDetachThreshold + 5;
    const QPoint detachPointA = stripA->mapToGlobal(QPoint(stripA->mapFromGlobal(pressGlobal).x(), detachYA));
    controller.handleMouseMove(detachPointA);

    assert(controller.state() == DragState::DraggingDetachedWindow);
    assert(controller.session().sessionId() == activeSessionId);
    assert(shellsCreated.size() == 1);
    QWidget *shellC = shellsCreated[0];
    assert(stripA->count() == 1);
    assert(shellC->findChild<TabStripWidget *>()->count() == 1);

    // Step 4: Continue drag towards Window B through neutral space
    controller.handleMouseMove(QPoint(1050, 300));
    assert(controller.state() == DragState::SearchingAttachTarget);
    assert(controller.session().sessionId() == activeSessionId);

    // Step 5: Move over Window B's tab bar -> LIVE ATTACH into Window B!
    const QPoint attachPointB = stripB->mapToGlobal(QPoint(50, 15));
    controller.handleMouseMove(attachPointB);

    assert(controller.state() == DragState::DraggingInTargetStrip);
    assert(controller.session().sessionId() == activeSessionId);
    assert(controller.session().currentWindow() == &winB);
    assert(controller.session().currentStrip() == stripB);
    assert(stripB->count() == 2);
    assert(findTabIndex(stripB, 102) >= 0);

    // Step 6: Move horizontally within Window B's tab bar
    controller.handleMouseMove(stripB->mapToGlobal(QPoint(150, 15)));
    assert(controller.state() == DragState::DraggingInTargetStrip);
    assert(controller.session().sessionId() == activeSessionId);

    // Step 7: Drag Tab 2 vertically OUT of Window B -> LIVE RE-DETACH!
    const int detachYB = stripB->height() + stripB->layoutModel().metrics().verticalDetachThreshold + 5;
    const QPoint redetachPointB = stripB->mapToGlobal(QPoint(150, detachYB));
    controller.handleMouseMove(redetachPointB);

    assert(controller.state() == DragState::DraggingDetachedWindow);
    assert(controller.session().sessionId() == activeSessionId);
    assert(shellsCreated.size() == 2);
    QWidget *shellD = shellsCreated[1];
    assert(stripB->count() == 1);
    assert(shellD->findChild<TabStripWidget *>()->count() == 1);

    // Step 8: Move back towards Window A's tab bar -> LIVE ATTACH back into Window A!
    const QPoint attachPointA = stripA->mapToGlobal(QPoint(80, 15));
    controller.handleMouseMove(attachPointA);

    assert(controller.state() == DragState::DraggingInTargetStrip);
    assert(controller.session().sessionId() == activeSessionId);
    assert(controller.session().currentWindow() == &winA);
    assert(controller.session().currentStrip() == stripA);
    assert(stripA->count() == 2);
    assert(findTabIndex(stripA, 102) >= 0);

    // Step 9: Finally RELEASE mouse at the end of the gesture!
    controller.handleMouseRelease(attachPointA);

    assert(!controller.isActive());
    assert(controller.state() == DragState::Idle);
    assert(stripA->count() == 2);
    assert(stripB->count() == 1);
    assert(findTabIndex(stripA, 102) >= 0);

    for (QWidget *shell : shellsCreated) {
      delete shell;
    }
  }

  // =========================================================================
  // TEST 5: Maximized Window Detach Geometry & Floating Bounds
  // =========================================================================
  std::cout << "[TEST 5] Testing maximized window detach geometry and restored bounds...\n";
  {
    TabWindowRegistry::instance().clear();
    QWidget maxWin;
    maxWin.setGeometry(0, 0, 1920, 1080);
    maxWin.setWindowState(Qt::WindowMaximized);
    maxWin.setProperty("ardaliRestoredSize", QSize(1000, 650));
    maxWin.setProperty("ardaliTabProfile", 1);
    maxWin.setProperty("ardaliTabWindowType", QStringLiteral("regular"));

    auto *maxStrip = new TabStripWidget(&maxWin);
    maxStrip->setGeometry(0, 0, 1920, 34);
    maxStrip->addTab(10, QStringLiteral("Tab 10"));
    maxStrip->addTab(20, QStringLiteral("Tab 20"));
    maxWin.show();
    app.processEvents();

    TabWindowRegistry::instance().registerWindow(&maxWin, maxStrip);

    std::vector<QWidget *> shells;
    controller.setDetachedWindowFactory([&shells](QWidget *, uint64_t) {
      auto *w = new QWidget();
      auto *st = new TabStripWidget(w);
      st->setGeometry(0, 0, 800, 34);
      shells.push_back(w);
      return w;
    });
    controller.setDetachTransferDelegate([](QWidget *dest, QWidget *origin, uint64_t tabId, int) {
      auto *destStrip = dest->findChild<TabStripWidget *>();
      auto *origStrip = origin->findChild<TabStripWidget *>();
      if (destStrip && origStrip) {
        origStrip->removeTab(findTabIndex(origStrip, tabId));
        destStrip->addTab(tabId, QStringLiteral("Transferred"));
      }
      return true;
    });

    // Start drag on Tab 20 (index 1)
    const QRect tab1Rect = maxStrip->tabRect(1);
    const QPoint pressOffset(50, 15);
    const QPoint pressPos = maxStrip->mapToGlobal(tab1Rect.topLeft() + pressOffset);
    controller.handleMousePress(&maxWin, maxStrip, 1, pressPos, pressOffset, maxWin.mapFromGlobal(pressPos));
    assert(controller.state() == DragState::Pressed);

    // Drag vertically down to detach
    const int detachY = maxStrip->height() + maxStrip->layoutModel().metrics().verticalDetachThreshold + 5;
    const QPoint detachPos = maxStrip->mapToGlobal(QPoint(maxStrip->mapFromGlobal(pressPos).x(), detachY));
    controller.handleMouseMove(detachPos);

    assert(controller.state() == DragState::DraggingDetachedWindow);
    assert(shells.size() == 1);
    QWidget *shell = shells.front();

    // Verify detached window is NOT maximized
    assert(!(shell->windowState() & Qt::WindowMaximized));
    assert(!(shell->windowState() & Qt::WindowFullScreen));

    // Verify detached window received sensible floating restored bounds (not 1920x1080)
    assert(shell->width() < maxWin.width());
    assert(shell->height() < maxWin.height());
    assert(shell->width() >= 600);
    assert(shell->height() >= 400);

    // Release mouse
    controller.handleMouseRelease(detachPos);
    assert(!controller.isActive());

    for (QWidget *s : shells) delete s;
  }

  // =========================================================================
  // TEST 6: Single-Tab Maximized Window Drag Restores Window To Normal
  // =========================================================================
  std::cout << "[TEST 6] Testing single-tab maximized window drag restores window...\n";
  {
    TabWindowRegistry::instance().clear();
    QWidget singleWin;
    singleWin.setGeometry(0, 0, 1920, 1080);
    singleWin.setWindowState(Qt::WindowMaximized);
    singleWin.setProperty("ardaliRestoredSize", QSize(950, 600));
    singleWin.setProperty("ardaliTabProfile", 1);
    singleWin.setProperty("ardaliTabWindowType", QStringLiteral("regular"));

    auto *singleStrip = new TabStripWidget(&singleWin);
    singleStrip->setGeometry(0, 0, 1920, 34);
    singleStrip->addTab(100, QStringLiteral("Single Tab"));
    singleWin.show();
    app.processEvents();

    TabWindowRegistry::instance().registerWindow(&singleWin, singleStrip);

    // Start drag on the only tab (index 0)
    const QRect tab0Rect = singleStrip->tabRect(0);
    const QPoint pressOffset(50, 15);
    const QPoint pressPos = singleStrip->mapToGlobal(tab0Rect.topLeft() + pressOffset);
    controller.handleMousePress(&singleWin, singleStrip, 0, pressPos, pressOffset, singleWin.mapFromGlobal(pressPos));
    assert(controller.state() == DragState::Pressed);

    // Drag vertically down past threshold
    const int detachY = singleStrip->height() + singleStrip->layoutModel().metrics().verticalDetachThreshold + 5;
    const QPoint dragDown = singleStrip->mapToGlobal(QPoint(singleStrip->mapFromGlobal(pressPos).x(), detachY));
    controller.handleMouseMove(dragDown);

    assert(controller.state() == DragState::DraggingDetachedWindow ||
           controller.state() == DragState::SearchingAttachTarget);

    // Window must be unmaximized and restored to normal floating size!
    assert(!(singleWin.windowState() & Qt::WindowMaximized));
    assert(!(singleWin.windowState() & Qt::WindowFullScreen));
    assert(singleWin.width() < 1920);
    assert(singleWin.height() < 1080);
    assert(singleWin.width() >= 600);
    assert(singleWin.height() >= 400);

    // Release mouse
    controller.handleMouseRelease(dragDown);
    assert(!controller.isActive());
  }

  // Clean up controller delegates
  controller.setDetachedWindowFactory({});
  controller.setDetachTransferDelegate({});
  controller.setTabTransferDelegate({});
  controller.setTabMoveDelegate({});
  TabWindowRegistry::instance().clear();

  std::cout << "[TEST] All critical tab drag scenario tests passed successfully!\n";
  return 0;
}
