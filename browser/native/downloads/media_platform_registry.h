#pragma once

#include <QString>
#include <QStringList>
#include <QUrl>

class MediaPlatformRegistry {
 public:
  // Returns true if the host belongs to a supported video/audio media platform
  static bool isSupportedMediaPlatform(const QUrl &url);

  // Returns true if the host belongs to an adult content platform denylist
  static bool isAdultPlatform(const QUrl &url);

  // Returns true if the URL points directly to a known audio/video file or streaming manifest (.mp4, .mp3, .m3u8, etc.)
  static bool isDirectMediaUrl(const QUrl &url);

  // Central decision whether the URL should be automatically forwarded to media analysis
  // Returns true for supported media platforms, direct media files, or unknown sites that actively have media
  // Returns false for adult platforms and normal web sites
  static bool shouldAutoAnalyzeMedia(const QUrl &url, bool pageHasMedia = false);

  // Helper to extract clean canonical host (lowercase, port stripped, trailing dot removed, trimmed)
  static QString canonicalHost(const QUrl &url);

  // Secure domain match: exact match OR proper subdomain suffix (.domain)
  // Ensures "youtube.com.attacker.com" does NOT match "youtube.com"
  static bool matchesDomain(const QString &host, const QString &domain);

  // Extensibility API
  static void registerSupportedDomain(const QString &domain);
  static void registerAdultDomain(const QString &domain);
  static QStringList supportedDomains();
  static QStringList adultDomains();
};
