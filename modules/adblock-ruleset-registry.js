const fs = require('fs');
const path = require('path');

const RULESET_ROOT_DIR = path.join(__dirname, '..', 'resources', 'adblock', 'rulesets');
const RULESET_REALMS = Object.freeze({
    main: 'main',
    regex: 'regex',
    strictblock: 'strictblock'
});
const SCRIPTING_REALMS = Object.freeze({
    generic: { dir: 'generic', ext: '.js' },
    generichigh: { dir: 'generichigh', ext: '.css' },
    specific: { dir: 'specific', ext: '.js' },
    procedural: { dir: 'procedural', ext: '.js' },
    scriptletMain: { dir: path.join('scriptlet', 'main'), ext: '.js' },
    scriptletIsolated: { dir: path.join('scriptlet', 'isolated'), ext: '.js' }
});

const cache = {
    details: null,
    filesByRealm: new Map()
};

function safeRulesetId(value) {
    return String(value || '').trim().replace(/[^a-z0-9_.-]/gi, '');
}

function readJsonFileSafe(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}

function sanitizeDisplayName(name) {
    const legacyNames = [
        ['u', 'Block Origin Lite'],
        ['u', 'Block Origin'],
        ['u', 'Block'],
        ['u', 'BO'],
        ['u', 'BOL']
    ].map((parts) => new RegExp(`\\b${parts.join('')}\\b`, 'gi'));

    let cleaned = String(name || '');
    for (const pattern of legacyNames) {
        cleaned = cleaned.replace(pattern, 'DeliBlock');
    }
    return cleaned
        .replace(/\s+–\s+/g, ' - ')
        .trim();
}

function listJsonIdsInDir(dirPath) {
    try {
        return fs.readdirSync(dirPath, { withFileTypes: true })
            .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
            .map((entry) => entry.name.slice(0, -5))
            .sort((a, b) => a.localeCompare(b));
    } catch {
        return [];
    }
}

function getFilesForRealm(realm) {
    const key = String(realm || '');
    if (cache.filesByRealm.has(key)) return cache.filesByRealm.get(key);
    const dir = path.join(RULESET_ROOT_DIR, key);
    const ids = new Set(listJsonIdsInDir(dir));
    cache.filesByRealm.set(key, ids);
    return ids;
}

function rulesetAssetExists(id, realm) {
    const safeId = safeRulesetId(id);
    if (!safeId) return false;
    return getFilesForRealm(realm).has(safeId);
}

function getRulesetAssetPath(id, realm) {
    const safeId = safeRulesetId(id);
    const safeRealm = String(realm || '');
    if (!safeId || !Object.prototype.hasOwnProperty.call(RULESET_REALMS, safeRealm)) return '';
    if (!rulesetAssetExists(safeId, safeRealm)) return '';
    return path.join(RULESET_ROOT_DIR, safeRealm, `${safeId}.json`);
}

function getScriptingAssetPath(id, realm) {
    const safeId = safeRulesetId(id);
    const descriptor = SCRIPTING_REALMS[realm];
    if (!safeId || !descriptor) return '';
    const filePath = path.join(RULESET_ROOT_DIR, 'scripting', descriptor.dir, `${safeId}${descriptor.ext}`);
    return fs.existsSync(filePath) ? filePath : '';
}

function getRulesetDetails() {
    if (cache.details) return cache.details;
    const detailsPath = path.join(RULESET_ROOT_DIR, 'ruleset-details.json');
    const parsed = readJsonFileSafe(detailsPath);
    const details = Array.isArray(parsed) ? parsed : [];
    cache.details = details
        .filter((item) => item && typeof item === 'object' && safeRulesetId(item.id))
        .map((item) => {
            const id = safeRulesetId(item.id);
            return {
                ...item,
                id,
                name: sanitizeDisplayName(item.name || id),
                group: String(item.group || 'other'),
                enabled: item.enabled === true,
                hasMain: rulesetAssetExists(id, 'main'),
                hasRegex: rulesetAssetExists(id, 'regex'),
                hasStrictblock: rulesetAssetExists(id, 'strictblock')
            };
        });
    return cache.details;
}

