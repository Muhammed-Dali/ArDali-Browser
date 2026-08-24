#include "side_widget.h"
#include "side_widget_settings_panel.h"

#include <QAbstractButton>
#include <QApplication>
#include <QDebug>
#include <QEvent>
#include <QGraphicsOpacityEffect>
#include <QKeyEvent>
#include <QMouseEvent>
#include <QPainter>
#include <QPainterPath>
#include <QPixmap>
#include <QRegion>
#include <QSettings>
#include <QTimer>
#include <QToolButton>
#include <cmath>

namespace {

struct ToolDef {
  SideTool tool;
  const char *title;
  const char *accentHex;
  const char *iconResource;
};

// 11 active tools list
const ToolDef kToolDefs[] = {
    {SideTool::DaliFiles, "DALI Dosya Yöneticisi", "#7dd9ff", ":/side-widget-icons/files.svg"},
    {SideTool::QuickListen, "Hızlı Dinleme", "#79a7ff", ":/side-widget-icons/quick-listen.svg"},
    {SideTool::SongFinder, "ArDali Pulse", "#8da4ff", ":/side-widget-icons/pulse.svg"},
    {SideTool::ScreenRecorder, "Ekran Kaydedici", "#7cf2d5", ":/side-widget-icons/video-tools.svg"},
    {SideTool::Video, "Video Oynatıcı", "#91b4ff", ":/side-widget-icons/video.svg"},
    {SideTool::Music, "Müzik Oynatıcı", "#86ffc8", ":/side-widget-icons/music.svg"},
    {SideTool::Gallery, "Görsel Galeri", "#a3e5ff", ":/side-widget-icons/gallery.svg"},
    {SideTool::AudioEffects, "Ses Efektleri & DSP", "#76f2ff", ":/side-widget-icons/sound-effects.svg"},
    {SideTool::EqPresets, "Hazır Ses Efektleri", "#94b8ff", ":/side-widget-icons/eq-presets.svg"},
    {SideTool::Visualizer, "Ses Görselleştirici (Spektrum)", "#b3c8ff", ":/side-widget-icons/visualizer.svg"},
    {SideTool::About, "Hakkında", "#a8d4ff", ":/side-widget-icons/about.svg"},
};

} // namespace

class SideWidgetTrigger final : public QAbstractButton {
 public:
  explicit SideWidgetTrigger(QWidget *parent = nullptr) : QAbstractButton(parent) {
    setObjectName(QStringLiteral("side-widget-trigger"));
    setToolTip(QStringLiteral("Akıllı Kenar Paneli"));
    setAccessibleName(QStringLiteral("Akıllı Kenar Paneli Menüsü"));
    setFocusPolicy(Qt::StrongFocus);
    setCursor(Qt::PointingHandCursor);
    setFixedSize(16, 52);
    setAttribute(Qt::WA_Hover, true);
  }

  bool isHovered() const { return isHovered_; }

 protected:
  void enterEvent(QEnterEvent *event) override {
    QAbstractButton::enterEvent(event);
    isHovered_ = true;
    update();
  }

  void leaveEvent(QEvent *event) override {
    QAbstractButton::leaveEvent(event);
    isHovered_ = false;
    update();
  }

  void paintEvent(QPaintEvent *event) override {
    Q_UNUSED(event);
    QPainter painter(this);
    painter.setRenderHint(QPainter::Antialiasing, true);

    QPainterPath path;
    path.moveTo(0, 7);
    path.cubicTo(12, 12, 12, 40, 0, 45);

    if (isHovered_ || isChecked() || hasFocus()) {
      QPen shadowPen(QColor(118, 226, 255, 140), 5.5);
      shadowPen.setCapStyle(Qt::RoundCap);
      painter.setPen(shadowPen);
      painter.drawPath(path);

      QPen linePen(QColor(142, 232, 255, 230), 2.5);
      linePen.setCapStyle(Qt::RoundCap);
      painter.setPen(linePen);
      painter.drawPath(path);
    } else {
      QPen shadowPen(QColor(75, 175, 238, 45), 3.5);
      shadowPen.setCapStyle(Qt::RoundCap);
      painter.setPen(shadowPen);
      painter.drawPath(path);

      QPen linePen(QColor(176, 222, 248, 150), 2.0);
      linePen.setCapStyle(Qt::RoundCap);
      painter.setPen(linePen);
      painter.drawPath(path);
    }
  }

