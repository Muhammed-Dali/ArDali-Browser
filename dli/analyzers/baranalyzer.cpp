/* Bar Analyzer for ArDali
 * Based on ArDali's BarAnalyzer
 * Original Author: Mark Kretschmann <markey@web.de> 2003
 */

#include "baranalyzer.h"

#include <QPainter>
#include <QtDebug>
#include <cmath>

using Analyzer::Scope;

const char* BarAnalyzer::kName =
    QT_TRANSLATE_NOOP("AnalyzerContainer", "Bar analyzer");

BarAnalyzer::BarAnalyzer(QWidget* parent) : Analyzer::Base(parent, 8) {
  bg_ = parent->palette().color(QPalette::Window);

  QColor fg(parent->palette().color(QPalette::Highlight).lighter(150));

  double dr = static_cast<double>(bg_.red() - fg.red()) / (kNumRoofs - 1);
  double dg = static_cast<double>(bg_.green() - fg.green()) / (kNumRoofs - 1);
  double db = static_cast<double>(bg_.blue() - fg.blue()) / (kNumRoofs - 1);

  for (uint i = 0; i < kNumRoofs; ++i) {
    pixRoof_[i] = QPixmap(kColumnWidth, 1);
    pixRoof_[i].fill(QColor(fg.red() + static_cast<int>(dr * i),
                            fg.green() + static_cast<int>(dg * i),
                            fg.blue() + static_cast<int>(db * i)));
  }
}

void BarAnalyzer::resizeEvent(QResizeEvent* e) { 
  // Wayland safety: skip if size is invalid
  if (width() <= 0 || height() <= 0) {
    return;
  }
  init(); 
}

void BarAnalyzer::init() {
  // Safety: skip if size is invalid
  if (width() <= 0 || height() <= 0) {
    return;
  }
  
  const double MAX_AMPLITUDE = 1.0;
  const double F =
      static_cast<double>(height() - 2) / (log10(255) * MAX_AMPLITUDE);

  band_count_ = width() / 5;
  if (band_count_ == 0) band_count_ = 1;
  
  max_down_ = static_cast<int>(0 - (qMax(1, height() / 50)));
  max_up_ = static_cast<int>(qMax(1, height() / 25));

  barVector_.resize(band_count_, 0);
  roofVector_.resize(band_count_, height() - 5);
  roofVelocityVector_.resize(band_count_, kRoofVelocityReductionFactor);
  roofMem_.resize(band_count_);
  scope_.resize(band_count_);

  for (uint x = 0; x < 256; ++x) {
    lvlMapper_[x] = static_cast<uint>(F * log10(x + 1));
  }

  // Safety: ensure valid dimensions before creating QPixmap
  int gradientWidth = height() * kColumnWidth;
  if (gradientWidth > 0 && height() > 0) {
    pixBarGradient_ = QPixmap(gradientWidth, height());
  }
  if (width() > 0 && height() > 0) {
    pixCompose_ = QPixmap(size());
    canvas_ = QPixmap(size());
    canvas_.fill(palette().color(QPalette::Window));
  }

  updateBandSize(band_count_);
  colorChanged();
  setMinimumSize(QSize(band_count_ * kColumnWidth, 10));
}

void BarAnalyzer::colorChanged() {
  if (pixBarGradient_.isNull()) {
    return;
  }

  QPainter p(&pixBarGradient_);
  QColor rgb;
  if (psychedelic_enabled_) {
    rgb = getPsychedelicColor(scope_, 50, 100);
  } else {
    rgb = palette().color(QPalette::Highlight);
  }

  for (int x = 0; x < height(); ++x) {
    int r = rgb.red();
    int g = rgb.green();
    int b = rgb.blue();
    int r2 = 255 - r;
    for (int y = x; y > 0; --y) {
      const double fraction = static_cast<double>(y) / height();

      p.setPen(QColor(r + static_cast<int>(r2 * fraction), g, b));
      p.drawLine(x * kColumnWidth, height() - y, (x + 1) * kColumnWidth,
                 height() - y);
    }
  }
}

void BarAnalyzer::psychedelicModeChanged(bool enabled) {
  psychedelic_enabled_ = enabled;
  colorChanged();
}

void BarAnalyzer::analyze(QPainter& p, const Scope& s, bool new_frame) {
  // Wayland safety
  if (width() <= 0 || height() <= 0) return;
  if (canvas_.isNull()) return;
  if (band_count_ == 0) return;
  
  if (!new_frame || (engine_ && engine_->state() == Engine::Paused)) {
    p.drawPixmap(0, 0, canvas_);
    return;
  }

  Analyzer::interpolate(s, scope_);
  QPainter canvas_painter(&canvas_);

  if (psychedelic_enabled_) {
    colorChanged();
  }

  canvas_.fill(palette().color(QPalette::Window));

  for (uint i = 0, x = 0, y2; i < scope_.size(); ++i, x += kColumnWidth + 1) {
    y2 = static_cast<uint>(scope_[i] * 256);
    y2 = lvlMapper_[(y2 > 255) ? 255 : y2];

    int change = y2 - barVector_[i];

    if (change < max_down_) y2 = barVector_[i] + max_down_;

    if (static_cast<int>(y2) > roofVector_[i]) {
      roofVector_[i] = static_cast<int>(y2);
      roofVelocityVector_[i] = 1;
    }

    barVector_[i] = y2;

    if (roofMem_[i].size() > kNumRoofs) roofMem_[i].erase(roofMem_[i].begin());

    for (uint c = 0; c < roofMem_[i].size(); ++c)
      canvas_painter.drawPixmap(x, roofMem_[i][c], pixRoof_[kNumRoofs - 1 - c]);

    canvas_painter.drawPixmap(x, height() - y2, *gradient(), y2 * kColumnWidth,
                              height() - y2, kColumnWidth, y2);

    roofMem_[i].emplace_back(height() - roofVector_[i] - 2);

    if (roofVelocityVector_[i] != 0) {
      if (roofVelocityVector_[i] > 32)
        roofVector_[i] -= (roofVelocityVector_[i] - 32) / 20;

      if (roofVector_[i] < 0) {
        roofVector_[i] = 0;
        roofVelocityVector_[i] = 0;
      } else {
        ++roofVelocityVector_[i];
      }
    }
  }

  p.drawPixmap(0, 0, canvas_);
}
