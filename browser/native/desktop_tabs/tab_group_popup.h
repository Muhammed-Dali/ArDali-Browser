#ifndef ARDALI_DESKTOP_TABS_TAB_GROUP_POPUP_H_
#define ARDALI_DESKTOP_TABS_TAB_GROUP_POPUP_H_

#include <QLineEdit>
#include <QPushButton>
#include <QUuid>
#include <QWidget>
#include <QVector>

#include "tab_group_model.h"

namespace ardali::desktop_tabs {

class TabGroupPopup : public QWidget {
  Q_OBJECT
 public:
  explicit TabGroupPopup(TabGroupModel *model, QWidget *parent = nullptr);
  ~TabGroupPopup() override = default;

  void showForGroup(const QUuid &groupId, const QPoint &globalPosBelowChip);

 signals:
  void newTabInGroupRequested(const QUuid &groupId);
  void moveGroupToNewWindowRequested(const QUuid &groupId);
  void closeGroupRequested(const QUuid &groupId);
  void ungroupRequested(const QUuid &groupId);
  void deleteGroupRequested(const QUuid &groupId);

 protected:
  void keyPressEvent(QKeyEvent *event) override;

 private:
  void setupUi();
  void updateColorSelection(const QColor &color);
  void showDeleteConfirmation();

  TabGroupModel *model_ = nullptr;
  QUuid currentGroupId_;

  QLineEdit *nameEdit_ = nullptr;
  QWidget *colorPaletteRow_ = nullptr;
  QVector<QPushButton *> colorButtons_;
};

}  // namespace ardali::desktop_tabs

#endif  // ARDALI_DESKTOP_TABS_TAB_GROUP_POPUP_H_
