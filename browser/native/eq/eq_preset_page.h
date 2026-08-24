#pragma once

#include "eq_preset_repository.h"

#include <QWidget>

class QComboBox;
class QLabel;
class QLineEdit;
class QListView;
class QPushButton;
class WebAudioEffectsController;

class EqPresetPage final : public QWidget {
  Q_OBJECT
 public:
  explicit EqPresetPage(WebAudioEffectsController *controller, QWidget *parent = nullptr);
  ~EqPresetPage() override;
  const EqPresetRepository &repositoryForView() const { return repository_; }
  const QVector<int> &visibleForView() const { return visible_; }
  const QString &selectedForView() const { return selectedId_; }
  int graphLayerCountForView() const { return graphLayerCount_; }
  int rowHeightForView() const { return rowHeight_; }

 private:
  void applyFilter();
  void preview(const QModelIndex &index);
  void commit();
  void rollback();
  void updateStatus();
  void setPerformanceMode(int mode);

  WebAudioEffectsController *controller_ = nullptr;
  EqPresetRepository repository_;
  QVector<int> visible_;
  QVector<double> originalBands_;
  QString selectedId_;
  bool committed_ = false;
  int performanceMode_ = 1; // 0 full, 1 balanced, 2 minimum
  int graphLayerCount_ = 3;
  int rowHeight_ = 84;
  QLineEdit *search_ = nullptr;
  QComboBox *group_ = nullptr;
  QListView *list_ = nullptr;
  QLabel *status_ = nullptr;
  QLabel *performanceHint_ = nullptr;
  QPushButton *fullButton_ = nullptr;
  QPushButton *balancedButton_ = nullptr;
  QPushButton *minimumButton_ = nullptr;
};
