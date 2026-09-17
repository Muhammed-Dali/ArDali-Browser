#include "song_finder_settings.h"

#include <algorithm>

namespace {
constexpr char kGroup[] = "songFinder";
constexpr char kKeyOpenPlatform[] = "openPlatform";
constexpr char kKeySensitivityMode[] = "sensitivityMode";
constexpr char kKeyRequestInterval[] = "requestIntervalSecs";
constexpr char kKeyBufferSize[] = "bufferSizeSecs";
constexpr char kKeyNoDuplicates[] = "noDuplicates";
constexpr char kKeyWebMetadataFallback[] = "webMetadataFallback";
constexpr char kKeyAutoStopOnResult[] = "autoStopOnResult";
constexpr char kKeyAutoOpenOnResult[] = "autoOpenOnResult";
constexpr char kKeyAutoPruneHistory[] = "autoPruneHistory";
constexpr char kKeyRememberAudioDevice[] = "rememberAudioDevice";
constexpr char kKeySavedDeviceId[] = "savedDeviceId";
}  // namespace

SongFinderSettings::SongFinderSettings(QObject *parent) : QObject(parent) {
  load();
}

void SongFinderSettings::setOpenPlatform(OpenPlatform platform) {
  if (openPlatform_ == platform) return;
  openPlatform_ = platform;
  emit settingsChanged();
}

void SongFinderSettings::setSensitivityMode(SensitivityMode mode) {
  if (sensitivityMode_ == mode) return;
  sensitivityMode_ = mode;
  switch (mode) {
    case SensitivityMode::Normal:
      requestIntervalSecs_ = 8;
      bufferSizeSecs_ = 10;
      break;
    case SensitivityMode::Background:
      requestIntervalSecs_ = 6;
      bufferSizeSecs_ = 12;
      break;
    case SensitivityMode::MaxAccuracy:
      requestIntervalSecs_ = 6;
      bufferSizeSecs_ = 16;
      break;
    case SensitivityMode::Custom:
      break;
  }
  emit settingsChanged();
}

void SongFinderSettings::setRequestIntervalSecs(int seconds) {
  const int clamped = std::clamp(seconds, 1, 120);
  if (requestIntervalSecs_ == clamped) return;
  requestIntervalSecs_ = clamped;
  sensitivityMode_ = SensitivityMode::Custom;
  emit settingsChanged();
}

void SongFinderSettings::setBufferSizeSecs(int seconds) {
  const int clamped = std::clamp(seconds, 4, 30);
  if (bufferSizeSecs_ == clamped) return;
  bufferSizeSecs_ = clamped;
  sensitivityMode_ = SensitivityMode::Custom;
  emit settingsChanged();
}

void SongFinderSettings::setNoDuplicates(bool enabled) {
  if (noDuplicates_ == enabled) return;
  noDuplicates_ = enabled;
  emit settingsChanged();
}

void SongFinderSettings::setWebMetadataFallback(bool enabled) {
  if (webMetadataFallback_ == enabled) return;
  webMetadataFallback_ = enabled;
  emit settingsChanged();
}

void SongFinderSettings::setAutoStopOnResult(bool enabled) {
  if (autoStopOnResult_ == enabled) return;
  autoStopOnResult_ = enabled;
  emit settingsChanged();
}

void SongFinderSettings::setAutoOpenOnResult(bool enabled) {
  if (autoOpenOnResult_ == enabled) return;
  autoOpenOnResult_ = enabled;
  emit settingsChanged();
}

void SongFinderSettings::setAutoPruneHistory(bool enabled) {
  if (autoPruneHistory_ == enabled) return;
  autoPruneHistory_ = enabled;
  emit settingsChanged();
}

void SongFinderSettings::setRememberAudioDevice(bool enabled) {
  if (rememberAudioDevice_ == enabled) return;
  rememberAudioDevice_ = enabled;
  emit settingsChanged();
}

void SongFinderSettings::setSavedDeviceId(const QString &deviceId) {
  if (savedDeviceId_ == deviceId) return;
  savedDeviceId_ = deviceId;
  emit settingsChanged();
}

