#include "browser_window.h"

#include <QApplication>
#include <QHBoxLayout>
#include <QIcon>
#include <QKeyEvent>
#include <QLineEdit>
#include <QMenu>
#include <QAction>
#include <QMessageBox>
#include <QMouseEvent>
#include <QProgressBar>
#include <QStackedWidget>
#include <QStyle>
#include <QPainter>
#include <QPainterPath>
#include <QToolButton>
#include <QToolBar>
#include <QUrl>
#include <QUrlQuery>
#include <QJsonObject>
#include <QJsonDocument>
#include <QWebEngineHistory>
#include <QWebEngineProfile>
#include <QWebEngineSettings>
#include <QWebEngineScriptCollection>
#include <QWindow>
#include <atomic>
#include <algorithm>

#include "desktop_tabs/tab_drag_controller.h"
#include "desktop_tabs/tab_strip_widget.h"
#include "desktop_tabs/tab_window_registry.h"
#include "desktop_tabs/tab_search_popup.h"
#include "desktop_tabs/tab_group_model.h"
#include "desktop_tabs/tab_group_popup.h"
#include "desktop_tabs/tab_group_launcher_popup.h"
#include "core/browser_icons.h"
#include "core/browser_ui_metrics.h"
#include "blocker/ardali_blocker_service.h"
#include "passwords/credential_vault_manager.h"
#include "pulse/song_finder_settings_page.h"
#include "translate/translate_service.h"
#include <QShortcut>

namespace {
static std::atomic<uint64_t> s_tabIdSequence{1};

bool isNewTabUrl(const QUrl &url) {
  const QString scheme = url.scheme().toLower();
  const QString host = url.host().toLower();
  return (scheme == QLatin1String("ardali") && host == QLatin1String("newtab"));
}

bool isInternalOrNonWebUrl(const QUrl &url) {
  if (!url.isValid() || url.isEmpty()) return true;
  const QString scheme = url.scheme().toLower();
  if (scheme == QLatin1String("ardali") ||
      scheme == QLatin1String("about") ||
      scheme == QLatin1String("data") ||
      scheme == QLatin1String("file") ||
      scheme == QLatin1String("chrome") ||
      scheme == QLatin1String("edge")) {
    return true;
  }
  return isNewTabUrl(url);
}

QUrl searchUrlForEngine(const QString &engine, const QString &queryText) {
  const QString lower = engine.trimmed().toLower();
  QString baseUrl;
  if (lower.contains(QLatin1String("duckduckgo")) || lower.contains(QLatin1String("duck"))) {
    baseUrl = QStringLiteral("https://duckduckgo.com/?q=");
  } else if (lower.contains(QLatin1String("brave"))) {
    baseUrl = QStringLiteral("https://search.brave.com/search?q=");
  } else if (lower.contains(QLatin1String("bing"))) {
    baseUrl = QStringLiteral("https://www.bing.com/search?q=");
  } else {
    baseUrl = QStringLiteral("https://www.google.com/search?q=");
  }
  return QUrl(baseUrl + QString::fromUtf8(QUrl::toPercentEncoding(queryText)));
}

QString bookmarkDisplayName(const QUrl &url) {
  const QString host = url.host().toLower();
  if (host.endsWith(QStringLiteral("youtube.com"))) return QStringLiteral("YouTube");
  if (host.endsWith(QStringLiteral("github.com"))) return QStringLiteral("GitHub");
  if (host.endsWith(QStringLiteral("wikipedia.org"))) return QStringLiteral("Wikipedia");
  if (host.endsWith(QStringLiteral("google.com"))) return QStringLiteral("Google");
  if (host.endsWith(QStringLiteral("duckduckgo.com"))) return QStringLiteral("DuckDuckGo");
  if (host.endsWith(QStringLiteral("facebook.com"))) return QStringLiteral("Facebook");
  if (host.endsWith(QStringLiteral("instagram.com"))) return QStringLiteral("Instagram");
  if (host.endsWith(QStringLiteral("openai.com")) || host.endsWith(QStringLiteral("chatgpt.com"))) return QStringLiteral("ChatGPT");
  if (host.endsWith(QStringLiteral("gitlab.com"))) return QStringLiteral("GitLab");
  if (host.endsWith(QStringLiteral("twitter.com")) || host.endsWith(QStringLiteral("x.com"))) return QStringLiteral("X");
  if (host.endsWith(QStringLiteral("threads.net"))) return QStringLiteral("Threads");
  if (host.endsWith(QStringLiteral("reddit.com"))) return QStringLiteral("Reddit");
  if (host.endsWith(QStringLiteral("tiktok.com"))) return QStringLiteral("TikTok");
  if (host.endsWith(QStringLiteral("linkedin.com"))) return QStringLiteral("LinkedIn");
  QString clean = host;
  if (clean.startsWith(QStringLiteral("www."))) clean.remove(0, 4);
  return clean.isEmpty() ? url.toDisplayString() : clean;
}

QIcon bookmarkIcon(bool bookmarked) {
  QPixmap pixmap(32, 32);
  pixmap.fill(Qt::transparent);
  QPainter painter(&pixmap);
  painter.setRenderHint(QPainter::Antialiasing);
  const QColor color = bookmarked ? QColor(QStringLiteral("#4fc3f7")) : QColor(QStringLiteral("#d8dce0"));
  QPainterPath ribbon;
  ribbon.moveTo(10.0, 5.5);
  ribbon.lineTo(22.0, 5.5);
  ribbon.lineTo(22.0, 25.0);
  ribbon.lineTo(16.0, 20.7);
  ribbon.lineTo(10.0, 25.0);
  ribbon.closeSubpath();
  painter.setPen(QPen(color, 2.0, Qt::SolidLine, Qt::RoundCap, Qt::RoundJoin));
  painter.setBrush(bookmarked ? QBrush(color) : Qt::NoBrush);
  painter.drawPath(ribbon);
  return QIcon(pixmap);
}

QIcon platformIconForBookmark(const QUrl &url) {
  const QString host = url.host().toLower();
  QPixmap pixmap(24, 24);
  pixmap.fill(Qt::transparent);
  QPainter painter(&pixmap);
  painter.setRenderHint(QPainter::Antialiasing);

  if (host.endsWith(QStringLiteral("duckduckgo.com"))) {
    return BrowserIcons::searchEngineIcon(QStringLiteral("DuckDuckGo"));
  }
  if (host.endsWith(QStringLiteral("gitlab.com"))) {
    painter.setPen(Qt::NoPen);
    painter.setBrush(QColor(QStringLiteral("#fc6d26")));
    painter.drawRoundedRect(QRectF(1, 1, 22, 22), 4, 4);
    painter.setPen(Qt::white);
    QFont font = painter.font();
    font.setBold(true);
    font.setPixelSize(10);
    painter.setFont(font);
    painter.drawText(pixmap.rect(), Qt::AlignCenter, QStringLiteral("GL"));
    return QIcon(pixmap);
  }
  if (host.endsWith(QStringLiteral("openai.com")) || host.endsWith(QStringLiteral("chatgpt.com"))) {
    painter.setPen(Qt::NoPen);
    painter.setBrush(QColor(QStringLiteral("#10a37f")));
    painter.drawEllipse(QRectF(1, 1, 22, 22));
    painter.setPen(Qt::white);
    QFont font = painter.font();
    font.setBold(true);
    font.setPixelSize(10);
    painter.setFont(font);
    painter.drawText(pixmap.rect(), Qt::AlignCenter, QStringLiteral("AI"));
    return QIcon(pixmap);
  }
  if (host.endsWith(QStringLiteral("youtube.com"))) {
    painter.setPen(Qt::NoPen);
    painter.setBrush(QColor(QStringLiteral("#ff0000")));
    painter.drawRoundedRect(QRectF(1, 4, 22, 16), 4, 4);
    painter.setBrush(Qt::white);
    QPolygonF triangle;
    triangle << QPointF(9.5, 8.5) << QPointF(16, 12) << QPointF(9.5, 15.5);
    painter.drawPolygon(triangle);
    return QIcon(pixmap);
  }
  if (host.endsWith(QStringLiteral("github.com"))) {
    painter.setPen(Qt::NoPen);
    painter.setBrush(QColor(QStringLiteral("#24292f")));
    painter.drawEllipse(QRectF(1, 1, 22, 22));
    painter.setPen(Qt::white);
    QFont font = painter.font();
    font.setBold(true);
    font.setPixelSize(10);
    painter.setFont(font);
    painter.drawText(pixmap.rect(), Qt::AlignCenter, QStringLiteral("GH"));
    return QIcon(pixmap);
  }
  if (host.endsWith(QStringLiteral("facebook.com"))) {
    painter.setPen(Qt::NoPen);
    painter.setBrush(QColor(QStringLiteral("#1877f2")));
    painter.drawEllipse(QRectF(1, 1, 22, 22));
    painter.setPen(Qt::white);
    QFont font = painter.font();
    font.setBold(true);
    font.setPixelSize(15);
    painter.setFont(font);
    painter.drawText(QRectF(3, 0, 20, 24), Qt::AlignCenter, QStringLiteral("f"));
    return QIcon(pixmap);
  }
  if (host.endsWith(QStringLiteral("instagram.com"))) {
    QLinearGradient grad(0, 24, 24, 0);
    grad.setColorAt(0.0, QColor(QStringLiteral("#f09433")));
    grad.setColorAt(0.3, QColor(QStringLiteral("#e6683c")));
    grad.setColorAt(0.6, QColor(QStringLiteral("#dc2743")));
    grad.setColorAt(1.0, QColor(QStringLiteral("#bc1888")));
    painter.setPen(Qt::NoPen);
    painter.setBrush(grad);
    painter.drawRoundedRect(QRectF(1, 1, 22, 22), 5, 5);
    painter.setPen(QPen(Qt::white, 1.6));
    painter.setBrush(Qt::NoBrush);
    painter.drawRoundedRect(QRectF(4.5, 4.5, 15, 15), 3.5, 3.5);
    painter.drawEllipse(QRectF(8, 8, 8, 8));
    painter.setBrush(Qt::white);
    painter.drawEllipse(QRectF(15.5, 6.5, 1.8, 1.8));
    return QIcon(pixmap);
  }
  if (host.endsWith(QStringLiteral("google.com"))) {
    painter.setPen(Qt::NoPen);
    painter.setBrush(QColor(QStringLiteral("#4285f4")));
    painter.drawEllipse(QRectF(1, 1, 22, 22));
    painter.setPen(Qt::white);
    QFont font = painter.font();
    font.setBold(true);
    font.setPixelSize(14);
    painter.setFont(font);
    painter.drawText(pixmap.rect(), Qt::AlignCenter, QStringLiteral("G"));
    return QIcon(pixmap);
  }
  if (host.endsWith(QStringLiteral("wikipedia.org"))) {
    painter.setPen(Qt::NoPen);
    painter.setBrush(QColor(QStringLiteral("#eef0f2")));
    painter.drawEllipse(QRectF(1, 1, 22, 22));
    painter.setPen(QColor(QStringLiteral("#202122")));
    QFont font = painter.font();
    font.setBold(true);
    font.setPixelSize(13);
    painter.setFont(font);
    painter.drawText(pixmap.rect(), Qt::AlignCenter, QStringLiteral("W"));
    return QIcon(pixmap);
  }
  if (host.endsWith(QStringLiteral("threads.net"))) {
    painter.setPen(Qt::NoPen);
    painter.setBrush(QColor(QStringLiteral("#101010")));
    painter.drawEllipse(QRectF(1, 1, 22, 22));
    painter.setPen(Qt::white);
    QFont font = painter.font();
    font.setBold(true);
    font.setPixelSize(14);
    painter.setFont(font);
    painter.drawText(pixmap.rect(), Qt::AlignCenter, QStringLiteral("@"));
    return QIcon(pixmap);
  }

  // Fallback initial icon
  QString initial = host.section(QLatin1Char('.'), 0, 0).left(1).toUpper();
  if (initial.isEmpty()) initial = QStringLiteral("★");
  const QColor bg = QColor::fromHsv(int(qHash(host) % 360), 140, 180);
  painter.setPen(Qt::NoPen);
  painter.setBrush(bg);
  painter.drawRoundedRect(QRectF(1, 1, 22, 22), 4, 4);
  painter.setPen(Qt::white);
  QFont font = painter.font();
  font.setBold(true);
  font.setPixelSize(12);
  painter.setFont(font);
  painter.drawText(pixmap.rect(), Qt::AlignCenter, initial);
  return QIcon(pixmap);
}
}  // namespace

