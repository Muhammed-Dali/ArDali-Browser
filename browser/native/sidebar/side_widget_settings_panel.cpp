#include "side_widget_settings_panel.h"

#include <QHBoxLayout>
#include <QKeyEvent>
#include <QPushButton>
#include <QVBoxLayout>

namespace {
void setSpeedProfile(SideWidgetConfig *config, int profile) {
  if (!config) return;
  if (profile == 1) {
    config->openDurationMs = 470; config->closeDurationMs = 370;
    config->openStaggerMs = 14; config->closeStaggerMs = 10;
  } else if (profile == 2) {
    config->openDurationMs = 250; config->closeDurationMs = 210;
    config->openStaggerMs = 6; config->closeStaggerMs = 4;
  } else {
    config->openDurationMs = 360; config->closeDurationMs = 280;
    config->openStaggerMs = 10; config->closeStaggerMs = 7;
  }
}

int speedProfileFor(const SideWidgetConfig &config) {
  if (config.openDurationMs <= 280) return 2;
  if (config.openDurationMs >= 420) return 1;
  return 0;
}
}  // namespace

SideWidgetSettingsPanel::SideWidgetSettingsPanel(QWidget *parent) : QFrame(parent) {
  setObjectName(QStringLiteral("side-widget-settings-panel"));
  setFixedSize(300, 314);
  setStyleSheet(QStringLiteral(
      "#side-widget-settings-panel{background:#0d1828;border:1px solid #2d75a7;border-radius:16px}"
      "QLabel{color:#d7e6f5;font-size:12px}"
      "QLabel#side-widget-settings-title{color:#f2f8ff;font-size:16px;font-weight:750}"
      "QLabel#side-widget-settings-subtitle{color:#82a1bb;font-size:11px}"
      "QLabel#side-widget-settings-section{color:#78d9ff;font-size:11px;font-weight:700;letter-spacing:.5px}"
      "QComboBox{min-height:34px;padding:0 10px;background:#101f33;color:#eaf6ff;border:1px solid #294b6a;border-radius:9px}"
      "QComboBox:hover{border-color:#4bc9ee}QCheckBox{color:#d7e6f5;padding:4px 0}"
      "QPushButton{min-height:34px;border-radius:9px;padding:0 12px;font-weight:700}"
      "QPushButton#side-widget-preview{background:#152b42;color:#dff4ff;border:1px solid #315b7d}"
      "QPushButton#side-widget-reset{background:#22c7b5;color:#04201e;border:0}"
      "QPushButton#side-widget-close{background:transparent;color:#8fb3cf;border:0;font-size:17px;min-width:28px;max-width:28px;padding:0}"
      "QPushButton#side-widget-close:hover{color:#ffffff;background:#233c57}"));
  buildUi();
  updateUiFromConfig();
}

