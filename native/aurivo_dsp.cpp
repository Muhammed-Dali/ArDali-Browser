#include <algorithm>
#include <array>
#include <cmath>
#include <vector>
#include <cstdio>
#include <cstdint>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

// Aurivo Safe EQ Engine (32-band only)
namespace AurivoDSP {

static const int NUM_BANDS = 32;
static float gSampleRate = 48000.0f;
static const float MIN_EQ_FREQ = 20.0f;
static const float MAX_EQ_FREQ = 20000.0f;
static const float NOISE_GATE_DB = -60.0f;
static const float NOISE_GATE_RMS = std::pow(10.0f, NOISE_GATE_DB / 20.0f);

static inline float clampf(float value, float min_value, float max_value) {
  return std::max(min_value, std::min(value, max_value));
}

// Windowed Sinc Resampler (Fixed 44.1k -> 48k for Monitor)
struct Resampler {
  float bufferL[256], bufferR[256];
  int writePos;
  double phase;
  double ratio;

  Resampler() : writePos(0), phase(0.0), ratio(48000.0 / 44100.0) {
    std::fill(bufferL, bufferL + 256, 0.0f);
    std::fill(bufferR, bufferR + 256, 0.0f);
  }

  void push(float L, float R) {
    bufferL[writePos] = L;
    bufferR[writePos] = R;
    writePos = (writePos + 1) % 256;
  }

  void process(float *inL, float *inR, int inFrames, float *out,
               int &outFrames) {
    double step = 1.0 / ratio;
    int outIdx = 0;
    while (phase < inFrames) {
      int i = (int)phase;
      double f = phase - i;

      float L, R;
      if (i + 1 < inFrames) {
        L = inL[i] * (1.0f - (float)f) + inL[i + 1] * (float)f;
        R = inR[i] * (1.0f - (float)f) + inR[i + 1] * (float)f;
      } else {
        L = inL[i];
        R = inR[i];
      }

      out[outIdx * 2] = L;
      out[outIdx * 2 + 1] = R;
      outIdx++;
      phase += step;
    }
    phase -= inFrames;
    outFrames = outIdx;
  }
};

static std::array<float, NUM_BANDS> makeCenterFrequencies() {
  std::array<float, NUM_BANDS> freqs{};
  float log_min = std::log10(MIN_EQ_FREQ);
  float log_max = std::log10(MAX_EQ_FREQ);
  float step = (log_max - log_min) / (NUM_BANDS - 1);
  for (int i = 0; i < NUM_BANDS; ++i) {
    freqs[i] = std::pow(10.0f, log_min + step * i);
  }
  return freqs;
}

static const std::array<float, NUM_BANDS> CENTER_FREQUENCIES =
    makeCenterFrequencies();

// ==================================================================================
// BIQUAD FILTER CORE
// ==================================================================================
struct Biquad {
  float b0, b1, b2, a1, a2;
  float x1, x2, y1, y2;

  Biquad() : b0(1), b1(0), b2(0), a1(0), a2(0), x1(0), x2(0), y1(0), y2(0) {}

  void reset() { x1 = x2 = y1 = y2 = 0; }

  void setIdentity() {
    b0 = 1.0f;
    b1 = 0.0f;
    b2 = 0.0f;
    a1 = 0.0f;
    a2 = 0.0f;
    reset();
  }

  bool coeffsFinite() const {
    return std::isfinite(b0) && std::isfinite(b1) && std::isfinite(b2) && std::isfinite(a1) &&
           std::isfinite(a2);
  }

  static inline float clampFreq(float freq) {
    return clampf(freq, 10.0f, gSampleRate * 0.45f);
  }

  static inline float clampQ(float q) { return clampf(q, 0.1f, 18.0f); }

  void setPeakingEQ(float centerFreq, float Q, float gaindB) {
    centerFreq = clampFreq(centerFreq);
    Q = clampQ(Q);
    float A = std::pow(10.0f, gaindB / 40.0f);
    float omega = 2.0f * (float)M_PI * centerFreq / gSampleRate;
    float sn = std::sin(omega);
    float cs = std::cos(omega);
    float alpha = sn / (2.0f * Q);

    float b0_tmp = 1.0f + alpha * A;
    float b1_tmp = -2.0f * cs;
    float b2_tmp = 1.0f - alpha * A;
    float a0_tmp = 1.0f + alpha / A;
    float a1_tmp = -2.0f * cs;
    float a2_tmp = 1.0f - alpha / A;

    b0 = b0_tmp / a0_tmp;
    b1 = b1_tmp / a0_tmp;
    b2 = b2_tmp / a0_tmp;
    a1 = a1_tmp / a0_tmp;
    a2 = a2_tmp / a0_tmp;

    if (!coeffsFinite()) setIdentity();
  }

  void setLowShelf(float cutoffFreq, float gaindB) {
    cutoffFreq = clampFreq(cutoffFreq);
    float A = std::pow(10.0f, gaindB / 40.0f);
    float omega = 2.0f * (float)M_PI * cutoffFreq / gSampleRate;
    float sn = std::sin(omega);
    float cs = std::cos(omega);
    float beta = std::sqrt(A + A);

    float b0_tmp = A * ((A + 1) - (A - 1) * cs + beta * sn);
    float b1_tmp = 2 * A * ((A - 1) - (A + 1) * cs);
    float b2_tmp = A * ((A + 1) - (A - 1) * cs - beta * sn);
    float a0_tmp = (A + 1) + (A - 1) * cs + beta * sn;
    float a1_tmp = -2 * ((A - 1) + (A + 1) * cs);
    float a2_tmp = (A + 1) + (A - 1) * cs - beta * sn;

    b0 = b0_tmp / a0_tmp;
    b1 = b1_tmp / a0_tmp;
    b2 = b2_tmp / a0_tmp;
    a1 = a1_tmp / a0_tmp;
    a2 = a2_tmp / a0_tmp;

    if (!coeffsFinite()) setIdentity();
  }

  void setHighShelf(float cutoffFreq, float gaindB) {
    cutoffFreq = clampFreq(cutoffFreq);
    float A = std::pow(10.0f, gaindB / 40.0f);
    float omega = 2.0f * (float)M_PI * cutoffFreq / gSampleRate;
    float sn = std::sin(omega);
    float cs = std::cos(omega);
    float beta = std::sqrt(A + A);

    float b0_tmp = A * ((A + 1) + (A - 1) * cs + beta * sn);
    float b1_tmp = -2 * A * ((A - 1) + (A + 1) * cs);
    float b2_tmp = A * ((A + 1) + (A - 1) * cs - beta * sn);
    float a0_tmp = (A + 1) - (A - 1) * cs + beta * sn;
    float a1_tmp = 2 * ((A - 1) - (A + 1) * cs);
    float a2_tmp = (A + 1) - (A - 1) * cs - beta * sn;

    b0 = b0_tmp / a0_tmp;
    b1 = b1_tmp / a0_tmp;
    b2 = b2_tmp / a0_tmp;
    a1 = a1_tmp / a0_tmp;
    a2 = a2_tmp / a0_tmp;

    if (!coeffsFinite()) setIdentity();
  }

