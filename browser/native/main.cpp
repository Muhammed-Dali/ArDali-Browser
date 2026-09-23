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
#include <QDateTime>
#include <QMessageBox>
#include <QProcess>
#include <QPushButton>
#include <QTimer>

#include "browser_window.h"
#include "core/application_identity.h"
#include "core/browser_icons.h"
#include "core/performance_diagnostics.h"
#include "core/web_engine_hardware_acceleration.h"
#include "core/web_engine_memory_policy.h"
#include "desktop_tabs/tab_drag_controller.h"
#include "i18n/i18n.h"
#include "i18n/language_manager.h"
#include "newtab/new_tab_scheme.h"

namespace {

constexpr auto kDaliNiraDesktopFile = "dalinira.desktop";
constexpr auto kDefaultBrowserPromptDisabled = "browser/defaultBrowserPromptDisabled";
constexpr auto kDefaultBrowserLastPromptUtc = "browser/defaultBrowserLastPromptUtc";

void openDefaultApplicationsSettings(QWidget *parent) {
#if defined(Q_OS_LINUX)
  if (QFileInfo(QStringLiteral("/usr/bin/systemsettings")).isExecutable()
      && QProcess::startDetached(QStringLiteral("/usr/bin/systemsettings"),
                                 {QStringLiteral("kcm_componentchooser")})) {
    return;
  }
#endif
  QMessageBox::information(parent, QStringLiteral("Varsayılan tarayıcı"),
      QStringLiteral("Sistem Ayarları > Öntanımlı Uygulamalar bölümünden "
                     "web tarayıcısı olarak DaliNira'yi seçin."));
}

void verifyDefaultBrowser(QWidget *parent) {
  auto *verify = new QProcess(parent);
  verify->setProgram(QStringLiteral("/usr/bin/xdg-settings"));
  verify->setArguments({QStringLiteral("get"), QStringLiteral("default-web-browser")});
  QObject::connect(verify, qOverload<int, QProcess::ExitStatus>(&QProcess::finished), parent,
                   [parent, verify](int exitCode, QProcess::ExitStatus exitStatus) {
    const QString desktopFile = QString::fromUtf8(verify->readAllStandardOutput()).trimmed();
    const bool accepted = exitStatus == QProcess::NormalExit && exitCode == 0
        && desktopFile == QString::fromLatin1(kDaliNiraDesktopFile);
    verify->deleteLater();
    if (accepted) {
      QSettings settings;
      settings.remove(QString::fromLatin1(kDefaultBrowserPromptDisabled));
      settings.remove(QString::fromLatin1(kDefaultBrowserLastPromptUtc));
      QMessageBox::information(parent, QStringLiteral("Varsayılan tarayıcı"),
          QStringLiteral("DaliNira varsayılan web tarayıcısı yapıldı."));
    } else {
      openDefaultApplicationsSettings(parent);
    }
  });
  verify->start();
}

void requestDefaultBrowser(QWidget *parent) {
  auto *setDefault = new QProcess(parent);
  setDefault->setProgram(QStringLiteral("/usr/bin/xdg-settings"));
  setDefault->setArguments({QStringLiteral("set"), QStringLiteral("default-web-browser"),
                            QString::fromLatin1(kDaliNiraDesktopFile)});
  QObject::connect(setDefault, qOverload<int, QProcess::ExitStatus>(&QProcess::finished), parent,
                   [parent, setDefault](int exitCode, QProcess::ExitStatus exitStatus) {
    const bool commandSucceeded = exitStatus == QProcess::NormalExit && exitCode == 0;
    setDefault->deleteLater();
    if (commandSucceeded) verifyDefaultBrowser(parent);
    else openDefaultApplicationsSettings(parent);
  });
  QObject::connect(setDefault, &QProcess::errorOccurred, parent,
                   [parent](QProcess::ProcessError error) {
    if (error == QProcess::FailedToStart) openDefaultApplicationsSettings(parent);
  });
  setDefault->start();
}

void showDefaultBrowserPrompt(QWidget *parent) {
  auto *dialog = new QMessageBox(QMessageBox::Question,
      QStringLiteral("DaliNira'yi varsayılan tarayıcı yap"),
      QStringLiteral("Web bağlantıları DaliNira ile açılsın mı?\n\n"
                     "Bu seçim yalnızca web bağlantılarını etkiler; müzik, video ve PDF "
                     "uygulamalarınız değiştirilmez."),
      QMessageBox::NoButton, parent);
  QPushButton *makeDefault = dialog->addButton(QStringLiteral("Varsayılan yap"), QMessageBox::AcceptRole);
  QPushButton *later = dialog->addButton(QStringLiteral("Şimdi değil"), QMessageBox::RejectRole);
  QPushButton *never = dialog->addButton(QStringLiteral("Bir daha sorma"), QMessageBox::DestructiveRole);
  dialog->setDefaultButton(makeDefault);
  dialog->setEscapeButton(later);
  dialog->setAttribute(Qt::WA_DeleteOnClose);
  QObject::connect(dialog, &QMessageBox::finished, parent,
                   [parent, dialog, makeDefault, never](int) {
    QSettings settings;
    if (dialog->clickedButton() == makeDefault) {
      requestDefaultBrowser(parent);
    } else if (dialog->clickedButton() == never) {
      settings.setValue(QString::fromLatin1(kDefaultBrowserPromptDisabled), true);
    } else {
      settings.setValue(QString::fromLatin1(kDefaultBrowserLastPromptUtc),
                        QDateTime::currentDateTimeUtc());
    }
  });
  dialog->open();
}

void checkDefaultBrowser(QWidget *parent) {
#if defined(Q_OS_LINUX)
  const QSettings settings;
  if (settings.value(QString::fromLatin1(kDefaultBrowserPromptDisabled), false).toBool()) return;
  const QDateTime lastPrompt = settings.value(QString::fromLatin1(kDefaultBrowserLastPromptUtc)).toDateTime();
  if (lastPrompt.isValid() && lastPrompt.daysTo(QDateTime::currentDateTimeUtc()) < 7) return;
  if (!QFileInfo(QStringLiteral("/usr/bin/xdg-settings")).isExecutable()) {
    showDefaultBrowserPrompt(parent);
    return;
  }
  auto *check = new QProcess(parent);
  check->setProgram(QStringLiteral("/usr/bin/xdg-settings"));
  check->setArguments({QStringLiteral("get"), QStringLiteral("default-web-browser")});
  QObject::connect(check, qOverload<int, QProcess::ExitStatus>(&QProcess::finished), parent,
                   [parent, check](int exitCode, QProcess::ExitStatus exitStatus) {
    const QString desktopFile = QString::fromUtf8(check->readAllStandardOutput()).trimmed();
    const bool alreadyDefault = exitStatus == QProcess::NormalExit && exitCode == 0
        && desktopFile == QString::fromLatin1(kDaliNiraDesktopFile);
    check->deleteLater();
    if (!alreadyDefault) showDefaultBrowserPrompt(parent);
  });
  check->start();
#else
  Q_UNUSED(parent);
#endif
}

}  // namespace

