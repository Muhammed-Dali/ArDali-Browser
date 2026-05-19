/* Analyzer Container for ArDali
 * Based on ArDali's AnalyzerContainer
 * Provides a container widget with right-click menu for selecting analyzers
 */

#ifndef ANALYZERS_ANALYZERCONTAINER_H_
#define ANALYZERS_ANALYZERCONTAINER_H_

#include <QMenu>
#include <QWidget>
#include <QActionGroup>

#include "analyzerbase.h"
#include "enginebase.h"

class AnalyzerContainer : public QWidget {
  Q_OBJECT

 public:
  explicit AnalyzerContainer(QWidget* parent);
  void SetEngine(EngineBase* engine);

  static const char* kSettingsGroup;
  static const char* kSettingsFramerate;

 signals:
  void WheelEvent(int delta);

 protected:
  void mouseReleaseEvent(QMouseEvent*);
  void wheelEvent(QWheelEvent* e);

 private slots:
  void ChangeAnalyzer(int id);
  void ChangeFramerate(int new_framerate);
  void DisableAnalyzer();
  void TogglePsychedelicColors();

 private:
  static const int kLowFramerate;
  static const int kMediumFramerate;
  static const int kHighFramerate;
  static const int kSuperHighFramerate;

  void Load();
  void Save();
  void SaveFramerate(int framerate);
  void SavePsychedelic();
  template <typename T>
  void AddAnalyzerType();
  void AddFramerate(const QString& name, int framerate);

 private:
  int current_framerate_;
  QMenu* context_menu_;
  QMenu* context_menu_framerate_;
  QActionGroup* group_;
  QActionGroup* group_framerate_;

  QList<const QMetaObject*> analyzer_types_;
  QList<int> framerate_list_;
  QList<QAction*> actions_;
  QAction* disable_action_;
  QAction* psychedelic_enable_;

  bool psychedelic_colors_on_;

  Analyzer::Base* current_analyzer_;
  EngineBase* engine_;
};

template <typename T>
void AnalyzerContainer::AddAnalyzerType() {
  int id = analyzer_types_.count();
  analyzer_types_ << &T::staticMetaObject;
  QAction* action = context_menu_->addAction(tr(T::kName));
  group_->addAction(action);
  action->setCheckable(true);
  actions_ << action;
  connect(action, &QAction::triggered, [this, id]() { ChangeAnalyzer(id); });
}

#endif  // ANALYZERS_ANALYZERCONTAINER_H_
