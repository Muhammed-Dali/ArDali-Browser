#include "browser_icons.h"

#include <QPainter>
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
    case BrowserIcon::Content: return QStringLiteral(":/browser-icons/content.svg");
    case BrowserIcon::Privacy: return QStringLiteral(":/browser-icons/privacy.svg");
    case BrowserIcon::Search: return QStringLiteral(":/browser-icons/search.svg");
    case BrowserIcon::Password: return QStringLiteral(":/browser-icons/password.svg");
    case BrowserIcon::Bookmark: return QStringLiteral(":/browser-icons/bookmark.svg");
    case BrowserIcon::Download: return QStringLiteral(":/browser-icons/download.svg");
    case BrowserIcon::Language: return QStringLiteral(":/browser-icons/language.svg");
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
    case BrowserIcon::Minimize: return QStringLiteral(":/browser-icons/minimize.svg");
    case BrowserIcon::Maximize: return QStringLiteral(":/browser-icons/maximize.svg");
    case BrowserIcon::Restore: return QStringLiteral(":/browser-icons/restore.svg");
    case BrowserIcon::Close: return QStringLiteral(":/browser-icons/close.svg");
  }
  return {};
}

QIcon BrowserIcons::icon(BrowserIcon id) {
  QIcon result;
  const QString path = resourcePath(id);
  for (const int size : {16, 18, 20, 24, 32}) {
    result.addPixmap(renderTinted(path, size, QColor(QStringLiteral("#b8c5d6"))), QIcon::Normal, QIcon::Off);
    result.addPixmap(renderTinted(path, size, QColor(QStringLiteral("#eff7ff"))), QIcon::Selected, QIcon::Off);
    result.addPixmap(renderTinted(path, size, QColor(QStringLiteral("#687584"))), QIcon::Disabled, QIcon::Off);
  }
  return result;
}
