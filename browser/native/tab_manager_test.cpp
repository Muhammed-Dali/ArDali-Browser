#include "tab_manager.h"
#include "session_store.h"

#include <QApplication>
#include <QPixmap>
#include <QTemporaryDir>
#include <QWebEnginePage>
#include <QWebEngineProfile>
#include <QWebEngineView>

#include <iostream>

int main(int argc, char *argv[]) {
  QApplication app(argc, argv);
  QObject mainOwner;
  QObject detachedOwner;
  QWebEngineProfile profile("ardali-tab-manager-test", &app);
  QWebEngineView first;
  QWebEngineView second;
  first.setPage(new QWebEnginePage(&profile, &first));
  second.setPage(new QWebEnginePage(&profile, &second));
  QWebEnginePage *const firstPage = first.page();

  TabManager manager;
  const auto firstId = manager.registerTab(&first, &mainOwner, false, "First");
  const auto secondId = manager.registerTab(&second, &mainOwner, false, "Second");
  if (firstId.isNull() || secondId.isNull() || !manager.activate(secondId)) return 1;
  if (!manager.transfer(firstId, &detachedOwner, true)) return 1;
  if (manager.record(firstId)->page != firstPage || !manager.record(firstId)->detached) return 1;
  manager.updateUrl(secondId, QUrl("https://example.com/session"));
  manager.updateTitle(secondId, "Session tab");
  if (!manager.markRendererCrashed(secondId, 2, 137) || !manager.record(secondId)->rendererCrashed) return 1;
  if (!manager.reorder(&mainOwner, {secondId})) return 1;
  QString reason;
  if (!manager.validate(&reason)) {
    std::cerr << reason.toStdString() << '\n';
    return 1;
  }
  QTemporaryDir directory;
  SessionStore sessions(directory.path() + "/tabs.session.json");
  if (!sessions.save(manager, &mainOwner)) return 1;
  const QVector<SavedTab> restored = sessions.load();
  // Test icon persistence and protection against null icon signals
  QPixmap pixmap(16, 16);
  pixmap.fill(Qt::blue);
  const QIcon testIcon(pixmap);
  if (testIcon.isNull()) {
    std::cerr << "test icon fixture is null\n";
    return 1;
  }
  manager.updateIcon(firstId, testIcon);
  if (manager.record(firstId)->icon.isNull()) {
    std::cerr << "icon update failed to store valid icon\n";
    return 1;
  }
  // Sending a null icon signal must NOT erase the stored favicon
  manager.updateIcon(firstId, QIcon());
  if (manager.record(firstId)->icon.isNull()) {
    std::cerr << "null icon signal wiped stored favicon\n";
    return 1;
  }

  std::cout << "tab manager ownership invariants: ok\n";
  std::cout << "tab manager icon persistence: ok\n";
  return 0;
}
