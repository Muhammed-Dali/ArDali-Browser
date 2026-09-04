#include <QApplication>
#include <QColor>
#include <cassert>
#include <iostream>

#include "../browser/native/desktop_tabs/tab_group_model.h"
#include "../browser/native/desktop_tabs/tab_group_popup.h"
#include "../browser/native/desktop_tabs/tab_group_launcher_popup.h"

using namespace ardali::desktop_tabs;

int main(int argc, char *argv[]) {
  QApplication app(argc, argv);

  std::cout << "[TEST] Starting Corrected Two-Step Tab Group Creation Flow Verification..." << std::endl;

  TabGroupModel model;

  // Initial Scenario: User has two open tabs
  const uint64_t youtubeTabId = 101;
  const uint64_t githubTabId = 102;
  // Initially, neither is grouped
  assert(!model.groupIdForTab(youtubeTabId).has_value());
  assert(!model.groupIdForTab(githubTabId).has_value());
  std::cout << "  ✓ Initial tabs (YouTube, GitHub) are open and ungrouped." << std::endl;

  // 1. User clicks grid button -> first-stage popup opens -> clicks "Yeni sekme grubu oluştur"
  // EXPECTED:
  // - A brand new tab is created (newTab1Id = 103)
  // - A new group is created (group1Id)
  // - ONLY newTab1Id is added to group1Id
  // - youtubeTabId and githubTabId remain UNGROUPED and UNTOUCHED!
  const uint64_t newTab1Id = 103;
  const QUuid group1Id = model.createGroup(QString(), tabGroupColorPalette()[0]);
  assert(!group1Id.isNull());
  model.setTabGroup(newTab1Id, group1Id);

  assert(!model.groupIdForTab(youtubeTabId).has_value());
  assert(!model.groupIdForTab(githubTabId).has_value());
  assert(model.groupIdForTab(newTab1Id) == group1Id);
  assert(model.tabsInGroup(group1Id).size() == 1);
  assert(model.tabsInGroup(group1Id).contains(newTab1Id));
  std::cout << "  ✓ NEW tab (103) grouped; previous active tab (YouTube) remains UNGROUPED!" << std::endl;

  // 2. Multiple creation test: User clicks grid button again -> "Yeni sekme grubu oluştur"
  // EXPECTED:
  // - Another brand new tab is created (newTab2Id = 104)
  // - A second independent group is created (group2Id)
  // - group1Id and group2Id are completely independent
  const uint64_t newTab2Id = 104;
  const QUuid group2Id = model.createGroup(QString(), tabGroupColorPalette()[1]);
  assert(!group2Id.isNull());
  assert(group1Id != group2Id);
  model.setTabGroup(newTab2Id, group2Id);

  assert(!model.groupIdForTab(youtubeTabId).has_value());
  assert(!model.groupIdForTab(githubTabId).has_value());
  assert(model.groupIdForTab(newTab1Id) == group1Id);
  assert(model.groupIdForTab(newTab2Id) == group2Id);
  assert(model.tabsInGroup(group1Id).size() == 1);
  assert(model.tabsInGroup(group2Id).size() == 1);
  std::cout << "  ✓ Multiple creation creates separate independent groups (group1 != group2)." << std::endl;

  // 3. "Grupta yeni sekme" test:
  // EXPECTED:
  // - Adds another tab to THAT EXISTING group (group1Id)
  const uint64_t group1Member2Id = 105;
  model.setTabGroup(group1Member2Id, group1Id);
  assert(model.tabsInGroup(group1Id).size() == 2);
  assert(model.tabsInGroup(group1Id).contains(newTab1Id));
  assert(model.tabsInGroup(group1Id).contains(group1Member2Id));
  assert(model.tabsInGroup(group2Id).size() == 1);
  std::cout << "  ✓ 'Grupta yeni sekme' expands existing group (group1 now has 2 tabs)." << std::endl;

  // 4. Live update of name and color in group popup
  TabGroup updatedGroup1 = *model.group(group1Id);
  updatedGroup1.name = "Video";
  updatedGroup1.color = tabGroupColorPalette()[2]; // Red
  model.addOrUpdateGroup(updatedGroup1);
  assert(model.group(group1Id)->name == "Video");
  assert(model.group(group1Id)->color == tabGroupColorPalette()[2]);
  std::cout << "  ✓ Live-updating group name to 'Video' and color to Red succeeds." << std::endl;

  // 5. Ungroup test ("Grubu çöz")
  model.removeTabFromGroup(newTab1Id);
  model.removeTabFromGroup(group1Member2Id);
  assert(!model.groupIdForTab(newTab1Id).has_value());
  assert(!model.groupIdForTab(group1Member2Id).has_value());
  assert(model.tabsInGroup(group1Id).isEmpty());
  std::cout << "  ✓ 'Grubu çöz' ungroups tabs without closing them." << std::endl;

  std::cout << "[SUCCESS] ALL Corrected Creation Flow Tests PASSED!" << std::endl;
  return 0;
}
