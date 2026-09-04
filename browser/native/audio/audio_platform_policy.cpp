#include "audio_platform_policy.h"

namespace ardali::audio {

const QStringList &supportedAudioPlatformDomains() {
  static const QStringList domains{
      QStringLiteral("youtube.com"),
      QStringLiteral("youtu.be"),
      QStringLiteral("reddit.com"),
      QStringLiteral("x.com"),
      QStringLiteral("twitter.com"),
      QStringLiteral("facebook.com"),
      QStringLiteral("instagram.com"),
      QStringLiteral("tiktok.com"),
  };
  return domains;
}

bool isSupportedAudioPlatform(const QUrl &url) {
  if (!url.isValid()) return false;
  const QString scheme = url.scheme().toLower();
  if (scheme != QLatin1String("http") && scheme != QLatin1String("https")) return false;

  const QString host = url.host().toLower();
  if (host.isEmpty()) return false;
  for (const QString &domain : supportedAudioPlatformDomains()) {
    if (host == domain || host.endsWith(QLatin1Char('.') + domain)) return true;
  }
  return false;
}

}  // namespace ardali::audio
