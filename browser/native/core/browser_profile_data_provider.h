#pragma once

#include <QDateTime>
#include <QList>
#include <QString>
#include <QtGlobal>
#include <QUrl>

#ifndef BROWSER_HISTORY_ENTRY_DEFINED
#define BROWSER_HISTORY_ENTRY_DEFINED
struct BrowserHistoryEntry {
  QString title;
  QUrl url;
  QDateTime visitedAt;
};

struct BrowserFrequentSite {
  QString title;
  QUrl url;
  QUrl iconLookupUrl;
  int visitCount = 0;
  int typedCount = 0;
  QDateTime lastVisitedAt;
};
#endif

namespace ardali::core {

class IBrowserProfileDataProvider {
 public:
  virtual ~IBrowserProfileDataProvider() = default;
  virtual QList<BrowserHistoryEntry> recentHistory() const = 0;
  virtual QList<BrowserFrequentSite> frequentSites(int limit = 6) const = 0;
  virtual QList<QUrl> bookmarks() const = 0;
  virtual QString searchEngine() const { return QStringLiteral("DuckDuckGo"); }
  virtual quint64 totalBlockedCount() const { return 0; }
};

}  // namespace ardali::core
