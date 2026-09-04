#include <QApplication>
#include <QIcon>
#include <QPalette>
#include <QStyleFactory>
#include <QWebEngineProfile>
#include <QWebEngineSettings>
#include <QStandardPaths>
#include <QDir>
#include <QFile>
#include <QFileInfo>

#include "browser_window.h"
#include "core/browser_icons.h"
#include "core/performance_diagnostics.h"
#include "desktop_tabs/tab_drag_controller.h"
#include "newtab/new_tab_scheme.h"

int main(int argc, char *argv[]) {
  // Ensure Wayland / XWayland coordinate parity for window moves and tab dragging
  if (!qEnvironmentVariableIsSet("QT_QPA_PLATFORM") &&
      qEnvironmentVariableIsSet("DISPLAY") &&
      qgetenv("XDG_SESSION_TYPE") == "wayland") {
    qputenv("QT_QPA_PLATFORM", "xcb");
  }

  // Register ardali:// URL scheme before QGuiApplication
  registerArdaliUrlSchemes();

  QApplication app(argc, argv);
  app.setApplicationName(QStringLiteral("ArDaliBrowser"));
  app.setApplicationVersion(QStringLiteral("6.1.2"));
  app.setOrganizationName(QStringLiteral("ArDali"));

  const QIcon appIcon = BrowserIcons::appIcon();
  if (!appIcon.isNull()) {
    app.setWindowIcon(appIcon);
  }

  // Apply dark palette theme
  app.setStyle(QStyleFactory::create(QStringLiteral("Fusion")));
  QPalette darkPalette;
  darkPalette.setColor(QPalette::Window, QColor(0x20, 0x21, 0x24));
  darkPalette.setColor(QPalette::WindowText, QColor(0xf1, 0xf3, 0xf4));
  darkPalette.setColor(QPalette::Base, QColor(0x18, 0x19, 0x1c));
  darkPalette.setColor(QPalette::AlternateBase, QColor(0x2b, 0x2a, 0x33));
  darkPalette.setColor(QPalette::ToolTipBase, QColor(0x2b, 0x2a, 0x33));
  darkPalette.setColor(QPalette::ToolTipText, QColor(0xf1, 0xf3, 0xf4));
  darkPalette.setColor(QPalette::Text, QColor(0xf1, 0xf3, 0xf4));
  darkPalette.setColor(QPalette::Button, QColor(0x2b, 0x2a, 0x33));
  darkPalette.setColor(QPalette::ButtonText, QColor(0xf1, 0xf3, 0xf4));
  darkPalette.setColor(QPalette::BrightText, Qt::red);
  darkPalette.setColor(QPalette::Link, QColor(0x8a, 0xb4, 0xf8));
  darkPalette.setColor(QPalette::Highlight, QColor(0x8a, 0xb4, 0xf8));
  darkPalette.setColor(QPalette::HighlightedText, QColor(0x20, 0x21, 0x24));
  app.setPalette(darkPalette);

  // Load browser policy
  QString policyError;
  const QString installedPolicyPath = QCoreApplication::applicationDirPath() + QStringLiteral("/browser_policy.json");
  const QString policyPath = QFileInfo::exists(installedPolicyPath)
      ? installedPolicyPath
      : QStringLiteral(ARDALI_BROWSER_POLICY_PATH);
  const BrowserPolicy policy = BrowserPolicy::load(policyPath, &policyError);

  const QString dataDir = QStandardPaths::writableLocation(QStandardPaths::AppDataLocation);
  QDir().mkpath(dataDir);

  // Initialize Core Services
  BrowserProfileService profileService(dataDir, &policy, &app);
  TabManager tabManager(&app);
  SessionStore sessionStore(dataDir + "/tabs.session.json");
  auto *audioEffects = new WebAudioEffectsController(&app);
  auto *eqPresetRepo = new EqPresetRepository;
  auto *songFinderSettings = new SongFinderSettings(&app);
  auto *songRecognition = new SongRecognitionService(songFinderSettings, &app);
  auto *mediaDownload = new MediaDownloadService(dataDir, &app);
  if (qEnvironmentVariableIntValue("ARDALI_FEATURE_DIAGNOSTICS") == 1) {
    auto *diagnostics = new PerformanceDiagnostics(
        &tabManager, profileService.adBlockService(), audioEffects, songRecognition, &app);
    diagnostics->start();
  }

  BrowserServices services;
  services.profile = profileService.profile();
  services.profileService = &profileService;
  services.tabManager = &tabManager;
  services.policy = &policy;
  services.sessionStore = &sessionStore;
  services.audioEffects = audioEffects;
  services.eqPresetRepo = eqPresetRepo;
  services.songFinderSettings = songFinderSettings;
  services.songRecognition = songRecognition;
  services.mediaDownload = mediaDownload;

  // Wire TabDragController delegates for Chromium parity tab dragging
  auto &dragController = ardali::desktop_tabs::TabDragController::instance();

  dragController.setDetachedWindowFactory(
      [services](QWidget *originWin, uint64_t /*tabId*/) -> QWidget * {
        auto *origin = dynamic_cast<BrowserWindow *>(originWin);
        if (!origin) return nullptr;
        auto *captureShell = new BrowserWindow(services, /*isCaptureShell=*/true);
        return captureShell;
      });

  dragController.setDetachTransferDelegate(
      [](QWidget *destWin, QWidget *originWin, uint64_t tabId, int targetIndex) -> bool {
        auto *origin = dynamic_cast<BrowserWindow *>(originWin);
        auto *dest   = dynamic_cast<BrowserWindow *>(destWin);
        if (!origin || !dest) return false;
        return origin->transferTabTo(tabId, dest, targetIndex);
      });

  dragController.setTabTransferDelegate(
      [](QWidget *fromWin, QWidget *toWin, uint64_t tabId, int targetIndex) -> bool {
        auto *source = dynamic_cast<BrowserWindow *>(fromWin);
        auto *dest   = dynamic_cast<BrowserWindow *>(toWin);
        if (!source || !dest) return false;
        return source->transferTabTo(tabId, dest, targetIndex);
      });

  dragController.setTabMoveDelegate(
      [](QWidget *win, int fromIndex, int toIndex) {
        auto *bw = dynamic_cast<BrowserWindow *>(win);
        if (!bw) return;
        bw->moveTab(fromIndex, toIndex);
      });

  // Launch initial browser window
  auto *window = new BrowserWindow(services);

  // Restore session or ensure initial tab
  bool restored = false;
  if (policy.allowsSessionRestore() && QSettings().value(QStringLiteral("browser/restoreSession"), true).toBool()) {
    const auto savedTabs = sessionStore.load();
    if (!savedTabs.isEmpty()) {
      window->restoreSession(savedTabs);
      restored = true;
    }
  }
  if (!restored) {
    window->ensureInitialTab();
  }

  // Handle command line startup URL
  for (int i = 1; i < argc; ++i) {
    const QString argument = QString::fromLocal8Bit(argv[i]).trimmed();
    if (argument.startsWith(QLatin1Char('-'))) continue;
    const QUrl candidate = QUrl::fromUserInput(argument);
    const QString scheme = candidate.scheme().toLower();
    if (candidate.isValid() && (scheme == QLatin1String("http") || scheme == QLatin1String("https")
                                || scheme == QLatin1String("ardali"))) {
      window->openStartupUrl(candidate);
      break;
    }
  }

  QObject::connect(&app, &QCoreApplication::aboutToQuit, window, [window] {
    window->saveSessionNow();
  });

  window->show();

  const int exitCode = app.exec();
  const auto topLevelWidgets = QApplication::topLevelWidgets();
  for (QWidget *w : topLevelWidgets) {
    if (auto *bw = qobject_cast<BrowserWindow *>(w)) {
      delete bw;
    }
  }
  return exitCode;
}
