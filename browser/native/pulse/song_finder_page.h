#pragma once

#include "song_recognition_service.h"

#include <QIcon>
#include <QUrl>
#include <QWidget>

class BigListenButton;
class QComboBox;
class QFrame;
class QLabel;
class QMenu;
class QProgressBar;
class QPushButton;
class QScrollArea;
class QVBoxLayout;

class SongFinderPage final : public QWidget {
  Q_OBJECT

 public:
  explicit SongFinderPage(SongRecognitionService *service, QWidget *parent = nullptr);
  ~SongFinderPage() override;

 signals:
  void openPreferencesRequested();
  void openUrlRequested(const QUrl &url);

 private slots:
  void onBigListenButtonClicked();
  void onRefreshDevicesClicked();
  void onDeviceSelectionChanged(int index);
  void onServiceStateChanged(SongRecognitionService::State state, const QString &message);
  void onServiceVolumeChanged(double levelPercent, double bufferFillPercent, const QString &activeSourceName);
  void onServiceSongFound(const SongResult &result);
  void onServiceDevicesUpdated(const QVector<AudioDeviceInfo> &devices, const AutoRouteInfo &route);
  void onAutoOpenRequested(const SongResult &result, SongFinderSettings::OpenPlatform platform);

 private:
  void setupUi();
  void updateDeviceList(const QVector<AudioDeviceInfo> &devices, const AutoRouteInfo &route);
  void addResultCard(const SongResult &result);
  void showActiveResult(const SongResult &result);
  void hideActiveResult();
  void setListExpanded(bool expanded);
  void updateHistoryListHeader();
  void toggleMenuPopup();
  void showAboutDialog();
  QUrl buildSearchUrl(SongFinderSettings::OpenPlatform platform, const QString &query) const;

  SongRecognitionService *service_ = nullptr;

  QLabel *statusLabel_ = nullptr;
  QPushButton *menuBtn_ = nullptr;
  class PulseMenuPopup *menuPopup_ = nullptr;
  QLabel *signalTitle_ = nullptr;
  QProgressBar *signalBar_ = nullptr;

  BigListenButton *listenBtn_ = nullptr;
  QLabel *stateTitle_ = nullptr;
  QLabel *stateSub_ = nullptr;

  // Active Found Song Card (hero result)
  QFrame *activeCard_ = nullptr;
  QLabel *activeCoverLabel_ = nullptr;
  QLabel *activeTitleLabel_ = nullptr;
  QLabel *activeArtistLabel_ = nullptr;
  QLabel *activeMetaLabel_ = nullptr;
  QPushButton *activeYtBtn_ = nullptr;
  QPushButton *activeYtmBtn_ = nullptr;
  QPushButton *activeDismissBtn_ = nullptr;
  SongResult currentActiveResult_;
  bool hasActiveResult_ = false;

  // Found Results History List & Toggle Button
  QPushButton *listToggleBtn_ = nullptr;
  QWidget *resultsContainer_ = nullptr;
  QVBoxLayout *resultsLayout_ = nullptr;
  QWidget *resultsHeaderWidget_ = nullptr;
  QLabel *resultsTitleLabel_ = nullptr;
  QLabel *emptyResultsLabel_ = nullptr;
  QPushButton *clearAllBtn_ = nullptr;
  bool isListExpanded_ = false;

  QComboBox *deviceCombo_ = nullptr;
  QPushButton *refreshBtn_ = nullptr;
  QLabel *hintLabel_ = nullptr;

  bool updatingDevices_ = false;
  AutoRouteInfo currentRoute_;
};
