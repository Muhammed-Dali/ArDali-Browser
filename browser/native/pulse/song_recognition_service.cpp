#include "song_recognition_service.h"

#include <QDateTime>
#include <QDebug>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QUrl>
#include <QUuid>
#include <QtConcurrent>

namespace {
constexpr qint64 kWebContextTtlMs = 2 * 60 * 1000;     // 2 minutes
}  // namespace

SongRecognitionService::SongRecognitionService(SongFinderSettings *settings, QObject *parent)
    : QObject(parent), settings_(settings ? settings : new SongFinderSettings(this)) {
  captureService_ = new AudioCaptureService(this);
  deviceManager_ = new AudioDeviceManager(this);
  networkManager_ = new QNetworkAccessManager(this);

  recognitionTimer_ = new QTimer(this);
  recognitionTimer_->setInterval(settings_->requestIntervalSecs() * 1000);

  connect(captureService_, &AudioCaptureService::volumeChanged, this, &SongRecognitionService::onCaptureVolumeChanged);
  connect(captureService_, &AudioCaptureService::errorOccurred, this, &SongRecognitionService::onCaptureError);
  connect(recognitionTimer_, &QTimer::timeout, this, &SongRecognitionService::onRecognitionTimerTimeout);
  connect(deviceManager_, &AudioDeviceManager::devicesChanged, this, &SongRecognitionService::onDeviceManagerChanges);

  connect(settings_, &SongFinderSettings::settingsChanged, this, [this] {
    if (recognitionTimer_) {
      recognitionTimer_->setInterval(settings_->requestIntervalSecs() * 1000);
    }
  });

  loadHistory();
  QTimer::singleShot(0, this, [this] { refreshDevices(); });
}

SongRecognitionService::~SongRecognitionService() {
  stopListening();
  saveHistory();
}

void SongRecognitionService::loadHistory() {
  QSettings s(QStringLiteral("ArDali"), QStringLiteral("SongFinderHistory"));
  const int count = s.beginReadArray(QStringLiteral("history"));
  history_.clear();
  recentTrackKeys_.clear();
  for (int i = 0; i < count; ++i) {
    s.setArrayIndex(i);
    SongResult res;
    res.title = s.value(QStringLiteral("title")).toString();
    res.artist = s.value(QStringLiteral("artist")).toString();
    res.album = s.value(QStringLiteral("album")).toString();
    res.genre = s.value(QStringLiteral("genre")).toString();
    res.coverUrl = s.value(QStringLiteral("coverUrl")).toString();
    res.trackKey = s.value(QStringLiteral("trackKey")).toString();
    res.source = static_cast<SongResult::Source>(s.value(QStringLiteral("source"), 0).toInt());
    res.timestamp = s.value(QStringLiteral("timestamp")).toDateTime();
    if (res.isValid()) {
      history_.append(res);
      recentTrackKeys_.insert(res.dedupeKey(), res.timestamp.toMSecsSinceEpoch());
    }
  }
  s.endArray();
}

void SongRecognitionService::saveHistory() {
  QSettings s(QStringLiteral("ArDali"), QStringLiteral("SongFinderHistory"));
  s.beginWriteArray(QStringLiteral("history"), history_.size());
  for (int i = 0; i < history_.size(); ++i) {
    s.setArrayIndex(i);
    const auto &res = history_.at(i);
    s.setValue(QStringLiteral("title"), res.title);
    s.setValue(QStringLiteral("artist"), res.artist);
    s.setValue(QStringLiteral("album"), res.album);
    s.setValue(QStringLiteral("genre"), res.genre);
    s.setValue(QStringLiteral("coverUrl"), res.coverUrl);
    s.setValue(QStringLiteral("trackKey"), res.trackKey);
    s.setValue(QStringLiteral("source"), static_cast<int>(res.source));
    s.setValue(QStringLiteral("timestamp"), res.timestamp);
  }
  s.endArray();
  s.sync();
}

bool SongRecognitionService::isListening() const {
  return captureService_ && captureService_->isRunning();
}

QString SongRecognitionService::currentDeviceId() const {
  return captureService_ ? captureService_->currentDeviceId() : QString();
}

QVector<AudioDeviceInfo> SongRecognitionService::refreshDevices() {
  cachedDevices_ = deviceManager_->listDevices();
  currentRoute_ = deviceManager_->resolveAutoRoute(cachedDevices_);
  emit devicesUpdated(cachedDevices_, currentRoute_);
  return cachedDevices_;
}

void SongRecognitionService::dismissActiveResult() {
  hasActiveResult_ = false;
  activeResult_ = SongResult();
  emit activeResultChanged(SongResult(), false);
}

void SongRecognitionService::clearActiveResult() {
  hasActiveResult_ = false;
  activeResult_ = SongResult();
  emit activeResultChanged(SongResult(), false);
}

