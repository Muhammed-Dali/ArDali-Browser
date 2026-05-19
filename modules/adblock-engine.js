const fs = require('fs');
const path = require('path');

const ADBLOCK_DEFAULT_CONFIG = Object.freeze({
    mode: 'ideal',
    showBlockedCount: true,
    autoReload: false,
    strictBlock: false,
    developerMode: false
});

const RESOURCE_TYPE_MAP = Object.freeze({
    mainFrame: 'main_frame',
    subFrame: 'sub_frame',
    stylesheet: 'stylesheet',
    script: 'script',
    image: 'image',
    font: 'font',
    object: 'object',
    xhr: 'xmlhttprequest',
    ping: 'ping',
    cspReport: 'csp_report',
    media: 'media',
    webSocket: 'websocket',
    other: 'other'
});

const DNR_ACTION_ORDER = Object.freeze({
    allow: 4,
    allowAllRequests: 4,
    block: 3,
    redirect: 2,
    upgradeScheme: 1,
    modifyHeaders: 0
});

const REDIRECT_RESOURCE_URLS = Object.freeze({
    'noop.js': 'data:application/javascript;base64,InVzZSBzdHJpY3QiOwp2b2lkIDA7Cg==',
    'noop.txt': 'data:text/plain;base64,Cg==',
    'noop.css': 'data:text/css;base64,Cg==',
    'noop.html': 'data:text/html;base64,PCFkb2N0eXBlIGh0bWw+PG1ldGEgY2hhcnNldD0idXRmLTgiPg==',
    'noop.json': 'data:application/json;base64,e30=',
    'noop-0.1s.mp3': 'data:audio/mpeg;base64,',
    'noop-1s.mp4': 'data:video/mp4;base64,',
    'noop-vmap1.xml': 'data:application/xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIj8+PFZNQVAgdmVyc2lvbj0iMS4wIiB4bWxucz0iaHR0cDovL3d3dy5pYWIubmV0L3ZtYXAtMS4wIj48L1ZNQVA+Cg==',
    'noop-vast2.xml': 'data:application/xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIj8+PFZBU1QgdmVyc2lvbj0iMi4wIj48L1ZBU1Q+Cg==',
    'noop-vast3.xml': 'data:application/xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIj8+PFZBU1QgdmVyc2lvbj0iMy4wIj48L1ZBU1Q+Cg==',
    '1x1.gif': 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
    '2x2.png': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEElEQVR42mP8z8AARLJgYAAAHAAD/6WfHMUAAAAASUVORK5CYII=',
    '32x32.png': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEElEQVR42mP8z8AARLJgYAAAHAAD/6WfHMUAAAAASUVORK5CYII=',
    empty: 'data:text/plain;base64,Cg=='
});

const REGEX_CACHE_LIMIT = 1600;
const dnrRegexCache = new Map();

const COMMON_SECOND_LEVEL_TLDS = new Set([
    'ac', 'co', 'com', 'edu', 'gov', 'net', 'org', 'mil'
]);

const WEB_ACCESSIBLE_RESOURCE_DIR = path.join(__dirname, '..', 'resources', 'adblock', 'web_accessible_resources');
const REDIRECT_RESOURCE_CACHE = new Map();

function normalizeMode(mode) {
    const value = String(mode || '').trim().toLowerCase();
    if (value === 'basic' || value === 'aggressive') return value;
    return 'ideal';
}

function sanitizeDnrRules(rules) {
    if (!Array.isArray(rules)) return [];
    if (rules.__ardaliDnrSanitized === true) return rules;
    const out = rules
        .filter((rule) => rule && typeof rule === 'object' && rule.action && rule.condition)
        .map((rule, index) => ({
            id: Number.isFinite(Number(rule.id)) ? Number(rule.id) : index + 1,
            priority: Number.isFinite(Number(rule.priority)) ? Number(rule.priority) : 1,
            action: rule.action,
            condition: rule.condition,
            ruleset: String(rule.ruleset || rule.rulesetId || '').trim()
        }));
    try {
        Object.defineProperty(out, '__ardaliDnrSanitized', {
            value: true,
            enumerable: false
        });
    } catch {
        // best effort
    }
    return out;
}