  void setLowPass(float cutoffFreq, float Q) {
    float fc = clampf(cutoffFreq, 10.0f, gSampleRate * 0.45f);
    float omega = 2.0f * (float)M_PI * fc / gSampleRate;
    float sn = std::sin(omega);
    float cs = std::cos(omega);
    float alpha = sn / (2.0f * Q);

    float b0_tmp = (1.0f - cs) * 0.5f;
    float b1_tmp = 1.0f - cs;
    float b2_tmp = (1.0f - cs) * 0.5f;
    float a0_tmp = 1.0f + alpha;
    float a1_tmp = -2.0f * cs;
    float a2_tmp = 1.0f - alpha;

    b0 = b0_tmp / a0_tmp;
    b1 = b1_tmp / a0_tmp;
    b2 = b2_tmp / a0_tmp;
    a1 = a1_tmp / a0_tmp;
    a2 = a2_tmp / a0_tmp;
  }

  void setHighPass(float cutoffFreq, float Q) {
    float fc = clampf(cutoffFreq, 10.0f, gSampleRate * 0.45f);
    float omega = 2.0f * (float)M_PI * fc / gSampleRate;
    float sn = std::sin(omega);
    float cs = std::cos(omega);
    float alpha = sn / (2.0f * Q);

    float b0_tmp = (1.0f + cs) * 0.5f;
    float b1_tmp = -(1.0f + cs);
    float b2_tmp = (1.0f + cs) * 0.5f;
    float a0_tmp = 1.0f + alpha;
    float a1_tmp = -2.0f * cs;
    float a2_tmp = 1.0f - alpha;

    b0 = b0_tmp / a0_tmp;
    b1 = b1_tmp / a0_tmp;
    b2 = b2_tmp / a0_tmp;
    a1 = a1_tmp / a0_tmp;
    a2 = a2_tmp / a0_tmp;
  }

  void setNotch(float centerFreq, float Q) {
    float fc = clampf(centerFreq, 10.0f, gSampleRate * 0.45f);
    float omega = 2.0f * (float)M_PI * fc / gSampleRate;
    float sn = std::sin(omega);
    float cs = std::cos(omega);
    float alpha = sn / (2.0f * Q);

    float b0_tmp = 1.0f;
    float b1_tmp = -2.0f * cs;
    float b2_tmp = 1.0f;
    float a0_tmp = 1.0f + alpha;
    float a1_tmp = -2.0f * cs;
    float a2_tmp = 1.0f - alpha;

    b0 = b0_tmp / a0_tmp;
    b1 = b1_tmp / a0_tmp;
    b2 = b2_tmp / a0_tmp;
    a1 = a1_tmp / a0_tmp;
    a2 = a2_tmp / a0_tmp;
  }

  void setBandPass(float centerFreq, float Q) {
    float fc = clampf(centerFreq, 10.0f, gSampleRate * 0.45f);
    float omega = 2.0f * (float)M_PI * fc / gSampleRate;
    float sn = std::sin(omega);
    float cs = std::cos(omega);
    float alpha = sn / (2.0f * Q);

    float b0_tmp = alpha;
    float b1_tmp = 0.0f;
    float b2_tmp = -alpha;
    float a0_tmp = 1.0f + alpha;
    float a1_tmp = -2.0f * cs;
    float a2_tmp = 1.0f - alpha;

    b0 = b0_tmp / a0_tmp;
    b1 = b1_tmp / a0_tmp;
    b2 = b2_tmp / a0_tmp;
    a1 = a1_tmp / a0_tmp;
    a2 = a2_tmp / a0_tmp;
  }

  inline float process(float input) {
    float output = b0 * input + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    if (std::abs(output) < 1e-20f)
      output = 0.0f;
    x2 = x1;
    x1 = input;
    y2 = y1;
    y1 = output;
    return output;
  }
};

// ===========================================
// ADDITIONAL EFFECTS (From Aurivo project)
// ===========================================

struct SimpleCompressor {
    float threshold;
    float ratio;
    float attack;
    float release;
    float makeup;
    float envelope;
    bool enabled;

    SimpleCompressor() : threshold(1.0f), ratio(1.0f), attack(0.0f), release(0.0f), makeup(1.0f), envelope(0.0f), enabled(false) {}

    void setParams(float threshdB, float rat, float attMs, float relMs, float makdB) {
        threshold = std::pow(10.0f, threshdB / 20.0f);
        ratio = std::max(1.0f, rat);
        attack = std::exp(-1.0f / (std::max(1.0f, attMs) * 0.001f * gSampleRate));
        release = std::exp(-1.0f / (std::max(1.0f, relMs) * 0.001f * gSampleRate));
        makeup = std::pow(10.0f, makdB / 20.0f);
    }

    float process(float input) {
        if (!enabled) return input;
        
        float absIn = std::abs(input);
        if (absIn > envelope) envelope = attack * (envelope - absIn) + absIn;
        else envelope = release * (envelope - absIn) + absIn;
        
        if (envelope > threshold && envelope > 1e-6f) {
            float gr = std::pow(envelope / threshold, (1.0f / ratio) - 1.0f);
            return input * gr * makeup;
        }
        return input * makeup;
    }
};

struct SimpleGate {
    float threshold;
    float envelope;
    float attack;
    float release;
    bool enabled;
    
    SimpleGate() : threshold(0.0f), envelope(0.0f), attack(0.0f), release(0.0f), enabled(false) {}
    
    void setParams(float threshdB, float attMs, float relMs) {
        threshold = std::pow(10.0f, threshdB / 20.0f);
        attack = std::exp(-1.0f / (std::max(1.0f, attMs) * 0.001f * gSampleRate));
        release = std::exp(-1.0f / (std::max(1.0f, relMs) * 0.001f * gSampleRate));
    }
    
    float process(float input) {
        if (!enabled) return input;
        
        float absIn = std::abs(input);
        float target = (absIn > threshold) ? 1.0f : 0.0f;
        
        if (target > envelope) envelope = attack * (envelope - target) + target;
        else envelope = release * (envelope - target) + target;
        
        return input * envelope;
    }
};

struct SimpleLimiter {
    float ceiling;
    float envelope;
    float release;
    bool enabled;
    
    SimpleLimiter() : ceiling(1.0f), envelope(0.0f), release(0.0f), enabled(false) {}
    
