#include "credential_vault.h"

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QSaveFile>
#include <QSettings>
#include <QMutexLocker>
#include <QTimer>
#include <QUuid>

#include <openssl/evp.h>
#include <openssl/crypto.h>
#include <openssl/rand.h>

namespace {
constexpr int kPbkdf2Iterations = 600000;
constexpr int kKeyBytes = 32;
constexpr int kNonceBytes = 12;
constexpr int kTagBytes = 16;
constexpr qint64 kMaxVaultBytes = 16 * 1024 * 1024;
constexpr int kMaxRecords = 1000;
constexpr int kMaxIconBase64Chars = 16 * 1024;

QByteArray b64(const QByteArray &value) { return value.toBase64(); }
QByteArray fromB64(const QJsonValue &value) { return QByteArray::fromBase64(value.toString().toLatin1()); }
bool randomBytes(QByteArray *out, int size) { out->resize(size); return RAND_bytes(reinterpret_cast<unsigned char *>(out->data()), size) == 1; }
bool deriveKey(const QString &password, const QByteArray &salt, QByteArray *key) {
  const QByteArray utf8 = password.toUtf8(); key->resize(kKeyBytes);
  return PKCS5_PBKDF2_HMAC(utf8.constData(), utf8.size(), reinterpret_cast<const unsigned char *>(salt.constData()), salt.size(),
                           kPbkdf2Iterations, EVP_sha256(), kKeyBytes, reinterpret_cast<unsigned char *>(key->data())) == 1;
}
bool aesGcm(bool encrypt, const QByteArray &key, const QByteArray &nonce, const QByteArray &input, const QByteArray &aad,
            QByteArray *output, QByteArray *tag) {
  EVP_CIPHER_CTX *ctx = EVP_CIPHER_CTX_new(); if (!ctx) return false;
  int size = 0, finalSize = 0; bool ok = false; output->resize(input.size() + kTagBytes);
  do {
    if (EVP_CipherInit_ex(ctx, EVP_aes_256_gcm(), nullptr, nullptr, nullptr, encrypt ? 1 : 0) != 1) break;
    if (EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_SET_IVLEN, nonce.size(), nullptr) != 1) break;
    if (EVP_CipherInit_ex(ctx, nullptr, nullptr, reinterpret_cast<const unsigned char *>(key.constData()), reinterpret_cast<const unsigned char *>(nonce.constData()), -1) != 1) break;
    if (!aad.isEmpty() && EVP_CipherUpdate(ctx, nullptr, &size, reinterpret_cast<const unsigned char *>(aad.constData()), aad.size()) != 1) break;
    if (EVP_CipherUpdate(ctx, reinterpret_cast<unsigned char *>(output->data()), &size, reinterpret_cast<const unsigned char *>(input.constData()), input.size()) != 1) break;
    if (!encrypt && (tag->size() != kTagBytes || EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_SET_TAG, kTagBytes, tag->data()) != 1)) break;
    if (EVP_CipherFinal_ex(ctx, reinterpret_cast<unsigned char *>(output->data()) + size, &finalSize) != 1) break;
    output->resize(size + finalSize);
    if (encrypt) { tag->resize(kTagBytes); if (EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_GET_TAG, kTagBytes, tag->data()) != 1) break; }
    ok = true;
  } while (false);
  EVP_CIPHER_CTX_free(ctx); return ok;
}
QString recordAad(const QString &id) { return QStringLiteral("ardali-vault-record:") + id; }
}

CredentialVault::CredentialVault(const QString &dataDirectory, QObject *parent, const QString &storageId)
    : QObject(parent), directory_(storageId.isEmpty() ? dataDirectory + QStringLiteral("/credential-vault") : dataDirectory + QStringLiteral("/credential-vault/vaults/") + storageId), path_(directory_ + QStringLiteral("/vault-v2.json")) {
  const int configured = QSettings().value(QStringLiteral("browser/passwords/autoLockMs"), autoLockTimeoutMs_).toInt();
  if (configured == 60000 || configured == 5 * 60000 || configured == 15 * 60000 || configured == 30 * 60000) autoLockTimeoutMs_ = configured;
  idleTimer_ = new QTimer(this); idleTimer_->setInterval(15000);
  connect(idleTimer_, &QTimer::timeout, this, [this] { if (!isLocked() && QDateTime::currentMSecsSinceEpoch() - lastActivityMs_ >= autoLockTimeoutMs_) lock(); });
  idleTimer_->start();
}
CredentialVault::~CredentialVault() { lock(); }

