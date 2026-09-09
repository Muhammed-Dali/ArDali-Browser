#pragma once

#include <QIcon>

enum class BrowserIcon {
  Startup,
  Appearance,
  Performance,
  Content,
  Privacy,
  Search,
  Password,
  Bookmark,
  Download,
  Language,
  Translate,
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
  Video,
  Music,
  Play,
  Clipboard,
  More,
  Minimize,
  Maximize,
  Restore,
  Close,
  Audio,
  Memory,
  Location,
  Camera,
  Microphone,
  Notification,
  Cookie,
  Javascript,
  Image,
  Popup,
  ChevronRight,
  ChevronDown,
  Fonts,
  Mouse,
  Pdf,
  LocationSlash,
  CameraSlash,
  MicrophoneSlash,
  NotificationSlash,
  ArrowLeft,
  JavascriptSlash,
  ImageSlash,
  PopupSlash,
  ProtectedContent,
  InsecureContent,
  SiteData,
  JsOptimize,
  Fullscreen,
  Tune
};

namespace BrowserIcons {
QIcon icon(BrowserIcon id);
QIcon appIcon();
QIcon youtubeIcon();
QIcon youtubeMusicIcon();
QIcon searchEngineIcon(const QString &engineName);
QIcon combinedMediaCaptureIcon();
QString resourcePath(BrowserIcon id);
}  // namespace BrowserIcons
