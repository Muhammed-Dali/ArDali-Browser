#include "browser_profile_service.h"
#include "settings_page.h"
#include "tab_manager.h"
#include "tab_performance_manager.h"
#include "system_memory_pressure_monitor.h"

#include <QApplication>
#include <QButtonGroup>
#include <QCheckBox>
#include <QFrame>
#include <QLabel>
#include <QLineEdit>
#include <QListWidget>
#include <QPushButton>
#include <QRadioButton>
#include <QSettings>
#include <QTemporaryDir>
#include <QWebEngineProfile>
#include <cassert>

using namespace ardali;

int main(int argc, char **argv) {
  QApplication app(argc, argv);

  // Backup existing settings
  QSettings settings;
  const QVariant origMode = settings.value(QStringLiteral("performance/policyMode"));
  const QVariant origDiscard = settings.value(QStringLiteral("performance/discardEnabled"));
  const QVariant origAllowlist = settings.value(QStringLiteral("performance/siteAllowlist"));

  // Reset to clean test state
  settings.setValue(QStringLiteral("performance/policyMode"), QStringLiteral("balanced"));
  settings.setValue(QStringLiteral("performance/discardEnabled"), true);
  settings.remove(QStringLiteral("performance/siteAllowlist"));

  QTemporaryDir tempDir;
  assert(tempDir.isValid());
  BrowserProfileService profileService(tempDir.path(), nullptr, &app);

  TabManager tabManager;
  auto *perfManager = tabManager.performanceManager();
  assert(perfManager != nullptr);

  SettingsPage::Hooks hooks;
  hooks.searchEngine = [] { return QStringLiteral("Google"); };
  hooks.setSearchEngine = [](const QString &) {};
  hooks.syncNewTabs = [] {};
  hooks.refreshBookmarks = [] {};
  hooks.performanceManager = [&perfManager] { return perfManager; };

  SettingsPage page(&profileService, std::move(hooks));
  page.resize(960, 700);
  page.show();
  page.setCategory(SettingsPage::Category::Performance);
  QApplication::processEvents();

  // --------------------------------------------------------------------------
  // Test 1: Verify Initial Performance Category UI Components
  // --------------------------------------------------------------------------
  auto *modeContainer = page.findChild<QWidget *>(QStringLiteral("settings-mode-container"));
  assert(modeContainer != nullptr);

  auto modeCards = modeContainer->findChildren<QFrame *>(QStringLiteral("settings-mode-card"));
  assert(modeCards.size() == 3);

  auto radioButtons = modeContainer->findChildren<QRadioButton *>();
  assert(radioButtons.size() == 3);

  // Balanced (index 0) must be checked by default
  assert(radioButtons[0]->isChecked());
  assert(!radioButtons[1]->isChecked());
  assert(!radioButtons[2]->isChecked());
  assert(perfManager->policyMode() == PerformancePolicyMode::Balanced);

  // --------------------------------------------------------------------------
  // Test 2: Mode Switching (MemorySaver and MaximumPerformance)
  // --------------------------------------------------------------------------
  // Click MemorySaver (index 1)
  radioButtons[1]->click();
  QApplication::processEvents();
  assert(!radioButtons[0]->isChecked());
  assert(radioButtons[1]->isChecked());
  assert(!radioButtons[2]->isChecked());
  assert(perfManager->policyMode() == PerformancePolicyMode::MemorySaver);
  assert(settings.value(QStringLiteral("performance/policyMode")).toString() == QStringLiteral("memory_saver"));

  // Click MaximumPerformance (index 2)
  radioButtons[2]->click();
  QApplication::processEvents();
  assert(!radioButtons[0]->isChecked());
  assert(!radioButtons[1]->isChecked());
  assert(radioButtons[2]->isChecked());
  assert(perfManager->policyMode() == PerformancePolicyMode::MaximumPerformance);
  assert(settings.value(QStringLiteral("performance/policyMode")).toString() == QStringLiteral("maximum_performance"));

  // Switch back to Balanced
  radioButtons[0]->click();
  QApplication::processEvents();
  assert(radioButtons[0]->isChecked());
  assert(perfManager->policyMode() == PerformancePolicyMode::Balanced);
  assert(settings.value(QStringLiteral("performance/policyMode")).toString() == QStringLiteral("balanced"));

  // --------------------------------------------------------------------------
  // Test 3: Discard Kill-Switch Toggle
  // --------------------------------------------------------------------------
  auto *discardToggle = page.findChild<QCheckBox *>(QStringLiteral("settings-discard-toggle"));
  assert(discardToggle != nullptr);
  assert(discardToggle->isChecked());
  assert(perfManager->isDiscardEnabled());

  // Toggle off
  discardToggle->click();
  QApplication::processEvents();
  assert(!discardToggle->isChecked());
  assert(!perfManager->isDiscardEnabled());
  assert(settings.value(QStringLiteral("performance/discardEnabled")).toBool() == false);

  // Toggle on
  discardToggle->click();
  QApplication::processEvents();
  assert(discardToggle->isChecked());
  assert(perfManager->isDiscardEnabled());
  assert(settings.value(QStringLiteral("performance/discardEnabled")).toBool() == true);

  // --------------------------------------------------------------------------
  // Test 4: Site Exceptions Allowlist Editor
  // --------------------------------------------------------------------------
  auto *siteInput = page.findChild<QLineEdit *>(QStringLiteral("settings-allowlist-input"));
  auto *addBtn = page.findChild<QPushButton *>(QStringLiteral("settings-allowlist-add"));
  auto *siteList = page.findChild<QListWidget *>(QStringLiteral("settings-allowlist-list"));
  auto *statusMsg = page.findChild<QLabel *>(QStringLiteral("settings-allowlist-status"));

  assert(siteInput != nullptr);
  assert(addBtn != nullptr);
  assert(siteList != nullptr);
  assert(statusMsg != nullptr);

  // Initial list is empty (shows 1 placeholder item)
  assert(perfManager->siteAllowlist().isEmpty());

  // 4a. Reject invalid scheme: javascript:
  siteInput->setText(QStringLiteral("javascript:alert(1)"));
  addBtn->click();
  QApplication::processEvents();
  assert(!statusMsg->isHidden() && !statusMsg->text().isEmpty());
  assert(perfManager->siteAllowlist().isEmpty());

  // 4b. Reject invalid scheme: file:
  siteInput->setText(QStringLiteral("file:///etc/passwd"));
  addBtn->click();
  QApplication::processEvents();
  assert(!statusMsg->isHidden() && !statusMsg->text().isEmpty());
  assert(perfManager->siteAllowlist().isEmpty());

  // 4c. Reject invalid credentials URL: user@site.com
  siteInput->setText(QStringLiteral("user@site.com"));
  addBtn->click();
  QApplication::processEvents();
  assert(!statusMsg->isHidden() && !statusMsg->text().isEmpty());
  assert(perfManager->siteAllowlist().isEmpty());

  // 4d. Add valid site: https://youtube.com/watch?v=123 -> normalizes to youtube.com
  siteInput->setText(QStringLiteral("https://youtube.com/watch?v=123"));
  addBtn->click();
  QApplication::processEvents();
  assert(statusMsg->isHidden());
  assert(siteInput->text().isEmpty());
  assert(perfManager->siteAllowlist().contains(QStringLiteral("youtube.com")));
  assert(settings.value(QStringLiteral("performance/siteAllowlist")).toStringList().contains(QStringLiteral("youtube.com")));

  // 4e. Reject duplicate addition
  siteInput->setText(QStringLiteral("https://www.youtube.com"));
  addBtn->click();
  QApplication::processEvents();
  assert(!statusMsg->isHidden() && !statusMsg->text().isEmpty());
  assert(perfManager->siteAllowlist().size() == 1);

  // 4f. Add second site: github.com
  siteInput->setText(QStringLiteral("github.com"));
  addBtn->click();
  QApplication::processEvents();
  assert(statusMsg->isHidden());
  assert(perfManager->siteAllowlist().size() == 2);
  assert(perfManager->siteAllowlist().contains(QStringLiteral("github.com")));

  // 4g. Remove youtube.com via [Kaldır] button
  bool removed = false;
  for (int r = 0; r < siteList->count(); ++r) {
    auto *item = siteList->item(r);
    if (item && item->text() == QStringLiteral("youtube.com")) {
      auto *w = siteList->itemWidget(item);
      assert(w != nullptr);
      auto *removeBtn = w->findChild<QPushButton *>();
      assert(removeBtn != nullptr);
      removeBtn->click();
      QApplication::processEvents();
      removed = true;
      break;
    }
  }
  assert(removed);
  assert(!perfManager->siteAllowlist().contains(QStringLiteral("youtube.com")));
  assert(perfManager->siteAllowlist().contains(QStringLiteral("github.com")));
  assert(perfManager->siteAllowlist().size() == 1);

  // --------------------------------------------------------------------------
  // Test 5: Memory Pressure Dynamic Status
  // --------------------------------------------------------------------------
  auto *statusLabel = page.findChild<QLabel *>(QStringLiteral("settings-memory-status-label"));
  assert(statusLabel != nullptr);

  // Normal
  perfManager->memoryPressureMonitor()->setSimulatedPressureLevel(MemoryPressureLevel::Normal);
  QApplication::processEvents();
  assert(statusLabel->text() == QStringLiteral("Bellek kullanımı normal"));

  // Moderate
  perfManager->memoryPressureMonitor()->setSimulatedPressureLevel(MemoryPressureLevel::Moderate);
  QApplication::processEvents();
  assert(statusLabel->text() == QStringLiteral("Bellek kullanımı yüksek"));

  // Critical
  perfManager->memoryPressureMonitor()->setSimulatedPressureLevel(MemoryPressureLevel::Critical);
  QApplication::processEvents();
  assert(statusLabel->text() == QStringLiteral("Bellek kullanımı çok yüksek"));

  // --------------------------------------------------------------------------
  // Test 6: Reset Performance Preferences
  // --------------------------------------------------------------------------
  page.setCategory(SettingsPage::Category::Reset);
  QApplication::processEvents();

  auto *resetPerfCard = page.findChild<QWidget *>(QStringLiteral("settings-section"));
  assert(resetPerfCard != nullptr);

  // Find the Reset Performance button
  QPushButton *resetPerfBtn = nullptr;
  for (auto *btn : page.findChildren<QPushButton *>()) {
    if (btn->text().contains(QStringLiteral("Performans ayarlarını sıfırla"))) {
      resetPerfBtn = btn;
      break;
    }
  }
  assert(resetPerfBtn != nullptr);

  // Change settings before reset
  perfManager->setPolicyMode(PerformancePolicyMode::MemorySaver);
  perfManager->setDiscardEnabled(false);
  assert(perfManager->policyMode() == PerformancePolicyMode::MemorySaver);
  assert(!perfManager->isDiscardEnabled());

  // Click reset
  resetPerfBtn->click();
  QApplication::processEvents();

  assert(perfManager->policyMode() == PerformancePolicyMode::Balanced);
  assert(perfManager->isDiscardEnabled());
  assert(perfManager->siteAllowlist().isEmpty());

  // --------------------------------------------------------------------------
  // Test 7: Zero Forbidden Technical Terms in UI
  // --------------------------------------------------------------------------
  page.setCategory(SettingsPage::Category::Performance);
  QApplication::processEvents();

  const QStringList forbiddenTerms = {
    QStringLiteral("Frozen"),
    QStringLiteral("Discarded"),
    QStringLiteral("LifecycleState"),
    QStringLiteral("recommendedState"),
    QStringLiteral("renderer process"),
    QStringLiteral("memory pressure"),
    QStringLiteral("QWebEnginePage"),
    QStringLiteral("RSS"),
    QStringLiteral("PSS")
  };

  for (const auto *lbl : page.findChildren<QLabel *>()) {
    for (const auto &term : forbiddenTerms) {
      assert(!lbl->text().contains(term, Qt::CaseInsensitive));
    }
  }

  // Restore original settings
  if (origMode.isValid()) settings.setValue(QStringLiteral("performance/policyMode"), origMode);
  else settings.remove(QStringLiteral("performance/policyMode"));
  if (origDiscard.isValid()) settings.setValue(QStringLiteral("performance/discardEnabled"), origDiscard);
  else settings.remove(QStringLiteral("performance/discardEnabled"));
  if (origAllowlist.isValid()) settings.setValue(QStringLiteral("performance/siteAllowlist"), origAllowlist);
  else settings.remove(QStringLiteral("performance/siteAllowlist"));

  return 0;
}
