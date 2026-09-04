#include "ardali_blocker_page.h"
#include "glow_toggle_switch.h"

#include <QApplication>
#include <QCheckBox>
#include <QComboBox>
#include <QFileDialog>
#include <QFileInfo>
#include <QFrame>
#include <QGridLayout>
#include <QGroupBox>
#include <QHBoxLayout>
#include <QHeaderView>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLabel>
#include <QLineEdit>
#include <QMessageBox>
#include <QPainter>
#include <QPainterPath>
#include <QPlainTextEdit>
#include <QProgressBar>
#include <QPushButton>
#include <QSaveFile>
#include <QScrollArea>
#include <QTableWidget>
#include <QVBoxLayout>
#include <QtMath>

#include "ardali_blocker_service.h"

namespace {
QFrame *createRankedMetricRow(int rank, const QString &name, quint64 count,
                              const QString &unit, const QString &accent,
                              QWidget *parent) {
  auto *row = new QFrame(parent);
  row->setObjectName(QStringLiteral("ranked-metric-row"));
  row->setFixedHeight(46);
  row->setStyleSheet(QStringLiteral(
      "QFrame#ranked-metric-row { background: #121923; border: 1px solid #2a3747; border-radius: 9px; }"
      "QFrame#ranked-metric-row:hover { background: #17212d; border-color: %1; }").arg(accent));
  auto *layout = new QHBoxLayout(row);
  layout->setContentsMargins(10, 6, 10, 6);
  layout->setSpacing(10);

  auto *rankLabel = new QLabel(QString::number(rank), row);
  rankLabel->setFixedSize(28, 28);
  rankLabel->setAlignment(Qt::AlignCenter);
  rankLabel->setStyleSheet(QStringLiteral(
      "background: %1; color: #071117; border: 0; border-radius: 14px; font-size: 12px; font-weight: 800;")
      .arg(accent));

  auto *nameLabel = new QLabel(name, row);
  nameLabel->setStyleSheet(QStringLiteral(
      "color: #e4ebf5; border: 0; font-size: 13px; font-weight: 600;"));
  nameLabel->setTextInteractionFlags(Qt::TextSelectableByMouse);

  auto *countLabel = new QLabel(QStringLiteral("%1 %2").arg(count).arg(unit), row);
  countLabel->setAlignment(Qt::AlignCenter);
  countLabel->setMinimumWidth(96);
  countLabel->setStyleSheet(QStringLiteral(
      "background: #0d141c; color: %1; border: 1px solid %1; border-radius: 12px; "
      "padding: 4px 10px; font-size: 12px; font-weight: 700;").arg(accent));

  layout->addWidget(rankLabel);
  layout->addWidget(nameLabel, 1);
  layout->addWidget(countLabel);
  return row;
}
}  // namespace

// ---------------- ModeKnobWidget Implementation ----------------

ModeKnobWidget::ModeKnobWidget(int level, int value, const QString &label, QWidget *parent)
    : QWidget(parent), level_(level), value_(value), label_(label) {
  setSizePolicy(QSizePolicy::Preferred, QSizePolicy::Fixed);
  setAttribute(Qt::WA_Hover, true);
}

void ModeKnobWidget::setValue(int val) {
  value_ = qBound(0, val, 100);
  update();
}

void ModeKnobWidget::paintEvent(QPaintEvent *) {
  QPainter p(this);
  p.setRenderHint(QPainter::Antialiasing, true);

  const int w = width();
  const int h = height();
  const qreal cx = w / 2.0;
  const qreal cy = 52.0;
  const qreal radius = 42.0;
  const qreal innerRadius = radius - 9.0;
  const qreal arcRadius = radius - 5.0;

  QColor accent;
  QColor glowColor;
  if (level_ == 1) {
    accent = QColor(0x53, 0xd2, 0xff);
    glowColor = QColor(0x53, 0xd2, 0xff, 120);
  } else if (level_ == 3) {
    accent = QColor(0x5c, 0xf2, 0xc4);
    glowColor = QColor(0x5c, 0xf2, 0xc4, 120);
  } else {
    accent = QColor(0x86, 0xa7, 0xff);
    glowColor = QColor(0x86, 0xa7, 0xff, 120);
  }

  // Outer circle background
  p.setPen(Qt::NoPen);
  p.setBrush(QColor(0x2a, 0x2a, 0x2a));
  p.drawEllipse(QPointF(cx, cy), radius, radius);

  // Inner circle background
  p.setBrush(QColor(0x1a, 0x1d, 0x22));
  p.drawEllipse(QPointF(cx, cy), innerRadius, innerRadius);

  // Segment arc
  const int segments = 50;
  const int activeSegments = qRound((value_ / 100.0) * segments);
  const qreal startDeg = 135.0;
  const qreal spanDeg = 270.0;
  const qreal segDeg = spanDeg / segments;

  QPen pen;
  pen.setWidthF(5.0);
  pen.setCapStyle(Qt::RoundCap);

  for (int i = 0; i < segments; ++i) {
    const qreal angle = startDeg + (i * segDeg);
    const qreal rad = qDegreesToRadians(angle);
    const qreal x = cx + arcRadius * qCos(rad);
    const qreal y = cy + arcRadius * qSin(rad);

    if (i < activeSegments) {
      pen.setColor(accent);
      p.setPen(pen);
      p.drawPoint(QPointF(x, y));
    } else {
      pen.setColor(QColor(0x35, 0x3d, 0x47));
      p.setPen(pen);
      p.drawPoint(QPointF(x, y));
    }
  }

  // Active Dot Glow & Indicator
  if (activeSegments > 0) {
    const qreal dotAngle = startDeg + ((activeSegments - 1) * segDeg);
    const qreal dotRad = qDegreesToRadians(dotAngle);
    const qreal dotX = cx + arcRadius * qCos(dotRad);
    const qreal dotY = cy + arcRadius * qSin(dotRad);

    QRadialGradient glow(QPointF(dotX, dotY), 12.0);
    glow.setColorAt(0, glowColor);
    glow.setColorAt(1, Qt::transparent);
    p.setPen(Qt::NoPen);
    p.setBrush(glow);
    p.drawEllipse(QPointF(dotX, dotY), 12.0, 12.0);

    p.setBrush(accent);
    p.drawEllipse(QPointF(dotX, dotY), 4.0, 4.0);
  }

  // Center axle
  p.setPen(Qt::NoPen);
  p.setBrush(QColor(0x4a, 0x55, 0x68));
  p.drawEllipse(QPointF(cx, cy), 5.0, 5.0);

  // Value text
  p.setPen(QColor(0xf0, 0xf4, 0xf8));
  QFont font = p.font();
  font.setPixelSize(14);
  font.setBold(true);
  p.setFont(font);
  p.drawText(QRectF(0, h - 36, w, 18), Qt::AlignCenter, QStringLiteral("%1%").arg(value_));

  // Label text
  p.setPen(QColor(0x9a, 0xa6, 0xb8));
  font.setPixelSize(10);
  font.setBold(false);
  p.setFont(font);
  p.drawText(QRectF(0, h - 18, w, 16), Qt::AlignCenter, label_.toUpper());
}

// ---------------- ArDaliBlockerPage Implementation ----------------

