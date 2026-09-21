#pragma once

#include <QByteArray>
#include <QString>
#include <memory>

// OS Keyring / Device-bound secret service abstraction.
// On Linux desktop systems supporting the FreeDesktop Secret Service API
// (GNOME Keyring, KDE KWallet / ksecretd), this protects a per-vault
// 256-bit cryptographic device secret in the user's login session keyring.
// The device secret is bound with the user's master password to derive the
// vault key, ensuring offline attackers who steal the vault file cannot
// decrypt credentials without access to the device-bound secret.
class DeviceKeyring {
 public:
  class Provider {
   public:
    virtual ~Provider() = default;
    virtual bool isAvailable() const = 0;
    virtual bool storeSecret(const QString &vaultKeyId, const QByteArray &secret) = 0;
    virtual bool loadSecret(const QString &vaultKeyId, QByteArray *secret) = 0;
    virtual bool clearSecret(const QString &vaultKeyId) = 0;
  };

  static bool isAvailable();
  static bool storeSecret(const QString &vaultKeyId, const QByteArray &secret);
  static bool loadSecret(const QString &vaultKeyId, QByteArray *secret);
  static bool clearSecret(const QString &vaultKeyId);

  static void setCustomProviderForTesting(std::shared_ptr<Provider> provider);
  static void resetCustomProviderForTesting();
};
