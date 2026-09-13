#include <QCoreApplication>
#include <QDir>
#include <QTemporaryDir>

#include "new_tab_asset_resolver.h"

namespace {
int fail(const char *message) {
  qCritical("new-tab asset resolver test failed: %s", message);
  return 1;
}
}  // namespace

int main(int argc, char **argv) {
  QCoreApplication app(argc, argv);
  QTemporaryDir root;
  if (!root.isValid()) return fail("temporary root missing");

  const QString installedApplicationDirectory = root.path() + QStringLiteral("/usr/lib/ardali-browser");
  const QString installedAssetsDirectory = root.path() + QStringLiteral("/usr/share/ardali-browser/new-tab");
  if (!QDir().mkpath(installedApplicationDirectory) || !QDir().mkpath(installedAssetsDirectory))
    return fail("installed layout fixture missing");
  if (resolveNewTabAssetsDirectory(installedApplicationDirectory) != installedAssetsDirectory)
    return fail("/usr/lib application did not resolve /usr/share assets");

  const QString portableApplicationDirectory = root.path() + QStringLiteral("/portable/bin");
  const QString portableAssetsDirectory = root.path() + QStringLiteral("/portable/share/ardali-browser/new-tab");
  if (!QDir().mkpath(portableApplicationDirectory) || !QDir().mkpath(portableAssetsDirectory))
    return fail("portable layout fixture missing");
  if (resolveNewTabAssetsDirectory(portableApplicationDirectory) != portableAssetsDirectory)
    return fail("portable bin layout did not resolve adjacent share assets");

  const QString buildApplicationDirectory = root.path() + QStringLiteral("/build");
  const QString buildAssetsDirectory = buildApplicationDirectory + QStringLiteral("/assets/new-tab");
  if (!QDir().mkpath(buildAssetsDirectory)) return fail("build layout fixture missing");
  if (resolveNewTabAssetsDirectory(buildApplicationDirectory) != buildAssetsDirectory)
    return fail("build layout did not resolve local assets");

  qInfo("new-tab asset resolver: ok");
  return 0;
}