BrowserWindow::BrowserWindow(const BrowserServices &services, bool isCaptureShell, QWidget *parent)
    : QMainWindow(parent), services_(services), isCaptureShell_(isCaptureShell) {
  setObjectName(QStringLiteral("BrowserWindow"));
  setWindowFlag(Qt::FramelessWindowHint, true);
  setAttribute(Qt::WA_Hover, true);
  setMouseTracking(true);
  setMinimumSize(640, 420);
  resize(1200, 800);
  lastNormalSize_ = size();
  lastNormalGeometry_ = geometry();
  setProperty("ardaliRestoredSize", lastNormalSize_);

  if (!services_.profile) {
    services_.profile = QWebEngineProfile::defaultProfile();
  }

  setupUi();
  setupStyle();
  setupTabStripSignals();

  // Register in global registry for tab drag & attach
  ardali::desktop_tabs::TabWindowRegistry::instance().registerWindow(this, tabStrip_);

  if (isCaptureShell_) {
    setProperty("ardaliDragCaptureShell", true);
  }
}

BrowserWindow::~BrowserWindow() {
  ardali::desktop_tabs::TabWindowRegistry::instance().unregisterWindow(this);
}

void BrowserWindow::setupUi() {
  using Metrics = ardali::ui::BrowserChromeMetrics;

  auto *central = new QWidget(this);
  central->setObjectName(QStringLiteral("centralRoot"));
  central->setMouseTracking(true);
  auto *rootLayout = new QVBoxLayout(central);
  rootLayout->setContentsMargins(0, 0, 0, 0);
  rootLayout->setSpacing(0);

  // 1. Chrome Unified Titlebar / Top Bar
  topBar_ = new QWidget(central);
  topBar_->setObjectName(QStringLiteral("topBar"));
  topBar_->setFixedHeight(Metrics::topBarHeight);
  topBar_->setMouseTracking(true);
  auto *topLayout = new QHBoxLayout(topBar_);
  topLayout->setContentsMargins(8, 0, 0, 0);
  topLayout->setSpacing(4);

  // Tab Search Button (Chrome top-left)
  tabSearchBtn_ = new QToolButton(topBar_);
  tabSearchBtn_->setObjectName(QStringLiteral("tabSearchBtn"));
  tabSearchBtn_->setText(QString::fromUtf8("⌵"));
  tabSearchBtn_->setToolTip(QStringLiteral("Sekmelerde ara (Ctrl+Shift+A)"));
  tabSearchBtn_->setFixedSize(Metrics::tabSearchButtonSize,
                              Metrics::tabSearchButtonSize);
  connect(tabSearchBtn_, &QToolButton::clicked, this, &BrowserWindow::toggleTabSearchPopup);
  topLayout->addWidget(tabSearchBtn_, 0, Qt::AlignVCenter);

  auto *tabSearchShortcut = new QShortcut(QKeySequence(Qt::CTRL | Qt::SHIFT | Qt::Key_A), this);
  connect(tabSearchShortcut, &QShortcut::activated, this, &BrowserWindow::toggleTabSearchPopup);

  auto *groupShortcut = new QShortcut(QKeySequence(Qt::ALT | Qt::SHIFT | Qt::Key_P), this);
  connect(groupShortcut, &QShortcut::activated, this, [this] {
    if (tabGroupLauncherPopup_ && tabGroupLauncherPopup_->isVisible()) {
      tabGroupLauncherPopup_->close();
    }
    createNewTabGroupWithNewTab();
  });

  auto *addTabInGroupShortcut = new QShortcut(QKeySequence(Qt::ALT | Qt::SHIFT | Qt::Key_C), this);
  connect(addTabInGroupShortcut, &QShortcut::activated, this, [this] {
    const int currentIdx = tabStrip_->currentIndex();
    if (currentIdx >= 0 && currentIdx < tabs_.size() && tabs_[currentIdx].groupId.has_value()) {
      addTabToGroup(*tabs_[currentIdx].groupId);
    }
  });

  auto *closeGroupShortcut = new QShortcut(QKeySequence(Qt::ALT | Qt::SHIFT | Qt::Key_W), this);
  connect(closeGroupShortcut, &QShortcut::activated, this, [this] {
    const int currentIdx = tabStrip_->currentIndex();
    if (currentIdx >= 0 && currentIdx < tabs_.size() && tabs_[currentIdx].groupId.has_value()) {
      closeTabGroup(*tabs_[currentIdx].groupId);
    }
  });

  // Tab Strip (Chromium TabStripWidget)
  tabStrip_ = new ardali::desktop_tabs::TabStripWidget(topBar_);
  tabStrip_->setObjectName(QStringLiteral("tabStrip"));
  tabStrip_->setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Fixed);
  groupModel_ = new ardali::desktop_tabs::TabGroupModel(this);
  tabStrip_->setGroupModel(groupModel_);
  connect(tabStrip_, &ardali::desktop_tabs::TabStripWidget::groupChipClicked,
          this, [this](const QUuid &groupId, const QPoint &globalPos) {
    showTabGroupPopup(groupId, globalPos);
  });
  topLayout->addWidget(tabStrip_, 1);

  // Window Caption Controls (Chrome top-right: Minimize, Maximize, Close)
  auto *captionBox = new QWidget(topBar_);
  captionBox->setObjectName(QStringLiteral("captionBox"));
  captionBox->setFixedHeight(Metrics::topBarHeight);
  auto *captionLayout = new QHBoxLayout(captionBox);
  captionLayout->setContentsMargins(0, 0, 0, 0);
  captionLayout->setSpacing(0);

  minBtn_ = new QToolButton(captionBox);
  minBtn_->setObjectName(QStringLiteral("windowControlMin"));
  minBtn_->setText(QString::fromUtf8("−"));
  minBtn_->setToolTip(QStringLiteral("Simge Durumuna Küçült"));
  minBtn_->setFixedSize(46, Metrics::topBarHeight);

  maxBtn_ = new QToolButton(captionBox);
  maxBtn_->setObjectName(QStringLiteral("windowControlMax"));
  maxBtn_->setText(QString::fromUtf8("□"));
  maxBtn_->setToolTip(QStringLiteral("Ekranı Kapla / Geri Yükle"));
  maxBtn_->setFixedSize(46, Metrics::topBarHeight);

  closeBtn_ = new QToolButton(captionBox);
  closeBtn_->setObjectName(QStringLiteral("windowControlClose"));
  closeBtn_->setText(QString::fromUtf8("✕"));
  closeBtn_->setToolTip(QStringLiteral("Kapat"));
  closeBtn_->setFixedSize(46, Metrics::topBarHeight);

  captionLayout->addWidget(minBtn_);
  captionLayout->addWidget(maxBtn_);
  captionLayout->addWidget(closeBtn_);
  topLayout->addWidget(captionBox, 0, Qt::AlignTop | Qt::AlignRight);

  rootLayout->addWidget(topBar_);

  // Connect Window Caption Buttons
  connect(minBtn_, &QToolButton::clicked, this, &BrowserWindow::onMinimizeClicked);
  connect(maxBtn_, &QToolButton::clicked, this, &BrowserWindow::onMaximizeRestoreClicked);
  connect(closeBtn_, &QToolButton::clicked, this, &BrowserWindow::onCloseWindowClicked);

  // 2. Navigation Bar
  navBar_ = new QWidget(central);
  navBar_->setObjectName(QStringLiteral("navBar"));
  navBar_->setFixedHeight(Metrics::navigationBarHeight);
  auto *navLayout = new QHBoxLayout(navBar_);
  navLayout->setContentsMargins(10, 6, 10, 6);
  navLayout->setSpacing(7);

  const auto configureNavigationButton = [](QToolButton *button) {
    button->setFixedSize(Metrics::navigationButtonSize,
                         Metrics::navigationButtonSize);
    button->setIconSize(QSize(Metrics::navigationIconSize,
                              Metrics::navigationIconSize));
  };

  backBtn_ = new QToolButton(navBar_);
  backBtn_->setObjectName(QStringLiteral("backBtn"));
  backBtn_->setText(QString::fromUtf8("←"));
  backBtn_->setToolTip(QStringLiteral("Geri (Alt+Sol)"));
  backBtn_->setEnabled(false);
  configureNavigationButton(backBtn_);
  navLayout->addWidget(backBtn_);

  forwardBtn_ = new QToolButton(navBar_);
  forwardBtn_->setObjectName(QStringLiteral("forwardBtn"));
  forwardBtn_->setText(QString::fromUtf8("→"));
  forwardBtn_->setToolTip(QStringLiteral("İleri (Alt+Sağ)"));
  forwardBtn_->setEnabled(false);
  configureNavigationButton(forwardBtn_);
  navLayout->addWidget(forwardBtn_);

  reloadBtn_ = new QToolButton(navBar_);
  reloadBtn_->setObjectName(QStringLiteral("reloadBtn"));
  reloadBtn_->setText(QString::fromUtf8("↻"));
  reloadBtn_->setToolTip(QStringLiteral("Yenile (Ctrl+R)"));
  configureNavigationButton(reloadBtn_);
  navLayout->addWidget(reloadBtn_);

  bookmarkBtn_ = new QToolButton(navBar_);
  bookmarkBtn_->setObjectName(QStringLiteral("bookmark-button"));
  bookmarkBtn_->setIcon(BrowserIcons::icon(BrowserIcon::Bookmark));
  bookmarkBtn_->setToolTip(QStringLiteral("Yer imi ekle"));
  configureNavigationButton(bookmarkBtn_);
  navLayout->addWidget(bookmarkBtn_);

  // Google Search / Omnibox
  omnibox_ = new QLineEdit(navBar_);
  omnibox_->setObjectName(QStringLiteral("omnibox"));
  omnibox_->setPlaceholderText(QStringLiteral("Adres veya arama girin"));
  omnibox_->setClearButtonEnabled(true);
  omnibox_->setFixedHeight(Metrics::omniboxHeight);
  searchEngineAction_ = omnibox_->addAction(BrowserIcons::searchEngineIcon(currentSearchEngine()), QLineEdit::LeadingPosition);
  searchEngineAction_->setToolTip(QStringLiteral("Arama motoru: %1").arg(currentSearchEngine()));
  connect(searchEngineAction_, &QAction::triggered, this, [this] {
    showSettings(SettingsPage::Category::Search);
  });
  if (services_.profileService) {
    connect(services_.profileService, &BrowserProfileService::searchEngineChanged, this, [this](const QString &) {
      updateSearchEngineIcon();
    });
  }
  navLayout->addWidget(omnibox_, 1);

  // Feature buttons in Toolbar
  zoomButton_ = new QToolButton(navBar_);
  zoomButton_->setObjectName(QStringLiteral("zoomButton"));
  zoomButton_->setIcon(BrowserIcons::icon(BrowserIcon::Zoom));
  zoomButton_->setToolTip(QStringLiteral("Sayfa yakınlaştırma"));
  configureNavigationButton(zoomButton_);
  zoomButton_->hide();
  navLayout->addWidget(zoomButton_);

  translateButton_ = new QToolButton(navBar_);
  translateButton_->setObjectName(QStringLiteral("translateButton"));
  translateButton_->setIcon(BrowserIcons::icon(BrowserIcon::Language));
  translateButton_->setToolTip(QStringLiteral("Bu sayfayı Türkçeye çevir"));
  configureNavigationButton(translateButton_);
  translateButton_->hide();
  navLayout->addWidget(translateButton_);

  // AdBlock Shield Button
  auto *adblock = services_.profileService ? services_.profileService->adBlockService() : nullptr;
  adBlockShield_ = new ArDaliBlockerShieldButton(adblock, navBar_);
  configureNavigationButton(adBlockShield_);
  navLayout->addWidget(adBlockShield_);

  // Pulse (Song recognition) Button
  pulseButton_ = new PulseToolbarButton(services_.songRecognition, services_.songFinderSettings, navBar_);
  configureNavigationButton(pulseButton_);
  navLayout->addWidget(pulseButton_);

  // Media Download Action Button
  mediaDownload_ = new QToolButton(navBar_);
  mediaDownload_->setObjectName(QStringLiteral("mediaDownloadButton"));
  mediaDownload_->setIcon(BrowserIcons::icon(BrowserIcon::Download));
  mediaDownload_->setToolTip(QStringLiteral("Bu sayfadaki medyayı indir"));
  configureNavigationButton(mediaDownload_);
  navLayout->addWidget(mediaDownload_);

  // Password Manager Button
  passwordsBtn_ = new QToolButton(navBar_);
  passwordsBtn_->setObjectName(QStringLiteral("passwordsButton"));
  passwordsBtn_->setIcon(BrowserIcons::icon(BrowserIcon::Password));
  passwordsBtn_->setToolTip(QStringLiteral("Şifre Yöneticisi"));
  configureNavigationButton(passwordsBtn_);
  navLayout->addWidget(passwordsBtn_);

  // Main Menu (Hamburger) Button
  mainMenuBtn_ = new QToolButton(navBar_);
  mainMenuBtn_->setObjectName(QStringLiteral("mainMenuButton"));
  mainMenuBtn_->setText(QString::fromUtf8("☰"));
  mainMenuBtn_->setToolTip(QStringLiteral("Ana menü"));
  configureNavigationButton(mainMenuBtn_);
  navLayout->addWidget(mainMenuBtn_);

  rootLayout->addWidget(navBar_);

  // Bookmark Bar (Under navigation bar)
  bookmarkBar_ = new QToolBar(central);
  bookmarkBar_->setObjectName(QStringLiteral("bookmark-bar"));
  bookmarkBar_->setMovable(false);
  bookmarkBar_->setIconSize(QSize(Metrics::bookmarkIconSize,
                                  Metrics::bookmarkIconSize));
  bookmarkBar_->setFixedHeight(Metrics::bookmarkBarHeight);
  bookmarkBar_->setToolButtonStyle(Qt::ToolButtonTextBesideIcon);
  rootLayout->addWidget(bookmarkBar_);

  // Seed default bookmarks if empty on startup
  if (services_.profileService && services_.profileService->bookmarks().isEmpty()) {
    services_.profileService->toggleBookmark(QUrl(QStringLiteral("https://github.com/")));
    services_.profileService->toggleBookmark(QUrl(QStringLiteral("https://www.youtube.com/")));
    services_.profileService->toggleBookmark(QUrl(QStringLiteral("https://www.facebook.com/")));
    services_.profileService->toggleBookmark(QUrl(QStringLiteral("https://www.instagram.com/")));
  }
  renderBookmarks();

  // 3. Thin loading progress bar (Chrome blue accent)
  progressBar_ = new QProgressBar(central);
  progressBar_->setObjectName(QStringLiteral("loadProgressBar"));
  progressBar_->setFixedHeight(2);
  progressBar_->setTextVisible(false);
  progressBar_->setRange(0, 100);
  progressBar_->hide();
  rootLayout->addWidget(progressBar_);

  // 4. Page Content Stack
  pageStack_ = new QStackedWidget(central);
  pageStack_->setObjectName(QStringLiteral("pageStack"));
  rootLayout->addWidget(pageStack_, 1);

  setCentralWidget(central);

  // Connect navigation buttons
  connect(backBtn_, &QToolButton::clicked, this, &BrowserWindow::onBackClicked);
  connect(forwardBtn_, &QToolButton::clicked, this, &BrowserWindow::onForwardClicked);
  connect(reloadBtn_, &QToolButton::clicked, this, &BrowserWindow::onReloadOrStopClicked);
  if (homeBtn_) connect(homeBtn_, &QToolButton::clicked, this, &BrowserWindow::onHomeClicked);
  connect(omnibox_, &QLineEdit::returnPressed, this, &BrowserWindow::onOmniboxReturnPressed);

  // Connect feature buttons
  connect(adBlockShield_, &ArDaliBlockerShieldButton::openSettingsRequested, this, [this] {
    showArDaliBlockerSettings(ArDaliBlockerPage::Tab::Settings);
  });
  connect(adBlockShield_, &ArDaliBlockerShieldButton::openLoggerRequested, this, [this] {
    showArDaliBlockerSettings(ArDaliBlockerPage::Tab::Logger);
  });
  connect(adBlockShield_, &ArDaliBlockerShieldButton::reloadRequested, this, [this] {
    if (auto *view = currentView()) {
      prepareAdBlockScripts(view->page(), view->url(), true);
      view->reload();
    }
  });
  if (adblock) {
    connect(adblock, &ArDaliBlockerService::tabStatsChanged, this, [this](quint64 tabId, const TabBlockerStats &stats) {
      if (auto *view = currentView()) {
        const quint64 currentId = reinterpret_cast<quintptr>(view);
        if (tabId == currentId && adBlockShield_) {
          if (isInternalOrNonWebUrl(view->url())) {
            adBlockShield_->setInternalPage(true);
            adBlockShield_->setActiveHost(QString());
            adBlockShield_->setBlockedCount(0);
          } else {
            adBlockShield_->setInternalPage(false);
            adBlockShield_->setActiveHost(view->url().host().toLower());
            adBlockShield_->setBlockedCount(stats.blockedRequests);
            adBlockShield_->setToolTip(stats.blockedRequests > 0
                ? QStringLiteral("ArDali Koruma: %1 (%2 istek engellendi)").arg(view->url().host()).arg(stats.blockedRequests)
                : QStringLiteral("ArDali Koruma: %1 (Etkin)").arg(view->url().host()));
          }
        }
      }
    });
    connect(adblock, &ArDaliBlockerService::autoReloadRequested, this, [this] {
      if (auto *view = currentView()) {
        prepareAdBlockScripts(view->page(), view->url(), true);
        view->reload();
      }
    });
  }

  connect(pulseButton_, &PulseToolbarButton::openFullPageRequested, this, &BrowserWindow::showSongFinder);
  connect(pulseButton_, &PulseToolbarButton::openSettingsRequested, this, &BrowserWindow::showSongFinderSettings);
  connect(pulseButton_, &PulseToolbarButton::openUrlRequested, this, [this](const QUrl &url) {
    addNewTab(url);
  });

  connect(mediaDownload_, &QToolButton::clicked, this, [this] {
    const QUrl activeUrl = currentView() ? currentView()->url() : QUrl{};
    showMediaDownloads(activeUrl, true);
  });

  connect(passwordsBtn_, &QToolButton::clicked, this, &BrowserWindow::showPasswords);
  connect(bookmarkBtn_, &QToolButton::clicked, this, &BrowserWindow::toggleCurrentBookmark);
  connect(mainMenuBtn_, &QToolButton::clicked, this, &BrowserWindow::showMainMenu);
  if (services_.profileService) {
    connect(services_.profileService, &BrowserProfileService::bookmarksChanged, this, &BrowserWindow::renderBookmarks);
  }

  connect(translateButton_, &QToolButton::clicked, this, &BrowserWindow::showTranslatePopup);
  connect(zoomButton_, &QToolButton::clicked, this, &BrowserWindow::showZoomPopup);
}

