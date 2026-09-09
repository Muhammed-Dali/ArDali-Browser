#include "browser_icons.h"
#include "search_engine_definition.h"

#include <QGuiApplication>
#include <QPainter>
#include <QPainterPath>
#include <QSvgRenderer>

namespace {
QPixmap renderTinted(const QString &path, int size, const QColor &color) {
  QSvgRenderer renderer(path);
  QPixmap source(size, size);
  source.fill(Qt::transparent);
  QPainter sourcePainter(&source);
  renderer.render(&sourcePainter, QRectF(0, 0, size, size));
  sourcePainter.end();
  QPainter tintPainter(&source);
  tintPainter.setCompositionMode(QPainter::CompositionMode_SourceIn);
  tintPainter.fillRect(source.rect(), color);
  return source;
}
}

QString BrowserIcons::resourcePath(BrowserIcon id) {
  switch (id) {
    case BrowserIcon::Startup: return QStringLiteral(":/browser-icons/startup.svg");
    case BrowserIcon::Appearance: return QStringLiteral(":/browser-icons/appearance.svg");
    case BrowserIcon::Performance: return QStringLiteral(":/browser-icons/performance.svg");
    case BrowserIcon::Content: return QStringLiteral(":/browser-icons/content.svg");
    case BrowserIcon::Privacy: return QStringLiteral(":/browser-icons/privacy.svg");
    case BrowserIcon::Search: return QStringLiteral(":/browser-icons/search.svg");
    case BrowserIcon::Password: return QStringLiteral(":/browser-icons/password.svg");
    case BrowserIcon::Bookmark: return QStringLiteral(":/browser-icons/bookmark.svg");
    case BrowserIcon::Download: return QStringLiteral(":/browser-icons/download.svg");
    case BrowserIcon::Language: return QStringLiteral(":/browser-icons/language.svg");
    case BrowserIcon::Translate: return QStringLiteral(":/browser-icons/language.svg");
    case BrowserIcon::Accessibility: return QStringLiteral(":/browser-icons/accessibility.svg");
    case BrowserIcon::Settings: return QStringLiteral(":/browser-icons/settings.svg");
    case BrowserIcon::Reset: return QStringLiteral(":/browser-icons/reset.svg");
    case BrowserIcon::Info: return QStringLiteral(":/browser-icons/info.svg");
    case BrowserIcon::NewTab: return QStringLiteral(":/browser-icons/new-tab.svg");
    case BrowserIcon::Window: return QStringLiteral(":/browser-icons/window.svg");
    case BrowserIcon::Incognito: return QStringLiteral(":/browser-icons/incognito.svg");
    case BrowserIcon::History: return QStringLiteral(":/browser-icons/history.svg");
    case BrowserIcon::Zoom: return QStringLiteral(":/browser-icons/zoom.svg");
    case BrowserIcon::Print: return QStringLiteral(":/browser-icons/print.svg");
    case BrowserIcon::Save: return QStringLiteral(":/browser-icons/save.svg");
    case BrowserIcon::Tools: return QStringLiteral(":/browser-icons/tools.svg");
    case BrowserIcon::Help: return QStringLiteral(":/browser-icons/help.svg");
    case BrowserIcon::Exit: return QStringLiteral(":/browser-icons/exit.svg");
    case BrowserIcon::Folder: return QStringLiteral(":/browser-icons/folder.svg");
    case BrowserIcon::Trash: return QStringLiteral(":/browser-icons/trash.svg");
    case BrowserIcon::Grid: return QStringLiteral(":/browser-icons/grid.svg");
    case BrowserIcon::Clock: return QStringLiteral(":/browser-icons/clock.svg");
    case BrowserIcon::Cards: return QStringLiteral(":/browser-icons/cards.svg");
    case BrowserIcon::Video: return QStringLiteral(":/browser-icons/video.svg");
    case BrowserIcon::Music: return QStringLiteral(":/browser-icons/music.svg");
    case BrowserIcon::Play: return QStringLiteral(":/browser-icons/play.svg");
    case BrowserIcon::Clipboard: return QStringLiteral(":/browser-icons/clipboard.svg");
    case BrowserIcon::More: return QStringLiteral(":/browser-icons/more.svg");
    case BrowserIcon::Minimize: return QStringLiteral(":/browser-icons/minimize.svg");
    case BrowserIcon::Maximize: return QStringLiteral(":/browser-icons/maximize.svg");
    case BrowserIcon::Restore: return QStringLiteral(":/browser-icons/restore.svg");
    case BrowserIcon::Close: return QStringLiteral(":/browser-icons/close.svg");
    case BrowserIcon::Audio: return QStringLiteral(":/browser-icons/audio.svg");
    case BrowserIcon::Memory: return QStringLiteral(":/browser-icons/memory.svg");
    case BrowserIcon::Location: return QStringLiteral(":/browser-icons/location.svg");
    case BrowserIcon::Camera: return QStringLiteral(":/browser-icons/camera.svg");
    case BrowserIcon::Microphone: return QStringLiteral(":/browser-icons/microphone.svg");
    case BrowserIcon::Notification: return QStringLiteral(":/browser-icons/notification.svg");
    case BrowserIcon::Cookie: return QStringLiteral(":/browser-icons/cookie.svg");
    case BrowserIcon::Javascript: return QStringLiteral(":/browser-icons/javascript.svg");
    case BrowserIcon::Image: return QStringLiteral(":/browser-icons/image.svg");
    case BrowserIcon::Popup: return QStringLiteral(":/browser-icons/popup.svg");
    case BrowserIcon::ChevronRight: return QStringLiteral(":/browser-icons/chevron-right.svg");
    case BrowserIcon::ChevronDown: return QStringLiteral(":/browser-icons/chevron-down.svg");
    case BrowserIcon::Fonts: return QStringLiteral(":/browser-icons/fonts.svg");
    case BrowserIcon::Mouse: return QStringLiteral(":/browser-icons/mouse.svg");
    case BrowserIcon::Pdf: return QStringLiteral(":/browser-icons/pdf.svg");
    case BrowserIcon::LocationSlash: return QStringLiteral(":/browser-icons/location-slash.svg");
    case BrowserIcon::CameraSlash: return QStringLiteral(":/browser-icons/camera-slash.svg");
    case BrowserIcon::MicrophoneSlash: return QStringLiteral(":/browser-icons/microphone-slash.svg");
    case BrowserIcon::NotificationSlash: return QStringLiteral(":/browser-icons/notification-slash.svg");
    case BrowserIcon::ArrowLeft: return QStringLiteral(":/browser-icons/arrow-left.svg");
    case BrowserIcon::JavascriptSlash: return QStringLiteral(":/browser-icons/javascript-slash.svg");
    case BrowserIcon::ImageSlash: return QStringLiteral(":/browser-icons/image-slash.svg");
    case BrowserIcon::PopupSlash: return QStringLiteral(":/browser-icons/popup-slash.svg");
    case BrowserIcon::ProtectedContent: return QStringLiteral(":/browser-icons/protected-content.svg");
    case BrowserIcon::InsecureContent: return QStringLiteral(":/browser-icons/insecure-content.svg");
    case BrowserIcon::SiteData: return QStringLiteral(":/browser-icons/site-data.svg");
    case BrowserIcon::JsOptimize: return QStringLiteral(":/browser-icons/js-optimize.svg");
    case BrowserIcon::Fullscreen: return QStringLiteral(":/browser-icons/fullscreen.svg");
    case BrowserIcon::Tune: return QStringLiteral(":/browser-icons/tune.svg");
  }
  return {};
}