ArDaliBlockerPage::ArDaliBlockerPage(ArDaliBlockerService *service, QWidget *parent)
    : QWidget(parent), service_(service) {
  setObjectName(QStringLiteral("adblock-page"));
  setStyleSheet(QStringLiteral(
      "QWidget#adblock-page { background: #12161c; color: #e4ebf5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Ubuntu, sans-serif; }"
      "QListWidget#adblock-sidebar { background: #181f28; border: 0; border-right: 1px solid #283442; color: #b8c4d4; font-size: 13px; font-weight: 500; outline: 0; padding: 12px 6px; min-width: 170px; max-width: 190px; }"
      "QListWidget#adblock-sidebar::item { min-height: 38px; padding-left: 14px; border-radius: 8px; margin-bottom: 4px; }"
      "QListWidget#adblock-sidebar::item:hover { background: #222b38; color: #ffffff; }"
      "QListWidget#adblock-sidebar::item:selected { background: #2f3d4f; color: #4ec9ff; font-weight: 600; }"
      "QGroupBox { font-size: 14px; font-weight: 600; color: #e4ebf5; border: 1px solid #283442; border-radius: 10px; margin-top: 14px; padding-top: 18px; background: #181f28; }"
      "QGroupBox::title { subcontrol-origin: margin; subcontrol-position: top left; left: 14px; padding: 0 6px; background: transparent; }"
      "QPushButton { background: #253140; color: #e4ebf5; border: 1px solid #364659; border-radius: 6px; padding: 6px 14px; font-size: 12px; font-weight: 500; min-height: 18px; }"
      "QPushButton:hover { background: #324357; border-color: #4b617a; color: #ffffff; }"
      "QPushButton:pressed { background: #1c2633; }"
      "QPushButton:disabled { background: #1a222c; color: #5a6878; border-color: #242f3d; }"
      "QPushButton#primary-btn { background: #2160c4; border-color: #2c75e8; color: #ffffff; }"
      "QPushButton#primary-btn:hover { background: #2872e4; }"
      "QLineEdit, QPlainTextEdit, QTextEdit { background: #10141a; border: 1px solid #2b394a; border-radius: 6px; color: #e4ebf5; padding: 7px 10px; font-size: 13px; selection-background-color: #2c75e8; }"
      "QLineEdit:focus, QPlainTextEdit:focus { border-color: #4ec9ff; }"
      "QCheckBox { color: #d0dbe8; font-size: 13px; spacing: 8px; }"
      "QCheckBox::indicator { width: 18px; height: 18px; border: 1px solid #3b4c61; border-radius: 4px; background: #10141a; }"
      "QCheckBox::indicator:checked { background: #2160c4; border-color: #4ec9ff; }"
      "QComboBox { background: #181f28; border: 1px solid #2b394a; border-radius: 6px; color: #e4ebf5; padding: 5px 10px; min-height: 20px; font-size: 12px; }"
      "QComboBox QAbstractItemView { background: #181f28; border: 1px solid #2b394a; color: #e4ebf5; selection-background-color: #2f3d4f; }"
      "QScrollArea { border: 0; background: transparent; }"
      "QScrollBar:vertical { background: #12161c; width: 10px; margin: 0; }"
      "QScrollBar::handle:vertical { background: #2c3a4d; border-radius: 5px; min-height: 20px; }"
      "QScrollBar::handle:vertical:hover { background: #3d4f66; }"
  ));

  auto *mainLayout = new QHBoxLayout(this);
  mainLayout->setContentsMargins(0, 0, 0, 0);
  mainLayout->setSpacing(0);

  sidebar_ = new QListWidget(this);
  sidebar_->setObjectName(QStringLiteral("adblock-sidebar"));

  auto addTabItem = [this](Tab tab, const QString &text) {
    sidebar_->addItem(text);
    tabIndices_[tab] = sidebar_->count() - 1;
  };

  addTabItem(Tab::Settings, QStringLiteral("Ayarlar"));
  addTabItem(Tab::Rulesets, QStringLiteral("Filtre listeleri"));
  addTabItem(Tab::CustomFilters, QStringLiteral("Özel filtreler"));
  addTabItem(Tab::Sites, QStringLiteral("Siteler"));
  addTabItem(Tab::Statistics, QStringLiteral("İstatistikler"));
  addTabItem(Tab::Logger, QStringLiteral("İstek günlüğü"));
  addTabItem(Tab::Develop, QStringLiteral("Geliştir"));
  addTabItem(Tab::About, QStringLiteral("Hakkında"));

  mainLayout->addWidget(sidebar_);

  stack_ = new QStackedWidget(this);
  mainLayout->addWidget(stack_, 1);

  createSettingsTab();
  createRulesetsTab();
  createCustomFiltersTab();
  createSitesTab();
  createStatisticsTab();
  createLoggerTab();
  createDevelopTab();
  createAboutTab();

  connect(sidebar_, &QListWidget::currentRowChanged, this, [this](int index) {
    stack_->setCurrentIndex(index);
    if (index == tabIndices_[Tab::Statistics]) refreshStatisticsTab();
    else if (index == tabIndices_[Tab::Logger]) refreshLoggerTab();
    else if (index == tabIndices_[Tab::Develop]) refreshDevelopTab();
    else if (index == tabIndices_[Tab::Rulesets]) refreshRulesetTab();
    else if (index == tabIndices_[Tab::Sites]) refreshSitesTab();
    else if (index == tabIndices_[Tab::CustomFilters]) refreshCustomFiltersTab();
  });
  sidebar_->setCurrentRow(0);

  // Only live telemetry needs polling. Rebuilding every tab's widget tree every
  // 1.5 seconds caused avoidable allocations and visible stalls while editing.
  connect(&refreshTimer_, &QTimer::timeout, this, [this]() {
    const int index = stack_->currentIndex();
    if (index == tabIndices_[Tab::Statistics]) refreshStatisticsTab();
    else if (index == tabIndices_[Tab::Logger]) refreshLoggerTab();
    else if (index == tabIndices_[Tab::Develop]) refreshDevelopTab();
  });
  refreshTimer_.setInterval(1500);

  if (service_) {
    connect(service_->settings(), &ArDaliBlockerSettings::settingsChanged, this, &ArDaliBlockerPage::updateModeUi);
  }

  updateModeUi();
}

void ArDaliBlockerPage::showEvent(QShowEvent *) {
  refreshAll();
  refreshTimer_.start();
}

void ArDaliBlockerPage::hideEvent(QHideEvent *) {
  refreshTimer_.stop();
}

void ArDaliBlockerPage::setActiveTab(Tab tab) {
  if (tabIndices_.contains(tab)) {
    sidebar_->setCurrentRow(tabIndices_[tab]);
  }
}

void ArDaliBlockerPage::setActiveHost(const QString &host) {
  activeHost_ = host.trimmed().toLower();
  if (siteHostInput_ && !activeHost_.isEmpty()) {
    siteHostInput_->setText(activeHost_);
  }
  if (aboutActiveHostLabel_) {
    aboutActiveHostLabel_->setText(activeHost_.isEmpty() ? QStringLiteral("Aktif web sekmesi yok") : activeHost_);
  }
  refreshSitesTab();
}

void ArDaliBlockerPage::refreshAll() {
  updateModeUi();
  refreshRulesetTab();
  refreshCustomFiltersTab();
  refreshSitesTab();
  refreshStatisticsTab();
  refreshLoggerTab();
  refreshDevelopTab();
}

// ---------------- 1. Settings Tab ----------------

