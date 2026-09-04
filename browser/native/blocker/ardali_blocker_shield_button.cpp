#include "ardali_blocker_shield_button.h"

#include <QCheckBox>
#include <QHBoxLayout>
#include <QLabel>
#include <QPainter>
#include <QPainterPath>
#include <QPushButton>
#include <QStyleOptionToolButton>
#include <QVBoxLayout>

#include "ardali_blocker_service.h"
#include "glow_toggle_switch.h"

// ---------------- ArDaliBlockerQuickPopup ----------------

ArDaliBlockerQuickPopup::ArDaliBlockerQuickPopup(ArDaliBlockerService *service, QWidget *parent)
    : QFrame(parent, Qt::Popup | Qt::FramelessWindowHint), service_(service) {
  setObjectName(QStringLiteral("deliblock-quick-panel"));
  setAttribute(Qt::WA_DeleteOnClose, false);
  setFixedWidth(270);
  setStyleSheet(QStringLiteral(
      "QFrame#deliblock-quick-panel { background: #181f28; border: 1px solid #364659; border-radius: 10px; color: #e4ebf5; padding: 12px; }"
      "QPushButton { background: #253140; color: #e4ebf5; border: 1px solid #364659; border-radius: 6px; padding: 6px 12px; font-size: 12px; font-weight: 500; min-height: 20px; }"
      "QPushButton:hover { background: #324357; border-color: #4ec9ff; color: #ffffff; }"
  ));

  auto *layout = new QVBoxLayout(this);
  layout->setContentsMargins(12, 12, 12, 12);
  layout->setSpacing(10);

  // Title Row
  auto *titleRow = new QHBoxLayout;
  auto *shieldIcon = new QLabel(QStringLiteral("🛡"), this);
  shieldIcon->setStyleSheet(QStringLiteral("font-size: 16px;"));
  auto *titleText = new QLabel(QStringLiteral("ArDali Koruma"), this);
  titleText->setStyleSheet(QStringLiteral("font-size: 14px; font-weight: 700; color: #ffffff;"));
  masterCheck_ = new GlowToggleSwitch(this);
  masterCheck_->setObjectName(QStringLiteral("adblock-master-toggle"));
  masterCheck_->setToolTip(QStringLiteral("Reklam engelleyiciyi aç veya kapat"));
  masterCheck_->setAccessibleName(QStringLiteral("ArDali reklam engelleyici ana anahtarı"));
  titleRow->addWidget(shieldIcon);
  titleRow->addWidget(titleText);
  titleRow->addStretch(1);
  titleRow->addWidget(masterCheck_);
  layout->addLayout(titleRow);

  connect(masterCheck_, &QCheckBox::toggled, this, [this](bool checked) {
    if (service_) service_->settings()->setProtectionEnabled(checked);
  });
  if (service_) {
    connect(service_->settings(), &ArDaliBlockerSettings::protectionEnabledChanged,
            this, [this](bool enabled) {
      if (!masterCheck_) return;
      masterCheck_->blockSignals(true);
      masterCheck_->setChecked(enabled);
      masterCheck_->blockSignals(false);
      updateForHost(currentHost_, blockedCount_);
    });
  }

  // Host Info
  auto *hostBox = new QVBoxLayout;
  auto *hostTag = new QLabel(QStringLiteral("Aktif Site:"), this);
  hostTag->setStyleSheet(QStringLiteral("font-size: 11px; color: #8c9ba8; font-weight: 600; text-transform: uppercase;"));
  hostLabel_ = new QLabel(QStringLiteral("—"), this);
  hostLabel_->setStyleSheet(QStringLiteral("font-size: 14px; font-weight: 600; color: #4ec9ff;"));
  hostLabel_->setWordWrap(true);
  hostBox->addWidget(hostTag);
  hostBox->addWidget(hostLabel_);
  layout->addLayout(hostBox);

  // Blocked Count
  auto *countRow = new QHBoxLayout;
  auto *cLabel = new QLabel(QStringLiteral("Engellenen istek:"), this);
  cLabel->setStyleSheet(QStringLiteral("font-size: 12px; color: #d0dbe8;"));
  countLabel_ = new QLabel(QStringLiteral("0"), this);
  countLabel_->setObjectName(QStringLiteral("adblock-popup-blocked-count"));
  countLabel_->setStyleSheet(QStringLiteral("font-size: 14px; font-weight: 700; color: #4ec9ff;"));
  countRow->addWidget(cLabel);
  countRow->addWidget(countLabel_);
  countRow->addStretch(1);
  layout->addLayout(countRow);

  // Notice for internal pages
  noticeLabel_ = new QLabel(this);
  noticeLabel_->setStyleSheet(QStringLiteral("color: #ff9d00; font-size: 11px; font-style: italic;"));
  noticeLabel_->setWordWrap(true);
  noticeLabel_->hide();
  layout->addWidget(noticeLabel_);

  // Toggles
  siteProtectionCheck_ = new GlowToggleSwitch(QStringLiteral("Bu sitede koruma"), this);
  siteProtectionCheck_->setObjectName(QStringLiteral("adblock-site-protection-toggle"));
  siteProtectionCheck_->setToolTip(
      QStringLiteral("Kapalı olduğunda bu sitedeki reklam ve izleyici isteklerine izin verilir"));
  siteProtectionCheck_->setAccessibleName(QStringLiteral("Bu sitede ArDali koruması"));
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
    emit reloadRequested();
  });

  connect(adsCheck_, &QCheckBox::toggled, this, [this](bool checked) {
    if (!service_ || currentHost_.isEmpty()) return;
    SitePolicy p = service_->settings()->sitePolicy(currentHost_);
    p.adBlocking = checked;
    service_->settings()->setSitePolicy(currentHost_, p);
    emit reloadRequested();
  });

  connect(trackersCheck_, &QCheckBox::toggled, this, [this](bool checked) {
    if (!service_ || currentHost_.isEmpty()) return;
    SitePolicy p = service_->settings()->sitePolicy(currentHost_);
    p.trackerProtection = checked;
    service_->settings()->setSitePolicy(currentHost_, p);
    emit reloadRequested();
  });

  // Buttons Row
  auto *btnRow = new QHBoxLayout;
  auto *pauseBtn = new QPushButton(QStringLiteral("10 dk Kapat"), this);
  pauseBtn->setToolTip(QStringLiteral("Bu site için korumayı 10 dakika boyunca askıya al"));
  connect(pauseBtn, &QPushButton::clicked, this, [this] {
    if (!service_ || currentHost_.isEmpty()) return;
    SitePolicy p = service_->settings()->sitePolicy(currentHost_);
    p.temporaryDisabledUntil = QDateTime::currentMSecsSinceEpoch() + 10 * 60 * 1000;
    service_->settings()->setSitePolicy(currentHost_, p);
    emit reloadRequested();
    hide();
  });

  auto *settingsBtn = new QPushButton(QStringLiteral("Ayarlar"), this);
  connect(settingsBtn, &QPushButton::clicked, this, [this] {
    emit openSettingsRequested();
    hide();
  });

  auto *loggerBtn = new QPushButton(QStringLiteral("Günlük"), this);
  connect(loggerBtn, &QPushButton::clicked, this, [this] {
    emit openLoggerRequested();
    hide();
  });

  btnRow->addWidget(pauseBtn);
  btnRow->addWidget(settingsBtn);
  btnRow->addWidget(loggerBtn);
  layout->addLayout(btnRow);
}

