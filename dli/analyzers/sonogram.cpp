/* Sonogram for ArDali
 * Based on ArDali's Sonogram
 * Original Author: Melchior FRANZ <mfranz@kde.org> 2004
 */

#include "sonogram.h"

#include <QPainter>

using Analyzer::Scope;

const char* Sonogram::kName =
    QT_TRANSLATE_NOOP("AnalyzerContainer", "Sonogram");

Sonogram::Sonogram(QWidget* parent)
    : Analyzer::Base(parent, 9), scope_size_(128) {}

Sonogram::~Sonogram() {}

void Sonogram::resizeEvent(QResizeEvent* e) {
  QWidget::resizeEvent(e);

  // Safety: skip if size is invalid
  if (width() <= 0 || height() <= 0) {
    return;
  }

  // Safety: ensure valid dimensions before creating QPixmap
  if (width() > 0 && height() > 0) {
    canvas_ = QPixmap(size());
    canvas_.fill(palette().color(QPalette::Window));
  }
  updateBandSize(scope_size_);
}

void Sonogram::psychedelicModeChanged(bool enabled) {
  psychedelic_enabled_ = enabled;
  updateBandSize(scope_size_);
}

void Sonogram::analyze(QPainter& p, const Scope& s, bool new_frame) {
  // Wayland safety
  if (width() <= 0 || height() <= 0) return;
  if (canvas_.isNull()) return;

  if (!new_frame || (engine_ && engine_->state() == Engine::Paused)) {
    p.drawPixmap(0, 0, canvas_);
    return;
  }

  int x = width() - 1;
  QColor c;

  QPainter canvas_painter(&canvas_);
  canvas_painter.drawPixmap(0, 0, canvas_, 1, 0, x, -1);

  Scope::const_iterator it = s.begin(), end = s.end();
  if (scope_size_ != static_cast<int>(s.size())) {
    scope_size_ = s.size();
    updateBandSize(scope_size_);
  }

  if (psychedelic_enabled_) {
    c = getPsychedelicColor(s, 20, 100);
    for (int y = height() - 1; y;) {
      if (it >= end || *it < .005) {
        c = palette().color(QPalette::Window);
      } else if (*it < .05) {
        c.setHsv(c.hue(), c.saturation(), 255 - static_cast<int>(*it * 4000.0));
      } else if (*it < 1.0) {
        c.setHsv((c.hue() + static_cast<int>(*it * 90.0)) % 255, 255, 255);
      } else {
        c = getPsychedelicColor(s, 10, 50);
      }

      canvas_painter.setPen(c);
      canvas_painter.drawPoint(x, y--);

      if (it < end) ++it;
    }
  } else {
    for (int y = height() - 1; y;) {
      if (it >= end || *it < .005)
        c = palette().color(QPalette::Window);
      else if (*it < .05)
        c.setHsv(95, 255, 255 - static_cast<int>(*it * 4000.0));
      else if (*it < 1.0)
        c.setHsv(95 - static_cast<int>(*it * 90.0), 255, 255);
      else
        c = Qt::red;

      canvas_painter.setPen(c);
      canvas_painter.drawPoint(x, y--);

      if (it < end) ++it;
    }
  }

  canvas_painter.end();

  p.drawPixmap(0, 0, canvas_);
}

void Sonogram::transform(Scope& scope) {
  fht_->power2(scope.data());
  fht_->scale(scope.data(), 1.0 / 256);
  scope.resize(fht_->size() / 2);
}

void Sonogram::demo(QPainter& p) {
  analyze(p, Scope(fht_->size(), 0), new_frame_);
}
