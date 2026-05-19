/* Analyzer Base for ArDali
 * Based on ArDali's AnalyzerBase
 * Original Author: Max Howell <max.howell@methylblue.com> 2003
 */

#ifndef ANALYZERS_ANALYZERBASE_H_
#define ANALYZERS_ANALYZERBASE_H_

#include <QBasicTimer>
#include <QPixmap>
#include <QWidget>
#include <vector>

#include "engine_fwd.h"
#include "enginebase.h"
#include "fht.h"

class QEvent;
class QPaintEvent;
class QResizeEvent;

namespace Analyzer {

typedef std::vector<float> Scope;

class Base : public QWidget {
  Q_OBJECT

 public:
  ~Base() { 
    timer_.stop();  // Stop timer FIRST to prevent callbacks during destruction
    delete fht_; 
  }

  uint timeout() const { return timeout_; }

  void set_engine(EngineBase* engine) { 
    engine_ = engine; 
    // If engine is null, stop the timer to prevent callbacks
    if (!engine_ && timer_.isActive()) {
      timer_.stop();
    }
  }

  void changeTimeout(uint newTimeout) {
    timeout_ = newTimeout;
    if (timer_.isActive()) {
      timer_.stop();
      timer_.start(timeout_, this);
    }
  }

  virtual void framerateChanged() {}
  virtual void psychedelicModeChanged(bool);

 protected:
  explicit Base(QWidget*, uint scopeSize = 7);

  void hideEvent(QHideEvent*);
  void showEvent(QShowEvent*);
  void paintEvent(QPaintEvent*);
  void timerEvent(QTimerEvent*);

  void polishEvent();

  int resizeExponent(int);
  int resizeForBands(int);
  int BandFrequency(int) const;
  void updateBandSize(const int);
  QColor getPsychedelicColor(const Scope&, const int, const int);
  virtual void init() {}
  virtual void transform(Scope&);
  virtual void analyze(QPainter& p, const Scope&, bool new_frame) = 0;
  virtual void demo(QPainter& p);

 protected:
  static const int kSampleRate = 44100;

  QBasicTimer timer_;
  uint timeout_;
  FHT* fht_;
  EngineBase* engine_;
  Scope lastScope_;

  bool new_frame_;
  bool is_playing_;

  QVector<uint> barkband_table_;
  double prev_colors_[10][3];
  int prev_color_index_;
  int bands_;
  bool psychedelic_enabled_;
};

void interpolate(const Scope&, Scope&);
void initSin(Scope&, const uint = 6000);

}  // namespace Analyzer

#endif  // ANALYZERS_ANALYZERBASE_H_
