#include "core/application_identity.h"

#include <QApplication>
#include <QFile>
#include <QGuiApplication>

#include <cassert>
#include <iostream>

int main(int argc, char **argv) {
  QApplication app(argc, argv);
  ardali::application_identity::apply();
  assert(QCoreApplication::applicationName() == QStringLiteral("ArDaliBrowser"));
  assert(QCoreApplication::organizationName() == QStringLiteral("ArDali"));
  assert(QGuiApplication::applicationDisplayName() == QStringLiteral("ArDali"));
  assert(QGuiApplication::desktopFileName() == QStringLiteral("ardali"));

  QFile desktop(QStringLiteral(ARDALI_DESKTOP_FILE));
  assert(desktop.open(QIODevice::ReadOnly));
  const QByteArray entry = desktop.readAll();
  assert(entry.contains("Name=ArDali\n"));
  assert(entry.contains("StartupWMClass=ArDaliBrowser\n"));
  assert(entry.contains("StartupNotify=true\n"));
  assert(entry.contains("Icon=ardali\n"));
  std::cout << "Qt desktop identity and freedesktop launcher identity match: ok\n";
  return 0;
}
