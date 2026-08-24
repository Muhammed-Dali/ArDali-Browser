#include <QApplication>
#include <QIcon>
#include <QPalette>
#include <QWebEngineView>
#include <cassert>
#include <iostream>

#include "tab_throbber.h"

void testStartAndFinishLoading() {
  QWebEngineView view;
  QObject owner;
  TabThrobber &throbber = TabThrobber::instance();

  assert(!throbber.isLoading(&view));
  throbber.startLoading(&view, &owner, 1000);

  assert(throbber.isLoading(&view));
  assert(throbber.isTimerActive());

  throbber.finishLoading(&view, true);
  assert(!throbber.isLoading(&view));
  assert(!throbber.isTimerActive());
  std::cout << "[PASS] testStartAndFinishLoading" << std::endl;
}

void testActivationDelay() {
  QWebEngineView view;
  QObject owner;
  TabThrobber &throbber = TabThrobber::instance();

  const qint64 startTime = 10000;
  throbber.startLoading(&view, &owner, startTime);

  assert(throbber.isLoading(&view));
  assert(!throbber.isThrobberVisible(&view)); // Not visible yet due to <100ms activation delay

  throbber.finishLoading(&view, true);
  assert(!throbber.isThrobberVisible(&view));
  std::cout << "[PASS] testActivationDelay" << std::endl;
}

void testCacheFaviconDuringLoad() {
  QWebEngineView view;
  QObject owner;
  TabThrobber &throbber = TabThrobber::instance();

  throbber.startLoading(&view, &owner, 1000);

  QPixmap px(16, 16);
  px.fill(Qt::red);
  const QIcon favicon(px);

  throbber.cacheFavicon(&view, favicon);
  assert(throbber.isLoading(&view));
  assert(!throbber.cachedFavicon(&view).isNull());

  throbber.finishLoading(&view, true);
  assert(!throbber.isLoading(&view));
  std::cout << "[PASS] testCacheFaviconDuringLoad" << std::endl;
}

void testOwnerUpdate() {
  QWebEngineView view;
  QObject owner1;
  QObject owner2;
  TabThrobber &throbber = TabThrobber::instance();

  throbber.startLoading(&view, &owner1, 1000);
  throbber.updateOwner(&view, &owner2);

  assert(throbber.isLoading(&view));
  throbber.finishLoading(&view, true);
  std::cout << "[PASS] testOwnerUpdate" << std::endl;
}

void testRenderThrobberIcon() {
  QPalette palette;
  const QIcon activeIcon = TabThrobber::renderThrobberIcon(5, palette, true, 1.0);
  const QIcon inactiveIcon = TabThrobber::renderThrobberIcon(5, palette, false, 2.0);

  assert(!activeIcon.isNull());
  assert(!inactiveIcon.isNull());
  assert(!activeIcon.pixmap(16, 16).isNull());
  assert(!inactiveIcon.pixmap(32, 32).isNull());

  std::cout << "[PASS] testRenderThrobberIcon" << std::endl;
}

int main(int argc, char *argv[]) {
  QApplication app(argc, argv);

  testStartAndFinishLoading();
  testActivationDelay();
  testCacheFaviconDuringLoad();
  testOwnerUpdate();
  testRenderThrobberIcon();

  std::cout << "All TabThrobber tests passed!" << std::endl;
  return 0;
}
