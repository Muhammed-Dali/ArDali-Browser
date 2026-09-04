#include "media_download_service.h"

#include "security_utils.h"
#include "yt_dlp_update_manager.h"

#include <QCoreApplication>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QProcess>
#include <QProcessEnvironment>
#include <QPointer>
#include <QRegularExpression>
#include <QSaveFile>
#include <QSet>
#include <QStandardPaths>
#include <QTimer>

#include <algorithm>
#include <utility>

namespace {

constexpr qsizetype kMaximumMetadataBytes = 32 * 1024 * 1024;

QString executableName(const QString &base) {
#if defined(Q_OS_WIN)
  return base + QStringLiteral(".exe");
#else
  return base;
#endif
}

QStringList defaultBundledCandidates(const QString &name) {
  const QString appDir = QCoreApplication::applicationDirPath();
  return {QDir(appDir).filePath(name), QDir(appDir).filePath(QStringLiteral("bin/") + name)};
}

QStringList defaultFfmpegCandidates(const QString &name) {
  QStringList candidates = defaultBundledCandidates(name);
  const QString dataDir = QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation);
  candidates << QDir(dataDir).filePath(QStringLiteral("downloader-bin/") + name);
  return candidates;
}

QString sizeLabel(qint64 bytes) {
  if (bytes <= 0) return QStringLiteral("boyut bilinmiyor");
  if (bytes >= 1024 * 1024 * 1024LL) return QStringLiteral("%1 GB").arg(bytes / 1024.0 / 1024.0 / 1024.0, 0, 'f', 2);
  return QStringLiteral("%1 MB").arg(bytes / 1024.0 / 1024.0, 0, 'f', 1);
}

QString stateText(MediaDownloadState state) {
  switch (state) {
    case MediaDownloadState::Queued: return QStringLiteral("Sırada");
    case MediaDownloadState::Downloading: return QStringLiteral("İndiriliyor");
    case MediaDownloadState::Processing: return QStringLiteral("İşleniyor");
    case MediaDownloadState::Completed: return QStringLiteral("Tamamlandı");
    case MediaDownloadState::Failed: return QStringLiteral("Başarısız");
    case MediaDownloadState::Cancelled: return QStringLiteral("İptal edildi");
  }
  return {};
}

QProcessEnvironment trustedProcessEnvironment(const QString &ytDlpPath, const QString &ffmpegPath) {
  const QProcessEnvironment system = QProcessEnvironment::systemEnvironment();
  QProcessEnvironment environment;
  for (const QString &name : {QStringLiteral("LANG"), QStringLiteral("LC_ALL"), QStringLiteral("LC_CTYPE"),
                              QStringLiteral("TMPDIR"), QStringLiteral("TEMP"), QStringLiteral("TMP"),
                              QStringLiteral("SSL_CERT_FILE"), QStringLiteral("SSL_CERT_DIR"),
                              QStringLiteral("SystemRoot"), QStringLiteral("WINDIR"),
                              QStringLiteral("COMSPEC"), QStringLiteral("USERPROFILE")}) {
    if (system.contains(name)) environment.insert(name, system.value(name));
  }
  QStringList paths;
  if (!ytDlpPath.isEmpty()) paths << QFileInfo(ytDlpPath).absolutePath();
  if (!ffmpegPath.isEmpty()) paths << QFileInfo(ffmpegPath).absolutePath();
#if defined(Q_OS_WIN)
  const QString systemRoot = qEnvironmentVariable("SystemRoot");
  if (!systemRoot.isEmpty()) paths << QDir(systemRoot).filePath(QStringLiteral("System32"));
#else
  paths << QStringLiteral("/usr/bin") << QStringLiteral("/usr/local/bin") << QStringLiteral("/bin")
        << QStringLiteral("/usr/sbin") << QStringLiteral("/usr/local/sbin") << QStringLiteral("/sbin");
#endif
  paths.removeAll(QString{});
  paths.removeDuplicates();
  environment.insert(QStringLiteral("PATH"), paths.join(QDir::listSeparator()));
  return environment;
}

bool isTerminal(MediaDownloadState state) {
  return state == MediaDownloadState::Completed || state == MediaDownloadState::Failed
      || state == MediaDownloadState::Cancelled;
}

QString uniqueFilePath(const QString &directory, const QString &suggestedName) {
  const QString safeName = BrowserSecurity::sanitizeDownloadFileName(suggestedName, QStringLiteral("playlist-links.txt"));
  const QFileInfo nameInfo(safeName);
  const QString suffix = nameInfo.completeSuffix();
  const QString stem = suffix.isEmpty() ? safeName : safeName.left(safeName.size() - suffix.size() - 1);
  for (int counter = 0; counter < 10000; ++counter) {
    const QString numbered = counter == 0 ? safeName
        : stem + QStringLiteral(" (%1)").arg(counter) + (suffix.isEmpty() ? QString{} : QLatin1Char('.') + suffix);
    const QString candidate = QDir(directory).absoluteFilePath(numbered);
    if (!QFileInfo::exists(candidate)) return candidate;
  }
  return {};
}

qint64 jsonInteger(const QJsonObject &object, const QString &name) {
  return static_cast<qint64>(object.value(name).toDouble());
}

}  // namespace

