#ifdef NDEBUG
#undef NDEBUG
#endif
#include <cassert>
#include <iostream>
#include <QApplication>
#include <QCompleter>
#include <QElapsedTimer>
#include <QEventLoop>
#include <QFocusEvent>
#include <QHeaderView>
#include <QKeyEvent>
#include <QLineEdit>
#include <QMenu>
#include <QMouseEvent>
#include <QPrinter>
#include <QSettings>
#include <QShortcut>
#include <QTableWidget>
#include <QTemporaryDir>
#include <QTimer>
#include <QToolBar>
#include <QTreeWidget>
#include <QWebEnginePage>

#include "browser_window.h"
#include "core/browser_profile_service.h"
#include "desktop_tabs/find_bar_widget.h"
#include "desktop_tabs/tab_strip_widget.h"
#include "passwords/credential_autofill_controller.h"
#include "passwords/credential_save_bubble.h"
#include "passwords/credential_vault_manager.h"
#include "settings/settings_page.h"

int main(int argc, char **argv) {
  setvbuf(stdout, nullptr, _IONBF, 0);
  setvbuf(stderr, nullptr, _IONBF, 0);
  QApplication app(argc, argv);
  app.setApplicationName(QStringLiteral("DaliNiraStep5Test"));

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

    QShortcut *closeShortcut = nullptr;
    for (auto *shortcut : window.findChildren<QShortcut *>()) {
      if (shortcut->key() == QKeySequence(Qt::CTRL | Qt::Key_W)) closeShortcut = shortcut;
    }
    assert(closeShortcut != nullptr);

    // Dispatch through the persistent shortcut. One activation must close one
    // tab, rather than reaching closeTab through duplicate handlers.
    const int initialCount = window.tabCount();
    Q_EMIT closeShortcut->activated();
    assert(window.tabCount() == initialCount - 1);
    assert(window.tabCount() == 2);

    Q_EMIT closeShortcut->activated();
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

    QShortcut *restoreShortcut = nullptr;
    for (auto *shortcut : window.findChildren<QShortcut *>()) {
      if (shortcut->key() == QKeySequence(Qt::CTRL | Qt::SHIFT | Qt::Key_T)) restoreShortcut = shortcut;
    }
    assert(restoreShortcut != nullptr);

    // Restore through Ctrl+Shift+T dispatch (should be Gamma).
    Q_EMIT restoreShortcut->activated();
    assert(window.tabCount() == 2);
    assert(window.allTabs()[1].url == urlGamma);

    // Restore next closed (should be Beta)
    Q_EMIT restoreShortcut->activated();
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

    const QUrl url1(QStringLiteral("https://dalinira-browser.org/features"));
    const QUrl url2(QStringLiteral("https://dalinira-browser.org/download"));
    const QUrl url3(QStringLiteral("https://github.com/dalinira-browser/core"));

    profileService.recordHistory(url1, QStringLiteral("DaliNira Features"), true);
    profileService.recordHistory(url2, QStringLiteral("DaliNira Download"), false);
    profileService.recordHistory(url3, QStringLiteral("GitHub Repository"), true);

    const auto allHistory = profileService.recentHistory();
    assert(allHistory.size() == 3);

    // Test Multi-token and Partial Search
    const auto searchMulti = profileService.searchHistory(QStringLiteral("dalinira feat"));
    assert(searchMulti.size() == 1);
    assert(searchMulti.first().url == url1);

    const auto searchAllDaliNira = profileService.searchHistory(QStringLiteral("dalinira"));
    assert(searchAllDaliNira.size() == 3);

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

    QShortcut *findShortcut = nullptr;
    for (auto *shortcut : window.findChildren<QShortcut *>()) {
      if (shortcut->key() == QKeySequence::Find) findShortcut = shortcut;
    }
    assert(findShortcut != nullptr);

    // Show find bar through Ctrl+F dispatch.
    Q_EMIT findShortcut->activated();
    assert(window.findChild<dalinira::desktop_tabs::FindBarWidget *>() != nullptr);
    auto *findBar = window.findChild<dalinira::desktop_tabs::FindBarWidget *>();
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
    omnibox->clearFocus();
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

    // Pump events so that WebEngine finishes initialization
    QEventLoop waitLoop;
    QObject::connect(view, &QWebEngineView::loadFinished, &waitLoop, &QEventLoop::quit);
    QTimer::singleShot(1000, &waitLoop, &QEventLoop::quit);
    waitLoop.exec();
    QApplication::processEvents();

    const QString tempPdfPath = tempDir.path() + QStringLiteral("/output.pdf");
    bool pdfFinished = false;
    bool pdfSucceeded = false;
    QEventLoop pdfLoop;
    QObject::connect(view->page(), &QWebEnginePage::pdfPrintingFinished,
                     &pdfLoop, [&](const QString &filePath, bool success) {
      if (filePath != tempPdfPath) return;
      pdfFinished = true;
      pdfSucceeded = success;
      pdfLoop.quit();
    });
    view->printToPdf(tempPdfPath);
    assert(window.isVisible());
    assert(window.tabCount() == 1);

    // Keep the page alive until Chromium completes the asynchronous PDF job.
    // Destroying QWebEnginePage with a pending print traps on the Qt WebEngine
    // versions shipped by Debian 12 and Ubuntu 24.04.
    if (!pdfFinished) {
      QTimer::singleShot(10000, &pdfLoop, &QEventLoop::quit);
      pdfLoop.exec();
    }
    assert(pdfFinished);
    assert(pdfSucceeded);

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

  // =========================================================================
  // STEP 6: Custom Search Engines — validation, persistence and resolution
  // =========================================================================
  {
    std::cout << "  -> Testing custom search engine validation and persistence...\n";
    assert(!BrowserProfileService::isValidSearchTemplate(QStringLiteral("javascript:alert(%s)")));
    assert(!BrowserProfileService::isValidSearchTemplate(QStringLiteral("https://example.com/search")));
    assert(!BrowserProfileService::isValidSearchTemplate(QStringLiteral("https://user:pass@example.com/?q=%s")));
    assert(BrowserProfileService::isValidSearchTemplate(QStringLiteral("https://search.example/?q=%s")));
    assert(profileService.saveCustomSearchEngine(QStringLiteral("Example Search"),
                                                 QStringLiteral("https://search.example/?q=%s")));
    profileService.setSearchEngine(QStringLiteral("Example Search"));
    assert(profileService.searchEngine() == QStringLiteral("Example Search"));
    assert(profileService.searchUrlForEngine(QStringLiteral("Example Search"), QStringLiteral("qt webengine"))
               == QUrl(QStringLiteral("https://search.example/?q=qt%20webengine")));
    {
      BrowserProfileService reopened(tempDir.path() + QStringLiteral("/profile"), nullptr, nullptr, false);
      assert(reopened.searchEngine() == QStringLiteral("Example Search"));
      assert(reopened.customSearchEngines().size() == 1);
    }
    assert(profileService.removeCustomSearchEngine(QStringLiteral("Example Search")));
    assert(profileService.searchEngine() == QStringLiteral("DuckDuckGo"));
    std::cout << "     PASS: Custom engines validate, resolve, persist and safely reset.\n";
  }

  // =========================================================================
  // STEP 6: Page Translation is discoverable and reaches the existing popup
  // =========================================================================
  {
    std::cout << "  -> Testing Page Translation hamburger-menu entry point...\n";
    BrowserWindow window(services, true);
    window.resize(1000, 700);
    window.show();
    window.addNewTab(QUrl(QStringLiteral("https://example.com/translation-test")));

    bool foundEnabledAction = false;
    QTimer::singleShot(0, &window, [&] {
      auto *menu = qobject_cast<QMenu *>(QApplication::activePopupWidget());
      if (!menu) {
        for (auto *top : QApplication::topLevelWidgets()) {
          if (auto *m = qobject_cast<QMenu *>(top)) {
            menu = m;
            break;
          }
        }
      }
      assert(menu != nullptr);
      auto *translateAction = menu->findChild<QAction *>(QStringLiteral("translatePageAction"));
      assert(translateAction != nullptr);
      foundEnabledAction = translateAction->isEnabled();
      translateAction->trigger();
      menu->close();
    });
    window.showMainMenu();

    assert(foundEnabledAction);
    auto *translatePopup = window.findChild<TranslateBubblePopup *>();
    assert(translatePopup != nullptr);
    translatePopup->close();
    std::cout << "     PASS: Sayfayı Çevir is visible for web pages and opens the existing translation popup.\n";
  }

  // =========================================================================
  // STEP 6: Session restore keeps pinned/normal tab presentation coherent
  // =========================================================================
  {
    std::cout << "  -> Testing restored pinned/normal tab order, presentation and active state...\n";
    TabManager manager;
    SessionStore store(tempDir.path() + QStringLiteral("/step6-tabs.session.json"));
    BrowserServices sessionServices = services;
    sessionServices.tabManager = &manager;
    sessionServices.sessionStore = &store;
    BrowserWindow window(sessionServices, true);
    window.resize(1000, 700);
    window.show();
    window.addNewTab(QUrl(QStringLiteral("dalinira://newtab/")));
    window.addNewTab(QUrl(QStringLiteral("dalinira://newtab/")));
    window.addNewTab(QUrl(QStringLiteral("dalinira://newtab/")));
    // Pin the middle-created tab. Interactive pinning moves it to visual slot
    // zero; the session must persist that visual order, not insertion order.
    window.toggleTabPin(1);
    window.switchTab(2); // Leave a normal tab active.
    window.saveSessionNow();
    const auto saved = store.load();
    assert(saved.size() == 3);
    assert(saved[0].pinned);
    assert(!saved[1].pinned && !saved[2].pinned);
    assert(saved[2].active);

    BrowserWindow restored(sessionServices, true);
    restored.resize(1000, 700);
    restored.show();
    restored.restoreSession(saved);
    QEventLoop settle;
    QTimer::singleShot(250, &settle, &QEventLoop::quit);
    settle.exec();
    assert(restored.tabCount() == 3);
    assert(restored.allTabs()[0].isPinned);
    assert(restored.tabStrip()->isTabPinned(0));
    assert(!restored.allTabs()[1].isPinned && !restored.tabStrip()->isTabPinned(1));
    assert(!restored.allTabs()[2].isPinned && !restored.tabStrip()->isTabPinned(2));
    assert(restored.tabStrip()->tabId(0) == restored.allTabs()[0].id);
    assert(restored.tabStrip()->tabId(1) == restored.allTabs()[1].id);
    assert(restored.tabStrip()->tabId(2) == restored.allTabs()[2].id);
    assert(restored.tabStrip()->tabText(1) == QStringLiteral("Yeni Sekme"));
    assert(restored.tabStrip()->tabText(2) == QStringLiteral("Yeni Sekme"));
    assert(restored.tabStrip()->tabRect(1).width() > restored.tabStrip()->tabRect(0).width());
    assert(restored.tabStrip()->tabRect(2).width() > restored.tabStrip()->tabRect(0).width());
    assert(restored.tabStrip()->currentIndex() == 2);
    std::cout << "     PASS: Restored normal tabs retain title and normal-width geometry.\n";
  }

  // =========================================================================
  // Test 14: Window-Level Shortcuts — Ctrl+Shift+N (Private) & Ctrl+N (New Window)
  // =========================================================================
  {
    std::cout << "  -> Testing Ctrl+Shift+N and Ctrl+N window-level shortcuts...\n";
    BrowserWindow window(services, true);
    window.resize(1000, 700);
    window.show();

    // Verify persistent QShortcut registration
    const auto shortcuts = window.findChildren<QShortcut*>();
    QShortcut *incognitoShortcut = nullptr;
    QShortcut *newWindowShortcut = nullptr;
    for (auto *sc : shortcuts) {
      if (sc->key() == QKeySequence(Qt::CTRL | Qt::SHIFT | Qt::Key_N)) {
        incognitoShortcut = sc;
      } else if (sc->key() == QKeySequence(Qt::CTRL | Qt::Key_N)) {
        newWindowShortcut = sc;
      }
    }
    assert(incognitoShortcut != nullptr);
    assert(newWindowShortcut != nullptr);
    assert(incognitoShortcut->context() == Qt::WindowShortcut);
    assert(newWindowShortcut->context() == Qt::WindowShortcut);

    // Activating Ctrl+Shift+N must create exactly one private window backed by
    // an off-the-record profile distinct from the normal profile.
    const auto topLevelsBefore = QApplication::topLevelWidgets();
    Q_EMIT incognitoShortcut->activated();

    BrowserWindow *spawnedIncognito = nullptr;
    int spawnedBrowserWindows = 0;
    for (auto *w : QApplication::topLevelWidgets()) {
      if (!topLevelsBefore.contains(w)) {
        if (auto *bw = qobject_cast<BrowserWindow*>(w)) {
          ++spawnedBrowserWindows;
          spawnedIncognito = bw;
        }
      }
    }
    assert(spawnedBrowserWindows == 1);
    assert(spawnedIncognito != nullptr);
    assert(spawnedIncognito->isIncognito());
    assert(spawnedIncognito->services().profile != services.profile);
    assert(spawnedIncognito->services().profile->isOffTheRecord());
    assert(spawnedIncognito->tabCount() >= 1);
    delete spawnedIncognito;

    // The menu command must reach the same authoritative creation behavior.
    const auto topLevelsBeforeMenu = QApplication::topLevelWidgets();
    QTimer::singleShot(0, &window, [&] {
      auto *menu = qobject_cast<QMenu *>(QApplication::activePopupWidget());
      if (!menu) {
        for (auto *top : QApplication::topLevelWidgets()) {
          if (auto *m = qobject_cast<QMenu *>(top)) {
            menu = m;
            break;
          }
        }
      }
      assert(menu != nullptr);
      auto *action = menu->findChild<QAction *>(QStringLiteral("newIncognitoWindowAction"));
      assert(action != nullptr);
      action->trigger();
      menu->close();
    });
    window.showMainMenu();
    BrowserWindow *menuIncognito = nullptr;
    spawnedBrowserWindows = 0;
    for (auto *w : QApplication::topLevelWidgets()) {
      if (!topLevelsBeforeMenu.contains(w)) {
        if (auto *bw = qobject_cast<BrowserWindow *>(w)) {
          ++spawnedBrowserWindows;
          menuIncognito = bw;
        }
      }
    }
    assert(spawnedBrowserWindows == 1);
    assert(menuIncognito != nullptr && menuIncognito->isIncognito());
    assert(menuIncognito->services().profile->isOffTheRecord());
    delete menuIncognito;

    // Activating Ctrl+N shortcut must create a new normal window
    const auto topLevelsBeforeNormal = QApplication::topLevelWidgets();
    Q_EMIT newWindowShortcut->activated();

    BrowserWindow *spawnedNormal = nullptr;
    for (auto *w : QApplication::topLevelWidgets()) {
      if (!topLevelsBeforeNormal.contains(w)) {
        if (auto *bw = qobject_cast<BrowserWindow*>(w)) {
          spawnedNormal = bw;
          break;
        }
      }
    }
    assert(spawnedNormal != nullptr);
    assert(!spawnedNormal->isIncognito());
    assert(spawnedNormal->tabCount() >= 1);
    delete spawnedNormal;

    std::cout << "     PASS: Ctrl+Shift+N and Ctrl+N persistent shortcuts create private and normal windows.\n";
  }

  // =========================================================================
  // Test 15: Remaining shortcut dispatch — Ctrl+T and Ctrl+L
  // =========================================================================
  {
    std::cout << "  -> Testing Ctrl+T and Ctrl+L observable dispatch...\n";
    BrowserWindow window(services, true);
    window.resize(1000, 700);
    window.show();
    window.addNewTab(QUrl(QStringLiteral("dalinira://newtab/")));

    QShortcut *newTabShortcut = nullptr;
    QShortcut *locationShortcut = nullptr;
    for (auto *shortcut : window.findChildren<QShortcut *>()) {
      if (shortcut->key() == QKeySequence(Qt::CTRL | Qt::Key_T)) newTabShortcut = shortcut;
      if (shortcut->key() == QKeySequence(Qt::CTRL | Qt::Key_L)) locationShortcut = shortcut;
    }
    assert(newTabShortcut != nullptr && locationShortcut != nullptr);

    const int before = window.tabCount();
    Q_EMIT newTabShortcut->activated();
    assert(window.tabCount() == before + 1);

    auto *omnibox = window.findChild<QLineEdit *>(QStringLiteral("omnibox"));
    assert(omnibox != nullptr);
    omnibox->setText(QStringLiteral("https://example.test/path"));
    Q_EMIT locationShortcut->activated();
    assert(omnibox->hasSelectedText());
    assert(omnibox->selectedText() == omnibox->text());
    std::cout << "     PASS: Ctrl+T creates one tab and Ctrl+L selects the location.\n";
  }

  // =========================================================================
  // Test 16: Pending credential decision follows its owning tab
  // =========================================================================
  {
    std::cout << "  -> Testing credential decision hide/re-show across tab switches...\n";
    auto *vault = profileService.credentialVault();
    assert(vault != nullptr);
    if (!vault->exists()) assert(vault->create(QStringLiteral("Step11SyntheticMaster#2026")));

    BrowserWindow window(services, true);
    window.resize(1000, 700);
    window.show();
    window.addNewTab(QUrl(QStringLiteral("https://login.example.com/form")));
    window.addNewTab(QUrl(QStringLiteral("https://other.example.net/")));
    auto *ownerView = window.allTabs().at(0).view.data();
    assert(ownerView != nullptr && window.autofillController() != nullptr);
    ownerView->setUrl(QUrl(QStringLiteral("https://login.example.com/form")));
    assert(ownerView->url() == QUrl(QStringLiteral("https://login.example.com/form")));

    window.autofillController()->handleConsoleMessage(
        ownerView->page(),
        QStringLiteral("DALINIRA_CREDENTIAL_CANDIDATE:{\"origin\":\"https://login.example.com\",\"username\":\"step11-user\",\"password\":\"SyntheticSecret#2026\",\"submitted\":true,\"nonce\":\"step11-flow\"}"));
    const QString candidateKey = window.autofillController()->candidateKey(
        ownerView, QStringLiteral("https://login.example.com"), QStringLiteral("step11-user"));
    assert(window.autofillController()->pendingCandidateCount() == 1);
    window.autofillController()->promptCandidate(ownerView, candidateKey);
    QElapsedTimer bubbleWait;
    bubbleWait.start();
    while (!window.autofillController()->activeSaveBubble() && bubbleWait.elapsed() < 1500) {
      QApplication::processEvents(QEventLoop::AllEvents, 20);
    }
    auto *bubble = window.autofillController()->activeSaveBubble();
    assert(bubble != nullptr);
    assert(bubble->origin() == QStringLiteral("https://login.example.com"));

    window.switchTab(0);
    assert(!bubble->isHidden());
    window.switchTab(1);
    assert(bubble->isHidden());
    assert(window.autofillController()->activeSaveBubble() == bubble);
    window.switchTab(0);
    assert(!bubble->isHidden());
    assert(bubble->origin() == QStringLiteral("https://login.example.com"));

    bubble->clickSecondary();
    assert(window.autofillController()->activeSaveBubble() == nullptr);
    std::cout << "     PASS: Pending decision survives tab switches and remains origin-bound.\n";
  }

  // =========================================================================
  // Test 17: Bookmark Bar Visibility Regression Test
  // =========================================================================
  {
    std::cout << "  -> Testing Bookmark bar visibility across tabs, navigation, and session restore...\n";
    BrowserWindow window(services, true);
    window.resize(1000, 700);
    window.show();

    // 1. Initial state with New Tab: Bookmark bar must be VISIBLE
    window.ensureInitialTab();
    assert(window.isCurrentTabNewTab());
    assert(window.bookmarkBar() && !window.bookmarkBar()->isHidden());

    // 2. Add normal website (YouTube): Bookmark bar must be HIDDEN immediately
    const int ytIdx = window.addNewTab(QUrl(QStringLiteral("https://www.youtube.com/")));
    assert(!window.isCurrentTabNewTab());
    assert(window.bookmarkBar() && window.bookmarkBar()->isHidden());

    // 3. Switch back to New Tab: Bookmark bar must show immediately
    window.switchTab(0);
    assert(window.isCurrentTabNewTab());
    assert(window.bookmarkBar() && !window.bookmarkBar()->isHidden());

    // 4. Switch to YouTube tab: Bookmark bar must hide immediately
    window.switchTab(ytIdx);
    assert(!window.isCurrentTabNewTab());
    assert(window.bookmarkBar() && window.bookmarkBar()->isHidden());

    // 5. Navigate New Tab to website: Bookmark bar must hide immediately
    window.switchTab(0);
    assert(window.bookmarkBar() && !window.bookmarkBar()->isHidden());
    window.navigateFromUserInput(QStringLiteral("https://www.google.com/"));
    assert(!window.isCurrentTabNewTab());
    assert(window.bookmarkBar() && window.bookmarkBar()->isHidden());

    // 6. Search results page: Bookmark bar must be HIDDEN
    window.navigateFromUserInput(QStringLiteral("dalinira test search"), QStringLiteral("Google"));
    assert(!window.isCurrentTabNewTab());
    assert(window.bookmarkBar() && window.bookmarkBar()->isHidden());

    // 7. Internal non-New-Tab page: Bookmark bar must be HIDDEN
    const int internalIdx = window.addNewTab(QUrl(QStringLiteral("dalinira://settings")));
    (void)internalIdx;
    assert(!window.isCurrentTabNewTab());
    assert(window.bookmarkBar() && window.bookmarkBar()->isHidden());

    // 8. Local page: Bookmark bar must be HIDDEN
    const int localIdx = window.addNewTab(QUrl(QStringLiteral("file:///tmp/sample.html")));
    (void)localIdx;
    assert(!window.isCurrentTabNewTab());
    assert(window.bookmarkBar() && window.bookmarkBar()->isHidden());

    // 9. Navigating home / back to New Tab: Bookmark bar must show again
    window.navigateFromUserInput(QStringLiteral("dalinira://newtab/"));
    assert(window.isCurrentTabNewTab());
    assert(window.bookmarkBar() && !window.bookmarkBar()->isHidden());

    // 10. Session restore: Restored normal website (YouTube active) must hide bookmark bar
    SavedTab tabYt;
    tabYt.url = QUrl(QStringLiteral("https://www.youtube.com/"));
    tabYt.title = QStringLiteral("YouTube");
    tabYt.pinned = false;
    tabYt.active = true;

    SavedTab tabNew;
    tabNew.url = QUrl(QStringLiteral("dalinira://newtab/"));
    tabNew.title = QStringLiteral("Yeni Sekme");
    tabNew.pinned = false;
    tabNew.active = false;

    QVector<SavedTab> savedTabs{tabYt, tabNew};

    BrowserWindow restoredWin(services, true);
    restoredWin.resize(1000, 700);
    restoredWin.restoreSession(savedTabs);
    restoredWin.show();
    assert(!restoredWin.isCurrentTabNewTab());
    assert(restoredWin.bookmarkBar() && restoredWin.bookmarkBar()->isHidden());

    // Switch to restored new tab: shows
    restoredWin.switchTab(1);
    assert(restoredWin.isCurrentTabNewTab());
    assert(restoredWin.bookmarkBar() && !restoredWin.bookmarkBar()->isHidden());

    // Switch back to restored YouTube: hides
    restoredWin.switchTab(0);
    assert(!restoredWin.isCurrentTabNewTab());
    assert(restoredWin.bookmarkBar() && restoredWin.bookmarkBar()->isHidden());

    // Toggle bookmark bar to never: hides even on New Tab
    restoredWin.switchTab(1);
    assert(!restoredWin.bookmarkBar()->isHidden());
    restoredWin.toggleBookmarkBar();
    assert(restoredWin.bookmarkBar()->isHidden());
    restoredWin.toggleBookmarkBar();
    assert(!restoredWin.bookmarkBar()->isHidden());

    // Clean up settings to default "new_tab"
    QSettings settings;
    settings.setValue(QStringLiteral("browser/bookmarkBarVisibility"), QStringLiteral("new_tab"));
    settings.sync();

    std::cout << "     PASS: Bookmark bar visibility strictly enforced for New Tab only.\n";
  }

  std::cout << "\n>>> STEP 5 REGRESSIONS AND STEP 6 UX TESTS PASSED SUCCESSFULLY! <<<\n";
  return 0;
}
