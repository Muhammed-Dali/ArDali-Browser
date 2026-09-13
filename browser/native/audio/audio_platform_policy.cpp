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
  if (qEnvironmentVariableIntValue("ARDALI_ALLOW_LOCAL_AUDIO_TEST") == 1) {
    static const QStringList testDomains = [] {
      QStringList list = domains;
      list.append(QStringLiteral("127.0.0.1"));
      list.append(QStringLiteral("localhost"));
      return list;
    }();
    return testDomains;
  }
  return domains;
}

bool isSupportedAudioPlatform(const QUrl &url) {
  if (!url.isValid()) return false;
  const QString scheme = url.scheme().toLower();
  if (scheme != QLatin1String("http") && scheme != QLatin1String("https")) return false;

  const QString host = url.host().toLower();
  if (host.isEmpty()) return false;
  if (qEnvironmentVariableIntValue("ARDALI_ALLOW_LOCAL_AUDIO_TEST") == 1
      && (host == QLatin1String("127.0.0.1") || host == QLatin1String("localhost"))) {
    return true;
  }
  for (const QString &domain : supportedAudioPlatformDomains()) {
    if (host == domain || host.endsWith(QLatin1Char('.') + domain)) return true;
  }
  return false;
}

}  // namespace ardali::audio