MediaDownloadService::MediaDownloadService(const QString &defaultDownloadDirectory, QObject *parent,
                                           QStringList ytDlpCandidates, QStringList ffmpegCandidates,
                                           QString historyPath, YtDlpUpdateManager *updateManager)
    : QObject(parent), defaultDownloadDirectory_(defaultDownloadDirectory), historyPath_(std::move(historyPath)) {
  const QString ytName = executableName(QStringLiteral("yt-dlp"));
  const QString ffmpegName = executableName(QStringLiteral("ffmpeg"));
  const bool explicitYtDlpCandidates = !ytDlpCandidates.isEmpty();
  if (ytDlpCandidates.isEmpty()) ytDlpCandidates = defaultBundledCandidates(ytName);
  if (ffmpegCandidates.isEmpty()) ffmpegCandidates = defaultFfmpegCandidates(ffmpegName);
  updateManager_ = updateManager ? updateManager : new YtDlpUpdateManager({}, this);
  ytDlpPath_ = BrowserSecurity::resolveTrustedExecutable(ytName, ytDlpCandidates, false);
  if (ytDlpPath_.isEmpty() && explicitYtDlpCandidates) {
    const QString legacyName = executableName(QStringLiteral("ytdlp"));
    ytDlpPath_ = BrowserSecurity::resolveTrustedExecutable(legacyName, ytDlpCandidates, false);
  }
  if (ytDlpPath_.isEmpty() && !explicitYtDlpCandidates && updateManager_)
    ytDlpPath_ = updateManager_->verifiedManagedExecutable();
  if (ytDlpPath_.isEmpty() && !explicitYtDlpCandidates)
    ytDlpPath_ = BrowserSecurity::resolveTrustedExecutable(ytName);
  ffmpegPath_ = BrowserSecurity::resolveTrustedExecutable(ffmpegName, ffmpegCandidates);
  if (historyPath_.isEmpty()) {
    historyPath_ = QDir(QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation))
                       .filePath(QStringLiteral("media-download-history.json"));
  }
  analysisTimeout_ = new QTimer(this);
  analysisTimeout_->setSingleShot(true);
  connect(analysisTimeout_, &QTimer::timeout, this, [this] {
    if (!analysisProcess_) return;
    analysisProcess_->kill();
    analysisStderr_ = QByteArrayLiteral("analysis-timeout");
  });
  jsRuntimeTimeout_ = new QTimer(this);
  jsRuntimeTimeout_->setSingleShot(true);
  connect(jsRuntimeTimeout_, &QTimer::timeout, this, [this] {
    if (jsRuntimeProcess_) jsRuntimeProcess_->kill();
  });
  connect(updateManager_, &YtDlpUpdateManager::statusChanged, this,
          [this](const QString &message, int percent) { emit enginePreparationStatus(message, percent); });
  connect(updateManager_, &YtDlpUpdateManager::ready, this,
          [this](const QString &path, bool) {
    if (!path.isEmpty()) ytDlpPath_ = path;
    if (!pendingAnalysisUrl_.isEmpty()) {
      const QUrl url = pendingAnalysisUrl_;
      pendingAnalysisUrl_ = QUrl{};
      prepareRuntimeThenAnalyze(url);
    }
  });
  connect(updateManager_, &YtDlpUpdateManager::failed, this,
          [this](const QString &message, bool existingUsable) {
    if (!pendingAnalysisUrl_.isEmpty()) {
      pendingAnalysisUrl_ = QUrl{};
      emit analysisFailed(existingUsable
          ? QStringLiteral("yt-dlp güncellenemedi; mevcut sürüm kullanılabilir.") : message);
    } else if (existingUsable) {
      emit enginePreparationStatus(QStringLiteral("Güncelleme başarısız; mevcut yt-dlp kullanılmaya devam ediyor."), 0);
    }
  });
  loadHistory();
}

MediaDownloadService::~MediaDownloadService() {
  for (QProcess *process : {analysisProcess_, downloadProcess_, jsRuntimeProcess_}) {
    if (!process || process->state() == QProcess::NotRunning) continue;
    process->terminate();
    if (!process->waitForFinished(1200)) {
      process->kill();
      process->waitForFinished(500);
    }
  }
}

bool MediaDownloadService::isSupportedMediaUrl(const QUrl &url, QString *reason) {
  const auto reject = [reason](const QString &message) { if (reason) *reason = message; return false; };
  if (!url.isValid() || url.isEmpty()) return reject(QStringLiteral("Geçerli bir bağlantı girin."));
  if (url.scheme().compare(QStringLiteral("http"), Qt::CaseInsensitive) != 0
      && url.scheme().compare(QStringLiteral("https"), Qt::CaseInsensitive) != 0) {
    return reject(QStringLiteral("Yalnızca HTTP veya HTTPS medya bağlantıları desteklenir."));
  }
  if (!url.userName().isEmpty() || !url.password().isEmpty()) {
    return reject(QStringLiteral("Kimlik bilgisi içeren bağlantılar güvenlik nedeniyle reddedildi."));
  }
  if (url.host().isEmpty()) return reject(QStringLiteral("Bağlantıda geçerli bir sunucu adı yok."));
  if (reason) reason->clear();
  return true;
}

