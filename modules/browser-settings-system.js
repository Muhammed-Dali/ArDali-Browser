/** Central UI adapters for ArDali's existing browser state. */
(function () {
    'use strict';

    const STAR_KEY = 'ardali_bookmarks';
    const QUICK_CATALOG = Object.freeze([
        ['youtube', 'YouTube', 'https://www.youtube.com/'],
        ['tiktok', 'TikTok', 'https://www.tiktok.com/'],
        ['whatsapp', 'WhatsApp', 'https://web.whatsapp.com/'],
        ['instagram', 'Instagram', 'https://www.instagram.com/'],
        ['facebook', 'Facebook', 'https://www.facebook.com/'],
        ['github', 'GitHub', 'https://github.com/'],
        ['chatgpt', 'ChatGPT', 'https://chatgpt.com/'],
        ['gemini', 'Gemini', 'https://gemini.google.com/']
    ]);
    let settings = {};
    let starredUrlCache = null;
    let settingsSaveQueue = Promise.resolve(true);
    let savedHardwareAcceleration = true;
    let hardwareRestartNoticePending = false;
    const byId = (id) => document.getElementById(id);
    const cleanText = (value, max = 180) => String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
    function safeUrl(value) {
        try {
            const parsed = new URL(String(value || '').trim());
            return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString().slice(0, 2048) : '';
        } catch { return ''; }
    }
    function readStarUrls() {
        if (Array.isArray(starredUrlCache)) return [...starredUrlCache];
        try {
            const parsed = JSON.parse(localStorage.getItem(STAR_KEY) || '[]');
            return Array.isArray(parsed) ? [...new Set(parsed.map(safeUrl).filter(Boolean))] : [];
        } catch { return []; }
    }
    function writeStarUrls(urls) {
        const clean = [...new Set(urls.map(safeUrl).filter(Boolean))];
        starredUrlCache = clean;
        localStorage.setItem(STAR_KEY, JSON.stringify(clean));
        window.ardali?.webSecurity?.setStarredUrls?.(clean).catch?.(() => {});
        window.dispatchEvent(new Event('ardali:bookmarks-changed'));
    }
    function currentNewTab() {
        const value = settings?.web?.newTab;
        return value && typeof value === 'object' ? value : {};
    }
    function quickItems() {
        const items = currentNewTab()?.shortcuts?.items;
        return Array.isArray(items) ? items.map((entry) => ({ title: cleanText(entry?.title, 40), url: safeUrl(entry?.url) })).filter((entry) => entry.title && entry.url) : [];
    }
    function providerIdForUrl(value) {
        try {
            const host = new URL(value).hostname.replace(/^www\./, '');
            return QUICK_CATALOG.find((entry) => host === new URL(entry[2]).hostname.replace(/^www\./, ''))?.[0] || '';
        } catch { return ''; }
    }
    async function savePatch(patch) {
        settingsSaveQueue = settingsSaveQueue.then(async () => {
            const ok = await window.ardali?.saveSettings?.(patch);
            if (ok !== false) settings = await window.ardali?.loadSettings?.() || settings;
            return ok !== false;
        }, async () => {
            const ok = await window.ardali?.saveSettings?.(patch);
            if (ok !== false) settings = await window.ardali?.loadSettings?.() || settings;
            return ok !== false;
        });
        return settingsSaveQueue;
    }
    async function saveNewTabItems(items) {
        const newTab = currentNewTab();
        const next = {
            ...newTab,
            shortcuts: { ...(newTab.shortcuts || {}), items }
        };
        settings.web = { ...(settings.web || {}), newTab: next };
        window.dispatchEvent(new CustomEvent('ardali:new-tab-settings-changed', { detail: next }));
        await savePatch({ web: { newTab: next } });
    }
    function isValidIp(value) {
        const input = String(value || '').trim();
        if (!input) return true;
        if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(input)) return input.split('.').every((part) => Number(part) <= 255);
        return input.includes(':') && /^[\da-f:]+$/i.test(input) && input.split(':').length <= 8;
    }
    const toggle = (id, label) => `<label class="browser-toggle"><input id="${id}" type="checkbox"><span>${label}</span></label>`;
    const row = (title, control, hint = '') => `<div class="browser-setting-row"><div><strong>${title}</strong>${hint ? `<small>${hint}</small>` : ''}</div>${control}</div>`;
    const section = (icon, title, keywords, content, open = false) => `<details class="browser-settings-section" data-keywords="${keywords}" ${open ? 'open' : ''}><summary><span class="material-symbols-rounded">${icon}</span>${title}<span class="material-symbols-rounded chevron">expand_more</span></summary><div class="browser-settings-body">${content}</div></details>`;

    function buildUi() {
        const page = byId('webSettings');
        if (!page || page.dataset.browserCenter) return;
        page.dataset.browserCenter = 'true';
        [...page.children].slice(1).forEach((element) => element.classList.add('legacy-browser-settings'));
        const root = document.createElement('div');
        root.className = 'browser-settings-center';
        root.innerHTML = `<div class="browser-settings-hero"><div><h3><span class="material-symbols-rounded">language</span>Tarayıcı Ayarları</h3><p>Çalışan tarayıcı özelliklerini tek merkezden yönetin.</p></div><input id="bsFind" class="settings-input" type="search" placeholder="Ayarlarda ara…"></div><div id="bsSections"></div>`;
        page.insertBefore(root, page.children[1]);
        byId('bsSections').innerHTML = [
            section('rocket_launch', 'Oturum', 'oturum başlangıç geri yükle session', toggle('bsRestore', 'Mevcut web oturumunu başlangıçta geri yükle'), true),
            section('search', 'Arama', 'arama motoru toolbar', row('Varsayılan arama motoru', '<select id="bsEngine" class="settings-select"><option value="duckduckgo">DuckDuckGo</option><option value="google">Google</option><option value="bing">Bing</option><option value="brave">Brave Search</option></select>', 'Toolbar ve yeni sekme aramasıyla aynı ayarı kullanır.')),
            section('dns', 'Ağ ve DNS', 'dns doh cloudflare google quad9 opendns adguard nextdns özel', row('DNS sağlayıcısı', '<select id="bsDns" class="settings-select"><option value="system">Sistem varsayılanı</option><option value="cloudflare">Cloudflare (1.1.1.1)</option><option value="google">Google DNS</option><option value="quad9">Quad9</option><option value="opendns">OpenDNS</option><option value="adguard">AdGuard DNS</option><option value="nextdns">NextDNS</option><option value="custom">Özel DNS</option></select>') + '<div id="bsCustomDns">' + row('Birincil DNS', '<input id="bsPrimary" class="settings-input">') + row('İkincil DNS', '<input id="bsSecondary" class="settings-input">') + '</div>' + toggle('bsDoh', 'DNS over HTTPS (DoH)') + '<small id="bsDnsStatus" class="browser-note">Ağ işlemi uygulama yeniden başlatıldığında etkinleşir.</small>'),
            section('star', 'Favoriler ve Yer İmleri', 'favori yıldız yer imi ara içe dışa html', '<div class="browser-actions"><input id="bsStarFind" class="settings-input" type="search" placeholder="Yıldızlarda ara…"><button id="bsStarAdd" class="settings-btn">Adres ekle</button><button id="bsImport" class="settings-btn">HTML içe aktar</button><button id="bsExport" class="settings-btn">HTML dışa aktar</button></div><div id="bsStars" class="browser-list"></div>'),
            section('apps', 'Hızlı Erişim', 'hızlı erişim youtube tiktok whatsapp instagram facebook github chatgpt gemini sürükle', '<small class="browser-note">Yeni sekmedeki mevcut Hızlı Siteler listesini yönetir. Sıralamak için sürükleyin.</small><div id="bsQuick" class="browser-list browser-sort"></div>'),
            section('keep', 'Sabit Sekmeler', 'sabit pinned sekme sırala', '<div class="browser-actions"><button id="bsPin" class="settings-btn">Geçerli sekmeyi sabitle / çöz</button><button id="bsPinnedRefresh" class="settings-btn">Listeyi yenile</button></div><small class="browser-note">Sıralamak için sabit sekmeleri sürükleyin.</small><div id="bsPinnedList" class="browser-list browser-sort"></div>'),
            section('download', 'İndirmeler', 'indirme klasörü konum aç eşzamanlı', row('İndirme klasörü', '<div class="browser-actions"><input id="bsFolder" class="settings-input" placeholder="Sistem İndirilenler klasörü"><button id="bsChooseFolder" class="settings-btn">Seç</button></div>') + toggle('bsAsk', 'Her seferinde konum sor') + toggle('bsOpen', 'İndirmeden sonra aç') + row('En fazla eşzamanlı indirme', '<input id="bsMax" class="settings-input" type="number" min="1" max="10">')),
            section('privacy_tip', 'Gizlilik', 'önbellek çerez geçmiş izleme koruma', toggle('bsTracking', 'Mevcut izleme korumasını etkinleştir') + '<div class="browser-actions"><button class="settings-btn" data-clear="cache">Önbelleği temizle</button><button class="settings-btn" data-clear="cookies">Çerezleri temizle</button><button class="settings-btn" data-clear="history">Geçmişi temizle</button></div><small id="bsPrivacy" class="browser-note"></small>'),
            section('tune', 'Gelişmiş', 'donanım gpu geliştirici devtools', toggle('bsHardware', 'Donanım hızlandırma') + '<small class="browser-note">Bu değişiklik uygulamanın yeniden başlatılmasından sonra uygulanacaktır.</small>' + row('GPU ayarları', '<select class="settings-select" disabled><option>Sistem varsayılanı</option></select>') + toggle('bsDev', 'Geliştirici araçları') + '<small class="browser-note">DevTools değişikliği yeniden başlatma gerektirmez. Etkinken F12 veya Ctrl+Shift+I kullanılabilir.</small>')
        ].join('');
        bindUi(root);
        fillUi();
    }

    function fillUi() {
        const web = settings.web || {};
        const webUi = settings.webUi || {};
        const dns = web.dns || {};
        byId('bsRestore').checked = webUi.restoreLastSession !== false;
        byId('bsEngine').value = web.searchEngine || 'duckduckgo';
        byId('bsDns').value = dns.provider || 'system';
        byId('bsPrimary').value = dns.primary || '';
        byId('bsSecondary').value = dns.secondary || '';
        byId('bsDoh').checked = dns.dohEnabled === true;
        byId('bsFolder').value = webUi.downloadFolder || '';
        byId('bsAsk').checked = webUi.askDownloadLocation !== false;
        byId('bsOpen').checked = webUi.openFileAfterDownload === true;
        byId('bsMax').value = Math.max(1, Math.min(10, Number(webUi.maxConcurrentDownloads) || 3));
        byId('bsTracking').checked = webUi.stripTrackingParams !== false;
        const advanced = web.advancedPlaceholders || {};
        byId('bsHardware').checked = advanced.hardwareAcceleration !== false;
        savedHardwareAcceleration = byId('bsHardware').checked;
        byId('bsDev').checked = advanced.developerTools === true;
        syncDnsUi();
        renderStars();
        renderQuickAccess();
        renderPinnedTabs();
    }

    function syncDnsUi() { byId('bsCustomDns').hidden = byId('bsDns').value !== 'custom'; }
    function resetGeneralUiToDefaults() {
        byId('bsRestore').checked = true;
        byId('bsEngine').value = 'duckduckgo';
        byId('bsDns').value = 'system';
        byId('bsPrimary').value = '';
        byId('bsSecondary').value = '';
        byId('bsDoh').checked = false;
        byId('bsFolder').value = '';
        byId('bsAsk').checked = true;
        byId('bsOpen').checked = false;
        byId('bsMax').value = '3';
        byId('bsTracking').checked = true;
        byId('bsHardware').checked = true;
        byId('bsDev').checked = false;
        syncDnsUi();

        const canonicalPatch = {
            web: {
                searchEngine: 'duckduckgo',
                dns: { provider: 'system', primary: '', secondary: '', dohEnabled: false },
                advancedPlaceholders: { hardwareAcceleration: true, gpuSettings: 'default', developerTools: false }
            },
            webUi: {
                restoreLastSession: true,
                askDownloadLocation: true,
                downloadFolder: '',
                openFileAfterDownload: false,
                maxConcurrentDownloads: 3,
                reduceReferrers: true,
                stripTrackingParams: true,
                blockThirdPartyCookies: false
            }
        };
        settings.web = { ...(settings.web || {}), ...canonicalPatch.web };
        settings.webUi = { ...(settings.webUi || {}), ...canonicalPatch.webUi };
        window.dispatchEvent(new CustomEvent('ardali:browser-settings-patch', { detail: canonicalPatch }));
    }
    async function saveGeneral() {
        const primary = byId('bsPrimary').value.trim();
        const secondary = byId('bsSecondary').value.trim();
        const valid = isValidIp(primary) && isValidIp(secondary);
        byId('bsDnsStatus').textContent = valid ? 'Ağ işlemi uygulama yeniden başlatıldığında etkinleşir.' : 'Geçerli bir IPv4 veya IPv6 adresi girin.';
        byId('bsDnsStatus').classList.toggle('error', !valid);
        if (!valid) return;
        const engine = byId('bsEngine').value;
        const tracking = byId('bsTracking').checked;
        const hardwareAcceleration = byId('bsHardware').checked;
        const developerTools = byId('bsDev').checked;
        const webPatch = {
            searchEngine: engine,
            dns: { provider: byId('bsDns').value, primary, secondary, dohEnabled: byId('bsDoh').checked },
            advancedPlaceholders: { hardwareAcceleration, gpuSettings: 'default', developerTools }
        };
        const webUiPatch = {
            restoreLastSession: byId('bsRestore').checked,
            askDownloadLocation: byId('bsAsk').checked,
            downloadFolder: cleanText(byId('bsFolder').value, 1000),
            openFileAfterDownload: byId('bsOpen').checked,
            maxConcurrentDownloads: Math.max(1, Math.min(10, Number(byId('bsMax').value) || 3)),
            reduceReferrers: tracking,
            stripTrackingParams: tracking,
            blockThirdPartyCookies: tracking && settings.webUi?.blockThirdPartyCookies === true
        };
        settings.web = { ...(settings.web || {}), ...webPatch };
        settings.webUi = { ...(settings.webUi || {}), ...webUiPatch };
        const canonicalPatch = { web: webPatch, webUi: webUiPatch };
        window.dispatchEvent(new CustomEvent('ardali:browser-settings-patch', { detail: canonicalPatch }));
        await savePatch(canonicalPatch);
        if (hardwareAcceleration !== savedHardwareAcceleration) hardwareRestartNoticePending = true;
        savedHardwareAcceleration = hardwareAcceleration;
        await window.ardali?.webSecurity?.setDevToolsEnabled?.(developerTools);
        // Existing toolbar/new-tab listeners consume this canonical event.
        const detail = { webSearchEngine: engine };
        window.dispatchEvent(new CustomEvent('ardali:settings-changed', { detail }));
        document.dispatchEvent(new CustomEvent('ardali:settings-changed', { detail }));
        const existingDropdown = byId('behaviorWebSearchEngine');
        if (existingDropdown) existingDropdown.value = engine;
    }

    function renderStars() {
        const host = byId('bsStars');
        if (!host) return;
        const query = cleanText(byId('bsStarFind')?.value).toLowerCase();
        const urls = readStarUrls().filter((value) => !query || value.toLowerCase().includes(query));
        host.replaceChildren();
        if (!urls.length) { const empty = document.createElement('small'); empty.className = 'browser-note'; empty.textContent = 'Yıldızlı adres bulunamadı.'; host.appendChild(empty); return; }
        urls.forEach((value) => {
            const row = document.createElement('div');
            const icon = document.createElement('span'); icon.className = 'material-symbols-rounded'; icon.textContent = 'star';
            const info = document.createElement('div'); const title = document.createElement('strong'); const detail = document.createElement('small');
            title.textContent = new URL(value).hostname; detail.textContent = value; info.append(title, detail);
            const edit = document.createElement('button'); edit.className = 'settings-btn'; edit.textContent = 'Adresi değiştir';
            edit.onclick = () => { const next = safeUrl(prompt('Adres', value) || ''); if (!next) return; writeStarUrls(readStarUrls().map((entry) => entry === value ? next : entry)); renderStars(); };
            const remove = document.createElement('button'); remove.className = 'settings-btn'; remove.textContent = 'Yıldızı kaldır';
            remove.onclick = () => { writeStarUrls(readStarUrls().filter((entry) => entry !== value)); renderStars(); };
            row.append(icon, info, edit, remove); host.appendChild(row);
        });
    }

    function renderQuickAccess() {
        const host = byId('bsQuick');
        if (!host) return;
        const items = quickItems();
        const rows = items.map((entry, index) => ({ key: providerIdForUrl(entry.url) || `custom-${index}`, entry, enabled: true }));
        QUICK_CATALOG.forEach((catalog) => {
            if (!rows.some((row) => row.key === catalog[0])) rows.push({ key: catalog[0], entry: { title: catalog[1], url: catalog[2] }, enabled: false });
        });
        host.innerHTML = rows.map((row) => {
            return `<div draggable="true" data-quick-key="${row.key}"><span class="material-symbols-rounded">drag_indicator</span><strong></strong><label class="browser-toggle"><input type="checkbox" ${row.enabled ? 'checked' : ''}> Göster</label></div>`;
        }).join('');
        host.querySelectorAll('[data-quick-key]').forEach((element, index) => { element.querySelector('strong').textContent = rows[index].entry.title; });
        const saveVisibleRows = async () => {
            const visible = [...host.querySelectorAll('[data-quick-key]')]
                .filter((row) => row.querySelector('input').checked)
                .map((row) => rows.find((entry) => entry.key === row.dataset.quickKey)?.entry)
                .filter(Boolean);
            await saveNewTabItems(visible);
        };
        let dragged = '';
        host.querySelectorAll('[data-quick-key]').forEach((element) => {
            element.ondragstart = () => { dragged = element.dataset.quickKey; };
            element.ondragover = (event) => event.preventDefault();
            element.ondrop = async () => {
                const target = element.dataset.quickKey;
                if (!dragged || dragged === target) return;
                const source = host.querySelector(`[data-quick-key="${dragged}"]`);
                if (!source) return;
                host.insertBefore(source, element);
                await saveVisibleRows();
                renderQuickAccess();
            };
            element.querySelector('input').onchange = async () => {
                await saveVisibleRows();
                renderQuickAccess();
            };
        });
    }

    function exportStars() {
        const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
        const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1><meta charset="UTF-8"><DL>${readStarUrls().map((value) => `<DT><A HREF="${escape(value)}">${escape(new URL(value).hostname)}</A>`).join('')}</DL>`;
        const anchor = document.createElement('a'); anchor.href = URL.createObjectURL(new Blob([html], { type: 'text/html' })); anchor.download = 'ardali-bookmarks.html'; anchor.click(); setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
    }
    async function renderPinnedTabs() {
        const host = byId('bsPinnedList');
        if (!host) return;
        const tabs = await window.ardali?.webSecurity?.getPinnedTabs?.() || [];
        host.replaceChildren();
        if (!tabs.length) {
            const empty = document.createElement('small');
            empty.className = 'browser-note'; empty.textContent = 'Sabitlenmiş sekme yok.'; host.appendChild(empty); return;
        }
        tabs.forEach((tab) => {
            const item = document.createElement('div'); item.draggable = true; item.dataset.pinnedTabId = tab.id;
            const drag = document.createElement('span'); drag.className = 'material-symbols-rounded'; drag.textContent = 'drag_indicator';
            const info = document.createElement('div'); const title = document.createElement('strong'); const detail = document.createElement('small');
            title.textContent = tab.title || new URL(tab.url).hostname; detail.textContent = tab.url; info.append(title, detail);
            const remove = document.createElement('button'); remove.className = 'settings-btn'; remove.textContent = 'Sabitlemeyi kaldır';
            remove.onclick = async () => { await window.ardali?.webSecurity?.unpinTab?.(tab.id); await renderPinnedTabs(); };
            item.append(drag, info, remove); host.appendChild(item);
        });
        let draggedId = '';
        host.querySelectorAll('[data-pinned-tab-id]').forEach((item) => {
            item.ondragstart = () => { draggedId = item.dataset.pinnedTabId; };
            item.ondragover = (event) => event.preventDefault();
            item.ondrop = async () => {
                if (!draggedId || draggedId === item.dataset.pinnedTabId) return;
                const source = [...host.querySelectorAll('[data-pinned-tab-id]')].find((entry) => entry.dataset.pinnedTabId === draggedId);
                if (!source) return;
                host.insertBefore(source, item);
                const order = [...host.querySelectorAll('[data-pinned-tab-id]')].map((entry) => entry.dataset.pinnedTabId);
                await window.ardali?.webSecurity?.reorderPinnedTabs?.(order);
                await renderPinnedTabs();
            };
        });
    }
    function importStars() {
        const input = document.createElement('input'); input.type = 'file'; input.accept = '.html,.htm,text/html';
        input.onchange = async () => { const source = await input.files?.[0]?.text(); if (!source) return; const doc = new DOMParser().parseFromString(source, 'text/html'); writeStarUrls([...readStarUrls(), ...[...doc.querySelectorAll('a[href]')].map((anchor) => anchor.getAttribute('href'))]); renderStars(); };
        input.click();
    }
    function bindUi(root) {
        root.addEventListener('change', (event) => { if (event.target.id === 'bsDns') syncDnsUi(); if (!event.target.closest('#bsQuick')) saveGeneral(); });
        byId('bsFind').oninput = (event) => { const query = event.target.value.toLocaleLowerCase('tr'); root.querySelectorAll('.browser-settings-section').forEach((element) => { element.hidden = !!query && !element.textContent.toLocaleLowerCase('tr').includes(query) && !element.dataset.keywords.includes(query); if (query && !element.hidden) element.open = true; }); };
        byId('bsStarFind').oninput = renderStars;
        byId('bsStarAdd').onclick = () => { const value = safeUrl(prompt('Adres', window.getActiveTabUrl?.() || '') || ''); if (!value) return; writeStarUrls([...readStarUrls(), value]); renderStars(); };
        byId('bsImport').onclick = importStars; byId('bsExport').onclick = exportStars;
        byId('bsPin').onclick = async () => {
            await window.ardali?.webSecurity?.togglePinCurrent?.();
            setTimeout(renderPinnedTabs, 120);
        };
        byId('bsPinnedRefresh').onclick = renderPinnedTabs;
        byId('settingsOk')?.addEventListener('click', async () => {
            await saveGeneral();
            if (hardwareRestartNoticePending) {
                hardwareRestartNoticePending = false;
                setTimeout(() => window.safeNotify?.(
                    'Donanım hızlandırması ayarı kaydedildi. Değişiklik uygulamayı yeniden başlattığınızda etkin olacaktır.',
                    'info', 3600
                ), 250);
            }
        });
        byId('bsChooseFolder').onclick = async () => { const result = await window.ardali?.dialog?.openFolder?.({ title: 'İndirme klasörünü seç', defaultPath: byId('bsFolder').value || undefined }); if (result?.path) { byId('bsFolder').value = result.path; await saveGeneral(); } };
        root.querySelectorAll('[data-clear]').forEach((button) => { button.onclick = async () => { if (button.dataset.clear === 'history') localStorage.removeItem('ardali_ntp_site_visits_v1'); const result = await window.ardali?.webSecurity?.clearData?.({ [button.dataset.clear]: true }); byId('bsPrivacy').textContent = result === false ? 'Temizleme başarısız.' : 'Temizlendi.'; }; });
        window.addEventListener('storage', (event) => { if (event.key === STAR_KEY) renderStars(); });
        window.addEventListener('ardali:bookmarks-changed', renderStars);
        window.addEventListener('ardali:settings-changed', (event) => {
            const engine = event.detail?.webSearchEngine;
            if (engine && byId('bsEngine')) byId('bsEngine').value = engine;
        });
        window.addEventListener('ardali:browser-settings-reset-defaults', resetGeneralUiToDefaults);
    }

    async function init() {
        settings = await window.ardali?.loadSettings?.() || {};
        const remoteStars = await window.ardali?.webSecurity?.getStarredUrls?.();
        if (Array.isArray(remoteStars)) starredUrlCache = remoteStars.map(safeUrl).filter(Boolean);
        // One-time cleanup of the earlier parallel prototype stores. Their URLs
        // are folded into the toolbar's existing star source before removal.
        for (const legacyKey of ['ardali_browser_bookmarks_v2', 'ardali_browser_favorites_v1']) {
            try {
                const legacy = JSON.parse(localStorage.getItem(legacyKey) || '[]');
                if (Array.isArray(legacy)) {
                    const urls = legacy.map((entry) => safeUrl(typeof entry === 'string' ? entry : entry?.url)).filter(Boolean);
                    if (urls.length) writeStarUrls([...readStarUrls(), ...urls]);
                }
                localStorage.removeItem(legacyKey);
            } catch { localStorage.removeItem(legacyKey); }
        }
        buildUi();
    }
    document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init, { once: true }) : init();
})();
