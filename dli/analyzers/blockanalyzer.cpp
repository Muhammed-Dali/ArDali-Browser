/* Block Analyzer for ArDali
 * Based on ArDali's BlockAnalyzer
 * Original Author: Max Howell <max.howell@methylblue.com> 2003-2005
 */

#include "blockanalyzer.h"

#include <QMouseEvent>
#include <QPainter>
#include <QResizeEvent>
#include <cmath>
#include <cstdlib>

const uint BlockAnalyzer::kHeight = 2;
const uint BlockAnalyzer::kWidth = 4;
const uint BlockAnalyzer::kMinRows = 3;
const uint BlockAnalyzer::kMaxRows = 256;
const uint BlockAnalyzer::kMinColumns = 32;
const uint BlockAnalyzer::kMaxColumns = 256;
const uint BlockAnalyzer::kFadeSize = 90;
const uint BlockAnalyzer::kFadeInitial = 32;

const char* BlockAnalyzer::kName =
    QT_TRANSLATE_NOOP("AnalyzerContainer", "Block analyzer");

BlockAnalyzer::BlockAnalyzer(QWidget* parent)
    : Analyzer::Base(parent, 9),
      scope_(kMinColumns),
      columns_(0),
      rows_(0),
      y_(0),
      canvas_(),
      rthresh_(kMaxRows + 1, 0.f),
      bg_grad_(kMaxRows + 1, 0),
      fade_bars_(kFadeSize, 0),
      bandinfo_(kMaxColumns) {
  setMinimumSize(kMinColumns * (kWidth + 1) - 1, kMinRows * (kHeight + 1) - 1);
  setMaximumWidth(kMaxColumns * (kWidth + 1) - 1);

  setAttribute(Qt::WA_OpaquePaintEvent, true);
}

BlockAnalyzer::~BlockAnalyzer() {
  // Canvas is automatically destroyed as member variable
}

void BlockAnalyzer::resizeEvent(QResizeEvent* e) {
  QWidget::resizeEvent(e);

  // Safety: skip if size is invalid
  if (width() <= 0 || height() <= 0) {
    return;
  }

  uint newRows, newCols;

  newCols = 1 + (width() + 1) / (kWidth + 1);
  newRows = 0 + (height() + 1) / (kHeight + 1);
  newCols = qMin(kMaxColumns, qMax(kMinColumns, newCols));
  newRows = qMin(kMaxRows, qMax(kMinRows, newRows));

  if (newCols != columns_) {
    columns_ = newCols;
    scope_.resize(columns_);

    updateBandSize(columns_);
    bandinfo_.fill(FHTBand());
  }

  if (rows_ != newRows) {
    rows_ = newRows;

    y_ = (height() - (rows_ * (kHeight + 1)) + 2) / 2;

    const float PRE = 1.f,
                PRO = 1.f,
        SCL = log10f(PRE + PRO + (1.f * rows_));

    for (uint z = 0; z < rows_; ++z)
      rthresh_[z] = 1.f - log10f(PRE + (1.f * z)) / SCL;

    rthresh_[rows_] = 0.f;

    determineStep();
    paletteChange(palette());
  }

  // Safety: ensure valid dimensions before creating QImage
  int canvasWidth = columns_ * (kWidth + 1);
  int canvasHeight = rows_ * (kHeight + 1);
  if (canvasWidth > 0 && canvasHeight > 0) {
    canvas_ = QImage(canvasWidth, canvasHeight,
                     QImage::Format_ARGB32_Premultiplied);
    canvas_.fill(pad_color_);
  }
}

void BlockAnalyzer::determineStep() {
  const float rFallTime = 1.f / (timeout() < 20 ? 20.f : 30.f);
  step_ = timeout() * rFallTime;
}

void BlockAnalyzer::framerateChanged() {
  determineStep();
}

void BlockAnalyzer::transform(Analyzer::Scope& s) {
  for (uint x = 0; x < s.size(); ++x) s[x] *= 2.f;

  fht_->spectrum(s.data());
  fht_->scale(s.data(), 1.f / 20.f);

  s.resize(scope_.size() <= kMaxColumns / 2 ? kMaxColumns / 2 : scope_.size());
}

