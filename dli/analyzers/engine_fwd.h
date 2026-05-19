/* Engine abstraction for ArDali's Analyzer system
 * Adapted from ArDali for BASS audio engine
 */

#ifndef ANALYZERS_ENGINE_FWD_H_
#define ANALYZERS_ENGINE_FWD_H_

#include <cstdint>
#include <vector>

namespace Engine {

enum State {
  Empty,
  Idle,
  Playing,
  Paused,
};

typedef std::vector<int16_t> Scope;

}  // namespace Engine

#endif  // ANALYZERS_ENGINE_FWD_H_
