#ifndef ARDALI_DESKTOP_TABS_FIND_BAR_WIDGET_H_
#define ARDALI_DESKTOP_TABS_FIND_BAR_WIDGET_H_

#include <QWidget>
#include <QLineEdit>
#include <QLabel>
#include <QToolButton>
#include <QHBoxLayout>
#include <QKeyEvent>

namespace ardali::desktop_tabs {

class FindBarWidget : public QWidget {
  Q_OBJECT

 public:
  explicit FindBarWidget(QWidget *parent = nullptr);
  ~FindBarWidget() override = default;

  void setFindText(const QString &text);
  QString findText() const;
  bool isCaseSensitive() const;
  void setMatchCount(int current, int total);
  void clearMatchCount();
  void focusAndSelectAll();

 signals:
  void findRequested(const QString &text, bool forward, bool caseSensitive);
  void clearFindRequested();
  void closeRequested();

 protected:
  bool eventFilter(QObject *watched, QEvent *event) override;
  void keyPressEvent(QKeyEvent *event) override;

 private slots:
  void onTextChanged(const QString &text);
  void onNextClicked();
  void onPrevClicked();
  void onCaseToggled();

 private:
  void setupUi();
  void applyStyle();

  QLineEdit *searchEdit_ = nullptr;
  QLabel *matchCountLabel_ = nullptr;
  QToolButton *prevBtn_ = nullptr;
  QToolButton *nextBtn_ = nullptr;
  QToolButton *caseBtn_ = nullptr;
  QToolButton *closeBtn_ = nullptr;
};

}  // namespace ardali::desktop_tabs

#endif  // ARDALI_DESKTOP_TABS_FIND_BAR_WIDGET_H_