bool MediaDownloadService::parseAnalysisJson(const QByteArray &json, const QUrl &url,
                                             MediaAnalysisResult *result, QString *error) {
  if (!result) return false;
  QJsonParseError parseError;
  const QJsonDocument document = QJsonDocument::fromJson(json, &parseError);
  if (!document.isObject()) {
    if (error) *error = QStringLiteral("Medya bilgisi okunamadı.");
    return false;
  }
  const QJsonObject root = document.object();
  MediaAnalysisResult parsed;
  parsed.url = url;
  parsed.id = root.value(QStringLiteral("id")).toString();
  parsed.title = root.value(QStringLiteral("title")).toString().trimmed().left(240);
  if (parsed.title.isEmpty()) parsed.title = root.value(QStringLiteral("fulltitle")).toString().trimmed().left(240);
  parsed.source = root.value(QStringLiteral("extractor_key")).toString();
  if (parsed.source.isEmpty()) parsed.source = root.value(QStringLiteral("extractor")).toString();
  if (parsed.source.isEmpty()) parsed.source = url.host();
  parsed.thumbnailUrl = root.value(QStringLiteral("thumbnail")).toString();
  parsed.durationSeconds = jsonInteger(root, QStringLiteral("duration"));

  QSet<QString> seenVideo;
  QSet<QString> seenAudio;
  for (const QJsonValue &value : root.value(QStringLiteral("formats")).toArray()) {
    const QJsonObject format = value.toObject();
    MediaFormatOption option;
    option.id = format.value(QStringLiteral("format_id")).toString().trimmed();
    if (option.id.isEmpty()) continue;
    option.extension = format.value(QStringLiteral("ext")).toString().toLower();
    option.videoCodec = format.value(QStringLiteral("vcodec")).toString(QStringLiteral("none"));
    option.audioCodec = format.value(QStringLiteral("acodec")).toString(QStringLiteral("none"));
    option.hasVideo = option.videoCodec != QLatin1String("none") && !option.videoCodec.isEmpty();
    option.hasAudio = option.audioCodec != QLatin1String("none") && !option.audioCodec.isEmpty();
    option.height = format.value(QStringLiteral("height")).toInt();
    option.fps = qRound(format.value(QStringLiteral("fps")).toDouble());
    option.audioBitrate = qRound(format.value(QStringLiteral("abr")).toDouble());
    option.estimatedBytes = jsonInteger(format, QStringLiteral("filesize"));
    if (!option.estimatedBytes) option.estimatedBytes = jsonInteger(format, QStringLiteral("filesize_approx"));
    if (option.hasVideo && !seenVideo.contains(option.id)) {
      seenVideo.insert(option.id);
      const QString quality = option.height > 0
          ? QStringLiteral("%1p%2").arg(option.height).arg(option.fps > 30 ? QStringLiteral(" %1fps").arg(option.fps) : QString{})
          : QStringLiteral("Video");
      option.label = QStringLiteral("%1 · %2 · %3%4").arg(quality, option.extension,
          option.videoCodec.section(QLatin1Char('.'), 0, 0), option.hasAudio ? QStringLiteral(" · ses dahil") : QString{})
          + QStringLiteral(" · ") + sizeLabel(option.estimatedBytes);
      parsed.videoFormats.append(option);
    }
    if (option.hasAudio && !option.hasVideo && !seenAudio.contains(option.id)) {
      seenAudio.insert(option.id);
      option.label = QStringLiteral("%1 kbps · %2 · %3 · %4")
          .arg(option.audioBitrate > 0 ? QString::number(option.audioBitrate) : QStringLiteral("?"),
               option.extension, option.audioCodec.section(QLatin1Char('.'), 0, 0), sizeLabel(option.estimatedBytes));
      parsed.audioFormats.append(option);
    }
  }
  std::sort(parsed.videoFormats.begin(), parsed.videoFormats.end(), [](const auto &a, const auto &b) {
    if (a.height != b.height) return a.height > b.height;
    return a.fps > b.fps;
  });
  std::sort(parsed.audioFormats.begin(), parsed.audioFormats.end(), [](const auto &a, const auto &b) {
    return a.audioBitrate > b.audioBitrate;
  });
  if (parsed.title.isEmpty() || (parsed.videoFormats.isEmpty() && parsed.audioFormats.isEmpty())) {
    if (error) *error = QStringLiteral("Bu sayfada desteklenen indirilebilir medya bulunamadı.");
    return false;
  }
  *result = parsed;
  if (error) error->clear();
  return true;
}

QStringList MediaDownloadService::buildDownloadArguments(const MediaDownloadRequest &request,
                                                         const QString &ffmpegPath,
                                                         const QString &jsRuntimeArgument) {
  QStringList args{QStringLiteral("--newline"), QStringLiteral("--no-config"),
                   QStringLiteral("--no-update"),
                   QStringLiteral("--no-mtime"), QStringLiteral("--no-overwrites"),
                   QStringLiteral("--windows-filenames"), QStringLiteral("--trim-filenames"), QStringLiteral("200"),
                   QStringLiteral("--progress-template"),
                   QStringLiteral("download:ARDALI_PROGRESS:%(progress._percent_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s"),
                   QStringLiteral("--progress-template"), QStringLiteral("postprocess:ARDALI_POST:%(progress.status)s"),
                   QStringLiteral("--print"), QStringLiteral("after_move:ARDALI_FILE:%(filepath)s")};
  if (request.playlist) {
    args << QStringLiteral("--yes-playlist") << QStringLiteral("--playlist-start")
         << QString::number(std::max(1, request.playlistStart));
    if (request.playlistEnd >= std::max(1, request.playlistStart))
      args << QStringLiteral("--playlist-end") << QString::number(request.playlistEnd);
  } else {
    args << QStringLiteral("--no-playlist");
  }
  if (!ffmpegPath.isEmpty()) args << QStringLiteral("--ffmpeg-location") << ffmpegPath;
  if (!jsRuntimeArgument.isEmpty()) {
    args << QStringLiteral("--no-js-runtimes") << QStringLiteral("--js-runtimes") << jsRuntimeArgument;
  }
  if (request.kind == MediaDownloadKind::PlaylistThumbnails) {
    args << QStringLiteral("--skip-download") << QStringLiteral("--write-thumbnail");
  } else if (request.kind == MediaDownloadKind::PlaylistLinks) {
    args << QStringLiteral("--skip-download") << QStringLiteral("--flat-playlist")
         << QStringLiteral("--print-to-file") << QStringLiteral("webpage_url")
         << request.auxiliaryOutputPath;
  } else if (request.kind == MediaDownloadKind::Video) {
    QString selector = request.playlist ? QString{} : request.formatId.trimmed();
    if (request.playlist) {
      const QString height = request.formatHeight > 0
          ? QStringLiteral("[height<=%1]").arg(request.formatHeight) : QString{};
      selector = QStringLiteral("bestvideo%1+bestaudio/best%1/best").arg(height);
    }
    if (selector.isEmpty()) selector = QStringLiteral("bestvideo+bestaudio/best");
    else if (!request.formatHasAudio) selector += QStringLiteral("+bestaudio/best");
    args << QStringLiteral("-f") << selector;
    const QString ext = request.formatExtension.toLower();
    args << QStringLiteral("--merge-output-format") << (ext == QLatin1String("webm") ? QStringLiteral("webm") : QStringLiteral("mp4"));
  } else {
    args << QStringLiteral("-f") << (request.playlist || request.formatId.trimmed().isEmpty()
        ? QStringLiteral("bestaudio/best") : request.formatId.trimmed());
    if (request.kind == MediaDownloadKind::AudioConvert) {
      static const QSet<QString> allowed{QStringLiteral("mp3"), QStringLiteral("m4a"), QStringLiteral("opus"),
                                         QStringLiteral("wav"), QStringLiteral("flac"), QStringLiteral("alac")};
      const QString output = allowed.contains(request.audioFormat.toLower()) ? request.audioFormat.toLower() : QStringLiteral("mp3");
      args << QStringLiteral("-x") << QStringLiteral("--audio-format") << output
           << QStringLiteral("--audio-quality") << QStringLiteral("0")
           << QStringLiteral("--embed-metadata") << QStringLiteral("--embed-thumbnail")
           << QStringLiteral("--convert-thumbnails") << QStringLiteral("jpg");
    }
  }
  const int sectionStart = std::max(0, request.sectionStartSeconds);
  const int sectionEnd = std::max(0, request.sectionEndSeconds);
  if (request.kind != MediaDownloadKind::PlaylistThumbnails
      && request.kind != MediaDownloadKind::PlaylistLinks
      && (sectionStart > 0 || sectionEnd > sectionStart)) {
    args << QStringLiteral("--download-sections")
         << QStringLiteral("*%1-%2").arg(sectionStart).arg(sectionEnd > sectionStart
                ? QString::number(sectionEnd) : QStringLiteral("inf"));
  }
  if (request.subtitles) {
    args << QStringLiteral("--write-subs") << QStringLiteral("--write-auto-subs")
         << QStringLiteral("--sub-langs") << QStringLiteral("all");
  }
  const QString outputTemplate = request.playlist
      ? QStringLiteral("%(playlist_title).100B/%(playlist_index)03d - %(title).140B [%(id)s].%(ext)s")
      : QStringLiteral("%(title).160B [%(id)s].%(ext)s");
  args << QStringLiteral("-P") << request.targetDirectory
       << QStringLiteral("-o") << outputTemplate
       << request.url.toString(QUrl::FullyEncoded);
  return args;
}

