#include "history_candidate_provider.h"

#include <algorithm>

#include "domain_normalizer.h"

namespace ardali::core {

HistoryCandidateProvider::HistoryCandidateProvider(
    IBrowserProfileDataProvider *dataProvider,
    QObject *signalSource,
    QObject *parent)
    : QObject(parent), dataProvider_(dataProvider), signalSource_(signalSource) {
  if (signalSource_) {
    connect(signalSource_, SIGNAL(historyChanged()), this, SLOT(markDirty()));
  }
}

void HistoryCandidateProvider::markDirty() {
  dirty_ = true;
}

void HistoryCandidateProvider::addHistoryEntry(const QUrl &url, const QString &title, const QDateTime &visitedAt, int visitCount, int typedCount) {
  useManualEntries_ = true;
  const QUrl canonical = DomainNormalizer::canonicalRootUrl(url);
  const ExtractedHostTokens tokens = DomainNormalizer::extractTokens(canonical.host());
  if (!tokens.isValid) return;

  IndexedHistoryItem item;
  item.canonicalUrl = canonical;
  item.displayHost = tokens.canonicalHost;
  item.primaryDomainToken = tokens.primaryDomainToken;
  item.subdomainTokens = tokens.subdomainTokens;
  item.title = title;
  item.visitCount = std::max(1, visitCount);
  item.typedCount = std::max(0, typedCount);
  item.lastVisited = visitedAt;

  manualEntries_.append(item);
  dirty_ = true;
}

void HistoryCandidateProvider::clearEntries() {
  manualEntries_.clear();
  tokenIndex_.clear();
  useManualEntries_ = false;
  dirty_ = true;
}

void HistoryCandidateProvider::ensureIndexBuilt() const {
  if (!dirty_) return;
  tokenIndex_.clear();

  if (useManualEntries_) {
    // Group manual entries by canonical host
    QHash<QString, IndexedHistoryItem> aggregated;
    for (const auto &item : manualEntries_) {
      const QString host = item.displayHost;
      if (aggregated.contains(host)) {
        auto &existing = aggregated[host];
        existing.visitCount += item.visitCount;
        existing.typedCount += item.typedCount;
        if (item.lastVisited > existing.lastVisited) {
          existing.lastVisited = item.lastVisited;
        }
      } else {
        aggregated.insert(host, item);
      }
    }

    for (const auto &item : aggregated) {
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
    // 1. Collect frequent sites for visit count & last visit
    QHash<QString, BrowserFrequentSite> frequentMap;
    for (const auto &site : dataProvider_->frequentSites(100)) {
      const QString host = DomainNormalizer::normalizeHost(site.url.host());
      if (!host.isEmpty()) {
        frequentMap.insert(host, site);
      }
    }

    // 2. Aggregate recent history
    QHash<QString, IndexedHistoryItem> aggregated;
    for (const auto &entry : dataProvider_->recentHistory()) {
      const QUrl canonical = DomainNormalizer::canonicalRootUrl(entry.url);
      const ExtractedHostTokens tokens = DomainNormalizer::extractTokens(canonical.host());
      if (!tokens.isValid) continue;

      const QString host = tokens.canonicalHost;
      if (aggregated.contains(host)) {
        auto &existing = aggregated[host];
        existing.visitCount += 1;
        if (entry.visitedAt > existing.lastVisited) {
          existing.lastVisited = entry.visitedAt;
        }
      } else {
        IndexedHistoryItem item;
        item.canonicalUrl = canonical;
        item.displayHost = host;
        item.primaryDomainToken = tokens.primaryDomainToken;
        item.subdomainTokens = tokens.subdomainTokens;
        item.title = entry.title;
        item.visitCount = 1;
        item.lastVisited = entry.visitedAt;
        aggregated.insert(host, item);
      }
    }

    // Overlay authoritative visit counts from frequentMap where available
    for (auto it = aggregated.begin(); it != aggregated.end(); ++it) {
      if (frequentMap.contains(it.key())) {
        const auto &freq = frequentMap.value(it.key());
        it->visitCount = std::max(it->visitCount, freq.visitCount);
        it->typedCount = std::max(it->typedCount, freq.typedCount);
        if (freq.lastVisitedAt > it->lastVisited) {
          it->lastVisited = freq.lastVisitedAt;
        }
      }
    }

    for (const auto &item : aggregated) {
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

QVector<NavigationCandidate> HistoryCandidateProvider::findCandidates(
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
    c.source = QStringLiteral("history");
    c.visitCount = item.visitCount;
    c.typedCount = item.typedCount;
    c.hasTypedEvidence = (item.typedCount > 0);
    c.lastVisited = item.lastVisited;
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

std::optional<QUrl> HistoryCandidateProvider::findNavigationCandidate(
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