function normalizeConfig(config = {}) {
    return {
        mode: normalizeMode(config.mode || ADBLOCK_DEFAULT_CONFIG.mode),
        showBlockedCount: config.showBlockedCount !== false,
        autoReload: !!config.autoReload,
        strictBlock: !!config.strictBlock,
        developerMode: !!config.developerMode,
        dnrRules: sanitizeDnrRules(config.dnrRules || config.rules)
    };
}

function domainMatches(hostname, ruleDomain) {
    if (!hostname || !ruleDomain) return false;
    return hostname === ruleDomain || hostname.endsWith(`.${ruleDomain}`);
}

function getCachedRegex(pattern, flags = '') {
    const source = String(pattern || '');
    const safeFlags = String(flags || '').replace(/[^dgimsuvy]/g, '');
    const cacheKey = `${safeFlags}\n${source}`;
    if (dnrRegexCache.has(cacheKey)) return dnrRegexCache.get(cacheKey);
    let regex = null;
    try {
        regex = new RegExp(source, safeFlags);
    } catch {
        regex = null;
    }
    dnrRegexCache.set(cacheKey, regex);
    if (dnrRegexCache.size > REGEX_CACHE_LIMIT) {
        const firstKey = dnrRegexCache.keys().next().value;
        dnrRegexCache.delete(firstKey);
    }
    return regex;
}

function getMimeTypeForResourceName(name) {
    const lower = String(name || '').toLowerCase();
    if (lower.endsWith('.js')) return 'application/javascript';
    if (lower.endsWith('.css')) return 'text/css';
    if (lower.endsWith('.html')) return 'text/html';
    if (lower.endsWith('.json')) return 'application/json';
    if (lower.endsWith('.xml')) return 'application/xml';
    if (lower.endsWith('.gif')) return 'image/gif';
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.mp3')) return 'audio/mpeg';
    if (lower.endsWith('.mp4')) return 'video/mp4';
    if (lower.endsWith('.webm')) return 'video/webm';
    return 'text/plain';
}

function readRedirectResourceDataUrl(name) {
    const safeName = path.basename(String(name || '').trim());
    if (!safeName) return '';
    if (REDIRECT_RESOURCE_CACHE.has(safeName)) return REDIRECT_RESOURCE_CACHE.get(safeName);

    let dataUrl = '';
    try {
        const filePath = path.join(WEB_ACCESSIBLE_RESOURCE_DIR, safeName);
        const relative = path.relative(WEB_ACCESSIBLE_RESOURCE_DIR, filePath);
        if (!relative.startsWith('..') && !path.isAbsolute(relative) && fs.existsSync(filePath)) {
            const buffer = fs.readFileSync(filePath);
            dataUrl = `data:${getMimeTypeForResourceName(safeName)};base64,${buffer.toString('base64')}`;
        }
    } catch {
        dataUrl = '';
    }

    REDIRECT_RESOURCE_CACHE.set(safeName, dataUrl);
    return dataUrl;
}

function getSiteDomain(hostname) {
    const parts = String(hostname || '').toLowerCase().split('.').filter(Boolean);
    if (parts.length <= 2) return parts.join('.');
    const last = parts[parts.length - 1];
    const secondLast = parts[parts.length - 2];
    if (last.length === 2 && COMMON_SECOND_LEVEL_TLDS.has(secondLast)) {
        return parts.slice(-3).join('.');
    }
    return parts.slice(-2).join('.');
}

function isSameSiteHostname(leftHostname, rightHostname) {
    const left = getSiteDomain(leftHostname);
    const right = getSiteDomain(rightHostname);
    return !!left && !!right && left === right;
}

