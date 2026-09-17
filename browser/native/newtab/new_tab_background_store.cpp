#include "new_tab_background_store.h"

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QImage>
#include <QImageReader>
#include <QImageWriter>
#include <QSaveFile>

namespace {
constexpr qint64 kMaximumSourceBytes = 25 * 1024 * 1024;
constexpr qint64 kMaximumPixels = 50'000'000;
constexpr int kMaximumDimension = 12'000;
constexpr int kStoredWidth = 3840;
constexpr int kStoredHeight = 2160;
constexpr int kThumbnailWidth = 480;
constexpr int kThumbnailHeight = 270;

bool isSupportedFormat(const QByteArray &format) {
  const QByteArray normalized = format.toLower();
  return normalized == "png" || normalized == "jpg" || normalized == "jpeg" || normalized == "webp";
}
}  // namespace

NewTabBackgroundStore::NewTabBackgroundStore(const QString &profileDataDirectory)
    : directory_(QDir(profileDataDirectory).filePath(QStringLiteral("new-tab-backgrounds"))) {
  QDir().mkpath(directory_);
  QFile::setPermissions(directory_, QFileDevice::ReadOwner | QFileDevice::WriteOwner | QFileDevice::ExeOwner);
}

NewTabBackgroundStore::ImportResult NewTabBackgroundStore::importImage(const QString &sourcePath) {
  const QFileInfo source(sourcePath);
  if (!source.isFile() || !source.isReadable())
    return {ImportError::InvalidImage, QStringLiteral("Görsel dosyası okunamıyor.")};
  if (source.size() > kMaximumSourceBytes)
    return {ImportError::FileTooLarge, QStringLiteral("Görsel 25 MB sınırını aşıyor.")};
  const QString suffix = source.suffix().toLower();
  if (suffix != QLatin1String("png") && suffix != QLatin1String("jpg")
      && suffix != QLatin1String("jpeg") && suffix != QLatin1String("webp"))
    return {ImportError::UnsupportedFormat, QStringLiteral("Yalnızca PNG, JPG/JPEG ve WebP desteklenir.")};

  QImageReader reader(source.absoluteFilePath());
  reader.setDecideFormatFromContent(true);
  reader.setAutoTransform(true);
  const QByteArray detectedFormat = reader.format();
  if (!isSupportedFormat(detectedFormat))
    return {ImportError::UnsupportedFormat, QStringLiteral("Dosyanın gerçek görsel formatı desteklenmiyor.")};
  const QSize sourceSize = reader.size();
  if (!sourceSize.isValid() || sourceSize.width() > kMaximumDimension || sourceSize.height() > kMaximumDimension
      || static_cast<qint64>(sourceSize.width()) * sourceSize.height() > kMaximumPixels)
    return {ImportError::UnsafeDimensions, QStringLiteral("Görsel boyutları güvenli sınırları aşıyor.")};
  if (sourceSize.width() > kStoredWidth || sourceSize.height() > kStoredHeight)
    reader.setScaledSize(sourceSize.scaled(kStoredWidth, kStoredHeight, Qt::KeepAspectRatio));
  QImage image = reader.read();
  if (image.isNull()) return {ImportError::InvalidImage, QStringLiteral("Görsel bozuk veya çözümlenemiyor.")};
  image = image.convertToFormat(QImage::Format_ARGB32);

  const QImage thumbnail = image.scaled(kThumbnailWidth, kThumbnailHeight, Qt::KeepAspectRatio, Qt::SmoothTransformation);
  QDir().mkpath(directory_);
  if (!writeImageAtomically(managedImagePath(), image, "PNG")
      || !writeImageAtomically(thumbnailPath(), thumbnail, "JPEG", 84)) {
    QFile::remove(managedImagePath());
    QFile::remove(thumbnailPath());
    return {ImportError::StorageFailure, QStringLiteral("Yönetilen arka plan kopyası kaydedilemedi.")};
  }
  return {};
}

bool NewTabBackgroundStore::removeManagedImage() {
  const bool imageRemoved = !QFileInfo::exists(managedImagePath()) || QFile::remove(managedImagePath());
  const bool thumbnailRemoved = !QFileInfo::exists(thumbnailPath()) || QFile::remove(thumbnailPath());
  return imageRemoved && thumbnailRemoved;
}

bool NewTabBackgroundStore::hasValidManagedImage() const {
  QImageReader reader(managedImagePath());
  const QSize size = reader.size();
  return QFileInfo::exists(managedImagePath()) && isSupportedFormat(reader.format()) && size.isValid()
      && size.width() <= kMaximumDimension && size.height() <= kMaximumDimension
      && static_cast<qint64>(size.width()) * size.height() <= kMaximumPixels && reader.canRead();
}

QString NewTabBackgroundStore::managedImagePath() const {
  return QDir(directory_).filePath(QStringLiteral("custom-background.png"));
}

QString NewTabBackgroundStore::thumbnailPath() const {
  return QDir(directory_).filePath(QStringLiteral("custom-background-thumbnail.jpg"));
}

bool NewTabBackgroundStore::writeImageAtomically(const QString &path, const QImage &image, const char *format, int quality) const {
  QSaveFile file(path);
  if (!file.open(QIODevice::WriteOnly)) return false;
  QImageWriter writer(&file, format);
  if (quality >= 0) writer.setQuality(quality);
  const bool ok = writer.write(image) && file.commit();
  if (ok) QFile::setPermissions(path, QFileDevice::ReadOwner | QFileDevice::WriteOwner);
  return ok;
}