QIcon BrowserIcons::icon(BrowserIcon id) {
  QIcon result;
  const QString path = resourcePath(id);
  for (const int size : {16, 18, 20, 24, 32, 36, 48, 64}) {
    result.addPixmap(renderTinted(path, size, QColor(QStringLiteral("#b8c5d6"))), QIcon::Normal, QIcon::Off);
    result.addPixmap(renderTinted(path, size, QColor(QStringLiteral("#eff7ff"))), QIcon::Selected, QIcon::Off);
    result.addPixmap(renderTinted(path, size, QColor(QStringLiteral("#687584"))), QIcon::Disabled, QIcon::Off);
  }
  return result;
}

QIcon BrowserIcons::appIcon() {
  const QIcon windowIcon = QGuiApplication::windowIcon();
  if (!windowIcon.isNull()) return windowIcon;
  QIcon icon(QStringLiteral(":/assets/icons/ardali-browser-256.png"));
  if (icon.isNull()) icon = QIcon(QStringLiteral(":/icons/ardali-browser-256.png"));
  if (icon.isNull()) icon = QIcon(QStringLiteral(":/assets/icons/ardali-browser-128.png"));
  return icon;
}

QIcon BrowserIcons::youtubeIcon() {
  QIcon icon;
  for (const int size : {16, 18, 20, 24, 32, 36, 48, 64}) {
    QPixmap pm(size, size);
    pm.fill(Qt::transparent);
    QPainter p(&pm);
    p.setRenderHint(QPainter::Antialiasing);

    // Red rounded background
    const qreal r = size * 0.22;
    const QRectF rect(0, size * 0.16, size, size * 0.68);
    p.setPen(Qt::NoPen);
    p.setBrush(QColor(QStringLiteral("#ff0033")));
    p.drawRoundedRect(rect, r, r);

    // White play triangle
    QPainterPath path;
    const qreal cx = size * 0.50;
    const qreal cy = size * 0.50;
    const qreal h = size * 0.20;
    path.moveTo(cx - h * 0.7, cy - h);
    path.lineTo(cx + h * 0.9, cy);
    path.lineTo(cx - h * 0.7, cy + h);
    path.closeSubpath();
    p.setBrush(Qt::white);
    p.drawPath(path);

    icon.addPixmap(pm);
  }
  return icon;
}