bool MediaDownloadService::ytDlpAvailable() const { return !ytDlpPath_.isEmpty(); }
bool MediaDownloadService::ffmpegAvailable() const { return !ffmpegPath_.isEmpty(); }
QString MediaDownloadService::ytDlpPath() const { return ytDlpPath_; }
QString MediaDownloadService::ffmpegPath() const { return ffmpegPath_; }
QString MediaDownloadService::javaScriptRuntimeArgument() const { return jsRuntimeArgument_; }
QString MediaDownloadService::defaultDownloadDirectory() const { return defaultDownloadDirectory_; }
QVector<MediaDownloadJob> MediaDownloadService::jobs() const { return jobs_; }
bool MediaDownloadService::analysisRunning() const {
  return analysisProcess_ != nullptr || jsRuntimeProcess_ != nullptr
      || !pendingAnalysisUrl_.isEmpty() || !runtimePendingAnalysisUrl_.isEmpty();
}

void MediaDownloadService::setDefaultDownloadDirectory(const QString &directory) {
  const QFileInfo info(directory);
  if (info.isDir() && info.isAbsolute()) defaultDownloadDirectory_ = info.absoluteFilePath();
}

bool MediaDownloadService::analyze(const QUrl &url) {
  QString reason;
  if (!isSupportedMediaUrl(url, &reason)) { emit analysisFailed(reason); return false; }
  if (analysisRunning()) return false;
  if (!ytDlpAvailable()) {
    if (!updateManager_) { emit analysisFailed(QStringLiteral("Hiç çalışan yt-dlp bulunamadı.")); return false; }
    pendingAnalysisUrl_ = url;
    emit enginePreparationStatus(QStringLiteral("İndirme motoru hazırlanıyor…"), 0);
    updateManager_->ensureInstalled();
    return true;
  }
  if (!updateCheckTriggered_ && updateManager_
      && ytDlpPath_ == updateManager_->verifiedManagedExecutable()) {
    updateCheckTriggered_ = true;
    QTimer::singleShot(0, updateManager_, &YtDlpUpdateManager::checkForUpdate);
  }
  prepareRuntimeThenAnalyze(url);
  return true;
}

void MediaDownloadService::prepareRuntimeThenAnalyze(const QUrl &url) {
  if (jsRuntimeResolved_) { startAnalysisProcess(url); return; }
  runtimePendingAnalysisUrl_ = url;
  if (jsRuntimeCandidates_.isEmpty()) {
    for (const QString &name : {QStringLiteral("deno"), QStringLiteral("node")}) {
      const QString executable = BrowserSecurity::resolveTrustedExecutable(
          executableName(name), defaultBundledCandidates(executableName(name)));
      if (!executable.isEmpty()) jsRuntimeCandidates_.append({name, executable});
    }
  }
  jsRuntimeCandidateIndex_ = 0;
  tryNextJavaScriptRuntime();
}

void MediaDownloadService::tryNextJavaScriptRuntime() {
  if (jsRuntimeCandidateIndex_ >= jsRuntimeCandidates_.size()) {
    jsRuntimeResolved_ = true;
    jsRuntimeArgument_.clear();
    const QUrl url = runtimePendingAnalysisUrl_;
    runtimePendingAnalysisUrl_ = QUrl{};
    startAnalysisProcess(url);
    return;
  }
  const auto candidate = jsRuntimeCandidates_.at(jsRuntimeCandidateIndex_++);
  jsRuntimeOutput_.clear();
  emit enginePreparationStatus(QStringLiteral("JavaScript çalışma zamanı doğrulanıyor…"), 0);
  jsRuntimeProcess_ = new QProcess(this);
  QProcess *const launched = jsRuntimeProcess_;
  launched->setProgram(candidate.second);
  launched->setArguments({QStringLiteral("--version")});
  launched->setProcessEnvironment(trustedProcessEnvironment(candidate.second, {}));
  launched->setProperty("ardali-runtime-name", candidate.first);
  connect(launched, &QProcess::readyReadStandardOutput, this, [this, launched] {
    if (jsRuntimeProcess_ != launched) return;
    jsRuntimeOutput_ += launched->readAllStandardOutput();
    if (jsRuntimeOutput_.size() > 2048) launched->kill();
  });
  connect(launched, &QProcess::readyReadStandardError, this, [this, launched] {
    if (jsRuntimeProcess_ != launched) return;
    jsRuntimeOutput_ += launched->readAllStandardError();
    if (jsRuntimeOutput_.size() > 2048) launched->kill();
  });
  connect(launched, &QProcess::errorOccurred, this, [this, launched](QProcess::ProcessError error) {
    if (error == QProcess::FailedToStart && jsRuntimeProcess_ == launched)
      finishJavaScriptRuntimeProbe(launched, true);
  });
  connect(launched, qOverload<int, QProcess::ExitStatus>(&QProcess::finished), this,
          [this, launched](int, QProcess::ExitStatus) {
    if (jsRuntimeProcess_ == launched) finishJavaScriptRuntimeProbe(launched);
  });
  launched->start();
  jsRuntimeTimeout_->start(2500);
}

