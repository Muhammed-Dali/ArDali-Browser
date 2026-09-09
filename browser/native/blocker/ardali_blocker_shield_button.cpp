#include "ardali_blocker_shield_button.h"

#include <QCheckBox>
#include <QGridLayout>
#include <QHBoxLayout>
#include <QLabel>
#include <QPainter>
#include <QPainterPath>
#include <QPushButton>
#include <QSignalBlocker>
#include <QStyleOptionToolButton>
#include <QToolButton>
#include <QVBoxLayout>

#include "ardali_blocker_service.h"
#include "glow_toggle_switch.h"

// ---------------- ArDaliBlockerQuickPopup ----------------

ArDaliBlockerQuickPopup::ArDaliBlockerQuickPopup(ArDaliBlockerService *service, QWidget *parent)
    : QFrame(parent, Qt::Popup | Qt::FramelessWindowHint), service_(service) {
  setObjectName(QStringLiteral("deliblock-quick-panel"));
  setAttribute(Qt::WA_DeleteOnClose, false);
  setMinimumWidth(424);
  setStyleSheet(QStringLiteral(
      "QFrame#deliblock-quick-panel { background: #181f28; border: 1px solid #364659; border-radius: 12px; color: #e4ebf5; }"
      "QPushButton { background: #222d3b; color: #e4ebf5; border: 1px solid #364659; border-radius: 7px; padding: 4px 12px; font-size: 12px; font-weight: 600; min-height: 24px; }"
      "QPushButton:hover { background: #2f3e52; border-color: #4ec9ff; color: #ffffff; }"
      "QComboBox { background: #1b2430; color: #e4ebf5; border: 1px solid #364659; border-radius: 6px; padding: 3px 28px 3px 9px; font-size: 11px; min-height: 24px; }"
      "QComboBox:hover { border-color: #4ec9ff; }"
      "QComboBox:focus { border-color: #4ec9ff; }"
      "QComboBox::drop-down { width: 24px; border: 0; border-left: 1px solid #364659; }"
      "QComboBox QAbstractItemView { background: #181f28; border: 1px solid #43566d; color: #e4ebf5; outline: 0; padding: 4px; selection-background-color: #276b87; selection-color: #ffffff; }"
      "QToolButton#adblock-site-reset { background: transparent; border: 1px solid transparent; border-radius: 6px; padding: 4px; }"
      "QToolButton#adblock-site-reset:hover { background: #222d3b; border-color: #364659; }"
  ));

  auto *layout = new QVBoxLayout(this);
  layout->setContentsMargins(16, 15, 16, 14);
  layout->setSpacing(9);

  // Top Header Row: Favicon/Icon + Host info + Master Toggle
  auto *headerRow = new QHBoxLayout;
  headerRow->setSpacing(10);

  auto *shieldIcon = new QLabel(this);
  shieldIcon->setFixedSize(24, 24);
  shieldIcon->setPixmap(QIcon(QStringLiteral(":/side-widget-icons/deliblock.svg"))
                            .pixmap(QSize(22, 22)));
  shieldIcon->setAlignment(Qt::AlignCenter);
  headerRow->addWidget(shieldIcon);

  auto *hostMetaBox = new QVBoxLayout;
  hostMetaBox->setSpacing(2);
  hostLabel_ = new QLabel(QStringLiteral("—"), this);
  hostLabel_->setStyleSheet(QStringLiteral("font-size: 14px; font-weight: 700; color: #ffffff;"));
  statusSubtitleLabel_ = new QLabel(QStringLiteral("ArDali Koruma açık"), this);
  statusSubtitleLabel_->setStyleSheet(QStringLiteral("font-size: 11px; color: #8c9ba8;"));
  hostMetaBox->addWidget(hostLabel_);
  hostMetaBox->addWidget(statusSubtitleLabel_);
  headerRow->addLayout(hostMetaBox, 1);

  masterCheck_ = new GlowToggleSwitch(this);
  masterCheck_->setObjectName(QStringLiteral("adblock-master-toggle"));
  masterCheck_->setToolTip(QStringLiteral("Bu sitede korumayı aç veya kapat"));
  masterCheck_->setFixedSize(54, 28);
  headerRow->addWidget(masterCheck_, 0, Qt::AlignVCenter);
  auto *reset = new QToolButton(this);
  reset->setObjectName(QStringLiteral("adblock-site-reset"));
  reset->setIcon(QIcon(QStringLiteral(":/browser-icons/reset.svg")));
  reset->setIconSize(QSize(17, 17));
  reset->setFixedSize(28, 28);
  reset->setToolTip(QStringLiteral("Bu site için koruma ayarlarını varsayılana döndür"));
  reset->setAccessibleName(reset->toolTip());
  headerRow->addWidget(reset);
  connect(reset, &QToolButton::clicked, this, [this] {
    if (!service_ || currentHost_.isEmpty()) return;
    service_->settings()->removeSitePolicy(currentHost_);
    updateForHost(currentHost_, blockedCount_);
    if (!service_->settings()->autoReloadOnModeChange()) emit reloadRequested();
  });
  layout->addLayout(headerRow);

  connect(masterCheck_, &QCheckBox::toggled, this, [this](bool checked) {
    if (!service_ || currentHost_.isEmpty()) return;
    SitePolicy p = service_->settings()->sitePolicy(currentHost_);
    p.whitelisted = !checked;
    service_->settings()->setSitePolicy(currentHost_, p);
    updateForHost(currentHost_, blockedCount_);
    if (!service_->settings()->autoReloadOnModeChange()) emit reloadRequested();
  });

  if (service_) {
    connect(service_->settings(), &ArDaliBlockerSettings::protectionEnabledChanged,
            this, [this](bool) {
      updateForHost(currentHost_, blockedCount_);
    });
  }

  if (service_) {
    connect(service_->settings(), &ArDaliBlockerSettings::settingsChanged,
            this, [this] { updateForHost(currentHost_, blockedCount_); });
  }

  // Summary Card: Large number + summary text
  auto *summaryCard = new QFrame(this);
  summaryCard->setObjectName(QStringLiteral("shields-summary-card"));
  summaryCard->setStyleSheet(QStringLiteral(
      "QFrame#shields-summary-card { background: #111720; border: 1px solid #2a3747; border-radius: 8px; padding: 8px 12px; }"
  ));
  auto *sumLayout = new QHBoxLayout(summaryCard);
  sumLayout->setContentsMargins(10, 8, 10, 8);
  sumLayout->setSpacing(10);

  countLabel_ = new QLabel(QStringLiteral("0"), summaryCard);
  countLabel_->setObjectName(QStringLiteral("adblock-popup-blocked-count"));
  countLabel_->setStyleSheet(QStringLiteral("font-size: 25px; font-weight: 800; color: #ffffff;"));
  countTextLabel_ = new QLabel(QStringLiteral("izleyici, reklam ve daha fazlası engellendi"), summaryCard);
  countTextLabel_->setStyleSheet(QStringLiteral("font-size: 12px; color: #a0b2c6; line-height: 1.3;"));
  countTextLabel_->setWordWrap(true);

  sumLayout->addWidget(countLabel_);
  sumLayout->addWidget(countTextLabel_, 1);
  layout->addWidget(summaryCard);

  // Notice label (for internal pages)
  noticeLabel_ = new QLabel(this);
  noticeLabel_->setStyleSheet(QStringLiteral("color: #ff9d00; font-size: 11px; font-style: italic;"));
  noticeLabel_->setWordWrap(true);
  noticeLabel_->hide();
  layout->addWidget(noticeLabel_);

  // Basic Toggles
  siteProtectionCheck_ = new GlowToggleSwitch(QStringLiteral("Bu sitede koruma"), this);
  siteProtectionCheck_->setObjectName(QStringLiteral("adblock-site-protection-toggle"));
  adsCheck_ = new GlowToggleSwitch(QStringLiteral("Reklamları engelle"), this);
  trackersCheck_ = new GlowToggleSwitch(QStringLiteral("İzleyicileri engelle"), this);

  layout->addWidget(siteProtectionCheck_);
  layout->addWidget(adsCheck_);
  layout->addWidget(trackersCheck_);

  connect(siteProtectionCheck_, &QCheckBox::toggled, this, [this](bool checked) {
    if (!service_ || currentHost_.isEmpty()) return;
    SitePolicy p = service_->settings()->sitePolicy(currentHost_);
    p.whitelisted = !checked;
    service_->settings()->setSitePolicy(currentHost_, p);
    updateForHost(currentHost_, blockedCount_);
    if (!service_->settings()->autoReloadOnModeChange()) emit reloadRequested();
  });

  connect(adsCheck_, &QCheckBox::toggled, this, [this](bool checked) {
    if (!service_ || currentHost_.isEmpty()) return;
    SitePolicy p = service_->settings()->sitePolicy(currentHost_);
    p.adBlocking = checked;
    service_->settings()->setSitePolicy(currentHost_, p);
    if (!service_->settings()->autoReloadOnModeChange()) emit reloadRequested();
  });

  connect(trackersCheck_, &QCheckBox::toggled, this, [this](bool checked) {
    if (!service_ || currentHost_.isEmpty()) return;
    SitePolicy p = service_->settings()->sitePolicy(currentHost_);
    p.trackerProtection = checked;
    service_->settings()->setSitePolicy(currentHost_, p);
    if (!service_->settings()->autoReloadOnModeChange()) emit reloadRequested();
  });

  // Collapsible Advanced Options Header
  auto *advHeader = new QPushButton(this);
  advHeader->setObjectName(QStringLiteral("adv-header-btn"));
  advHeader->setFlat(true);
  advHeader->setCursor(Qt::PointingHandCursor);
  advHeader->setStyleSheet(QStringLiteral(
      "QPushButton#adv-header-btn { background: transparent; border: 0; padding: 6px 2px; text-align: left; font-size: 12px; font-weight: 600; color: #a0b2c6; }"
      "QPushButton#adv-header-btn:hover { color: #ffffff; }"
  ));
  auto *advHeaderLayout = new QHBoxLayout(advHeader);
  advHeaderLayout->setContentsMargins(0, 0, 0, 0);
  auto *gearIcon = new QLabel(advHeader);
  gearIcon->setFixedSize(18, 18);
  gearIcon->setPixmap(QIcon(QStringLiteral(":/browser-icons/settings.svg")).pixmap(QSize(16, 16)));
  gearIcon->setAlignment(Qt::AlignCenter);
  auto *advTitle = new QLabel(QStringLiteral("Gelişmiş seçenekler"), advHeader);
  advTitle->setStyleSheet(QStringLiteral("font-size: 12px; font-weight: 600; color: #d0dbe8;"));
  advancedChevron_ = new QLabel(advHeader);
  advancedChevron_->setFixedSize(18, 18);
  advancedChevron_->setPixmap(QIcon(QStringLiteral(":/browser-icons/chevron-right.svg")).pixmap(QSize(14, 14)));
  advancedChevron_->setAlignment(Qt::AlignCenter);
  advHeaderLayout->addWidget(gearIcon);
  advHeaderLayout->addWidget(advTitle);
  advHeaderLayout->addStretch(1);
  advHeaderLayout->addWidget(advancedChevron_);
  for (auto *label : {gearIcon, advTitle, advancedChevron_})
    label->setAttribute(Qt::WA_TransparentForMouseEvents);
  layout->addWidget(advHeader);

  // Collapsible Container
  advancedContainer_ = new QWidget(this);
  auto *advLayout = new QVBoxLayout(advancedContainer_);
  advLayout->setContentsMargins(0, 2, 0, 2);
  advLayout->setSpacing(8);
  advancedContainer_->hide();

  connect(advHeader, &QPushButton::clicked, this, [this] {
    const bool expanded = !advancedContainer_->isVisible();
    advancedContainer_->setVisible(expanded);
    advancedChevron_->setPixmap(QIcon(expanded ? QStringLiteral(":/browser-icons/chevron-down.svg")
                                               : QStringLiteral(":/browser-icons/chevron-right.svg"))
                                      .pixmap(QSize(14, 14)));
    adjustSize();
  });

  auto *advancedGrid = new QGridLayout;
  advancedGrid->setContentsMargins(0, 1, 0, 1);
  advancedGrid->setHorizontalSpacing(10);
  advancedGrid->setVerticalSpacing(5);
  advancedGrid->setColumnMinimumWidth(0, 18);
  advancedGrid->setColumnStretch(1, 1);
  advancedGrid->setColumnMinimumWidth(2, 124);
  advLayout->addLayout(advancedGrid);

  const auto addIcon = [this, advancedGrid](int row, const QString &path) {
    auto *label = new QLabel(advancedContainer_);
    label->setFixedSize(18, 34);
    label->setPixmap(QIcon(path).pixmap(QSize(17, 17)));
    label->setAlignment(Qt::AlignCenter);
    advancedGrid->addWidget(label, row, 0, Qt::AlignVCenter);
  };
  const auto addLabel = [this, advancedGrid](int row, const QString &text) {
    auto *label = new QLabel(text, advancedContainer_);
    label->setStyleSheet(QStringLiteral("font-size: 12px; color: #d0dbe8; font-weight: 500;"));
    label->setMinimumHeight(34);
    label->setAlignment(Qt::AlignLeft | Qt::AlignVCenter);
    advancedGrid->addWidget(label, row, 1);
    return label;
  };
  const auto prepareToggle = [advancedGrid](int row, QCheckBox *toggle, const QString &name) {
    toggle->setAccessibleName(name);
    toggle->setFixedSize(54, 28);
    advancedGrid->addWidget(toggle, row, 2, Qt::AlignRight | Qt::AlignVCenter);
  };

  // Row A: İzleyicileri & reklamları engelle
  addIcon(0, QStringLiteral(":/browser-icons/privacy.svg"));
  addLabel(0, QStringLiteral("İzleyicileri & reklamları engelle"));
  adsModeCombo_ = new QComboBox(advancedContainer_);
  adsModeCombo_->addItems({QStringLiteral("Standart"), QStringLiteral("Agresif"), QStringLiteral("Kapalı")});
  adsModeCombo_->setFixedWidth(124);
  advancedGrid->addWidget(adsModeCombo_, 0, 2, Qt::AlignRight | Qt::AlignVCenter);

  connect(adsModeCombo_, qOverload<int>(&QComboBox::currentIndexChanged), this, [this](int index) {
    if (!service_ || currentHost_.isEmpty()) return;
    SitePolicy p = service_->settings()->sitePolicy(currentHost_);
    if (index == 0) { // Standart
      p.whitelisted = false;
      p.adBlocking = true;
      p.trackerProtection = true;
      p.perSiteMode = static_cast<int>(ArDaliBlockerMode::Ideal);
    } else if (index == 1) { // Agresif
      p.whitelisted = false;
      p.adBlocking = true;
      p.trackerProtection = true;
      p.perSiteMode = static_cast<int>(ArDaliBlockerMode::Aggressive);
    } else if (index == 2) { // Kapalı
      p.whitelisted = true;
    }
    service_->settings()->setSitePolicy(currentHost_, p);
    updateForHost(currentHost_, blockedCount_);
    if (!service_->settings()->autoReloadOnModeChange()) emit reloadRequested();
  });

  // Row B: Bağlantıları HTTPS'e yükselt
  addIcon(1, QStringLiteral(":/browser-icons/password.svg"));
  addLabel(1, QStringLiteral("Bağlantıları HTTPS'e yükselt"));
  httpsCheck_ = new GlowToggleSwitch(advancedContainer_);
  httpsCheck_->setObjectName(QStringLiteral("adblock-httpsCheck"));
  prepareToggle(1, httpsCheck_, QStringLiteral("Bağlantıları HTTPS'e yükselt"));

  connect(httpsCheck_, &QCheckBox::toggled, this, [this](bool checked) {
    if (!service_ || currentHost_.isEmpty()) return;
    SitePolicy p = service_->settings()->sitePolicy(currentHost_);
    p.upgradeHttps = checked;
    service_->settings()->setSitePolicy(currentHost_, p);
    if (!service_->settings()->autoReloadOnModeChange()) emit reloadRequested();
  });

  // Row C: Script'leri engelle
  addIcon(2, QStringLiteral(":/browser-icons/javascript-slash.svg"));
  addLabel(2, QStringLiteral("Script'leri engelle"));
  scriptsCheck_ = new GlowToggleSwitch(advancedContainer_);
  scriptsCheck_->setObjectName(QStringLiteral("adblock-scriptsCheck"));
  prepareToggle(2, scriptsCheck_, QStringLiteral("Script'leri engelle"));

  connect(scriptsCheck_, &QCheckBox::toggled, this, [this](bool checked) {
    if (!service_ || currentHost_.isEmpty()) return;
    SitePolicy p = service_->settings()->sitePolicy(currentHost_);
    p.blockScripts = checked;
    service_->settings()->setSitePolicy(currentHost_, p);
    if (!service_->settings()->autoReloadOnModeChange()) emit reloadRequested();
  });

  // Row D: Parmak izi kontrolünü engelle
  addIcon(3, QStringLiteral(":/browser-icons/protected-content.svg"));
  addLabel(3, QStringLiteral("Parmak izi kontrolünü engelle"));
  fingerprintCheck_ = new GlowToggleSwitch(advancedContainer_);
  fingerprintCheck_->setObjectName(QStringLiteral("adblock-fingerprintCheck"));
  fingerprintCheck_->setToolTip(QStringLiteral("Canvas piksel okumasını engeller ve WebGL cihaz bilgisini sınırlar."));
  prepareToggle(3, fingerprintCheck_, QStringLiteral("Parmak izi kontrolünü engelle"));

  connect(fingerprintCheck_, &QCheckBox::toggled, this, [this](bool checked) {
    if (!service_ || currentHost_.isEmpty()) return;
    SitePolicy p = service_->settings()->sitePolicy(currentHost_);
    p.blockFingerprinting = checked;
    service_->settings()->setSitePolicy(currentHost_, p);
    if (!service_->settings()->autoReloadOnModeChange()) emit reloadRequested();
  });

  // Row E: Üçüncü taraf çerezlerini engelle
  addIcon(4, QStringLiteral(":/browser-icons/cookie.svg"));
  addLabel(4, QStringLiteral("Üçüncü taraf çerezleri"));
  cookieCombo_ = new QComboBox(advancedContainer_);
  cookieCombo_->addItems({QStringLiteral("Engellendi"), QStringLiteral("Tümüne izin ver"), QStringLiteral("Tümünü engelle")});
  cookieCombo_->setFixedWidth(124);
  advancedGrid->addWidget(cookieCombo_, 4, 2, Qt::AlignRight | Qt::AlignVCenter);

  connect(cookieCombo_, qOverload<int>(&QComboBox::currentIndexChanged), this, [this](int index) {
    if (!service_ || currentHost_.isEmpty()) return;
    SitePolicy p = service_->settings()->sitePolicy(currentHost_);
    if (index == 1) p.cookiePolicy = QStringLiteral("allow_all");
    else if (index == 2) p.cookiePolicy = QStringLiteral("block_all");
    else p.cookiePolicy = QStringLiteral("third_party");
    service_->settings()->setSitePolicy(currentHost_, p);
    if (!service_->settings()->autoReloadOnModeChange()) emit reloadRequested();
  });

  // Row F: Bu siteyi kapattığımda beni unut
  addIcon(5, QStringLiteral(":/browser-icons/trash.svg"));
  addLabel(5, QStringLiteral("Bu siteyi kapattığımda beni unut"));
  forgetOnCloseCheck_ = new GlowToggleSwitch(advancedContainer_);
  forgetOnCloseCheck_->setObjectName(QStringLiteral("adblock-forgetOnCloseCheck"));
  forgetOnCloseCheck_->setToolTip(QStringLiteral("Son site sekmesi kapanınca çerezleri ve bu sayfanın yerel depolamasını temizler."));
  prepareToggle(5, forgetOnCloseCheck_, QStringLiteral("Bu siteyi kapattığımda beni unut"));

  connect(forgetOnCloseCheck_, &QCheckBox::toggled, this, [this](bool checked) {
    if (!service_ || currentHost_.isEmpty()) return;
    SitePolicy p = service_->settings()->sitePolicy(currentHost_);
    p.forgetOnClose = checked;
    service_->settings()->setSitePolicy(currentHost_, p);
  });

  layout->addWidget(advancedContainer_);

  // Bottom Buttons: "Listeleri filtrele" & "Genel Ayarlar"
  auto *btnRow = new QHBoxLayout;
  btnRow->setSpacing(8);

  auto *filterListsBtn = new QPushButton(QStringLiteral("Listeleri filtrele"), this);
  filterListsBtn->setObjectName(QStringLiteral("btn-filter-lists"));
  filterListsBtn->setMinimumHeight(30);
  connect(filterListsBtn, &QPushButton::clicked, this, [this] {
    emit openRulesetsRequested();
    hide();
  });

  auto *settingsBtn = new QPushButton(QStringLiteral("Genel Ayarlar"), this);
  settingsBtn->setObjectName(QStringLiteral("btn-general-settings"));
  settingsBtn->setMinimumHeight(30);
  connect(settingsBtn, &QPushButton::clicked, this, [this] {
    emit openSettingsRequested();
    hide();
  });

  btnRow->addWidget(filterListsBtn, 1);
  btnRow->addWidget(settingsBtn, 1);
  layout->addLayout(btnRow);

  // Footer Note
  auto *footerNote = new QLabel(
      QStringLiteral("Bu site bozuk görünüyorsa ArDali Koruma’yı geçici olarak kapatmayı deneyin."),
      this);
  footerNote->setStyleSheet(QStringLiteral("font-size: 10px; color: #718399; margin-top: 3px; margin-bottom: 1px;"));
  footerNote->setAlignment(Qt::AlignCenter);
  footerNote->setWordWrap(true);
  layout->addWidget(footerNote);
  for (auto *check : findChildren<QCheckBox *>()) {
    check->setProperty("trailingTrack", true);
    check->setMinimumHeight(32);
    if (!check->text().isEmpty()) check->setAccessibleName(check->text());
  }
  hostLabel_->setTextFormat(Qt::PlainText);
  hostLabel_->setMaximumWidth(260);
}

