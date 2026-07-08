/**
 * Web Browser Module for ArDali WebMedia
 * Handles Tabs, Navigation, Search, and New Tab Page logic.
 */

document.addEventListener('DOMContentLoaded', () => {
    // --- Elements ---
    const webTabsList = document.getElementById('webTabsList');
    const webTabNewBtn = document.getElementById('webTabNewBtn');
    
    const navBack = document.getElementById('webNavBack');
    const navForward = document.getElementById('webNavForward');
    const navReload = document.getElementById('webNavReload');
    const navHome = document.getElementById('webNavHome');
    const addressInput = document.getElementById('webAddressInput');
    
    const newTabPage = document.getElementById('webNewTabPage');
    const ntpSearchInput = document.getElementById('webNtpSearchInput');
    const ntpEngines = document.querySelectorAll('.web-ntp-engine');

    const webAddressZoom = document.getElementById('webAddressZoom');
    const webZoomPopup = document.getElementById('webZoomPopup');
    const webZoomOutBtn = document.getElementById('webZoomOutBtn');
    const webZoomInBtn = document.getElementById('webZoomInBtn');
    const webZoomResetBtn = document.getElementById('webZoomResetBtn');
    const webZoomText = document.getElementById('webZoomText');

    // --- State ---
    let tabs = [];
    let activeTabId = null;
    let currentSearchEngine = window.state?.settings?.web?.searchEngine || 'duckduckgo';
    let isWebviewLoading = false;
    const loadWatchdogs = new Map();
    const blankPageChecks = new Map();
    const LOAD_STALL_MS = 12000;
    const BLANK_PAGE_CHECK_MS = 900;
    const BLANK_PAGE_SECOND_CHECK_MS = 2800;

    window.addEventListener('ardali:settings-changed', (e) => {
        if (e.detail && e.detail.webSearchEngine) {
            currentSearchEngine = e.detail.webSearchEngine;
            // Update UI selection on new tab page
            updateNtpSearchEngineUI(currentSearchEngine);
        }
    });

    const BLANK_URL = 'about:blank';
    const NEW_TAB_TITLE = 'Yeni Sekme';

    // Search Engine Definitions
    const searchEngines = {
        'duckduckgo': (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
        'google': (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
        'bing': (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
        'brave': (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}`
    };

    window.getActiveWebView = function() {
        if (!activeTabId) return null;
        return document.getElementById('webview-' + activeTabId);
    };

    window.getActiveTabUrl = function() {
        const tab = getActiveTab();
        return tab ? tab.url : null;
    };

    window.createTab = createTab;

    // --- Helper Functions ---
    function generateId() {
        return Math.random().toString(36).substring(2, 10);
    }

    function isValidUrl(string) {
        try {
            new URL(string);
            return true;
        } catch (_) {
            return false;
        }
    }

    function formatUrl(input) {
        if (!input.trim()) return BLANK_URL;
        if (isValidUrl(input)) return input;
        
        // If it looks like a domain but lacks protocol
        if (input.includes('.') && !input.includes(' ')) {
            return `https://${input}`;
        }

        // Otherwise, it's a search query
        return searchEngines[currentSearchEngine](input);
    }

    function isDownloadsUrl(url = '') {
        return String(url || '').trim() === 'ardali://downloads';
    }

    function shouldUseCompatibilityUserAgent(url = '') {
        const parsed = parseHttpUrl(url);
        if (!parsed) return false;
        const host = String(parsed.hostname || '').toLowerCase();
        return host === 'web.whatsapp.com' ||
            host === 'whatsapp.com' ||
            host === 'www.whatsapp.com' ||
            host.endsWith('.whatsapp.com') ||
            host === 'open.spotify.com' ||
            host === 'spotify.com' ||
            host === 'www.spotify.com' ||
            host.endsWith('.spotify.com');
    }

    function getPreferredUserAgentForWebview(url = '') {
        if (!shouldUseCompatibilityUserAgent(url)) return '';
        try {
            if (typeof window.getPreferredWebUserAgent === 'function') {
                return String(window.getPreferredWebUserAgent() || '');
            }
        } catch (_) {}
        return getCompatibilityUserAgent();
    }

    function getCompatibilityUserAgent() {
        const stripped = String(navigator.userAgent || '')
            .replace(/\sElectron\/[^\s)]+/gi, '')
            .replace(/\sArDali\/[^\s)]+/gi, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
        if (stripped && /Chrome\/(\d+)/.test(stripped)) return stripped;
        return 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36';
    }

    function getNativeWebviewUserAgent() {
        return String(navigator.userAgent || '')
            .replace(/\sArDali\/[^\s)]+/gi, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }

    function runWhenWebviewReady(wv, fn) {
        if (!wv || typeof fn !== 'function') return;
        if (wv.__ardaliDomReady) {
            try { fn(); } catch (_) {}
            return;
        }
        const run = () => {
            wv.__ardaliDomReady = true;
            try { fn(); } catch (_) {}
        };
        try {
            wv.addEventListener('dom-ready', run, { once: true });
        } catch (_) {}
    }

    function setWebviewZoomFactorSafe(wv, zoomFactor) {
        if (!wv || typeof wv.setZoomFactor !== 'function') return;
        const factor = Number(zoomFactor || 1);
        runWhenWebviewReady(wv, () => wv.setZoomFactor(factor));
    }

    function applyPreferredUserAgent(wv, url = '') {
        if (!wv) return;
        const compatibility = shouldUseCompatibilityUserAgent(url);
        const userAgent = getPreferredUserAgentForWebview(url) || getNativeWebviewUserAgent();
        try {
            if (compatibility && userAgent) {
                wv.setAttribute('useragent', userAgent);
            } else {
                wv.removeAttribute('useragent');
            }
        } catch (_) {}
        try {
            if (typeof wv.setUserAgent !== 'function') return;
            if (userAgent) runWhenWebviewReady(wv, () => wv.setUserAgent(userAgent));
        } catch (_) {}
    }

    function notifyWebBrowser(message, type = 'info', timeoutMs = 3200) {
        try {
            if (typeof window.safeNotify === 'function') {
                window.safeNotify(message, type, timeoutMs);
                return;
            }
            if (typeof window.ardali?.notify === 'function') {
                window.ardali.notify(message, type);
                return;
            }
        } catch (_) {}
        console.log(`[WEB] ${message}`);
    }

    function getTabWebView(tabId) {
        return document.getElementById('webview-' + tabId);
    }

    function setTabLoading(tabId, loading, url = '') {
        const tab = tabs.find(t => t.id === tabId);
        if (!tab) return;
        if (url) tab.url = url;
        tab.isLoading = !!loading;
        if (loading && tab.url !== BLANK_URL) tab.title = 'Yükleniyor...';
        if (loading) tab.loadStartedAt = Date.now();
        if (activeTabId === tabId) {
            isWebviewLoading = !!loading;
            navReload.innerHTML = loading
                ? '<span class="material-symbols-rounded">close</span>'
                : '<span class="material-symbols-rounded">refresh</span>';
            updateAddressBar(tab.url);
            updateNewTabPageVisibility(tab.url);
        }
        renderTabs();
    }

    function clearLoadWatchdog(tabId) {
        const timer = loadWatchdogs.get(tabId);
        if (timer) clearTimeout(timer);
        loadWatchdogs.delete(tabId);
    }

    function clearBlankPageChecks(tabId) {
        const timers = blankPageChecks.get(tabId);
        if (Array.isArray(timers)) {
            timers.forEach(timer => clearTimeout(timer));
        }
        blankPageChecks.delete(tabId);
    }

    function scheduleLoadWatchdog(tabId, url) {
        clearLoadWatchdog(tabId);
        if (!parseHttpUrl(url)) return;
        loadWatchdogs.set(tabId, setTimeout(() => {
            const tab = tabs.find(t => t.id === tabId);
            const wv = getTabWebView(tabId);
            if (!tab || !wv || !tab.isLoading || tab.url !== url) return;
            recoverWebviewLoad(tabId, 'load-timeout');
        }, LOAD_STALL_MS));
    }

    function isLikelyBlankPageProbe(result) {
        const ready = String(result?.ready || '');
        const textLength = Number(result?.textLength || 0);
        const visibleTextLength = Number(result?.visibleTextLength || 0);
        const visibleElementCount = Number(result?.visibleElementCount || 0);
        const meaningfulElementCount = Number(result?.meaningfulElementCount || 0);
        const bodyArea = Number(result?.bodyArea || 0);
        const viewportArea = Number(result?.viewportArea || 0);
        const hasWhiteBackground = result?.hasWhiteBackground === true;

        if (ready !== 'interactive' && ready !== 'complete') return false;
        if (textLength === 0 && meaningfulElementCount === 0) return true;
        if (visibleTextLength < 8 && visibleElementCount < 3 && meaningfulElementCount < 3) return true;
        if (hasWhiteBackground && visibleTextLength < 8 && bodyArea >= viewportArea * 0.65 && meaningfulElementCount < 6) return true;
        return false;
    }

    function recoverWebviewLoad(tabId, reason) {
        const tab = tabs.find(t => t.id === tabId);
        const wv = getTabWebView(tabId);
        if (!tab || !wv) return;
        const targetUrl = String(tab.url || wv.getURL?.() || '').trim();
        if (!targetUrl || targetUrl === BLANK_URL) return;
        tab.loadRecoveryCount = Number(tab.loadRecoveryCount || 0) + 1;
        if (tab.loadRecoveryCount > 2) {
            setTabLoading(tabId, false);
            if (activeTabId === tabId) notifyWebBrowser('Sayfa yüklenemedi. Yenile düğmesiyle tekrar deneyebilirsin.', 'warning');
            return;
        }
        console.warn('[WEB] recovering stalled webview load:', { reason, targetUrl, attempt: tab.loadRecoveryCount });
        try { if (typeof wv.stop === 'function') wv.stop(); } catch (_) {}
        if (reason === 'blank-page' && tab.loadRecoveryCount > 1) {
            recreateWebviewForTab(tabId, reason);
            return;
        }
        setTimeout(() => {
            const current = getTabWebView(tabId);
            if (!current) return;
            applyPreferredUserAgent(current, targetUrl);
            setTabLoading(tabId, true, targetUrl);
            scheduleLoadWatchdog(tabId, targetUrl);
            try {
                if (typeof current.reloadIgnoringCache === 'function' && current.getURL?.() === targetUrl) {
                    current.reloadIgnoringCache();
                } else {
                    current.loadURL(targetUrl);
                }
            } catch (err) {
                console.warn('[WEB] recovery load failed:', err?.message || err);
            }
        }, 350);
    }

    function recreateWebviewForTab(tabId, reason) {
        const tab = tabs.find(t => t.id === tabId);
        if (!tab) return;
        clearLoadWatchdog(tabId);
        clearBlankPageChecks(tabId);
        const oldWebview = getTabWebView(tabId);
        const targetUrl = String(tab.url || oldWebview?.getURL?.() || BLANK_URL).trim() || BLANK_URL;
        if (oldWebview) oldWebview.remove();
        const wv = document.createElement('webview');
        wv.id = 'webview-' + tabId;
        wv.setAttribute('allowpopups', '');
        wv.setAttribute('partition', 'persist:ardali-web');
        applyPreferredUserAgent(wv, targetUrl);
        wv.src = targetUrl;
        const container = document.getElementById('webViewsContainer');
        if (container) container.appendChild(wv);
        bindWebBrowserEvents(wv, tabId);
        if (typeof window.bindWebViewEvents === 'function') {
            window.bindWebViewEvents(wv);
        }
        wv.addEventListener('media-started-playing', () => { tab.isPlayingMedia = true; });
        wv.addEventListener('media-paused', () => { tab.isPlayingMedia = false; });
        if (activeTabId === tabId) {
            document.querySelectorAll('.webviews-container webview').forEach(w => w.classList.remove('active'));
            wv.classList.add('active');
        }
        console.warn('[WEB] webview recreated:', { reason, targetUrl });
        setTabLoading(tabId, targetUrl !== BLANK_URL, targetUrl);
        scheduleLoadWatchdog(tabId, targetUrl);
    }

    function scheduleBlankPageRecovery(tabId) {
        const tab = tabs.find(t => t.id === tabId);
        const wv = getTabWebView(tabId);
        if (!tab || !wv || !parseHttpUrl(tab.url)) return;
        clearBlankPageChecks(tabId);
        const runBlankProbe = async () => {
            const currentTab = tabs.find(t => t.id === tabId);
            const currentWebview = getTabWebView(tabId);
            if (!currentTab || !currentWebview || !parseHttpUrl(currentTab.url)) return;
            const loadAgeMs = Date.now() - Number(currentTab.loadStartedAt || 0);
            if (currentTab.isLoading && loadAgeMs < 2200) return;
            try {
                const result = await currentWebview.executeJavaScript(`
                    (() => {
                        const body = document.body;
                        const doc = document.documentElement;
                        const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
                        const bodyRect = body ? body.getBoundingClientRect() : { width: 0, height: 0 };
                        const bodyArea = Math.max(0, bodyRect.width * bodyRect.height);
                        const elements = Array.from(document.querySelectorAll('body *')).slice(0, 900);
                        let visibleElementCount = 0;
                        let meaningfulElementCount = 0;
                        let visibleTextLength = 0;
                        for (const el of elements) {
                            const style = window.getComputedStyle(el);
                            if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) === 0) continue;
                            const rect = el.getBoundingClientRect();
                            const visible = rect.width > 1 && rect.height > 1 && rect.bottom >= 0 && rect.right >= 0 && rect.top <= window.innerHeight && rect.left <= window.innerWidth;
                            if (!visible) continue;
                            visibleElementCount += 1;
                            const tag = String(el.tagName || '').toLowerCase();
                            if (!['script', 'style', 'meta', 'link', 'noscript', 'template'].includes(tag)) {
                                meaningfulElementCount += 1;
                                visibleTextLength += String(el.innerText || el.textContent || '').trim().length;
                            }
                        }
                        const bg = window.getComputedStyle(body || doc).backgroundColor || '';
                        return {
                            ready: document.readyState,
                            href: location.href,
                            textLength: String(body?.innerText || '').trim().length,
                            childCount: body ? body.children.length : 0,
                            visibleTextLength,
                            visibleElementCount,
                            meaningfulElementCount,
                            bodyArea,
                            viewportArea,
                            hasWhiteBackground: /rgba?\\(\\s*255\\s*,\\s*255\\s*,\\s*255(?:\\s*,\\s*(?:1|1\\.0+))?\\s*\\)/i.test(bg)
                        };
                    })()
                `, true);
                const href = String(result?.href || '');
                const webviewUrl = String(currentWebview.getURL?.() || '');
                if (!href || href === BLANK_URL) return;
                if (href !== currentTab.url && href !== webviewUrl) return;
                if (href && href !== currentTab.url) currentTab.url = href;
                if (isLikelyBlankPageProbe(result)) {
                    currentTab.blankRecoveryCount = Number(currentTab.blankRecoveryCount || 0) + 1;
                    recoverWebviewLoad(tabId, 'blank-page');
                } else {
                    currentTab.blankRecoveryCount = 0;
                    currentTab.loadRecoveryCount = 0;
                }
            } catch (_) {
                // executeJavaScript can fail during fast navigations; the next lifecycle event will handle it.
            }
        };
        const timers = [
            setTimeout(runBlankProbe, BLANK_PAGE_CHECK_MS),
            setTimeout(runBlankProbe, BLANK_PAGE_SECOND_CHECK_MS)
        ];
        blankPageChecks.set(tabId, timers);
    }

    function parseHttpUrl(value) {
        try {
            const parsed = new URL(String(value || '').trim());
            return /^https?:$/i.test(parsed.protocol) ? parsed : null;
        } catch (_) {
            return null;
        }
    }

    // --- Zoom Logic ---
    const ZOOM_STEPS = [0.25, 0.33, 0.50, 0.67, 0.75, 0.80, 0.90, 1.0, 1.10, 1.25, 1.50, 1.75, 2.0, 2.5, 3.0, 4.0, 5.0];

    function getNextZoomFactor(current, direction) {
        // Find nearest step
        let closestIndex = 0;
        let minDiff = Infinity;
        for (let i = 0; i < ZOOM_STEPS.length; i++) {
            const diff = Math.abs(current - ZOOM_STEPS[i]);
            if (diff < minDiff) {
                minDiff = diff;
                closestIndex = i;
            }
        }
        
        let newIndex = closestIndex + direction;
        newIndex = Math.max(0, Math.min(newIndex, ZOOM_STEPS.length - 1));
        return ZOOM_STEPS[newIndex];
    }

    function updateZoomUI(zoomFactor) {
        if (!webAddressZoom || !webZoomPopup) return;
        
        const percent = Math.round(zoomFactor * 100);
        webZoomText.textContent = `%${percent}`;
        webAddressZoom.title = `Yakınlaştırma: %${percent}`;
        
        if (zoomFactor !== 1.0) {
            webAddressZoom.classList.remove('hidden');
            webAddressZoom.classList.add('active');
        } else {
            webAddressZoom.classList.remove('active');
            // Keep visible if popup is open
            if (webZoomPopup.classList.contains('hidden')) {
                webAddressZoom.classList.add('hidden');
            }
        }
    }

    function handleWebviewZoomScroll(tabId, direction) {
        const tab = tabs.find(t => t.id === tabId);
        if (!tab) return;
        
        tab.zoomFactor = getNextZoomFactor(tab.zoomFactor || 1.0, direction);
        const wv = document.getElementById('webview-' + tabId);
        setWebviewZoomFactorSafe(wv, tab.zoomFactor);
        
        if (activeTabId === tabId) {
            updateZoomUI(tab.zoomFactor);
            // Show icon
            webAddressZoom.classList.remove('hidden');
            // Show popup automatically on scroll
            webZoomPopup.classList.remove('hidden');
            
            clearTimeout(window.zoomPopupTimeout);
            window.zoomPopupTimeout = setTimeout(() => {
                if (activeTabId === tabId) {
                    webZoomPopup.classList.add('hidden');
                    if (tab.zoomFactor === 1.0) {
                        webAddressZoom.classList.add('hidden');
                        webAddressZoom.classList.remove('active');
                    }
                }
            }, 2500);
        }
    }

    function safelyLoadWebUrl(url) {
        const wv = window.getActiveWebView();
        if (!wv || !url) return;
        const tab = getActiveTab();
        if (isDownloadsUrl(url)) {
            if (tab) {
                clearLoadWatchdog(tab.id);
                tab.url = url;
                tab.title = 'İndirilenler';
                tab.isLoading = false;
                renderTabs();
            }
            try { wv.stop?.(); } catch (_) {}
            try { wv.src = BLANK_URL; } catch (_) {}
            updateAddressBar(url);
            updateNewTabPageVisibility(url);
            isWebviewLoading = false;
            navReload.innerHTML = '<span class="material-symbols-rounded">refresh</span>';
            return;
        }
        if (tab) {
            tab.loadRecoveryCount = 0;
            setTabLoading(tab.id, url !== BLANK_URL, url);
            scheduleLoadWatchdog(tab.id, url);
        }
        applyPreferredUserAgent(wv, url);
        try {
            const maybe = wv.loadURL(url);
            if (maybe && typeof maybe.catch === 'function') {
                maybe.catch((err) => {
                    const code = String(err?.code || err?.message || '');
                    if (code.includes('ERR_ABORTED') || code.includes('-3')) return;
                    console.warn('[WEB] loadURL failed:', err?.message || err);
                });
            }
        } catch (err) {
            const code = String(err?.code || err?.message || '');
            if (code.includes('ERR_ABORTED') || code.includes('-3')) return;
            console.warn('[WEB] loadURL failed:', err?.message || err);
        }
    }

    // --- Tab Management ---
    function createTab(url = BLANK_URL, makeActive = true) {
        const id = generateId();
        const isDownloadsTab = isDownloadsUrl(url);
        
        // Create WebView Element
        const wv = document.createElement('webview');
        wv.id = 'webview-' + id;
        wv.setAttribute('allowpopups', '');
        wv.setAttribute('partition', 'persist:ardali-web');
        
        applyPreferredUserAgent(wv, url);
        wv.src = isDownloadsTab ? BLANK_URL : url;
        
        const container = document.getElementById('webViewsContainer');
        if (container) {
            container.appendChild(wv);
        }

        const tab = { 
            id, 
            url, 
            title: isDownloadsTab ? 'İndirilenler' : (url === BLANK_URL ? NEW_TAB_TITLE : 'Yükleniyor...'), 
            isLoading: url !== BLANK_URL && !isDownloadsTab,
            favicon: '',
            zoomFactor: 1.0,
            isPlayingMedia: false,
            lastActive: Date.now()
        };
        
        // Attach Events
        bindWebBrowserEvents(wv, tab.id);
        if (typeof window.bindWebViewEvents === 'function') {
            window.bindWebViewEvents(wv);
        }
        wv.addEventListener('media-started-playing', () => { tab.isPlayingMedia = true; });
        wv.addEventListener('media-paused', () => { tab.isPlayingMedia = false; });

        tabs.push(tab);
        renderTabs();
        if (makeActive) {
            activateTab(tab.id);
        }
        return tab;
    }

    function removeTab(id) {
        tabs = tabs.filter(t => t.id !== id);
        
        // Remove Webview from DOM
        const wv = document.getElementById('webview-' + id);
        if (wv) wv.remove();

        if (tabs.length === 0) {
            createTab();
        } else if (activeTabId === id) {
            // Activate the last tab
            activateTab(tabs[tabs.length - 1].id);
        } else {
            renderTabs();
        }
    }

    function activateTab(id) {
        activeTabId = id;
        const tab = tabs.find(t => t.id === id);
        if (!tab) return;
        
        tab.lastActive = Date.now();
        
        // Re-awaken discarded tab
        let wv = document.getElementById('webview-' + id);
        if (!wv) {
            wv = document.createElement('webview');
            wv.id = 'webview-' + id;
            wv.setAttribute('allowpopups', '');
            wv.setAttribute('partition', 'persist:ardali-web');
            
            applyPreferredUserAgent(wv, tab.url);
            wv.src = isDownloadsUrl(tab.url) ? BLANK_URL : tab.url;
            const container = document.getElementById('webViewsContainer');
            if (container) container.appendChild(wv);
            
            bindWebBrowserEvents(wv, tab.id);
            if (typeof window.bindWebViewEvents === 'function') {
                window.bindWebViewEvents(wv);
            }
            wv.addEventListener('media-started-playing', () => { tab.isPlayingMedia = true; });
            wv.addEventListener('media-paused', () => { tab.isPlayingMedia = false; });
        }

        renderTabs();
        
        const allWVs = document.querySelectorAll('.webviews-container webview');
        allWVs.forEach(w => w.classList.remove('active'));
        if (wv) wv.classList.add('active');
        
        updateAddressBar(tab.url);
        updateNewTabPageVisibility(tab.url);
    }

    function getActiveTab() {
        return tabs.find(t => t.id === activeTabId);
    }

    function getTabById(tabId) {
        return tabs.find(t => t.id === tabId);
    }

    function updateActiveTabState(url, title) {
        const tab = getActiveTab();
        if (tab) {
            tab.url = url;
            if (isDownloadsUrl(url)) {
                tab.title = 'İndirilenler';
                tab.isLoading = false;
            } else if (url === BLANK_URL) {
                tab.title = NEW_TAB_TITLE;
            } else if (title) {
                tab.title = title;
            }
            renderTabs();
            updateAddressBar(url);
            updateNewTabPageVisibility(url);
        }
    }

    function updateAddressBar(url) {
        if (url === BLANK_URL) {
            addressInput.value = '';
        } else {
            addressInput.value = url;
        }
        
        // Update Bookmark Icon
        const addressBookmarkBtn = document.getElementById('webAddressBookmark');
        if (addressBookmarkBtn) {
            const icon = addressBookmarkBtn.querySelector('.material-symbols-rounded');
            let bookmarks = [];
            try {
                bookmarks = JSON.parse(localStorage.getItem('ardali_bookmarks') || '[]');
            } catch(e) {}
            
            if (url !== BLANK_URL && bookmarks.includes(url)) {
                icon.style.fontVariationSettings = "'FILL' 1";
                icon.style.color = 'var(--accent-primary, #00ffcc)';
            } else {
                icon.style.fontVariationSettings = "'FILL' 0";
                icon.style.color = '';
            }
        }

        // Update Site Info Popup Content
        const securityBtn = document.querySelector('.web-address-security');
        const securityIcon = securityBtn?.querySelector('.material-symbols-rounded');
        const popupIcon = document.getElementById('siteInfoSecurityIconPopup');
        const popupDomain = document.getElementById('siteInfoDomain');
        const popupStatus = document.getElementById('siteInfoStatus');

        if (securityBtn && securityIcon && popupIcon && popupDomain && popupStatus) {
            // Ensure app icon img element exists
            let appIconImg = securityBtn.querySelector('.app-logo-icon');
            if (!appIconImg) {
                appIconImg = document.createElement('img');
                appIconImg.src = 'icons/app/ardali_256.png';
                appIconImg.className = 'app-logo-icon';
                appIconImg.style.width = '18px';
                appIconImg.style.height = '18px';
                appIconImg.style.objectFit = 'contain';
                appIconImg.style.display = 'none';
                securityBtn.insertBefore(appIconImg, securityIcon);
            }

            if (url === BLANK_URL || url === '') {
                appIconImg.style.display = 'block';
                securityIcon.style.display = 'none';
                securityBtn.title = 'ArDali WebMedia';
                popupDomain.textContent = 'ArDali WebMedia';
                popupStatus.textContent = 'Yeni Sekme';
                popupIcon.textContent = 'home';
                popupIcon.className = 'material-symbols-rounded site-info-icon';
                popupStatus.className = 'site-info-status';
            } else {
                appIconImg.style.display = 'none';
                securityIcon.style.display = 'block';
                securityBtn.title = 'Site Ayarları';
                try {
                    const parsed = new URL(url);
                    popupDomain.textContent = parsed.hostname;
                    if (parsed.protocol === 'https:') {
                        securityIcon.textContent = 'tune';
                        securityIcon.style.color = 'var(--text-primary, #fff)';
                        popupStatus.textContent = 'Bağlantı güvenli';
                        popupIcon.textContent = 'lock';
                        popupIcon.className = 'material-symbols-rounded site-info-icon secure';
                        popupStatus.className = 'site-info-status secure';
                    } else if (parsed.protocol === 'http:') {
                        securityIcon.textContent = 'tune';
                        securityIcon.style.color = 'var(--accent-danger, #ff4444)';
                        popupStatus.textContent = 'Bu siteye bağlantınız güvenli değil';
                        popupIcon.textContent = 'warning';
                        popupIcon.className = 'material-symbols-rounded site-info-icon';
                        popupStatus.className = 'site-info-status';
                        popupStatus.style.color = 'var(--accent-danger, #ff4444)';
                    } else {
                        securityIcon.textContent = 'tune';
                        securityIcon.style.color = '';
                        popupStatus.textContent = 'Yerel/Özel sayfa';
                        popupIcon.textContent = 'info';
                        popupIcon.className = 'material-symbols-rounded site-info-icon';
                        popupStatus.className = 'site-info-status';
                        popupStatus.style.color = '';
                    }
                } catch(e) {
                    securityIcon.textContent = 'tune';
                    popupDomain.textContent = url;
                    popupStatus.textContent = 'Bilinmeyen bağlantı';
                }
            }
        }
    }

    function updateNewTabPageVisibility(url) {
        window.dispatchEvent(new CustomEvent('ardali:tab-url-changed', { detail: url }));
        const wv = window.getActiveWebView();
        const downloadsPage = document.getElementById('webDownloadsPage');
        const tab = getActiveTab();
        
        if (url === 'ardali://downloads') {
            newTabPage.classList.remove('active');
            if (wv) wv.style.visibility = 'hidden';
            if (downloadsPage) downloadsPage.classList.remove('hidden');
            if (tab) {
                clearLoadWatchdog(tab.id);
                tab.title = 'İndirilenler';
                tab.isLoading = false;
            }
            isWebviewLoading = false;
            navReload.innerHTML = '<span class="material-symbols-rounded">refresh</span>';
            renderTabs();
        } else if (url === BLANK_URL || url === '') {
            newTabPage.classList.add('active');
            if (wv) wv.style.visibility = 'hidden';
            if (downloadsPage) downloadsPage.classList.add('hidden');
            setTimeout(() => ntpSearchInput.focus(), 50);
        } else {
            newTabPage.classList.remove('active');
            if (wv) wv.style.visibility = 'visible';
            if (downloadsPage) downloadsPage.classList.add('hidden');
        }
        
        // Restore Zoom
        if (tab) {
            setWebviewZoomFactorSafe(wv, tab.zoomFactor || 1.0);
            updateZoomUI(tab.zoomFactor || 1.0);
        }
    }

    function renderBookmarks() {
        const bookmarksStrip = document.getElementById('webBookmarksStrip');
        if (!bookmarksStrip) return;
        
        const existing = bookmarksStrip.querySelectorAll('.web-bookmark-btn');
        existing.forEach(el => el.remove());

        let bookmarks = [];
        try {
            bookmarks = JSON.parse(localStorage.getItem('ardali_bookmarks') || '[]');
        } catch(e) {}

        bookmarks.forEach(url => {
            const btn = document.createElement('button');
            btn.className = 'web-bookmark-btn';
            
            try {
                const domain = new URL(url).hostname;
                btn.title = domain;
            } catch(e) {
                btn.title = url;
            }
            
            const img = document.createElement('img');
            try {
                const domain = new URL(url).hostname;
                if (domain.includes('whatsapp.com')) {
                    img.src = 'icons/app/whatsapp.png';
                } else {
                    img.src = `https://icons.duckduckgo.com/ip3/${domain}.ico`;
                    img.onerror = () => { 
                        if (img.src.includes('duckduckgo.com')) {
                            img.src = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
                        } else if (img.src.includes('google.com')) {
                            img.src = 'icons/app/ardali_256.png';
                        }
                    };
                }
            } catch(e) {
                img.src = 'icons/app/ardali_256.png';
            }
            
            btn.appendChild(img);
            
            btn.onclick = () => {
                const tab = getActiveTab();
                const wv = window.getActiveWebView();
                if (tab && wv) {
                    tab.url = url;
                    applyPreferredUserAgent(wv, url);
                    wv.src = url;
                    updateAddressBar(url);
                    updateNewTabPageVisibility(url);
                    renderTabs();
                } else {
                    createTab(url);
                }
            };
            
            bookmarksStrip.appendChild(btn);
        });
    }

    // --- Rendering ---
    function renderTabs() {
        const currentTabNodes = Array.from(webTabsList.querySelectorAll('.web-tab'));
        const validTabIds = new Set(tabs.map(t => t.id));

        currentTabNodes.forEach(node => {
            if (!validTabIds.has(node.dataset.tabId)) {
                node.remove();
            }
        });

        tabs.forEach((tab, index) => {
            const isTabActive = tab.id === activeTabId;
            let tabEl = webTabsList.querySelector(`.web-tab[data-tab-id="${tab.id}"]`);
            
            if (!tabEl) {
                tabEl = document.createElement('div');
                tabEl.dataset.tabId = tab.id;
                
                const titleEl = document.createElement('span');
                titleEl.className = 'web-tab-title';
                
                const closeBtn = document.createElement('button');
                closeBtn.className = 'web-tab-close';
                closeBtn.innerHTML = '<span class="material-symbols-rounded">close</span>';
                closeBtn.onclick = (e) => {
                    e.stopPropagation();
                    removeTab(tab.id);
                };
                
                tabEl.appendChild(titleEl);
                tabEl.appendChild(closeBtn);
                tabEl.onclick = () => activateTab(tab.id);
            }
            
            if (webTabsList.children[index] !== tabEl) {
                webTabsList.insertBefore(tabEl, webTabsList.children[index]);
                
                // Chrome'un Flexbox animasyonlarını atlamasını kesin olarak engellemek için doğrudan JS ile canlandır
                try {
                    tabEl.animate([
                        { maxWidth: '0px', minWidth: '0px', flexGrow: 0, paddingLeft: '0px', paddingRight: '0px', marginRight: '0px', opacity: 0 },
                        { maxWidth: '240px', minWidth: '120px', flexGrow: 1, paddingLeft: '8px', paddingRight: '8px', marginRight: '4px', opacity: 1 }
                    ], {
                        duration: 450,
                        easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)'
                    });
                } catch (e) {
                    console.log('Animation API not supported');
                }
            }
            
            tabEl.className = `web-tab ${isTabActive ? 'active' : ''}`;
            
            const titleEl = tabEl.querySelector('.web-tab-title');
            if (titleEl.textContent !== tab.title) {
                titleEl.textContent = tab.title;
            }
            
            const currentSpinner = tabEl.querySelector('.web-tab-icon-spinner');
            const currentImg = tabEl.querySelector('img.web-tab-icon');
            const currentIsLoading = currentSpinner !== null;
            const hasIcon = currentSpinner !== null || currentImg !== null;
            const currentFavicon = currentImg ? currentImg.src : null;
            
            let faviconSrc = 'icons/app/ardali_256.png';
            if (!tab.isLoading) {
                if (tab.url && isValidUrl(tab.url) && new URL(tab.url).hostname.includes('whatsapp.com')) {
                    faviconSrc = 'icons/app/whatsapp.png';
                } else if (tab.url && tab.url.startsWith('ardali://downloads')) {
                    faviconSrc = 'icons/ui/download-save.svg';
                } else if (tab.favicon) {
                    faviconSrc = tab.favicon;
                } else if (tab.url !== BLANK_URL && isValidUrl(tab.url)) {
                    try {
                        const domain = new URL(tab.url).hostname;
                        faviconSrc = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
                    } catch(e) {}
                }
            }
            
            const needsUpdate = !hasIcon || tab.isLoading !== currentIsLoading || (!tab.isLoading && faviconSrc !== currentFavicon && !(faviconSrc.includes('ardali_256') && currentFavicon && currentFavicon.includes('ardali_256')));
            
            if (needsUpdate) {
                if (currentSpinner) currentSpinner.remove();
                if (currentImg) currentImg.remove();
                
                let iconEl;
                if (tab.isLoading) {
                    iconEl = document.createElement('div');
                    iconEl.className = 'web-tab-icon-spinner';
                    iconEl.innerHTML = `
                        <svg viewBox="25 25 50 50" xmlns="http://www.w3.org/2000/svg">
                            <circle cx="50" cy="50" r="20" fill="none" stroke-width="5" stroke-linecap="round" stroke-miterlimit="10"/>
                        </svg>
                    `;
                } else {
                    iconEl = document.createElement('img');
                    iconEl.className = 'web-tab-icon';
                    iconEl.src = faviconSrc;
                    iconEl.onerror = () => {
                        if (tab.url !== BLANK_URL && isValidUrl(tab.url)) {
                            try {
                                const domain = new URL(tab.url).hostname;
                                const googleUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
                                let directUrl = `https://${domain}/favicon.ico`;
                                if (domain.includes('whatsapp.com')) {
                                    directUrl = 'icons/app/whatsapp.png';
                                }
                                
                                if (iconEl.src.includes('google.com/s2')) iconEl.dataset.triedGoogle = 'true';
                                if (iconEl.src.includes('favicon.ico')) iconEl.dataset.triedDirect = 'true';
                                
                                if (!iconEl.dataset.triedDirect) {
                                    iconEl.dataset.triedDirect = 'true';
                                    iconEl.src = directUrl;
                                } else if (!iconEl.dataset.triedGoogle) {
                                    iconEl.dataset.triedGoogle = 'true';
                                    iconEl.src = googleUrl;
                                } else {
                                    iconEl.onerror = null;
                                    iconEl.src = 'icons/app/ardali_256.png';
                                }
                            } catch(e) {
                                iconEl.onerror = null;
                                iconEl.src = 'icons/app/ardali_256.png';
                            }
                        } else {
                            iconEl.onerror = null;
                            iconEl.src = 'icons/app/ardali_256.png';
                        }
                    };
                }
                tabEl.insertBefore(iconEl, titleEl);
            }
        });
        
        if (webTabNewBtn) {
            webTabsList.appendChild(webTabNewBtn);
        }
    }

    // --- Events ---
    // Webview Events
    function bindWebBrowserEvents(wv, tabId) {
        wv.addEventListener('dom-ready', () => {
            wv.__ardaliDomReady = true;
            const tab = tabs.find(t => t.id === tabId);
            if (tab) {
                setWebviewZoomFactorSafe(wv, tab.zoomFactor || 1.0);
            }
            scheduleBlankPageRecovery(tabId);
        });

        wv.addEventListener('did-start-loading', () => {
            if (isDownloadsUrl(getTabById(tabId)?.url)) {
                setTabLoading(tabId, false, 'ardali://downloads');
                return;
            }
            clearBlankPageChecks(tabId);
            if (activeTabId === tabId) {
                isWebviewLoading = true;
                navReload.innerHTML = '<span class="material-symbols-rounded">close</span>';
            }
            const tab = tabs.find(t => t.id === tabId);
            if (tab) {
                const currentUrl = String(wv.getURL?.() || '').trim();
                if (currentUrl === BLANK_URL || currentUrl === '') {
                    tab.isLoading = false;
                    clearLoadWatchdog(tabId);
                } else {
                    tab.isLoading = true;
                    tab.loadStartedAt = Date.now();
                    if (parseHttpUrl(currentUrl)) tab.url = currentUrl;
                    scheduleLoadWatchdog(tabId, tab.url);
                }
                if (activeTabId === tabId) renderTabs();
            }
        });

        wv.addEventListener('did-stop-loading', () => {
            if (isDownloadsUrl(getTabById(tabId)?.url)) {
                setTabLoading(tabId, false, 'ardali://downloads');
                return;
            }
            clearLoadWatchdog(tabId);
            const tab = tabs.find(t => t.id === tabId);
            if (tab) {
                tab.isLoading = false;
            }
            
            if (activeTabId === tabId) {
                isWebviewLoading = false;
                renderTabs();
                navReload.innerHTML = '<span class="material-symbols-rounded">refresh</span>';
                navBack.disabled = !wv.canGoBack();
                navForward.disabled = !wv.canGoForward();
                updateActiveTabState(wv.getURL(), wv.getTitle());
            }
            scheduleBlankPageRecovery(tabId);
        });

        wv.addEventListener('did-finish-load', () => {
            if (isDownloadsUrl(getTabById(tabId)?.url)) {
                setTabLoading(tabId, false, 'ardali://downloads');
                return;
            }
            clearLoadWatchdog(tabId);
            const tab = tabs.find(t => t.id === tabId);
            if (tab) {
                tab.isLoading = false;
                const currentUrl = wv.getURL();
                if (currentUrl) tab.url = currentUrl;
                if (activeTabId === tabId) updateActiveTabState(currentUrl, wv.getTitle());
            }
            scheduleBlankPageRecovery(tabId);
        });

        wv.addEventListener('did-fail-load', (e) => {
            if (isDownloadsUrl(getTabById(tabId)?.url)) {
                setTabLoading(tabId, false, 'ardali://downloads');
                return;
            }
            if (e?.isMainFrame === false) return;
            const code = Number(e?.errorCode);
            const failedUrl = String(e?.validatedURL || wv.getURL?.() || '').trim();
            if (code === -3) {
                setTabLoading(tabId, false, failedUrl);
                return;
            }
            clearLoadWatchdog(tabId);
            const transientCodes = new Set([-6, -7, -21, -105, -106, -118, -137, -202, -324]);
            if (transientCodes.has(code)) {
                const tab = tabs.find(t => t.id === tabId);
                if (tab && Number(tab.loadRecoveryCount || 0) < 2) {
                    if (failedUrl) tab.url = failedUrl;
                    recoverWebviewLoad(tabId, `did-fail-load:${code}`);
                    return;
                }
            }
            setTabLoading(tabId, false, failedUrl);
            if (activeTabId === tabId) {
                notifyWebBrowser(`Sayfa yüklenemedi (${code || 'hata'}).`, 'error');
            }
        });

        wv.addEventListener('page-title-updated', (e) => {
            if (activeTabId === tabId) updateActiveTabState(wv.getURL(), e.title);
        });

        wv.addEventListener('page-favicon-updated', (e) => {
            const tab = tabs.find(t => t.id === tabId);
            if (tab && e.favicons && e.favicons.length > 0) {
                tab.favicon = e.favicons[0];
                if (activeTabId === tabId) renderTabs();
            }
        });

        wv.addEventListener('new-window', (e) => {
            e.preventDefault();
            createTab(e.url);
        });

        wv.addEventListener('did-start-navigation', (e) => {
            if (isDownloadsUrl(getTabById(tabId)?.url)) {
                setTabLoading(tabId, false, 'ardali://downloads');
                return;
            }
            if (e.isMainFrame) {
                const tab = tabs.find(t => t.id === tabId);
                if (tab) {
                    tab.favicon = '';
                    tab.url = e.url || tab.url;
                    tab.isLoading = true;
                    tab.loadStartedAt = Date.now();
                    clearBlankPageChecks(tabId);
                    scheduleLoadWatchdog(tabId, tab.url);
                    if (activeTabId === tabId) {
                        updateAddressBar(tab.url);
                        updateNewTabPageVisibility(tab.url);
                    }
                    if (activeTabId === tabId) renderTabs();
                }
            }
        });

        wv.addEventListener('did-navigate', (e) => {
            if (isDownloadsUrl(getTabById(tabId)?.url)) {
                setTabLoading(tabId, false, 'ardali://downloads');
                return;
            }
            if (e?.isMainFrame === false) return;
            const tab = tabs.find(t => t.id === tabId);
            if (!tab) return;
            tab.url = e.url || wv.getURL() || tab.url;
            if (activeTabId === tabId) updateActiveTabState(tab.url, wv.getTitle());
        });

        wv.addEventListener('did-navigate-in-page', (e) => {
            if (isDownloadsUrl(getTabById(tabId)?.url)) {
                setTabLoading(tabId, false, 'ardali://downloads');
                return;
            }
            if (e?.isMainFrame === false) return;
            const tab = tabs.find(t => t.id === tabId);
            if (!tab) return;
            tab.url = e.url || wv.getURL() || tab.url;
            if (activeTabId === tabId) updateActiveTabState(tab.url, wv.getTitle());
        });

        wv.addEventListener('render-process-gone', () => recreateWebviewForTab(tabId, 'render-process-gone'));
        wv.addEventListener('crashed', () => recreateWebviewForTab(tabId, 'crashed'));

        wv.addEventListener('ipc-message', (e) => {
            if (e.channel === 'ardali-webview-zoom-scroll') {
                const direction = e.args[0]; // -1 or 1
                handleWebviewZoomScroll(tabId, direction);
            } else if (e.channel === 'ardali-webview-pointer-down') {
                window.dispatchEvent(new CustomEvent('ardali:webview-pointer-down', { detail: { tabId } }));
            }
        });
    }

    // UI Events
    webTabNewBtn.onclick = () => createTab();
    
    // Zoom UI Events
    if (webAddressZoom) {
        webAddressZoom.addEventListener('click', (e) => {
            e.stopPropagation();
            clearTimeout(window.zoomPopupTimeout);
            if (webZoomPopup.classList.contains('hidden')) {
                webZoomPopup.classList.remove('hidden');
                webAddressZoom.classList.add('active');
            } else {
                webZoomPopup.classList.add('hidden');
                const tab = getActiveTab();
                if (tab && tab.zoomFactor === 1.0) {
                    webAddressZoom.classList.add('hidden');
                    webAddressZoom.classList.remove('active');
                }
            }
        });
    }

    if (webZoomOutBtn) {
        webZoomOutBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            clearTimeout(window.zoomPopupTimeout);
            handleWebviewZoomScroll(activeTabId, -1);
            // Don't let handleWebviewZoomScroll set a new auto-hide timeout if they manually clicked
            clearTimeout(window.zoomPopupTimeout);
        });
    }

    if (webZoomInBtn) {
        webZoomInBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            clearTimeout(window.zoomPopupTimeout);
            handleWebviewZoomScroll(activeTabId, 1);
            clearTimeout(window.zoomPopupTimeout);
        });
    }

    if (webZoomResetBtn) {
        webZoomResetBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            clearTimeout(window.zoomPopupTimeout);
            const tab = getActiveTab();
            if (tab) {
                tab.zoomFactor = 1.0;
                const wv = window.getActiveWebView();
                setWebviewZoomFactorSafe(wv, 1.0);
                updateZoomUI(1.0);
                webZoomPopup.classList.add('hidden');
            }
        });
    }

    // Close zoom popup when clicking outside
    document.addEventListener('click', (e) => {
        if (webZoomPopup && !webZoomPopup.classList.contains('hidden')) {
            if (!webZoomPopup.contains(e.target) && e.target !== webAddressZoom && !webAddressZoom.contains(e.target)) {
                webZoomPopup.classList.add('hidden');
                const tab = getActiveTab();
                if (tab && tab.zoomFactor === 1.0) {
                    webAddressZoom.classList.add('hidden');
                    webAddressZoom.classList.remove('active');
                }
            }
        }
    });
    
    navBack.onclick = () => { const wv = window.getActiveWebView(); if (wv && wv.canGoBack()) wv.goBack(); };
    navForward.onclick = () => { const wv = window.getActiveWebView(); if (wv && wv.canGoForward()) wv.goForward(); };
    navReload.onclick = () => {
        const wv = window.getActiveWebView();
        if (!wv) return;
        if (isWebviewLoading) wv.stop();
        else if (getActiveTab()?.url === 'ardali://downloads') return;
        else if (wv.getURL() !== BLANK_URL) wv.reload();
    };
    navHome.onclick = () => {
        const tab = getActiveTab();
        if (tab) {
            tab.url = BLANK_URL;
            tab.title = NEW_TAB_TITLE;
            const wv = window.getActiveWebView();
            if (wv) wv.src = BLANK_URL;
            updateAddressBar(BLANK_URL);
            updateNewTabPageVisibility(BLANK_URL);
            renderTabs();
        }
    };

    const addressBookmarkBtn = document.getElementById('webAddressBookmark');
    if (addressBookmarkBtn) {
        addressBookmarkBtn.onclick = () => {
            const icon = addressBookmarkBtn.querySelector('.material-symbols-rounded');
            const tab = getActiveTab();
            if (!tab || tab.url === BLANK_URL) return;
            
            let bookmarks = [];
            try {
                bookmarks = JSON.parse(localStorage.getItem('ardali_bookmarks') || '[]');
            } catch(e) {}

            if (icon.style.fontVariationSettings.includes('1')) {
                icon.style.fontVariationSettings = "'FILL' 0";
                icon.style.color = '';
                bookmarks = bookmarks.filter(url => url !== tab.url);
            } else {
                icon.style.fontVariationSettings = "'FILL' 1";
                icon.style.color = 'var(--accent-primary, #00ffcc)';
                if (!bookmarks.includes(tab.url)) bookmarks.push(tab.url);
            }
            
            localStorage.setItem('ardali_bookmarks', JSON.stringify(bookmarks));
            renderBookmarks();
        };
    }
    
    const securityBtn = document.querySelector('.web-address-security');
    const siteInfoPopup = document.getElementById('siteInfoPopup');
    const siteInfoCookiesBtn = document.getElementById('siteInfoCookiesBtn');
    if (securityBtn && siteInfoPopup) {
        securityBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            siteInfoPopup.classList.toggle('hidden');
        });

        document.addEventListener('click', (e) => {
            if (!siteInfoPopup.contains(e.target) && !securityBtn.contains(e.target)) {
                siteInfoPopup.classList.add('hidden');
            }
        });

        if (siteInfoCookiesBtn) {
            siteInfoCookiesBtn.addEventListener('click', async () => {
                siteInfoPopup.classList.add('hidden');
                if (!addressInput.value || addressInput.value === BLANK_URL) return;
                try {
                    const origin = new URL(addressInput.value).origin;
                    const result = await window.ardali?.webSecurity?.clearData?.({ cookies: true, origin: origin });
                    if (result && window.ardali?.notify) {
                        window.ardali.notify('Çerezler temizlendi', 'success');
                    } else {
                        // Fallback using alert if notify is not directly available here
                        alert('Çerezler temizlendi.');
                    }
                    safelyLoadWebUrl(addressInput.value); // Reload to apply changes
                } catch (e) {
                    console.error('Cookie clear error:', e);
                }
            });
        }
    }

    const extensionsBtn = document.getElementById('webNavExtensions');
    if (extensionsBtn) {
        extensionsBtn.onclick = () => {
            alert('Eklentiler özelliği yakında eklenecektir.');
        };
    }

    const addressSuggestions = document.getElementById('webAddressSuggestions');
    let suggestionTimeout;

    addressInput.addEventListener('input', (e) => {
        clearTimeout(suggestionTimeout);
        const query = addressInput.value.trim();
        if (!query || isValidUrl(query)) {
            addressSuggestions.classList.add('hidden');
            return;
        }
        
        suggestionTimeout = setTimeout(async () => {
            try {
                const response = await fetch(`https://duckduckgo.com/ac/?q=${encodeURIComponent(query)}`);
                const data = await response.json();
                
                if (data && data.length > 0) {
                    addressSuggestions.innerHTML = '';
                    data.forEach(item => {
                        const div = document.createElement('div');
                        div.className = 'web-suggestion-item';
                        div.innerHTML = `<span class="material-symbols-rounded">search</span> <span>${item.phrase}</span>`;
                        div.onmousedown = (e) => {
                            e.preventDefault();
                            addressInput.value = item.phrase;
                            addressSuggestions.classList.add('hidden');
                            safelyLoadWebUrl(formatUrl(item.phrase));
                        };
                        addressSuggestions.appendChild(div);
                    });
                    addressSuggestions.classList.remove('hidden');
                } else {
                    addressSuggestions.classList.add('hidden');
                }
            } catch (err) {
                addressSuggestions.classList.add('hidden');
            }
        }, 300);
    });

    addressInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            let url = addressInput.value.trim();
            if (url === 'ardali://downloads') {
                safelyLoadWebUrl(url);
                addressInput.blur();
                addressSuggestions.classList.add('hidden');
                return;
            }
            if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('about:') && !url.startsWith('ardali:')) {
                url = formatUrl(url);
            }
            safelyLoadWebUrl(url);
            updateAddressBar(url);
            addressInput.blur();
            addressSuggestions.classList.add('hidden');
        }
    });

    addressInput.addEventListener('focus', () => {
        addressInput.select();
        if (addressInput.value.trim() && !isValidUrl(addressInput.value.trim())) {
             addressInput.dispatchEvent(new Event('input'));
        }
    });

    addressInput.addEventListener('blur', () => {
        addressSuggestions.classList.add('hidden');
    });

    // New Tab Page Events
    const ntpSuggestions = document.getElementById('webNtpSuggestions');
    let ntpSuggestionTimeout;
    let ntpSelectedIndex = -1;
    let ntpOriginalQuery = '';

    ntpSearchInput.addEventListener('input', (e) => {
        ntpSelectedIndex = -1;
        ntpOriginalQuery = ntpSearchInput.value;
        clearTimeout(ntpSuggestionTimeout);
        const query = ntpSearchInput.value.trim();
        if (!query || isValidUrl(query)) {
            if (ntpSuggestions) ntpSuggestions.classList.add('hidden');
            return;
        }
        
        ntpSuggestionTimeout = setTimeout(async () => {
            if (!ntpSuggestions) return;
            try {
                const response = await fetch(`https://duckduckgo.com/ac/?q=${encodeURIComponent(query)}`);
                const data = await response.json();
                
                if (data && data.length > 0) {
                    ntpSuggestions.innerHTML = '';
                    data.forEach(item => {
                        const div = document.createElement('div');
                        div.className = 'web-suggestion-item';
                        div.dataset.phrase = item.phrase;
                        div.innerHTML = `<span class="material-symbols-rounded">search</span> <span>${item.phrase}</span>`;
                        div.onmousedown = (e) => {
                            e.preventDefault();
                            ntpSearchInput.value = '';
                            ntpSuggestions.classList.add('hidden');
                            safelyLoadWebUrl(formatUrl(item.phrase));
                        };
                        ntpSuggestions.appendChild(div);
                    });
                    ntpSuggestions.classList.remove('hidden');
                } else {
                    ntpSuggestions.classList.add('hidden');
                }
            } catch (err) {
                ntpSuggestions.classList.add('hidden');
            }
        }, 300);
    });

    ntpSearchInput.addEventListener('keydown', (e) => {
        const items = ntpSuggestions ? ntpSuggestions.querySelectorAll('.web-suggestion-item') : [];
        if (items.length > 0 && !ntpSuggestions.classList.contains('hidden')) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                ntpSelectedIndex = ntpSelectedIndex + 1;
                if (ntpSelectedIndex >= items.length) ntpSelectedIndex = -1;
                updateNtpSuggestionSelection(items);
                return;
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                ntpSelectedIndex = ntpSelectedIndex - 1;
                if (ntpSelectedIndex < -1) ntpSelectedIndex = items.length - 1;
                updateNtpSuggestionSelection(items);
                return;
            }
        }

        if (e.key === 'Enter') {
            e.preventDefault();
            if (ntpSelectedIndex >= 0 && ntpSelectedIndex < items.length && !ntpSuggestions.classList.contains('hidden')) {
                const phrase = items[ntpSelectedIndex].dataset.phrase;
                safelyLoadWebUrl(formatUrl(phrase));
            } else {
                const query = ntpSearchInput.value.trim();
                if (!query) return;
                const url = formatUrl(query);
                safelyLoadWebUrl(url);
            }
            ntpSearchInput.value = '';
            if (ntpSuggestions) ntpSuggestions.classList.add('hidden');
            ntpSelectedIndex = -1;
        }
    });

    function updateNtpSuggestionSelection(items) {
        items.forEach((item, index) => {
            if (index === ntpSelectedIndex) {
                item.classList.add('selected');
                ntpSearchInput.value = item.dataset.phrase;
            } else {
                item.classList.remove('selected');
            }
        });
        if (ntpSelectedIndex === -1) {
            ntpSearchInput.value = ntpOriginalQuery;
        }
    }

    ntpSearchInput.addEventListener('focus', () => {
        if (ntpSearchInput.value.trim() && !isValidUrl(ntpSearchInput.value.trim())) {
             ntpSearchInput.dispatchEvent(new Event('input'));
        }
    });

    ntpSearchInput.addEventListener('blur', () => {
        if (ntpSuggestions) ntpSuggestions.classList.add('hidden');
    });

    function updateNtpSearchEngineUI(engineId) {
        const dd = document.getElementById('ntpWebSearchEngine');
        if (dd) {
            const opt = dd.querySelector(`.custom-dropdown-option[data-value="${engineId}"]`);
            if (opt) {
                dd.value = engineId;
                const currentIcon = dd.querySelector('.custom-dropdown-icon');
                dd.querySelectorAll('.custom-dropdown-option').forEach(o => o.classList.remove('selected'));
                opt.classList.add('selected');
                if (currentIcon && opt.querySelector('img')) currentIcon.src = opt.querySelector('img').src;
            }
        }
    }

    // Initialize UI
    updateNtpSearchEngineUI(currentSearchEngine);

    // --- Memory Saver (Tab Discarding) ---
    setInterval(() => {
        const now = Date.now();
        const DISCARD_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
        
        tabs.forEach(tab => {
            if (tab.id === activeTabId) return; // Never discard active tab
            if (tab.isPlayingMedia) return; // Never discard media playing tab
            
            if (now - tab.lastActive > DISCARD_THRESHOLD_MS) {
                const wv = document.getElementById('webview-' + tab.id);
                if (wv) {
                    wv.remove(); // Remove from DOM to free RAM
                    console.log(`[Memory Saver] Tab ${tab.id} discarded to save RAM.`);
                }
            }
        });
    }, 60 * 1000); // Check every minute

    // Initialize first tab AFTER all scripts are fully loaded
    setTimeout(() => {
        createTab();
        renderBookmarks();
    }, 50);
});
