#include "site_controls_bubble.h"

#include <QGraphicsDropShadowEffect>
#include <QHBoxLayout>
#include <QKeyEvent>
#include <QPainter>
#include <QPainterPath>
#include <QStyle>
#include <QStyleOption>
#include <QScrollBar>

namespace {

QPushButton *createNavRowButton(BrowserIcon iconId, const QString &title, const QString &subtitle, QLabel **outSubLabel, QLabel **outIconLabel = nullptr, QLabel **outTitleLabel = nullptr) {
  auto *btn = new QPushButton();
  btn->setObjectName(QStringLiteral("site-controls-nav-row"));
  btn->setCursor(Qt::PointingHandCursor);
  btn->setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Fixed);
  btn->setFixedHeight(50);

  auto *layout = new QHBoxLayout(btn);
  layout->setContentsMargins(12, 6, 12, 6);
  layout->setSpacing(12);

  auto *iconLbl = new QLabel(btn);
  iconLbl->setFixedSize(22, 22);
  iconLbl->setPixmap(BrowserIcons::icon(iconId).pixmap(QSize(20, 20)));
  if (outIconLabel) *outIconLabel = iconLbl;
  layout->addWidget(iconLbl);

  auto *textCol = new QVBoxLayout();
  textCol->setContentsMargins(0, 0, 0, 0);
  textCol->setSpacing(1);

  auto *titleLbl = new QLabel(title, btn);
  titleLbl->setObjectName(QStringLiteral("site-controls-row-title"));
  if (outTitleLabel) *outTitleLabel = titleLbl;
  textCol->addWidget(titleLbl);

  auto *subLbl = new QLabel(subtitle, btn);
  subLbl->setObjectName(QStringLiteral("site-controls-row-subtitle"));
  if (outSubLabel) *outSubLabel = subLbl;
  textCol->addWidget(subLbl);

  layout->addLayout(textCol, 1);

  auto *chevronLbl = new QLabel(btn);
  chevronLbl->setFixedSize(16, 16);
  chevronLbl->setPixmap(BrowserIcons::icon(BrowserIcon::ChevronRight).pixmap(QSize(14, 14)));
  layout->addWidget(chevronLbl);

  return btn;
}

QWidget *createSubpageHeader(const QString &title, QLabel **outHostLabel, std::function<void()> onBack) {
  auto *header = new QWidget();
  auto *hLayout = new QHBoxLayout(header);
  hLayout->setContentsMargins(10, 8, 10, 6);
  hLayout->setSpacing(8);

  auto *backBtn = new QToolButton(header);
  backBtn->setObjectName(QStringLiteral("site-controls-back-btn"));
  backBtn->setIcon(BrowserIcons::icon(BrowserIcon::ArrowLeft));
  backBtn->setIconSize(QSize(18, 18));
  backBtn->setToolTip(QStringLiteral("Geri"));
  backBtn->setCursor(Qt::PointingHandCursor);
  QObject::connect(backBtn, &QToolButton::clicked, onBack);
  hLayout->addWidget(backBtn);

  auto *vLayout = new QVBoxLayout();
  vLayout->setContentsMargins(0, 0, 0, 0);
  vLayout->setSpacing(1);

  auto *titleLbl = new QLabel(title, header);
  titleLbl->setObjectName(QStringLiteral("site-controls-header-title"));
  vLayout->addWidget(titleLbl);

  auto *hostLbl = new QLabel(header);
  hostLbl->setObjectName(QStringLiteral("site-controls-header-host"));
  if (outHostLabel) *outHostLabel = hostLbl;
  vLayout->addWidget(hostLbl);

  hLayout->addLayout(vLayout, 1);

  return header;
}

}  // namespace

SiteControlsBubble::SiteControlsBubble(QWidget *parent)
    : QFrame(parent, Qt::FramelessWindowHint) {
  initializeUi();
}

void SiteControlsBubble::setProfileService(BrowserProfileService *service) {
  profileService_ = service;
}