void BrowserWindow::setupStyle() {
  setStyleSheet(QStringLiteral(
      "QMainWindow { background-color: #1c1b22; }"
      "#centralRoot { background-color: #1c1b22; }"
      "#topBar { background-color: #1c1b22; }"
      "#tabStrip { background-color: #1c1b22; }"
      "#tabSearchBtn {"
      "  color: #c4c7c5;"
      "  background: transparent;"
      "  border: none;"
      "  border-radius: 14px;"
      "  font-size: 13px;"
      "  font-weight: bold;"
      "}"
      "#tabSearchBtn:hover { background-color: rgba(255, 255, 255, 0.12); }"
      "#captionBox { background: transparent; }"
      "#windowControlMin, #windowControlMax, #windowControlClose {"
      "  color: #c4c7c5;"
      "  background: transparent;"
      "  border: none;"
      "  font-size: 15px;"
      "  font-family: monospace, sans-serif;"
      "}"
      "#windowControlMin:hover, #windowControlMax:hover {"
      "  background-color: rgba(255, 255, 255, 0.12);"
      "  color: #ffffff;"
      "}"
      "#windowControlClose:hover {"
      "  background-color: #e81123;"
      "  color: #ffffff;"
      "}"
      "#navBar {"
      "  background-color: #2b2a33;"
      "  border: none;"
      "}"
      "#bookmark-bar {"
      "  background-color: #2b2a33;"
      "  border: none;"
      "  border-bottom: 1px solid #1c1b22;"
      "  spacing: 4px;"
      "  padding: 2px 8px;"
      "  min-height: 32px;"
      "  max-height: 32px;"
      "}"
      "#bookmark-bar QToolButton {"
      "  color: #d8dce0;"
      "  background: transparent;"
      "  border: none;"
      "  border-radius: 4px;"
      "  padding: 3px 8px;"
      "  font-size: 13px;"
      "  font-weight: 500;"
      "  min-width: 24px;"
      "  max-width: 220px;"
      "  min-height: 28px;"
      "  max-height: 28px;"
      "  qproperty-toolButtonStyle: ToolButtonTextBesideIcon;"
      "}"
      "#bookmark-bar QToolButton:hover {"
      "  background-color: rgba(255, 255, 255, 0.12);"
      "  color: #ffffff;"
      "}"
      "#bookmark-bar #appsButton {"
      "  min-width: 30px;"
      "  max-width: 30px;"
      "  min-height: 28px;"
      "  max-height: 28px;"
      "  padding: 2px;"
      "  border-radius: 4px;"
      "  qproperty-toolButtonStyle: ToolButtonIconOnly;"
      "}"
      "#mediaDownloadButton[activeMedia=\"true\"] {"
      "  color: #4fc3f7;"
      "  background-color: rgba(79, 195, 247, 0.22);"
      "  border-radius: 14px;"
      "}"
      "#navBar QToolButton, #tabSearchBtn {"
      "  color: #fbfbfe;"
      "  background: transparent;"
      "  border: none;"
      "  border-radius: 16px;"
      "  min-width: 32px;"
      "  max-width: 32px;"
      "  min-height: 32px;"
      "  max-height: 32px;"
      "  font-size: 18px;"
      "  font-weight: bold;"
      "}"
      "#navBar QToolButton:hover, #tabSearchBtn:hover {"
      "  background-color: rgba(255, 255, 255, 0.12);"
      "}"
      "#navBar QToolButton:disabled, #tabSearchBtn:disabled { color: #5b5b66; }"
      "#omnibox {"
      "  background-color: #1c1b22;"
      "  color: #fbfbfe;"
      "  border: 1px solid #3c4043;"
      "  border-radius: 17px;"
      "  padding: 4px 14px;"
      "  font-size: 14px;"
      "  selection-background-color: #8ab4f8;"
      "  selection-color: #1c1b22;"
      "}"
      "#omnibox:focus {"
      "  border: 2px solid #8ab4f8;"
      "  background-color: #16151d;"
      "}"
      "#loadProgressBar {"
      "  border: none;"
      "  background: transparent;"
      "  height: 2px;"
      "}"
      "#loadProgressBar::chunk {"
      "  background-color: #8ab4f8;"
      "}"
  ));
}

void BrowserWindow::setupTabStripSignals() {
  connect(tabStrip_, &ardali::desktop_tabs::TabStripWidget::newTabRequested, this, [this] {
    addNewTab(QUrl(QStringLiteral("ardali://newtab/")));
  });

  connect(tabStrip_, &ardali::desktop_tabs::TabStripWidget::tabCloseRequested, this, [this](int index) {
    closeTab(index);
  });

  connect(tabStrip_, &ardali::desktop_tabs::TabStripWidget::currentChanged, this, [this](int index) {
    switchTab(index);
  });

  connect(tabStrip_, &ardali::desktop_tabs::TabStripWidget::tabMoved, this, [this](int from, int to) {
    moveTab(from, to);
  });

  connect(tabStrip_, &ardali::desktop_tabs::TabStripWidget::dragInitiated, this,
          [this](int index, const QPoint &screenPosition, const QPoint &pressOffsetInTab, const QSize &) {
    if (index < 0 || index >= tabs_.size()) return;
    const QPoint offsetInWindow = mapFromGlobal(screenPosition);
    ardali::desktop_tabs::TabDragController::instance().handleMousePress(
        this, tabStrip_, index, screenPosition, pressOffsetInTab, offsetInWindow);
  });
}

void BrowserWindow::prepareAdBlockScripts(QWebEnginePage *page, const QUrl &url, bool force) {
  if (!page) return;
  const QString planKey = QStringLiteral("%1://%2").arg(url.scheme().toLower(), url.host().toLower());
  if (!force && page->property("ardali-adblock-script-plan").toString() == planKey) return;
  page->setProperty("ardali-adblock-script-plan", planKey);

  static const QStringList names = {
      QStringLiteral("ardali-adblock-cosmetic"),
      QStringLiteral("ardali-adblock-scriptlets-main"),
      QStringLiteral("ardali-adblock-scriptlets-isolated"),
      QStringLiteral("ardali-adblock-procedural")};
  for (const QString &name : names) {
    const auto installed = page->scripts().find(name);
    for (const QWebEngineScript &script : installed) page->scripts().remove(script);
  }
  if (!services_.profileService || !services_.profileService->adBlockService()) return;
  const QString scheme = url.scheme().toLower();
  if (scheme != QLatin1String("http") && scheme != QLatin1String("https")) return;
  for (const QWebEngineScript &script :
       services_.profileService->adBlockService()->createScriptingScriptsForHost(url.host().toLower())) {
    page->scripts().insert(script);
  }
}