QString CredentialVault::canonicalHttpsOrigin(const QUrl &url) {
  if (!url.isValid() || url.scheme().compare(QStringLiteral("https"), Qt::CaseInsensitive) != 0 || url.host().isEmpty() || url.userName().size() || url.password().size()) return {};
  QUrl origin; origin.setScheme(QStringLiteral("https")); origin.setHost(url.host().toLower()); if (url.port() > 0 && url.port() != 443) origin.setPort(url.port());
  return origin.toString(QUrl::RemovePath | QUrl::RemoveQuery | QUrl::RemoveFragment).remove(QRegularExpression("/$"));
}
bool CredentialVault::isStrongMasterPassword(const QString &p) { return p.size() >= 12 && p.size() <= 256 && p.contains(QRegularExpression("[a-z]")) && p.contains(QRegularExpression("[A-Z]")) && p.contains(QRegularExpression("[0-9]")) && p.contains(QRegularExpression("[^A-Za-z0-9\\s]")); }
bool CredentialVault::exists() const { return QFileInfo::exists(path_); }
bool CredentialVault::isLocked() const { QMutexLocker locker(&mutex_); return dataKey_.isEmpty(); }
int CredentialVault::autoLockTimeoutMs() const { QMutexLocker locker(&mutex_); return autoLockTimeoutMs_; }
bool CredentialVault::setAutoLockTimeoutMs(int timeoutMs) {
  QMutexLocker locker(&mutex_);
  if (timeoutMs != 60000 && timeoutMs != 5 * 60000 && timeoutMs != 15 * 60000 && timeoutMs != 30 * 60000) return setError(QStringLiteral("invalid-auto-lock-timeout"));
  autoLockTimeoutMs_ = timeoutMs; QSettings().setValue(QStringLiteral("browser/passwords/autoLockMs"), timeoutMs); touch(); return true;
}
QString CredentialVault::lastError() const { QMutexLocker locker(&mutex_); return lastError_; }
bool CredentialVault::setError(const QString &error) const { QMutexLocker locker(&mutex_); lastError_ = error; return false; }
void CredentialVault::secureClear(QByteArray *value) const { if (!value) return; std::fill(value->begin(), value->end(), '\0'); value->clear(); }
void CredentialVault::touch() const { lastActivityMs_ = QDateTime::currentMSecsSinceEpoch(); }

