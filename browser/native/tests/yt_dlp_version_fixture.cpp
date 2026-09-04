#include <chrono>
#include <iostream>
#include <string>
#include <thread>

#ifndef ARDALI_YTDLP_FIXTURE_VERSION
#define ARDALI_YTDLP_FIXTURE_VERSION "2099.01.01"
#endif

int main(int argc, char **argv) {
  for (int index = 1; index < argc; ++index) {
    const std::string argument(argv[index]);
    if (argument == "--version") {
      std::cout << ARDALI_YTDLP_FIXTURE_VERSION << '\n';
      return 0;
    }
    if (argument == "--hold") {
      std::this_thread::sleep_for(std::chrono::seconds(4));
      return 0;
    }
    if (argument == "--dump-single-json") {
      std::cout << R"({"id":"managed-fixture","title":"Managed Fixture","extractor_key":"Fixture","duration":3,"formats":[{"format_id":"v1","ext":"mp4","height":360,"fps":30,"vcodec":"h264","acodec":"aac","filesize":4096}]})" << '\n';
      return 0;
    }
  }
  std::cout << "ARDALI_PROGRESS:100%|4096|4096|4096|0\n"
            << "ARDALI_FILE:managed-fixture.mp4\n";
  return 0;
}