function uniqueIds(values) {
    const out = [];
    const seen = new Set();
    for (const value of values) {
        const id = safeRulesetId(value);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push(id);
    }
    return out;
}

function getReferenceId(predicate) {
    const found = getRulesetDetails().find(predicate);
    return found ? found.id : '';
}

function getModeRulesetIds(mode = 'ideal') {
    const normalized = ['basic', 'ideal', 'aggressive'].includes(String(mode || '').toLowerCase())
        ? String(mode).toLowerCase()
        : 'ideal';
    const details = getRulesetDetails();
    const defaultIds = details
        .filter((item) => item.enabled && item.hasMain)
        .map((item) => item.id);
    const basicIds = details
        .filter((item) => item.enabled && item.hasMain && item.group === 'default')
        .map((item) => item.id);
    const regionalId = getReferenceId((item) => item.id === 'tur-0' && item.hasMain);
    const experimentalId = getReferenceId((item) => /experimental/i.test(item.id) && item.hasMain);

    if (normalized === 'basic') return uniqueIds(basicIds.length ? basicIds : defaultIds);
    if (normalized === 'aggressive') return uniqueIds([...defaultIds, regionalId, experimentalId]);
    return uniqueIds([...defaultIds, regionalId]);
}

function getActiveRulesetPlan(config = {}) {
    const mode = ['basic', 'ideal', 'aggressive'].includes(String(config.mode || '').toLowerCase())
        ? String(config.mode).toLowerCase()
        : 'ideal';
    const requestedIds = Array.isArray(config.enabledRulesetIds)
        ? uniqueIds(config.enabledRulesetIds).filter((id) => rulesetAssetExists(id, 'main'))
        : [];
    const ids = config.rulesetSelectionConfigured === true ? requestedIds : getModeRulesetIds(mode);
    const strictEnabled = config.strictBlock === true || mode === 'aggressive';
    const detailsById = new Map(getRulesetDetails().map((item) => [item.id, item]));
    const strictIds = ids.filter((id) => {
        if (!rulesetAssetExists(id, 'strictblock')) return false;
        // Malware, phishing and badware navigation protection is a safety
        // baseline, not an ad-block preference. The Strict Block toggle only
        // controls the additional potentially-unwanted-site rulesets.
        return strictEnabled || detailsById.get(id)?.group === 'malware';
    });

    return {
        mode,
        ids,
        dnr: ids.map((id) => ({
            id,
            label: detailsById.get(id)?.name || id,
            mainPath: getRulesetAssetPath(id, 'main'),
            regexPath: getRulesetAssetPath(id, 'regex')
        })),
        strictblock: strictIds.map((id) => ({
            id,
            label: detailsById.get(id)?.name || id,
            path: getRulesetAssetPath(id, 'strictblock')
        })),
        scripting: ids.map((id) => {
            const assets = {};
            for (const realm of Object.keys(SCRIPTING_REALMS)) {
                const filePath = getScriptingAssetPath(id, realm);
                if (filePath) assets[realm] = filePath;
            }
            return {
                id,
                label: detailsById.get(id)?.name || id,
                assets
            };
        }).filter((item) => Object.keys(item.assets).length > 0)
    };
}

function getDevelopRulesetDetails() {
    return getRulesetDetails().map((item) => ({
        id: item.id,
        name: item.name,
        group: item.group,
        enabled: item.enabled,
        rules: item.rules || {},
        css: item.css || {},
        hasMain: item.hasMain,
        hasRegex: item.hasRegex,
        hasStrictblock: item.hasStrictblock
    }));
}

module.exports = {
    RULESET_ROOT_DIR,
    getActiveRulesetPlan,
    getDevelopRulesetDetails,
    getModeRulesetIds,
    getRulesetAssetPath,
    readJsonFileSafe,
    sanitizeDisplayName
};