bool CredentialVault::create(const QString &masterPassword) {
  QMutexLocker locker(&mutex_);
  if (exists()) return setError(QStringLiteral("vault-exists"));
  if (!isStrongMasterPassword(masterPassword)) return setError(QStringLiteral("weak-master-password"));
  QByteArray wrapKey, rawKey; if (!randomBytes(&salt_, 16) || !deriveKey(masterPassword, salt_, &wrapKey) || !randomBytes(&rawKey, kKeyBytes) || !randomBytes(&wrappedNonce_, kNonceBytes)) { secureClear(&wrapKey); secureClear(&rawKey); return setError(QStringLiteral("crypto-failed")); }
  if (!aesGcm(true, wrapKey, wrappedNonce_, rawKey, QByteArrayLiteral("ardali-vault-key-v2"), &wrappedKey_, &wrappedTag_)) { secureClear(&wrapKey); secureClear(&rawKey); return setError(QStringLiteral("crypto-failed")); }
  secureClear(&wrapKey); dataKey_ = rawKey; records_.clear(); touch();
  if (!persist()) { lock(); return false; } emit lockStateChanged(false); emit changed(); return true;
}
bool CredentialVault::loadEnvelope() {
  const auto parse = [this](const QString &candidate) {
    const QFileInfo info(candidate);
    if (!info.isFile() || info.isSymLink() || info.size() <= 0 || info.size() > kMaxVaultBytes) return false;
    QFile file(candidate); if (!file.open(QIODevice::ReadOnly)) return false;
    const QJsonObject root = QJsonDocument::fromJson(file.readAll()).object();
    if (root.value("schemaVersion").toInt() != 2 || root.value("kdf").toString() != QLatin1String("PBKDF2-HMAC-SHA256") || root.value("iterations").toInt() != kPbkdf2Iterations) return false;
    const QByteArray salt = fromB64(root.value("salt")), wrapped = fromB64(root.value("wrappedKey")), nonce = fromB64(root.value("wrappedNonce")), tag = fromB64(root.value("wrappedTag"));
    const QJsonArray entries = root.value("records").toArray(); if (salt.size() != 16 || nonce.size() != kNonceBytes || tag.size() != kTagBytes || wrapped.isEmpty() || entries.size() > kMaxRecords) return false;
    QVector<Record> parsed; QSet<QString> ids;
    for (const QJsonValue &value : entries) { const QJsonObject o = value.toObject(); Record r{o.value("id").toString(), o.value("createdAt").toVariant().toLongLong(), o.value("updatedAt").toVariant().toLongLong(), fromB64(o.value("ciphertext")), fromB64(o.value("nonce")), fromB64(o.value("tag"))}; if (r.id.isEmpty() || ids.contains(r.id) || r.nonce.size() != kNonceBytes || r.tag.size() != kTagBytes || r.encrypted.isEmpty()) return false; ids.insert(r.id); parsed.append(std::move(r)); }
    salt_ = salt; wrappedKey_ = wrapped; wrappedNonce_ = nonce; wrappedTag_ = tag; records_ = std::move(parsed); return true;
  };
  if (parse(path_)) return true;
  if (parse(path_ + QStringLiteral(".bak"))) { lastError_ = QStringLiteral("vault-recovered-from-backup"); return true; }
  return setError(QStringLiteral("invalid-vault"));
}
bool CredentialVault::unlock(const QString &masterPassword) {
  QMutexLocker locker(&mutex_);
  const qint64 now = QDateTime::currentMSecsSinceEpoch(); if (now < nextUnlockAtMs_) return setError(QStringLiteral("unlock-rate-limited"));
  if (!exists() || !loadEnvelope()) return false;
  QByteArray wrapKey, key;
  const bool ok = deriveKey(masterPassword, salt_, &wrapKey) && aesGcm(false, wrapKey, wrappedNonce_, wrappedKey_, QByteArrayLiteral("ardali-vault-key-v2"), &key, &wrappedTag_) && key.size() == kKeyBytes;
  secureClear(&wrapKey); if (!ok) { secureClear(&key); failedUnlocks_ = std::min(8, failedUnlocks_ + 1); nextUnlockAtMs_ = now + std::min<qint64>(30000, 500 * (1LL << (failedUnlocks_ - 1))); return setError(QStringLiteral("invalid-master-password")); }
  lock(); dataKey_ = key; failedUnlocks_ = 0; nextUnlockAtMs_ = 0; touch(); emit lockStateChanged(false); return true;
}
void CredentialVault::lock() { QMutexLocker locker(&mutex_); const bool wasUnlocked = !dataKey_.isEmpty(); secureClear(&dataKey_); lastActivityMs_ = 0; if (wasUnlocked) emit lockStateChanged(true); }
bool CredentialVault::encryptRecord(Record *record, const CredentialSecret &secret) { const QString icon = secret.iconPngBase64.left(kMaxIconBase64Chars); QByteArray plain = QJsonDocument(QJsonObject{{"origin", secret.origin}, {"username", secret.username}, {"password", secret.password}, {"icon", icon}}).toJson(QJsonDocument::Compact); if (!randomBytes(&record->nonce, kNonceBytes) || !aesGcm(true, dataKey_, record->nonce, plain, recordAad(record->id).toUtf8(), &record->encrypted, &record->tag)) { secureClear(&plain); return false; } secureClear(&plain); return true; }
bool CredentialVault::decryptRecord(const Record &record, CredentialSecret *secret) const { if (!secret || isLocked()) return false; QByteArray plain, tag = record.tag; if (!aesGcm(false, dataKey_, record.nonce, record.encrypted, recordAad(record.id).toUtf8(), &plain, &tag)) { secureClear(&plain); return false; } const QJsonObject o = QJsonDocument::fromJson(plain).object(); secureClear(&plain); const QUrl origin(o.value("origin").toString()); const QString canonical = canonicalHttpsOrigin(origin); const QString username = o.value("username").toString(); const QString password = o.value("password").toString(); const QString icon = o.value("icon").toString(); if (canonical.isEmpty() || username.isEmpty() || password.isEmpty() || password.size() > 4096 || icon.size() > kMaxIconBase64Chars) return false; *secret = {canonical, username, password, icon}; return true; }
bool CredentialVault::persist() {
  QDir().mkpath(directory_); QFile::setPermissions(directory_, QFileDevice::ReadOwner | QFileDevice::WriteOwner | QFileDevice::ExeOwner);
  QJsonArray records; for (const Record &r : records_) records.append(QJsonObject{{"id", r.id}, {"createdAt", QString::number(r.createdAt)}, {"updatedAt", QString::number(r.updatedAt)}, {"ciphertext", QString::fromLatin1(b64(r.encrypted))}, {"nonce", QString::fromLatin1(b64(r.nonce))}, {"tag", QString::fromLatin1(b64(r.tag))}});
  const QJsonObject root{{"schemaVersion", 2}, {"kdf", "PBKDF2-HMAC-SHA256"}, {"iterations", kPbkdf2Iterations}, {"salt", QString::fromLatin1(b64(salt_))}, {"wrappedKey", QString::fromLatin1(b64(wrappedKey_))}, {"wrappedNonce", QString::fromLatin1(b64(wrappedNonce_))}, {"wrappedTag", QString::fromLatin1(b64(wrappedTag_))}, {"records", records}};
  if (QFile::exists(path_)) { QFile::remove(path_ + QStringLiteral(".bak")); QFile::copy(path_, path_ + QStringLiteral(".bak")); QFile::setPermissions(path_ + QStringLiteral(".bak"), QFileDevice::ReadOwner | QFileDevice::WriteOwner); }
  QSaveFile file(path_); const QByteArray bytes = QJsonDocument(root).toJson(QJsonDocument::Compact);
  if (!file.open(QIODevice::WriteOnly) || file.write(bytes) != bytes.size() || !file.commit()) return setError(QStringLiteral("write-failed"));
  QFile::setPermissions(path_, QFileDevice::ReadOwner | QFileDevice::WriteOwner); return true;
}
bool CredentialVault::save(const CredentialSecret &input, bool *updated) {
  QMutexLocker locker(&mutex_);
  if (isLocked()) return setError(QStringLiteral("vault-locked"));
  const QString origin = canonicalHttpsOrigin(QUrl(input.origin));
  const QString username = input.username.trimmed();
  if (origin.isEmpty() || username.isEmpty() || input.password.isEmpty() || input.password.size() > 4096) return setError(QStringLiteral("invalid-credential"));
  Record *target = nullptr; QString existingIcon;
  for (Record &r : records_) { CredentialSecret old; if (!decryptRecord(r, &old)) return setError(QStringLiteral("corrupt-vault")); if (old.origin == origin && old.username == username) { target = &r; existingIcon = old.iconPngBase64; break; } }
  const qint64 now = QDateTime::currentMSecsSinceEpoch(); const bool isUpdate = target != nullptr;
  if (!target) { if (records_.size() >= kMaxRecords) return setError(QStringLiteral("vault-full")); Record added; added.id = QUuid::createUuid().toString(QUuid::WithoutBraces); added.createdAt = now; added.updatedAt = now; records_.append(std::move(added)); target = &records_.last(); }
  target->updatedAt = now;
  if (!encryptRecord(target, {origin, username, input.password, input.iconPngBase64.isEmpty() ? existingIcon : input.iconPngBase64}) || !persist()) return setError(QStringLiteral("write-failed"));
  if (updated) *updated = isUpdate;
  touch();
  emit changed();
  return true;
}
bool CredentialVault::update(const QString &id, const CredentialSecret &input) {
  QMutexLocker locker(&mutex_);
  if (isLocked()) return setError(QStringLiteral("vault-locked"));
  const QString origin = canonicalHttpsOrigin(QUrl(input.origin)); const QString username = input.username.trimmed();
  if (origin.isEmpty() || username.isEmpty() || input.password.isEmpty() || input.password.size() > 4096) return setError(QStringLiteral("invalid-credential"));
  Record *target = nullptr; QString existingIcon;
  for (Record &record : records_) {
    CredentialSecret current;
    if (!decryptRecord(record, &current)) return setError(QStringLiteral("corrupt-vault"));
    if (record.id == id) { target = &record; existingIcon = current.iconPngBase64; }
    if (record.id != id && current.origin == origin && current.username == username) return setError(QStringLiteral("duplicate-credential"));
  }
  if (!target) return setError(QStringLiteral("record-not-found"));
  target->updatedAt = QDateTime::currentMSecsSinceEpoch();
  if (!encryptRecord(target, {origin, username, input.password, input.iconPngBase64.isEmpty() ? existingIcon : input.iconPngBase64}) || !persist()) return setError(QStringLiteral("write-failed"));
  touch(); emit changed(); return true;
}
bool CredentialVault::changeMasterPassword(const QString &currentPassword, const QString &nextPassword) {
  QMutexLocker locker(&mutex_);
  if (isLocked()) return setError(QStringLiteral("vault-locked"));
  if (!isStrongMasterPassword(nextPassword)) return setError(QStringLiteral("weak-master-password"));
  QByteArray oldWrap, verifiedKey, newSalt, newWrap, newNonce, newCipher, newTag;
  const bool verified = deriveKey(currentPassword, salt_, &oldWrap)
      && aesGcm(false, oldWrap, wrappedNonce_, wrappedKey_, QByteArrayLiteral("ardali-vault-key-v2"), &verifiedKey, &wrappedTag_)
      && verifiedKey.size() == dataKey_.size()
      && CRYPTO_memcmp(verifiedKey.constData(), dataKey_.constData(), size_t(dataKey_.size())) == 0;
  secureClear(&oldWrap); secureClear(&verifiedKey);
  if (!verified || !randomBytes(&newSalt, 16) || !deriveKey(nextPassword, newSalt, &newWrap) || !randomBytes(&newNonce, kNonceBytes)
      || !aesGcm(true, newWrap, newNonce, dataKey_, QByteArrayLiteral("ardali-vault-key-v2"), &newCipher, &newTag)) {
    secureClear(&newSalt); secureClear(&newWrap); secureClear(&newNonce); secureClear(&newCipher); secureClear(&newTag); return setError(QStringLiteral("invalid-master-password"));
  }
  secureClear(&newWrap); salt_ = newSalt; wrappedNonce_ = newNonce; wrappedKey_ = newCipher; wrappedTag_ = newTag;
  if (!persist()) return false;
  touch(); emit changed(); return true;
}
QVector<CredentialMetadata> CredentialVault::list() const { QMutexLocker locker(&mutex_); QVector<CredentialMetadata> result; if (isLocked()) return result; for (const Record &r : records_) { CredentialSecret s; if (!decryptRecord(r, &s)) { setError(QStringLiteral("corrupt-vault")); return {}; } result.append({r.id, s.origin, s.username, QDateTime::fromMSecsSinceEpoch(r.createdAt), QDateTime::fromMSecsSinceEpoch(r.updatedAt), s.iconPngBase64, {}, {}}); } touch(); return result; }
bool CredentialVault::reveal(const QString &id, CredentialSecret *secret) const { QMutexLocker locker(&mutex_); if (isLocked()) return setError(QStringLiteral("vault-locked")); for (const Record &r : records_) if (r.id == id) { if (!decryptRecord(r, secret)) return setError(QStringLiteral("corrupt-vault")); touch(); return true; } return setError(QStringLiteral("record-not-found")); }
bool CredentialVault::remove(const QString &id) { QMutexLocker locker(&mutex_); if (isLocked()) return setError(QStringLiteral("vault-locked")); for (int i = 0; i < records_.size(); ++i) if (records_[i].id == id) { records_.removeAt(i); if (!persist()) return false; emit changed(); return true; } return setError(QStringLiteral("record-not-found")); }
bool CredentialVault::reset() { QMutexLocker locker(&mutex_); lock(); records_.clear(); secureClear(&salt_); secureClear(&wrappedKey_); secureClear(&wrappedNonce_); secureClear(&wrappedTag_); const bool primary = !QFile::exists(path_) || QFile::remove(path_); const bool backup = !QFile::exists(path_ + QStringLiteral(".bak")) || QFile::remove(path_ + QStringLiteral(".bak")); if (!primary || !backup) return setError(QStringLiteral("reset-failed")); emit changed(); return true; }
QVector<CredentialMetadata> CredentialVault::forOrigin(const QUrl &url) const { QMutexLocker locker(&mutex_); const QString origin = canonicalHttpsOrigin(url); QVector<CredentialMetadata> result; if (origin.isEmpty()) return result; for (const CredentialMetadata &meta : list()) if (meta.origin == origin) result.append(meta); return result; }
