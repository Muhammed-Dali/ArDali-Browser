#include "new_tab_asset_resolver.h"

#include <QDir>
#include <QStringList>

QString resolveNewTabAssetsDirectory(const QString &applicationDirectory) {
  const QDir appDirectory(applicationDirectory);
  const QStringList candidates{
      appDirectory.absoluteFilePath(QStringLiteral("assets/new-tab")),
      appDirectory.absoluteFilePath(QStringLiteral("../share/dalinira-browser/new-tab")),
      appDirectory.absoluteFilePath(QStringLiteral("../../share/dalinira-browser/new-tab"))};

  for (const QString &candidate : candidates) {
    if (QDir(candidate).exists()) return QDir::cleanPath(candidate);
  }
  return QDir::cleanPath(candidates.constFirst());
}
