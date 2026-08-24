#include "song_fingerprint.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <numbers>

namespace {
constexpr const char *kDataUriPrefix = "data:audio/vnd.shazam.sig;base64,";
constexpr int kSampleRate = 16000;
constexpr int kFftSize = 2048;
constexpr int kFftStep = 128;
constexpr int kFftRing = 256;

// Precalculated Hanning window
const QVector<float> &getHanningWindow() {
  static const QVector<float> kHanning = []() {
    QVector<float> h(kFftSize);
    for (int i = 0; i < kFftSize; ++i) {
      h[i] = 0.5f - 0.5f * std::cos((2.0f * std::numbers::pi_v<float> * i) / (kFftSize - 1));
    }
    return h;
  }();
  return kHanning;
}

// CRC32 Lookup Table
const uint32_t *getCrc32Table() {
  static const auto kTable = []() {
    std::array<uint32_t, 256> table{};
    for (uint32_t i = 0; i < 256; ++i) {
      uint32_t c = i;
      for (int k = 0; k < 8; ++k) {
        c = (c & 1) ? (0xedb88320u ^ (c >> 1)) : (c >> 1);
      }
      table[i] = c;
    }
    return table;
  }();
  return kTable.data();
}

void writeU32LE(QByteArray &bytes, uint32_t value) {
  const uint8_t raw[4] = {
      static_cast<uint8_t>(value & 0xff),
      static_cast<uint8_t>((value >> 8) & 0xff),
      static_cast<uint8_t>((value >> 16) & 0xff),
      static_cast<uint8_t>((value >> 24) & 0xff)};
  bytes.append(reinterpret_cast<const char *>(raw), 4);
}

void writeU16LE(QByteArray &bytes, uint16_t value) {
  const uint8_t raw[2] = {
      static_cast<uint8_t>(value & 0xff),
      static_cast<uint8_t>((value >> 8) & 0xff)};
  bytes.append(reinterpret_cast<const char *>(raw), 2);
}

void fftInPlace(float *real, float *imag, int n) {
  for (int i = 1, j = 0; i < n; ++i) {
    int bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      std::swap(real[i], real[j]);
      std::swap(imag[i], imag[j]);
    }
  }

  for (int len = 2; len <= n; len <<= 1) {
    const float angle = -2.0f * std::numbers::pi_v<float> / len;
    const float wlenR = std::cos(angle);
    const float wlenI = std::sin(angle);
    for (int i = 0; i < n; i += len) {
      float wr = 1.0f;
      float wi = 0.0f;
      for (int j = 0; j < (len >> 1); ++j) {
        const float uR = real[i + j];
        const float uI = imag[i + j];
        const int vIndex = i + j + (len >> 1);
        const float vR = real[vIndex] * wr - imag[vIndex] * wi;
        const float vI = real[vIndex] * wi + imag[vIndex] * wr;
        real[i + j] = uR + vR;
        imag[i + j] = uI + vI;
        real[vIndex] = uR - vR;
        imag[vIndex] = uI - vI;
        const float nextWr = wr * wlenR - wi * wlenI;
        wi = wr * wlenI + wi * wlenR;
        wr = nextWr;
      }
    }
  }
}

int bandForFrequency(float frequencyHz) {
  if (frequencyHz >= 250.0f && frequencyHz <= 519.0f) return 0;
  if (frequencyHz >= 520.0f && frequencyHz <= 1449.0f) return 1;
  if (frequencyHz >= 1450.0f && frequencyHz <= 3499.0f) return 2;
  if (frequencyHz >= 3500.0f && frequencyHz <= 5500.0f) return 3;
  return -1;
}

}  // namespace

struct PeakInfo {
  int fftPassNumber = 0;
  uint16_t peakMagnitude = 0;
  uint16_t correctedPeakFrequencyBin = 0;
};

