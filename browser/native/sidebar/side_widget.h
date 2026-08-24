#pragma once

#include "side_widget_config.h"

#include <QColor>
#include <QIcon>
#include <QList>
#include <QObject>
#include <QPointer>
#include <QRect>
#include <QVariantAnimation>
#include <QVector>
#include <QWidget>

class SideWidgetTrigger;
class SideWidgetSettingsPanel;
class QToolButton;

enum class SideTool {
  WebProtection,
  Browser,
  DaliFiles,
  QuickListen,
  SongFinder,
  ScreenRecorder,
  Video,
  Music,
  Gallery,
  AudioEffects,
  EqPresets,
  Visualizer,
  Settings,
  About
};

enum class SideWidgetState {
  Closed,
  Opening,
  Open,
  Closing
};

class SideWidget final : public QWidget {
  Q_OBJECT

 public:
  explicit SideWidget(QWidget *parent = nullptr);
  ~SideWidget() override;

  SideWidgetState state() const { return state_; }
  bool isOpen() const { return state_ == SideWidgetState::Open || state_ == SideWidgetState::Opening; }
  void forceAnimationProgressForTest(qreal progress);
  qreal animationProgress() const { return animationProgress_; }

  int buttonCount() const { return tools_.size(); }
  QRect buttonRect(int index) const;
  bool checkOverlapInOpenState() const;

  SideWidgetConfig config() const { return config_; }
  void setConfig(const SideWidgetConfig &cfg);
  void resetConfigToDefaults();

  void openWidget();
  void closeWidget();
  void toggleWidget();

  void toggleSettingsPanel();
  void openSettingsPanel();
  void closeSettingsPanel();
  void previewAnimation();

  bool handleEscKey();

 signals:
  void toolRequested(SideTool tool);
  void stateChanged(SideWidgetState newState);

 protected:
  bool eventFilter(QObject *watched, QEvent *event) override;
  void resizeEvent(QResizeEvent *event) override;
  void paintEvent(QPaintEvent *event) override;

 private slots:
  void onAnimationValueChanged(const QVariant &value);
  void onAnimationFinished();
  void onButtonClicked(SideTool tool);

 private:
  struct ToolButtonInfo {
    SideTool tool;
    QString title;
    QIcon icon;
    QColor accentColor;
    QToolButton *button = nullptr;
    double targetX = 0.0;
    double targetY = 0.0;
    bool hovered = false;
  };

  void setupButtons();
  void setupSettingsButton();
  void updateLayoutGeometries();
  void setState(SideWidgetState newState);
  static QIcon createToolIcon(SideTool tool, const QColor &color);

  SideWidgetTrigger *triggerButton_ = nullptr;
  QToolButton *settingsButton_ = nullptr;
  SideWidgetSettingsPanel *settingsPanel_ = nullptr;

  QVector<ToolButtonInfo> tools_;
  SideWidgetState state_ = SideWidgetState::Closed;
  QVariantAnimation slideAnimation_;
  qreal animationProgress_ = 0.0;
  SideWidgetConfig config_;
};
