#pragma once

#include <QSet>
#include <QString>
#include <QUrl>

class BrowserPolicy final {
 public:
  static BrowserPolicy load(const QString &path, QString *error = nullptr);

  bool isValid() const { return valid_; }
  bool allowsNavigation(const QUrl &url) const;
  bool allowsDownloadPrompt() const;
  bool allowsSessionRestore() const;
  bool blocksUnrequestedPopups() const;

 private:
  bool valid_ = false;
  QSet<QString> allowed_;
  QSet<QString> denied_;
};
