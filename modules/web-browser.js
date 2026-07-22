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
    const navPasswords = document.getElementById('webNavPasswords');
    const addressInput = document.getElementById('webAddressInput');

    navPasswords?.addEventListener('click', () => window.ardali?.credentialVault?.openManager?.());

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
    const closedTabs = [];
    const mutedSiteHosts = new Set();
    const WEB_SESSION_STORAGE_KEY = 'ardali_web_tabs_session_v1';
    const BOOKMARK_FAVICONS_STORAGE_KEY = 'ardali_bookmark_favicons_v1';
    const NTP_SITE_VISITS_STORAGE_KEY = 'ardali_ntp_site_visits_v1';
    const MAX_RESTORED_TABS = 30;
    let restoreLastSessionEnabled = true;
    let isRestoringSession = false;
    let sessionPersistTimer = 0;
    const restoredTabPreloadTimers = new Set();
    let splitTabId = null;
    let verticalTabsEnabled = false;
    const LOAD_STALL_MS = 30000;
    const BLANK_PAGE_CHECK_MS = 900;
    const BLANK_PAGE_SECOND_CHECK_MS = 2800;

    window.addEventListener('ardali:settings-changed', (e) => {
        if (e.detail && e.detail.webSearchEngine) {
            currentSearchEngine = e.detail.webSearchEngine;
            // Update UI selection on new tab page
            updateNtpSearchEngineUI(currentSearchEngine);
        }
    });

    window.addEventListener('ardali:languageChanged', () => {
        tabs.forEach((tab) => {
            if (tab.url === BLANK_URL) tab.title = browserText('newTab');
            else if (isDownloadsUrl(tab.url)) tab.title = browserText('downloads');
        });
        renderTabs();
    });

    const BLANK_URL = 'about:blank';
    const browserText = (key) => {
        const lang = String(document.documentElement.lang || navigator.language || 'en').toLowerCase();
        const locale = lang.startsWith('tr') ? 'tr' : (lang.startsWith('ar') ? 'ar' : 'en');
        const text = {
            tr: { newTab: 'Yeni Sekme', downloads: 'İndirilenler', loading: 'Yükleniyor...' },
            en: { newTab: 'New Tab', downloads: 'Downloads', loading: 'Loading...' },
            ar: { newTab: 'علامة تبويب جديدة', downloads: 'التنزيلات', loading: 'جارٍ التحميل...' }
        };
        return text[locale][key];
    };

    function recordSiteVisit(tab, rawUrl, rawTitle) {
        const parsed = parseHttpUrl(rawUrl);
        if (!parsed || !tab) return;
        const host = String(parsed.hostname || '').toLowerCase().replace(/^www\./, '');
        if (!host) return;
        const visitKey = `${host}${parsed.pathname}`;
        const now = Date.now();
        if (tab.lastRecordedVisitKey === visitKey && now - Number(tab.lastRecordedVisitAt || 0) < 10000) return;
        tab.lastRecordedVisitKey = visitKey; tab.lastRecordedVisitAt = now;
        try {
            const visits = JSON.parse(localStorage.getItem(NTP_SITE_VISITS_STORAGE_KEY) || '{}');
            const previous = visits[host] && typeof visits[host] === 'object' ? visits[host] : {};
            const title = String(rawTitle || previous.title || host).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60);
            visits[host] = { host, title: title || host, count: Math.min(100000, Number(previous.count || 0) + 1), lastVisit: now };
            const trimmed = Object.fromEntries(Object.entries(visits).sort((a, b) => Number(b[1]?.lastVisit) - Number(a[1]?.lastVisit)).slice(0, 200));
            localStorage.setItem(NTP_SITE_VISITS_STORAGE_KEY, JSON.stringify(trimmed));
            window.dispatchEvent(new CustomEvent('ardali:web-visit-recorded', { detail: visits[host] }));
        } catch (_) {}
    }

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

    function sanitizeSessionUrl(value) {
        const raw = String(value || '').trim();
        if (raw === BLANK_URL || raw === 'ardali://downloads') return raw;
        try {
            const parsed = new URL(raw);
            if (!['http:', 'https:'].includes(parsed.protocol)) return '';
            parsed.username = '';
            parsed.password = '';
            return parsed.toString().slice(0, 4096);
        } catch (_) {
            return '';
        }
    }

    function sanitizeSessionFavicon(value) {
        const raw = String(value || '').trim();
        if (!raw || raw.length > 8192) return '';
        if (/^icons\/[a-z0-9_./-]+\.(?:png|svg|ico)$/i.test(raw)) return raw;
        if (/^data:image\/(?:png|jpeg|webp|x-icon);base64,[a-z0-9+/=]+$/i.test(raw) && raw.length <= 8192) return raw;
        try {
            const parsed = new URL(raw);
            return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString().slice(0, 4096) : '';
        } catch (_) {
            return '';
        }
    }

    function getFallbackFaviconForUrl(value) {
        try {
            const host = new URL(String(value || '')).hostname.toLowerCase();
            if (!host) return 'icons/app/ardali_256.png';
            if (host.includes('whatsapp.com')) return 'icons/app/whatsapp.png';
            return `https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`;
        } catch (_) {
            return 'icons/app/ardali_256.png';
        }
    }

    function readBookmarkFavicons() {
        try {
            const saved = JSON.parse(localStorage.getItem(BOOKMARK_FAVICONS_STORAGE_KEY) || '{}');
            return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
        } catch (_) {
            return {};
        }
    }

    function saveBookmarkFavicon(url, favicon) {
        const safeUrl = sanitizeSessionUrl(url);
        const safeFavicon = sanitizeSessionFavicon(favicon);
        if (!safeUrl || !safeFavicon) return;
        const favicons = readBookmarkFavicons();
        favicons[safeUrl] = safeFavicon;
        const limited = Object.fromEntries(Object.entries(favicons).slice(-200));
        try { localStorage.setItem(BOOKMARK_FAVICONS_STORAGE_KEY, JSON.stringify(limited)); } catch (_) {}
    }

    function removeBookmarkFavicon(url) {
        const favicons = readBookmarkFavicons();
        if (!Object.prototype.hasOwnProperty.call(favicons, url)) return;
        delete favicons[url];
        try { localStorage.setItem(BOOKMARK_FAVICONS_STORAGE_KEY, JSON.stringify(favicons)); } catch (_) {}
    }

    function buildSessionSnapshot() {
        const cleanTabs = tabs.slice(0, MAX_RESTORED_TABS).map((tab) => ({
            url: sanitizeSessionUrl(tab.url),
            title: String(tab.title || browserText('newTab')).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 160),
            favicon: sanitizeSessionFavicon(tab.favicon) || (parseHttpUrl(tab.url) ? getFallbackFaviconForUrl(tab.url) : ''),
            pinned: tab.pinned === true,
            groupName: String(tab.groupName || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 60)
        })).filter((tab) => tab.url);
        const activeIndex = Math.max(0, tabs.findIndex((tab) => tab.id === activeTabId));
        return { version: 1, activeIndex: Math.min(activeIndex, Math.max(0, cleanTabs.length - 1)), tabs: cleanTabs, savedAt: Date.now() };
    }

    function persistTabSession(immediate = false) {
        if (isRestoringSession || !restoreLastSessionEnabled) return;
        clearTimeout(sessionPersistTimer);
        const write = () => {
            try { localStorage.setItem(WEB_SESSION_STORAGE_KEY, JSON.stringify(buildSessionSnapshot())); } catch (_) {}
        };
        if (immediate) write(); else sessionPersistTimer = setTimeout(write, 180);
    }

    function readRestorableSession() {
        if (!restoreLastSessionEnabled) return null;
        try {
            const parsed = JSON.parse(localStorage.getItem(WEB_SESSION_STORAGE_KEY) || 'null');
            if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.tabs)) return null;
            const cleanTabs = parsed.tabs.slice(0, MAX_RESTORED_TABS).map((tab) => ({
                url: sanitizeSessionUrl(tab?.url),
                title: String(tab?.title || browserText('newTab')).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 160),
                favicon: sanitizeSessionFavicon(tab?.favicon) || (parseHttpUrl(tab?.url) ? getFallbackFaviconForUrl(tab.url) : ''),
                pinned: tab?.pinned === true,
                groupName: String(tab?.groupName || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 60)
            })).filter((tab) => tab.url);
            if (!cleanTabs.length) return null;
            return { tabs: cleanTabs, activeIndex: Math.max(0, Math.min(cleanTabs.length - 1, Number(parsed.activeIndex) || 0)) };
        } catch (_) {
            return null;
        }
    }

    function restoreTabSession() {
        const snapshot = readRestorableSession();
        if (!snapshot) return false;
        isRestoringSession = true;
        const created = snapshot.tabs.map((saved) => {
            const tab = createTab(saved.url, false, { deferLoad: true });
            if (!tab) return null;
            tab.title = saved.title || tab.title;
            tab.restoreTitle = tab.title;
            tab.favicon = saved.favicon || getFallbackFaviconForUrl(saved.url);
            tab.pinned = saved.pinned;
            tab.groupName = saved.groupName;
            return tab;
        }).filter(Boolean);
        if (!created.length) { isRestoringSession = false; return false; }
        const activeTab = created[Math.min(snapshot.activeIndex, created.length - 1)];
        renderTabs();
        activateTab(activeTab.id);
        scheduleRestoredTabPreloads(created, activeTab.id);
        isRestoringSession = false;
        persistTabSession(true);
        return true;
    }

    function scheduleRestoredTabPreloads(restoredTabs, activeId) {
        const waitingTabs = restoredTabs.filter((tab) => (
            tab.id !== activeId && tab.deferredLoad && parseHttpUrl(tab.pendingRestoreUrl || tab.url)
        ));
        waitingTabs.forEach((tab, index) => {
            const timer = setTimeout(() => {
                restoredTabPreloadTimers.delete(timer);
                startDeferredTabLoad(tab.id, { background: true, reason: 'session-preload' });
            }, 500 + (index * 700));
            restoredTabPreloadTimers.add(timer);
        });
    }

    function startDeferredTabLoad(tabId, options = {}) {
        const tab = tabs.find((item) => item.id === tabId);
        const wv = getTabWebView(tabId);
        if (!tab || !wv || !tab.deferredLoad) return false;
        const targetUrl = sanitizeSessionUrl(tab.pendingRestoreUrl || tab.url);
        if (!parseHttpUrl(targetUrl)) {
            tab.deferredLoad = false;
            return false;
        }
        tab.deferredLoad = false;
        tab.restoreLoadFailed = false;
        tab.pendingRestoreUrl = targetUrl;
        runWhenWebviewReady(wv, () => {
            if (!wv.isConnected || !tabs.some((item) => item.id === tabId)) return;
            applyPreferredUserAgent(wv, targetUrl);
            try {
                if (options.background === true) {
                    try { wv.setAudioMuted(true); } catch (_) {}
                    tab.backgroundPreloadMuted = true;
                }
                tab.isLoading = true;
                tab.loadStartedAt = Date.now();
                wv.setAttribute('src', targetUrl);
                scheduleLoadWatchdog(tabId, targetUrl);
                renderTabs();
            } catch (_) {
                tab.restoreLoadFailed = true;
                tab.deferredLoad = true;
                tab.isLoading = false;
                renderTabs();
            }
        });
        return true;
    }

    async function setupDefaultBrowserBanner() {
        const banner = document.getElementById('webDefaultBrowserBanner');
        const button = document.getElementById('webMakeDefaultBrowserBtn');
        const dismiss = document.getElementById('webDefaultBrowserDismiss');
        const message = document.getElementById('webDefaultBrowserMessage');
        if (!banner || !button || !dismiss || !message || !window.ardali?.webSecurity?.getDefaultBrowserStatus) return;
        const language = String(document.documentElement.lang || navigator.language || 'en').toLowerCase();
        const tr = language.startsWith('tr');
        button.textContent = tr ? 'Varsayılan olarak ayarla' : 'Set as default';
        message.textContent = tr ? 'ArDali varsayılan web tarayıcınız değil' : 'ArDali is not your default browser';
        dismiss.setAttribute('aria-label', tr ? 'Kapat' : 'Close');
        if (localStorage.getItem('ardali_default_browser_banner_dismissed') === '1') return;
        try {
            const status = await window.ardali.webSecurity.getDefaultBrowserStatus();
            if (!status?.supported || status?.isDefault) return;
            banner.classList.remove('hidden');
        } catch (_) { return; }
        dismiss.addEventListener('click', () => {
            localStorage.setItem('ardali_default_browser_banner_dismissed', '1');
            banner.classList.add('hidden');
        });
        button.addEventListener('click', async () => {
            button.disabled = true;
            message.textContent = tr ? 'Sistem tarayıcı ayarı güncelleniyor…' : 'Updating the system browser setting…';
            try {
                const result = await window.ardali.webSecurity.makeDefaultBrowser();
                if (result?.isDefault) {
                    message.textContent = tr ? 'ArDali artık varsayılan tarayıcınız' : 'ArDali is now your default browser';
                    setTimeout(() => banner.classList.add('hidden'), 1200);
                } else if (result?.requiresSystemConfirmation) {
                    message.textContent = tr ? 'Windows ayarlarında ArDali’yi seçin' : 'Choose ArDali in Windows settings';
                } else {
                    message.textContent = tr ? 'Varsayılan tarayıcı değiştirilemedi' : 'The default browser could not be changed';
                }
            } catch (_) {
                message.textContent = tr ? 'Varsayılan tarayıcı değiştirilemedi' : 'The default browser could not be changed';
            } finally { button.disabled = false; }
        });
    }

    // --- Helper Functions ---
    function generateId() {
        return Math.random().toString(36).substring(2, 10);
    }

    function tabMenuT(key, fallback) {
        const locale = String(document.documentElement.lang || window.i18n?.getLanguage?.() || 'en-US').toLowerCase();
        const tr = {
            newRight: 'Sağa yeni sekme', addGroup: 'Sekmeyi yeni gruba ekle', moveWindow: 'Sekmeyi yeni pencereye taşı',
            split: 'Sekmeyi yeni bölünmüş görünüme ekle', reload: 'Yeniden yükle', duplicate: 'Yinele', pin: 'Sabitle',
            unpin: 'Sabitlemeyi kaldır', muteTab: 'Sekmenin sesini kapat', unmuteTab: 'Sekmenin sesini aç',
            muteSite: 'Sitenin sesini kapat', unmuteSite: 'Sitenin sesini aç', readingList: 'Okuma listesine sekme ekle',
            close: 'Kapat', closeDuplicates: 'Kopyalanmış sekmeleri kapat', closeOthers: 'Diğer sekmeleri kapat',
            closeRight: 'Sağdaki sekmeleri kapat', restore: 'Pencereyi geri yükle', bookmarkAll: 'Tüm sekmelere yer işareti koy…',
            vertical: 'Dikey sekmeleri kullan', groupPrompt: 'Sekme grubu adı', unavailable: 'Yakında'
        };
        const ar = {
            newRight: 'علامة تبويب جديدة إلى اليمين', addGroup: 'إضافة علامة التبويب إلى مجموعة جديدة', moveWindow: 'نقل علامة التبويب إلى نافذة جديدة',
            split: 'إضافة علامة التبويب إلى عرض منقسم', reload: 'إعادة تحميل', duplicate: 'تكرار', pin: 'تثبيت', unpin: 'إلغاء التثبيت',
            muteTab: 'كتم علامة التبويب', unmuteTab: 'إلغاء كتم علامة التبويب', muteSite: 'كتم الموقع', unmuteSite: 'إلغاء كتم الموقع',
            readingList: 'إضافة علامة التبويب إلى قائمة القراءة', close: 'إغلاق', closeDuplicates: 'إغلاق علامات التبويب المكررة',
            closeOthers: 'إغلاق علامات التبويب الأخرى', closeRight: 'إغلاق علامات التبويب إلى اليمين', restore: 'استعادة علامة التبويب المغلقة',
            bookmarkAll: 'إضافة جميع علامات التبويب إلى الإشارات المرجعية…', vertical: 'استخدام علامات التبويب العمودية', groupPrompt: 'اسم مجموعة علامات التبويب', unavailable: 'قريبًا'
        };
        const table = locale.startsWith('tr') ? tr : (locale.startsWith('ar') ? ar : null);
        return table?.[key] || fallback;
    }

    function getTabHost(tab) {
        try { return new URL(String(tab?.url || '')).hostname.toLowerCase(); } catch (_) { return ''; }
    }

    function updateSplitView() {
        const container = document.getElementById('webViewsContainer');
        if (!container) return;
        const splitView = splitTabId && splitTabId !== activeTabId ? getTabWebView(splitTabId) : null;
        container.classList.toggle('web-split-view', !!splitView);
        container.querySelectorAll('webview.split-secondary').forEach((view) => view.classList.remove('split-secondary'));
        if (splitView) splitView.classList.add('split-secondary');
    }

    function addTabToReadingList(tab) {
        if (!tab || tab.url === BLANK_URL) return;
        let list = [];
        try { list = JSON.parse(localStorage.getItem('ardali_reading_list') || '[]'); } catch (_) {}
        list = Array.isArray(list) ? list : [];
        if (!list.some((item) => item?.url === tab.url)) {
            list.unshift({ url: tab.url, title: tab.title || tab.url, addedAt: Date.now() });
            localStorage.setItem('ardali_reading_list', JSON.stringify(list.slice(0, 250)));
        }
    }

    function bookmarkAllTabs() {
        let bookmarks = [];
        try { bookmarks = JSON.parse(localStorage.getItem('ardali_bookmarks') || '[]'); } catch (_) {}
        bookmarks = Array.isArray(bookmarks) ? bookmarks : [];
        for (const tab of tabs) {
            if (tab.url !== BLANK_URL && !bookmarks.includes(tab.url)) bookmarks.push(tab.url);
            if (tab.url !== BLANK_URL) saveBookmarkFavicon(tab.url, tab.favicon);
        }
        localStorage.setItem('ardali_bookmarks', JSON.stringify(bookmarks));
        renderBookmarks();
    }

    function duplicateTab(tab) {
        if (!tab) return;
        const sourceIndex = tabs.findIndex((item) => item.id === tab.id);
        const copy = createTab(tab.url, false);
        if (!copy) return;
        const createdIndex = tabs.findIndex((item) => item.id === copy.id);
        tabs.splice(createdIndex, 1);
        tabs.splice(sourceIndex + 1, 0, copy);
        renderTabs();
        activateTab(copy.id);
    }

    function createTabToRight(tab) {
        const sourceIndex = tabs.findIndex((item) => item.id === tab.id);
        const created = createTab(BLANK_URL, false);
        if (!created) return;
        const createdIndex = tabs.findIndex((item) => item.id === created.id);
        tabs.splice(createdIndex, 1);
        tabs.splice(sourceIndex + 1, 0, created);
        renderTabs();
        activateTab(created.id);
    }

    function closeTabsByIds(ids) {
        const unique = Array.from(new Set(ids)).filter((id) => tabs.some((tab) => tab.id === id));
        unique.forEach((id) => removeTab(id, { keepAtLeastOne: false }));
        if (!tabs.length) createTab();
    }

    function restoreClosedTab() {
        const snapshot = closedTabs.pop();
        if (!snapshot) return;
        const tab = createTab(snapshot.url || BLANK_URL, false);
        if (!tab) return;
        tab.title = snapshot.title || tab.title;
        tab.pinned = snapshot.pinned === true;
        tab.groupName = snapshot.groupName || '';
        renderTabs();
        activateTab(tab.id);
    }

    function closeWebTabContextMenu() {
        document.getElementById('webTabContextMenu')?.remove();
    }

    function showWebTabContextMenu(event, tab) {
        event.preventDefault();
        event.stopPropagation();
        closeWebTabContextMenu();
        const tabIndex = tabs.findIndex((item) => item.id === tab.id);
        const host = getTabHost(tab);
        const wv = getTabWebView(tab.id);
        const menu = document.createElement('div');
        menu.id = 'webTabContextMenu';
        menu.className = 'web-tab-context-menu';
        menu.setAttribute('role', 'menu');

        const addItem = (label, icon, action, options = {}) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'web-tab-context-item';
            button.disabled = options.disabled === true;
            button.setAttribute('role', 'menuitem');
            button.innerHTML = `<span class="material-symbols-rounded" aria-hidden="true">${icon}</span><span class="web-tab-context-label"></span>${options.shortcut ? `<kbd>${options.shortcut}</kbd>` : ''}${options.note ? `<small>${options.note}</small>` : ''}`;
            button.querySelector('.web-tab-context-label').textContent = label;
            button.addEventListener('click', () => {
                if (button.disabled) return;
                closeWebTabContextMenu();
                action?.();
            });
            menu.appendChild(button);
        };
        const separator = () => {
            const line = document.createElement('div');
            line.className = 'web-tab-context-separator';
            menu.appendChild(line);
        };

        addItem(tabMenuT('newRight', 'New tab to the right'), 'add', () => createTabToRight(tab));
        addItem(tabMenuT('addGroup', 'Add tab to new group'), 'tab_group', () => {
            const name = window.prompt(tabMenuT('groupPrompt', 'Tab group name'), tab.groupName || '');
            if (name == null) return;
            tab.groupName = String(name).trim();
            renderTabs();
        });
        addItem(tabMenuT('moveWindow', 'Move tab to new window'), 'open_in_new', async () => {
            if (!wv || tab.url === BLANK_URL) return;
            try {
                const opened = await wv.executeJavaScript(`(() => !!window.open(${JSON.stringify(tab.url)}, '_blank'))()`, true);
                if (opened) removeTab(tab.id);
            } catch (_) {
                notifyWebBrowser(tabMenuT('moveWindow', 'Move tab to new window'), 'error');
            }
        }, { disabled: !wv || tab.url === BLANK_URL });
        addItem(tabMenuT('split', 'Add tab to new split view'), 'vertical_split', () => {
            if (tab.id === activeTabId) {
                splitTabId = tabs.find((item) => item.id !== tab.id)?.id || null;
            } else {
                splitTabId = tab.id;
            }
            updateSplitView();
        }, { disabled: tabs.length < 2 });
        separator();
        addItem(tabMenuT('reload', 'Reload'), 'refresh', () => wv?.reload?.(), { shortcut: 'Ctrl+R' });
        addItem(tabMenuT('duplicate', 'Duplicate'), 'content_copy', () => duplicateTab(tab));
        addItem(tabMenuT(tab.pinned ? 'unpin' : 'pin', tab.pinned ? 'Unpin' : 'Pin'), 'keep', () => {
            tab.pinned = !tab.pinned;
            tabs.sort((a, b) => Number(b.pinned === true) - Number(a.pinned === true));
            renderTabs();
        });
        addItem(tabMenuT(tab.muted ? 'unmuteTab' : 'muteTab', tab.muted ? 'Unmute tab' : 'Mute tab'), tab.muted ? 'volume_up' : 'volume_off', () => {
            tab.muted = !tab.muted;
            try { wv?.setAudioMuted?.(tab.muted); } catch (_) {}
            renderTabs();
        });
        addItem(tabMenuT(host && mutedSiteHosts.has(host) ? 'unmuteSite' : 'muteSite', host && mutedSiteHosts.has(host) ? 'Unmute site' : 'Mute site'), 'language', () => {
            if (!host) return;
            const muted = !mutedSiteHosts.has(host);
            if (muted) mutedSiteHosts.add(host); else mutedSiteHosts.delete(host);
            tabs.filter((item) => getTabHost(item) === host).forEach((item) => {
                item.siteMuted = muted;
                try { getTabWebView(item.id)?.setAudioMuted?.(muted || item.muted === true); } catch (_) {}
            });
            renderTabs();
        }, { disabled: !host });
        separator();
        addItem(tabMenuT('readingList', 'Add tab to reading list'), 'menu_book', () => addTabToReadingList(tab), { disabled: tab.url === BLANK_URL });
        separator();
        addItem(tabMenuT('close', 'Close'), 'close', () => removeTab(tab.id), { shortcut: 'Ctrl+W' });
        const duplicateIds = tabs.filter((item, index) => item.url === tab.url && index !== tabIndex).map((item) => item.id);
        addItem(tabMenuT('closeDuplicates', 'Close duplicate tabs'), 'tab_close', () => closeTabsByIds(duplicateIds), { disabled: !duplicateIds.length });
        addItem(tabMenuT('closeOthers', 'Close other tabs'), 'close_fullscreen', () => closeTabsByIds(tabs.filter((item) => item.id !== tab.id && !item.pinned).map((item) => item.id)), { disabled: tabs.length < 2 });
        const rightIds = tabs.slice(tabIndex + 1).filter((item) => !item.pinned).map((item) => item.id);
        addItem(tabMenuT('closeRight', 'Close tabs to the right'), 'right_panel_close', () => closeTabsByIds(rightIds), { disabled: !rightIds.length });
        separator();
        addItem(tabMenuT('restore', 'Restore window'), 'restore', restoreClosedTab, { disabled: !closedTabs.length });
        addItem(tabMenuT('bookmarkAll', 'Bookmark all tabs…'), 'bookmarks', bookmarkAllTabs, { disabled: !tabs.some((item) => item.url !== BLANK_URL) });
        separator();
        addItem(tabMenuT('vertical', 'Use vertical tabs'), 'view_sidebar', () => {
            verticalTabsEnabled = !verticalTabsEnabled;
            document.getElementById('webPage')?.classList.toggle('web-vertical-tabs', verticalTabsEnabled);
        });

        document.body.appendChild(menu);
        const rect = menu.getBoundingClientRect();
        menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - rect.width - 8))}px`;
        menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - rect.height - 8))}px`;
        requestAnimationFrame(() => menu.classList.add('visible'));
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
        if (loading && tab.url !== BLANK_URL) tab.title = browserText('loading');
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
        loadWatchdogs.set(tabId, setTimeout(async () => {
            const tab = tabs.find(t => t.id === tabId);
            const wv = getTabWebView(tabId);
            if (!tab || !wv || !tab.isLoading || tab.url !== url) return;

            // Büyük pazaryerleri, reklam ve öneri akışları nedeniyle ağ
            // bağlantılarını uzun süre açık tutar. Chromium bu sırada hâlâ
            // "loading" diyebilir; görünür ve kullanılabilir bir belgeyi zorla
            // yenilemek hem takılma hem de tekrar yükleme döngüsü oluşturur.
            try {
                const health = await wv.executeJavaScript(`
                    (() => {
                        const body = document.body;
                        const textLength = String(body?.innerText || '').trim().length;
                        const elementCount = Number(body?.querySelectorAll?.('*')?.length || 0);
                        const loadedImages = Array.from(document.images || [])
                            .filter((img) => img.complete && Number(img.naturalWidth || 0) > 0).length;
                        return {
                            ready: String(document.readyState || ''),
                            href: String(location.href || ''),
                            textLength,
                            elementCount,
                            loadedImages,
                            hasUsableContent: textLength >= 20 || elementCount >= 8 || loadedImages > 0
                        };
                    })()
                `, true);
                if (health?.hasUsableContent === true) {
                    tab.loadRecoveryCount = 0;
                    tab.hasUsableContent = true;
                    const liveUrl = String(health.href || wv.getURL?.() || tab.url || '').trim();
                    const liveTitle = String(wv.getTitle?.() || '').trim();
                    if (liveUrl && liveUrl !== BLANK_URL) tab.url = liveUrl;
                    if (liveTitle && liveTitle !== BLANK_URL) tab.title = liveTitle;
                    // Ağda kalan reklam/telemetri istekleri sekme başlığını
                    // sonsuza kadar yükleniyor göstermesin; belgeyi durdurma.
                    setTabLoading(tabId, false, tab.url);
                    return;
                }
            } catch (_) {
                // Navigasyon sırasında probe reddedilebilir. Gerçek tarayıcı
                // davranışı için bu durumda sayfayı kendiliğinden yenileme.
                return;
            }

            // Yalnızca 30 saniye sonunda hâlâ içerik üretmemiş gerçek boş
            // belgelerde tek kurtarma girişimine izin ver.
            if (Number(tab.loadRecoveryCount || 0) === 0) {
                recoverWebviewLoad(tabId, 'load-timeout');
            } else {
                setTabLoading(tabId, false);
            }
        }, LOAD_STALL_MS));
    }

    function isLikelyBlankPageProbe(result) {
        // Chromium doğrudan bir görsel URL'si açıldığında yalnızca tek bir <img>
        // içeren yerleşik bir belge üretir. Bu geçerli belgeyi boş sayfa sanıp
        // yeniden yüklemek resmi kısa süre gösterdikten sonra beyaz ekrana düşürür.
        if (result?.isImageDocument === true || result?.hasLoadedStandaloneImage === true) return false;
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
                        const contentType = String(document.contentType || '').toLowerCase();
                        const standaloneImage = body?.querySelector?.(':scope > img:only-child') || null;
                        return {
                            ready: document.readyState,
                            href: location.href,
                            contentType,
                            isImageDocument: contentType.startsWith('image/'),
                            hasLoadedStandaloneImage: !!(
                                standaloneImage
                                && standaloneImage.complete
                                && Number(standaloneImage.naturalWidth || 0) > 0
                                && Number(standaloneImage.naturalHeight || 0) > 0
                            ),
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
                tab.title = browserText('downloads');
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
            tab.url = url;
            tab.deferredLoad = false;
            tab.restoreLoadFailed = false;
            tab.loadRecoveryCount = 0;
            setTabLoading(tab.id, url !== BLANK_URL, url);
            scheduleLoadWatchdog(tab.id, url);
        }
        applyPreferredUserAgent(wv, url);
        runWhenWebviewReady(wv, () => {
            if (!wv.isConnected || (tab && !tabs.some((item) => item.id === tab.id))) return;
            try {
                if (typeof wv.loadURL === 'function') {
                    const navigation = wv.loadURL(url);
                    navigation?.catch?.((error) => {
                        const code = Number(error?.errno || error?.errorCode || 0);
                        if (code === -3 || !tab || !tabs.some((item) => item.id === tab.id)) return;
                        console.warn('[WEB] navigation promise rejected:', error?.code || error?.message || 'navigation-error');
                        setTimeout(() => recoverWebviewLoad(tab.id, 'navigation-rejected'), 120);
                    });
                } else {
                    wv.setAttribute('src', url);
                }
            } catch (err) {
                console.warn('[WEB] navigation failed:', err?.message || err);
                if (tab) {
                    setTimeout(() => recoverWebviewLoad(tab.id, 'navigation-threw'), 120);
                }
            }
        });
    }

    // --- Tab Management ---
    function createTab(url = BLANK_URL, makeActive = true, options = {}) {
        const id = generateId();
        const isDownloadsTab = isDownloadsUrl(url);
        const tab = {
            id,
            url,
            title: isDownloadsTab ? browserText('downloads') : (url === BLANK_URL ? browserText('newTab') : browserText('loading')),
            isLoading: url !== BLANK_URL && !isDownloadsTab && options.deferLoad !== true,
            favicon: '',
            zoomFactor: 1.0,
            isPlayingMedia: false,
            lastActive: Date.now(),
            deferredLoad: options.deferLoad === true && url !== BLANK_URL && !isDownloadsTab
        };
        if (tab.deferredLoad) tab.pendingRestoreUrl = url;

        // Olayları ve görünürlük durumunu guest oluşturulmadan önce hazırla.
        // Linux'ta ekran dışında/örtülü eklenen bir webview ilk navigasyonu
        // askıya alabiliyor; bu nedenle aktif webview DOM'a doğrudan görünür girer.
        const wv = document.createElement('webview');
        wv.id = 'webview-' + id;
        wv.setAttribute('allowpopups', '');
        wv.setAttribute('partition', 'persist:ardali-web');
        bindWebBrowserEvents(wv, tab.id);
        if (typeof window.bindWebViewEvents === 'function') {
            window.bindWebViewEvents(wv);
        }
        wv.addEventListener('media-started-playing', () => { tab.isPlayingMedia = true; });
        wv.addEventListener('media-paused', () => { tab.isPlayingMedia = false; });

        const targetUrl = isDownloadsTab ? BLANK_URL : url;
        if (targetUrl !== BLANK_URL && !tab.deferredLoad) {
            wv.addEventListener('dom-ready', () => {
                applyPreferredUserAgent(wv, targetUrl);
                try {
                    const pending = wv.loadURL(targetUrl);
                    pending?.catch?.((err) => console.warn(
                        '[WEB] background tab load failed ' + JSON.stringify({
                            id,
                            targetUrl,
                            error: String(err?.code || err?.message || err || '')
                        })
                    ));
                } catch (err) {
                    console.warn('[WEB] background tab load threw ' + JSON.stringify({
                        id,
                        targetUrl,
                        error: String(err?.message || err || '')
                    }));
                }
            }, { once: true });
        }

        if (makeActive) {
            document.querySelectorAll('.webviews-container webview.active')
                .forEach((view) => view.classList.remove('active'));
            wv.classList.add('active');
            activeTabId = id;
        }
        applyPreferredUserAgent(wv, targetUrl);
        // Electron/Wayland'de hedef URL ile doğrudan eklenen ikinci webview
        // guest'e bağlanmayabiliyor. Önce blank guest oluştur, URL'yi
        // did-attach sonrasında yukarıdaki dinleyiciyle yükle.
        wv.setAttribute('src', BLANK_URL);

        const container = document.getElementById('webViewsContainer');
        if (!container) return null;
        container.appendChild(wv);

        tabs.push(tab);
        renderTabs();
        if (makeActive) {
            activateTab(tab.id);
        }

        // did-attach çok erken kaçarsa veya guest gecikirse kontrollü yedek.
        if (!isDownloadsTab && url !== BLANK_URL && !tab.deferredLoad) {
            const ensureCreatedTabLoaded = () => {
                if (!wv.isConnected) return;
                try {
                    const currentUrl = String(wv.getURL?.() || '').trim();
                    if (currentUrl === BLANK_URL) {
                        wv.loadURL(url).catch?.(() => {});
                    }
                } catch (_) {}
            };
            setTimeout(ensureCreatedTabLoaded, 500);
        }
        persistTabSession();
        return tab;
    }

    function removeTab(id, options = {}) {
        const removed = tabs.find(t => t.id === id);
        if (removed && options.recordHistory !== false && removed.url !== BLANK_URL) {
            closedTabs.push({
                url: removed.url,
                title: removed.title,
                pinned: removed.pinned === true,
                groupName: removed.groupName || ''
            });
            if (closedTabs.length > 30) closedTabs.shift();
        }
        tabs = tabs.filter(t => t.id !== id);
        if (splitTabId === id) splitTabId = null;

        // Remove Webview from DOM
        const wv = document.getElementById('webview-' + id);
        if (wv) wv.remove();

        if (tabs.length === 0 && options.keepAtLeastOne !== false) {
            createTab();
        } else if (tabs.length === 0) {
            activeTabId = null;
            renderTabs();
        } else if (activeTabId === id) {
            // Activate the last tab
            activateTab(tabs[tabs.length - 1].id);
        } else {
            renderTabs();
        }
        updateSplitView();
        persistTabSession(true);
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

            const container = document.getElementById('webViewsContainer');
            if (container) container.appendChild(wv);

            applyPreferredUserAgent(wv, tab.url);
            setTimeout(() => {
                if (wv) wv.src = isDownloadsUrl(tab.url) ? BLANK_URL : tab.url;
            }, 100);

            bindWebBrowserEvents(wv, tab.id);
            if (typeof window.bindWebViewEvents === 'function') {
                window.bindWebViewEvents(wv);
            }
            wv.addEventListener('media-started-playing', () => { tab.isPlayingMedia = true; });
            wv.addEventListener('media-paused', () => { tab.isPlayingMedia = false; });
        }

        // Arka planda yüklenen sekmeler Electron olaylarını kullanıcı sekmeye
        // geçmeden tamamlayabilir. Aktivasyonda görünür modeli guest'in gerçek
        // URL/başlık/yükleme durumuyla yeniden eşitle.
        if (wv) {
            try {
                const liveUrl = String(wv.getURL?.() || '').trim();
                const liveTitle = String(wv.getTitle?.() || '').trim();
                if (liveUrl && liveUrl !== BLANK_URL) tab.url = liveUrl;
                if (liveTitle && liveTitle !== BLANK_URL) tab.title = liveTitle;
                if (typeof wv.isLoading === 'function') {
                    tab.isLoading = !!wv.isLoading() && tab.hasUsableContent !== true;
                }
            } catch (_) {}
        }

        if (wv && tab.deferredLoad) {
            startDeferredTabLoad(tab.id, { background: false, reason: 'tab-activated' });
        }
        if (wv && tab.backgroundPreloadMuted) {
            try { wv.setAudioMuted(tab.muted === true || tab.siteMuted === true); } catch (_) {}
            tab.backgroundPreloadMuted = false;
        }
        renderTabs();

        const allWVs = document.querySelectorAll('.webviews-container webview');
        allWVs.forEach(w => w.classList.remove('active'));
        if (wv) wv.classList.add('active');

        scheduleSmartSidebarContrastProbe(wv, id, [40, 450]);
        updateSplitView();

        updateAddressBar(tab.url);
        updateNewTabPageVisibility(tab.url);
        window.syncActivePlatformButtonByUrl?.(tab.url);
        isWebviewLoading = !!tab.isLoading;
        navReload.innerHTML = tab.isLoading
            ? '<span class="material-symbols-rounded">close</span>'
            : '<span class="material-symbols-rounded">refresh</span>';
        try {
            navBack.disabled = !wv?.canGoBack?.();
            navForward.disabled = !wv?.canGoForward?.();
        } catch (_) {}
        persistTabSession();
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
            const pendingRestoreUrl = sanitizeSessionUrl(tab.pendingRestoreUrl);
            if (url === BLANK_URL && parseHttpUrl(pendingRestoreUrl)) {
                updateAddressBar(tab.url);
                updateNewTabPageVisibility(tab.url);
                renderTabs();
                return;
            }
            tab.url = url;
            if (isDownloadsUrl(url)) {
                tab.title = browserText('downloads');
                tab.isLoading = false;
            } else if (url === BLANK_URL) {
                tab.title = browserText('newTab');
            } else if (title) {
                tab.title = title;
            }
            renderTabs();
            updateAddressBar(url);
            updateNewTabPageVisibility(url);
            persistTabSession();
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
        syncActiveBookmarkIndicator(url);
    }

    function getComparableBookmarkHost(value) {
        try {
            return new URL(String(value || '')).hostname.toLowerCase().replace(/^www\./, '');
        } catch (_) {
            return '';
        }
    }

    function syncActiveBookmarkIndicator(currentUrl = '') {
        const activeHost = getComparableBookmarkHost(currentUrl);
        document.querySelectorAll('#webBookmarksStrip .web-bookmark-btn').forEach((btn) => {
            const bookmarkHost = getComparableBookmarkHost(btn.dataset.bookmarkUrl);
            const isActive = !!activeHost && activeHost === bookmarkHost;
            btn.classList.toggle('active-site', isActive);
            btn.setAttribute('aria-current', isActive ? 'page' : 'false');
        });
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
                tab.title = browserText('downloads');
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
        const savedFavicons = readBookmarkFavicons();
        try {
            bookmarks = JSON.parse(localStorage.getItem('ardali_bookmarks') || '[]');
        } catch(e) {}

        bookmarks.forEach(url => {
            const btn = document.createElement('button');
            btn.className = 'web-bookmark-btn';
            btn.dataset.bookmarkUrl = url;

            try {
                const domain = new URL(url).hostname;
                btn.title = domain;
            } catch(e) {
                btn.title = url;
            }

            const img = document.createElement('img');
            try {
                const domain = new URL(url).hostname;
                const savedFavicon = sanitizeSessionFavicon(savedFavicons[sanitizeSessionUrl(url)] || savedFavicons[url]);
                if (savedFavicon) {
                    img.src = savedFavicon;
                } else if (domain.includes('whatsapp.com')) {
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
            const activeIndicator = document.createElement('span');
            activeIndicator.className = 'web-bookmark-active-indicator';
            activeIndicator.setAttribute('aria-hidden', 'true');
            btn.appendChild(activeIndicator);

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
        syncActiveBookmarkIndicator(getActiveTab()?.url || '');
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
                tabEl.addEventListener('contextmenu', (event) => {
                    const current = tabs.find((item) => item.id === tabEl.dataset.tabId);
                    if (current) showWebTabContextMenu(event, current);
                });
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

            tabEl.className = `web-tab ${isTabActive ? 'active' : ''} ${tab.pinned ? 'pinned' : ''} ${tab.groupName ? 'grouped' : ''} ${(tab.muted || tab.siteMuted) ? 'muted' : ''} ${tab.restoreLoadFailed ? 'restore-load-failed' : ''}`;
            tabEl.dataset.groupName = tab.groupName || '';
            const baseTitle = tab.groupName ? `${tab.title} — ${tab.groupName}` : tab.title;
            tabEl.title = tab.restoreLoadFailed ? `${baseTitle} — Yüklenemedi, yeniden denemek için tıklayın` : baseTitle;

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
                    faviconSrc = getFallbackFaviconForUrl(tab.url);
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
        persistTabSession();
    }

    // --- Events ---
    // Webview Events
    function scheduleSmartSidebarContrastProbe(wv, tabId, delays = [80, 650, 1800]) {
        if (!wv) return;
        if (Array.isArray(wv.__ardaliContrastTimers)) {
            wv.__ardaliContrastTimers.forEach((timer) => clearTimeout(timer));
        }
        wv.__ardaliContrastTimers = delays.map((delay) => setTimeout(async () => {
            if (activeTabId !== tabId || !wv.isConnected) return;
            try {
                const result = await wv.executeJavaScript(`
                    (() => {
                        const parse = (value) => {
                            const match = String(value || '').match(/rgba?\\(\\s*([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)(?:[,/\\s]+([\\d.]+))?\\s*\\)/i);
                            if (!match) return null;
                            return {
                                r: Number(match[1]),
                                g: Number(match[2]),
                                b: Number(match[3]),
                                a: match[4] == null ? 1 : Number(match[4])
                            };
                        };
                        const luminance = (color) => {
                            const channel = (value) => {
                                const n = Math.max(0, Math.min(255, value)) / 255;
                                return n <= 0.04045 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
                            };
                            return (0.2126 * channel(color.r)) + (0.7152 * channel(color.g)) + (0.0722 * channel(color.b));
                        };
                        const samples = [];
                        const xPoints = [2, 8, Math.min(28, Math.max(2, innerWidth - 1))];
                        const yPoints = [innerHeight * 0.42, innerHeight * 0.5, innerHeight * 0.58];
                        for (const x of xPoints) {
                            for (const y of yPoints) {
                                let node = document.elementFromPoint(x, y);
                                let color = null;
                                while (node && node !== document) {
                                    const candidate = parse(getComputedStyle(node).backgroundColor);
                                    if (candidate && candidate.a >= 0.72) {
                                        color = candidate;
                                        break;
                                    }
                                    node = node.parentElement;
                                }
                                if (!color) {
                                    color = parse(getComputedStyle(document.body || document.documentElement).backgroundColor)
                                        || parse(getComputedStyle(document.documentElement).backgroundColor)
                                        || { r: 255, g: 255, b: 255, a: 1 };
                                }
                                samples.push(luminance(color));
                            }
                        }
                        samples.sort((a, b) => a - b);
                        const median = samples[Math.floor(samples.length / 2)] ?? 0;
                        return { light: median >= 0.48, luminance: median };
                    })()
                `, true);
                if (activeTabId !== tabId) return;
                document.body.classList.toggle('smart-sidebar-on-light-content', result?.light === true);
                document.body.style.setProperty('--smart-content-luminance', String(Number(result?.luminance || 0).toFixed(3)));
            } catch (_) {
                // The guest may navigate between scheduling and sampling.
            }
        }, Math.max(0, Number(delay) || 0)));
    }

    function bindWebBrowserEvents(wv, tabId) {
        wv.addEventListener('dom-ready', () => {
            wv.__ardaliDomReady = true;
            const tab = tabs.find(t => t.id === tabId);
            if (tab) {
                setWebviewZoomFactorSafe(wv, tab.zoomFactor || 1.0);
            }
            scheduleBlankPageRecovery(tabId);
            scheduleSmartSidebarContrastProbe(wv, tabId, [100, 700, 1900]);
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
                tab.hasUsableContent = true;
                tab.restoreLoadFailed = false;
                const currentUrl = String(wv.getURL?.() || '').trim();
                const currentTitle = String(wv.getTitle?.() || '').trim();
                if (currentUrl && currentUrl !== BLANK_URL) tab.url = currentUrl;
                if (currentTitle && currentTitle !== BLANK_URL) tab.title = currentTitle;
                if (currentUrl && currentUrl !== BLANK_URL) tab.pendingRestoreUrl = '';
            }

            if (activeTabId === tabId) {
                isWebviewLoading = false;
                navReload.innerHTML = '<span class="material-symbols-rounded">refresh</span>';
                navBack.disabled = !wv.canGoBack();
                navForward.disabled = !wv.canGoForward();
                updateActiveTabState(wv.getURL(), wv.getTitle());
            } else {
                renderTabs();
            }
            scheduleBlankPageRecovery(tabId);
            scheduleSmartSidebarContrastProbe(wv, tabId);
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
                tab.hasUsableContent = true;
                tab.restoreLoadFailed = false;
                const currentUrl = wv.getURL();
                if (currentUrl && currentUrl !== BLANK_URL) {
                    tab.url = currentUrl;
                    tab.pendingRestoreUrl = '';
                }
                const currentTitle = String(wv.getTitle?.() || '').trim();
                if (currentTitle && currentTitle !== BLANK_URL) tab.title = currentTitle;
                if (activeTabId === tabId) updateActiveTabState(currentUrl, wv.getTitle());
                if (activeTabId === tabId) recordSiteVisit(tab, currentUrl, currentTitle);
            }
            if (activeTabId !== tabId) renderTabs();
            scheduleBlankPageRecovery(tabId);
            scheduleSmartSidebarContrastProbe(wv, tabId);
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
            const failedTab = tabs.find(t => t.id === tabId);
            if (failedTab?.restoreTitle) failedTab.title = failedTab.restoreTitle;
            if (failedTab?.restoreTitle && sanitizeSessionUrl(failedTab.url) !== BLANK_URL) {
                failedTab.restoreLoadFailed = true;
                failedTab.deferredLoad = true;
                renderTabs();
            }
            if (activeTabId === tabId) {
                notifyWebBrowser(`Sayfa yüklenemedi (${code || 'hata'}).`, 'error');
            }
        });

        wv.addEventListener('page-title-updated', (e) => {
            const tab = tabs.find(t => t.id === tabId);
            if (!tab) return;
            const currentUrl = String(wv.getURL?.() || tab.url || '').trim();
            if (currentUrl && currentUrl !== BLANK_URL) tab.url = currentUrl;
            if (e.title && currentUrl !== BLANK_URL) tab.title = e.title;
            if (activeTabId === tabId) {
                updateActiveTabState(tab.url, tab.title);
            } else {
                renderTabs();
            }
        });

        wv.addEventListener('page-favicon-updated', (e) => {
            const tab = tabs.find(t => t.id === tabId);
            if (tab && e.favicons && e.favicons.length > 0) {
                tab.favicon = sanitizeSessionFavicon(e.favicons[0]) || getFallbackFaviconForUrl(tab.url);
                let bookmarks = [];
                try { bookmarks = JSON.parse(localStorage.getItem('ardali_bookmarks') || '[]'); } catch (_) {}
                if (Array.isArray(bookmarks) && bookmarks.includes(tab.url)) {
                    saveBookmarkFavicon(tab.url, tab.favicon);
                    renderBookmarks();
                }
                renderTabs();
            }
        });

        wv.addEventListener('new-window', (e) => {
            e.preventDefault();
            createTab(e.url, false);
        });

        wv.addEventListener('did-start-navigation', (e) => {
            if (isDownloadsUrl(getTabById(tabId)?.url)) {
                setTabLoading(tabId, false, 'ardali://downloads');
                return;
            }
            if (e.isMainFrame) {
                const navigationUrl = String(e.url || '').trim();
                const pendingRestore = parseHttpUrl(getTabById(tabId)?.pendingRestoreUrl);
                if (navigationUrl === BLANK_URL && pendingRestore) return;
                // Amazon gibi SPA'lar aynı belge içinde History API ile URL'yi
                // günceller. Chromium bunu in-place navigasyon olarak bildirir;
                // gerçek bir ağ yüklemesi olmadığı için spinner/watchdog başlatma.
                if (e.isInPlace === true) {
                    const tab = tabs.find(t => t.id === tabId);
                    if (tab && e.url) tab.url = e.url;
                    if (activeTabId === tabId && e.url) updateAddressBar(e.url);
                    return;
                }
                const tab = tabs.find(t => t.id === tabId);
                if (tab) {
                    tab.favicon = '';
                    tab.url = e.url || tab.url;
                    tab.isLoading = true;
                    tab.hasUsableContent = false;
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
            const navigatedUrl = String(e.url || wv.getURL?.() || '').trim();
            if (navigatedUrl === BLANK_URL && parseHttpUrl(tab.pendingRestoreUrl)) return;
            tab.url = navigatedUrl || tab.url;
            if (activeTabId === tabId) {
                updateActiveTabState(tab.url, wv.getTitle());
                window.syncActivePlatformButtonByUrl?.(tab.url);
                scheduleSmartSidebarContrastProbe(wv, tabId, [120, 700]);
            }
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
            if (activeTabId === tabId) {
                updateActiveTabState(tab.url, wv.getTitle());
                window.syncActivePlatformButtonByUrl?.(tab.url);
            }
        });

        wv.addEventListener('render-process-gone', () => recreateWebviewForTab(tabId, 'render-process-gone'));
        wv.addEventListener('crashed', () => recreateWebviewForTab(tabId, 'crashed'));

        wv.addEventListener('ipc-message', (e) => {
            if (e.channel === 'ardali-webview-zoom-scroll') {
                const direction = e.args[0]; // -1 or 1
                handleWebviewZoomScroll(tabId, direction);
            } else if (e.channel === 'ardali-webview-pointer-down') {
                window.dispatchEvent(new CustomEvent('ardali:webview-pointer-down', { detail: { tabId } }));
            } else if (e.channel === 'ardali-vault-stage-status' && activeTabId === tabId) {
                notifyWebBrowser('E-posta güvenli biçimde hazırlandı; şifre adımı bekleniyor.', 'info', 4200);
            } else if (e.channel === 'ardali-vault-fill-status' && activeTabId === tabId) {
                const filled = e.args?.[0]?.state === 'filled';
                notifyWebBrowser(filled ? 'Kayıtlı giriş bilgisi dolduruldu.' : 'Kayıtlı giriş bilgisi doldurulamadı. Kasanın açık olduğunu kontrol edin.', filled ? 'success' : 'warning', 4200);
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
            tab.title = browserText('newTab');
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
                removeBookmarkFavicon(tab.url);
            } else {
                icon.style.fontVariationSettings = "'FILL' 1";
                icon.style.color = 'var(--accent-primary, #00ffcc)';
                if (!bookmarks.includes(tab.url)) bookmarks.push(tab.url);
                saveBookmarkFavicon(tab.url, tab.favicon || getFallbackFaviconForUrl(tab.url));
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
                        const icon = document.createElement('span');
                        icon.className = 'material-symbols-rounded';
                        icon.textContent = 'search';
                        const label = document.createElement('span');
                        label.textContent = String(item?.phrase || '').slice(0, 256);
                        div.append(icon, document.createTextNode(' '), label);
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
                        div.dataset.phrase = String(item?.phrase || '').slice(0, 256);
                        const icon = document.createElement('span');
                        icon.className = 'material-symbols-rounded';
                        icon.textContent = 'search';
                        const label = document.createElement('span');
                        label.textContent = div.dataset.phrase;
                        div.append(icon, document.createTextNode(' '), label);
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

    document.addEventListener('pointerdown', (event) => {
        const menu = document.getElementById('webTabContextMenu');
        if (menu && !menu.contains(event.target)) closeWebTabContextMenu();
    }, true);
    window.addEventListener('blur', closeWebTabContextMenu);
    window.addEventListener('resize', closeWebTabContextMenu, { passive: true });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeWebTabContextMenu();
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
    setupDefaultBrowserBanner();

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

    window.addEventListener('beforeunload', () => persistTabSession(true));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persistTabSession(true); });

    // Initialize tabs after loading the user's existing Web session preference.
    setTimeout(async () => {
        try {
            const loaded = await window.ardali?.loadSettings?.();
            restoreLastSessionEnabled = loaded?.webUi?.restoreLastSession !== false;
            if (!restoreLastSessionEnabled) localStorage.removeItem(WEB_SESSION_STORAGE_KEY);
        } catch (_) {
            restoreLastSessionEnabled = true;
        }
        if (!restoreTabSession()) createTab();
        renderBookmarks();
    }, 50);
});
