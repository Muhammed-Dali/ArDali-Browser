#pragma once

#include <QString>

#include "media_download_service.h"

enum class LocalMediaPlayerKind {
  External,
  Audio,
  Video
};

struct LocalMediaOpenRequest {
  QString path;
  QString allowedRoot;
  QString title;
  QString mimeType;
  QString thumbnailUrl;
  LocalMediaPlayerKind playerKind = LocalMediaPlayerKind::External;
};

class LocalMediaRouting final {
 public:
  static LocalMediaPlayerKind classify(const QString &path,
                                       const QString &mimeHint = {},
                                       const MediaDownloadKind *downloadKind = nullptr);
  static QString detectedMimeType(const QString &path, const QString &mimeHint = {});
  static bool isSafeDownloadedFile(const QString &path, const QString &allowedRoot);
};

Q_DECLARE_METATYPE(LocalMediaOpenRequest)
