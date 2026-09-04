#include "security_utils.h"

#include <QDir>
#include <QFileDevice>
#include <QFileInfo>
#include <QSet>
#include <QStandardPaths>
#include <QUrlQuery>
#include <QRegularExpression>

#include <algorithm>

namespace {

const QSet<QString> &sensitiveParameterNames() {
  static const QSet<QString> names{
      QStringLiteral("token"), QStringLiteral("access_token"), QStringLiteral("id_token"),
      QStringLiteral("refresh_token"), QStringLiteral("oauth_token"), QStringLiteral("auth"),
      QStringLiteral("authorization"), QStringLiteral("code"), QStringLiteral("api_key"),
      QStringLiteral("apikey"), QStringLiteral("key"), QStringLiteral("secret"),
      QStringLiteral("client_secret"), QStringLiteral("password"), QStringLiteral("passwd"),
      QStringLiteral("session"), QStringLiteral("sessionid"), QStringLiteral("session_id"),
      QStringLiteral("sid"), QStringLiteral("jwt"), QStringLiteral("credential"),
      QStringLiteral("credentials"), QStringLiteral("samlresponse"), QStringLiteral("assertion")};
  return names;
}

QString sanitizedParameterString(const QString &encoded, bool *changed) {
  if (changed) *changed = false;
  QUrlQuery source(encoded);
  QUrlQuery safe;
  for (const auto &[name, value] : source.queryItems(QUrl::FullyDecoded)) {
    if (sensitiveParameterNames().contains(name.trimmed().toLower())) {
      if (changed) *changed = true;
      continue;
    }
    safe.addQueryItem(name, value);
  }
  return safe.toString(QUrl::FullyEncoded);
}

bool isSecureExecutableFile(const QString &candidate) {
  if (candidate.isEmpty() || !QDir::isAbsolutePath(candidate)) return false;
  const QFileInfo original(candidate);
  if (!original.exists() || !original.isFile() || !original.isExecutable()) return false;
  const QString canonical = original.canonicalFilePath();
  if (canonical.isEmpty() || !QDir::isAbsolutePath(canonical)) return false;
  const QFileInfo resolved(canonical);
  const auto permissions = resolved.permissions();
  const QFileInfo parent(resolved.absolutePath());
  const auto parentPermissions = parent.permissions();
  return resolved.isFile() && resolved.isExecutable() && parent.isDir()
      && !(permissions & (QFileDevice::WriteGroup | QFileDevice::WriteOther))
      && !(parentPermissions & (QFileDevice::WriteGroup | QFileDevice::WriteOther));
}

QString canonicalExecutable(const QString &candidate) {
  return isSecureExecutableFile(candidate) ? QFileInfo(candidate).canonicalFilePath() : QString{};
}

QStringList defaultSystemExecutableDirectories() {
#if defined(Q_OS_UNIX)
  return {QStringLiteral("/usr/bin"), QStringLiteral("/usr/local/bin"),
          QStringLiteral("/bin"), QStringLiteral("/usr/sbin"),
          QStringLiteral("/usr/local/sbin"), QStringLiteral("/sbin"),
          QStringLiteral("/opt/homebrew/bin"), QStringLiteral("/opt/local/bin")};
#elif defined(Q_OS_WIN)
  const QString systemRoot = qEnvironmentVariable("SystemRoot");
  return systemRoot.isEmpty() ? QStringList{} : QStringList{QDir(systemRoot).filePath(QStringLiteral("System32"))};
#else
  return {};
#endif
}

}  // namespace

namespace BrowserSecurity {

QUrl sanitizeUrlForPersistence(const QUrl &url) {
  if (!url.isValid()) return {};
  QUrl safe(url);
  safe.setUserName({});
  safe.setPassword({});

  bool queryChanged = false;
  const QString safeQuery = sanitizedParameterString(url.query(QUrl::FullyEncoded), &queryChanged);
  if (queryChanged) safe.setQuery(safeQuery);

  const QString fragment = url.fragment(QUrl::FullyEncoded);
  if (!fragment.isEmpty()) {
    const qsizetype queryStart = fragment.indexOf(QLatin1Char('?'));
    const bool hasParameterForm = queryStart >= 0 || fragment.contains(QLatin1Char('='));
    if (hasParameterForm) {
      const QString prefix = queryStart >= 0 ? fragment.left(queryStart) : QString{};
      const QString parameters = queryStart >= 0 ? fragment.mid(queryStart + 1) : fragment;
      bool fragmentChanged = false;
      const QString safeParameters = sanitizedParameterString(parameters, &fragmentChanged);
      if (fragmentChanged) {
        if (prefix.isEmpty()) safe.setFragment(safeParameters);
        else safe.setFragment(safeParameters.isEmpty() ? prefix : prefix + QLatin1Char('?') + safeParameters);
      }
    }
  }
  return safe;
}

QString resolveTrustedExecutable(const QString &programName, const QStringList &bundledCandidates,
                                 bool includeSystemDirectories) {
  if (programName.isEmpty() || programName != QFileInfo(programName).fileName()
      || programName == QLatin1String(".") || programName == QLatin1String("..")) {
    return {};
  }
  for (const QString &candidate : bundledCandidates) {
    if (QFileInfo(candidate).fileName() != programName) continue;
    const QString resolved = canonicalExecutable(candidate);
    if (!resolved.isEmpty()) return resolved;
  }
  if (!includeSystemDirectories) return {};
  for (const QString &directory : defaultSystemExecutableDirectories()) {
    const QString found = QStandardPaths::findExecutable(programName, {directory});
    const QString resolved = canonicalExecutable(found);
    if (!resolved.isEmpty()) return resolved;
  }
  return {};
}

QString sanitizeDownloadFileName(const QString &suggested, const QString &fallback) {
  QString name = QFileInfo(suggested).fileName();
  name.replace(QRegularExpression(QStringLiteral("[\\x00-\\x1f\\x7f<>:\"/\\\\|?*]+")), QStringLiteral("_"));
  name.replace(QRegularExpression(QStringLiteral("\\s+")), QStringLiteral(" "));
  name = name.trimmed();
  while (name.endsWith(QLatin1Char('.')) || name.endsWith(QLatin1Char(' '))) name.chop(1);
  static const QRegularExpression reserved(
      QStringLiteral("^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\\..*)?$"),
      QRegularExpression::CaseInsensitiveOption);
  if (name.isEmpty() || name == QLatin1String(".") || name == QLatin1String("..") || reserved.match(name).hasMatch()) {
    name = QFileInfo(fallback).fileName().trimmed();
  }
  if (name.isEmpty() || name == QLatin1String(".") || name == QLatin1String("..")) name = QStringLiteral("download");
  if (name.size() <= 220) return name;
  const QString suffix = QFileInfo(name).completeSuffix();
  if (suffix.isEmpty() || suffix.size() > 20) return name.left(220);
  const QString dottedSuffix = QLatin1Char('.') + suffix;
  return name.left(std::max<qsizetype>(1, 220 - dottedSuffix.size())) + dottedSuffix;
}

}  // namespace BrowserSecurity
