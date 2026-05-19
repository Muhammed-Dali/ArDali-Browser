/* Block Analyzer for ArDali
 * Based on ArDali's BlockAnalyzer
 * Original Author: Max Howell <max.howell@methylblue.com> 2003-2005
 */

#ifndef ANALYZERS_BLOCKANALYZER_H_
#define ANALYZERS_BLOCKANALYZER_H_

#include <qcolor.h>
#include "analyzerbase.h"

class QResizeEvent;
class QMouseEvent;
class QPalette;

class BlockAnalyzer : public Analyzer::Base {
  Q_OBJECT

 public:
  Q_INVOKABLE BlockAnalyzer(QWidget*);
  ~BlockAnalyzer();

  static const uint kHeight;
  static const uint kWidth;
  static const uint kMinRows;
  static const uint kMaxRows;
  static const uint kMinColumns;
  static const uint kMaxColumns;
  static const uint kFadeSize;
  static const uint kFadeInitial;

  static const char* kName;

 protected:
  virtual void transform(Analyzer::Scope&);
  virtual void analyze(QPainter& p, const Analyzer::Scope&, bool new_frame);
  virtual void resizeEvent(QResizeEvent*);
  virtual void paletteChange(const QPalette&);
  virtual void framerateChanged();
  virtual void psychedelicModeChanged(bool);

  void determineStep();

 private:
  struct FHTBand {
    FHTBand()
        : height(0.f),
          row(0),
          fade_row(0),
          fade_coloridx(kMaxRows),
          fade_intensity(kFadeInitial) {}

    float height;
    uint row;
    uint fade_row;
    uint fade_coloridx;
    int fade_intensity;
  };

  inline quint32 colorFromRowAndBand(uint cur_r, const FHTBand& band);

  Analyzer::Scope scope_;

  uint columns_;
  uint rows_;
  uint y_;
  float step_;

  QColor fg_color_;
  QColor bg_color_;
  QColor pad_color_;
  QImage canvas_;

  QVector<float> rthresh_;
  QVector<quint32> bg_grad_;
  QVector<quint32> fade_bars_;
  QVector<FHTBand> bandinfo_;
};

inline quint32 BlockAnalyzer::colorFromRowAndBand(uint r, const FHTBand& band) {
  if (r == band.row)
    return fg_color_.rgba();
  else if (r > band.row)
    return bg_grad_[r];
  else if ((band.fade_intensity > 0) && (r >= band.fade_row))
    return fade_bars_[band.fade_coloridx];
  else
    return bg_color_.rgba();
}

#endif  // ANALYZERS_BLOCKANALYZER_H_
