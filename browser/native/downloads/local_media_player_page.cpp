#include "local_media_player_page.h"

#include "audio/web_audio_effects_controller.h"
#include "core/browser_icons.h"

#include <QFileInfo>
#include <QFile>
#include <QBuffer>
#include <QCryptographicHash>
#include <QDir>
#include <QHBoxLayout>
#include <QImageReader>
#include <QJsonArray>
#include <QJsonDocument>
#include <QLabel>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QProcess>
#include <QPushButton>
#include <QStandardPaths>
#include <QTemporaryDir>
#include <QUrl>
#include <QVBoxLayout>
#include <QWebEngineFullScreenRequest>
#include <QWebEnginePage>
#include <QWebEngineProfile>
#include <QWebEngineSettings>
#include <QWebEngineView>

namespace {

class LockedLocalMediaPage final : public QWebEnginePage {
 public:
  LockedLocalMediaPage(QWebEngineProfile *profile, QObject *parent)
      : QWebEnginePage(profile, parent) {
    connect(this, &QWebEnginePage::loadFinished, this,
            [this] { trustedDocumentLoad_ = false; });
  }

  void prepareTrustedDocument(const QUrl &documentUrl) {
    documentUrl_ = documentUrl;
    trustedDocumentLoad_ = true;
  }

 protected:
  bool acceptNavigationRequest(const QUrl &url, NavigationType type, bool isMainFrame) override {
    if (isMainFrame && url != documentUrl_ && url != QUrl(QStringLiteral("about:blank"))) {
      // QWebEngine implements setHtml() as a data: navigation even when a
      // file: base URL is supplied. Permit only that one native-initiated
      // document load; lock the page again as soon as it finishes.
      if (!trustedDocumentLoad_ || url.scheme() != QLatin1String("data")) return false;
    }
    return QWebEnginePage::acceptNavigationRequest(url, type, isMainFrame);
  }

 private:
  QUrl documentUrl_;
  bool trustedDocumentLoad_ = false;
};

QString playerHtml(const LocalMediaOpenRequest &request, const QUrl &mediaUrl) {
  const bool audio = request.playerKind == LocalMediaPlayerKind::Audio;
  const QString element = audio ? QStringLiteral("audio") : QStringLiteral("video");
  const QString title = (request.title.trimmed().isEmpty()
      ? QFileInfo(request.path).completeBaseName() : request.title).toHtmlEscaped();
  const QString source = mediaUrl.toString(QUrl::FullyEncoded).toHtmlEscaped();
  const QString mediaClass = audio ? QStringLiteral("audio") : QStringLiteral("video");
  return QStringLiteral(R"HTML(<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src file:; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>html,body{height:100%;margin:0;background:#0d1319;color:#edf3f8;font-family:system-ui,sans-serif}body{display:grid;place-items:center}.shell{width:min(980px,92vw);text-align:center}.art{margin:auto auto 24px;width:220px;height:220px;overflow:hidden;border-radius:24px;background:linear-gradient(145deg,#244b69,#101820);display:grid;place-items:center;font-size:62px;color:#8ac7f8;box-shadow:0 18px 50px #0008}.art img{width:100%;height:100%;object-fit:cover}.title{font-size:20px;font-weight:700;margin:0 0 8px}.kind{color:#8da1b2;margin:0 0 22px}.audio{width:min(720px,90vw)}.video{display:block;margin:auto;width:min(1100px,92vw);max-height:78vh;background:#000;border-radius:12px}.video-mode .shell{width:min(1200px,94vw)}.video-mode .art{position:fixed;top:24px;right:28px;width:180px;height:102px;margin:0;border-radius:12px;z-index:2;font-size:34px}.video-mode .title{margin-top:0}.video-mode .kind{margin-bottom:16px}@media(max-width:900px){.video-mode .art{top:14px;right:14px;width:128px;height:72px}}#error{color:#ff9aa5;margin-top:16px}</style></head><body class="%7-mode"><main class="shell"><div class="art"><img id="cover" hidden alt="Albüm kapağı"><span id="cover-placeholder">%1</span></div><h1 class="title">%2</h1><p class="kind">%3</p><%4 id="media" class="%5" src="%6" controls autoplay preload="metadata"></%4><p id="error" hidden>Bu medya biçimi veya codec bu sistemde oynatılamıyor.</p></main><script>const m=document.getElementById('media'),e=document.getElementById('error');m.addEventListener('error',()=>e.hidden=false);m.play().catch(()=>{});</script></body></html>)HTML")
      .arg(audio ? QStringLiteral("♫") : QStringLiteral("▶"), title,
           audio ? QStringLiteral("DaliNira Ses Oynatıcı") : QStringLiteral("DaliNira Video Oynatıcı"),
           element, mediaClass, source, mediaClass);
}

}  // namespace

