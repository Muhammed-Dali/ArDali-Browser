/* Boom Analyzer for ArDali
 * Based on ArDali's BoomAnalyzer
 * Original Author: Max Howell <max.howell@methylblue.com> 2004
 */

#ifndef ANALYZERS_BOOMANALYZER_H_
#define ANALYZERS_BOOMANALYZER_H_

#include "analyzerbase.h"

class BoomAnalyzer : public Analyzer::Base {
  Q_OBJECT

 public:
  Q_INVOKABLE BoomAnalyzer(QWidget*);

  static const char* kName;

  virtual void transform(Analyzer::Scope& s);
  virtual void analyze(QPainter& p, const Analyzer::Scope&, bool new_frame);
  virtual void psychedelicModeChanged(bool);

 public slots:
  void changeK_barHeight(int);
  void changeF_peakSpeed(int);

 protected:
  void resizeEvent(QResizeEvent* e);
  void paletteChange(const QPalette&);

  static const uint kColumnWidth;
  static const uint kMaxBandCount;
  static const uint kMinBandCount;

  uint bands_;
  Analyzer::Scope scope_;
  QColor fg_;

  double K_barHeight_, F_peakSpeed_, F_;

  std::vector<float> bar_height_;
  std::vector<float> peak_height_;
  std::vector<float> peak_speed_;

  QPixmap barPixmap_;
  QPixmap canvas_;
};

#endif  // ANALYZERS_BOOMANALYZER_H_