function normalizeResourceType(resourceType) {
    const value = String(resourceType || '').trim();
    return RESOURCE_TYPE_MAP[value] || value.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`).toLowerCase() || 'other';
}

function getHostnameFromUrl(rawUrl) {
    try {
        return String(new URL(String(rawUrl || '')).hostname || '').toLowerCase();
    } catch {
        return '';
    }
}

function getRequestContext(rawUrl, resourceType, requestDetails = {}) {
    const url = String(rawUrl || '');
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        parsed = null;
    }

    const initiatorUrl = String(
        requestDetails.initiator ||
        requestDetails.documentUrl ||
        requestDetails.referrer ||
        ''
    );
    const initiatorHostname = getHostnameFromUrl(initiatorUrl);

    return {
        url,
        urlLower: url.toLowerCase(),
        parsed,
        hostname: parsed ? String(parsed.hostname || '').toLowerCase() : '',
        resourceType: normalizeResourceType(resourceType || requestDetails.resourceType),
        method: String(requestDetails.method || 'GET').toLowerCase(),
        initiatorHostname,
        requestHeaders: normalizeHeaderMap(requestDetails.requestHeaders),
        responseHeaders: normalizeHeaderMap(requestDetails.responseHeaders)
    };
}

function normalizeHeaderMap(headers) {
    const out = new Map();
    if (!headers || typeof headers !== 'object') return out;

    const entries = Array.isArray(headers)
        ? headers.map((item) => [item?.name || item?.header, item?.value])
        : Object.entries(headers);

    for (const [rawName, rawValue] of entries) {
        const name = String(rawName || '').trim();
        if (!name) continue;
        const values = Array.isArray(rawValue) ? rawValue : [rawValue];
        out.set(name.toLowerCase(), {
            name,
            values: values.map((value) => String(value ?? ''))
        });
    }
    return out;
}

function electronHeadersFromMap(headers) {
    const out = {};
    for (const entry of headers.values()) {
        if (!entry?.name) continue;
        out[entry.name] = Array.isArray(entry.values) ? entry.values.map((value) => String(value ?? '')) : [];
    }
    return out;
}

function headerValueMatches(pattern, value) {
    const rawPattern = String(pattern ?? '');
    const rawValue = String(value ?? '');
    if (!rawPattern.includes('*')) return rawPattern.toLowerCase() === rawValue.toLowerCase();
    const escaped = rawPattern
        .split('*')
        .map((part) => part.replace(/[|\\{}()[\]^$+?.]/g, '\\$&'))
        .join('.*');
    return new RegExp(`^${escaped}$`, 'i').test(rawValue);
}

function headerConditionMatches(headerConditions, headers) {
    if (!Array.isArray(headerConditions) || headerConditions.length === 0) return true;
    if (!(headers instanceof Map) || headers.size === 0) return false;

    for (const condition of headerConditions) {
        if (!condition || typeof condition !== 'object') return false;
        const name = String(condition.header || '').trim().toLowerCase();
        if (!name) return false;
        const entry = headers.get(name);
        if (!entry) return false;
        const values = entry.values || [];

        if (Array.isArray(condition.values) && condition.values.length > 0) {
            const matched = values.some((value) => condition.values.some((pattern) => headerValueMatches(pattern, value)));
            if (!matched) return false;
        }

        if (Array.isArray(condition.excludedValues) && condition.excludedValues.length > 0) {
            const excluded = values.some((value) => condition.excludedValues.some((pattern) => headerValueMatches(pattern, value)));
            if (excluded) return false;
        }
    }
    return true;
}

function matchesUrlFilter(rawFilter, urlLower, hostname) {
    const filter = String(rawFilter || '').trim().toLowerCase();
    if (!filter) return true;

    if (filter.startsWith('||')) {
        const rest = filter.slice(2);
        const markerIndex = rest.search(/[\^/*|]/);
        const domain = (markerIndex === -1 ? rest : rest.slice(0, markerIndex)).replace(/^\.+|\.+$/g, '');
        if (!domain || !domainMatches(hostname, domain)) return false;
        const suffix = markerIndex === -1 ? '' : rest.slice(markerIndex);
        if (!suffix || suffix === '^' || suffix === '|') return true;
        return matchesUrlFilter(suffix.replace(/^\^/, ''), urlLower, hostname);
    }

    let pattern = filter;
    let anchoredStart = false;
    let anchoredEnd = false;
    if (pattern.startsWith('|')) {
        anchoredStart = true;
        pattern = pattern.slice(1);
    }
    if (pattern.endsWith('|')) {
        anchoredEnd = true;
        pattern = pattern.slice(0, -1);
    }

    if (!pattern.includes('*') && !pattern.includes('^')) {
        if (anchoredStart && anchoredEnd) return urlLower === pattern;
        if (anchoredStart) return urlLower.startsWith(pattern);
        if (anchoredEnd) return urlLower.endsWith(pattern);
        return urlLower.includes(pattern);
    }

    const escaped = pattern
        .split('')
        .map((char) => {
            if (char === '*') return '.*';
            if (char === '^') return '[^A-Za-z0-9_.%-]|$';
            return char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
        })
        .join('');
    const regex = new RegExp(`${anchoredStart ? '^' : ''}${escaped}${anchoredEnd ? '$' : ''}`, 'i');
    return regex.test(urlLower);
}

function arrayIncludesDomain(domains, hostname) {
    if (!Array.isArray(domains) || !hostname) return false;
    return domains.some((domain) => domainMatches(hostname, String(domain || '').toLowerCase()));
}

function dnrConditionMatches(condition, context) {
    if (!condition || typeof condition !== 'object') return false;

    if (Array.isArray(condition.resourceTypes) && condition.resourceTypes.length > 0) {
        if (!condition.resourceTypes.includes(context.resourceType)) return false;
    }
    if (Array.isArray(condition.excludedResourceTypes) && condition.excludedResourceTypes.includes(context.resourceType)) {
        return false;
    }

    if (Array.isArray(condition.requestMethods) && condition.requestMethods.length > 0) {
        if (!condition.requestMethods.map((method) => String(method).toLowerCase()).includes(context.method)) return false;
    }
    if (Array.isArray(condition.excludedRequestMethods)) {
        if (condition.excludedRequestMethods.map((method) => String(method).toLowerCase()).includes(context.method)) return false;
    }

    if (Array.isArray(condition.requestDomains) && condition.requestDomains.length > 0) {
        if (!arrayIncludesDomain(condition.requestDomains, context.hostname)) return false;
    }
    if (arrayIncludesDomain(condition.excludedRequestDomains, context.hostname)) return false;

    if (Array.isArray(condition.initiatorDomains) && condition.initiatorDomains.length > 0) {
        if (!arrayIncludesDomain(condition.initiatorDomains, context.initiatorHostname)) return false;
    }
    if (arrayIncludesDomain(condition.excludedInitiatorDomains, context.initiatorHostname)) return false;

    if (condition.domainType === 'thirdParty' && context.initiatorHostname) {
        if (isSameSiteHostname(context.hostname, context.initiatorHostname)) return false;
    }
    if (condition.domainType === 'firstParty' && context.initiatorHostname) {
        if (!isSameSiteHostname(context.hostname, context.initiatorHostname)) return false;
    }

    if (condition.urlFilter && !matchesUrlFilter(condition.urlFilter, context.urlLower, context.hostname)) {
        return false;
    }

    if (condition.regexFilter) {
        const flags = condition.isUrlFilterCaseSensitive ? '' : 'i';
        const regex = getCachedRegex(condition.regexFilter, flags);
        if (!regex) return false;
        regex.lastIndex = 0;
        if (!regex.test(context.url)) return false;
    }

    if (Array.isArray(condition.requestHeaders) && !headerConditionMatches(condition.requestHeaders, context.requestHeaders)) {
        return false;
    }

    if (Array.isArray(condition.responseHeaders) && !headerConditionMatches(condition.responseHeaders, context.responseHeaders)) {
        return false;
    }

    return true;
}

function getDnrRuleRank(rule) {
    const actionType = String(rule?.action?.type || '');
    return [
        Number(rule?.priority || 1),
        DNR_ACTION_ORDER[actionType] || 0,
        Number(rule?.id || 0)
    ];
}

function compareDnrRuleRank(a, b) {
    const ar = getDnrRuleRank(a);
    const br = getDnrRuleRank(b);
    for (let i = 0; i < ar.length; i += 1) {
        if (ar[i] !== br[i]) return br[i] - ar[i];
    }
    return 0;
}

function setUrlPartIfPresent(parsed, transform, key, setter) {
    if (!Object.prototype.hasOwnProperty.call(transform, key)) return;
    const value = transform[key];
    setter(value === undefined || value === null ? '' : String(value));
}

function applyDnrQueryTransform(parsed, queryTransform) {
    if (!queryTransform || typeof queryTransform !== 'object') return;
    const params = parsed.searchParams;

    if (Array.isArray(queryTransform.removeParams)) {
        for (const key of queryTransform.removeParams) {
            const name = String(key || '');
            if (name) params.delete(name);
        }
    }

    if (Array.isArray(queryTransform.addOrReplaceParams)) {
        for (const entry of queryTransform.addOrReplaceParams) {
            if (!entry || typeof entry !== 'object') continue;
            const key = String(entry.key || '');
            if (!key) continue;
            const value = String(entry.value ?? '');
            if (entry.replaceOnly && !params.has(key)) continue;
            params.delete(key);
            params.append(key, value);
        }
    }
}

function applyDnrRedirectTransform(rawUrl, transform) {
    if (!transform || typeof transform !== 'object') return '';
    let parsed;
    try {
        parsed = new URL(String(rawUrl || ''));
    } catch {
        return '';
    }

    setUrlPartIfPresent(parsed, transform, 'scheme', (value) => {
        parsed.protocol = value ? `${value.replace(/:$/, '')}:` : parsed.protocol;
    });
    setUrlPartIfPresent(parsed, transform, 'host', (value) => {
        if (value) parsed.hostname = value;
    });
    setUrlPartIfPresent(parsed, transform, 'port', (value) => {
        parsed.port = value;
    });
    setUrlPartIfPresent(parsed, transform, 'path', (value) => {
        parsed.pathname = value.startsWith('/') ? value : `/${value}`;
    });
    setUrlPartIfPresent(parsed, transform, 'query', (value) => {
        parsed.search = value ? `?${value.replace(/^\?/, '')}` : '';
    });

    applyDnrQueryTransform(parsed, transform.queryTransform);

    setUrlPartIfPresent(parsed, transform, 'fragment', (value) => {
        parsed.hash = value ? `#${value.replace(/^#/, '')}` : '';
    });
    setUrlPartIfPresent(parsed, transform, 'username', (value) => {
        parsed.username = value;
    });
    setUrlPartIfPresent(parsed, transform, 'password', (value) => {
        parsed.password = value;
    });

    return parsed.toString();
}

