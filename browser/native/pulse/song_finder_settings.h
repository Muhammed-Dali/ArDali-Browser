#pragma once

#include <QObject>
#include <QSettings>
#include <QString>

class SongFinderSettings final : public QObject {
  Q_OBJECT

 public:
  enum class SensitivityMode {
    Normal,       // 8s interval, 10s buffer
    Background,   // 6s interval, 12s buffer (Default)
    MaxAccuracy,  // 6s interval, 16s buffer
    Custom
  };

  enum class OpenPlatform {
    YouTube,
    YouTubeMusic
  };

  explicit SongFinderSettings(QObject *parent = nullptr);

  // Getters
  OpenPlatform openPlatform() const { return openPlatform_; }
  SensitivityMode sensitivityMode() const { return sensitivityMode_; }
  int requestIntervalSecs() const { return requestIntervalSecs_; }
  int bufferSizeSecs() const { return bufferSizeSecs_; }
  bool noDuplicates() const { return noDuplicates_; }
  bool webMetadataFallback() const { return webMetadataFallback_; }
  bool autoStopOnResult() const { return autoStopOnResult_; }
  bool autoOpenOnResult() const { return autoOpenOnResult_; }
  bool autoPruneHistory() const { return autoPruneHistory_; }
  bool rememberAudioDevice() const { return rememberAudioDevice_; }
  QString savedDeviceId() const { return savedDeviceId_; }

  // Setters
  void setOpenPlatform(OpenPlatform platform);
  void setSensitivityMode(SensitivityMode mode);
  void setRequestIntervalSecs(int seconds);
  void setBufferSizeSecs(int seconds);
  void setNoDuplicates(bool enabled);
  void setWebMetadataFallback(bool enabled);
  void setAutoStopOnResult(bool enabled);
  void setAutoOpenOnResult(bool enabled);
  void setAutoPruneHistory(bool enabled);
  void setRememberAudioDevice(bool enabled);
  void setSavedDeviceId(const QString &deviceId);

  // Batch operations
  void load();
  void save();
  void resetToDefaults();

  // Helper conversions
  static QString platformToString(OpenPlatform platform);
  static OpenPlatform stringToPlatform(const QString &str);
  static QString sensitivityToString(SensitivityMode mode);
  static SensitivityMode stringToSensitivity(const QString &str);

 signals:
  void settingsChanged();

 private:
  OpenPlatform openPlatform_ = OpenPlatform::YouTube;
  SensitivityMode sensitivityMode_ = SensitivityMode::Background;
  int requestIntervalSecs_ = 6;
  int bufferSizeSecs_ = 12;
  bool noDuplicates_ = true;
  bool webMetadataFallback_ = true;
  bool autoStopOnResult_ = true;
  bool autoOpenOnResult_ = false;
  bool autoPruneHistory_ = true;
  bool rememberAudioDevice_ = true;
  QString savedDeviceId_;
};
