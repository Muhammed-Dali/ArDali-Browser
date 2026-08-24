#pragma once

#include "song_finder_settings.h"

#include <QWidget>

class QCheckBox;
class QComboBox;
class QPushButton;
class QSpinBox;

class SongFinderSettingsPage final : public QWidget {
  Q_OBJECT

 public:
  explicit SongFinderSettingsPage(SongFinderSettings *settings, QWidget *parent = nullptr);

 signals:
  void closeTabRequested();

 private slots:
  void onSaveClicked();
  void onDefaultsClicked();
  void onCancelClicked();
  void onSensitivityModeChanged(int index);
  void onIntervalOrBufferChanged();

 private:
  void setupUi();
  void loadFormValues();

  SongFinderSettings *settings_ = nullptr;

  QComboBox *platformCombo_ = nullptr;
  QComboBox *sensitivityCombo_ = nullptr;
  QSpinBox *requestIntervalSpin_ = nullptr;
  QSpinBox *bufferSizeSpin_ = nullptr;

  QCheckBox *noDuplicatesCheck_ = nullptr;
  QCheckBox *webFallbackCheck_ = nullptr;
  QCheckBox *autoStopCheck_ = nullptr;
  QCheckBox *autoOpenCheck_ = nullptr;
  QCheckBox *rememberDeviceCheck_ = nullptr;

  QPushButton *cancelBtn_ = nullptr;
  QPushButton *defaultsBtn_ = nullptr;
  QPushButton *saveBtn_ = nullptr;

  bool updatingForm_ = false;
};
