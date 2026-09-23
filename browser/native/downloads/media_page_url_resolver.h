#pragma once

#include <QString>
#include <QUrl>
#include <QVariant>

class MediaPageUrlResolver {
 public:
  // Runs in the page's isolated application world and returns the permalink
  // associated with the most visible video element. A direct HTTP(S) media
  // source is used only when no post permalink can be found.
  static QString extractionScript();

  // Treat page-provided values as untrusted. Invalid/non-web results fall back
  // to the address-bar URL instead of reaching yt-dlp.
  static QUrl validatedResult(const QVariant &scriptResult, const QUrl &fallbackUrl);
};