class SignatureGenerator {
 public:
  SignatureGenerator() {
    ringSamples_.resize(kFftSize, 0.0f);
    fftOutputs_.resize(kFftRing);
    for (auto &row : fftOutputs_) row.resize(1025, 0.0f);
    spreadOutputs_.resize(kFftRing);
    for (auto &row : spreadOutputs_) row.resize(1025, 0.0f);
    bands_.resize(4);
  }

  QVector<QVector<PeakInfo>> process(const QVector<float> &samples) {
    const int roundedLength = samples.size() - (samples.size() % kFftStep);
    for (int offset = 0; offset < roundedLength; offset += kFftStep) {
      doFft(samples, offset);
      doPeakSpreading();
      numSpreadFfts_ += 1;
      if (numSpreadFfts_ >= 46) {
        doPeakRecognition();
      }
    }
    return bands_;
  }

 private:
  void doFft(const QVector<float> &samples, int offset) {
    for (int i = 0; i < kFftStep; ++i) {
      ringSamples_[(ringIndex_ + i) & (kFftSize - 1)] = (offset + i < samples.size()) ? samples[offset + i] : 0.0f;
    }
    ringIndex_ = (ringIndex_ + kFftStep) & (kFftSize - 1);

    const auto &hanning = getHanningWindow();
    std::array<float, kFftSize> real;
    std::array<float, kFftSize> imag{};
    for (int i = 0; i < kFftSize; ++i) {
      real[i] = ringSamples_[(i + ringIndex_) & (kFftSize - 1)] * hanning[i] * 32768.0f;
    }
    fftInPlace(real.data(), imag.data(), kFftSize);

    auto &out = fftOutputs_[fftIndex_];
    for (int i = 0; i <= 1024; ++i) {
      out[i] = std::max(((real[i] * real[i]) + (imag[i] * imag[i])) / (1 << 17), 1e-10f);
    }
    fftIndex_ = (fftIndex_ + 1) & (kFftRing - 1);
  }

  void doPeakSpreading() {
    const auto &real = fftOutputs_[(fftIndex_ - 1 + kFftRing) & (kFftRing - 1)];
    auto &spread = spreadOutputs_[spreadIndex_];
    for (int i = 0; i <= 1024; ++i) spread[i] = real[i];

    for (int pos = 0; pos <= 1022; ++pos) {
      spread[pos] = std::max({spread[pos], spread[pos + 1], spread[pos + 2]});
    }

    const auto copy = spread;
    for (int pos = 0; pos <= 1024; ++pos) {
      for (int former : {1, 3, 6}) {
        auto &formerOut = spreadOutputs_[(spreadIndex_ - former + kFftRing) & (kFftRing - 1)];
        formerOut[pos] = std::max(formerOut[pos], copy[pos]);
      }
    }
    spreadIndex_ = (spreadIndex_ + 1) & (kFftRing - 1);
  }

