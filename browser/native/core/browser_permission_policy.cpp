#include "browser_permission_policy.h"

namespace BrowserPermissionPolicy {

QT_WARNING_PUSH
QT_WARNING_DISABLE_DEPRECATED
QString featureName(QWebEnginePage::Feature feature) {
  switch (feature) {
    case QWebEnginePage::Geolocation: return QStringLiteral("konum");
    case QWebEnginePage::MediaAudioCapture: return QStringLiteral("mikrofon");
    case QWebEnginePage::MediaVideoCapture: return QStringLiteral("kamera");
    case QWebEnginePage::MediaAudioVideoCapture: return QStringLiteral("kamera ve mikrofon");
    case QWebEnginePage::MouseLock: return QStringLiteral("fare kilidi");
    case QWebEnginePage::DesktopVideoCapture: return QStringLiteral("ekran paylaşımı");
    case QWebEnginePage::DesktopAudioVideoCapture: return QStringLiteral("ekran ve ses paylaşımı");
    case QWebEnginePage::Notifications: return QStringLiteral("bildirim");
    case QWebEnginePage::ClipboardReadWrite: return QStringLiteral("pano erişimi");
    case QWebEnginePage::LocalFontsAccess: return QStringLiteral("yerel yazı tipleri");
  }
  return QStringLiteral("site özelliği");
}
QT_WARNING_POP

}  // namespace BrowserPermissionPolicy
