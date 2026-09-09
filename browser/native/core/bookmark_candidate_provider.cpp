#include "bookmark_candidate_provider.h"

#include <algorithm>

#include "domain_normalizer.h"

namespace ardali::core {

BookmarkCandidateProvider::BookmarkCandidateProvider(
    IBrowserProfileDataProvider *dataProvider,
    QObject *signalSource,
    QObject *parent)
    : QObject(parent), dataProvider_(dataProvider), signalSource_(signalSource) {
  if (signalSource_) {
    connect(signalSource_, SIGNAL(bookmarksChanged()), this, SLOT(markDirty()));
  }
}

void BookmarkCandidateProvider::markDirty() {
  dirty_ = true;
}

void BookmarkCandidateProvider::addBookmark(const QUrl &url, const QString &title) {
  useManualBookmarks_ = true;
  if (!url.isValid()) return;

  const QUrl canonical = DomainNormalizer::canonicalRootUrl(url);
  const ExtractedHostTokens tokens = DomainNormalizer::extractTokens(url.host());
  if (!tokens.isValid) return;

  BookmarkItem item;
  item.originalUrl = url;
  item.canonicalRootUrl = canonical;
  item.displayHost = tokens.canonicalHost;
  item.primaryDomainToken = tokens.primaryDomainToken;
  item.subdomainTokens = tokens.subdomainTokens;
  item.title = title.trimmed();

  manualBookmarks_.append(item);
  dirty_ = true;
}

void BookmarkCandidateProvider::clearBookmarks() {
  manualBookmarks_.clear();
  indexedBookmarks_.clear();
  useManualBookmarks_ = false;
  dirty_ = true;
}

void BookmarkCandidateProvider::ensureIndexBuilt() const {
  if (!dirty_) return;
  indexedBookmarks_.clear();

  if (useManualBookmarks_) {
    indexedBookmarks_ = manualBookmarks_;
    dirty_ = false;
    return;
  }

  if (dataProvider_) {
    // History entries to correlate titles if available
    QHash<QString, QString> urlToTitle;
    for (const auto &entry : dataProvider_->recentHistory()) {
      urlToTitle.insert(entry.url.toString(QUrl::FullyEncoded), entry.title);
    }

    for (const auto &url : dataProvider_->bookmarks()) {
      if (!url.isValid()) continue;
      const QUrl canonical = DomainNormalizer::canonicalRootUrl(url);
      const ExtractedHostTokens tokens = DomainNormalizer::extractTokens(url.host());
      if (!tokens.isValid) continue;

      BookmarkItem item;
      item.originalUrl = url;
      item.canonicalRootUrl = canonical;
      item.displayHost = tokens.canonicalHost;
      item.primaryDomainToken = tokens.primaryDomainToken;
      item.subdomainTokens = tokens.subdomainTokens;
      item.title = urlToTitle.value(url.toString(QUrl::FullyEncoded), QString{}).trimmed();
      indexedBookmarks_.append(item);
    }
  }

  dirty_ = false;
}

QVector<NavigationCandidate> BookmarkCandidateProvider::findCandidates(
    const QString &normalizedToken,
    const QLocale &locale) const {
  Q_UNUSED(locale);
  const QString token = normalizedToken.trimmed().toLower();
  if (token.isEmpty()) return {};

  ensureIndexBuilt();

  QVector<NavigationCandidate> candidates;

  for (const auto &item : indexedBookmarks_) {
    bool isTitleMatch = false;
    if (!item.title.isEmpty()) {
      if (token == item.title.toLower()) {
        isTitleMatch = true;
      } else {
        // Check word tokens in title
        const QStringList titleTokens = item.title.toLower().split(QLatin1Char(' '), Qt::SkipEmptyParts);
        if (titleTokens.contains(token)) {
          isTitleMatch = true;
        }
      }
    }

    bool isExactDomain = false;
    bool isExactSubdomain = false;
    if (token == item.primaryDomainToken) {
      isExactDomain = true;
    } else if (item.subdomainTokens.contains(token)) {
      isExactSubdomain = true;
    }

    if (!isTitleMatch && !isExactDomain && !isExactSubdomain) {
      continue;
    }

    NavigationCandidate c;
    c.displayHost = item.displayHost;
    c.source = QStringLiteral("bookmark");
    c.isBookmark = true;
    c.hasExactTokenMatch = true;
    c.isBookmarkTitleMatch = isTitleMatch;
    c.isExactDomainMatch = isExactDomain;
    c.isExactSubdomainMatch = isExactSubdomain;

    if (isTitleMatch) {
      // Strong title match: preserve specific bookmark path
      c.url = item.originalUrl;
      c.isRootCanonical = (item.originalUrl.path().isEmpty() || item.originalUrl.path() == QLatin1String("/"));
    } else {
      // Host token match only: use canonical host root
      c.url = item.canonicalRootUrl;
      c.isRootCanonical = true;
    }

    c.score = CandidateScoringConfig::calculateScore(c);
    c.confidence = CandidateScoringConfig::calculateConfidence(c);
    candidates.append(c);
  }

  std::sort(candidates.begin(), candidates.end(), [](const NavigationCandidate &a, const NavigationCandidate &b) {
    return a.score > b.score;
  });

  return candidates;
}

std::optional<QUrl> BookmarkCandidateProvider::findNavigationCandidate(
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
