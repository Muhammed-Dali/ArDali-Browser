/**
 * ArDali New Tab customization.
 * This module only renders trusted application UI. Remote pages stay isolated in
 * Electron webviews and never receive this module or its privileged bridge.
 */
(function () {
    'use strict';

    const WALLPAPERS = Object.freeze([
        { id: 'flow-blue', src: 'assets/backgrounds/new-tab/ardali-flow-blue.png', credit: 'ArDali • Flow Blue' },
        { id: 'aurora-teal', src: 'assets/backgrounds/new-tab/ardali-aurora-teal.png', credit: 'ArDali • Aurora Teal' },
        { id: 'cosmic-violet', src: 'assets/backgrounds/new-tab/ardali-cosmic-violet.png', credit: 'ArDali • Cosmic Violet' }
    ]);
    const VISITS_STORAGE_KEY = 'ardali_ntp_site_visits_v1';
    const DISMISSED_SITES_STORAGE_KEY = 'ardali_ntp_dismissed_sites_v1';
    const DEFAULTS = Object.freeze({
        version: 1,
        background: { mode: 'packaged', packagedId: 'flow-blue', fit: 'cover', position: 'center', dim: 36, blur: 0, hasCustom: false },
        clock: { visible: true, style: 'digital', format: '24', seconds: false, showDate: true },
        search: { visible: true },
        shortcuts: { visible: true, autoTopSites: false, items: [
            { title: 'YouTube', url: 'https://www.youtube.com/' },
            { title: 'GitHub', url: 'https://github.com/' },
            { title: 'Wikipedia', url: 'https://www.wikipedia.org/' }
        ] },
        cards: { downloads: true, privacy: true, position: 'center', order: ['downloads', 'privacy'] },
        appearance: { reducedMotion: false }
    });
    const TEXT = {
        tr: { title: 'Yeni Sekmeyi Özelleştir', shortcuts: 'Hızlı Siteler', downloads: 'Son indirilenler', privacy: 'Web koruması', active: 'Etkin', saved: 'Kaydedildi', failed: 'Kaydedilemedi', invalidUrl: 'Yalnızca http/https adresleri kullanılabilir.', imageFailed: 'Resim güvenlik doğrulamasından geçemedi.', siteTitle: 'Site adı', siteUrl: 'https://ornek.com', confirmReset: 'Yeni sekme ayarları varsayılana döndürülsün mü?' },
        en: { title: 'Customize New Tab', shortcuts: 'Quick Sites', downloads: 'Recent downloads', privacy: 'Web protection', active: 'Active', saved: 'Saved', failed: 'Could not save', invalidUrl: 'Only http/https addresses are allowed.', imageFailed: 'The image did not pass security validation.', siteTitle: 'Site name', siteUrl: 'https://example.com', confirmReset: 'Reset new tab settings to defaults?' }
    };

    let settings = structuredCloneSafe(DEFAULTS);
    let customImageDataUrl = '';
    let clockTimer = 0;
    let saveTimer = 0;

    function structuredCloneSafe(value) { return JSON.parse(JSON.stringify(value)); }
    function localeKey() { return String(document.documentElement.lang || navigator.language || 'en').toLowerCase().startsWith('tr') ? 'tr' : 'en'; }
    function t(key) { return TEXT[localeKey()][key] || TEXT.en[key] || key; }
    function byId(id) { return document.getElementById(id); }
    function bool(value, fallback) { return typeof value === 'boolean' ? value : fallback; }
    function allowed(value, values, fallback) { return values.includes(value) ? value : fallback; }
    function bounded(value, min, max, fallback) { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback; }
    function safeUrl(value) {
        try { const url = new URL(String(value || '').trim()); return ['http:', 'https:'].includes(url.protocol) ? url.toString().slice(0, 2048) : ''; } catch (_) { return ''; }
    }
    function normalize(raw) {
        const source = raw && typeof raw === 'object' ? raw : {};
        const items = (Array.isArray(source.shortcuts?.items) ? source.shortcuts.items : DEFAULTS.shortcuts.items)
            .slice(0, 12).map((item) => ({ title: String(item?.title || '').trim().slice(0, 40), url: safeUrl(item?.url) })).filter((item) => item.title && item.url);
        return {
            version: 1,
            background: { mode: allowed(source.background?.mode, ['packaged', 'gradient', 'custom', 'none'], 'packaged'), packagedId: allowed(source.background?.packagedId, WALLPAPERS.map((item) => item.id), 'flow-blue'), fit: allowed(source.background?.fit, ['cover', 'contain', 'stretch'], 'cover'), position: allowed(source.background?.position, ['center', 'top', 'bottom', 'left', 'right'], 'center'), dim: bounded(source.background?.dim, 0, 80, 36), blur: bounded(source.background?.blur, 0, 16, 0), hasCustom: bool(source.background?.hasCustom, false) },
            clock: { visible: bool(source.clock?.visible, true), style: allowed(source.clock?.style, ['digital', 'flip', 'analog', 'written'], 'digital'), format: allowed(source.clock?.format, ['12', '24'], '24'), seconds: bool(source.clock?.seconds, false), showDate: bool(source.clock?.showDate, true) },
            search: { visible: bool(source.search?.visible, true) },
            shortcuts: { visible: bool(source.shortcuts?.visible, true), autoTopSites: bool(source.shortcuts?.autoTopSites, false), items },
            cards: { downloads: bool(source.cards?.downloads, true), privacy: bool(source.cards?.privacy, true), position: allowed(source.cards?.position, ['left', 'center', 'right'], 'center'), order: ['downloads', 'privacy'] },
            appearance: { reducedMotion: bool(source.appearance?.reducedMotion, false) }
        };
    }
    function chooseSessionWallpaper() {
        if (settings.background.mode !== 'packaged') return;
        const ids = WALLPAPERS.map((item) => item.id);
        const previous = localStorage.getItem('ardali_ntp_last_wallpaper') || '';
        const candidates = ids.filter((id) => id !== previous);
        const pool = candidates.length ? candidates : ids;
        settings.background.packagedId = pool[Math.floor(Math.random() * pool.length)];
        localStorage.setItem('ardali_ntp_last_wallpaper', settings.background.packagedId);
    }
    async function persist(immediate = false) {
        clearTimeout(saveTimer);
        const run = async () => {
            const status = byId('webNtpSaveStatus');
            try {
                // Keep the main renderer's in-memory settings in sync. Otherwise a
                // later application-wide save can overwrite this panel's values.
                window.dispatchEvent(new CustomEvent('ardali:new-tab-settings-changed', { detail: structuredCloneSafe(settings) }));
                const ok = await window.ardali?.saveSettings?.({ web: { newTab: settings } });
                if (!ok) throw new Error('save-failed');
                if (status) status.textContent = t('saved');
            } catch (_) { if (status) status.textContent = t('failed'); }
        };
        if (immediate) await run(); else saveTimer = setTimeout(run, 220);
    }
    function setVisible(id, visible) { const el = byId(id); if (el) el.hidden = !visible; }
    function applyBackground() {
        const backdrop = byId('webNtpBackdrop'); const shade = byId('webNtpShade'); const credit = byId('webNtpCredit');
        if (!backdrop || !shade) return;
        const bg = settings.background;
        let image = ''; let label = '';
        if (bg.mode === 'packaged') { const selected = WALLPAPERS.find((item) => item.id === bg.packagedId) || WALLPAPERS[0]; image = `url("${selected.src}")`; label = selected.credit; }
        else if (bg.mode === 'custom' && customImageDataUrl) { image = `url("${customImageDataUrl}")`; label = localeKey() === 'tr' ? 'Kişisel arka plan' : 'Personal background'; }
        else if (bg.mode === 'gradient' || (bg.mode === 'custom' && !customImageDataUrl)) image = 'radial-gradient(circle at 18% 20%,#114c67 0,transparent 38%),radial-gradient(circle at 80% 78%,#4d1768 0,transparent 42%),linear-gradient(145deg,#05080d,#101729)';
        else image = 'none';
        backdrop.style.backgroundImage = image;
        backdrop.style.backgroundSize = bg.fit === 'stretch' ? '100% 100%' : bg.fit;
        backdrop.style.backgroundPosition = bg.position;
        backdrop.style.backgroundRepeat = 'no-repeat';
        backdrop.style.opacity = bg.mode === 'none' ? '0' : '1';
        backdrop.style.filter = `blur(${bg.blur}px)`;
        shade.style.background = `rgba(2,5,10,${bg.dim / 100})`;
        if (credit) credit.textContent = label;
    }
    function numberWords(value) {
        const tr = ['sıfır','bir','iki','üç','dört','beş','altı','yedi','sekiz','dokuz','on','on bir','on iki','on üç','on dört','on beş','on altı','on yedi','on sekiz','on dokuz','yirmi','yirmi bir','yirmi iki','yirmi üç','yirmi dört','yirmi beş','yirmi altı','yirmi yedi','yirmi sekiz','yirmi dokuz','otuz','otuz bir','otuz iki','otuz üç','otuz dört','otuz beş','otuz altı','otuz yedi','otuz sekiz','otuz dokuz','kırk','kırk bir','kırk iki','kırk üç','kırk dört','kırk beş','kırk altı','kırk yedi','kırk sekiz','kırk dokuz','elli','elli bir','elli iki','elli üç','elli dört','elli beş','elli altı','elli yedi','elli sekiz','elli dokuz'];
        return localeKey() === 'tr' ? (tr[value] || String(value)) : String(value).padStart(2, '0');
    }
    function updateClock() {
        const now = new Date(); const lang = document.documentElement.lang || navigator.language;
        const clock = byId('webNtpClock'); const date = byId('webNtpDate');
        if (clock) {
            clock.className = `web-ntp-clock style-${settings.clock.style}`;
            clock.replaceChildren();
            const hour12 = settings.clock.format === '12';
            const displayHour = hour12 ? (now.getHours() % 12 || 12) : now.getHours();
            if (settings.clock.style === 'analog') {
                const canvas = document.createElement('canvas'); canvas.className = 'web-ntp-analog-clock'; canvas.width = 180; canvas.height = 180;
                const ctx = canvas.getContext('2d'); const center = 90;
                ctx.clearRect(0, 0, 180, 180); ctx.beginPath(); ctx.arc(center, center, 84, 0, Math.PI * 2); ctx.fillStyle = 'rgba(7,13,24,.66)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.36)'; ctx.lineWidth = 2; ctx.stroke();
                for (let i = 0; i < 12; i += 1) { const a = i * Math.PI / 6; ctx.beginPath(); ctx.moveTo(center + Math.sin(a) * 68, center - Math.cos(a) * 68); ctx.lineTo(center + Math.sin(a) * 76, center - Math.cos(a) * 76); ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 3; ctx.stroke(); }
                const hand = (angle, length, width, color) => { ctx.beginPath(); ctx.moveTo(center, center); ctx.lineTo(center + Math.sin(angle) * length, center - Math.cos(angle) * length); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.stroke(); };
                hand(((now.getHours() % 12) + now.getMinutes() / 60) * Math.PI / 6, 43, 7, '#fff'); hand((now.getMinutes() + now.getSeconds() / 60) * Math.PI / 30, 64, 5, '#68ddff'); if (settings.clock.seconds) hand(now.getSeconds() * Math.PI / 30, 70, 2, '#ff657c');
                ctx.beginPath(); ctx.arc(center, center, 6, 0, Math.PI * 2); ctx.fillStyle = '#68ddff'; ctx.fill(); clock.append(canvas);
            } else if (settings.clock.style === 'written') {
                const written = document.createElement('span'); written.className = 'web-ntp-written-time'; written.textContent = `${numberWords(displayHour)} ${numberWords(now.getMinutes())}`; clock.append(written);
            } else if (settings.clock.style === 'flip') {
                const h = document.createElement('span'); h.textContent = String(displayHour).padStart(2, '0');
                const m = document.createElement('span'); m.textContent = String(now.getMinutes()).padStart(2, '0');
                clock.append(h, document.createTextNode(':'), m);
            } else clock.textContent = new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit', second: settings.clock.seconds ? '2-digit' : undefined, hour12 }).format(now);
        }
        if (date) date.textContent = settings.clock.showDate ? new Intl.DateTimeFormat(lang, { weekday: 'long', day: 'numeric', month: 'long' }).format(now) : '';
    }
    function scheduleClock() { clearInterval(clockTimer); updateClock(); clockTimer = setInterval(updateClock, settings.clock.seconds ? 1000 : 60000); }
    function navigate(url) { if (!safeUrl(url)) return; if (typeof window.createTab === 'function') window.createTab(url, true); else { const input = byId('webNtpSearchInput'); if (input) { input.value = url; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); } } }
    function shortcutFaviconUrls(rawUrl) {
        try {
            const url = new URL(safeUrl(rawUrl));
            return [
                `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(url.origin)}&sz=128`,
                `${url.origin}/favicon.ico`,
                `https://icons.duckduckgo.com/ip3/${encodeURIComponent(url.hostname)}.ico`
            ];
        } catch (_) { return []; }
    }
    function readJsonStorage(key, fallback) { try { const value = JSON.parse(localStorage.getItem(key) || 'null'); return value ?? fallback; } catch (_) { return fallback; } }
    function getRenderedShortcuts() {
        const manual = settings.shortcuts.items.map((item, index) => ({ ...item, manualIndex: index }));
        if (!settings.shortcuts.autoTopSites) return manual;
        const manualHosts = new Set(manual.map((item) => { try { return new URL(item.url).hostname.replace(/^www\./, ''); } catch (_) { return ''; } }));
        const dismissed = new Set(Array.isArray(readJsonStorage(DISMISSED_SITES_STORAGE_KEY, [])) ? readJsonStorage(DISMISSED_SITES_STORAGE_KEY, []) : []);
        const visits = readJsonStorage(VISITS_STORAGE_KEY, {});
        const automatic = Object.values(visits && typeof visits === 'object' ? visits : {})
            .filter((item) => item && Number(item.count) >= 3 && !manualHosts.has(item.host) && !dismissed.has(item.host))
            .sort((a, b) => Number(b.count) - Number(a.count) || Number(b.lastVisit) - Number(a.lastVisit))
            .slice(0, Math.max(0, 12 - manual.length))
            .map((item) => ({ title: item.title || item.host, url: `https://${item.host}/`, autoHost: item.host }));
        return manual.concat(automatic);
    }
    function removeShortcut(item) {
        if (Number.isInteger(item.manualIndex)) {
            settings.shortcuts.items.splice(item.manualIndex, 1);
            renderEditor(); persist();
        } else if (item.autoHost) {
            const dismissed = new Set(Array.isArray(readJsonStorage(DISMISSED_SITES_STORAGE_KEY, [])) ? readJsonStorage(DISMISSED_SITES_STORAGE_KEY, []) : []);
            dismissed.add(item.autoHost); localStorage.setItem(DISMISSED_SITES_STORAGE_KEY, JSON.stringify(Array.from(dismissed).slice(-100)));
        }
        renderShortcuts();
    }
    function renderShortcuts() {
        const host = byId('webNtpShortcuts'); if (!host) return; host.replaceChildren();
        getRenderedShortcuts().forEach((item) => {
            const button = document.createElement('button'); button.type = 'button'; button.className = 'web-ntp-shortcut'; button.title = item.url;
            const icon = document.createElement('span'); icon.className = 'web-ntp-shortcut-icon'; icon.textContent = item.title.slice(0, 1).toLocaleUpperCase();
            const faviconUrls = shortcutFaviconUrls(item.url);
            if (faviconUrls.length) {
                const image = document.createElement('img');
                image.className = 'web-ntp-shortcut-favicon';
                image.alt = '';
                image.loading = 'lazy';
                image.decoding = 'async';
                image.referrerPolicy = 'no-referrer';
                let candidateIndex = 0;
                image.addEventListener('load', () => icon.classList.add('has-favicon'));
                image.addEventListener('error', () => {
                    candidateIndex += 1;
                    if (candidateIndex < faviconUrls.length) image.src = faviconUrls[candidateIndex];
                    else image.remove();
                });
                image.src = faviconUrls[candidateIndex];
                icon.appendChild(image);
            }
            const title = document.createElement('span'); title.textContent = item.title;
            const remove = document.createElement('span'); remove.className = 'web-ntp-shortcut-remove'; remove.textContent = '×'; remove.title = localeKey() === 'tr' ? 'Siteyi kaldır' : 'Remove site'; remove.setAttribute('role', 'button'); remove.tabIndex = 0;
            const removeItem = (event) => { event.preventDefault(); event.stopPropagation(); removeShortcut(item); };
            remove.addEventListener('click', removeItem); remove.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') removeItem(event); });
            button.append(icon, title, remove); button.addEventListener('click', () => navigate(item.url)); host.appendChild(button);
        });
    }
    function renderEditor() {
        const host = byId('webNtpShortcutEditor'); if (!host) return; host.replaceChildren();
        settings.shortcuts.items.forEach((item, index) => {
            const row = document.createElement('div'); row.className = 'web-ntp-shortcut-editor-row';
            const title = document.createElement('input'); title.type = 'text'; title.maxLength = 40; title.placeholder = t('siteTitle'); title.value = item.title;
            const url = document.createElement('input'); url.type = 'url'; url.maxLength = 2048; url.placeholder = t('siteUrl'); url.value = item.url;
            const remove = document.createElement('button'); remove.type = 'button'; remove.title = localeKey() === 'tr' ? 'Kaldır' : 'Remove'; remove.textContent = '×';
            title.addEventListener('change', () => { settings.shortcuts.items[index].title = title.value.trim().slice(0, 40) || item.title; renderShortcuts(); persist(); });
            url.addEventListener('change', () => { const clean = safeUrl(url.value); if (!clean) { url.setCustomValidity(t('invalidUrl')); url.reportValidity(); url.value = item.url; return; } url.setCustomValidity(''); settings.shortcuts.items[index].url = clean; renderShortcuts(); persist(); });
            remove.addEventListener('click', () => { settings.shortcuts.items.splice(index, 1); renderShortcuts(); renderEditor(); persist(); });
            row.append(title, url, remove); host.appendChild(row);
        });
    }
    function addShortcut() { if (settings.shortcuts.items.length >= 12) return; settings.shortcuts.items.push({ title: localeKey() === 'tr' ? 'Yeni Site' : 'New Site', url: 'https://example.com/' }); renderShortcuts(); renderEditor(); persist(); }
    async function refreshCards() {
        try { const history = await window.ardali?.downloads?.getHistory?.(); const value = byId('webNtpDownloadsValue'); if (value) value.textContent = String(Array.isArray(history) ? history.slice(0, 5).length : 0); } catch (_) {}
        try { const stats = await window.ardali?.adblock?.getStats?.(); const value = byId('webNtpPrivacyValue'); const blocked = Number(stats?.totalBlocked); if (value) value.textContent = Number.isFinite(blocked) ? String(blocked) : t('active'); } catch (_) {}
    }
    function syncControls() {
        const pairs = [
            ['webNtpBackgroundMode', settings.background.mode], ['webNtpBackgroundFit', settings.background.fit], ['webNtpBackgroundPosition', settings.background.position], ['webNtpDim', settings.background.dim], ['webNtpBlur', settings.background.blur], ['webNtpSearchVisible', settings.search.visible], ['webNtpShortcutsVisible', settings.shortcuts.visible], ['webNtpAutoTopSites', settings.shortcuts.autoTopSites], ['webNtpClockVisible', settings.clock.visible], ['webNtpClockFormat', settings.clock.format], ['webNtpClockSeconds', settings.clock.seconds], ['webNtpDateVisible', settings.clock.showDate], ['webNtpCardsPosition', settings.cards.position], ['webNtpDownloadsVisible', settings.cards.downloads], ['webNtpPrivacyVisible', settings.cards.privacy]
        ];
        pairs.forEach(([id, value]) => { const el = byId(id); if (!el) return; if (el.type === 'checkbox') el.checked = value; else el.value = String(value); });
        if (byId('webNtpDimValue')) byId('webNtpDimValue').textContent = `${settings.background.dim}%`;
        if (byId('webNtpBlurValue')) byId('webNtpBlurValue').textContent = `${settings.background.blur}px`;
        document.querySelectorAll('.web-ntp-wallpaper').forEach((el) => el.classList.toggle('active', el.dataset.wallpaperId === settings.background.packagedId));
        document.querySelectorAll('.web-ntp-clock-style').forEach((el) => el.classList.toggle('active', el.dataset.clockStyle === settings.clock.style));
    }
    function applyAll() {
        applyBackground(); scheduleClock(); renderShortcuts(); renderEditor(); syncControls();
        setVisible('webNtpClockCard', settings.clock.visible); setVisible('webNtpSearchContainer', settings.search.visible); setVisible('webNtpShortcutsCard', settings.shortcuts.visible); setVisible('webNtpDownloadsCard', settings.cards.downloads); setVisible('webNtpPrivacyCard', settings.cards.privacy);
        const content = byId('webNtpShortcutsCard')?.parentElement; if (content) content.dataset.cardsPosition = settings.cards.position;
        const cards = byId('webNtpCards'); if (cards) cards.hidden = !settings.cards.downloads && !settings.cards.privacy;
        refreshCards();
    }
    function openPanel() { byId('webNtpPanel')?.classList.remove('hidden'); byId('webNtpPanelBackdrop')?.classList.remove('hidden'); byId('webNtpPanelClose')?.focus(); }
    function closePanel() { byId('webNtpPanel')?.classList.add('hidden'); byId('webNtpPanelBackdrop')?.classList.add('hidden'); byId('webNtpCustomizeBtn')?.focus(); }
    function buildWallpapers() {
        const host = byId('webNtpWallpaperGrid'); if (!host) return;
        WALLPAPERS.forEach((item) => { const button = document.createElement('button'); button.type = 'button'; button.className = 'web-ntp-wallpaper'; button.dataset.wallpaperId = item.id; button.title = item.credit; button.style.backgroundImage = `url("${item.src}")`; button.addEventListener('click', () => { settings.background.mode = 'packaged'; settings.background.packagedId = item.id; applyAll(); persist(); }); host.appendChild(button); });
    }
    function bind() {
        byId('webNtpCustomizeBtn')?.addEventListener('click', openPanel); byId('webNtpPanelClose')?.addEventListener('click', closePanel); byId('webNtpPanelBackdrop')?.addEventListener('click', closePanel);
        document.addEventListener('keydown', (event) => {
            const panel = byId('webNtpPanel');
            if (!panel || panel.classList.contains('hidden')) return;
            if (event.key === 'Escape') { closePanel(); return; }
            if (event.key !== 'Tab') return;
            const focusable = Array.from(panel.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])')).filter((el) => !el.hidden && el.offsetParent !== null);
            if (!focusable.length) return;
            const first = focusable[0]; const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        });
        document.querySelectorAll('[data-ntp-panel-tab]').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('[data-ntp-panel-tab]').forEach((el) => el.classList.toggle('active', el === button)); document.querySelectorAll('[data-ntp-panel-section]').forEach((el) => el.classList.toggle('active', el.dataset.ntpPanelSection === button.dataset.ntpPanelTab)); }));
        const bindings = [
            ['webNtpBackgroundMode', 'change', (el) => settings.background.mode = el.value], ['webNtpBackgroundFit', 'change', (el) => settings.background.fit = allowed(el.value, ['cover', 'contain', 'stretch'], 'cover')], ['webNtpBackgroundPosition', 'change', (el) => settings.background.position = allowed(el.value, ['center', 'top', 'bottom', 'left', 'right'], 'center')], ['webNtpDim', 'input', (el) => settings.background.dim = bounded(el.value, 0, 80, 36)], ['webNtpBlur', 'input', (el) => settings.background.blur = bounded(el.value, 0, 16, 0)], ['webNtpSearchVisible', 'change', (el) => settings.search.visible = el.checked], ['webNtpShortcutsVisible', 'change', (el) => settings.shortcuts.visible = el.checked], ['webNtpAutoTopSites', 'change', (el) => settings.shortcuts.autoTopSites = el.checked], ['webNtpClockVisible', 'change', (el) => settings.clock.visible = el.checked], ['webNtpClockFormat', 'change', (el) => settings.clock.format = el.value], ['webNtpClockSeconds', 'change', (el) => settings.clock.seconds = el.checked], ['webNtpDateVisible', 'change', (el) => settings.clock.showDate = el.checked], ['webNtpCardsPosition', 'change', (el) => settings.cards.position = allowed(el.value, ['left', 'center', 'right'], 'center')], ['webNtpDownloadsVisible', 'change', (el) => settings.cards.downloads = el.checked], ['webNtpPrivacyVisible', 'change', (el) => settings.cards.privacy = el.checked]
        ];
        bindings.forEach(([id, event, update]) => byId(id)?.addEventListener(event, (e) => { update(e.currentTarget); applyAll(); persist(); }));
        byId('webNtpAddShortcutBtn')?.addEventListener('click', () => { openPanel(); byId('webNtpPanel')?.querySelector('[data-ntp-panel-tab="shortcuts"]')?.click(); addShortcut(); }); byId('webNtpPanelAddShortcut')?.addEventListener('click', addShortcut);
        byId('webNtpChooseImage')?.addEventListener('click', async () => { const result = await window.ardali?.newTab?.chooseBackground?.(); if (result?.ok && String(result.dataUrl || '').startsWith('data:image/png;base64,')) { customImageDataUrl = result.dataUrl; settings.background.hasCustom = true; settings.background.mode = 'custom'; applyAll(); persist(true); } else if (!result?.canceled) window.alert(t('imageFailed')); });
        byId('webNtpRemoveImage')?.addEventListener('click', async () => { if (await window.ardali?.newTab?.removeBackground?.()) { customImageDataUrl = ''; settings.background.hasCustom = false; if (settings.background.mode === 'custom') settings.background.mode = 'gradient'; applyAll(); persist(true); } });
        byId('webNtpReset')?.addEventListener('click', async () => { if (!window.confirm(t('confirmReset'))) return; settings = structuredCloneSafe(DEFAULTS); applyAll(); await persist(true); });
        document.querySelectorAll('.web-ntp-clock-style').forEach((button) => button.addEventListener('click', () => { settings.clock.style = allowed(button.dataset.clockStyle, ['digital', 'flip', 'analog', 'written'], 'digital'); applyAll(); persist(); }));
        window.addEventListener('ardali:web-visit-recorded', () => { if (settings.shortcuts.autoTopSites) renderShortcuts(); });
    }
    async function init() {
        if (!byId('webNewTabPage')) return;
        buildWallpapers(); bind();
        try { const loaded = await window.ardali?.loadSettings?.(); settings = normalize(loaded?.web?.newTab); } catch (_) { settings = structuredCloneSafe(DEFAULTS); }
        chooseSessionWallpaper();
        if (settings.background.hasCustom) { try { const result = await window.ardali?.newTab?.loadBackground?.(); if (result?.ok && String(result.dataUrl || '').startsWith('data:image/png;base64,')) customImageDataUrl = result.dataUrl; else settings.background.hasCustom = false; } catch (_) { settings.background.hasCustom = false; } }
        const textMap = { webNtpPanelTitle: 'title', webNtpShortcutsTitle: 'shortcuts', webNtpDownloadsLabel: 'downloads', webNtpPrivacyLabel: 'privacy' }; Object.entries(textMap).forEach(([id, key]) => { if (byId(id)) byId(id).textContent = t(key); });
        applyAll();
    }
    document.addEventListener('DOMContentLoaded', init, { once: true });
})();
