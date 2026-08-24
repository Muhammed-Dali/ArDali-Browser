#pragma once

#include "side_widget_config.h"

#include <QCheckBox>
#include <QComboBox>
#include <QFrame>
#include <QLabel>

class SideWidgetSettingsPanel final : public QFrame {
  Q_OBJECT

 public:
  explicit SideWidgetSettingsPanel(QWidget *parent = nullptr);
  ~SideWidgetSettingsPanel() override = default;

  void setConfig(const SideWidgetConfig &config);
  SideWidgetConfig config() const;
  void setOverlapWarning(bool hasOverlap);

 signals:
  void configChanged(const SideWidgetConfig &newConfig);
  void previewRequested();
  void resetRequested();
  void closeRequested();

 protected:
  void keyPressEvent(QKeyEvent *event) override;

 private:
  void buildUi();
  void updateUiFromConfig();
  void emitConfigChanged();

  SideWidgetConfig config_;
  bool isUpdatingUi_ = false;
  QComboBox *speedProfile_ = nullptr;
  QComboBox *buttonSize_ = nullptr;
  QCheckBox *animationsEnabled_ = nullptr;
  QLabel *overlapWarningLabel_ = nullptr;
};
