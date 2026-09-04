#ifndef BROWSER_WINDOW_H_
#define BROWSER_WINDOW_H_

#include <QFrame>
#include <QIcon>
#include <QLabel>
#include <QList>
#include <QMainWindow>
#include <QPointer>
#include <QString>
#include <QTimer>
#include <QUrl>
#include <QUuid>
#include <QWebEngineProfile>
#include <QWebEngineView>

#include "audio/audio_effects_page.h"
#include "audio/web_audio_effects_controller.h"
#include "blocker/ardali_blocker_page.h"
#include "blocker/ardali_blocker_shield_button.h"
#include "core/browser_policy.h"
#include "core/browser_profile_service.h"
#include "desktop_tabs/tab_manager.h"
#include "desktop_tabs/tab_group_model.h"
#include "downloads/media_download_page.h"
#include "downloads/media_download_service.h"
#include "eq/eq_preset_page.h"
#include "eq/eq_preset_repository.h"
#include "passwords/password_manager_page.h"
#include "pulse/pulse_toolbar_button.h"
#include "pulse/song_finder_page.h"
#include "pulse/song_finder_settings.h"
#include "pulse/song_recognition_service.h"
#include "session/session_store.h"
#include "settings/settings_page.h"
#include "translate/page_translator.h"
#include "translate/translate_bubble_popup.h"

class ArDaliBlockerService;
class CredentialVaultManager;
class SongFinderSettingsPage;
class TranslateService;
class QLineEdit;
class QStackedWidget;
class QToolButton;
class QToolBar;
class QProgressBar;

namespace ardali::desktop_tabs {
class TabStripWidget;
class TabSearchPopup;
class TabGroupPopup;
class TabGroupLauncherPopup;
} // namespace ardali::desktop_tabs

struct BrowserServices {
  QWebEngineProfile *profile = nullptr;
  BrowserProfileService *profileService = nullptr;
  TabManager *tabManager = nullptr;
  const BrowserPolicy *policy = nullptr;
  SessionStore *sessionStore = nullptr;
  WebAudioEffectsController *audioEffects = nullptr;
  EqPresetRepository *eqPresetRepo = nullptr;
  SongRecognitionService *songRecognition = nullptr;
  SongFinderSettings *songFinderSettings = nullptr;
  MediaDownloadService *mediaDownload = nullptr;
};

struct BrowserTabInfo {
  uint64_t id = 0;
  QUuid uuid;
  QString title;
  QUrl url;
  QIcon icon;
  QPointer<QWidget> content;
  QPointer<QWebEngineView> view;
  bool isInternal = false;
  QString internalId;
  std::optional<QUuid> groupId;
};

class BrowserWindow : public QMainWindow {
  Q_OBJECT
public:
  explicit BrowserWindow(const BrowserServices &services = {},
                         bool isCaptureShell = false,
                         QWidget *parent = nullptr);
  ~BrowserWindow() override;

  const BrowserServices &services() const { return services_; }

  // Tab management
  int addNewTab(const QUrl &url = QUrl(QStringLiteral("ardali://newtab/")),
                int insertIndex = -1);
  int addInternalTab(QWidget *page, const QString &title, const QIcon &icon,
                     const QString &internalId, int insertIndex = -1);
  void closeTab(int index);
  void switchTab(int index);
  void moveTab(int fromIndex, int toIndex);

  // Tab drag transfer (Chromium parity)
  bool transferTabTo(uint64_t tabId, BrowserWindow *destination,
                     int targetIndex);
  void adoptTab(BrowserTabInfo info, int targetIndex);
  int findIndexByTabId(uint64_t tabId) const;
  uint64_t findTabIdByIndex(int index) const;

  ardali::desktop_tabs::TabStripWidget *tabStrip() const { return tabStrip_; }
  int tabCount() const { return tabs_.size(); }
  const BrowserTabInfo &tabInfo(int index) const { return tabs_[index]; }
  const QVector<BrowserTabInfo> &allTabs() const { return tabs_; }
  QWebEngineView *currentView() const;

  QString currentSearchEngine() const;
  void setSearchEngine(const QString &engine);
  void updateSearchEngineIcon();
  void toggleTabSearchPopup();

  // Tab Groups
  ardali::desktop_tabs::TabGroupModel *groupModel() const { return groupModel_; }
  void toggleTabGroupLauncher();
  void createNewTabGroupWithNewTab();
  void createGroupFromExistingTab(uint64_t tabId);
  void showTabGroupPopup(const QUuid &groupId, const QPoint &globalPos = QPoint());
  void addTabToGroup(const QUuid &groupId);
  void moveGroupToNewWindow(const QUuid &groupId);
  void closeTabGroup(const QUuid &groupId);
  void ungroupTabs(const QUuid &groupId);
  void deleteTabGroup(const QUuid &groupId);
  std::optional<ardali::desktop_tabs::TabGroup> groupForTab(uint64_t tabId) const;