void BlockAnalyzer::analyze(QPainter& p, const Analyzer::Scope& s,
                            bool new_frame) {
  float yf;
  uint x, y;

  if (p.paintEngine() == nullptr) return;
  if (canvas_.isNull()) return;
  if (rows_ == 0 || columns_ == 0) return;
  if (width() <= 0 || height() <= 0) return;

  p.setCompositionMode(QPainter::CompositionMode_Source);

  if (!new_frame) {
    p.drawImage(0, 0, canvas_, 0, 0, width(), height(), Qt::NoFormatConversion);
    return;
  }

  Analyzer::interpolate(s, scope_);

  if (psychedelic_enabled_) paletteChange(QPalette());

  for (x = 0; x < scope_.size(); ++x) {
    const float& bandthr = scope_[x];
    FHTBand& band = bandinfo_[x];

    for (y = 0; y < rows_; ++y) {
      if (bandthr >= rthresh_[y]) break;
    }

    if ((yf = 1.f * y) <= band.height) {
      band.height = yf;
      band.row = y;
    } else {
      band.height += step_;
      band.row = y = static_cast<uint>(band.height);
    }

    if (y <= band.fade_row) {
      band.fade_row = y;
      band.fade_intensity = kFadeSize;
    }

    if (band.fade_intensity <= 0) {
      band.fade_row = rows_;
      band.fade_coloridx = 0;
    } else {
      band.fade_coloridx = --band.fade_intensity;
    }
  }

  QRgb* line;
  uint px_w, px_h;
  uint to_x;
  uint to_y;
  uint blk_r;
  uint blk_c;

  quint32 padcolor = pad_color_.rgba();
  quint32 blkcolor;

  // IMPORTANT: Use canvas_ dimensions, not widget dimensions to prevent buffer overflow
  px_w = static_cast<uint>(canvas_.width());
  px_h = static_cast<uint>(canvas_.height());
  
  // Safety check
  if (px_w == 0 || px_h == 0) return;

  for (y = 0; y < y_; ++y) {
    line = reinterpret_cast<QRgb*>(canvas_.scanLine(y));
    for (x = 0; x < px_w; line[x++] = padcolor)
      ;
  }

  for (blk_r = 0; blk_r < rows_; ++blk_r) {
    to_y = qMin(y + kHeight, px_h);

    for (; y < to_y; ++y) {
      line = reinterpret_cast<QRgb*>(canvas_.scanLine(y));

      for (x = 0, blk_c = 0; blk_c < columns_; ++blk_c) {
        to_x = qMin(x + kWidth, px_w);

        blkcolor = colorFromRowAndBand(blk_r, bandinfo_[blk_c]);

        for (; x < to_x; line[x++] = blkcolor)
          ;
        if (x < px_w) line[x++] = padcolor;
      }

      for (; x < px_w; line[x++] = padcolor)
        ;
    }

    if (y < px_h) {
      line = reinterpret_cast<QRgb*>(canvas_.scanLine(y++));
      for (x = 0; x < px_w; line[x++] = padcolor)
        ;
    }
  }

  while (y < px_h) {
    line = reinterpret_cast<QRgb*>(canvas_.scanLine(y++));
    for (x = 0; x < px_w; line[x++] = padcolor)
      ;
  }

  p.drawImage(0, 0, canvas_, 0, 0, width(), height(), Qt::NoFormatConversion);
}

static inline void adjustToLimits(int& b, int& f, uint& amount) {
  if (b < f) {
    if (b > 255 - f) {
      amount -= f;
      f = 0;
    } else {
      amount -= (255 - f);
      f = 255;
    }
  } else {
    if (f > 255 - b) {
      amount -= f;
      f = 0;
    } else {
      amount -= (255 - f);
      f = 255;
    }
  }
}