void ArDaliBlockerQuickPopup::updateForHost(const QString &host, quint64 blockedCount) {
  blockedCount_ = blockedCount;
  currentHost_ = host.trimmed().toLower();
  currentHost_ = ArDaliBlockerSettings::normalizeSiteHost(currentHost_);

  const bool isInternal = currentHost_.isEmpty() ||
                          currentHost_ == QLatin1String("newtab") ||
                          currentHost_ == QLatin1String("settings") ||
                          currentHost_ == QLatin1String("adblock") ||
                          currentHost_ == QLatin1String("blocker");

  hostLabel_->setText(isInternal ? QStringLiteral("Dahili / Boş Sekme") : currentHost_);
  countLabel_->setText(QString::number(blockedCount_));
  if (blockedBadge_) blockedBadge_->setText(QString::number(blockedCount_));
  if (countTextLabel_) {
    countTextLabel_->setText(blockedCount_ == 1 ? QStringLiteral("izleyici veya reklam engellendi")
                                               : QStringLiteral("izleyici, reklam ve daha fazlası engellendi"));
  }

  const bool protectionEnabled = service_ && service_->settings()->protectionEnabled();

  if (isInternal) {
    masterCheck_->setEnabled(false);
    siteProtectionCheck_->setEnabled(false);
    adsCheck_->setEnabled(false);
    trackersCheck_->setEnabled(false);
    if (advancedContainer_) advancedContainer_->setEnabled(false);
    statusSubtitleLabel_->setText(QStringLiteral("Dahili tarayıcı sayfası"));
    noticeLabel_->setText(QStringLiteral("Dahili tarayıcı sayfalarında reklam engelleme devre dışıdır."));
    noticeLabel_->show();
    return;
  }

  if (service_ && !currentHost_.isEmpty()) {
    const SitePolicy p = service_->settings()->sitePolicy(currentHost_);
    const bool activeOnSite = protectionEnabled && !p.whitelisted;

    statusSubtitleLabel_->setText(activeOnSite ? QStringLiteral("ArDali Koruma açık")
                                               : QStringLiteral("ArDali Koruma kapalı"));

    const QSignalBlocker blocker_masterCheck_(masterCheck_);
    const QSignalBlocker blocker_siteProtectionCheck_(siteProtectionCheck_);
    const QSignalBlocker blocker_adsCheck_(adsCheck_);
    const QSignalBlocker blocker_trackersCheck_(trackersCheck_);
    const QSignalBlocker blocker_adsModeCombo_(adsModeCombo_);
    const QSignalBlocker blocker_httpsCheck_(httpsCheck_);
    const QSignalBlocker blocker_scriptsCheck_(scriptsCheck_);
    const QSignalBlocker blocker_fingerprintCheck_(fingerprintCheck_);
    const QSignalBlocker blocker_cookieCombo_(cookieCombo_);
    const QSignalBlocker blocker_forgetOnCloseCheck_(forgetOnCloseCheck_);

    masterCheck_->setChecked(!p.whitelisted);
    siteProtectionCheck_->setChecked(!p.whitelisted);
    adsCheck_->setChecked(p.adBlocking);
    trackersCheck_->setChecked(p.trackerProtection);

    if (p.whitelisted) {
      adsModeCombo_->setCurrentIndex(2); // Kapalı
    } else if (p.perSiteMode == static_cast<int>(ArDaliBlockerMode::Aggressive) ||
               (p.perSiteMode < 0 && service_->settings()->mode() == ArDaliBlockerMode::Aggressive)) {
      adsModeCombo_->setCurrentIndex(1); // Agresif
    } else {
      adsModeCombo_->setCurrentIndex(0); // Standart
    }

    httpsCheck_->setChecked(p.upgradeHttps);
    scriptsCheck_->setChecked(p.blockScripts);
    fingerprintCheck_->setChecked(p.blockFingerprinting);

    if (p.cookiePolicy == QLatin1String("allow_all")) {
      cookieCombo_->setCurrentIndex(1);
    } else if (p.cookiePolicy == QLatin1String("block_all")) {
      cookieCombo_->setCurrentIndex(2);
    } else {
      cookieCombo_->setCurrentIndex(0); // Engellendi (third_party)
    }

    forgetOnCloseCheck_->setChecked(p.forgetOnClose);

    masterCheck_->setEnabled(protectionEnabled);
    siteProtectionCheck_->setEnabled(protectionEnabled);
    adsCheck_->setEnabled(activeOnSite);
    trackersCheck_->setEnabled(activeOnSite);
    if (advancedContainer_) advancedContainer_->setEnabled(protectionEnabled);

    noticeLabel_->setVisible(!protectionEnabled || p.whitelisted);
    if (!protectionEnabled) {
      noticeLabel_->setText(QStringLiteral("Reklam engelleyici genel anahtardan kapalı."));
    } else if (p.whitelisted) {
      noticeLabel_->setText(
          QStringLiteral("Bu sitede koruma kapalı. Site reklam sunarsa reklamlar gösterilir."));
    }











  } else {
    masterCheck_->setEnabled(false);
    siteProtectionCheck_->setEnabled(false);
    adsCheck_->setEnabled(false);
    trackersCheck_->setEnabled(false);
    noticeLabel_->hide();
  }
}