void ArDaliBlockerPage::createSettingsTab() {
  auto *scroll = new QScrollArea(this);
  scroll->setWidgetResizable(true);
  auto *container = new QWidget(scroll);
  auto *layout = new QVBoxLayout(container);
  layout->setContentsMargins(28, 24, 28, 24);
  layout->setSpacing(20);

  // Header & Mode Pill
  auto *heroGroup = new QGroupBox(QStringLiteral("Varsayılan Filtreleme Modu"), container);
  auto *heroLayout = new QVBoxLayout(heroGroup);
  heroLayout->setContentsMargins(18, 18, 18, 18);
  heroLayout->setSpacing(14);

  auto *heroTop = new QHBoxLayout;
  modeDesc_ = new QLabel(QStringLiteral("Web sitesi başına özel mod seçilmediğinde bu mod kullanılır. Her mod, koruma düzeyi ve uyumluluk arasında farklı denge kurar."), heroGroup);
  modeDesc_->setWordWrap(true);
  modeDesc_->setStyleSheet(QStringLiteral("color: #9aa7b8; font-size: 13px;"));
  heroTop->addWidget(modeDesc_, 1);

  modePill_ = new QLabel(QStringLiteral("İdeal"), heroGroup);
  modePill_->setStyleSheet(QStringLiteral("background: #1f3b5c; color: #53d2ff; font-weight: 700; font-size: 12px; border-radius: 12px; padding: 4px 14px; border: 1px solid #2e598a;"));
  heroTop->addWidget(modePill_, 0, Qt::AlignTop);
  heroLayout->addLayout(heroTop);

  // 3 Mode Cards
  auto *cardsLayout = new QHBoxLayout;
  cardsLayout->setSpacing(14);

  auto createModeCard = [this](int level, int value, const QString &title, const QString &knobLabel, const QString &desc, QWidget **outCard) {
    auto *card = new QFrame;
    card->setObjectName(QStringLiteral("mode-card"));
    card->setCursor(Qt::PointingHandCursor);
    card->setStyleSheet(QStringLiteral(
        "QFrame#mode-card { background: #121720; border: 1.5px solid #283545; border-radius: 12px; padding: 12px; }"
        "QFrame#mode-card:hover { background: #161e2a; border-color: #4a617d; }"
    ));
    auto *cLayout = new QVBoxLayout(card);
    cLayout->setContentsMargins(8, 8, 8, 8);
    cLayout->setSpacing(8);

    auto *headerLayout = new QHBoxLayout;
    auto *radioDot = new QLabel(QStringLiteral("○"), card);
    radioDot->setObjectName(QStringLiteral("radio-dot"));
    radioDot->setStyleSheet(QStringLiteral("color: #72849a; font-size: 16px; font-weight: bold;"));
    auto *titleLabel = new QLabel(title, card);
    titleLabel->setStyleSheet(QStringLiteral("color: #ffffff; font-size: 15px; font-weight: 700;"));
    headerLayout->addWidget(radioDot);
    headerLayout->addWidget(titleLabel);
    headerLayout->addStretch(1);
    cLayout->addLayout(headerLayout);

    auto *knob = new ModeKnobWidget(level, value, knobLabel, card);
    cLayout->addWidget(knob, 0, Qt::AlignCenter);

    auto *descLabel = new QLabel(desc, card);
    descLabel->setWordWrap(true);
    descLabel->setStyleSheet(QStringLiteral("color: #8c9bae; font-size: 12px; min-height: 48px;"));
    cLayout->addWidget(descLabel);

    card->installEventFilter(this);
    radioDot->installEventFilter(this);
    titleLabel->installEventFilter(this);
    knob->installEventFilter(this);
    descLabel->installEventFilter(this);
    *outCard = card;
    return card;
  };

  cardsLayout->addWidget(createModeCard(
      1, 35, QStringLiteral("Temel"), QStringLiteral("Hafif"),
      QStringLiteral("Seçilen filtre listelerinden temel ağ filtrelemesi. Web sitelerindeki verileri okumak ve değiştirmek için izin gerektirmez."),
      &basicCard_));

  cardsLayout->addWidget(createModeCard(
      2, 65, QStringLiteral("İdeal"), QStringLiteral("Dengeli"),
      QStringLiteral("Gelişmiş ağ filtrelemesi ve seçilen filtre listelerinden genişletilmiş filtreleme."),
      &idealCard_));

  cardsLayout->addWidget(createModeCard(
      3, 95, QStringLiteral("Kapsamlı"), QStringLiteral("Güçlü"),
      QStringLiteral("Gelişmiş ağ filtrelemenin yanında sert engelleme, görünür reklam temizliği ve ek YouTube sinyalleri."),
      &aggressiveCard_));

  heroLayout->addLayout(cardsLayout);
  layout->addWidget(heroGroup);

  // Click handling for mode cards
  basicCard_->setMouseTracking(true);
  idealCard_->setMouseTracking(true);
  aggressiveCard_->setMouseTracking(true);

  // Behavior Section
  auto *behaviorGroup = new QGroupBox(QStringLiteral("Davranış"), container);
  auto *bLayout = new QVBoxLayout(behaviorGroup);
  bLayout->setContentsMargins(18, 18, 18, 18);
  bLayout->setSpacing(12);

  autoReloadCheck_ = new GlowToggleSwitch(QStringLiteral("Filtreleme modunu değiştirirken sayfayı otomatik olarak yenile"), behaviorGroup);
  showCountCheck_ = new GlowToggleSwitch(QStringLiteral("Engellenen isteklerin sayısını araç çubuğu simgesinde göster"), behaviorGroup);
  strictBlockCheck_ = new GlowToggleSwitch(QStringLiteral("Sıkı engellemeyi etkinleştir (İstenmeyebilecek sitelere erişim engellenecek ve devam etme seçeneği sunulacaktır)"), behaviorGroup);
  popupBlockCheck_ = new GlowToggleSwitch(QStringLiteral("Açılır pencere engellemeyi etkinleştir (Etkinleştirildiğinde, uygun filtreler web sitelerinin açtığı istenmeyen sekmeleri otomatik olarak kapatır)"), behaviorGroup);
  developerModeCheck_ = new GlowToggleSwitch(QStringLiteral("Geliştirici modu (Teknik kullanıcılara uygun özelliklere ve log detaylarına izin ver)"), behaviorGroup);

  bLayout->addWidget(autoReloadCheck_);
  bLayout->addWidget(showCountCheck_);
  bLayout->addWidget(strictBlockCheck_);
  bLayout->addWidget(popupBlockCheck_);
  bLayout->addWidget(developerModeCheck_);
  layout->addWidget(behaviorGroup);

  connect(autoReloadCheck_, &QCheckBox::toggled, this, [this](bool checked) {
    if (service_) service_->settings()->setAutoReloadOnModeChange(checked);
  });
  connect(showCountCheck_, &QCheckBox::toggled, this, [this](bool checked) {
    if (service_) service_->settings()->setShowBlockedCountOnToolbar(checked);
  });
  connect(strictBlockCheck_, &QCheckBox::toggled, this, [this](bool checked) {
    if (service_) service_->settings()->setStrictBlock(checked);
  });
  connect(popupBlockCheck_, &QCheckBox::toggled, this, [this](bool checked) {
    if (service_) service_->settings()->setPopupBlock(checked);
  });
  connect(developerModeCheck_, &QCheckBox::toggled, this, [this](bool checked) {
    if (service_) service_->settings()->setDeveloperMode(checked);
  });

  // Backup & Restore Section
  auto *backupGroup = new QGroupBox(QStringLiteral("Yedekle"), container);
  auto *bkLayout = new QVBoxLayout(backupGroup);
  bkLayout->setContentsMargins(18, 18, 18, 18);
  bkLayout->setSpacing(12);

  auto *bkDesc = new QLabel(QStringLiteral("Ayarlarınızı bir dosyaya yedekleyin veya yedeklenmiş bir dosyadan geri yükleyin."), backupGroup);
  bkDesc->setStyleSheet(QStringLiteral("color: #9aa7b8; font-size: 13px;"));
  bkLayout->addWidget(bkDesc);

  auto *bkBtns = new QHBoxLayout;
  auto *backupBtn = new QPushButton(QStringLiteral("Yedekle..."), backupGroup);
  auto *restoreBtn = new QPushButton(QStringLiteral("Geri yükle..."), backupGroup);
  auto *resetBtn = new QPushButton(QStringLiteral("Varsayılan ayarlara sıfırla..."), backupGroup);

  bkBtns->addWidget(backupBtn);
  bkBtns->addWidget(restoreBtn);
  bkBtns->addWidget(resetBtn);
  bkBtns->addStretch(1);
  bkLayout->addLayout(bkBtns);
  layout->addWidget(backupGroup);

  connect(backupBtn, &QPushButton::clicked, this, [this]() {
    if (!service_) return;
    const QString path = QFileDialog::getSaveFileName(this, QStringLiteral("Reklam Engelleyici Ayarlarını Yedekle"), QStringLiteral("deliblock-settings.json"), QStringLiteral("JSON Dosyası (*.json)"));
    if (path.isEmpty()) return;
    QSaveFile file(path);
    const QByteArray bytes = QJsonDocument(service_->settings()->exportBackupJson()).toJson(QJsonDocument::Indented);
    if (file.open(QIODevice::WriteOnly) && file.write(bytes) == bytes.size() && file.commit()) {
      QFile::setPermissions(path, QFileDevice::ReadOwner | QFileDevice::WriteOwner);
      QMessageBox::information(this, QStringLiteral("Yedekleme Başarılı"), QStringLiteral("Ayarlar başarıyla dosyaya yedeklendi."));
    }
  });

  connect(restoreBtn, &QPushButton::clicked, this, [this]() {
    if (!service_) return;
    const QString path = QFileDialog::getOpenFileName(this, QStringLiteral("Yedekten Geri Yükle"), QString(), QStringLiteral("JSON Dosyası (*.json)"));
    if (path.isEmpty()) return;
    QFile file(path);
    if (file.open(QIODevice::ReadOnly)) {
      QJsonParseError err;
      const QJsonDocument doc = QJsonDocument::fromJson(file.readAll(), &err);
      if (err.error == QJsonParseError::NoError && doc.isObject()) {
        if (service_->settings()->importBackupJson(doc.object())) {
          updateModeUi();
          QMessageBox::information(this, QStringLiteral("Geri Yükleme Başarılı"), QStringLiteral("Ayarlar başarıyla geri yüklendi."));
          return;
        }
      }
      QMessageBox::warning(this, QStringLiteral("Hata"), QStringLiteral("Geçersiz yedek dosyası biçimi!"));
    }
  });

  connect(resetBtn, &QPushButton::clicked, this, [this]() {
    if (!service_) return;
    if (QMessageBox::question(this, QStringLiteral("Sıfırlama Onayı"), QStringLiteral("Tüm reklam engelleme ayarları varsayılanlara sıfırlansın mı?")) == QMessageBox::Yes) {
      service_->settings()->resetToDefaults();
      refreshAll();
      QMessageBox::information(this, QStringLiteral("Sıfırlandı"), QStringLiteral("Reklam engelleyici varsayılan ayarlara döndürüldü."));
    }
  });

  layout->addStretch(1);
  scroll->setWidget(container);
  stack_->addWidget(scroll);
}

void ArDaliBlockerPage::updateModeUi() {
  if (!service_) return;
  const ArDaliBlockerMode mode = service_->settings()->mode();

  auto setCardActive = [](QWidget *card, bool active, const QString &borderCol) {
    if (!card) return;
    auto *dot = card->findChild<QLabel *>(QStringLiteral("radio-dot"));
    if (dot) {
      dot->setText(active ? QStringLiteral("●") : QStringLiteral("○"));
      dot->setStyleSheet(active ? QStringLiteral("color: %1; font-size: 16px; font-weight: bold;").arg(borderCol)
                                : QStringLiteral("color: #72849a; font-size: 16px; font-weight: bold;"));
    }
    card->setStyleSheet(QStringLiteral(
        "QFrame#mode-card { background: %1; border: 2px solid %2; border-radius: 12px; padding: 12px; }"
    ).arg(active ? QStringLiteral("#182333") : QStringLiteral("#121720"),
          active ? borderCol : QStringLiteral("#283545")));
  };

  setCardActive(basicCard_, mode == ArDaliBlockerMode::Basic, QStringLiteral("#53d2ff"));
  setCardActive(idealCard_, mode == ArDaliBlockerMode::Ideal, QStringLiteral("#86a7ff"));
  setCardActive(aggressiveCard_, mode == ArDaliBlockerMode::Aggressive, QStringLiteral("#5cf2c4"));

  if (modePill_) {
    if (mode == ArDaliBlockerMode::Basic) {
      modePill_->setText(QStringLiteral("Temel"));
      modePill_->setStyleSheet(QStringLiteral("background: #143542; color: #53d2ff; font-weight: 700; font-size: 12px; border-radius: 12px; padding: 4px 14px; border: 1px solid #20576e;"));
    } else if (mode == ArDaliBlockerMode::Aggressive) {
      modePill_->setText(QStringLiteral("Kapsamlı"));
      modePill_->setStyleSheet(QStringLiteral("background: #11382e; color: #5cf2c4; font-weight: 700; font-size: 12px; border-radius: 12px; padding: 4px 14px; border: 1px solid #1c614f;"));
    } else {
      modePill_->setText(QStringLiteral("İdeal"));
      modePill_->setStyleSheet(QStringLiteral("background: #1f3b5c; color: #86a7ff; font-weight: 700; font-size: 12px; border-radius: 12px; padding: 4px 14px; border: 1px solid #2e598a;"));
    }
  }

  if (autoReloadCheck_) autoReloadCheck_->setChecked(service_->settings()->autoReloadOnModeChange());
  if (showCountCheck_) showCountCheck_->setChecked(service_->settings()->showBlockedCountOnToolbar());
  if (strictBlockCheck_) strictBlockCheck_->setChecked(service_->settings()->strictBlock());
  if (popupBlockCheck_) popupBlockCheck_->setChecked(service_->settings()->popupBlock());
  if (developerModeCheck_) developerModeCheck_->setChecked(service_->settings()->developerMode());
}

// ---------------- 2. Rulesets Tab ----------------