int BrowserWindow::addNewTab(const QUrl &url, int insertIndex) {
  QUrl targetUrl = url;
  if (targetUrl.isEmpty()) {
    targetUrl = QUrl(QStringLiteral("ardali://newtab/"));
  }

  // Handle internal scheme navigations directly
  const QString scheme = targetUrl.scheme().toLower();
  const QString host = targetUrl.host().toLower();
  if (scheme == QLatin1String("ardali") && host != QLatin1String("newtab")) {
    if (host == QLatin1String("settings")) { showSettings(); return tabStrip_->currentIndex(); }
    if (host == QLatin1String("passwords")) { showPasswords(); return tabStrip_->currentIndex(); }
    if (host == QLatin1String("audio-effects")) { showAudioEffects(); return tabStrip_->currentIndex(); }
    if (host == QLatin1String("eq-presets")) { showEqPresetBrowser(); return tabStrip_->currentIndex(); }
    if (host == QLatin1String("blocker")) { showArDaliBlockerSettings(); return tabStrip_->currentIndex(); }
    if (host == QLatin1String("downloads")) { showMediaDownloads(); return tabStrip_->currentIndex(); }
    if (host == QLatin1String("listen") || host == QLatin1String("pulse")) { showSongFinder(); return tabStrip_->currentIndex(); }
    if (host == QLatin1String("listen-settings")) { showSongFinderSettings(); return tabStrip_->currentIndex(); }
  }

  auto *view = new QWebEngineView(pageStack_);
  if (services_.profile) {
    auto *page = new QWebEnginePage(services_.profile, view);
    view->setPage(page);
  }

  // Audio Effects registration
  if (services_.audioEffects) {
    services_.audioEffects->registerWebView(view);
  }

  // Blocker tab registration
  if (services_.profileService && services_.profileService->adBlockService()) {
    const quint64 adBlockTabId = reinterpret_cast<quintptr>(view);
    services_.profileService->adBlockService()->registerTab(adBlockTabId, targetUrl);
    services_.profileService->adBlockService()->setActiveTabId(adBlockTabId);
  }

  // Permission handling (microphone, media capture, fullscreen)
  if (view->page()) {
    view->page()->settings()->setAttribute(QWebEngineSettings::FullScreenSupportEnabled, true);
#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
    connect(view->page(), &QWebEnginePage::permissionRequested, this, [this](const QWebEnginePermission &permission) {
      if (services_.profileService) services_.profileService->handlePermission(permission);
      else permission.deny();
    });
#else
    connect(view->page(), &QWebEnginePage::featurePermissionRequested, this,
            [view](const QUrl &origin, QWebEnginePage::Feature feature) {
      view->page()->setFeaturePermission(origin, feature, QWebEnginePage::PermissionGrantedByUser);
    });
#endif
  }

  const uint64_t tabId = s_tabIdSequence.fetch_add(1);
  BrowserTabInfo info;
  info.id = tabId;
  info.title = QStringLiteral("Yeni Sekme");
  info.url = targetUrl;
  info.view = view;
  info.isInternal = false;
  info.icon = BrowserIcons::appIcon();
  info.uuid = services_.tabManager
      ? services_.tabManager->registerTab(view, this, false, info.title)
      : QUuid::createUuid();

  wireViewSignals(view, tabId);

  const int index = (insertIndex >= 0 && insertIndex <= tabs_.size())
      ? insertIndex : tabs_.size();

  tabs_.insert(index, info);
  pageStack_->insertWidget(index, view);
  tabStrip_->insertTab(index, tabId, info.title, info.icon);

  prepareAdBlockScripts(view->page(), targetUrl);
  view->load(targetUrl);
  switchTab(index);

  return index;
}

int BrowserWindow::addInternalTab(QWidget *page, const QString &title, const QIcon &icon,
                                  const QString &internalId, int insertIndex) {
  if (!page) return -1;

  const uint64_t tabId = s_tabIdSequence.fetch_add(1);
  BrowserTabInfo info;
  info.id = tabId;
  info.title = title;
  info.icon = icon.isNull() ? BrowserIcons::appIcon() : icon;
  info.content = page;
  info.view = nullptr;
  info.isInternal = true;
  info.internalId = internalId;
  info.uuid = services_.tabManager
      ? services_.tabManager->registerInternalTab(page, this, title, internalId, {true, true, false, false})
      : QUuid::createUuid();

  const int index = (insertIndex >= 0 && insertIndex <= tabs_.size())
      ? insertIndex : tabs_.size();

  tabs_.insert(index, info);
  pageStack_->insertWidget(index, page);
  tabStrip_->insertTab(index, tabId, title, info.icon);

  switchTab(index);
  return index;
}

void BrowserWindow::closeTab(int index) {
  if (index < 0 || index >= tabs_.size()) return;

  BrowserTabInfo info = tabs_.takeAt(index);
  if (info.groupId.has_value() && groupModel_) {
    const QUuid gid = *info.groupId;
    groupModel_->removeTabFromGroup(info.id);
    if (groupModel_->groupTabCount(gid) == 0) {
      groupModel_->removeGroup(gid);
    }
  }
  if (services_.profileService && !info.url.isEmpty() && info.url.isValid()) {
    services_.profileService->rememberClosedTab(info.url, info.title);
  }
  if (services_.tabManager && !info.uuid.isNull()) {
    services_.tabManager->remove(info.uuid);
  }

  if (info.view) {
    if (services_.profileService && services_.profileService->adBlockService()) {
      const quint64 adBlockTabId = reinterpret_cast<quintptr>(info.view.data());
      services_.profileService->adBlockService()->unregisterTab(adBlockTabId);
    }
    pageStack_->removeWidget(info.view);
    info.view->deleteLater();
  } else if (info.content) {
    pageStack_->removeWidget(info.content);
    info.content->deleteLater();
  }
  tabStrip_->removeTab(index);

  if (tabs_.isEmpty()) {
    close();
  } else {
    const int newIndex = std::min(index, static_cast<int>(tabs_.size()) - 1);
    switchTab(newIndex);
  }
}

void BrowserWindow::switchTab(int index) {
  if (index < 0 || index >= tabs_.size()) return;

  tabStrip_->setCurrentIndex(index);
  auto &info = tabs_[index];

  if (info.view) {
    pageStack_->setCurrentWidget(info.view);
    updateOmniboxForCurrentTab();
    updateNavButtons();
    if (bookmarkBtn_ && services_.profileService) {
      const bool bm = services_.profileService->isBookmarked(info.url);
      bookmarkBtn_->setToolTip(bm ? QStringLiteral("Yer imi kaldır") : QStringLiteral("Yer imi ekle"));
    }
    updateBlockerControls();
    if (services_.songRecognition) {
      QString cleanTitle = info.title.trimmed();
      if (cleanTitle.endsWith(QStringLiteral(" - YouTube"), Qt::CaseInsensitive)) cleanTitle.chop(10);
      const QStringList parts = cleanTitle.split(QStringLiteral(" - "));
      if (parts.size() >= 2) {
        services_.songRecognition->setWebContextMetadata(parts.mid(1).join(QStringLiteral(" - ")).trimmed(), parts.first().trimmed());
      } else {
        services_.songRecognition->setWebContextMetadata(cleanTitle, QString());
      }
    }
    if (services_.audioEffects) {
      services_.audioEffects->applyToView(info.view.data());
    }
  } else if (info.content) {
    pageStack_->setCurrentWidget(info.content);
    omnibox_->setText(QStringLiteral("ardali://") + info.internalId);
    backBtn_->setEnabled(false);
    forwardBtn_->setEnabled(false);
    updateBlockerControls();
  }

  if (services_.tabManager && !info.uuid.isNull()) {
    services_.tabManager->activate(info.uuid);
  }
}

void BrowserWindow::moveTab(int fromIndex, int toIndex) {
  if (fromIndex < 0 || fromIndex >= tabs_.size() ||
      toIndex < 0 || toIndex >= tabs_.size() || fromIndex == toIndex) {
    return;
  }
  tabs_.move(fromIndex, toIndex);
}

bool BrowserWindow::transferTabTo(uint64_t tabId, BrowserWindow *destination, int targetIndex) {
  if (!destination || destination == this) return false;

  int sourceIndex = findIndexByTabId(tabId);
  if (sourceIndex < 0) {
    const auto &session = ardali::desktop_tabs::TabDragController::instance().session();
    if (session.isActive() && session.sourceWindow() == this) {
      sourceIndex = session.sourceTabIndex();
    }
  }
  if (sourceIndex < 0 && tabStrip_) {
    sourceIndex = tabStrip_->currentIndex();
  }
  if (sourceIndex < 0 || sourceIndex >= tabs_.size()) return false;

  BrowserTabInfo info = tabs_.takeAt(sourceIndex);
  if (info.groupId.has_value() && groupModel_) {
    const QUuid oldGid = *info.groupId;
    groupModel_->removeTabFromGroup(info.id);
    if (groupModel_->groupTabCount(oldGid) == 0) {
      groupModel_->removeGroup(oldGid);
    }
    info.groupId = std::nullopt; // Single detached tab leaves old group
  }
  if (info.view) {
    info.view->disconnect(this);
    pageStack_->removeWidget(info.view);
  } else if (info.content) {
    info.content->disconnect(this);
    pageStack_->removeWidget(info.content);
  }
  tabStrip_->removeTab(sourceIndex);

  destination->adoptTab(info, targetIndex);

  if (tabs_.isEmpty()) {
    if (!isCaptureShell_) {
      close();
    } else {
      hide();
    }
  } else {
    const int newIdx = std::clamp(sourceIndex, 0, static_cast<int>(tabs_.size()) - 1);
    switchTab(newIdx);
  }

  return true;
}

void BrowserWindow::adoptTab(BrowserTabInfo info, int targetIndex) {
  const int idx = (targetIndex >= 0 && targetIndex <= tabs_.size())
      ? targetIndex : tabs_.size();

  if (info.icon.isNull()) {
    info.icon = BrowserIcons::appIcon();
  }

  tabs_.insert(idx, info);
  if (info.view) {
    info.view->setParent(pageStack_);
    pageStack_->insertWidget(idx, info.view);
    wireViewSignals(info.view, info.id);
    if (services_.audioEffects) {
      services_.audioEffects->registerWebView(info.view.data());
      services_.audioEffects->applyToView(info.view.data());
    }
    if (services_.profileService && services_.profileService->adBlockService()) {
      const quint64 adBlockTabId = reinterpret_cast<quintptr>(info.view.data());
      services_.profileService->adBlockService()->registerTab(adBlockTabId, info.url);
      services_.profileService->adBlockService()->setActiveTabId(adBlockTabId);
    }
    if (info.view->page()) {
#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
      connect(info.view->page(), &QWebEnginePage::permissionRequested, this, [this](const QWebEnginePermission &permission) {
        if (services_.profileService) services_.profileService->handlePermission(permission);
        else permission.deny();
      });
#endif
    }
  } else if (info.content) {
    info.content->setParent(pageStack_);
    pageStack_->insertWidget(idx, info.content);
  }

  tabStrip_->insertTab(idx, info.id, info.title, info.icon);
  if (info.groupId.has_value() && groupModel_ && groupModel_->hasGroup(*info.groupId)) {
    groupModel_->setTabGroup(info.id, *info.groupId);
  }
  switchTab(idx);
  if (!isVisible()) show();
  raise();
}

int BrowserWindow::findIndexByTabId(uint64_t tabId) const {
  for (int i = 0; i < tabs_.size(); ++i) {
    if (tabs_[i].id == tabId) return i;
  }
  return -1;
}

uint64_t BrowserWindow::findTabIdByIndex(int index) const {
  if (index >= 0 && index < tabs_.size()) {
    return tabs_[index].id;
  }
  return 0;
}

QWebEngineView *BrowserWindow::currentView() const {
  const int idx = tabStrip_->currentIndex();
  if (idx >= 0 && idx < tabs_.size() && !tabs_[idx].isInternal) {
    return tabs_[idx].view.data();
  }
  return nullptr;
}

