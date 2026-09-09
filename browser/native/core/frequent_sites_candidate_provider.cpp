#include "frequent_sites_candidate_provider.h"

#include <algorithm>

#include "domain_normalizer.h"

namespace ardali::core {

FrequentSitesCandidateProvider::FrequentSitesCandidateProvider(
    IBrowserProfileDataProvider *dataProvider,
    QObject *signalSource,
    QObject *parent)
    : QObject(parent), dataProvider_(dataProvider), signalSource_(signalSource) {
  if (signalSource_) {
    connect(signalSource_, SIGNAL(historyChanged()), this, SLOT(markDirty()));
  }
}

void FrequentSitesCandidateProvider::markDirty() {
  dirty_ = true;
}

void FrequentSitesCandidateProvider::addFrequentSite(const QUrl &url, const QString &title, int visitCount, const QDateTime &lastVisited, int typedCount) {
  useManualSites_ = true;
  const QUrl canonical = DomainNormalizer::canonicalRootUrl(url);
  const ExtractedHostTokens tokens = DomainNormalizer::extractTokens(canonical.host());
  if (!tokens.isValid) return;

  IndexedFrequentItem item;
  item.canonicalUrl = canonical;
  item.displayHost = tokens.canonicalHost;
  item.primaryDomainToken = tokens.primaryDomainToken;
  item.subdomainTokens = tokens.subdomainTokens;
  item.title = title;
  item.visitCount = std::max(1, visitCount);
  item.typedCount = std::max(0, typedCount);
  item.lastVisited = lastVisited;

  manualSites_.append(item);
  dirty_ = true;
}

void FrequentSitesCandidateProvider::clearFrequentSites() {
  manualSites_.clear();
  tokenIndex_.clear();
  useManualSites_ = false;
  dirty_ = true;
}

void FrequentSitesCandidateProvider::ensureIndexBuilt() const {
  if (!dirty_) return;
  tokenIndex_.clear();

  if (useManualSites_) {
    for (const auto &item : manualSites_) {
      if (!item.primaryDomainToken.isEmpty()) {
        tokenIndex_[item.primaryDomainToken].append(item);
      }
      for (const QString &sub : item.subdomainTokens) {
        if (!sub.isEmpty() && sub != item.primaryDomainToken) {
          tokenIndex_[sub].append(item);
        }
      }
    }
    dirty_ = false;
    return;
  }

  if (dataProvider_) {
    const auto list = dataProvider_->frequentSites(100);
    for (const auto &site : list) {
      const QUrl canonical = DomainNormalizer::canonicalRootUrl(site.url);
      const ExtractedHostTokens tokens = DomainNormalizer::extractTokens(canonical.host());
      if (!tokens.isValid) continue;

      IndexedFrequentItem item;
      item.canonicalUrl = canonical;
      item.displayHost = tokens.canonicalHost;
      item.primaryDomainToken = tokens.primaryDomainToken;
      item.subdomainTokens = tokens.subdomainTokens;
      item.title = site.title;
      item.visitCount = site.visitCount;
      item.typedCount = site.typedCount;
      item.lastVisited = site.lastVisitedAt;

      if (!item.primaryDomainToken.isEmpty()) {
        tokenIndex_[item.primaryDomainToken].append(item);
      }
      for (const QString &sub : item.subdomainTokens) {
        if (!sub.isEmpty() && sub != item.primaryDomainToken) {
          tokenIndex_[sub].append(item);
        }
      }
    }
  }

  dirty_ = false;
}

QVector<NavigationCandidate> FrequentSitesCandidateProvider::findCandidates(
    const QString &normalizedToken,
    const QLocale &locale) const {
  Q_UNUSED(locale);
  const QString token = normalizedToken.trimmed().toLower();
  if (token.isEmpty()) return {};

  ensureIndexBuilt();

  const auto items = tokenIndex_.value(token);
  if (items.isEmpty()) return {};

  QVector<NavigationCandidate> candidates;
  candidates.reserve(items.size());

  for (const auto &item : items) {
    NavigationCandidate c;
    c.url = item.canonicalUrl;
    c.displayHost = item.displayHost;
    c.source = QStringLiteral("frequent");
    c.visitCount = item.visitCount;
    c.typedCount = item.typedCount;
    c.hasTypedEvidence = (item.typedCount > 0);
    c.lastVisited = item.lastVisited;
    c.isFrequentSite = true;
    c.isRootCanonical = true;
    c.hasExactTokenMatch = true;
    c.isExactDomainMatch = (token == item.primaryDomainToken);
    c.isExactSubdomainMatch = !c.isExactDomainMatch;
    c.score = CandidateScoringConfig::calculateScore(c);
    c.confidence = CandidateScoringConfig::calculateConfidence(c);
    candidates.append(c);
  }

  std::sort(candidates.begin(), candidates.end(), [](const NavigationCandidate &a, const NavigationCandidate &b) {
    if (a.score != b.score) return a.score > b.score;
    if (a.visitCount != b.visitCount) return a.visitCount > b.visitCount;
    return a.lastVisited > b.lastVisited;
  });

  return candidates;
}

std::optional<QUrl> FrequentSitesCandidateProvider::findNavigationCandidate(
    const QString &normalizedToken,
    const QLocale &locale) const {
  const auto candidates = findCandidates(normalizedToken, locale);
  if (candidates.isEmpty()) return std::nullopt;

  const auto &top = candidates.first();
  if (top.confidence >= CandidateScoringConfig::kMinConfidenceThreshold) {
    return top.url;
  }
  return std::nullopt;
}

}  // namespace ardali::core
