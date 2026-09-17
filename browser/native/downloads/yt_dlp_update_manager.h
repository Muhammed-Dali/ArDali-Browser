#pragma once

#include <QDateTime>
#include <QJsonObject>
#include <QObject>
#include <QUrl>

class QCryptographicHash;
class QNetworkAccessManager;
class QNetworkReply;
class QProcess;
class QTemporaryFile;
class QTimer;

struct YtDlpReleaseInfo {
  QString version;
  QString artifactName;
  QUrl artifactUrl;
  qint64 artifactSize = 0;
  QString apiSha256;
  QUrl checksumsUrl;
};

class YtDlpUpdateManager final : public QObject {
  Q_OBJECT
 public:
  explicit YtDlpUpdateManager(const QString &managedDirectory = {},
                              QObject *parent = nullptr,
                              QNetworkAccessManager *network = nullptr);
  ~YtDlpUpdateManager() override;

  static QString defaultManagedDirectory();
  static QString platformArtifactName(QString *error = nullptr);
  static bool parseReleaseJson(const QByteArray &json, const QString &artifactName,
                               YtDlpReleaseInfo *release, QString *error = nullptr);
  static QString checksumForArtifact(const QByteArray &checksums, const QString &artifactName);
  static QString sha256File(const QString &path);
  static bool verifyArtifactFile(const QString &path, const QString &artifactName,
                                 const QString &expectedSha256, QString *error = nullptr);

  QString managedDirectory() const;
  QString verifiedManagedExecutable() const;
  QString installedVersion() const;
  bool updateCheckDue() const;
  bool busy() const;

  void ensureInstalled();
  void checkForUpdate();
  void cancel();

 signals:
  void statusChanged(const QString &message, int percent);
  void ready(const QString &absolutePath, bool installedOrUpdated);
  void failed(const QString &message, bool existingVersionUsable);
  void updateCheckFinished(bool updated);

 private:
  enum class Operation { None, EnsureInstall, BackgroundUpdate };
  enum class RequestKind { LatestRelease, Checksums, Artifact };

  bool prepareManagedDirectory(QString *error = nullptr) const;
  bool isAllowedOfficialUrl(const QUrl &url) const;
  void begin(Operation operation);
  void request(RequestKind kind, const QUrl &url, int redirectCount = 0);
  void handleReplyFinished(QNetworkReply *reply, RequestKind kind, int redirectCount);
  void handleLatestRelease();
  void handleChecksums();
  void beginArtifactDownload();
  void handleArtifactFinished();
  void verifyDownloadedVersion();
  void installVerifiedArtifact(const QString &versionOutput);
  void finishNoUpdate();
  void fail(const QString &message);
  void cleanupTransfer();
  bool writeManifest(const QJsonObject &manifest) const;
  void cleanupOldArtifacts(const QJsonObject &manifest) const;
  QJsonObject readManifest() const;
  static QDate versionDate(const QString &version);

  QString managedDirectory_;
  QString manifestPath_;
  QNetworkAccessManager *network_ = nullptr;
  Operation operation_ = Operation::None;
  RequestKind requestKind_ = RequestKind::LatestRelease;
  QNetworkReply *reply_ = nullptr;
  QByteArray responseBytes_;
  YtDlpReleaseInfo release_;
  QString expectedSha256_;
  QString existingPath_;
  QTemporaryFile *temporaryFile_ = nullptr;
  QString temporaryPath_;
  QCryptographicHash *artifactHash_ = nullptr;
  qint64 downloadedBytes_ = 0;
  QProcess *versionProcess_ = nullptr;
  QTimer *versionTimeout_ = nullptr;
  QTimer *networkTimeout_ = nullptr;
  QByteArray versionOutput_;
};