void SiteControlsBubble::initializeUi() {
  setObjectName(QStringLiteral("site-controls-bubble"));
  setAttribute(Qt::WA_StyledBackground, true);
  setFixedWidth(360);

  auto *shadow = new QGraphicsDropShadowEffect(this);
  shadow->setBlurRadius(20);
  shadow->setOffset(0, 6);
  shadow->setColor(QColor(0, 0, 0, 160));
  setGraphicsEffect(shadow);

  setStyleSheet(QStringLiteral(
      "QFrame#site-controls-bubble {"
      "  background-color: #181f28;"
      "  border: 1px solid #2e3b49;"
      "  border-radius: 12px;"
      "  color: #e4ebf5;"
      "}"
      "QLabel {"
      "  color: #e4ebf5;"
      "  background: transparent;"
      "}"
      "QLabel#site-controls-main-host {"
      "  font-size: 14px;"
      "  font-weight: 700;"
      "  color: #f3f7fc;"
      "}"
      "QLabel#site-controls-header-title {"
      "  font-size: 13px;"
      "  font-weight: 700;"
      "  color: #f3f7fc;"
      "}"
      "QLabel#site-controls-header-host {"
      "  font-size: 11px;"
      "  color: #92a1b3;"
      "}"
      "QLabel#site-controls-row-title {"
      "  font-size: 13px;"
      "  font-weight: 600;"
      "  color: #e4ebf5;"
      "}"
      "QLabel#site-controls-row-subtitle {"
      "  font-size: 11px;"
      "  color: #92a1b3;"
      "}"
      "QPushButton#site-controls-nav-row {"
      "  background-color: transparent;"
      "  border: 1px solid transparent;"
      "  border-radius: 8px;"
      "  text-align: left;"
      "}"
      "QPushButton#site-controls-nav-row:hover {"
      "  background-color: #222d3b;"
      "  border-color: #2e3b49;"
      "}"
      "QPushButton#site-controls-nav-row:focus {"
      "  border-color: #58a6c7;"
      "}"
      "QToolButton#site-controls-close-btn, QToolButton#site-controls-back-btn {"
      "  background: transparent;"
      "  border: none;"
      "  border-radius: 6px;"
      "  color: #92a1b3;"
      "  font-size: 16px;"
      "  font-weight: bold;"
      "  padding: 2px;"
      "  min-width: 26px;"
      "  max-width: 26px;"
      "  min-height: 26px;"
      "  max-height: 26px;"
      "}"
      "QToolButton#site-controls-close-btn:hover, QToolButton#site-controls-back-btn:hover {"
      "  background-color: #273444;"
      "  color: #ffffff;"
      "}"
      "QFrame#site-controls-card {"
      "  background-color: #1c2633;"
      "  border: 1px solid #2e3b49;"
      "  border-radius: 8px;"
      "  padding: 10px;"
      "}"
      "QComboBox {"
      "  background-color: #1e2836;"
      "  border: 1px solid #3c4f64;"
      "  border-radius: 6px;"
      "  color: #e4ebf5;"
      "  padding: 4px 8px;"
      "  font-size: 12px;"
      "  min-width: 82px;"
      "}"
      "QComboBox:hover {"
      "  border-color: #58a6c7;"
      "}"
      "QComboBox::drop-down {"
      "  border: none;"
      "  width: 18px;"
      "}"
      "QComboBox QAbstractItemView {"
      "  background-color: #181f28;"
      "  border: 1px solid #2e3b49;"
      "  selection-background-color: #25384a;"
      "  selection-color: #edf5fc;"
      "  color: #e4ebf5;"
      "}"
      "QPushButton#site-controls-action-btn {"
      "  background-color: #25384a;"
      "  border: 1px solid #486681;"
      "  border-radius: 7px;"
      "  color: #edf5fc;"
      "  font-size: 12px;"
      "  font-weight: 600;"
      "  padding: 7px 14px;"
      "  min-height: 30px;"
      "}"
      "QPushButton#site-controls-action-btn:hover {"
      "  background-color: #2e465d;"
      "  border-color: #5d81a3;"
      "}"
      "QPushButton#site-controls-action-btn:focus {"
      "  border: 2px solid #58a6c7;"
      "}"
      "QScrollArea {"
      "  background: transparent;"
      "  border: none;"
      "}"
  ));

  auto *rootLayout = new QVBoxLayout(this);
  rootLayout->setContentsMargins(4, 4, 4, 4);
  rootLayout->setSpacing(0);

  stack_ = new QStackedWidget(this);
  stack_->addWidget(createMainPage());         // Index 0
  stack_->addWidget(createSecurityPage());     // Index 1
  stack_->addWidget(createCookiesPage());      // Index 2
  stack_->addWidget(createPermissionsPage());  // Index 3
  stack_->addWidget(createAboutPage());        // Index 4

  rootLayout->addWidget(stack_);
}