void SongFinderSettings::load() {
  QSettings settings;
  settings.beginGroup(QString::fromLatin1(kGroup));
  openPlatform_ = stringToPlatform(settings.value(QString::fromLatin1(kKeyOpenPlatform), QStringLiteral("youtube")).toString());
  sensitivityMode_ = stringToSensitivity(settings.value(QString::fromLatin1(kKeySensitivityMode), QStringLiteral("background")).toString());
  requestIntervalSecs_ = std::clamp(settings.value(QString::fromLatin1(kKeyRequestInterval), 6).toInt(), 1, 120);
  bufferSizeSecs_ = std::clamp(settings.value(QString::fromLatin1(kKeyBufferSize), 12).toInt(), 4, 30);
  noDuplicates_ = settings.value(QString::fromLatin1(kKeyNoDuplicates), true).toBool();
  webMetadataFallback_ = settings.value(QString::fromLatin1(kKeyWebMetadataFallback), true).toBool();
  autoStopOnResult_ = settings.value(QString::fromLatin1(kKeyAutoStopOnResult), true).toBool();
  autoOpenOnResult_ = settings.value(QString::fromLatin1(kKeyAutoOpenOnResult), false).toBool();
  autoPruneHistory_ = settings.value(QString::fromLatin1(kKeyAutoPruneHistory), true).toBool();
  rememberAudioDevice_ = settings.value(QString::fromLatin1(kKeyRememberAudioDevice), true).toBool();
  savedDeviceId_ = settings.value(QString::fromLatin1(kKeySavedDeviceId), QString()).toString();
  settings.endGroup();
}

void SongFinderSettings::save() {
  QSettings settings;
  settings.beginGroup(QString::fromLatin1(kGroup));
  settings.setValue(QString::fromLatin1(kKeyOpenPlatform), platformToString(openPlatform_));
  settings.setValue(QString::fromLatin1(kKeySensitivityMode), sensitivityToString(sensitivityMode_));
  settings.setValue(QString::fromLatin1(kKeyRequestInterval), requestIntervalSecs_);
  settings.setValue(QString::fromLatin1(kKeyBufferSize), bufferSizeSecs_);
  settings.setValue(QString::fromLatin1(kKeyNoDuplicates), noDuplicates_);
  settings.setValue(QString::fromLatin1(kKeyWebMetadataFallback), webMetadataFallback_);
  settings.setValue(QString::fromLatin1(kKeyAutoStopOnResult), autoStopOnResult_);
  settings.setValue(QString::fromLatin1(kKeyAutoOpenOnResult), autoOpenOnResult_);
  settings.setValue(QString::fromLatin1(kKeyAutoPruneHistory), autoPruneHistory_);
  settings.setValue(QString::fromLatin1(kKeyRememberAudioDevice), rememberAudioDevice_);
  settings.setValue(QString::fromLatin1(kKeySavedDeviceId), savedDeviceId_);
  settings.endGroup();
  settings.sync();
}

void SongFinderSettings::resetToDefaults() {
  openPlatform_ = OpenPlatform::YouTube;
  sensitivityMode_ = SensitivityMode::Background;
  requestIntervalSecs_ = 6;
  bufferSizeSecs_ = 12;
  noDuplicates_ = true;
  webMetadataFallback_ = true;
  autoStopOnResult_ = true;
  autoOpenOnResult_ = false;
  autoPruneHistory_ = true;
  rememberAudioDevice_ = true;
  savedDeviceId_.clear();
  save();
  emit settingsChanged();
}

QString SongFinderSettings::platformToString(OpenPlatform platform) {
  switch (platform) {
    case OpenPlatform::YouTubeMusic:
      return QStringLiteral("ytmusic");
    case OpenPlatform::YouTube:
    default:
      return QStringLiteral("youtube");
  }
}

SongFinderSettings::OpenPlatform SongFinderSettings::stringToPlatform(const QString &str) {
  if (str.compare(QStringLiteral("ytmusic"), Qt::CaseInsensitive) == 0 ||
      str.compare(QStringLiteral("youtube-music"), Qt::CaseInsensitive) == 0) {
    return OpenPlatform::YouTubeMusic;
  }
  return OpenPlatform::YouTube;
}

QString SongFinderSettings::sensitivityToString(SensitivityMode mode) {
  switch (mode) {
    case SensitivityMode::Normal:
      return QStringLiteral("normal");
    case SensitivityMode::MaxAccuracy:
      return QStringLiteral("max");
    case SensitivityMode::Custom:
      return QStringLiteral("custom");
    case SensitivityMode::Background:
    default:
      return QStringLiteral("background");
  }
}

SongFinderSettings::SensitivityMode SongFinderSettings::stringToSensitivity(const QString &str) {
  if (str.compare(QStringLiteral("normal"), Qt::CaseInsensitive) == 0) {
    return SensitivityMode::Normal;
  }
  if (str.compare(QStringLiteral("max"), Qt::CaseInsensitive) == 0 ||
      str.compare(QStringLiteral("maxAccuracy"), Qt::CaseInsensitive) == 0) {
    return SensitivityMode::MaxAccuracy;
  }
  if (str.compare(QStringLiteral("custom"), Qt::CaseInsensitive) == 0) {
    return SensitivityMode::Custom;
  }
  return SensitivityMode::Background;
}
