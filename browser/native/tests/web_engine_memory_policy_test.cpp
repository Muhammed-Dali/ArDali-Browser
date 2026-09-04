#include <cassert>

#include <QCoreApplication>
#include <QDir>
#include <QFile>
#include <QFileDevice>
#include <QTemporaryDir>

#include "../core/web_engine_memory_policy.h"

namespace {

bool makeExecutable(const QString &path) {
  QFile file(path);
  if (!file.open(QIODevice::WriteOnly)) return false;
  file.close();
  return QFile::setPermissions(path, QFileDevice::ReadOwner | QFileDevice::WriteOwner
                                        | QFileDevice::ExeOwner);
}

}  // namespace

int main(int argc, char *argv[]) {
  QCoreApplication app(argc, argv);

#if defined(Q_OS_LINUX)
  const QByteArray originalProcessPath = qgetenv("QTWEBENGINEPROCESS_PATH");
  const QByteArray originalRealPath = qgetenv("ARDALI_REAL_QTWEBENGINEPROCESS_PATH");
  const QByteArray originalArenaMax = qgetenv("MALLOC_ARENA_MAX");
  const QByteArray originalTrimThreshold = qgetenv("MALLOC_TRIM_THRESHOLD_");

  QTemporaryDir root;
  assert(root.isValid());
  const QString applicationDir = QDir(root.path()).filePath(QStringLiteral("app"));
  const QString qtDir = QDir(root.path()).filePath(QStringLiteral("qt"));
  assert(QDir().mkpath(applicationDir));
  assert(QDir().mkpath(qtDir));
  const QString launcher = QDir(applicationDir).filePath(QStringLiteral("ardali-webengine-process"));
  const QString realProcess = QDir(qtDir).filePath(QStringLiteral("QtWebEngineProcess"));
  assert(makeExecutable(launcher));
  assert(makeExecutable(realProcess));

  qunsetenv("QTWEBENGINEPROCESS_PATH");
  qputenv("MALLOC_ARENA_MAX", "unchanged-main-process");
  qputenv("MALLOC_TRIM_THRESHOLD_", "unchanged-main-process");
  const auto status = ardali::WebEngineMemoryPolicy::configureSubprocessLauncher(applicationDir, qtDir);
  assert(status.configured);
  assert(status.launcherPath == QFileInfo(launcher).canonicalFilePath());
  assert(status.realProcessPath == QFileInfo(realProcess).canonicalFilePath());
  assert(qgetenv("QTWEBENGINEPROCESS_PATH") == status.launcherPath.toLocal8Bit());
  assert(qgetenv("ARDALI_REAL_QTWEBENGINEPROCESS_PATH") == status.realProcessPath.toLocal8Bit());
  assert(qgetenv("MALLOC_ARENA_MAX") == "unchanged-main-process");
  assert(qgetenv("MALLOC_TRIM_THRESHOLD_") == "unchanged-main-process");

  const auto recursive = ardali::WebEngineMemoryPolicy::configureSubprocessLauncher(applicationDir, qtDir);
  assert(!recursive.configured);
  assert(recursive.error.contains(QStringLiteral("recursion")));

  if (originalProcessPath.isNull()) qunsetenv("QTWEBENGINEPROCESS_PATH");
  else qputenv("QTWEBENGINEPROCESS_PATH", originalProcessPath);
  if (originalRealPath.isNull()) qunsetenv("ARDALI_REAL_QTWEBENGINEPROCESS_PATH");
  else qputenv("ARDALI_REAL_QTWEBENGINEPROCESS_PATH", originalRealPath);
  if (originalArenaMax.isNull()) qunsetenv("MALLOC_ARENA_MAX");
  else qputenv("MALLOC_ARENA_MAX", originalArenaMax);
  if (originalTrimThreshold.isNull()) qunsetenv("MALLOC_TRIM_THRESHOLD_");
  else qputenv("MALLOC_TRIM_THRESHOLD_", originalTrimThreshold);
#endif

  return 0;
}