    void setParams(float ceil, float relMs) {
        ceiling = std::pow(10.0f, ceil / 20.0f);
        release = std::exp(-1.0f / (std::max(1.0f, relMs) * 0.001f * gSampleRate));
    }
    
    float process(float input) {
        if (!enabled) return input;
        
        float absIn = std::abs(input);
        if (absIn > envelope) envelope = absIn;
        else envelope = release * (envelope - absIn) + absIn;
        
        if (envelope > ceiling && envelope > 1e-6f) {
            return input * (ceiling / envelope);
        }
        return input;
    }
};

struct SimpleEcho {
    std::vector<float> buffer;
    int pos;
    float feedback;
    float mix; // 0-1
    int delaySamples;
    bool enabled;
    
    SimpleEcho() : pos(0), feedback(0.0f), mix(0.0f), delaySamples(0), enabled(false) {
        buffer.resize(96000, 0.0f); // Max 2 sec
    }
    
    void setParams(float delayMs, float fb, float mx) {
        delaySamples = (int)(delayMs * 0.001f * gSampleRate);
        feedback = std::min(0.95f, fb);
        mix = mx;
        if (delaySamples >= buffer.size()) delaySamples = buffer.size() - 1;
    }
    
    float process(float input) {
        if (!enabled || delaySamples <= 0) return input;
        
        float delayed = buffer[pos];
        float newVal = input + delayed * feedback;
        if (std::abs(newVal) < 1e-20f) newVal = 0.0f;
        
        buffer[pos] = newVal;
        pos++;
        if (pos >= delaySamples) pos = 0;
        
        return input * (1.0f - mix) + delayed * mix;
    }
};

// Filter Types for Parametric EQ
enum PEQFilterType {
    PEQ_BELL = 0,        // Peak/Bell (varsayılan)
    PEQ_LOW_SHELF,       // Low Shelf
    PEQ_HIGH_SHELF,      // High Shelf
    PEQ_LOW_PASS,        // Low Pass
    PEQ_HIGH_PASS,       // High Pass
    PEQ_NOTCH,           // Notch (Band Stop)
    PEQ_BAND_PASS        // Band Pass
};

struct ParametricEQ {
    static const int BANDS = 6;  // 6 bant!
    Biquad bands[BANDS];
    bool enabled;
    
    struct BandSettings {
        float freq;
        float gain;
        float Q;
        PEQFilterType filterType;
    } settings[BANDS];

    // Varsayılan frekanslar (6 bant)
    static constexpr float DEFAULT_FREQS[6] = {60.0f, 150.0f, 400.0f, 1500.0f, 5000.0f, 12000.0f};
    static constexpr PEQFilterType DEFAULT_TYPES[6] = {
        PEQ_LOW_SHELF, PEQ_BELL, PEQ_BELL, PEQ_BELL, PEQ_BELL, PEQ_HIGH_SHELF
    };

    ParametricEQ() : enabled(false) {
        for(int i=0; i<BANDS; i++) {
            settings[i] = {DEFAULT_FREQS[i], 0.0f, 1.0f, DEFAULT_TYPES[i]};
        }
    }
    
    void setBand(int index, float freq, float gain, float Q) {
        if (index < 0 || index >= BANDS) return;
        settings[index].freq = freq;
        settings[index].gain = gain;
        settings[index].Q = Q;
        applyBandFilter(index);
    }
    
    void setFilterType(int index, PEQFilterType type) {
        if (index < 0 || index >= BANDS) return;
        settings[index].filterType = type;
        applyBandFilter(index);
    }
    
    void applyBandFilter(int index) {
        if (index < 0 || index >= BANDS) return;
        
        float freq = settings[index].freq;
        float gain = settings[index].gain;
        float Q = settings[index].Q;
        
        switch (settings[index].filterType) {
            case PEQ_BELL:
                bands[index].setPeakingEQ(freq, Q, gain);
                break;
            case PEQ_LOW_SHELF:
                bands[index].setLowShelf(freq, gain);
                break;
            case PEQ_HIGH_SHELF:
                bands[index].setHighShelf(freq, gain);
                break;
            case PEQ_LOW_PASS:
                bands[index].setLowPass(freq, Q);
                break;
            case PEQ_HIGH_PASS:
                bands[index].setHighPass(freq, Q);
                break;
            case PEQ_NOTCH:
                bands[index].setNotch(freq, Q);
                break;
            case PEQ_BAND_PASS:
                bands[index].setBandPass(freq, Q);
                break;
        }
    }
    
    void recalc() {
        for(int i=0; i<BANDS; i++) {
            applyBandFilter(i);
        }
    }
    
    float process(float input) {
        if (!enabled) return input;
        float out = input;
        for(int i=0; i<BANDS; i++) {
             out = bands[i].process(out);
        }
        return out;
    }
};

// ==================================================================================
// MASTER DSP CHAIN (Merged Angolla + Aurivo Effects)
// ==================================================================================
class MasterDSP {
private:
  // Angolla Core
  std::vector<Biquad> filtersLeft, filtersRight;
  Biquad lowExciterL, lowExciterR;
  Biquad highExciterL, highExciterR;
  Biquad smartBassL, smartBassR;
  Biquad bassLoudL, bassLoudR;
  Biquad bassProtectL, bassProtectR;
  Biquad toneMidL, toneMidR;
  Biquad toneHighL, toneHighR;
  Biquad webLowPassL, webLowPassR;
  
  // Custom Modules
  ParametricEQ peqL, peqR;
  SimpleCompressor compressorL, compressorR;
  SimpleGate gateL, gateR;
  SimpleLimiter limiterL, limiterR;
  SimpleEcho echoL, echoR;
  Biquad bassBoostL, bassBoostR;
  bool bassBoostEnabled;
  float bassBoostGain;

  // Crossfeed (Headphone Enhancement - Meier/Linkwitz style)
  struct Crossfeed {
      bool enabled;
      float level;        // 0-100%
      float delay;        // ms
      float lowCut;       // Hz
      float highCut;      // Hz

      // Internal
      std::vector<float> delayBufferL, delayBufferR;
      int delaySamples;
      int bufferPos;
      Biquad shadowingFilterL, shadowingFilterR; // Head shadowing simulator

      Crossfeed() : enabled(false), level(30.0f), delay(0.3f), lowCut(700.0f), highCut(4000.0f),
                    delaySamples(0), bufferPos(0) {
          delayBufferL.resize(4800, 0.0f); // Max 100ms at 48kHz
          delayBufferR.resize(4800, 0.0f);
      }

