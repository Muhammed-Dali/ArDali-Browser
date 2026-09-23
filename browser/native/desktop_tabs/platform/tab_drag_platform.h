#ifndef DALINIRA_DESKTOP_TABS_PLATFORM_TAB_DRAG_PLATFORM_H_
#define DALINIRA_DESKTOP_TABS_PLATFORM_TAB_DRAG_PLATFORM_H_

#include <QCursor>
#include <QGuiApplication>
#include <QPoint>
#include <Qt>
#include <QWidget>
#include <memory>

namespace dalinira::desktop_tabs {

class TabDragPlatformBackend {
 public:
  virtual ~TabDragPlatformBackend() = default;

  virtual QPoint globalCursorPosition() const;
  virtual void moveWindow(QWidget *window, const QPoint &globalTopLeft);
  virtual void bringToFront(QWidget *window);
  virtual bool beginPointerCapture(QWidget *widget);
  virtual void endPointerCapture(QWidget *widget);
  virtual bool isWayland() const;
  virtual bool isX11() const;

  static std::unique_ptr<TabDragPlatformBackend> create();
};

}  // namespace dalinira::desktop_tabs

#endif  // DALINIRA_DESKTOP_TABS_PLATFORM_TAB_DRAG_PLATFORM_H_