void MediaDownloadService::finishJavaScriptRuntimeProbe(QProcess *process, bool failedToStart) {
  if (!process || jsRuntimeProcess_ != process) return;
  jsRuntimeTimeout_->stop();
  jsRuntimeOutput_ += process->readAllStandardOutput() + process->readAllStandardError();
  const QString name = process->property("ardali-runtime-name").toString();
  const QString path = process->program();
  const bool exitedCleanly = !failedToStart && process->exitStatus() == QProcess::NormalExit
      && process->exitCode() == 0 && jsRuntimeOutput_.size() <= 2048;
  const QString output = QString::fromUtf8(jsRuntimeOutput_).trimmed();
  bool supported = false;
  if (exitedCleanly && name == QLatin1String("deno")) {
    const QRegularExpressionMatch match = QRegularExpression(QStringLiteral(R"(\bdeno\s+(\d+)\.(\d+))")).match(output);
    supported = match.hasMatch() && (match.captured(1).toInt() > 2
        || (match.captured(1).toInt() == 2 && match.captured(2).toInt() >= 3));
  } else if (exitedCleanly && name == QLatin1String("node")) {
    const QRegularExpressionMatch match = QRegularExpression(QStringLiteral(R"(v?(\d+)\.)")).match(output);
    supported = match.hasMatch() && match.captured(1).toInt() >= 22;
  }
  process->deleteLater();
  jsRuntimeProcess_ = nullptr;
  if (!supported) { QTimer::singleShot(0, this, &MediaDownloadService::tryNextJavaScriptRuntime); return; }
  jsRuntimeResolved_ = true;
  jsRuntimeArgument_ = name + QLatin1Char(':') + path;
  const QUrl url = runtimePendingAnalysisUrl_;
  runtimePendingAnalysisUrl_ = QUrl{};
  startAnalysisProcess(url);
}

void MediaDownloadService::startAnalysisProcess(const QUrl &url) {
  analysisUrl_ = url;
  analysisStdout_.clear();
  analysisStderr_.clear();
  analysisWasCancelled_ = false;
  analysisProcess_ = new QProcess(this);
  QProcess *const launchedAnalysis = analysisProcess_;
  analysisProcess_->setProgram(ytDlpPath_);
  analysisProcess_->setProcessEnvironment(trustedProcessEnvironment(ytDlpPath_, ffmpegPath_));
  QStringList analysisArguments{QStringLiteral("--dump-single-json"), QStringLiteral("--no-playlist"),
      QStringLiteral("--no-warnings"), QStringLiteral("--no-config"), QStringLiteral("--no-update")};
  if (!jsRuntimeArgument_.isEmpty())
    analysisArguments << QStringLiteral("--no-js-runtimes") << QStringLiteral("--js-runtimes") << jsRuntimeArgument_;
  analysisArguments << url.toString(QUrl::FullyEncoded);
  analysisProcess_->setArguments(analysisArguments);
  connect(analysisProcess_, &QProcess::readyReadStandardOutput, this, [this] {
    analysisStdout_ += analysisProcess_->readAllStandardOutput();
    if (analysisStdout_.size() > kMaximumMetadataBytes) analysisProcess_->kill();
  });
  connect(analysisProcess_, &QProcess::readyReadStandardError, this, [this] {
    analysisStderr_ += analysisProcess_->readAllStandardError();
    if (analysisStderr_.size() > 256 * 1024) analysisStderr_ = analysisStderr_.right(256 * 1024);
  });
  connect(analysisProcess_, &QProcess::errorOccurred, this, [this, launchedAnalysis](QProcess::ProcessError error) {
    if (analysisStderr_.isEmpty()) analysisStderr_ = QByteArrayLiteral("process-start-failed");
    if (error != QProcess::FailedToStart || analysisProcess_ != launchedAnalysis) return;
    analysisTimeout_->stop();
    analysisProcess_->deleteLater();
    analysisProcess_ = nullptr;
    emit analysisFailed(QStringLiteral("yt-dlp işlemi başlatılamadı."));
  });
  connect(analysisProcess_, qOverload<int, QProcess::ExitStatus>(&QProcess::finished), this,
          [this, launchedAnalysis](int exitCode, QProcess::ExitStatus exitStatus) {
    if (analysisProcess_ != launchedAnalysis) return;
    analysisTimeout_->stop();
    QProcess *finished = analysisProcess_;
    analysisProcess_ = nullptr;
    if (finished) {
      analysisStdout_ += finished->readAllStandardOutput();
      analysisStderr_ += finished->readAllStandardError();
      finished->deleteLater();
    }
    if (analysisWasCancelled_) { emit analysisCancelled(); return; }
    if (exitStatus != QProcess::NormalExit || exitCode != 0 || analysisStdout_.size() > kMaximumMetadataBytes) {
      emit analysisFailed(categorizedError(analysisStderr_, exitCode));
      return;
    }
    MediaAnalysisResult result;
    QString error;
    if (!parseAnalysisJson(analysisStdout_, analysisUrl_, &result, &error)) { emit analysisFailed(error); return; }
    emit analysisReady(result);
  });
  emit analysisStarted(url);
  analysisProcess_->start();
  analysisTimeout_->start(60000);
}

void MediaDownloadService::cancelAnalysis() {
  if (!pendingAnalysisUrl_.isEmpty()) {
    pendingAnalysisUrl_ = QUrl{};
    if (updateManager_) updateManager_->cancel();
    emit analysisCancelled();
    return;
  }
  if (!runtimePendingAnalysisUrl_.isEmpty()) {
    runtimePendingAnalysisUrl_ = QUrl{};
    jsRuntimeTimeout_->stop();
    if (jsRuntimeProcess_) {
      QProcess *process = jsRuntimeProcess_;
      jsRuntimeProcess_ = nullptr;
      process->disconnect(this);
      process->kill();
      process->deleteLater();
    }
    emit analysisCancelled();
    return;
  }
  if (!analysisProcess_) return;
  analysisWasCancelled_ = true;
  analysisProcess_->terminate();
  QTimer::singleShot(1200, analysisProcess_, [process = QPointer<QProcess>(analysisProcess_)] {
    if (process && process->state() != QProcess::NotRunning) process->kill();
  });
}