void BrowserWindow::wireViewSignals(QWebEngineView *view, uint64_t tabId) {
  if (!view) return;

  connect(view, &QWebEngineView::titleChanged, this, [this, tabId](const QString &title) {
    const int idx = findIndexByTabId(tabId);
    if (idx >= 0) {
      tabs_[idx].title = title.isEmpty() ? QStringLiteral("Yeni Sekme") : title;
      tabStrip_->setTabText(idx, tabs_[idx].title);
      if (services_.tabManager && !tabs_[idx].uuid.isNull()) {
        services_.tabManager->updateTitle(tabs_[idx].uuid, tabs_[idx].title);
      }
      if (idx == tabStrip_->currentIndex() && services_.songRecognition) {
        QString cleanTitle = tabs_[idx].title.trimmed();
        if (cleanTitle.endsWith(QStringLiteral(" - YouTube"), Qt::CaseInsensitive)) cleanTitle.chop(10);
        const QStringList parts = cleanTitle.split(QStringLiteral(" - "));
        if (parts.size() >= 2) {
          services_.songRecognition->setWebContextMetadata(parts.mid(1).join(QStringLiteral(" - ")).trimmed(), parts.first().trimmed());
        } else {
          services_.songRecognition->setWebContextMetadata(cleanTitle, QString());
        }
      }
    }
  });

  connect(view, &QWebEngineView::iconChanged, this, [this, tabId](const QIcon &icon) {
    const int idx = findIndexByTabId(tabId);
    if (idx >= 0) {
      if (!icon.isNull() && !isNewTabUrl(tabs_[idx].url)) {
        tabs_[idx].icon = icon;
      } else {
        tabs_[idx].icon = BrowserIcons::appIcon();
      }
      tabStrip_->setTabIcon(idx, tabs_[idx].icon);
      if (services_.tabManager && !tabs_[idx].uuid.isNull()) {
        services_.tabManager->updateIcon(tabs_[idx].uuid, tabs_[idx].icon);
      }
    }
  });

  connect(view, &QWebEngineView::urlChanged, this, [this, tabId, view](const QUrl &url) {
    const int idx = findIndexByTabId(tabId);
    if (idx >= 0) {
      tabs_[idx].url = url;
      if (isNewTabUrl(url) || url.isEmpty()) {
        tabs_[idx].icon = BrowserIcons::appIcon();
        tabStrip_->setTabIcon(idx, tabs_[idx].icon);
      }
      if (!isNewTabUrl(url) && url.scheme() != QLatin1String("ardali") && url.isValid()) {
        lastActiveWebUrl_ = url;
      }
      if (services_.profileService) {
        services_.profileService->recordHistory(url, tabs_[idx].title);
        if (services_.profileService->adBlockService()) {
          const quint64 adBlockTabId = reinterpret_cast<quintptr>(view);
          services_.profileService->adBlockService()->updateTabUrl(adBlockTabId, url);
        }
      }
      if (idx == tabStrip_->currentIndex()) {
        updateOmniboxForCurrentTab();
        updateNavButtons();
        updateBlockerControls();
      }
      prepareAdBlockScripts(tabs_[idx].view ? tabs_[idx].view->page() : nullptr, url);
      if (services_.tabManager && !tabs_[idx].uuid.isNull()) {
        services_.tabManager->updateUrl(tabs_[idx].uuid, url);
      }
      if (services_.audioEffects) {
        services_.audioEffects->applyToView(view);
      }
    }
  });

  connect(view, &QWebEngineView::loadProgress, this, [this, tabId](int progress) {
    const int idx = findIndexByTabId(tabId);
    if (idx == tabStrip_->currentIndex()) {
      if (progress < 100) {
        progressBar_->setValue(progress);
        progressBar_->show();
        reloadBtn_->setText(QString::fromUtf8("✕"));
        reloadBtn_->setToolTip(QStringLiteral("Durdur (Esc)"));
      } else {
        progressBar_->hide();
        reloadBtn_->setText(QString::fromUtf8("⟳"));
        reloadBtn_->setToolTip(QStringLiteral("Yenile (F5 / Ctrl+R)"));
      }
    }
  });

  connect(view, &QWebEngineView::loadFinished, this, [this](bool success) {
    if (success) {
      fillCurrentPageFromVault();
    }
  });
}

void BrowserWindow::onOmniboxReturnPressed() {
  QString input = omnibox_->text().trimmed();
  if (input.isEmpty()) return;

  // Check for internal ardali:// schemes
  if (input.startsWith(QStringLiteral("ardali://"), Qt::CaseInsensitive)) {
    const QUrl internalUrl(input);
    const QString host = internalUrl.host().toLower();
    if (host == QLatin1String("settings")) { showSettings(); return; }
    if (host == QLatin1String("passwords")) { showPasswords(); return; }
    if (host == QLatin1String("audio-effects")) { showAudioEffects(); return; }
    if (host == QLatin1String("eq-presets")) { showEqPresetBrowser(); return; }
    if (host == QLatin1String("blocker")) { showArDaliBlockerSettings(); return; }
    if (host == QLatin1String("downloads")) { showMediaDownloads(); return; }
    if (host == QLatin1String("listen") || host == QLatin1String("pulse")) { showSongFinder(); return; }
    if (host == QLatin1String("listen-settings")) { showSongFinderSettings(); return; }
    if (host == QLatin1String("newtab")) {
      if (auto *view = currentView()) {
        view->load(QUrl(QStringLiteral("ardali://newtab/")));
      } else {
        addNewTab(QUrl(QStringLiteral("ardali://newtab/")));
      }
      return;
    }
  }

  QUrl url = QUrl::fromUserInput(input);
  if (!input.contains(QLatin1Char('.')) || input.contains(QLatin1Char(' '))) {
    url = searchUrlForEngine(currentSearchEngine(), input);
  }

  if (auto *view = currentView()) {
    prepareAdBlockScripts(view->page(), url);
    view->load(url);
  } else {
    addNewTab(url);
  }
}

void BrowserWindow::onBackClicked() {
  if (auto *view = currentView()) {
    view->back();
  }
}

void BrowserWindow::onForwardClicked() {
  if (auto *view = currentView()) {
    view->forward();
  }
}

void BrowserWindow::onReloadOrStopClicked() {
  if (auto *view = currentView()) {
    if (progressBar_->isVisible()) {
      view->stop();
    } else {
      view->reload();
    }
  }
}

void BrowserWindow::onHomeClicked() {
  if (auto *view = currentView()) {
    view->load(QUrl(QStringLiteral("ardali://newtab/")));
  } else {
    addNewTab(QUrl(QStringLiteral("ardali://newtab/")));
  }
}

void BrowserWindow::updateNavButtons() {
  if (auto *view = currentView()) {
    if (auto *hist = view->history()) {
      backBtn_->setEnabled(hist->canGoBack());
      forwardBtn_->setEnabled(hist->canGoForward());
    } else {
      backBtn_->setEnabled(false);
      forwardBtn_->setEnabled(false);
    }
    const bool isMedia = MediaDownloadService::isSupportedMediaUrl(view->url()) &&
                         !isNewTabUrl(view->url()) &&
                         view->url().scheme() != QLatin1String("ardali");
    if (mediaDownload_) {
      mediaDownload_->setEnabled(isMedia);
      mediaDownload_->setProperty("activeMedia", isMedia);
      mediaDownload_->setToolTip(isMedia ? QStringLiteral("Medyayı İndir (Aktif Video Tespit Edildi)")
                                         : QStringLiteral("İndirmeler"));
      mediaDownload_->style()->unpolish(mediaDownload_);
      mediaDownload_->style()->polish(mediaDownload_);
    }
  } else {
    backBtn_->setEnabled(false);
    forwardBtn_->setEnabled(false);
    if (mediaDownload_) {
      mediaDownload_->setEnabled(false);
      mediaDownload_->setProperty("activeMedia", false);
      mediaDownload_->style()->unpolish(mediaDownload_);
      mediaDownload_->style()->polish(mediaDownload_);
    }
  }
  updateBookmarkButtonState();
  updateBlockerControls();
}

void BrowserWindow::updateOmniboxForCurrentTab() {
  if (auto *view = currentView()) {
    const QString urlStr = view->url().toString();
    if (!urlStr.isEmpty() && urlStr != QLatin1String("about:blank")) {
      omnibox_->setText(urlStr);
    } else {
      omnibox_->clear();
    }
  }
}

// -----------------------------------------------------------------
// Feature Page Navigations
// -----------------------------------------------------------------
void BrowserWindow::showSettings(SettingsPage::Category category) {
  if (services_.tabManager) {
    const auto existingId = services_.tabManager->findInternal(this, QStringLiteral("settings"));
    if (!existingId.isNull()) {
      const auto *record = services_.tabManager->record(existingId);
      if (record && record->content) {
        const int idx = pageStack_->indexOf(record->content);
        if (idx >= 0) {
          if (auto *page = qobject_cast<SettingsPage *>(record->content.data())) {
            page->setCategory(category);
          }
          switchTab(idx);
          return;
        }
      }
    }
  }

  SettingsPage::Hooks hooks;
  hooks.searchEngine = [this] { return currentSearchEngine(); };
  hooks.setSearchEngine = [this](const QString &engine) { setSearchEngine(engine); };
  hooks.syncNewTabs = [] {};
  hooks.refreshBookmarks = [this] { renderBookmarks(); };
  hooks.refreshTabStyle = [] {
    ardali::desktop_tabs::TabWindowRegistry::instance().reloadTabAppearances();
  };
  hooks.performanceManager = [this] { return services_.tabManager ? services_.tabManager->performanceManager() : nullptr; };

  auto *page = new SettingsPage(services_.profileService, std::move(hooks));
  page->setCategory(category);
  connect(page, &SettingsPage::navigateRequested, this, [this](const QUrl &url) {
    if (url == QUrl(QStringLiteral("ardali://passwords"))) showPasswords();
    else addNewTab(url);
  });

  addInternalTab(page, QStringLiteral("Ayarlar"), BrowserIcons::icon(BrowserIcon::Settings), QStringLiteral("settings"));
}

void BrowserWindow::showPasswords() {
  if (services_.tabManager) {
    const auto existingId = services_.tabManager->findInternal(this, QStringLiteral("passwords"));
    if (!existingId.isNull()) {
      const auto *record = services_.tabManager->record(existingId);
      if (record && record->content) {
        const int idx = pageStack_->indexOf(record->content);
        if (idx >= 0) { switchTab(idx); return; }
      }
    }
  }
  if (!services_.profileService || !services_.profileService->credentialVault()) return;
  auto *page = new PasswordManagerPage(services_.profileService->credentialVault());
  addInternalTab(page, QStringLiteral("Şifre Yöneticisi"), BrowserIcons::icon(BrowserIcon::Password), QStringLiteral("passwords"));
}

void BrowserWindow::showAudioEffects() {
  if (services_.tabManager) {
    const auto existingId = services_.tabManager->findInternal(this, QStringLiteral("audio-effects"));
    if (!existingId.isNull()) {
      const auto *record = services_.tabManager->record(existingId);
      if (record && record->content) {
        const int idx = pageStack_->indexOf(record->content);
        if (idx >= 0) { switchTab(idx); return; }
      }
    }
  }
  auto *page = new AudioEffectsPage(services_.audioEffects);
  connect(page, &AudioEffectsPage::eqPresetBrowserRequested, this, &BrowserWindow::showEqPresetBrowser);
  addInternalTab(page, QStringLiteral("Ses Efektleri"), QIcon(QStringLiteral(":/side-widget-icons/sound-effects.svg")), QStringLiteral("audio-effects"));
}

void BrowserWindow::showEqPresetBrowser() {
  if (services_.tabManager) {
    const auto existingId = services_.tabManager->findInternal(this, QStringLiteral("eq-presets"));
    if (!existingId.isNull()) {
      const auto *record = services_.tabManager->record(existingId);
      if (record && record->content) {
        const int idx = pageStack_->indexOf(record->content);
        if (idx >= 0) { switchTab(idx); return; }
      }
    }
  }
  auto *page = new EqPresetPage(services_.audioEffects);
  addInternalTab(page, QStringLiteral("Hazır Ses Efektleri"), QIcon(QStringLiteral(":/side-widget-icons/eq-presets.svg")), QStringLiteral("eq-presets"));
}

void BrowserWindow::showArDaliBlockerSettings(ArDaliBlockerPage::Tab tab) {
  if (!services_.profileService || !services_.profileService->adBlockService()) return;
  if (services_.tabManager) {
    const auto existingId = services_.tabManager->findInternal(this, QStringLiteral("blocker"));
    if (!existingId.isNull()) {
      const auto *record = services_.tabManager->record(existingId);
      if (record && record->content) {
        const int idx = pageStack_->indexOf(record->content);
        if (idx >= 0) {
          if (auto *page = qobject_cast<ArDaliBlockerPage *>(record->content.data())) page->setActiveTab(tab);
          switchTab(idx);
          return;
        }
      }
    }
  }
  auto *page = new ArDaliBlockerPage(services_.profileService->adBlockService());
  page->setActiveTab(tab);
  addInternalTab(page, QStringLiteral("ArDali Blocker"), QIcon(QStringLiteral(":/side-widget-icons/deliblock.svg")), QStringLiteral("blocker"));
}

void BrowserWindow::showSongFinder() {
  if (services_.tabManager) {
    const auto existingId = services_.tabManager->findInternal(this, QStringLiteral("song-finder"));
    if (!existingId.isNull()) {
      const auto *record = services_.tabManager->record(existingId);
      if (record && record->content) {
        const int idx = pageStack_->indexOf(record->content);
        if (idx >= 0) { switchTab(idx); return; }
      }
    }
  }
  auto *page = new SongFinderPage(services_.songRecognition);
  connect(page, &SongFinderPage::openPreferencesRequested, this, &BrowserWindow::showSongFinderSettings);
  connect(page, &SongFinderPage::openUrlRequested, this, [this](const QUrl &url) { addNewTab(url); });
  addInternalTab(page, QStringLiteral("ArDali Pulse"), QIcon(QStringLiteral(":/side-widget-icons/pulse.svg")), QStringLiteral("song-finder"));
}

