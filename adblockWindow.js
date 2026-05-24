(function initAdblockWindow() {
    const DEFAULTS = {
        mode: 'ideal',
        showBlockedCount: true,
        autoRefreshOnModeChange: false,
        strictBlock: false,
        developerMode: false
    };

    const MODE_I18N_KEYS = {
        basic: {
            label: 'adblock.mode.basic.label',
            description: 'adblock.mode.basic.description'
        },
        ideal: {
            label: 'adblock.mode.ideal.label',
            description: 'adblock.mode.ideal.description'
        },
        aggressive: {
            label: 'adblock.mode.aggressive.label',
            description: 'adblock.mode.aggressive.description'
        }
    };

    const UI_THEME_STORAGE_KEY = 'ardali_ui_theme';
    const SHARED_THEME_KEY = 'theme';
    const THEME_ALIASES = {
        github: 'light',
        'aur-renk-efektleri': 'ardali',
        'performance-lite': 'dark',
        'performance-balanced': 'ardali'
    };
    const THEME_OPTIONS = new Set([
        'ardali',
        'dark',
        'black',
        'light',
        'frappe',
        'onedark',
        'matrix',
        'latte',
        'solarized-dark'
    ]);

    function t(key, fallback = '') {
        try {
            const value = window.i18n?.tSync?.(key);
            if (value && value !== key) return value;
        } catch {
            // ignore
        }
        return fallback || String(key || '');
    }

    const elements = {
        tabButtons: Array.from(document.querySelectorAll('.adblock-tab-button[data-adblock-tab]')),
        tabPanels: Array.from(document.querySelectorAll('.adblock-tab-panel[data-adblock-panel]')),
        cards: Array.from(document.querySelectorAll('.adblock-mode-card[data-adblock-mode]')),
        modeGrid: document.getElementById('adblockModeGrid'),
        modeText: document.getElementById('adblockModeText'),
        modeDescription: document.getElementById('adblockModeDescription'),
        currentHost: document.getElementById('adblockCurrentHost'),
        showCount: document.getElementById('adblockShowBlockedCount'),
        autoRefresh: document.getElementById('adblockAutoRefreshOnModeChange'),
        strictBlock: document.getElementById('adblockStrictBlock'),
        developerMode: document.getElementById('adblockDeveloperMode'),
        blocked: document.getElementById('adblockBlockedCount'),
        total: document.getElementById('adblockTotalCount'),
        rulesets: document.getElementById('adblockRulesetCount'),
        domains: document.getElementById('adblockDomainRuleCount'),
        dnrRules: document.getElementById('adblockDnrRuleCount'),
        recent: document.getElementById('adblockRecentList'),
        rulesetBreakdown: document.getElementById('adblockRulesetBreakdown'),
        lastRule: document.getElementById('adblockLastRule'),
        reset: document.getElementById('adblockResetStatsBtn'),
        refresh: document.getElementById('adblockRefreshStatsBtn'),
        backup: document.getElementById('adblockBackupBtn'),
        restore: document.getElementById('adblockRestoreBtn'),
        restoreInput: document.getElementById('adblockRestoreInput'),
        resetDefaults: document.getElementById('adblockResetDefaultsBtn'),
        developView: document.getElementById('adblockDevelopView'),
        developEditor: document.getElementById('adblockDevelopEditor'),
        developLines: document.getElementById('adblockDevelopLineNumbers'),
        developSave: document.getElementById('adblockDevelopSaveBtn'),
        developRevert: document.getElementById('adblockDevelopRevertBtn')
    };

    let settings = {};
    let adblock = { ...DEFAULTS };
    let saveTimer = null;
    let lastStats = null;
    let developSourcesLoaded = false;

    function normalizeTheme(theme) {
        const raw = String(theme || '').trim().toLowerCase();
        const mapped = THEME_ALIASES[raw] || raw;
        return THEME_OPTIONS.has(mapped) ? mapped : 'black';
    }

    function applyTheme(theme, options = {}) {
        const nextTheme = normalizeTheme(theme);
        const commitTheme = () => {
            document.documentElement.setAttribute('theme', nextTheme);
            document.documentElement.dataset.ardaliTheme = nextTheme;
            document.body?.setAttribute('data-ardali-theme', nextTheme);
        };
        const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
        if (!options.animate || prefersReducedMotion || typeof document.startViewTransition !== 'function') {
            commitTheme();
            return;
        }
        try {
            document.startViewTransition(commitTheme);
        } catch {
            commitTheme();
        }
    }

    function getStoredTheme() {
        try {
            return normalizeTheme(
                settings?.appearance?.theme ||
                localStorage.getItem(UI_THEME_STORAGE_KEY) ||
                localStorage.getItem(SHARED_THEME_KEY) ||
                'black'
            );
        } catch {
            return normalizeTheme(settings?.appearance?.theme || 'black');
        }
    }

    function drawStaticKnob(canvas) {
        if (!canvas || typeof canvas.getContext !== 'function') return;
        const ctx = canvas.getContext('2d', { alpha: true });
        if (!ctx) return;

        const width = canvas.width || 130;
        const height = canvas.height || 150;
        const level = Math.max(1, Math.min(3, Number(canvas.dataset.level) || 2));
        const value = Math.max(0, Math.min(100, Number(canvas.dataset.value) || 0));
        const label = t(canvas.dataset.labelKey, String(canvas.dataset.label || '').trim());
        const accent = level === 1 ? '#53d2ff' : level === 3 ? '#5cf2c4' : '#86a7ff';
        const accentSoft = level === 1 ? 'rgba(83, 210, 255, 0.55)' : level === 3 ? 'rgba(92, 242, 196, 0.55)' : 'rgba(134, 167, 255, 0.55)';
        const cx = width / 2;
        const cy = 58;
        const radius = 44;
        const innerRadius = radius - 10;
        const arcRadius = radius - 5;
        const startDeg = 135;
        const spanDeg = 270;
        const segments = 54;
        const activeSegments = Math.round((value / 100) * segments);
        const degToRad = (deg) => deg * Math.PI / 180;

        ctx.clearRect(0, 0, width, height);

        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fillStyle = '#2a2a2a';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(cx, cy, innerRadius, 0, Math.PI * 2);
        ctx.fillStyle = '#1f1f1f';
        ctx.fill();

        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        for (let i = 0; i < segments; i += 1) {
            const angleStart = startDeg + (i * spanDeg / segments);
            const angleEnd = angleStart + (spanDeg / segments) - 1;
            ctx.beginPath();
            ctx.arc(cx, cy, arcRadius, degToRad(angleStart), degToRad(angleEnd));
            ctx.strokeStyle = i < activeSegments ? accent : 'rgba(42, 52, 70, 0.72)';
            ctx.stroke();
        }

        const dotDeg = startDeg + ((Math.max(0, activeSegments - 1) / segments) * spanDeg);
        const dotX = cx + Math.cos(degToRad(dotDeg)) * arcRadius;
        const dotY = cy + Math.sin(degToRad(dotDeg)) * arcRadius;
        const glow = ctx.createRadialGradient(dotX, dotY, 0, dotX, dotY, 14);
        glow.addColorStop(0, accentSoft);
        glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.beginPath();
        ctx.arc(dotX, dotY, 14, 0, Math.PI * 2);
        ctx.fillStyle = glow;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(dotX, dotY, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = accent;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(cx, cy, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#5a5a5a';
        ctx.fill();

        ctx.font = 'bold 14px Arial';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.fillText(`${Math.round(value)}%`, cx, height - 30);

        ctx.font = '9px Arial';
        ctx.fillStyle = 'rgb(180, 180, 180)';
        ctx.fillText(label.toUpperCase(), cx, height - 10);
    }

    function drawAdblockModeKnobs() {
        document.querySelectorAll('.adblock-mode-knob').forEach(drawStaticKnob);
    }

    function normalizeMode(mode) {
        const value = String(mode || '').trim().toLowerCase();
        if (value === 'basic' || value === 'aggressive') return value;
        return 'ideal';
    }

    function ensureAdblock(raw) {
        const next = raw && typeof raw === 'object' ? raw : {};
        return {
            mode: normalizeMode(next.mode || DEFAULTS.mode),
            showBlockedCount: typeof next.showBlockedCount === 'boolean' ? next.showBlockedCount : DEFAULTS.showBlockedCount,
            autoRefreshOnModeChange: typeof next.autoRefreshOnModeChange === 'boolean' ? next.autoRefreshOnModeChange : DEFAULTS.autoRefreshOnModeChange,
            strictBlock: typeof next.strictBlock === 'boolean' ? next.strictBlock : DEFAULTS.strictBlock,
            developerMode: typeof next.developerMode === 'boolean' ? next.developerMode : DEFAULTS.developerMode
        };
    }

    function bridgeConfig() {
        return {
            mode: normalizeMode(adblock.mode),
            autoReload: !!adblock.autoRefreshOnModeChange,
            showBlockedCount: !!adblock.showBlockedCount,
            strictBlock: !!adblock.strictBlock,
            developerMode: !!adblock.developerMode
        };
    }

    function updateModeUi() {
        const mode = normalizeMode(adblock.mode);
        const copy = MODE_I18N_KEYS[mode] || MODE_I18N_KEYS.ideal;
        if (elements.modeGrid) elements.modeGrid.dataset.mode = mode;
        if (elements.modeText) elements.modeText.textContent = t(copy.label, mode);
        if (elements.modeDescription) elements.modeDescription.textContent = t(copy.description, '');
        document.title = t('adblock.windowTitle', 'DeliBlock');
        document.body.dataset.developerMode = adblock.developerMode ? 'true' : 'false';
        elements.cards.forEach((card) => {
            const active = normalizeMode(card.dataset.adblockMode) === mode;
            card.classList.toggle('active', active);
            card.setAttribute('aria-checked', active ? 'true' : 'false');
        });
        if (elements.showCount) elements.showCount.checked = !!adblock.showBlockedCount;
        if (elements.autoRefresh) elements.autoRefresh.checked = !!adblock.autoRefreshOnModeChange;
        if (elements.strictBlock) elements.strictBlock.checked = !!adblock.strictBlock;
        if (elements.developerMode) elements.developerMode.checked = !!adblock.developerMode;
        drawAdblockModeKnobs();
    }

    function setActiveTab(tabName) {
        const requested = String(tabName || 'settings');
        const safeTab = requested === 'develop' && !adblock.developerMode ? 'settings' : requested;
        document.body.dataset.activePane = safeTab;
        elements.tabButtons.forEach((button) => {
            const active = button.dataset.adblockTab === safeTab;
            button.classList.toggle('active', active);
            button.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        elements.tabPanels.forEach((panel) => {
            panel.classList.toggle('active', panel.dataset.adblockPanel === safeTab);
        });
    }

    function readUi() {
        if (elements.showCount) adblock.showBlockedCount = !!elements.showCount.checked;
        if (elements.autoRefresh) adblock.autoRefreshOnModeChange = !!elements.autoRefresh.checked;
        if (elements.strictBlock) adblock.strictBlock = !!elements.strictBlock.checked;
        if (elements.developerMode) adblock.developerMode = !!elements.developerMode.checked;
        adblock.mode = normalizeMode(adblock.mode);
    }

    async function saveAndApply() {
        readUi();
        settings.adblock = { ...adblock };
        await window.ardali?.adblock?.setConfig?.(bridgeConfig());
        await window.ardali?.saveSettings?.(settings);
        updateModeUi();
        if (!adblock.developerMode && document.body.dataset.activePane === 'develop') setActiveTab('settings');
        await refreshStats();
    }

    function scheduleSave() {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            saveTimer = null;
            saveAndApply().catch((error) => {
                console.warn('[ADBLOCK_WINDOW] save error:', error?.message || error);
            });
        }, 160);
    }

    function setNumber(element, value) {
        if (!element) return;
        element.textContent = String(Math.max(0, Number(value) || 0));
    }

    function formatTime(ts) {
        const value = Number(ts) || 0;
        if (!value) return '';
        try {
            return new Date(value).toLocaleTimeString('tr-TR', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
        } catch {
            return '';
        }
    }

    function shortText(value, max = 92) {
        const text = String(value || '').trim();
        if (text.length <= max) return text;
        return `${text.slice(0, Math.max(0, max - 1))}...`;
    }

    function formatDevelopList(values, indent = '  - ') {
        return values.map((value) => `${indent}${value}`).join('\n');
    }

    function createDevelopModeText(stats) {
        const config = stats?.config || {};
        const mode = normalizeMode(config.mode || adblock.mode);
        const active = stats?.activeRulesets || {};
        const dnrLines = Array.isArray(active.dnr) && active.dnr.length
            ? active.dnr.map((item) => `  - ${item?.label || item?.id || 'ruleset'}${item?.hasRegex ? ' + regex' : ''}`)
            : [`  - ${t('adblock.rulesets.noActive', 'No active source yet')}`];
        const strictLines = Array.isArray(active.strictblock) && active.strictblock.length
            ? active.strictblock.map((item) => `  - ${item?.label || item?.id || 'strictblock'}`)
            : [`  - ${t('adblock.rulesets.off', 'Off')}`];
        const scriptingLines = Array.isArray(active.scripting) && active.scripting.length
            ? active.scripting.map((item) => `  - ${item?.label || item?.id || 'scripting'} (${(item?.assets || []).join(', ')})`)
            : [`  - ${t('adblock.rulesets.noActive', 'No active source yet')}`];
        return [
            t('adblock.develop.registryTitle', 'DeliBlock registry:'),
            `${t('adblock.develop.mode', 'mode')}: ${t(MODE_I18N_KEYS[mode]?.label, 'Ideal')}`,
            `${t('adblock.develop.strictBlock', 'strictBlock')}: ${config.strictBlock ? 'true' : 'false'}`,
            `${t('adblock.develop.developerMode', 'developerMode')}: ${config.developerMode ? 'true' : 'false'}`,
            '',
            t('adblock.develop.activeNetworkRulesets', 'active network rulesets:'),
            ...dnrLines,
            '',
            t('adblock.develop.activeStrictblockRulesets', 'active strictblock rulesets:'),
            ...strictLines,
            '',
            t('adblock.develop.availableScriptingAssets', 'available scripting assets:'),
            ...scriptingLines,
            '',
        ].join('\n');
    }

    function createDevelopDnrText(stats) {
        const byRuleset = stats?.blockedByRuleset && typeof stats.blockedByRuleset === 'object'
            ? Object.entries(stats.blockedByRuleset).sort((a, b) => Number(b[1]) - Number(a[1]))
            : [];
        return [
            `mode: ${stats?.mode || normalizeMode(adblock.mode)}`,
            `rulesetCount: ${Number(stats?.rulesetCount) || 0}`,
            `domainRuleCount: ${Number(stats?.domainRuleCount) || 0}`,
            `dnrRuleCount: ${Number(stats?.dnrRuleCount) || 0}`,
            `cosmeticSelectorCount: ${Number(stats?.cosmeticSelectorCount) || 0}`,
            '',
            t('adblock.develop.matchedRulesets', 'matched rulesets:'),
            byRuleset.length ? formatDevelopList(byRuleset.map(([name, count]) => `${name}: ${count}`)) : `  - ${t('adblock.develop.none', 'none')}`
        ].join('\n');
    }

    function createDevelopSessionText(stats) {
        const recent = Array.isArray(stats?.recentBlocked) ? stats.recentBlocked : [];
        const rows = recent.slice(0, 20).map((item) => {
            const host = item?.hostname || 'unknown';
            const action = item?.action || 'block';
            const ruleset = item?.ruleset || item?.reason || 'legacy';
            const type = item?.resourceType || 'other';
            return `${formatTime(item?.at)} ${action} ${type} ${ruleset} ${host}${item?.path ? ` ${item.path}` : ''}`.trim();
        });
        return [
            `blockedSession: ${Number(stats?.blocked) || 0}`,
            `blockedTotal: ${Number(stats?.totalBlocked) || 0}`,
            `lastBlockedAt: ${stats?.lastBlockedAt ? new Date(stats.lastBlockedAt).toISOString() : 'none'}`,
            '',
            t('adblock.develop.recent', 'recent:'),
            rows.length ? formatDevelopList(rows) : `  - ${t('adblock.develop.none', 'none')}`
        ].join('\n');
    }

    function setDevelopEditorText(text, editable = false) {
        if (!elements.developEditor) return;
        const value = String(text || '');
        elements.developEditor.value = value;
        elements.developEditor.readOnly = !editable;
        const lineCount = Math.max(1, value.split('\n').length);
        if (elements.developLines) {
            elements.developLines.textContent = Array.from({ length: lineCount }, (_, index) => String(index + 1)).join('\n');
        }
        if (elements.developSave) elements.developSave.disabled = true;
        if (elements.developRevert) elements.developRevert.disabled = true;
    }

    function createOption(value, label) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        return option;
    }

    async function populateDevelopSources() {
        if (!elements.developView || developSourcesLoaded) return;
        developSourcesLoaded = true;
        try {
            const result = await window.ardali?.adblock?.listDevelopSources?.();
            const sources = Array.isArray(result?.sources) ? result.sources : [];
            if (!sources.length) return;

            elements.developView.replaceChildren();
            const editorGroup = document.createElement('optgroup');
            editorGroup.label = t('adblock.develop.view', 'View:').replace(/:$/, '');
            const readonlyGroup = document.createElement('optgroup');
            readonlyGroup.label = 'DNR ruleset';
            const rulesetGroup = document.createElement('optgroup');
            rulesetGroup.label = t('adblock.stats.dnrRules', 'DNR rules');

            for (const source of sources) {
                const option = createOption(source.id, source.label);
                if (source.group === 'rulesets') rulesetGroup.appendChild(option);
                else if (source.group === 'readonly') readonlyGroup.appendChild(option);
                else editorGroup.appendChild(option);
            }

            elements.developView.append(editorGroup, readonlyGroup, rulesetGroup);
            elements.developView.value = 'modes';
        } catch (error) {
            console.warn('[ADBLOCK_WINDOW] develop source list error:', error?.message || error);
        }
    }

    async function updateDevelopEditor(stats = lastStats) {
        if (!elements.developEditor) return;
        await populateDevelopSources();
        const view = String(elements.developView?.value || 'modes');
        if (view === 'dnr') {
            setDevelopEditorText(createDevelopDnrText(stats), false);
            return;
        }
        if (view === 'session') {
            setDevelopEditorText(createDevelopSessionText(stats), false);
            return;
        }
        try {
            const result = await window.ardali?.adblock?.readDevelopSource?.(view);
            if (result?.ok) {
                setDevelopEditorText(result.text, !!result.editable);
                return;
            }
        } catch (error) {
            console.warn('[ADBLOCK_WINDOW] develop source read error:', error?.message || error);
        }
        setDevelopEditorText(createDevelopModeText(stats), false);
    }

    function renderHostSummary(item) {
        if (!elements.currentHost) return;
        const hostname = String(item?.hostname || '').trim();
        elements.currentHost.textContent = hostname ? shortText(hostname, 42) : t('adblock.about.activeWebTab', 'Active web tab');
    }

    function renderLastRule(item) {
        if (!elements.lastRule) return;
        if (!item) {
            elements.lastRule.textContent = t('adblock.rulesets.noMatch', 'No matching rule yet.');
            return;
        }
        const pieces = [
            item.ruleset ? `ruleset: ${item.ruleset}` : '',
            item.rule ? `kural: ${item.rule}` : '',
            item.action ? `işlem: ${item.action}` : ''
        ].filter(Boolean);
        elements.lastRule.textContent = pieces.length ? pieces.join(' / ') : t('adblock.rulesets.noMatch', 'No matching rule yet.');
    }

    function renderRulesetBreakdown(value) {
        if (!elements.rulesetBreakdown) return;
        const entries = value && typeof value === 'object'
            ? Object.entries(value).filter(([, count]) => Number(count) > 0)
            : [];
        entries.sort((a, b) => Number(b[1]) - Number(a[1]));

        elements.rulesetBreakdown.replaceChildren();
        if (!entries.length) {
            const empty = document.createElement('p');
            empty.className = 'adblock-log-empty';
            empty.textContent = t('adblock.rulesets.empty', 'Waiting for a ruleset match.');
            elements.rulesetBreakdown.appendChild(empty);
            return;
        }

        const max = Math.max(...entries.map(([, count]) => Number(count) || 0), 1);
        for (const [name, count] of entries.slice(0, 7)) {
            const row = document.createElement('div');
            row.className = 'adblock-ruleset-row';

            const label = document.createElement('span');
            label.textContent = shortText(name, 34);

            const amount = document.createElement('strong');
            amount.textContent = String(Number(count) || 0);

            const bar = document.createElement('i');
            bar.style.setProperty('--ruleset-fill', `${Math.max(6, Math.round((Number(count) || 0) / max * 100))}%`);

            row.append(label, amount, bar);
            elements.rulesetBreakdown.appendChild(row);
        }
    }

    function renderRecentBlocked(items) {
        if (!elements.recent) return;
        const list = Array.isArray(items) ? items.slice(0, 12) : [];
        elements.recent.replaceChildren();
        if (!list.length) {
            const empty = document.createElement('p');
            empty.className = 'adblock-log-empty';
            empty.textContent = 'Henüz engellenen istek yok.';
            elements.recent.appendChild(empty);
            return;
        }

        for (const item of list) {
            const row = document.createElement('div');
            row.className = 'adblock-log-row';

            const top = document.createElement('div');
            top.className = 'adblock-log-top';

            const host = document.createElement('strong');
            host.textContent = shortText(item?.hostname || item?.url || 'bilinmeyen istek', 54);

            const time = document.createElement('span');
            time.textContent = formatTime(item?.at);

            const meta = document.createElement('div');
            meta.className = 'adblock-log-meta';
            meta.textContent = [
                item?.ruleset ? `ruleset: ${item.ruleset}` : '',
                item?.action ? `işlem: ${item.action}` : '',
                item?.rule ? `kural: ${item.rule}` : '',
                item?.resourceType ? `tip: ${item.resourceType}` : ''
            ].filter(Boolean).join(' / ');

            const path = document.createElement('div');
            path.className = 'adblock-log-url';
            path.textContent = shortText(item?.path || item?.url || '', 118);

            top.append(host, time);
            row.append(top, meta, path);
            elements.recent.appendChild(row);
        }
    }

    async function refreshStats() {
        const stats = await window.ardali?.adblock?.getStats?.();
        lastStats = stats || null;
        setNumber(elements.blocked, stats?.blocked);
        setNumber(elements.total, stats?.totalBlocked ?? stats?.blocked);
        setNumber(elements.rulesets, stats?.rulesetCount);
        setNumber(elements.domains, stats?.domainRuleCount);
        setNumber(elements.dnrRules, stats?.dnrRuleCount);
        const recent = Array.isArray(stats?.recentBlocked) ? stats.recentBlocked : [];
        const last = recent[0] || stats?.lastBlocked || null;
        renderHostSummary(last);
        renderLastRule(last);
        renderRulesetBreakdown(stats?.blockedByRuleset);
        renderRecentBlocked(recent);
        updateDevelopEditor(stats).catch(() => {});
        return stats;
    }

    async function resetStats() {
        await window.ardali?.adblock?.resetStats?.();
        await refreshStats();
    }

    function downloadBackup() {
        const payload = {
            exportedAt: new Date().toISOString(),
            adblock: { ...adblock }
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'deliblock-settings.json';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 500);
    }

    async function restoreBackupFile(file) {
        if (!file) return;
        const text = await file.text();
        const parsed = JSON.parse(text);
        adblock = ensureAdblock(parsed?.adblock || parsed);
        updateModeUi();
        await saveAndApply();
    }

    async function resetDefaults() {
        adblock = ensureAdblock(DEFAULTS);
        updateModeUi();
        await saveAndApply();
    }

    async function load() {
        if (window.i18n && typeof window.i18n.init === 'function') {
            await window.i18n.init();
        }
        settings = await window.ardali?.loadSettings?.() || {};
        adblock = ensureAdblock(settings.adblock);
        applyTheme(getStoredTheme());
        window.i18n?.translatePage?.();
        updateModeUi();
        setActiveTab('settings');
        await window.ardali?.adblock?.setConfig?.(bridgeConfig());
        await refreshStats();
    }

    elements.cards.forEach((card) => {
        card.addEventListener('click', () => {
            adblock.mode = normalizeMode(card.dataset.adblockMode);
            updateModeUi();
            scheduleSave();
        });
    });

    [elements.showCount, elements.autoRefresh, elements.strictBlock, elements.developerMode]
        .forEach((element) => {
            element?.addEventListener('change', scheduleSave);
        });

    elements.tabButtons.forEach((button) => {
        button.addEventListener('click', () => setActiveTab(button.dataset.adblockTab));
    });

    elements.reset?.addEventListener('click', () => {
        resetStats().catch((error) => console.warn('[ADBLOCK_WINDOW] reset error:', error?.message || error));
    });
    elements.refresh?.addEventListener('click', () => {
        refreshStats().catch((error) => console.warn('[ADBLOCK_WINDOW] refresh error:', error?.message || error));
    });
    elements.backup?.addEventListener('click', downloadBackup);
    elements.restore?.addEventListener('click', () => elements.restoreInput?.click());
    elements.restoreInput?.addEventListener('change', () => {
        const file = elements.restoreInput?.files?.[0];
        restoreBackupFile(file)
            .catch((error) => console.warn('[ADBLOCK_WINDOW] restore error:', error?.message || error))
            .finally(() => {
                if (elements.restoreInput) elements.restoreInput.value = '';
            });
    });
    elements.resetDefaults?.addEventListener('click', () => {
        resetDefaults().catch((error) => console.warn('[ADBLOCK_WINDOW] reset defaults error:', error?.message || error));
    });
    elements.developView?.addEventListener('change', () => {
        updateDevelopEditor().catch((error) => console.warn('[ADBLOCK_WINDOW] develop switch error:', error?.message || error));
    });
    elements.developEditor?.addEventListener('scroll', () => {
        if (elements.developLines) elements.developLines.scrollTop = elements.developEditor.scrollTop;
    });

    window.ardali?.onSettingsReload?.((nextSettings) => {
        if (!nextSettings || typeof nextSettings !== 'object') return;
        settings = nextSettings;
        adblock = ensureAdblock(settings.adblock);
        applyTheme(getStoredTheme(), { animate: true });
        const nextLang = String(settings?.ui?.language || '').trim();
        if (nextLang && window.i18n?.setLanguage) {
            window.i18n.setLanguage(nextLang, { skipPersist: true }).catch(() => {
                window.i18n?.translatePage?.();
                updateModeUi();
            });
        } else {
            window.i18n?.translatePage?.();
        }
        updateModeUi();
        if (!adblock.developerMode && document.body.dataset.activePane === 'develop') setActiveTab('settings');
        refreshStats().catch(() => {});
    });

    window.addEventListener('storage', (event) => {
        if (event.key !== UI_THEME_STORAGE_KEY && event.key !== SHARED_THEME_KEY) return;
        applyTheme(event.newValue || 'black', { animate: true });
    });

    window.i18n?.onChange?.(() => {
        window.i18n?.translatePage?.();
        updateModeUi();
        updateDevelopEditor().catch(() => {});
    });

    load().catch((error) => {
        console.warn('[ADBLOCK_WINDOW] load error:', error?.message || error);
        updateModeUi();
    });

    setInterval(() => {
        refreshStats().catch(() => {});
    }, 1200);
}());
