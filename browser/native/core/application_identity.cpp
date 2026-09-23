#include "application_identity.h"

#include <QCoreApplication>
#include <QGuiApplication>

namespace dalinira::application_identity {

void apply() {
  QCoreApplication::setApplicationName(QString::fromLatin1(kApplicationName));
  QCoreApplication::setOrganizationName(QString::fromLatin1(kOrganizationName));
  QGuiApplication::setApplicationDisplayName(QString::fromLatin1(kDisplayName));
  // Qt appends ".desktop" when resolving the freedesktop desktop entry.  Keeping
  // this basename identical to dalinira.desktop also sets the Wayland app_id used
  // by Plasma/GNOME to associate a running window with its pinned launcher.
  QGuiApplication::setDesktopFileName(QString::fromLatin1(kDesktopFileName));
}

}  // namespace dalinira::application_identity