QWidget *SiteControlsBubble::createMainPage() {
  auto *page = new QWidget();
  auto *layout = new QVBoxLayout(page);
  layout->setContentsMargins(12, 12, 12, 12);
  layout->setSpacing(6);

  // Top header row: Host + Close button
  auto *topRow = new QHBoxLayout();
  topRow->setContentsMargins(4, 0, 0, 4);
  mainHostLabel_ = new QLabel(page);
  mainHostLabel_->setObjectName(QStringLiteral("site-controls-main-host"));
  topRow->addWidget(mainHostLabel_, 1);

  mainCloseBtn_ = new QToolButton(page);
  mainCloseBtn_->setObjectName(QStringLiteral("site-controls-close-btn"));
  mainCloseBtn_->setText(QStringLiteral("×"));
  mainCloseBtn_->setToolTip(QStringLiteral("Kapat (Esc)"));
  mainCloseBtn_->setCursor(Qt::PointingHandCursor);
  connect(mainCloseBtn_, &QToolButton::clicked, this, &QWidget::hide);
  topRow->addWidget(mainCloseBtn_);

  layout->addLayout(topRow);

  // Row 1: Connection Security
  mainSecurityRow_ = createNavRowButton(
      BrowserIcon::Privacy, QStringLiteral("Bağlantı güvenli"),
      QStringLiteral("Bilgileriniz güvende"), &mainSecuritySubLabel_,
      &mainSecurityIconLabel_, &mainSecurityTitleLabel_);
  connect(mainSecurityRow_, &QPushButton::clicked, this, [this] {
    stack_->setCurrentIndex(1);
  });
  layout->addWidget(mainSecurityRow_);

  // Row 2: Cookies and site data
  mainCookiesRow_ = createNavRowButton(
      BrowserIcon::Cookie, QStringLiteral("Çerezler ve site verileri"),
      QStringLiteral("0 çerez kullanımda"), &mainCookiesSubLabel_);
  connect(mainCookiesRow_, &QPushButton::clicked, this, [this] {
    stack_->setCurrentIndex(2);
  });
  layout->addWidget(mainCookiesRow_);

  // Row 3: Site permissions
  mainPermsRow_ = createNavRowButton(
      BrowserIcon::Tune, QStringLiteral("Site izinleri"),
      QStringLiteral("İzinleri yönetin"), &mainPermsSubLabel_);
  connect(mainPermsRow_, &QPushButton::clicked, this, [this] {
    stack_->setCurrentIndex(3);
  });
  layout->addWidget(mainPermsRow_);

  // Separator
  auto *sep = new QFrame(page);
  sep->setFrameShape(QFrame::HLine);
  sep->setStyleSheet(QStringLiteral("background-color: #2e3b49; max-height: 1px; margin: 4px 6px;"));
  layout->addWidget(sep);

  // Row 4: About this page
  mainAboutRow_ = createNavRowButton(
      BrowserIcon::Info, QStringLiteral("Bu sayfa hakkında"),
      QStringLiteral("Bağlantı ve site detayları"), nullptr);
  connect(mainAboutRow_, &QPushButton::clicked, this, [this] {
    stack_->setCurrentIndex(4);
  });
  layout->addWidget(mainAboutRow_);

  return page;
}

