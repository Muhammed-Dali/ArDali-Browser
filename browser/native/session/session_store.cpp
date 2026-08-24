#include "session_store.h"

#include "tab_manager.h"

#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QSaveFile>

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
  for (const QJsonValue &value : document.object().value("tabs").toArray()) {
    const QJsonObject entry = value.toObject();
    const QUrl url(entry.value("url").toString());
    if (!url.isValid() || (url.scheme() != QStringLiteral("http") && url.scheme() != QStringLiteral("https"))
        || isRuntimeFixtureUrl(url)) continue;
    result.push_back({url, entry.value("title").toString(), entry.value("active").toBool()});
  }
  return result;
}

bool SessionStore::save(const TabManager &tabs, QObject *ownerWindow, QString *error) const {
  QJsonArray savedTabs;
  const QVector<TabManager::TabRecord> records = tabs.recordsFor(ownerWindow);
  TabManager::TabId activePersistent;
  TabManager::TabId mostRecentPersistent;
  quint64 newestActivation = 0;
  for (const TabManager::TabRecord &record : records) {
    if (!record.capabilities.persistentInSession || record.kind != TabManager::TabKind::Web
        || record.detached || !record.url.isValid() || isRuntimeFixtureUrl(record.url)) continue;
    if (record.active) activePersistent = record.id;
    if (record.activationSerial >= newestActivation) {
      newestActivation = record.activationSerial;
      mostRecentPersistent = record.id;
    }
  }
  if (activePersistent.isNull()) activePersistent = mostRecentPersistent;
  for (const TabManager::TabRecord &record : records) {
    if (!record.capabilities.persistentInSession || record.kind != TabManager::TabKind::Web
        || record.detached || !record.url.isValid() || isRuntimeFixtureUrl(record.url)) continue;
    savedTabs.push_back(QJsonObject{{"url", record.url.toString()}, {"title", record.title},
                                    {"active", record.id == activePersistent}});
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
  return true;
}
