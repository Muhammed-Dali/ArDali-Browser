/* Bar Analyzer for ArDali
 * Based on ArDali's BarAnalyzer
 * Original Author: Max Howell <max.howell@methylblue.com> 2003-2005
 */

#ifndef ANALYZERS_BARANALYZER_H_
#define ANALYZERS_BARANALYZER_H_

#include "analyzerbase.h"

typedef std::vector<uint> aroofMemVec;

class BarAnalyzer : public Analyzer::Base {
  Q_OBJECT

 public:
  Q_INVOKABLE BarAnalyzer(QWidget*);

  void init();
  virtual void analyze(QPainter& p, const Analyzer::Scope&, bool new_frame);
  virtual void psychedelicModeChanged(bool);

  void resizeEvent(QResizeEvent* e);
  void colorChanged();

  uint band_count_;
  int max_down_;
  int max_up_;
  static const uint kRoofHoldTime = 48;
  static const int kRoofVelocityReductionFactor = 32;
  static const uint kNumRoofs = 16;
  static const uint kColumnWidth = 4;

  static const char* kName;

 protected:
  QPixmap pixRoof_[kNumRoofs];

  uint lvlMapper_[256];
  std::vector<aroofMemVec> roofMem_;
  std::vector<uint> barVector_;
  std::vector<int> roofVector_;
  std::vector<uint> roofVelocityVector_;

  const QPixmap* gradient() const { return &pixBarGradient_; }

 private:
  QPixmap pixBarGradient_;
  QPixmap pixCompose_;
  QPixmap canvas_;
  Analyzer::Scope scope_;
  QColor bg_;
};

#endif  // ANALYZERS_BARANALYZER_H_
