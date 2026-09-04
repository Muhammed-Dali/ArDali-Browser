#include "media_download_service.h"
#include "yt_dlp_update_manager.h"

#include <QCoreApplication>
#include <QCryptographicHash>
#include <QDir>
#include <QEventLoop>
#include <QFile>
#include <QFileInfo>
#include <QHash>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QProcess>
#include <QTemporaryDir>
#include <QTimer>

#include <cassert>
#include <cstring>
#include <functional>
#include <iostream>

namespace {

struct FakeResponse {
  QByteArray body;
  int status = 200;
  QNetworkReply::NetworkError error = QNetworkReply::NoError;
  QUrl redirect;
};

class FakeReply final : public QNetworkReply {
 public:
  FakeReply(const QNetworkRequest &request, FakeResponse response, QObject *parent)
      : QNetworkReply(parent), response_(std::move(response)) {
    setRequest(request);
    setUrl(request.url());
    setOperation(QNetworkAccessManager::GetOperation);
    setOpenMode(QIODevice::ReadOnly);
    if (response_.status > 0)
      setAttribute(QNetworkRequest::HttpStatusCodeAttribute, response_.status);
    if (response_.redirect.isValid())
      setAttribute(QNetworkRequest::RedirectionTargetAttribute, response_.redirect);
    setHeader(QNetworkRequest::ContentLengthHeader, response_.body.size());
    if (response_.error != QNetworkReply::NoError)
      setError(response_.error, QStringLiteral("synthetic network failure"));
    QTimer::singleShot(0, this, [this] {
      if (aborted_) { emit finished(); return; }
      emit metaDataChanged();
      if (!response_.body.isEmpty()) {
        emit readyRead();
        emit downloadProgress(response_.body.size(), response_.body.size());
      }
      finished_ = true;
      emit finished();
    });
  }

  void abort() override {
    if (finished_) return;
    aborted_ = true;
    setError(QNetworkReply::OperationCanceledError, QStringLiteral("aborted"));
  }

  qint64 bytesAvailable() const override {
    return response_.body.size() - offset_ + QNetworkReply::bytesAvailable();
  }

 protected:
  qint64 readData(char *data, qint64 maximum) override {
    if (offset_ >= response_.body.size()) return -1;
    const qint64 count = qMin(maximum, response_.body.size() - offset_);
    memcpy(data, response_.body.constData() + offset_, static_cast<size_t>(count));
    offset_ += count;
    return count;
  }

 private:
  FakeResponse response_;
  qint64 offset_ = 0;
  bool aborted_ = false;
  bool finished_ = false;
};

class FakeNetworkAccessManager final : public QNetworkAccessManager {
 public:
  QHash<QString, FakeResponse> responses;
  QList<QNetworkRequest> requests;

