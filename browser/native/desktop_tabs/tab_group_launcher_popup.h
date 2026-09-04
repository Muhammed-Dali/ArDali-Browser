#ifndef ARDALI_DESKTOP_TABS_TAB_GROUP_LAUNCHER_POPUP_H_
#define ARDALI_DESKTOP_TABS_TAB_GROUP_LAUNCHER_POPUP_H_

#include <QWidget>

class QKeyEvent;

namespace ardali::desktop_tabs {

class TabGroupLauncherPopup : public QWidget {
  Q_OBJECT
 public:
  explicit TabGroupLauncherPopup(QWidget *parent = nullptr);
  ~TabGroupLauncherPopup() override = default;

  void showBelow(QWidget *anchorWidget);

 signals:
  void createGroupRequested();

 protected:
  void keyPressEvent(QKeyEvent *event) override;

 private:
  void setupUi();
};

}  // namespace ardali::desktop_tabs

#endif  // ARDALI_DESKTOP_TABS_TAB_GROUP_LAUNCHER_POPUP_H_
