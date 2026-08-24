#pragma once

#include <QString>

class NewTabBackgroundStore final {
 public:
  enum class ImportError { None, UnsupportedFormat, InvalidImage, FileTooLarge, UnsafeDimensions, StorageFailure };

  struct ImportResult {
    ImportError error = ImportError::None;
    QString message;
    bool ok() const { return error == ImportError::None; }
  };

  explicit NewTabBackgroundStore(const QString &profileDataDirectory);

  ImportResult importImage(const QString &sourcePath);
  bool removeManagedImage();
  bool hasValidManagedImage() const;
  QString managedImagePath() const;
  QString thumbnailPath() const;

 private:
  bool writeImageAtomically(const QString &path, const class QImage &image, const char *format, int quality = -1) const;

  QString directory_;
};
