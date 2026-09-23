#include "session_store.h"

#include "tab_manager.h"
#include "browser_window.h"
#include "security_utils.h"

#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QSaveFile>

#include <climits>

namespace {
// The audio runtime harness serves its disposable fixture on this endpoint.
// It must never become a user's restored browser session.
bool isRuntimeFixtureUrl(const QUrl &url) {
  const QString host = url.host().toLower();
  return (host == QStringLiteral("127.0.0.1") || host == QStringLiteral("localhost")) && url.port() == 18766;
}
}  // namespace

SessionStore::SessionStore(QString path) : path_(std::move(path)) {}

QVector<SavedTab> SessionStore::load() const {
  QFile file(path_);
  if (!file.open(QIODevice::ReadOnly)) return {};
  const QJsonDocument document = QJsonDocument::fromJson(file.readAll());
  QVector<SavedTab> result;
  QJsonArray sanitizedTabs;
  bool storageChanged = false;
  for (const QJsonValue &value : document.object().value("tabs").toArray()) {
    const QJsonObject entry = value.toObject();
    const QString originalUrl = entry.value("url").toString();
    const QUrl url = BrowserSecurity::sanitizeUrlForPersistence(QUrl(originalUrl));
    const QString scheme = url.scheme().toLower();
    const bool validScheme = scheme == QStringLiteral("http") || scheme == QStringLiteral("https")
                          || scheme == QStringLiteral("dalinira");
    if (!url.isValid() || !validScheme || isRuntimeFixtureUrl(url)) {
      storageChanged = true;
      continue;
    }
    QJsonObject safeEntry = entry;
    const QString encoded = url.toString(QUrl::FullyEncoded);
    if (encoded != originalUrl) { safeEntry.insert(QStringLiteral("url"), encoded); storageChanged = true; }
    sanitizedTabs.append(safeEntry);

    std::optional<QUuid> gid;
    if (entry.contains("groupId")) {
      const QUuid parsed = QUuid::fromString(entry.value("groupId").toString());
      if (!parsed.isNull()) gid = parsed;
    }
    const QString gname = entry.value("groupName").toString();
    const QColor gcolor = entry.contains("groupColor") ? QColor(entry.value("groupColor").toString()) : QColor();
    const bool gcol = entry.value("groupCollapsed").toBool();

    result.push_back({url, entry.value("title").toString(), entry.value("active").toBool(),
                      entry.value("pinned").toBool(), gid, gname, gcolor, gcol});
  }
  if (storageChanged) {
    QSaveFile sanitized(path_);
    const QByteArray bytes = QJsonDocument(QJsonObject{{"version", 1}, {"tabs", sanitizedTabs}}).toJson(QJsonDocument::Compact);
    if (sanitized.open(QIODevice::WriteOnly) && sanitized.write(bytes) == bytes.size() && sanitized.commit()) {
      QFile::setPermissions(path_, QFileDevice::ReadOwner | QFileDevice::WriteOwner);
    }
  }
  return result;
}

bool SessionStore::save(const TabManager &tabs, QObject *ownerWindow, QString *error) const {
  QJsonArray savedTabs;
  QVector<TabManager::TabRecord> records = tabs.recordsFor(ownerWindow);
  if (const auto *bw = qobject_cast<const BrowserWindow *>(ownerWindow)) {
    QHash<QUuid, int> visualOrder;
    const auto &visibleTabs = bw->allTabs();
    for (int i = 0; i < visibleTabs.size(); ++i) visualOrder.insert(visibleTabs[i].uuid, i);
    std::stable_sort(records.begin(), records.end(), [&visualOrder](const auto &left, const auto &right) {
      return visualOrder.value(left.id, INT_MAX) < visualOrder.value(right.id, INT_MAX);
    });
  }
  TabManager::TabId activePersistent;
  TabManager::TabId mostRecentPersistent;
  quint64 newestActivation = 0;
  for (const TabManager::TabRecord &record : records) {
    if (!record.capabilities.persistentInSession || record.detached || isRuntimeFixtureUrl(record.url)) continue;
    if (record.active) activePersistent = record.id;
    if (record.activationSerial >= newestActivation) {
      newestActivation = record.activationSerial;
      mostRecentPersistent = record.id;
    }
  }
  if (activePersistent.isNull()) activePersistent = mostRecentPersistent;
  for (const TabManager::TabRecord &record : records) {
    if (!record.capabilities.persistentInSession || record.detached || isRuntimeFixtureUrl(record.url)) continue;
    QUrl targetUrl = record.url;
    if (targetUrl.isEmpty()) {
      targetUrl = QUrl(QStringLiteral("dalinira://newtab/"));
    }
    const QUrl persistentUrl = BrowserSecurity::sanitizeUrlForPersistence(targetUrl);
    const QString scheme = persistentUrl.scheme().toLower();
    const bool validScheme = scheme == QStringLiteral("http") || scheme == QStringLiteral("https")
                          || scheme == QStringLiteral("dalinira");
    if (!persistentUrl.isValid() || !validScheme || isRuntimeFixtureUrl(persistentUrl)) continue;

    QJsonObject tabObj{{"url", persistentUrl.toString(QUrl::FullyEncoded)}, {"title", record.title},
                        {"active", record.id == activePersistent}};
    if (ownerWindow) {
      const auto *bw = qobject_cast<const BrowserWindow*>(ownerWindow);
      if (bw) {
        for (const auto &info : bw->allTabs()) {
          if (info.uuid != record.id) continue;
          tabObj.insert(QStringLiteral("pinned"), info.isPinned);
          if (info.groupId.has_value() && !info.groupId->isNull()) {
            tabObj.insert(QStringLiteral("groupId"), info.groupId->toString());
            const auto optGroup = bw->groupForTab(info.id);
            if (optGroup.has_value()) {
              tabObj.insert(QStringLiteral("groupName"), optGroup->name);
              tabObj.insert(QStringLiteral("groupColor"), optGroup->color.name());
              tabObj.insert(QStringLiteral("groupCollapsed"), optGroup->collapsed);
            }
          }
          break;
        }
      }
    }
    savedTabs.push_back(tabObj);
  }
  QSaveFile file(path_);
  if (!file.open(QIODevice::WriteOnly)) {
    if (error) *error = QStringLiteral("Cannot write session file");
    return false;
  }
  file.write(QJsonDocument(QJsonObject{{"version", 1}, {"tabs", savedTabs}}).toJson(QJsonDocument::Compact));
  if (!file.commit()) {
    if (error) *error = QStringLiteral("Cannot commit session file");
    return false;
  }
  QFile::setPermissions(path_, QFileDevice::ReadOwner | QFileDevice::WriteOwner);
  return true;
}
