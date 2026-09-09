#include "media_platform_registry.h"

#include <QReadWriteLock>
#include <QSet>

namespace {

QReadWriteLock s_lock;

QSet<QString> &customSupportedDomains() {
  static QSet<QString> domains;
  return domains;
}

QSet<QString> &customAdultDomains() {
  static QSet<QString> domains;
  return domains;
}

const QStringList &defaultSupportedDomainsList() {
  static const QStringList list = {
    // YouTube / YouTube Music
    QStringLiteral("youtube.com"),
    QStringLiteral("youtu.be"),
    QStringLiteral("youtube-nocookie.com"),

    // Meta (Facebook / Instagram)
    QStringLiteral("facebook.com"),
    QStringLiteral("fb.watch"),
    QStringLiteral("fb.com"),
    QStringLiteral("instagram.com"),
    QStringLiteral("instagr.am"),

    // Short-form & Social
    QStringLiteral("tiktok.com"),
    QStringLiteral("twitter.com"),
    QStringLiteral("x.com"),
    QStringLiteral("t.co"),
    QStringLiteral("reddit.com"),
    QStringLiteral("redd.it"),
    QStringLiteral("v.redd.it"),
    QStringLiteral("pinterest.com"),
    QStringLiteral("pin.it"),

    // Video Platforms
    QStringLiteral("vimeo.com"),
    QStringLiteral("dailymotion.com"),
    QStringLiteral("dai.ly"),
    QStringLiteral("twitch.tv"),
    QStringLiteral("bilibili.com"),
    QStringLiteral("bilibili.tv"),
    QStringLiteral("rumble.com"),
    QStringLiteral("odysee.com"),
    QStringLiteral("vk.com"),
    QStringLiteral("vkvideo.ru"),
    QStringLiteral("rutube.ru"),
    QStringLiteral("streamable.com"),
    QStringLiteral("loom.com"),
    QStringLiteral("ted.com"),
    QStringLiteral("peertube.tv"),
    QStringLiteral("kick.com"),

    // Audio & Music
    QStringLiteral("soundcloud.com"),
    QStringLiteral("spotify.com"),
    QStringLiteral("spotify.link"),
    QStringLiteral("deezer.com"),
    QStringLiteral("deezer.page.link"),
    QStringLiteral("bandcamp.com"),
    QStringLiteral("mixcloud.com"),
    QStringLiteral("audiomack.com"),
    QStringLiteral("archive.org")
  };
  return list;
}

const QStringList &defaultAdultDomainsList() {
  static const QStringList list = {
    QStringLiteral("pornhub.com"),
    QStringLiteral("phncdn.com"),
    QStringLiteral("xvideos.com"),
    QStringLiteral("xnxx.com"),
    QStringLiteral("xhamster.com"),
    QStringLiteral("redtube.com"),
    QStringLiteral("youporn.com"),
    QStringLiteral("tube8.com"),
    QStringLiteral("chaturbate.com"),
    QStringLiteral("onlyfans.com"),
    QStringLiteral("fansly.com"),
    QStringLiteral("stripchat.com"),
    QStringLiteral("cam4.com"),
    QStringLiteral("bongacams.com"),
    QStringLiteral("livejasmin.com"),
    QStringLiteral("spankbang.com"),
    QStringLiteral("eporner.com"),
    QStringLiteral("txxx.com"),
    QStringLiteral("hqporner.com"),
    QStringLiteral("porn.com"),
    QStringLiteral("beeg.com"),
    QStringLiteral("motherless.com"),
    QStringLiteral("heavy-r.com"),
    QStringLiteral("daftsex.com"),
    QStringLiteral("rule34.xxx"),
    QStringLiteral("gelbooru.com"),
    QStringLiteral("danbooru.donmai.us"),
    QStringLiteral("e-hentai.org"),
    QStringLiteral("nhentai.net"),
    QStringLiteral("hentaihaven.xxx"),
    QStringLiteral("hanime.tv"),
    QStringLiteral("xcafe.com"),
    QStringLiteral("brazzers.com"),
    QStringLiteral("camwhores.tv"),
    QStringLiteral("camsoda.com"),
    QStringLiteral("myfreecams.com"),
    QStringLiteral("porntrex.com")
  };
  return list;
}

}  // namespace

QString MediaPlatformRegistry::canonicalHost(const QUrl &url) {
  QString host = url.host().trimmed().toLower();
  while (host.endsWith(QLatin1Char('.'))) {
    host.chop(1);
  }
  return host;
}