      void setParams(float lvl, float dly, float low, float high) {
          level = lvl;
          delay = dly;
          lowCut = low;
          highCut = high;

          // Recalculate delay samples (inter-aural time difference)
          delaySamples = (int)(delay * 0.001f * gSampleRate);
          if (delaySamples < 1) delaySamples = 1;
          if (delaySamples >= (int)delayBufferL.size()) delaySamples = (int)delayBufferL.size() - 1;

          // Shadowing filter: High frequencies are blocked by head, so cross-talk is low-passed
          // Standard Meier crossfeed uses ~700Hz cutoff. highCut param allows customizing this.
          shadowingFilterL.setLowPass(highCut, 0.5f); // Use lower Q for natural roll-off
          shadowingFilterR.setLowPass(highCut, 0.5f);
      }

      void process(float &L, float &R) {
          if (!enabled || delaySamples <= 0) return;

          // 1. Store current samples in delay line
          delayBufferL[bufferPos] = L;
          delayBufferR[bufferPos] = R;

          // 2. Read delayed samples for cross-talk
          int readPos = bufferPos - delaySamples;
          if (readPos < 0) readPos += delayBufferL.size();

          float crossL = delayBufferR[readPos];
          float crossR = delayBufferL[readPos];

          // 3. Apply head shadowing (Low-pass) to cross-talk signals
          crossL = shadowingFilterL.process(crossL);
          crossR = shadowingFilterR.process(crossR);

          // 4. Calculate mix amounts
          // Boosted max mix for more audible effect (0.5 -> 0.7)
          // 0.7 (-3dB) is significant cross-talk
          float mix = (level * 0.01f) * 0.7f; 
          
          // 5. Apply level compensation to direct signal to prevent mono buildup
          float directGain = 1.0f - (mix * 0.45f);

          // 6. Combine
          L = (L * directGain) + (crossL * mix);
          R = (R * directGain) + (crossR * mix);

          bufferPos = (bufferPos + 1) % delayBufferL.size();
      }
  } crossfeed;

  // Bass Mono (Low Frequency Mono Summing)
  struct BassMono {
      bool enabled;
      float cutoff;       // Hz
      float slope;        // dB/oct (12, 24, 48)
      float stereoWidth;  // % (cutoff üstü genişlik)

      // Crossover Filters
      Biquad lpL, lpR, hpL, hpR;
      Biquad lpL2, lpR2, hpL2, hpR2; // For 24dB
      Biquad lpL3, lpR3, hpL3, hpR3; // For 48dB
      Biquad lpL4, lpR4, hpL4, hpR4; // For 48dB

      BassMono() : enabled(false), cutoff(120.0f), slope(24.0f), stereoWidth(100.0f) {}

      void setParams(bool en, float freq, float s, float width) {
          enabled = en;
          cutoff = freq;
          slope = s;
          stereoWidth = width;
          updateFilters();
      }

      void updateFilters() {
          float q = 0.707f;
          if (slope >= 24.0f) q = 0.5f;

          lpL.setLowPass(cutoff, q); lpR.setLowPass(cutoff, q);
          hpL.setHighPass(cutoff, q); hpR.setHighPass(cutoff, q);

          if (slope >= 24.0f) {
              lpL2.setLowPass(cutoff, q); lpR2.setLowPass(cutoff, q);
              hpL2.setHighPass(cutoff, q); hpR2.setHighPass(cutoff, q);
          }
          if (slope >= 48.0f) {
              lpL3.setLowPass(cutoff, q); lpR3.setLowPass(cutoff, q);
              hpL3.setHighPass(cutoff, q); hpR3.setHighPass(cutoff, q);
              lpL4.setLowPass(cutoff, q); lpR4.setLowPass(cutoff, q);
              hpL4.setHighPass(cutoff, q); hpR4.setHighPass(cutoff, q);
          }
      }

      void process(float &L, float &R) {
          if (!enabled) return;

          // 1. Process Low Pass (Bass isolation)
          float lowL = lpL.process(L);
          float lowR = lpR.process(R);
          
          if (slope >= 24.0f) { lowL = lpL2.process(lowL); lowR = lpR2.process(lowR); }
          if (slope >= 48.0f) { 
              lowL = lpL3.process(lowL); lowR = lpR3.process(lowR);
              lowL = lpL4.process(lowL); lowR = lpR4.process(lowR);
          }

          // 2. Process High Pass (Remaining signal)
          float highL = hpL.process(L);
          float highR = hpR.process(R);

          if (slope >= 24.0f) { highL = hpL2.process(highL); highR = hpR2.process(highR); }
          if (slope >= 48.0f) { 
              highL = hpL3.process(highL); highR = hpR3.process(highR);
              highL = hpL4.process(highL); highR = hpR4.process(highR);
          }

          // 3. Sum Low to Mono
          float monoBass = (lowL + lowR) * 0.5f;

          // 4. Apply Width to High
          if (stereoWidth != 100.0f) {
              float width = stereoWidth * 0.01f;
              float mid = (highL + highR) * 0.5f;
              float side = (highL - highR) * 0.5f;
              side *= width;
              highL = mid + side;
              highR = mid - side;
          }

          // 5. Combine
          L = monoBass + highL;
          R = monoBass + highR;
      }
  } bassMono;
  
  // Dynamic EQ (Professional Mastering) - High Quality 2nd Order
  struct DynamicEQ {
      bool enabled;
      float frequency;   
      float q;           
      float threshold;   
      float targetGain;  
      float range;       
      float attackMs;
      float releaseMs;

      // Processing State
      float env;         
      Biquad detL, detR;    
      Biquad peakL, peakR;  
      
      uint32_t counter;
      float smoothedGainDb;

      DynamicEQ() : enabled(false), frequency(3500.0f), q(2.0f), threshold(-40.0f),
                    targetGain(-6.0f), range(12.0f), attackMs(5.0f), releaseMs(120.0f),
                    env(0.0f), counter(0), smoothedGainDb(0.0f) {
          detL.reset(); detR.reset(); peakL.reset(); peakR.reset();
      }

      void setParams(bool en, float f, float _q, float thr, float gain, float rng, float atk, float rel) {
          bool freqChanged = (std::abs(f - frequency) > 1.0f || std::abs(_q - q) > 0.05f);
          enabled = en;
          frequency = f;
          q = _q;
          threshold = thr;
          targetGain = gain;
          range = rng;
          attackMs = atk;
          releaseMs = rel;

          if (freqChanged) {
              detL.setBandPass(frequency, q);
              detR.setBandPass(frequency, q);
          }
      }