function applyDnrRegexSubstitution(rule, context) {
    const substitution = String(rule?.action?.redirect?.regexSubstitution || '').trim();
    const regexFilter = String(rule?.condition?.regexFilter || '');
    if (!substitution || !regexFilter) return '';
    const flags = rule.condition?.isUrlFilterCaseSensitive ? '' : 'i';
    const regex = getCachedRegex(regexFilter, flags);
    if (!regex) return '';
    regex.lastIndex = 0;
    const replacement = substitution.replace(/\\([0-9]+)/g, '$$$1');
    return context.url.replace(regex, replacement);
}

function getDnrRedirectUrl(rule, context) {
    const action = rule?.action || {};
    const direct = String(action?.redirect?.url || action?.redirectUrl || '').trim();
    if (direct) return direct;
    const transformed = applyDnrRedirectTransform(context?.url, action?.redirect?.transform);
    if (transformed) return transformed;
    const substituted = applyDnrRegexSubstitution(rule, context);
    if (substituted && substituted !== context?.url) return substituted;
    const extensionPath = String(action?.redirect?.extensionPath || '').trim();
    if (!extensionPath) return '';
    const name = extensionPath.split('/').filter(Boolean).pop();
    if (!name) return '';
    const bundled = readRedirectResourceDataUrl(name);
    if (bundled) return bundled;
    if (REDIRECT_RESOURCE_URLS[name]) return REDIRECT_RESOURCE_URLS[name];
    if (name.endsWith('.js')) return REDIRECT_RESOURCE_URLS['noop.js'];
    if (name.endsWith('.css')) return REDIRECT_RESOURCE_URLS['noop.css'];
    if (name.endsWith('.html')) return REDIRECT_RESOURCE_URLS['noop.html'];
    if (name.endsWith('.json')) return REDIRECT_RESOURCE_URLS['noop.json'];
    if (name.endsWith('.xml')) return REDIRECT_RESOURCE_URLS['noop-vmap1.xml'];
    if (name.endsWith('.gif')) return REDIRECT_RESOURCE_URLS['1x1.gif'];
    if (name.endsWith('.png') || name.endsWith('.webp') || name.endsWith('.jpg') || name.endsWith('.jpeg')) return REDIRECT_RESOURCE_URLS['2x2.png'];
    if (name.endsWith('.mp3')) return REDIRECT_RESOURCE_URLS['noop-0.1s.mp3'];
    if (name.endsWith('.mp4') || name.endsWith('.webm')) return REDIRECT_RESOURCE_URLS['noop-1s.mp4'];
    if (name.endsWith('.txt')) return REDIRECT_RESOURCE_URLS['noop.txt'];
    return '';
}