void SongRecognitionService::removeHistoryItem(const QString &dedupeKey) {
  if (dedupeKey.isEmpty()) return;
  for (int i = 0; i < history_.size(); ++i) {
    if (history_[i].dedupeKey() == dedupeKey ||
        history_[i].trackKey == dedupeKey) {
      history_.removeAt(i);
      break;
    }
  }
  recentTrackKeys_.remove(dedupeKey);
  if (hasActiveResult_ && (activeResult_.dedupeKey() == dedupeKey || activeResult_.trackKey == dedupeKey)) {
    dismissActiveResult();
  }
  saveHistory();
}

void SongRecognitionService::clearHistory() {
  history_.clear();
  recentTrackKeys_.clear();
  dismissActiveResult();
  saveHistory();
}

void SongRecognitionService::onDeviceManagerChanges(const QVector<AudioDeviceInfo> &devices, const AutoRouteInfo &route) {
  cachedDevices_ = devices;
  currentRoute_ = route;
  emit devicesUpdated(cachedDevices_, currentRoute_);

  if (isListening() && captureService_->isAutoMode()) {
    captureService_->updateAutoRoute(route.systemMonitorId, route.microphoneId);
  }
}

void SongRecognitionService::setWebContextMetadata(const QString &title, const QString &artist) {
  webContextTitle_ = title.trimmed();
  webContextArtist_ = artist.trimmed();
  webContextUpdatedAt_ = QDateTime::currentMSecsSinceEpoch();
}

void SongRecognitionService::clearWebContextMetadata() {
  webContextTitle_.clear();
  webContextArtist_.clear();
  webContextUpdatedAt_ = 0;
}

bool SongRecognitionService::startListening(const QString &requestedDeviceId) {
  if (cachedDevices_.isEmpty()) {
    refreshDevices();
  }

  QString targetDeviceId = requestedDeviceId.trimmed();
  if (targetDeviceId.isEmpty()) {
    if (settings_->rememberAudioDevice() && !settings_->savedDeviceId().isEmpty()) {
      targetDeviceId = settings_->savedDeviceId();
    } else {
      targetDeviceId = QStringLiteral("auto");
    }
  }

  const bool isAuto = (targetDeviceId.isEmpty() || targetDeviceId == QStringLiteral("auto") || targetDeviceId.startsWith(QStringLiteral("auto:")));

  ++currentSessionId_;
  sessionStartedAt_ = QDateTime::currentMSecsSinceEpoch();
  clearWebContextMetadata();
  consecutiveNoSignal_ = 0;
  consecutiveNoMatch_ = 0;
  isProcessing_ = false;

  const int bufferSecs = settings_->bufferSizeSecs();
  bool started = false;

  if (isAuto) {
    currentRoute_ = deviceManager_->resolveAutoRoute(cachedDevices_);
    started = captureService_->startAuto(currentRoute_.systemMonitorId, currentRoute_.microphoneId, bufferSecs);
  } else {
    started = captureService_->start(targetDeviceId, bufferSecs);
  }

  if (!started) {
    setState(State::Error, QStringLiteral("Ses yakalama başlatılamadı."));
    return false;
  }

  if (settings_->rememberAudioDevice()) {
    settings_->setSavedDeviceId(targetDeviceId);
    settings_->save();
  }

  recognitionTimer_->setInterval(settings_->requestIntervalSecs() * 1000);
  recognitionTimer_->start();

  setState(State::Listening, QStringLiteral("Dinliyorum"));
  return true;
}

void SongRecognitionService::stopListening() {
  ++currentSessionId_;
  recognitionTimer_->stop();
  captureService_->stop();
  isProcessing_ = false;
  setState(State::Ready, QStringLiteral("Dinlemeye hazır"));
}

void SongRecognitionService::setState(State state, const QString &message) {
  state_ = state;
  stateMessage_ = message;
  emit stateChanged(state_, stateMessage_);
}

void SongRecognitionService::onCaptureVolumeChanged(double levelPercent, double bufferFillPercent, AudioCaptureService::ActiveSourceType sourceType, const QString &sourceName) {
  Q_UNUSED(sourceType);
  emit volumeChanged(levelPercent, bufferFillPercent, sourceName);
}

void SongRecognitionService::onCaptureError(const QString &error) {
  stopListening();
  setState(State::Error, error);
}

void SongRecognitionService::onRecognitionTimerTimeout() {
  if (!isListening() || isProcessing_) return;
  processBufferForRecognition();
}

