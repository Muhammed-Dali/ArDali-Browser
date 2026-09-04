#pragma once

#include <QObject>
#include <QPointer>
#include <QSettings>
#include <QString>

#include "passwords/credential_vault_manager.h"

class TranslationSecretStore final : public QObject {
  Q_OBJECT

 public:
  explicit TranslationSecretStore(CredentialVaultManager *vaultManager = nullptr, QObject *parent = nullptr);
  ~TranslationSecretStore() override = default;

  void setVaultManager(CredentialVaultManager *vaultManager);
  CredentialVaultManager *vaultManager() const { return vaultManager_; }

  bool isVaultAvailable() const;
  bool isVaultLocked() const;

  bool saveSecret(const QString &providerId, const QString &apiKey);
  QString loadSecret(const QString &providerId) const;
  bool removeSecret(const QString &providerId);

  void migrateLegacySecrets(QSettings &prefs);

 signals:
  void secretChanged(const QString &providerId);
  void vaultLockStateChanged(bool locked);

 private:
  static QString translationOrigin();
  static QString usernameForProvider(const QString &providerId);

  QPointer<CredentialVaultManager> vaultManager_;
};
