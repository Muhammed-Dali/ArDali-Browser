#pragma once

#include <QUrl>
#include <QString>

namespace ardali {

inline bool isNewTabUrl(const QUrl &url) {
  const QString scheme = url.scheme().toLower();
  const QString host = url.host().toLower();
  return scheme == QLatin1String("ardali") &&
      (host == QLatin1String("newtab") || host == QLatin1String("incognito")) &&
      (url.path().isEmpty() || url.path() == QLatin1String("/")) &&
      !url.hasQuery() && !url.hasFragment() && url.userInfo().isEmpty() && url.port() == -1;
}

} // namespace ardali

using ardali::isNewTabUrl;
