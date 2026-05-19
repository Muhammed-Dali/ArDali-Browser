/* Engine Base for ArDali's Analyzer system
 * Provides audio scope data for visualizations
 * Adapted from ArDali for BASS audio engine
 */

#ifndef ANALYZERS_ENGINEBASE_H_
#define ANALYZERS_ENGINEBASE_H_

#include <QObject>
#include <QMutex>
#include <vector>
#include "engine_fwd.h"

class EngineBase : public QObject {
  Q_OBJECT

 public:
  static const int kScopeSize = 1024;

  explicit EngineBase(QObject* parent = nullptr);
  virtual ~EngineBase();

  Engine::State state() const { return state_; }
  void setState(Engine::State s) { state_ = s; }

  // Returns scope data for visualization
  const Engine::Scope& scope(int chunk_length);
  
  // Push audio samples from DSP callback
  void pushSamples(const float* samples, int frameCount, int channels);

 private:
  Engine::State state_;
  Engine::Scope scope_;
  
  // Raw audio buffer
  static constexpr int kBufferSize = 4096;
  std::vector<int16_t> buffer_;
  int buffer_pos_;
  QMutex buffer_mutex_;
};

#endif  // ANALYZERS_ENGINEBASE_H_
