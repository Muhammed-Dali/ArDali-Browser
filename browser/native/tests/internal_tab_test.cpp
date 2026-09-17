#include "session_store.h"
#include "tab_manager.h"

#include <QApplication>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QTemporaryDir>
#include <QWebEnginePage>
#include <QWebEngineProfile>
#include <QWebEngineView>
#include <QWidget>

#include <iostream>

int main(int argc, char *argv[]) {
  QApplication app(argc, argv);
  QObject owner;
  QWebEngineProfile profile(QStringLiteral("ardali-internal-tab-test"), &app);
  QWebEngineView web;
  web.setPage(new QWebEnginePage(&profile, &web));
  TabManager manager;

  const auto webId = manager.registerTab(&web, &owner, false, QStringLiteral("Web"));
  manager.updateUrl(webId, QUrl(QStringLiteral("https://example.com/callback?code=synthetic-code&q=ardali")));
  if (webId.isNull() || !manager.activate(webId)) return 1;

  QWidget settings;
  const TabManager::TabCapabilities settingsCapabilities{true, true, false, false};
  const auto settingsId = manager.registerInternalTab(&settings, &owner, QStringLiteral("Ayarlar"),
                                                       QStringLiteral("settings"), settingsCapabilities);
  const TabManager::TabRecord *settingsRecord = manager.record(settingsId);
  if (settingsId.isNull() || !settingsRecord || settingsRecord->kind != TabManager::TabKind::Internal
      || settingsRecord->internalId != QStringLiteral("settings") || settingsRecord->capabilities.detachable
      || settingsRecord->capabilities.persistentInSession || !settingsRecord->capabilities.closable) return 1;

  QWidget duplicate;
  if (!manager.registerInternalTab(&duplicate, &owner, QStringLiteral("Ayarlar"), QStringLiteral("settings"),
                                   settingsCapabilities).isNull()) return 1;
  if (!manager.activate(settingsId) || manager.activeFor(&owner) != settingsId) return 1;
  if (!manager.reorder(&owner, {settingsId, webId})) return 1;
  const QVector<TabManager::TabRecord> reordered = manager.recordsFor(&owner);
  if (reordered.size() != 2 || reordered[0].id != settingsId || reordered[1].id != webId) return 1;

  QTemporaryDir directory;
  const QString legacyPath = directory.path() + QStringLiteral("/legacy.session.json");
  QFile legacyFile(legacyPath);
  if (!legacyFile.open(QIODevice::WriteOnly)) return 1;
  const QJsonObject legacyEntry{
      {QStringLiteral("url"), QStringLiteral("https://user:synthetic-password@example.com/callback?code=synthetic-code&q=kept#access_token=synthetic-token&state=kept")},
      {QStringLiteral("title"), QStringLiteral("Legacy")},
      {QStringLiteral("active"), true}};
  legacyFile.write(QJsonDocument(QJsonObject{{QStringLiteral("version"), 1},
      {QStringLiteral("tabs"), QJsonArray{legacyEntry}}}).toJson(QJsonDocument::Compact));
  legacyFile.close();
  SessionStore legacySessions(legacyPath);
  const QVector<SavedTab> migrated = legacySessions.load();
  if (migrated.size() != 1 || migrated.front().url
      != QUrl(QStringLiteral("https://example.com/callback?q=kept#state=kept"))) return 1;
  if (!legacyFile.open(QIODevice::ReadOnly)) return 1;
  const QByteArray migratedBytes = legacyFile.readAll();
  if (migratedBytes.contains("synthetic-") || !migratedBytes.contains("q=kept")
      || !migratedBytes.contains("state=kept")) return 1;
  legacyFile.close();

  SessionStore sessions(directory.path() + QStringLiteral("/tabs.session.json"));
  if (!sessions.save(manager, &owner)) return 1;
  const auto sessionPermissions = QFileInfo(directory.path() + QStringLiteral("/tabs.session.json")).permissions();
  if (sessionPermissions & (QFileDevice::ReadGroup | QFileDevice::ReadOther
                            | QFileDevice::WriteGroup | QFileDevice::WriteOther)) return 1;
  const QVector<SavedTab> restored = sessions.load();
  if (restored.size() != 1 || restored.front().url != QUrl(QStringLiteral("https://example.com/callback?q=ardali"))
      || !restored.front().active) return 1;
  QFile persistedSession(directory.path() + QStringLiteral("/tabs.session.json"));
  if (!persistedSession.open(QIODevice::ReadOnly)) return 1;
  const QByteArray sessionBytes = persistedSession.readAll();
  if (sessionBytes.contains("synthetic-code") || !sessionBytes.contains("q=ardali")) return 1;

  if (!manager.remove(settingsId) || !manager.findInternal(&owner, QStringLiteral("settings")).isNull()) return 1;
  QWidget reopenedSettings;
  const auto reopenedId = manager.registerInternalTab(&reopenedSettings, &owner, QStringLiteral("Ayarlar"),
                                                       QStringLiteral("settings"), settingsCapabilities);
  if (reopenedId.isNull() || reopenedId == settingsId || !manager.activate(reopenedId)
      || manager.activeFor(&owner) != reopenedId) return 1;
  QString reason;
  if (!manager.validate(&reason)) {
    std::cerr << reason.toStdString() << '\n';
    return 1;
  }
  // Verify off-the-record profile and incognito session isolation
  QWebEngineProfile incognitoProfile(&app);
  if (!incognitoProfile.isOffTheRecord()) {
    std::cerr << "Incognito profile must be off-the-record\n";
    return 1;
  }
  QObject incognitoOwner;
  QWebEngineView incognitoWeb;
  incognitoWeb.setPage(new QWebEnginePage(&incognitoProfile, &incognitoWeb));
  const auto incognitoWebId = manager.registerTab(&incognitoWeb, &incognitoOwner, false, QStringLiteral("Incognito Web"));
  manager.updateUrl(incognitoWebId, QUrl(QStringLiteral("https://private.example.com/secret")));
  if (const TabManager::TabRecord *incognitoRecord = manager.record(incognitoWebId)) {
    const_cast<TabManager::TabRecord *>(incognitoRecord)->capabilities.persistentInSession = false;
  }
  if (!manager.activate(incognitoWebId)) return 1;

  const QString incognitoSessionPath = directory.path() + QStringLiteral("/incognito.session.json");
  SessionStore incognitoSessions(incognitoSessionPath);
  if (!incognitoSessions.save(manager, &incognitoOwner)) return 1;
  const QVector<SavedTab> incognitoRestored = incognitoSessions.load();
  if (!incognitoRestored.isEmpty()) {
    std::cerr << "Incognito session must not persist any tabs\n";
    return 1;
  }

  std::cout << "internal settings and incognito isolation lifecycle: ok\n";
  return 0;
}
