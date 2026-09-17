#include "media_platform_registry.h"

#include <cassert>
#include <iostream>

int main() {
  // 1. Supported Media Platforms: YouTube variants
  assert(MediaPlatformRegistry::isSupportedMediaPlatform(QUrl(QStringLiteral("https://www.youtube.com/watch?v=dQw4w9WgXcQ"))));
  assert(MediaPlatformRegistry::isSupportedMediaPlatform(QUrl(QStringLiteral("https://m.youtube.com/watch?v=123"))));
  assert(MediaPlatformRegistry::isSupportedMediaPlatform(QUrl(QStringLiteral("https://music.youtube.com/watch?v=abc"))));
  assert(MediaPlatformRegistry::isSupportedMediaPlatform(QUrl(QStringLiteral("https://youtu.be/dQw4w9WgXcQ"))));
  assert(MediaPlatformRegistry::isSupportedMediaPlatform(QUrl(QStringLiteral("https://www.youtube-nocookie.com/embed/123"))));

  // 2. Supported Media Platforms: Social & Video/Audio platforms
  assert(MediaPlatformRegistry::isSupportedMediaPlatform(QUrl(QStringLiteral("https://www.tiktok.com/@user/video/12345"))));
  assert(MediaPlatformRegistry::isSupportedMediaPlatform(QUrl(QStringLiteral("https://m.tiktok.com/v/123.html"))));
  assert(MediaPlatformRegistry::isSupportedMediaPlatform(QUrl(QStringLiteral("https://www.instagram.com/reel/C8xyz/"))));
  assert(MediaPlatformRegistry::isSupportedMediaPlatform(QUrl(QStringLiteral("https://facebook.com/watch?v=999"))));
  assert(MediaPlatformRegistry::isSupportedMediaPlatform(QUrl(QStringLiteral("https://fb.watch/xyz/"))));
  assert(MediaPlatformRegistry::isSupportedMediaPlatform(QUrl(QStringLiteral("https://vimeo.com/12345678"))));
  assert(MediaPlatformRegistry::isSupportedMediaPlatform(QUrl(QStringLiteral("https://www.twitch.tv/videos/123"))));
  assert(MediaPlatformRegistry::isSupportedMediaPlatform(QUrl(QStringLiteral("https://soundcloud.com/artist/track"))));
  assert(MediaPlatformRegistry::isSupportedMediaPlatform(QUrl(QStringLiteral("https://dailymotion.com/video/x123"))));
  assert(MediaPlatformRegistry::isSupportedMediaPlatform(QUrl(QStringLiteral("https://twitter.com/user/status/123"))));
  assert(MediaPlatformRegistry::isSupportedMediaPlatform(QUrl(QStringLiteral("https://x.com/user/status/456"))));
  assert(MediaPlatformRegistry::isSupportedMediaPlatform(QUrl(QStringLiteral("https://reddit.com/r/videos/comments/xyz"))));
  assert(MediaPlatformRegistry::isSupportedMediaPlatform(QUrl(QStringLiteral("https://v.redd.it/xyz123"))));
  assert(MediaPlatformRegistry::isSupportedMediaPlatform(QUrl(QStringLiteral("https://open.spotify.com/track/123"))));
  assert(MediaPlatformRegistry::isSupportedMediaPlatform(QUrl(QStringLiteral("https://deezer.com/track/123"))));
  assert(MediaPlatformRegistry::isSupportedMediaPlatform(QUrl(QStringLiteral("https://bandcamp.com/album/xyz"))));

  // 3. Normal websites - MUST NOT be treated as media platforms
  assert(!MediaPlatformRegistry::isSupportedMediaPlatform(QUrl(QStringLiteral("https://www.microsoft.com/tr-tr/software-download/windows11"))));
  assert(!MediaPlatformRegistry::isSupportedMediaPlatform(QUrl(QStringLiteral("https://en.wikipedia.org/wiki/Computer"))));
  assert(!MediaPlatformRegistry::isSupportedMediaPlatform(QUrl(QStringLiteral("https://github.com/torvalds/linux"))));
  assert(!MediaPlatformRegistry::isSupportedMediaPlatform(QUrl(QStringLiteral("https://google.com"))));

  // 4. Spoofed/fake domains - MUST NOT match real media platforms
  assert(!MediaPlatformRegistry::isSupportedMediaPlatform(QUrl(QStringLiteral("https://youtube.com.attacker.com/watch?v=123"))));
  assert(!MediaPlatformRegistry::isSupportedMediaPlatform(QUrl(QStringLiteral("https://notyoutube.com/video"))));
  assert(!MediaPlatformRegistry::isSupportedMediaPlatform(QUrl(QStringLiteral("https://fake-tiktok.com/clip"))));
  assert(!MediaPlatformRegistry::isSupportedMediaPlatform(QUrl(QStringLiteral("https://tiktok.com.phishing.org/watch"))));

  // 5. Adult denylist platforms
  assert(MediaPlatformRegistry::isAdultPlatform(QUrl(QStringLiteral("https://www.pornhub.com/view_video.php?viewkey=123"))));
  assert(MediaPlatformRegistry::isAdultPlatform(QUrl(QStringLiteral("https://xvideos.com/video123"))));
  assert(MediaPlatformRegistry::isAdultPlatform(QUrl(QStringLiteral("https://chaturbate.com/room1"))));
  assert(MediaPlatformRegistry::isAdultPlatform(QUrl(QStringLiteral("https://onlyfans.com/user"))));
  assert(!MediaPlatformRegistry::isAdultPlatform(QUrl(QStringLiteral("https://youtube.com"))));
  assert(!MediaPlatformRegistry::isAdultPlatform(QUrl(QStringLiteral("https://microsoft.com"))));

  // Adult platforms MUST be rejected from shouldAutoAnalyzeMedia
  assert(!MediaPlatformRegistry::shouldAutoAnalyzeMedia(QUrl(QStringLiteral("https://pornhub.com/video")), true));
  assert(!MediaPlatformRegistry::shouldAutoAnalyzeMedia(QUrl(QStringLiteral("https://xvideos.com/video")), false));

  // 6. Direct media URLs
  assert(MediaPlatformRegistry::isDirectMediaUrl(QUrl(QStringLiteral("https://example.com/video.mp4"))));
  assert(MediaPlatformRegistry::isDirectMediaUrl(QUrl(QStringLiteral("https://example.com/audio.mp3"))));
  assert(MediaPlatformRegistry::isDirectMediaUrl(QUrl(QStringLiteral("https://example.com/stream.m3u8"))));
  assert(!MediaPlatformRegistry::isDirectMediaUrl(QUrl(QStringLiteral("https://example.com/file.iso"))));
  assert(!MediaPlatformRegistry::isDirectMediaUrl(QUrl(QStringLiteral("https://example.com/file.zip"))));
  assert(!MediaPlatformRegistry::isDirectMediaUrl(QUrl(QStringLiteral("https://example.com/doc.pdf"))));

  // 7. shouldAutoAnalyzeMedia Central Decision
  // Supported media platforms: always true
  assert(MediaPlatformRegistry::shouldAutoAnalyzeMedia(QUrl(QStringLiteral("https://www.youtube.com/watch?v=123")), false));
  assert(MediaPlatformRegistry::shouldAutoAnalyzeMedia(QUrl(QStringLiteral("https://tiktok.com/@user/123")), false));
  // Normal sites: false
  assert(!MediaPlatformRegistry::shouldAutoAnalyzeMedia(QUrl(QStringLiteral("https://www.microsoft.com/tr-tr/software-download/windows11")), false));
  assert(!MediaPlatformRegistry::shouldAutoAnalyzeMedia(QUrl(QStringLiteral("https://en.wikipedia.org/wiki/Main_Page")), false));
  // Direct media files: true
  assert(MediaPlatformRegistry::shouldAutoAnalyzeMedia(QUrl(QStringLiteral("https://example.com/clip.webm")), false));
  // Unknown site with active media playing: true
  assert(MediaPlatformRegistry::shouldAutoAnalyzeMedia(QUrl(QStringLiteral("https://independent-podcast.org/listen")), true));
  // Unknown site without media playing: false
  assert(!MediaPlatformRegistry::shouldAutoAnalyzeMedia(QUrl(QStringLiteral("https://independent-podcast.org/listen")), false));

  // 8. Extensibility
  MediaPlatformRegistry::registerSupportedDomain(QStringLiteral("mycustomvideo.org"));
  assert(MediaPlatformRegistry::isSupportedMediaPlatform(QUrl(QStringLiteral("https://cdn.mycustomvideo.org/v/1"))));
  MediaPlatformRegistry::registerAdultDomain(QStringLiteral("customadultsite.xyz"));
  assert(MediaPlatformRegistry::isAdultPlatform(QUrl(QStringLiteral("https://customadultsite.xyz/watch"))));
  assert(!MediaPlatformRegistry::shouldAutoAnalyzeMedia(QUrl(QStringLiteral("https://customadultsite.xyz/watch")), true));

  std::cout << "media_platform_registry_test: all assertions passed successfully!\n";
  return 0;
}