void BrowserWindow::showSongFinderSettings() {
  if (services_.tabManager) {
    const auto existingId = services_.tabManager->findInternal(this, QStringLiteral("song-finder-settings"));
    if (!existingId.isNull()) {
      const auto *record = services_.tabManager->record(existingId);
      if (record && record->content) {
        const int idx = pageStack_->indexOf(record->content);
        if (idx >= 0) { switchTab(idx); return; }
      }
    }
  }
  auto *page = new SongFinderSettingsPage(services_.songFinderSettings);
  connect(page, &SongFinderSettingsPage::closeTabRequested, this, [this] { showSongFinder(); });
  addInternalTab(page, QStringLiteral("Pulse Ayarları"), BrowserIcons::icon(BrowserIcon::Settings), QStringLiteral("song-finder-settings"));
}

void BrowserWindow::showMediaDownloads(const QUrl &sourceUrl, bool analyzeImmediately) {
  if (!services_.mediaDownload) return;

  QUrl targetUrl = sourceUrl;
  if (targetUrl.isEmpty()) {
    if (currentView() && !isNewTabUrl(currentView()->url()) && currentView()->url().scheme() != QLatin1String("ardali")) {
      targetUrl = currentView()->url();
    } else if (!lastActiveWebUrl_.isEmpty()) {
      targetUrl = lastActiveWebUrl_;
    }
  }

  const bool shouldAnalyze = analyzeImmediately || (!targetUrl.isEmpty() && MediaDownloadService::isSupportedMediaUrl(targetUrl));

  if (services_.tabManager) {
    const auto existingId = services_.tabManager->findInternal(this, QStringLiteral("downloads"));
    if (!existingId.isNull()) {
      const auto *record = services_.tabManager->record(existingId);
      if (record && record->content) {
        const int idx = pageStack_->indexOf(record->content);
        if (idx >= 0) {
          if (auto *page = qobject_cast<MediaDownloadPage *>(record->content.data())) {
            if (!targetUrl.isEmpty()) page->setSourceUrl(targetUrl, shouldAnalyze);
          }
          switchTab(idx);
          return;
        }
      }
    }
  }
  auto *page = new MediaDownloadPage(services_.mediaDownload, services_.profileService);
  if (!targetUrl.isEmpty()) page->setSourceUrl(targetUrl, shouldAnalyze);
  addInternalTab(page, QStringLiteral("İndirmeler"), BrowserIcons::icon(BrowserIcon::Download), QStringLiteral("downloads"));
}

void BrowserWindow::showTranslatePopup() {
  auto *view = currentView();
  if (!view) return;
  if (!translateBubble_) {
    translateBubble_ = new TranslateBubblePopup(this);
  }
  if (!pageTranslator_ && services_.profileService) {
    pageTranslator_ = new PageTranslator(view, services_.profileService->translateService(), this);
  }
  translateBubble_->setTranslator(pageTranslator_);
  translateBubble_->showAtAnchor(translateButton_->mapToGlobal(QPoint(0, translateButton_->height())));
}

void BrowserWindow::showZoomPopup() {
  if (auto *view = currentView()) {
    setCurrentZoom(view->zoomFactor() == 1.0 ? 1.25 : 1.0);
  }
}

void BrowserWindow::changeCurrentZoom(qreal delta) {
  if (auto *view = currentView()) {
    setCurrentZoom(view->zoomFactor() + delta);
  }
}

void BrowserWindow::setCurrentZoom(qreal factor) {
  if (auto *view = currentView()) {
    const qreal clamped = std::clamp(factor, 0.25, 5.0);
    view->setZoomFactor(clamped);
    if (clamped != 1.0) zoomButton_->show();
    else zoomButton_->hide();
  }
}

void BrowserWindow::saveSessionNow() {
  if (services_.sessionStore && services_.tabManager) {
    services_.sessionStore->save(*services_.tabManager, this);
  }
}

void BrowserWindow::restoreSession(const QVector<SavedTab> &savedTabs) {
  for (const auto &tab : savedTabs) {
    const int idx = addNewTab(tab.url);
    if (idx >= 0 && idx < tabs_.size() && tab.groupId.has_value() && !tab.groupId->isNull()) {
      tabs_[idx].groupId = *tab.groupId;
      if (groupModel_) {
        if (!groupModel_->hasGroup(*tab.groupId)) {
          groupModel_->addOrUpdateGroup({*tab.groupId, tab.groupName, tab.groupColor, tab.groupCollapsed});
        }
        groupModel_->setTabGroup(tabs_[idx].id, *tab.groupId);
      }
    }
  }
  if (tabs_.isEmpty()) {
    ensureInitialTab();
  }
  if (tabStrip_) {
    tabStrip_->update();
  }
}

void BrowserWindow::ensureInitialTab() {
  if (tabs_.isEmpty()) {
    addNewTab(QUrl(QStringLiteral("ardali://newtab/")));
  }
}

void BrowserWindow::openStartupUrl(const QUrl &url) {
  addNewTab(url);
}

// -----------------------------------------------------------------
// Window events, Edge Resizing & Window Caption Controls
// -----------------------------------------------------------------
void BrowserWindow::closeEvent(QCloseEvent *event) {
  saveSessionNow();
  ardali::desktop_tabs::TabWindowRegistry::instance().unregisterWindow(this);
  QMainWindow::closeEvent(event);
}

void BrowserWindow::keyPressEvent(QKeyEvent *event) {
  if (event->modifiers() & Qt::ControlModifier) {
    if (event->key() == Qt::Key_T) {
      addNewTab(QUrl(QStringLiteral("ardali://newtab/")));
      event->accept();
      return;
    }
    if (event->key() == Qt::Key_W) {
      closeTab(tabStrip_->currentIndex());
      event->accept();
      return;
    }
    if (event->key() == Qt::Key_R) {
      onReloadOrStopClicked();
      event->accept();
      return;
    }
    if (event->key() == Qt::Key_L) {
      omnibox_->setFocus();
      omnibox_->selectAll();
      event->accept();
      return;
    }
  }
  if (event->key() == Qt::Key_F5) {
    onReloadOrStopClicked();
    event->accept();
    return;
  }
  if (event->key() == Qt::Key_Escape && progressBar_->isVisible()) {
    if (auto *view = currentView()) {
      view->stop();
    }
    event->accept();
    return;
  }
  QMainWindow::keyPressEvent(event);
}

void BrowserWindow::onMinimizeClicked() {
  showMinimized();
}

void BrowserWindow::onMaximizeRestoreClicked() {
  if (isMaximized()) {
    showNormal();
    if (maxBtn_) maxBtn_->setText(QString::fromUtf8("□"));
  } else {
    showMaximized();
    if (maxBtn_) maxBtn_->setText(QString::fromUtf8("❐"));
  }
}

void BrowserWindow::onCloseWindowClicked() {
  close();
}

void BrowserWindow::changeEvent(QEvent *event) {
  if (event->type() == QEvent::WindowStateChange) {
    if (maxBtn_) {
      maxBtn_->setText(isMaximized() ? QString::fromUtf8("❐") : QString::fromUtf8("□"));
    }
  }
  QMainWindow::changeEvent(event);
}

void BrowserWindow::resizeEvent(QResizeEvent *event) {
  QMainWindow::resizeEvent(event);
  if (!isMaximized() && !isFullScreen() && !(windowState() & (Qt::WindowMaximized | Qt::WindowFullScreen))) {
    lastNormalSize_ = size();
    lastNormalGeometry_ = geometry();
    setProperty("ardaliRestoredSize", lastNormalSize_);
  }
}

void BrowserWindow::moveEvent(QMoveEvent *event) {
  QMainWindow::moveEvent(event);
  if (!isMaximized() && !isFullScreen() && !(windowState() & (Qt::WindowMaximized | Qt::WindowFullScreen))) {
    lastNormalGeometry_ = geometry();
    lastNormalSize_ = size();
    setProperty("ardaliRestoredSize", lastNormalSize_);
  }
}

QSize BrowserWindow::restoredSize() const {
  if (lastNormalSize_.isValid() && lastNormalSize_.width() >= 600 && lastNormalSize_.height() >= 400) {
    return lastNormalSize_;
  }
  const QRect norm = normalGeometry();
  if (norm.isValid() && norm.width() >= 600 && norm.height() >= 400) {
    return norm.size();
  }
  return QSize(1200, 800);
}

QRect BrowserWindow::restoredGeometry() const {
  if (lastNormalGeometry_.isValid() && lastNormalGeometry_.width() >= 600 && lastNormalGeometry_.height() >= 400) {
    return lastNormalGeometry_;
  }
  const QRect norm = normalGeometry();
  if (norm.isValid() && norm.width() >= 600 && norm.height() >= 400) {
    return norm;
  }
  return QRect(100, 100, 1200, 800);
}

Qt::Edges BrowserWindow::calculateEdges(const QPoint &pos) const {
  if (isMaximized() || isFullScreen()) return {};
  Qt::Edges edges;
  const int margin = 6;
  if (pos.x() <= margin) edges |= Qt::LeftEdge;
  if (pos.x() >= width() - margin) edges |= Qt::RightEdge;
  if (topBar_ && topBar_->geometry().contains(pos)) {
    return edges;
  }
  if (pos.y() <= margin) edges |= Qt::TopEdge;
  if (pos.y() >= height() - margin) edges |= Qt::BottomEdge;
  return edges;
}

void BrowserWindow::updateCursorShape(const QPoint &pos) {
  if (isMaximized() || isFullScreen() ||
      property("ardaliDragCaptureShell").toBool() ||
      ardali::desktop_tabs::TabDragController::instance().isActive()) {
    unsetCursor();
    return;
  }
  if (topBar_ && topBar_->geometry().contains(pos)) {
    unsetCursor();
    return;
  }
  const Qt::Edges edges = calculateEdges(pos);
  if ((edges & Qt::LeftEdge && edges & Qt::TopEdge) ||
      (edges & Qt::RightEdge && edges & Qt::BottomEdge)) {
    setCursor(Qt::SizeFDiagCursor);
  } else if ((edges & Qt::RightEdge && edges & Qt::TopEdge) ||
             (edges & Qt::LeftEdge && edges & Qt::BottomEdge)) {
    setCursor(Qt::SizeBDiagCursor);
  } else if (edges & (Qt::LeftEdge | Qt::RightEdge)) {
    setCursor(Qt::SizeHorCursor);
  } else if (edges & (Qt::TopEdge | Qt::BottomEdge)) {
    setCursor(Qt::SizeVerCursor);
  } else {
    unsetCursor();
  }
}

void BrowserWindow::mousePressEvent(QMouseEvent *event) {
  if (event->button() == Qt::LeftButton) {
    const QPoint pos = event->position().toPoint();
    if (topBar_ && topBar_->geometry().contains(pos)) {
      QMainWindow::mousePressEvent(event);
      return;
    }
    const Qt::Edges edges = calculateEdges(pos);
    if (edges != 0) {
      if (windowHandle()) {
        windowHandle()->startSystemResize(edges);
        event->accept();
        return;
      }
    }
    if (pos.y() <= 40) {
      if (windowHandle()) {
        windowHandle()->startSystemMove();
        event->accept();
        return;
      }
    }
  }
  QMainWindow::mousePressEvent(event);
}

void BrowserWindow::mouseMoveEvent(QMouseEvent *event) {
  if (!property("ardaliDragCaptureShell").toBool() &&
      !ardali::desktop_tabs::TabDragController::instance().isActive()) {
    updateCursorShape(event->position().toPoint());
  } else {
    unsetCursor();
  }
  QMainWindow::mouseMoveEvent(event);
}

void BrowserWindow::mouseReleaseEvent(QMouseEvent *event) {
  unsetCursor();
  QMainWindow::mouseReleaseEvent(event);
}

QIcon BrowserWindow::tabIconForRecord(const BrowserTabInfo &info) const {
  if (info.isInternal && !info.icon.isNull()) {
    return info.icon;
  }
  const bool isNewTab = (info.view && (isNewTabUrl(info.view->url()) || info.view->property("ardali-is-newtab-intent").toBool()))
                     || isNewTabUrl(info.url) || info.url.isEmpty();
  if (isNewTab) {
    return BrowserIcons::appIcon();
  }
  if (!info.icon.isNull()) {
    return info.icon;
  }
  if (info.view && !info.view->icon().isNull()) {
    return info.view->icon();
  }
  return BrowserIcons::appIcon();
}