void ArDaliBlockerPage::createRulesetsTab() {
  auto *scroll = new QScrollArea(this);
  scroll->setWidgetResizable(true);
  auto *container = new QWidget(scroll);
  auto *layout = new QVBoxLayout(container);
  layout->setContentsMargins(28, 24, 28, 24);
  layout->setSpacing(24);

  // Summary Row
  auto *summaryBox = new QFrame(container);
  summaryBox->setStyleSheet(QStringLiteral("background: #181f28; border: 1px solid #283442; border-radius: 10px; padding: 12px;"));
  auto *sLayout = new QHBoxLayout(summaryBox);
  sLayout->setSpacing(16);

  auto addStatTile = [sLayout, summaryBox](const QString &title, QLabel **outVal) {
    auto *tile = new QVBoxLayout;
    auto *tLabel = new QLabel(title, summaryBox);
    tLabel->setStyleSheet(QStringLiteral("color: #8c9ba8; font-size: 11px; font-weight: 600; text-transform: uppercase;"));
    auto *vLabel = new QLabel(QStringLiteral("0"), summaryBox);
    vLabel->setStyleSheet(QStringLiteral("color: #4ec9ff; font-size: 20px; font-weight: 700;"));
    tile->addWidget(tLabel);
    tile->addWidget(vLabel);
    sLayout->addLayout(tile);
    *outVal = vLabel;
  };

  addStatTile(QStringLiteral("Bu oturum"), &rulesetSessionCount_);
  addStatTile(QStringLiteral("Toplam"), &rulesetTotalCount_);
  addStatTile(QStringLiteral("Ruleset"), &rulesetCount_);
  addStatTile(QStringLiteral("Alan adı kuralı"), &rulesetDomainRuleCount_);
  addStatTile(QStringLiteral("DNR kuralı"), &rulesetDnrRuleCount_);

  layout->addWidget(summaryBox);

  // Breakdown Section
  auto *breakdownGroup = new QFrame(container);
  breakdownGroup->setObjectName(QStringLiteral("ruleset-breakdown-group"));
  breakdownGroup->setStyleSheet(QStringLiteral(
      "QFrame#ruleset-breakdown-group { background: #181f28; border: 1px solid #283442; border-radius: 10px; }"));
  auto *breakdownSectionLayout = new QVBoxLayout(breakdownGroup);
  breakdownSectionLayout->setContentsMargins(16, 14, 16, 16);
  breakdownSectionLayout->setSpacing(12);
  auto *breakdownTitle = new QLabel(QStringLiteral("En Etkin Filtre Listeleri"), breakdownGroup);
  breakdownTitle->setStyleSheet(QStringLiteral(
      "color: #e4ebf5; border: 0; font-size: 14px; font-weight: 700;"));
  breakdownSectionLayout->addWidget(breakdownTitle);
  rulesetBreakdownLayout_ = new QVBoxLayout;
  rulesetBreakdownLayout_->setContentsMargins(0, 0, 0, 0);
  rulesetBreakdownLayout_->setSpacing(12);
  breakdownSectionLayout->addLayout(rulesetBreakdownLayout_);
  layout->addWidget(breakdownGroup);

  // Catalog Section
  auto *catalogGroup = new QGroupBox(QStringLiteral("Filtre Listeleri Kataloğu"), container);
  catalogGroup->setObjectName(QStringLiteral("ruleset-catalog-group"));
  auto *cMainLayout = new QVBoxLayout(catalogGroup);
  cMainLayout->setContentsMargins(16, 28, 16, 16);
  cMainLayout->setSpacing(12);

  auto *actionRow = new QHBoxLayout;
  auto *updateBtn = new QPushButton(QStringLiteral("Yerel filtreleri doğrula"), catalogGroup);
  updateBtn->setToolTip(QStringLiteral("Etkin yerel filtreleri tek sefer doğrular ve yeniden derler."));
  rulesetUpdateStatus_ = new QLabel(QStringLiteral("Yerel filtreler hazır."), catalogGroup);
  rulesetUpdateStatus_->setStyleSheet(QStringLiteral("color: #72849a; font-size: 12px;"));
  rulesetUpdateProgress_ = new QProgressBar(catalogGroup);
  rulesetUpdateProgress_->setRange(0, 1);
  rulesetUpdateProgress_->setValue(0);
  rulesetUpdateProgress_->setTextVisible(true);
  rulesetUpdateProgress_->setFixedWidth(140);
  rulesetUpdateProgress_->hide();

  actionRow->addWidget(updateBtn);
  actionRow->addWidget(rulesetUpdateStatus_);
  actionRow->addWidget(rulesetUpdateProgress_);
  actionRow->addStretch(1);
  cMainLayout->addLayout(actionRow);

  auto *updateHint = new QLabel(
      QStringLiteral("Bu tek seferlik işlem aşağıda açık olan tüm etkin listeleri birlikte doğrular ve yeniden derler. İnternetten filtre indirmez."),
      catalogGroup);
  updateHint->setWordWrap(true);
  updateHint->setStyleSheet(QStringLiteral("color: #8c9ba8; font-size: 12px;"));
  cMainLayout->addWidget(updateHint);

  connect(updateBtn, &QPushButton::clicked, this, [this]() {
    if (service_) {
      rulesetUpdateStatus_->setText(QStringLiteral("Doğrulanıyor..."));
      service_->updateFiltersAsync();
    }
  });

  if (service_) {
    connect(service_, &ArDaliBlockerService::filterUpdateStarted, this, [this, updateBtn]() {
      updateBtn->setEnabled(false);
      if (rulesetUpdateProgress_) {
        rulesetUpdateProgress_->setRange(0, 3);
        rulesetUpdateProgress_->setValue(0);
        rulesetUpdateProgress_->show();
      }
    });
    connect(service_, &ArDaliBlockerService::filterUpdateProgress, this,
            [this](int completed, int total, const QString &stage) {
              if (rulesetUpdateStatus_) {
                const QString label = stage == QLatin1String("parse") ? QStringLiteral("Kurallar ayrıştırılıyor")
                    : stage == QLatin1String("cosmetic") ? QStringLiteral("Görsel filtreler hazırlanıyor")
                    : stage == QLatin1String("swap") ? QStringLiteral("Motor etkinleştiriliyor")
                    : QStringLiteral("Hazırlanıyor");
                rulesetUpdateStatus_->setText(QStringLiteral("%1… %2/%3").arg(label).arg(completed).arg(total));
              }
              if (rulesetUpdateProgress_) {
                rulesetUpdateProgress_->setRange(0, qMax(1, total));
                rulesetUpdateProgress_->setValue(completed);
              }
            });
    connect(service_, &ArDaliBlockerService::filterUpdateFinished, this, [this, updateBtn](bool, const QString &msg) {
      rulesetUpdateStatus_->setText(msg + QStringLiteral(" (") + QDateTime::currentDateTime().toString(QStringLiteral("hh:mm")) + QStringLiteral(")"));
      refreshRulesetTab();
      updateBtn->setEnabled(true);
      if (rulesetUpdateProgress_) rulesetUpdateProgress_->hide();
    });
  }

  rulesetCatalogLayout_ = new QVBoxLayout;
  rulesetCatalogLayout_->setSpacing(8);
  cMainLayout->addLayout(rulesetCatalogLayout_);

  layout->addWidget(catalogGroup);
  layout->addStretch(1);
  scroll->setWidget(container);
  stack_->addWidget(scroll);
}

void ArDaliBlockerPage::refreshRulesetTab() {
  if (!service_) return;

  if (rulesetSessionCount_) rulesetSessionCount_->setText(QString::number(service_->sessionBlockedCount()));
  if (rulesetTotalCount_) rulesetTotalCount_->setText(QString::number(service_->totalBlockedCount()));
  if (rulesetCount_) rulesetCount_->setText(QString::number(service_->listManager()->availableLists().size()));
  if (rulesetDomainRuleCount_) rulesetDomainRuleCount_->setText(QString::number(service_->filterEngine()->ruleCount()));
  if (rulesetDnrRuleCount_) rulesetDnrRuleCount_->setText(QString::number(service_->filterEngine()->ruleCount()));

  // Top Ruleset Breakdown
  if (rulesetBreakdownLayout_) {
    while (rulesetBreakdownLayout_->count() > 0) {
      auto *item = rulesetBreakdownLayout_->takeAt(0);
      if (item->widget()) delete item->widget();
      delete item;
    }
    const auto top = service_->topMatchedRulesets(6);
    if (top.isEmpty()) {
      auto *empty = new QLabel(QStringLiteral("Ruleset eşleşmesi bekleniyor."), this);
      empty->setStyleSheet(QStringLiteral("color: #72849a; font-style: italic;"));
      rulesetBreakdownLayout_->addWidget(empty);
    } else {
      int rank = 1;
      for (const auto &p : top) {
        rulesetBreakdownLayout_->addWidget(createRankedMetricRow(
            rank++, p.first, p.second, QStringLiteral("eşleşme"),
            QStringLiteral("#4ec9ff"), rulesetBreakdownLayout_->parentWidget()));
      }
    }
  }

  // Ruleset Catalog
  if (rulesetCatalogLayout_) {
    while (rulesetCatalogLayout_->count() > 0) {
      auto *item = rulesetCatalogLayout_->takeAt(0);
      if (item->widget()) delete item->widget();
      delete item;
    }
    const auto lists = service_->listManager()->availableLists();
    const QStringList enabled = service_->settings()->enabledRulesetIds();
    const bool selectionConfigured = service_->settings()->rulesetSelectionConfigured();

    for (const auto &list : lists) {
      auto *row = new QFrame(this);
      row->setStyleSheet(QStringLiteral("background: #121720; border: 1px solid #24303f; border-radius: 8px; padding: 10px;"));
      auto *rLayout = new QHBoxLayout(row);
      rLayout->setContentsMargins(8, 4, 8, 4);

      auto *chk = new GlowToggleSwitch(row);
      chk->setChecked(selectionConfigured ? enabled.contains(list.id) : list.enabled);
      chk->setToolTip(QStringLiteral("Bu filtre listesini etkin plana dahil et"));
      rLayout->addWidget(chk);

      auto *infoLayout = new QVBoxLayout;
      auto *nameLbl = new QLabel(list.name, row);
      nameLbl->setStyleSheet(QStringLiteral("font-size: 13px; font-weight: 600; color: #e4ebf5;"));
      auto *metaLbl = new QLabel(QStringLiteral("%1 · %2 kural · v%3 · %4")
                                     .arg(list.group, QString::number(list.ruleCount), list.version,
                                          list.lastUpdated.toString(QStringLiteral("dd.MM.yyyy"))),
                                 row);
      metaLbl->setStyleSheet(QStringLiteral("font-size: 11px; color: #8c9ba8;"));
      infoLayout->addWidget(nameLbl);
      infoLayout->addWidget(metaLbl);
      rLayout->addLayout(infoLayout, 1);

      connect(chk, &QCheckBox::toggled, this, [this, list](bool checked) {
        if (!service_) return;
        QStringList cur = service_->settings()->enabledRulesetIds();
        if (!service_->settings()->rulesetSelectionConfigured()) {
          for (const auto &l : service_->listManager()->availableLists()) {
            if (l.enabled) cur.append(l.id);
          }
        }
        if (checked && !cur.contains(list.id)) cur.append(list.id);
        else if (!checked) cur.removeAll(list.id);
        service_->settings()->setEnabledRulesetIds(cur);
      });

      rulesetCatalogLayout_->addWidget(row);
    }
  }
}

