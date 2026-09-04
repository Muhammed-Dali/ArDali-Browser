#ifndef ARDALI_DESKTOP_TABS_TAB_GROUP_MODEL_H_
#define ARDALI_DESKTOP_TABS_TAB_GROUP_MODEL_H_

#include <QtCore/QUuid>
#include <QtGui/QColor>
#include <QList>
#include <QMap>
#include <QObject>
#include <QString>
#include <QUuid>
#include <cstdint>
#include <optional>

namespace ardali::desktop_tabs {

struct TabGroup {
  QUuid id;
  QString name;
  QColor color;
  bool collapsed = false;

  bool isValid() const { return !id.isNull(); }
};

// 9 Chrome-aligned high-contrast theme colors
inline const QList<QColor> &tabGroupColorPalette() {
  static const QList<QColor> kPalette = {
    QColor("#757b82"),  // Gri (Grey)
    QColor("#1a73e8"),  // Mavi (Blue)
    QColor("#d93025"),  // Kırmızı (Red)
    QColor("#f9ab00"),  // Sarı (Yellow)
    QColor("#1e8e3e"),  // Yeşil (Green)
    QColor("#e52592"),  // Pembe (Pink)
    QColor("#9334e6"),  // Mor (Purple)
    QColor("#12b5cb"),  // Camgöbeği (Cyan)
    QColor("#e8710a")   // Turuncu (Orange)
  };
  return kPalette;
}

class TabGroupModel : public QObject {
  Q_OBJECT
 public:
  explicit TabGroupModel(QObject *parent = nullptr);
  ~TabGroupModel() override = default;

  // Group metadata management
  QUuid createGroup(const QString &name = QString(), const QColor &color = QColor());
  void addOrUpdateGroup(const TabGroup &group);
  void removeGroup(const QUuid &groupId);
  std::optional<TabGroup> group(const QUuid &groupId) const;
  bool hasGroup(const QUuid &groupId) const;
  QList<TabGroup> allGroups() const;

  // Stable tab UID -> Group UID mapping (NEVER by index)
  void setTabGroup(uint64_t tabId, const QUuid &groupId);
  void removeTabFromGroup(uint64_t tabId);
  std::optional<QUuid> groupIdForTab(uint64_t tabId) const;
  QList<uint64_t> tabsInGroup(const QUuid &groupId) const;
  int groupTabCount(const QUuid &groupId) const;

  void clear();

 signals:
  void groupAdded(const TabGroup &group);
  void groupUpdated(const TabGroup &group);
  void groupRemoved(const QUuid &groupId);
  void tabGroupAssigned(uint64_t tabId, const QUuid &groupId);
  void tabGroupRemoved(uint64_t tabId);

 private:
  QMap<QUuid, TabGroup> groups_;
  QMap<uint64_t, QUuid> tabToGroup_;  // Keyed strictly by stable uint64_t tabId
};

}  // namespace ardali::desktop_tabs

#endif  // ARDALI_DESKTOP_TABS_TAB_GROUP_MODEL_H_