void BrowserWindow::updateBookmarkButtonState() {
  if (!bookmarkBtn_) return;
  const QUrl url = currentView() ? currentView()->url() : (tabStrip_->currentIndex() >= 0 && tabStrip_->currentIndex() < tabs_.size() ? tabs_[tabStrip_->currentIndex()].url : QUrl{});
  const bool bookmarked = services_.profileService && !isNewTabUrl(url) && url.isValid() && services_.profileService->isBookmarked(url);
  bookmarkBtn_->setIcon(bookmarkIcon(bookmarked));
  bookmarkBtn_->setToolTip(bookmarked ? QStringLiteral("Yer imi kaldır") : QStringLiteral("Yer imi ekle"));
}

void BrowserWindow::updateBlockerControls() {
  if (!adBlockShield_) return;

  // The blocker shield button must ALWAYS remain enabled and clickable
  adBlockShield_->setEnabled(true);

  auto *view = currentView();
  const int idx = tabStrip_ ? tabStrip_->currentIndex() : -1;
  const bool isInternalTab = (idx >= 0 && idx < tabs_.size() && tabs_[idx].content != nullptr);

  if (!view || isInternalTab || isInternalOrNonWebUrl(view->url())) {
    adBlockShield_->setInternalPage(true);
    adBlockShield_->setActiveHost(QString());
    adBlockShield_->setBlockedCount(0);
    adBlockShield_->setToolTip(QStringLiteral("ArDali Koruma (Reklam Engelleyici)"));
    return;
  }

  // Normal supported web tab
  const QUrl url = view->url();
  const QString host = url.host().toLower();
  adBlockShield_->setInternalPage(false);
  adBlockShield_->setActiveHost(host);

  const quint64 tabId = reinterpret_cast<quintptr>(view);
  if (services_.profileService && services_.profileService->adBlockService()) {
    services_.profileService->adBlockService()->setActiveTabId(tabId);
    const auto stats = services_.profileService->adBlockService()->statsForTab(tabId);
    adBlockShield_->setBlockedCount(stats.blockedRequests);
    adBlockShield_->setToolTip(stats.blockedRequests > 0
        ? QStringLiteral("ArDali Koruma: %1 (%2 istek engellendi)").arg(host).arg(stats.blockedRequests)
        : QStringLiteral("ArDali Koruma: %1 (Etkin)").arg(host));
  } else {
    adBlockShield_->setBlockedCount(0);
    adBlockShield_->setToolTip(QStringLiteral("ArDali Koruma: %1").arg(host));
  }
}

void BrowserWindow::toggleCurrentBookmark() {
  if (!services_.profileService) return;
  const QUrl url = currentView() ? currentView()->url() : (tabStrip_->currentIndex() >= 0 && tabStrip_->currentIndex() < tabs_.size() ? tabs_[tabStrip_->currentIndex()].url : QUrl{});
  if (!url.isValid() || isNewTabUrl(url)) return;
  services_.profileService->toggleBookmark(url);
  updateBookmarkButtonState();
  renderBookmarks();
}

void BrowserWindow::renderBookmarks() {
  using Metrics = ardali::ui::BrowserChromeMetrics;
  if (!bookmarkBar_ || !services_.profileService) return;
  bookmarkBar_->clear();

  // 1. Far-left Tab Group button ("Yeni sekme grubu oluştur")
  appsBtn_ = new QToolButton(bookmarkBar_);
  appsBtn_->setObjectName(QStringLiteral("appsButton"));
  appsBtn_->setIcon(BrowserIcons::icon(BrowserIcon::Grid));
  appsBtn_->setToolTip(QStringLiteral("Yeni sekme grubu oluştur"));
  appsBtn_->setFixedSize(30, Metrics::bookmarkButtonHeight);
  appsBtn_->setIconSize(QSize(Metrics::bookmarkIconSize,
                              Metrics::bookmarkIconSize));
  appsBtn_->setAutoRaise(true);
  connect(appsBtn_, &QToolButton::clicked, this, &BrowserWindow::toggleTabGroupLauncher);
  bookmarkBar_->addWidget(appsBtn_);

  // 2. Bookmark items with icon + full site name
  for (const QUrl &url : services_.profileService->bookmarks()) {
    const QString title = bookmarkDisplayName(url);
    QAction *action = bookmarkBar_->addAction(title);
    action->setToolTip(url.toDisplayString());
    action->setIcon(platformIconForBookmark(url));

    auto *btn = qobject_cast<QToolButton *>(bookmarkBar_->widgetForAction(action));
    if (btn) {
      btn->setToolButtonStyle(Qt::ToolButtonTextBesideIcon);
      btn->setSizePolicy(QSizePolicy::Preferred, QSizePolicy::Fixed);
      btn->setIconSize(QSize(Metrics::bookmarkIconSize,
                             Metrics::bookmarkIconSize));
      btn->setFixedHeight(Metrics::bookmarkButtonHeight);
    }

    if (services_.profile) {
      const QPointer<QAction> guardedAction(action);
      services_.profile->requestIconForPageURL(url, 64, [guardedAction](const QIcon &icon, const QUrl &, const QUrl &) {
        if (guardedAction && !icon.isNull()) {
          guardedAction->setIcon(icon);
        }
      });
    }

    connect(action, &QAction::triggered, this, [this, url] {
      if (auto *view = currentView()) {
        prepareAdBlockScripts(view->page(), url);
        view->load(url);
      } else {
        addNewTab(url);
      }
    });
  }
}

void BrowserWindow::showMainMenu() {
  QMenu menu(this);
  menu.setStyleSheet(QStringLiteral("QMenu{background:#1b232d;color:#e8eef5;border:1px solid #3a4857;border-radius:9px;padding:6px;} QMenu::item{min-height:25px;padding:5px 30px 5px 30px;border-radius:6px;} QMenu::item:selected{background:#2b3947;} QMenu::item:disabled{color:#6f7b87;} QMenu::separator{height:1px;background:#33404d;margin:6px 8px;} QMenu::icon{padding-left:7px;}"));

  QAction *newTab = menu.addAction(BrowserIcons::icon(BrowserIcon::NewTab), QStringLiteral("Yeni sekme"));
  newTab->setShortcut(QKeySequence(Qt::CTRL | Qt::Key_T));
  QAction *newWindow = menu.addAction(BrowserIcons::icon(BrowserIcon::Window), QStringLiteral("Yeni pencere"));
  newWindow->setShortcut(QKeySequence(Qt::CTRL | Qt::Key_N));
  QAction *incognito = menu.addAction(BrowserIcons::icon(BrowserIcon::Incognito), QStringLiteral("Yeni gizli pencere"));
  incognito->setShortcut(QKeySequence(Qt::CTRL | Qt::SHIFT | Qt::Key_N));
  incognito->setToolTip(QStringLiteral("Yeni gizli pencere aç (Ctrl+Shift+N)"));

  menu.addSeparator();
  QAction *passwords = menu.addAction(BrowserIcons::icon(BrowserIcon::Password), QStringLiteral("Şifreler ve otomatik doldurma"));
  QAction *fillPassword = menu.addAction(BrowserIcons::icon(BrowserIcon::Password), QStringLiteral("Bu sayfayı kayıtlı girişle doldur"));
  fillPassword->setEnabled(currentView() != nullptr && services_.profileService && services_.profileService->credentialVault() && !services_.profileService->credentialVault()->isLocked());
  QAction *history = menu.addAction(BrowserIcons::icon(BrowserIcon::History), QStringLiteral("Geçmiş"));
  history->setShortcut(QKeySequence(Qt::CTRL | Qt::Key_H));
  QAction *bookmarks = menu.addAction(BrowserIcons::icon(BrowserIcon::Bookmark), QStringLiteral("Yer işaretleri"));
  QAction *downloads = menu.addAction(BrowserIcons::icon(BrowserIcon::Download), QStringLiteral("İndirilenler"));
  downloads->setShortcut(QKeySequence(Qt::CTRL | Qt::Key_J));

  menu.addSeparator();
  QMenu *zoom = menu.addMenu(BrowserIcons::icon(BrowserIcon::Zoom), QStringLiteral("Yakınlaştır"));
  QAction *zoomOut = zoom->addAction(QStringLiteral("−"));
  QAction *zoomReset = zoom->addAction(QStringLiteral("%%%1").arg(currentView() ? qRound(currentView()->zoomFactor() * 100.0) : 100));
  QAction *zoomIn = zoom->addAction(QStringLiteral("+"));
  const bool hasWebContent = currentView() != nullptr;
  zoomOut->setEnabled(hasWebContent);
  zoomReset->setEnabled(hasWebContent);
  zoomIn->setEnabled(hasWebContent);

  menu.addSeparator();
  QAction *print = menu.addAction(BrowserIcons::icon(BrowserIcon::Print), QStringLiteral("Yazdır")); print->setEnabled(false);
  QAction *find = menu.addAction(BrowserIcons::icon(BrowserIcon::Search), QStringLiteral("Bul ve düzenle")); find->setEnabled(false);
  QAction *save = menu.addAction(BrowserIcons::icon(BrowserIcon::Save), QStringLiteral("Kaydet ve paylaş")); save->setEnabled(false);
  QAction *tools = menu.addAction(BrowserIcons::icon(BrowserIcon::Tools), QStringLiteral("Diğer araçlar")); tools->setEnabled(false);

  menu.addSeparator();
  QAction *help = menu.addAction(BrowserIcons::icon(BrowserIcon::Help), QStringLiteral("Yardım")); help->setEnabled(false);
  QAction *audioEffectsAction = menu.addAction(QIcon(QStringLiteral(":/side-widget-icons/sound-effects.svg")), QStringLiteral("Ses Efektleri"));
  QAction *eqPresetsAction = menu.addAction(QIcon(QStringLiteral(":/side-widget-icons/eq-presets.svg")), QStringLiteral("Hazır Ses Efektleri"));
  QAction *settings = menu.addAction(BrowserIcons::icon(BrowserIcon::Settings), QStringLiteral("Ayarlar"));
  QAction *quit = menu.addAction(BrowserIcons::icon(BrowserIcon::Exit), QStringLiteral("Çıkış"));

  connect(newTab, &QAction::triggered, this, [this] { addNewTab(); });
  connect(newWindow, &QAction::triggered, this, [this] {
    auto *window = new BrowserWindow(services_);
    window->ensureInitialTab();
    window->show();
  });
  connect(incognito, &QAction::triggered, this, [this] {
    auto incognitoServices = services_;
    incognitoServices.profile = new QWebEngineProfile(this);
    auto *window = new BrowserWindow(incognitoServices);
    window->setWindowTitle(QStringLiteral("Gizli Pencere — ArDaliBrowser"));
    window->ensureInitialTab();
    window->show();
  });
  connect(passwords, &QAction::triggered, this, &BrowserWindow::showPasswords);
  connect(fillPassword, &QAction::triggered, this, &BrowserWindow::fillCurrentPageFromVault);
  connect(history, &QAction::triggered, this, [this] { showHistoryMenu(); });
  connect(bookmarks, &QAction::triggered, this, [this] { showSettings(SettingsPage::Category::Bookmarks); });
  connect(downloads, &QAction::triggered, this, [this] { showDownloadsMenu(); });
  connect(zoomOut, &QAction::triggered, this, [this] { changeCurrentZoom(-0.1); });
  connect(zoomReset, &QAction::triggered, this, [this] { setCurrentZoom(1.0); });
  connect(zoomIn, &QAction::triggered, this, [this] { changeCurrentZoom(0.1); });
  connect(audioEffectsAction, &QAction::triggered, this, &BrowserWindow::showAudioEffects);
  connect(eqPresetsAction, &QAction::triggered, this, &BrowserWindow::showEqPresetBrowser);
  connect(settings, &QAction::triggered, this, [this] { showSettings(); });
  connect(quit, &QAction::triggered, qApp, &QCoreApplication::quit);

  const QPoint execPos = mainMenuBtn_ ? mainMenuBtn_->mapToGlobal(QPoint(0, mainMenuBtn_->height())) : QCursor::pos();
  menu.exec(execPos);
}