bool MediaPlatformRegistry::matchesDomain(const QString &host, const QString &domain) {
  if (host.isEmpty() || domain.isEmpty()) return false;
  const QString cleanDomain = domain.trimmed().toLower();
  if (host == cleanDomain) return true;
  if (host.endsWith(QLatin1Char('.') + cleanDomain)) return true;
  return false;
}

bool MediaPlatformRegistry::isAdultPlatform(const QUrl &url) {
  const QString host = canonicalHost(url);
  if (host.isEmpty()) return false;

  for (const QString &domain : defaultAdultDomainsList()) {
    if (matchesDomain(host, domain)) return true;
  }

  QReadLocker locker(&s_lock);
  for (const QString &domain : customAdultDomains()) {
    if (matchesDomain(host, domain)) return true;
  }

  return false;
}

bool MediaPlatformRegistry::isSupportedMediaPlatform(const QUrl &url) {
  if (isAdultPlatform(url)) return false;

  const QString host = canonicalHost(url);
  if (host.isEmpty()) return false;

  for (const QString &domain : defaultSupportedDomainsList()) {
    if (matchesDomain(host, domain)) return true;
  }

  QReadLocker locker(&s_lock);
  for (const QString &domain : customSupportedDomains()) {
    if (matchesDomain(host, domain)) return true;
  }

  return false;
}

bool MediaPlatformRegistry::isDirectMediaUrl(const QUrl &url) {
  if (!url.isValid()) return false;
  const QString scheme = url.scheme().toLower();
  if (scheme != QLatin1String("http") && scheme != QLatin1String("https")) return false;

  const QString path = url.path().toLower();
  static const QSet<QString> mediaExtensions{
    // Video
    QStringLiteral("mp4"), QStringLiteral("m4v"), QStringLiteral("webm"), QStringLiteral("mkv"),
    QStringLiteral("flv"), QStringLiteral("avi"), QStringLiteral("mov"), QStringLiteral("wmv"),
    QStringLiteral("3gp"), QStringLiteral("ts"), QStringLiteral("ogv"),
    // Audio
    QStringLiteral("mp3"), QStringLiteral("m4a"), QStringLiteral("opus"), QStringLiteral("wav"),
    QStringLiteral("flac"), QStringLiteral("aac"), QStringLiteral("ogg"), QStringLiteral("wma"),
    QStringLiteral("alac"), QStringLiteral("weba"),
    // Streaming manifests
    QStringLiteral("m3u8"), QStringLiteral("mpd")
  };

  const int lastDot = path.lastIndexOf(QLatin1Char('.'));
  if (lastDot >= 0 && lastDot < path.length() - 1) {
    const QString ext = path.mid(lastDot + 1);
    if (mediaExtensions.contains(ext)) return true;
  }

  return false;
}

bool MediaPlatformRegistry::shouldAutoAnalyzeMedia(const QUrl &url, bool pageHasMedia) {
  if (!url.isValid() || url.isEmpty()) return false;
  const QString scheme = url.scheme().toLower();
  if (scheme != QLatin1String("http") && scheme != QLatin1String("https")) return false;

  // 1. Adult platforms denylist - never auto analyze
  if (isAdultPlatform(url)) return false;

  // 2. Supported media platforms - always auto analyze
  if (isSupportedMediaPlatform(url)) return true;

  // 3. Direct media files (mp4, mp3, etc.)
  if (isDirectMediaUrl(url)) return true;

  // 4. Unknown site: only if media was actively detected on page
  if (pageHasMedia) return true;

  return false;
}

void MediaPlatformRegistry::registerSupportedDomain(const QString &domain) {
  const QString clean = domain.trimmed().toLower();
  if (clean.isEmpty()) return;
  QWriteLocker locker(&s_lock);
  customSupportedDomains().insert(clean);
}

void MediaPlatformRegistry::registerAdultDomain(const QString &domain) {
  const QString clean = domain.trimmed().toLower();
  if (clean.isEmpty()) return;
  QWriteLocker locker(&s_lock);
  customAdultDomains().insert(clean);
}

QStringList MediaPlatformRegistry::supportedDomains() {
  QReadLocker locker(&s_lock);
  QStringList all = defaultSupportedDomainsList();
  for (const QString &d : customSupportedDomains()) {
    if (!all.contains(d)) all.append(d);
  }
  return all;
}

QStringList MediaPlatformRegistry::adultDomains() {
  QReadLocker locker(&s_lock);
  QStringList all = defaultAdultDomainsList();
  for (const QString &d : customAdultDomains()) {
    if (!all.contains(d)) all.append(d);
  }
  return all;
}