 private:
  bool isHovered_ = false;
};

SideWidget::SideWidget(QWidget *parent) : QWidget(parent) {
  setObjectName(QStringLiteral("ardali-side-widget"));
  setAttribute(Qt::WA_NoSystemBackground, true);
  setAttribute(Qt::WA_TranslucentBackground, true);
  setAutoFillBackground(false);

  // Load persistent QSettings configuration
  QSettings settings;
  config_.load(settings);

  slideAnimation_.setEasingCurve(config_.openEasing);
  connect(&slideAnimation_, &QVariantAnimation::valueChanged, this, &SideWidget::onAnimationValueChanged);
  connect(&slideAnimation_, &QVariantAnimation::finished, this, &SideWidget::onAnimationFinished);

  triggerButton_ = new SideWidgetTrigger(this);
  connect(triggerButton_, &QAbstractButton::clicked, this, &SideWidget::toggleWidget);

  setupSettingsButton();
  setupButtons();

  if (parent) parent->installEventFilter(this);
}

SideWidget::~SideWidget() {
  slideAnimation_.stop();
  if (qApp) {
    qApp->removeEventFilter(this);
  }
}

void SideWidget::setupSettingsButton() {
  settingsButton_ = new QToolButton(this);
  settingsButton_->setObjectName(QStringLiteral("side-widget-settings-btn"));
  settingsButton_->setToolTip(QStringLiteral("Kenar Çubuğu Ayarları"));
  settingsButton_->setAccessibleName(QStringLiteral("Kenar Çubuğu Ayarları"));
  settingsButton_->setFocusPolicy(Qt::StrongFocus);
  settingsButton_->setCursor(Qt::PointingHandCursor);
  settingsButton_->setFixedSize(26, 26);

  // Crisp gear settings icon
  QIcon gearIcon(QStringLiteral(":/side-widget-icons/settings-gear.svg"));
  settingsButton_->setIcon(gearIcon);
  settingsButton_->setIconSize(QSize(16, 16));

  settingsButton_->setStyleSheet(QStringLiteral(
      "QToolButton {"
      "  background: rgba(14, 23, 38, 0.90);"
      "  border: 1px solid rgba(120, 200, 255, 0.40);"
      "  border-radius: 13px;"
      "}"
      "QToolButton:hover, QToolButton:focus-visible {"
      "  background: rgba(36, 68, 105, 0.96);"
      "  border-color: #7dd9ff;"
      "}"));

  connect(settingsButton_, &QToolButton::clicked, this, &SideWidget::toggleSettingsPanel);
}

void SideWidget::setupButtons() {
  for (const auto &def : kToolDefs) {
    ToolButtonInfo info;
    info.tool = def.tool;
    info.title = QString::fromUtf8(def.title);
    info.accentColor = QColor(QString::fromLatin1(def.accentHex));

    auto *btn = new QToolButton(this);
    btn->setObjectName(QStringLiteral("side-tool-btn"));
    btn->setToolTip(info.title);
    btn->setAccessibleName(info.title);
    btn->setFocusPolicy(Qt::StrongFocus);
    btn->setCursor(Qt::PointingHandCursor);
    btn->installEventFilter(this);

    info.icon = createToolIcon(def.tool, info.accentColor);
    btn->setIcon(info.icon);
    btn->setIconSize(QSize(26, 26));

    btn->setStyleSheet(QString(
        "QToolButton {"
        "  background: rgba(14, 23, 38, 0.90);"
        "  border: 1px solid rgba(80, 160, 255, 0.30);"
        "  border-radius: %1px;"
        "}"
        "QToolButton:hover,"
        "QToolButton:focus-visible {"
        "  background: rgba(32, 52, 76, 0.96);"
        "  border-color: %2;"
        "}"
        "QToolButton:pressed {"
        "  background: rgba(50, 80, 115, 0.98);"
        "}").arg(config_.buttonDiameter / 2).arg(info.accentColor.name()));

    auto *opacityEffect = new QGraphicsOpacityEffect(btn);
    opacityEffect->setOpacity(0.0);
    btn->setGraphicsEffect(opacityEffect);

    connect(btn, &QToolButton::clicked, this, [this, tool = def.tool] {
      onButtonClicked(tool);
    });

    btn->hide();
    info.button = btn;
    tools_.append(info);
  }
}

