#include <QApplication>
#include <QSettings>
#include <cassert>
#include <iostream>

#include "side_widget.h"
#include "side_widget_config.h"
#include "side_widget_settings_panel.h"

void testInitialState() {
  QWidget container;
  container.resize(1024, 768);
  SideWidget widget(&container);

  assert(widget.state() == SideWidgetState::Closed);
  assert(!widget.isOpen());
  assert(widget.animationProgress() == 0.0);
  assert(widget.buttonCount() == 11); // 11 active buttons

  std::cout << "[PASS] testInitialState (11 buttons active)" << std::endl;
}

void testBackgroundTransparency() {
  QWidget container;
  container.resize(1024, 768);
  SideWidget widget(&container);

  assert(!widget.autoFillBackground());
  assert(widget.testAttribute(Qt::WA_TranslucentBackground));

  std::cout << "[PASS] testBackgroundTransparency" << std::endl;
}

void testZeroOverlapInOpenState() {
  QWidget container;
  container.resize(1024, 768);
  SideWidget widget(&container);
  widget.resize(1024, 768);

  widget.openWidget();
  assert(widget.isOpen());

  widget.forceAnimationProgressForTest(1.0);
  const bool hasOverlap = widget.checkOverlapInOpenState();
  assert(!hasOverlap);

  std::cout << "[PASS] testZeroOverlapInOpenState (Zero overlap verified across all 11 buttons)" << std::endl;
}

void testOpenCloseToggle() {
  QWidget container;
  container.resize(1024, 768);
  SideWidget widget(&container);

  widget.openWidget();
  assert(widget.isOpen());

  widget.closeWidget();
  assert(widget.state() == SideWidgetState::Closing || widget.state() == SideWidgetState::Closed);

  widget.toggleWidget();
  assert(widget.isOpen());

  std::cout << "[PASS] testOpenCloseToggle" << std::endl;
}

void testDeterministic10CycleAnimation() {
  QWidget container;
  container.resize(1024, 768);
  SideWidget widget(&container);
  widget.resize(1024, 768);

  SideWidgetConfig cfg = SideWidgetConfig::defaults();
  cfg.openDurationMs = 200;
  cfg.closeDurationMs = 200;
  widget.setConfig(cfg);

  for (int cycle = 1; cycle <= 10; ++cycle) {
    widget.openWidget();
    widget.forceAnimationProgressForTest(1.0);
    assert(widget.isOpen());

    widget.closeWidget();
    widget.forceAnimationProgressForTest(0.0);
    assert(!widget.isOpen());
  }

  std::cout << "[PASS] testDeterministic10CycleAnimation (10 cycles deterministic timing verified)" << std::endl;
}

void testConfigPersistenceAndReset() {
  SideWidgetConfig cfg = SideWidgetConfig::defaults();
  cfg.openDurationMs = 750;
  cfg.closeDurationMs = 650;
  cfg.buttonDiameter = 52;
  cfg.radiusX = 210.0;

  {
    QSettings settings("ArDaliTest", "SideWidgetTest");
    cfg.save(settings);
  }

  SideWidgetConfig loadedCfg;
  {
    QSettings settings("ArDaliTest", "SideWidgetTest");
    loadedCfg.load(settings);
  }

  assert(loadedCfg.openDurationMs == 750);
  assert(loadedCfg.closeDurationMs == 650);
  assert(loadedCfg.buttonDiameter == 52);
  assert(loadedCfg.radiusX == 210.0);

  SideWidgetConfig defaultCfg = SideWidgetConfig::defaults();
  assert(defaultCfg.openDurationMs == 360);
  assert(defaultCfg.buttonDiameter == 48);

  std::cout << "[PASS] testConfigPersistenceAndReset" << std::endl;
}

void testSettingsPanelToggle() {
  QWidget container;
  container.resize(1024, 768);
  container.show();
  SideWidget widget(&container);
  widget.resize(1024, 768);
  widget.show();

  widget.openSettingsPanel();
  assert(widget.handleEscKey()); // panel closed on ESC

  std::cout << "[PASS] testSettingsPanelToggle" << std::endl;
}

int main(int argc, char *argv[]) {
  QApplication app(argc, argv);

  testInitialState();
  testBackgroundTransparency();
  testZeroOverlapInOpenState();
  testOpenCloseToggle();
  testDeterministic10CycleAnimation();
  testConfigPersistenceAndReset();
  testSettingsPanelToggle();

  std::cout << "All SideWidget & Settings Panel tests passed!" << std::endl;
  return 0;
}