void ArDaliBlockerQuickPopup::showEvent(QShowEvent *event) {
  QFrame::showEvent(event);
  updateForHost(currentHost_, blockedCount_);
}

// ---------------- ArDaliBlockerShieldButton ----------------

ArDaliBlockerShieldButton::ArDaliBlockerShieldButton(ArDaliBlockerService *service, QWidget *parent)
    : QToolButton(parent), service_(service) {
  setObjectName(QStringLiteral("adblock-shield-button"));
  setIcon(QIcon(QStringLiteral(":/side-widget-icons/deliblock.svg")));
  setIconSize(QSize(20, 20));
  setFixedSize(30, 30);
  setCursor(Qt::PointingHandCursor);
  setToolTip(QStringLiteral("ArDali Koruma (Reklam Engelleyici)"));
  setAccessibleName(QStringLiteral("Reklam engelleyici kalkanı"));

  setStyleSheet(QStringLiteral(
      "QToolButton#adblock-shield-button { background: transparent; border: 0; border-radius: 15px; padding: 2px; }"
      "QToolButton#adblock-shield-button:hover { background: #383a3d; }"
  ));

  if (service_) {
    showBadge_ = service_->settings()->showBlockedCountOnToolbar();
    connect(service_->settings(), &ArDaliBlockerSettings::toolbarCountVisibilityChanged, this, [this](bool visible) {
      showBadge_ = visible;
      update();
    });
  }

  connect(this, &QToolButton::clicked, this, &ArDaliBlockerShieldButton::showQuickPopup);
}

