#include "translation_secret_store.h"

#include "passwords/credential_vault_manager.h"

#include <QUrl>
#include <algorithm>

namespace {
// Legacy decoding helper strictly for one-time migration from previous temporary schema
QString decodeLegacySecret(const QByteArray &base64Data) {
  if (base64Data.isEmpty()) return QString();
  const QByteArray raw = QByteArray::fromBase64(base64Data);
  QByteArray clear;
  clear.reserve(raw.size());
  constexpr quint8 kMask = 0x5A;
  for (int i = 0; i < raw.size(); ++i) {
    clear.append(static_cast<char>(raw.at(i) ^ (kMask + (i % 7))));
  }
  const QString result = QString::fromUtf8(clear);
  std::fill(clear.begin(), clear.end(), '\0');
  return result;
}
}

TranslationSecretStore::TranslationSecretStore(CredentialVaultManager *vaultManager, QObject *parent)
    : QObject(parent) {
  setVaultManager(vaultManager);
}

void TranslationSecretStore::setVaultManager(CredentialVaultManager *vaultManager) {
  if (vaultManager_ == vaultManager) return;

  if (vaultManager_) {
    disconnect(vaultManager_, nullptr, this, nullptr);
  }

  vaultManager_ = vaultManager;

  if (vaultManager_) {
    connect(vaultManager_, &CredentialVaultManager::lockStateChanged, this, [this](bool locked) {
      emit vaultLockStateChanged(locked);
    });
    connect(vaultManager_, &CredentialVaultManager::changed, this, [this] {
      emit secretChanged(QString());
    });
  }
}

bool TranslationSecretStore::isVaultAvailable() const {
  return vaultManager_ != nullptr && vaultManager_->exists();
}

bool TranslationSecretStore::isVaultLocked() const {
  return !vaultManager_ || vaultManager_->isLocked();
}

QString TranslationSecretStore::translationOrigin() {
  return QStringLiteral("https://translation.ardali.internal");
}

QString TranslationSecretStore::usernameForProvider(const QString &providerId) {
  return QStringLiteral("provider:%1").arg(providerId.toLower().trimmed());
}

bool TranslationSecretStore::saveSecret(const QString &providerId, const QString &apiKey) {
  const QString cleanId = providerId.toLower().trimmed();
  const QString cleanKey = apiKey.trimmed();

  if (cleanKey.isEmpty()) {
    return removeSecret(cleanId);
  }

  if (!vaultManager_ || vaultManager_->isLocked()) {
    return false;
  }

  CredentialSecret secret;
  secret.origin = translationOrigin();
  secret.username = usernameForProvider(cleanId);
  secret.password = cleanKey;

  bool updated = false;
  const bool ok = vaultManager_->save(secret, &updated);
  if (ok) {
    emit secretChanged(cleanId);
  }
  return ok;
}

QString TranslationSecretStore::loadSecret(const QString &providerId) const {
  if (!vaultManager_ || vaultManager_->isLocked()) {
    return QString();
  }

  const QString cleanId = providerId.toLower().trimmed();
  const QString targetUsername = usernameForProvider(cleanId);
  const QVector<CredentialMetadata> records = vaultManager_->forOrigin(QUrl(translationOrigin()));

  for (const CredentialMetadata &meta : records) {
    if (meta.username == targetUsername) {
      CredentialSecret secret;
      if (vaultManager_->reveal(meta.id, &secret)) {
        return secret.password;
      }
    }
  }

  return QString();
}

bool TranslationSecretStore::removeSecret(const QString &providerId) {
  if (!vaultManager_ || vaultManager_->isLocked()) {
    return false;
  }

  const QString cleanId = providerId.toLower().trimmed();
  const QString targetUsername = usernameForProvider(cleanId);
  const QVector<CredentialMetadata> records = vaultManager_->forOrigin(QUrl(translationOrigin()));
  bool removedAny = false;

  for (const CredentialMetadata &meta : records) {
    if (meta.username == targetUsername) {
      if (vaultManager_->remove(meta.id)) {
        removedAny = true;
      }
    }
  }

  if (removedAny) {
    emit secretChanged(cleanId);
  }
  return true;
}

void TranslationSecretStore::migrateLegacySecrets(QSettings &prefs) {
  if (!isVaultAvailable() || isVaultLocked()) {
    return;
  }

  const struct MigrationEntry {
    const char *key;
    const char *providerId;
  } kEntries[] = {
      {"translation/sec_lt", "libretranslate"},
      {"translation/sec_deepl", "deepl"},
      {"translation/sec_gcp", "google_cloud"},
  };

  for (const auto &entry : kEntries) {
    const QString prefKey = QString::fromLatin1(entry.key);
    if (prefs.contains(prefKey)) {
      const QByteArray rawLegacy = prefs.value(prefKey).toByteArray();
      const QString clearSecret = decodeLegacySecret(rawLegacy);

      if (!clearSecret.isEmpty()) {
        if (saveSecret(QLatin1String(entry.providerId), clearSecret)) {
          prefs.remove(prefKey);
        }
      } else {
        prefs.remove(prefKey);
      }
    }
  }
}