void SideWidget::setConfig(const SideWidgetConfig &cfg) {
  config_ = cfg;
  QSettings settings;
  config_.save(settings);

  if (settingsPanel_) {
    settingsPanel_->setConfig(config_);
  }
  updateLayoutGeometries();
}

void SideWidget::resetConfigToDefaults() {
  setConfig(SideWidgetConfig::defaults());
}

QRect SideWidget::buttonRect(int index) const {
  if (index < 0 || index >= tools_.size() || !tools_[index].button) return QRect();
  return tools_[index].button->geometry();
}

bool SideWidget::checkOverlapInOpenState() const {
  const int N = tools_.size();
  const double minDistance = static_cast<double>(config_.buttonDiameter) - 1.0;
  for (int i = 0; i < N; ++i) {
    const QRect r1 = buttonRect(i);
    if (r1.isEmpty()) continue;
    const QPointF c1 = r1.center();
    for (int j = i + 1; j < N; ++j) {
      const QRect r2 = buttonRect(j);
      if (r2.isEmpty()) continue;
      const QPointF c2 = r2.center();
      const double dx = c1.x() - c2.x();
      const double dy = c1.y() - c2.y();
      const double dist = std::sqrt(dx * dx + dy * dy);
      if (dist < minDistance) return true; // Circular overlap detected!
    }
  }
  return false;
}

void SideWidget::forceAnimationProgressForTest(qreal progress) {
  animationProgress_ = progress;
  updateLayoutGeometries();
}

void SideWidget::openWidget() {
  if (state_ == SideWidgetState::Open) return;

  if (!config_.animationsEnabled) {
    animationProgress_ = 1.0;
    setState(SideWidgetState::Open);
    updateLayoutGeometries();
    return;
  }

  // Deterministic reset on fresh opening
  if (state_ == SideWidgetState::Closed || animationProgress_ <= 0.05) {
    animationProgress_ = 0.0;
  }

  setState(SideWidgetState::Opening);
  slideAnimation_.stop();
  slideAnimation_.setEasingCurve(config_.openEasing);
  slideAnimation_.setStartValue(animationProgress_);
  slideAnimation_.setEndValue(1.0);

  const int totalMs = config_.openDurationMs;
  const int remainingMs = static_cast<int>(totalMs * (1.0 - animationProgress_));
  slideAnimation_.setDuration(qMax(40, remainingMs));
  slideAnimation_.start();

  if (qApp) {
    qApp->removeEventFilter(this);
    qApp->installEventFilter(this);
  }
}

void SideWidget::closeWidget() {
  if (state_ == SideWidgetState::Closed) return;

  if (!config_.animationsEnabled) {
    animationProgress_ = 0.0;
    setState(SideWidgetState::Closed);
    updateLayoutGeometries();
    if (qApp) qApp->removeEventFilter(this);
    return;
  }

  // Deterministic reset on fresh closing
  if (state_ == SideWidgetState::Open || animationProgress_ >= 0.95) {
    animationProgress_ = 1.0;
  }

  setState(SideWidgetState::Closing);
  slideAnimation_.stop();
  slideAnimation_.setEasingCurve(config_.closeEasing);
  slideAnimation_.setStartValue(animationProgress_);
  slideAnimation_.setEndValue(0.0);

  const int totalMs = config_.closeDurationMs;
  const int remainingMs = static_cast<int>(totalMs * animationProgress_);
  slideAnimation_.setDuration(qMax(40, remainingMs));
  slideAnimation_.start();
}

