#pragma once

#include <QByteArray>
#include <QMutex>
#include <QString>
#include <QVector>
#include <cstdint>

class SlidingPcmBuffer {
 public:
  explicit SlidingPcmBuffer(int sampleRate = 16000, int seconds = 12);

  void resizeCapacity(int seconds);
  void pushF32(const float *data, int count);
  void pushBytes(const QByteArray &bytes);

  QVector<float> snapshot(int maxSamples = 0) const;
  void clear();

  int filled() const { return filled_; }
  int capacity() const { return capacity_; }
  int sampleRate() const { return sampleRate_; }
  double fillPercent() const;

  struct LevelStats {
    float peak = 0.0f;
    float rms = 0.0f;
  };

  LevelStats getRecentLevelStats(int windowSamples = 1600) const;
  double getLevelPercent(int windowSamples = 1600, double gain = 1.0) const;
  bool hasSignal(float threshold = 0.003f) const;

 private:
  int sampleRate_ = 16000;
  int capacity_ = 16000 * 12;
  QVector<float> samples_;
  int writeIndex_ = 0;
  int filled_ = 0;
  mutable QMutex mutex_;
};

struct FingerprintResult {
  bool success = false;
  bool pending = false;
  QString uri;
  int sampleMs = 0;
  int totalPeaks = 0;
  QString error;
};

class SongFingerprint {
 public:
  static FingerprintResult createSignatureFromSamples(const QVector<float> &samples);
  static QByteArray encodeSignature(int numberSamples, const QVector<QVector<struct PeakInfo>> &bands);
  static uint32_t calculateCrc32(const uint8_t *data, size_t length);
};