 protected:
  QNetworkReply *createRequest(Operation operation, const QNetworkRequest &request,
                               QIODevice *outgoingData = nullptr) override {
    Q_UNUSED(operation)
    Q_UNUSED(outgoingData)
    requests.append(request);
    const FakeResponse response = responses.value(request.url().toString(),
        FakeResponse{{}, 0, QNetworkReply::HostNotFoundError, {}});
    return new FakeReply(request, response, this);
  }
};

bool waitFor(const std::function<bool()> &predicate, int timeoutMs = 7000) {
  QEventLoop loop;
  QTimer poll;
  poll.setInterval(10);
  QTimer timeout;
  timeout.setSingleShot(true);
  QObject::connect(&poll, &QTimer::timeout, &loop, [&] { if (predicate()) loop.quit(); });
  QObject::connect(&timeout, &QTimer::timeout, &loop, &QEventLoop::quit);
  poll.start();
  timeout.start(timeoutMs);
  loop.exec();
  return predicate();
}

QByteArray readFile(const QString &path) {
  QFile file(path);
  assert(file.open(QIODevice::ReadOnly));
  return file.readAll();
}

QString digest(const QByteArray &bytes) {
  return QString::fromLatin1(QCryptographicHash::hash(bytes, QCryptographicHash::Sha256).toHex());
}

void configureRelease(FakeNetworkAccessManager *network, const QString &version,
                      const QByteArray &artifactBytes, bool corruptArtifact = false) {
  assert(network);
  QString error;
  const QString artifactName = YtDlpUpdateManager::platformArtifactName(&error);
  assert(!artifactName.isEmpty());
  const QString artifactHash = digest(artifactBytes);
  const QUrl artifactUrl(QStringLiteral("https://github.com/yt-dlp/yt-dlp/releases/download/%1/%2")
      .arg(version, artifactName));
  const QUrl checksumsUrl(QStringLiteral("https://github.com/yt-dlp/yt-dlp/releases/download/%1/SHA2-256SUMS")
      .arg(version));
  const QJsonArray assets{
      QJsonObject{{QStringLiteral("name"), artifactName},
          {QStringLiteral("size"), artifactBytes.size()},
          {QStringLiteral("digest"), QStringLiteral("sha256:") + artifactHash},
          {QStringLiteral("browser_download_url"), artifactUrl.toString()}},
      QJsonObject{{QStringLiteral("name"), QStringLiteral("SHA2-256SUMS")},
          {QStringLiteral("size"), 100},
          {QStringLiteral("browser_download_url"), checksumsUrl.toString()}}};
  const QJsonObject release{{QStringLiteral("tag_name"), version},
      {QStringLiteral("draft"), false}, {QStringLiteral("prerelease"), false},
      {QStringLiteral("immutable"), true}, {QStringLiteral("assets"), assets}};
  network->responses.clear();
  network->responses.insert(QStringLiteral("https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest"),
      {QJsonDocument(release).toJson(QJsonDocument::Compact), 200, QNetworkReply::NoError, {}});
  network->responses.insert(checksumsUrl.toString(),
      {QStringLiteral("%1  %2\n").arg(artifactHash, artifactName).toUtf8(), 200, QNetworkReply::NoError, {}});
  QByteArray delivered = artifactBytes;
  if (corruptArtifact && !delivered.isEmpty()) delivered[delivered.size() / 2] ^= 0x1;
  network->responses.insert(artifactUrl.toString(), {delivered, 200, QNetworkReply::NoError, {}});
}

void makeUpdateDue(const QString &managedDirectory) {
  const QString path = QDir(managedDirectory).filePath(QStringLiteral("yt-dlp-manifest.json"));
  QFile file(path);
  assert(file.open(QIODevice::ReadOnly));
  QJsonObject root = QJsonDocument::fromJson(file.readAll()).object();
  file.close();
  root.insert(QStringLiteral("checkedAt"), QStringLiteral("2000-01-01T00:00:00Z"));
  assert(file.open(QIODevice::WriteOnly | QIODevice::Truncate));
  assert(file.write(QJsonDocument(root).toJson(QJsonDocument::Compact)) > 0);
  file.close();
  assert(QFile::setPermissions(path, QFileDevice::ReadOwner | QFileDevice::WriteOwner));
}

bool hasTemporaryArtifact(const QString &directory) {
  return !QDir(directory).entryList({QStringLiteral(".yt-dlp-download-*")}, QDir::Files).isEmpty();
}

}  // namespace

