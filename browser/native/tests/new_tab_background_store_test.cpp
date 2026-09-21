#include <QCoreApplication>
#include <QFile>
#include <QImage>
#include <QImageReader>
#include <QImageWriter>
#include <QTemporaryDir>

#include <cstdio>

#include "new_tab_background_store.h"

namespace {
int fail(const char *message) {
  std::fprintf(stderr, "new-tab background store test failed: %s\n", message);
  return 1;
}
}  // namespace

int main(int argc, char **argv) {
  QCoreApplication app(argc, argv);
  QTemporaryDir directory;
  if (!directory.isValid()) return fail("temporary profile missing");
  NewTabBackgroundStore store(directory.path() + QStringLiteral("/profile"));
  QImage image(640, 360, QImage::Format_ARGB32);
  image.fill(QColor(QStringLiteral("#3184a8")));

  for (const QByteArray &format : {QByteArray("PNG"), QByteArray("JPEG"), QByteArray("WEBP")}) {
    if (!QImageWriter::supportedImageFormats().contains(format.toLower())) return fail("required image writer unavailable");
    const QString suffix = format == "JPEG" ? QStringLiteral("jpg") : QString::fromLatin1(format).toLower();
    const QString original = directory.path() + QStringLiteral("/original.") + suffix;
    if (!image.save(original, format.constData())) return fail("fixture could not be written");
    const auto result = store.importImage(original);
    if (!result.ok() || !store.hasValidManagedImage() || !QImageReader(store.thumbnailPath()).canRead())
      return fail("supported image import or thumbnail failed");
    if (store.managedImagePath() == original) return fail("original path was reused as managed storage");
    if (!store.removeManagedImage() || !QFile::exists(original)) return fail("remove affected the user original");
    if (store.hasValidManagedImage()) return fail("removed managed image remained valid");
  }

  const QString firstPath = directory.path() + QStringLiteral("/first.png");
  const QString secondPath = directory.path() + QStringLiteral("/second.webp");
  image.fill(Qt::blue);
  if (!image.save(firstPath, "PNG") || !store.importImage(firstPath).ok())
    return fail("initial replacement fixture failed");
  image.fill(Qt::red);
  if (!image.save(secondPath, "WEBP") || !store.importImage(secondPath).ok())
    return fail("managed image replacement failed");
  const QImage replaced(store.managedImagePath());
  const QColor replacedColor = replaced.pixelColor(0, 0);
  if (replaced.isNull() || replacedColor.red() < 240 || replacedColor.green() > 20
      || replacedColor.blue() > 20)
    return fail("replacement did not update the managed copy");

  const QString corrupt = directory.path() + QStringLiteral("/corrupt.png");
  QFile corruptFile(corrupt);
  if (!corruptFile.open(QIODevice::WriteOnly) || corruptFile.write("not an image") < 0) return fail("corrupt fixture failed");
  corruptFile.close();
  if (store.importImage(corrupt).ok()) return fail("corrupt image was accepted");
  if (!store.hasValidManagedImage()) return fail("rejected image removed the existing managed copy");

  QFile::remove(store.thumbnailPath());
  if (store.hasValidManagedImage()) return fail("missing thumbnail was treated as a valid managed background");
  if (!store.importImage(secondPath).ok()) return fail("managed background could not recover after a missing file");

  const QString oversizedFile = directory.path() + QStringLiteral("/oversized.png");
  QFile oversized(oversizedFile);
  if (!oversized.open(QIODevice::WriteOnly) || !oversized.resize(25 * 1024 * 1024 + 1)) return fail("large fixture failed");
  oversized.close();
  if (store.importImage(oversizedFile).error != NewTabBackgroundStore::ImportError::FileTooLarge)
    return fail("oversized file was not rejected early");

  QImage unsafe(12001, 1, QImage::Format_ARGB32);
  unsafe.fill(Qt::black);
  const QString unsafePath = directory.path() + QStringLiteral("/unsafe.png");
  if (!unsafe.save(unsafePath, "PNG")
      || store.importImage(unsafePath).error != NewTabBackgroundStore::ImportError::UnsafeDimensions)
    return fail("unsafe dimensions were not rejected");

  qInfo("new-tab background store: ok");
  return 0;
}