QUuid MediaDownloadService::enqueue(const MediaDownloadRequest &candidate) {
  MediaDownloadRequest request = candidate;
  QString reason;
  if (!ytDlpAvailable() || !isSupportedMediaUrl(request.url, &reason)) return {};
  const QFileInfo directory(request.targetDirectory.isEmpty() ? defaultDownloadDirectory_ : request.targetDirectory);
  if (!directory.isDir() || !directory.isAbsolute() || !directory.isWritable()) return {};
  request.targetDirectory = directory.absoluteFilePath();
  if (request.kind == MediaDownloadKind::PlaylistThumbnails || request.kind == MediaDownloadKind::PlaylistLinks)
    request.playlist = true;
  if (request.kind == MediaDownloadKind::PlaylistLinks) {
    request.auxiliaryOutputPath = uniqueFilePath(request.targetDirectory,
        request.title + QStringLiteral(" links.txt"));
    if (request.auxiliaryOutputPath.isEmpty()) return {};
  }
  const bool needsFfmpeg = request.kind == MediaDownloadKind::AudioConvert
      || (request.kind == MediaDownloadKind::Video && !request.formatHasAudio)
      || request.sectionStartSeconds > 0 || request.sectionEndSeconds > 0;
  if (needsFfmpeg && !ffmpegAvailable()) return {};
  for (const MediaDownloadJob &existing : std::as_const(jobs_)) {
    if (!isTerminal(existing.state) && existing.url == request.url && existing.kind == request.kind
        && existing.playlist == request.playlist && existing.targetDirectory == request.targetDirectory) {
      return existing.id;
    }
  }
  MediaDownloadJob job;
  job.id = QUuid::createUuid();
  job.url = request.url;
  job.title = request.title.trimmed().left(240);
  if (job.title.isEmpty()) job.title = QStringLiteral("Medya indirmesi");
  job.targetDirectory = request.targetDirectory;
  job.kind = request.kind;
  job.playlist = request.playlist;
  if (request.kind == MediaDownloadKind::PlaylistLinks) job.outputPath = request.auxiliaryOutputPath;
  job.state = MediaDownloadState::Queued;
  job.statusText = stateText(job.state);
  job.createdAt = QDateTime::currentDateTimeUtc();
  jobs_.prepend(job);
  requests_.insert(job.id, request);
  queue_.enqueue(job.id);
  emit jobsChanged();
  startNextDownload();
  return job.id;
}

bool MediaDownloadService::cancel(const QUuid &id) {
  const int index = jobIndex(id);
  if (index < 0 || isTerminal(jobs_[index].state)) return false;
  if (id == currentJobId_ && downloadProcess_) {
    currentCancelRequested_ = true;
    downloadProcess_->terminate();
    QTimer::singleShot(1600, downloadProcess_, [process = QPointer<QProcess>(downloadProcess_)] {
      if (process && process->state() != QProcess::NotRunning) process->kill();
    });
    return true;
  }
  if (queue_.removeOne(id)) {
    jobs_[index].state = MediaDownloadState::Cancelled;
    jobs_[index].statusText = stateText(jobs_[index].state);
    persistHistory();
    emit jobsChanged();
    return true;
  }
  return false;
}

QUuid MediaDownloadService::retry(const QUuid &id) {
  const auto request = requests_.constFind(id);
  if (request == requests_.cend()) return {};
  const int index = jobIndex(id);
  if (index < 0 || !isTerminal(jobs_[index].state)) return {};
  return enqueue(*request);
}

bool MediaDownloadService::remove(const QUuid &id) {
  const int index = jobIndex(id);
  if (index < 0 || !isTerminal(jobs_[index].state)) return false;
  jobs_.removeAt(index);
  requests_.remove(id);
  persistHistory();
  emit jobsChanged();
  return true;
}

int MediaDownloadService::jobIndex(const QUuid &id) const {
  for (int index = 0; index < jobs_.size(); ++index) if (jobs_.at(index).id == id) return index;
  return -1;
}

void MediaDownloadService::startNextDownload() {
  if (downloadProcess_ || queue_.isEmpty()) return;
  currentJobId_ = queue_.dequeue();
  const int index = jobIndex(currentJobId_);
  const auto request = requests_.constFind(currentJobId_);
  if (index < 0 || request == requests_.cend()) { currentJobId_ = {}; startNextDownload(); return; }
  jobs_[index].state = MediaDownloadState::Downloading;
  jobs_[index].statusText = stateText(jobs_[index].state);
  currentCancelRequested_ = false;
  downloadStdoutBuffer_.clear();
  downloadStderrBuffer_.clear();
  downloadErrorTail_.clear();
  downloadProcess_ = new QProcess(this);
  QProcess *const launchedDownload = downloadProcess_;
  downloadProcess_->setWorkingDirectory(request->targetDirectory);
  downloadProcess_->setProgram(ytDlpPath_);
  downloadProcess_->setProcessEnvironment(trustedProcessEnvironment(ytDlpPath_, ffmpegPath_));
  downloadProcess_->setArguments(buildDownloadArguments(*request, ffmpegPath_, jsRuntimeArgument_));
  connect(downloadProcess_, &QProcess::readyReadStandardOutput, this, [this] {
    processDownloadOutput(&downloadStdoutBuffer_, downloadProcess_->readAllStandardOutput());
  });
  connect(downloadProcess_, &QProcess::readyReadStandardError, this, [this] {
    const QByteArray chunk = downloadProcess_->readAllStandardError();
    downloadErrorTail_ = (downloadErrorTail_ + chunk).right(256 * 1024);
    processDownloadOutput(&downloadStderrBuffer_, chunk);
  });
  connect(downloadProcess_, &QProcess::errorOccurred, this, [this, launchedDownload](QProcess::ProcessError error) {
    if (downloadErrorTail_.isEmpty()) downloadErrorTail_ = QByteArrayLiteral("process-start-failed");
    if (error == QProcess::FailedToStart && downloadProcess_ == launchedDownload) {
      finishCurrent(MediaDownloadState::Failed, QStringLiteral("yt-dlp işlemi başlatılamadı."));
    }
  });
  connect(downloadProcess_, qOverload<int, QProcess::ExitStatus>(&QProcess::finished), this,
          [this, launchedDownload](int exitCode, QProcess::ExitStatus status) {
    if (downloadProcess_ != launchedDownload) return;
    if (downloadProcess_) {
      processDownloadOutput(&downloadStdoutBuffer_, downloadProcess_->readAllStandardOutput() + QByteArrayLiteral("\n"));
      const QByteArray error = downloadProcess_->readAllStandardError();
      downloadErrorTail_ = (downloadErrorTail_ + error).right(256 * 1024);
      processDownloadOutput(&downloadStderrBuffer_, error + QByteArrayLiteral("\n"));
    }
    if (currentCancelRequested_) finishCurrent(MediaDownloadState::Cancelled);
    else if (status == QProcess::NormalExit && exitCode == 0) finishCurrent(MediaDownloadState::Completed);
    else finishCurrent(MediaDownloadState::Failed, categorizedError(downloadErrorTail_, exitCode));
  });
  emit jobsChanged();
  downloadProcess_->start();
}