QWidget *SiteControlsBubble::createSecurityPage() {
  auto *page = new QWidget();
  auto *layout = new QVBoxLayout(page);
  layout->setContentsMargins(10, 10, 10, 12);
  layout->setSpacing(10);

  layout->addWidget(createSubpageHeader(QStringLiteral("Güvenlik"), &secHostLabel_, [this] {
    stack_->setCurrentIndex(0);
  }));

  // Connection Card
  auto *connCard = new QFrame(page);
  connCard->setObjectName(QStringLiteral("site-controls-card"));
  auto *cLayout = new QVBoxLayout(connCard);
  cLayout->setContentsMargins(10, 10, 10, 10);
  cLayout->setSpacing(6);

  auto *cTop = new QHBoxLayout();
  secStatusIconLabel_ = new QLabel(connCard);
  secStatusIconLabel_->setFixedSize(22, 22);
  cTop->addWidget(secStatusIconLabel_);

  secStatusTitleLabel_ = new QLabel(connCard);
  secStatusTitleLabel_->setObjectName(QStringLiteral("site-controls-row-title"));
  cTop->addWidget(secStatusTitleLabel_, 1);
  cLayout->addLayout(cTop);

  secStatusDescLabel_ = new QLabel(connCard);
  secStatusDescLabel_->setObjectName(QStringLiteral("site-controls-row-subtitle"));
  secStatusDescLabel_->setWordWrap(true);
  cLayout->addWidget(secStatusDescLabel_);

  layout->addWidget(connCard);

  // Certificate Card
  auto *certCard = new QFrame(page);
  certCard->setObjectName(QStringLiteral("site-controls-card"));
  auto *certLayout = new QVBoxLayout(certCard);
  certLayout->setContentsMargins(10, 10, 10, 10);
  certLayout->setSpacing(6);

  auto *certTop = new QHBoxLayout();
  secCertIconLabel_ = new QLabel(certCard);
  secCertIconLabel_->setFixedSize(22, 22);
  certTop->addWidget(secCertIconLabel_);

  secCertTitleLabel_ = new QLabel(certCard);
  secCertTitleLabel_->setObjectName(QStringLiteral("site-controls-row-title"));
  certTop->addWidget(secCertTitleLabel_, 1);
  certLayout->addLayout(certTop);

  secCertDescLabel_ = new QLabel(certCard);
  secCertDescLabel_->setObjectName(QStringLiteral("site-controls-row-subtitle"));
  secCertDescLabel_->setWordWrap(true);
  certLayout->addWidget(secCertDescLabel_);

  layout->addWidget(certCard);
  layout->addStretch();

  return page;
}

QWidget *SiteControlsBubble::createCookiesPage() {
  auto *page = new QWidget();
  auto *layout = new QVBoxLayout(page);
  layout->setContentsMargins(10, 10, 10, 12);
  layout->setSpacing(10);

  layout->addWidget(createSubpageHeader(QStringLiteral("Çerezler ve site verileri"), &cookiesHostLabel_, [this] {
    stack_->setCurrentIndex(0);
  }));

  auto *card = new QFrame(page);
  card->setObjectName(QStringLiteral("site-controls-card"));
  auto *cLayout = new QVBoxLayout(card);
  cLayout->setContentsMargins(10, 10, 10, 10);
  cLayout->setSpacing(6);

  auto *top = new QHBoxLayout();
  auto *cIcon = new QLabel(card);
  cIcon->setFixedSize(22, 22);
  cIcon->setPixmap(BrowserIcons::icon(BrowserIcon::Cookie).pixmap(QSize(20, 20)));
  top->addWidget(cIcon);

  cookiesCountLabel_ = new QLabel(card);
  cookiesCountLabel_->setObjectName(QStringLiteral("site-controls-row-title"));
  top->addWidget(cookiesCountLabel_, 1);
  cLayout->addLayout(top);

  auto *descLbl = new QLabel(QStringLiteral("Çerezler oturum bilgilerini ve tercihlerinizi saklar."), card);
  descLbl->setObjectName(QStringLiteral("site-controls-row-subtitle"));
  descLbl->setWordWrap(true);
  cLayout->addWidget(descLbl);

  layout->addWidget(card);

  cookiesStatusLabel_ = new QLabel(page);
  cookiesStatusLabel_->setObjectName(QStringLiteral("site-controls-row-subtitle"));
  cookiesStatusLabel_->setStyleSheet(QStringLiteral("color: #58a6c7; font-weight: 500;"));
  cookiesStatusLabel_->hide();
  layout->addWidget(cookiesStatusLabel_);

  cookiesClearBtn_ = new QPushButton(QStringLiteral("Bu sitenin verilerini sil"), page);
  cookiesClearBtn_->setObjectName(QStringLiteral("site-controls-action-btn"));
  cookiesClearBtn_->setCursor(Qt::PointingHandCursor);
  connect(cookiesClearBtn_, &QPushButton::clicked, this, [this] {
    if (profileService_) {
      profileService_->clearCookiesForHost(host_);
    }
    emit cookiesClearedRequested(host_);
    cookiesCountLabel_->setText(QStringLiteral("Bu site için 0 adet çerez depolanıyor"));
    if (mainCookiesSubLabel_) {
      mainCookiesSubLabel_->setText(QStringLiteral("0 çerez kullanımda"));
    }
    cookiesStatusLabel_->setText(QStringLiteral("Bu sitenin çerezleri ve verileri temizlendi."));
    cookiesStatusLabel_->show();
  });
  layout->addWidget(cookiesClearBtn_);

  layout->addStretch();
  return page;
}

