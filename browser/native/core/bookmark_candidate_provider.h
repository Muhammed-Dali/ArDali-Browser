#pragma once

#include <QHash>
#include <QObject>
#include <QPointer>
#include <QString>
#include <QUrl>
#include <QVector>

#include "address_input_resolver.h"
#include "browser_profile_data_provider.h"
#include "navigation_candidate.h"

namespace ardali::core {

class BookmarkCandidateProvider : public QObject, public INavigationCandidateProvider {
  Q_OBJECT
 public:
  explicit BookmarkCandidateProvider(
      IBrowserProfileDataProvider *dataProvider = nullptr,
      QObject *signalSource = nullptr,
      QObject *parent = nullptr);
  ~BookmarkCandidateProvider() override = default;

  std::optional<QUrl> findNavigationCandidate(
      const QString &normalizedToken,
      const QLocale &locale) const override;

  QVector<NavigationCandidate> findCandidates(
      const QString &normalizedToken,
      const QLocale &locale) const override;

  // Manual injection for test isolation
  void addBookmark(const QUrl &url, const QString &title = QString{});
  void clearBookmarks();

 public slots:
  void markDirty();

 private:
  struct BookmarkItem {
    QUrl originalUrl;
    QUrl canonicalRootUrl;
    QString displayHost;
    QString primaryDomainToken;
    QStringList subdomainTokens;
    QString title;
  };

  void ensureIndexBuilt() const;

  IBrowserProfileDataProvider *dataProvider_ = nullptr;
  QPointer<QObject> signalSource_;
  mutable bool dirty_ = true;
  mutable bool useManualBookmarks_ = false;
  mutable QVector<BookmarkItem> manualBookmarks_;
  mutable QVector<BookmarkItem> indexedBookmarks_;
};

}  // namespace ardali::core