QIcon BrowserIcons::youtubeMusicIcon() {
  QIcon icon;
  for (const int size : {16, 18, 20, 24, 32, 36, 48, 64}) {
    QPixmap pm(size, size);
    pm.fill(Qt::transparent);
    QPainter p(&pm);
    p.setRenderHint(QPainter::Antialiasing);

    // Red circle
    p.setPen(Qt::NoPen);
    p.setBrush(QColor(QStringLiteral("#ff0033")));
    p.drawEllipse(QRectF(0, 0, size, size));

    // Outer white concentric ring
    QPen ringPen(QColor(255, 255, 255, 200), std::max(1.0, size * 0.08));
    p.setPen(ringPen);
    p.setBrush(Qt::NoBrush);
    const qreal m = size * 0.18;
    p.drawEllipse(QRectF(m, m, size - 2 * m, size - 2 * m));

    // Inner white triangle
    QPainterPath path;
    const qreal cx = size * 0.52;
    const qreal cy = size * 0.50;
    const qreal h = size * 0.18;
    path.moveTo(cx - h * 0.6, cy - h);
    path.lineTo(cx + h * 0.8, cy);
    path.lineTo(cx - h * 0.6, cy + h);
    path.closeSubpath();
    p.setPen(Qt::NoPen);
    p.setBrush(Qt::white);
    p.drawPath(path);

    icon.addPixmap(pm);
  }
  return icon;
}

QIcon BrowserIcons::searchEngineIcon(const QString &engineName) {
  QIcon engineIcon(ardali::core::searchEngineResourcePath(engineName));
  if (!engineIcon.isNull()) return engineIcon;

  return icon(BrowserIcon::Search);
}

QIcon BrowserIcons::combinedMediaCaptureIcon() {
  QIcon result;
  for (const int size : {16, 18, 20, 24, 32, 48}) {
    QPixmap px(size, size);
    px.fill(Qt::transparent);
    QPainter p(&px);
    p.setRenderHint(QPainter::Antialiasing);
    const int subSize = size * 11 / 20;
    QPixmap cam = renderTinted(resourcePath(BrowserIcon::Camera), subSize, QColor(QStringLiteral("#58a6c7")));
    QPixmap mic = renderTinted(resourcePath(BrowserIcon::Microphone), subSize, QColor(QStringLiteral("#58a6c7")));
    p.drawPixmap(0, (size - subSize) / 2, cam);
    p.drawPixmap(size - subSize, (size - subSize) / 2, mic);
    p.end();
    result.addPixmap(px);
  }
  return result;
}