QWidget *SiteControlsBubble::createPermissionsPage() {
  auto *page = new QWidget();
  auto *layout = new QVBoxLayout(page);
  layout->setContentsMargins(10, 10, 10, 12);
  layout->setSpacing(8);

  layout->addWidget(createSubpageHeader(QStringLiteral("Site izinleri"), &permsHostLabel_, [this] {
    stack_->setCurrentIndex(0);
  }));

  auto *scrollArea = new QScrollArea(page);
  scrollArea->setWidgetResizable(true);
  scrollArea->setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
  scrollArea->setVerticalScrollBarPolicy(Qt::ScrollBarAsNeeded);

  permsContainerWidget_ = new QWidget();
  permsListLayout_ = new QVBoxLayout(permsContainerWidget_);
  permsListLayout_->setContentsMargins(4, 2, 4, 4);
  permsListLayout_->setSpacing(6);

  static const struct PermDef {
    QString key;
    QString title;
    BrowserIcon icon;
  } kSupportedPerms[] = {
    {QStringLiteral("geolocation"), QStringLiteral("Konum"), BrowserIcon::Location},
    {QStringLiteral("camera"), QStringLiteral("Kamera"), BrowserIcon::Camera},
    {QStringLiteral("microphone"), QStringLiteral("Mikrofon"), BrowserIcon::Microphone},
    {QStringLiteral("notifications"), QStringLiteral("Bildirimler"), BrowserIcon::Notification},
    {QStringLiteral("clipboard"), QStringLiteral("Pano erişimi"), BrowserIcon::Clipboard},
    {QStringLiteral("localFonts"), QStringLiteral("Yerel yazı tipleri"), BrowserIcon::Fonts},
    {QStringLiteral("mouseLock"), QStringLiteral("Fare kilidi"), BrowserIcon::Mouse},
    {QStringLiteral("screenShare"), QStringLiteral("Ekran paylaşımı"), BrowserIcon::Video}
  };

  permRows_.clear();

  for (const auto &def : kSupportedPerms) {
    auto *rowWidget = new QWidget(permsContainerWidget_);
    auto *rLayout = new QHBoxLayout(rowWidget);
    rLayout->setContentsMargins(6, 4, 6, 4);
    rLayout->setSpacing(10);

    auto *iconLbl = new QLabel(rowWidget);
    iconLbl->setFixedSize(20, 20);
    iconLbl->setPixmap(BrowserIcons::icon(def.icon).pixmap(QSize(18, 18)));
    rLayout->addWidget(iconLbl);

    auto *textCol = new QVBoxLayout();
    textCol->setContentsMargins(0, 0, 0, 0);
    textCol->setSpacing(1);

    auto *nameLbl = new QLabel(def.title, rowWidget);
    nameLbl->setObjectName(QStringLiteral("site-controls-row-title"));
    nameLbl->setStyleSheet(QStringLiteral("font-size: 12px; font-weight: 550;"));
    textCol->addWidget(nameLbl);

    auto *badgeLbl = new QLabel(QStringLiteral("Bu ziyaret için izin verildi"), rowWidget);
    badgeLbl->setStyleSheet(QStringLiteral("color: #58a6c7; font-size: 10px; font-weight: 600;"));
    badgeLbl->hide();
    textCol->addWidget(badgeLbl);

    rLayout->addLayout(textCol, 1);

    auto *combo = new QComboBox(rowWidget);
    combo->addItems({QStringLiteral("Sor"), QStringLiteral("İzin ver"), QStringLiteral("Engelle")});
    combo->setCursor(Qt::PointingHandCursor);

    PermissionRowWidgets prw;
    prw.key = def.key;
    prw.iconLabel = iconLbl;
    prw.titleLabel = nameLbl;
    prw.tempBadgeLabel = badgeLbl;
    prw.combo = combo;
    permRows_.append(prw);

    const QString key = def.key;
    connect(combo, QOverload<int>::of(&QComboBox::currentIndexChanged), this, [this, key, combo, badgeLbl](int index) {
      if (!profileService_ || canonicalOrigin_.isEmpty()) return;
      if (index == 1) { // İzin ver (persistent Allow)
        profileService_->addSitePermissionRule(key, canonicalOrigin_, true);
        badgeLbl->hide();
        emit permissionRuleChanged(key, canonicalOrigin_, 1);
      } else if (index == 2) { // Engelle (persistent Block)
        profileService_->addSitePermissionRule(key, canonicalOrigin_, false);
        badgeLbl->hide();
        emit permissionRuleChanged(key, canonicalOrigin_, 2);
      } else { // Sor (Reset persistent rule)
        profileService_->removeSitePermissionRule(key, canonicalOrigin_);
        emit permissionRuleChanged(key, canonicalOrigin_, 0);
      }
    });

    rLayout->addWidget(combo);
    permsListLayout_->addWidget(rowWidget);
  }

  permsListLayout_->addStretch();
  scrollArea->setWidget(permsContainerWidget_);
  layout->addWidget(scrollArea, 1);

  // Bottom action: Reset all site permissions
  resetAllPermsBtn_ = new QPushButton(QStringLiteral("Tüm site izinlerini sıfırla"), page);
  resetAllPermsBtn_->setObjectName(QStringLiteral("site-controls-action-btn"));
  resetAllPermsBtn_->setCursor(Qt::PointingHandCursor);
  connect(resetAllPermsBtn_, &QPushButton::clicked, this, [this] {
    if (canonicalOrigin_.isEmpty()) return;
    if (profileService_) {
      for (const auto &row : permRows_) {
        profileService_->removeSitePermissionRule(row.key, canonicalOrigin_);
      }
      profileService_->removeSitePermissionRule(QStringLiteral("cameraMicrophone"), canonicalOrigin_);
    }
    emit permissionsResetRequested(canonicalOrigin_);
    refreshPermissions();
  });
  layout->addWidget(resetAllPermsBtn_);

  return page;
}

