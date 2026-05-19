/* Turbine Analyzer for ArDali
 * Based on ArDali's TurbineAnalyzer
 * Original Author: Stanislav Karchebny <berkus@users.sf.net> 2003
 */

#include "turbine.h"

#include <QPainter>
#include <cmath>

using Analyzer::Scope;

const char* TurbineAnalyzer::kName =
    QT_TRANSLATE_NOOP("AnalyzerContainer", "Turbine");

void TurbineAnalyzer::analyze(QPainter& p, const Scope& scope, bool new_frame) {
  // Wayland safety
  if (width() <= 0 || height() <= 0) return;
  if (canvas_.isNull()) return;
  if (bands_ == 0) return;

  if (!new_frame || (engine_ && engine_->state() == Engine::Paused)) {
    p.drawPixmap(0, 0, canvas_);
    return;
  }

  const uint hd2 = height() / 2;
  if (hd2 == 0) return;
  const uint kMaxHeight = hd2 - 1;

  QPainter canvas_painter(&canvas_);
  canvas_.fill(palette().color(QPalette::Window));

  Analyzer::interpolate(scope, scope_);

  if (psychedelic_enabled_) {
    paletteChange(QPalette());
  }

  for (uint i = 0, x = 0, y; i < bands_; ++i, x += kColumnWidth + 1) {
    float h = std::min(log10(scope_[i] * 256.0) * F_ * 0.5, kMaxHeight * 1.0);

    if (h > bar_height_[i]) {
      bar_height_[i] = h;
      if (h > peak_height_[i]) {
        peak_height_[i] = h;
        peak_speed_[i] = 0.01;
      } else {
        goto peak_handling;
      }
    } else {
      if (bar_height_[i] > 0.0) {
        bar_height_[i] -= K_barHeight_;
        if (bar_height_[i] < 0.0) bar_height_[i] = 0.0;
      }

    peak_handling:
      if (peak_height_[i] > 0.0) {
        peak_height_[i] -= peak_speed_[i];
        peak_speed_[i] *= F_peakSpeed_;
        peak_height_[i] =
            std::max(0.0f, std::max(bar_height_[i], peak_height_[i]));
      }
    }

    y = hd2 - static_cast<uint>(bar_height_[i]);
    canvas_painter.drawPixmap(x + 1, y, barPixmap_, 0, y, -1, -1);
    canvas_painter.drawPixmap(x + 1, hd2, barPixmap_, 0,
                              static_cast<int>(bar_height_[i]), -1, -1);

    canvas_painter.setPen(fg_);
    if (bar_height_[i] > 0)
      canvas_painter.drawRect(x, y, kColumnWidth - 1,
                              static_cast<int>(bar_height_[i]) * 2 - 1);

    const uint x2 = x + kColumnWidth - 1;
    canvas_painter.setPen(palette().color(QPalette::Midlight));
    y = hd2 - uint(peak_height_[i]);
    canvas_painter.drawLine(x, y, x2, y);
    y = hd2 + uint(peak_height_[i]);
    canvas_painter.drawLine(x, y, x2, y);
  }

  p.drawPixmap(0, 0, canvas_);
}
