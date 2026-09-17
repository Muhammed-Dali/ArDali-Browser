#pragma once

#include <QDateTime>
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

class FrequentSitesCandidateProvider : public QObject, public INavigationCandidateProvider {
  Q_OBJECT
 public:
  explicit FrequentSitesCandidateProvider(
      IBrowserProfileDataProvider *dataProvider = nullptr,
      QObject *signalSource = nullptr,
      QObject *parent = nullptr);
  ~FrequentSitesCandidateProvider() override = default;

  std::optional<QUrl> findNavigationCandidate(
      const QString &normalizedToken,
      const QLocale &locale) const override;

  QVector<NavigationCandidate> findCandidates(
      const QString &normalizedToken,
      const QLocale &locale) const override;

  // In-memory test injection
  void addFrequentSite(const QUrl &url, const QString &title = QString{}, int visitCount = 1, const QDateTime &lastVisited = QDateTime::currentDateTimeUtc(), int typedCount = 0);
  void clearFrequentSites();

 public slots:
  void markDirty();

 private:
  struct IndexedFrequentItem {
    QUrl canonicalUrl;
    QString displayHost;
    QString primaryDomainToken;
    QStringList subdomainTokens;
    QString title;
    int visitCount = 0;
    int typedCount = 0;
    QDateTime lastVisited;
  };

  void ensureIndexBuilt() const;

  IBrowserProfileDataProvider *dataProvider_ = nullptr;
  QPointer<QObject> signalSource_;
  mutable bool dirty_ = true;
  mutable bool useManualSites_ = false;
  mutable QVector<IndexedFrequentItem> manualSites_;
  mutable QHash<QString, QVector<IndexedFrequentItem>> tokenIndex_;
};

}  // namespace ardali::core