  void doPeakRecognition() {
    const auto &fftMinus46 = fftOutputs_[(fftIndex_ - 46 + kFftRing) & (kFftRing - 1)];
    const auto &spreadMinus49 = spreadOutputs_[(spreadIndex_ - 49 + kFftRing) & (kFftRing - 1)];

    for (int bin = 10; bin <= 1014; ++bin) {
      if (fftMinus46[bin] < 1.0f / 64.0f || fftMinus46[bin] < spreadMinus49[bin - 1]) continue;

      float maxNeighbor = 0.0f;
      for (int offset : {-10, -7, -4, -3, 1, 2, 5, 8}) {
        maxNeighbor = std::max(maxNeighbor, spreadMinus49[bin + offset]);
      }
      if (fftMinus46[bin] <= maxNeighbor) continue;

      float maxAdjacent = maxNeighbor;
      for (int offset : {-53, -45, 165, 172, 179, 186, 193, 200, 214, 221, 228, 235, 242, 249}) {
        const auto &other = spreadOutputs_[(spreadIndex_ + offset + kFftRing) & (kFftRing - 1)];
        maxAdjacent = std::max(maxAdjacent, other[bin - 1]);
      }
      if (fftMinus46[bin] <= maxAdjacent) continue;

      const int fftPassNumber = numSpreadFfts_ - 46;
      const float magnitude = std::max(std::log(fftMinus46[bin]), 1.0f / 64.0f) * 1477.3f + 6144.0f;
      const float before = std::max(std::log(fftMinus46[bin - 1]), 1.0f / 64.0f) * 1477.3f + 6144.0f;
      const float after = std::max(std::log(fftMinus46[bin + 1]), 1.0f / 64.0f) * 1477.3f + 6144.0f;
      const float variation1 = magnitude * 2.0f - before - after;
      if (variation1 < 0.0f) continue;

      const float variation2 = (after - before) * 32.0f / (variation1 != 0.0f ? variation1 : 1.0f);
      const int correctedBin = std::clamp(static_cast<int>(bin * 64 + variation2), 0, 65535);
      const float frequencyHz = correctedBin * (kSampleRate / 2.0f / 1024.0f / 64.0f);
      const int band = bandForFrequency(frequencyHz);
      if (band < 0) continue;

      PeakInfo peak;
      peak.fftPassNumber = fftPassNumber;
      peak.peakMagnitude = static_cast<uint16_t>(std::clamp(static_cast<int>(magnitude), 0, 65535));
      peak.correctedPeakFrequencyBin = static_cast<uint16_t>(correctedBin);
      bands_[band].append(peak);
    }
  }

  QVector<float> ringSamples_;
  int ringIndex_ = 0;
  QVector<QVector<float>> fftOutputs_;
  int fftIndex_ = 0;
  QVector<QVector<float>> spreadOutputs_;
  int spreadIndex_ = 0;
  int numSpreadFfts_ = 0;
  QVector<QVector<PeakInfo>> bands_;
};

SlidingPcmBuffer::SlidingPcmBuffer(int sampleRate, int seconds)
    : sampleRate_(std::clamp(sampleRate, 8000, 48000)),
      capacity_(sampleRate_ * std::clamp(seconds, 4, 30)) {
  samples_.resize(capacity_, 0.0f);
}

void SlidingPcmBuffer::resizeCapacity(int seconds) {
  QMutexLocker locker(&mutex_);
  const int newCapacity = sampleRate_ * std::clamp(seconds, 4, 30);
  if (newCapacity == capacity_) return;

  QVector<float> newSamples(newCapacity, 0.0f);
  const int wanted = std::min(filled_, newCapacity);
  const int start = (writeIndex_ - wanted + capacity_) % capacity_;
  for (int i = 0; i < wanted; ++i) {
    newSamples[i] = samples_[(start + i) % capacity_];
  }
  samples_ = std::move(newSamples);
  capacity_ = newCapacity;
  writeIndex_ = wanted % capacity_;
  filled_ = wanted;
}

void SlidingPcmBuffer::pushF32(const float *data, int count) {
  if (!data || count <= 0) return;
  QMutexLocker locker(&mutex_);
  for (int i = 0; i < count; ++i) {
    const float sample = data[i];
    samples_[writeIndex_] = std::isfinite(sample) ? std::clamp(sample, -1.0f, 1.0f) : 0.0f;
    writeIndex_ = (writeIndex_ + 1) % capacity_;
    filled_ = std::min(capacity_, filled_ + 1);
  }
}

void SlidingPcmBuffer::pushBytes(const QByteArray &bytes) {
  if (bytes.size() < static_cast<int>(sizeof(float))) return;
  const int usable = bytes.size() - (bytes.size() % sizeof(float));
  const int count = usable / sizeof(float);
  const auto *ptr = reinterpret_cast<const float *>(bytes.constData());
  pushF32(ptr, count);
}

