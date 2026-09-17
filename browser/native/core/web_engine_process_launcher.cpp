#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include <unistd.h>

namespace {

constexpr auto kRealProcessEnvironment = "ARDALI_REAL_QTWEBENGINEPROCESS_PATH";

}  // namespace

int main(int argc, char *argv[]) {
  const char *configuredPath = std::getenv(kRealProcessEnvironment);
  if (configuredPath == nullptr || configuredPath[0] != '/') {
    std::fputs("ArDali: invalid QtWebEngineProcess path\n", stderr);
    return 127;
  }
  const std::string realProcessPath(configuredPath);
  if (access(realProcessPath.c_str(), X_OK) != 0) {
    std::fprintf(stderr, "ArDali: QtWebEngineProcess is not executable: %s\n", std::strerror(errno));
    return 127;
  }

  // This process becomes the QtWebEngine subprocess/zygote. Renderers inherit
  // the policy from the zygote; the browser process remains unrestricted.
  if (setenv("MALLOC_ARENA_MAX", "2", 1) != 0
      || setenv("MALLOC_TRIM_THRESHOLD_", "131072", 1) != 0) {
    std::fprintf(stderr, "ArDali: failed to apply child allocator policy: %s\n", std::strerror(errno));
    return 127;
  }
  unsetenv(kRealProcessEnvironment);
  unsetenv("QTWEBENGINEPROCESS_PATH");

  std::vector<char *> childArguments;
  childArguments.reserve(static_cast<size_t>(argc) + 1);
  childArguments.push_back(const_cast<char *>(realProcessPath.c_str()));
  for (int index = 1; index < argc; ++index) childArguments.push_back(argv[index]);
  childArguments.push_back(nullptr);

  execv(realProcessPath.c_str(), childArguments.data());
  std::fprintf(stderr, "ArDali: failed to launch QtWebEngineProcess: %s\n", std::strerror(errno));
  return 127;
}