LocalMediaPlayerPage::LocalMediaPlayerPage(const LocalMediaOpenRequest &request,
                                           QWebEngineProfile *profile,
                                           WebAudioEffectsController *audioEffects,
                                           const QString &ffmpegPath,
                                           QWidget *parent)
    : QWidget(parent), mediaPath_(QFileInfo(request.path).canonicalFilePath()),
      ffmpegPath_(ffmpegPath), playerKind_(request.playerKind), audioEffects_(audioEffects) {
  if (profile && profile->isOffTheRecord()) {
    privateArtworkDirectory_ = std::make_unique<QTemporaryDir>();
  }
  setObjectName(QStringLiteral("local-media-player-page"));
  auto *layout = new QVBoxLayout(this);
  layout->setContentsMargins(0, 0, 0, 0);
  layout->setSpacing(0);

  auto *header = new QWidget(this);
  auto *headerLayout = new QHBoxLayout(header);
  headerLayout->setContentsMargins(16, 10, 16, 10);
  fileLabel_ = new QLabel(header);
  headerLayout->addWidget(fileLabel_, 1);
  effectsButton_ = new QPushButton(BrowserIcons::icon(BrowserIcon::Tune),
                                   QStringLiteral("Ses Efektleri"), header);
  connect(effectsButton_, &QPushButton::clicked,
          this, &LocalMediaPlayerPage::audioEffectsRequested);
  headerLayout->addWidget(effectsButton_);
  layout->addWidget(header);

  view_ = new QWebEngineView(this);
  auto *page = new LockedLocalMediaPage(profile ? profile : QWebEngineProfile::defaultProfile(), view_);
  view_->setPage(page);
  connect(view_, &QWebEngineView::loadFinished, this, [this](bool ok) {
    if (ok) updateArtworkInDocument();
  });
  page->settings()->setAttribute(QWebEngineSettings::JavascriptEnabled, true);
  page->settings()->setAttribute(QWebEngineSettings::LocalContentCanAccessFileUrls, true);
  page->settings()->setAttribute(QWebEngineSettings::LocalContentCanAccessRemoteUrls, false);
  page->settings()->setAttribute(QWebEngineSettings::FullScreenSupportEnabled, true);
  connect(page, &QWebEnginePage::fullScreenRequested, this, [this](QWebEngineFullScreenRequest request) {
    request.accept();
    QWidget *top = window();
    if (!top) return;
    if (request.toggleOn()) {
      if (!mediaFullScreen_) {
        windowStateBeforeFullScreen_ = top->windowState();
        windowGeometryBeforeFullScreen_ = top->geometry();
        mediaFullScreen_ = true;
      }
      top->showFullScreen();
      return;
    }
    if (!mediaFullScreen_) return;
    mediaFullScreen_ = false;
    const Qt::WindowStates previousState = windowStateBeforeFullScreen_ & ~Qt::WindowFullScreen;
    if (previousState.testFlag(Qt::WindowMaximized)) {
      top->showMaximized();
    } else {
      top->showNormal();
      if (windowGeometryBeforeFullScreen_.isValid()) top->setGeometry(windowGeometryBeforeFullScreen_);
    }
  });
  layout->addWidget(view_, 1);
  loadMedia(request);
}

LocalMediaPlayerPage::~LocalMediaPlayerPage() {
  ++artworkGeneration_;
  if (artworkReply_) artworkReply_->abort();
  if (artworkProcess_ && artworkProcess_->state() != QProcess::NotRunning) artworkProcess_->kill();
  if (audioEffects_ && view_) audioEffects_->unregisterWebView(view_);
}

