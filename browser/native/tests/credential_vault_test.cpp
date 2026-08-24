#include "credential_vault.h"
#include "credential_vault_manager.h"

#include <QFile>
#include <QFileInfo>
#include <QJsonDocument>
#include <QJsonArray>
#include <QJsonObject>
#include <QTemporaryDir>

#include <cassert>
#include <cstdio>

int main() {
  QTemporaryDir root; assert(root.isValid());
  const QString master = QStringLiteral("SyntheticMaster#2026");
  CredentialVault vault(root.path());
  assert(vault.isLocked());
  assert(!vault.create(QStringLiteral("weak")));
  assert(vault.create(master));
  bool updated = false;
  const bool saved = vault.save({QStringLiteral("https://example.com"), QStringLiteral("test-user"), QStringLiteral("synthetic-secret-A"), QStringLiteral("aWNvbg==")}, &updated);
  if (!saved) { std::fprintf(stderr, "%s\n", qPrintable(vault.lastError())); return 2; }
  assert(!updated);
  assert(vault.forOrigin(QUrl(QStringLiteral("https://example.com/login"))).size() == 1);
  assert(vault.forOrigin(QUrl(QStringLiteral("https://evil-example.com"))).isEmpty());
  assert(vault.forOrigin(QUrl(QStringLiteral("http://example.com"))).isEmpty());
  QFile file(root.path() + QStringLiteral("/credential-vault/vault-v2.json")); assert(file.open(QIODevice::ReadOnly)); const QByteArray bytes = file.readAll();
  assert(!bytes.contains("synthetic-secret-A") && !bytes.contains("test-user") && !bytes.contains("https://example.com"));
  const QString firstNonce = QJsonDocument::fromJson(bytes).object().value(QStringLiteral("records")).toArray().at(0).toObject().value(QStringLiteral("nonce")).toString();
  const auto first = vault.list().front();
  assert(vault.save({QStringLiteral("https://example.com"), QStringLiteral("test-user"), QStringLiteral("synthetic-secret-B"), QString{}}, &updated) && updated);
  file.close(); assert(file.open(QIODevice::ReadOnly)); const QString secondNonce = QJsonDocument::fromJson(file.readAll()).object().value(QStringLiteral("records")).toArray().at(0).toObject().value(QStringLiteral("nonce")).toString();
  assert(firstNonce != secondNonce);
  CredentialSecret revealed; assert(vault.reveal(first.id, &revealed) && revealed.password == QStringLiteral("synthetic-secret-B") && revealed.iconPngBase64 == QStringLiteral("aWNvbg=="));
  assert(vault.list().front().iconPngBase64 == QStringLiteral("aWNvbg=="));
  const QString changedMaster = QStringLiteral("ChangedSynthetic#2027");
  assert(vault.changeMasterPassword(master, changedMaster));
  vault.lock(); assert(vault.isLocked() && vault.list().isEmpty());
  assert(!vault.unlock(QStringLiteral("NotTheMaster#2026")));
  // A fresh process-equivalent instance is always locked and only the correct master can open it.
  CredentialVault restartedWrong(root.path()); assert(restartedWrong.isLocked());
  assert(!restartedWrong.unlock(master));
  CredentialVault restarted(root.path()); assert(restarted.unlock(changedMaster)); assert(restarted.list().size() == 1);
  assert(restarted.remove(restarted.list().front().id)); assert(restarted.list().isEmpty());
  const auto permissions = QFileInfo(root.path() + QStringLiteral("/credential-vault/vault-v2.json")).permissions();
  assert(!(permissions & (QFileDevice::ReadGroup | QFileDevice::ReadOther | QFileDevice::WriteGroup | QFileDevice::WriteOther)));
  assert(restarted.reset());
  assert(!restarted.exists() && restarted.isLocked());
  assert(!QFile::exists(root.path() + QStringLiteral("/credential-vault/vault-v2.json")));

  QTemporaryDir corruptRoot; CredentialVault corrupt(corruptRoot.path()); assert(corrupt.create(master)); assert(corrupt.save({QStringLiteral("https://example.org"), QStringLiteral("tamper-user"), QStringLiteral("synthetic-tamper-value"), QString{}})); const QString corruptId = corrupt.list().front().id;
  const QString corruptPath = corruptRoot.path() + QStringLiteral("/credential-vault/vault-v2.json"); QFile corruptFile(corruptPath); assert(corruptFile.open(QIODevice::ReadOnly)); QJsonObject tampered = QJsonDocument::fromJson(corruptFile.readAll()).object(); corruptFile.close(); QJsonArray records = tampered.value(QStringLiteral("records")).toArray(); QJsonObject record = records.at(0).toObject(); QString tag = record.value(QStringLiteral("tag")).toString(); tag[0] = tag[0] == QLatin1Char('A') ? QLatin1Char('B') : QLatin1Char('A'); record.insert(QStringLiteral("tag"), tag); records[0] = record; tampered.insert(QStringLiteral("records"), records); assert(corruptFile.open(QIODevice::WriteOnly | QIODevice::Truncate)); corruptFile.write(QJsonDocument(tampered).toJson(QJsonDocument::Compact)); corruptFile.close(); corrupt.lock(); CredentialVault corruptRestart(corruptRoot.path()); assert(corruptRestart.unlock(master)); CredentialSecret tamperedSecret; assert(!corruptRestart.reveal(corruptId, &tamperedSecret));

  QTemporaryDir multiRoot; CredentialVaultManager multi(multiRoot.path()); QString personalId, workId;
  assert(multi.createVault(QStringLiteral("Kişisel"), master, &personalId));
  assert(multi.saveToVault(personalId, {QStringLiteral("https://example.net"), QStringLiteral("personal-user"), QStringLiteral("personal-secret"), QString{}}));
  assert(multi.createVault(QStringLiteral("İş"), changedMaster, &workId));
  assert(multi.saveToVault(workId, {QStringLiteral("https://example.net"), QStringLiteral("work-user"), QStringLiteral("work-secret"), QString{}}));
  assert(multi.forOrigin(QUrl(QStringLiteral("https://example.net/login"))).size() == 2);
  const QString backupPath = multiRoot.path() + QStringLiteral("/portable.ardali-vault-backup");
  const QString backupPassword = QStringLiteral("BackupPassword#2026");
  assert(multi.exportBackup(backupPath, backupPassword));
  QFile backupFile(backupPath); assert(backupFile.open(QIODevice::ReadOnly)); const QByteArray backupBytes = backupFile.readAll(); assert(!backupBytes.contains("personal-secret") && !backupBytes.contains("work-secret"));
  QTemporaryDir restoredRoot; CredentialVaultManager restored(restoredRoot.path()); QStringList imported;
  assert(!restored.importBackup(backupPath, QStringLiteral("WrongBackup#2026"), &imported));
  assert(restored.importBackup(backupPath, backupPassword, &imported) && imported.size() == 2 && restored.vaults().size() == 2);
  for (const VaultMetadata &restoredVault : restored.vaults()) assert(restored.unlockVault(restoredVault.id, restoredVault.name == QStringLiteral("Kişisel") ? master : changedMaster));
  assert(restored.forOrigin(QUrl(QStringLiteral("https://example.net/login"))).size() == 2);
  multi.lockVault(personalId);
  assert(multi.forOrigin(QUrl(QStringLiteral("https://example.net/login"))).size() == 1);
  assert(multi.unlockVault(personalId, master));
  assert(multi.forOrigin(QUrl(QStringLiteral("https://example.net/login"))).size() == 2);
  assert(multi.setActiveVault(workId) && multi.clearActiveVault() && multi.list().isEmpty());
  assert(multi.deleteVault(personalId) && multi.vaults().size() == 1);
  CredentialVaultManager multiRestart(multiRoot.path());
  assert(multiRestart.vaults().size() == 1 && multiRestart.activeVaultId() == workId);
  assert(multiRestart.unlockVault(workId, changedMaster) && multiRestart.list().isEmpty());
}
