#pragma once

#include "credential_vault.h"

#include <QObject>
#include <QStringList>
#include <QVector>

struct VaultMetadata {
  QString id;
  QString name;
  bool locked = true;
};

// Native-only collection of independently encrypted credential vaults. Each
// entry owns a different CredentialVault instance, data key, and master
// password; a record id returned by this facade is namespaced by vault id.
class CredentialVaultManager final : public QObject {
  Q_OBJECT
 public:
  explicit CredentialVaultManager(const QString &dataDirectory, QObject *parent = nullptr);

  static QString canonicalHttpsOrigin(const QUrl &url) { return CredentialVault::canonicalHttpsOrigin(url); }
  static bool isStrongMasterPassword(const QString &password) { return CredentialVault::isStrongMasterPassword(password); }

  QVector<VaultMetadata> vaults() const;
  QString activeVaultId() const;
  bool setActiveVault(const QString &id);
  bool exists() const;
  bool isLocked() const;
  bool isVaultLocked(const QString &id) const;
  QString lastError() const;
  int autoLockTimeoutMs() const;
  bool setAutoLockTimeoutMs(int timeoutMs);

  bool create(const QString &masterPassword);
  bool createVault(const QString &name, const QString &masterPassword, QString *id = nullptr);
  bool unlock(const QString &masterPassword);
  bool unlockVault(const QString &id, const QString &masterPassword);
  void lock();
  void lockVault(const QString &id);
  bool deleteVault(const QString &id);
  bool clearActiveVault();
  bool exportBackup(const QString &filePath, const QString &backupPassword) const;
  bool importBackup(const QString &filePath, const QString &backupPassword, QStringList *importedVaultNames = nullptr);

  bool save(const CredentialSecret &secret, bool *updated = nullptr);
  bool saveToVault(const QString &vaultId, const CredentialSecret &secret, bool *updated = nullptr);
  bool update(const QString &recordId, const CredentialSecret &secret);
  bool changeMasterPassword(const QString &currentPassword, const QString &nextPassword);
  bool remove(const QString &recordId);
  bool reset();
  QVector<CredentialMetadata> list() const;
  bool reveal(const QString &recordId, CredentialSecret *secret) const;
  QVector<CredentialMetadata> forOrigin(const QUrl &url) const;
  QVector<VaultMetadata> vaultsForOrigin(const QUrl &url) const;

 signals:
  void lockStateChanged(bool locked);
  void changed();

 private:
  struct Entry { QString id; QString name; CredentialVault *vault = nullptr; bool legacyStorage = false; };
  bool loadIndex();
  bool persistIndex();
  Entry *entry(const QString &id);
  const Entry *entry(const QString &id) const;
  Entry *activeEntry();
  const Entry *activeEntry() const;
  static QString namespacedId(const QString &vaultId, const QString &recordId);
  static bool splitId(const QString &id, QString *vaultId, QString *recordId);
  void attach(Entry *entry);
  bool setError(const QString &error) const;

  QString dataDirectory_;
  QString indexPath_;
  QVector<Entry> entries_;
  QString activeId_;
  mutable QString lastError_;
};