  // Feature page navigations
  void showSettings(
      SettingsPage::Category category = SettingsPage::Category::Startup);
  void showPasswords();
  void showAudioEffects();
  void showEqPresetBrowser();
  void showArDaliBlockerSettings(
      ArDaliBlockerPage::Tab tab = ArDaliBlockerPage::Tab::Settings);
  void showSongFinder();
  void showSongFinderSettings();
  void showMediaDownloads(const QUrl &sourceUrl = {},
                          bool analyzeImmediately = false);
  void showTranslatePopup();
  void showZoomPopup();
  void changeCurrentZoom(qreal delta);
  void setCurrentZoom(qreal factor);
  void showMainMenu();
  void showHistoryMenu();
  void showDownloadsMenu();
  void toggleCurrentBookmark();
  void renderBookmarks();
  void fillCurrentPageFromVault();
  QIcon tabIconForRecord(const BrowserTabInfo &info) const;

  void prepareAdBlockScripts(QWebEnginePage *page, const QUrl &url,
                             bool force = false);
  void saveSessionNow();
  void restoreSession(const QVector<SavedTab> &savedTabs);
  void ensureInitialTab();
  void openStartupUrl(const QUrl &url);

  QSize restoredSize() const;
  QRect restoredGeometry() const;
  void updateBookmarkButtonState();
  void updateBlockerControls();

protected:
  void closeEvent(QCloseEvent *event) override;
  void keyPressEvent(QKeyEvent *event) override;
  void changeEvent(QEvent *event) override;
  void resizeEvent(QResizeEvent *event) override;
  void moveEvent(QMoveEvent *event) override;
  void mousePressEvent(QMouseEvent *event) override;
  void mouseMoveEvent(QMouseEvent *event) override;
  void mouseReleaseEvent(QMouseEvent *event) override;

private slots:
  void onOmniboxReturnPressed();
  void onBackClicked();
  void onForwardClicked();
  void onReloadOrStopClicked();
  void onHomeClicked();
  void onMinimizeClicked();
  void onMaximizeRestoreClicked();
  void onCloseWindowClicked();

private:
  void setupUi();
  void setupStyle();
  void setupTabStripSignals();
  void wireViewSignals(QWebEngineView *view, uint64_t tabId);
  void updateNavButtons();
  void updateOmniboxForCurrentTab();
  Qt::Edges calculateEdges(const QPoint &pos) const;
  void updateCursorShape(const QPoint &pos);

  BrowserServices services_;
  bool isCaptureShell_ = false;
  QList<BrowserTabInfo> tabs_;

  // Frameless Top Bar
  QWidget *topBar_ = nullptr;
  QToolButton *tabSearchBtn_ = nullptr;
  ardali::desktop_tabs::TabStripWidget *tabStrip_ = nullptr;
  QToolButton *minBtn_ = nullptr;
  QToolButton *maxBtn_ = nullptr;
  QToolButton *closeBtn_ = nullptr;

  // Navigation Bar & Features
  QWidget *navBar_ = nullptr;
  QToolButton *backBtn_ = nullptr;
  QToolButton *forwardBtn_ = nullptr;
  QToolButton *reloadBtn_ = nullptr;
  QToolButton *homeBtn_ = nullptr;
  QToolButton *bookmarkBtn_ = nullptr;
  QLineEdit *omnibox_ = nullptr;
  QAction *searchEngineAction_ = nullptr;
  QToolBar *bookmarkBar_ = nullptr;
  QToolButton *appsBtn_ = nullptr;
  QPointer<ardali::desktop_tabs::TabSearchPopup> tabSearchPopup_;
  ardali::desktop_tabs::TabGroupModel *groupModel_ = nullptr;
  QPointer<ardali::desktop_tabs::TabGroupPopup> tabGroupPopup_;
  QPointer<ardali::desktop_tabs::TabGroupLauncherPopup> tabGroupLauncherPopup_;
  QProgressBar *progressBar_ = nullptr;
  QStackedWidget *pageStack_ = nullptr;

  // Feature buttons in navBar_
  QToolButton *zoomButton_ = nullptr;
  QFrame *zoomPopup_ = nullptr;
  QLabel *zoomPercent_ = nullptr;
  QToolButton *translateButton_ = nullptr;
  ArDaliBlockerShieldButton *adBlockShield_ = nullptr;
  PulseToolbarButton *pulseButton_ = nullptr;
  QToolButton *mediaDownload_ = nullptr;
  QToolButton *passwordsBtn_ = nullptr;
  QToolButton *mainMenuBtn_ = nullptr;

  TranslateBubblePopup *translateBubble_ = nullptr;
  PageTranslator *pageTranslator_ = nullptr;

  bool resizing_ = false;
  Qt::Edges resizeEdges_{};

  QSize lastNormalSize_{1280, 800};
  QRect lastNormalGeometry_{100, 100, 1280, 800};
  QUrl lastActiveWebUrl_;
};

#endif // BROWSER_WINDOW_H_