// ---------------- 3. Custom Filters Tab ----------------

void ArDaliBlockerPage::createCustomFiltersTab() {
  auto *scroll = new QScrollArea(this);
  scroll->setWidgetResizable(true);
  auto *container = new QWidget(scroll);
  auto *layout = new QVBoxLayout(container);
  layout->setContentsMargins(28, 24, 28, 24);
  layout->setSpacing(18);

  auto *editorGroup = new QGroupBox(QStringLiteral("Özel Filtreler"), container);
  auto *eLayout = new QVBoxLayout(editorGroup);
  eLayout->setContentsMargins(16, 16, 16, 16);
  eLayout->setSpacing(10);

  auto *hint = new QLabel(QStringLiteral("Kural formatı: ||example.com/ads^ (bloklama), @@||example.com/allow^ (izin), example.com##.advertisement (kozmetik gizleme)"), editorGroup);
  hint->setStyleSheet(QStringLiteral("color: #8c9ba8; font-size: 12px;"));
  eLayout->addWidget(hint);

  userFilterEditor_ = new QPlainTextEdit(editorGroup);
  userFilterEditor_->setPlaceholderText(QStringLiteral("Örnek:\n||doubleclick.net^\n@@||my-safe-site.com^\nexample.com##.ad-banner"));
  userFilterEditor_->setMinimumHeight(110);
  eLayout->addWidget(userFilterEditor_);

  auto *btnRow = new QHBoxLayout;
  auto *addBtn = new QPushButton(QStringLiteral("Filtre ekle"), editorGroup);
  addBtn->setObjectName(QStringLiteral("primary-btn"));
  auto *importBtn = new QPushButton(QStringLiteral("İçe aktar..."), editorGroup);
  auto *exportBtn = new QPushButton(QStringLiteral("Dışa aktar..."), editorGroup);
  userFilterValidation_ = new QLabel(editorGroup);
  userFilterValidation_->setStyleSheet(QStringLiteral("color: #5cf2c4; font-size: 12px;"));

  btnRow->addWidget(addBtn);
  btnRow->addWidget(importBtn);
  btnRow->addWidget(exportBtn);
  btnRow->addWidget(userFilterValidation_);
  btnRow->addStretch(1);
  eLayout->addLayout(btnRow);

  connect(addBtn, &QPushButton::clicked, this, [this]() {
    if (!service_) return;
    const QString text = userFilterEditor_->toPlainText().trimmed();
    if (text.isEmpty()) return;
    const QStringList lines = text.split(QRegularExpression(QStringLiteral("[\r\n]+")), Qt::SkipEmptyParts);
    QStringList current = service_->settings()->customFilters();
    int added = 0;
    QStringList errors;
    for (const QString &line : lines) {
      const QString trimmed = line.trimmed();
      const QString error = ArDaliBlockerEngine::validateCustomFilterLine(trimmed);
      if (!error.isEmpty()) {
        errors.append(QStringLiteral("%1: %2").arg(trimmed, error));
        continue;
      }
      if (!trimmed.isEmpty() && !current.contains(trimmed)) {
        current.append(trimmed);
        added++;
      }
    }
    service_->settings()->setCustomFilters(current);
    userFilterEditor_->clear();
    if (errors.isEmpty()) {
      userFilterValidation_->setStyleSheet(QStringLiteral("color: #5cf2c4; font-size: 12px;"));
      userFilterValidation_->setText(QStringLiteral("%1 kural eklendi.").arg(added));
    } else {
      userFilterValidation_->setStyleSheet(QStringLiteral("color: #ff8e99; font-size: 12px;"));
      userFilterValidation_->setText(QStringLiteral("%1 eklendi, %2 kural reddedildi: %3")
          .arg(added).arg(errors.size()).arg(errors.first()));
    }
    refreshCustomFiltersTab();
  });

  connect(importBtn, &QPushButton::clicked, this, [this]() {
    if (!service_) return;
    const QString path = QFileDialog::getOpenFileName(this, QStringLiteral("Filtre Listesi İçe Aktar"), QString(), QStringLiteral("Metin Dosyası (*.txt);;Tüm Dosyalar (*.*)"));
    if (path.isEmpty()) return;
    QFile file(path);
    if (file.open(QIODevice::ReadOnly)) {
      const QString content = QString::fromUtf8(file.readAll());
      const QStringList lines = content.split(QRegularExpression(QStringLiteral("[\r\n]+")), Qt::SkipEmptyParts);
      QStringList current = service_->settings()->customFilters();
      QStringList errors;
      for (const QString &l : lines) {
        const QString tr = l.trimmed();
        const QString error = ArDaliBlockerEngine::validateCustomFilterLine(tr);
        if (!error.isEmpty()) {
          errors.append(QStringLiteral("%1: %2").arg(tr, error));
          continue;
        }
        // Preserve comments: they are part of the user's list even though the
        // compiler intentionally ignores them.
        if (!tr.isEmpty() && !current.contains(tr)) {
          current.append(tr);
        }
      }
      service_->settings()->setCustomFilters(current);
      if (!errors.isEmpty()) {
        userFilterValidation_->setStyleSheet(QStringLiteral("color: #ff8e99; font-size: 12px;"));
        userFilterValidation_->setText(QStringLiteral("%1 geçersiz satır içe aktarılmadı: %2")
            .arg(errors.size()).arg(errors.first()));
      }
      refreshCustomFiltersTab();
    }
  });

  connect(exportBtn, &QPushButton::clicked, this, [this]() {
    if (!service_) return;
    const QString path = QFileDialog::getSaveFileName(this, QStringLiteral("Özel Filtreleri Dışa Aktar"), QStringLiteral("ardali-user-filters.txt"), QStringLiteral("Metin Dosyası (*.txt)"));
    if (path.isEmpty()) return;
    QSaveFile file(path);
    const QByteArray bytes = service_->settings()->customFilters().join(QStringLiteral("\n")).toUtf8();
    if (file.open(QIODevice::WriteOnly) && file.write(bytes) == bytes.size() && file.commit()) {
      QFile::setPermissions(path, QFileDevice::ReadOwner | QFileDevice::WriteOwner);
      QMessageBox::information(this, QStringLiteral("Dışa Aktarıldı"), QStringLiteral("Özel filtreler başarıyla kaydedildi."));
    }
  });

  layout->addWidget(editorGroup);

  // User Filter List
  auto *listGroup = new QGroupBox(QStringLiteral("Kullanıcı Filtreleri Listesi"), container);
  userFilterListLayout_ = new QVBoxLayout(listGroup);
  userFilterListLayout_->setContentsMargins(16, 16, 16, 16);
  userFilterListLayout_->setSpacing(8);
  layout->addWidget(listGroup);

  layout->addStretch(1);
  scroll->setWidget(container);
  stack_->addWidget(scroll);
}

void ArDaliBlockerPage::refreshCustomFiltersTab() {
  if (!service_ || !userFilterListLayout_) return;

  while (userFilterListLayout_->count() > 0) {
    auto *item = userFilterListLayout_->takeAt(0);
    if (item->widget()) delete item->widget();
    delete item;
  }

  const QStringList filters = service_->settings()->customFilters();
  if (filters.isEmpty()) {
    auto *empty = new QLabel(QStringLiteral("Henüz kullanıcı filtresi yok."), this);
    empty->setStyleSheet(QStringLiteral("color: #72849a; font-style: italic;"));
    userFilterListLayout_->addWidget(empty);
    return;
  }

  for (const QString &f : filters) {
    auto *row = new QFrame(this);
    row->setStyleSheet(QStringLiteral("background: #121720; border: 1px solid #24303f; border-radius: 8px; padding: 8px 12px;"));
    auto *rLayout = new QHBoxLayout(row);
    rLayout->setContentsMargins(6, 4, 6, 4);

    auto *textLbl = new QLabel(f, row);
    textLbl->setStyleSheet(QStringLiteral("font-family: monospace; font-size: 13px; color: #e4ebf5;"));
    rLayout->addWidget(textLbl, 1);

    auto *delBtn = new QPushButton(QStringLiteral("Sil"), row);
    delBtn->setStyleSheet(QStringLiteral("background: #3b2226; border-color: #5c2b33; color: #ff8e99;"));
    rLayout->addWidget(delBtn);

    connect(delBtn, &QPushButton::clicked, this, [this, f]() {
      if (!service_) return;
      QStringList current = service_->settings()->customFilters();
      current.removeAll(f);
      service_->settings()->setCustomFilters(current);
      refreshCustomFiltersTab();
    });

    userFilterListLayout_->addWidget(row);
  }
}

// ---------------- 4. Sites Tab ----------------