void SongRecognitionService::processBufferForRecognition() {
  if (QDateTime::currentMSecsSinceEpoch() < backoffUntilMs_) {
    return;
  }

  auto &buffer = captureService_->activeBuffer();
  const int minSamples = 16000 * 4;  // at least 4 seconds
  if (buffer.filled() < minSamples) {
    return;
  }

  if (!buffer.hasSignal(0.0015f)) {
    consecutiveNoSignal_++;
    if (consecutiveNoSignal_ >= 3) {
      setState(State::Listening, QStringLiteral("Sinyal tespit edilemedi (sessiz)"));
    }
    return;
  }
  consecutiveNoSignal_ = 0;

  isProcessing_ = true;
  setState(State::Recognizing, QStringLiteral("Şarkı aranıyor"));

  const uint64_t sessionId = currentSessionId_;
  // Take snapshot of up to 14 seconds of audio from the clean active buffer
  const QVector<float> samples = buffer.snapshot(16000 * 14);

  // Run fingerprint generation in worker thread
  QThreadPool::globalInstance()->start([this, samples, sessionId]() {
    const FingerprintResult fpResult = SongFingerprint::createSignatureFromSamples(samples);

    QMetaObject::invokeMethod(this, [this, fpResult, sessionId]() {
      if (sessionId != currentSessionId_ || !isListening()) {
        isProcessing_ = false;
        return;
      }

      if (!fpResult.success) {
        isProcessing_ = false;
        setState(State::Listening, QStringLiteral("Dinliyorum"));
        return;
      }

      sendShazamRequest(fpResult.uri, fpResult.sampleMs);
    });
  });
}

void SongRecognitionService::sendShazamRequest(const QString &signatureUri, int sampleMs) {
  const uint64_t sessionId = currentSessionId_;
  const QString tagId1 = QUuid::createUuid().toString(QUuid::WithoutBraces).toUpper();
  const QString tagId2 = QUuid::createUuid().toString(QUuid::WithoutBraces).toLower();
  const QString endpoint = QStringLiteral(
      "https://amp.shazam.com/discovery/v5/en/US/android/-/tag/%1/%2"
      "?sync=true&webv3=true&sampling=true&connected=&shazamapiversion=v3&sharehub=true&video=v3")
      .arg(tagId1, tagId2);

  const qint64 timestamp = QDateTime::currentMSecsSinceEpoch();

  QJsonObject geoObj;
  geoObj.insert(QStringLiteral("altitude"), 300);
  geoObj.insert(QStringLiteral("latitude"), 45);
  geoObj.insert(QStringLiteral("longitude"), 2);

  QJsonObject sigObj;
  sigObj.insert(QStringLiteral("samplems"), std::max(1000, sampleMs));
  sigObj.insert(QStringLiteral("timestamp"), timestamp);
  sigObj.insert(QStringLiteral("uri"), signatureUri);

  QJsonObject rootObj;
  rootObj.insert(QStringLiteral("geolocation"), geoObj);
  rootObj.insert(QStringLiteral("signature"), sigObj);
  rootObj.insert(QStringLiteral("timestamp"), timestamp);
  rootObj.insert(QStringLiteral("timezone"), QStringLiteral("Europe/Istanbul"));

  const QByteArray payload = QJsonDocument(rootObj).toJson(QJsonDocument::Compact);

  QNetworkRequest request((QUrl(endpoint)));
  request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
  request.setRawHeader("Content-Language", "en_US");
  request.setRawHeader("User-Agent", "ArDali-Pulse/1.0");

  QNetworkReply *reply = networkManager_->post(request, payload);
  connect(reply, &QNetworkReply::finished, this, [this, reply, sessionId]() {
    reply->deleteLater();
    if (sessionId != currentSessionId_ || !isListening()) {
      isProcessing_ = false;
      return;
    }

    const int statusCode = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    const QByteArray data = reply->readAll();
    handleShazamResponse(data, statusCode);
  });
}

