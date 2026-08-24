#include "session_store.h"
#include "tab_manager.h"

#include <QApplication>
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
  manager.updateUrl(webId, QUrl(QStringLiteral("https://example.com/")));
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
  SessionStore sessions(directory.path() + QStringLiteral("/tabs.session.json"));
  if (!sessions.save(manager, &owner)) return 1;
  const QVector<SavedTab> restored = sessions.load();
  if (restored.size() != 1 || restored.front().url != QUrl(QStringLiteral("https://example.com/"))
      || !restored.front().active) return 1;

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
  std::cout << "internal settings tab lifecycle: ok\n";
  return 0;
}