void MediaDownloadService::processDownloadOutput(QByteArray *buffer, const QByteArray &chunk) {
  if (!buffer) return;
  *buffer += chunk;
  while (true) {
    const qsizetype newline = buffer->indexOf('\n');
    if (newline < 0) break;
    const QByteArray line = buffer->left(newline);
    buffer->remove(0, newline + 1);
    processDownloadLine(QString::fromUtf8(line).trimmed());
  }
  if (buffer->size() > 64 * 1024) *buffer = buffer->right(64 * 1024);
}

void MediaDownloadService::processDownloadLine(const QString &line) {
  const int index = jobIndex(currentJobId_);
  if (index < 0 || line.isEmpty()) return;
  if (line.startsWith(QStringLiteral("ARDALI_PROGRESS:"))) {
    const QStringList fields = line.mid(16).split(QLatin1Char('|'));
    if (!fields.isEmpty()) {
      QString percent = fields.value(0).trimmed();
      percent.remove(QLatin1Char('%'));
      jobs_[index].percent = std::clamp(percent.toDouble(), 0.0, 100.0);
      jobs_[index].downloadedBytes = fields.value(1).toLongLong();
      jobs_[index].totalBytes = fields.value(2).toLongLong();
      jobs_[index].bytesPerSecond = fields.value(3).toLongLong();
      jobs_[index].etaSeconds = fields.value(4).toInt();
      jobs_[index].state = MediaDownloadState::Downloading;
      jobs_[index].statusText = stateText(jobs_[index].state);
      emit jobsChanged();
    }
    return;
  }
  if (line.startsWith(QStringLiteral("ARDALI_POST:"))) {
    jobs_[index].state = MediaDownloadState::Processing;
    const MediaDownloadRequest request = requests_.value(currentJobId_);
    if (request.kind == MediaDownloadKind::AudioConvert) {
      jobs_[index].statusText = QStringLiteral("Dönüştürülüyor");
    } else if (request.kind == MediaDownloadKind::Video && !request.formatHasAudio) {
      jobs_[index].statusText = QStringLiteral("Birleştiriliyor");
    } else {
      jobs_[index].statusText = stateText(jobs_[index].state);
    }
    emit jobsChanged();
    return;
  }
  if (line.startsWith(QStringLiteral("ARDALI_FILE:"))) {
    const QString reported = line.mid(12).trimmed();
    const QFileInfo output(reported);
    const QString absolute = output.isAbsolute() ? output.absoluteFilePath()
        : QDir(jobs_[index].targetDirectory).absoluteFilePath(reported);
    const QDir root(jobs_[index].targetDirectory);
    const QString relative = root.relativeFilePath(QDir::cleanPath(absolute));
    if (!QDir::isAbsolutePath(relative) && relative != QLatin1String("..")
        && !relative.startsWith(QStringLiteral("../")) && !relative.startsWith(QStringLiteral("..\\"))) {
      jobs_[index].outputPath = QDir::cleanPath(absolute);
    }
  }
}

void MediaDownloadService::finishCurrent(MediaDownloadState state, const QString &error) {
  const int index = jobIndex(currentJobId_);
  const MediaDownloadRequest request = requests_.value(currentJobId_);
  if (index >= 0) {
    jobs_[index].state = state;
    jobs_[index].statusText = stateText(state);
    jobs_[index].errorText = error;
    if (state == MediaDownloadState::Completed) jobs_[index].percent = 100.0;
  }
  if (request.kind == MediaDownloadKind::PlaylistLinks && !request.auxiliaryOutputPath.isEmpty()) {
    if (state == MediaDownloadState::Completed) {
      QFile::setPermissions(request.auxiliaryOutputPath, QFileDevice::ReadOwner | QFileDevice::WriteOwner);
    } else {
      QFile::remove(request.auxiliaryOutputPath);
    }
  }
  if (downloadProcess_) downloadProcess_->deleteLater();
  downloadProcess_ = nullptr;
  currentJobId_ = {};
  currentCancelRequested_ = false;
  persistHistory();
  emit jobsChanged();
  QTimer::singleShot(0, this, &MediaDownloadService::startNextDownload);
}