void SideWidget::toggleWidget() {
  if (isOpen()) {
    closeWidget();
  } else {
    openWidget();
  }
}

void SideWidget::toggleSettingsPanel() {
  if (settingsPanel_ && settingsPanel_->isVisible()) {
    closeSettingsPanel();
  } else {
    openSettingsPanel();
  }
}

void SideWidget::openSettingsPanel() {
  if (!settingsPanel_) {
    settingsPanel_ = new SideWidgetSettingsPanel(this);
    connect(settingsPanel_, &SideWidgetSettingsPanel::configChanged, this, [this](const SideWidgetConfig &newCfg) {
      setConfig(newCfg);
    });
    connect(settingsPanel_, &SideWidgetSettingsPanel::previewRequested, this, &SideWidget::previewAnimation);
    connect(settingsPanel_, &SideWidgetSettingsPanel::resetRequested, this, &SideWidget::resetConfigToDefaults);
    connect(settingsPanel_, &SideWidgetSettingsPanel::closeRequested, this, &SideWidget::closeSettingsPanel);
  }

  settingsPanel_->setConfig(config_);
  settingsPanel_->setOverlapWarning(checkOverlapInOpenState());
  settingsPanel_->show();
  settingsPanel_->raise();
  updateLayoutGeometries();

  if (qApp) {
    qApp->removeEventFilter(this);
    qApp->installEventFilter(this);
  }
}

void SideWidget::closeSettingsPanel() {
  if (settingsPanel_) {
    settingsPanel_->hide();
  }
  updateLayoutGeometries();
}

void SideWidget::previewAnimation() {
  if (isOpen()) {
    closeWidget();
    // Re-open after closing completes
    QTimer::singleShot(config_.closeDurationMs + 50, this, [this] { openWidget(); });
  } else {
    openWidget();
  }
}

bool SideWidget::handleEscKey() {
  if (settingsPanel_ && settingsPanel_->isVisible()) {
    closeSettingsPanel();
    return true;
  }
  if (isOpen()) {
    closeWidget();
    return true;
  }
  return false;
}

void SideWidget::setState(SideWidgetState newState) {
  if (state_ == newState) return;
  state_ = newState;
  emit stateChanged(state_);
}

void SideWidget::onAnimationValueChanged(const QVariant &value) {
  animationProgress_ = value.toReal();
  updateLayoutGeometries();
  update();
}

void SideWidget::onAnimationFinished() {
  const double endVal = slideAnimation_.endValue().toDouble();
  if (endVal >= 0.99 || animationProgress_ >= 0.99) {
    animationProgress_ = 1.0;
    setState(SideWidgetState::Open);
  } else {
    animationProgress_ = 0.0;
    setState(SideWidgetState::Closed);
    if (qApp && (!settingsPanel_ || !settingsPanel_->isVisible())) {
      qApp->removeEventFilter(this);
    }
  }
  updateLayoutGeometries();
}

void SideWidget::onButtonClicked(SideTool tool) {
  qDebug().noquote() << QStringLiteral("[SideWidget] Tool requested: %1")
                            .arg(static_cast<int>(tool));
  // A tool opens a full page/tab. Collapse the temporary radial menu first so
  // it never obscures the destination content while the page is switching.
  closeWidget();
  emit toolRequested(tool);
}