void BrowserWindow::showHistoryMenu() {
  if (!services_.profileService) return;
  QMenu menu(this);
  menu.setStyleSheet(QStringLiteral("QMenu{background:#1b232d;color:#e8eef5;border:1px solid #3a4857;border-radius:9px;padding:6px;} QMenu::item{min-height:25px;padding:5px 30px 5px 30px;border-radius:6px;} QMenu::item:disabled{color:#6f7b87;}"));
  const auto entries = services_.profileService->recentHistory();
  if (entries.isEmpty()) {
    QAction *empty = menu.addAction(QStringLiteral("Geçmiş henüz boş"));
    empty->setEnabled(false);
  } else {
    for (const auto &entry : entries.mid(0, std::min<qsizetype>(30, entries.size()))) {
      const QString label = entry.title.isEmpty() ? entry.url.host() : entry.title;
      QAction *action = menu.addAction(label.left(90));
      action->setToolTip(QStringLiteral("%1\n%2").arg(entry.url.toDisplayString(), entry.visitedAt.toLocalTime().toString(QStringLiteral("dd.MM.yyyy HH:mm"))));
      connect(action, &QAction::triggered, this, [this, url = entry.url] {
        if (auto *view = currentView()) {
          view->load(url);
        } else {
          addNewTab(url);
        }
      });
    }
    menu.addSeparator();
    QAction *clear = menu.addAction(QStringLiteral("Geçmişi temizle"));
    connect(clear, &QAction::triggered, this, [this] {
      if (services_.profileService) services_.profileService->clearHistory();
    });
  }
  menu.exec(QCursor::pos());
}

void BrowserWindow::showDownloadsMenu() {
  showMediaDownloads();
}

void BrowserWindow::fillCurrentPageFromVault() {
  auto *vault = services_.profileService ? services_.profileService->credentialVault() : nullptr;
  auto *view = currentView();
  if (!view || !vault) return;
  const auto choices = vault->forOrigin(view->url());
  if (choices.isEmpty()) return;
  CredentialSecret secret;
  if (!vault->reveal(choices.front().id, &secret)) return;
  const QString expectedOrigin = CredentialVault::canonicalHttpsOrigin(view->url());
  if (expectedOrigin.isEmpty() || secret.origin != expectedOrigin) return;
  const QJsonObject values{{QStringLiteral("origin"), expectedOrigin}, {QStringLiteral("username"), secret.username}, {QStringLiteral("password"), secret.password}};
  const QString json = QString::fromUtf8(QJsonDocument(values).toJson(QJsonDocument::Compact));
  const QString script = QStringLiteral(R"JS((() => { const v=%1; if(location.origin!==v.origin)return false; const p=[...document.querySelectorAll('input[type="password"]')].find(e=>e.offsetParent!==null&&!e.disabled); if(!p)return false; const u=[...p.form.querySelectorAll('input')].filter(e=>e.offsetParent!==null&&!e.disabled&&/^(text|email|tel)$/i.test(e.type||'text')).find(e=>/(user|email|login|account|identifier)/i.test(e.name+' '+e.id+' '+e.autocomplete)); if(u){u.focus();u.value=v.username;u.dispatchEvent(new Event('input',{bubbles:true}));u.dispatchEvent(new Event('change',{bubbles:true}));} p.focus();p.value=v.password;p.dispatchEvent(new Event('input',{bubbles:true}));p.dispatchEvent(new Event('change',{bubbles:true}));return true;})())JS").arg(json);
  view->page()->runJavaScript(script);
}

QString BrowserWindow::currentSearchEngine() const {
  if (services_.profileService) {
    return services_.profileService->searchEngine();
  }
  return QSettings().value(QStringLiteral("browser/searchEngine"), QStringLiteral("Google")).toString();
}

void BrowserWindow::setSearchEngine(const QString &engine) {
  if (services_.profileService) {
    services_.profileService->setSearchEngine(engine);
  } else {
    QSettings().setValue(QStringLiteral("browser/searchEngine"), engine);
    updateSearchEngineIcon();
  }
}

void BrowserWindow::updateSearchEngineIcon() {
  const QString engine = currentSearchEngine();
  if (searchEngineAction_) {
    searchEngineAction_->setIcon(BrowserIcons::searchEngineIcon(engine));
    searchEngineAction_->setToolTip(QStringLiteral("Arama motoru: %1").arg(engine));
  }
}

void BrowserWindow::toggleTabSearchPopup() {
  if (tabSearchPopup_ && tabSearchPopup_->isVisible()) {
    tabSearchPopup_->close();
    return;
  }
  if (!tabSearchPopup_) {
    tabSearchPopup_ = new ardali::desktop_tabs::TabSearchPopup(this);
  }
  tabSearchPopup_->showBelow(tabSearchBtn_);
}

void BrowserWindow::toggleTabGroupLauncher() {
  if (tabGroupLauncherPopup_ && tabGroupLauncherPopup_->isVisible()) {
    tabGroupLauncherPopup_->close();
    return;
  }
  if (!tabGroupLauncherPopup_) {
    tabGroupLauncherPopup_ = new ardali::desktop_tabs::TabGroupLauncherPopup(this);
    connect(tabGroupLauncherPopup_, &ardali::desktop_tabs::TabGroupLauncherPopup::createGroupRequested,
            this, &BrowserWindow::createNewTabGroupWithNewTab);
  }
  tabGroupLauncherPopup_->showBelow(appsBtn_);
}

void BrowserWindow::createNewTabGroupWithNewTab() {
  if (!groupModel_) return;

  // 1. Create a brand new normal ArDali tab at the end of tabs using existing creation path
  const int newIdx = addNewTab(QUrl(QStringLiteral("ardali://newtab/")), -1);
  if (newIdx < 0 || newIdx >= tabs_.size()) return;

  // 2. Generate a new stable Group UID
  const QColor defaultColor = ardali::desktop_tabs::tabGroupColorPalette().value(0, QColor("#757b82"));
  const QUuid groupId = groupModel_->createGroup(QString(), defaultColor);

  // 3. Associate NEW Tab UID -> Group UID
  auto &newTab = tabs_[newIdx];
  newTab.groupId = groupId;
  groupModel_->setTabGroup(newTab.id, groupId);

  // 4. Update tab strip rendering
  tabStrip_->update();

  // 5. Open TabGroupPopup anchored below the group chip / new tab header
  QPoint targetPos;
  const QRect chipRect = tabStrip_->groupChipRect(groupId);
  if (!chipRect.isEmpty()) {
    targetPos = tabStrip_->mapToGlobal(QPoint(chipRect.left(), tabStrip_->height()));
  } else {
    const QRect tr = tabStrip_->tabRect(newIdx);
    targetPos = tabStrip_->mapToGlobal(QPoint(tr.left(), tabStrip_->height()));
  }

  showTabGroupPopup(groupId, targetPos);
}

void BrowserWindow::createGroupFromExistingTab(uint64_t tabId) {
  if (!groupModel_ || tabId == 0) return;
  const int idx = findIndexByTabId(tabId);
  if (idx < 0 || idx >= tabs_.size()) return;

  auto &tab = tabs_[idx];
  QUuid groupId;
  if (tab.groupId.has_value() && groupModel_->hasGroup(*tab.groupId)) {
    groupId = *tab.groupId;
  } else {
    const QColor defaultColor = ardali::desktop_tabs::tabGroupColorPalette().value(0, QColor("#757b82"));
    groupId = groupModel_->createGroup(QString(), defaultColor);
    tab.groupId = groupId;
    groupModel_->setTabGroup(tab.id, groupId);
    tabStrip_->update();
  }

  QPoint targetPos;
  const QRect chipRect = tabStrip_->groupChipRect(groupId);
  if (!chipRect.isEmpty()) {
    targetPos = tabStrip_->mapToGlobal(QPoint(chipRect.left(), tabStrip_->height()));
  } else {
    const QRect tr = tabStrip_->tabRect(idx);
    targetPos = tabStrip_->mapToGlobal(QPoint(tr.left(), tabStrip_->height()));
  }

  showTabGroupPopup(groupId, targetPos);
}

void BrowserWindow::showTabGroupPopup(const QUuid &groupId, const QPoint &globalPos) {
  if (!groupModel_ || groupId.isNull()) return;
  if (!tabGroupPopup_) {
    tabGroupPopup_ = new ardali::desktop_tabs::TabGroupPopup(groupModel_, this);
    connect(tabGroupPopup_, &ardali::desktop_tabs::TabGroupPopup::newTabInGroupRequested,
            this, &BrowserWindow::addTabToGroup);
    connect(tabGroupPopup_, &ardali::desktop_tabs::TabGroupPopup::moveGroupToNewWindowRequested,
            this, &BrowserWindow::moveGroupToNewWindow);
    connect(tabGroupPopup_, &ardali::desktop_tabs::TabGroupPopup::closeGroupRequested,
            this, &BrowserWindow::closeTabGroup);
    connect(tabGroupPopup_, &ardali::desktop_tabs::TabGroupPopup::ungroupRequested,
            this, &BrowserWindow::ungroupTabs);
    connect(tabGroupPopup_, &ardali::desktop_tabs::TabGroupPopup::deleteGroupRequested,
            this, &BrowserWindow::deleteTabGroup);
  }

  QPoint targetPos = globalPos;
  if (targetPos.isNull()) {
    const QRect chipRect = tabStrip_->groupChipRect(groupId);
    if (!chipRect.isEmpty()) {
      targetPos = tabStrip_->mapToGlobal(QPoint(chipRect.left(), tabStrip_->height()));
    } else {
      const int idx = tabStrip_->currentIndex();
      const QRect tr = tabStrip_->tabRect(idx >= 0 ? idx : 0);
      targetPos = tabStrip_->mapToGlobal(QPoint(tr.left(), tabStrip_->height()));
    }
  }

  tabGroupPopup_->showForGroup(groupId, targetPos);
}

void BrowserWindow::addTabToGroup(const QUuid &groupId) {
  if (!groupModel_ || groupId.isNull()) return;

  int lastGroupIdx = -1;
  for (int i = 0; i < tabs_.size(); ++i) {
    if (tabs_[i].groupId == groupId) {
      lastGroupIdx = i;
    }
  }

  const int insertIdx = (lastGroupIdx >= 0) ? lastGroupIdx + 1 : tabs_.size();
  const int newIdx = addNewTab(QUrl(QStringLiteral("ardali://newtab/")), insertIdx);
  if (newIdx >= 0 && newIdx < tabs_.size()) {
    tabs_[newIdx].groupId = groupId;
    groupModel_->setTabGroup(tabs_[newIdx].id, groupId);
    tabStrip_->update();
  }
}

void BrowserWindow::moveGroupToNewWindow(const QUuid &groupId) {
  if (!groupModel_ || groupId.isNull()) return;
  const auto optGroup = groupModel_->group(groupId);
  if (!optGroup.has_value()) return;

  const QList<uint64_t> memberTabIds = groupModel_->tabsInGroup(groupId);
  if (memberTabIds.isEmpty()) return;

  const ardali::desktop_tabs::TabGroup groupToMove = *optGroup;

  auto *newWindow = new BrowserWindow(services_);
  newWindow->groupModel()->addOrUpdateGroup(groupToMove);

  for (uint64_t tid : memberTabIds) {
    const int idx = findIndexByTabId(tid);
    if (idx < 0 || idx >= tabs_.size()) continue;

    BrowserTabInfo info = tabs_.takeAt(idx);
    if (info.view) {
      info.view->disconnect(this);
      pageStack_->removeWidget(info.view);
    } else if (info.content) {
      info.content->disconnect(this);
      pageStack_->removeWidget(info.content);
    }
    tabStrip_->removeTab(idx);
    groupModel_->removeTabFromGroup(info.id);

    info.groupId = groupId;
    newWindow->adoptTab(info, -1);
    newWindow->groupModel()->setTabGroup(info.id, groupId);
  }

  groupModel_->removeGroup(groupId);

  if (tabs_.isEmpty()) {
    if (!isCaptureShell_) {
      close();
    } else {
      hide();
    }
  } else {
    const int current = std::clamp(tabStrip_->currentIndex(), 0, static_cast<int>(tabs_.size()) - 1);
    switchTab(current);
  }

  newWindow->show();
  newWindow->raise();
}

void BrowserWindow::closeTabGroup(const QUuid &groupId) {
  if (!groupModel_ || groupId.isNull()) return;
  const QList<uint64_t> memberTabIds = groupModel_->tabsInGroup(groupId);
  for (uint64_t tid : memberTabIds) {
    const int idx = findIndexByTabId(tid);
    if (idx >= 0) {
      closeTab(idx);
    }
  }
  groupModel_->removeGroup(groupId);
  tabStrip_->update();
}

void BrowserWindow::ungroupTabs(const QUuid &groupId) {
  if (!groupModel_ || groupId.isNull()) return;
  for (auto &tab : tabs_) {
    if (tab.groupId == groupId) {
      tab.groupId = std::nullopt;
    }
  }
  groupModel_->removeGroup(groupId);
  tabStrip_->update();
}

void BrowserWindow::deleteTabGroup(const QUuid &groupId) {
  closeTabGroup(groupId);
}

std::optional<ardali::desktop_tabs::TabGroup> BrowserWindow::groupForTab(uint64_t tabId) const {
  if (!groupModel_) return std::nullopt;
  const auto optGid = groupModel_->groupIdForTab(tabId);
  if (!optGid.has_value() || optGid->isNull()) return std::nullopt;
  return groupModel_->group(*optGid);
}