QString MediaDownloadService::categorizedError(const QByteArray &stderrOutput, int exitCode) {
  const QString text = QString::fromUtf8(stderrOutput).toLower();
  if (text.contains(QStringLiteral("analysis-timeout"))) return QStringLiteral("Medya analizi zaman aşımına uğradı.");
  if (text.contains(QStringLiteral("unsupported url"))) return QStringLiteral("Bu sayfada desteklenen indirilebilir medya bulunamadı.");
  if (text.contains(QStringLiteral("private video")) || text.contains(QStringLiteral("login")) || text.contains(QStringLiteral("sign in")))
    return QStringLiteral("İçerik özel veya oturum açmayı gerektiriyor.");
  if (text.contains(QStringLiteral("no space left"))) return QStringLiteral("Hedef diskte yeterli alan yok.");
  if (text.contains(QStringLiteral("permission denied"))) return QStringLiteral("Hedef klasöre yazma izni yok.");
  if (text.contains(QStringLiteral("requested format"))) return QStringLiteral("Seçilen format artık kullanılamıyor; içeriği yeniden analiz edin.");
  if (text.contains(QStringLiteral("network")) || text.contains(QStringLiteral("timed out")) || text.contains(QStringLiteral("unable to download")))
    return QStringLiteral("Ağ bağlantısı veya medya sunucusu hatası oluştu.");
  if (text.contains(QStringLiteral("process-start-failed"))) return QStringLiteral("yt-dlp işlemi başlatılamadı.");
  return QStringLiteral("Medya işlemi başarısız oldu (kod %1).").arg(exitCode);
}

void MediaDownloadService::persistHistory() const {
  if (historyPath_.isEmpty()) return;
  QJsonArray entries;
  for (const MediaDownloadJob &job : jobs_) {
    if (!isTerminal(job.state)) continue;
    const MediaDownloadRequest request = requests_.value(job.id);
    entries.append(QJsonObject{{QStringLiteral("id"), job.id.toString(QUuid::WithoutBraces)},
        {QStringLiteral("url"), BrowserSecurity::sanitizeUrlForPersistence(job.url).toString(QUrl::FullyEncoded)},
        {QStringLiteral("title"), job.title}, {QStringLiteral("targetDirectory"), job.targetDirectory},
        {QStringLiteral("outputPath"), job.outputPath}, {QStringLiteral("kind"), static_cast<int>(job.kind)},
        {QStringLiteral("playlist"), job.playlist}, {QStringLiteral("formatId"), request.formatId},
        {QStringLiteral("formatExtension"), request.formatExtension}, {QStringLiteral("formatHeight"), request.formatHeight},
        {QStringLiteral("formatHasAudio"), request.formatHasAudio}, {QStringLiteral("audioFormat"), request.audioFormat},
        {QStringLiteral("auxiliaryOutputPath"), request.auxiliaryOutputPath},
        {QStringLiteral("subtitles"), request.subtitles}, {QStringLiteral("playlistStart"), request.playlistStart},
        {QStringLiteral("sectionStartSeconds"), request.sectionStartSeconds},
        {QStringLiteral("sectionEndSeconds"), request.sectionEndSeconds},
        {QStringLiteral("playlistEnd"), request.playlistEnd},
        {QStringLiteral("state"), static_cast<int>(job.state)}, {QStringLiteral("error"), job.errorText},
        {QStringLiteral("createdAt"), job.createdAt.toString(Qt::ISODate)}});
    if (entries.size() >= 200) break;
  }
  QDir().mkpath(QFileInfo(historyPath_).absolutePath());
  QSaveFile file(historyPath_);
  const QByteArray bytes = QJsonDocument(QJsonObject{{QStringLiteral("version"), 1},
      {QStringLiteral("jobs"), entries}}).toJson(QJsonDocument::Compact);
  if (file.open(QIODevice::WriteOnly)
      && file.setPermissions(QFileDevice::ReadOwner | QFileDevice::WriteOwner)
      && file.write(bytes) == bytes.size() && file.commit()) {
    QFile::setPermissions(historyPath_, QFileDevice::ReadOwner | QFileDevice::WriteOwner);
  }
}

void MediaDownloadService::loadHistory() {
  QFile file(historyPath_);
  if (!file.open(QIODevice::ReadOnly)) return;
  const QJsonDocument document = QJsonDocument::fromJson(file.readAll());
  for (const QJsonValue &value : document.object().value(QStringLiteral("jobs")).toArray()) {
    const QJsonObject object = value.toObject();
    const QUrl url = BrowserSecurity::sanitizeUrlForPersistence(QUrl(object.value(QStringLiteral("url")).toString()));
    if (!isSupportedMediaUrl(url)) continue;
    MediaDownloadJob job;
    job.id = QUuid(object.value(QStringLiteral("id")).toString());
    if (job.id.isNull()) job.id = QUuid::createUuid();
    job.url = url;
    job.title = object.value(QStringLiteral("title")).toString().left(240);
    job.targetDirectory = object.value(QStringLiteral("targetDirectory")).toString();
    job.outputPath = object.value(QStringLiteral("outputPath")).toString();
    job.kind = static_cast<MediaDownloadKind>(object.value(QStringLiteral("kind")).toInt());
    job.playlist = object.value(QStringLiteral("playlist")).toBool();
    job.state = static_cast<MediaDownloadState>(object.value(QStringLiteral("state")).toInt());
    if (!isTerminal(job.state)) continue;
    job.statusText = stateText(job.state);
    job.errorText = object.value(QStringLiteral("error")).toString();
    job.createdAt = QDateTime::fromString(object.value(QStringLiteral("createdAt")).toString(), Qt::ISODate);
    jobs_.append(job);
    MediaDownloadRequest request;
    request.url = job.url;
    request.title = job.title;
    request.targetDirectory = job.targetDirectory;
    request.kind = job.kind;
    request.playlist = job.playlist;
    request.formatId = object.value(QStringLiteral("formatId")).toString();
    request.formatExtension = object.value(QStringLiteral("formatExtension")).toString();
    request.formatHeight = object.value(QStringLiteral("formatHeight")).toInt();
    request.formatHasAudio = object.value(QStringLiteral("formatHasAudio")).toBool();
    request.audioFormat = object.value(QStringLiteral("audioFormat")).toString(QStringLiteral("mp3"));
    request.auxiliaryOutputPath = object.value(QStringLiteral("auxiliaryOutputPath")).toString();
    request.subtitles = object.value(QStringLiteral("subtitles")).toBool();
    request.sectionStartSeconds = std::max(0, object.value(QStringLiteral("sectionStartSeconds")).toInt());
    request.sectionEndSeconds = std::max(0, object.value(QStringLiteral("sectionEndSeconds")).toInt());
    request.playlistStart = std::max(1, object.value(QStringLiteral("playlistStart")).toInt(1));
    request.playlistEnd = object.value(QStringLiteral("playlistEnd")).toInt();
    requests_.insert(job.id, request);
  }
}