void SideWidget::updateLayoutGeometries() {
  const int w = width();
  const int h = height();
  if (w <= 0 || h <= 0) return;

  // Trigger geometry: embedded on left edge
  const int triggerW = 16;
  const int triggerH = 52;
  const int centerY = h / 2;
  const int triggerY = centerY - (triggerH / 2);
  triggerButton_->setGeometry(0, triggerY, triggerW, triggerH);

  // Settings button position right beside trigger: (22, centerY - 13)
  const int settingsW = 26;
  const int settingsH = 26;
  const int settingsX = 22;
  const int settingsY = centerY - (settingsH / 2);
  settingsButton_->setGeometry(settingsX, settingsY, settingsW, settingsH);

  const bool isTriggerHovered = triggerButton_ && triggerButton_->isHovered();
  const bool isSettingsPanelOpen = settingsPanel_ && settingsPanel_->isVisible();
  settingsButton_->setVisible(isOpen() || isTriggerHovered || isSettingsPanelOpen);

  // Position settings panel beside trigger
  if (settingsPanel_ && settingsPanel_->isVisible()) {
    const int panelY = qBound(10, centerY - (settingsPanel_->height() / 2), h - settingsPanel_->height() - 10);
    settingsPanel_->move(56, panelY);
  }

  // ArDali-WebMedia's smart radial menu: retain the original responsive arc
  // rather than stretching the fan too far vertically on large windows.
  // The old app used 142/220 as the lower bounds. At that size two 48px Qt
  // hit targets touch on a 1024x768 window, so keep a small no-overlap floor.
  // Above that compact size these are exactly the WebMedia measurements.
  const double radiusX = std::clamp(w * 0.115, 160.0, 188.0);
  const double radiusY = std::clamp(h * 0.310, 270.0, 285.0);
  constexpr double startAngle = -78.0 * (M_PI / 180.0);
  constexpr double endAngle = 78.0 * (M_PI / 180.0);

  const int N = tools_.size();
  const int buttonSize = config_.buttonDiameter;

  const bool isClosing = (state_ == SideWidgetState::Closing);
  QRegion activeMask(triggerButton_->geometry());

  if (settingsButton_->isVisible()) {
    activeMask += QRegion(settingsButton_->geometry(), QRegion::Ellipse);
  }

  if (settingsPanel_ && settingsPanel_->isVisible()) {
    activeMask += QRegion(settingsPanel_->geometry());
  }

  // Calculate stagger fraction from config ms
  const double totalDuration = isClosing ? config_.closeDurationMs : config_.openDurationMs;
  const double staggerMs = isClosing ? config_.closeStaggerMs : config_.openStaggerMs;
  const double maxDelayFraction = (totalDuration > 0.0) ? std::clamp(staggerMs * N / totalDuration, 0.0, 0.40) : 0.0;

  for (int i = 0; i < N; ++i) {
    ToolButtonInfo &info = tools_[i];
    if (!info.button) continue;

    const double progress = (N > 1) ? static_cast<double>(i) / (N - 1) : 0.5;
    const double angle = startAngle + (endAngle - startAngle) * progress;

    info.targetX = std::cos(angle) * radiusX;
    info.targetY = std::sin(angle) * radiusY;

    // Staggered delay per button
    const double delayFraction = isClosing
                                     ? ((N - 1 - i) / static_cast<double>(N - 1)) * maxDelayFraction
                                     : (i / static_cast<double>(N - 1)) * maxDelayFraction;

    double pI = 0.0;
    if (!config_.animationsEnabled) {
      pI = (state_ == SideWidgetState::Closed) ? 0.0 : 1.0;
    } else if (animationProgress_ > delayFraction) {
      const double denom = qMax(0.01, 1.0 - maxDelayFraction);
      pI = std::clamp((animationProgress_ - delayFraction) / denom, 0.0, 1.0);
    }

    // Radial bloom fan trajectory: start near trigger anchor (4px, centerY)
    const double startX = 4.0;
    const double startY = 0.0;

    const double openingScale = config_.startScale + ((1.0 - config_.startScale) * pI);
    const double hoverScale = (info.hovered && pI > 0.99) ? 1.03 : 1.0;
    const int renderedButtonSize = qMax(1, qRound(buttonSize * openingScale * hoverScale));
    const double currentX = startX + (info.targetX - startX) * pI
        - ((renderedButtonSize - buttonSize) / 2.0);
    const double currentY = centerY + (startY + (info.targetY - startY) * pI)
        - (renderedButtonSize / 2.0);

    info.button->setFixedSize(renderedButtonSize, renderedButtonSize);
    info.button->setIconSize(QSize(qRound(renderedButtonSize * 0.54), qRound(renderedButtonSize * 0.54)));

    // Update stylesheet for dynamic button diameter
    info.button->setStyleSheet(QString(
        "QToolButton {"
        "  background: rgba(14, 23, 38, 0.90);"
        "  border: 1px solid rgba(80, 160, 255, 0.30);"
        "  border-radius: %1px;"
        "}"
        "QToolButton:hover,"
        "QToolButton:focus-visible {"
        "  background: rgba(32, 52, 76, 0.96);"
        "  border-color: %2;"
        "}"
        "QToolButton:pressed {"
        "  background: rgba(50, 80, 115, 0.98);"
        "}").arg(renderedButtonSize / 2).arg(info.accentColor.name()));

    // Update opacity graphics effect
    if (auto *effect = qobject_cast<QGraphicsOpacityEffect *>(info.button->graphicsEffect())) {
      effect->setOpacity(pI);
    }

    const QRect btnRect(static_cast<int>(currentX), static_cast<int>(currentY), renderedButtonSize, renderedButtonSize);
    info.button->setGeometry(btnRect);
    const bool isVisible = pI > 0.001;
    info.button->setVisible(isVisible);

    if (isVisible) {
      activeMask += QRegion(btnRect, QRegion::Ellipse);
    }
  }

  // Click-through mask: transparent empty space passes through to web content underneath!
  if (animationProgress_ > 0.001 || isSettingsPanelOpen) {
    setMask(activeMask);
  } else {
    setMask(QRegion(triggerButton_->geometry()));
  }
}