void ArDaliBlockerShieldButton::setBlockedCount(quint64 count) {
  if (blockedCount_ == count) return;
  blockedCount_ = count;
  if (popup_) popup_->updateForHost(currentHost_, blockedCount_);
  update();
}

void ArDaliBlockerShieldButton::setActiveHost(const QString &host) {
  currentHost_ = host.trimmed().toLower();
  if (popup_) popup_->updateForHost(currentHost_, blockedCount_);
}

void ArDaliBlockerShieldButton::setInternalPage(bool internal) {
  if (isInternalPage_ == internal) return;
  isInternalPage_ = internal;
  if (isInternalPage_) {
    blockedCount_ = 0;
    currentHost_.clear();
  }
  update();
}

void ArDaliBlockerShieldButton::showQuickPopup() {
  if (!popup_) {
    popup_ = new ArDaliBlockerQuickPopup(service_, window());
    connect(popup_, &ArDaliBlockerQuickPopup::openSettingsRequested, this, &ArDaliBlockerShieldButton::openSettingsRequested);
    connect(popup_, &ArDaliBlockerQuickPopup::openRulesetsRequested, this, &ArDaliBlockerShieldButton::openRulesetsRequested);
    connect(popup_, &ArDaliBlockerQuickPopup::openLoggerRequested, this, &ArDaliBlockerShieldButton::openLoggerRequested);
    connect(popup_, &ArDaliBlockerQuickPopup::reloadRequested, this, &ArDaliBlockerShieldButton::reloadRequested);
  }
  popup_->updateForHost(currentHost_, blockedCount_);
  const QPoint pos = mapToGlobal(QPoint(width() - popup_->width(), height() + 4));
  popup_->move(pos);
  popup_->show();
}