      void process(float &L, float &R) {
          if (!enabled) return;

          float sr = gSampleRate;
          float atkCoeff = std::exp(-1.0f / (0.001f * std::max(0.1f, attackMs) * sr));
          float relCoeff = std::exp(-1.0f / (0.001f * std::max(1.0f, releaseMs) * sr));

          float thrLin = std::pow(10.0f, threshold / 20.0f);
          float targetGainDb = clampf(targetGain, -24.0f, 24.0f);
          float maxRange = clampf(range, 0.0f, 36.0f);

          // 1. Detection
          float detOutL = detL.process(L);
          float detOutR = detR.process(R);
          float x = 0.5f * (std::abs(detOutL) + std::abs(detOutR));

          // 2. Envelope
          if (x > env) env = atkCoeff * env + (1.0f - atkCoeff) * x;
          else env = relCoeff * env + (1.0f - relCoeff) * x;

          // 3. Dynamic Gain Calculation & Smoothing
          float over = (env > thrLin) ? (env - thrLin) / (thrLin + 1e-6f) : 0.0f;
          float targetDynDb = clampf(over * targetGainDb, -maxRange, maxRange);
          
          // Smooth the gain to avoid filter ripples
          smoothedGainDb = 0.995f * smoothedGainDb + 0.005f * targetDynDb;

          // 4. Update filters (Every 64 samples for stability and performance)
          if (++counter >= 64) {
              peakL.setPeakingEQ(frequency, q, smoothedGainDb);
              peakR.setPeakingEQ(frequency, q, smoothedGainDb);
              counter = 0;
          }

          // 5. Apply
          L = peakL.process(L);
          R = peakR.process(R);

          // Debug
          static int debugCounter = 0;
          if (enabled && ++debugCounter > 10000) {
              printf("[DYNAMIC EQ] env=%.4f thr=%.4f dynGain=%.2f dB over=%.2f\n", 
                     env, thrLin, smoothedGainDb, over);
              debugCounter = 0;
          }
      }
  } dynamicEQ;


  // State
  float webLowPassFreq;
  float gains[NUM_BANDS];
  float targetGains[NUM_BANDS];
  float currentGains[NUM_BANDS];
  float targetTone[3];
  float currentTone[3];
  float targetStereoWidth;
  float currentStereoWidth;
  float targetPreGain;
  float currentPreGain;
  float currentMasterGain;
  float smartMix;
  std::array<int, NUM_BANDS> activeBands;
  int activeBandCount;
  float limiterCeiling;
  bool smartEnabled;
  bool dspEnabled;
  bool needsRebuild;

  // Steady-State Noise Detector
  float lastRMS;
  float rmsVariance;
  int frozenCounter;
  bool signalFrozen;
  bool forceMute;
  float monitorGateThreshold;
  Resampler monitorResampler;

public:
  MasterDSP()
      : targetPreGain(1.0f), currentPreGain(1.0f), activeBandCount(0),
        webLowPassFreq(8000.0f), bassBoostEnabled(false) {
    filtersLeft.resize(NUM_BANDS);
    filtersRight.resize(NUM_BANDS);
    for (int i = 0; i < NUM_BANDS; ++i) {
      gains[i] = 1.0f;
      targetGains[i] = 1.0f;
      currentGains[i] = 1.0f;
    }
    targetTone[0] = targetTone[1] = targetTone[2] = 1.0f;
    currentTone[0] = currentTone[1] = currentTone[2] = 1.0f;
    targetStereoWidth = 1.0f;
    currentStereoWidth = 1.0f;
    currentMasterGain = 1.0f;
    smartMix = 0.3f;
    smartEnabled = true;
    dspEnabled = true;
    needsRebuild = false;

    limiterCeiling = std::pow(10.0f, -0.3f / 20.0f);

    lastRMS = 0.0f;
    rmsVariance = 1.0f;
    frozenCounter = 0;
    signalFrozen = false;
    forceMute = false;
    monitorGateThreshold = std::pow(10.0f, -35.0f / 20.0f);
  }

  void rebuildFilters() {
    for (auto &f : filtersLeft) f.reset();
    for (auto &f : filtersRight) f.reset();
    lowExciterL.reset(); lowExciterR.reset();
    highExciterL.reset(); highExciterR.reset();
    smartBassL.reset(); smartBassR.reset();
    bassLoudL.reset(); bassLoudR.reset();
    bassProtectL.reset(); bassProtectR.reset();
    toneMidL.reset(); toneMidR.reset();
    toneHighL.reset(); toneHighR.reset();
    webLowPassL.reset(); webLowPassR.reset();
    peqL.recalc(); peqR.recalc();

    const float Q = 2.5f;
    for (int b = 0; b < NUM_BANDS; ++b) {
      if (b == 0) {
        filtersLeft[b].setLowShelf(CENTER_FREQUENCIES[b], currentGains[b]);
        filtersRight[b].setLowShelf(CENTER_FREQUENCIES[b], currentGains[b]);
      } else if (b == NUM_BANDS - 1) {
        filtersLeft[b].setHighShelf(CENTER_FREQUENCIES[b], currentGains[b]);
        filtersRight[b].setHighShelf(CENTER_FREQUENCIES[b], currentGains[b]);
      } else {
        filtersLeft[b].setPeakingEQ(CENTER_FREQUENCIES[b], Q, currentGains[b]);
        filtersRight[b].setPeakingEQ(CENTER_FREQUENCIES[b], Q, currentGains[b]);
      }
    }

    lowExciterL.setLowPass(120.0f, 0.7f);
    lowExciterR.setLowPass(120.0f, 0.7f);
    highExciterL.setHighPass(6000.0f, 0.7f);
    highExciterR.setHighPass(6000.0f, 0.7f);

    smartBassL.setLowPass(120.0f, 0.7f);
    smartBassR.setLowPass(120.0f, 0.7f);
    bassLoudL.setLowShelf(100.0f, currentTone[0]);
    bassLoudR.setLowShelf(100.0f, currentTone[0]);
    bassProtectL.setLowPass(140.0f, 0.7f);
    bassProtectR.setLowPass(140.0f, 0.7f);

    toneMidL.setPeakingEQ(1000.0f, 0.8f, currentTone[1]);
    toneMidR.setPeakingEQ(1000.0f, 0.8f, currentTone[1]);
    toneHighL.setHighShelf(10000.0f, currentTone[2]);
    toneHighR.setHighShelf(10000.0f, currentTone[2]);
    webLowPassL.setLowPass(webLowPassFreq, 0.7f);
    webLowPassR.setLowPass(webLowPassFreq, 0.7f);
  }

  void setSampleRate(float sr) {
    float clamped = clampf(sr, 8000.0f, 192000.0f);
    if (std::abs(clamped - gSampleRate) < 1.0f)
      return;
    gSampleRate = clamped;
    needsRebuild = true;
  }

  // ... [Standard Angolla Setters]
  void updateTargets() {
    float max_boost = 0.0f;
    for (int i = 0; i < NUM_BANDS; ++i) {
      targetGains[i] = gains[i];
      float weight = (i == 0 || i == NUM_BANDS - 1) ? 0.6f : 1.0f;
      float weighted = targetGains[i] * weight;
      if (weighted > max_boost)
        max_boost = weighted;
    }
    float soft_boost = 6.0f * std::tanh(max_boost / 6.0f);
    targetPreGain = std::pow(10.0f, -(soft_boost * 0.60f) / 20.0f);
  }