QVector<float> SlidingPcmBuffer::snapshot(int maxSamples) const {
  QMutexLocker locker(&mutex_);
  const int wanted = std::max(0, std::min(filled_, (maxSamples > 0 ? maxSamples : filled_)));
  QVector<float> out(wanted);
  const int start = (writeIndex_ - wanted + capacity_) % capacity_;
  for (int i = 0; i < wanted; ++i) {
    out[i] = samples_[(start + i) % capacity_];
  }
  return out;
}

void SlidingPcmBuffer::clear() {
  QMutexLocker locker(&mutex_);
  std::fill(samples_.begin(), samples_.end(), 0.0f);
  writeIndex_ = 0;
  filled_ = 0;
}

double SlidingPcmBuffer::fillPercent() const {
  QMutexLocker locker(&mutex_);
  if (capacity_ <= 0) return 0.0;
  return std::clamp((static_cast<double>(filled_) / capacity_) * 100.0, 0.0, 100.0);
}

SlidingPcmBuffer::LevelStats SlidingPcmBuffer::getRecentLevelStats(int windowSamples) const {
  QMutexLocker locker(&mutex_);
  const int count = std::min(filled_, std::max(1, windowSamples));
  if (count <= 0) return {0.0f, 0.0f};

  float peak = 0.0f;
  double sumSquares = 0.0;
  for (int i = 0; i < count; ++i) {
    const int idx = (writeIndex_ - 1 - i + capacity_) % capacity_;
    const float sample = std::abs(samples_[idx]);
    peak = std::max(peak, sample);
    sumSquares += static_cast<double>(sample) * sample;
  }
  return {peak, static_cast<float>(std::sqrt(sumSquares / count))};
}

double SlidingPcmBuffer::getLevelPercent(int windowSamples, double gain) const {
  const auto stats = getRecentLevelStats(windowSamples > 0 ? windowSamples : 640);
  if (stats.peak == 0.0f && stats.rms == 0.0f) return 0.0;

  const double visualGain = std::clamp(gain, 0.1, 8.0);
  const double gainDb = 20.0 * std::log10(visualGain);
  const double rmsDb = 20.0 * std::log10(std::max(1e-6f, stats.rms)) + gainDb;
  const double peakDb = 20.0 * std::log10(std::max(1e-6f, stats.peak)) + gainDb;

  const auto toPercent = [](double db, double floorDb, double ceilingDb) {
    const double norm = (db - floorDb) / (ceilingDb - floorDb);
    return std::clamp(norm * 100.0, 0.0, 100.0);
  };

  // Floor at -60 dB to capture low-level speech/mic inputs and ceiling at -6 dB
  const double rmsPercent = toPercent(rmsDb, -60.0, -6.0);
  const double peakPercent = toPercent(peakDb, -50.0, -3.0);
  const double linearPercent = std::min(100.0, static_cast<double>(stats.rms) * visualGain * 600.0);
  const double blended = std::max((rmsPercent * 0.60) + (linearPercent * 0.40), peakPercent * 0.70);
  return std::clamp(blended, 0.0, 100.0);
}

bool SlidingPcmBuffer::hasSignal(float threshold) const {
  const auto stats = getRecentLevelStats(sampleRate_ / 2);
  return std::max(stats.peak, stats.rms * 1.8f) >= threshold;
}

uint32_t SongFingerprint::calculateCrc32(const uint8_t *data, size_t length) {
  const uint32_t *table = getCrc32Table();
  uint32_t c = 0xffffffffu;
  for (size_t i = 0; i < length; ++i) {
    c = table[(c ^ data[i]) & 0xff] ^ (c >> 8);
  }
  return c ^ 0xffffffffu;
}