void ArDaliBlockerShieldButton::paintEvent(QPaintEvent *event) {
  QToolButton::paintEvent(event);

  QPainter p(this);
  p.setRenderHint(QPainter::Antialiasing, true);

  if (icon().isNull() || icon().pixmap(iconSize()).isNull()) {
    // Vector shield fallback
    const QRectF r(width() / 2.0 - 8.0, height() / 2.0 - 9.0, 16.0, 18.0);
    QPainterPath path;
    path.moveTo(r.left(), r.top() + 4);
    path.quadTo(r.left() + r.width() / 2.0, r.top(), r.right(), r.top() + 4);
    path.quadTo(r.right(), r.top() + r.height() * 0.65, r.left() + r.width() / 2.0, r.bottom());
    path.quadTo(r.left(), r.top() + r.height() * 0.65, r.left(), r.top() + 4);
    p.setPen(QPen(QColor(0x4e, 0xc9, 0xff), 1.5));
    p.setBrush(QColor(0x1a, 0x30, 0x4d));
    p.drawPath(path);
  }

  // Internal pages or disabled setting: do not draw badge
  if (isInternalPage_ || !showBadge_ || blockedCount_ == 0) return;

  const QString text = blockedCount_ > 99 ? QStringLiteral("99+") : QString::number(blockedCount_);
  QFont f = p.font();
  f.setPixelSize(9);
  f.setBold(true);
  p.setFont(f);

  const QFontMetrics fm(f);
  const int textW = fm.horizontalAdvance(text);
  const int badgeW = qMax(14, textW + 6);
  const int badgeH = 13;
  const int badgeX = width() - badgeW - 1;
  const int badgeY = 1;

  p.setPen(Qt::NoPen);
  p.setBrush(QColor(0x21, 0x60, 0xc4)); // Blue accent badge
  p.drawRoundedRect(badgeX, badgeY, badgeW, badgeH, 4, 4);

  p.setPen(QColor(0xff, 0xff, 0xff));
  p.drawText(QRect(badgeX, badgeY, badgeW, badgeH), Qt::AlignCenter, text);
}