  void setEQGain(int band, float db) {
    if (band >= 0 && band < NUM_BANDS) {
      gains[band] = db;
      updateTargets();
    }
  }

  void setEQGains(const float *newGains, int numBands) {
    if (!newGains) return;
    int count = std::min(numBands, NUM_BANDS);
    for (int i = 0; i < count; ++i) gains[i] = newGains[i];
    updateTargets();
  }

  void setDSPEnabled(bool enabled) { dspEnabled = enabled; }
  void setToneParams(float bass, float mid, float treble) {
    targetTone[0] = bass; targetTone[1] = mid; targetTone[2] = treble;
  }
  void setStereoWidth(float width) { targetStereoWidth = clampf(width, 0.0f, 2.0f); }
  void setMasterToggle(bool active) { smartEnabled = active; }
  void setWebLPF(float freq) {
    float clamped = clampf(freq, 200.0f, 20000.0f);
    if (std::abs(clamped - webLowPassFreq) > 1.0f) {
      webLowPassFreq = clamped;
      webLowPassL.setLowPass(webLowPassFreq, 0.7f);
      webLowPassR.setLowPass(webLowPassFreq, 0.7f);
    }
  }
  void setForceMute(bool mute) { forceMute = mute; }

  // [Enhanced Setters for Extra Effects]
  void setCompressorParams(bool enabled, float thresh, float ratio, float att, float rel, float makeup) {
        compressorL.enabled = enabled; compressorR.enabled = enabled;
        if (enabled) {
            compressorL.setParams(thresh, ratio, att, rel, makeup);
            compressorR.setParams(thresh, ratio, att, rel, makeup);
        }
    }
    
    void setGateParams(bool enabled, float thresh, float att, float rel) {
        gateL.enabled = enabled; gateR.enabled = enabled;
        if (enabled) {
            gateL.setParams(thresh, att, rel);
            gateR.setParams(thresh, att, rel);
        }
    }
    
    void setLimiterParams(bool enabled, float ceiling, float rel) {
        limiterL.enabled = enabled; limiterR.enabled = enabled;
        if (enabled) {
            limiterL.setParams(ceiling, rel);
            limiterR.setParams(ceiling, rel);
        }
    }
    
    void setEchoParams(bool enabled, float delay, float feedback, float mix) {
        echoL.enabled = enabled; echoR.enabled = enabled;
        if (enabled) {
            echoL.setParams(delay, feedback, mix);
            echoR.setParams(delay, feedback, mix);
        }
    }
    
    void setBassBoost(bool enabled, float gain, float freq) {
        bassBoostEnabled = enabled;
        bassBoostGain = gain;
        bassBoostL.setLowShelf(freq, gain);
        bassBoostR.setLowShelf(freq, gain);
    }

    void setCrossfeedParams(bool enabled, float level, float delay, float lowCut, float highCut) {
        crossfeed.enabled = enabled;
        if (enabled) {
            crossfeed.setParams(level, delay, lowCut, highCut);
        }
    }

    void setPEQBand(int index, bool enabled, float freq, float gain, float Q) {
        peqL.enabled = enabled; peqR.enabled = enabled;
        peqL.setBand(index, freq, gain, Q);
        peqR.setBand(index, freq, gain, Q);
    }
    
    void setPEQFilterType(int index, int filterType) {
        peqL.setFilterType(index, static_cast<PEQFilterType>(filterType));
    peqR.setFilterType(index, static_cast<PEQFilterType>(filterType));
  }

  void setBassMonoParams(bool enabled, float cutoff, float slope, float width) {
      bassMono.setParams(enabled, cutoff, slope, width);
  }
  
  void setDynamicEQParams(bool enabled, float freq, float q, float thr, float gain, float rng, float atk, float rel) {
      printf("[DSP] setDynamicEq: en=%d, f=%.1f, q=%.1f, thr=%.1f, g=%.1f, r=%.1f, a=%.1f, rel=%.1f\n",
             enabled, freq, q, thr, gain, rng, atk, rel);
      dynamicEQ.setParams(enabled, freq, q, thr, gain, rng, atk, rel);
  }
  
  // PEQ band ayarlarını al
    void getPEQBand(int index, float* freq, float* gain, float* Q, int* filterType) {
        if (index < 0 || index >= ParametricEQ::BANDS) return;
        *freq = peqL.settings[index].freq;
        *gain = peqL.settings[index].gain;
        *Q = peqL.settings[index].Q;
        *filterType = static_cast<int>(peqL.settings[index].filterType);
    }

