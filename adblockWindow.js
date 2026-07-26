(function initAdblockWindow() {
    const DEFAULTS = {
        mode: 'ideal',
        showBlockedCount: true,
        autoRefreshOnModeChange: false,
        strictBlock: false,
        developerMode: false,
        protectionPolicyVersion: 1,
        userFilters: [],
        sitePolicies: {},
        enabledRulesetIds: [],
        rulesetSelectionConfigured: false,
        autoUpdateRulesets: true
    };
    const BACKUP_FORMAT = 'ardali-deliblock-settings';
    const BACKUP_VERSION = 1;
    const INITIAL_TAB = String(new URLSearchParams(location.search).get('tab') || 'settings').trim().toLowerCase();
    const TRANSIENT_BACKUP_KEYS = new Set([
        'statistics',
        'requestLog',
        'recentBlocked',
        'blockedSession',
        'blockedTotal',
        'cache',
        'rulesetMetadata'
    ]);

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
    const ADBLOCK_THEME_STORAGE_KEY = 'ardaliAdblockTheme';
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
        developRevert: document.getElementById('adblockDevelopRevertBtn'),
        userFilterEditor: document.getElementById('adblockUserFilterEditor'),
        userFilterAdd: document.getElementById('adblockUserFilterAddBtn'),
        userFilterImport: document.getElementById('adblockUserFilterImportBtn'),
        userFilterExport: document.getElementById('adblockUserFilterExportBtn'),
        userFilterImportInput: document.getElementById('adblockUserFilterImportInput'),
        userFilterValidation: document.getElementById('adblockUserFilterValidation'),
        userFilterList: document.getElementById('adblockUserFilterList'),
        siteHostname: document.getElementById('adblockSiteHostname'),
        siteWhitelist: document.getElementById('adblockSiteWhitelist'),
        siteAds: document.getElementById('adblockSiteAds'),
        siteTrackers: document.getElementById('adblockSiteTrackers'),
        siteSave: document.getElementById('adblockSiteSaveBtn'),
        sitePolicyList: document.getElementById('adblockSitePolicyList'),
        rulesetCatalog: document.getElementById('adblockRulesetCatalog'),
        rulesetUpdate: document.getElementById('adblockRulesetUpdateBtn'),
        rulesetAutoUpdate: document.getElementById('adblockRulesetAutoUpdate'),
        rulesetUpdateStatus: document.getElementById('adblockRulesetUpdateStatus'),
        loggerSearch: document.getElementById('adblockLoggerSearch'),
        loggerAction: document.getElementById('adblockLoggerAction'),
        networkLog: document.getElementById('adblockNetworkLog'),
        statsToday: document.getElementById('adblockStatsToday'),
        statsWeek: document.getElementById('adblockStatsWeek'),
        statsMonth: document.getElementById('adblockStatsMonth'),
        statsTotal: document.getElementById('adblockStatsTotal'),
        statsTrackers: document.getElementById('adblockStatsTrackers'),
        statsSaved: document.getElementById('adblockStatsSaved'),
        statsSpeed: document.getElementById('adblockStatsSpeed'),
        statsWhitelistSites: document.getElementById('adblockStatsWhitelistSites'),
        statsWhitelistAllowed: document.getElementById('adblockStatsWhitelistAllowed'),
        activeSiteStatus: document.getElementById('adblockActiveSiteStatus'),
        topSites: document.getElementById('adblockTopSites'),
        topLists: document.getElementById('adblockTopLists'),
        diagLoaded: document.getElementById('adblockDiagLoaded'),
        diagActive: document.getElementById('adblockDiagActive'),
        diagBlocked: document.getElementById('adblockDiagBlocked'),
        diagAllowed: document.getElementById('adblockDiagAllowed'),
        diagTime: document.getElementById('adblockDiagTime'),
        diagMemory: document.getElementById('adblockDiagMemory')
    };

    let settings = {};
    let adblock = { ...DEFAULTS };
    let saveTimer = null;
    let lastStats = null;
    let developSourcesLoaded = false;
    let siteEditorHostname = '';
    let statsRefreshInterval = null;

    function stopStatsRefresh() {
        if (statsRefreshInterval === null) return;
        clearInterval(statsRefreshInterval);
        statsRefreshInterval = null;
    }

    function startStatsRefresh() {
        if (statsRefreshInterval !== null) return;
        statsRefreshInterval = setInterval(() => {
            refreshStats().catch(() => {});
        }, 1200);
    }

    function normalizeTheme(theme) {
        const raw = String(theme || '').trim().toLowerCase();
        const mapped = THEME_ALIASES[raw] || raw;
        return THEME_OPTIONS.has(mapped) ? mapped : 'black';
    }

    function getAppTheme() {
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

    function getAdblockThemePreference() {
        try {
            const raw = String(localStorage.getItem(ADBLOCK_THEME_STORAGE_KEY) || 'app').trim().toLowerCase();
            return raw === 'app' ? 'app' : normalizeTheme(raw);
        } catch {
            return 'app';
        }
    }

    function applyTheme(theme, options = {}) {
        const requestedTheme = String(theme || 'app').trim().toLowerCase();
        const nextTheme = requestedTheme === 'app' ? getAppTheme() : normalizeTheme(requestedTheme);
        const commitTheme = () => {
            document.documentElement.setAttribute('theme', nextTheme);
            document.documentElement.dataset.ardaliTheme = nextTheme;
            document.body?.setAttribute('data-ardali-theme', nextTheme);
            try {
                localStorage.setItem(ADBLOCK_THEME_STORAGE_KEY, requestedTheme === 'app' ? 'app' : nextTheme);
            } catch {
                // ignore
            }
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
        const preference = getAdblockThemePreference();
        return preference === 'app' ? 'app' : preference;
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
            ...next,
            mode: normalizeMode(next.mode || DEFAULTS.mode),
            showBlockedCount: typeof next.showBlockedCount === 'boolean' ? next.showBlockedCount : DEFAULTS.showBlockedCount,
            autoRefreshOnModeChange: typeof next.autoRefreshOnModeChange === 'boolean' ? next.autoRefreshOnModeChange : DEFAULTS.autoRefreshOnModeChange,
            strictBlock: typeof next.strictBlock === 'boolean' ? next.strictBlock : DEFAULTS.strictBlock,
            developerMode: typeof next.developerMode === 'boolean' ? next.developerMode : DEFAULTS.developerMode,
            userFilters: Array.isArray(next.userFilters) ? next.userFilters : [],
            sitePolicies: next.sitePolicies && typeof next.sitePolicies === 'object' && !Array.isArray(next.sitePolicies) ? next.sitePolicies : {},
            enabledRulesetIds: Array.isArray(next.enabledRulesetIds) ? next.enabledRulesetIds : [],
            rulesetSelectionConfigured: next.rulesetSelectionConfigured === true,
            rulesetMetadata: next.rulesetMetadata && typeof next.rulesetMetadata === 'object' ? next.rulesetMetadata : {},
            autoUpdateRulesets: next.autoUpdateRulesets !== false,
            statistics: next.statistics && typeof next.statistics === 'object'
                ? next.statistics
                : { totalBlocked: 0, trackersBlocked: 0, estimatedBytesSaved: 0, whitelistAllowedRequests: 0, daily: {} }
        };
    }

    function cloneJsonValue(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function createPersistentAdblockSettings(raw) {
        const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
        const persistent = {};
        for (const [key, value] of Object.entries(source)) {
            if (TRANSIENT_BACKUP_KEYS.has(key) || typeof value === 'undefined') continue;
            persistent[key] = cloneJsonValue(value);
        }
        const policies = persistent.sitePolicies && typeof persistent.sitePolicies === 'object' && !Array.isArray(persistent.sitePolicies)
            ? persistent.sitePolicies
            : {};
        persistent.sitePolicies = Object.fromEntries(Object.entries(policies).map(([hostname, rawPolicy]) => {
            const policy = rawPolicy && typeof rawPolicy === 'object' && !Array.isArray(rawPolicy)
                ? cloneJsonValue(rawPolicy)
                : {};
            delete policy.temporaryDisabledUntil;
            if (policy.whitelistPrevious && typeof policy.whitelistPrevious === 'object') {
                delete policy.whitelistPrevious.temporaryDisabledUntil;
            }
            return [hostname, policy];
        }));
        return persistent;
    }

    function createDefaultAdblockSettings() {
        return ensureAdblock({
            ...cloneJsonValue(DEFAULTS),
            statistics: adblock.statistics,
            rulesetMetadata: adblock.rulesetMetadata
        });
    }

    function bridgeConfig() {
        return {
            mode: normalizeMode(adblock.mode),
            autoReload: !!adblock.autoRefreshOnModeChange,
            showBlockedCount: !!adblock.showBlockedCount,
            strictBlock: !!adblock.strictBlock,
            developerMode: !!adblock.developerMode,
            userFilters: adblock.userFilters,
            sitePolicies: adblock.sitePolicies,
            enabledRulesetIds: adblock.enabledRulesetIds,
            rulesetSelectionConfigured: adblock.rulesetSelectionConfigured,
            statistics: adblock.statistics
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
        if (elements.rulesetAutoUpdate) elements.rulesetAutoUpdate.checked = adblock.autoUpdateRulesets !== false;
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
        if (elements.rulesetAutoUpdate) adblock.autoUpdateRulesets = !!elements.rulesetAutoUpdate.checked;
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

    function renderActiveSiteStatus(stats) {
        if (!elements.activeSiteStatus) return;
        const hostname = String(stats?.activeHostname || '').trim().toLowerCase();
        const policy = hostname ? getSitePolicyForHostname(hostname) : null;
        const whitelisted = policy?.whitelisted === true;
        elements.activeSiteStatus.textContent = whitelisted
            ? t('adblock.whitelist.activeNotice', 'Bu site Beyaz Listede, koruma uygulanmıyor.')
            : '';
        elements.activeSiteStatus.hidden = !whitelisted;
    }

    function syncActiveSiteEditor(stats, force = false) {
        const hostname = normalizeHostname(stats?.activeHostname);
        if (!force && hostname === siteEditorHostname) return;
        siteEditorHostname = hostname;
        if (elements.siteHostname) elements.siteHostname.value = hostname;
        const policy = hostname ? getSitePolicyForHostname(hostname) : null;
        if (elements.siteWhitelist) elements.siteWhitelist.checked = policy?.whitelisted === true;
        if (elements.siteAds) elements.siteAds.checked = policy?.adBlocking !== false;
        if (elements.siteTrackers) elements.siteTrackers.checked = policy?.trackerProtection !== false;
        if (elements.siteSave) elements.siteSave.disabled = !hostname;
        updateSiteEditorState();
    }

    function getSitePolicyForHostname(hostname) {
        const parts = normalizeHostname(hostname).split('.').filter(Boolean);
        for (let index = 0; index < parts.length - 1; index += 1) {
            const candidate = parts.slice(index).join('.');
            if (adblock.sitePolicies[candidate]) return adblock.sitePolicies[candidate];
        }
        return null;
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

    function normalizeHostname(value) {
        const raw = String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0].replace(/:\d+$/, '');
        return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(raw) ? raw.replace(/^\.+|\.+$/g, '') : '';
    }

    function createManagerRow(title, meta = '') {
        const row = document.createElement('div');
        row.className = 'adblock-manager-row';
        const copy = document.createElement('div');
        const strong = document.createElement('strong');
        const small = document.createElement('small');
        strong.textContent = title;
        small.textContent = meta;
        copy.append(strong, small);
        const actions = document.createElement('div');
        actions.className = 'adblock-action-row';
        row.append(copy, actions);
        return { row, actions };
    }

    function makeSmallButton(label, action) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-small';
        button.textContent = label;
        button.dataset.action = action;
        return button;
    }

    function renderUserFilters() {
        if (!elements.userFilterList) return;
        elements.userFilterList.replaceChildren();
        if (!adblock.userFilters.length) {
            const empty = document.createElement('p');
            empty.className = 'adblock-log-empty';
            empty.textContent = t('adblock.filters.empty', 'Henüz kullanıcı filtresi yok.');
            elements.userFilterList.appendChild(empty);
            return;
        }
        const sortedFilters = [...adblock.userFilters].sort((left, right) => {
            const leftText = String(left?.text || left || '');
            const rightText = String(right?.text || right || '');
            return leftText.split('#')[0].localeCompare(rightText.split('#')[0]) || leftText.localeCompare(rightText);
        });
        for (const filter of sortedFilters) {
            const item = typeof filter === 'string' ? { id: '', text: filter, enabled: true } : filter;
            const site = String(item.text || '').includes('#') ? String(item.text).split('#')[0] : t('adblock.filters.network', 'Ağ filtresi');
            const status = item.enabled === false ? t('adblock.rulesets.off', 'Kapalı') : t('adblock.filters.enabled', 'Etkin');
            const { row, actions } = createManagerRow(item.text, `${site || '*'} · ${status}`);
            const toggle = makeSmallButton(item.enabled === false ? t('adblock.filters.enable', 'Etkinleştir') : t('adblock.filters.disable', 'Devre dışı'), 'toggle');
            const edit = makeSmallButton(t('adblock.filters.edit', 'Düzenle'), 'edit');
            const remove = makeSmallButton(t('adblock.filters.delete', 'Sil'), 'delete');
            toggle.addEventListener('click', () => {
                item.enabled = item.enabled === false;
                item.updatedAt = Date.now();
                scheduleSave();
                renderUserFilters();
            });
            edit.addEventListener('click', () => {
                if (elements.userFilterEditor) {
                    elements.userFilterEditor.value = item.text;
                    elements.userFilterEditor.dataset.editId = item.id || '';
                    elements.userFilterEditor.focus();
                }
            });
            remove.addEventListener('click', () => {
                adblock.userFilters = adblock.userFilters.filter((candidate) => candidate !== filter);
                scheduleSave();
                renderUserFilters();
            });
            actions.append(toggle, edit, remove);
            elements.userFilterList.appendChild(row);
        }
    }

    async function addOrUpdateUserFilters(text) {
        const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        if (!lines.length) return false;
        for (const line of lines) {
            const validation = await window.ardali?.adblock?.validateUserFilter?.(line);
            if (!validation?.ok) {
                if (elements.userFilterValidation) elements.userFilterValidation.textContent = `${line}: ${validation?.error || 'invalid-filter'}`;
                return false;
            }
        }
        const editId = String(elements.userFilterEditor?.dataset?.editId || '');
        const now = Date.now();
        if (editId && lines.length === 1) {
            const existing = adblock.userFilters.find((entry) => entry?.id === editId);
            if (existing) {
                existing.text = lines[0];
                existing.updatedAt = now;
            }
        } else {
            for (const line of lines) {
                if (adblock.userFilters.some((entry) => String(entry?.text || entry) === line)) continue;
                adblock.userFilters.push({ id: `user-${now.toString(36)}-${adblock.userFilters.length}`, text: line, enabled: true, createdAt: now, updatedAt: now });
            }
        }
        if (elements.userFilterEditor) {
            elements.userFilterEditor.value = '';
            delete elements.userFilterEditor.dataset.editId;
        }
        if (elements.userFilterValidation) elements.userFilterValidation.textContent = t('adblock.filters.valid', 'Filtre kaydedildi.');
        renderUserFilters();
        await saveAndApply();
        return true;
    }

    function renderSitePolicies() {
        if (!elements.sitePolicyList) return;
        elements.sitePolicyList.replaceChildren();
        const entries = Object.entries(adblock.sitePolicies).sort((a, b) => a[0].localeCompare(b[0]));
        if (!entries.length) {
            const empty = document.createElement('p');
            empty.className = 'adblock-log-empty';
            empty.textContent = t('adblock.sites.empty', 'Siteye özel kural yok.');
            elements.sitePolicyList.appendChild(empty);
            return;
        }
        for (const [hostname, policy] of entries) {
            const temporary = Number(policy.temporaryDisabledUntil || 0) > Date.now();
            const whitelisted = policy.whitelisted === true;
            const statuses = whitelisted
                ? [t('adblock.whitelist.status', 'Beyaz Listede')]
                : [
                    policy.adBlocking !== false ? t('adblock.whitelist.adsOn', 'Reklam Engelleme Açık') : '',
                    policy.trackerProtection !== false ? t('adblock.whitelist.trackersOn', 'İzleyici Koruması Açık') : '',
                    policy.adBlocking === false && policy.trackerProtection === false
                        ? t('adblock.whitelist.protectionOff', 'Koruma Kapalı')
                        : '',
                    temporary ? t('adblock.sites.temporaryOff', 'Geçici olarak kapalı') : ''
                ].filter(Boolean);
            const meta = statuses.join(' · ');
            const { row, actions } = createManagerRow(hostname, meta);
            const whitelistButton = makeSmallButton(
                whitelisted
                    ? t('adblock.whitelist.remove', 'Beyaz Listeden Çıkar')
                    : t('adblock.whitelist.add', 'Beyaz Listeye Al'),
                'whitelist'
            );
            const temporaryButton = makeSmallButton(t('adblock.sites.temporary', '10 dk kapat'), 'temporary');
            const remove = makeSmallButton(t('adblock.filters.delete', 'Sil'), 'delete');
            whitelistButton.addEventListener('click', () => {
                setPolicyWhitelist(policy, !whitelisted);
                scheduleSave();
                renderSitePolicies();
            });
            temporaryButton.addEventListener('click', () => {
                policy.temporaryDisabledUntil = Date.now() + 10 * 60 * 1000;
                scheduleSave();
                renderSitePolicies();
            });
            temporaryButton.disabled = whitelisted;
            remove.addEventListener('click', () => {
                delete adblock.sitePolicies[hostname];
                scheduleSave();
                renderSitePolicies();
            });
            actions.append(whitelistButton, temporaryButton, remove);
            elements.sitePolicyList.appendChild(row);
        }
    }

    function setPolicyWhitelist(policy, enabled) {
        if (!policy || typeof policy !== 'object') return;
        if (enabled) {
            if (policy.whitelisted !== true) {
                policy.whitelistPrevious = {
                    adBlocking: policy.adBlocking !== false,
                    trackerProtection: policy.trackerProtection !== false,
                    temporaryDisabledUntil: Math.max(0, Number(policy.temporaryDisabledUntil) || 0)
                };
            }
            policy.whitelisted = true;
            return;
        }
        const previous = policy.whitelistPrevious;
        if (previous && typeof previous === 'object') {
            policy.adBlocking = previous.adBlocking !== false;
            policy.trackerProtection = previous.trackerProtection !== false;
            policy.temporaryDisabledUntil = Math.max(0, Number(previous.temporaryDisabledUntil) || 0);
        }
        policy.whitelisted = false;
        policy.whitelistPrevious = null;
    }

    function updateSiteEditorState() {
        const whitelisted = elements.siteWhitelist?.checked === true;
        if (elements.siteAds) elements.siteAds.disabled = whitelisted;
        if (elements.siteTrackers) elements.siteTrackers.disabled = whitelisted;
    }

    async function refreshRulesetCatalog() {
        if (!elements.rulesetCatalog) return;
        const result = await window.ardali?.adblock?.getRulesetCatalog?.();
        const items = Array.isArray(result?.items) ? result.items : [];
        elements.rulesetCatalog.replaceChildren();
        for (const item of items) {
            const checked = adblock.rulesetSelectionConfigured ? adblock.enabledRulesetIds.includes(item.id) : item.active;
            const updated = item.lastUpdatedAt ? new Date(item.lastUpdatedAt).toLocaleDateString() : '-';
            const { row, actions } = createManagerRow(item.name || item.id, `${item.group || 'other'} · ${Number(item.rules?.total || 0).toLocaleString()} rules · v${item.version || 'bundled'} · ${updated}`);
            const toggle = document.createElement('input');
            toggle.type = 'checkbox';
            toggle.checked = checked;
            toggle.addEventListener('change', () => {
                const current = new Set(adblock.rulesetSelectionConfigured ? adblock.enabledRulesetIds : items.filter((entry) => entry.active).map((entry) => entry.id));
                if (toggle.checked) current.add(item.id); else current.delete(item.id);
                adblock.enabledRulesetIds = Array.from(current);
                adblock.rulesetSelectionConfigured = true;
                scheduleSave();
            });
            actions.appendChild(toggle);
            elements.rulesetCatalog.appendChild(row);
        }
    }

    function renderBreakdownInto(container, value) {
        if (!container) return;
        const entries = Object.entries(value || {}).filter(([, count]) => Number(count) > 0).sort((a, b) => b[1] - a[1]).slice(0, 10);
        container.replaceChildren();
        for (const [name, count] of entries) {
            const { row } = createManagerRow(name, String(count));
            container.appendChild(row);
        }
    }

    function formatBytes(value) {
        const bytes = Math.max(0, Number(value) || 0);
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    }

    function renderAdvancedStats(stats) {
        const persisted = stats?.statistics || {};
        const daily = persisted.daily && typeof persisted.daily === 'object' ? persisted.daily : {};
        const now = Date.now();
        const countSince = (ms) => Object.entries(daily).reduce((sum, [day, count]) => {
            const at = Date.parse(`${day}T00:00:00Z`);
            return at >= now - ms ? sum + Number(count || 0) : sum;
        }, 0);
        setNumber(elements.statsToday, countSince(24 * 60 * 60 * 1000));
        setNumber(elements.statsWeek, countSince(7 * 24 * 60 * 60 * 1000));
        setNumber(elements.statsMonth, countSince(30 * 24 * 60 * 60 * 1000));
        setNumber(elements.statsTotal, stats?.totalBlocked);
        const trackers = Object.entries(stats?.blockedByRuleset || {}).filter(([name]) => /privacy|tracker|spyware/i.test(name)).reduce((sum, [, count]) => sum + Number(count || 0), 0);
        setNumber(elements.statsTrackers, Math.max(trackers, Number(persisted.trackersBlocked) || 0));
        if (elements.statsSaved) elements.statsSaved.textContent = formatBytes(stats?.estimatedBytesSaved);
        const processed = Math.max(1, Number(stats?.processedRequests) || 0);
        if (elements.statsSpeed) elements.statsSpeed.textContent = `${Math.min(95, Math.round((Number(stats?.blocked) || 0) / processed * 100))}%`;
        setNumber(elements.statsWhitelistSites, stats?.whitelistSiteCount);
        setNumber(elements.statsWhitelistAllowed, stats?.whitelistAllowedRequests);
        renderBreakdownInto(elements.topSites, stats?.blockedByHostname);
        renderBreakdownInto(elements.topLists, stats?.blockedByRuleset);
        setNumber(elements.diagLoaded, stats?.dnrRuleCount);
        setNumber(elements.diagActive, stats?.rulesetCount);
        setNumber(elements.diagBlocked, stats?.blocked);
        setNumber(elements.diagAllowed, stats?.allowedRequests);
        if (elements.diagTime) elements.diagTime.textContent = `${Number(stats?.averageProcessingTimeMs || 0).toFixed(3)} ms`;
        if (elements.diagMemory) elements.diagMemory.textContent = `${(Number(stats?.memoryUsageBytes || 0) / 1024 ** 2).toFixed(1)} MB`;
    }

    function renderNetworkLog(stats) {
        if (!elements.networkLog) return;
        const search = String(elements.loggerSearch?.value || '').trim().toLowerCase();
        const action = String(elements.loggerAction?.value || 'all');
        const items = (Array.isArray(stats?.requestLog) ? stats.requestLog : []).filter((item) => {
            if (action !== 'all' && item.action !== action && !(action === 'block' && item.action === 'redirect')) return false;
            if (!search) return true;
            return [item.url, item.rule, item.ruleset, item.reason, item.resourceType].some((value) => String(value || '').toLowerCase().includes(search));
        }).slice(0, 300);
        elements.networkLog.replaceChildren();
        for (const item of items) {
            const reason = item.reason === 'Whitelist'
                ? t('adblock.whitelist.logReason', 'Whitelist')
                : (item.reason || '-');
            const { row } = createManagerRow(shortText(item.url, 130), `${formatTime(item.at)} · ${item.resourceType} · ${item.action} · ${item.ruleset || '-'} · ${reason} · ${item.rule || '-'}`);
            elements.networkLog.appendChild(row);
        }
    }

    async function refreshStats() {
        const stats = await window.ardali?.adblock?.getStats?.();
        lastStats = stats || null;
        if (stats?.statistics) adblock.statistics = stats.statistics;
        setNumber(elements.blocked, stats?.blocked);
        setNumber(elements.total, stats?.totalBlocked ?? stats?.blocked);
        setNumber(elements.rulesets, stats?.rulesetCount);
        setNumber(elements.domains, stats?.domainRuleCount);
        setNumber(elements.dnrRules, stats?.dnrRuleCount);
        const recent = Array.isArray(stats?.recentBlocked) ? stats.recentBlocked : [];
        const last = recent[0] || stats?.lastBlocked || null;
        renderHostSummary({ hostname: stats?.activeHostname || last?.hostname || '' });
        renderActiveSiteStatus(stats);
        syncActiveSiteEditor(stats);
        renderLastRule(last);
        renderRulesetBreakdown(stats?.blockedByRuleset);
        renderRecentBlocked(recent);
        renderAdvancedStats(stats);
        renderNetworkLog(stats);
        updateDevelopEditor(stats).catch(() => {});
        return stats;
    }

    async function resetStats() {
        await window.ardali?.adblock?.resetStats?.();
        await refreshStats();
    }

    function downloadBackup() {
        const payload = {
            format: BACKUP_FORMAT,
            version: BACKUP_VERSION,
            exportedAt: new Date().toISOString(),
            adblock: createPersistentAdblockSettings(adblock)
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
        const imported = parsed?.adblock || parsed;
        if (!imported || typeof imported !== 'object' || Array.isArray(imported)) {
            throw new Error('Geçersiz DeliBlock yedek dosyası');
        }
        const persistent = createPersistentAdblockSettings(imported);
        adblock = ensureAdblock({
            ...persistent,
            statistics: adblock.statistics,
            rulesetMetadata: adblock.rulesetMetadata
        });
        updateModeUi();
        renderUserFilters();
        renderSitePolicies();
        await saveAndApply();
        await refreshRulesetCatalog();
    }

    async function resetDefaults() {
        if (saveTimer) {
            clearTimeout(saveTimer);
            saveTimer = null;
        }
        adblock = createDefaultAdblockSettings();
        updateModeUi();
        renderUserFilters();
        renderSitePolicies();
        await saveAndApply();
        await refreshRulesetCatalog();
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
        renderUserFilters();
        renderSitePolicies();
        setActiveTab(INITIAL_TAB);
        await window.ardali?.adblock?.setConfig?.(bridgeConfig());
        if (adblock.autoUpdateRulesets !== false && Date.now() - Number(adblock.rulesetMetadata?.lastAutoUpdateAt || 0) > 24 * 60 * 60 * 1000) {
            await window.ardali?.adblock?.refreshRulesets?.();
            adblock.rulesetMetadata.lastAutoUpdateAt = Date.now();
            settings.adblock = { ...adblock };
            await window.ardali?.saveSettings?.(settings);
        }
        await refreshRulesetCatalog();
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
    elements.userFilterAdd?.addEventListener('click', () => {
        addOrUpdateUserFilters(elements.userFilterEditor?.value).catch((error) => {
            if (elements.userFilterValidation) elements.userFilterValidation.textContent = error?.message || String(error);
        });
    });
    elements.userFilterExport?.addEventListener('click', () => {
        const text = adblock.userFilters.map((entry) => String(entry?.text || entry || '')).filter(Boolean).join('\n');
        const blob = new Blob([`${text}\n`], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'deliblock-user-filters.txt';
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 500);
    });
    elements.userFilterImport?.addEventListener('click', () => elements.userFilterImportInput?.click());
    elements.userFilterImportInput?.addEventListener('change', () => {
        const file = elements.userFilterImportInput?.files?.[0];
        if (!file) return;
        file.text().then(addOrUpdateUserFilters).catch((error) => {
            if (elements.userFilterValidation) elements.userFilterValidation.textContent = error?.message || String(error);
        }).finally(() => { elements.userFilterImportInput.value = ''; });
    });
    elements.siteSave?.addEventListener('click', () => {
        const hostname = normalizeHostname(elements.siteHostname?.value);
        if (!hostname) return;
        const existingPolicy = adblock.sitePolicies[hostname] && typeof adblock.sitePolicies[hostname] === 'object'
            ? adblock.sitePolicies[hostname]
            : null;
        const policy = existingPolicy
            ? existingPolicy
            : { adBlocking: true, trackerProtection: true, temporaryDisabledUntil: 0 };
        const whitelisted = elements.siteWhitelist?.checked === true;
        if (whitelisted) {
            if (!existingPolicy) {
                policy.adBlocking = elements.siteAds?.checked !== false;
                policy.trackerProtection = elements.siteTrackers?.checked !== false;
            }
            setPolicyWhitelist(policy, true);
        } else {
            if (policy.whitelisted === true) setPolicyWhitelist(policy, false);
            policy.adBlocking = elements.siteAds?.checked !== false;
            policy.trackerProtection = elements.siteTrackers?.checked !== false;
        }
        policy.temporaryDisabledUntil = Math.max(0, Number(policy.temporaryDisabledUntil) || 0);
        adblock.sitePolicies[hostname] = policy;
        syncActiveSiteEditor({ activeHostname: hostname }, true);
        renderSitePolicies();
        saveAndApply().catch(() => {});
    });
    elements.siteWhitelist?.addEventListener('change', () => {
        if (elements.siteWhitelist.checked === false) {
            const hostname = normalizeHostname(elements.siteHostname?.value);
            const previous = adblock.sitePolicies[hostname]?.whitelistPrevious;
            if (previous && typeof previous === 'object') {
                if (elements.siteAds) elements.siteAds.checked = previous.adBlocking !== false;
                if (elements.siteTrackers) elements.siteTrackers.checked = previous.trackerProtection !== false;
            }
        }
        updateSiteEditorState();
    });
    elements.rulesetUpdate?.addEventListener('click', async () => {
        if (elements.rulesetUpdateStatus) elements.rulesetUpdateStatus.textContent = t('adblock.rulesets.updating', 'Güncelleniyor…');
        const result = await window.ardali?.adblock?.refreshRulesets?.();
        adblock.rulesetMetadata.lastManualUpdateAt = Number(result?.refreshedAt) || Date.now();
        await saveAndApply();
        await refreshRulesetCatalog();
        if (elements.rulesetUpdateStatus) elements.rulesetUpdateStatus.textContent = new Date().toLocaleString();
    });
    elements.rulesetAutoUpdate?.addEventListener('change', scheduleSave);
    [elements.loggerSearch, elements.loggerAction].forEach((element) => {
        element?.addEventListener('input', () => renderNetworkLog(lastStats));
        element?.addEventListener('change', () => renderNetworkLog(lastStats));
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
        renderUserFilters();
        renderSitePolicies();
        refreshRulesetCatalog().catch(() => {});
        if (!adblock.developerMode && document.body.dataset.activePane === 'develop') setActiveTab('settings');
        refreshStats().then((stats) => syncActiveSiteEditor(stats, true)).catch(() => {});
    });

    window.addEventListener('storage', (event) => {
        if (event.key !== UI_THEME_STORAGE_KEY && event.key !== SHARED_THEME_KEY) return;
        if (getAdblockThemePreference() === 'app') applyTheme('app', { animate: true });
    });

    window.i18n?.onChange?.(() => {
        window.i18n?.translatePage?.();
        updateModeUi();
        updateDevelopEditor().catch(() => {});
    });

    window.ardali?.onSettingsNavigate?.((payload) => {
        const tab = String(payload?.tab || '').trim().toLowerCase();
        if (tab) setActiveTab(tab);
        refreshStats().then((stats) => syncActiveSiteEditor(stats, true)).catch(() => {});
    });

    load().catch((error) => {
        console.warn('[ADBLOCK_WINDOW] load error:', error?.message || error);
        updateModeUi();
    });

    window.addEventListener('message', (event) => {
        if (event.source !== window || event.origin !== window.location.origin) return;
        if (event.data?.type !== 'workspace:lifecycle') return;
        const phase = String(event.data.phase || '').toLowerCase();
        if (phase === 'activate' || phase === 'resume') {
            startStatsRefresh();
            refreshStats().catch(() => {});
        } else if (phase === 'deactivate' || phase === 'suspend' || phase === 'close') {
            stopStatsRefresh();
        }
    });
    window.addEventListener('beforeunload', stopStatsRefresh);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') stopStatsRefresh();
        else startStatsRefresh();
    });
    startStatsRefresh();
}());
