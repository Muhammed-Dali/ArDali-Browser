#pragma once

#include <QHash>
#include <QObject>
#include <QString>
#include <QUrl>
#include <QVector>
#include <memory>

#include "address_input_resolver.h"
#include "navigation_candidate.h"

namespace ardali::core {

class CompositeNavigationCandidateProvider : public QObject, public INavigationCandidateProvider {
  Q_OBJECT
 public:
  explicit CompositeNavigationCandidateProvider(QObject *parent = nullptr);
  ~CompositeNavigationCandidateProvider() override = default;

  void addProvider(std::shared_ptr<INavigationCandidateProvider> provider);

  std::optional<QUrl> findNavigationCandidate(
      const QString &normalizedToken,
      const QLocale &locale) const override;

  QVector<NavigationCandidate> findCandidates(
      const QString &normalizedToken,
      const QLocale &locale) const override;

 private:
  QVector<std::shared_ptr<INavigationCandidateProvider>> providers_;
};

}  // namespace ardali::core
