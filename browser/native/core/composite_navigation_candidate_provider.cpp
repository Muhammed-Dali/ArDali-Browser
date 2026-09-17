#include "composite_navigation_candidate_provider.h"

#include <algorithm>

namespace ardali::core {

CompositeNavigationCandidateProvider::CompositeNavigationCandidateProvider(QObject *parent)
    : QObject(parent) {}

void CompositeNavigationCandidateProvider::addProvider(std::shared_ptr<INavigationCandidateProvider> provider) {
  if (provider) {
    providers_.append(std::move(provider));
  }
}

QVector<NavigationCandidate> CompositeNavigationCandidateProvider::findCandidates(
    const QString &normalizedToken,
    const QLocale &locale) const {
  const QString token = normalizedToken.trimmed().toLower();
  if (token.isEmpty()) return {};

  QHash<QString, NavigationCandidate> mergedMap;

  for (const auto &provider : providers_) {
    if (!provider) continue;
    const auto candidates = provider->findCandidates(token, locale);
    for (const auto &c : candidates) {
      const QString hostKey = c.displayHost.trimmed().toLower();
      if (hostKey.isEmpty()) continue;

      if (!mergedMap.contains(hostKey)) {
        mergedMap.insert(hostKey, c);
      } else {
        auto &m = mergedMap[hostKey];
        // Merge signals
        m.isBookmark = m.isBookmark || c.isBookmark;
        m.isFrequentSite = m.isFrequentSite || c.isFrequentSite;
        m.hasExactTokenMatch = m.hasExactTokenMatch || c.hasExactTokenMatch;
        m.isExactDomainMatch = m.isExactDomainMatch || c.isExactDomainMatch;
        m.isExactSubdomainMatch = m.isExactSubdomainMatch || c.isExactSubdomainMatch;
        m.visitCount = std::max(m.visitCount, c.visitCount);
        m.typedCount = std::max(m.typedCount, c.typedCount);
        m.hasTypedEvidence = m.hasTypedEvidence || c.hasTypedEvidence;
        if (c.lastVisited > m.lastVisited) {
          m.lastVisited = c.lastVisited;
        }

        // Bookmark title match takes precedence over generic root url
        if (c.isBookmarkTitleMatch) {
          m.url = c.url;
          m.isBookmarkTitleMatch = true;
          m.isRootCanonical = c.isRootCanonical;
        }

        // If at least one provider is local evidence, it is not purely bootstrap
        if (!c.isBootstrap) {
          m.isBootstrap = false;
        }

        m.source += QStringLiteral("+") + c.source;
      }
    }
  }

  QVector<NavigationCandidate> result;
  result.reserve(mergedMap.size());

  for (auto &cand : mergedMap) {
    cand.score = CandidateScoringConfig::calculateScore(cand);
    cand.confidence = CandidateScoringConfig::calculateConfidence(cand);
    result.append(cand);
  }

  std::sort(result.begin(), result.end(), [](const NavigationCandidate &a, const NavigationCandidate &b) {
    if (a.score != b.score) return a.score > b.score;
    if (a.visitCount != b.visitCount) return a.visitCount > b.visitCount;
    return a.lastVisited > b.lastVisited;
  });

  return result;
}

std::optional<QUrl> CompositeNavigationCandidateProvider::findNavigationCandidate(
    const QString &normalizedToken,
    const QLocale &locale) const {
  const auto candidates = findCandidates(normalizedToken, locale);
  if (candidates.isEmpty()) return std::nullopt;

  const auto &top = candidates.first();

  // 1. Confidence threshold check
  if (top.confidence < CandidateScoringConfig::kMinConfidenceThreshold) {
    return std::nullopt;
  }

  // 2. Ambiguity check: if there is a second candidate with a different host
  // that also meets the confidence threshold and has a very close score, fall back to search.
  for (qsizetype i = 1; i < candidates.size(); ++i) {
    const auto &c2 = candidates.at(i);
    if (c2.displayHost.compare(top.displayHost, Qt::CaseInsensitive) == 0) {
      continue;
    }

    if (c2.confidence >= CandidateScoringConfig::kMinConfidenceThreshold && c2.hasExactTokenMatch) {
      const bool ratioClose = (c2.score >= top.score * CandidateScoringConfig::kAmbiguityRatio);
      const bool deltaClose = ((top.score - c2.score) < CandidateScoringConfig::kAmbiguityScoreDelta);
      if (ratioClose && deltaClose) {
        return std::nullopt; // Ambiguous -> fallback to search
      }
    }
    // Since candidates are sorted by score descending, once c2 is not close, subsequent won't be either
    break;
  }

  return top.url;
}

}  // namespace ardali::core
