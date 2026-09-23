#include "media_page_url_resolver.h"

QString MediaPageUrlResolver::extractionScript() {
  return QStringLiteral(R"JS((() => {
    'use strict';

    const toHttpUrl = value => {
      if (typeof value !== 'string' || value.length === 0 || value.length > 8192) return '';
      try {
        const url = new URL(value, document.baseURI);
        return (url.protocol === 'http:' || url.protocol === 'https:') ? url.href : '';
      } catch (_) {
        return '';
      }
    };

    const host = location.hostname.toLowerCase().replace(/\.$/, '');
    const hostMatches = (candidate, domain) =>
        candidate === domain || candidate.endsWith('.' + domain);

    const platformPathScore = url => {
      const path = url.pathname;
      const candidateHost = url.hostname.toLowerCase().replace(/\.$/, '');
      if (hostMatches(host, 'tiktok.com') && hostMatches(candidateHost, 'tiktok.com')) {
        if (/^\/@[^/]+\/(?:video|photo)\/\d+\/?$/i.test(path)
            || /^\/(?:v|embed|share\/video)\/\d+\/?$/i.test(path)
            || /^\/video\/\d+\/?$/i.test(path)) {
          return 100000;
        }
        return 0;
      }
      if (hostMatches(host, 'instagram.com') && hostMatches(candidateHost, 'instagram.com')) {
        return /^\/(?:reel|reels|p|tv)\/[^/]+\/?$/i.test(path) ? 100000 : 0;
      }
      if (hostMatches(host, 'facebook.com') && hostMatches(candidateHost, 'facebook.com')) {
        return (/^\/(?:reel|watch|share\/r|share\/v)\//i.test(path)
            || /\/videos\/\d+/i.test(path) || (path === '/watch/' && url.searchParams.has('v')))
            ? 100000 : 0;
      }
      if ((hostMatches(host, 'x.com') || hostMatches(host, 'twitter.com'))
          && (hostMatches(candidateHost, 'x.com') || hostMatches(candidateHost, 'twitter.com'))) {
        return /^\/[^/]+\/status\/\d+/i.test(path) ? 100000 : 0;
      }
      if (hostMatches(host, 'youtube.com') && hostMatches(candidateHost, 'youtube.com')) {
        return ((path === '/watch' && url.searchParams.has('v')) || /^\/shorts\/[^/]+/i.test(path))
            ? 100000 : 0;
      }
      if (hostMatches(host, 'reddit.com') && hostMatches(candidateHost, 'reddit.com')) {
        return /\/comments\/[^/]+/i.test(path) ? 100000 : 0;
      }
      return 0;
    };

    const candidates = new Map();
    const addCandidate = (value, proximityBonus = 0, semanticBonus = 0) => {
      const href = toHttpUrl(value);
      if (!href) return;
      const url = new URL(href);
      const baseScore = platformPathScore(url);
      if (baseScore <= 0) return;
      const score = baseScore + proximityBonus + semanticBonus;
      const previous = candidates.get(href);
      if (previous === undefined || score > previous) candidates.set(href, score);
    };

    // If address bar or window.location is already a specific media post/permalink,
    // prioritize it as a baseline candidate.
    const currentLoc = toHttpUrl(location.href);
    if (currentLoc) {
      addCandidate(currentLoc, 90000, 90000);
    }

    // Check canonical / OpenGraph metadata early
    const canonicalMeta = toHttpUrl(document.querySelector('link[rel="canonical"]')?.href
        || document.querySelector('meta[property="og:url"]')?.content || '');
    if (canonicalMeta) {
      addCandidate(canonicalMeta, 85000, 85000);
    }

    const visibleArea = element => {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) return 0;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden'
          || Number.parseFloat(style.opacity || '1') <= 0.01) return 0;
      const width = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
      const height = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
      return width * height;
    };

    const videos = Array.from(document.querySelectorAll('video'))
        .map(video => {
          const rect = video.getBoundingClientRect();
          const area = visibleArea(video);
          const centerY = rect.top + rect.height / 2;
          const distFromCenter = Math.abs(centerY - innerHeight / 2);
          const isPlaying = !video.paused && !video.ended && (video.readyState >= 1 || video.currentTime > 0);
          return { video, area, isPlaying, distFromCenter };
        })
        .filter(item => item.area > 0)
        .sort((a, b) => (b.isPlaying - a.isPlaying)
                     || (a.distFromCenter - b.distFromCenter)
                     || (b.area - a.area));

    let activeMedia = videos.length > 0 ? videos[0].video : null;

    // On TikTok, photo posts (slideshows) or newly buffering cards might not contain a <video> element
    if (!activeMedia && hostMatches(host, 'tiktok.com')) {
      const photoContainers = Array.from(document.querySelectorAll(
          '[data-e2e*="photo"], [class*="DivPhotoPlayer"], [class*="PhotoSlide"], '
          + '[data-e2e="feed-item"], [data-e2e="recommend-list-item-container"], article'))
          .map(el => {
            const rect = el.getBoundingClientRect();
            const area = visibleArea(el);
            const centerY = rect.top + rect.height / 2;
            return { el, area, dist: Math.abs(centerY - innerHeight / 2) };
          })
          .filter(item => item.area > 0)
          .sort((a, b) => a.dist - b.dist || b.area - a.area);
      if (photoContainers.length > 0) {
        activeMedia = photoContainers[0].el;
      }
    }

    let activeCenterX = innerWidth / 2;
    let activeCenterY = innerHeight / 2;
    if (activeMedia) {
      const activeRect = activeMedia.getBoundingClientRect();
      activeCenterX = activeRect.left + activeRect.width / 2;
      activeCenterY = activeRect.top + activeRect.height / 2;
    }

    if (hostMatches(host, 'tiktok.com')) {
      const mediaCard = activeMedia ? activeMedia.closest(
          '[data-e2e="feed-video"], [data-e2e="recommend-list-item-container"], article, [data-e2e="feed-item"]') : null;
      const feedItem = (activeMedia ? activeMedia.closest(
          '[data-e2e="recommend-list-item-container"], [data-e2e="feed-item"], '
          + '[data-e2e="user-post-item"], [data-e2e="search_video-item"], '
          + '[data-e2e="search_top-item"], [data-e2e="favorites-item"], [data-e2e="user-liked-item"], '
          + '[data-e2e="challenge-item"], [data-e2e="collection-item"], [data-e2e="video-item"], '
          + 'article, [role="article"], [class*="DivItemContainer"]') : null)
          || mediaCard
          || (activeMedia ? activeMedia.closest('[id*="xgwrapper"],[id*="xgplayer"],[class*="DivVideoWrapper"]') : null)
          || (activeMedia ? activeMedia.parentElement : null);

      // Method 1: Check for direct /video/ or /photo/ links inside the active feed card
      const searchScope = feedItem || (activeMedia ? activeMedia.parentElement : null);
      if (searchScope) {
        const links = searchScope.querySelectorAll('a[href]');
        for (const link of links) {
          const href = toHttpUrl(link.href);
          if (!href) continue;
          addCandidate(href, 60000, 60000);
        }
      }

      // Method 2: Extract video ID from ancestor/descendant attributes and author from profile links
      let itemId = '';
      if (activeMedia) {
        for (let node = activeMedia, depth = 0;
             node && depth < 20 && (!feedItem || feedItem.contains(node) || depth < 6);
             node = node.parentElement, ++depth) {
          const idSource = (node.getAttribute?.('data-item-id') || '') + ' '
              + (node.getAttribute?.('data-video-id') || '') + ' '
              + (node.getAttribute?.('data-aweme-id') || '') + ' '
              + (node.getAttribute?.('data-id') || '') + ' '
              + (node.id || '');
          const idMatch = idSource.match(/\b(\d{16,21})\b/)
              || idSource.match(/(?:item|video|aweme|xgwrapper|xgplayer)[-_:]?(\d{10,21})/i);
          if (idMatch) {
            itemId = idMatch[1];
            break;
          }
        }
      }
      if (!itemId && feedItem) {
        for (const idNode of feedItem.querySelectorAll('[data-item-id],[data-video-id],[data-aweme-id],[id]')) {
          const idSource = (idNode.getAttribute('data-item-id') || '') + ' '
              + (idNode.getAttribute('data-video-id') || '') + ' '
              + (idNode.getAttribute('data-aweme-id') || '') + ' '
              + (idNode.id || '');
          const idMatch = idSource.match(/\b(\d{16,21})\b/)
              || idSource.match(/(?:item|video|aweme|xgwrapper|xgplayer)[-_:]?(\d{10,21})/i);
          if (idMatch) {
            itemId = idMatch[1];
            break;
          }
        }
      }

      if (itemId) {
        let username = '';
        if (feedItem) {
          for (const profileLink of feedItem.querySelectorAll('a[href]')) {
            const pHref = toHttpUrl(profileLink.href);
            if (!pHref) continue;
            const pUrl = new URL(pHref);
            if (!hostMatches(pUrl.hostname.toLowerCase(), 'tiktok.com')) continue;
            const pMatch = pUrl.pathname.match(/^\/@[^/]+\/?$/);
            if (pMatch) {
              username = pUrl.pathname.replace(/^\/@|\/$/g, '');
              break;
            }
          }
        }
        if (username) {
          addCandidate(`https://www.tiktok.com/@${username}/video/${itemId}`, 50000, 50000);
        } else {
          addCandidate(`https://www.tiktok.com/@i/video/${itemId}`, 45000, 45000);
        }
      }

      // Method 3: Parse TikTok Rehydration data if present
      try {
        const rehydrateScript = document.querySelector('script#__UNIVERSAL_DATA_FOR_REHYDRATION__')
            || document.querySelector('script#SIGI_STATE')
            || document.querySelector('script#__NEXT_DATA__');
        if (rehydrateScript) {
          const rawData = (rehydrateScript.textContent || '').trim();
          if (rawData) {
            const parsedData = JSON.parse(rawData);
            const scope = parsedData.__DEFAULT_SCOPE__ || parsedData;
            const detailStruct = scope['webapp.video-detail']?.itemInfo?.itemStruct;
            if (detailStruct && detailStruct.id) {
              const uName = detailStruct.author?.uniqueId || 'i';
              addCandidate(`https://www.tiktok.com/@${uName}/video/${detailStruct.id}`, 70000, 70000);
            }
            const itemModule = scope['webapp.video-detail']?.itemModule || scope.itemModule || scope.ItemModule;
            if (itemModule && typeof itemModule === 'object') {
              if (itemId && itemModule[itemId]) {
                const item = itemModule[itemId];
                const uName = item.author?.uniqueId || item.author || 'i';
                addCandidate(`https://www.tiktok.com/@${uName}/video/${itemId}`, 65000, 65000);
              }
            }
          }
        }
      } catch (_) {}
    }

    // Inspect activeMedia's ancestor tree for permalinks
    if (activeMedia) {
      let container = activeMedia;
      for (let depth = 0; container && depth < 16; ++depth, container = container.parentElement) {
        if (container.matches && container.matches('a[href]')) {
          addCandidate(container.href, 20000 - depth * 500, 0);
        }
        const links = container.querySelectorAll ? container.querySelectorAll('a[href]') : [];
        for (let index = 0; index < links.length && index < 300; ++index) {
          const link = links[index];
          const rel = (link.getAttribute('rel') || '').toLowerCase();
          const marker = ((link.getAttribute('data-e2e') || '') + ' '
              + (link.getAttribute('data-testid') || '')).toLowerCase();
          addCandidate(link.href, 18000 - depth * 500,
                       /bookmark|permalink/.test(rel + ' ' + marker) ? 5000 : 0);
        }
        if (container.matches && container.matches('article,[role="article"],[data-e2e*="feed-video"],[data-e2e="feed-item"]')) break;
      }
    }

    // Document-wide closest link search
    if (activeMedia) {
      const allLinks = document.querySelectorAll('a[href]');
      for (let index = 0; index < allLinks.length && index < 3000; ++index) {
        const link = allLinks[index];
        const href = toHttpUrl(link.href);
        if (!href) continue;
        const parsed = new URL(href);
        if (platformPathScore(parsed) === 0) continue;
        const rect = link.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const distance = Math.hypot(centerX - activeCenterX, centerY - activeCenterY);
        addCandidate(href, Math.max(0, 12000 - Math.round(distance)), 0);
      }
    }

    if (candidates.size > 0) {
      return Array.from(candidates.entries()).sort((a, b) => b[1] - a[1])[0][0];
    }

    const canonical = document.querySelector('link[rel="canonical"]')?.href
        || document.querySelector('meta[property="og:url"]')?.content || '';
    const canonicalUrl = toHttpUrl(canonical);
    if (canonicalUrl) {
      const parsed = new URL(canonicalUrl);
      const canonicalHost = parsed.hostname.toLowerCase().replace(/\.$/, '');
      const sameSite = hostMatches(canonicalHost, host) || hostMatches(host, canonicalHost);
      if (platformPathScore(parsed) > 0
          || (sameSite && parsed.pathname && parsed.pathname !== '/'
              && !/^\/(?:foryou|explore|following|live)\/?$/i.test(parsed.pathname))) {
        return canonicalUrl;
      }
    }

    if (activeMedia && activeMedia.tagName === 'VIDEO') {
      const directSrc = toHttpUrl(activeMedia.currentSrc || activeMedia.src || '');
      if (directSrc && !hostMatches(host, 'tiktok.com')) {
        return directSrc;
      }
    }

    return '';
  })())JS");
}

QUrl MediaPageUrlResolver::validatedResult(const QVariant &scriptResult,
                                            const QUrl &fallbackUrl) {
  const QString raw = scriptResult.toString().trimmed();
  if (raw.isEmpty() || raw.size() > 8192) return fallbackUrl;

  const QUrl candidate(raw, QUrl::StrictMode);
  const QString scheme = candidate.scheme().toLower();
  if (!candidate.isValid() || candidate.host().isEmpty()
      || (scheme != QLatin1String("http") && scheme != QLatin1String("https"))
      || !candidate.userName().isEmpty() || !candidate.password().isEmpty()) {
    return fallbackUrl;
  }
  return candidate;
}