function findMatchingDnrRule(context, rules) {
    const matches = [];
    for (const rule of rules) {
        if (!dnrConditionMatches(rule.condition, context)) continue;
        matches.push(rule);
    }
    if (!matches.length) return null;
    matches.sort(compareDnrRuleRank);
    return matches[0];
}

function findMatchingDnrRules(context, rules, actionType) {
    const matches = [];
    for (const rule of rules) {
        if (String(rule?.action?.type || '') !== actionType) continue;
        if (!dnrConditionMatches(rule.condition, context)) continue;
        matches.push(rule);
    }
    matches.sort(compareDnrRuleRank);
    return matches;
}

function evaluateDnrRules(rawUrl, resourceType, config, requestDetails = {}) {
    const normalized = normalizeConfig(config);
    if (!normalized.dnrRules.length) return null;
    const context = getRequestContext(rawUrl, resourceType, requestDetails);
    if (!context.parsed) return null;
    const protocol = String(context.parsed.protocol || '').toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') return null;

    const rule = findMatchingDnrRule(context, normalized.dnrRules);
    if (!rule) return null;

    const actionType = String(rule.action?.type || '');
    if (actionType === 'allow' || actionType === 'allowAllRequests') {
        return { action: 'allow', reason: 'dnr-allow', rule: rule.id, ruleset: rule.ruleset || '' };
    }
    if (actionType === 'block') {
        return { action: 'block', reason: 'dnr-block', rule: rule.id, ruleset: rule.ruleset || '' };
    }
    if (actionType === 'redirect') {
        const redirectUrl = getDnrRedirectUrl(rule, context);
        if (redirectUrl) {
            return { action: 'redirect', reason: 'dnr-redirect', rule: rule.id, ruleset: rule.ruleset || '', redirectUrl };
        }
    }
    if (actionType === 'upgradeScheme' && protocol === 'http:') {
        const upgraded = new URL(context.url);
        upgraded.protocol = 'https:';
        return {
            action: 'redirect',
            reason: 'dnr-upgrade-scheme',
            rule: rule.id,
            ruleset: rule.ruleset || '',
            redirectUrl: upgraded.toString()
        };
    }
    return null;
}