  void processBuffer(float *buffer, int numFrames, int channels) {
    if (!buffer || channels != 2) return;
    int total_samples = numFrames * channels;
    if (total_samples <= 0) return;

    double sum_sq = 0.0;
    for (int i = 0; i < total_samples; ++i) {
      float v = buffer[i];
      sum_sq += static_cast<double>(v) * static_cast<double>(v);
    }
    float rms = std::sqrt(sum_sq / total_samples);
    
    if (rms < NOISE_GATE_RMS) {
      std::fill(buffer, buffer + total_samples, 0.0f);
      return;
    }

    if (needsRebuild) { rebuildFilters(); needsRebuild = false; }
    
    if (!dspEnabled) return;

    const float smoothingSamples = std::max(512.0f, gSampleRate * 0.02f);
    const float smartHeadroomDb = -3.0f;
    const float smartStep = 1.0f / smoothingSamples;
    const float invSmoothing = 1.0f / smoothingSamples;
    const float smoothThreshold = 0.0001f;
    const float Q = 2.5f;
    const float toneQ = 0.8f;
    const float duckThresholdDb = 10.0f;
    const float duckRangeDb = 5.0f;
    const float duckMaxDb = -6.0f;
    const float bassLimit = limiterCeiling * 0.85f;
    const float hardLimiterCeiling = 1.0f;

    auto hard_limit = [&](float x) {
      if (x > hardLimiterCeiling) return hardLimiterCeiling;
      if (x < -hardLimiterCeiling) return -hardLimiterCeiling;
      return x;
    };

    // Update EQ gains + coefficients once per buffer to avoid zipper noise and potential IIR instability.
    const float blockAlpha = 1.0f - std::pow(1.0f - invSmoothing, (float)numFrames);
    activeBandCount = 0;
    for (int b = 0; b < NUM_BANDS; ++b) {
      float diff = targetGains[b] - currentGains[b];
      if (std::abs(diff) > smoothThreshold) {
        currentGains[b] += diff * blockAlpha;
      } else if (diff != 0.0f) {
        currentGains[b] = targetGains[b];
      }

      if (b == 0) {
        filtersLeft[b].setLowShelf(CENTER_FREQUENCIES[b], currentGains[b]);
        filtersRight[b].setLowShelf(CENTER_FREQUENCIES[b], currentGains[b]);
      } else if (b == NUM_BANDS - 1) {
        filtersLeft[b].setHighShelf(CENTER_FREQUENCIES[b], currentGains[b]);
        filtersRight[b].setHighShelf(CENTER_FREQUENCIES[b], currentGains[b]);
      } else {
        filtersLeft[b].setPeakingEQ(CENTER_FREQUENCIES[b], Q, currentGains[b]);
        filtersRight[b].setPeakingEQ(CENTER_FREQUENCIES[b], Q, currentGains[b]);
      }

      if (std::abs(currentGains[b]) > 1e-5f) activeBands[activeBandCount++] = b;
    }

    for (int i = 0; i < numFrames * 2; i += 2) {
      float &L = buffer[i];
      float &R = buffer[i + 1];
      float inL = L;
      float inR = R;

      // --- Angolla Smart Logic ---
      float smartTarget = smartEnabled ? 1.0f : 0.0f;
      if (smartMix < smartTarget) smartMix = std::min(smartTarget, smartMix + smartStep);
      else if (smartMix > smartTarget) smartMix = std::max(smartTarget, smartMix - smartStep);

      if (smartMix > 0.0f) {
        float lowL = smartBassL.process(inL);
        float lowR = smartBassR.process(inR);
        float drive = 1.4f;
        float harmL = std::tanh(lowL * drive) - lowL;
        float harmR = std::tanh(lowR * drive) - lowR;
        inL += harmL * (0.12f * smartMix);
        inR += harmR * (0.12f * smartMix);
        float headroom = std::pow(10.0f, (smartHeadroomDb * smartMix) / 20.0f);
        inL *= headroom;
        inR *= headroom;
      }

      currentPreGain += (targetPreGain - currentPreGain) * invSmoothing;
      currentStereoWidth += (targetStereoWidth - currentStereoWidth) * invSmoothing;

      L = inL * currentPreGain;
      R = inR * currentPreGain;

      // --- CUSTOM EFFECT CHAIN START ---
      // 1. Noise Gate
      if (gateL.enabled) { L = gateL.process(L); R = gateR.process(R); }
      // 2. Compressor
      if (compressorL.enabled) { L = compressorL.process(L); R = compressorR.process(R); }
      // 3. Bass Boost (Custom, separate from Angolla SmartBass)
      if (bassBoostEnabled) { L = bassBoostL.process(L); R = bassBoostR.process(R); }
      // 4. Parametric EQ
      if (peqL.enabled) { L = peqL.process(L); R = peqR.process(R); }
      // 5. Crossfeed (Headphone Enhancement) - Before limiter
      crossfeed.process(L, R);
      // 6. Bass Mono (Low Frequency Mono Summing) - Important for Master/Vinyl
      bassMono.process(L, R);
      // 7. Dynamic EQ (Professional Mastering)
      dynamicEQ.process(L, R);
      // --- CUSTOM EFFECT CHAIN END ---

      // --- 32-Band Angolla EQ ---
      for (int j = 0; j < activeBandCount; ++j) {
        int b = activeBands[j];
        L = filtersLeft[b].process(L);
        R = filtersRight[b].process(R);
      }

      // --- Angolla Exciter Logic ---
      float low_boost = currentGains[0];
      float high_boost = currentGains[NUM_BANDS - 1];
      float low_amount = clampf((low_boost - 10.0f) / 5.0f, 0.0f, 1.0f);
      float high_amount = clampf((high_boost - 10.0f) / 5.0f, 0.0f, 1.0f);

      if (low_amount > 0.0f) {
        float lowL = lowExciterL.process(L); float lowR = lowExciterR.process(R);
        float drive = 1.0f + (low_amount * 2.0f);
        float harmL = std::tanh(lowL * drive) - lowL; float harmR = std::tanh(lowR * drive) - lowR;
        L += harmL * (0.10f * low_amount); R += harmR * (0.10f * low_amount);
      }
      if (high_amount > 0.0f) {
        float highL = highExciterL.process(L); float highR = highExciterR.process(R);
        float drive = 1.0f + (high_amount * 2.5f);
        float harmL = std::tanh(highL * drive) - highL; float harmR = std::tanh(highR * drive) - highR;
        L += harmL * (0.08f * high_amount); R += harmR * (0.08f * high_amount);
      }

      // --- Angolla Tone Space ---
      for (int t = 0; t < 3; ++t) {
        float diff = targetTone[t] - currentTone[t];
        if (std::abs(diff) > smoothThreshold) currentTone[t] += diff * invSmoothing;
        else if (diff != 0.0f) currentTone[t] = targetTone[t];
      }

      if (smartMix > 0.0f) {
        bassLoudL.setLowShelf(100.0f, currentTone[0]); bassLoudR.setLowShelf(100.0f, currentTone[0]);
        toneMidL.setPeakingEQ(1000.0f, toneQ, currentTone[1]); toneMidR.setPeakingEQ(1000.0f, toneQ, currentTone[1]);
        toneHighL.setHighShelf(10000.0f, currentTone[2]); toneHighR.setHighShelf(10000.0f, currentTone[2]);

        float toneScale = smartMix;
        float L_proc = L; float R_proc = R;
        L_proc = bassLoudL.process(L_proc); R_proc = bassLoudR.process(R_proc);
        L_proc = toneMidL.process(L_proc); R_proc = toneMidR.process(R_proc);
        L_proc = toneHighL.process(L_proc); R_proc = toneHighR.process(R_proc);
        L = L * (1.0f - toneScale) + L_proc * toneScale;
        R = R * (1.0f - toneScale) + R_proc * toneScale;

        if (currentStereoWidth != 1.0f) {
          float M = (L + R) * 0.5f; float S = (L - R) * 0.5f; S *= currentStereoWidth;
          L = M + S; R = M - S;
        }
      }

      // 5. Echo (Post-Processing)
      if (echoL.enabled) { L = echoL.process(L); R = echoR.process(R); }

      // --- Angolla Dynamic Handling (Limiter/Duck) ---
      float duckAmount = 0.0f;
      if (smartMix > 0.0f && currentTone[0] > duckThresholdDb) {
        duckAmount = clampf((currentTone[0] - duckThresholdDb) / duckRangeDb, 0.0f, 1.0f);
      }
      float max_low_boost = 0.0f;
      for (int b = 0; b < 6; ++b) if (currentGains[b] > max_low_boost) max_low_boost = currentGains[b];

      float bass_reduction_db = std::max(0.0f, max_low_boost * 0.45f);
      float tone_bass_boost_db = std::max(0.0f, currentTone[0]) * smartMix;
      float tone_bass_reduction_db = tone_bass_boost_db * 0.333f;
      float duck_db = duckMaxDb * duckAmount * smartMix;
      float targetMaster = limiterCeiling * std::pow(10.0f, (duck_db - bass_reduction_db - tone_bass_reduction_db) / 20.0f);

      currentMasterGain += (targetMaster - currentMasterGain) * invSmoothing;
      L *= currentMasterGain; R *= currentMasterGain;

      // Bass Protect Hard Limiter
      auto bass_limit = [&](float x) {
        float ax = std::abs(x);
        if (ax <= bassLimit) return x;
        float excess = ax - bassLimit; float k = 6.0f;
        float compressed = bassLimit + (1.0f - std::exp(-k * excess)) / k;
        return (x < 0.0f) ? -compressed : compressed;
      };
      
      float lowL = bassProtectL.process(L); float lowR = bassProtectR.process(R);
      L = (L - lowL) + bass_limit(lowL);
      R = (R - lowR) + bass_limit(lowR);

      // Angolla Soft Limiter
      auto soft_limit = [&](float x) {
        float ax = std::abs(x);
        if (ax <= limiterCeiling) return x;
        float excess = ax - limiterCeiling; float k = 4.0f;
        float compressed = limiterCeiling + (1.0f - std::exp(-k * excess)) / k;
        return (x < 0.0f) ? -compressed : compressed;
      };
      L = soft_limit(L); R = soft_limit(R);

      // 6. Bass Mono (Low Frequency Mono Summing)
      bassMono.process(L, R);

      // 7. User Limiter (Post-everything safety)
      if (limiterL.enabled) { L = limiterL.process(L); R = limiterR.process(R); }

      buffer[i] = hard_limit(L);
      buffer[i + 1] = hard_limit(R);
    }
  }