void ArDaliBlockerPage::createSitesTab() {
  auto *scroll = new QScrollArea(this);
  scroll->setWidgetResizable(true);
  auto *container = new QWidget(scroll);
  auto *layout = new QVBoxLayout(container);
  layout->setContentsMargins(28, 24, 28, 24);
  layout->setSpacing(18);

  auto *siteEditGroup = new QGroupBox(QStringLiteral("Site Koruması ve İzin Listesi"), container);
  auto *sLayout = new QVBoxLayout(siteEditGroup);
  sLayout->setContentsMargins(16, 16, 16, 16);
  sLayout->setSpacing(12);

  siteActiveStatus_ = new QLabel(siteEditGroup);
  siteActiveStatus_->setStyleSheet(QStringLiteral("color: #5cf2c4; font-size: 13px; font-weight: 600;"));
  sLayout->addWidget(siteActiveStatus_);

  auto *inputRow = new QHBoxLayout;
  siteHostInput_ = new QLineEdit(siteEditGroup);
  siteHostInput_->setPlaceholderText(QStringLiteral("example.com"));
  siteHostInput_->setMinimumWidth(220);

  siteWhitelistCheck_ = new GlowToggleSwitch(QStringLiteral("Beyaz Listeye Al (Whitelist)"), siteEditGroup);
  siteAdsCheck_ = new GlowToggleSwitch(QStringLiteral("Reklam engelleme"), siteEditGroup);
  siteAdsCheck_->setChecked(true);
  siteTrackersCheck_ = new GlowToggleSwitch(QStringLiteral("İzleyici koruması"), siteEditGroup);
  siteTrackersCheck_->setChecked(true);

  auto *saveBtn = new QPushButton(QStringLiteral("Kaydet"), siteEditGroup);
  saveBtn->setObjectName(QStringLiteral("primary-btn"));

  inputRow->addWidget(siteHostInput_);
  inputRow->addWidget(siteWhitelistCheck_);
  inputRow->addWidget(siteAdsCheck_);
  inputRow->addWidget(siteTrackersCheck_);
  inputRow->addWidget(saveBtn);
  sLayout->addLayout(inputRow);

  connect(siteWhitelistCheck_, &QCheckBox::toggled, this, [this](bool checked) {
    siteAdsCheck_->setEnabled(!checked);
    siteTrackersCheck_->setEnabled(!checked);
  });

  connect(saveBtn, &QPushButton::clicked, this, [this]() {
    if (!service_) return;
    const QString host = siteHostInput_->text().trimmed().toLower();
    if (host.isEmpty()) return;
    SitePolicy p;
    p.whitelisted = siteWhitelistCheck_->isChecked();
    p.adBlocking = siteAdsCheck_->isChecked();
    p.trackerProtection = siteTrackersCheck_->isChecked();
    service_->settings()->setSitePolicy(host, p);
    refreshSitesTab();
  });

  layout->addWidget(siteEditGroup);

  // Site Policies List
  auto *listGroup = new QGroupBox(QStringLiteral("Tanımlı Site Kuralları"), container);
  sitePolicyListLayout_ = new QVBoxLayout(listGroup);
  sitePolicyListLayout_->setContentsMargins(16, 16, 16, 16);
  sitePolicyListLayout_->setSpacing(8);
  layout->addWidget(listGroup);

  layout->addStretch(1);
  scroll->setWidget(container);
  stack_->addWidget(scroll);
}

void ArDaliBlockerPage::refreshSitesTab() {
  if (!service_) return;

  if (siteActiveStatus_) {
    if (!activeHost_.isEmpty()) {
      const SitePolicy p = service_->settings()->sitePolicy(activeHost_);
      if (p.whitelisted) {
        siteActiveStatus_->setText(QStringLiteral("Aktif Site: %1 (Beyaz Listede — Koruma Kapalı)").arg(activeHost_));
        siteActiveStatus_->setStyleSheet(QStringLiteral("color: #ffb86c; font-size: 13px; font-weight: 600;"));
      } else {
        siteActiveStatus_->setText(QStringLiteral("Aktif Site: %1 (Koruma Aktif)").arg(activeHost_));
        siteActiveStatus_->setStyleSheet(QStringLiteral("color: #5cf2c4; font-size: 13px; font-weight: 600;"));
      }
    } else {
      siteActiveStatus_->setText(QStringLiteral("Aktif web sekmesi yok"));
      siteActiveStatus_->setStyleSheet(QStringLiteral("color: #8c9ba8; font-size: 13px;"));
    }
  }

  if (sitePolicyListLayout_) {
    while (sitePolicyListLayout_->count() > 0) {
      auto *item = sitePolicyListLayout_->takeAt(0);
      if (item->widget()) delete item->widget();
      delete item;
    }

    const auto policies = service_->settings()->sitePolicies();
    if (policies.isEmpty()) {
      auto *empty = new QLabel(QStringLiteral("Henüz siteye özel kural yok."), this);
      empty->setStyleSheet(QStringLiteral("color: #72849a; font-style: italic;"));
      sitePolicyListLayout_->addWidget(empty);
      return;
    }

    for (auto it = policies.constBegin(); it != policies.constEnd(); ++it) {
      const QString host = it.key();
      const SitePolicy p = it.value();

      auto *row = new QFrame(this);
      row->setStyleSheet(QStringLiteral("background: #121720; border: 1px solid #24303f; border-radius: 8px; padding: 8px 12px;"));
      auto *rLayout = new QHBoxLayout(row);
      rLayout->setContentsMargins(6, 4, 6, 4);

      auto *hostLbl = new QLabel(host, row);
      hostLbl->setStyleSheet(QStringLiteral("font-size: 13px; font-weight: 600; color: #e4ebf5; min-width: 160px;"));
      rLayout->addWidget(hostLbl);

      QString statusStr = p.whitelisted ? QStringLiteral("Beyaz Listede") : QStringLiteral("Reklam: %1 · İzleyici: %2")
                                                                                .arg(p.adBlocking ? QStringLiteral("Açık") : QStringLiteral("Kapalı"),
                                                                                     p.trackerProtection ? QStringLiteral("Açık") : QStringLiteral("Kapalı"));
      auto *statusLbl = new QLabel(statusStr, row);
      statusLbl->setStyleSheet(p.whitelisted ? QStringLiteral("color: #ffb86c; font-size: 12px;") : QStringLiteral("color: #8c9ba8; font-size: 12px;"));
      rLayout->addWidget(statusLbl, 1);

      auto *toggleBtn = new QPushButton(p.whitelisted ? QStringLiteral("Beyaz Listeden Çıkar") : QStringLiteral("Beyaz Listeye Al"), row);
      auto *pauseBtn = new QPushButton(QStringLiteral("10 dk Kapat"), row);
      auto *delBtn = new QPushButton(QStringLiteral("Sil"), row);
      delBtn->setStyleSheet(QStringLiteral("background: #3b2226; border-color: #5c2b33; color: #ff8e99;"));

      rLayout->addWidget(toggleBtn);
      rLayout->addWidget(pauseBtn);
      rLayout->addWidget(delBtn);

      connect(toggleBtn, &QPushButton::clicked, this, [this, host, p]() {
        if (!service_) return;
        SitePolicy np = p;
        np.whitelisted = !np.whitelisted;
        service_->settings()->setSitePolicy(host, np);
        refreshSitesTab();
      });

      connect(pauseBtn, &QPushButton::clicked, this, [this, host, p]() {
        if (!service_) return;
        SitePolicy np = p;
        np.temporaryDisabledUntil = QDateTime::currentMSecsSinceEpoch() + (10 * 60 * 1000);
        service_->settings()->setSitePolicy(host, np);
        refreshSitesTab();
      });

      connect(delBtn, &QPushButton::clicked, this, [this, host]() {
        if (!service_) return;
        service_->settings()->removeSitePolicy(host);
        refreshSitesTab();
      });

      sitePolicyListLayout_->addWidget(row);
    }
  }
}

// ---------------- 5. Statistics Tab ----------------

void ArDaliBlockerPage::createStatisticsTab() {
  auto *scroll = new QScrollArea(this);
  scroll->setWidgetResizable(true);
  auto *container = new QWidget(scroll);
  auto *layout = new QVBoxLayout(container);
  layout->setContentsMargins(28, 24, 28, 24);
  layout->setSpacing(18);

  // 9 Stats Tiles Grid
  auto *gridFrame = new QFrame(container);
  gridFrame->setStyleSheet(QStringLiteral("background: #181f28; border: 1px solid #283442; border-radius: 10px; padding: 14px;"));
  auto *grid = new QGridLayout(gridFrame);
  grid->setSpacing(14);

  auto addGridStat = [grid, gridFrame](int r, int c, const QString &title, QLabel **outVal) {
    auto *tile = new QVBoxLayout;
    auto *tLabel = new QLabel(title, gridFrame);
    tLabel->setStyleSheet(QStringLiteral("color: #8c9ba8; font-size: 11px; font-weight: 600; text-transform: uppercase;"));
    auto *vLabel = new QLabel(QStringLiteral("0"), gridFrame);
    vLabel->setStyleSheet(QStringLiteral("color: #4ec9ff; font-size: 18px; font-weight: 700;"));
    tile->addWidget(tLabel);
    tile->addWidget(vLabel);
    grid->addLayout(tile, r, c);
    *outVal = vLabel;
  };

  addGridStat(0, 0, QStringLiteral("Bugün"), &statsToday_);
  addGridStat(0, 1, QStringLiteral("Bu hafta"), &statsWeek_);
  addGridStat(0, 2, QStringLiteral("Bu ay"), &statsMonth_);
  addGridStat(1, 0, QStringLiteral("Toplam"), &statsTotal_);
  addGridStat(1, 1, QStringLiteral("İzleyiciler"), &statsTrackers_);
  addGridStat(1, 2, QStringLiteral("Tahmini Tasarruf"), &statsSaved_);
  addGridStat(2, 0, QStringLiteral("Tahmini hızlanma"), &statsSpeed_);
  addGridStat(2, 1, QStringLiteral("Whitelist site sayısı"), &statsWhitelistSites_);
  addGridStat(2, 2, QStringLiteral("Whitelist ile izin verilen"), &statsWhitelistAllowed_);

  layout->addWidget(gridFrame);

  // Breakdown lists
  auto createRankingSection = [](const QString &title, QWidget *parent,
                                 QVBoxLayout **rows) {
    auto *section = new QFrame(parent);
    section->setObjectName(QStringLiteral("ranking-section"));
    section->setStyleSheet(QStringLiteral(
        "QFrame#ranking-section { background: #181f28; border: 1px solid #283442; border-radius: 10px; }"));
    auto *sectionLayout = new QVBoxLayout(section);
    sectionLayout->setContentsMargins(16, 14, 16, 16);
    sectionLayout->setSpacing(12);
    auto *titleLabel = new QLabel(title, section);
    titleLabel->setStyleSheet(QStringLiteral(
        "color: #e4ebf5; border: 0; font-size: 14px; font-weight: 700;"));
    sectionLayout->addWidget(titleLabel);
    *rows = new QVBoxLayout;
    (*rows)->setContentsMargins(0, 0, 0, 0);
    (*rows)->setSpacing(12);
    sectionLayout->addLayout(*rows);
    return section;
  };

  auto *topSitesGroup = createRankingSection(
      QStringLiteral("En Çok Engellenen Siteler"), container, &topSitesLayout_);
  topSitesLayout_->setSpacing(12);
  layout->addWidget(topSitesGroup);

  auto *topListsGroup = createRankingSection(
      QStringLiteral("En Etkin Filtre Listeleri"), container, &topListsLayout_);
  topListsLayout_->setSpacing(12);
  layout->addWidget(topListsGroup);

  layout->addStretch(1);
  scroll->setWidget(container);
  stack_->addWidget(scroll);
}