void SongRecognitionService::handleShazamResponse(const QByteArray &data, int statusCode) {
  isProcessing_ = false;

  if (statusCode == 429) {
    backoffUntilMs_ = QDateTime::currentMSecsSinceEpoch() + 90000;  // 90s backoff
    setState(State::Listening, QStringLiteral("İstek sınırı aşıldı, bekleniyor..."));
    return;
  }

  if (statusCode < 200 || statusCode >= 300) {
    setState(State::Listening, QStringLiteral("Dinliyorum"));
    return;
  }

  const QJsonDocument doc = QJsonDocument::fromJson(data);
  if (!doc.isObject()) {
    setState(State::Listening, QStringLiteral("Dinliyorum"));
    return;
  }

  const QJsonObject root = doc.object();
  const QJsonObject track = root.value(QStringLiteral("track")).toObject();

  SongResult result;
  if (!track.isEmpty()) {
    result.title = track.value(QStringLiteral("title")).toString().trimmed();
    result.artist = track.value(QStringLiteral("subtitle")).toString().trimmed();
    result.trackKey = track.value(QStringLiteral("key")).toString().trimmed();
    result.source = SongResult::Source::Shazam;

    const QJsonObject images = track.value(QStringLiteral("images")).toObject();
    result.coverUrl = images.value(QStringLiteral("coverarthq")).toString();
    if (result.coverUrl.isEmpty()) {
      result.coverUrl = images.value(QStringLiteral("coverart")).toString();
    }
    if (result.coverUrl.isEmpty()) {
      result.coverUrl = images.value(QStringLiteral("background")).toString();
    }
    if (result.coverUrl.isEmpty()) {
      result.coverUrl = track.value(QStringLiteral("share")).toObject().value(QStringLiteral("image")).toString();
    }
    if (result.coverUrl.isEmpty()) {
      result.coverUrl = track.value(QStringLiteral("hub")).toObject().value(QStringLiteral("image")).toString();
    }

    const QJsonObject genres = track.value(QStringLiteral("genres")).toObject();
    result.genre = genres.value(QStringLiteral("primary")).toString();
  }

  if (result.isValid()) {
    consecutiveNoMatch_ = 0;
    const bool duplicate = isDuplicate(result);
    rememberResult(result);

    if (!settings_->noDuplicates() || !duplicate) {
      history_.prepend(result);
      if (settings_->autoPruneHistory()) {
        while (history_.size() > 10) {
          history_.removeLast();
        }
      }
      saveHistory();
      hasActiveResult_ = true;
      activeResult_ = result;
      emit activeResultChanged(activeResult_, true);
      // FIRST emit songFound so UI has card in list before state becomes Found
      emit songFound(result);
      setState(State::Found, QStringLiteral("Şarkı bulundu: %1 - %2").arg(result.artist, result.title));

      if (settings_->autoOpenOnResult()) {
        emit autoOpenRequested(result, settings_->openPlatform());
      }

      if (settings_->autoStopOnResult()) {
        stopListening();
      }
    } else {
      setState(State::Listening, QStringLiteral("Aynı şarkı tekrar bulundu (atlandı)"));
    }
  } else {
    consecutiveNoMatch_++;

    // Strict Web tab metadata fallback validation
    const qint64 now = QDateTime::currentMSecsSinceEpoch();
    if (settings_->webMetadataFallback() &&
        consecutiveNoMatch_ >= 3 &&
        (webContextUpdatedAt_ >= sessionStartedAt_) &&
        (now - webContextUpdatedAt_ < kWebContextTtlMs) &&
        (!webContextTitle_.isEmpty() && !webContextArtist_.isEmpty())) {
      SongResult fallbackResult;
      fallbackResult.title = webContextTitle_;
      fallbackResult.artist = webContextArtist_;
      fallbackResult.genre = QStringLiteral("Web Medya");
      fallbackResult.source = SongResult::Source::WebMetadata;

      if (fallbackResult.isValid()) {
        const bool duplicate = isDuplicate(fallbackResult);
        rememberResult(fallbackResult);

        if (!settings_->noDuplicates() || !duplicate) {
          history_.prepend(fallbackResult);
          if (settings_->autoPruneHistory()) {
            while (history_.size() > 10) {
              history_.removeLast();
            }
          }
          saveHistory();
          hasActiveResult_ = true;
          activeResult_ = fallbackResult;
          emit activeResultChanged(activeResult_, true);
          emit songFound(fallbackResult);
          setState(State::Found, QStringLiteral("Web Medyadan bulundu: %1 - %2").arg(fallbackResult.artist, fallbackResult.title));

          if (settings_->autoOpenOnResult()) {
            emit autoOpenRequested(fallbackResult, settings_->openPlatform());
          }
          if (settings_->autoStopOnResult()) {
            stopListening();
          }
          return;
        }
      }
    }

    // Still listening!
    setState(State::Listening, QStringLiteral("Dinliyorum"));
  }
}

bool SongRecognitionService::isDuplicate(const SongResult &result) const {
  const QString key = result.dedupeKey();
  if (key.isEmpty()) return false;

  // If the song is currently in history, it is a duplicate.
  // If the user deleted it from history, it is no longer considered a duplicate and can be recognized again!
  for (const auto &item : history_) {
    if (item.dedupeKey() == key ||
        (!item.trackKey.isEmpty() && item.trackKey == result.trackKey) ||
        (item.artist.compare(result.artist, Qt::CaseInsensitive) == 0 &&
         item.title.compare(result.title, Qt::CaseInsensitive) == 0)) {
      return true;
    }
  }
  return false;
}

void SongRecognitionService::rememberResult(const SongResult &result) {
  const QString key = result.dedupeKey();
  if (!key.isEmpty()) {
    recentTrackKeys_.insert(key, QDateTime::currentMSecsSinceEpoch());
  }
}
