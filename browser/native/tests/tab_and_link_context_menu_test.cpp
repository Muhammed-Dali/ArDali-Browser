#ifdef NDEBUG
#undef NDEBUG
#endif
#include <QApplication>
#include <QEventLoop>
#include <QTimer>
#include <QTemporaryDir>
#include <QSettings>
#include <cassert>
#include <iostream>

#include "browser_window.h"
#include "desktop_tabs/tab_strip_widget.h"
#include "core/browser_profile_service.h"

int main(int argc, char **argv) {
  QApplication app(argc, argv);
  app.setApplicationName(QStringLiteral("ArDaliContextMenuTest"));

  QTemporaryDir root;
  QSettings::setDefaultFormat(QSettings::IniFormat);
  QSettings::setPath(QSettings::IniFormat, QSettings::UserScope, root.path());

  BrowserProfileService profile(root.path() + "/normal", nullptr, nullptr, false);
  BrowserServices services;
  services.profile = profile.profile();
  services.profileService = &profile;

  BrowserWindow window(services, true);
  window.resize(1000, 700);

  // 1. Initial tab check
  window.addNewTab(QUrl(QStringLiteral("https://example.com/tab0")));
  window.addNewTab(QUrl(QStringLiteral("https://example.com/tab1")));
  window.addNewTab(QUrl(QStringLiteral("https://example.com/tab2")));
  window.addNewTab(QUrl(QStringLiteral("https://example.com/tab3")));

  assert(window.tabCount() == 4);
  assert(window.tabStrip()->count() == 4);

  // 2. Tab Pinning test
  assert(!window.allTabs()[0].isPinned);
  assert(!window.tabStrip()->isTabPinned(0));

  window.toggleTabPin(2); // Pin tab2 (url: example.com/tab2)
  assert(window.allTabs()[0].isPinned);
  assert(window.tabStrip()->isTabPinned(0));
  assert(window.allTabs()[0].url.toString() == QStringLiteral("https://example.com/tab2"));

  // Unpin it
  window.toggleTabPin(0);
  assert(!window.allTabs()[0].isPinned);
  assert(!window.tabStrip()->isTabPinned(0));

  // 3. Close tabs to the right
  // We have 4 tabs: 0, 1, 2, 3.
  window.closeTabsToRight(1);
  assert(window.tabCount() == 2);
  assert(window.tabStrip()->count() == 2);

  // 4. Close other tabs
  window.addNewTab(QUrl(QStringLiteral("https://example.com/tabExtra")));
  assert(window.tabCount() == 3);
  window.closeOtherTabs(1);
  assert(window.tabCount() == 1);
  assert(window.tabStrip()->count() == 1);

  // 5. Open incognito window
  BrowserWindow *incognitoWin = window.openIncognitoWindow();
  assert(incognitoWin != nullptr);
  assert(incognitoWin->isIncognito());
  assert(incognitoWin->tabCount() >= 1);
  assert(incognitoWin->tabInfo(0).title == QStringLiteral("Yeni Gizli Sekme"));
  assert(incognitoWin->tabStrip()->tabText(0) == QStringLiteral("Yeni Gizli Sekme"));
  delete incognitoWin;

  // 7. Bookmark context menu test
  const QUrl bmUrl(QStringLiteral("https://example.com/testbookmark"));
  profile.toggleBookmark(bmUrl);
  assert(profile.isBookmarked(bmUrl));

  QTimer::singleShot(10, [] {
    if (auto *w = QApplication::activePopupWidget()) {
      w->close();
    }
  });
  window.showBookmarkContextMenu(bmUrl, QStringLiteral("Test BM"), QPoint(100, 100));

  QTimer::singleShot(10, [] {
    if (auto *w = QApplication::activePopupWidget()) {
      w->close();
    }
  });
  window.showBookmarkContextMenu(QUrl(), QString(), QPoint(100, 100));

  std::cout << "All context menu and tab/bookmark management tests passed successfully!\n";
  return 0;
}
