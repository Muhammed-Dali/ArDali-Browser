#ifndef ARDALI_DESKTOP_TABS_TAB_WINDOW_REGISTRY_H_
#define ARDALI_DESKTOP_TABS_TAB_WINDOW_REGISTRY_H_

#include <QList>
#include <QObject>
#include <QPoint>
#include <QPointer>
#include <QWidget>

namespace ardali::desktop_tabs {

class TabStripWidget;

struct RegisteredWindow {
  QPointer<QWidget> window;
  QPointer<TabStripWidget> tabStrip;
};

class TabWindowRegistry : public QObject {
  Q_OBJECT
 public:
  static TabWindowRegistry &instance();

  void registerWindow(QWidget *window, TabStripWidget *tabStrip);
  void unregisterWindow(QWidget *window);

  QList<RegisteredWindow> registeredWindows() const;

  // Finds a valid target window and tab strip under the given global screen point,
  // excluding the given window (such as the currently dragged window).
  RegisteredWindow findTargetAt(const QPoint &globalScreenPoint, QWidget *excludeWindow = nullptr) const;

  // Reloads the persisted appearance in every live strip without recreating
  // windows, tab models, or drag sessions.
  void reloadTabAppearances();

  void clear();

 private:
  TabWindowRegistry() = default;
  ~TabWindowRegistry() override = default;

  QList<RegisteredWindow> windows_;
};

}  // namespace ardali::desktop_tabs

#endif  // ARDALI_DESKTOP_TABS_TAB_WINDOW_REGISTRY_H_