bool SideWidget::eventFilter(QObject *watched, QEvent *event) {
  if (event->type() == QEvent::Enter || event->type() == QEvent::Leave) {
    for (ToolButtonInfo &info : tools_) {
      if (info.button != watched) continue;
      info.hovered = event->type() == QEvent::Enter;
      updateLayoutGeometries();
      break;
    }
  }
  if (event->type() == QEvent::KeyPress) {
    auto *keyEvent = static_cast<QKeyEvent *>(event);
    if (keyEvent->key() == Qt::Key_Escape) {
      return handleEscKey();
    }
  } else if (event->type() == QEvent::MouseButtonPress && (isOpen() || (settingsPanel_ && settingsPanel_->isVisible()))) {
    auto *mouseEvent = static_cast<QMouseEvent *>(event);
    const QPoint globalPos = mouseEvent->globalPosition().toPoint();
    const QPoint localPos = mapFromGlobal(globalPos);

    bool clickedOnChild = false;
    if (triggerButton_ && triggerButton_->geometry().contains(localPos)) {
      clickedOnChild = true;
    } else if (settingsButton_ && settingsButton_->isVisible() && settingsButton_->geometry().contains(localPos)) {
      clickedOnChild = true;
    } else if (settingsPanel_ && settingsPanel_->isVisible() && settingsPanel_->geometry().contains(localPos)) {
      clickedOnChild = true;
    } else {
      for (const auto &info : tools_) {
        if (info.button && info.button->isVisible() && info.button->geometry().contains(localPos)) {
          clickedOnChild = true;
          break;
        }
      }
    }

    if (!clickedOnChild) {
      if (settingsPanel_ && settingsPanel_->isVisible()) {
        closeSettingsPanel();
      }
      if (isOpen()) {
        closeWidget();
      }
    }
  }
  return QWidget::eventFilter(watched, event);
}

void SideWidget::resizeEvent(QResizeEvent *event) {
  QWidget::resizeEvent(event);
  updateLayoutGeometries();
}

void SideWidget::paintEvent(QPaintEvent *event) {
  Q_UNUSED(event);
}

QIcon SideWidget::createToolIcon(SideTool tool, const QColor &color) {
  Q_UNUSED(color);
  for (const auto &def : kToolDefs) {
    if (def.tool == tool) {
      QIcon icon(QString::fromUtf8(def.iconResource));
      if (!icon.isNull()) return icon;
    }
  }
  return QIcon();
}
