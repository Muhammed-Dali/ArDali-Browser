#pragma once

#include <QHash>
#include <QUrl>
#include <QWidget>

#include "browser_icons.h"

#include <functional>

class BrowserProfileService;
class QLineEdit;
class QListWidget;
class QStackedWidget;

// Trusted native browser chrome. It is never loaded into a web renderer and
// intentionally exposes no QObject or settings bridge to web content.
class SettingsPage final : public QWidget {
  Q_OBJECT
 public:
  enum class Category {
    Startup,
    Appearance,
    Content,
    Privacy,
    Blocker,
    AdBlock = Blocker,
    Search,
    Passwords,
    Bookmarks,
    History,
    Downloads,
    Languages,
    Accessibility,
    System,
    Reset,
    Listening,
    About
  };

  struct Hooks {
    std::function<QString()> searchEngine;
    std::function<void(const QString &)> setSearchEngine;
    std::function<void()> syncNewTabs;
    std::function<void()> refreshBookmarks;
  };

  SettingsPage(BrowserProfileService *profileService, Hooks hooks, QWidget *parent = nullptr);
  void setCategory(Category category);
  void refreshPreferences();

 signals:
  void navigateRequested(const QUrl &url);
  void appearanceResetRequested();

 private:
  QWidget *createStartupSection();
  QWidget *createAppearanceSection();
  QWidget *createContentSection();
  QWidget *createPrivacySection();
  QWidget *createBlockerSection();
  QWidget *createAdBlockSection() { return createBlockerSection(); }
  QWidget *createSearchSection();
  QWidget *createPasswordsSection();
  QWidget *createDownloadsSection();
  QWidget *createBookmarksSection();
  QWidget *createHistorySection();
  QWidget *createLanguagesSection();
  QWidget *createAccessibilitySection();
  QWidget *createSystemSection();
  QWidget *createResetSection();
  QWidget *createListeningSection();
  QWidget *createAboutSection();
  void addCategory(Category category, BrowserIcon icon, const QString &name, const QString &keywords, QWidget *section);
  void addSidebarSeparator();
  void selectCategory(int index);
  void applyFilter(const QString &query);

  BrowserProfileService *profileService_ = nullptr;
  Hooks hooks_;
  QListWidget *sidebar_ = nullptr;
  QStackedWidget *content_ = nullptr;
  QLineEdit *search_ = nullptr;
  QHash<Category, int> categoryIndexes_;
  QHash<int, QString> searchKeywords_;
  QHash<int, int> contentSidebarRows_;
};