void ArDaliBlockerPage::refreshStatisticsTab() {
  if (!service_) return;

  if (statsToday_) statsToday_->setText(QString::number(service_->todayBlockedCount()));
  if (statsWeek_) statsWeek_->setText(QString::number(service_->weekBlockedCount()));
  if (statsMonth_) statsMonth_->setText(QString::number(service_->monthBlockedCount()));
  if (statsTotal_) statsTotal_->setText(QString::number(service_->totalBlockedCount()));
  if (statsTrackers_) statsTrackers_->setText(QString::number(service_->totalTrackersBlockedCount()));

  if (statsSaved_) {
    const quint64 bytes = service_->estimatedBytesSaved();
    if (bytes < 1024 * 1024) statsSaved_->setText(QStringLiteral("%1 KB").arg(bytes / 1024));
    else statsSaved_->setText(QStringLiteral("%1 MB").arg(QString::number(bytes / (1024.0 * 1024.0), 'f', 1)));
  }

  if (statsSpeed_) {
    const quint64 blocked = service_->totalBlockedCount();
    const quint64 allowed = service_->totalAllowedCount();
    const quint64 total = blocked + allowed;
    const int pct = total > 0 ? qBound(0, static_cast<int>((blocked * 100) / total), 95) : 0;
    statsSpeed_->setText(QStringLiteral("%1%").arg(pct));
  }

  if (statsWhitelistSites_) statsWhitelistSites_->setText(QString::number(service_->settings()->sitePolicies().size()));
  if (statsWhitelistAllowed_) statsWhitelistAllowed_->setText(QString::number(service_->whitelistAllowedCount()));

  // Top Sites
  if (topSitesLayout_) {
    while (topSitesLayout_->count() > 0) {
      auto *item = topSitesLayout_->takeAt(0);
      if (item->widget()) delete item->widget();
      delete item;
    }
    const auto top = service_->topBlockedHosts(6);
    if (top.isEmpty()) {
      auto *empty = new QLabel(QStringLiteral("Henüz engellenen site kaydı yok."), this);
      empty->setStyleSheet(QStringLiteral("color: #72849a; font-style: italic;"));
      topSitesLayout_->addWidget(empty);
    } else {
      int rank = 1;
      for (const auto &p : top) {
        topSitesLayout_->addWidget(createRankedMetricRow(
            rank++, p.first, p.second, QStringLiteral("engelleme"),
            QStringLiteral("#5cf2c4"), topSitesLayout_->parentWidget()));
      }
    }
  }

  // Top Lists
  if (topListsLayout_) {
    while (topListsLayout_->count() > 0) {
      auto *item = topListsLayout_->takeAt(0);
      if (item->widget()) delete item->widget();
      delete item;
    }
    const auto top = service_->topMatchedRulesets(6);
    if (top.isEmpty()) {
      auto *empty = new QLabel(QStringLiteral("Henüz eşleşen kural seti kaydı yok."), this);
      empty->setStyleSheet(QStringLiteral("color: #72849a; font-style: italic;"));
      topListsLayout_->addWidget(empty);
    } else {
      int rank = 1;
      for (const auto &p : top) {
        topListsLayout_->addWidget(createRankedMetricRow(
            rank++, p.first, p.second, QStringLiteral("eşleşme"),
            QStringLiteral("#4ec9ff"), topListsLayout_->parentWidget()));
      }
    }
  }
}

// ---------------- 6. Logger Tab ----------------

void ArDaliBlockerPage::createLoggerTab() {
  auto *container = new QWidget(this);
  auto *layout = new QVBoxLayout(container);
  layout->setContentsMargins(28, 24, 28, 24);
  layout->setSpacing(14);

  // Search & Filter Header
  auto *header = new QHBoxLayout;
  loggerSearch_ = new QLineEdit(container);
  loggerSearch_->setPlaceholderText(QStringLiteral("URL, kural veya liste ara..."));
  loggerActionCombo_ = new QComboBox(container);
  loggerActionCombo_->addItem(QStringLiteral("Tümü"), QStringLiteral("all"));
  loggerActionCombo_->addItem(QStringLiteral("Engellenen"), QStringLiteral("block"));
  loggerActionCombo_->addItem(QStringLiteral("İzin verilen"), QStringLiteral("allow"));

  header->addWidget(loggerSearch_, 1);
  header->addWidget(loggerActionCombo_);
  layout->addLayout(header);

  // Table
  logTable_ = new QTableWidget(container);
  logTable_->setColumnCount(6);
  logTable_->setHorizontalHeaderLabels({QStringLiteral("Zaman"), QStringLiteral("Tip"), QStringLiteral("Aksiyon"),
                                        QStringLiteral("Liste / Sebep"), QStringLiteral("Kural"), QStringLiteral("URL")});
  logTable_->horizontalHeader()->setStretchLastSection(true);
  logTable_->horizontalHeader()->setDefaultAlignment(Qt::AlignLeft);
  logTable_->verticalHeader()->setVisible(false);
  logTable_->setSelectionBehavior(QAbstractItemView::SelectRows);
  logTable_->setStyleSheet(QStringLiteral(
      "QTableWidget { background: #121720; border: 1px solid #283442; gridline-color: #1e2733; color: #e4ebf5; font-size: 12px; }"
      "QHeaderView::section { background: #181f28; color: #8c9ba8; font-weight: 600; border: 0; border-bottom: 1px solid #283442; padding: 6px 8px; }"
      "QTableWidget::item { padding: 4px 8px; }"
      "QTableWidget::item:selected { background: #2f3d4f; }"
  ));
  layout->addWidget(logTable_, 1);

  connect(loggerSearch_, &QLineEdit::textChanged, this, &ArDaliBlockerPage::refreshLoggerTab);
  connect(loggerActionCombo_, &QComboBox::currentIndexChanged, this, &ArDaliBlockerPage::refreshLoggerTab);

  // Diagnostics Box
  auto *diagBox = new QFrame(container);
  diagBox->setStyleSheet(QStringLiteral("background: #181f28; border: 1px solid #283442; border-radius: 8px; padding: 10px;"));
  auto *dLayout = new QHBoxLayout(diagBox);

  auto addDiagTile = [dLayout, diagBox](const QString &title, QLabel **outVal) {
    auto *tile = new QVBoxLayout;
    auto *t = new QLabel(title, diagBox);
    t->setStyleSheet(QStringLiteral("color: #8c9ba8; font-size: 10px; text-transform: uppercase;"));
    auto *v = new QLabel(QStringLiteral("0"), diagBox);
    v->setStyleSheet(QStringLiteral("color: #4ec9ff; font-size: 14px; font-weight: bold;"));
    tile->addWidget(t);
    tile->addWidget(v);
    dLayout->addLayout(tile);
    *outVal = v;
  };

  addDiagTile(QStringLiteral("Yüklü filtre"), &diagLoaded_);
  addDiagTile(QStringLiteral("Aktif liste"), &diagActive_);
  addDiagTile(QStringLiteral("Engellenen"), &diagBlocked_);
  addDiagTile(QStringLiteral("İzin verilen"), &diagAllowed_);
  addDiagTile(QStringLiteral("İşleme süresi"), &diagTime_);
  addDiagTile(QStringLiteral("Bellek"), &diagMemory_);

  layout->addWidget(diagBox);
  stack_->addWidget(container);
}

void ArDaliBlockerPage::refreshLoggerTab() {
  if (!service_ || !logTable_) return;

  const QString filterText = loggerSearch_->text().trimmed().toLower();
  const QString actionFilter = loggerActionCombo_->currentData().toString();
  const auto logs = service_->recentLogs(300);

  logTable_->setRowCount(0);
  int row = 0;

  for (const auto &entry : logs) {
    const QString actionStr = entry.action == ArDaliBlockerAction::Block ? QStringLiteral("block") :
                              entry.action == ArDaliBlockerAction::Redirect ? QStringLiteral("redirect") : QStringLiteral("allow");
    if (actionFilter == QLatin1String("block") && entry.action == ArDaliBlockerAction::Allow) continue;
    if (actionFilter == QLatin1String("allow") && entry.action != ArDaliBlockerAction::Allow) continue;

    if (!filterText.isEmpty()) {
      if (!entry.requestUrl.toLower().contains(filterText) &&
          !entry.siteHost.toLower().contains(filterText) &&
          !entry.rulesetId.toLower().contains(filterText)) {
        continue;
      }
    }

    logTable_->insertRow(row);
    logTable_->setItem(row, 0, new QTableWidgetItem(entry.timestamp.toString(QStringLiteral("hh:mm:ss"))));
    logTable_->setItem(row, 1, new QTableWidgetItem(entry.resourceTypeStr));

    auto *actItem = new QTableWidgetItem(entry.action == ArDaliBlockerAction::Block ? QStringLiteral("ENGEL") :
                                         entry.action == ArDaliBlockerAction::Redirect ? QStringLiteral("YÖNLENDİR") : QStringLiteral("İZİN"));
    if (entry.action == ArDaliBlockerAction::Block) actItem->setForeground(QColor(0xff, 0x6b, 0x6b));
    else if (entry.action == ArDaliBlockerAction::Redirect) actItem->setForeground(QColor(0xff, 0xb8, 0x6c));
    else actItem->setForeground(QColor(0x5c, 0xf2, 0xc4));
    logTable_->setItem(row, 2, actItem);

    logTable_->setItem(row, 3, new QTableWidgetItem(entry.rulesetId.isEmpty() ? entry.reason : entry.rulesetId));
    logTable_->setItem(row, 4, new QTableWidgetItem(entry.ruleId > 0 ? QString::number(entry.ruleId) : QStringLiteral("-")));
    logTable_->setItem(row, 5, new QTableWidgetItem(entry.requestUrl));
    row++;
  }

  // Diagnostics
  if (diagLoaded_) diagLoaded_->setText(QString::number(service_->filterEngine()->ruleCount()));
  if (diagActive_) diagActive_->setText(QString::number(service_->listManager()->availableLists().size()));
  if (diagBlocked_) diagBlocked_->setText(QString::number(service_->sessionBlockedCount()));
  if (diagAllowed_) diagAllowed_->setText(QString::number(service_->totalAllowedCount()));
  if (diagTime_) {
    if (service_->evaluationCount() > 0) {
      diagTime_->setText(QStringLiteral("%1 ms").arg(QString::number(service_->averageEvaluationTimeMs(), 'f', 3)));
    } else {
      diagTime_->setText(QStringLiteral("—"));
    }
  }
  if (diagMemory_) {
    const quint64 memBytes = service_->estimatedMemoryBytes();
    diagMemory_->setText(QStringLiteral("Tahmini: %1 MB").arg(QString::number(memBytes / (1024.0 * 1024.0), 'f', 2)));
  }
}