void BlockAnalyzer::psychedelicModeChanged(bool enabled) {
  psychedelic_enabled_ = enabled;
  paletteChange(QPalette());
}

static QColor ensureContrast(const QColor& bg, const QColor& fg,
                             uint _amount = 150) {
  int bh, bs, bv;
  int fh, fs, fv;

  bg.getHsv(&bh, &bs, &bv);
  fg.getHsv(&fh, &fs, &fv);

  int dv = abs(bv - fv);

  if (dv > static_cast<int>(_amount)) return fg;

  int ds = abs(bs - fs);

  if (ds > static_cast<int>(_amount)) return fg;

  int dh = abs(bh - fh);

  if (dh > 120) {
    if (ds > static_cast<int>(_amount) / 2 && (bs > 125 && fs > 125))
      return fg;
    else if (dv > static_cast<int>(_amount) / 2 && (bv > 125 && fv > 125))
      return fg;
  }

  if (fs < 50 && ds < 40) {
    const int tmp = 50 - fs;
    fs = 50;
    if (static_cast<int>(_amount) > tmp)
      _amount -= tmp;
    else
      _amount = 0;
  }

  if (255 - dv < static_cast<int>(_amount)) {
    if (static_cast<int>(_amount) > 0) adjustToLimits(bs, fs, _amount);

    if (static_cast<int>(_amount) > 0)
      fh += static_cast<int>(_amount);

    return QColor::fromHsv(fh, fs, fv);
  }

  if (fv > bv && bv > static_cast<int>(_amount))
    return QColor::fromHsv(fh, fs, bv - static_cast<int>(_amount));

  if (fv < bv && fv > static_cast<int>(_amount))
    return QColor::fromHsv(fh, fs, fv - static_cast<int>(_amount));

  if (fv > bv && (255 - fv > static_cast<int>(_amount)))
    return QColor::fromHsv(fh, fs, fv + static_cast<int>(_amount));

  if (fv < bv && (255 - bv > static_cast<int>(_amount)))
    return QColor::fromHsv(fh, fs, bv + static_cast<int>(_amount));

  return Qt::blue;
}

void BlockAnalyzer::paletteChange(const QPalette&) {
  QColor bg, bgdark, fg;

  bg = palette().color(QPalette::Window);
  bgdark = bg.darker(112);

  if (psychedelic_enabled_)
    fg = getPsychedelicColor(scope_, 10, 75);
  else
    fg = ensureContrast(bg, palette().color(QPalette::Highlight));

  fg_color_ = fg;
  bg_color_ = bgdark;
  pad_color_ = bg;

  {
    const float dr = 15.f * (bg.red() - fg.red()) / (16.f * rows_);
    const float dg = 15.f * (bg.green() - fg.green()) / (16.f * rows_);
    const float db = 15.f * (bg.blue() - fg.blue()) / (16.f * rows_);

    for (uint y = 0; y < rows_; ++y) {
      bg_grad_[y] = qRgba(fg.red() + static_cast<int>(dr * y),
                          fg.green() + static_cast<int>(dg * y),
                          fg.blue() + static_cast<int>(db * y), 255);
    }

    bg_grad_[rows_] = bg.rgba();
  }

  {
    int h, s, v;

    bg.darker(150).getHsv(&h, &s, &v);
    fg = QColor::fromHsv(h + 120, s, v);

    const float r = 1.f * bgdark.red();
    const float g = 1.f * bgdark.green();
    const float b = 1.f * bgdark.blue();
    const float dr = 1.f * fg.red() - r;
    const float dg = 1.f * fg.green() - g;
    const float db = 1.f * fg.blue() - b;

    const float fFscl = 1. * kFadeSize;
    const float frlogFscl = 1.f / log10f(fFscl);

    for (uint y = 0; y < kFadeSize; ++y) {
      const float lrY = 1.f - (frlogFscl * log10f(fFscl - y));
      fade_bars_[y] =
          qRgba(static_cast<int>(r + lrY * dr), static_cast<int>(g + lrY * dg),
                static_cast<int>(b + lrY * db), 255);
    }
  }
}