void ArDaliBlockerQuickPopup::updateForHost(const QString &host, quint64 blockedCount) {
  blockedCount_ = blockedCount;
  currentHost_ = host.trimmed().toLower();
  if (currentHost_.startsWith(QStringLiteral("www."))) currentHost_.remove(0, 4);

  hostLabel_->setText(currentHost_.isEmpty() ? QStringLiteral("Dahili / Boş Sekme") : currentHost_);
  countLabel_->setText(QString::number(blockedCount));
  const bool protectionEnabled = service_ && service_->settings()->protectionEnabled();
  masterCheck_->blockSignals(true);
  masterCheck_->setChecked(protectionEnabled);
  masterCheck_->blockSignals(false);

  if (currentHost_.isEmpty() || currentHost_ == QLatin1String("newtab") || currentHost_ == QLatin1String("settings") || currentHost_ == QLatin1String("adblock") || currentHost_ == QLatin1String("blocker")) {
    siteProtectionCheck_->setEnabled(false);
    adsCheck_->setEnabled(false);
    trackersCheck_->setEnabled(false);
    noticeLabel_->setText(QStringLiteral("Dahili tarayıcı sayfalarında reklam engelleme devre dışıdır."));
    noticeLabel_->show();
    return;
  }

  if (service_ && !currentHost_.isEmpty()) {
    const SitePolicy p = service_->settings()->sitePolicy(currentHost_);
    siteProtectionCheck_->blockSignals(true);
    adsCheck_->blockSignals(true);
    trackersCheck_->blockSignals(true);

    siteProtectionCheck_->setChecked(!p.whitelisted);
    adsCheck_->setChecked(p.adBlocking);
    trackersCheck_->setChecked(p.trackerProtection);

    siteProtectionCheck_->setEnabled(protectionEnabled);
    adsCheck_->setEnabled(protectionEnabled && !p.whitelisted);
    trackersCheck_->setEnabled(protectionEnabled && !p.whitelisted);
    noticeLabel_->setVisible(!protectionEnabled || p.whitelisted);
    if (!protectionEnabled) {
      noticeLabel_->setText(QStringLiteral("Reklam engelleyici genel anahtardan kapalı."));
    } else if (p.whitelisted) {
      noticeLabel_->setText(
          QStringLiteral("Bu sitede koruma kapalı. Site reklam sunarsa reklamlar gösterilir."));
    }

    siteProtectionCheck_->blockSignals(false);
    adsCheck_->blockSignals(false);
    trackersCheck_->blockSignals(false);
  } else {
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
  update();
}

void ArDaliBlockerShieldButton::setActiveHost(const QString &host) {
  currentHost_ = host.trimmed().toLower();
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