QByteArray SongFingerprint::encodeSignature(int numberSamples, const QVector<QVector<PeakInfo>> &bands) {
  QByteArray bytes;
  writeU32LE(bytes, 0xcafe2580u);
  writeU32LE(bytes, 0);
  writeU32LE(bytes, 0);
  writeU32LE(bytes, 0x94119c00u);
  writeU32LE(bytes, 0);
  writeU32LE(bytes, 0);
  writeU32LE(bytes, 0);
  writeU32LE(bytes, 3u << 27);
  writeU32LE(bytes, 0);
  writeU32LE(bytes, 0);
  writeU32LE(bytes, static_cast<uint32_t>(numberSamples + static_cast<int>(kSampleRate * 0.24)));
  writeU32LE(bytes, (15u << 19) + 0x40000u);
  writeU32LE(bytes, 0x40000000u);
  writeU32LE(bytes, 0);

  for (int band = 0; band < 4; ++band) {
    if (band >= bands.size()) continue;
    const auto &peaks = bands[band];
    if (peaks.isEmpty()) continue;

    QByteArray peakBytes;
    int lastFftPassNumber = 0;
    for (const auto &peak : peaks) {
      const int delta = peak.fftPassNumber - lastFftPassNumber;
      if (delta >= 255) {
        peakBytes.append(static_cast<char>(0xff));
        writeU32LE(peakBytes, static_cast<uint32_t>(peak.fftPassNumber));
        lastFftPassNumber = peak.fftPassNumber;
      }
      peakBytes.append(static_cast<char>(std::clamp(peak.fftPassNumber - lastFftPassNumber, 0, 254)));
      writeU16LE(peakBytes, peak.peakMagnitude);
      writeU16LE(peakBytes, peak.correctedPeakFrequencyBin);
      lastFftPassNumber = peak.fftPassNumber;
    }

    writeU32LE(bytes, 0x60030040u + band);
    writeU32LE(bytes, static_cast<uint32_t>(peakBytes.size()));
    bytes.append(peakBytes);
    while (bytes.size() % 4 != 0) {
      bytes.append(static_cast<char>(0));
    }
  }

  const uint32_t totalLength = static_cast<uint32_t>(bytes.size());
  const uint32_t payloadLength = (totalLength >= 48) ? (totalLength - 48) : 0;

  // Write payload length at offset 8 and 52
  auto *ptr = reinterpret_cast<uint8_t *>(bytes.data());
  ptr[8] = payloadLength & 0xff;
  ptr[9] = (payloadLength >> 8) & 0xff;
  ptr[10] = (payloadLength >> 16) & 0xff;
  ptr[11] = (payloadLength >> 24) & 0xff;

  if (bytes.size() >= 56) {
    ptr[52] = payloadLength & 0xff;
    ptr[53] = (payloadLength >> 8) & 0xff;
    ptr[54] = (payloadLength >> 16) & 0xff;
    ptr[55] = (payloadLength >> 24) & 0xff;
  }

  // Calculate CRC32 starting from offset 8
  const uint32_t crc = calculateCrc32(ptr + 8, totalLength - 8);
  ptr[4] = crc & 0xff;
  ptr[5] = (crc >> 8) & 0xff;
  ptr[6] = (crc >> 16) & 0xff;
  ptr[7] = (crc >> 24) & 0xff;

  return bytes;
}

FingerprintResult SongFingerprint::createSignatureFromSamples(const QVector<float> &samples) {
  FingerprintResult res;
  if (samples.size() < kSampleRate * 4) {
    res.success = false;
    res.pending = true;
    res.error = QStringLiteral("not-enough-audio");
    return res;
  }

  SignatureGenerator generator;
  const auto bands = generator.process(samples);

  int totalPeaks = 0;
  for (const auto &band : bands) totalPeaks += band.size();
  res.totalPeaks = totalPeaks;

  if (totalPeaks < 8) {
    res.success = false;
    res.error = QStringLiteral("not-enough-peaks");
    return res;
  }

  const QByteArray binary = encodeSignature(samples.size(), bands);
  res.success = true;
  res.uri = QString::fromLatin1(kDataUriPrefix) + QString::fromLatin1(binary.toBase64());
  res.sampleMs = static_cast<int>((static_cast<double>(samples.size()) / kSampleRate) * 1000.0);
  return res;
}
