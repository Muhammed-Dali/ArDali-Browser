#pragma once

#include "song_fingerprint.h"

#include <QDateTime>
#include <QObject>
#include <QProcess>
#include <QString>
#include <QTimer>

class AudioCaptureService final : public QObject {
  Q_OBJECT

 public:
  enum class ActiveSourceType {
    SystemAudio,
    Microphone,
    Manual
  };

  explicit AudioCaptureService(QObject *parent = nullptr);
  ~AudioCaptureService() override;

  bool start(const QString &deviceId, int bufferSizeSecs = 12);
  bool startAuto(const QString &systemMonitorId, const QString &microphoneId, int bufferSizeSecs = 12);
  void stop();

  void updateAutoRoute(const QString &systemMonitorId, const QString &microphoneId);

  bool isRunning() const;
  bool isAutoMode() const { return isAutoMode_; }
  QString currentDeviceId() const { return currentDeviceId_; }
  ActiveSourceType activeSourceType() const { return activeSourceType_; }
  QString activeSourceName() const;

  SlidingPcmBuffer &buffer() { return activeBuffer(); }
  const SlidingPcmBuffer &buffer() const { return activeBuffer(); }

  SlidingPcmBuffer &activeBuffer();
  const SlidingPcmBuffer &activeBuffer() const;
  SlidingPcmBuffer &systemBuffer() { return systemBuffer_; }
  SlidingPcmBuffer &micBuffer() { return micBuffer_; }

 signals:
  void started(const QString &deviceId);
  void stopped();
  void errorOccurred(const QString &error);
  void volumeChanged(double levelPercent, double bufferFillPercent, AudioCaptureService::ActiveSourceType sourceType, const QString &sourceName);

 private slots:
  void onSystemReadyRead();
  void onMicReadyRead();
  void onLevelTimerTimeout();

 private:
  QProcess *spawnFfmpegProcess(const QString &deviceId);
  void stopProcess(QProcess *&proc);

  bool isAutoMode_ = false;
  QString currentDeviceId_;
  QString systemMonitorId_;
  QString microphoneId_;

  QProcess *systemProcess_ = nullptr;
  QProcess *micProcess_ = nullptr;

  SlidingPcmBuffer systemBuffer_;
  SlidingPcmBuffer micBuffer_;

  ActiveSourceType activeSourceType_ = ActiveSourceType::SystemAudio;
  qint64 holdSystemUntilMs_ = 0;
  qint64 holdMicUntilMs_ = 0;

  QTimer *levelTimer_ = nullptr;
  int bufferSizeSecs_ = 12;
};
