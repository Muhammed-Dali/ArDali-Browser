#include "security_utils.h"

#include <QCoreApplication>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QTemporaryDir>

#include <cassert>
#include <iostream>

namespace {
QUrl sanitized(const char *url) {
  return BrowserSecurity::sanitizeUrlForPersistence(QUrl(QString::fromUtf8(url)));
}
}

int main(int argc, char **argv) {
  QCoreApplication app(argc, argv);

  assert(sanitized("https://example.com/page?q=ardali&page=2")
         == QUrl(QStringLiteral("https://example.com/page?q=ardali&page=2")));
  assert(sanitized("https://example.com/callback?code=synthetic-code")
         == QUrl(QStringLiteral("https://example.com/callback")));
  assert(sanitized("https://example.com/?access_token=synthetic-token&q=test")
         == QUrl(QStringLiteral("https://example.com/?q=test")));
  assert(sanitized("https://example.com/?Access_Token=one&access_token=two&q=test")
         == QUrl(QStringLiteral("https://example.com/?q=test")));
  assert(sanitized("https://example.com/?access%5Ftoken=encoded&q=test")
         == QUrl(QStringLiteral("https://example.com/?q=test")));
  assert(sanitized("https://example.com/callback#access_token=synthetic-token&state=kept")
         == QUrl(QStringLiteral("https://example.com/callback#state=kept")));
  assert(sanitized("https://example.com/#/callback?id_token=synthetic-token&state=kept")
         == QUrl(QStringLiteral("https://example.com/#/callback?state=kept")));
  assert(sanitized("https://user:synthetic-password@example.com/page?q=kept")
         == QUrl(QStringLiteral("https://example.com/page?q=kept")));
  assert(sanitized("https://example.com/?monkey=value&codec=h264&state=kept")
         == QUrl(QStringLiteral("https://example.com/?monkey=value&codec=h264&state=kept")));
  const QStringList sensitiveNames{
      QStringLiteral("token"), QStringLiteral("access_token"), QStringLiteral("id_token"),
      QStringLiteral("refresh_token"), QStringLiteral("oauth_token"), QStringLiteral("auth"),
      QStringLiteral("authorization"), QStringLiteral("code"), QStringLiteral("api_key"),
      QStringLiteral("apikey"), QStringLiteral("key"), QStringLiteral("secret"),
      QStringLiteral("client_secret"), QStringLiteral("password"), QStringLiteral("passwd"),
      QStringLiteral("session"), QStringLiteral("sessionid"), QStringLiteral("session_id"),
      QStringLiteral("sid"), QStringLiteral("jwt"), QStringLiteral("credential"),
      QStringLiteral("credentials"), QStringLiteral("samlresponse"), QStringLiteral("assertion")};
  for (const QString &name : sensitiveNames) {
    QUrl candidate(QStringLiteral("https://example.com/callback"));
    candidate.setQuery(name.toUpper() + QStringLiteral("=synthetic-secret&q=kept"));
    assert(BrowserSecurity::sanitizeUrlForPersistence(candidate)
           == QUrl(QStringLiteral("https://example.com/callback?q=kept")));
  }

  QTemporaryDir directory;
  assert(directory.isValid());
  const QString trustedPath = QDir(directory.path()).filePath(QStringLiteral("ffmpeg"));
  QFile trusted(trustedPath);
  assert(trusted.open(QIODevice::WriteOnly));
  assert(trusted.write("synthetic executable fixture\n") > 0);
  trusted.close();
  assert(QFile::setPermissions(trustedPath, QFileDevice::ReadOwner | QFileDevice::WriteOwner | QFileDevice::ExeOwner));
  assert(BrowserSecurity::resolveTrustedExecutable(QStringLiteral("ffmpeg"), {trustedPath})
         == QFileInfo(trustedPath).canonicalFilePath());

  const QString writableProgram = QStringLiteral("ardali-writable-helper");
  const QString writablePath = QDir(directory.path()).filePath(writableProgram);
  QFile writable(writablePath);
  assert(writable.open(QIODevice::WriteOnly));
  assert(writable.write("synthetic executable fixture\n") > 0);
  writable.close();
  assert(QFile::setPermissions(writablePath, QFileDevice::ReadOwner | QFileDevice::WriteOwner | QFileDevice::ExeOwner
                                            | QFileDevice::WriteGroup | QFileDevice::WriteOther));
  assert(BrowserSecurity::resolveTrustedExecutable(writableProgram, {writablePath}).isEmpty());
  assert(BrowserSecurity::resolveTrustedExecutable(QStringLiteral("../ffmpeg"), {trustedPath}).isEmpty());

  const QString insecureDirectoryPath = QDir(directory.path()).filePath(QStringLiteral("writable-bin"));
  assert(QDir().mkpath(insecureDirectoryPath));
  assert(QFile::setPermissions(insecureDirectoryPath, QFileDevice::ReadOwner | QFileDevice::WriteOwner
      | QFileDevice::ExeOwner | QFileDevice::WriteGroup | QFileDevice::WriteOther));
  const QString insecureDirectoryProgram = QStringLiteral("ardali-insecure-directory-helper");
  const QString insecureDirectoryExecutable = QDir(insecureDirectoryPath).filePath(insecureDirectoryProgram);
  QFile insecureDirectoryFile(insecureDirectoryExecutable);
  assert(insecureDirectoryFile.open(QIODevice::WriteOnly));
  assert(insecureDirectoryFile.write("synthetic executable fixture\n") > 0);
  insecureDirectoryFile.close();
  assert(QFile::setPermissions(insecureDirectoryExecutable,
      QFileDevice::ReadOwner | QFileDevice::WriteOwner | QFileDevice::ExeOwner));
  assert(BrowserSecurity::resolveTrustedExecutable(insecureDirectoryProgram, {insecureDirectoryExecutable}).isEmpty());

  const QByteArray originalPath = qgetenv("PATH");
  qputenv("PATH", directory.path().toUtf8());
  assert(BrowserSecurity::resolveTrustedExecutable(QStringLiteral("ardali-nonexistent-helper")).isEmpty());
  qputenv("PATH", originalPath);

  std::cout << "URL persistence and executable provenance invariants: ok\n";
  return 0;
}
