#pragma once

#include "song_finder_settings.h"
#include "song_recognition_service.h"

#include <QFrame>
#include <QIcon>
#include <QPainter>
#include <QToolButton>
#include <QUrl>

class BigListenButton;
class QLabel;
class QNetworkAccessManager;
class QProgressBar;
class QPushButton;
class QScrollArea;
class QVBoxLayout;

class PulseResultCard final : public QFrame {
  Q_OBJECT
 public:
  explicit PulseResultCard(const SongResult &result,
                           SongFinderSettings::OpenPlatform platform,
                           QWidget *parent = nullptr);
  ~PulseResultCard() override = default;

  const SongResult &result() const { return result_; }

 signals:
  void clicked(const SongResult &result);

 protected:
  void mousePressEvent(QMouseEvent *event) override;
  void mouseReleaseEvent(QMouseEvent *event) override;
  void enterEvent(QEnterEvent *event) override;
  void leaveEvent(QEvent *event) override;

 private:
  SongResult result_;
  bool isPressed_ = false;
  bool isHovered_ = false;
};

class PulseQuickPopup final : public QFrame {
  Q_OBJECT
 public:
  explicit PulseQuickPopup(SongRecognitionService *service,
                           SongFinderSettings *settings,
                           QWidget *parent = nullptr);
  ~PulseQuickPopup() override = default;

  void refreshState();
  static QUrl buildSearchUrl(SongFinderSettings::OpenPlatform platform, const QString &query);

 signals:
  void openUrlRequested(const QUrl &url);
  void openFullPageRequested();
  void openSettingsRequested();

 protected:
  void showEvent(QShowEvent *event) override;
  void hideEvent(QHideEvent *event) override;

 private slots:
  void onListenButtonClicked();
  void onServiceStateChanged(SongRecognitionService::State state, const QString &message);
  void onServiceVolumeChanged(double levelPercent, double bufferFillPercent, const QString &activeSourceName);
  void onServiceSongFound(const SongResult &result);
  void onResultCardClicked(const SongResult &result);

 private:
  void setupUi();
  void updateResultsList();

  SongRecognitionService *service_ = nullptr;
  SongFinderSettings *settings_ = nullptr;

  QLabel *titleLabel_ = nullptr;
  QLabel *statusLabel_ = nullptr;
  QPushButton *settingsBtn_ = nullptr;
  QProgressBar *signalBar_ = nullptr;
  BigListenButton *listenBtn_ = nullptr;

  QScrollArea *resultsScroll_ = nullptr;
  QWidget *resultsContainer_ = nullptr;
  QVBoxLayout *resultsLayout_ = nullptr;
  QLabel *emptyLabel_ = nullptr;
  QPushButton *openFullBtn_ = nullptr;
};

class PulseToolbarButton final : public QToolButton {
  Q_OBJECT
 public:
  explicit PulseToolbarButton(SongRecognitionService *service,
                              SongFinderSettings *settings,
                              QWidget *parent = nullptr);
  ~PulseToolbarButton() override = default;

 signals:
  void openUrlRequested(const QUrl &url);
  void openFullPageRequested();
  void openSettingsRequested();

 protected:
  void paintEvent(QPaintEvent *event) override;

 private slots:
  void toggleQuickPopup();
  void onServiceStateChanged(SongRecognitionService::State state, const QString &message);
  void onAnimTick();

 private:
  void showQuickPopup();

  SongRecognitionService *service_ = nullptr;
  SongFinderSettings *settings_ = nullptr;
  PulseQuickPopup *popup_ = nullptr;
  QTimer *animTimer_ = nullptr;
  double animPhase_ = 0.0;
  qint64 lastClosedMs_ = 0;
};
