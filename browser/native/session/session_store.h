#pragma once

#include <QString>
#include <QUrl>
#include <QVector>
#include <QUuid>
#include <QColor>
#include <optional>

class TabManager;
class QObject;

struct SavedTab final {
  QUrl url;
  QString title;
  bool active = false;
  std::optional<QUuid> groupId;
  QString groupName;
  QColor groupColor;
  bool groupCollapsed = false;
};

class SessionStore final {
 public:
  explicit SessionStore(QString path);

  QVector<SavedTab> load() const;
  bool save(const TabManager &tabs, QObject *ownerWindow, QString *error = nullptr) const;

 private:
  QString path_;
};
