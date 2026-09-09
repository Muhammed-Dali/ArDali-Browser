#ifndef BROWSER_WINDOW_H_
#define BROWSER_WINDOW_H_

#include <memory>
#include <QFrame>
#include <QCache>
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

namespace ardali::core {
class INavigationCandidateProvider;
}

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
#include "downloads/media_platform_registry.h"
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
#include "site_permission_prompt_bubble.h"
#include "site_controls_bubble.h"

struct TabSessionPermissionKey {
  uint64_t tabId = 0;
  QString canonicalOrigin;
  QString permissionKey;

  bool operator==(const TabSessionPermissionKey &other) const {
    return tabId == other.tabId && canonicalOrigin == other.canonicalOrigin && permissionKey == other.permissionKey;
  }
};

inline size_t qHash(const TabSessionPermissionKey &key, size_t seed = 0) {
  return qHash(key.tabId, seed) ^ qHash(key.canonicalOrigin, seed) ^ qHash(key.permissionKey, seed);
}

#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
struct PendingPermissionRequest {
  QWebEnginePermission permission;
  QPointer<QWebEngineView> view;
  QPointer<QWebEnginePage> page;
  uint64_t tabId = 0;
  QUrl requestedOrigin;
  QString canonicalOrigin;
  QWebEnginePermission::PermissionType type;
  QDateTime requestedAt;
};
#endif

class ArDaliBlockerService;
class CredentialVaultManager;
class CredentialAutofillController;
class SongFinderSettingsPage;
class TranslateService;
class QLineEdit;
class QCompleter;
class QStandardItemModel;
class QStackedWidget;
class QToolButton;
class QToolBar;
class QProgressBar;
class TabHoverCard;
class DownloadUiModel;
class DownloadPopup;
class DownloadToolbarButton;

namespace ardali::desktop_tabs {
class TabStripWidget;
class TabSearchPopup;
class TabGroupPopup;
class TabGroupLauncherPopup;
} // namespace ardali::desktop_tabs

struct BrowserServices {
  std::shared_ptr<BrowserProfileService> privateProfileOwner;
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
  QUrl expectedTypedUrl;
  bool activeCamera = false;
  bool activeMicrophone = false;
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
  void navigateFromUserInput(const QString &rawInput, const QString &searchEngine = QString{});
  ardali::core::INavigationCandidateProvider *candidateProvider() const { return candidateProvider_.get(); }
  void requestNewTabSuggestions(QWebEnginePage *page, const QString &query, int requestId);
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
  bool isCurrentTabNewTab() const;
  void updateBookmarkBarVisibility();
  void toggleBookmarkBar();
  void fillCurrentPageFromVault();
  CredentialAutofillController *autofillController() const { return autofillController_.get(); }
  void updateSaveBubblePosition();
  void dismissCredentialSaveBubble();
  QIcon tabIconForRecord(const BrowserTabInfo &info) const;

  // Tab-scoped session permission management
  void clearTabSessionPermissions(uint64_t tabId);
  void clearTabSessionPermissionsForOrigin(uint64_t tabId, const QString &canonicalOrigin);
  void clearAllTabSessionPermissionsForOrigin(const QString &canonicalOrigin);
  void grantTabSessionPermission(uint64_t tabId, const QString &canonicalOrigin, const QString &permissionKey);
  bool hasTabSessionPermission(uint64_t tabId, const QString &canonicalOrigin, const QString &permissionKey) const;

  // Site controls & omnibox leading icon
  SiteControlsBubble *siteControlsBubble() const { return siteControlsBubble_.data(); }
  void toggleSiteControlsBubble();
  void dismissSiteControlsBubble();
  bool isInsideSiteControls(QWidget *target, const QPoint &globalPos) const;
  void updateOmniboxLeadingIcon();
  QAction *omniboxLeadingAction() const { return searchEngineAction_; }
  void setTabActiveMediaForTesting(int tabIndex, bool camera, bool mic);

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
  bool eventFilter(QObject *watched, QEvent *event) override;
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
  void onTabHovered(int index, const QPoint &globalPos, const QRect &globalTabRect);
  void onTabHoverLeave();

private:
  void setupUi();
  void setupStyle();
  void setupTabStripSignals();
  void wireViewSignals(QWebEngineView *view, uint64_t tabId);
  void updateNavButtons();
  void updateOmniboxForCurrentTab();
  Qt::Edges calculateEdges(const QPoint &pos) const;
  void updateCursorShape(const QPoint &pos);
  void handleManualResize(const QPoint &globalPos);
  QVector<QPointer<QWebEngineView>> collectAllWebViewsAcrossWindows() const;
  void syncNewTabViews();
  void onThrobberTick();

  BrowserServices services_;
  bool isCaptureShell_ = false;
  QList<BrowserTabInfo> tabs_;

  // Frameless Top Bar
  QWidget *topBar_ = nullptr;
  QToolButton *tabSearchBtn_ = nullptr;
  ardali::desktop_tabs::TabStripWidget *tabStrip_ = nullptr;
  QPointer<TabHoverCard> hoverCard_;
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
  QCompleter *suggestionCompleter_ = nullptr;
  QStandardItemModel *suggestionModel_ = nullptr;
  bool suggestionActivated_ = false;
  QCache<QString, QIcon> suggestionIconCache_{64};
  int pendingSuggestionIcons_ = 0;
  QJsonArray searchRows(const QString &query, const QStringList &remote) const;
  void updateOmniboxSuggestions(const QString &query);
  void activateSuggestion(const QUrl &url);
  bool beginForgetClosedView(QWebEngineView *view);
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
  DownloadToolbarButton *mediaDownload_ = nullptr;
  DownloadUiModel *downloadUiModel_ = nullptr;
  DownloadPopup *downloadPopup_ = nullptr;
  QToolButton *passwordsBtn_ = nullptr;
  QToolButton *mainMenuBtn_ = nullptr;
  std::unique_ptr<CredentialAutofillController> autofillController_;

  void updateDownloadToolbar();
  void showDownloadStartedAnimation();
  bool downloadAnimationsEnabled() const;

  TranslateBubblePopup *translateBubble_ = nullptr;
  PageTranslator *pageTranslator_ = nullptr;

  QPointer<SitePermissionPromptBubble> permissionBubble_;
  QPointer<SiteControlsBubble> siteControlsBubble_;
  QSet<TabSessionPermissionKey> tabSessionGrants_;
  void updateSiteControlsBubblePosition();
#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
  QList<PendingPermissionRequest> pendingPermissionQueue_;
  std::optional<PendingPermissionRequest> currentActivePermissionRequest_;
  void handleTabPermissionRequested(QWebEngineView *view, const QWebEnginePermission &permission);
  void processNextPermissionRequest();
  void resolveActivePermissionRequest(SitePermissionChoice choice);
  void dismissActivePermissionPrompt(bool cancelRequest = true);
  void updatePermissionBubblePosition();
  void syncProfilePermissionsForTab(uint64_t tabId);
#endif

  bool resizing_ = false;
  Qt::Edges resizeEdges_{};
  QPoint resizeStartPos_;
  QRect resizeStartGeometry_;
  bool hasOverrideCursor_ = false;
  Qt::CursorShape currentOverrideShape_ = Qt::ArrowCursor;

  QSize lastNormalSize_{1280, 800};
  QRect lastNormalGeometry_{100, 100, 1280, 800};
  QUrl lastActiveWebUrl_;

  std::unique_ptr<ardali::core::INavigationCandidateProvider> candidateProvider_;
};

#endif // BROWSER_WINDOW_H_
