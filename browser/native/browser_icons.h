#pragma once

#include <QIcon>

enum class BrowserIcon {
  Startup,
  Appearance,
  Content,
  Privacy,
  Search,
  Password,
  Bookmark,
  Download,
  Language,
  Accessibility,
  Settings,
  Reset,
  Info,
  NewTab,
  Window,
  Incognito,
  History,
  Zoom,
  Print,
  Save,
  Tools,
  Help,
  Exit,
  Folder,
  Trash,
  Grid,
  Clock,
  Cards,
  Minimize,
  Maximize,
  Restore,
  Close
};

namespace BrowserIcons {
QIcon icon(BrowserIcon id);
QString resourcePath(BrowserIcon id);
}  // namespace BrowserIcons