void LocalMediaPlayerPage::loadMedia(const LocalMediaOpenRequest &request) {
  const QString canonicalPath = QFileInfo(request.path).canonicalFilePath();
  if (canonicalPath.isEmpty() || request.playerKind == LocalMediaPlayerKind::External) return;

  mediaPath_ = canonicalPath;
  playerKind_ = request.playerKind;
  fileLabel_->setText(QFileInfo(mediaPath_).fileName());
  fileLabel_->setToolTip(mediaPath_);
  effectsButton_->setVisible(true);

  const QUrl mediaUrl = QUrl::fromLocalFile(mediaPath_);
  view_->setProperty("dalinira-trusted-local-media", true);
  if (audioEffects_) audioEffects_->registerWebView(view_, mediaUrl);
  auto *page = static_cast<LockedLocalMediaPage *>(view_->page());
  page->prepareTrustedDocument(mediaUrl);
  view_->stop();
  view_->setHtml(playerHtml(request, mediaUrl), mediaUrl);
  requestArtwork(request);
}

void LocalMediaPlayerPage::requestArtwork(const LocalMediaOpenRequest &request) {
  const quint64 generation = ++artworkGeneration_;
  artworkData_.clear();
  if (artworkProcess_) {
    artworkProcess_->kill();
    artworkProcess_->deleteLater();
    artworkProcess_ = nullptr;
  }
  if (artworkReply_) {
    artworkReply_->abort();
    artworkReply_->deleteLater();
    artworkReply_ = nullptr;
  }

  const QFileInfo media(mediaPath_);
  const QByteArray cacheKey = QCryptographicHash::hash(
      media.canonicalFilePath().toUtf8() + '|' + QByteArray::number(media.size()) + '|'
          + QByteArray::number(media.lastModified().toMSecsSinceEpoch()),
      QCryptographicHash::Sha256).toHex();
  const QString cacheDirectory = privateArtworkDirectory_ && privateArtworkDirectory_->isValid()
      ? privateArtworkDirectory_->path()
      : QDir(QStandardPaths::writableLocation(QStandardPaths::CacheLocation))
            .filePath(QStringLiteral("media-artwork"));
  QDir().mkpath(cacheDirectory);
  const QString cachePath = QDir(cacheDirectory).filePath(QString::fromLatin1(cacheKey) + QStringLiteral(".png"));
  QFile cached(cachePath);
  if (cached.open(QIODevice::ReadOnly) && cached.size() <= 5 * 1024 * 1024) {
    if (setArtworkData(cached.readAll(), generation)) return;
    cached.close();
    QFile::remove(cachePath);
  }

  const QFileInfo ffmpeg(ffmpegPath_);
  if (!ffmpeg.isAbsolute() || !ffmpeg.isExecutable()) {
    requestRemoteArtwork(request.thumbnailUrl, generation);
    return;
  }
  artworkProcess_ = new QProcess(this);
  QProcess *process = artworkProcess_;
  process->setProgram(ffmpeg.absoluteFilePath());
  process->setArguments({QStringLiteral("-v"), QStringLiteral("error"), QStringLiteral("-nostdin"),
      QStringLiteral("-i"), mediaPath_, QStringLiteral("-map"), QStringLiteral("0:v:0?"),
      QStringLiteral("-frames:v"), QStringLiteral("1"), QStringLiteral("-an"),
      QStringLiteral("-vf"), QStringLiteral("scale=512:512:force_original_aspect_ratio=decrease"),
      QStringLiteral("-y"), cachePath});
  connect(process, qOverload<int, QProcess::ExitStatus>(&QProcess::finished), this,
          [this, process, cachePath, thumbnailUrl = request.thumbnailUrl, generation]
          (int exitCode, QProcess::ExitStatus status) {
    if (artworkProcess_ == process) artworkProcess_ = nullptr;
    process->deleteLater();
    if (generation != artworkGeneration_) return;
    QFile extracted(cachePath);
    if (status == QProcess::NormalExit && exitCode == 0 && extracted.open(QIODevice::ReadOnly)
        && extracted.size() > 0 && extracted.size() <= 5 * 1024 * 1024) {
      QFile::setPermissions(cachePath, QFileDevice::ReadOwner | QFileDevice::WriteOwner);
      setArtworkData(extracted.readAll(), generation);
      return;
    }
    QFile::remove(cachePath);
    requestRemoteArtwork(thumbnailUrl, generation);
  });
  connect(process, &QProcess::errorOccurred, this,
          [this, process, thumbnailUrl = request.thumbnailUrl, generation](QProcess::ProcessError error) {
    if (error != QProcess::FailedToStart || artworkProcess_ != process) return;
    artworkProcess_ = nullptr;
    process->deleteLater();
    requestRemoteArtwork(thumbnailUrl, generation);
  });
  process->start();
}