// ---------------- 7. Develop Tab ----------------

void ArDaliBlockerPage::createDevelopTab() {
  auto *container = new QWidget(this);
  auto *layout = new QVBoxLayout(container);
  layout->setContentsMargins(28, 24, 28, 24);
  layout->setSpacing(14);

  auto *topBar = new QHBoxLayout;
  auto *vLabel = new QLabel(QStringLiteral("Görünüm:"), container);
  developViewCombo_ = new QComboBox(container);
  developViewCombo_->addItem(QStringLiteral("Filtreleme modu ayrıntıları"), QStringLiteral("modes"));
  developViewCombo_->addItem(QStringLiteral("DNR ruleset özeti"), QStringLiteral("dnr"));
  developViewCombo_->addItem(QStringLiteral("Oturum eşleşme özeti"), QStringLiteral("session"));

  auto *resetStatsBtn = new QPushButton(QStringLiteral("Sayacı sıfırla"), container);

  topBar->addWidget(vLabel);
  topBar->addWidget(developViewCombo_);
  topBar->addStretch(1);
  topBar->addWidget(resetStatsBtn);
  layout->addLayout(topBar);

  developEditor_ = new QPlainTextEdit(container);
  developEditor_->setReadOnly(true);
  developEditor_->setStyleSheet(QStringLiteral("font-family: monospace; font-size: 12px; background: #0e1217; color: #a4b3c6;"));
  layout->addWidget(developEditor_, 1);

  connect(developViewCombo_, &QComboBox::currentIndexChanged, this, &ArDaliBlockerPage::refreshDevelopTab);
  connect(resetStatsBtn, &QPushButton::clicked, this, [this]() {
    if (service_) {
      service_->resetAllStats();
      refreshAll();
    }
  });

  stack_->addWidget(container);
}

void ArDaliBlockerPage::refreshDevelopTab() {
  if (!service_ || !developEditor_) return;
  const QString view = developViewCombo_->currentData().toString();

  QString text;
  if (view == QLatin1String("dnr")) {
    text = QStringLiteral("DNR Kural Özeti:\n"
                          "Yüklü Toplam Kural: %1\n"
                          "Özel Kullanıcı Kuralları: %2\n"
                          "Aktif Ruleset Sayısı: %3\n\n"
                          "Eşleşen Kural Setleri:\n")
               .arg(QString::number(service_->filterEngine()->ruleCount()),
                    QString::number(service_->filterEngine()->customRuleCount()),
                    QString::number(service_->listManager()->availableLists().size()));
    for (const auto &p : service_->topMatchedRulesets()) {
      text += QStringLiteral("  - %1: %2 eşleşme\n").arg(p.first, QString::number(p.second));
    }
  } else if (view == QLatin1String("session")) {
    text = QStringLiteral("Oturum İstatistik Özeti:\n"
                          "Oturumda Engellenen İstek: %1\n"
                          "Toplam Engellenen İstek: %2\n"
                          "Toplam İzin Verilen İstek: %3\n"
                          "İzleyici İstekleri: %4\n"
                          "Whitelist İle İzin Verilen: %5\n\n"
                          "Son Engellenen İstekler (Son 10):\n")
               .arg(QString::number(service_->sessionBlockedCount()),
                    QString::number(service_->totalBlockedCount()),
                    QString::number(service_->totalAllowedCount()),
                    QString::number(service_->totalTrackersBlockedCount()),
                    QString::number(service_->whitelistAllowedCount()));
    const auto logs = service_->recentLogs(10);
    for (const auto &l : logs) {
      if (l.action == ArDaliBlockerAction::Block || l.action == ArDaliBlockerAction::Redirect) {
        text += QStringLiteral("  [%1] %2 -> %3 (%4)\n")
                    .arg(l.timestamp.toString(QStringLiteral("hh:mm:ss")), l.siteHost, l.rulesetId, l.resourceTypeStr);
      }
    }
  } else {
    text = QStringLiteral("ArDali Reklam Engelleyici Mod Özeti:\n"
                          "Aktif Mod: %1\n"
                          "Sıkı Engelleme (Strict Block): %2\n"
                          "Açılır Pencere Engelleme (Popup Block): %3\n"
                          "Geliştirici Modu: %4\n"
                          "Otomatik Sayfa Yenileme: %5\n"
                          "Kalkan Sayacı Gösterimi: %6\n\n"
                          "Filtre Motoru Yapılandırması:\n"
                          "  - Network Request Interception: QWebEngineUrlRequestInterceptor\n"
                          "  - Dynamic Cosmetic Stylesheets: Aktif\n"
                          "  - Strict Protection Redirects: ardali://newtab?strictblock=1\n")
               .arg(modeToString(service_->settings()->mode()),
                    service_->settings()->strictBlock() ? QStringLiteral("Açık") : QStringLiteral("Kapalı"),
                    service_->settings()->popupBlock() ? QStringLiteral("Açık") : QStringLiteral("Kapalı"),
                    service_->settings()->developerMode() ? QStringLiteral("Açık") : QStringLiteral("Kapalı"),
                    service_->settings()->autoReloadOnModeChange() ? QStringLiteral("Açık") : QStringLiteral("Kapalı"),
                    service_->settings()->showBlockedCountOnToolbar() ? QStringLiteral("Açık") : QStringLiteral("Kapalı"));
  }

  developEditor_->setPlainText(text);
}

// ---------------- 8. About Tab ----------------

void ArDaliBlockerPage::createAboutTab() {
  auto *scroll = new QScrollArea(this);
  scroll->setWidgetResizable(true);
  auto *container = new QWidget(scroll);
  auto *layout = new QVBoxLayout(container);
  layout->setContentsMargins(28, 24, 28, 24);
  layout->setSpacing(18);

  auto *aboutGroup = new QGroupBox(QStringLiteral("ArDali Blocker Hakkında"), container);
  auto *aLayout = new QVBoxLayout(aboutGroup);
  aLayout->setContentsMargins(18, 18, 18, 18);
  aLayout->setSpacing(14);

  auto *body = new QLabel(
      QStringLiteral("ArDali Blocker, yerel kural seti mantığını Chromium ağ istek motoruyla birleştirir. "
                     "Ağ engelleme doğrudan Qt WebEngine UrlRequestInterceptor seviyesinde gerçekleşirken, görünür reklam temizliği "
                     "ise sayfa içi güvenli CSS kuralları ile yapılır."),
      aboutGroup);
  body->setWordWrap(true);
  body->setStyleSheet(QStringLiteral("color: #b8c4d4; font-size: 13px; line-height: 1.5;"));
  aLayout->addWidget(body);

  auto *hostBox = new QFrame(aboutGroup);
  hostBox->setStyleSheet(QStringLiteral("background: #121720; border: 1px solid #283545; border-radius: 8px; padding: 12px;"));
  auto *hLayout = new QHBoxLayout(hostBox);
  auto *globe = new QLabel(QStringLiteral("🌐"), hostBox);
  globe->setStyleSheet(QStringLiteral("font-size: 20px;"));
  aboutActiveHostLabel_ = new QLabel(QStringLiteral("Aktif web sekmesi yok"), hostBox);
  aboutActiveHostLabel_->setStyleSheet(QStringLiteral("font-size: 14px; font-weight: 600; color: #4ec9ff;"));

  hLayout->addWidget(globe);
  hLayout->addWidget(aboutActiveHostLabel_, 1);
  aLayout->addWidget(hostBox);

  auto *verLbl = new QLabel(
      QStringLiteral("Sürüm: %1 (Native Qt/C++ Motoru) · Lisans: GPL-3.0-only / ArDali Project")
          .arg(QStringLiteral(ARDALI_BROWSER_VERSION)),
      aboutGroup);
  verLbl->setStyleSheet(QStringLiteral("color: #72849a; font-size: 12px;"));
  aLayout->addWidget(verLbl);

  layout->addWidget(aboutGroup);
  layout->addStretch(1);
  scroll->setWidget(container);
  stack_->addWidget(scroll);
}

bool ArDaliBlockerPage::eventFilter(QObject *watched, QEvent *event) {
  if (event->type() == QEvent::MouseButtonRelease) {
    auto isChildOf = [](QWidget *parent, QObject *obj) {
      if (!parent || !obj) return false;
      if (parent == obj) return true;
      auto *w = qobject_cast<QWidget *>(obj);
      return w && parent->isAncestorOf(w);
    };

    if (isChildOf(basicCard_, watched)) {
      if (service_) service_->settings()->setMode(ArDaliBlockerMode::Basic);
      return true;
    }
    if (isChildOf(idealCard_, watched)) {
      if (service_) service_->settings()->setMode(ArDaliBlockerMode::Ideal);
      return true;
    }
    if (isChildOf(aggressiveCard_, watched)) {
      if (service_) service_->settings()->setMode(ArDaliBlockerMode::Aggressive);
      return true;
    }
  }
  return QWidget::eventFilter(watched, event);
}