QWidget *SiteControlsBubble::createAboutPage() {
  auto *page = new QWidget();
  auto *layout = new QVBoxLayout(page);
  layout->setContentsMargins(10, 10, 10, 12);
  layout->setSpacing(10);

  layout->addWidget(createSubpageHeader(QStringLiteral("Bu sayfa hakkında"), &aboutHostLabel_, [this] {
    stack_->setCurrentIndex(0);
  }));

  auto *card = new QFrame(page);
  card->setObjectName(QStringLiteral("site-controls-card"));
  auto *cLayout = new QVBoxLayout(card);
  cLayout->setContentsMargins(10, 10, 10, 10);
  cLayout->setSpacing(8);

  auto *urlTitle = new QLabel(QStringLiteral("Tam web adresi:"), card);
  urlTitle->setObjectName(QStringLiteral("site-controls-row-subtitle"));
  cLayout->addWidget(urlTitle);

  aboutUrlLabel_ = new QLabel(card);
  aboutUrlLabel_->setObjectName(QStringLiteral("site-controls-row-title"));
  aboutUrlLabel_->setWordWrap(true);
  aboutUrlLabel_->setTextInteractionFlags(Qt::TextSelectableByMouse);
  cLayout->addWidget(aboutUrlLabel_);

  auto *protoTitle = new QLabel(QStringLiteral("Protokol ve güvenlik:"), card);
  protoTitle->setObjectName(QStringLiteral("site-controls-row-subtitle"));
  cLayout->addWidget(protoTitle);

  aboutProtocolLabel_ = new QLabel(card);
  aboutProtocolLabel_->setObjectName(QStringLiteral("site-controls-row-title"));
  cLayout->addWidget(aboutProtocolLabel_);

  aboutSecurityDetailLabel_ = new QLabel(card);
  aboutSecurityDetailLabel_->setObjectName(QStringLiteral("site-controls-row-subtitle"));
  aboutSecurityDetailLabel_->setWordWrap(true);
  cLayout->addWidget(aboutSecurityDetailLabel_);

  layout->addWidget(card);
  layout->addStretch();

  return page;
}

void SiteControlsBubble::updateForTab(uint64_t tabId,
                                      const QUrl &url,
                                      bool isHttps,
                                      bool hasActiveCam,
                                      bool hasActiveMic,
                                      const std::function<bool(const QString &permKey)> &hasTempGrant) {
  tabId_ = tabId;
  url_ = url;
  host_ = url.host().toLower();
  if (host_.isEmpty()) host_ = url.toString();
  canonicalOrigin_ = BrowserProfileService::canonicalOrigin(url);
  isHttps_ = isHttps;
  hasActiveCam_ = hasActiveCam;
  hasActiveMic_ = hasActiveMic;
  hasTempGrantCallback_ = hasTempGrant;

  if (mainHostLabel_) mainHostLabel_->setText(host_);
  if (secHostLabel_) secHostLabel_->setText(host_);
  if (cookiesHostLabel_) cookiesHostLabel_->setText(host_);
  if (permsHostLabel_) permsHostLabel_->setText(host_);
  if (aboutHostLabel_) aboutHostLabel_->setText(host_);

  updateSecurityPageContent();
  updateCookiesPageContent();
  updatePermissionsPageContent();
  updateAboutPageContent();

  stack_->setCurrentIndex(0);
  adjustSize();
}