void LocalMediaPlayerPage::requestRemoteArtwork(const QString &thumbnailUrl, quint64 generation) {
  const QUrl url(thumbnailUrl);
  if (generation != artworkGeneration_ || !url.isValid() || !url.userInfo().isEmpty()
      || (url.scheme() != QLatin1String("https") && url.scheme() != QLatin1String("http"))) return;
  if (!artworkNetwork_) artworkNetwork_ = new QNetworkAccessManager(this);
  QNetworkRequest networkRequest(url);
  networkRequest.setAttribute(QNetworkRequest::RedirectPolicyAttribute,
                              QNetworkRequest::NoLessSafeRedirectPolicy);
  networkRequest.setAttribute(QNetworkRequest::CookieLoadControlAttribute, QNetworkRequest::Manual);
  networkRequest.setAttribute(QNetworkRequest::CookieSaveControlAttribute, QNetworkRequest::Manual);
  artworkReply_ = artworkNetwork_->get(networkRequest);
  QNetworkReply *reply = artworkReply_;
  connect(reply, &QNetworkReply::readyRead, this, [reply] {
    if (reply->bytesAvailable() > 5 * 1024 * 1024) reply->abort();
  });
  connect(reply, &QNetworkReply::finished, this, [this, reply, generation] {
    if (artworkReply_ == reply) artworkReply_ = nullptr;
    const QByteArray bytes = reply->error() == QNetworkReply::NoError
        && reply->bytesAvailable() <= 5 * 1024 * 1024 ? reply->readAll() : QByteArray{};
    reply->deleteLater();
    setArtworkData(bytes, generation);
  });
}

bool LocalMediaPlayerPage::setArtworkData(const QByteArray &bytes, quint64 generation) {
  if (generation != artworkGeneration_ || bytes.isEmpty()) return false;
  QBuffer source;
  source.setData(bytes);
  source.open(QIODevice::ReadOnly);
  QImageReader reader(&source);
  const QSize originalSize = reader.size();
  if (!originalSize.isValid() || originalSize.width() > 8192 || originalSize.height() > 8192) return false;
  reader.setScaledSize(originalSize.scaled(QSize(512, 512), Qt::KeepAspectRatio));
  const QImage image = reader.read();
  if (image.isNull()) return false;
  QByteArray png;
  QBuffer destination(&png);
  destination.open(QIODevice::WriteOnly);
  if (!image.save(&destination, "PNG")) return false;
  artworkData_ = png;
  updateArtworkInDocument();
  return true;
}

void LocalMediaPlayerPage::updateArtworkInDocument() {
  if (!view_ || !view_->page() || artworkData_.isEmpty()) return;
  const QString dataUrl = QStringLiteral("data:image/png;base64,")
      + QString::fromLatin1(artworkData_.toBase64());
  QByteArray literal = QJsonDocument(QJsonArray{dataUrl}).toJson(QJsonDocument::Compact);
  literal = literal.mid(1, literal.size() - 2);
  view_->page()->runJavaScript(QStringLiteral(R"JS((function(src){
    const cover=document.getElementById('cover');
    const placeholder=document.getElementById('cover-placeholder');
    if(!cover||!placeholder)return false;
    cover.src=src;cover.hidden=false;placeholder.hidden=true;return true;
  })(%1))JS").arg(QString::fromUtf8(literal)));
}
