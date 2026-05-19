/* Engine Base for ArDali's Analyzer system
 * Provides audio scope data for visualizations
 * Adapted from ArDali for BASS audio engine
 */

#include "enginebase.h"
#include <algorithm>
#include <cstring>

EngineBase::EngineBase(QObject* parent)
    : QObject(parent),
      state_(Engine::Empty),
      buffer_(kBufferSize * 2, 0),
      buffer_pos_(0) {
  scope_.resize(kScopeSize * 2);
}

EngineBase::~EngineBase() {}

const Engine::Scope& EngineBase::scope(int chunk_length) {
  QMutexLocker locker(&buffer_mutex_);
  
  // Copy buffer to scope
  int samples_to_copy = std::min(static_cast<int>(scope_.size()), 
                                  static_cast<int>(buffer_.size()));
  
  // Rotate buffer - put newest samples at front
  int start_pos = buffer_pos_ >= samples_to_copy ? 
                  buffer_pos_ - samples_to_copy : 
                  buffer_.size() + buffer_pos_ - samples_to_copy;
  
  for (int i = 0; i < samples_to_copy; ++i) {
    int idx = (start_pos + i) % buffer_.size();
    scope_[i] = buffer_[idx];
  }
  
  return scope_;
}

void EngineBase::pushSamples(const float* samples, int frameCount, int channels) {
  QMutexLocker locker(&buffer_mutex_);
  
  // Convert float samples to int16 and store in buffer
  for (int i = 0; i < frameCount; ++i) {
    for (int ch = 0; ch < channels && ch < 2; ++ch) {
      float sample = samples[i * channels + ch];
      // Clamp to [-1, 1]
      sample = std::max(-1.0f, std::min(1.0f, sample));
      // Convert to int16
      int16_t val = static_cast<int16_t>(sample * 32767.0f);
      
      buffer_[buffer_pos_] = val;
      buffer_pos_ = (buffer_pos_ + 1) % buffer_.size();
    }
  }
}
