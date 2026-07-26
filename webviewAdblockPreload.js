(function installArDaliWebviewAdblockPreload() {
    // --- ArDali Zoom Event Handler ---
    try {
        const { ipcRenderer } = require('electron');
        window.addEventListener('wheel', (e) => {
            if (e.ctrlKey) {
                // Prevent default scrolling
                e.preventDefault();
                // Determine direction: deltaY > 0 is scroll down (zoom out), deltaY < 0 is scroll up (zoom in)
                const direction = e.deltaY > 0 ? -1 : 1;
                ipcRenderer.sendToHost('ardali-webview-zoom-scroll', direction);
            }
        }, { passive: false, capture: true });
        window.addEventListener('pointerdown', () => {
            ipcRenderer.sendToHost('ardali-webview-pointer-down');
        }, { passive: true, capture: true });
    } catch (err) {
        console.error('Failed to init ArDali zoom handler', err);
    }

    function isCompatibilityIdentityPage() {
        try {
            const host = String(location.hostname || '').toLowerCase();
            return host === 'web.whatsapp.com' ||
                host === 'whatsapp.com' ||
                host === 'www.whatsapp.com' ||
                host.endsWith('.whatsapp.com') ||
                host === 'open.spotify.com' ||
                host === 'spotify.com' ||
                host === 'www.spotify.com' ||
                host.endsWith('.spotify.com');
        } catch {
            return false;
        }
    }

    function installCompatibilityBrowserIdentityPatch() {
        if (!isCompatibilityIdentityPage()) return;
        const code = `
            (function installArDaliCompatibilityBrowserIdentity() {
                if (window.__ardaliCompatibilityBrowserIdentity) return;
                window.__ardaliCompatibilityBrowserIdentity = true;
                const ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36';
                const platform = 'Linux x86_64';
                const brands = [
                    { brand: 'Chromium', version: '132' },
                    { brand: 'Google Chrome', version: '132' },
                    { brand: 'Not A(Brand', version: '99' }
                ];
                const defineNavigatorValue = (name, value) => {
                    try {
                        Object.defineProperty(Navigator.prototype, name, {
                            configurable: true,
                            get: () => value
                        });
                    } catch {}
                    try {
                        Object.defineProperty(navigator, name, {
                            configurable: true,
                            get: () => value
                        });
                    } catch {}
                };
                defineNavigatorValue('userAgent', ua);
                defineNavigatorValue('appVersion', ua.replace(/^Mozilla\\//, ''));
                defineNavigatorValue('platform', platform);
                defineNavigatorValue('vendor', 'Google Inc.');
                try {
                    Object.defineProperty(Navigator.prototype, 'userAgentData', {
                        configurable: true,
                        get: () => ({
                            brands,
                            mobile: false,
                            platform: 'Linux',
                            getHighEntropyValues: async (hints) => {
                                const values = {
                                    brands,
                                    mobile: false,
                                    platform: 'Linux',
                                    architecture: 'x86',
                                    bitness: '64',
                                    model: '',
                                    platformVersion: '6.0.0',
                                    uaFullVersion: '132.0.0.0',
                                    fullVersionList: brands.map((item) => ({
                                        brand: item.brand,
                                        version: item.brand === 'Not A(Brand' ? '99.0.0.0' : '132.0.0.0'
                                    }))
                                };
                                return (Array.isArray(hints) ? hints : []).reduce((out, key) => {
                                    out[key] = values[key];
                                    return out;
                                }, { brands, mobile: false, platform: 'Linux' });
                            },
                            toJSON: () => ({ brands, mobile: false, platform: 'Linux' })
                        })
                    });
                } catch {}
            })();
        `;
        try {
            const { webFrame } = require('electron');
            if (webFrame && typeof webFrame.executeJavaScript === 'function') {
                webFrame.executeJavaScript(code, false);
                return;
            }
        } catch {}
        try {
            const script = document.createElement('script');
            script.textContent = code;
            (document.documentElement || document.head || document.body).appendChild(script);
            script.remove();
        } catch {}
    }

    function isGoogleIdentityPage() {
        try {
            const host = String(location.hostname || '').toLowerCase();
            const path = String(location.pathname || '').toLowerCase();
            if (host === 'accounts.google.com' ||
                host === 'myaccount.google.com' ||
                host === 'oauth2.googleapis.com' ||
                host === 'accounts.youtube.com') {
                return true;
            }
            return (host === 'google.com' || host === 'www.google.com') && (
                path.includes('/servicelogin') ||
                path.includes('/signin') ||
                path.includes('/accountchooser')
            );
        } catch {
            return false;
        }
    }

    installCompatibilityBrowserIdentityPatch();

    const skipAdblockScriptingForIdentityPage = isGoogleIdentityPage();

    function installDeliBlockScriptingBridge() {
        let ipcRenderer = null;
        try {
            ({ ipcRenderer } = require('electron'));
        } catch {
            return;
        }
        if (!ipcRenderer || typeof ipcRenderer.invoke !== 'function') return;
        if (globalThis.__ardaliDeliBlockScriptingBridge) return;
        globalThis.__ardaliDeliBlockScriptingBridge = true;

        const styleId = 'ardali-deliblock-cosmetic-style';
        const genericStyleId = 'ardali-deliblock-generic-style';
        const proceduralStyleId = 'ardali-deliblock-procedural-style';
        const genericState = {
            hostname: '',
            signature: '',
            imported: false,
            selectors: new Set(),
            pendingNodes: new Set(),
            timer: 0,
            observer: null
        };
        const proceduralState = {
            hostname: '',
            signature: '',
            rules: [],
            hiddenNodes: new WeakSet(),
            styledNodes: new WeakSet(),
            timer: 0,
            observer: null
        };
        const scriptletState = {
            pageKey: '',
            executed: new Set(),
            webFrame: null
        };
        const cosmeticStyleState = {
            css: '',
            insertionKey: '',
            generation: 0,
            webFrame: null
        };

        function getCurrentUrl() {
            try { return String(location.href || ''); } catch { return ''; }
        }

        function ensureStyleElement(id = styleId) {
            const root = document.documentElement || document.head || document.body;
            if (!root) return null;
            let style = document.getElementById(id);
            if (!style) {
                style = document.createElement('style');
                style.id = id;
                style.type = 'text/css';
                style.setAttribute('data-ardali-deliblock', 'cosmetic');
                (document.head || root).appendChild(style);
            }
            return style;
        }

        function getCosmeticWebFrame() {
            if (cosmeticStyleState.webFrame !== null) return cosmeticStyleState.webFrame;
            try {
                cosmeticStyleState.webFrame = require('electron')?.webFrame || null;
            } catch {
                cosmeticStyleState.webFrame = null;
            }
            return cosmeticStyleState.webFrame;
        }

        async function applyCss(cssList) {
            const css = (Array.isArray(cssList) ? cssList : [])
                .map((item) => String(item || '').trim())
                .filter(Boolean)
                .join('\n\n');
            if (cosmeticStyleState.css === css) return;
            cosmeticStyleState.css = css;
            const generation = ++cosmeticStyleState.generation;
            const webFrame = getCosmeticWebFrame();

            try {
                const result = await ipcRenderer.invoke('adblock:applyCosmeticCss', { css });
                if (generation !== cosmeticStyleState.generation) return;
                if (result?.ok === true) {
                    cosmeticStyleState.insertionKey = String(result.key || '');
                    const fallbackStyle = document.getElementById(styleId);
                    if (fallbackStyle) fallbackStyle.textContent = '';
                    return;
                }
            } catch {
                // Fall through to the renderer-local compatibility path.
            }

            if (webFrame && typeof webFrame.insertCSS === 'function') {
                const previousKey = cosmeticStyleState.insertionKey;
                cosmeticStyleState.insertionKey = '';
                if (previousKey && typeof webFrame.removeInsertedCSS === 'function') {
                    try { await webFrame.removeInsertedCSS(previousKey); } catch {}
                }
                if (generation !== cosmeticStyleState.generation) return;
                if (css) {
                    try {
                        const key = await webFrame.insertCSS(css, { cssOrigin: 'user' });
                        if (generation !== cosmeticStyleState.generation) {
                            if (key && typeof webFrame.removeInsertedCSS === 'function') {
                                try { await webFrame.removeInsertedCSS(key); } catch {}
                            }
                            return;
                        }
                        cosmeticStyleState.insertionKey = String(key || '');
                        const fallbackStyle = document.getElementById(styleId);
                        if (fallbackStyle) fallbackStyle.textContent = '';
                        return;
                    } catch {
                        // Older Electron builds fall back to the existing style element.
                    }
                } else {
                    const fallbackStyle = document.getElementById(styleId);
                    if (fallbackStyle) fallbackStyle.textContent = '';
                    return;
                }
            }

            const style = ensureStyleElement();
            if (style) style.textContent = css;
        }

        function hashFromString(type, text) {
            const value = String(text || '');
            const len = value.length;
            const step = len + 7 >>> 3;
            let hash = (type << 5) + type ^ len;
            for (let i = 0; i < len; i += step) {
                hash = (hash << 5) + hash ^ value.charCodeAt(i);
            }
            return hash & 0xFFF;
        }

        function hostnameVariants(hostname, includeEntities = false) {
            const parts = String(hostname || '').toLowerCase().split('.').filter(Boolean);
            const out = [];
            for (let i = 0; i < parts.length; i += 1) out.push(parts.slice(i).join('.'));
            if (includeEntities && parts.length > 1) {
                const n = parts.length - 1;
                for (let i = 0; i < n; i += 1) {
                    for (let j = n; j > i; j -= 1) out.push(`${parts.slice(i, j).join('.')}.*`);
                }
            }
            return Array.from(new Set(out));
        }

        function applyGenericExceptions(selectorList, hash) {
            try {
                const exceptionSieve = globalThis.genericExceptionSieve;
                const exceptionMap = globalThis.genericExceptionMap;
                if (!(exceptionSieve instanceof Set) || !exceptionSieve.has(hash)) return selectorList;
                if (!(exceptionMap instanceof Map)) return selectorList;
                const selectors = new Set(String(selectorList || '').split(',\n').filter(Boolean));
                for (const hostname of hostnameVariants(location.hostname, true)) {
                    const exceptions = exceptionMap.get(hostname);
                    if (!exceptions) continue;
                    for (const exception of String(exceptions).split('\n')) selectors.delete(exception);
                    if (selectors.size === 0) break;
                }
                return Array.from(selectors).join(',\n');
            } catch {
                return selectorList;
            }
        }

        function addGenericSelectorByHash(hash) {
            try {
                const map = globalThis.genericSelectorMap;
                if (!(map instanceof Map)) return;
                const selectorList = map.get(hash);
                if (selectorList === undefined) return;
                map.delete(hash);
                const filtered = applyGenericExceptions(selectorList, hash);
                if (!filtered) return;
                genericState.selectors.add(filtered);
            } catch {
                // Ignore bad selectors from imported lists.
            }
        }

        function surveyGenericNode(node) {
            if (!node || node.nodeType !== 1) return;
            try {
                const id = typeof node.id === 'string' ? node.id.trim() : '';
                if (id) addGenericSelectorByHash(hashFromString(0x23, id));
                const classes = String(node.getAttribute('class') || '');
                if (classes) {
                    for (const token of classes.split(/\s+/)) {
                        if (token) addGenericSelectorByHash(hashFromString(0x2E, token));
                    }
                }
            } catch {
                // Node disappeared or has hostile accessors.
            }
        }

        function flushGenericSelectors() {
            genericState.timer = 0;
            const nodes = Array.from(genericState.pendingNodes);
            genericState.pendingNodes.clear();
            for (const node of nodes) {
                surveyGenericNode(node);
                try {
                    for (const descendant of node.querySelectorAll('[id],[class]')) {
                        surveyGenericNode(descendant);
                    }
                } catch {}
            }
            if (genericState.selectors.size === 0) return;
            const style = ensureStyleElement(genericStyleId);
            if (!style) return;
            style.textContent = `${Array.from(genericState.selectors).join(',\n')}{display:none!important;}`;
        }

        function scheduleGenericSurvey(node) {
            if (node && node.nodeType === 1) genericState.pendingNodes.add(node);
            if (genericState.timer) return;
            genericState.timer = setTimeout(flushGenericSelectors, 80);
        }

        function resetGenericCosmetics(hostname, signature) {
            genericState.hostname = hostname;
            genericState.signature = signature;
            genericState.imported = false;
            genericState.selectors.clear();
            genericState.pendingNodes.clear();
            if (genericState.timer) {
                clearTimeout(genericState.timer);
                genericState.timer = 0;
            }
            try { genericState.observer?.disconnect?.(); } catch {}
            genericState.observer = null;
            const style = document.getElementById(genericStyleId);
            if (style) style.textContent = '';
            try {
                delete globalThis.genericSelectorMap;
                delete globalThis.genericExceptionSieve;
                delete globalThis.genericExceptionMap;
            } catch {
                globalThis.genericSelectorMap = undefined;
                globalThis.genericExceptionSieve = undefined;
                globalThis.genericExceptionMap = undefined;
            }
        }

        function installGenericCosmetics(result) {
            const imports = Array.isArray(result?.genericImports) ? result.genericImports : [];
            const hostname = String(result?.hostname || location.hostname || '').toLowerCase();
            const signature = imports.map((item) => String(item?.id || '')).join('|') || 'none';
            // Amazon'un ürün akışı çok yüksek DOM/class değişimi üretir. Genel
            // kozmetik tarama burada ana iş parçacığını gereksiz yere yorar;
            // ağ tabanlı reklam engelleme çalışmaya devam eder.
            const isHighChurnCommerceHost = hostname === 'amazon.com'
                || hostname.endsWith('.amazon.com')
                || hostname === 'amazon.com.tr'
                || hostname.endsWith('.amazon.com.tr');
            if (isHighChurnCommerceHost) {
                resetGenericCosmetics(hostname, 'commerce-performance');
                return;
            }
            if (imports.length === 0) {
                if (genericState.hostname !== hostname || genericState.signature !== signature) {
                    resetGenericCosmetics(hostname, signature);
                }
                return;
            }
            if (hostname === 'youtube.com' || hostname.endsWith('.youtube.com')) {
                resetGenericCosmetics(hostname, 'youtube-lite');
                return;
            }
            if (genericState.hostname !== hostname || genericState.signature !== signature) {
                resetGenericCosmetics(hostname, signature);
            }
            if (!genericState.imported) {
                for (const item of imports) {
                    const code = String(item?.code || '');
                    if (!code.trim()) continue;
                    try {
                        Function(code).call(globalThis);
                    } catch {
                        // Keep the rest of the cosmetic bridge alive if one list fails.
                    }
                }
                genericState.imported = true;
            }
            scheduleGenericSurvey(document.documentElement);
            if (!genericState.observer && document.documentElement) {
                try {
                    genericState.observer = new MutationObserver((mutations) => {
                        for (const mutation of mutations) {
                            if (mutation.type === 'childList') {
                                for (const node of mutation.addedNodes) scheduleGenericSurvey(node);
                            } else if (mutation.target) {
                                scheduleGenericSurvey(mutation.target);
                            }
                        }
                    });
                    genericState.observer.observe(document.documentElement, {
                        childList: true,
                        subtree: true,
                        attributes: true,
                        attributeFilter: ['id', 'class']
                    });
                } catch {
                    // Observer is best-effort.
                }
            }
        }

        function patternToRegex(pattern, flags = '') {
            const text = String(pattern || '');
            const match = /^\/([\s\S]*)\/([a-z]*)$/i.exec(text);
            if (match) {
                try { return new RegExp(match[1], match[2] || flags || undefined); } catch {}
            }
            try {
                return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags || 'i');
            } catch {
                return /^$/;
            }
        }

        function queryAllSafe(root, selector) {
            const value = String(selector || '').trim();
            if (!value) return root instanceof Element ? [root] : [];
            try {
                return Array.from((root || document).querySelectorAll(value));
            } catch {
                return [];
            }
        }

        function queryRelativeSafe(node, selector) {
            const value = String(selector || '').trim();
            if (!node || node.nodeType !== 1 || !value) return [];
            try {
                if (/^[>+~]/.test(value)) {
                    return Array.from(node.parentElement?.querySelectorAll(`:scope ${value}`) || []);
                }
                return Array.from(node.querySelectorAll(value));
            } catch {
                try { return Array.from(document.querySelectorAll(value)); } catch { return []; }
            }
        }

        function matchesSelectorSafe(node, selector) {
            try { return !!node?.matches?.(selector); } catch { return false; }
        }

        function evaluateTask(node, task) {
            if (!Array.isArray(task) || !node) return [];
            const name = String(task[0] || '');
            const arg = task[1];

            if (name === 'has-text') {
                return patternToRegex(arg, 'i').test(String(node.textContent || '')) ? [node] : [];
            }
            if (name === 'matches-path') {
                return patternToRegex(arg).test(`${location.pathname || ''}${location.search || ''}`) ? [node] : [];
            }
            if (name === 'matches-media') {
                try { return matchMedia(String(arg || '')).matches ? [node] : []; } catch { return []; }
            }
            if (name === 'matches-css' || name === 'matches-css-before' || name === 'matches-css-after') {
                try {
                    const pseudo = name.endsWith('before') ? '::before' : (name.endsWith('after') ? '::after' : null);
                    const style = getComputedStyle(node, pseudo);
                    const prop = String(arg?.name || '');
                    const value = String(style?.getPropertyValue(prop) || style?.[prop] || '');
                    return patternToRegex(arg?.value || '').test(value) ? [node] : [];
                } catch {
                    return [];
                }
            }
            if (name === 'has') {
                const nested = arg && typeof arg === 'object' ? arg : {};
                const candidates = queryRelativeSafe(node, nested.selector || '*');
                return filterProceduralNodes(candidates, nested.tasks || []).length > 0 ? [node] : [];
            }
            if (name === 'not') {
                const nested = arg && typeof arg === 'object' ? arg : {};
                const candidates = nested.selector ? queryRelativeSafe(node, nested.selector) : [node];
                return filterProceduralNodes(candidates, nested.tasks || []).length === 0 ? [node] : [];
            }
            if (name === 'upward') {
                if (typeof arg === 'number') {
                    let target = node;
                    for (let i = 0; i < arg; i += 1) target = target?.parentElement || null;
                    return target ? [target] : [];
                }
                const closest = String(arg || '').trim() ? node.closest(String(arg || '').trim()) : null;
                return closest ? [closest] : [];
            }
            if (name === 'spath') {
                const selector = String(arg || '').trim();
                if (!selector) return [node];
                try {
                    if (/^[+~]/.test(selector)) {
                        return Array.from(node.parentElement?.querySelectorAll(`:scope ${selector}`) || []);
                    }
                    if (/^>/.test(selector)) return Array.from(node.querySelectorAll(`:scope ${selector}`));
                    if (selector.startsWith(':')) return matchesSelectorSafe(node, selector) ? [node] : [];
                    return queryRelativeSafe(node, selector);
                } catch {
                    return [];
                }
            }

            return [node];
        }

        function filterProceduralNodes(nodes, tasks) {
            let out = Array.from(nodes || []).filter((node) => node && node.nodeType === 1);
            for (const task of Array.isArray(tasks) ? tasks : []) {
                const next = [];
                for (const node of out) next.push(...evaluateTask(node, task));
                out = Array.from(new Set(next));
                if (out.length === 0) break;
            }
            return out;
        }

        function applyProceduralAction(node, rule) {
            if (!node || node.nodeType !== 1) return;
            const action = Array.isArray(rule.action) ? rule.action : ['style', 'display:none!important;'];
            const type = String(action[0] || 'style');
            const value = String(action[1] || '');
            try {
                if (type === 'remove') {
                    node.remove();
                } else if (type === 'remove-attr' && value) {
                    node.removeAttribute(value);
                } else if (type === 'remove-class' && value) {
                    node.classList.remove(...value.split(/\s+/).filter(Boolean));
                } else if (type === 'style') {
                    node.style.cssText += `;${value || 'display:none!important;'}`;
                    proceduralState.styledNodes.add(node);
                } else if (!proceduralState.hiddenNodes.has(node)) {
                    node.style.setProperty('display', 'none', 'important');
                    proceduralState.hiddenNodes.add(node);
                }
            } catch {
                // Ignore nodes removed by page scripts.
            }
        }

        function runProceduralCosmetics() {
            proceduralState.timer = 0;
            const rules = proceduralState.rules;
            if (!Array.isArray(rules) || rules.length === 0) return;
            const deadline = performance.now() + 12;
            for (const rule of rules) {
                if (performance.now() > deadline) {
                    proceduralState.timer = setTimeout(runProceduralCosmetics, 80);
                    return;
                }
                const base = queryAllSafe(document, String(rule?.selector || '').trim() || 'html');
                const matched = filterProceduralNodes(base, rule?.tasks || []);
                for (const node of matched) applyProceduralAction(node, rule);
            }
        }

        function scheduleProceduralRun() {
            if (proceduralState.timer) return;
            proceduralState.timer = setTimeout(runProceduralCosmetics, 90);
        }

        function resetProceduralCosmetics(hostname, signature) {
            proceduralState.hostname = hostname;
            proceduralState.signature = signature;
            proceduralState.rules = [];
            proceduralState.hiddenNodes = new WeakSet();
            proceduralState.styledNodes = new WeakSet();
            if (proceduralState.timer) {
                clearTimeout(proceduralState.timer);
                proceduralState.timer = 0;
            }
            try { proceduralState.observer?.disconnect?.(); } catch {}
            proceduralState.observer = null;
            const style = document.getElementById(proceduralStyleId);
            if (style) style.textContent = '';
        }

        function installProceduralCosmetics(result) {
            const rules = Array.isArray(result?.proceduralRules) ? result.proceduralRules : [];
            const hostname = String(result?.hostname || location.hostname || '').toLowerCase();
            if (hostname === 'youtube.com' || hostname.endsWith('.youtube.com')) {
                resetProceduralCosmetics(hostname, 'youtube-lite');
                return;
            }
            const signature = `${hostname}:${rules.map((rule) => `${rule?.source || ''}:${rule?.selector || ''}`).join('|')}`;
            if (proceduralState.hostname !== hostname || proceduralState.signature !== signature) {
                resetProceduralCosmetics(hostname, signature);
            }
            proceduralState.rules = rules;
            if (rules.length === 0) return;
            scheduleProceduralRun();
            if (!proceduralState.observer && document.documentElement) {
                try {
                    proceduralState.observer = new MutationObserver(scheduleProceduralRun);
                    proceduralState.observer.observe(document.documentElement, {
                        childList: true,
                        subtree: true,
                        attributes: true,
                        attributeFilter: ['class', 'id', 'style']
                    });
                } catch {
                    // Observer is best-effort.
                }
            }
        }

        function getScriptletPageKey() {
            try {
                return `${location.origin || ''}${location.pathname || ''}${location.search || ''}`;
            } catch {
                return '';
            }
        }

        function getWebFrame() {
            if (scriptletState.webFrame !== null) return scriptletState.webFrame;
            try {
                const electron = require('electron');
                scriptletState.webFrame = electron?.webFrame || null;
            } catch {
                scriptletState.webFrame = null;
            }
            return scriptletState.webFrame;
        }

        function runMainWorldScriptlet(code) {
            const source = String(code || '');
            if (!source.trim()) return;
            try {
                const webFrame = getWebFrame();
                if (webFrame && typeof webFrame.executeJavaScript === 'function') {
                    webFrame.executeJavaScript(source, false);
                    return;
                }
            } catch {
                // Fall through to DOM injection.
            }
            try {
                const script = document.createElement('script');
                script.textContent = source;
                (document.documentElement || document.head || document.body).appendChild(script);
                script.remove();
            } catch {
                // Ignore scriptlet execution failures.
            }
        }

        function runIsolatedScriptlet(code) {
            const source = String(code || '');
            if (!source.trim()) return;
            try {
                Function(source).call(globalThis);
            } catch {
                // Ignore scriptlet execution failures.
            }
        }

        function installScriptlets(result) {
            const scripts = Array.isArray(result?.scripts) ? result.scripts : [];
            const pageKey = getScriptletPageKey();
            if (scriptletState.pageKey !== pageKey) {
                scriptletState.pageKey = pageKey;
                scriptletState.executed.clear();
            }
            for (const scriptlet of scripts) {
                if (!scriptlet || scriptlet.enabled !== true) continue;
                const id = String(scriptlet.id || '');
                const world = String(scriptlet.world || 'isolated');
                const key = `${pageKey}:${world}:${id}`;
                if (scriptletState.executed.has(key)) continue;
                scriptletState.executed.add(key);
                if (world === 'main') runMainWorldScriptlet(scriptlet.code);
                else runIsolatedScriptlet(scriptlet.code);
            }
        }

        async function refreshInjection(reason = 'load') {
            const url = getCurrentUrl();
            if (!/^https?:\/\//i.test(url)) return;
            try {
                const result = await ipcRenderer.invoke('adblock:getScriptingInjection', { url, reason });
                if (!result || result.ok !== true) return;
                const whitelisted = result.reason === 'whitelist';
                globalThis.__ardaliDeliBlockWhitelist = whitelisted;
                try {
                    globalThis.dispatchEvent(new CustomEvent('ardali:adblock-whitelist-state', {
                        detail: { whitelisted }
                    }));
                } catch {}
                await applyCss(result.css);
                installGenericCosmetics(result);
                installProceduralCosmetics(result);
                installScriptlets(result);
                globalThis.__ardaliDeliBlockScriptingState = {
                    at: Date.now(),
                    mode: result.mode || '',
                    hostname: result.hostname || '',
                    sources: Array.isArray(result.sources) ? result.sources : [],
                    genericImports: Array.isArray(result.genericImports) ? result.genericImports.map((item) => item.id) : [],
                    proceduralRules: Array.isArray(result.proceduralRules) ? result.proceduralRules.length : 0,
                    scripts: Array.isArray(result.scripts)
                        ? result.scripts.map((item) => ({ id: item.id, world: item.world, enabled: item.enabled }))
                        : []
                };
            } catch {
                // The webview must keep loading even if the adblock bridge is unavailable.
            }
        }

        function scheduleRefresh(reason) {
            setTimeout(() => refreshInjection(reason), 0);
            setTimeout(() => refreshInjection(`${reason}:late`), 700);
        }

        scheduleRefresh('pre-dom');
        addEventListener('ardali:adblock-refresh', () => scheduleRefresh('settings-change'), true);
        addEventListener('beforeunload', () => {
            try { ipcRenderer.invoke('adblock:applyCosmeticCss', { css: '' }).catch(() => {}); } catch {}
            const webFrame = getCosmeticWebFrame();
            const key = cosmeticStyleState.insertionKey;
            if (key && webFrame && typeof webFrame.removeInsertedCSS === 'function') {
                try { webFrame.removeInsertedCSS(key); } catch {}
            }
        }, { once: true });

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => scheduleRefresh('dom'), { once: true });
        } else {
            scheduleRefresh('ready');
        }

        try {
            const pushState = history.pushState;
            const replaceState = history.replaceState;
            history.pushState = function(...args) {
                const out = pushState.apply(this, args);
                scheduleRefresh('pushState');
                return out;
            };
            history.replaceState = function(...args) {
                const out = replaceState.apply(this, args);
                scheduleRefresh('replaceState');
                return out;
            };
            addEventListener('popstate', () => scheduleRefresh('popstate'), true);
            addEventListener('hashchange', () => scheduleRefresh('hashchange'), true);
        } catch {
            // navigation hooks are best-effort
        }
    }

    if (!skipAdblockScriptingForIdentityPage) installDeliBlockScriptingBridge();

    function injectEarlyYouTubePatch() {
    const code = `
        (function installArDaliDeliBlockEarlyYouTubePatch() {
            if (window.__ardaliDeliBlockEarlyYouTubePatch) return;
            window.__ardaliDeliBlockEarlyYouTubePatch = true;

            function isYouTubeHost() {
                try {
                    const h = String(location.hostname || '').toLowerCase();
                    return h === 'youtube.com' ||
                        h === 'www.youtube.com' ||
                        h === 'm.youtube.com' ||
                        h === 'music.youtube.com' ||
                        h.endsWith('.youtube.com') ||
                        h === 'youtu.be';
                } catch {
                    return false;
                }
            }

            if (!isYouTubeHost()) return;

            function stripAdPayload(payload) {
                try {
                    if (!payload || typeof payload !== 'object') return payload;
                    delete payload.adPlacements;
                    delete payload.playerAds;
                    delete payload.adSlots;
                    delete payload.adBreakHeartbeatParams;
                    delete payload.adSafetyReason;
                    delete payload.playerLegacyDesktopYpcOfferRenderer;
                    if (payload.playerConfig && typeof payload.playerConfig === 'object') {
                        delete payload.playerConfig.ads;
                    }
                    if (payload.responseContext && typeof payload.responseContext === 'object') {
                        delete payload.responseContext.adSignalsInfo;
                    }
                    if (payload.auxiliaryUi && typeof payload.auxiliaryUi === 'object') {
                        delete payload.auxiliaryUi.messageRenderers;
                    }
                    // Continuation/browse payloads can mix normal feed items and promoted
                    // metadata in the same action. Dropping the whole action breaks
                    // YouTube's infinite grid and makes the page look like it reached
                    // the end immediately, so keep feed actions intact.
                } catch {}
                return payload;
            }

            function isPlayerEndpoint(raw) {
                try {
                    const url = typeof raw === 'string'
                        ? raw
                        : String(raw && (raw.url || raw.toString && raw.toString()) || '');
                    return /\\/youtubei\\/v1\\/(player|next)\\b/.test(url) ||
                        /\\/get_video_info\\?/.test(url);
                } catch {
                    return false;
                }
            }

            function patchGlobals() {
                try { stripAdPayload(window.ytInitialPlayerResponse); } catch {}
                try { stripAdPayload(window.ytInitialData); } catch {}
                try {
                    const player = document.getElementById('movie_player');
                    stripAdPayload(player && player.getPlayerResponse && player.getPlayerResponse());
                } catch {}
            }

            const adAudioRestore = new WeakMap();

            function isLikelyAdMediaSrc(raw) {
                const src = String(raw || '').toLowerCase();
                if (!src || !src.includes('googlevideo.com/videoplayback')) return false;
                return src.includes('oad=') ||
                    src.includes('moad=') ||
                    src.includes('ctier=') ||
                    src.includes('adformat=') ||
                    src.includes('ad_type=') ||
                    src.includes('gct=');
            }

            function getAdState(player) {
                try {
                    if (!player) return 0;
                    if (typeof player.getAdState === 'function') return Number(player.getAdState()) || 0;
                    if (player.classList && player.classList.contains('ad-showing')) return 1;
                } catch {}
                return 0;
            }

            function hasVisibleAdUi() {
                try {
                    const nodes = document.querySelectorAll(
                        '.ytp-ad-player-overlay, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-ad-preview-container, .ytp-ad-text, .ytp-ad-message-container'
                    );
                    for (const node of nodes) {
                        if (!node) continue;
                        const style = window.getComputedStyle ? window.getComputedStyle(node) : null;
                        if (style && (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') === 0)) continue;
                        const rect = typeof node.getBoundingClientRect === 'function' ? node.getBoundingClientRect() : null;
                        if (rect && rect.width < 2 && rect.height < 2) continue;
                        return true;
                    }
                } catch {}
                return false;
            }

            function getYouTubeAdContainer(node) {
                try {
                    if (!node || !node.closest) return null;
                    return node.closest(
                        'ytd-ad-slot-renderer, ytd-promoted-video-renderer, ytd-in-feed-ad-layout-renderer, ytd-display-ad-renderer, ytd-promoted-sparkles-web-renderer, ytd-video-masthead-ad-v3-renderer, ytd-banner-promo-renderer, ytd-companion-slot-renderer, ytd-action-companion-ad-renderer, ytd-compact-promoted-video-renderer, ytd-promoted-sparkles-text-search-renderer, #player-ads, #masthead-ad, .video-ads, .ytp-ad-module, [data-ad], [id*="ad-slot"], [class*="ad-slot"]'
                    );
                } catch {
                    return null;
                }
            }

            function neutralizeAdContainerMedia() {
                try {
                    const containers = document.querySelectorAll(
                        'ytd-ad-slot-renderer, ytd-promoted-video-renderer, ytd-in-feed-ad-layout-renderer, ytd-display-ad-renderer, ytd-promoted-sparkles-web-renderer, ytd-video-masthead-ad-v3-renderer, ytd-banner-promo-renderer, ytd-companion-slot-renderer, ytd-action-companion-ad-renderer, ytd-compact-promoted-video-renderer, ytd-promoted-sparkles-text-search-renderer, #player-ads, #masthead-ad, .video-ads, .ytp-ad-module, [data-ad], [id*="ad-slot"], [class*="ad-slot"]'
                    );
                    containers.forEach((container) => {
                        try {
                            const medias = container && typeof container.querySelectorAll === 'function'
                                ? Array.from(container.querySelectorAll('video, audio'))
                                : [];
                            medias.forEach((m) => {
                                try {
                                    m.muted = true;
                                    m.volume = 0;
                                    if (typeof m.pause === 'function') m.pause();
                                    if (Number.isFinite(m.duration) && m.duration > 0) {
                                        m.currentTime = Math.max(0, m.duration - 0.05);
                                    }
                                } catch {}
                            });
                            if (container && container.style) {
                                container.style.setProperty('display', 'none', 'important');
                                container.style.setProperty('visibility', 'hidden', 'important');
                            }
                        } catch {}
                    });
                } catch {}
            }

            function guardAdAudio() {
                try {
                    const player = document.getElementById('movie_player');
                    const adShowing = !!(
                        document.querySelector('.ad-showing, .ad-interrupting') ||
                        (player && player.classList && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'))) ||
                        getAdState(player) > 0 ||
                        hasVisibleAdUi()
                    );
                    const medias = Array.from(document.querySelectorAll('video.html5-main-video, #movie_player video, #movie_player audio, video, audio'));
                    const adSrc = medias.some((m) => isLikelyAdMediaSrc(m && (m.currentSrc || m.src)));
                    const shouldMute = adShowing || adSrc;
                    neutralizeAdContainerMedia();
                    medias.forEach((m) => {
                        try {
                            if (!m) return;
                            const mediaIsAd = isLikelyAdMediaSrc(m.currentSrc || m.src) || !!getYouTubeAdContainer(m);
                            if (shouldMute || mediaIsAd) {
                                if (!adAudioRestore.has(m)) {
                                    adAudioRestore.set(m, {
                                        muted: !!m.muted,
                                        volume: Number.isFinite(Number(m.volume)) ? Number(m.volume) : 1,
                                        playbackRate: Number.isFinite(Number(m.playbackRate)) ? Number(m.playbackRate) : 1
                                    });
                                }
                                m.muted = true;
                                m.volume = 0;
                                if (mediaIsAd) {
                                    if (Number.isFinite(m.duration) && m.duration > 0) {
                                        m.currentTime = Math.max(0, m.duration - 0.05);
                                    }
                                    if (Number.isFinite(m.playbackRate) && m.playbackRate < 8) {
                                        m.playbackRate = 16;
                                    }
                                }
                            } else if (adAudioRestore.has(m)) {
                                const prev = adAudioRestore.get(m) || {};
                                m.muted = !!prev.muted;
                                if (Number.isFinite(Number(prev.volume))) m.volume = Math.max(0, Math.min(1, Number(prev.volume)));
                                if (Number.isFinite(Number(prev.playbackRate)) && Number(prev.playbackRate) > 0 && Number(m.playbackRate) > 4) {
                                    m.playbackRate = Number(prev.playbackRate);
                                }
                                adAudioRestore.delete(m);
                            }
                        } catch {}
                    });
                    const skip = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, button.ytp-ad-skip-button-modern, .videoAdUiSkipButton, .ytp-skip-ad-button');
                    if (skip && typeof skip.click === 'function') skip.click();
                    if (shouldMute && player && typeof player.skipAd === 'function') player.skipAd();
                } catch {}
            }

            try {
                const originalFetch = window.fetch;
                if (typeof originalFetch === 'function') {
                    window.fetch = async function(...args) {
                        const response = await originalFetch.apply(this, args);
                        if (!isPlayerEndpoint(args[0])) return response;
                        try {
                            const clone = response.clone();
                            const contentType = String(clone.headers && clone.headers.get && clone.headers.get('content-type') || '');
                            if (!contentType.includes('json')) return response;
                            const data = stripAdPayload(await clone.json());
                            const headers = new Headers(response.headers);
                            headers.set('content-type', 'application/json; charset=utf-8');
                            return new Response(JSON.stringify(data), {
                                status: response.status,
                                statusText: response.statusText,
                                headers
                            });
                        } catch {
                            return response;
                        }
                    };
                }
            } catch {}

            try {
                const originalOpen = XMLHttpRequest.prototype.open;
                const originalSend = XMLHttpRequest.prototype.send;
                XMLHttpRequest.prototype.open = function(method, url, ...rest) {
                    try { this.__ardaliDeliBlockUrl = String(url || ''); } catch {}
                    return originalOpen.call(this, method, url, ...rest);
                };
                XMLHttpRequest.prototype.send = function(...args) {
                    if (isPlayerEndpoint(this.__ardaliDeliBlockUrl)) {
                        this.addEventListener('readystatechange', () => {
                            try {
                                if (this.readyState !== 4) return;
                                const raw = String(this.responseText || '');
                                if (!raw || raw[0] !== '{') return;
                                const patched = JSON.stringify(stripAdPayload(JSON.parse(raw)));
                                Object.defineProperty(this, 'responseText', { configurable: true, get: () => patched });
                                Object.defineProperty(this, 'response', { configurable: true, get: () => patched });
                            } catch {}
                        });
                    }
                    return originalSend.apply(this, args);
                };
            } catch {}

            try {
                Object.defineProperty(window, 'ytInitialPlayerResponse', {
                    configurable: true,
                    get() { return this.__ardaliYtInitialPlayerResponse; },
                    set(value) { this.__ardaliYtInitialPlayerResponse = stripAdPayload(value); }
                });
            } catch {}

            patchGlobals();
            guardAdAudio();
            setInterval(patchGlobals, 1500);
            setInterval(guardAdAudio, 650);
        })();
    `;

    let injectedWithWebFrame = false;
    try {
        const { webFrame } = require('electron');
        if (webFrame && typeof webFrame.executeJavaScript === 'function') {
            webFrame.executeJavaScript(code, false);
            injectedWithWebFrame = true;
        }
    } catch {}

    if (!injectedWithWebFrame) {
        try {
            const script = document.createElement('script');
            script.textContent = code;
            (document.documentElement || document.head || document.body).appendChild(script);
            script.remove();
        } catch {}
    }
    }

    (async function installEarlyYouTubePatchWhenAllowed() {
        if (skipAdblockScriptingForIdentityPage) return;
        try {
            const { ipcRenderer } = require('electron');
            const url = String(location.href || '');
            const result = await ipcRenderer.invoke('adblock:getScriptingInjection', {
                url,
                reason: 'early-youtube-gate'
            });
            if (result?.ok === true && result.reason === 'whitelist') return;
        } catch {
            // Preserve the existing fail-open startup behavior if IPC is unavailable.
        }
        injectEarlyYouTubePatch();
    })();

    (async function installCredentialFormBridge() {
        if (window.top !== window || location.protocol !== 'https:') return;
        let ipcRenderer;
        try { ({ ipcRenderer } = require('electron')); } catch (_) { return; }
        if (!ipcRenderer?.invoke) return;

        const origin = location.origin;
        let bridgeEnabled = false;
        try {
            const status = await ipcRenderer.invoke('vault:guest:bridgeStatus', origin);
            bridgeEnabled = status?.enabled === true;
        } catch (_) { return; }
        if (!bridgeEnabled || location.origin !== origin) return;
        let lastUsername = '';
        let lastCandidateAt = 0;
        let stagedNoticeSent = false;
        const isVisible = (element) => {
            if (!element || !element.isConnected || !element.getClientRects().length) return false;
            const style = getComputedStyle(element);
            return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity || 1) > 0;
        };
        const isSafeLoginForm = (form, passwordField) => {
            if (!(form instanceof HTMLFormElement) || !isVisible(form) || !isVisible(passwordField)) return false;
            try {
                const action = new URL(form.getAttribute('action') || location.href, document.baseURI);
                return action.protocol === 'https:' && action.origin === origin;
            } catch (_) { return false; }
        };
        const findUsername = (form, passwordField) => {
            const candidates = Array.from((form || document).querySelectorAll('input')).filter((input) => {
                const type = String(input.type || 'text').toLowerCase();
                const hint = `${input.autocomplete || ''} ${input.name || ''} ${input.id || ''}`.toLowerCase();
                return input !== passwordField && !input.disabled && ['email', 'text', 'tel'].includes(type) &&
                    isVisible(input) && /user|email|login|identifier/.test(hint);
            });
            return candidates.reverse().find((input) => {
                const value = String(input.value || '').trim();
                return value && value.length <= 320;
            }) || null;
        };
        const stageUsername = (value) => {
            if (!bridgeEnabled) return;
            const username = String(value || '').trim();
            if (!username || username.length > 320 || username === lastUsername) return;
            lastUsername = username;
            ipcRenderer.invoke('vault:guest:stageUsername', { origin, username }).then((accepted) => {
                if (accepted === true && !stagedNoticeSent) {
                    stagedNoticeSent = true;
                    ipcRenderer.sendToHost('ardali-vault-stage-status', { state: 'username-ready' });
                }
            }).catch(() => {});
        };
        const captureCandidate = (scope = document) => {
            if (!bridgeEnabled) return;
            const now = Date.now();
            if (now - lastCandidateAt < 800) return;
            const passwordField = Array.from(scope.querySelectorAll?.('input[type="password"]') || [])
                .find((input) => !input.disabled && String(input.value || '').length > 0);
            if (!passwordField || !isSafeLoginForm(passwordField.form, passwordField)) return;
            const usernameField = findUsername(passwordField.form || scope, passwordField);
            const username = String(usernameField?.value || lastUsername || '').trim();
            const password = String(passwordField.value || '');
            if (username) stageUsername(username);
            if (!password || password.length > 4096) return;
            lastCandidateAt = now;
            ipcRenderer.invoke('vault:guest:candidate', { origin, username, password }).catch(() => {});
        };
        const dispatchInput = (input, value) => {
            const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
            descriptor?.set?.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        };

        document.addEventListener('submit', (event) => {
            if (!bridgeEnabled) return;
            const form = event.target instanceof HTMLFormElement ? event.target : null;
            if (!form) return;
            captureCandidate(form);
        }, true);
        document.addEventListener('input', (event) => {
            if (!bridgeEnabled) return;
            const input = event.target;
            if (!(input instanceof HTMLInputElement) || input.type === 'password') return;
            const hint = `${input.type || ''} ${input.autocomplete || ''} ${input.name || ''} ${input.id || ''}`.toLowerCase();
            if (/email|user|login|identifier/.test(hint)) stageUsername(input.value);
        }, true);
        document.addEventListener('pointerdown', (event) => {
            if (!bridgeEnabled) return;
            const control = event.target?.closest?.('button,input[type="submit"],input[type="button"],[role="button"]');
            if (control) captureCandidate(control.form || document);
        }, true);
        document.addEventListener('keydown', (event) => {
            if (!bridgeEnabled) return;
            if (event.key === 'Enter') captureCandidate(event.target?.form || document);
        }, true);

        let button = null;
        let activePassword = null;
        let fillInProgress = false;
        const hideButton = () => { button?.remove(); button = null; activePassword = null; };
        ipcRenderer.on('vault:guest:disable', () => {
            bridgeEnabled = false;
            lastUsername = '';
            stagedNoticeSent = false;
            hideButton();
        });
        const fillFromVault = async (event) => {
            event?.preventDefault?.();
            event?.stopImmediatePropagation?.();
            if (event?.isTrusted !== true || navigator.userActivation?.isActive !== true) return;
            if (!bridgeEnabled || fillInProgress || !activePassword) return;
            // Kilit penceresi odağı aldığında focusout düğmeyi gizleyebilir.
            // Kullanıcının ilk tıklamasını tamamlamak için hedef alanı bekleme
            // boyunca yerel ve doğrulanabilir bir referans olarak koru.
            const targetPassword = activePassword;
            fillInProgress = true;
            try {
                const authorizationToken = await ipcRenderer.invoke('vault:guest:beginFill', origin);
                if (!authorizationToken || navigator.userActivation?.isActive !== true) return;
                const secret = await ipcRenderer.invoke('vault:guest:chooseAndFill', origin, authorizationToken);
                if (!secret || location.origin !== origin || !isSafeLoginForm(targetPassword.form, targetPassword) ||
                    !targetPassword.isConnected || targetPassword.type !== 'password') return;
                const usernameField = findUsername(targetPassword.form, targetPassword);
                if (usernameField) dispatchInput(usernameField, String(secret.username || ''));
                dispatchInput(targetPassword, String(secret.password || ''));
                targetPassword.focus();
                ipcRenderer.sendToHost('ardali-vault-fill-status', { state: 'filled' });
            } catch (_) {
                ipcRenderer.sendToHost('ardali-vault-fill-status', { state: 'failed' });
            } finally { fillInProgress = false; }
        };
        const showButton = (passwordField) => {
            if (!bridgeEnabled || !isSafeLoginForm(passwordField.form, passwordField)) return;
            hideButton();
            const rect = passwordField.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            activePassword = passwordField;
            button = document.createElement('button');
            button.type = 'button';
            button.textContent = '🔑';
            button.title = 'ArDali güvenli kasadan doldur';
            button.setAttribute('aria-label', 'ArDali güvenli kasadan doldur');
            Object.assign(button.style, { position: 'fixed', zIndex: '2147483647', pointerEvents: 'auto', userSelect: 'none', left: `${Math.max(0, rect.right - 34)}px`, top: `${Math.max(0, rect.top + (rect.height - 28) / 2)}px`, width: '28px', height: '28px', border: '0', borderRadius: '8px', background: '#172235', color: '#fff', cursor: 'pointer', fontSize: '15px' });
            button.addEventListener('pointerdown', fillFromVault, true);
            button.addEventListener('click', (event) => { event.preventDefault(); event.stopImmediatePropagation(); }, true);
            document.documentElement.appendChild(button);
        };
        document.addEventListener('focusin', (event) => {
            if (!bridgeEnabled) return;
            const input = event.target;
            if (input instanceof HTMLInputElement && input.type === 'password' && isVisible(input)) showButton(input);
        }, true);
        document.addEventListener('focusout', () => setTimeout(() => { if (document.activeElement !== button) hideButton(); }, 180), true);
        window.addEventListener('scroll', hideButton, true);
        window.addEventListener('beforeunload', hideButton, { once: true });
    }());

    (function installDeliBlockElementPicker() {
        let ipcRenderer;
        try { ({ ipcRenderer } = require('electron')); } catch { return; }
        let cleanupActivePicker = null;

        function cssEscape(value) {
            if (globalThis.CSS?.escape) return globalThis.CSS.escape(String(value || ''));
            return String(value || '').replace(/[^a-z0-9_-]/gi, (char) => `\\${char}`);
        }

        function uniqueSelector(element) {
            if (!(element instanceof Element)) return '';
            const id = String(element.id || '').trim();
            if (id) {
                const selector = `#${cssEscape(id)}`;
                try { if (document.querySelectorAll(selector).length === 1) return selector; } catch {}
            }
            const segments = [];
            let node = element;
            while (node && node.nodeType === 1 && node !== document.documentElement && segments.length < 6) {
                let segment = node.localName;
                const stableClasses = Array.from(node.classList || [])
                    .filter((name) => name.length < 64 && !/\d{5,}|^(active|selected|hover|focus)$/i.test(name))
                    .slice(0, 3);
                if (stableClasses.length) segment += stableClasses.map((name) => `.${cssEscape(name)}`).join('');
                const parent = node.parentElement;
                if (parent) {
                    try {
                        const same = Array.from(parent.children).filter((child) => child.localName === node.localName);
                        if (same.length > 1) segment += `:nth-of-type(${same.indexOf(node) + 1})`;
                    } catch {}
                }
                segments.unshift(segment);
                const candidate = segments.join(' > ');
                try { if (document.querySelectorAll(candidate).length === 1) return candidate; } catch {}
                node = parent;
            }
            return segments.join(' > ');
        }

        function startPicker(payload = {}) {
            if (globalThis.__ardaliDeliBlockWhitelist === true) return;
            cleanupActivePicker?.();
            const mode = ['block', 'filter'].includes(payload.mode) ? payload.mode : 'hide';
            const overlay = document.createElement('div');
            const panel = document.createElement('div');
            const panelTitle = document.createElement('strong');
            const validationMessage = document.createElement('div');
            const panelBar = document.createElement('div');
            const selectionSummary = document.createElement('strong');
            const expandButton = document.createElement('button');
            const selectionList = document.createElement('div');
            const actions = document.createElement('div');
            const previewButton = document.createElement('button');
            const undoButton = document.createElement('button');
            const saveButton = document.createElement('button');
            const cancelButton = document.createElement('button');
            const selections = new Map();
            let hovered = null;
            let previewed = false;
            let listExpanded = false;
            const existingFilters = new Set(
                (Array.isArray(payload.existingFilters) ? payload.existingFilters : [])
                    .map((value) => String(value || '').trim())
                    .filter(Boolean)
            );

            overlay.setAttribute('data-ardali-picker-ui', 'true');
            panel.setAttribute('data-ardali-picker-ui', 'true');
            Object.assign(overlay.style, {
                position: 'fixed', zIndex: '2147483646', pointerEvents: 'none',
                border: '2px solid #5cf2c4', background: 'rgba(92,242,196,.15)',
                boxSizing: 'border-box', display: 'none'
            });
            Object.assign(panel.style, {
                position: 'fixed', zIndex: '2147483647', left: '16px', right: '16px', bottom: '16px',
                display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px 12px',
                border: '1px solid #3a4b62', borderRadius: '10px', background: '#10141b',
                color: '#fff', boxShadow: '0 12px 40px rgba(0,0,0,.55)', font: '13px sans-serif',
                maxHeight: 'min(42vh, 360px)'
            });
            Object.assign(panelBar.style, {
                display: 'flex', gap: '8px', alignItems: 'center', minHeight: '34px', minWidth: '0'
            });
            panelTitle.textContent = mode === 'filter' ? 'Kullanıcı Filtresi' : 'Element Picker';
            Object.assign(panelTitle.style, { fontSize: '14px', color: '#fff' });
            validationMessage.setAttribute('aria-live', 'polite');
            Object.assign(validationMessage.style, {
                minHeight: '16px', color: '#ffb4b4', fontSize: '12px', display: 'none'
            });
            selectionSummary.setAttribute('aria-live', 'polite');
            Object.assign(selectionSummary.style, {
                flex: '0 0 auto', alignSelf: 'center', whiteSpace: 'nowrap', padding: '4px'
            });
            selectionList.setAttribute('aria-label', 'Selected element selectors');
            Object.assign(selectionList.style, {
                minWidth: '120px', maxHeight: '240px', overflow: 'auto',
                display: 'none', flexDirection: 'column', gap: '5px'
            });
            Object.assign(actions.style, {
                marginLeft: 'auto', flex: '0 0 auto', display: 'flex', gap: '8px', alignItems: 'center'
            });
            const setupButton = (button, text, primary = false) => {
                button.type = 'button';
                button.textContent = text;
                Object.assign(button.style, {
                    padding: '8px 12px', borderRadius: '6px', cursor: 'pointer',
                    border: '1px solid #4b607d', background: primary ? '#176b55' : '#1b2635', color: '#fff'
                });
            };
            setupButton(previewButton, 'Preview');
            setupButton(undoButton, 'Undo');
            setupButton(saveButton, 'Save', true);
            setupButton(cancelButton, 'Cancel');
            setupButton(expandButton, '▴');
            expandButton.setAttribute('aria-label', 'Seçilen öğeleri göster');
            expandButton.setAttribute('aria-expanded', 'false');
            expandButton.title = 'Seçilen öğeleri göster';
            Object.assign(expandButton.style, {
                padding: '3px 8px', minWidth: '30px', fontSize: '12px', lineHeight: '18px'
            });
            actions.append(previewButton, undoButton, saveButton, cancelButton);
            panelBar.append(selectionSummary, expandButton, actions);
            panel.append(panelTitle, selectionList, validationMessage, panelBar);
            document.documentElement.append(overlay, panel);

            const positionMarker = (marker, element) => {
                if (!(element instanceof Element) || !element.isConnected) {
                    marker.style.display = 'none';
                    return;
                }
                const rect = element.getBoundingClientRect();
                Object.assign(marker.style, {
                    display: rect.width > 0 || rect.height > 0 ? 'block' : 'none',
                    left: `${rect.left}px`,
                    top: `${rect.top}px`,
                    width: `${rect.width}px`,
                    height: `${rect.height}px`
                });
            };
            const refreshMarkers = () => {
                for (const entry of selections.values()) positionMarker(entry.marker, entry.element);
                if (hovered) {
                    const rect = hovered.getBoundingClientRect();
                    Object.assign(overlay.style, {
                        display: rect.width > 0 || rect.height > 0 ? 'block' : 'none',
                        left: `${rect.left}px`,
                        top: `${rect.top}px`,
                        width: `${rect.width}px`,
                        height: `${rect.height}px`
                    });
                }
            };
            const updateHover = (element) => {
                if (!(element instanceof Element) || element.closest?.('[data-ardali-picker-ui]')) return;
                hovered = element;
                const rect = element.getBoundingClientRect();
                Object.assign(overlay.style, {
                    display: 'block', left: `${rect.left}px`, top: `${rect.top}px`,
                    width: `${rect.width}px`, height: `${rect.height}px`
                });
            };
            const restoreEntry = (entry) => {
                if (!entry?.previewState || !(entry.element instanceof Element)) return;
                if (entry.previewState.hadStyle) entry.element.setAttribute('style', entry.previewState.value);
                else entry.element.removeAttribute('style');
                entry.previewState = null;
            };
            const undo = () => {
                if (!previewed) return;
                for (const entry of selections.values()) restoreEntry(entry);
                previewed = false;
                refreshMarkers();
                renderSelections();
            };
            const removeSelection = (selector) => {
                const entry = selections.get(selector);
                if (!entry) return;
                restoreEntry(entry);
                entry.marker.remove();
                selections.delete(selector);
                renderSelections();
                refreshMarkers();
            };
            const renderSelections = () => {
                const count = selections.size;
                selectionSummary.textContent = `${count} öğe seçildi`;
                expandButton.disabled = count === 0;
                if (count === 0) listExpanded = false;
                selectionList.style.display = listExpanded ? 'flex' : 'none';
                expandButton.textContent = listExpanded ? '▾' : '▴';
                expandButton.setAttribute('aria-expanded', String(listExpanded));
                expandButton.setAttribute(
                    'aria-label',
                    listExpanded ? 'Seçilen öğeleri gizle' : 'Seçilen öğeleri göster'
                );
                expandButton.title = listExpanded ? 'Seçilen öğeleri gizle' : 'Seçilen öğeleri göster';
                expandButton.style.opacity = count === 0 ? '.5' : '1';
                expandButton.style.cursor = count === 0 ? 'default' : 'pointer';
                selectionList.replaceChildren();
                for (const entry of selections.values()) {
                    const row = document.createElement('div');
                    const selectorText = mode === 'filter'
                        ? document.createElement('textarea')
                        : document.createElement('code');
                    const removeButton = document.createElement('button');
                    row.setAttribute('data-ardali-picker-ui', 'true');
                    Object.assign(row.style, {
                        display: 'flex', gap: '7px', alignItems: 'center', minWidth: '0',
                        padding: '5px 7px', borderRadius: '6px', background: '#172231'
                    });
                    if (mode === 'filter') {
                        selectorText.value = entry.filterText;
                        selectorText.rows = 2;
                        selectorText.spellcheck = false;
                        selectorText.addEventListener('input', () => {
                            entry.filterText = selectorText.value;
                            validationMessage.style.display = 'none';
                        });
                    } else {
                        selectorText.textContent = entry.selector;
                    }
                    selectorText.title = mode === 'filter' ? entry.filterText : entry.selector;
                    Object.assign(selectorText.style, {
                        flex: '1', minWidth: '0', overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: mode === 'filter' ? 'pre-wrap' : 'nowrap',
                        color: '#cfe4ff',
                        background: mode === 'filter' ? '#0e1722' : 'transparent',
                        border: mode === 'filter' ? '1px solid #42536b' : '0',
                        borderRadius: mode === 'filter' ? '5px' : '0',
                        padding: mode === 'filter' ? '6px' : '0',
                        resize: mode === 'filter' ? 'vertical' : 'none'
                    });
                    setupButton(removeButton, '×');
                    removeButton.setAttribute('aria-label', `Remove ${entry.selector}`);
                    removeButton.title = 'Remove';
                    Object.assign(removeButton.style, {
                        padding: '1px 7px', borderColor: '#6d4050', background: '#35202a'
                    });
                    removeButton.addEventListener('click', () => removeSelection(entry.selector));
                    row.append(selectorText, removeButton);
                    selectionList.appendChild(row);
                }
                previewButton.disabled = count === 0 || previewed;
                undoButton.disabled = !previewed;
                saveButton.disabled = count === 0;
                for (const button of [previewButton, undoButton, saveButton]) {
                    button.style.opacity = button.disabled ? '.5' : '1';
                    button.style.cursor = button.disabled ? 'default' : 'pointer';
                }
            };
            expandButton.addEventListener('click', () => {
                if (!selections.size) return;
                listExpanded = !listExpanded;
                renderSelections();
            });
            const addSelection = (element) => {
                if (!(element instanceof Element)) return;
                if (previewed) undo();
                const selector = uniqueSelector(element);
                if (!selector || /[{}@]/.test(selector)) return;
                if (selections.has(selector)) {
                    removeSelection(selector);
                    return;
                }
                try {
                    if (!document.querySelector(selector)) return;
                } catch {
                    return;
                }
                const marker = document.createElement('div');
                marker.setAttribute('data-ardali-picker-ui', 'true');
                marker.setAttribute('aria-hidden', 'true');
                Object.assign(marker.style, {
                    position: 'fixed', zIndex: '2147483645', pointerEvents: 'none',
                    border: '2px solid #4a9eff', background: 'rgba(74,158,255,.14)',
                    boxSizing: 'border-box'
                });
                document.documentElement.appendChild(marker);
                selections.set(selector, {
                    selector,
                    filterText: `${location.hostname}##${selector}`,
                    element,
                    marker,
                    previewState: null
                });
                positionMarker(marker, element);
                renderSelections();
            };
            const onPointerMove = (event) => updateHover(document.elementFromPoint(event.clientX, event.clientY));
            const onPointerDown = (event) => {
                if (event.target?.closest?.('[data-ardali-picker-ui]')) return;
                event.preventDefault();
                event.stopImmediatePropagation();
                if (event.button !== 0) return;
                updateHover(event.target);
                addSelection(event.target);
            };
            const onClick = (event) => {
                if (event.target?.closest?.('[data-ardali-picker-ui]')) return;
                event.preventDefault();
                event.stopImmediatePropagation();
            };
            const cleanup = () => {
                document.removeEventListener('pointermove', onPointerMove, true);
                document.removeEventListener('pointerdown', onPointerDown, true);
                document.removeEventListener('click', onClick, true);
                document.removeEventListener('keydown', onKeyDown, true);
                window.removeEventListener('scroll', refreshMarkers, true);
                window.removeEventListener('resize', refreshMarkers, true);
                for (const entry of selections.values()) entry.marker.remove();
                overlay.remove();
                panel.remove();
                cleanupActivePicker = null;
            };
            const cancel = () => {
                undo();
                cleanup();
                selections.clear();
            };
            const onKeyDown = (event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    cancel();
                }
            };
            previewButton.addEventListener('click', () => {
                if (!selections.size || previewed) return;
                for (const entry of selections.values()) {
                    const element = entry.element;
                    if (!(element instanceof Element) || !element.isConnected) continue;
                    entry.previewState = {
                        hadStyle: element.hasAttribute('style'),
                        value: element.getAttribute('style') || ''
                    };
                    element.style.setProperty('display', 'none', 'important');
                }
                previewed = true;
                overlay.style.display = 'none';
                renderSelections();
                refreshMarkers();
            });
            undoButton.addEventListener('click', undo);
            cancelButton.addEventListener('click', cancel);
            saveButton.addEventListener('click', () => {
                if (!selections.size) return;
                const entries = Array.from(selections.values());
                if (mode === 'filter') {
                    const texts = [];
                    let duplicateCount = 0;
                    for (const entry of entries) {
                        const text = String(entry.filterText || '').trim();
                        const match = /^([a-z0-9.*_-]+(?:,[a-z0-9.*_-]+)*)##(.+)$/i.exec(text);
                        if (!match) {
                            validationMessage.textContent = 'Geçersiz kozmetik filtre. Beklenen biçim: example.com##.selector';
                            validationMessage.style.display = 'block';
                            return;
                        }
                        const selector = match[2].trim();
                        if (!selector || /[{}@]/.test(selector)) {
                            validationMessage.textContent = 'Geçersiz CSS selector.';
                            validationMessage.style.display = 'block';
                            return;
                        }
                        try { document.querySelector(selector); } catch {
                            validationMessage.textContent = 'Geçersiz CSS selector.';
                            validationMessage.style.display = 'block';
                            return;
                        }
                        if (existingFilters.has(text) || texts.includes(text)) {
                            duplicateCount += 1;
                            continue;
                        }
                        texts.push(text);
                    }
                    if (!texts.length) {
                        validationMessage.textContent = 'Bu filtre zaten mevcut.';
                        validationMessage.style.display = 'block';
                        return;
                    }
                    undo();
                    ipcRenderer.sendToHost('ardali-adblock-user-filter', {
                        texts,
                        hostname: location.hostname,
                        mode,
                        duplicateCount
                    });
                    cleanup();
                    return;
                }
                const selectors = entries.map((entry) => entry.selector);
                undo();
                for (const selector of selectors) {
                    ipcRenderer.sendToHost('ardali-adblock-user-filter', {
                        text: `${location.hostname}##${selector}`,
                        hostname: location.hostname,
                        selector,
                        mode
                    });
                }
                cleanup();
            });
            document.addEventListener('pointermove', onPointerMove, true);
            document.addEventListener('pointerdown', onPointerDown, true);
            document.addEventListener('click', onClick, true);
            document.addEventListener('keydown', onKeyDown, true);
            window.addEventListener('scroll', refreshMarkers, true);
            window.addEventListener('resize', refreshMarkers, true);
            cleanupActivePicker = cancel;
            renderSelections();
            const initialElement = document.elementFromPoint(Number(payload.x) || innerWidth / 2, Number(payload.y) || innerHeight / 2);
            updateHover(initialElement);
            if (mode === 'filter' && initialElement instanceof Element && !initialElement.closest?.('[data-ardali-picker-ui]')) {
                addSelection(initialElement);
                listExpanded = true;
                renderSelections();
            }
        }

        ipcRenderer.on('adblock:startElementPicker', (_event, payload) => startPicker(payload));
        globalThis.addEventListener('ardali:adblock-whitelist-state', (event) => {
            if (event?.detail?.whitelisted === true) cleanupActivePicker?.();
        });
        ipcRenderer.on('adblock:refreshScripting', () => {
            try { globalThis.dispatchEvent(new CustomEvent('ardali:adblock-refresh')); } catch {}
        });
        window.addEventListener('beforeunload', () => cleanupActivePicker?.(), { once: true });
    }());

}());