void SideWidgetSettingsPanel::buildUi() {
  auto *layout = new QVBoxLayout(this);
  layout->setContentsMargins(16, 14, 16, 14);
  layout->setSpacing(9);

  auto *header = new QHBoxLayout;
  auto *titles = new QVBoxLayout;
  titles->setSpacing(1);
  auto *title = new QLabel(QStringLiteral("Kavisli Bar"), this);
  title->setObjectName(QStringLiteral("side-widget-settings-title"));
  auto *subtitle = new QLabel(QStringLiteral("WebMedia kavisli menü görünümü"), this);
  subtitle->setObjectName(QStringLiteral("side-widget-settings-subtitle"));
  titles->addWidget(title); titles->addWidget(subtitle);
  auto *close = new QPushButton(QStringLiteral("×"), this);
  close->setObjectName(QStringLiteral("side-widget-close")); close->setToolTip(QStringLiteral("Kapat"));
  connect(close, &QPushButton::clicked, this, &SideWidgetSettingsPanel::closeRequested);
  header->addLayout(titles); header->addStretch(); header->addWidget(close);
  layout->addLayout(header);

  auto *speedLabel = new QLabel(QStringLiteral("AÇILIŞ HIZI"), this);
  speedLabel->setObjectName(QStringLiteral("side-widget-settings-section"));
  layout->addWidget(speedLabel);
  speedProfile_ = new QComboBox(this);
  speedProfile_->addItems({QStringLiteral("WebMedia · Dengeli"), QStringLiteral("Yumuşak"), QStringLiteral("Hızlı")});
  connect(speedProfile_, qOverload<int>(&QComboBox::currentIndexChanged), this, [this](int index) {
    if (isUpdatingUi_) return;
    setSpeedProfile(&config_, index); emitConfigChanged();
  });
  layout->addWidget(speedProfile_);

  auto *appearanceLabel = new QLabel(QStringLiteral("GÖRÜNÜM"), this);
  appearanceLabel->setObjectName(QStringLiteral("side-widget-settings-section"));
  layout->addWidget(appearanceLabel);
  buttonSize_ = new QComboBox(this);
  buttonSize_->addItem(QStringLiteral("Standart düğmeler"), 48);
  buttonSize_->addItem(QStringLiteral("Büyük düğmeler"), 54);
  connect(buttonSize_, qOverload<int>(&QComboBox::currentIndexChanged), this, [this](int index) {
    if (isUpdatingUi_) return;
    config_.buttonDiameter = buttonSize_->itemData(index).toInt(); emitConfigChanged();
  });
  layout->addWidget(buttonSize_);
  animationsEnabled_ = new QCheckBox(QStringLiteral("Akıcı açılış animasyonu"), this);
  connect(animationsEnabled_, &QCheckBox::toggled, this, [this](bool enabled) {
    if (isUpdatingUi_) return;
    config_.animationsEnabled = enabled; emitConfigChanged();
  });
  layout->addWidget(animationsEnabled_);

  overlapWarningLabel_ = new QLabel(this);
  overlapWarningLabel_->setStyleSheet(QStringLiteral("color:#ffcf70;font-size:11px;"));
  overlapWarningLabel_->setWordWrap(true); overlapWarningLabel_->hide();
  layout->addWidget(overlapWarningLabel_);
  layout->addStretch();

  auto *actions = new QHBoxLayout;
  auto *preview = new QPushButton(QStringLiteral("Önizle"), this);
  preview->setObjectName(QStringLiteral("side-widget-preview"));
  connect(preview, &QPushButton::clicked, this, &SideWidgetSettingsPanel::previewRequested);
  auto *reset = new QPushButton(QStringLiteral("WebMedia'ya dön"), this);
  reset->setObjectName(QStringLiteral("side-widget-reset"));
  connect(reset, &QPushButton::clicked, this, &SideWidgetSettingsPanel::resetRequested);
  actions->addWidget(preview); actions->addWidget(reset);
  layout->addLayout(actions);
}

void SideWidgetSettingsPanel::setConfig(const SideWidgetConfig &config) { config_ = config; updateUiFromConfig(); }
SideWidgetConfig SideWidgetSettingsPanel::config() const { return config_; }

void SideWidgetSettingsPanel::setOverlapWarning(bool hasOverlap) {
  overlapWarningLabel_->setVisible(hasOverlap);
  if (hasOverlap) overlapWarningLabel_->setText(QStringLiteral("Düğmeler dar ekranda birbirine yaklaşabilir."));
}

void SideWidgetSettingsPanel::updateUiFromConfig() {
  isUpdatingUi_ = true;
  speedProfile_->setCurrentIndex(speedProfileFor(config_));
  const int buttonIndex = buttonSize_->findData(config_.buttonDiameter >= 52 ? 54 : 48);
  buttonSize_->setCurrentIndex(qMax(0, buttonIndex));
  animationsEnabled_->setChecked(config_.animationsEnabled);
  isUpdatingUi_ = false;
}

void SideWidgetSettingsPanel::emitConfigChanged() { emit configChanged(config_); }

void SideWidgetSettingsPanel::keyPressEvent(QKeyEvent *event) {
  if (event->key() == Qt::Key_Escape) { emit closeRequested(); return; }
  QFrame::keyPressEvent(event);
}
