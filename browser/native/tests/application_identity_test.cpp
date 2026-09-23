#include "core/application_identity.h"

#include <QApplication>
#include <QFile>
#include <QGuiApplication>

#include <cassert>
#include <iostream>

int main(int argc, char **argv) {
  QApplication app(argc, argv);
  dalinira::application_identity::apply();
  assert(QCoreApplication::applicationName() == QStringLiteral("DaliNiraBrowser"));
  assert(QCoreApplication::organizationName() == QStringLiteral("DaliNira"));
  assert(QGuiApplication::applicationDisplayName() == QStringLiteral("DaliNira"));
  assert(QGuiApplication::desktopFileName() == QStringLiteral("dalinira"));

  QFile desktop(QStringLiteral(DALINIRA_DESKTOP_FILE));
  assert(desktop.open(QIODevice::ReadOnly));
  const QByteArray entry = desktop.readAll();
  assert(entry.contains("Name=DaliNira\n"));
  assert(entry.contains("StartupWMClass=DaliNiraBrowser\n"));
  assert(entry.contains("StartupNotify=true\n"));
  assert(entry.contains("Icon=dalinira\n"));
  std::cout << "Qt desktop identity and freedesktop launcher identity match: ok\n";
  return 0;
}
