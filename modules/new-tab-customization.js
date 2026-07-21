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
    const DEFAULTS = Object.freeze({
        version: 1,
        background: { mode: 'packaged', packagedId: 'flow-blue', dim: 36, blur: 0, hasCustom: false },
        clock: { visible: true, format: '24', seconds: false, showDate: true },
        search: { visible: true },
        shortcuts: { visible: true, items: [
            { title: 'YouTube', url: 'https://www.youtube.com/' },
            { title: 'GitHub', url: 'https://github.com/' },
            { title: 'Wikipedia', url: 'https://www.wikipedia.org/' }
        ] },
        cards: { downloads: true, privacy: true, order: ['downloads', 'privacy'] },
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
            background: { mode: allowed(source.background?.mode, ['packaged', 'gradient', 'custom', 'none'], 'packaged'), packagedId: allowed(source.background?.packagedId, WALLPAPERS.map((item) => item.id), 'flow-blue'), dim: bounded(source.background?.dim, 0, 80, 36), blur: bounded(source.background?.blur, 0, 16, 0), hasCustom: bool(source.background?.hasCustom, false) },
            clock: { visible: bool(source.clock?.visible, true), format: allowed(source.clock?.format, ['12', '24'], '24'), seconds: bool(source.clock?.seconds, false), showDate: bool(source.clock?.showDate, true) },
            search: { visible: bool(source.search?.visible, true) },
            shortcuts: { visible: bool(source.shortcuts?.visible, true), items },
            cards: { downloads: bool(source.cards?.downloads, true), privacy: bool(source.cards?.privacy, true), order: ['downloads', 'privacy'] },
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
                const ok = await window.ardali?.saveSettings?.({ web: { newTab: settings } });
                if (!ok) throw new Error('save-failed');
                if (status) status.textContent = t('saved');
                window.dispatchEvent(new CustomEvent('ardali:new-tab-settings-changed', { detail: structuredCloneSafe(settings) }));
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
        backdrop.style.opacity = bg.mode === 'none' ? '0' : '1';
        backdrop.style.filter = `blur(${bg.blur}px)`;
        shade.style.background = `rgba(2,5,10,${bg.dim / 100})`;
        if (credit) credit.textContent = label;
    }
    function updateClock() {
        const now = new Date(); const lang = document.documentElement.lang || navigator.language;
        const clock = byId('webNtpClock'); const date = byId('webNtpDate');
        if (clock) clock.textContent = new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit', second: settings.clock.seconds ? '2-digit' : undefined, hour12: settings.clock.format === '12' }).format(now);
        if (date) date.textContent = settings.clock.showDate ? new Intl.DateTimeFormat(lang, { weekday: 'long', day: 'numeric', month: 'long' }).format(now) : '';
    }
    function scheduleClock() { clearInterval(clockTimer); updateClock(); clockTimer = setInterval(updateClock, settings.clock.seconds ? 1000 : 60000); }
    function navigate(url) { if (!safeUrl(url)) return; if (typeof window.createTab === 'function') window.createTab(url, true); else { const input = byId('webNtpSearchInput'); if (input) { input.value = url; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); } } }
    function renderShortcuts() {
        const host = byId('webNtpShortcuts'); if (!host) return; host.replaceChildren();
        settings.shortcuts.items.forEach((item) => {
            const button = document.createElement('button'); button.type = 'button'; button.className = 'web-ntp-shortcut'; button.title = item.url;
            const icon = document.createElement('span'); icon.className = 'web-ntp-shortcut-icon'; icon.textContent = item.title.slice(0, 1).toLocaleUpperCase();
            const title = document.createElement('span'); title.textContent = item.title;
            button.append(icon, title); button.addEventListener('click', () => navigate(item.url)); host.appendChild(button);
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
            ['webNtpBackgroundMode', settings.background.mode], ['webNtpDim', settings.background.dim], ['webNtpBlur', settings.background.blur], ['webNtpSearchVisible', settings.search.visible], ['webNtpShortcutsVisible', settings.shortcuts.visible], ['webNtpClockVisible', settings.clock.visible], ['webNtpClockFormat', settings.clock.format], ['webNtpClockSeconds', settings.clock.seconds], ['webNtpDateVisible', settings.clock.showDate], ['webNtpDownloadsVisible', settings.cards.downloads], ['webNtpPrivacyVisible', settings.cards.privacy]
        ];
        pairs.forEach(([id, value]) => { const el = byId(id); if (!el) return; if (el.type === 'checkbox') el.checked = value; else el.value = String(value); });
        if (byId('webNtpDimValue')) byId('webNtpDimValue').textContent = `${settings.background.dim}%`;
        if (byId('webNtpBlurValue')) byId('webNtpBlurValue').textContent = `${settings.background.blur}px`;
        document.querySelectorAll('.web-ntp-wallpaper').forEach((el) => el.classList.toggle('active', el.dataset.wallpaperId === settings.background.packagedId));
    }
    function applyAll() {
        applyBackground(); scheduleClock(); renderShortcuts(); renderEditor(); syncControls();
        setVisible('webNtpClockCard', settings.clock.visible); setVisible('webNtpSearchContainer', settings.search.visible); setVisible('webNtpShortcutsCard', settings.shortcuts.visible); setVisible('webNtpDownloadsCard', settings.cards.downloads); setVisible('webNtpPrivacyCard', settings.cards.privacy);
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
            ['webNtpBackgroundMode', 'change', (el) => settings.background.mode = el.value], ['webNtpDim', 'input', (el) => settings.background.dim = bounded(el.value, 0, 80, 36)], ['webNtpBlur', 'input', (el) => settings.background.blur = bounded(el.value, 0, 16, 0)], ['webNtpSearchVisible', 'change', (el) => settings.search.visible = el.checked], ['webNtpShortcutsVisible', 'change', (el) => settings.shortcuts.visible = el.checked], ['webNtpClockVisible', 'change', (el) => settings.clock.visible = el.checked], ['webNtpClockFormat', 'change', (el) => settings.clock.format = el.value], ['webNtpClockSeconds', 'change', (el) => settings.clock.seconds = el.checked], ['webNtpDateVisible', 'change', (el) => settings.clock.showDate = el.checked], ['webNtpDownloadsVisible', 'change', (el) => settings.cards.downloads = el.checked], ['webNtpPrivacyVisible', 'change', (el) => settings.cards.privacy = el.checked]
        ];
        bindings.forEach(([id, event, update]) => byId(id)?.addEventListener(event, (e) => { update(e.currentTarget); applyAll(); persist(); }));
        byId('webNtpAddShortcutBtn')?.addEventListener('click', () => { openPanel(); byId('webNtpPanel')?.querySelector('[data-ntp-panel-tab="shortcuts"]')?.click(); addShortcut(); }); byId('webNtpPanelAddShortcut')?.addEventListener('click', addShortcut);
        byId('webNtpChooseImage')?.addEventListener('click', async () => { const result = await window.ardali?.newTab?.chooseBackground?.(); if (result?.ok && String(result.dataUrl || '').startsWith('data:image/png;base64,')) { customImageDataUrl = result.dataUrl; settings.background.hasCustom = true; settings.background.mode = 'custom'; applyAll(); persist(true); } else if (!result?.canceled) window.alert(t('imageFailed')); });
        byId('webNtpRemoveImage')?.addEventListener('click', async () => { if (await window.ardali?.newTab?.removeBackground?.()) { customImageDataUrl = ''; settings.background.hasCustom = false; if (settings.background.mode === 'custom') settings.background.mode = 'gradient'; applyAll(); persist(true); } });
        byId('webNtpReset')?.addEventListener('click', async () => { if (!window.confirm(t('confirmReset'))) return; settings = structuredCloneSafe(DEFAULTS); applyAll(); await persist(true); });
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