int main(int argc, char *argv[]) {
  // Ensure Wayland / XWayland coordinate parity for window moves and tab dragging
  if (!qEnvironmentVariableIsSet("QT_QPA_PLATFORM") &&
      qEnvironmentVariableIsSet("DISPLAY") &&
      qgetenv("XDG_SESSION_TYPE") == "wayland") {
    qputenv("QT_QPA_PLATFORM", "xcb");
  }

  // Configure WebEngine subprocess allocator policy (MALLOC_ARENA_MAX=2, MALLOC_TRIM_THRESHOLD=128KB)
  // before QtWebEngine process is spawned.
  const QString appDir = QFileInfo(QString::fromLocal8Bit(argv[0])).dir().absolutePath();
  dalinira::WebEngineMemoryPolicy::configureSubprocessLauncher(appDir);

  // Initialize hardware video decoding and GPU flags early before QApplication / QtWebEngine init
  dalinira::WebEngineHardwareAcceleration::initializeEarlyRuntime();

  // Register dalinira:// URL scheme before QGuiApplication
  registerDaliNiraUrlSchemes();

  QApplication app(argc, argv);
  dalinira::application_identity::apply();
  app.setApplicationVersion(QStringLiteral(DALINIRA_BROWSER_VERSION));

  // Initialize central i18n / multi-language system
  dalinira::i18n::LanguageManager::instance().initialize();

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
      : QStringLiteral(DALINIRA_BROWSER_POLICY_PATH);
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
  if (qEnvironmentVariableIntValue("DALINIRA_FEATURE_DIAGNOSTICS") == 1) {
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
  auto &dragController = dalinira::desktop_tabs::TabDragController::instance();

  dragController.setDetachedWindowFactory(
      [services](QWidget *originWin, uint64_t /*tabId*/) -> QWidget * {
        auto *origin = dynamic_cast<BrowserWindow *>(originWin);
        if (!origin) return nullptr;
        auto *captureShell = new BrowserWindow(origin->services(), /*isCaptureShell=*/true);
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
  const QByteArray savedWindowGeometry =
      QSettings().value(QStringLiteral("browser/mainWindowGeometry")).toByteArray();
  if (!savedWindowGeometry.isEmpty()) {
    window->restoreGeometry(savedWindowGeometry);
  }

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
                                || scheme == QLatin1String("dalinira"))) {
      window->openStartupUrl(candidate);
      break;
    }
  }

  QObject::connect(&app, &QCoreApplication::aboutToQuit, window, [window] {
    window->saveSessionNow();
    QSettings settings;
    settings.setValue(QStringLiteral("browser/mainWindowGeometry"), window->saveGeometry());
    settings.sync();
  });

  window->show();
  QTimer::singleShot(1200, window, [window] { checkDefaultBrowser(window); });

  const int exitCode = app.exec();
  const auto topLevelWidgets = QApplication::topLevelWidgets();
  for (QWidget *w : topLevelWidgets) {
    if (auto *bw = qobject_cast<BrowserWindow *>(w)) {
      delete bw;
    }
  }
  return exitCode;
}
