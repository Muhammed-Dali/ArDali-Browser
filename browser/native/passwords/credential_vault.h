#pragma once

#include <QDateTime>
#include <QObject>
#include <QString>
#include <QUrl>
#include <QVector>
#include <QRecursiveMutex>

class QTimer;

struct CredentialMetadata {
  QString id;
  QString origin;
  QString username;
  QDateTime createdAt;
  QDateTime updatedAt;
  QString iconPngBase64;
  QString vaultId;
  QString vaultName;
};

struct CredentialSecret {
  QString origin;
  QString username;
  QString password;
  QString iconPngBase64;
};

// Native-only encrypted credential store.  No web renderer is given a QObject,
// QWebChannel, or a callable API for this class.
class CredentialVault final : public QObject {
  Q_OBJECT
 public:
  explicit CredentialVault(const QString &dataDirectory, QObject *parent = nullptr, const QString &storageId = {});
  ~CredentialVault() override;

  static QString canonicalHttpsOrigin(const QUrl &url);
  static bool isStrongMasterPassword(const QString &password);

  bool exists() const;
  bool isLocked() const;
  int autoLockTimeoutMs() const;
  bool setAutoLockTimeoutMs(int timeoutMs);
  QString lastError() const;
  bool create(const QString &masterPassword);
  bool unlock(const QString &masterPassword);
  void lock();
  bool save(const CredentialSecret &secret, bool *updated = nullptr);
  bool update(const QString &id, const CredentialSecret &secret);
  bool changeMasterPassword(const QString &currentPassword, const QString &nextPassword);
  bool remove(const QString &id);
  bool reset();
  QVector<CredentialMetadata> list() const;
  bool reveal(const QString &id, CredentialSecret *secret) const;
  QVector<CredentialMetadata> forOrigin(const QUrl &url) const;

 signals:
  void lockStateChanged(bool locked);
  void changed();

 private:
  struct Record { QString id; qint64 createdAt = 0; qint64 updatedAt = 0; QByteArray encrypted; QByteArray nonce; QByteArray tag; };
  bool loadEnvelope();
  bool persist();
  bool decryptRecord(const Record &record, CredentialSecret *secret) const;
  bool encryptRecord(Record *record, const CredentialSecret &secret);
  bool setError(const QString &error) const;
  void touch() const;
  void secureClear(QByteArray *value) const;

  QString directory_;
  QString path_;
  mutable QString lastError_;
  QByteArray salt_;
  QByteArray wrappedKey_;
  QByteArray wrappedNonce_;
  QByteArray wrappedTag_;
  mutable QByteArray dataKey_;
  QVector<Record> records_;
  mutable qint64 nextUnlockAtMs_ = 0;
  mutable int failedUnlocks_ = 0;
  mutable qint64 lastActivityMs_ = 0;
  mutable QRecursiveMutex mutex_;
  int autoLockTimeoutMs_ = 5 * 60 * 1000;
  QTimer *idleTimer_ = nullptr;
};