void SiteControlsBubble::updateSecurityPageContent() {
  if (isHttps_) {
    if (mainSecurityIconLabel_) {
      mainSecurityIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::Privacy).pixmap(QSize(20, 20)));
    }
    if (mainSecurityTitleLabel_) {
      mainSecurityTitleLabel_->setText(QStringLiteral("Bağlantı güvenli"));
    }
    if (mainSecuritySubLabel_) {
      mainSecuritySubLabel_->setText(QStringLiteral("Bilgileriniz bu sitede güvende"));
    }
    if (secStatusIconLabel_) {
      secStatusIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::Privacy).pixmap(QSize(20, 20)));
    }
    if (secStatusTitleLabel_) {
      secStatusTitleLabel_->setText(QStringLiteral("Bağlantı güvenli"));
    }
    if (secStatusDescLabel_) {
      secStatusDescLabel_->setText(QStringLiteral(
          "Bu siteye gönderdiğiniz bilgiler (örneğin parolalar veya kredi kartı bilgileri) gizli tutulur."));
    }
    if (secCertIconLabel_) {
      secCertIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::ProtectedContent).pixmap(QSize(20, 20)));
    }
    if (secCertTitleLabel_) {
      secCertTitleLabel_->setText(QStringLiteral("Sertifika geçerli"));
    }
    if (secCertDescLabel_) {
      secCertDescLabel_->setText(QStringLiteral("Sertifika bu bağlantı için doğrulandı (TLS / Şifreli bağlantı)."));
    }
  } else {
    if (mainSecurityIconLabel_) {
      mainSecurityIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::InsecureContent).pixmap(QSize(20, 20)));
    }
    if (mainSecurityTitleLabel_) {
      mainSecurityTitleLabel_->setText(QStringLiteral("Bağlantı güvenli değil"));
    }
    if (mainSecuritySubLabel_) {
      mainSecuritySubLabel_->setText(QStringLiteral("Gönderilen bilgiler şifrelenmiyor"));
    }
    if (secStatusIconLabel_) {
      secStatusIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::InsecureContent).pixmap(QSize(20, 20)));
    }
    if (secStatusTitleLabel_) {
      secStatusTitleLabel_->setText(QStringLiteral("Bağlantı güvenli değil"));
    }
    if (secStatusDescLabel_) {
      secStatusDescLabel_->setText(QStringLiteral(
          "Bu sitede hassas bilgilerinizi (örneğin parolalar veya kredi kartı bilgileri) girmemelisiniz. Çünkü bu bilgiler saldırganlar tarafından çalınabilir."));
    }
    if (secCertIconLabel_) {
      secCertIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::InsecureContent).pixmap(QSize(20, 20)));
    }
    if (secCertTitleLabel_) {
      secCertTitleLabel_->setText(QStringLiteral("Sertifika yok"));
    }
    if (secCertDescLabel_) {
      secCertDescLabel_->setText(QStringLiteral("Bu site için geçerli bir SSL/TLS güvenlik sertifikası bulunmuyor."));
    }
  }
}

void SiteControlsBubble::updateCookiesPageContent() {
  const int count = profileService_ ? profileService_->cookiesCountForHost(host_) : 0;
  if (mainCookiesSubLabel_) {
    mainCookiesSubLabel_->setText(QStringLiteral("%1 çerez kullanımda").arg(count));
  }
  if (cookiesCountLabel_) {
    cookiesCountLabel_->setText(QStringLiteral("Bu site için %1 adet çerez depolanıyor").arg(count));
  }
  if (cookiesStatusLabel_) {
    cookiesStatusLabel_->hide();
  }
}

void SiteControlsBubble::updatePermissionsPageContent() {
  refreshPermissions();
}

