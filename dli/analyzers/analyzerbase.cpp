/* Analyzer Base for ArDali
 * Based on ArDali's AnalyzerBase
 * Original Author: Max Howell <max.howell@methylblue.com> 2003
 */

#include "analyzerbase.h"

#include <QEvent>
#include <QPaintEvent>
#include <QPainter>
#include <QtDebug>
#include <algorithm>
#include <cmath>
#include <cstdint>

static const int sBarkBands[] = {
    100,  200,  300,  400,  510,  630,  770,  920,  1080, 1270, 1480,  1720,
    2000, 2320, 2700, 3150, 3700, 4400, 5300, 6400, 7700, 9500, 12000, 15500};

static const int sBarkBandCount = sizeof(sBarkBands) / sizeof(sBarkBands[0]);

Analyzer::Base::Base(QWidget* parent, uint scopeSize)
    : QWidget(parent),
      timeout_(40),  // msec
      fht_(new FHT(scopeSize)),
      engine_(nullptr),
      lastScope_(),
      new_frame_(false),
      is_playing_(false),
      barkband_table_(),
      prev_color_index_(0),
      bands_(0),
      psychedelic_enabled_(false) {
  lastScope_.resize(fht_->size());
}

void Analyzer::Base::hideEvent(QHideEvent*) { timer_.stop(); }

void Analyzer::Base::showEvent(QShowEvent*) { timer_.start(timeout(), this); }

void Analyzer::Base::transform(Scope& scope) {
  QVector<float> aux(fht_->size());
  if (aux.size() >= static_cast<int>(scope.size())) {
    std::copy(scope.begin(), scope.end(), aux.begin());
  } else {
    std::copy(scope.begin(), scope.begin() + aux.size(), aux.begin());
  }

  fht_->logSpectrum(scope.data(), aux.data());
  fht_->scale(scope.data(), 1.0 / 20);

  scope.resize(fht_->size() / 2);
}

void Analyzer::Base::paintEvent(QPaintEvent* e) {
  // Wayland safety: skip painting if widget has zero size
  if (width() <= 0 || height() <= 0) {
    return;
  }
  
  QPainter p(this);
  if (!p.isActive()) {
    return;
  }
  
  p.fillRect(e->rect(), palette().color(QPalette::Window));

  if (!engine_) {
    demo(p);
    return;
  }

  switch (engine_->state()) {
    case Engine::Playing: {
      const Engine::Scope& thescope = engine_->scope(timeout_);
      
      // Safety check for scope size
      if (thescope.empty() || fht_->size() <= 0) {
        demo(p);
        return;
      }
      
      int i = 0;

      // convert to mono here - our built in analyzers need mono, but the
      // engines provide interleaved pcm
      for (uint x = 0; static_cast<int>(x) < fht_->size(); ++x) {
        if (i + 1 < static_cast<int>(thescope.size())) {
          lastScope_[x] = static_cast<double>(thescope[i] + thescope[i + 1]) /
                          (2 * (1 << 15));
        } else {
          lastScope_[x] = 0.0;
        }
        i += 2;
      }

      is_playing_ = true;
      transform(lastScope_);
      analyze(p, lastScope_, new_frame_);

      lastScope_.resize(fht_->size());

      break;
    }
    case Engine::Paused:
      is_playing_ = false;
      analyze(p, lastScope_, new_frame_);
      break;

    default:
      is_playing_ = false;
      demo(p);
  }

  new_frame_ = false;
}

int Analyzer::Base::resizeExponent(int exp) {
  if (exp < 3)
    exp = 3;
  else if (exp > 9)
    exp = 9;

  if (exp != fht_->sizeExp()) {
    delete fht_;
    fht_ = new FHT(exp);
  }
  return exp;
}

int Analyzer::Base::resizeForBands(int bands) {
  int exp;
  if (bands <= 8)
    exp = 4;
  else if (bands <= 16)
    exp = 5;
  else if (bands <= 32)
    exp = 6;
  else if (bands <= 64)
    exp = 7;
  else if (bands <= 128)
    exp = 8;
  else
    exp = 9;

  resizeExponent(exp);
  return fht_->size() / 2;
}

void Analyzer::Base::demo(QPainter& p) {
  static int t = 201;

  if (t > 999) t = 1;
  if (t < 201) {
    Scope s(32);

    const double dt = static_cast<double>(t) / 200;
    for (uint i = 0; i < s.size(); ++i)
      s[i] = dt * (sin(M_PI + (i * M_PI) / s.size()) + 1.0);

    analyze(p, s, new_frame_);
  } else {
    analyze(p, Scope(32, 0), new_frame_);
  }
  ++t;
}

void Analyzer::Base::psychedelicModeChanged(bool enabled) {
  psychedelic_enabled_ = enabled;
}

int Analyzer::Base::BandFrequency(int band) const {
  return ((kSampleRate / 2) * band + kSampleRate / 4) / bands_;
}

void Analyzer::Base::updateBandSize(const int scopeSize) {
  if (scopeSize == 0) {
    return;
  }

  bands_ = scopeSize;

  barkband_table_.clear();

  int barkband = 0;
  for (int i = 0; i < bands_; ++i) {
    if (barkband < sBarkBandCount - 1 &&
        BandFrequency(i) >= sBarkBands[barkband]) {
      barkband++;
    }

    barkband_table_.append(barkband);
  }
}

QColor Analyzer::Base::getPsychedelicColor(const Scope& scope,
                                           const int ampFactor,
                                           const int bias) {
  if (static_cast<int>(scope.size()) > barkband_table_.size()) {
    return palette().color(QPalette::Highlight);
  }

  double bands[sBarkBandCount]{};

  for (int i = 0; i < static_cast<int>(scope.size()); ++i) {
    bands[barkband_table_[i]] += scope[i];
  }

  double rgb[3]{};
  for (int i = 0; i < sBarkBandCount - 1; ++i) {
    rgb[(i * 3) / sBarkBandCount] += pow(bands[i], 2);
  }

  for (int i = 0; i < 3; ++i) {
    rgb[i] = qMin(255, (int)((sqrt(rgb[i]) * ampFactor) + bias));
  }

  return QColor::fromRgb(rgb[0], rgb[1], rgb[2]);
}

void Analyzer::Base::polishEvent() {
  init();
}

void Analyzer::interpolate(const Scope& inVec, Scope& outVec) {
  double pos = 0.0;
  const double step = static_cast<double>(inVec.size()) / outVec.size();

  for (uint i = 0; i < outVec.size(); ++i, pos += step) {
    const double error = pos - std::floor(pos);
    const uint64_t offset = static_cast<uint64_t>(pos);

    uint64_t indexLeft = offset + 0;

    if (indexLeft >= inVec.size()) indexLeft = inVec.size() - 1;

    uint64_t indexRight = offset + 1;

    if (indexRight >= inVec.size()) indexRight = inVec.size() - 1;

    outVec[i] = inVec[indexLeft] * (1.0 - error) + inVec[indexRight] * error;
  }
}

void Analyzer::initSin(Scope& v, const uint size) {
  double step = (M_PI * 2) / size;
  double radian = 0;

  for (uint i = 0; i < size; i++) {
    v.push_back(sin(radian));
    radian += step;
  }
}

void Analyzer::Base::timerEvent(QTimerEvent* e) {
  QWidget::timerEvent(e);
  if (e->timerId() != timer_.timerId()) return;

  new_frame_ = true;
  update();
}
