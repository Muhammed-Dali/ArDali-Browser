#include "device_keyring.h"

#include <QDBusConnection>
#include <QDBusConnectionInterface>
#include <QMutex>
#include <QMutexLocker>

#include <cstring>

#if defined(DALINIRA_HAS_LIBSECRET)
#pragma push_macro("signals")
#pragma push_macro("slots")
#undef signals
#undef slots
#include <libsecret/secret.h>
#pragma pop_macro("slots")
#pragma pop_macro("signals")
#endif

namespace {
QMutex sMutex;
std::shared_ptr<DeviceKeyring::Provider> sCustomProvider;

#if defined(DALINIRA_HAS_LIBSECRET)
const SecretSchema *daliniraVaultSchema() {
  static const SecretSchema schema = {
    "org.dalinira.Browser.VaultDeviceSecret",
    SECRET_SCHEMA_NONE,
    {
      { "application", SECRET_SCHEMA_ATTRIBUTE_STRING },
      { "vault_id", SECRET_SCHEMA_ATTRIBUTE_STRING },
      { nullptr, static_cast<SecretSchemaAttributeType>(0) },
    },
    0, nullptr, nullptr, nullptr, nullptr, nullptr, nullptr, nullptr
  };
  return &schema;
}
#endif

class DefaultProvider final : public DeviceKeyring::Provider {
 public:
  bool isAvailable() const override {
#if defined(DALINIRA_HAS_LIBSECRET)
    auto bus = QDBusConnection::sessionBus();
    if (!bus.isConnected()) {
      return false;
    }
    auto *iface = bus.interface();
    if (!iface || !iface->isServiceRegistered(QStringLiteral("org.freedesktop.secrets"))) {
      return false;
    }
    return true;
#else
    return false;
#endif
  }

  bool storeSecret(const QString &vaultKeyId, const QByteArray &secret) override {
#if defined(DALINIRA_HAS_LIBSECRET)
    if (!isAvailable() || vaultKeyId.isEmpty() || secret.isEmpty()) {
      return false;
    }
    const QByteArray b64 = secret.toBase64();
    GError *error = nullptr;
    const gboolean res = secret_password_store_sync(
        daliniraVaultSchema(),
        SECRET_COLLECTION_DEFAULT,
        "DaliNira Browser Vault Key",
        b64.constData(),
        nullptr,
        &error,
        "application", "dalinira-browser",
        "vault_id", vaultKeyId.toUtf8().constData(),
        nullptr);
    if (error) {
      g_error_free(error);
      return false;
    }
    return (res == TRUE);
#else
    Q_UNUSED(vaultKeyId);
    Q_UNUSED(secret);
    return false;
#endif
  }

  bool loadSecret(const QString &vaultKeyId, QByteArray *secret) override {
#if defined(DALINIRA_HAS_LIBSECRET)
    if (!secret || !isAvailable() || vaultKeyId.isEmpty()) {
      return false;
    }
    GError *error = nullptr;
    gchar *raw = secret_password_lookup_sync(
        daliniraVaultSchema(),
        nullptr,
        &error,
        "application", "dalinira-browser",
        "vault_id", vaultKeyId.toUtf8().constData(),
        nullptr);
    if (error) {
      g_error_free(error);
      return false;
    }
    if (!raw) {
      return false;
    }
    const QByteArray b64(raw);
    std::memset(raw, 0, std::strlen(raw));
    secret_password_free(raw);
    *secret = QByteArray::fromBase64(b64);
    return !secret->isEmpty();
#else
    Q_UNUSED(vaultKeyId);
    Q_UNUSED(secret);
    return false;
#endif
  }

  bool clearSecret(const QString &vaultKeyId) override {
#if defined(DALINIRA_HAS_LIBSECRET)
    if (!isAvailable() || vaultKeyId.isEmpty()) {
      return false;
    }
    GError *error = nullptr;
    const gboolean res = secret_password_clear_sync(
        daliniraVaultSchema(),
        nullptr,
        &error,
        "application", "dalinira-browser",
        "vault_id", vaultKeyId.toUtf8().constData(),
        nullptr);
    if (error) {
      g_error_free(error);
      return false;
    }
    return (res == TRUE);
#else
    Q_UNUSED(vaultKeyId);
    return false;
#endif
  }
};

DeviceKeyring::Provider *effectiveProvider() {
  if (sCustomProvider) {
    return sCustomProvider.get();
  }
  static DefaultProvider defaultProv;
  return &defaultProv;
}

}  // namespace

bool DeviceKeyring::isAvailable() {
  QMutexLocker locker(&sMutex);
  return effectiveProvider()->isAvailable();
}

bool DeviceKeyring::storeSecret(const QString &vaultKeyId, const QByteArray &secret) {
  QMutexLocker locker(&sMutex);
  return effectiveProvider()->storeSecret(vaultKeyId, secret);
}

bool DeviceKeyring::loadSecret(const QString &vaultKeyId, QByteArray *secret) {
  QMutexLocker locker(&sMutex);
  return effectiveProvider()->loadSecret(vaultKeyId, secret);
}

bool DeviceKeyring::clearSecret(const QString &vaultKeyId) {
  QMutexLocker locker(&sMutex);
  return effectiveProvider()->clearSecret(vaultKeyId);
}

void DeviceKeyring::setCustomProviderForTesting(std::shared_ptr<Provider> provider) {
  QMutexLocker locker(&sMutex);
  sCustomProvider = std::move(provider);
}

void DeviceKeyring::resetCustomProviderForTesting() {
  QMutexLocker locker(&sMutex);
  sCustomProvider.reset();
}