int main(int argc, char **argv) {
  QCoreApplication app(argc, argv);
  assert(argc == 3 || argc == 4);
  const QString fixtureOne = QFileInfo(QString::fromLocal8Bit(argv[1])).canonicalFilePath();
  const QString fixtureTwo = QFileInfo(QString::fromLocal8Bit(argv[2])).canonicalFilePath();
  assert(!fixtureOne.isEmpty() && !fixtureTwo.isEmpty());
  const QByteArray artifactOne = readFile(fixtureOne);
  const QByteArray artifactTwo = readFile(fixtureTwo);

  if (argc == 4) {
    const QString realTools = QFileInfo(QString::fromLocal8Bit(argv[3])).absoluteFilePath();
    FakeNetworkAccessManager reuseNetwork;
    YtDlpUpdateManager restartedManager(realTools, nullptr, &reuseNetwork);
    const QString verifiedBefore = restartedManager.verifiedManagedExecutable();
    assert(!verifiedBefore.isEmpty() && !restartedManager.updateCheckDue());
    const QFileInfo beforeInfo(verifiedBefore);
    const QString beforeHash = YtDlpUpdateManager::sha256File(verifiedBefore);
    const QDateTime beforeModified = beforeInfo.lastModified();
    const qint64 beforeSize = beforeInfo.size();
    QString reusedPath;
    bool installedOrUpdated = true;
    QObject::connect(&restartedManager, &YtDlpUpdateManager::ready, &app,
                     [&](const QString &path, bool changed) {
      reusedPath = path;
      installedOrUpdated = changed;
    });
    restartedManager.ensureInstalled();
    assert(!restartedManager.busy() && reusedPath == verifiedBefore && !installedOrUpdated);
    assert(reuseNetwork.requests.isEmpty());
    const QFileInfo afterInfo(verifiedBefore);
    assert(afterInfo.size() == beforeSize && afterInfo.lastModified() == beforeModified
        && YtDlpUpdateManager::sha256File(verifiedBefore) == beforeHash);
  }

  QString platformError;
  const QString artifactName = YtDlpUpdateManager::platformArtifactName(&platformError);
  assert(!artifactName.isEmpty());
  YtDlpReleaseInfo parsed;
  QString parseError;
  FakeNetworkAccessManager parserNetwork;
  configureRelease(&parserNetwork, QStringLiteral("2099.01.01"), artifactOne);
  const QByteArray releaseJson = parserNetwork.responses.value(
      QStringLiteral("https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest")).body;
  assert(YtDlpUpdateManager::parseReleaseJson(releaseJson, artifactName, &parsed, &parseError));
  assert(parsed.version == QStringLiteral("2099.01.01"));
  assert(YtDlpUpdateManager::checksumForArtifact(
      QStringLiteral("%1  %2\n").arg(digest(artifactOne), artifactName).toUtf8(), artifactName)
      == digest(artifactOne));
  QTemporaryDir typeCheckRoot;
  assert(typeCheckRoot.isValid());
  const QString wrongTypePath = QDir(typeCheckRoot.path()).filePath(QStringLiteral("artifact"));
  QFile wrongType(wrongTypePath);
  const QByteArray wrongTypeBytes(5000, 'x');
  assert(wrongType.open(QIODevice::WriteOnly) && wrongType.write(wrongTypeBytes) == wrongTypeBytes.size());
  wrongType.close();
  assert(!YtDlpUpdateManager::verifyArtifactFile(wrongTypePath, artifactName, digest(wrongTypeBytes), &parseError));

  QTemporaryDir firstRunRoot;
  assert(firstRunRoot.isValid());
  const QString firstRunTools = QDir(firstRunRoot.path()).filePath(QStringLiteral("tools"));
  FakeNetworkAccessManager firstRunNetwork;
  configureRelease(&firstRunNetwork, QStringLiteral("2099.01.01"), artifactOne);
  YtDlpUpdateManager firstRunManager(firstRunTools, nullptr, &firstRunNetwork);
  QString installedPath;
  bool firstRunFailed = false;
  QString firstRunFailureMessage;
  QObject::connect(&firstRunManager, &YtDlpUpdateManager::ready, &app,
                   [&](const QString &path, bool changed) { if (changed) installedPath = path; });
  QObject::connect(&firstRunManager, &YtDlpUpdateManager::failed, &app,
                   [&](const QString &message, bool) { firstRunFailed = true; firstRunFailureMessage = message; });
  bool eventLoopResponsive = false;
  QTimer::singleShot(0, &app, [&] { eventLoopResponsive = true; });
  firstRunManager.ensureInstalled();
  assert(waitFor([&] { return firstRunFailed || !installedPath.isEmpty(); }));
  if (firstRunFailed) std::cerr << "first-run failure: " << firstRunFailureMessage.toStdString() << '\n';
  assert(!firstRunFailed && eventLoopResponsive);
  assert(installedPath == firstRunManager.verifiedManagedExecutable());
  assert(firstRunManager.installedVersion() == QStringLiteral("2099.01.01"));
  assert(!firstRunManager.updateCheckDue());
  assert(!hasTemporaryArtifact(firstRunTools));
  const auto directoryPermissions = QFileInfo(firstRunTools).permissions();
  assert(!(directoryPermissions & (QFileDevice::ReadGroup | QFileDevice::WriteGroup | QFileDevice::ExeGroup
                                   | QFileDevice::ReadOther | QFileDevice::WriteOther | QFileDevice::ExeOther)));
  for (const QNetworkRequest &request : firstRunNetwork.requests) {
    assert(request.url().scheme() == QLatin1String("https"));
    assert(!request.url().toString().contains(QStringLiteral("synthetic-secret")));
    assert(request.rawHeader("Cookie").isEmpty());
  }

  QTemporaryDir hashFailureRoot;
  assert(hashFailureRoot.isValid());
  FakeNetworkAccessManager hashFailureNetwork;
  configureRelease(&hashFailureNetwork, QStringLiteral("2099.01.01"), artifactOne, true);
  YtDlpUpdateManager hashFailureManager(QDir(hashFailureRoot.path()).filePath(QStringLiteral("tools")),
                                        nullptr, &hashFailureNetwork);
  bool hashFailed = false;
  QObject::connect(&hashFailureManager, &YtDlpUpdateManager::failed, &app,
                   [&](const QString &, bool usable) { hashFailed = !usable; });
  hashFailureManager.ensureInstalled();
  assert(waitFor([&] { return hashFailed; }));
  assert(hashFailureManager.verifiedManagedExecutable().isEmpty());
  assert(!hasTemporaryArtifact(hashFailureManager.managedDirectory()));

  QTemporaryDir versionFailureRoot;
  assert(versionFailureRoot.isValid());
  FakeNetworkAccessManager versionFailureNetwork;
  configureRelease(&versionFailureNetwork, QStringLiteral("2099.03.03"), artifactOne);
  YtDlpUpdateManager versionFailureManager(QDir(versionFailureRoot.path()).filePath(QStringLiteral("tools")),
                                           nullptr, &versionFailureNetwork);
  bool versionFailed = false;
  QObject::connect(&versionFailureManager, &YtDlpUpdateManager::failed, &app,
                   [&](const QString &, bool usable) { versionFailed = !usable; });
  versionFailureManager.ensureInstalled();
  assert(waitFor([&] { return versionFailed; }));
  assert(versionFailureManager.verifiedManagedExecutable().isEmpty());
  assert(!hasTemporaryArtifact(versionFailureManager.managedDirectory()));

  QTemporaryDir networkFailureRoot;
  assert(networkFailureRoot.isValid());
  FakeNetworkAccessManager networkFailureNetwork;
  YtDlpUpdateManager networkFailureManager(QDir(networkFailureRoot.path()).filePath(QStringLiteral("tools")),
                                            nullptr, &networkFailureNetwork);
  bool networkFailedWithoutFallback = false;
  QObject::connect(&networkFailureManager, &YtDlpUpdateManager::failed, &app,
                   [&](const QString &, bool usable) { networkFailedWithoutFallback = !usable; });
  networkFailureManager.ensureInstalled();
  assert(waitFor([&] { return networkFailedWithoutFallback; }));

  QTemporaryDir cancelledRoot;
  assert(cancelledRoot.isValid());
  FakeNetworkAccessManager cancelledNetwork;
  configureRelease(&cancelledNetwork, QStringLiteral("2099.01.01"), artifactOne);
  YtDlpUpdateManager cancelledManager(QDir(cancelledRoot.path()).filePath(QStringLiteral("tools")),
                                      nullptr, &cancelledNetwork);
  cancelledManager.ensureInstalled();
  assert(cancelledManager.busy());
  cancelledManager.cancel();
  assert(!cancelledManager.busy() && !hasTemporaryArtifact(cancelledManager.managedDirectory()));

  makeUpdateDue(firstRunTools);
  configureRelease(&firstRunNetwork, QStringLiteral("2099.01.01"), artifactOne);
  firstRunNetwork.requests.clear();
  bool noUpdateFinished = false;
  QObject::connect(&firstRunManager, &YtDlpUpdateManager::updateCheckFinished, &app,
                   [&](bool updated) { if (!updated) noUpdateFinished = true; });
  firstRunManager.checkForUpdate();
  assert(waitFor([&] { return noUpdateFinished; }));
  assert(firstRunNetwork.requests.size() == 1);

  makeUpdateDue(firstRunTools);
  configureRelease(&firstRunNetwork, QStringLiteral("2099.02.02"), artifactTwo);
  const QString oldPath = installedPath;
  QProcess activeOldProcess;
  activeOldProcess.setProgram(oldPath);
  activeOldProcess.setArguments({QStringLiteral("--hold")});
  activeOldProcess.start();
  assert(activeOldProcess.waitForStarted(2000));
  QString updatedPath;
  QObject::connect(&firstRunManager, &YtDlpUpdateManager::ready, &app,
                   [&](const QString &path, bool changed) { if (changed && path != oldPath) updatedPath = path; });
  firstRunManager.checkForUpdate();
  assert(waitFor([&] { return !updatedPath.isEmpty(); }));
  assert(updatedPath != oldPath && QFileInfo::exists(oldPath));
  assert(activeOldProcess.state() == QProcess::Running);
  assert(firstRunManager.installedVersion() == QStringLiteral("2099.02.02"));
  assert(activeOldProcess.waitForFinished(6000));

  makeUpdateDue(firstRunTools);
  firstRunNetwork.responses.clear();
  bool failedWithFallback = false;
  QObject::connect(&firstRunManager, &YtDlpUpdateManager::failed, &app,
                   [&](const QString &, bool usable) { failedWithFallback = usable; });
  firstRunManager.checkForUpdate();
  assert(waitFor([&] { return failedWithFallback; }));
  assert(firstRunManager.verifiedManagedExecutable() == updatedPath);

  QTemporaryDir serviceRoot;
  assert(serviceRoot.isValid());
  const QString serviceTools = QDir(serviceRoot.path()).filePath(QStringLiteral("tools"));
  const QString downloads = QDir(serviceRoot.path()).filePath(QStringLiteral("downloads"));
  assert(QDir().mkpath(downloads));
  FakeNetworkAccessManager serviceNetwork;
  configureRelease(&serviceNetwork, QStringLiteral("2099.01.01"), artifactOne);
  YtDlpUpdateManager serviceManager(serviceTools, nullptr, &serviceNetwork);
  MediaDownloadService service(downloads, nullptr,
      {QStringLiteral("/definitely/missing/yt-dlp")}, {},
      QDir(serviceRoot.path()).filePath(QStringLiteral("history.json")), &serviceManager);
  bool analysisReady = false;
  bool analysisFailed = false;
  QObject::connect(&service, &MediaDownloadService::analysisReady, &app,
                   [&](const MediaAnalysisResult &result) { analysisReady = result.id == QStringLiteral("managed-fixture"); });
  QObject::connect(&service, &MediaDownloadService::analysisFailed, &app,
                   [&](const QString &) { analysisFailed = true; });
  assert(service.analyze(QUrl(QStringLiteral("https://example.com/watch?v=first-run&secret=synthetic-secret"))));
  assert(waitFor([&] { return analysisReady || analysisFailed; }));
  assert(analysisReady && !analysisFailed && service.ytDlpAvailable());
  for (const QNetworkRequest &request : serviceNetwork.requests)
    assert(!request.url().toString().contains(QStringLiteral("first-run"))
           && !request.url().toString().contains(QStringLiteral("synthetic-secret")));

  std::cout << "managed yt-dlp first-run, hash, network fail-safe, atomic update and auto-resume: ok\n";
  return 0;
}
