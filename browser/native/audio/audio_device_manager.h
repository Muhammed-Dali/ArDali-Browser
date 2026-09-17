#pragma once

#include <QObject>
#include <QPair>
#include <QString>
#include <QVector>

enum class AudioDeviceType {
  Monitor,
  Microphone,
  Other
};

struct AudioDeviceInfo {
  QString id;
  QString label;
  QString driver;
  QString cardBusId;
  QString cardName;
  QString monitorOfSink;
  AudioDeviceType type = AudioDeviceType::Other;
  bool isDefault = false;
  bool isDefaultMonitor = false;
  bool isMonitor = false;
  bool isAvailable = true;
  int channelCount = 2;

  QString displayTitle() const {
    QString title = label.isEmpty() ? id : label;
    if (isDefaultMonitor) {
      return QStringLiteral("%1 [Sistem Sesi / Monitör]").arg(title);
    }
    if (isMonitor) {
      return QStringLiteral("%1 [Monitör]").arg(title);
    }
    if (isDefault) {
      return QStringLiteral("%1 [Varsayılan Mikrofon]").arg(title);
    }
    return title;
  }
};

struct AutoRouteInfo {
  QString systemMonitorId;
  QString systemMonitorLabel;
  QString microphoneId;
  QString microphoneLabel;
  QString activeSinkName;
  QString cardName;
  bool hasSystemMonitor = false;
  bool hasMicrophone = false;

  QString summaryDescription() const {
    if (hasSystemMonitor && hasMicrophone) {
      if (!cardName.isEmpty()) {
        return QStringLiteral("Aktif: %1 (Sistem sesi + mikrofon)").arg(cardName);
      }
      return QStringLiteral("Aktif: %1 + %2").arg(
          systemMonitorLabel.isEmpty() ? QStringLiteral("Sistem Sesi") : systemMonitorLabel,
          microphoneLabel.isEmpty() ? QStringLiteral("Mikrofon") : microphoneLabel);
    }
    if (hasSystemMonitor) {
      return QStringLiteral("Aktif: %1 (Sistem sesi)").arg(systemMonitorLabel);
    }
    if (hasMicrophone) {
      return QStringLiteral("Aktif: %1 (Mikrofon)").arg(microphoneLabel);
    }
    return QStringLiteral("Aktif: Varsayılan ses cihazı");
  }
};

class QTimer;

class AudioDeviceManager final : public QObject {
  Q_OBJECT

 public:
  explicit AudioDeviceManager(QObject *parent = nullptr);
  ~AudioDeviceManager() override;

  QVector<AudioDeviceInfo> listDevices();
  AutoRouteInfo resolveAutoRoute(const QVector<AudioDeviceInfo> &devices);
  QString pickBestDeviceId(const QVector<AudioDeviceInfo> &devices, const QString &preferredId = QString()) const;
  void startMonitoring();
  void stopMonitoring();
  bool isMonitoring() const;
  quint64 pollCheckCount() const { return pollCheckCount_; }
  quint64 processLaunchCount() const { return processLaunchCount_; }

 signals:
  void devicesChanged(const QVector<AudioDeviceInfo> &devices, const AutoRouteInfo &route);

 private slots:
  void checkDeviceChanges();

 private:
  QString executeCommand(const QStringList &arguments, int timeoutMs = 2500) const;
  QPair<QString, QString> queryDefaultPulseRoute() const;

  QTimer *pollTimer_ = nullptr;
  QString lastDefaultSink_;
  QString lastDefaultSource_;
  QString pactlPath_;
  quint64 pollCheckCount_ = 0;
  mutable quint64 processLaunchCount_ = 0;
};