void SiteControlsBubble::refreshPermissions() {
  if (!profileService_ || canonicalOrigin_.isEmpty()) return;

  for (const auto &row : permRows_) {
    const QStringList allowed = profileService_->allowedOrigins(row.key);
    const QStringList denied = profileService_->deniedOrigins(row.key);

    const bool isAllowed = allowed.contains(canonicalOrigin_);
    const bool isDenied = denied.contains(canonicalOrigin_);

    row.combo->blockSignals(true);
    if (isAllowed) {
      row.combo->setCurrentIndex(1); // İzin ver
      if (row.tempBadgeLabel) row.tempBadgeLabel->hide();
    } else if (isDenied) {
      row.combo->setCurrentIndex(2); // Engelle
      if (row.tempBadgeLabel) row.tempBadgeLabel->hide();
    } else {
      row.combo->setCurrentIndex(0); // Sor
      const bool hasTemp = hasTempGrantCallback_ && hasTempGrantCallback_(row.key);
      if (row.tempBadgeLabel) {
        row.tempBadgeLabel->setVisible(hasTemp);
      }
    }
    row.combo->blockSignals(false);
  }
}

void SiteControlsBubble::updateAboutPageContent() {
  if (aboutUrlLabel_) aboutUrlLabel_->setText(url_.toString());
  if (aboutProtocolLabel_) {
    aboutProtocolLabel_->setText(isHttps_ ? QStringLiteral("HTTPS (Güvenli Şifreli Bağlantı)") : QStringLiteral("HTTP (Güvenli Değil)"));
  }
  if (aboutSecurityDetailLabel_) {
    aboutSecurityDetailLabel_->setText(
        isHttps_ ? QStringLiteral("Bu sayfa TLS şifrelemesi kullanır. Verileriniz üçüncü şahıslardan korunur.")
                 : QStringLiteral("Bu sayfa şifrelenmemiştir. Ağınızdaki başkaları aktarılan verileri görebilir."));
  }
}

void SiteControlsBubble::keyPressEvent(QKeyEvent *event) {
  if (event->key() == Qt::Key_Escape) {
    hide();
    event->accept();
    return;
  }
  if (event->key() == Qt::Key_Back || event->key() == Qt::Key_Backspace) {
    if (stack_ && stack_->currentIndex() != 0) {
      stack_->setCurrentIndex(0);
      event->accept();
      return;
    }
  }
  QFrame::keyPressEvent(event);
}

void SiteControlsBubble::hideEvent(QHideEvent *event) {
  hasTempGrantCallback_ = nullptr;
  QFrame::hideEvent(event);
}

void SiteControlsBubble::paintEvent(QPaintEvent *event) {
  Q_UNUSED(event);
  QStyleOption opt;
  opt.initFrom(this);
  QPainter p(this);
  style()->drawPrimitive(QStyle::PE_Widget, &opt, &p, this);
}

int SiteControlsBubble::permissionChoice(const QString &key) const {
  for (const auto &row : permRows_) {
    if (row.key == key && row.combo) {
      return row.combo->currentIndex();
    }
  }
  return -1;
}

bool SiteControlsBubble::isTemporaryBadgeVisible(const QString &key) const {
  for (const auto &row : permRows_) {
    if (row.key == key && row.tempBadgeLabel) {
      return !row.tempBadgeLabel->isHidden();
    }
  }
  return false;
}

void SiteControlsBubble::setPermissionChoice(const QString &key, int choice) {
  for (const auto &row : permRows_) {
    if (row.key == key && row.combo) {
      row.combo->setCurrentIndex(choice);
      return;
    }
  }
}

void SiteControlsBubble::triggerResetAllPermissions() {
  if (resetAllPermsBtn_) {
    resetAllPermsBtn_->click();
  }
}

QString SiteControlsBubble::securityTitle() const {
  return secStatusTitleLabel_ ? secStatusTitleLabel_->text() : QString();
}

QString SiteControlsBubble::securityDescription() const {
  return secStatusDescLabel_ ? secStatusDescLabel_->text() : QString();
}

QString SiteControlsBubble::cookiesCountText() const {
  return cookiesCountLabel_ ? cookiesCountLabel_->text() : QString();
}

void SiteControlsBubble::triggerClearCookies() {
  if (cookiesClearBtn_) {
    cookiesClearBtn_->click();
  }
}

int SiteControlsBubble::stackIndex() const {
  return stack_ ? stack_->currentIndex() : 0;
}

void SiteControlsBubble::setStackIndex(int idx) {
  if (stack_) {
    stack_->setCurrentIndex(idx);
  }
}
