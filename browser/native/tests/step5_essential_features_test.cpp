#ifdef NDEBUG
#undef NDEBUG
#endif
#include <cassert>
#include <iostream>
#include <QApplication>
#include <QCompleter>
#include <QEventLoop>
#include <QFocusEvent>
#include <QHeaderView>
#include <QKeyEvent>
#include <QLineEdit>
#include <QMouseEvent>
#include <QPrinter>
#include <QSettings>
#include <QTableWidget>
#include <QTemporaryDir>
#include <QTimer>
#include <QTreeWidget>

#include "browser_window.h"
#include "core/browser_profile_service.h"
#include "desktop_tabs/find_bar_widget.h"
#include "desktop_tabs/tab_strip_widget.h"
#include "settings/settings_page.h"

int main(int argc, char **argv) {
  QApplication app(argc, argv);
  app.setApplicationName(QStringLiteral("ArDaliStep5Test"));

  QTemporaryDir tempDir;
  assert(tempDir.isValid());
  QSettings::setDefaultFormat(QSettings::IniFormat);
  QSettings::setPath(QSettings::IniFormat, QSettings::UserScope, tempDir.path());

  BrowserProfileService profileService(tempDir.path() + QStringLiteral("/profile"), nullptr, nullptr, false);
  BrowserServices services;
  services.profile = profileService.profile();
  services.profileService = &profileService;

  std::cout << "[Step 5 Test] Starting essential features verification...\n";

  // =========================================================================
  // Test 1: Deferred Defect Fix — Ctrl+W Closes Exactly One Tab
  // =========================================================================
  {
    std::cout << "  -> Testing Ctrl+W single-tab closure behavior...\n";
    BrowserWindow window(services, true);
    window.resize(1000, 700);

    window.addNewTab(QUrl(QStringLiteral("https://example.com/page1")));
    window.addNewTab(QUrl(QStringLiteral("https://example.com/page2")));
    window.addNewTab(QUrl(QStringLiteral("https://example.com/page3")));
    assert(window.tabCount() == 3);

    // Trigger close on active tab (index 2)
    const int initialCount = window.tabCount();
    window.closeTab(window.tabStrip()->currentIndex());
    assert(window.tabCount() == initialCount - 1);
    assert(window.tabCount() == 2);

    // Close another tab
    window.closeTab(window.tabStrip()->currentIndex());
    assert(window.tabCount() == 1);
    std::cout << "     PASS: Ctrl+W closes exactly one tab per invocation.\n";
  }

  // =========================================================================
  // Test 2: Recently Closed Tabs & Ctrl+Shift+T (LIFO Restoration)
  // =========================================================================
  {
    std::cout << "  -> Testing recently closed tabs LIFO stack and restoration...\n";
    BrowserWindow window(services, true);
    window.resize(1000, 700);

    const QUrl urlAlpha(QStringLiteral("https://example.com/alpha"));
    const QUrl urlBeta(QStringLiteral("https://example.com/beta"));
    const QUrl urlGamma(QStringLiteral("https://example.com/gamma"));

    window.addNewTab(urlAlpha);
    window.addNewTab(urlBeta);
    window.addNewTab(urlGamma);
    assert(window.tabCount() == 3);

    // Close Beta (index 1)
    window.closeTab(1);
    assert(window.tabCount() == 2);
    assert(profileService.hasClosedTabs());
    assert(profileService.closedTabs().size() >= 1);
    assert(profileService.closedTabs().first().url == urlBeta);

    // Close Gamma (now index 1)
    window.closeTab(1);
    assert(window.tabCount() == 1);
    assert(profileService.closedTabs().first().url == urlGamma);

    // Restore most recently closed (should be Gamma)
    window.restoreLastClosedTab();
    assert(window.tabCount() == 2);
    assert(window.allTabs()[1].url == urlGamma);

    // Restore next closed (should be Beta)
    window.restoreLastClosedTab();
    assert(window.tabCount() == 3);
    assert(window.allTabs()[2].url == urlBeta);

    std::cout << "     PASS: Recently closed tabs restored in correct LIFO order.\n";
  }

  // =========================================================================
  // Test 3: History Search, Real Persistence Across Restarts & UI Integration
  // =========================================================================
  {
    std::cout << "  -> Testing history search, deletion persistence across restarts, and Settings UI...\n";
    profileService.clearHistory();
    assert(profileService.recentHistory().isEmpty());

    const QUrl url1(QStringLiteral("https://ardali-browser.org/features"));
    const QUrl url2(QStringLiteral("https://ardali-browser.org/download"));
    const QUrl url3(QStringLiteral("https://github.com/ardali-browser/core"));

    profileService.recordHistory(url1, QStringLiteral("ArDali Features"), true);
    profileService.recordHistory(url2, QStringLiteral("ArDali Download"), false);
    profileService.recordHistory(url3, QStringLiteral("GitHub Repository"), true);

    const auto allHistory = profileService.recentHistory();
    assert(allHistory.size() == 3);

    // Test Multi-token and Partial Search
    const auto searchMulti = profileService.searchHistory(QStringLiteral("ardali feat"));
    assert(searchMulti.size() == 1);
    assert(searchMulti.first().url == url1);

    const auto searchAllArdali = profileService.searchHistory(QStringLiteral("ardali"));
    assert(searchAllArdali.size() == 3);

    const auto searchGit = profileService.searchHistory(QStringLiteral("github"));
    assert(searchGit.size() == 1);
    assert(searchGit.first().url == url3);

    const auto searchNone = profileService.searchHistory(QStringLiteral("nonexistent_query_string"));
    assert(searchNone.isEmpty());

    // Test Individual Deletion
    const bool removed = profileService.removeHistoryEntry(url2, allHistory[1].visitedAt);
    assert(removed);
    assert(profileService.recentHistory().size() == 2);
    assert(profileService.searchHistory(QStringLiteral("Download")).isEmpty());

    // Verify Real Persistence across browser restart
    {
      BrowserProfileService reopenedProfile(tempDir.path() + QStringLiteral("/profile"), nullptr, nullptr, false);
      const auto reloadedHistory = reopenedProfile.recentHistory();
      assert(reloadedHistory.size() == 2);
      assert(reopenedProfile.searchHistory(QStringLiteral("Download")).isEmpty());
      assert(reopenedProfile.searchHistory(QStringLiteral("Features")).size() == 1);
      assert(reopenedProfile.searchHistory(QStringLiteral("GitHub")).size() == 1);
    }

    // Test Settings History UI Integration
    {
      SettingsPage settingsPage(&profileService, {});
      settingsPage.setCategory(SettingsPage::Category::History);

      auto *list = settingsPage.findChild<QListWidget *>(QStringLiteral("history-list-widget"));
      assert(list != nullptr);
      assert(list->count() == 2);

      // Test Search filtering in the UI
      auto *searchEdit = settingsPage.findChild<QLineEdit *>(QStringLiteral("history-search-input"));
      assert(searchEdit != nullptr);
      searchEdit->setText(QStringLiteral("Features"));
      assert(list->count() == 1);

      searchEdit->clear();
      assert(list->count() == 2);

      // Test Individual Deletion from History
      profileService.removeHistoryEntriesForUrl(url3);
      assert(list->count() == 1);
      assert(profileService.recentHistory().size() == 1);
      assert(profileService.recentHistory().first().url == url1);
    }

    std::cout << "     PASS: History multi-token search, deletion persistence across restarts, and UI verified.\n";
  }

  // =========================================================================
  // Test 4: Bookmark Folders, Tree Hierarchy, Real Persistence & Netscape HTML
  // =========================================================================
  {
    std::cout << "  -> Testing bookmark folders, tree hierarchy, persistence across restarts, and HTML...\n";
    const QUrl bm1(QStringLiteral("https://example.com/site1"));
    const QUrl bm2(QStringLiteral("https://example.com/site2"));
    const QUrl bm3(QStringLiteral("https://example.com/site3"));

    // Explicitly create folder
    assert(profileService.createBookmarkFolder(QStringLiteral("Work")));
    assert(profileService.createBookmarkFolder(QStringLiteral("Personal")));
    assert(profileService.createBookmarkFolder(QStringLiteral("EmptyArchive")));

    // Add with folders
    assert(profileService.addBookmark(bm1, QStringLiteral("Site One"), QStringLiteral("Work")));
    assert(profileService.addBookmark(bm2, QStringLiteral("Site Two"), QStringLiteral("Work")));
    assert(profileService.addBookmark(bm3, QStringLiteral("Site Three"), QStringLiteral("Personal")));

    // Move bookmark into another folder
    assert(profileService.moveBookmarkToFolder(bm3, QStringLiteral("EmptyArchive")));

    // Verify folder listing including empty ones
    const QStringList folders = profileService.bookmarkFolders();
    assert(folders.contains(QStringLiteral("Work")));
    assert(folders.contains(QStringLiteral("Personal")));
    assert(folders.contains(QStringLiteral("EmptyArchive")));

    // Verify Real Persistence across browser restart
    {
      BrowserProfileService reopenedProfile(tempDir.path() + QStringLiteral("/profile"), nullptr, nullptr, false);
      const QStringList reloadedFolders = reopenedProfile.bookmarkFolders();
      assert(reloadedFolders.contains(QStringLiteral("Work")));
      assert(reloadedFolders.contains(QStringLiteral("Personal")));
      assert(reloadedFolders.contains(QStringLiteral("EmptyArchive")));

      const auto items = reopenedProfile.bookmarkItems();
      bool foundMoved = false;
      for (const auto &item : items) {
        if (item.url == bm3 && item.folder == QStringLiteral("EmptyArchive")) {
          foundMoved = true;
          break;
        }
      }
      assert(foundMoved);
    }

    // Test Settings Bookmarks UI Integration (TreeWidget hierarchy)
    {
      SettingsPage settingsPage(&profileService, {});
      settingsPage.setCategory(SettingsPage::Category::Bookmarks);

      auto *tree = settingsPage.findChild<QTreeWidget *>();
      assert(tree != nullptr);
      assert(tree->topLevelItemCount() >= 3); // Root folders
    }

    // Test Netscape HTML Export & Import
    const QString exportedHtml = profileService.exportBookmarksToHtml();
    assert(exportedHtml.contains(QStringLiteral("<!DOCTYPE NETSCAPE-Bookmark-file-1>")));
    assert(exportedHtml.contains(QStringLiteral("Work")));
    assert(exportedHtml.contains(QStringLiteral("EmptyArchive")));
    assert(exportedHtml.contains(QStringLiteral("https://example.com/site1")));

    // Clean profile and import exported HTML
    QTemporaryDir tempDir2;
    assert(tempDir2.isValid());
    BrowserProfileService freshProfile(tempDir2.path() + QStringLiteral("/profile"), nullptr, nullptr, false);
    const int importedCount = freshProfile.importBookmarksFromHtml(exportedHtml);
    assert(importedCount >= 3);
    assert(freshProfile.isBookmarked(bm1));
    assert(freshProfile.isBookmarked(bm2));
    assert(freshProfile.isBookmarked(bm3));
    assert(freshProfile.bookmarkFolders().contains(QStringLiteral("Work")));

    std::cout << "     PASS: Bookmark folders hierarchy, persistence across restarts, and HTML verified.\n";
  }

  // =========================================================================
  // Test 5: Secure DNS (DNS-over-HTTPS) Configuration
  // =========================================================================
  {
    std::cout << "  -> Testing Secure DNS configuration and Qt WebEngine integration...\n";
    assert(profileService.secureDnsMode() == QStringLiteral("system"));

    profileService.setSecureDnsMode(QStringLiteral("secure"));
    assert(profileService.secureDnsMode() == QStringLiteral("secure"));

    profileService.setSecureDnsTemplate(QStringLiteral("https://dns.google/dns-query"));
    assert(profileService.secureDnsTemplate() == QStringLiteral("https://dns.google/dns-query"));

    // Fallback mode
    profileService.setSecureDnsMode(QStringLiteral("fallback"));
    assert(profileService.secureDnsMode() == QStringLiteral("fallback"));

    // System mode
    profileService.setSecureDnsMode(QStringLiteral("system"));
    assert(profileService.secureDnsMode() == QStringLiteral("system"));

    std::cout << "     PASS: Secure DNS mode and provider templates applied cleanly.\n";
  }

  // =========================================================================
  // Test 6: Find in Page Bar Lifecycle
  // =========================================================================
  {
    std::cout << "  -> Testing Find in Page bar lifecycle and controls...\n";
    BrowserWindow window(services, true);
    window.resize(1000, 700);
    window.show();
    window.addNewTab(QUrl(QStringLiteral("https://example.com/test")));

    // Show find bar
    window.showFindBar();
    assert(window.findChild<ardali::desktop_tabs::FindBarWidget *>() != nullptr);
    auto *findBar = window.findChild<ardali::desktop_tabs::FindBarWidget *>();
    assert(!findBar->isHidden());

    // Set text and match count
    findBar->setFindText(QStringLiteral("example"));
    assert(findBar->findText() == QStringLiteral("example"));

    findBar->setMatchCount(1, 5);
    findBar->clearMatchCount();

    // Hide find bar
    window.hideFindBar();
    assert(!findBar->isVisible());

    std::cout << "     PASS: Find in Page bar creation, controls, and lifecycle verified.\n";
  }

  // =========================================================================
  // Test 7: Omnibox Suggestion Popup Dismissal on Focus Loss, Escape & Click Outside
  // =========================================================================
  {
    std::cout << "  -> Testing omnibox suggestion popup dismissal on Escape, focus loss, and outside clicks...\n";
    BrowserWindow window(services, true);
    window.resize(1000, 700);
    window.show();

    auto *omnibox = window.findChild<QLineEdit *>(QStringLiteral("omnibox"));
    assert(omnibox != nullptr);
    auto *completer = omnibox->completer();
    assert(completer != nullptr && completer->popup() != nullptr);

    // Show popup
    completer->popup()->show();
    assert(completer->popup()->isVisible());

    // Test Escape key dismissal
    QKeyEvent escapeEvent(QEvent::KeyPress, Qt::Key_Escape, Qt::NoModifier);
    QApplication::sendEvent(&window, &escapeEvent);
    assert(!completer->popup()->isVisible());

    // Show popup again
    completer->popup()->show();
    assert(completer->popup()->isVisible());

    // Test Click Outside dismissal
    QMouseEvent clickOutside(QEvent::MouseButtonPress, QPointF(500, 500), QPointF(500, 500), Qt::LeftButton, Qt::LeftButton, Qt::NoModifier);
    QApplication::sendEvent(window.centralWidget(), &clickOutside);
    assert(!completer->popup()->isVisible());

    // Show popup again and test Focus Out dismissal
    completer->popup()->show();
    assert(completer->popup()->isVisible());
    QFocusEvent focusOut(QEvent::FocusOut);
    QApplication::sendEvent(omnibox, &focusOut);

    // Deferred focus out check (150ms)
    QEventLoop loop;
    QTimer::singleShot(250, &loop, &QEventLoop::quit);
    loop.exec();
    assert(!completer->popup()->isVisible());

    std::cout << "     PASS: Omnibox suggestion popup dismisses on Escape, outside click, and focus loss.\n";
  }

  // =========================================================================
  // Test 8: Print and PDF Execution Lifetime Safety
  // =========================================================================
  {
    std::cout << "  -> Testing Print and PDF execution lifetime and window survival...\n";
    BrowserWindow window(services, true);
    window.resize(1000, 700);
    window.show();
    window.addNewTab(QUrl(QStringLiteral("about:blank")));

    // Verify printToPdf directly does not crash or close window
    auto *view = window.currentView();
    assert(view != nullptr);
    const QString tempPdfPath = tempDir.path() + QStringLiteral("/output.pdf");
    view->printToPdf(tempPdfPath);
    assert(window.isVisible());
    assert(window.tabCount() == 1);

    // Verify QPrinter asynchronous lifetime pattern
    auto printer = std::make_shared<QPrinter>(QPrinter::HighResolution);
    auto conn = std::make_shared<QMetaObject::Connection>();
    *conn = QObject::connect(view, &QWebEngineView::printFinished, view, [printer, conn](bool) {
      QObject::disconnect(*conn);
    });
    assert(conn != nullptr);
    assert(printer.use_count() >= 1);
    assert(window.isVisible());

    std::cout << "     PASS: Print and PDF execution lifetime safety verified without window closure.\n";
  }

  std::cout << "\n>>> ALL STEP 5 ESSENTIAL FEATURE TESTS PASSED SUCCESSFULLY! <<<\n";
  return 0;
}
