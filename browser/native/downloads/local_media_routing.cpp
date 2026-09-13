#include "local_media_routing.h"

#include <QDir>
#include <QFileInfo>
#include <QMimeDatabase>
#include <QMimeType>

namespace {

bool isPlayableMediaMime(const QString &mime, const QString &prefix) {
  if (mime.startsWith(prefix)) return true;
  if (prefix == QLatin1String("audio/")) {
    return mime == QLatin1String("application/ogg")
        || mime == QLatin1String("application/x-ogg");
  }
  return false;
}

}  // namespace

QString LocalMediaRouting::detectedMimeType(const QString &path, const QString &mimeHint) {
  const QString normalizedHint = mimeHint.trimmed().toLower().section(QLatin1Char(';'), 0, 0);
  if (normalizedHint.startsWith(QLatin1String("audio/"))
      || normalizedHint.startsWith(QLatin1String("video/"))) {
    return normalizedHint;
  }
  const QFileInfo file(path);
  if (!file.isFile()) return normalizedHint;
  QMimeDatabase database;
  const QMimeType content = database.mimeTypeForFile(file, QMimeDatabase::MatchContent);
  if (content.isValid() && content.name() != QLatin1String("application/octet-stream")) {
    return content.name().toLower();
  }
  return database.mimeTypeForFile(file, QMimeDatabase::MatchExtension).name().toLower();
}

LocalMediaPlayerKind LocalMediaRouting::classify(const QString &path,
                                                 const QString &mimeHint,
                                                 const MediaDownloadKind *downloadKind) {
  if (downloadKind) {
    if (*downloadKind == MediaDownloadKind::AudioOriginal
        || *downloadKind == MediaDownloadKind::AudioConvert) {
      return LocalMediaPlayerKind::Audio;
    }
    if (*downloadKind == MediaDownloadKind::Video) return LocalMediaPlayerKind::Video;
    return LocalMediaPlayerKind::External;
  }
  const QString mime = detectedMimeType(path, mimeHint);
  if (isPlayableMediaMime(mime, QStringLiteral("audio/"))) return LocalMediaPlayerKind::Audio;
  if (isPlayableMediaMime(mime, QStringLiteral("video/"))) return LocalMediaPlayerKind::Video;
  return LocalMediaPlayerKind::External;
}

bool LocalMediaRouting::isSafeDownloadedFile(const QString &path, const QString &allowedRoot) {
  const QFileInfo file(path);
  const QFileInfo root(allowedRoot);
  if (!file.isAbsolute() || !file.isFile() || !file.isReadable() || !root.isAbsolute() || !root.isDir()) {
    return false;
  }
  const QString canonicalFile = file.canonicalFilePath();
  const QString canonicalRoot = root.canonicalFilePath();
  if (canonicalFile.isEmpty() || canonicalRoot.isEmpty()) return false;
  const QString relative = QDir(canonicalRoot).relativeFilePath(canonicalFile);
  return relative != QLatin1String("..") && !QDir::isAbsolutePath(relative)
      && !relative.startsWith(QStringLiteral("../"))
      && !relative.startsWith(QStringLiteral("..\\"));
}
