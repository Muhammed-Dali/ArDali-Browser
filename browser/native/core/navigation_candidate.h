#pragma once

#include <QDateTime>
#include <QString>
#include <QUrl>
#include <algorithm>

namespace ardali::core {

struct NavigationCandidate {
  QUrl url;
  QString displayHost;
  QString source; // "history", "bookmark", "frequent", "bootstrap", or composite
  double score = 0.0;
  double confidence = 0.0; // 0.0 to 1.0
  QDateTime lastVisited;
  int visitCount = 0;
  int typedCount = 0;
  bool hasTypedEvidence = false;
  bool isBookmark = false;
  bool isFrequentSite = false;
  bool isRootCanonical = false;
  bool hasExactTokenMatch = false;
  bool isExactDomainMatch = false;
  bool isExactSubdomainMatch = false;
  bool isBookmarkTitleMatch = false;
  bool isBootstrap = false;
};

struct CandidateScoringConfig {
  // Base scores by match kind
  static constexpr double kExactDomainBaseScore = 100.0;
  static constexpr double kExactSubdomainBaseScore = 85.0;
  static constexpr double kBookmarkTitleBaseScore = 110.0;
  static constexpr double kBootstrapScore = 50.0;

  // Evidence bonuses
  static constexpr double kBookmarkBonus = 30.0;
  static constexpr double kFrequentSiteBonus = 20.0;
  static constexpr double kVisitCountMultiplier = 1.5;
  static constexpr double kMaxVisitCountBonus = 30.0;

  // Recency bonuses
  static constexpr double kRecency24hBonus = 15.0;
  static constexpr double kRecency7dBonus = 10.0;
  static constexpr double kRecency30dBonus = 5.0;

  // Gating thresholds
  static constexpr double kMinConfidenceThreshold = 0.70;
  static constexpr double kAmbiguityRatio = 0.85;
  static constexpr double kAmbiguityScoreDelta = 15.0;
  static constexpr int kAntiPoisoningMinVisits = 2;

  // Score calculation for relative candidate ranking
  static double calculateScore(const NavigationCandidate &c) {
    if (c.isBootstrap) {
      return kBootstrapScore;
    }

    double s = 0.0;
    if (c.isBookmarkTitleMatch) {
      s += kBookmarkTitleBaseScore;
    } else if (c.isExactDomainMatch) {
      s += kExactDomainBaseScore;
    } else if (c.isExactSubdomainMatch) {
      s += kExactSubdomainBaseScore;
    } else if (c.hasExactTokenMatch) {
      s += kExactDomainBaseScore;
    }

    if (c.isBookmark) {
      s += kBookmarkBonus;
    }
    if (c.isFrequentSite) {
      s += kFrequentSiteBonus;
    }

    const double visitBonus = std::min(c.visitCount * kVisitCountMultiplier, kMaxVisitCountBonus);
    s += visitBonus;

    if (c.lastVisited.isValid()) {
      const qint64 secs = c.lastVisited.secsTo(QDateTime::currentDateTimeUtc());
      if (secs <= 86400) {
        s += kRecency24hBonus;
      } else if (secs <= 7 * 86400) {
        s += kRecency7dBonus;
      } else if (secs <= 30 * 86400) {
        s += kRecency30dBonus;
      }
    }

    return s;
  }

  // Confidence calculation to decide whether to direct navigate vs fallback to search
  static double calculateConfidence(const NavigationCandidate &c) {
    // Non-exact matches NEVER auto-navigate on submit
    if (!c.hasExactTokenMatch && !c.isBookmarkTitleMatch) {
      return 0.0;
    }

    // Bootstrap fallback has moderate confidence (0.75 >= 0.70)
    if (c.isBootstrap) {
      return 0.75;
    }

    // Bookmark matches have very high confidence
    if (c.isBookmark) {
      return 0.95;
    }

    // Typed / direct navigation evidence: The user explicitly typed this domain or URL before!
    // This is strong user intent, immune to accidental link click poisoning.
    if (c.hasTypedEvidence && c.isExactDomainMatch) {
      return 0.85;
    }

    // Frequent sites with confirmed visits have high confidence
    if (c.isFrequentSite && c.visitCount >= kAntiPoisoningMinVisits) {
      return 0.90;
    }

    // History-only candidate:
    // Anti-poisoning guard: single accidental visit (<= 1) drops confidence to 0.40 (< 0.70)
    if (c.visitCount >= kAntiPoisoningMinVisits) {
      return 0.80;
    }

    // Single visit / weak local evidence -> safe fallback to search
    return 0.40;
  }
};

}  // namespace ardali::core