function applyHeaderOperations(rawHeaders, operations) {
    const headers = normalizeHeaderMap(rawHeaders);
    let changed = false;

    for (const operation of operations) {
        if (!operation || typeof operation !== 'object') continue;
        const headerName = String(operation.header || '').trim();
        if (!headerName) continue;
        const key = headerName.toLowerCase();
        const type = String(operation.operation || '').trim().toLowerCase();
        const value = String(operation.value ?? '');

        if (type === 'remove') {
            if (headers.delete(key)) changed = true;
            continue;
        }

        if (type === 'set') {
            headers.set(key, { name: headerName, values: [value] });
            changed = true;
            continue;
        }

        if (type === 'append') {
            const current = headers.get(key) || { name: headerName, values: [] };
            current.values = Array.isArray(current.values) ? current.values : [];
            current.values.push(value);
            headers.set(key, current);
            changed = true;
        }
    }

    return changed ? electronHeadersFromMap(headers) : null;
}

function evaluateDnrHeaderModifications(rawUrl, resourceType, config, requestDetails = {}, phase = 'response') {
    const normalized = normalizeConfig(config);
    if (!normalized.dnrRules.length) return null;
    const context = getRequestContext(rawUrl, resourceType, requestDetails);
    if (!context.parsed) return null;
    const protocol = String(context.parsed.protocol || '').toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') return null;

    const headerKey = phase === 'request' ? 'requestHeaders' : 'responseHeaders';
    const sourceHeaders = requestDetails[headerKey];
    const operations = [];
    const matched = [];

    for (const rule of findMatchingDnrRules(context, normalized.dnrRules, 'modifyHeaders')) {
        const ruleOperations = Array.isArray(rule?.action?.[headerKey]) ? rule.action[headerKey] : [];
        if (!ruleOperations.length) continue;
        operations.push(...ruleOperations);
        matched.push({ rule: rule.id, ruleset: rule.ruleset || '' });
    }

    if (!operations.length) return null;
    const headers = applyHeaderOperations(sourceHeaders, operations);
    if (!headers) return null;
    return {
        action: 'modifyHeaders',
        reason: `dnr-modify-${phase}-headers`,
        matched,
        [headerKey]: headers
    };
}

