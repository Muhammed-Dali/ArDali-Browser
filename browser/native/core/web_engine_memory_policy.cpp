#include "web_engine_memory_policy.h"

#include <QDir>
#include <QFileInfo>
#include <QLibraryInfo>

namespace ardali {

namespace {

constexpr auto kLauncherName = "ardali-webengine-process";
constexpr auto kRealProcessEnvironment = "ARDALI_REAL_QTWEBENGINEPROCESS_PATH";

QString executableCanonicalPath(const QString &path) {
  const QFileInfo file(path);
  if (!file.isAbsolute() || !file.exists() || !file.isFile() || !file.isExecutable()) return {};
  return file.canonicalFilePath();
}

}  // namespace

WebEngineMemoryPolicyStatus WebEngineMemoryPolicy::configureSubprocessLauncher(
    const QString &applicationDir, const QString &qtLibraryExecutablesDir) {
  WebEngineMemoryPolicyStatus status;

#if !defined(Q_OS_LINUX)
  Q_UNUSED(applicationDir)
  Q_UNUSED(qtLibraryExecutablesDir)
  status.error = QStringLiteral("child allocator policy is Linux-only");
  return status;
#else
  const QStringList launcherCandidates = {
      QDir(applicationDir).filePath(QString::fromLatin1(kLauncherName)),
      QDir(applicationDir).filePath(QStringLiteral("../lib/ardali-browser/ardali-webengine-process")),
      QDir(applicationDir).filePath(QStringLiteral("../bin/ardali-webengine-process")),
      QStringLiteral("/usr/lib/ardali-browser/ardali-webengine-process"),
      QStringLiteral("/usr/local/lib/ardali-browser/ardali-webengine-process"),
      QStringLiteral("/usr/bin/ardali-webengine-process"),
      QStringLiteral("/usr/local/bin/ardali-webengine-process")
  };

  for (const QString &candidate : launcherCandidates) {
    if (!candidate.isEmpty()) {
      status.launcherPath = executableCanonicalPath(candidate);
      if (!status.launcherPath.isEmpty()) break;
    }
  }

  if (status.launcherPath.isEmpty()) {
    status.error = QStringLiteral("allocator launcher is missing or not executable");
    return status;
  }

  const QString configuredProcess = QString::fromLocal8Bit(qgetenv("QTWEBENGINEPROCESS_PATH"));
  if (!configuredProcess.isEmpty()) {
    status.realProcessPath = executableCanonicalPath(configuredProcess);
  }

  if (status.realProcessPath.isEmpty()) {
    const QString qtDir = qtLibraryExecutablesDir.isEmpty()
                              ? QLibraryInfo::path(QLibraryInfo::LibraryExecutablesPath)
                              : qtLibraryExecutablesDir;
    const QStringList processCandidates = {
        QDir(qtDir).filePath(QStringLiteral("QtWebEngineProcess")),
        QDir(qtDir).filePath(QStringLiteral("libexec/QtWebEngineProcess")),
        QStringLiteral("/usr/lib/qt6/QtWebEngineProcess"),
        QStringLiteral("/usr/lib/qt6/libexec/QtWebEngineProcess"),
        QStringLiteral("/usr/libexec/QtWebEngineProcess"),
        QStringLiteral("/usr/lib/x86_64-linux-gnu/qt6/libexec/QtWebEngineProcess")
    };

    for (const QString &candidate : processCandidates) {
      if (!candidate.isEmpty()) {
        status.realProcessPath = executableCanonicalPath(candidate);
        if (!status.realProcessPath.isEmpty()) break;
      }
    }
  }

  if (status.realProcessPath.isEmpty()) {
    status.error = QStringLiteral("real QtWebEngineProcess is missing or not executable");
    return status;
  }
  if (status.realProcessPath == status.launcherPath) {
    status.error = QStringLiteral("allocator launcher recursion rejected");
    return status;
  }

  if (!qputenv(kRealProcessEnvironment, status.realProcessPath.toLocal8Bit())
      || !qputenv("QTWEBENGINEPROCESS_PATH", status.launcherPath.toLocal8Bit())) {
    qunsetenv(kRealProcessEnvironment);
    status.error = QStringLiteral("failed to configure QtWebEngine subprocess launcher");
    return status;
  }

  status.configured = true;
  return status;
#endif
}

}  // namespace ardali