  void processWebBuffer(float *buffer, int numFrames, int channels) {
      // Just wrap processBuffer for now, Angolla had duplicate logic for web
      processBuffer(buffer, numFrames, channels);
  }

  void processMonitorBuffer(float *buffer, int numFrames, int inSampleRate) {
    if (!buffer) return;
    // Just forward to processWeb
    processWebBuffer(buffer, numFrames, 2);
  }
};

} // namespace AurivoDSP

// ==================================================================================
// C-INTERFACE
// ==================================================================================
extern "C" {
void *create_dsp() { return new AurivoDSP::MasterDSP(); }
void destroy_dsp(void *dsp) { delete static_cast<AurivoDSP::MasterDSP *>(dsp); }
void process_dsp(void *dsp, float *buffer, int numFrames, int channels) {
  if (dsp) static_cast<AurivoDSP::MasterDSP *>(dsp)->processBuffer(buffer, numFrames, channels);
}
void set_eq_band(void *dsp, int band, float gain) { if (dsp) static_cast<AurivoDSP::MasterDSP *>(dsp)->setEQGain(band, gain); }
void set_eq_bands(void *dsp, const float *gains, int numBands) { if (dsp) static_cast<AurivoDSP::MasterDSP *>(dsp)->setEQGains(gains, numBands); }
void set_tone_params(void *dsp, float bass, float mid, float treble) { if (dsp) static_cast<AurivoDSP::MasterDSP *>(dsp)->setToneParams(bass, mid, treble); }
void set_stereo_width(void *dsp, float width) { if (dsp) static_cast<AurivoDSP::MasterDSP *>(dsp)->setStereoWidth(width); }
void set_master_toggle(void *dsp, int active) { if (dsp) static_cast<AurivoDSP::MasterDSP *>(dsp)->setMasterToggle(active != 0); }
void set_dsp_enabled(void *dsp, int enabled) { if (dsp) static_cast<AurivoDSP::MasterDSP *>(dsp)->setDSPEnabled(enabled != 0); }
void set_sample_rate(void *dsp, float sample_rate) { if (dsp) static_cast<AurivoDSP::MasterDSP *>(dsp)->setSampleRate(sample_rate); }
// New wrappers
void set_compressor_params(void *dsp, int enabled, float thresh, float ratio, float att, float rel, float makeup) {
    if (dsp) static_cast<AurivoDSP::MasterDSP *>(dsp)->setCompressorParams(enabled != 0, thresh, ratio, att, rel, makeup);
}
void set_gate_params(void *dsp, int enabled, float thresh, float att, float rel) {
    if (dsp) static_cast<AurivoDSP::MasterDSP *>(dsp)->setGateParams(enabled != 0, thresh, att, rel);
}
void set_limiter_params(void *dsp, int enabled, float ceiling, float rel) {
    if (dsp) static_cast<AurivoDSP::MasterDSP *>(dsp)->setLimiterParams(enabled != 0, ceiling, rel);
}
void set_echo_params(void *dsp, int enabled, float delay, float feedback, float mix) {
    if (dsp) static_cast<AurivoDSP::MasterDSP *>(dsp)->setEchoParams(enabled != 0, delay, feedback, mix);
}
void set_bass_boost(void *dsp, int enabled, float gain, float freq) {
    if (dsp) static_cast<AurivoDSP::MasterDSP *>(dsp)->setBassBoost(enabled != 0, gain, freq);
}
void set_peq_band(void *dsp, int band, int enabled, float freq, float gain, float Q) {
    if (dsp) static_cast<AurivoDSP::MasterDSP *>(dsp)->setPEQBand(band, enabled != 0, freq, gain, Q);
}
void set_peq_filter_type(void *dsp, int band, int filterType) {
    if (dsp) static_cast<AurivoDSP::MasterDSP *>(dsp)->setPEQFilterType(band, filterType);
}
void get_peq_band(void *dsp, int band, float* freq, float* gain, float* Q, int* filterType) {
    if (dsp) static_cast<AurivoDSP::MasterDSP *>(dsp)->getPEQBand(band, freq, gain, Q, filterType);
}
void set_crossfeed_params(void *dsp, int enabled, float level, float delay, float lowCut, float highCut) {
    if (dsp) static_cast<AurivoDSP::MasterDSP *>(dsp)->setCrossfeedParams(enabled != 0, level, delay, lowCut, highCut);
}
void set_bass_mono_params(void *dsp, int enabled, float cutoff, float slope, float width) {
    if (dsp) static_cast<AurivoDSP::MasterDSP *>(dsp)->setBassMonoParams(enabled != 0, cutoff, slope, width);
}
void set_dynamic_eq_params(void *dsp, int enabled, float freq, float q, float thr, float gain, float rng, float atk, float rel) {
    if (dsp) static_cast<AurivoDSP::MasterDSP *>(dsp)->setDynamicEQParams(enabled != 0, freq, q, thr, gain, rng, atk, rel);
}
}