function shouldBlockRequest(rawUrl, resourceType, config, requestDetails = {}) {
    const normalized = normalizeConfig(config);
    if (normalized.mode === 'basic' && resourceType === 'mainFrame') return null;

    let parsed;
    try {
        parsed = new URL(String(rawUrl || ''));
    } catch {
        return null;
    }
    const protocol = String(parsed.protocol || '').toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') return null;

    const dnrMatch = evaluateDnrRules(rawUrl, resourceType, normalized, requestDetails);
    if (dnrMatch?.action === 'allow') return null;
    if (dnrMatch?.action === 'block' || dnrMatch?.action === 'redirect') return dnrMatch;

    return null;
}

function getRulesetSummary(config, metrics = {}) {
    const normalized = normalizeConfig(config);
    const dnrRulesetCount = new Set(
        normalized.dnrRules
            .map((rule) => String(rule?.ruleset || '').trim())
            .filter(Boolean)
    ).size;
    return {
        mode: normalized.mode,
        rulesetCount: Math.max(Number(metrics.rulesetCount || 0), dnrRulesetCount),
        domainRuleCount: Number(metrics.domainRuleCount || 0),
        dnrRuleCount: normalized.dnrRules.length,
        cosmeticSelectorCount: Number(metrics.cosmeticSelectorCount || 0)
    };
}

module.exports = {
    ADBLOCK_DEFAULT_CONFIG,
    normalizeAdblockConfig: normalizeConfig,
    evaluateDnrRules,
    evaluateDnrHeaderModifications,
    shouldBlockRequest,
    getRulesetSummary
};
