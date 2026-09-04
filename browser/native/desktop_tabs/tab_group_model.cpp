#include "tab_group_model.h"

namespace ardali::desktop_tabs {

TabGroupModel::TabGroupModel(QObject *parent) : QObject(parent) {}

QUuid TabGroupModel::createGroup(const QString &name, const QColor &color) {
  TabGroup group;
  group.id = QUuid::createUuid();
  group.name = name;
  const auto &palette = tabGroupColorPalette();
  if (color.isValid()) {
    group.color = color;
  } else {
    // Pick color based on existing group count to cycle nicely through palette
    const int idx = groups_.size() % palette.size();
    group.color = palette[idx];
  }
  group.collapsed = false;

  groups_.insert(group.id, group);
  emit groupAdded(group);
  return group.id;
}

void TabGroupModel::addOrUpdateGroup(const TabGroup &group) {
  if (!group.isValid()) return;
  const bool isNew = !groups_.contains(group.id);
  groups_.insert(group.id, group);
  if (isNew) {
    emit groupAdded(group);
  } else {
    emit groupUpdated(group);
  }
}

void TabGroupModel::removeGroup(const QUuid &groupId) {
  if (groupId.isNull() || !groups_.contains(groupId)) return;

  // Unassign all tabs belonging to this group
  QList<uint64_t> tabsToRemove;
  for (auto it = tabToGroup_.begin(); it != tabToGroup_.end(); ++it) {
    if (it.value() == groupId) {
      tabsToRemove.append(it.key());
    }
  }
  for (uint64_t tabId : tabsToRemove) {
    tabToGroup_.remove(tabId);
    emit tabGroupRemoved(tabId);
  }

  groups_.remove(groupId);
  emit groupRemoved(groupId);
}

std::optional<TabGroup> TabGroupModel::group(const QUuid &groupId) const {
  auto it = groups_.find(groupId);
  if (it != groups_.end()) {
    return it.value();
  }
  return std::nullopt;
}

bool TabGroupModel::hasGroup(const QUuid &groupId) const {
  return !groupId.isNull() && groups_.contains(groupId);
}

QList<TabGroup> TabGroupModel::allGroups() const {
  return groups_.values();
}

void TabGroupModel::setTabGroup(uint64_t tabId, const QUuid &groupId) {
  if (tabId == 0 || groupId.isNull()) return;

  const auto oldGroup = tabToGroup_.value(tabId, QUuid());
  if (oldGroup == groupId) return;

  tabToGroup_.insert(tabId, groupId);
  emit tabGroupAssigned(tabId, groupId);
}

void TabGroupModel::removeTabFromGroup(uint64_t tabId) {
  if (tabId == 0) return;
  if (tabToGroup_.remove(tabId) > 0) {
    emit tabGroupRemoved(tabId);
  }
}

std::optional<QUuid> TabGroupModel::groupIdForTab(uint64_t tabId) const {
  auto it = tabToGroup_.find(tabId);
  if (it != tabToGroup_.end()) {
    return it.value();
  }
  return std::nullopt;
}

QList<uint64_t> TabGroupModel::tabsInGroup(const QUuid &groupId) const {
  QList<uint64_t> result;
  if (groupId.isNull()) return result;
  for (auto it = tabToGroup_.begin(); it != tabToGroup_.end(); ++it) {
    if (it.value() == groupId) {
      result.append(it.key());
    }
  }
  return result;
}

int TabGroupModel::groupTabCount(const QUuid &groupId) const {
  int count = 0;
  for (auto it = tabToGroup_.begin(); it != tabToGroup_.end(); ++it) {
    if (it.value() == groupId) ++count;
  }
  return count;
}

void TabGroupModel::clear() {
  groups_.clear();
  tabToGroup_.clear();
}

}  // namespace ardali::desktop_tabs
