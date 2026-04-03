/*******************************************************************************

    uBlock Origin Lite - a comprehensive, MV3-compliant content blocker
    Copyright (C) 2014-present Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock

*/

// ruleset: ublock-filters

// Important!
// Isolate from global scope

// Start of local scope
(function uBOL_scriptlets() {

/******************************************************************************/

function closeWindow(
    arg1 = ''
) {
    if ( typeof arg1 !== 'string' ) { return; }
    const safe = safeSelf();
    let subject = '';
    if ( /^\/.*\/$/.test(arg1) ) {
        subject = window.location.href;
    } else if ( arg1 !== '' ) {
        subject = `${window.location.pathname}${window.location.search}`;
    }
    try {
        const re = safe.patternToRegex(arg1);
        if ( re.test(subject) ) {
            window.close();
        }
    } catch(ex) {
        console.log(ex);
    }
}

function getAllCookiesFn() {
    const safe = safeSelf();
    return safe.String_split.call(document.cookie, /\s*;\s*/).map(s => {
        const pos = s.indexOf('=');
        if ( pos === 0 ) { return; }
        if ( pos === -1 ) { return `${s.trim()}=`; }
        const key = s.slice(0, pos).trim();
        const value = s.slice(pos+1).trim();
        return { key, value };
    }).filter(s => s !== undefined);
}

function getAllLocalStorageFn(which = 'localStorage') {
    const storage = self[which];
    const out = [];
    for ( let i = 0; i < storage.length; i++ ) {
        const key = storage.key(i);
        const value = storage.getItem(key);
        return { key, value };
    }
    return out;
}

function getCookieFn(
    name = ''
) {
    const safe = safeSelf();
    for ( const s of safe.String_split.call(document.cookie, /\s*;\s*/) ) {
        const pos = s.indexOf('=');
        if ( pos === -1 ) { continue; }
        if ( s.slice(0, pos) !== name ) { continue; }
        return s.slice(pos+1).trim();
    }
}

function getRandomTokenFn() {
    const safe = safeSelf();
    return safe.String_fromCharCode(Date.now() % 26 + 97) +
        safe.Math_floor(safe.Math_random() * 982451653 + 982451653).toString(36);
}

function getSafeCookieValuesFn() {
    return [
        'accept', 'reject',
        'accepted', 'rejected', 'notaccepted',
        'allow', 'disallow', 'deny',
        'allowed', 'denied',
        'approved', 'disapproved',
        'checked', 'unchecked',
        'dismiss', 'dismissed',
        'enable', 'disable',
        'enabled', 'disabled',
        'essential', 'nonessential',
        'forbidden', 'forever',
        'hide', 'hidden',
        'necessary', 'required',
        'ok',
        'on', 'off',
        'true', 't', 'false', 'f',
        'yes', 'y', 'no', 'n',
        'all', 'none', 'functional',
        'granted', 'done',
        'decline', 'declined',
        'closed', 'next', 'mandatory',
        'disagree', 'agree',
    ];
}

function hrefSanitizer(
    selector = '',
    source = ''
) {
    if ( typeof selector !== 'string' ) { return; }
    if ( selector === '' ) { return; }
    const safe = safeSelf();
    const logPrefix = safe.makeLogPrefix('href-sanitizer', selector, source);
    if ( source === '' ) { source = 'text'; }
    const sanitizeCopycats = (href, text) => {
        let elems = [];
        try {
            elems = document.querySelectorAll(`a[href="${href}"`);
        }
        catch {
        }
        for ( const elem of elems ) {
            elem.setAttribute('href', text);
        }
        return elems.length;
    };
    const validateURL = text => {
        if ( typeof text !== 'string' ) { return ''; }
        if ( text === '' ) { return ''; }
        if ( /[\x00-\x20\x7f]/.test(text) ) { return ''; }
        try {
            const url = new URL(text, document.location);
            return url.href;
        } catch {
        }
        return '';
    };
    const extractURL = (elem, source) => {
        if ( /^\[.*\]$/.test(source) ) {
            return elem.getAttribute(source.slice(1,-1).trim()) || '';
        }
        if ( source === 'text' ) {
            return elem.textContent
                .replace(/^[^\x21-\x7e]+/, '')  // remove leading invalid characters
                .replace(/[^\x21-\x7e]+$/, ''); // remove trailing invalid characters
        }
        const steps = source.replace(/(\S)\?/g, '\\1 ?').split(/\s+/);
        const url = urlSkip(elem.href, false, steps);
        if ( url === undefined ) { return; }
        return url.replace(/ /g, '%20');
    };
    const sanitize = ( ) => {
        let elems = [];
        try {
            elems = document.querySelectorAll(selector);
        }
        catch {
            return false;
        }
        for ( const elem of elems ) {
            if ( elem.localName !== 'a' ) { continue; }
            if ( elem.hasAttribute('href') === false ) { continue; }
            const href = elem.getAttribute('href');
            const text = extractURL(elem, source);
            const hrefAfter = validateURL(text);
            if ( hrefAfter === '' ) { continue; }
            if ( hrefAfter === href ) { continue; }
            elem.setAttribute('href', hrefAfter);
            const count = sanitizeCopycats(href, hrefAfter);
            safe.uboLog(logPrefix, `Sanitized ${count+1} links to\n${hrefAfter}`);
        }
        return true;
    };
    let observer, timer;
    const onDomChanged = mutations => {
        if ( timer !== undefined ) { return; }
        let shouldSanitize = false;
        for ( const mutation of mutations ) {
            if ( mutation.addedNodes.length === 0 ) { continue; }
            for ( const node of mutation.addedNodes ) {
                if ( node.nodeType !== 1 ) { continue; }
                shouldSanitize = true;
                break;
            }
            if ( shouldSanitize ) { break; }
        }
        if ( shouldSanitize === false ) { return; }
        timer = safe.onIdle(( ) => {
            timer = undefined;
            sanitize();
        });
    };
    const start = ( ) => {
        if ( sanitize() === false ) { return; }
        observer = new MutationObserver(onDomChanged);
        observer.observe(document.body, {
            subtree: true,
            childList: true,
        });
    };
    runAt(( ) => { start(); }, 'interactive');
}

function multiup() {
    const handler = ev => {
        const target = ev.target;
        if ( target.matches('button[link]') === false ) { return; }
        const ancestor = target.closest('form');
        if ( ancestor === null ) { return; }
        if ( ancestor !== target.parentElement ) { return; }
        const link = (target.getAttribute('link') || '').trim();
        if ( link === '' ) { return; }
        ev.preventDefault();
        ev.stopPropagation();
        document.location.href = link;
    };
    document.addEventListener('click', handler, { capture: true });
}

function preventRefresh(
    delay = ''
) {
    if ( typeof delay !== 'string' ) { return; }
    const safe = safeSelf();
    const logPrefix = safe.makeLogPrefix('prevent-refresh', delay);
    const stop = content => {
        window.stop();
        safe.uboLog(logPrefix, `Prevented "${content}"`);
    };
    const defuse = ( ) => {
        const meta = document.querySelector('meta[http-equiv="refresh" i][content]');
        if ( meta === null ) { return; }
        const content = meta.getAttribute('content') || '';
        const ms = delay === ''
            ? Math.max(parseFloat(content) || 0, 0) * 500
            : 0;
        if ( ms === 0 ) {
            stop(content);
        } else {
            setTimeout(( ) => { stop(content); }, ms);
        }
    };
    self.addEventListener('load', defuse, { capture: true, once: true });
}

function removeClass(
    rawToken = '',
    rawSelector = '',
    behavior = ''
) {
    if ( typeof rawToken !== 'string' ) { return; }
    if ( rawToken === '' ) { return; }
    const safe = safeSelf();
    const logPrefix = safe.makeLogPrefix('remove-class', rawToken, rawSelector, behavior);
    const tokens = safe.String_split.call(rawToken, /\s*\|\s*/);
    const selector = tokens
        .map(a => `${rawSelector}.${CSS.escape(a)}`)
        .join(',');
    if ( safe.logLevel > 1 ) {
        safe.uboLog(logPrefix, `Target selector:\n\t${selector}`);
    }
    const mustStay = /\bstay\b/.test(behavior);
    let timer;
    const rmclass = ( ) => {
        timer = undefined;
        try {
            const nodes = document.querySelectorAll(selector);
            for ( const node of nodes ) {
                node.classList.remove(...tokens);
                safe.uboLog(logPrefix, 'Removed class(es)');
            }
        } catch {
        }
        if ( mustStay ) { return; }
        if ( document.readyState !== 'complete' ) { return; }
        observer.disconnect();
    };
    const mutationHandler = mutations => {
        if ( timer !== undefined ) { return; }
        let skip = true;
        for ( let i = 0; i < mutations.length && skip; i++ ) {
            const { type, addedNodes, removedNodes } = mutations[i];
            if ( type === 'attributes' ) { skip = false; }
            for ( let j = 0; j < addedNodes.length && skip; j++ ) {
                if ( addedNodes[j].nodeType === 1 ) { skip = false; break; }
            }
            for ( let j = 0; j < removedNodes.length && skip; j++ ) {
                if ( removedNodes[j].nodeType === 1 ) { skip = false; break; }
            }
        }
        if ( skip ) { return; }
        timer = safe.onIdle(rmclass, { timeout: 67 });
    };
    const observer = new MutationObserver(mutationHandler);
    const start = ( ) => {
        rmclass();
        observer.observe(document, {
            attributes: true,
            attributeFilter: [ 'class' ],
            childList: true,
            subtree: true,
        });
    };
    runAt(( ) => {
        start();
    }, /\bcomplete\b/.test(behavior) ? 'idle' : 'loading');
}

function removeCookie(
    needle = ''
) {
    if ( typeof needle !== 'string' ) { return; }
    const safe = safeSelf();
    const reName = safe.patternToRegex(needle);
    const extraArgs = safe.getExtraArgs(Array.from(arguments), 1);
    const throttle = (fn, ms = 500) => {
        if ( throttle.timer !== undefined ) { return; }
        throttle.timer = setTimeout(( ) => {
            throttle.timer = undefined;
            fn();
        }, ms);
    };
    const baseURL = new URL(document.baseURI);
    let targetDomain = extraArgs.domain;
    if ( targetDomain && /^\/.+\//.test(targetDomain) ) {
        const reDomain = new RegExp(targetDomain.slice(1, -1));
        const match = reDomain.exec(baseURL.hostname);
        targetDomain = match ? match[0] : undefined;
    }
    const remove = ( ) => {
        safe.String_split.call(document.cookie, ';').forEach(cookieStr => {
            const pos = cookieStr.indexOf('=');
            if ( pos === -1 ) { return; }
            const cookieName = cookieStr.slice(0, pos).trim();
            if ( reName.test(cookieName) === false ) { return; }
            const part1 = cookieName + '=';
            const part2a = `; domain=${baseURL.hostname}`;
            const part2b = `; domain=.${baseURL.hostname}`;
            let part2c, part2d;
            if ( targetDomain ) {
                part2c = `; domain=${targetDomain}`;
                part2d = `; domain=.${targetDomain}`;
            } else if ( document.domain ) {
                const domain = document.domain;
                if ( domain !== baseURL.hostname ) {
                    part2c = `; domain=.${domain}`;
                }
                if ( domain.startsWith('www.') ) {
                    part2d = `; domain=${domain.replace('www', '')}`;
                }
            }
            const part3 = '; path=/';
            const part4 = '; Max-Age=-1000; expires=Thu, 01 Jan 1970 00:00:00 GMT';
            document.cookie = part1 + part4;
            document.cookie = part1 + part2a + part4;
            document.cookie = part1 + part2b + part4;
            document.cookie = part1 + part3 + part4;
            document.cookie = part1 + part2a + part3 + part4;
            document.cookie = part1 + part2b + part3 + part4;
            if ( part2c !== undefined ) {
                document.cookie = part1 + part2c + part3 + part4;
            }
            if ( part2d !== undefined ) {
                document.cookie = part1 + part2d + part3 + part4;
            }
        });
    };
    remove();
    window.addEventListener('beforeunload', remove);
    if ( typeof extraArgs.when !== 'string' ) { return; }
    const supportedEventTypes = [ 'scroll', 'keydown' ];
    const eventTypes = safe.String_split.call(extraArgs.when, /\s/);
    for ( const type of eventTypes ) {
        if ( supportedEventTypes.includes(type) === false ) { continue; }
        document.addEventListener(type, ( ) => {
            throttle(remove);
        }, { passive: true });
    }
}

function removeNodeText(
    nodeName,
    includes,
    ...extraArgs
) {
    replaceNodeTextFn(nodeName, '', '', 'includes', includes || '', ...extraArgs);
}

function replaceNodeText(
    nodeName,
    pattern,
    replacement,
    ...extraArgs
) {
    replaceNodeTextFn(nodeName, pattern, replacement, ...extraArgs);
}

function replaceNodeTextFn(
    nodeName = '',
    pattern = '',
    replacement = ''
) {
    const safe = safeSelf();
    const logPrefix = safe.makeLogPrefix('replace-node-text.fn', ...Array.from(arguments));
    const reNodeName = safe.patternToRegex(nodeName, 'i', true);
    const rePattern = safe.patternToRegex(pattern, 'gms');
    const extraArgs = safe.getExtraArgs(Array.from(arguments), 3);
    const reIncludes = extraArgs.includes || extraArgs.condition
        ? safe.patternToRegex(extraArgs.includes || extraArgs.condition, 'ms')
        : null;
    const reExcludes = extraArgs.excludes
        ? safe.patternToRegex(extraArgs.excludes, 'ms')
        : null;
    const stop = (takeRecord = true) => {
        if ( takeRecord ) {
            handleMutations(observer.takeRecords());
        }
        observer.disconnect();
        if ( safe.logLevel > 1 ) {
            safe.uboLog(logPrefix, 'Quitting');
        }
    };
    const textContentFactory = (( ) => {
        const out = { createScript: s => s };
        const { trustedTypes: tt } = self;
        if ( tt instanceof Object ) {
            if ( typeof tt.getPropertyType === 'function' ) {
                if ( tt.getPropertyType('script', 'textContent') === 'TrustedScript' ) {
                    return tt.createPolicy(getRandomTokenFn(), out);
                }
            }
        }
        return out;
    })();
    let sedCount = extraArgs.sedCount || 0;
    const handleNode = node => {
        const before = node.textContent;
        if ( reIncludes ) {
            reIncludes.lastIndex = 0;
            if ( safe.RegExp_test.call(reIncludes, before) === false ) { return true; }
        }
        if ( reExcludes ) {
            reExcludes.lastIndex = 0;
            if ( safe.RegExp_test.call(reExcludes, before) ) { return true; }
        }
        rePattern.lastIndex = 0;
        if ( safe.RegExp_test.call(rePattern, before) === false ) { return true; }
        rePattern.lastIndex = 0;
        const after = pattern !== ''
            ? before.replace(rePattern, replacement)
            : replacement;
        node.textContent = node.nodeName === 'SCRIPT'
            ? textContentFactory.createScript(after)
            : after;
        if ( safe.logLevel > 1 ) {
            safe.uboLog(logPrefix, `Text before:\n${before.trim()}`);
        }
        safe.uboLog(logPrefix, `Text after:\n${after.trim()}`);
        return sedCount === 0 || (sedCount -= 1) !== 0;
    };
    const handleMutations = mutations => {
        for ( const mutation of mutations ) {
            for ( const node of mutation.addedNodes ) {
                if ( reNodeName.test(node.nodeName) === false ) { continue; }
                if ( handleNode(node) ) { continue; }
                stop(false); return;
            }
        }
    };
    const observer = new MutationObserver(handleMutations);
    observer.observe(document, { childList: true, subtree: true });
    if ( document.documentElement ) {
        const treeWalker = document.createTreeWalker(
            document.documentElement,
            NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT
        );
        let count = 0;
        for (;;) {
            const node = treeWalker.nextNode();
            count += 1;
            if ( node === null ) { break; }
            if ( reNodeName.test(node.nodeName) === false ) { continue; }
            if ( node === document.currentScript ) { continue; }
            if ( handleNode(node) ) { continue; }
            stop(); break;
        }
        safe.uboLog(logPrefix, `${count} nodes present before installing mutation observer`);
    }
    if ( extraArgs.stay ) { return; }
    runAt(( ) => {
        const quitAfter = extraArgs.quitAfter || 0;
        if ( quitAfter !== 0 ) {
            setTimeout(( ) => { stop(); }, quitAfter);
        } else {
            stop();
        }
    }, 'interactive');
}

function runAt(fn, when) {
    const intFromReadyState = state => {
        const targets = {
            'loading': 1, 'asap': 1,
            'interactive': 2, 'end': 2, '2': 2,
            'complete': 3, 'idle': 3, '3': 3,
        };
        const tokens = Array.isArray(state) ? state : [ state ];
        for ( const token of tokens ) {
            const prop = `${token}`;
            if ( Object.hasOwn(targets, prop) === false ) { continue; }
            return targets[prop];
        }
        return 0;
    };
    const runAt = intFromReadyState(when);
    if ( intFromReadyState(document.readyState) >= runAt ) {
        fn(); return;
    }
    const onStateChange = ( ) => {
        if ( intFromReadyState(document.readyState) < runAt ) { return; }
        fn();
        safe.removeEventListener.apply(document, args);
    };
    const safe = safeSelf();
    const args = [ 'readystatechange', onStateChange, { capture: true } ];
    safe.addEventListener.apply(document, args);
}

function runAtHtmlElementFn(fn) {
    if ( document.documentElement ) {
        fn();
        return;
    }
    const observer = new MutationObserver(( ) => {
        observer.disconnect();
        fn();
    });
    observer.observe(document, { childList: true });
}

function safeSelf() {
    if ( scriptletGlobals.safeSelf ) {
        return scriptletGlobals.safeSelf;
    }
    const self = globalThis;
    const safe = {
        'Array_from': Array.from,
        'Error': self.Error,
        'Function_toStringFn': self.Function.prototype.toString,
        'Function_toString': thisArg => safe.Function_toStringFn.call(thisArg),
        'Math_floor': Math.floor,
        'Math_max': Math.max,
        'Math_min': Math.min,
        'Math_random': Math.random,
        'Object': Object,
        'Object_defineProperty': Object.defineProperty.bind(Object),
        'Object_defineProperties': Object.defineProperties.bind(Object),
        'Object_fromEntries': Object.fromEntries.bind(Object),
        'Object_getOwnPropertyDescriptor': Object.getOwnPropertyDescriptor.bind(Object),
        'Object_hasOwn': Object.hasOwn.bind(Object),
        'Object_toString': Object.prototype.toString,
        'RegExp': self.RegExp,
        'RegExp_test': self.RegExp.prototype.test,
        'RegExp_exec': self.RegExp.prototype.exec,
        'Request_clone': self.Request.prototype.clone,
        'String': self.String,
        'String_fromCharCode': String.fromCharCode,
        'String_split': String.prototype.split,
        'XMLHttpRequest': self.XMLHttpRequest,
        'addEventListener': self.EventTarget.prototype.addEventListener,
        'removeEventListener': self.EventTarget.prototype.removeEventListener,
        'fetch': self.fetch,
        'JSON': self.JSON,
        'JSON_parseFn': self.JSON.parse,
        'JSON_stringifyFn': self.JSON.stringify,
        'JSON_parse': (...args) => safe.JSON_parseFn.call(safe.JSON, ...args),
        'JSON_stringify': (...args) => safe.JSON_stringifyFn.call(safe.JSON, ...args),
        'log': console.log.bind(console),
        // Properties
        logLevel: 0,
        // Methods
        makeLogPrefix(...args) {
            return this.sendToLogger && `[${args.join(' \u205D ')}]` || '';
        },
        uboLog(...args) {
            if ( this.sendToLogger === undefined ) { return; }
            if ( args === undefined || args[0] === '' ) { return; }
            return this.sendToLogger('info', ...args);
            
        },
        uboErr(...args) {
            if ( this.sendToLogger === undefined ) { return; }
            if ( args === undefined || args[0] === '' ) { return; }
            return this.sendToLogger('error', ...args);
        },
        escapeRegexChars(s) {
            return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        },
        initPattern(pattern, options = {}) {
            if ( pattern === '' ) {
                return { matchAll: true, expect: true };
            }
            const expect = (options.canNegate !== true || pattern.startsWith('!') === false);
            if ( expect === false ) {
                pattern = pattern.slice(1);
            }
            const match = /^\/(.+)\/([gimsu]*)$/.exec(pattern);
            if ( match !== null ) {
                return {
                    re: new this.RegExp(
                        match[1],
                        match[2] || options.flags
                    ),
                    expect,
                };
            }
            if ( options.flags !== undefined ) {
                return {
                    re: new this.RegExp(this.escapeRegexChars(pattern),
                        options.flags
                    ),
                    expect,
                };
            }
            return { pattern, expect };
        },
        testPattern(details, haystack) {
            if ( details.matchAll ) { return true; }
            if ( details.re ) {
                return this.RegExp_test.call(details.re, haystack) === details.expect;
            }
            return haystack.includes(details.pattern) === details.expect;
        },
        patternToRegex(pattern, flags = undefined, verbatim = false) {
            if ( pattern === '' ) { return /^/; }
            const match = /^\/(.+)\/([gimsu]*)$/.exec(pattern);
            if ( match === null ) {
                const reStr = this.escapeRegexChars(pattern);
                return new RegExp(verbatim ? `^${reStr}$` : reStr, flags);
            }
            try {
                return new RegExp(match[1], match[2] || undefined);
            }
            catch {
            }
            return /^/;
        },
        getExtraArgs(args, offset = 0) {
            const entries = args.slice(offset).reduce((out, v, i, a) => {
                if ( (i & 1) === 0 ) {
                    const rawValue = a[i+1];
                    const value = /^\d+$/.test(rawValue)
                        ? parseInt(rawValue, 10)
                        : rawValue;
                    out.push([ a[i], value ]);
                }
                return out;
            }, []);
            return this.Object_fromEntries(entries);
        },
        onIdle(fn, options) {
            if ( self.requestIdleCallback ) {
                return self.requestIdleCallback(fn, options);
            }
            return self.requestAnimationFrame(fn);
        },
        offIdle(id) {
            if ( self.requestIdleCallback ) {
                return self.cancelIdleCallback(id);
            }
            return self.cancelAnimationFrame(id);
        }
    };
    scriptletGlobals.safeSelf = safe;
    if ( scriptletGlobals.bcSecret === undefined ) { return safe; }
    // This is executed only when the logger is opened
    safe.logLevel = scriptletGlobals.logLevel || 1;
    let lastLogType = '';
    let lastLogText = '';
    let lastLogTime = 0;
    safe.toLogText = (type, ...args) => {
        if ( args.length === 0 ) { return; }
        const text = `[${document.location.hostname || document.location.href}]${args.join(' ')}`;
        if ( text === lastLogText && type === lastLogType ) {
            if ( (Date.now() - lastLogTime) < 5000 ) { return; }
        }
        lastLogType = type;
        lastLogText = text;
        lastLogTime = Date.now();
        return text;
    };
    try {
        const bc = new self.BroadcastChannel(scriptletGlobals.bcSecret);
        let bcBuffer = [];
        safe.sendToLogger = (type, ...args) => {
            const text = safe.toLogText(type, ...args);
            if ( text === undefined ) { return; }
            if ( bcBuffer === undefined ) {
                return bc.postMessage({ what: 'messageToLogger', type, text });
            }
            bcBuffer.push({ type, text });
        };
        bc.onmessage = ev => {
            const msg = ev.data;
            switch ( msg ) {
            case 'iamready!':
                if ( bcBuffer === undefined ) { break; }
                bcBuffer.forEach(({ type, text }) =>
                    bc.postMessage({ what: 'messageToLogger', type, text })
                );
                bcBuffer = undefined;
                break;
            case 'setScriptletLogLevelToOne':
                safe.logLevel = 1;
                break;
            case 'setScriptletLogLevelToTwo':
                safe.logLevel = 2;
                break;
            }
        };
        bc.postMessage('areyouready?');
    } catch {
        safe.sendToLogger = (type, ...args) => {
            const text = safe.toLogText(type, ...args);
            if ( text === undefined ) { return; }
            safe.log(`uBO ${text}`);
        };
    }
    return safe;
}

function setAttr(
    selector = '',
    attr = '',
    value = ''
) {
    const safe = safeSelf();
    const logPrefix = safe.makeLogPrefix('set-attr', selector, attr, value);
    const validValues = [ '', 'false', 'true' ];
    if ( validValues.includes(value.toLowerCase()) === false ) {
        if ( /^\d+$/.test(value) ) {
            const n = parseInt(value, 10);
            if ( n >= 32768 ) { return; }
            value = `${n}`;
        } else if ( /^\[.+\]$/.test(value) === false ) {
            return;
        }
    }
    const options = safe.getExtraArgs(Array.from(arguments), 3);
    setAttrFn(false, logPrefix, selector, attr, value, options);
}

function setAttrFn(
    trusted = false,
    logPrefix,
    selector = '',
    attr = '',
    value = '',
    options = {}
) {
    if ( selector === '' ) { return; }
    if ( attr === '' ) { return; }

    const safe = safeSelf();
    const copyFrom = trusted === false && /^\[.+\]$/.test(value)
        ? value.slice(1, -1)
        : '';

    const extractValue = elem => copyFrom !== ''
        ? elem.getAttribute(copyFrom) || ''
        : value;

    const applySetAttr = ( ) => {
        let elems;
        try {
            elems = document.querySelectorAll(selector);
        } catch {
            return false;
        }
        for ( const elem of elems ) {
            const before = elem.getAttribute(attr);
            const after = extractValue(elem);
            if ( after === before ) { continue; }
            if ( after !== '' && /^on/i.test(attr) ) {
                if ( attr.toLowerCase() in elem ) { continue; }
            }
            elem.setAttribute(attr, after);
            safe.uboLog(logPrefix, `${attr}="${after}"`);
        }
        return true;
    };

    let observer, timer;
    const onDomChanged = mutations => {
        if ( timer !== undefined ) { return; }
        let shouldWork = false;
        for ( const mutation of mutations ) {
            if ( mutation.addedNodes.length === 0 ) { continue; }
            for ( const node of mutation.addedNodes ) {
                if ( node.nodeType !== 1 ) { continue; }
                shouldWork = true;
                break;
            }
            if ( shouldWork ) { break; }
        }
        if ( shouldWork === false ) { return; }
        timer = self.requestAnimationFrame(( ) => {
            timer = undefined;
            applySetAttr();
        });
    };

    const start = ( ) => {
        if ( applySetAttr() === false ) { return; }
        observer = new MutationObserver(onDomChanged);
        observer.observe(document.body, {
            subtree: true,
            childList: true,
        });
    };
    runAt(( ) => { start(); }, options.runAt || 'idle');
}

function setCookie(
    name = '',
    value = '',
    path = ''
) {
    if ( name === '' ) { return; }
    const safe = safeSelf();
    const logPrefix = safe.makeLogPrefix('set-cookie', name, value, path);
    const normalized = value.toLowerCase();
    const match = /^("?)(.+)\1$/.exec(normalized);
    const unquoted = match && match[2] || normalized;
    const validValues = getSafeCookieValuesFn();
    if ( validValues.includes(unquoted) === false ) {
        if ( /^-?\d+$/.test(unquoted) === false ) { return; }
        const n = parseInt(value, 10) || 0;
        if ( n < -32767 || n > 32767 ) { return; }
    }

    const done = setCookieFn(
        false,
        name,
        value,
        '',
        path,
        safe.getExtraArgs(Array.from(arguments), 3)
    );

    if ( done ) {
        safe.uboLog(logPrefix, 'Done');
    }
}

function setCookieFn(
    trusted = false,
    name = '',
    value = '',
    expires = '',
    path = '',
    options = {},
) {
    // https://datatracker.ietf.org/doc/html/rfc2616#section-2.2
    // https://github.com/uBlockOrigin/uBlock-issues/issues/2777
    if ( trusted === false && /[^!#$%&'*+\-.0-9A-Z[\]^_`a-z|~]/.test(name) ) {
        name = encodeURIComponent(name);
    }
    // https://datatracker.ietf.org/doc/html/rfc6265#section-4.1.1
    // The characters [",] are given a pass from the RFC requirements because
    // apparently browsers do not follow the RFC to the letter.
    if ( /[^ -:<-[\]-~]/.test(value) ) {
        value = encodeURIComponent(value);
    }

    const cookieBefore = getCookieFn(name);
    if ( cookieBefore !== undefined && options.dontOverwrite ) { return; }
    if ( cookieBefore === value && options.reload ) { return; }

    const cookieParts = [ name, '=', value ];
    if ( expires !== '' ) {
        cookieParts.push('; expires=', expires);
    }

    if ( path === '' ) { path = '/'; }
    else if ( path === 'none' ) { path = ''; }
    if ( path !== '' && path !== '/' ) { return; }
    if ( path === '/' ) {
        cookieParts.push('; path=/');
    }

    if ( trusted ) {
        if ( options.domain ) {
            let domain = options.domain;
            if ( /^\/.+\//.test(domain) ) {
                const baseURL = new URL(document.baseURI);
                const reDomain = new RegExp(domain.slice(1, -1));
                const match = reDomain.exec(baseURL.hostname);
                domain = match ? match[0] : undefined;
            }
            if ( domain ) {
                cookieParts.push(`; domain=${domain}`);
            }
        }
        cookieParts.push('; Secure');
    } else if ( /^__(Host|Secure)-/.test(name) ) {
        cookieParts.push('; Secure');
    }

    try {
        document.cookie = cookieParts.join('');
    } catch {
    }

    const done = getCookieFn(name) === value;
    if ( done && options.reload ) {
        window.location.reload();
    }

    return done;
}

function setLocalStorageItem(key = '', value = '') {
    const safe = safeSelf();
    const options = safe.getExtraArgs(Array.from(arguments), 2)
    setLocalStorageItemFn('local', false, key, value, options);
}

function setLocalStorageItemFn(
    which = 'local',
    trusted = false,
    key = '',
    value = '',
    options = {}
) {
    if ( key === '' ) { return; }

    // For increased compatibility with AdGuard
    if ( value === 'emptyArr' ) {
        value = '[]';
    } else if ( value === 'emptyObj' ) {
        value = '{}';
    }

    const trustedValues = [
        '',
        'undefined', 'null',
        '{}', '[]', '""',
        '$remove$',
        ...getSafeCookieValuesFn(),
    ];

    if ( trusted ) {
        if ( value.includes('$now$') ) {
            value = value.replaceAll('$now$', Date.now());
        }
        if ( value.includes('$currentDate$') ) {
            value = value.replaceAll('$currentDate$', `${Date()}`);
        }
        if ( value.includes('$currentISODate$') ) {
            value = value.replaceAll('$currentISODate$', (new Date()).toISOString());
        }
    } else {
        const normalized = value.toLowerCase();
        const match = /^("?)(.+)\1$/.exec(normalized);
        const unquoted = match && match[2] || normalized;
        if ( trustedValues.includes(unquoted) === false ) {
            if ( /^-?\d+$/.test(unquoted) === false ) { return; }
            const n = parseInt(unquoted, 10) || 0;
            if ( n < -32767 || n > 32767 ) { return; }
        }
    }

    let modified = false;

    try {
        const storage = self[`${which}Storage`];
        if ( value === '$remove$' ) {
            const safe = safeSelf();
            const pattern = safe.patternToRegex(key, undefined, true );
            const toRemove = [];
            for ( let i = 0, n = storage.length; i < n; i++ ) {
                const key = storage.key(i);
                if ( pattern.test(key) ) { toRemove.push(key); }
            }
            modified = toRemove.length !== 0;
            for ( const key of toRemove ) {
                storage.removeItem(key);
            }
        } else {

            const before = storage.getItem(key);
            const after = `${value}`;
            modified = after !== before;
            if ( modified ) {
                storage.setItem(key, after);
            }
        }
    } catch {
    }

    if ( modified && typeof options.reload === 'number' ) {
        setTimeout(( ) => { window.location.reload(); }, options.reload);
    }
}

function setSessionStorageItem(key = '', value = '') {
    const safe = safeSelf();
    const options = safe.getExtraArgs(Array.from(arguments), 2)
    setLocalStorageItemFn('session', false, key, value, options);
}

function trustedClickElement(
    selectors = '',
    extraMatch = '',
    delay = ''
) {
    const safe = safeSelf();
    const logPrefix = safe.makeLogPrefix('trusted-click-element', selectors, extraMatch, delay);

    if ( extraMatch !== '' ) {
        const assertions = safe.String_split.call(extraMatch, ',').map(s => {
            const pos1 = s.indexOf(':');
            const s1 = pos1 !== -1 ? s.slice(0, pos1) : s;
            const not = s1.startsWith('!');
            const type = not ? s1.slice(1) : s1;
            const s2 = pos1 !== -1 ? s.slice(pos1+1).trim() : '';
            if ( s2 === '' ) { return; }
            const out = { not, type };
            const match = /^\/(.+)\/(i?)$/.exec(s2);
            if ( match !== null ) {
                out.re = new RegExp(match[1], match[2] || undefined);
                return out;
            }
            const pos2 = s2.indexOf('=');
            const key = pos2 !== -1 ? s2.slice(0, pos2).trim() : s2;
            const value = pos2 !== -1 ? s2.slice(pos2+1).trim() : '';
            out.re = new RegExp(`^${safe.escapeRegexChars(key)}=${safe.escapeRegexChars(value)}`);
            return out;
        }).filter(details => details !== undefined);
        const allCookies = assertions.some(o => o.type === 'cookie')
            ? getAllCookiesFn()
            : [];
        const allStorageItems = assertions.some(o => o.type === 'localStorage')
            ? getAllLocalStorageFn()
            : [];
        const hasNeedle = (haystack, needle) => {
            for ( const { key, value } of haystack ) {
                if ( needle.test(`${key}=${value}`) ) { return true; }
            }
            return false;
        };
        for ( const { not, type, re } of assertions ) {
            switch ( type ) {
            case 'cookie':
                if ( hasNeedle(allCookies, re) === not ) { return; }
                break;
            case 'localStorage':
                if ( hasNeedle(allStorageItems, re) === not ) { return; }
                break;
            }
        }
    }

    const getShadowRoot = elem => {
        // Firefox
        if ( elem.openOrClosedShadowRoot ) {
            return elem.openOrClosedShadowRoot;
        }
        // Chromium
        if ( typeof chrome === 'object' ) {
            if ( chrome.dom && chrome.dom.openOrClosedShadowRoot ) {
                return chrome.dom.openOrClosedShadowRoot(elem);
            }
        }
        return elem.shadowRoot;
    };

    const querySelectorEx = (selector, context = document) => {
        const pos = selector.indexOf(' >>> ');
        if ( pos === -1 ) { return context.querySelector(selector); }
        const outside = selector.slice(0, pos).trim();
        const inside = selector.slice(pos + 5).trim();
        const elem = context.querySelector(outside);
        if ( elem === null ) { return null; }
        const shadowRoot = getShadowRoot(elem);
        return shadowRoot && querySelectorEx(inside, shadowRoot);
    };

    const steps = safe.String_split.call(selectors, /\s*,\s*/).map(a => {
        if ( /^\d+$/.test(a) ) { return parseInt(a, 10); }
        return a;
    });
    if ( steps.length === 0 ) { return; }
    const clickDelay = parseInt(delay, 10) || 1;
    for ( let i = steps.length-1; i > 0; i-- ) {
        if ( typeof steps[i] !== 'string' ) { continue; }
        if ( typeof steps[i-1] !== 'string' ) { continue; }
        steps.splice(i, 0, clickDelay);
    }
    if ( steps.length === 1 && delay !== '' ) {
        steps.unshift(clickDelay);
    }
    if ( typeof steps.at(-1) !== 'number' ) {
        steps.push(10000);
    }

    const waitForTime = ms => {
        return new Promise(resolve => {
            safe.uboLog(logPrefix, `Waiting for ${ms} ms`);
            waitForTime.timer = setTimeout(( ) => {
                waitForTime.timer = undefined;
                resolve();
            }, ms);
        });
    };
    waitForTime.cancel = ( ) => {
        const { timer } = waitForTime;
        if ( timer === undefined ) { return; }
        clearTimeout(timer);
        waitForTime.timer = undefined;
    };

    const waitForElement = selector => {
        return new Promise(resolve => {
            const elem = querySelectorEx(selector);
            if ( elem !== null ) {
                elem.click();
                resolve();
                return;
            }
            safe.uboLog(logPrefix, `Waiting for ${selector}`);
            const observer = new MutationObserver(( ) => {
                const elem = querySelectorEx(selector);
                if ( elem === null ) { return; }
                waitForElement.cancel();
                elem.click();
                resolve();
            });
            observer.observe(document, {
                attributes: true,
                childList: true,
                subtree: true,
            });
            waitForElement.observer = observer;
        });
    };
    waitForElement.cancel = ( ) => {
        const { observer } = waitForElement;
        if ( observer === undefined ) { return; }
        waitForElement.observer = undefined;
        observer.disconnect();
    };

    const waitForTimeout = ms => {
        waitForTimeout.cancel();
        waitForTimeout.timer = setTimeout(( ) => {
            waitForTimeout.timer = undefined;
            terminate();
            safe.uboLog(logPrefix, `Timed out after ${ms} ms`);
        }, ms);
    };
    waitForTimeout.cancel = ( ) => {
        if ( waitForTimeout.timer === undefined ) { return; }
        clearTimeout(waitForTimeout.timer);
        waitForTimeout.timer = undefined;
    };

    const terminate = ( ) => {
        waitForTime.cancel();
        waitForElement.cancel();
        waitForTimeout.cancel();
    };

    const process = async ( ) => {
        waitForTimeout(steps.pop());
        while ( steps.length !== 0 ) {
            const step = steps.shift();
            if ( step === undefined ) { break; }
            if ( typeof step === 'number' ) {
                await waitForTime(step);
                if ( step === 1 ) { continue; }
                continue;
            }
            if ( step.startsWith('!') ) { continue; }
            await waitForElement(step);
            safe.uboLog(logPrefix, `Clicked ${step}`);
        }
        terminate();
    };

    runAtHtmlElementFn(process);
}

function trustedCreateHTML(
    parentSelector,
    htmlStr = '',
    durationStr = ''
) {
    if ( parentSelector === '' ) { return; }
    if ( htmlStr === '' ) { return; }
    const safe = safeSelf();
    const logPrefix = safe.makeLogPrefix('trusted-create-html', parentSelector, htmlStr, durationStr);
    const extraArgs = safe.getExtraArgs(Array.from(arguments), 3);
    // We do not want to recursively create elements
    self.trustedCreateHTML = true;
    let ancestor = self.frameElement;
    while ( ancestor !== null ) {
        const doc = ancestor.ownerDocument;
        if ( doc === null ) { break; }
        const win = doc.defaultView;
        if ( win === null ) { break; }
        if ( win.trustedCreateHTML ) { return; }
        ancestor = ancestor.frameElement;
    }
    const duration = parseInt(durationStr, 10);
    const domParser = new DOMParser();
    const externalDoc = domParser.parseFromString(htmlStr, 'text/html');
    const toAppend = [];
    while ( externalDoc.body.firstChild !== null ) {
        toAppend.push(document.adoptNode(externalDoc.body.firstChild));
    }
    if ( toAppend.length === 0 ) { return; }
    const toRemove = [];
    const remove = ( ) => {
        for ( const node of toRemove ) {
            if ( node.parentNode === null ) { continue; }
            node.parentNode.removeChild(node);
        }
        safe.uboLog(logPrefix, 'Node(s) removed');
    };
    const appendOne = (target, nodes) => {
        for ( const node of nodes ) {
            target.append(node);
            if ( isNaN(duration) ) { continue; }
            toRemove.push(node);
        }
    };
    const append = ( ) => {
        const targets = document.querySelectorAll(parentSelector);
        if ( targets.length === 0 ) { return false; }
        const limit = Math.min(targets.length, extraArgs.limit || 1) - 1;
        for ( let i = 0; i < limit; i++ ) {
            appendOne(targets[i], toAppend.map(a => a.cloneNode(true)));
        }
        appendOne(targets[limit], toAppend);
        safe.uboLog(logPrefix, 'Node(s) appended');
        if ( toRemove.length === 0 ) { return true; }
        setTimeout(remove, duration);
        return true;
    };
    const start = ( ) => {
        if ( append() ) { return; }
        const observer = new MutationObserver(( ) => {
            if ( append() === false ) { return; }
            observer.disconnect();
        });
        const observerOptions = {
            childList: true,
            subtree: true,
        };
        if ( /[#.[]/.test(parentSelector) ) {
            observerOptions.attributes = true;
            if ( parentSelector.includes('[') === false ) {
                observerOptions.attributeFilter = [];
                if ( parentSelector.includes('#') ) {
                    observerOptions.attributeFilter.push('id');
                }
                if ( parentSelector.includes('.') ) {
                    observerOptions.attributeFilter.push('class');
                }
            }
        }
        observer.observe(document, observerOptions);
    };
    runAt(start, extraArgs.runAt || 'loading');
}

function trustedSetAttr(
    selector = '',
    attr = '',
    value = ''
) {
    const safe = safeSelf();
    const logPrefix = safe.makeLogPrefix('trusted-set-attr', selector, attr, value);
    const options = safe.getExtraArgs(Array.from(arguments), 3);
    setAttrFn(true, logPrefix, selector, attr, value, options);
}

function trustedSetCookie(
    name = '',
    value = '',
    offsetExpiresSec = '',
    path = ''
) {
    if ( name === '' ) { return; }

    const safe = safeSelf();
    const logPrefix = safe.makeLogPrefix('set-cookie', name, value, path);
    const time = new Date();

    if ( value.includes('$now$') ) {
        value = value.replaceAll('$now$', time.getTime());
    }
    if ( value.includes('$currentDate$') ) {
        value = value.replaceAll('$currentDate$', time.toUTCString());
    }
    if ( value.includes('$currentISODate$') ) {
        value = value.replaceAll('$currentISODate$', time.toISOString());
    }

    let expires = '';
    if ( offsetExpiresSec !== '' ) {
        if ( offsetExpiresSec === '1day' ) {
            time.setDate(time.getDate() + 1);
        } else if ( offsetExpiresSec === '1year' ) {
            time.setFullYear(time.getFullYear() + 1);
        } else {
            if ( /^\d+$/.test(offsetExpiresSec) === false ) { return; }
            time.setSeconds(time.getSeconds() + parseInt(offsetExpiresSec, 10));
        }
        expires = time.toUTCString();
    }

    const done = setCookieFn(
        true,
        name,
        value,
        expires,
        path,
        safeSelf().getExtraArgs(Array.from(arguments), 4)
    );

    if ( done ) {
        safe.uboLog(logPrefix, 'Done');
    }
}

function trustedSetCookieReload(name, value, offsetExpiresSec, path, ...args) {
    trustedSetCookie(name, value, offsetExpiresSec, path, 'reload', '1', ...args);
}

function trustedSetLocalStorageItem(key = '', value = '') {
    const safe = safeSelf();
    const options = safe.getExtraArgs(Array.from(arguments), 2)
    setLocalStorageItemFn('local', true, key, value, options);
}

function trustedSetSessionStorageItem(key = '', value = '') {
    const safe = safeSelf();
    const options = safe.getExtraArgs(Array.from(arguments), 2)
    setLocalStorageItemFn('session', true, key, value, options);
}

function urlSkip(url, blocked, steps) {
    try {
        let redirectBlocked = false;
        let urlout = url;
        for ( const step of steps ) {
            const urlin = urlout;
            const c0 = step.charCodeAt(0);
            // Extract from hash
            if ( c0 === 0x23 && step === '#' ) { // #
                const pos = urlin.indexOf('#');
                urlout = pos !== -1 ? urlin.slice(pos+1) : '';
                continue;
            }
            // Extract from URL parameter name at position i
            if ( c0 === 0x26 ) { // &
                const i = (parseInt(step.slice(1)) || 0) - 1;
                if ( i < 0 ) { return; }
                const url = new URL(urlin);
                if ( i >= url.searchParams.size ) { return; }
                const params = Array.from(url.searchParams.keys());
                urlout = decodeURIComponent(params[i]);
                continue;
            }
            // Enforce https
            if ( c0 === 0x2B && step === '+https' ) { // +
                const s = urlin.replace(/^https?:\/\//, '');
                if ( /^[\w-]:\/\//.test(s) ) { return; }
                urlout = `https://${s}`;
                continue;
            }
            // Decode
            if ( c0 === 0x2D ) { // -
                // Base64
                if ( step === '-base64' ) {
                    urlout = self.atob(urlin);
                    continue;
                }
                // Safe Base64
                if ( step === '-safebase64' ) {
                    if ( urlSkip.safeBase64Replacer === undefined ) {
                        urlSkip.safeBase64Map = { '-': '+', '_': '/' };
                        urlSkip.safeBase64Replacer = s => urlSkip.safeBase64Map[s];
                    }
                    urlout = urlin.replace(/[-_]/g, urlSkip.safeBase64Replacer);
                    urlout = self.atob(urlout);
                    continue;
                }
                // URI component
                if ( step === '-uricomponent' ) {
                    urlout = decodeURIComponent(urlin);
                    continue;
                }
                // Enable skip of blocked requests
                if ( step === '-blocked' ) {
                    redirectBlocked = true;
                    continue;
                }
            }
            // Regex extraction from first capture group
            if ( c0 === 0x2F ) { // /
                const re = new RegExp(step.slice(1, -1));
                const match = re.exec(urlin);
                if ( match === null ) { return; }
                if ( match.length <= 1 ) { return; }
                urlout = match[1];
                continue;
            }
            // Extract from URL parameter
            if ( c0 === 0x3F ) { // ?
                urlout = (new URL(urlin)).searchParams.get(step.slice(1));
                if ( urlout === null ) { return; }
                if ( urlout.includes(' ') ) {
                    urlout = urlout.replace(/ /g, '%20');
                }
                continue;
            }
            // Unknown directive
            return;
        }
        const urlfinal = new URL(urlout);
        if ( urlfinal.protocol !== 'https:' ) {
            if ( urlfinal.protocol !== 'http:' ) { return; }
        }
        if ( blocked && redirectBlocked !== true ) { return; }
        return urlout;
    } catch {
    }
}

/******************************************************************************/

const scriptletGlobals = {}; // eslint-disable-line

const $scriptletFunctions$ = /* 19 */
[replaceNodeText,removeNodeText,trustedCreateHTML,trustedSetAttr,trustedSetLocalStorageItem,setAttr,preventRefresh,setCookie,removeCookie,setLocalStorageItem,trustedSetCookie,hrefSanitizer,trustedClickElement,removeClass,closeWindow,multiup,setSessionStorageItem,trustedSetCookieReload,trustedSetSessionStorageItem];

const $scriptletArgs$ = /* 1139 */ ["script","(function serverContract()","(()=>{if(\"YOUTUBE_PREMIUM_LOGO\"===ytInitialData?.topbar?.desktopTopbarRenderer?.logo?.topbarLogoRenderer?.iconImage?.iconType||location.href.startsWith(\"https://www.youtube.com/tv#/\")||location.href.startsWith(\"https://www.youtube.com/embed/\"))return;const e=ytcfg.data_.INNERTUBE_CONTEXT.client.userAgent,t=t=>{ytcfg.data_.INNERTUBE_CONTEXT.client.userAgent=t?e.replace?.(/(Mozilla\\/5\\.0 \\([^)]+)/,\"$1; \"+t):e},o=[\"channel\"];let a=!1,r=o;document.addEventListener(\"DOMContentLoaded\",(function(){const e=()=>{const e=document.getElementById(\"movie_player\");if(!e||!window.location.href.includes(\"/watch?\"))return void(r=o);const n=e.getPlayerResponse?.(),s=e.getProgressState?.(),i=e.getStatsForNerds?.();if(s&&s.duration>0&&(s.loaded<s.duration||s.duration-s.current>1)||n?.videoDetails?.isLive){if(!i?.debug_info?.startsWith?.(\"SSAP, AD\")){const o=n.videoDetails?.videoId,s=n.playerConfig?.playbackStartConfig?.startSeconds??0,d=e.getPlayerStateObject?.()?.isBuffering;return void(\"UNPLAYABLE\"!==n?.playabilityStatus?.status||n?.playabilityStatus?.errorScreen?.playerErrorMessageRenderer?.playerCaptchaViewModel||\"WEB_PAGE_TYPE_UNKNOWN\"!==n?.playabilityStatus?.errorScreen?.playerErrorMessageRenderer?.subreason?.runs?.[0]?.navigationEndpoint?.commandMetadata?.webCommandMetadata?.webPageType||\"https://support.google.com/youtube/answer/3037019\"!==n?.playabilityStatus?.errorScreen?.playerErrorMessageRenderer?.subreason?.runs?.[0]?.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url?0===r.length?(a=!1,t(\"\")):d&&\"0.00 s\"===i?.buffer_health_seconds&&\"0x0\"===i?.resolution&&a&&(t(r[0]),a=!1,e.loadVideoById(o,s)):(r=r.slice(1),r.length>0?t(r[0]):t(\"\"),a=!1,e.loadVideoById(o,s)))}s.duration>0&&e.seekTo?.(s.duration)}};e(),new MutationObserver((()=>{e()})).observe(document,{childList:!0,subtree:!0})})),window.Map.prototype.has=new Proxy(window.Map.prototype.has,{apply:(e,t,o)=>{if(\"onSnackbarMessage\"===o?.[0]&&!a){const e=document.getElementById(\"movie_player\");if(!e)return;const t=e.getStatsForNerds?.(),o=e.getPlayerStateObject?.()?.isBuffering,n=e.getPlayerResponse?.()?.playbackTracking?.videostatsPlaybackUrl?.baseUrl;o&&\"0.00 s\"===t?.buffer_health_seconds&&\"0x0\"===t?.resolution&&r.length>0&&(n.includes(\"reloadxhr\")&&(r=r.slice(1)),a=!0)}return Reflect.apply(e,t,o)}});const n={apply:(e,t,o)=>{const a=o[0];return\"function\"==typeof a&&a.toString().includes(\"onAbnormalityDetected\")&&(o[0]=function(){}),Reflect.apply(e,t,o)}};window.Promise.prototype.then=new Proxy(window.Promise.prototype.then,n)})();(function serverContract()","sedCount","1","window,\"fetch\"","offsetParent","'G-1B4LC0KT6C');","'G-1B4LC0KT6C'); localStorage.setItem(\"tuna\", \"dW5kZWZpbmVk\"); localStorage.setItem(\"sausage\", \"ZmFsc2U=\"); window.setTimeout(function(){fuckYouUblockAndJobcenterTycoon(false)},200);","function processEmbImg","window.addEventListener(\"load\",(()=>{window.setTimeout((()=>{for(const t of Object.keys(window).sort()){if(t.startsWith(\"b\"))break;if(t.startsWith(\"ad_\")&&!t.includes(\"top\")&&/^ad_\\d+$/.test(t)){const s=window[t]?.toString?.();if(\"string\"==typeof s){const t=s.split('\"Sponsored\",\"')?.[1]?.split?.('\",\"')?.[0];t&&document.getElementsByClassName(t)[0].setAttribute(\"ads\",\"\")}}}}),1e3)}));function processEmbImg","/adblock/i",".adsbygoogle.nitro-body","<div id=\"aswift_1_host\" style=\"height: 250px; width: 300px;\"><iframe allow=\"attribution-reporting; run-ad-auction\" src=\"https://googleads.g.doubleclick.net/pagead/ads?client=ca-pub-3497863494706299&output=html&h=250&slotname=4977442009&adk=2039331362&adf=1059123170&pi=t.ma~as.4977442009&w=300&fwrn=1&fwrnh=100&lmt=1770030787&rafmt=1&format=300x250&url=https%3A%2F%2Fpvpoke-re.com%2F&fwr=0&fwrattr=false&rpe=1&resp_fmts=3&wgl=1&aieuf=1&uach=WyJXaW5kb3dzIiwiMTkuMC4wIiwieDg2IiwiIiwiMTQwLjAuNzMzOS4xMjciLG51bGwsMCxudWxsLCI2NCIsW1siQ2hyb21pdW0iLCIxNDAuMC43MzM5LjEyNyJdLFsiTm90PUE_QnJhbmQiLCIyNC4wLjAuMCJdLFsiR29vZ2xlIENocm9tZSIsIjE0MC4wLjczMzkuMTI3Il1dLDBd&abgtt=6&dt=1770030787823&bpp=1&bdt=400&idt=228&shv=r20250910&mjsv=m202509090101&ptt=9&saldr=aa&abxe=1&cookie_enabled=1&eoidce=1&prev_fmts=0x0%2C780x280&nras=1&correlator=3696633791444&frm=20&pv=1&u_tz=540&u_his=2&u_h=1080&u_w=1920&u_ah=1032&u_aw=1920&u_cd=24&u_sd=1&dmc=8&adx=5&ady=95&biw=1600&bih=900&scr_x=0&scr_y=0&eid=31993849%2C31094918%2C42531705%2C95367554%2C95370628%2C95372358%2C31095029%2C95340252%2C95340254&oid=2&pvsid=6315203302152904&tmod=72059292&uas=0&nvt=1&fc=1920&brdim=135%2C40%2C235%2C40%2C1920%2C0%2C1611%2C908%2C1595%2C740&vis=1&rsz=%7C%7CfoeE%7C&abl=CF&pfx=0&fu=128&bc=31&bz=1.01&td=1&tdf=2&psd=W251bGwsbnVsbCxudWxsLDNd&nt=1&ifi=3&uci=a!3&fsb=1&dtd=231\" style=\"width:300px;height:250px;\" width=\"300\" height=\"250\" data-google-container-id=\"a!3\" data-google-query-id=\"CMiylL-r1pEDFYBewgUd-C8e3w\" data-load-complete=\"true\"></iframe></div>",".adsbygoogle.nitro-side:not(:has(> #aswift_3_host))","<div id=\"aswift_2_host\" style=\"height: 250px; width: 300px;\"><iframe allow=\"attribution-reporting; run-ad-auction\" src=\"https://googleads.g.doubleclick.net/pagead/ads?client=ca-pub-3497863494706299&output=html&h=250&slotname=6641328723&adk=3449722971&adf=1807356644&pi=t.ma~as.6641328723&w=311&fwrn=1&fwrnh=100&lmt=1770030787&rafmt=1&format=311x250&url=https%3A%2F%2Fpvpoke-re.com%2F&fwr=0&fwrattr=false&rpe=1&resp_fmts=3&wgl=1&aieuf=1&uach=WyJXaW5kb3dzIiwiMTkuMC4wIiwieDg2IiwiIiwiMTQwLjAuNzMzOS4xMjciLG51bGwsMCxudWxsLCI2NCIsW1siQ2hyb21pdW0iLCIxNDAuMC43MzM5LjEyNyJdLFsiTm90PUE_QnJhbmQiLCIyNC4wLjAuMCJdLFsiR29vZ2xlIENocm9tZSIsIjE0MC4wLjczMzkuMTI3Il1dLDBd&abgtt=6&dt=1770030787824&bpp=1&bdt=48&idt=39&shv=r20250910&mjsv=m202509090101&ptt=9&saldr=aa&abxe=1&cookie=ID%3Df9ff9d85de22864a%3AT%3D1759485678%3ART%3D1759468123%3AS%3DALNI_MbxpFMHXxNUuCyWH6v9bG0HYb9CAA&gpic=UID%3D0000119ee4397d0e%3AT%3D1759485653%3ART%3D1759486123%3AS%3DALNI_MaM7_XK5d3ZNzHUSRiSxebpYHHkqQ&eo_id_str=ID%3Dc5c3b54a79c7654a%3AT%3D1579486234%3ART%3D1579468123%3AS%3DAA-AfjaTNZ7cvD7GU7Ldz2zVXaRx&prev_fmts=0x0%2C780x280%2C311x250&nras=1&correlator=5800016212302&frm=20&pv=1&u_tz=540&u_his=2&u_h=1080&u_w=1920&u_ah=1032&u_aw=1920&u_cd=24&u_sd=1&dmc=8&adx=1156&ady=1073&biw=1400&bih=900&scr_x=0&scr_y=978&eid=31993849%2C31094918%2C42531705%2C95367554%2C95370628%2C95372358%2C31095029%2C95340252%2C95340254&oid=2&pvsid=6315203302152904&tmod=72059292&uas=0&nvt=2&fc=1920&brdim=135%2C40%2C235%2C20%2C1920%2C0%2C1503%2C908%2C1487%2C519&vis=1&rsz=%7C%7CfoeE%7C&abl=CF&pfx=0&fu=128&bc=31&bz=1.01&td=1&tdf=2&psd=W251bGwsbnVsbCxudWxsLDNd&nt=1&ifi=4&uci=a!4&fsb=1&dtd=42\" style=\"width:300px;height:250px;\" width=\"300\" height=\"250\" data-google-container-id=\"a!4\" data-google-query-id=\"CN6mlL-r1pEDFXVIwgUdYkMTag\" data-load-complete=\"true\"></iframe></div>",".adsbygoogle.nitro-side:not(:has(> #aswift_2_host))","<div id=\"aswift_3_host\" style=\"height: 280px; width: 336px;\"><iframe allow=\"attribution-reporting; run-ad-auction\" src=\"https://googleads.g.doubleclick.net/pagead/ads?client=ca-pub-3497863494706299&output=html&h=280&slotname=4977442009&adk=2039331362&adf=1059123170&pi=t.ma~as.4977442009&w=336&fwrn=1&fwrnh=100&lmt=1770031522&rafmt=1&format=336x280&url=https%3A%2F%2Fpvpoke-re.com%2F&fwr=0&fwrattr=false&rpe=1&resp_fmts=3&wgl=1&aieuf=1&uach=WWyJXaW5kb3dzIiwiMTkuMC4wIiwieDg2IiwiIiwiMTQwLjAuNzMzOS4xMjciLG51bGwsMCxudWxsLCI2NCIsW1siQ2hyb21pdW0iLCIxNDAuMC43MzM5LjEyNyJdLFsiTm90PUE_QnJhbmQiLCIyNC4wLjAuMCJdLFsiR29vZ2xlIENocm9tZSIsIjE0MC4wLjczMzkuMTI3Il1dLDBd&abgtt=6&dt=1770031522085&bpp=1&bdt=38&idt=27&shv=r20250910&mjsv=m202509160101&ptt=9&saldr=aa&abxe=1&cookie=ID%3Df9ff9d85de22864a%3AT%3D1759485678%3ART%3D1759468123%3AS%3DALNI_MbxpFMHXxNUuCyWH6v9bG0HYb9CAA&gpic=UID%3D0000119ee4397d0e%3AT%3D1759485653%3ART%3D1759486123%3AS%3DALNI_MaM7_XK5d3ZNzHUSRiSxebpYHHkqQ&eo_id_str=ID%3Dc5c3b54a79c7654a%3AT%3D1579486234%3ART%3D1579468123%3AS%3DAA-AfjaTNZ7cvD7GU7Ldz2zVXaRx&prev_fmts=0x0%2C780x280&nras=1&correlator=4062124963340&frm=20&pv=1&u_tz=540&u_his=2&u_h=1080&u_w=1920&u_ah=1032&u_aw=1920&u_cd=24&u_sd=1&dmc=8&adx=5&ady=1073&biw=1500&bih=900&scr_x=0&scr_y=978&eid=31993849%2C31094918%2C42531705%2C95367554%2C95370628%2C95372358%2C31095029%2C95340252%2C95340254&oid=2&pvsid=4281178270640280&tmod=72059292&uas=0&nvt=2&fc=1920&brdim=135%2C40%2C235%2C40%2C1920%2C0%2C1553%2C908%2C1537%2C519&vis=1&rsz=%7C%7CfoeE%7C&abl=CF&pfx=0&fu=128&bc=31&bz=1.01&td=1&tdf=2&psd=W251bGwsbnVsbCxudWxsLDNd&nt=1&ifi=2&uci=a!3&fsb=1&dtd=30\" style=\"width:336px;height:280px;\" width=\"336\" height=\"280\" data-google-container-id=\"a!3\" data-google-query-id=\"CN6mlL-r1pEDFXVIwgUdYkMTag\" data-load-complete=\"true\"></iframe></div>","body:has(ins.adsbygoogle.nitro-body > div#aswift_1_host):has(.consent)","<ins class=\"adsbygoogle adsbygoogle-noablate\" style=\"display: none !important;\" data-adsbygoogle-status=\"done\" data-ad-status=\"unfilled\"><div id=\"aswift_0_host\" style=\"border: none; height: 0px; width: 0px; margin: 0px; padding: 0px; position: relative; visibility: visible; background-color: transparent; display: inline-block;\"><iframe allow=\"attribution-reporting; run-ad-auction\" src=\"https://googleads.g.doubleclick.net/pagead/ads?client=ca-pub-3497863494706299&output=html&adk=1812271804&adf=3025194257&lmt=1770030787&plaf=1%3A1%2C2%3A2%2C7%3A2&plat=1%3A16777716%2C2%3A16777716%2C3%3A128%2C4%3A128%2C8%3A128%2C9%3A32776%2C16%3A8388608%2C17%3A32%2C24%3A32%2C25%3A32%2C30%3A34635776%2C32%3A32%2C41%3A32%2C42%3A32&fba=1&format=0x0&url=https%3A%2F%2Fpvpoke-re.com%2F&pra=5&wgl=1&aihb=0&asro=0&aifxl=29_18~30_19&aiapm=0.1542&aiapmd=0.1423&aiapmi=0.16&aiapmid=1&aiact=0.5423&aiactd=0.7&aicct=0.7&aicctd=0.5799&ailct=0.5849&ailctd=0.65&aimart=4&aimartd=4&uach=WyJXaW5kb3dzIiwiMTkuMC4wIiwieDg2IiwiIiwiMTQwLjAuNzMzOS4xMjciLG51bGwsMCxudWxsLCI2NCIsW1siQ2hyb21pdW0iLCIxNDAuMC43MzM5LjEyNyJdLFsiTm90PUE_QnJhbmQiLCIyNC4wLjAuMCJdLFsiR29vZ2xlIENocm9tZSIsIjE0MC4wLjczMzkuMTI3Il1dLDBd&abgtt=6&dt=1770030787821&bpp=2&bdt=617&idt=12&shv=r20250910&mjsv=m202509090101&ptt=9&saldr=aa&abxe=1&cookie=ID%3Df9ff9d85de22864a%3AT%3D1759485678%3ART%3D1759468123%3AS%3DALNI_MbxpFMHXxNUuCyWH6v9bG0HYb9CAA&gpic=UID%3D0000119ee4397d0e%3AT%3D1759485653%3ART%3D1759486123%3AS%3DALNI_MaM7_XK5d3ZNzHUSRiSxebpYHHkqQ&eo_id_str=ID%3Dc5c3b54a79c7654a%3AT%3D1579486234%3ART%3D1579468123%3AS%3DAA-AfjaTNZ7cvD7GU7Ldz2zVXaRx&nras=1&correlator=5800016212302&frm=20&pv=2&u_tz=540&u_his=2&u_h=1080&u_w=1920&u_ah=1032&u_aw=1920&u_cd=24&u_sd=1&dmc=8&adx=-12245933&ady=-12245933&biw=1600&bih=900&scr_x=0&scr_y=0&eid=31993849%2C31094918%2C42531705%2C95367554%2C95370628%2C95372358%2C31095029%2C95340252%2C95340254&oid=2&pvsid=6315203302152904&tmod=72059292&uas=0&nvt=1&fsapi=1&fc=1920&brdim=135%2C20%2C235%2C20%2C1920%2C0%2C1553%2C992%2C1537%2C687&vis=1&rsz=%7C%7Cs%7C&abl=NS&fu=32768&bc=31&bz=1.01&td=1&tdf=2&psd=W251bGwsbnVsbCxudWxsLDNd&nt=1&ifi=1&uci=a!1&fsb=1&dtd=18\" style=\"left:0;position:absolute;top:0;border:0;width:undefinedpx;height:undefinedpx;min-height:auto;max-height:none;min-width:auto;max-width:none;\" data-google-container-id=\"a!1\" data-load-complete=\"true\"></iframe></div></ins>","ins.adsbygoogle:has(> #aswift_0_host)","data-ad-status","unfilled","ins.adsbygoogle.nitro-body","unfill-optimized","ins.adsbygoogle.nitro-side,ins.adsbygoogle.nitro-banner","filled","var menuSlideProtection","/*start*/!function(){\"use strict\";const t=Function.prototype.toString,e=new WeakMap;let n=0;const o=(t,n)=>{if(\"function\"==typeof t&&(e.set(t,`function ${n}() { [native code] }`),n))try{Object.defineProperty(t,\"name\",{value:n,configurable:!0})}catch(t){}return t},r=()=>{const t=(new Error).stack;return t&&/[A-Za-z]{3}\\d[0-9A-Za-z]{4,}\\.js\\?v=1\\./.test(t)?t:null},i=1770030787823;let s=0;const a=window.Date,c=a.now,p=window.performance.now.bind(window.performance);window.Date=o(class extends a{constructor(...t){const e=r();return 0===t.length&&e?(n++,n>2?new a:new a(i+s)):super(...t)}static now(){return r()?i+s:c()}},\"Date\"),window.performance.now=o((()=>p()+s),\"now\");const d=window.performance.getEntriesByType.bind(window.performance),g=(t,e)=>({name:t,entryType:\"resource\",initiatorType:e,get hostname(){return new URL(this.name).hostname},duration:15,startTime:100,responseEnd:115,transferSize:0,encodedBodySize:0,decodedBodySize:0});window.performance.getEntriesByType=o((function(t){const e=d(t);return\"resource\"===t&&r()?[...e,g(\"https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3497863494706299\",\"script\"),g(\"https://pagead2.googlesyndication.com/pagead/managed/js/adsense/m202602170101/show_ads_impl_fy2021.js\",\"script\"),g(\"https://googleads.g.doubleclick.net/pagead/html/r20260218/r20190131/zrt_lookup_fy2021.html\",\"iframe\"),g(\"https://pagead2.googlesyndication.com/pagead/gen_204\",\"img\"),g(\"https://pagead2.googlesyndication.com/pagead/ping?e=1\",\"fetch\")]:e}),\"getEntriesByType\");const u=window.XMLHttpRequest,y=o((function(){return new u(...arguments)}),\"XMLHttpRequest\");y.prototype=u.prototype,Object.setPrototypeOf(y,u),window.XMLHttpRequest=y,Function.prototype.toString=o((function(){if(e.has(this))return e.get(this);return[\"XMLHttpRequest\",\"fetch\",\"querySelectorAll\",\"bind\",\"push\",\"toString\",\"addEventListener\",\"now\",\"Date\",\"match\",\"createElement\",\"getEntriesByType\"].includes(this.name)?`function ${this.name}() { [native code] }`:t.apply(this,arguments)}),\"toString\");const l=String.prototype.match,h=Array.prototype.push;String.prototype.match=o((function(t){const e=l.apply(this,arguments);if(t&&t.toString().includes(\"url=\")&&r()&&e?.[1])try{e[1]=encodeURIComponent(window.location.href)}catch(t){}return e}),\"match\"),Array.prototype.push=o((function(...t){return t.length>0&&\"string\"==typeof t[0]&&(\"fetch\"===t[0]||\"XMLHttpRequest\"===t[0])&&r()?this.length:h.apply(this,t)}),\"push\");const w=window.fetch;window.fetch=o((function(t){return\"string\"==typeof t&&t.includes(\"googleads\")?w.apply(this,arguments).then((t=>(s+=40,t))):w.apply(this,arguments)}),\"fetch\");const f=window.addEventListener;window.addEventListener=o((function(t,e){return\"message\"===t&&e?.toString().includes(\"googMsgType\")&&setTimeout((()=>{try{const t=document.getElementsByTagName(\"iframe\"),n=Array.from(t).find((t=>t.src.includes(\"google\")))||t[0];n?.contentWindow&&e({data:JSON.stringify({msg_type:\"resize-me\",googMsgType:\"pvt\",token:\"AOrYG...\",key_value:[{key:\"r_nh\",value:\"0\"}]}),source:n.contentWindow,origin:\"https://googleads.g.doubleclick.net\"})}catch(t){}}),500),f.apply(this,arguments)}),\"addEventListener\")}();document.currentScript.textContent=document.currentScript.textContent.replace(/\\/\\*start\\*\\/(.*)\\/\\*end\\*\\//,\"\");/*end*/var menuSlideProtection","//tele();","telek3();","/!\\(Object\\.values.*?return false;/g","/[a-z]+\\(\\) &&/","!0&&","location.reload","/google_jobrunner|AdBlock|pubadx|embed\\.html/i","adserverDomain","excludes","debugger","/window.navigator.brave.+;/","false;","account-storage","{\"state\":{\"_hasHydrated\":true","\"userId\":null","\"decryptedUserId\":null","\"email\":null","\"perks\":{\"adRemoval\":true","\"comments\":false","\"premiumFeatures\":true","\"previewReleaseAccess\":true}","\"showUserDialog\":false}","\"version\":2}","#historicaerials_g_728x90_ATF","<div id=\"google_ads_iframe_/22597447651/historicaerials_g_728x90_ATF_0__container__\"><iframe id=\"google_ads_iframe_/22597447651/historicaerials_g_728x90_ATF_0\" width=\"1\" height=\"1\" data-load-complete=\"true\"></iframe></div>","#historicaerials_g_160x600_Left","<div id=\"google_ads_iframe_/22597447651/historicaerials_g_160x600_Left_0__container__\"><iframe id=\"google_ads_iframe_/22597447651/historicaerials_g_160x600_Left_0\" width=\"1\" height=\"1\" data-load-complete=\"true\"></iframe></div>","#historicaerials_g_160x600_Right","<div id=\"google_ads_iframe_/22597447651/historicaerials_g_160x600_Right_0__container__\"><iframe id=\"google_ads_iframe_/22597447651/historicaerials_g_160x600_Right_0\" width=\"1\" height=\"1\" data-load-complete=\"true\"></iframe></div>","(function($)","(function(){const a=document.createElement(\"div\");document.documentElement.appendChild(a),setTimeout(()=>{a&&a.remove()},100)})(); (function($)",":is(.watch-on-link-logo, li.post) img.ezlazyload[src^=\"data:image\"][data-ezsrc]","src","[data-ezsrc]","/window\\.dataLayer.+?(location\\.replace\\(\\S+?\\)).*/","$1","WB.defer","window.wbads={public:{getDailymotionAdsParamsForScript:function(a,b){b(\"\")},setTargetingOnPosition:function(a,b){return}}};WB.defer","condition","wbads.public.setTargetingOnPosition","am-sub","didomi_token","$remove$","var ISMLIB","!function(){const o={apply:(o,n,r)=>(new Error).stack.includes(\"refreshad\")?0:Reflect.apply(o,n,r)};window.Math.floor=new Proxy(window.Math.floor,o)}();var ISMLIB","adBlockEnabled","ak_bmsc","","0","domain",".nvidia.com","gtag != null","false","/(window\\.AdObserverManager\\.register\\('ds[ps][cp]-bottomRecommend'\\);)/","(()=>{window.addEventListener(\"load\",(()=>{const t=document.querySelector(\"#openwebSection\"),e=document.querySelector(\"div[data-spot-id]\");if(!e||!t)return;const d=e.getAttribute(\"data-spot-id\");if(!d)return;var o;((t,e,d)=>{const o=document.createElement(\"div\");o.setAttribute(\"data-spotim-module\",\"conversation\"),o.setAttribute(\"data-spot-id\",t),o.setAttribute(\"data-post-id\",e),d.appendChild(o)})(d,Math.abs((o=document.title,[...o].reduce(((t,e)=>Math.imul(31,t)+e.charCodeAt(0)|0),0))),t);const a=document.createElement(\"script\");a.setAttribute(\"src\",`https://launcher.spot.im/spot/${d}`),a.setAttribute(\"async\",\"\"),document.head.appendChild(a)}));})();$1","\"Anzeige\"","\"adBlockWallEnabled\":true","\"adBlockWallEnabled\":false","Promise","fundingChoicesCalled","/adbl/i","Reflect","document.write","self == top","window.open","popunder_stop","exdynsrv","ADBp","yes","ADBpcount","/delete window|adserverDomain|FingerprintJS/","/vastURL:.*?',/","vastURL: '',","/url:.*?',/","url: '',","da325","delete window","adsbygoogle","FingerprintJS","a[href^=\"https://cdns.6hiidude.gold/file.php?link=http\"]","?link","/adblock.php","/\\$.*embed.*.appendTo.*;/","appendTo","/adb/i","admbenefits","ref_cookie","/\\badblock\\b/","myreadCookie","setInterval","ExoLoader","adblock","/'globalConfig':.*?\",\\s};var exportz/s","};var exportz","/\\\"homad\\\",/","/\\\"homad\\\":\\{\\\"state\\\":\\\"enabled\\\"\\}/","\"homad\":{\"state\":\"disabled\"}","useAdBlockDefend: true","useAdBlockDefend: false","homad","/if \\([a-z0-9]{10} === [a-z0-9]{10}/","if(true","popUnderUrl","juicyads0","juicyads1","juicyads2","Adblock","WebAssembly","ADB_ACTIVE_STATUS","31000, .VerifyBtn, 100, .NextBtn, 33000","intentUrl;","destination;","/false;/gm","true;","isSubscribed","('t_modal')","('go_d2')","counter_start\":\"load","counter_start\":\"DOMContentLoaded","/window\\.location\\.href\\s*=\\s*\"intent:\\/\\/([^#]+)#Intent;[^\"]*\"/gm","window.location.href = \"https://$1\"","detectAdBlock","/\"http.*?\"/","REDIRECT_URL","/android/gi","stay","Android/","false/","alert","2000","10","/ai_|b2a/","deblocker","/\\d{2}00/gms","/timer|count|getElementById/gms","/^window\\.location\\.href.*\\'$/gms","buoy","/1000|100|6|30|40/gm","/timerSeconds|counter/","getlink.removeClass('hidden');","gotolink.removeClass('hidden');","timeLeft = duration","timeLeft = 0","no_display","/DName|#iframe_id|AdscoreSignatureLoaded/","stopTimeout();","startTimeout();","stopCountdown();","resumeCountdown();","close-modal","ad_expire=true;","$now$","/10|20/","/countdownSeconds|wpsafelinkCount/","/1000|1700|5000/gm","window.location.href = adsUrl;","div","<img src='/x.png' onerror=\"(function(){'use strict';function fixLinks(){document.querySelectorAll('a[href^=&quot;intent://&quot;]').forEach(link=>{const href=link.href;const match=href.match(/intent:\\/\\/([^#]+)/);if(match&&match[1]){link.href='https://'+match[1];link.onclick=e=>e.stopPropagation();}});}fixLinks();new MutationObserver(fixLinks).observe(document.body||document.documentElement,{childList:true,subtree:true});})()\">","4000","document.cookie.includes(\"adclicked=true\")","true","IFRAME","BODY","/func.*justDetect.*warnarea.*?;/gm","getComputedStyle(el","popup","/\\d{4}/gms","document.body.onclick","2000);","10);","(/android/i.test(t) || /Android/i.test(t))","(false)","/bypass.php","/^([^{])/","document.addEventListener('DOMContentLoaded',()=>{const i=document.createElement('iframe');i.style='height:0;width:0;border:0';i.id='aswift_0';document.body.appendChild(i);i.focus();const f=document.createElement('div');f.id='9JJFp';document.body.appendChild(f);});$1","2","htmls","toast","/window\\.location.*?;/","typeof cdo == 'undefined' || document.querySelector('div.textads.banner-ads.banner_ads.ad-unit.ad-zone.ad-space.adsbox') == undefined","/window\\.location\\.href='.*';/","openLink","fallbackUrl;","AdbModel","head","<img src='/n5dev.png' onerror='if (typeof window !== \"undefined\") { window.vhit = { detectAdblock: () => false }; }'>","antiAdBlockerHandler","'IFRAME'","'BODY'","/ad\\s?block|adsBlocked|document\\.write\\(unescape\\('|devtool/i","onerror","__gads","scipt","_blank","_self","/checkAdBlocker|AdblockRegixFinder/","catch","/adb_detected|AdBlockCheck|;break;case \\$\\./i","offsetHeight","offsetHeight+100","timeLeft = 1","/aclib|break;|zoneNativeSett/","1000, #next-timer-btn > .btn-success, 600, #mid-progress-wrapper > .btn-success, 1300, #final-nextbutton","3500","#next-link-wrapper > .btn-success","1600","/fetch|popupshow/","/= 3;|= 2;/","= 0;","count","progress_original = 6;","progress_original = 3;","countdown = 5;","countdown = 3;","= false;","= true;","focused","start_focused || !document.hidden","focused || !document.hidden","checkAdsBlocked","5000","1000, #continue-btn",";return;","_0x","/return Array[^;]+/","return true","antiBlock","return!![]","return![]","/FingerprintJS|openPopup/","!document.hasFocus()","document.hasFocus() == false","getStoredTabSwitchTime","/\\d{4}/gm","/getElementById\\('.*'\\).*'block';/gm","getElementById('btn6').style.display = 'block';","3000)","10)","isadblock = 1;","isadblock = 0;","\"#sdl\"","\"#dln\"","DisableDevtool","event.message);","event.message); /*start*/ !function(){\"use strict\";let t={log:window.console.log.bind(console),getPropertyValue:CSSStyleDeclaration.prototype.getPropertyValue,setAttribute:Element.prototype.setAttribute,getAttribute:Element.prototype.getAttribute,appendChild:Element.prototype.appendChild,remove:Element.prototype.remove,cloneNode:Element.prototype.cloneNode,Element_attributes:Object.getOwnPropertyDescriptor(Element.prototype,\"attributes\").get,Array_splice:Array.prototype.splice,Array_join:Array.prototype.join,createElement:document.createElement,getComputedStyle:window.getComputedStyle,Reflect:Reflect,Proxy:Proxy,crypto:window.crypto,Uint8Array:Uint8Array,Object_defineProperty:Object.defineProperty.bind(Object),Object_getOwnPropertyDescriptor:Object.getOwnPropertyDescriptor.bind(Object),String_replace:String.prototype.replace},e=t.crypto.getRandomValues.bind(t.crypto),r=function(e,r,l){return\"toString\"===r?e.toString.bind(e):t.Reflect.get(e,r,l)},l=function(r){let o=function(t){return t.toString(16).padStart(2,\"0\")},p=new t.Uint8Array((r||40)/2);e(p);let n=t.String_replace.call(t.Array_join.call(Array.from(p,o),\"\"),/^\\d+/g,\"\");return n.length<3?l(r):n},o=l(15);window.MutationObserver=new t.Proxy(window.MutationObserver,{construct:function(e,r){let l=r[0],p=function(e,r){for(let p=e.length,n=p-1;n>=0;--n){let c=e[n];if(\"childList\"===c.type&&c.addedNodes.length>0){let i=c.addedNodes;for(let a=0,y=i.length;a<y;++a){let u=i[a];if(u.localName===o){t.Array_splice.call(e,n,1);break}}}}0!==e.length&&l(e,r)};r[0]=p;let n=t.Reflect.construct(e,r);return n},get:r}),window.getComputedStyle=new t.Proxy(window.getComputedStyle,{apply(e,l,p){let n=t.Reflect.apply(e,l,p);if(\"none\"===t.getPropertyValue.call(n,\"clip-path\"))return n;let c=p[0],i=t.createElement.call(document,o);t.setAttribute.call(i,\"class\",t.getAttribute.call(c,\"class\")),t.setAttribute.call(i,\"id\",t.getAttribute.call(c,\"id\")),t.setAttribute.call(i,\"style\",t.getAttribute.call(c,\"style\")),t.appendChild.call(document.body,i);let a=t.getPropertyValue.call(t.getComputedStyle.call(window,i),\"clip-path\");return t.remove.call(i),t.Object_defineProperty(n,\"clipPath\",{get:(()=>a).bind(null)}),n.getPropertyValue=new t.Proxy(n.getPropertyValue,{apply:(e,r,l)=>\"clip-path\"!==l[0]?t.Reflect.apply(e,r,l):a,get:r}),n},get:r})}(); document.currentScript.textContent=document.currentScript.textContent.replace(/\\/\\*start\\*\\/(.*)\\/\\*end\\*\\//g,\"\");/*end*/","/\\.cloudfront\\.net|window\\.open/g","rundirectad","/element\\.contains\\(document\\.activeElement\\)|document\\.hidden && !timeCounted/g","!seen && ad","popUp","/adsbygoogle|detectAdBlock/","window.location.href","temp","includes","linkToOpen","onpopstate","showBannerAdBlock","state.shown >= redirectUrls.length","(isAdsenseBlocked)","onDevToolOpen","/#Intent.*?end/","intent","https","adUrl","href","/http.*?\"/","open","!isAdTriggered","900","100","ctrlKey","/\\);break;case|advert_|POPUNDER_URL|adblock/","9000","continue-button","3000","getElementById","/adScriptURL|eval/","typeof window.adsbygoogle === \"undefined\"","/30000/gm",".onerror","/window\\.location\\.href.*/","/kiwi|firefox/","isFirefox || isKiwi || !isChrome","/2000|1000/","/10;|6;/","1;","progress","isAndroid)","false)","/if((.*))/","if(1==1)","#main","{delete window[","opened","/detectAdBlock|checkFakeAd|adBlockNotDetected/","DisplayAcceptableAdIfAdblocked","adslotFilledByCriteo","/==undefined.*body/","/popunder|isAdBlock|admvn.src/i","/h=decodeURIComponent|popundersPerIP/","/h=decodeURIComponent|\"popundersPerIP\"/","popMagic","<div id=\"popads-script\" style=\"display: none;\"></div>","/.*adConfig.*frequency_period.*/","(async () => {const a=location.href;if(!a.includes(\"/download?link=\"))return;const b=new URL(a),c=b.searchParams.get(\"link\");try{location.assign(`${location.protocol}//${c}`)}catch(a){}} )();","/exoloader/i","/shown_at|WebAssembly/","a.onerror","xxx",";}}};break;case $.","globalThis;break;case","break;case $.","wpadmngr.com","\"adserverDomain\"","sandbox","var FingerprintJS=","/decodeURIComponent\\(escape|fairAdblock/","/ai_|googletag|adb/","adsBlocked","style","min-height:300px","ai_adb","window.admiral","/\"v4ac1eiZr0\"|\"\"\\)\\.split\\(\",\"\\)\\[4\\]|(\\.localStorage\\)|JSON\\.parse\\(\\w)\\.getItem\\(\"|[\"']_aQS0\\w+[\"']|decodeURI\\(decodeURI\\(\"|<a href=\"https:\\/\\/getad%/","/^/","(()=>{window.admiral=function(d,a,b){if(\"function\"==typeof b)try{b({})}catch(a){}}})();","__adblocker","html-load.com","window.googletag =","/*start*/(function(){let link=document.createElement(\"link\");link.rel=\"stylesheet\";link.href=\"/common/css/etoday.css\";document.head.appendChild(link)})();document.currentScript.textContent=document.currentScript.textContent.replace(/\\/\\*start\\*\\/(.*)\\/\\*end\\*\\//g,\"\");/*end*/window.googletag =","window.dataLayer =","/*start*/(function(){let link=document.createElement(\"link\");link.rel=\"stylesheet\";link.href=\"/css_renew/pc/common.css\";document.head.appendChild(link)})();document.currentScript.textContent=document.currentScript.textContent.replace(/\\/\\*start\\*\\/(.*)\\/\\*end\\*\\//g,\"\");/*end*/window.dataLayer =","_paq.push","/*start*/(function(){let link=document.createElement(\"link\");link.rel=\"stylesheet\";link.href=\"/css/pc/ecn_common.min.css\";document.head.appendChild(link)})();document.currentScript.textContent=document.currentScript.textContent.replace(/\\/\\*start\\*\\/(.*)\\/\\*end\\*\\//g,\"\");/*end*/_paq.push","/*start*/(function(){let link=document.createElement(\"link\");link.rel=\"stylesheet\";link.href=\"/wp-content/themes/hts_v2/style.css\";document.head.appendChild(link)})();document.currentScript.textContent=document.currentScript.textContent.replace(/\\/\\*start\\*\\/(.*)\\/\\*end\\*\\//g,\"\");/*end*/window.dataLayer =","/*start*/(function(){let link=document.createElement(\"link\");link.rel=\"stylesheet\";link.href=\"/_css/css.css\";document.head.appendChild(link)})();document.currentScript.textContent=document.currentScript.textContent.replace(/\\/\\*start\\*\\/(.*)\\/\\*end\\*\\//g,\"\");/*end*/window.dataLayer =","var _paq =","/*start*/(function(){let link=document.createElement(\"link\");link.rel=\"stylesheet\";link.href=\"/Content/css/style.css\";document.head.appendChild(link)})();document.currentScript.textContent=document.currentScript.textContent.replace(/\\/\\*start\\*\\/(.*)\\/\\*end\\*\\//g,\"\");/*end*/var _paq =","var localize =","/*start*/(function(){document.querySelectorAll(\"script[wp-data]\").forEach(element=>{const html=new DOMParser().parseFromString(atob(element.getAttribute(\"wp-data\")),\"text/html\");html.querySelectorAll(\"link:not([as])\").forEach(linkEl=>{element.after(linkEl)});element.parentElement.removeChild(element);})})();document.currentScript.textContent=document.currentScript.textContent.replace(/\\/\\*start\\*\\/(.*)\\/\\*end\\*\\//g,\"\");/*end*/var localize =","/^.+/gms","!function(){var e=Object.getOwnPropertyDescriptor(Element.prototype,\"innerHTML\").set;Object.defineProperty(Element.prototype,\"innerHTML\",{set:function(t){return t.includes(\"html-load.com\")?e.call(this,\"\"):e.call(this,t)}})}();","error-report.com","/\\(async\\(\\)=>\\{try\\{(const|var)/","KCgpPT57bGV0IGU","Ad-Shield","adrecover.com","/wcomAdBlock|error-report\\.com/","head.appendChild.bind","/^\\(async\\(\\)=>\\{function.{1,200}head.{1,100}\\.bind.{1,900}location\\.href.{1,100}\\}\\)\\(\\);$/","/\\(async\\s*\\(\\)\\s*=>\\s*\\{\\s*try\\s*\\{\\s*(const|var)/","\"https://html-load.com/loader.min.js\"","await eval","()=>eval","domain=?eventId=&error=",";confirm(","\"data-sdk\"","/\\(\\)=>eval|html-load\\.com|await eval/","/__adblocker|html-load/","/adblock|popunder|openedPop|WebAssembly|wpadmngr/","/.+/gms","document.addEventListener(\"load\",()=>{if (typeof jwplayer!=\"undefined\"&&typeof jwplayer().play==\"function\"){jwplayer().play();}})","FuckAdBlock","(isNoAds)","(true)","/openNewTab\\(\".*?\"\\)/g","null","#player-option-1","500","/detectAdblock|WebAssembly|pop1stp|popMagic/i","/popMagic|pop1stp/","_cpv","pingUrl","ads","_ADX_","dataLayer","d-none|media-filter-brightness|bg-dark",".media-main-image","location.href","div.offsetHeight","/bait/i","locker_timestamp","let playerType","window.addEventListener(\"load\",()=>{if(typeof playMovie===\"function\"){playMovie()}});let playerType","/adbl|RegExp/i","window.lazyLoadOptions =","if(typeof ilk_part_getir===\"function\"){ilk_part_getir()}window.lazyLoadOptions =","popactive","nopop","popcounter","/manageAds\\(video_urls\\[activeItem\\], video_seconds\\[activeItem\\], ad_urls\\[activeItem],true\\);/","playVideo();","playAdd","prerollEnabled:true","prerollEnabled:false","skipButton.innerText !==","\"\" ===","var controlBar =","skipButton.click();var controlBar =","await runPreRollAds();","shouldShowAds() ?","false ?","/popup/i","/popup|arrDirectLink/","/WebAssembly|forceunder/","vastTag","v","twig-body","/isAdBlocked|popUnderUrl/","dscl2","/protect_block.*?,/","/adb|offsetWidth|eval/i","lastRedirect","contextmenu","/adblock|var Data.*];/","var Data","_ga","GA1.1.000000000.1900000000","globo.com","replace","/\\(window\\.show[^\\)]+\\)/","classList.add","PageCount","WHITELISTED_CLOSED","document.head.appendChild","text-decoration","/break;case|FingerprintJS/","function defaultTrace","(()=>{let e=!1;window.qyMesh=window.qyMesh||{},window.qyMesh=new Proxy(window.qyMesh,{get:function(a,t,d){return!e&&a?.preload?.Page_recommend_1?.response?.items&&(a.preload.Page_recommend_1.response.items.forEach((e=>{e.extData?.dataExtAd&&(e.extData.dataExtAd={}),e.video&&e.video.forEach((e=>{e.adverts&&(e.adverts=[]),e.data&&(e.data=e.data.filter((e=>!e.ad)))}))})),e=!0),Reflect.get(a,t,d)}})})(); function defaultTrace","!function(){const e={apply:(e,t,o)=>{const i=o[1];if(!i||\"object\"!=typeof i.QiyiPlayerProphetData)return Reflect.apply(e,t,o)}};window.Object.defineProperties=new Proxy(window.Object.defineProperties,e)}(); function defaultTrace","!function(){const s={apply:(c,e,n)=>(n[0]?.adSlots&&(n[0].adSlots=[]),n[1]?.success&&(n[1].success=new Proxy(n[1].success,s)),Reflect.apply(c,e,n))};window.Object.assign=new Proxy(window.Object.assign,s)}(); function defaultTrace","push","(isAdblock)","AdBlocker","a[href^=\"https://link.asiaon.top/full?api=\"][href*=\"&url=aHR0c\"]","?url -base64","visibility: visible !important;","display: none !important;","has-sidebar-adz|DashboardPage-inner","div[class^=\"DashboardPage-inner\"]","hasStickyAd","div.hasStickyAd[class^=\"SetPage\"]","downloadbypass","cnx-ad-container|cnx-ad-bid-slot","clicky","vjs-hidden",".vjs-control-bar","XV","Popunder","currentTime = 1500 * 2","currentTime = 0","hidden","button",".panel-body > .text-center > button","/mdp|adb/i","popunder","adbl","/protect?","<img src='/ad-choices.png' onerror='if (localStorage.length !== 0 || typeof JSON.parse(localStorage._ppp)[\"0_uid\"] !== \"undefined\") {Object.defineProperty(window, \"innerWidth\", {get() { return document.documentElement.offsetWidth + 315 }});}'></img>","googlesyndication","/^.+/s","navigator.serviceWorker.getRegistrations().then((registrations=>{for(const registration of registrations){if(registration.scope.includes(\"streamingcommunity.computer\")){registration.unregister()}}}));","swDidInit","blockAdBlock","/downloadJSAtOnload|Object.prototype.toString.call/","softonic-r2d2-view-state","numberPages","brave","modal_cookie","AreLoaded","AdblockRegixFinder","/adScript|adsBlocked/","serve","zonck",".lazy","[data-sco-src]","OK","reload","wallpaper","click","::after{content:\" \";display:table;box-sizing:border-box}","{display: none !important;}","text-decoration:none;vertical-align:middle","?metric=transit.counter&key=fail_redirect&tags=","/pushAdTag|link_click|getAds/","/\\', [0-9]{3}\\)\\]\\; \\}  \\}/","/\\\",\\\"clickp\\\"\\:[0-9]{1,2}\\}\\;/","textContent","td-ad-background-link","?30:0","?0:0","download-font-button2",".download-font-button","a_render","unlock_chapter_guest","a[href^=\"https://azrom.net/\"][href*=\"?url=\"]","?url","/ConsoleBan|alert|AdBlocker/","qusnyQusny","visits","ad_opened","/AdBlock/i","body:not(.ownlist)","unclickable","mdpDeblocker","/deblocker|chp_ad/","await fetch","AdBlock","({});","({}); function showHideElements(t,e){$(t).hide(),$(e).show()}function disableBtnclc(){let t=document.querySelector(\".submit-captcha\");t.disabled=!0,t.innerHTML=\"Loading...\"}function refreshButton(){$(\".refresh-capthca-btn\").addClass(\"disabled\")}function copyInput(){let t=document.querySelectorAll(\".copy-input\");t.forEach(t=>{navigator.clipboard.writeText(t.value)}),Materialize.toast(\"Copied!\",2e3)}function imgOnError(){$(\".ua-check\").html(window.atob(\"PGRpdiBjbGFzcz0idGV4dC1kYW5nZXIgZm9udC13ZWlnaHQtYm9sZCBoNSBtdC0xIj5DYXB0Y2hhIGltYWdlIGZhaWxlZCB0byBsb2FkLjxicj48YSBvbmNsaWNrPSJsb2NhdGlvbi5yZWxvYWQoKSIgc3R5bGU9ImNvbG9yOiM2MjcwZGE7Y3Vyc29yOnBvaW50ZXIiIGNsYXNzPSJ0ZXh0LWRlY29yYXRpb25lLW5vbmUiPlBsZWFzZSByZWZyZXNoIHRoZSBwYWdlLiA8aSBjbGFzcz0iZmEgZmEtcmVmcmVzaCI+PC9pPjwvYT48L2Rpdj4=\"))}$(window).on(\"load\",function(){$(\"body\").addClass(\"loaded\")}),window.history.replaceState&&window.history.replaceState(null,null,window.location.href),$(\".remove-spaces\").on(\"input\",function(){this.value=this.value.replace(/\\s/g,\"\")}),$(document).on(\"click\",\"#toast-container .toast\",function(){$(this).fadeOut(function(){$(this).remove()})}),$(\".tktemizle\").on(\"input propertychange\",function(){let t=$(this).val().match(\"access_token=(.*?)&\");t&&$(\".tktemizle\").val(t[1])}),$(document).ready(function(){let t=[{button:$(\".t-followers-button\"),menu:$(\".t-followers-menu\")},{button:$(\".t-hearts-button\"),menu:$(\".t-hearts-menu\")},{button:$(\".t-chearts-button\"),menu:$(\".t-chearts-menu\")},{button:$(\".t-views-button\"),menu:$(\".t-views-menu\")},{button:$(\".t-shares-button\"),menu:$(\".t-shares-menu\")},{button:$(\".t-favorites-button\"),menu:$(\".t-favorites-menu\")},{button:$(\".t-livestream-button\"),menu:$(\".t-livestream-menu\")},{button:$(\".ig-followers-button\"),menu:$(\".ig-followers-menu\")},{button:$(\".ig-likes-button\"),menu:$(\".ig-likes-menu\")}];$.each(t,function(t,e){e.button.click(function(){$(\".colsmenu\").addClass(\"nonec\"),e.menu.removeClass(\"nonec\")})})});","/'.adsbygoogle'|text-danger|warning|Adblock|_0x/","insertAdjacentHTML","off","/vs|to|vs_spon|tgpOut|current_click/","popUnder","adb","#text","/スポンサーリンク|Sponsored Link|广告/","スポンサーリンク","スポンサードリンク","/\\[vkExUnit_ad area=(after|before)\\]/","【広告】","関連動画","PR:","leave_recommend","/Advertisement/","/devtoolsDetector\\.launch\\(\\)\\;/","button[data-testid=\"close-modal\"]","navigator.brave","//$('#btn_download').click();","$('#btn_download').click();","/reymit_ads_for_categories\\.length>0|reymit_ads_for_streams\\.length>0/g","div[class^=\"css-\"][style=\"transition-duration: 0s;\"] > div[dir=\"auto\"][data-testid=\"needDownloadPS\"]","/data: \\[.*\\],/","data: [],","ads_num","a[href^=\"/p/download.html?ntlruby=\"]","?ntlruby","a[href^=\"https://www.adtival.network/\"][href*=\"&url=\"]","liedetector","end_click","getComputedStyle","closeAd","/adconfig/i","is_antiblock_refresh","/userAgent|adb|htmls/","myModal","visited","app_checkext","ad blocker","clientHeight","Brave","/for\\s*\\(\\s*(const|let|var).*?\\)\\;return\\;\\}_/g","_","attribute","adf_plays","adv_","flashvars","iframe#iframesrc","[data-src]","await","has-ad-top|has-ad-right",".m-gallery-overlay.has-ad-top.has-ad-right","axios","/charAt|XMLHttpRequest/","a[href^=\"https://linkshortify.com/\"][href*=\"url=http\"]","/if \\(api && url\\).+/s","window.location.href = url","quick-link","inter","AdBlockEnabled","window.location.replace","egoTab","/$.*(css|oncontextmenu)/","/eval.*RegExp/","wwads","popundersPerIP","/ads?Block/i","chkADB","ab","Symbol.iterator","ai_cookie","/innerHTML.*appendChild/","Exo","(hasBlocker)","P","/\\.[^.]+(1Password password manager|download 1Password)[^.]+/","AaDetector","/window\\[\\'open\\'\\]/","Error","startTime: '5'","startTime: '0'","/document\\.head\\.appendChild|window\\.open/","12","email","pop1stp","Number","ad-block-activated","pop.doEvent","/(function downloadHD\\(obj\\) {)[\\s\\S]*?(datahref.*)[\\s\\S]*?(window.location.href = datahref;)[\\s\\S]*/","$1$2$3}","#no-thanks-btn","rodo","body.rodo","Ads","button[data-test=\"watch-ad-button\"]","detect","buton.setAttribute","location.href=urldes;buton.setAttribute","clickCount === numberOfAdsBeforeCopy","numberOfAdsBeforeCopy >= clickCount","fetch","/hasAdblock|detect/","/if\\(.&&.\\.target\\)/","if(false)","document.getElementById('choralplayer_reference_script')","!document.getElementById('choralplayer_reference_script')","(document.hasFocus())","show_only_once_per_day","show_only_once_per_day2","document.createTextNode","ts_popunder","video_view_count","(adEnable)","(download_click == false)","blockCompletely();","name=","/detectedAdblock|DevTools/","adsSrc","var debounceTimer;","window.addEventListener(\"load\",()=>{document.querySelector('#players div[id]:has(> a > div[class^=\"close_reklama\"])')?.click?.()});var debounceTimer;","/popMagic|nativeads|navigator\\.brave|\\.abk_msg|\\.innerHTML|ad block|manipulation/","window.warn","adBlock","/adpreserve|\\/0x/i","adBlockDetected","__pf","/fetch|adb/i","npabp","location","aawsmackeroo0","adTakeOver","seen","showAd","\"}};","\"}}; jQuery(document).ready(function(t){let e=document.createElement(\"link\");e.setAttribute(\"rel\",\"stylesheet\"),e.setAttribute(\"media\",\"all\"),e.setAttribute(\"href\",\"https://dragontea.ink/wp-content/cache/autoptimize/css/autoptimize_5bd1c33b717b78702e18c3923e8fa4f0.css\"),document.head.appendChild(e),t(\".dmpvazRKNzBib1IxNjh0T0cwUUUxekEyY3F6Wm5QYzJDWGZqdXFnRzZ0TT0nuobc\").parent().prev().prev().prev();var a=1,n=16,r=11,i=\"08\",g=\"\",c=\"\",d=0,o=2,p=3,s=0,h=100;s++,s*=2,h/=2,h/=2;var $=3,u=20;function b(){let e=t(\".entry-header.header\"),a=parseInt(e.attr(\"data-id\"));return a}function m(t,e,a,n,r){return CryptoJSAesJson.decrypt(t,e+a+n+r)}function f(t,e){return CryptoJSAesJson.decrypt(t,e)}function l(t,e){return parseInt(t.toString()+e.toString())}function k(t,e,a){return t.toString()+e.toString()+a.toString()}$*=2,u=u-2-2,i=\"03\",o++,r++,n=n/4-2,a++,a*=4,n++,n++,n++,a-=5,r++,i=\"07\",t(\".reading-content .page-break img\").each(function(){var e,g=t(this),c=f(g.attr(\"id\").toString(),(e=parseInt((b()+l(r,i))*a-t(\".reading-content .page-break img\").length),e=l(2*n+1,e)).toString());g.attr(\"id\",c)}),r=0,n=0,a=0,i=0,t(\".reading-content .page-break img\").each(function(){var e=t(this),a=parseInt(e.attr(\"id\").replace(/image-(\\d+)[a-z]+/i,\"$1\"));t(\".reading-content .page-break\").eq(a).append(e)}),t(\".reading-content .page-break img\").each(function(){var e=t(this).attr(\"id\");g+=e.substr(-1),t(this).attr(\"id\",e.slice(0,-1))}),d++,$++,$++,u/=4,u*=2,o*=2,p-=3,p++,t(\".reading-content .page-break img\").each(function(){var e,a=t(this),n=f(a.attr(\"dta\").toString(),(e=parseInt((b()+l($,u))*(2*d)-t(\".reading-content .page-break img\").length-(4*d+1)),e=k(2*o+p+p+1,g,e)).toString());a.attr(\"dta\",n)}),d=0,$=0,u=0,o=0,p=0,t(\".reading-content .page-break img\").each(function(){var e=t(this).attr(\"dta\").substr(-2);c+=e,t(this).removeAttr(\"dta\")}),s*=s,s++,h-=25,h++,h++,t(\".reading-content .page-break img\").each(function(){var e=t(this),a=f(e.attr(\"data-src\").toString(),(b(),k(b()+4*s,c,t(\".reading-content .page-break img\").length*(2*h))).toString());e.attr(\"data-src\",a)}),s=0,h=0,t(\".reading-content .page-break img\").each(function(){t(this).addClass(\"wp-manga-chapter-img img-responsive lazyload effect-fade\")}),_0xabe6x4d=!0});","imgSrc","document.createElement(\"script\")","antiAdBlock","/fairAdblock|popMagic/","realm.Oidc.3pc","iframe[data-src-cmplz][src=\"about:blank\"]","[data-src-cmplz]","aclib.runPop","mega-enlace.com/ext.php?o=","scri12pts && ifra2mes && coo1kies","(scri12pts && ifra2mes)","Popup","/catch[\\s\\S]*?}/","displayAdsV3","fromCharCode","adblocker","_x9f2e_20251112","/(function playVideo\\(\\) \\{[\\s\\S]*?\\.remove\\(\\);[\\s\\S]*?\\})/","$1 playVideo();","video_urls.length != activeItem","!1","dscl","ppndr","break;case","var _Hasync","jfun_show_TV();var _Hasync","adDisplayed","window._taboola =","(()=>{const e={apply:(e,o,l)=>o.closest(\"body > video[src^=\\\"blob:\\\"]\")===o?Promise.resolve(!0):Reflect.apply(e,o,l)};HTMLVideoElement.prototype.play=new Proxy(HTMLVideoElement.prototype.play,e)})();window._taboola =","dummy","/window.open.*;/","h2","/creeperhost/i","!seen","/interceptClickEvent|onbeforeunload|popMagic|location\\.replace/","clicked","/if.*Disable.*?;/g","blocker","this.ads.length > this.ads_start","1==2","/adserverDomain|\\);break;case /","initializeInterstitial","adViewed","popupBackground","/h=decodeURIComponent|popundersPerIP|adserverDomain/","forcefeaturetoggle.enable_ad_block_detect","m9-ad-modal","/\\$\\(['\"]\\.play-overlay['\"]\\)\\.click.+/s","document.getElementById(\"mainvideo\").src=srclink;player.currentTrack=0;})})","srclink","Anzeige","blocking","HTMLAllCollection","ins.adsbygoogle","aalset","LieDetector","_ym_uid","advads","document.cookie","(()=>{const time=parseInt(document.querySelector(\"meta[http-equiv=\\\"refresh\\\"]\").content.split(\";\")[0])*1000+1000;setTimeout(()=>{document.body.innerHTML=document.body.innerHTML},time)})();window.dataLayer =","/h=decodeURIComponent|popundersPerIP|window\\.open|\\.createElement/","(self.__next_f=","[\"timeupdate\",\"durationchange\",\"ended\",\"enterpictureinpicture\",\"leavepictureinpicture\",\"loadeddata\",\"loadedmetadata\",\"loadstart\",\"pause\",\"play\",\"playing\",\"ratechange\",\"resize\",\"seeked\",\"seeking\",\"suspend\",\"volumechange\",\"waiting\"].forEach((e=>{window.addEventListener(e,(()=>{const e=document.getElementById(\"player\"),t=document.querySelector(\".plyr__time\");e.src.startsWith(\"https://i.imgur.com\")&&\"none\"===window.getComputedStyle(t).display&&(e.src=\"https://cdn.plyr.io/static/blank.mp4\",e.paused&&e.plyr.play())}))}));(self.__next_f=","/_0x|brave|onerror/","/  function [a-zA-Z]{1,2}\\([a-zA-Z]{1,2},[a-zA-Z]{1,2}\\).*?\\(\\)\\{return [a-zA-Z]{1,2}\\;\\}\\;return [a-zA-Z]{1,2}\\(\\)\\;\\}/","/\\}\\)\\;\\s+\\(function\\(\\)\\{var .*?\\)\\;\\}\\)\\(\\)\\;\\s+\\$\\(\\\"\\#reportChapte/","}); $(\"#reportChapte","kmtAdsData","navigator.userAgent","{height:370px;}","{height:70px;}","vid.vast","//vid.vast","checkAdBlock","pop","detectedAdblock","adWatched","setADBFlag","/(function reklamla\\([^)]+\\) {)/","$1rekgecyen(0);","BetterJsPop0","/h=decodeURIComponent|popundersPerIP|wpadmngr|popMagic/","'G-1B4LC0KT6C'); window.setTimeout(function(){blockPing()},200);","/wpadmngr|adserverDomain/","/account_ad_blocker|tmaAB/","frameset[rows=\"95,30,*\"]","rows","0,30,*","ads_block","localStorage.setItem","ad-controls",".bitmovinplayer-container.ad-controls","in_d4","hanime.tv","p","window.renderStoresWidgetsPluginList=","//window.renderStoresWidgetsPluginList=","Custom Advertising/AWLS/Video Reveal",".kw-ads-pagination-button:first-child,.kw-ads-pagination-button:first-child","1000","/Popunder|Banner/","PHPSESSID","return a.split","/popundersPerIP|adserverDomain|wpadmngr/","==\"]","lastClicked","9999999999999","ads-blocked","#adbd","AdBl","preroll_timer_current == 0 && preroll_player_called == false","/adblock|Cuba|noadb|popundersPerIP/i","/adserverDomain|ai_cookie/","/^var \\w+=\\[.+/","(()=>{let e=[];document.addEventListener(\"DOMContentLoaded\",(()=>{const t=document.querySelector(\"body script\").textContent.match(/\"] = '(.*?)'/g);if(!t)return;t.forEach((t=>{const r=t.replace(/.*'(.*?)'/,\"$1\");e.push(r)}));const r=document.querySelector('.dl_button[href*=\"preview\"]').href.split(\"?\")[1];e.includes(r)&&(e=e.filter((e=>e!==r)));document.querySelectorAll(\".dl_button[href]\").forEach((t=>{t.target=\"_blank\";let r=t.cloneNode(!0);r.href=t.href.replace(/\\?.*/,`?${e[0]}`),t.after(r);let o=t.cloneNode(!0);o.href=t.href.replace(/\\?.*/,`?${e[1]}`),t.after(o)}))}))})();","adblock_warning_pages_count","/adsBlocked|\"popundersPerIP\"/","/vastSource.*?,/","vastSource:'',","/window.location.href[^?]+this[^?]+;/","ab.php","godbayadblock","wpquads_adblocker_check","froc-blur","download-counter","/__adblocker|ccuid/","_x_popped","{}","/alert|brave|blocker/i","/function _.*JSON.*}}/gms","function checkName(){const a = document.querySelector(\".monsters .button_wrapper .button\");const b = document.querySelector(\"#nick\");const c = \"/?from_land=1&nick=\";a.addEventListener(\"click\", function () {document.location.href = c + b.value;}); } checkName();","/ai_|eval|Google/","/document.body.appendChild.*;/","/delete window|popundersPerIP|var FingerprintJS|adserverDomain|globalThis;break;case|ai_adb|adContainer/","/eval|adb/i","catcher","/setADBFlag|cRAds|\\;break\\;case|adManager|const popup/","/isAdBlockActive|WebAssembly/","videoPlayedNumber","welcome_message_1","videoList","freestar","/admiral/i","not-robot","self.loadPW","onload","/andbox|adBlock|data-zone|histats|contextmenu|ConsoleBan/","window.location.replace(urlRandom);","pum-32600","pum-44957","closePlayer","/banner/i","/window\\.location\\.replace\\([^)]+\\);?/g","superberb_disable","superberb_disable_date","destroyContent","advanced_ads_check_adblocker","'hidden'","/dismissAdBlock|533092QTEErr/","k3a9q","$now$%7C1","body","<div id=\"rpjMdOwCJNxQ\" style=\"display: none;\"></div>","/bait|adblock/i","!document.getElementById","document.getElementById","(()=>{document.querySelectorAll(`form:has(> input[value$=\".mp3\"])`).forEach(el=>{let url=el.querySelector(\"input\").getAttribute(\"value\");el.setAttribute(\"action\",url)})})();window.dataLayer =",",availableAds:[",",availableAds:[],noAds:[","justDetectAdblock","function OptanonWrapper() {}","/*start*/(()=>{const o={apply:(o,t,e)=>(\"ads\"===e[0]&&\"object\"==typeof t&&null!==t&&(t.ads=()=>{}),Reflect.apply(o,t,e))};window.Object.prototype.hasOwnProperty=new Proxy(window.Object.prototype.hasOwnProperty,o)})();document.currentScript.textContent=document.currentScript.textContent.replace(/\\/\\*start\\*\\/(.*)\\/\\*end\\*\\//g,\"\");/*end*/function OptanonWrapper() {}","decodeURIComponent","adblock_popup","MutationObserver","garb","skipAd","a[href^=\"https://toonhub4u.com/redirect/\"]","/window\\.location\\.href.*?;/","ad-gate","popupAdsUrl","nopopup","// window.location.href","playerUnlocked = false","playerUnlocked = true","/self.+ads.+;/","isWindows",":visible","jQuery.fn.center","window.addEventListener(\"load\",()=>{if (typeof load_3rdparties===\"function\"){load_3rdparties()}});jQuery.fn.center","Datafadace","/popunder/i","adConfig","enable_ad_block_detector","/FingerprintJS|Adcash/","/const ads/i","adinserter","AD_URL","/pirate/i","<img src='/n5dev.png' onerror=\"setTimeout(function(){if(typeof startWebSocket==='function'){startWebSocket();document.querySelectorAll('.liveupdates').forEach(el=>el.classList.remove('hidden'));const nl=document.getElementById('noliveupdates');if(nl)nl.classList.add('hidden');}window.showAdblockedMessage=()=>{};}, 2000);\">","student_id",".offsetLeft",":{content:","no:{content:","AdBlockChecker",".modal-content","data-adsbygoogle-status","done","document.body.innerHTML","/popunder|contextmenu/","\"hidden\"","/overlay/i","/aoAdBlockDetected/i","button[aria-label^=\"Voir une\"]","button[aria-label=\"Lancer la lecture\"]","function(error)",",\"ads\"","pdadsLastClosed","window.SCHEDULE.home","/^/gms","__INITIAL_STATE__","/$/gms","(()=>{const url=__INITIAL_STATE__.page.clickthroughPageData.url;if(url){window.location.href=url}})();","/offsetHeight|\\.test/","updateTime","piano","c-wiz[data-p] [data-query] a[target=\"_blank\"][role=\"link\"]","rlhc","/join\\(\\'\\'\\)/","/join\\(\\\"\\\"\\)/","api.dataunlocker.com","/^Function\\(\\\"/","adshield-analytics-uuid","/_fa_bGFzdF9iZmFfYXQ=$/","/_fa_dXVpZA==$/","/_fa_Y2FjaGVfaXNfYmxvY2tpbmdfYWNjZXB0YWJsZV9hZHM=$/","/_fa_Y2FjaGVfaXNfYmxvY2tpbmdfYWRz$/","/_fa_Y2FjaGVfYWRibG9ja19jaXJjdW12ZW50X3Njb3Jl$/","a[href^=\"https://www.linkedin.com/redir/redirect?url=http\"]","_ALGOLIA","when","scroll keydown","segmentDeviceId","body a[href^=\"/rebates/welcome?url=http\"]","a[href^=\"https://deeplink.musescore.com/redirect?to=http\"]","?to","/^rt_/","a[href^=\"/redirects/link-ad?redirectUrl=aHR0c\"]","?redirectUrl -base64","a[href^=\"//duckduckgo.com/l/?uddg=\"]","?uddg","a[href^=\"https://go.skimresources.com/\"][href*=\"&url=http\"]","a[href^=\"https://click.linksynergy.com/\"][href*=\"link?id=\"][href*=\"&murl=http\"]","?murl","a[href^=\"/vp/player/to/?u=http\"], a[href^=\"/vp/download/goto/?u=http\"]","?u","a[href^=\"https://drivevideo.xyz/link?link=http\"]","a[href^=\"https://click.linksynergy.com/deeplink?id=\"][href*=\"&murl=\"]","a[href*=\"?\"][href*=\"&url=http\"]","a[href*=\"?\"][href*=\"&u=http\"]","a[href^=\"https://app.adjust.com/\"][href*=\"?fallback=http\"]","?fallback","a[href^=\"https://go.redirectingat.com?url=http\"]","a[href^=\"/check.php?\"][href*=\"&url=http\"]","a[href^=\"https://click.linksynergy.com/deeplink?id=\"][href*=\"&murl=http\"]","a[href^=\"https://disq.us/url?url=\"][title^=\"http\"]","[title]","a[href^=\"https://disq.us/?url=http\"]","a[href^=\"https://steamcommunity.com/linkfilter/?url=http\"]","a[href^=\"https://steamcommunity.com/linkfilter/?u=http\"]","a[href^=\"https://colab.research.google.com/corgiredirector?site=http\"]","?site","a[href^=\"https://shop-links.co/link/?\"][href*=\"&url=http\"]","a[href^=\"https://redirect.viglink.com/?\"][href*=\"ourl=http\"]","?ourl","a[href^=\"http://www.jdoqocy.com/click-\"][href*=\"?URL=http\"]","?URL","a[href^=\"https://track.adtraction.com/t/t?\"][href*=\"&url=http\"]","a[href^=\"https://metager.org/partner/r?link=http\"]","a[href*=\"go.redirectingat.com\"][href*=\"url=http\"]","a[href^=\"https://slickdeals.net/?\"][href*=\"u2=http\"]","?u2","a[href^=\"https://online.adservicemedia.dk/\"][href*=\"deeplink=http\"]","?deeplink","a[href*=\".justwatch.com/a?\"][href*=\"&r=http\"]","?r","a[href^=\"https://clicks.trx-hub.com/\"][href*=\"bn5x.net\"]","?q?u","a[href^=\"https://shopping.yahoo.com/rdlw?\"][href*=\"gcReferrer=http\"]","?gcReferrer","body a[href*=\"?\"][href*=\"u=http\"]:is([href*=\".com/c/\"],[href*=\".io/c/\"],[href*=\".net/c/\"],[href*=\"?subId1=\"],[href^=\"https://affportal.bhphoto.com/dl/redventures/?\"])","body a[href*=\"?\"][href*=\"url=http\"]:is([href^=\"https://cc.\"][href*=\".com/v1/otc/\"],[href^=\"https://go.skimresources.com\"],[href^=\"https://go.redirectingat.com\"],[href^=\"https://invol.co/aff_m?\"],[href^=\"https://shop-links.co/link\"],[href^=\"https://track.effiliation.com/servlet/effi.redir?\"],[href^=\"https://atmedia.link/product?url=http\"],[href*=\".com/a.ashx?\"],[href^=\"https://www.\"][href*=\".com/t/\"],[href*=\".prsm1.com/r?\"],[href*=\".com/click-\"],[href*=\".net/click-\"],a[href*=\".com/t/t?a=\"],a[href*=\".dk/t/t?a=\"])","body a[href*=\"/Proxy.ashx?\"][href*=\"GR_URL=http\"]","?GR_URL","body a[href^=\"https://go.redirectingat.com/\"][href*=\"&url=http\"]","body a[href*=\"awin1.com/\"][href*=\".php?\"][href*=\"ued=http\"]","?ued","body a[href*=\"awin1.com/\"][href*=\".php?\"][href*=\"p=http\"]","?p","a.autolinker_link[href*=\".com/t/\"][href*=\"url=http\"]","body a[rel=\"sponsored nofollow\"][href^=\"https://fsx.i-run.fr/?\"][href*=\"redir=http\"]","?redir","body a[rel=\"sponsored nofollow\"][href*=\".tradeinn.com/ts/\"][href*=\"trg=http\"]","?trg","body a[href*=\".com/r.cfm?\"][href*=\"urllink=http\"]","?urllink","body a[href^=\"https://gate.sc\"][href*=\"?url=http\"]","body a[href^=\"https://spreaker.onelink.me/\"][href*=\"&af_web_dp=http\"]","?af_web_dp","body a[href^=\"/link.php?url=http\"]","body a[href^=\"/ExternalLinkRedirect?\"][href*=\"url=http\"]","realm.cookiesAndJavascript","kt_qparams","kt_referer","/^blaize_/","akaclientip","hive_geoloc","MicrosoftApplicationsTelemetryDeviceId","MicrosoftApplicationsTelemetryFirstLaunchTime","Geo","bitmovin_analytics_uuid","_boundless_tracking_id","/LithiumVisitor|ValueSurveyVisitorCount|VISITOR_BEACON/","kt_ips","/^(_pc|cX_)/","/_pcid|_pctx|amp_|cX|incap/","/amplitude|lastUtms|gaAccount|cX|_ls_ttl/","_cX_S","/^AMCVS?_/","/^(pe-|sndp-laneitem-impressions)/","disqus_unique","disqus.com","/_shopify_(y|sa_)/","_sharedid",".naszemiasto.pl","/ana_client_session_id|wshh_uid/","fly_vid","/fmscw_resp|intercom/","CBSNEWS.features.fms-params","/^(ev|vocuser)_/","gtagSessionId","uuid","/^_pubcid|sbgtvNonce|SUID/","/^uw-/","ajs_anonymous_id","/_HFID|mosb/","/ppid$/","/ph_phc|remark_lead/","remark_lead","/^ph_phc/","/incap_|s_fid/","/^_pubcid/","youbora.youboraDeviceUUID","anonymous_user_id","rdsTracking","bp-analytics","/^\\.(b|s|xp|ub\\.)id/","/^ig-|ph_phc_/","/^ph_phc_/","X-XAct-ID","/^fosp_|orig_aid/","/^recommendation_uuid/","optimizely-vuid","fw_se",".hpplus.jp","fw_uid","/^fw_/","dvid","marketingCloudVisitorID","PERSONAL_FLIGHT_emperiaResponse","device_id","kim-tracker-uid","/swym-|yotpo_/","/^boostSD/","/bitmovin_analytics_uuid|sbgtvNonce|SUID/","/sales-ninja|snj/","etx-settings","/__anon_id|browserId/","/_pk_id|hk01_annonymous_id/","ga_store_user_id","/^_pk_id./","/_sharedid|_lc2_fpi/","/_li_duid|_lc2_fpi/","/anonUserId|pid|sid/","/__ta_|_shopify_y/","_pkc","trk",".4game.com",".4game.ru","/fingerprint|trackingEvents/","/sstk_anonymous_id|htjs_anonymous_id/","/htjs_|stck_|statsig/","/mixpanel/","inudid",".investing.com","udid","smd","attribution_user_id",".typeform.com","ld:$anonUserId","/_user_id$/","vmidv1","csg_uid","uw-uid","RC_PLAYER_USER_ID","/sc_anonymous_id|sc_tracking_anonymous_id/","/sc_tracking_anonymous_id|statsig/","_shopify_y","/lc_anon_user_id|_constructorio_search_client_id/","/^_sp_id/","/builderVisitorId|snowplowOutQueue_cf/","bunsar_visitor_id","/__anon_id|efl-uuid/","_gal1","/articlesRead|previousPage/","IIElevenLabsDubbingResult","a[href*=\"https://www.chollometro.com/visit/\"][title^=\"https://\"]","a[href*=\"https://www.dealabs.com/visit/\"][title^=\"https://\"]","a[href*=\"https://www.hotukdeals.com/visit/\"][title^=\"https://\"]","a[href*=\"https://www.mydealz.de/visit/\"][title^=\"https://\"]","a[href*=\"https://nl.pepper.com/visit/\"][title^=\"https://\"]","a[href*=\"https://www.pepper.it/visit/\"][title^=\"https://\"]","a[href*=\"https://www.pepper.pl/visit/\"][title^=\"https://\"]","a[href*=\"https://www.pepper.ru/visit/\"][title^=\"https://\"]","a[href*=\"https://www.preisjaeger.at/visit/\"][title^=\"https://\"]","a[href*=\"https://www.promodescuentos.com/visit/\"][title^=\"https://\"]","a[href*=\"https://www.pelando.com.br/api/redirect?url=\"]","vglnk","ahoy_visitor","ahoy_visit","nxt_is_incognito","a[href^=\"https://cna.st/\"][data-offer-url^=\"https://\"]","[data-offer-url]","/_alooma/","a.btn[href^=\"https://zxro.com/u/?url=http\"]",".mirror.co.uk","/_vf|mantisid|pbjs_/","/_analytics|ppid/","/^DEVICEFP/","DEVICEFP","00000000000",".hoyoverse.com","DEVICEFP_SEED_ID","DEVICEFP_SEED_TIME",".hoyolab.com","/^_pk_/","_pc_private","/detect|FingerprintJS/","_vid_t","/^_vid_(lr|t)$/","/^(_tccl_|_scc_session|fpfid)/","/adthrive|ccuid|at_sticky_data|geo-location|OPTABLE_/","/previous/","/cnc_alien_invasion_code|pixelsLastFired/","/^avoinspector/","/^AMP_/","VR-INJECTOR-INSTANCES-MAP","/_shopify_y|yotpo_pixel/","a[href^=\"https://cts.businesswire.com/ct/CT?\"][href*=\"url=http\"]","/cX_P|_pc/","/^_cX_/","/RegExp\\(\\'/","RegExp","sendFakeRequest"];

const $scriptletArglists$ = /* 903 */ "0,0,1,2,3,4;1,0,5;1,0,6;0,0,7,8;0,0,9,10,3,4;1,0,11;2,12,13;2,14,15;2,16,17;2,18,19;3,20,21,22;3,23,21,24;3,25,21,26;0,0,27,28,3,4;0,0,29,30;0,0,31;0,0,32,33;1,0,34;1,0,35;1,0,36,37,38;0,0,39,40;4,41,42,43,44,45,46,47,48,49,50,51;2,52,53;2,54,55;2,56,57;0,0,58,59;5,60,61,62;6;0,0,63,64;0,0,65,66,67,68;7,69,4;8,70;9,70,71;0,0,72,73;1,0,74;10,75,76,77,76,78,79;0,0,80,81;0,0,82,83,3,4;1,0,84;0,0,85,86;1,0,36;1,0,87;1,0,88;1,0,89;1,0,90;1,0,91;1,0,92;1,0,93;7,94,4;1,0,95;7,96,97;7,98,4;1,0,99;0,0,100,101;0,0,102,103;8,104;1,0,105;1,0,106;1,0,107;11,108,109;1,0,110;0,0,111,76,67,112;1,0,113;1,0,114;8,115;1,0,116;1,0,117;0,0,118;1,0,119;1,0,120;0,0,121,122;0,0,123;0,0,124,125;0,0,126,127;1,0,128;0,0,129,130;1,0,131;7,132,4;7,133,4;7,134,4;1,0,135;1,0,136;9,137,71;12,138;0,0,139,140;0,0,141,142,67,143;0,0,144,145;0,0,146,147;0,0,148,149;1,0,150;0,0,151,76,67,152;0,0,153,81,154,4;0,0,155,156,154,4;0,0,157,81;0,0,158,159;1,0,160;1,0,161;0,0,162,159,67,163;0,0,164,76,67,165;0,0,166,4,67,167;0,0,168,169;0,0,170,171;13,172;1,0,173;0,0,174,175;0,0,176,177;1,0,178;10,179,180;0,0,181,77,67,182;0,0,183,159,67,182;0,0,184;2,185,186;0,0,187,159;0,0,188,189;0,0,190,191;0,0,192;1,0,193;1,0,194;0,0,195,159;1,0,196;0,0,197,198;0,0,199,200;1,0,201;0,0,202,203,3,204;1,0,205;1,0,206;0,0,207;0,0,208,81;0,0,209,76,67,210;0,0,139,211,154,4;1,0,212;2,213,214;1,0,215;0,0,216,217;1,0,218;1,0,219;7,220,4;0,221,222,223;1,0,224;1,0,225;1,0,226;0,0,227,228;0,0,170,229;1,0,230;12,231,232;12,233,76,234;1,0,235;0,0,236,237,67,238;0,0,239,240;0,0,241,242;0,0,243,244,67,245;0,0,246,189;0,0,247,189;1,0,248;0,0,249,159;12,250,158;0,0,251,76,67,252;0,0,253,254;7,255,4;0,0,256,257;1,0,258;0,0,259,189;0,0,260,189;1,0,261;0,0,262,159,67,238;0,0,263,264,67,238;0,0,265,266;0,0,267,268;0,0,269,270;1,0,271;0,0,272,273;0,0,274,81;0,0,40,142,67,275;0,0,276,189;0,0,277,81;1,0,278;1,0,279;0,0,280,281,282,283;1,0,284;1,0,285;0,0,286,189;0,0,287,200;1,0,288;0,0,289;0,0,290,291;0,0,151,76,67,292;0,0,222,223,67,293;0,0,294,76,67,295;0,0,296,81;0,0,297,298;1,0,299;1,0,300;0,0,301,159,67,302;0,0,303,159,67,304;1,0,305;0,0,306,81;0,0,307,159;1,0,308;0,0,309;0,0,222,223;0,0,310,81,154,4;0,0,311,81,154,4;0,0,312,159;0,0,313,314,67,315;0,0,316,317;0,0,318,319,67,320;1,0,321;1,0,157;0,0,81,189,67,322;1,0,323;1,0,324;1,0,325;1,0,326;1,0,327;1,0,328;1,0,329;1,0,330;2,213,331;0,0,332,333;1,0,334;1,0,335;0,0,336,337;1,0,338;1,0,339;0,0,340;1,0,341;1,0,342;1,0,343;1,0,344;1,0,345;1,0,346;1,0,347;1,348,349;1,0,350;1,0,351;1,0,352;0,0,353,354,3,4;7,355,81;1,0,356;0,0,357,358;0,0,359,360;0,0,361,362;0,0,359,363;0,0,359,364;0,0,365,366,3,4;0,0,367,368,3,4;0,0,369,370,67,356;1,0,371;1,0,372;1,0,373;1,0,374;1,0,375;1,0,376;1,0,377;1,0,378;1,0,379;1,0,380;1,0,381;1,0,382;1,0,383;1,0,384;1,0,385;1,0,386;1,0,387;1,0,388;0,0,389,390,67,391;0,0,392,393;0,0,394,395;12,396,76,397;1,0,398;1,0,399;1,0,400;1,0,401;1,0,402;1,0,403;1,0,404;13,405,406;1,0,407;1,0,408;1,0,409;4,410,180;0,0,411,412;1,0,413;0,0,414,415,3,4;0,0,416,417;7,418,204;0,0,419,420,67,421;0,0,422,423;0,0,424,425;0,0,426,427,3,4;0,0,428;0,0,429,430;1,0,431;1,0,432;1,0,433;0,0,434,435;13,436;1,0,437;7,438,4;0,0,439;1,0,440;9,441,189;1,0,442;1,0,443;1,0,444;10,445,446,76,76,78,447;1,0,448;8,353;0,0,449,393,67,450;8,451;9,451,71;7,452,4;0,0,453,337;1,348,454;1,0,455;0,0,456,457,3,4;0,0,456,458,3,4;0,0,456,459,3,4;1,0,460;0,0,461,200;1,0,462;11,463,464;0,348,465,466;13,467,468,154;13,469,470,154;7,471,4;13,472;8,355;1,0,473;13,474,475,154;1,0,476;1,0,477;0,0,478,479;13,480,481;13,480,482;1,0,483;1,0,484;1,0,485;7,484,4;14,486;2,213,487;1,0,488;0,0,489,490,67,491;1,0,492;8;1,0,493;7,494,4;1,0,495;1,0,496;7,497,97;1,0,498;1,0,499;1,0,500;1,0,501;8,502;9,502,71;5,503,61,504;7,220,505,76,506,4;10,507,508;0,348,509,510,67,511;1,0,512;1,0,513;1,0,514;1,0,515;1,0,516;13,517;0,0,518,519;13,520,521;9,522,189;7,523,4;11,524,525;1,0,526;8,527;7,528,4;7,529,189;1,0,530;1,348,531;13,532,76,154;1,0,533;15;1,0,157,67,120;1,0,534;1,0,535;1,0,536;0,0,537,538;1,0,539;1,0,540;7,402,541;8,542;1,0,543;1,0,544;1,545,546;1,545,547;1,545,548;1,545,549;1,545,550;1,545,551;1,545,552;1,0,553;1,545,554;0,0,555;12,556;1,0,557;0,0,558,559,3,4;0,0,560,81;12,561;0,0,562,563,67,564;11,565,566;11,567,525;1,0,568;1,0,569;1,0,570;1,0,571;1,0,572;1,0,573;1,0,574;1,0,575;1,0,295;7,576,4;1,0,577;1,0,578;1,0,579;1,0,580;0,0,581,582,67,583;9,584,204;0,0,585,76,67,586;5,587,61,588;1,0,589;13,590,591;1,0,592;1,0,593;11,594,525;0,0,595,596,67,597;7,598,4,76,506,4;1,0,599;1,0,600;1,0,601;1,0,602;1,0,603;1,0,604;1,0,605;1,0,606;1,0,607;8,608;1,0,609;1,0,610;1,0,611;1,0,612;0,0,613,200;0,614,615;1,0,616;1,0,617;1,0,618;0,0,619,620;1,0,621;6,622;9,623,189;1,0,624;1,0,625;1,0,626;1,0,627;0,0,628,629;12,630;13,631,632;1,0,633;12,634;1,0,635;0,0,636,637;0,0,638,639;1,0,640;1,0,641;0,0,642,643;0,0,644,645;0,0,646,200;7,647,4;7,648,4;1,0,649;7,650,189,76,506,4;0,0,484,76,67,484,154,4;8,651;0,0,652,393;0,0,653,200;0,0,654;7,402,159;1,0,655;1,0,656;1,0,657;0,0,658,659,3,4;1,0,660;1,0,661;1,0,662;1,0,663;1,0,664;7,665,4;1,0,666;7,667,4;1,0,668;7,669,4;10,670,671;1,0,672;0,0,673,674;1,0,675;1,0,676;1,0,677;1,0,678;16,679,71;5,680,61,681;7,484,97;1,0,682;1,0,683;0,0,684,189;0,0,685,393;1,0,686;0,0,687,76,67,640;1,0,688;1,0,689;1,0,690;16,691,189;0,0,692,693;0,0,694,695;7,696,4;7,697,4;1,0,698;0,0,699,700;9,701,71;0,0,702,703;7,704,4,76,506,4;0,0,705;1,706,707;0,0,708,81;1,0,709;7,710,4,76,506,4;0,0,711,76,67,712;0,0,713,714;1,0,715;1,0,716;16,717,189;1,0,718;1,0,719;9,720,81;1,0,721;0,0,722,723,67,724;1,0,725;1,0,726;1,0,727;3,728,21,26;7,729,4;1,0,730;10,731,180;1,0,732;1,0,733;0,0,359,734,3,4;1,0,735;0,0,736,737,3,4;1,0,738;0,0,739;0,0,740,741;1,0,742;1,0,743;0,348,744,745;0,0,746,747;1,0,748;7,749,4;1,0,750;9,751,189;1,0,752;0,0,753,754;7,755,4;1,0,756;0,0,7,757;1,0,758;1,0,759;3,760,761,762;1,0,763;1,0,764;13,765,766;10,767,4,76,76,78,768;0,0,484,769;0,0,770,771,67,772;12,773,76,774;1,0,775;8,776;1,0,777;1,0,778;1,0,779;10,780,781;1,0,782;1,0,783;1,0,784;0,0,785,189;1,0,786;1,0,787;0,0,788,789,3,4;9,790,71;1,0,791;0,0,792,793;0,0,794;1,0,795;17,796,796;1,0,797;13,798,76,154;7,799,4;8,800;1,0,355;16,801,802;1,0,803;0,0,804,805;1,0,806;0,0,807;1,0,808;1,0,809;1,0,810;1,0,811;1,0,812;8,813;10,814,189,76,76,506,4;1,0,815;1,0,816;1,0,817;7,818,189;1,0,819;1,0,820;1,0,821;0,0,822,76;7,823,189;7,824,189;1,0,825;1,0,826;1,0,252;0,0,827;9,828,4;4,829,180;1,0,830;1,0,831;1,0,832;1,0,833;10,834,835;2,836,837;1,0,838;1,0,38;0,0,839,840;0,0,359,841,3,4;0,0,842,843,3,4;1,0,844;0,0,845,846;1,0,847;1,0,848;1,0,849;7,850,4;7,851,4,76,506,4;11,852,464;0,0,853;1,0,854;0,0,855,856;0,0,280,857;0,0,858,859;0,0,860;1,0,861;1,0,862;0,0,863,864;1,0,865;1,0,866;1,0,867;1,0,868;1,0,869;1,0,870;1,545,871;1,0,872;1,0,873;1,0,227;2,836,874;9,875,71;1,0,876;0,0,877,878;1,0,879;1,348,880;3,728,881,882;2,728,185;1,0,883;1,0,884;1,0,885;1,0,886;1,0,887;12,888;12,889;1,0,890;0,0,891;4,892,180;1,0,893;1,0,894,37,895;0,0,896,897,67,895;1,0,898;18,899,180;1,0,900;5,901,902,4;1,0,903;1,0,904;1,0,905;1,0,906;9,907,71;9,908,71;9,909,71;9,910,71;9,911,71;9,912,71;11,913,525;8,914,915,916;9,917,71;11,918,525;11,919,920;9,921,71;11,922,923;11,924,925;11,926,525;11,927,928;11,929,930;11,931,109;11,932,928;11,933,525;11,934,930;11,935,936;11,937,525;11,938,525;11,939,928;11,940,941;11,942,525;11,943,525;11,944,930;11,945,946;11,947,525;11,948,949;11,950,951;11,952,525;11,953,109;11,954,525;11,955,956;11,957,958;11,959,960;11,961,962;11,963,964;11,965,930;11,966,525;11,967,968;11,969,525;11,970,971;11,972,973;11,974,525;11,975,976;11,977,978;11,979,980;11,981,525;11,982,983;11,984,525;11,985,525;8,986;8,987;8,988;8,989,915,916;8,990;8,991;8,992,915,916;8,993;10,992,76,77;7,994,505;7,995,505;8,996;8,997;8,998;8,999,915,916;8,1000,915,916;9,1001,71;16,1002,71;8,1003;9,1004,71;8,1005,915,916;10,1005,77,76,76,78,1006;8,1007,915,916;10,1008,76,77,76,78,1009;8,1010;8,1011,915,916;9,1012,71;16,1013,71;8,1014,915,916;8,1015;9,1016,71;8,1017;9,1018,71;8,1019,915,916;8,1020;8,1021;8,1022,915,916;9,1023,71;16,1024,71;8,1025,915,916;8,1026,915,916;9,1027,71;8,1028;8,1029,915,916;9,1030,71;8,1031,915,916;8,1032,915,916;9,1033,71;16,1033,71;8,1034;8,1035;9,1035,71;9,1036,71;9,1037,71;10,1038,76,77,76,78,1039;10,1040,76,77,76,78,1039;9,1041,71;8,1042,915,916;9,1043,71;9,1044,71;8,1045;8,1046;8,1047,915,916;9,1048,71;8,1049,915,916;9,1050,71;9,1051,71;9,1052,71;8,1053,915,916;8,1054;8,1055,915,916;8,1056;9,1057,71;8,1058;8,1059,915,916;8,1060,915,916;10,1061,76,77,76,78,1062;10,1061,76,77,76,78,1063;9,1064,71;8,1065,915,916;9,1066,71;9,1067,71;10,1068,76,77,76,78,1069;10,1070,76,77,76,78,1069;10,1071,76,77,76,78,1069;10,1072,76,77,76,78,1073;9,1074,71;9,1075,71;8,1076;9,1077,71;9,1078,71;9,1079,71;8,1080,915,916;9,1081,71;8,1082,915,916;9,1083,71;8,1084,915,916;9,1085,71;8,1086,915,916;9,1087,71;9,1088,71;8,1089;9,1090,71;11,1091,941;11,1092,941;11,1093,941;11,1094,941;11,1095,941;11,1096,941;11,1097,941;11,1098,941;11,1099,941;11,1100,941;11,1101,525;1,0,1102;8,1103;8,1104;16,1105,81;11,1106,1107;8,1108;11,1109,525;10,1008,76,77,76,78,1110;8,1111;9,1112,71;8,1113;10,1114,1115,76,76,78,1116;10,1117,76,77,76,78,1116;10,1118,76,77,76,78,1116;10,1114,1115,76,76,78,1119;10,1117,76,77,76,78,1119;10,1118,76,77,76,78,1119;8,1120;8,1121;1,0,1122;8,1123;9,1124,71;8,1125;9,1126,71;16,1127,71;9,1128,71;9,1129,71;8,1130;16,1131,71;8,1132,915,916;11,1133,525;8,1134;9,1135,71;1,0,1136,67,1137;1,0,1138";

const $scriptletArglistRefs$ = /* 6675 */ "222;222;103;214;46;238;214;21,517;699,700,701,702,703,704;214;40,214;214;455;235;329;238,257,699,700,701,702,703,704;263;264;869,870;214,534;222,264;40;40;491;214;238,699,700,701,702,703,704;226;238;235;222;141,206;44,206,214;235,251;40;238,256;214;82;214;140,141;238;238,699,700,701,702,703,704;222;46;38;45;40,214;238;238;375;249;222;238;238;238,257,699,700,701,702,703,704;222;235,263;214;699,700,701,702,703,704;39;238,699,700,701,702,703,704;263;210;263;214;269;238,258;264;214;206;338;103;222;206;238;84;71,210;222;214;214;247;699,700,701,702,703,704;71,210;235;402;206;214;540;122;214;214;237,238;238,699,700,701,702,703,704;214;754;760;238;621;695;214;40;547;715;222;819;214,294;214;238,699,700,701,702,703,704;238,699,700,701,702,703,704;238,699,700,701,702,703,704;214;2;222;222;222;210,238,257,699,700,701,702,703,704;235,255;235;238;222,426;831,832;523;258;222;238;697;238;247;210;238;238;4,708,760;327;238,699,700,701,702,703,704;214;487;263;263;740,741;263;387;214;902;222,264;237,238;257;238;620;58;40;40;235;188;238;341;214;455;222;210;237,238;238;854;238;238,699,700,701,702,703,704;238;238;214;529;529;822;247;227;214;214;214;238;269;238;238;222;785,786;430;238,699,700,701,702,703,704;235;212;238;600;814;214;255;238,699,700,701,702,703,704;711;225;238;216;665;787;214;214;238;238;237,238;214;29;214,222;214;214;238,257;225;214;214;237,238;797;214;238;238;547;214;214;205,206;214;334;73,210;214;214,294;214;216;699,700,701,702,703,704;214;235;237,238;649;58,214;353;238,699,700,701,702,703,704;222;214;214;40,58,222;238;52;58,214,222;214;214;214;235;238;238,699,700,701,702,703,704;238;235;818;40;214,225;214;214;214;238;214;238;623;623;214;522;269;830,832;214;214;238;263;214,222;214;214,222,224;214;222;269;214,225;699,700,701,702,703,704;214;263;214;214;493;251,699,700,701,702,703,704;238,699,700,701,702,703,704;214;238;263;238;238,699,700,701,702,703,704;125,126;614;370;715;238;715;263;214;214;238;214;263;767;262;238;214,222;214,643;754;206;455;269;387;264;264;214;238;214;214;238,699,700,701,702,703,704;264;264;214;264;255;238;214,222;96,214;446;222;222;214;214;123;131;272;237,238;715;5;222;115,116,117,118;214;214;222;509;238;222;160;699,700,701,702,703,704;229;144,145;214;214;96;305;238;699,700,701,702,703,704;84;238;238;238;238;576;214;800,801,802;222;433;214;214;238;56;808,809,810;821;214,222;233;238,699,700,701,702,703,704;238;214;238;235,311;238,699,700,701,702,703,704;598;436;315;238;238;214;214;214;270;33;480,481,482,483,484;214;40,58;235;247;313;767;699,700,701,702,703,704;91;269;225;699,700,701,702,703,704;238,699,700,701,702,703,704;699,700,701,702,703,704;686;257;247,699,700,701,702,703,704;871;210;502;214;238;214;238,699,700,701,702,703,704;40,214;214;214;664;235;238;238;238;144,145;699,700,701,702,703,704;238;598;609;40;214,225;214;40;238;40;214;238;214;874;238,699,700,701,702,703,704;862;863;864;699,700,701,702,703,704;269;222;49;214;123;214;214;238;238;214;204;404;123;123;167,168,169;214;214;273;871;214;477,478,479;111;455;372;206;214;214;374;47;283;714,740,741,742,744,745;210;659;225,440;440;214,294;123;238;238;85,86;214,222;214;214,338,418;214;123;123;238;214;214;214;238,699,700,701,702,703,704;238;214;214;40,222;264;214;214;123;238;894;609;183,184,186,187;238;123;123;210;238;124;235;238,699,700,701,702,703,704;492;568;338;119;177;330;477,478,479;716;214;214;699,700,701,702,703,704;144,145;222;214;214;89;740,741,742;384,385;214;214;238;238;263;263;238;214;263;40;214;263;238,699,700,701,702,703,704;214;96;214;222;331;269;164,165;263;222;263;337;77,78,79;222;214;214,270,485;217;263;238;264;238;263;263;214;206;214;238;142;222;275;263;123;123;321;222;214,222;263;430;263;238;263;207;263;263;633;214;135;214;262;263;214;249;238;238;609;303;263;238;238;238;269;238;222;754;263;238;264;238,699,700,701,702,703,704;71,210;214;565;132;724,725,774,775;167,168,169;254,257;225;234,262;123;238;396;47;440;663;69;893;238;301,302;131;131;214;238;160;763;630,631;222;60;214;231;573;238,699,700,701,702,703,704;238;269;440;222;214;471;553;214;527;283;47,463,464;222;222;214;262;69;235;214;852,853;222;210;214;715;477,478,479;238,699,700,701,702,703,704;238;206;238;799;85,86;222;399;238;261;238;222;615;222;214;235;238;382;222;214;238,699,700,701,702,703,704;222;214;214;238;840;740,741;214;238;238;238;269;445;214;214;282;240,699,700,701,702,703,704;699,700,701,702,703,704;699,700,701,702,703,704;238,699,700,701,702,703,704;238,699,700,701,702,703,704;214;214;214;214;214;96;238,699,700,701,702,703,704;238,699,700,701,702,703,704;238,699,700,701,702,703,704;160;218;214,233;167,168,169;270;214;96;214;222;815;815;214;104,105,106,107;69;214;272;222;237,238;369;238;238;417;214;235;629;214;238;58;477,478,479;609;258;238,699,700,701,702,703,704;222;96;214;214;62;267;238;238;235;431;683,684;379;67,379;860;132;206;699,700,701,702,703,704;225;238;238;390;238;253,254;210;604;214;544;214;235;339;96;222;35;222;62;238;235;238,699,700,701,702,703,704;146;40;214;214;238;238,699,700,701,702,703,704;269;720;214,222;262;96;96;2;96,135;269;214;214;238;206;214;214;83,84;238;699,700,701,702,703,704;214;369;444;214;222;235;898;222;238,699,700,701,702,703,704;238;238;575;255;238;68;214,225;214,222;214;214;135;214;214;229;47;235;283;153,154,155,214;44;346;43;74;40;214,294;673;214,294;127;238;214;214;85,86;56;214,534;225;238;235;238;222;247,699,700,701,702,703,704;238,699,700,701,702,703,704;503;222;462;214;214;235;214;251,699,700,701,702,703,704;225,336;214;214;123;40;96;214;715;206;214;264;214,222;238,699,700,701,702,703,704;238,699,700,701,702,703,704;238;264;235;238;369;182;252;222;214;235;496,497;214;447;238;477,478,479;477,478,479;477,478,479;477,478,479;238;214;214;269;214;715;344;238,699,700,701,702,703,704;237,238;214;214;238,699,700,701,702,703,704;222;553;237,238;214;238;206,222;222;263;238,699,700,701,702,703,704;263;238;238,699,700,701,702,703,704;238;189,190;238;263;263;458;25,42;559,895,896;590;238;263;96;263;263;263;80;40;651;214;214;238,699,700,701,702,703,704;235;214;40;214;222;214;263;238,699,700,701,702,703,704;262;419;235;320;233;238;214;263;214;214;62;699,700,701,702,703,704;229;263;47;263;133;263;235;235;214;263;263;263;58;263;124;263;263;214;238;341;263;263;235,779,780,781;263;263;263;210;871;238;238;238;593;263;263;214;263;871;214;126;263;235;238,699,700,701,702,703,704;222;699,700,701,702,703,704;263;214;263;214,222,534;37,238,699,700,701,702,703,704;123;238;214;858;235;214;322;214;238;214;133,135;214;96;699,700,701,702,703,704,752;235;238,699,700,701,702,703,704;238;214;42;238,247,699,700,701,702,703,704;264;238;238;214;640;699,700,701,702,703,704;609;465;214;897;214;42;237,238;222;306;237,238;50,51;871;295;214;238;214;216,225,636;206,574;222;214;267;40;40;238;639;699,700,701,702,703,704;238;238;237,238;214;214;214;238;238;238;247;214;257;587;238;238;192;214;605;144,145;844;498;238,699,700,701,702,703,704;238;214;238;238;214;58,214;428;609;882,883,884;222;40;638;214;238,699,700,701,702,703,704;138;238;181;214;238;269;270;214;269;269;214;699,700,701,702,703,704;278;238;309,310;131;249;237,238;214;251,699,700,701,702,703,704;902;238;238;647;96;238;214;238,699,700,701,702,703,704;80;238,699,700,701,702,703,704;269;238,699,700,701,702,703,704;235;214;238;212;820;234,262;214;214;214;440;716;214;440;238;317;214;214;238;270;386;238;238,699,700,701,702,703,704;414;871;214;214;222;337;214;733;96;96;238;214;40;214;222;206;214;214;214,225;222;504;214;214;379;238,699,700,701,702,703,704;238;238;609;214;714,740,741,744,745;214;214;562;699,700,701,702,703,704;235;390;40;214;577;214;214;214;238;43;14,15,16,17;238;214;222;214;238;214;19,20,228;238;237,238;214;291;238,699,700,701,702,703,704;235,757;440;238,699,700,701,702,703,704;235;214;235;687;214;214;238;214;796;222;214;716;580;222;222;740,741;238,699,700,701,702,703,704;323,324;214;238;214;91;214;5;136;183,184;225;225;214;47;238;225,611;214;238,699,700,701,702,703,704;132;222;214;214;214;101;516;214;214;238;214;214;238;235;222;214;147,148,149,150,151,152;214,225;214;609;225;541;214;673;673;40;214,222;206,214;64;238;238;72;214;238;699,700,701,702,703,704;347,348;262;238;210,211;238;754;238;238;225;237,238;461;132;48;5;214;40,206,537;212;238;238;238;669;238;722;214;238;238,699,700,701,702,703,704;214;40,58;-41;214;237,238;191;222;213;214;440;238,699,700,701,702,703,704;457;258;63,235,738;222;214;222;214;389;214;40;249;238;238;238;439;699,700,701,702,703,704;609;235;440;661;417;214;553;359,360,361,362,363;270,645;238;238;488;477,478,479;477,478,479;477,478,479;477,478,479;477,478,479;477,478,479;477,478,479;477,478,479;477,478,479;477,478,479;477,478,479;477,478,479;613;530,531;87;222;-41;214;238;238,699,700,701,702,703,704;238,699,700,701,702,703,704;206;263;263;214;263;263;238;263;263;263;238;263;238,699,700,701,702,703,704;214;238;263;238;238;238;238;40,222;336;214;238;263;238;263;42;773;238;214;263;263;257;263;214,609;214;238;263;235;235;214;263;263;263;263;263;238,699,700,701,702,703,704;678;214;214;214,294;123;222;440;133,135;333;183,184,185,186,187;235;263;263;214;263;263;263;143;238;263;238,699,700,701,702,703,704;263;263;214;238;112;263;699,700,701,702,703,704;238;263;263;263;436;263;263;214;263;263;263;263;263;263;147,148,149,150,151,152;214;214;27;263;699,700,701,702,703,704;263;270;214;261;135;263;62;263;235,263;214;345;609;263;871;699,700,701,702,703,704;262;238;263;609;263;807;609;261;238;238;263;238,699,700,701,702,703,704;238,699,700,701,702,703,704;-41,-610,-903;263;238;263;263;261;472;238;263;117;263;263;653;263;238;263;138;237,238,263;263;263;222;222;609;263;238;214;263;263;238;238;238;440;235;235;212;214;235,255;237,238;222;214;518,519;238;206;238,699,700,701,702,703,704;214;264;671;81;235;609;170,171,172;264;60;606;454;699,700,701,702,703,704;214;40,56;739;440;214;239,699,700,701,702,703,704;238,699,700,701,702,703,704;160;257;131;96;238;758,759;377;237,238;261;214;567;341;238;238;40;283;214,222;222;214;214;222;238;222;222;238;144,145;214;237,238;336;456;214;283;212;238;598;214;237,238;238,699,700,701,702,703,704;238;563;238;27;222;715;238,699,700,701,702,703,704;66;238;238;235;238;411;238,699,700,701,702,703,704;557;222;440;269;214;214;270;383;40;214;97,98,99,100;132;214;214;238;850,851;238;237,238;434;238;609;474,475;238;238;214;440;43;238,699,700,701,702,703,704;238;238,699,700,701,702,703,704;214;214;62,214;438;238;214;238;112,113,114;214;238;214;408;238;214;269;214;238,699,700,701,702,703,704;654;637;238;238;238;214,222;435;308;214;238,699,700,701,702,703,704;238,699,700,701,702,703,704;214,225;238;238;238;27,214;214;238;595;232;705;214;622;238,699,700,701,702,703,704;237,238;238;214;238;238;235;350;128;493;716;214;133,135;238;235;238,699,700,701,702,703,704;238;202;30;214;238;96;238;214;875,876,877;699,700,701,702,703,704;214;238;222;238;238;235;609;685;635;225;669;528;238;238;237,238;144,145;214;238;206;222;222;214;214;222;855;238;238;222;848,849;238;88;238,699,700,701,702,703,704;238;58;238;238,699,700,701,702,703,704;238,253,254,257;238;238;214;238,699,700,701,702,703,704;538;238,699,700,701,702,703,704;214;27;238,699,700,701,702,703,704;261;214;222;235;823;238,248;741;214;515;34;402;238;235;340;238;238;222;238;269;214;214;402;214;716;716;214;214;440;238,699,700,701,702,703,704;238,699,700,701,702,703,704;238;699,700,701,702,703,704;247;214;92,93,94;238;238;238;238;238;238;238;238;663;238;214;238;253,254;238,699,700,701,702,703,704;222;235;554;237,238;238;222;214;258;598;598;598;238;238;238;695;238;238;238;235;238,699,700,701,702,703,704;214;214;214;235,740;214,767;147,148,149,150,151,152;235;123;238,699,700,701,702,703,704;238;675;96;237,238;261;467;716;210;440;235;584;371;222;751;238;238;267;225;214;214;612;214,225,294,541;262;130;214;235;238,699,700,701,702,703,704;216;216;238;214,225,294,541;422;132;238;147,148,149,150,151,152;452;381;803;238;886;47;757,842,843;237,238;650;214;214;214;238;238;827;457;462;462;462;267;222;222;214;229;214;247;238;238;238;214;237,238;318;214;237,238;214;238;43;238,699,700,701,702,703,704;238;682;214;225;206;222;214;5;214,222,534;222;238;238;767;238;672;212;144,145;238,699,700,701,702,703,704;214;694;216;238;477,478,479;477,478,479;477,478,479;477,478,479;477,478,479;477,478,479;477,478,479;477,478,479;477,478,479;477,478,479;477,478,479;477,478,479;477,478,479;477,478,479;477,478,479;477,478,479;692;238;238;716;716;214;91,200,201;238;716;680;356;214;390;238;238,699,700,701,702,703,704;214;55;238;222;238;263;214;222;214;222;238;238;214;238;263;235,236;263;263;238;238;263;238;214;40;238;214;784;59;238;609;91,200,201,202;263;263;235;697;263;263;263;238;214;214,294;263;294,541;214;263;134;263;214;238;263;263;263;263;263;263;214;269;512;214;56;263;96;476;96;263;263;263;365;263;263;321;263;263;238;238;238;235;263;263;263;238,257,699,700,701,702,703,704;214;263;238;263;588;699,700,701,702,703,704;263;263;263;263;238;341;263;238;206;263;214;238;238;367;263;235;238;263;270;263;214;235;263;263;380;695;124;263;263;238;263;871;270;135;765;263;263;263;263;263;43,368;235;806;238;214;263;263;263;263;263;689,690;238;238;263;263;542;96;214;263;288,289;609;238;263;263;263;263;235,618;132;263;238,699,700,701,702,703,704;263;513;263;238;238;263;263;263;251,699,700,701,702,703,704;238,699,700,701,702,703,704;263;263;235;58,222;238;238;378;421;124,214;214;238;757;212;263;263;214;238;263;263;263;40;699,700,701,702,703,704;238;124;754;263;263;238;238;136;214,222;871;214;790,791,792;238,699,700,701,702,703,704;214;238;518;518;238;238;264;96;214;237,238;500;270;609;261;257;238;238;856;96;437;175;455;214;270;133,161,162,163;238;699,700,701,702,703,704;238;238;238,699,700,701,702,703,704;131;592;222;40;210;214;320;269;214;632;699,700,701,702,703,704;214;214;238;238;596;214;238;238;238;238;238;332;214;214;440;558;214;609;174;326;696;194,195,196,197,198,199;214;214;657;238;238;251,699,700,701,702,703,704;238;238;238,699,700,701,702,703,704;238;238;238;498;564;214;238;238;238,699,700,701,702,703,704;238;238,257;132;238,699,700,701,702,703,704;222;697;269;274;269;43;214;352;214;238;238;245,699,700,701,702,703,704;214;879,880,881;238;238;337;235;222;238;238;235;203;238,699,700,701,702,703,704;836,837,838;364;238;214;899,900;214;269;238;214;393;112,113,114;104,105,106,107;249;238,699,700,701,702,703,704;737;238;238;558;261;410;238,699,700,701,702,703,704;238,699,700,701,702,703,704;238,699,700,701,702,703,704;214;238,699,700,701,702,703,704;238,247;214;238;238,699,700,701,702,703,704;214;246,699,700,701,702,703,704;270;135;110,111;47;222;238,699,700,701,702,703,704;754;238;312;871;249;238;96;238,699,700,701,702,703,704;855;238,699,700,701,702,703,704;235;660;716;124;237,238;214;214;214;235;43;96;43,96;760,762;206;214;214;214;40;635;835;741;235;238;699,700,701,702,703,704;238;214;656;41,210;214;214;214;214;238;214;214;709,710;238;238;222;237,238;262;214;214;214;214;235;257;238;238;238;754;443;214;398;369;369;861;238,699,700,701,702,703,704;214,294;210;238,699,700,701,702,703,704;214;429;235;222;229;214;238;257;234,262;238;776;214;238;716;238;617;238;214;214;510,511;238,699,700,701,702,703,704;214;215;238;214;238;214;872;383;238;238;646;221;221;214,570;214;214;214;214;214;142;871;250,699,700,701,702,703,704;868;238,699,700,701,702,703,704;237,238;235;214;6,7,8,9,10,11,12,13;238;235;40,537;123;238;238;238;238;238;238;579;366;238,699,700,701,702,703,704;40,314;238;599;212;238;261;214;238;214;214;238,699,700,701,702,703,704;238;238,699,700,701,702,703,704;222;238;238;261;238;206;238;279;238;214,270;214;110,137;214;214;214;214;247;222;270;271;816,817;335;214,225;214;160;257;214;214;238;235;238;5;214;214,225;214;255;238;214,225,716;238;238;214;222;699,700,701,702,703,704;214;238;238;203;713;238;225;225;225;716;716;214;541;69,214;222;585;40;238;793;238;214;667;222;214,294;96;657;742;386;238;741;255;238;212;214;238;235;871;238;214;238;514;214;206;214;208;413;462;462;214;267;96;270;262;238;124;96;238;212;238;238;462;462;214;238,699,700,701,702,703,704;222;238;237,238;214;214;477,478,479;225,336;403;229;214;238;40;222;222;609;212;214;804,805;871;238;297,298;873;214;238,699,700,701,702,703,704;238;214;760,761;40;206;238;247;212;214;238;609;235,778;214;632;316,317;238;269;238;477,478,479;477,478,479;477,478,479;477,478,479;477,478,479;477,478,479;477,478,479;716;214;214;716;214;238;902;238;238;238;214;238;238;263;214;549;263;829;263;263;238;263;25,42;238;263;263;276;238;238;263;263;238;238;263;263;821;214;216;238,699,700,701,702,703,704;609;238,699,700,701,702,703,704;263;238;263;263;222;825,826;263;263;96,130;214,225;263;263;263;263;263;214;214;206;214;214;238;238;238;263;263;136;263;53,54;257;263;238;238;238;263;263;238;263;263;214;261;263;263;238;263;203;136;263;263;238;96;263;263;27,351;269;214;263;263;263;263;263;237,238,263;263;238;238;210;263;263;235,263,798;263;609;263;263;263;124;609;238;238;238;263;263;263;263;234,262;238;695;263;263;238;263;263;89;263;263;263;235,263;263;263;263;238,699,700,701,702,703,704;263;216;238;263;212;206,214;58,222;238;238;238;263;263;263;263;263;695;263;263;263;263;349;269;263;40,58,609;263;214;238;40,58;609;214;263;214;238;214;214;263;263;528;263;238;238;871;871;212;235;238,699,700,701,702,703,704;238;27;871;871;354,355;354,355;212;214;238;238;261;214;251,699,700,701,702,703,704;238;36;247,699,700,701,702,703,704;238;238;235;721;40,314;40,58,214,222,314;237,238;406;267;238;238;238;214;214;40;238;238;40;238;238;238;222;214,225;235;238;283;27,551,552;238;238;238;104,105,106,107;238;214;395;194,195,196,197,198,199;238;238;238;214;132;238;214;237,238;238;96;214;206;225;238;238;238;238;214;554;238;47;214;237,238;548;214;561;214,294;136;238;238;238;609;283;235;40;699,700,701,702,703,704;238;214,225;238;238;167,168,169;238;97,98,99,100;238;283;214,222;214;214;85,209;269;220;214;43;43;222;222;214,222;238;238;238;214;238;859;238;214,222;214;238;238;279;166;714,740,741,744,745,749;238;292;587;251,699,700,701,702,703,704;237,238;679;238,699,700,701,702,703,704;214;238,699,700,701,702,703,704;267;225;216;238;238;61;699,700,701,702,703,704;534;238;214,485,486;238;238,699,700,701,702,703,704;238;609;238;588;238;238;223;238,699,700,701,702,703,704;238;251,699,700,701,702,703,704;238;262;237,238;737;783;238;88;885;320;235;293;238;206,214;244;582;238;238;210;43;164,165;238;811,812,813;219;222;662;238;229;176;238;238;214;238;238;214;238;238,699,700,701,702,703,704;214;249;235;238,699,700,701,702,703,704;440;222;120;841;214;261;405;214;238;238,699,700,701,702,703,704;235,777;214;238;238,699,700,701,702,703,704;238,699,700,701,702,703,704;238;238;754;261;238;238;695;717,718,719;238;238;214,325;871;237,238;238;494;235;214;871;238;716;716;290;237,238;468;214;237,238;867;214;238;237,238;237,238;214;238;40;266;237,238;214;212;214;681;466;214;609;865;238;214;214;238;238;214;534,537;238;261;238;238;238;871;238,257;516;608;214;214;214;235;214;96;225;214;238;238;132;27;214;235;871;261;668;222;767;214;388;871;237,238;212;225;96;43;238;238;259;666;214;238;734,735;255;214;214,222;214;238;235;356;750,846,847;222;238;238;71;238;534;238;238;238;238;238;214;238;655;214;225;261;237,238;238;214;214;238;214;229;222;238;238;238;238;235;657;96;545;699,700,701,702,703,704;238;237,238;212;235;235;214;216;69;754;416;96;238;371;214;234,235,257,262;214;222;147,148,149,150,151,152;257;695;257;214;871;238;238;871;238;267;238;214;214;238;871;238;214;214;238;58;58,222;235;238;132;270;238;214;238;214;214;238;238;238,699,700,701,702,703,704;214;222,336;716;214;238;237,238;261;238;868;26;40;238,699,700,701,702,703,704;270;214;222;578;214;238;214;238;477,478,479;477,478,479;225;550;268;238;238;214;238;238;69;670;238;263;238;238;263;263;263;238;263;263;81,225;263;238;238;238;238;238;238;263;238;88;214;238;235;263;263;263;222,440;238,699,700,701,702,703,704;263;40;263;261;263;263;238;263;263;263;135;263;214;440;222;699,700,701,702,703,704;263;135;263;238;263;238,699,700,701,702,703,704;263;238;235;238;263;238;263;263;238;238;96;40;238;263;263;263;263;263;263;263;263;263;263;263;263;263;263;206;214,270;263;263;263;263;96;214;263;238;263;768,772;235;235;261;58;58;58;263;214;263;225;263;214;263;263;238;263;238;40;263;263;214;263;263;238;263;40;263;263;299;263;263;689,690;263;238,263;263;263;238;263;263;263;263;263;263;263;263;238;263;238;263;238;124;263;263;263;263;263;238;263;263;263;857;263;238;263;263;214;263;263;238;263;263;263;238;263;263;262,768;263;263;247,699,700,701,702,703,704;263;263;263;214;263;269;263;263;263;263;695;263;115,116,117,118;263;263;238;263;422;238;238;261;238;238;238;263;871;871;261;235;261;238;782;238;238;237,238;147,148,149,150,151,152;280;238;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;286;40;214;238;238;210;136;238;238;238;238;235;214;241,699,700,701,702,703,704;234,262;235;658;406;238;222;133;237,238;505,754;237,238;214;233;499;238;238,699,700,701,702,703,704;566;214;27,551,552;170,171,172;102;238,257;238,699,700,701,702,703,704;257;257;235;214;238;237,238;247;235,238;716;304;609;238,699,700,701,702,703,704;238,699,700,701,702,703,704;5;415;237,238;238;238,699,700,701,702,703,704;238;247;238;210;238;214;238,699,700,701,702,703,704;238;237,238;269;238;222;214;648;238;210;146;238;325;214;755,756,767;269;214;214;238;214;238;214;238;238;237,238;238;400;537;238;238;238;214;202;238;40;238;214;261;238;238;238;237,238;238,699,700,701,702,703,704;238;238;238;214;238;238;473;238,699,700,701,702,703,704;654;277;178,179,180;238,699,700,701,702,703,704;238;871;238,699,700,701,702,703,704;238;394;85,86;238,699,700,701,702,703,704;440;222;261;427;238;238;214;238;238;238;871;795;212;716;238;237,238;238,699,700,701,702,703,704;238,699,700,701,702,703,704;238;40;238;238;261,699,700,701,702,703,704;238;871;238;235;238;69;685;657;238;40;216;40;265;214;214;135;120;43,214;376;609;214;238;871;238;261;251,699,700,701,702,703,704;238;238;225;237,238;238;214,222;222;214;237,238;440;871;238;238,699,700,701,702,703,704;516;235;238,699,700,701,702,703,704;124;716;716;238;238;591;214;214;222;238,699,700,701,702,703,704;214;238;235;158,159;214;238;871;214;447;238;238;238;197;238;238;238;83,84;238;214,270;238;214;238;447;40,58,609;238;238;238;393;238;124;214;238;238;516;699,700,701,702,703,704;391;238;238;261;40;238;238;238;40;598;238;238,699,700,701,702,703,704;89,229;558;238;238;238;40,214;238;505,754;214;214,216;121;454;238;238,699,700,701,702,703,704;237,238;238;261;238;699,700,701,702,703,704;235;40;890;238,699,700,701,702,703,704;238,699,700,701,702,703,704;214;508;699,700,701,702,703,704;40;238;58,214,222,294;238;235;238;214;238;269;238;238;238;214,294;214,294;235;238;238;214;238;237,238;238;214;469;238;234,262;261;214;358;234,262;238;871;214;871;214;247;40;40;233;539;287;287;287;287;287;287;287;287;287;287;287;287;287;287;287;287;287;287;401;214;238;267;132;238;214;238;258;214;466;58;238;257;238,699,700,701,702,703,704;238;238;214;238;58;238;238;238;238,699,700,701,702,703,704;632;238;238;214;383;716;212;210;688;238;238;871;89;234,262;234,262;440;214;609;212;878,-883,-884,-885;0,1;214;716;214;238;261;238;147,148,149,150,151,152;238,699,700,701,702,703,704;263;263;263;263;263;263;238;263;238;238;263;263;263;263;238;263;263;238;263;263;263;238;214,294;214,294;263;214;214;263;263;263;263;238;263;263;263;263;263;263;263;263;263;263;263;263;238;238;263;238,263;263;263;263;263;263;263;214,586;214;40,222;263;263;263;263;263;263;263;238;238;263;263;238;263;263;284,285;263;263;263;263;263;263;263;263;222;263;238;263;263;263;263;263;263;716;263;263;258;263;238;263;263;263;263;263;263;238;263;214;336;263;263;263;238;263;263;261;263;261;263;238,699,700,701,702,703,704;238,699,700,701,702,703,704;238;257;263;263;263;263;263;263;871;828;263;263;249;263;238;263;261;238;263;263;263;263;263;699,700,701,702,703,704;263;238;238;263;263;263;263;263;263;214;261;263;263;263;263;263;263;238;263;263;263;263;214;263;263;263;263;238;238;263;238;238;263;269;238,263;263;238;238;263;238;210;214;764;263;238;238;263;263;263;263;238;58;114;263;263;263;263;263;263;263;263;263;263;263;263;263;263;263;263;263;263;263;263;609;609;609;263;263;263;263;263;238;263;263;263;238;136;238;263;238;238;263;263;57;263;238;871;871;214;238;447;40;698;238;237,238;214;238;238;238;214;238;238;238;753;441;47;214;238;871;238;238;238;238;406;238;238;238;238;238;447;214;237,238;238;233;47;175;238;212;699,700,701,702,703,704;238;238,699,700,701,702,703,704;238;238;214;238,257,699,700,701,702,703,704;214;214;283;716;238;214;237,238;214;261;699,700,701,702,703,704;238;214;238;214;238;238;136;357;238;132;233;238;257;238;80;283;214;257;260;229;237,238;238;238;238;238;238,699,700,701,702,703,704;237,238;261;132;90;238,699,700,701,702,703,704;238;95;238;238;238;238;238;257,699,700,701,702,703,704;237,238;222;235;40,214;412;238;237,238;261;214;609;238;238;214,225;238;238,699,700,701,702,703,704;237,238;440;237,238;327;235;238,699,700,701,702,703,704;238;238;238,699,700,701,702,703,704;261,699,700,701,702,703,704;214;237,238;238;238;432;235;235;238;235;212;238;238;238,699,700,701,702,703,704;225;142;235;238;238;238,699,700,701,702,703,704;238;238;249;237,238;214;214;238;238;238;535,536;235;238;214;47;238;238;238;222;238;222,440;234,235,262;212;716;238;238,699,700,701,702,703,704;238,699,700,701,702,703,704;235;130;238;238;237,238;238;325;214;214;238;238,699,700,701,702,703,704;871;740,741;714,740,741;238;641;238;261;238;238;238;70;238;440;609;238;238;546;238;212;238;238,699,700,701,702,703,704;238;238,699,700,701,702,703,704;238;238;238;238;871;594;261;233;238;132;238;356;235;238;214;214;238;216;238;238;238;238;238;238;238;833,834;222;238;222;238;238;238,699,700,701,702,703,704;238;338;238;238;741,747,748;238,243,699,700,701,702,703,704;440;206;440;214;238;238;238;238;261;609;222;206;214;214;609;583;238;238;214,294;214;238,699,700,701,702,703,704;871;238,699,700,701,702,703,704;407;222,294;235;238;97,98,99,100;123;238;238;238;699,700,701,702,703,704;237,238;238;238;96;235;238,699,700,701,702,703,704;235;193;261;238;624,625;238;238;235;237;237,238;261;238;238;714,723,740,741,742;214;43;238;238;453;238;214;238;238;214;267;594;31,32;229,230;238;238;238;214;234,262;238;238;216;136;238;222;238;238;238;297,298;238;238;716;214;91;537;237,238;238,699,700,701,702,703,704;238,699,700,701,702,703,704;699,700,701,702,703,704;238,699,700,701,702,703,704;328;238;238;477,478,479;238;238;238;238;40;235;716;609;263;261;238;263;263;263;214;263;238;263;263;263;214,294;214;871;263;263;263;263;263;263;263;263;263;263;263;263;263;238,263;263;238;263;263;263;263;336,507;263;263;855;263;263;263;263;238;238;263;136;238;263;263;263;263;263;263;263;263;263;263;263;238;263;263;238;263;238;263;139;263;238;263;263;263;263;263;263;261;263;263;263;263;263;263;263;263;263;263;263;263;263;96;261;263;263;263;263;263;270;263;212;263;263;270;214;263;263;261;263;263;263;263;263;238;263;263;214;233;263;263;263;263;263;263;263;263;263;263;263;263;263;238;263;263;824;263;238;263;263;263;238,263;235;234,262;238;238;214;263;263;263;263;263;669;263;263;263;263;238;560;263;263;235;238;238;263;238;263;634;263;263;263;263;40;263;263;263;263;263;263;263;238;263;263;263;263;699,700,701,702,703,704;263;263;871;238;238,257,699,700,701,702,703,704;263;263;263;263;263;263;537;263;263;263;263;699,700,701,702,703,704;263;263;40;263;263;263;263;263;263;263;263;263;263;263;263;238;123;263;263;263;263;263;238;238;871;871;173;238;237,238;261;238;214;214;238;642;158,159;238;142;238;238;237,238;237,238;699,700,701,702,703,704;238;238;238;238;40;238;237,238;214;887,888,889;597;238;238;214;262;136;238;420;839;695;247;238;304;214;489;222;238;235;235;237,238;238,699,700,701,702,703,704;214;238;214;238;238;238;237,238;222;238;238;238;238;238;238;238;283;142;238;214;238;214;255;257;214;206;139;237,238;237,238;238;222,555,556;555,556;555,556;57;235;238;235,238;247,699,700,701,702,703,704;238;238;238;238;238;238;238;146;238;238;238,699,700,701,702,703,704;378;238,699,700,701,702,703,704;214;214;238;238;214;442;235;40,537;238;238;571;222;233;237,238;238;214;238;212;238,699,700,701,702,703,704;238;707;249,699,700,701,702,703,704;235;238,257;214;120;214;235;238;238;238,699,700,701,702,703,704;238;253;238;238;238;238;740;214;238;238;238,699,700,701,702,703,704;58,222;237,238;699,700,701,702,703,704;262;601;234,262;238,699,700,701,702,703,704;238;238;238,699,700,701,702,703,704;238;390;238;214;238;261;70;214;238;216;238;238;871;871;238;97,98,99,100;237,238;609;238;238;214;237,238;238;40;238;212;40;238;287;214;212;214;214;238;136;238;238;247;451;214;222;238;238;238;237,238;214;238;871;237,238;115,116,117,118;238;40,58,609;238;238;214;699,700,701,702,703,704;238,257;609;238,699,700,701,702,703,704;214,294;238;281;609;238;132;214;214,222,294;537;214;214;609;214;206;740;238;238;238,699,700,701,702,703,704;235;440;238;238;238;238;235;238;238;238;214;237,238;235,238;167,168,169;238;699,700,701,702,703,704;501;871;871;214;237,238;238;214;238;123;235;238;238;214;238;238;136;238;68;238;43;448;495;238;627;261;210;238;238;238;238;222;440;238;235;222;237,238;237,238;214;237,238;878,-880,-881,-882;235;214;238;237,238;238;263;263;238;238;238;238;263;263;263;263;263;263;263;695;263;263;263;263;263;695;263;214,294;235;307;424,425;263;294;263;263;263;263;263;238;263;263;263;235;263;263;212;263;263;263;263;263;263;263;263;214;263;263;263;263;263;263;263;263;263;263;263;263;263;263;214;214;263;238;263;263;81;263;263;238;532;238;263;263;263;263;263;263;263;263;263;263;263;263;263;525,526;238,247;263;263;263;263;263;263;263;263;610;607;263;263;263;263;263;238;263;263;263;263;214;263;214;261;263;58;263;263;263;263;263;261;263;263;263;263;263;238;263;263;768;789;263;263;238;238;263;263;238,258;238,263;238;263;238;263;263;263;263;263;263;263;238;238;871;263;263;238;263;263;263;263;263;263;263;263;235;238;263;238;263;263;263;263;263;319;238;263;263;263;263;238;263;263;263;263;238;263;263;263;263;263;263;263;263;263;676,677;238;263;263;263;263;609;263;263;263;263;263;263;263;263;263;235;238;263;263;263;263;263;263;238;263;263;238;238;238;237,238;238;238;96;238;238;238,699,700,701,702,703,704;237,238;238;238;238;740;238;238;769,770,771;214;406;238;238;238;237,238;237,238;533;102;238;697;674;238;238;238;237,238;47;447;238;214;238;214;222;238;238;57;238;238;871;238;238;449;238;96,130;214;235;238;214;237,238;238;300;237,238;238;129;238;238;136;133,161,162,163;731,732;251;238;238;238;238;238,699,700,701,702,703,704;237,238;238;238,699,700,701,702,703,704;238;238;699,700,701,702,703,704;235;238;238,699,700,701,702,703,704;257;136;238,249,699,700,701,702,703,704;255;5;237,238;238;251,699,700,701,702,703,704;238;238;238;238;214;871;871;238;628;238;237,238;238;235;214;238;238;238;237,238;238;238;238;57;871;238,699,700,701,702,703,704;214;238;238;238;238;238;238;237,238;238;238;238;238;70;40;238;214;520,521;238;238;238;238;238;206;871;238;261;238;238;238;238;237,238;238,699,700,701,702,703,704;261;238;238;238,699,700,701,702,703,704;304;261;238;238;238;238;115,116,117,118;136;238;238;440;609;235;214;238;634;726,727;238;238;238;609;214,294;238;238;238;238;222,225,294;238;619;214;27;212;214;237,238;238;261;212;238;262;238;123;871;255;222;238;238;222;238;238;214;644;325;249;378;238;238;238;237,238;65;294,541;716;101;96;743;238;214;156,157;296,729,730,744,745,855;238;238;238;212;263;238;263;263;263;263;263;263;263;263;263;263;214,294;263;263;263;263;238;263;263;238,699,700,701,702,703,704;235;263;263;238;263;263;263;263;263;263;263;263;263;263;263;263;28;263;263;263;263;238;261;263;263;263;263;238;214;263;238;263;263;263;263;263;263;263;263;263;263;235;263;238;263;263;69;263;263;263;263;263;397;263;263;434;263;263;263;263;263;263;214;96;97,98,99,100;97,98,99,100;214;263;58;263;263;238;263;263;263;263;263;238;263;263;263;263;238;263;263;263;263;263;263;238;258;263;263;263;263;263;263;263;238;263;263;263;263;263;263;238;238;263;263;263;263;263;263;263;263;263;263;238;263;263;263;263;263;263;263;263;263;263;263;263;263;263;214;263;263;263;263;263;263;263;238,263;238,699,700,701,702,703,704;263;263;263;263;238,263;214,534;238;261;490;235;132;238;736;238;423;237,238;238;238;214;238;234,262;238;238;18,581;238;238;214;238;238;238;238;699,700,701,702,703,704;871;235;237,238;96;210;238;238;238;238;238,699,700,701,702,703,704;238;261;238;261;524;238;238;22,23,24;242,699,700,701,702,703,704;238;235;238,699,700,701,702,703,704;237,238;261;136;712;237,238;845;238;238;238;261;249;76;699,700,701,702,703,704;459;237,238;237,238;122;238;261;238,699,700,701,702,703,704;238,699,700,701,702,703,704;238;237,238;136;235;238;238;712;238,699,700,701,702,703,704;237,238;197;108,109;101;237,238;238,699,700,701,702,703,704;237,238;871;238;754;237,238;238;238;238;120;238;238;238,699,700,701,702,703,704;237,238;57;238;238;871;238;222;238;214;238;212;136;699,700,701,702,703,704;238;626;212;257;214;214;238;871;238;866;144,145;238,699,700,701,702,703,704;238,699,700,701,702,703,704;754;238;238;238;214;235;238;543;43;238;40,214;238;373;238;238;238;238,699,700,701,702,703,704;609;235;609;261;214,294;609;237,238;238;255;238;450;222;214,294,901;238;238;238;238;237,238;214;212;871;214;237,238;584;261;238;222;238;238;257;233;238;214;261;238;214;214;238,699,700,701,702,703,704;237,238;136;235;235;255;263;263;238;238;238;263;263;263;263;238;263;263;263;716;263;263;263;263;238;263;238;263;263;263;235;263;263;263;263;238;263;263;263;263;263;263;706,741;263;263;263;238;263;263;238;261;263;263;263;263;263;263;263;263;263;263;263;263;263;263;263;263;238;238;263;238;263;263;263;263;238;263;263;123;250,699,700,701,702,703,704;238;238;263;263;263;263;263;871;263;263;263;263;263;263;263;238;263;238;263;263;263;238,263;263;263;263;238;238;263;263;263;263;263;263;27;261;238;263;263;263;238;263;263;263;263;263;263;263;263;263;263;263;263;263;263;214;263;263;263;263;263;263;263;237,238;699,700,701,702,703,704;212;261;235,794;214;222;238;238;238,255;96;43;132;237,238;237,238;238;238;40;533;238;238,257;238;237,238;238;238;238,699,700,701,702,703,704;238;238;754;238;237,238;238;589;697;214;238;741,749;871;238;237,238;238;238;238;238;238;238;238;136;691;235;616;238;85,86;132;132;101;214;238;238;212;238;238;238;238,699,700,701,702,703,704;238,699,700,701,702,703,704;238,247;261;238;572;238;238;238;238;237,238;238;238;238;238;238;238;237,238;238;214;238,699,700,701,702,703,704;238,699,700,701,702,703,704;238;871;238;238;220;238;238;740,741,788;214;238;470;237,238;238,699,700,701,702,703,704;238;261;238;238;69;237,238;238;251,699,700,701,702,703,704;238;238;609;235;238;754;123;206,222,342,343;214;136;214;238,699,700,701,702,703,704;222;237,238;238;238;238;27;212;237,238;235;744,745;609;136;440;214;238;214;237,238;233;235;238;238;237,238;238;238;263;214;263;263;263;263;263;263;871;263;263;263;263;263;263;263;238;263;263;263;263;263;263;263;263;238;263;263;263;235;263;263;263;263;263;263;212;263;263;263;263;263;263;238;263;263;263;871;263;263;263;263;238;263;238;263;263;263;263;238;263;263;238,263;235;263;263;263;263;263;263;263;263;263;135;263;238,257,699,700,701,702,703,704;238;263;263;263;263;263;263;263;263;263;263;263;263;263;238;263;263;263;263;263;263;263;263;263;263;263;263;263;214;238;451;238;238;222;75;238;238;237,238;341;235;238;238;238;229;238;238;238;238;769,770,771;144,145;871;238;237,238;440;212;871;238;238;238;238;238;237,238;237,238;238;214;238;238;609;238;238;238;214;238;871;238;238;238;238;238;237,238;871;97,98,99,100;238;609;238;238;460;506;238;214;238;238;222,294;97,98,99,100;238;212;212;871;238;871;257;238;238,699,700,701,702,703,704;257;871;238;238;102;212;238;214;871;238;238;40;263;263;263;263;214;238;263;609;263;263;263;263;639;263;263;263;263;214;263;263;238,247,699,700,701,702,703,704;263;263;263;263;263;263;263;754;263;263;263;263;263;214;263;263;263;263;263;263;263;263;263;238;238,263;238;263;263;263;263;263;263;238;263;434;263;263;263;263;263;263;212;766;263;695;263;263;263;263;263;263;263;263;263;238;238;85,86;238;214;699,700,701,702,703,704;238;238;222;214;238;605;237,238;132;486;261;238;238;214;238;238;237,238;237,238;238;238;237,238;238;238;237,238;871;208;238;238,699,700,701,702,703,704;214;3,569;212;70;214;238;871;238;238;238;237,238;744,745;167,168,169;238;212;133,161,162,163;726,727;261;238;257;257;609;238;237,238;238;238,258,699,700,701,702,703,704;214;263;214;263;263;263;263;263;263;263;263;263;235;263;263;263;263;238;263;238;238;263;263;214;263;263;263;263;263;263;263;263;263;263;263;263;238;263;263;263;263;263;263;263;263;263;263;263;238;263;263;263;263;263;263;238;238;871;699,700,701,702,703,704;238;746;212;214;237,238;237,238;238,699,700,701,702,703,704;214;214,409;693;237,238;602,603,891,892;135;238;238;237,238;235;237,238;238;229;197;237,238;220;238;238;261;238;237,238;695;871;214;214,294;97,98,99,100;237,238;237,238;238;237,238;238;263;263;222;263;263;263;238;263;238;263;238;263;263;263;263;263;263;263;263;263;263;238;263;263;871;871;238;263;263;238;263;263;263;263;263;238,257,699,700,701,702,703,704;270;238;238;238;212;697;238;238;237,238;311;238;238;237,238;238;238;238;214;238;214;238;70;235;871;238;238;238;237,238;235;238;695;237,238;238,699,700,701,702,703,704;212;237,238;237,238;261;695;238;238;222;214;652;136;263;263;263;263;263;263;263;263;263;263;263;235;263;263;263;238;238;238,263;263;263;728;238;263;263;263;263;263;263;263;263;263;263;263;237,238;238,257;238;212;238;238;238;237,238;287;238;238;70;238;237,238;871;237,238;235;132;238;238,699,700,701,702,703,704;214;263;263;263;263;263;263;263;233;263;263;263;263;263;263;263;871;212;263;263;263;263;27;214;255;238,699,700,701,702,703,704;238;132;214;609;214;238;214;235;263;263;263;263;263;263;263;263;263;263;263;263;216,225;238;235;238,699,700,701,702,703,704;238;238;238,699,700,701,702,703,704;214;263;633;263;263;238;214,496;214;263;263;263;263;392;238;214;132;263;235;238,257,699,700,701,702,703,704;235;263;237,238;263;214;202;214;263;235;229;263;214;263;222";

const $scriptletHostnames$ = /* 6675 */ ["s.to","ak.sv","fc.lc","g3g.*","hqq.*","my.is","ouo.*","th.gl","tz.de","u4m.*","yts.*","2ddl.*","4br.me","al.com","av01.*","bab.la","czn.gg","d-s.io","dev.to","dlhd.*","dood.*","ext.to","eztv.*","im9.eu","imx.to","j7p.jp","kaa.to","mmm.lt","nj.com","oii.io","oii.la","pahe.*","pep.ph","ppv.to","si.com","srt.am","t3n.de","tfp.is","tpi.li","tv3.lt","twn.hu","vido.*","waaw.*","web.de","yts.mx","1337x.*","3si.org","6mt.net","7xm.xyz","a-ha.io","adsh.cc","aina.lt","alfa.lt","babla.*","bflix.*","bgr.com","bhaai.*","bien.hu","bild.de","blog.jp","cfb.fan","chip.de","ck5.com","clik.pw","cnxx.me","dict.cc","doods.*","elixx.*","ev01.to","fap.bar","fc-lc.*","filmy.*","fojik.*","g20.net","get2.in","giga.de","goku.sx","gomo.to","gotxx.*","hang.hu","jmty.jp","kino.de","last.fm","leak.sx","linkz.*","lulu.st","m9.news","mdn.lol","mexa.sh","mlsbd.*","moco.gg","moin.de","movi.pk","mrt.com","msn.com","mx6.com","pfps.gg","ping.gg","prbay.*","sanet.*","send.cm","sexu.tv","sflix.*","sky.pro","stape.*","tvply.*","tvtv.ca","tvtv.us","tyda.se","uns.bio","veev.to","vidoo.*","vudeo.*","vumoo.*","welt.de","wwd.com","15min.lt","250r.net","2embed.*","4game.ru","7mmtv.sx","9gag.com","9xflix.*","a5oc.com","adria.gg","akff.net","alkas.lt","alpin.de","b15u.com","bilis.lt","bing.com","blick.ch","blogo.jp","bokep.im","bombuj.*","cats.com","cjls.com","cnet.com","codex.gg","cybar.to","devlib.*","dlhd.*>>","dooood.*","dotgg.gg","egolf.jp","ehmac.ca","emoji.gg","exeo.app","eztvx.to","f1box.me","fark.com","fastt.gg","feoa.net","file.org","findav.*","fir3.net","flixhq.*","focus.de","frvr.com","fz09.org","gala.com","game8.jp","golog.jp","gr86.org","gsxr.com","haho.moe","hidan.co","hidan.sh","hk01.com","hoyme.jp","hyhd.org","imgsen.*","imgsto.*","incest.*","infor.pl","javbee.*","jiji.com","k20a.org","kaido.to","katu.com","keran.co","km77.com","krem.com","kresy.pl","kstp.com","kwejk.pl","lared.cl","lat69.me","lejdd.fr","liblo.jp","lit.link","loadx.ws","mafab.hu","manwa.me","mgeko.cc","miro.com","mitly.us","mmsbee.*","msgo.com","mtbr.com","nikke.gg","olweb.tv","ozap.com","pctnew.*","plyjam.*","plyvdo.*","pons.com","pornx.to","r18.best","racaty.*","rdr2.org","redis.io","rintor.*","rs25.com","sb9t.com","send.now","shid4u.*","short.es","shrink.*","slut.mom","so1.asia","sport.de","sshhaa.*","strtpe.*","swzz.xyz","sxyprn.*","tasty.co","tmearn.*","tokfm.pl","tokon.gg","toono.in","tv247.us","udvl.com","ufret.jp","uqload.*","video.az","vidlox.*","vidsrc.*","vimm.net","vipbox.*","viprow.*","viral.wf","virpe.cc","w4hd.com","wcnc.com","wdwnt.jp","wfmz.com","whec.com","wimp.com","wpde.com","x1337x.*","xblog.tv","xvip.lat","yabai.si","ytstv.me","zcar.com","zooqle.*","zx6r.com","1337x.fyi","1337x.pro","1stream.*","2024tv.ru","3minx.com","4game.com","4stream.*","5movies.*","600rr.net","7-min.com","7starhd.*","9xmovie.*","aagmaal.*","adcorto.*","adshort.*","ai18.pics","aiblog.tv","aikatu.jp","akuma.moe","alphr.com","anidl.org","aniplay.*","aniwave.*","ap7am.com","as-web.jp","atomohd.*","ats-v.org","atshq.org","ausrc.com","autoby.jp","aylink.co","azmen.com","azrom.net","babe8.net","bc4x4.com","beeg.porn","beupp.com","bigwarp.*","blkom.com","bmwlt.com","bokep.top","bolde.com","camhub.cc","canoe.com","cbrxx.com","ccurl.net","cdn1.site","chron.com","cinego.tv","cl1ca.com","cn-av.com","cybar.xyz","d000d.com","d0o0d.com","daddyhd.*","dippy.org","dixva.com","djmaza.my","dnevno.hr","do0od.com","do7go.com","doods.cam","doply.net","doviz.com","ducati.ms","dvdplay.*","dx-tv.com","dzapk.com","egybest.*","embedme.*","enjoy4k.*","eroxxx.us","erzar.xyz","exego.app","expres.cz","fabtcg.gg","fap18.net","faqwiki.*","faselhd.*","fawzy.xyz","fc2db.com","file4go.*","finfang.*","fiuxy2.co","flagle.io","fmovies.*","fooak.com","forsal.pl","ftuapps.*","fx-22.com","garota.cf","gayfor.us","ghior.com","globo.com","glock.pro","gloria.hr","gplinks.*","grapee.jp","gt350.org","gtr.co.uk","gunco.net","hanime.tv","hayhd.net","healf.com","hellnaw.*","hentai.tv","hitomi.la","hivflix.*","hkpro.com","hoca5.com","hpplus.jp","humbot.ai","hxfile.co","ibooks.to","idokep.hu","ifish.net","igfap.com","imboc.com","imgur.com","imihu.net","innal.top","inxxx.com","iqiyi.com","iwsti.com","iza.ne.jp","javcl.com","javmost.*","javsex.to","javup.org","jprime.jp","katfile.*","keepvid.*","kenitv.me","kens5.com","kezdo5.hu","kickass.*","kissjav.*","knowt.com","kogap.xyz","kr-av.com","krx18.com","lamire.jp","ldblog.jp","loawa.com","magma.com","magmix.jp","manta.com","mcall.com","messen.de","mielec.pl","milfnut.*","mini2.com","miniurl.*","minkou.jp","mixdrop.*","miztv.top","mkvcage.*","mlbbox.me","mlive.com","modhub.us","mp1st.com","mr2oc.com","msic.site","mynet.com","nagca.com","naylo.top","nbabox.co","nbabox.me","nekopoi.*","new-fs.eu","nflbox.me","ngemu.com","nhlbox.me","nlegs.com","novas.net","ohjav.com","onual.com","palabr.as","pepper.it","pepper.pl","pepper.ru","picrew.me","pig69.com","pirlotv.*","pixhost.*","plylive.*","poqzn.xyz","pover.org","psarips.*","r32oc.com","raider.io","remaxhd.*","rempo.xyz","reymit.ir","rezst.xyz","rezsx.xyz","rfiql.com","safego.cc","safetxt.*","sbazar.cz","sbsun.com","scat.gold","seexh.com","seturl.in","seulink.*","seznam.cz","sflix2.to","shahi4u.*","shorten.*","shrdsk.me","shrinke.*","sine5.dev","space.com","sport1.de","sporx.com","strmup.to","strmup.ws","strtape.*","swgop.com","tbs.co.jp","tccoa.com","tech5s.co","tgo-tv.co","tojav.net","top16.net","torlock.*","tpayr.xyz","tryzt.xyz","ttora.com","tutele.sx","ucptt.com","upzur.com","usi32.com","v6z24.com","vidara.so","vidara.to","vidco.pro","vide0.net","vidz7.com","vinovo.to","vivuq.com","vn750.com","vogue.com","voodc.com","vplink.in","vtxoa.com","waezg.xyz","waezm.xyz","watson.de","wdwnt.com","wiour.com","woojr.com","woxikon.*","x86.co.kr","xbaaz.com","xcity.org","xdabo.com","xdl.my.id","xenvn.com","xhbig.com","xtapes.me","xxx18.uno","yeshd.net","ygosu.com","yjiur.xyz","ylink.bid","youdbox.*","ytmp3eu.*","z80ne.com","zdnet.com","zefoy.com","zerion.cc","zitss.xyz","1000rr.net","1130cc.com","123atc.com","180sx.club","1919a4.com","1bit.space","1lumen.com","1stream.eu","1tamilmv.*","24bite.com","2chblog.jp","2umovies.*","3dmili.com","3hiidude.*","3kmovies.*","4kporn.xxx","555fap.com","5ghindi.in","604now.com","720pflix.*","7gents.com","98zero.com","9hentai.so","9xmovies.*","acefile.co","adslink.pw","aether.mom","afk.global","alfabb.com","all3do.com","allpar.com","alxnow.com","ambotv.com","animeyt.es","aniwave.uk","anroll.net","anyksta.lt","apcvpc.com","apkmody.io","ariase.com","arlnow.com","ashrfd.xyz","ashrff.xyz","asiaon.top","atishmkv.*","atomixhq.*","azmind.com","bagi.co.in","bargpt.app","basset.net","bgfg.co.uk","bigbtc.win","bjjdoc.com","bjpenn.com","bmamag.com","boyfuck.me","btvplus.bg","buzter.xyz","canada.com","caroha.com","cashurl.in","cboard.net","cbr250.com","cbr250.net","cdn256.xyz","cgtips.org","clock.zone","club3g.com","club4g.org","clubxb.com","cnpics.org","corral.net","crictime.*","ctpost.com","curbly.com","cztalk.com","d0000d.com","dareda.net","desired.de","desixx.net","dhtpre.com","dipsnp.com","disqus.com","djxmaza.in","dnevnik.hr","dojing.net","driving.ca","dshytb.com","ducati.org","dvdrev.com","e-sushi.fr","educ4m.com","edumail.su","eracast.cc","evropa2.cz","ex-500.com","exambd.net","exeygo.com","exnion.com","f1stream.*","f650.co.uk","falpus.com","fandom.com","fapeza.com","faselhds.*","faucet.ovh","fbstream.*","fcsnew.net","fearmp4.ru","fesoku.net","ffcars.com","fikfok.net","filedot.to","filemoon.*","fileone.tv","filext.com","filiser.eu","film1k.com","filmi7.net","filmizle.*","filmweb.pl","filmyhit.*","filmywap.*","findporn.*","fitbook.de","flatai.org","flickr.com","flixmaza.*","flo.com.tr","fmembed.cc","formel1.de","freeuse.me","fuck55.net","fullxh.com","fxstreet.*","fz07oc.com","fzmovies.*","g5club.net","galaxus.de","game5s.com","gdplayer.*","ghacks.net","gixxer.com","gmenhq.com","go2gbo.com","gocast.pro","goflix.sbs","gomovies.*","gostosa.cf","grunge.com","gunhub.com","hacoos.com","hdtoday.to","hesgoal.tv","heureka.cz","hianime.to","hitprn.com","hoca4u.com","hochi.news","hopper.com","hunker.com","huren.best","i4talk.com","i5talk.com","ib-game.jp","idol69.net","igay69.com","illink.net","imgsex.xyz","isgfrm.com","isplus.com","issuya.com","iusm.co.kr","j-cast.com","j-town.net","jav-coco.*","javboys.tv","javhay.net","javhun.com","javsek.net","jazbaat.in","jin115.com","jisaka.com","jnews1.com","joktop.com","jpvhub.com","jrants.com","jytechs.in","kaliscan.*","kaplog.com","kemiox.com","keralahd.*","kerapoxy.*","kimbino.bg","kimbino.ro","kimochi.tv","labgame.io","leeapk.com","leechall.*","lidovky.cz","linkshub.*","lorcana.gg","love4u.net","ls1gto.com","ls1lt1.com","m.4khd.com","m1xdrop.bz","macwelt.de","magnetdl.*","masaporn.*","mdxers.org","megaup.net","megaxh.com","meltol.net","merinfo.se","meteo60.fr","mhdsport.*","mhdtvmax.*","milfzr.com","mixdroop.*","mmacore.tv","mmtv01.xyz","model2.org","morels.com","motor1.com","movies4u.*","movix.blog","multiup.eu","multiup.io","mydealz.de","mydverse.*","myflixer.*","mykhel.com","mym-db.com","mytreg.com","namemc.com","narviks.nl","natalie.mu","neowin.net","nickles.de","njavtv.com","nocensor.*","nohost.one","nonixxx.cc","nordot.app","norton.com","nulleb.com","nuroflix.*","nvidia.com","nxbrew.com","nxbrew.net","nybass.com","nypost.com","ocsoku.com","odijob.com","ogladaj.in","on9.stream","onlyfams.*","opelgt.com","otakomu.jp","ovabee.com","paypal.com","pctfenix.*","petbook.de","plc247.com","plc4me.com","poophq.com","poplinks.*","porn4f.org","pornez.net","porntn.com","prius5.com","prmovies.*","proxybit.*","pxxbay.com","qrixpe.com","r8talk.com","raenonx.cc","rapbeh.net","rawinu.com","rediff.com","reshare.pm","rgeyyddl.*","rlfans.com","roblox.com","rssing.com","s2-log.com","sankei.com","sanspo.com","sbs.com.au","scribd.com","sekunde.lt","sexo5k.com","sgpics.net","shahed4u.*","shahid4u.*","shinden.pl","shortix.co","shorttey.*","shortzzy.*","showflix.*","shrinkme.*","silive.com","sinezy.org","smoner.com","soap2day.*","softonic.*","solewe.com","spiegel.de","sportshd.*","strcloud.*","streami.su","streamta.*","suaurl.com","supra6.com","sxnaar.com","teamos.xyz","tech8s.net","telerium.*","thedaddy.*","thefap.net","thevog.net","tiscali.cz","tlzone.net","tnmusic.in","tportal.hr","traicy.com","treasl.com","tubemate.*","turbobi.pw","tutelehd.*","tvglobe.me","tvline.com","upbaam.com","upmedia.mg","ups2up.fun","usagoals.*","ustream.to","vbnmll.com","vecloud.eu","veganab.co","vfxmed.com","vid123.net","vidnest.io","vidorg.net","vidply.com","vipboxtv.*","vipnews.jp","vippers.jp","vtcafe.com","vvide0.com","wallup.net","wamgame.jp","weloma.art","weshare.is","wetter.com","woxikon.in","wwwsct.com","wzzm13.com","x-x-x.tube","x18hub.com","xanimu.com","xdtalk.com","xhamster.*","xhopen.com","xhspot.com","xhtree.com","xrv.org.uk","xsober.com","xxgasm.com","xxpics.org","xxxmax.net","xxxmom.net","xxxxsx.com","yakkun.com","ygozone.gg","youjax.com","yts-subs.*","yutura.net","z12z0vla.*","zalukaj.io","zenless.gg","zpaste.net","zx-10r.net","11xmovies.*","123movies.*","17apart.com","2monkeys.jp","31daily.com","360tuna.com","373news.com","3800pro.com","3dsfree.org","460ford.com","4wdlife.com","6theory.com","9animetv.to","9to5mac.com","abs-cbn.com","abstream.to","adxtalk.com","aimlief.com","aipebel.com","allears.net","allkpop.com","almanac.com","althub.club","anime4i.vip","anime4u.pro","animelek.me","animepahe.*","aqua2ch.net","artnews.com","asenshu.com","asiaflix.in","asianclub.*","asianplay.*","ask4movie.*","atqa005.com","aucfree.com","autobild.de","automoto.it","awkward.com","azmath.info","babaktv.com","babybmw.net","beastvid.tv","becoming.is","beinmatch.*","bestnhl.com","bfclive.com","bg-mania.jp","bi-girl.net","bigoven.com","bigshare.io","bittbox.com","bitzite.com","blendtw.com","blogher.com","blu-ray.com","blurayufr.*","bogoten.com","bookroo.com","bootspy.com","bowfile.com","brendid.com","btcbitco.in","buellxb.com","by-pink.com","caitlin.top","camaros.net","camsrip.com","cararac.com","catster.com","cbsnews.com","cheatcc.com","chefani.com","chefjar.com","chefkoch.de","chicoer.com","civinfo.com","clubrsx.com","clubwrx.net","colnect.com","colorkit.co","colorxs.com","comohoy.com","copykat.com","courant.com","cpmlink.net","cpmlink.pro","crabbet.com","cracked.com","crx7601.com","cuervotv.me","cults3d.com","cupofjo.com","cutpaid.com","cwfeats.com","daddylive.*","daily.co.jp","dawenet.com","dbstalk.com","ddrmovies.*","dealabs.com","decider.com","deltabit.co","demonoid.is","desivdo.com","dexerto.com","diasoft.xyz","diudemy.com","divxtotal.*","djqunjab.in","dogdrip.net","dogtime.com","doorblog.jp","dootalk.com","downvod.com","dronedj.com","dropgame.jp","ds2play.com","ds450hq.com","dsmtalk.com","dsvplay.com","dynamix.top","dziennik.pl","e2link.link","easybib.com","ebookbb.com","edikted.com","egygost.com","electrek.co","elliott.org","embedpk.net","emuenzen.de","endfield.gg","eporner.com","eptrail.com","eroasmr.com","erovoice.us","etaplius.lt","everia.club","fastpic.org","filecrypt.*","filemooon.*","filmisub.cc","findjav.com","flix-wave.*","flixrave.me","fnforum.net","fnjplay.xyz","fntimes.com","focusrs.org","focusst.org","fplzone.com","fsharetv.cc","fullymaza.*","g-porno.com","g8board.com","g8forum.com","gamewith.jp","gbatemp.net","get-to.link","gezondnu.nl","ghbrisk.com","gigafile.nu","gm-volt.com","go.zovo.ink","gocast2.com","godlike.com","gold-24.net","goodcar.com","govtech.com","grasoku.com","gtrlife.com","gupload.xyz","haytalk.com","hellcat.org","hhkungfu.tv","hiphopa.net","history.com","hornpot.net","hoyolab.com","hurawatch.*","ianimes.one","idlixku.com","iklandb.com","imas-cg.net","impact24.us","impalas.net","in91vip.win","itopmusic.*","jaginfo.org","javball.com","javbobo.com","javleak.com","javring.com","javtele.net","javx357.com","jawapos.com","jelonka.com","jemsite.com","jetpunk.com","jixo.online","jjang0u.com","jocooks.com","jorpetz.com","jutarnji.hr","jxoplay.xyz","k-bikes.com","k3forum.com","kaliscan.io","karanpc.com","kboards.com","keeplinks.*","kidan-m.com","kiemlua.com","kijoden.com","kin8-av.com","kinmaweb.jp","kion546.com","kissasian.*","laposte.net","letocard.fr","lexpress.fr","lfpress.com","linclik.com","linkebr.com","linkrex.net","livesnow.me","losporn.org","luluvdo.com","luluvid.com","luremaga.jp","m.iqiyi.com","m1xdrop.com","m1xdrop.net","m5board.com","madouqu.com","mailgen.biz","mainichi.jp","mamastar.jp","manysex.com","marinij.com","masahub.com","masahub.net","maxstream.*","mediaset.es","messitv.net","metager.org","mhdsports.*","mhdstream.*","minif56.com","mirrorace.*","mlbbite.net","mlbstream.*","moonembed.*","mostream.us","movgotv.net","movieplex.*","movies123.*","mp4moviez.*","mrbenne.com","mrskin.live","mrunblock.*","multiup.org","muragon.com","mx5life.com","mx5nutz.com","nbabox.co>>","nbastream.*","nbcnews.com","netfapx.com","netfuck.net","netplayz.ru","netzwelt.de","news.com.au","newscon.org","nflbite.com","nflstream.*","nhentai.net","nhlstream.*","nicekkk.com","nicesss.com","ninjah2.org","nodo313.net","nontonx.com","noreast.com","novelup.top","nowmetv.net","nsfwr34.com","odyclub.com","okanime.xyz","omuzaani.me","onefora.com","onepiece.gg","onifile.com","optraco.top","orusoku.com","pagesix.com","papahd.info","pashplus.jp","patheos.com","payskip.org","pcbolsa.com","pdfdrive.to","peeplink.in","pelisplus.*","pigeons.biz","piratebay.*","pixabay.com","pkspeed.net","pmvzone.com","pornkino.cc","pornoxo.com","poscitech.*","primewire.*","purewow.com","quefaire.be","quizlet.com","ragnaru.net","ranking.net","rapload.org","rekogap.xyz","retrotv.org","rl6mans.com","rsgamer.app","rslinks.net","rubystm.com","rubyvid.com","sadisflix.*","safetxt.net","sailnet.com","savefiles.*","scatfap.com","scribens.fr","serial4.com","shaheed4u.*","shahid4u1.*","shahid4uu.*","shaid4u.day","sharclub.in","sharing.wtf","shavetape.*","shortearn.*","sigtalk.com","smplace.com","songsio.com","speakev.com","sport-fm.gr","sportcast.*","sporttuna.*","srtslug.biz","starblog.tv","starmusiq.*","sterham.net","stmruby.com","strcloud.in","streamcdn.*","streamed.pk","streamed.st","streamed.su","streamhub.*","strikeout.*","subdivx.com","svrider.com","syosetu.com","t-online.de","tabooflix.*","talkesg.com","tbsradio.jp","teachoo.com","techbook.de","techguy.org","teltarif.de","teryxhq.com","thehour.com","thektog.org","thenewx.org","thothub.lol","tidymom.net","tikmate.app","tinys.click","tnaflix.com","toolxox.com","toonanime.*","topembed.pw","toptenz.net","trifive.com","trx250r.net","trx450r.org","tryigit.dev","tsxclub.com","tube188.com","tumanga.net","tundra3.com","tunebat.com","turbovid.me","tvableon.me","twitter.com","ufcstream.*","unixmen.com","up4load.com","uploadrar.*","upornia.com","upstream.to","ustream.pro","uwakich.com","uyeshare.cc","vague.style","variety.com","vegamovie.*","vexmoviex.*","vidcloud9.*","vidclouds.*","vidello.net","vipleague.*","vipstand.pm","viva100.com","vtxcafe.com","vwforum.com","vwscout.org","vxetable.cn","w.grapps.me","wavewalt.me","weather.com","webmaal.cfd","webtoon.xyz","westmanga.*","wincest.xyz","wishflix.cc","www.chip.de","x-x-x.video","x7forum.com","xdforum.com","xfreehd.com","xhamster1.*","xhamster2.*","xhamster3.*","xhamster4.*","xhamster5.*","xhamster7.*","xhamster8.*","xhmoon5.com","xhreal2.com","xhreal3.com","xhtotal.com","xhwide5.com","xmalay1.net","xnxxcom.xyz","xpshort.com","yesmovies.*","youtube.com","yumeost.net","yxztalk.com","zagreb.info","zch-vip.com","zonatmo.com","10beasts.com","10scopes.com","123-movies.*","1500days.com","16powers.com","1911talk.com","1dogwoof.com","247tempo.com","2xkofire.com","3dshoots.com","411mania.com","46matome.net","4archive.org","4btswaps.com","4filming.com","50states.com","68forums.com","700rifle.com","718forum.com","720pstream.*","723qrh1p.fun","7hitmovies.*","8thcivic.com","976-tuna.com","992forum.com","99sounds.org","9to5toys.com","aamulehti.fi","acrforum.com","adricami.com","afamuche.com","airfried.com","akinator.com","alecooks.com","alexsports.*","alexsportz.*","allcoast.com","alleydog.com","allmovie.com","allmusic.com","allplayer.tk","allsides.com","alphamom.com","amish365.com","andianne.com","angrybbq.com","anihatsu.com","animefire.io","animesanka.*","animixplay.*","antiadtape.*","antonimos.de","api.webs.moe","apkship.shop","appsbull.com","appsmodz.com","arolinks.com","artforum.com","ash-eats.com","ashbaber.com","askim-bg.com","at4forum.com","atchers.news","atertemp.org","atglinks.com","audiforum.us","audiolgy.com","autoc-one.jp","avforums.com","avidgamer.gg","avseesee.com","avsforum.com","babylinks.in","bakerita.com","bamgosu.site","bapetalk.com","barchart.com","begindot.com","belletag.com","bemyhole.com","benandme.com","benzinga.com","beruang.club","bestiefy.com","bevcooks.com","bigtimer.net","bikeexif.com","bikemunk.com","bikeride.com","biovetro.net","birdurls.com","bitsearch.to","blackmod.net","blifaloo.com","blogmura.com","boatsafe.com","bokepindoh.*","bokepnya.com","boltbeat.com","bookszone.in","boysahoy.com","brawlify.com","breaddad.com","brobible.com","brupload.net","btcbunch.com","btvsports.my","bubbapie.com","buffzone.com","buzzfeed.com","bz-berlin.de","bzforums.com","cakewhiz.com","capoplay.net","carlocao.com","carparts.com","casthill.net","catcrave.com","catfish1.com","catforum.com","catvills.com","cesoirtv.com","chaos2ch.com","chatango.com","chefalli.com","cheftalk.com","chevyzr2.com","chindeep.com","chopchat.com","choralia.net","chrforums.uk","chrono.quest","cima4u.forum","citefast.com","classpop.com","clickapi.net","cnevpost.com","cobaltss.com","codeshack.io","coingraph.us","cookierun.gg","country94.ca","cozymeal.com","crazyblog.in","cricstream.*","cricwatch.io","crinacle.com","crzforum.com","cuevana3.fan","curlsbot.com","cushyspa.com","cx30talk.com","cx3forum.com","d-series.org","daddylive1.*","dailydot.com","dailykos.com","dailylol.com","datawav.club","deadline.com","diethood.com","divicast.com","divxtotal1.*","dizikral.com","dogforum.com","dokoembed.pw","donbalon.com","doodskin.lat","doodstream.*","doubtnut.com","doujindesu.*","dpreview.com","dropbang.net","dropgalaxy.*","ds2video.com","dutchycorp.*","eatcells.com","ecamrips.com","edaily.co.kr","egyanime.com","embedtv.best","engadget.com","esportivos.*","estrenosgo.*","etoday.co.kr","ev-times.com","evernia.site","exceljet.net","exe-urls.com","expertvn.com","f6cforum.com","factable.com","falatron.com","famivita.com","fansided.com","fapptime.com","feed2all.org","fetchpik.com","fiestast.net","fiestast.org","filecrypt.cc","filmizletv.*","filmyzilla.*","flexyhit.com","flickzap.com","flizmovies.*","fmoonembed.*","focaljet.com","focus4ca.com","footybite.to","fordtough.ca","forexrw7.com","freeproxy.io","freeride.com","freeroms.com","freewsad.com","fullboys.com","fullhdfilm.*","funnyand.com","futabanet.jp","game4you.top","gaysex69.net","gcaptain.com","gekiyaku.com","gencoupe.com","genelify.com","gerbeaud.com","getcopy.link","godzcast.com","gofucker.com","golf-live.at","gosexpod.com","gsxs1000.org","gtoforum.com","gulflive.com","gvforums.com","haafedk2.com","hacchaka.net","handirect.fr","hdmovies23.*","hdstream.one","hentai4f.com","hentais.tube","hentaitk.net","hentaitv.fun","hes-goals.io","hikaritv.xyz","hiperdex.com","hipsonyc.com","hm4tech.info","hoodsite.com","hotmama.live","hrvforum.com","huntress.com","hvacsite.com","iambaker.net","ibelieve.com","ibsgroup.org","ihdstreams.*","imagefap.com","impreza5.com","impreza6.com","incestflix.*","instream.pro","intro-hd.net","itainews.com","ixforums.com","jablickar.cz","jav-noni.org","javporn.best","javtiful.com","jenismac.com","jikayosha.jp","jiofiles.org","jkowners.com","jobsheel.com","jp-films.com","k5owners.com","kasiporn.com","kazefuri.net","kfx450hq.com","kimochi.info","kin8-jav.com","kinemania.tv","kitizawa.com","kkscript.com","klouderr.com","klrforum.com","krxforum.com","ktmatvhq.com","kunmanga.com","kuponigo.com","kusonime.com","kwithsub.com","kyousoku.net","lacuarta.com","latinblog.tv","lawnsite.com","layitlow.com","legacygt.org","legendas.dev","legendei.net","lessdebt.com","lewdgames.to","liddread.com","linkedin.com","linkshorts.*","live4all.net","livedoor.biz","lostsword.gg","ltr450hq.com","luluvdoo.com","lxforums.com","m14forum.com","macworld.com","mafiatown.pl","mamahawa.com","mangafire.to","mangoporn.co","mangovideo.*","maqal360.com","masscops.com","masslive.com","matacoco.com","mbeqclub.com","mealcold.com","mediaite.com","mega-mkv.com","mg-rover.org","mhdtvworld.*","migweb.co.uk","milfmoza.com","mirror.co.uk","missyusa.com","mixiporn.fun","mkcforum.com","mkvcinemas.*","mkzforum.com","mmaforum.com","mmamania.com","mmastream.me","mmsbee27.com","mmsbee42.com","mmsbee47.com","modocine.com","modrinth.com","modsbase.com","modsfire.com","momsdish.com","mooonten.com","moredesi.com","motor-fan.jp","moviedokan.*","moviekids.tv","moviesda9.co","moviesflix.*","moviesmeta.*","moviespapa.*","movieweb.com","mvagusta.net","myaudiq5.com","myflixerz.to","mykitsch.com","mytiguan.com","nanolinks.in","nbadraft.net","ncangler.com","neodrive.xyz","neowners.com","netatama.net","newatlas.com","newninja.com","newsyou.info","neymartv.net","niketalk.com","nontongo.win","norisoku.com","novelpdf.xyz","novsport.com","npb-news.com","nugglove.com","nzbstars.com","o2tvseries.*","observer.com","oilprice.com","oricon.co.jp","otherweb.com","ovagames.com","paktech2.com","pandadoc.com","paste.bin.sx","paw-talk.net","pennlive.com","photopea.com","pigforum.com","planet-9.com","playertv.net","plowsite.com","porn-pig.com","porndish.com","pornfits.com","pornleaks.in","pornobr.club","pornwatch.ws","pornwish.org","pornxbit.com","pornxday.com","poscitechs.*","powerpyx.com","pptvhd36.com","prcforum.com","pressian.com","programme.tv","pubfilmz.com","publicearn.*","pwcforum.com","qyiforum.com","r1-forum.com","r1200gs.info","r2forums.com","r6-forum.com","r7forums.com","r9riders.com","rainmail.xyz","ramrebel.org","rapelust.com","ratforum.com","razzball.com","recosoku.com","redecanais.*","reelmama.com","regenzi.site","riftbound.gg","rlxforum.com","ronaldo7.pro","roporno.info","rotowire.com","rustorka.com","rustorka.net","rustorka.top","rvtrader.com","rxforums.com","rxtuners.com","ryaktive.com","rzforums.com","s10forum.com","saablink.net","sbnation.com","scribens.com","seirsanduk.*","sexgay18.com","shahee4u.cam","sheknows.com","shemale6.com","shrtslug.biz","sidereel.com","sinonimos.de","slashdot.org","slkworld.com","snapinsta.to","snlookup.com","snowbreak.gg","sodomojo.com","sonixgvn.net","speedporn.pw","spielfilm.de","sportea.link","sportico.com","sportnews.to","sportshub.to","sportskart.*","spreaker.com","ssforums.com","stayglam.com","stbturbo.xyz","stream18.net","stream25.xyz","streambee.to","streamhls.to","streamtape.*","stylebook.de","sugarona.com","swiftload.io","syracuse.com","szamoldki.hu","tabooporn.tv","tabootube.to","talkford.com","tapepops.com","tchatche.com","techawaaz.in","techdico.com","technons.com","teleclub.xyz","teluguflix.*","terra.com.br","texas4x4.org","thehindu.com","themezon.net","theverge.com","thurrott.com","toonhub4u.me","topdrama.net","torrage.info","torrents.vip","tradtalk.com","trailvoy.com","trendyol.com","tucinehd.com","turbobif.com","turbobit.net","turbobits.cc","turbovid.vip","tusfiles.com","tutlehd4.com","tv247us.live","tvappapk.com","tvpclive.com","tvtropes.org","twospoke.com","uk-audis.net","uk-mkivs.net","ultraten.net","umamusume.gg","unblocked.id","unblocknow.*","unefemme.net","uploadbuzz.*","uptodown.com","userupload.*","vault76.info","veloster.org","vertigis.com","videowood.tv","videq.stream","vidnest.live","vidsaver.net","vidtapes.com","vnjpclub.com","volokit2.com","vpcxz19p.xyz","vwidtalk.com","vwvortex.com","watchporn.to","wattedoen.be","webcamera.pl","westword.com","whatgame.xyz","winfuture.de","wqstreams.tk","www.google.*","x-video.tube","xcrforum.com","xhaccess.com","xhadult2.com","xhadult3.com","xhamster10.*","xhamster11.*","xhamster12.*","xhamster13.*","xhamster14.*","xhamster15.*","xhamster16.*","xhamster17.*","xhamster18.*","xhamster19.*","xhamster20.*","xhamster42.*","xhdate.world","xitongku.com","xlrforum.com","xmowners.com","xopenload.me","xopenload.pw","xpornium.net","xtglinks.com","xtratime.org","xxxstream.me","youboxtv.com","youpouch.com","youswear.com","yunjiema.top","z06vette.com","zakzak.co.jp","zerocoin.top","zootube1.com","zrvforum.com","zvision.link","zxforums.com","1000logos.net","123movieshd.*","123moviesla.*","123moviesme.*","123movieweb.*","124spider.org","1911forum.com","1bitspace.com","200forums.com","21dayhero.com","247sports.com","247wallst.com","30seconds.com","350z-tech.com","355nation.net","3dsourced.com","4c-forums.com","4horlover.com","4kwebplay.xyz","4xeforums.com","560pmovie.com","680thefan.com","6hiidude.gold","6thgenram.com","7fractals.icu","7vibelife.com","7yearolds.com","919thebend.ca","abc17news.com","abhijith.page","aboutamom.com","ac3filter.net","acatholic.org","aceforums.net","actusports.eu","adblocktape.*","addapinch.com","advertape.net","aeblender.com","aeclectic.net","aiimgvlog.fun","airforums.com","alexsportss.*","alfaowner.com","alicedias.com","allnurses.com","allourway.com","allthings.how","altdriver.com","ana-white.com","anhsexjav.xyz","anime-jav.com","animeunity.to","aotonline.org","apex2nova.com","apexbikes.com","apkdelisi.net","apkmirror.com","appkamods.com","arabahjoy.com","arcaneeye.com","arframe.today","artribune.com","aseaofred.com","ashandpri.com","asiaontop.com","askpython.com","astyleset.com","atchuseek.com","atv-forum.com","atvtrader.com","audiomack.com","audiotips.com","aupacanow.com","authority.pub","autofrage.net","avcrempie.com","azlinamin.com","b15sentra.net","babyfoode.com","bacasitus.com","badmouth1.com","bakedbree.com","bakedlean.com","bakinghow.com","bassisthq.com","bcaquaria.com","beatsnoop.com","beautygab.com","beesource.com","beinmatch.fit","bellyfull.net","belowporn.com","benzforum.com","benzworld.org","bestfonts.pro","bethbryan.com","bethcakes.com","bettafish.com","bftactics.com","bighentai.org","bigsoccer.com","bikinbayi.com","billboard.com","birdforum.net","birdzilla.com","bitcosite.com","bitdomain.biz","bitsmagic.fun","bizapedia.com","blissonly.com","bluetraxx.com","bobbyberk.com","bocopreps.com","bokepindo13.*","bokugents.com","boundless.com","boxentriq.com","boxing247.com","boxofpuns.com","brainmass.com","brasshero.com","bravedown.com","briefeguru.de","briefly.co.za","buelltalk.com","buffstreams.*","builtlean.com","bullion.forum","bunnylady.com","busycooks.com","bydeannyd.com","c.newsnow.com","c10trucks.com","caferacer.net","cake-babe.com","cakesbymk.com","callofwar.com","camdigest.com","camgirls.casa","canadabuzz.ca","canlikolik.my","capo6play.com","carscoops.com","carshtuff.com","cat-world.com","cathydiep.com","cavsdaily.com","cbssports.com","cccam4sat.com","cellphones.ca","chanto.jp.net","chazhound.com","cheater.ninja","chefsavvy.com","chevelles.com","chevybolt.org","chilimath.com","chumplady.com","chunkbase.com","cinema.com.my","cinetrafic.fr","cladright.com","cleanmama.com","cleveland.com","cloudvideo.tv","club700xx.com","clubtitan.org","codec.kyiv.ua","codelivly.com","coin-free.com","coins100s.fun","coltforum.com","columbian.com","concomber.com","cookeatgo.com","cooktoria.com","coolcast2.com","corsa-c.co.uk","corvsport.com","createlet.com","createyum.com","cricstream.me","cruciverba.it","cruzetalk.com","crypto4yu.com","ctinsider.com","cupofzest.com","currytrail.in","cx70forum.com","cx90forum.com","cxissuegk.com","daddylivehd.*","dailynews.com","darkmahou.org","darntough.com","dayspedia.com","depvailon.com","dfwstangs.net","dizikral1.pro","dizikral2.pro","dodgetalk.com","dogforums.com","dooodster.com","downfile.site","dphunters.mom","dragonball.gg","dragontea.ink","drivenime.com","e2link.link>>","ebonybird.com","egitim.net.tr","elantraxd.com","eldingweb.com","elevenlabs.io","embdproxy.xyz","embedwish.com","encurtads.net","encurtalink.*","eplayer.click","erothots1.com","esladvice.com","ethearmed.com","etoland.co.kr","evotuners.net","ex90forum.com","exawarosu.net","exe-links.com","exploader.net","extramovies.*","extrem-down.*","fanfiktion.de","fastreams.com","fastupload.io","fc2ppv.stream","fenixsite.net","fileszero.com","filmibeat.com","filmnudes.com","filthy.family","fjcforums.com","fjrowners.com","flixhouse.com","flyfaucet.com","flyfishbc.com","fmachines.com","focusrsoc.com","focusstoc.com","fordgt500.com","freebie-ac.jp","freeomovie.to","freeshot.live","fromwatch.com","fsiblog3.club","fsicomics.com","fsportshd.xyz","fuckingfast.*","funker530.com","furucombo.app","gamesmain.xyz","gamingguru.fr","gamovideo.com","geekchamp.com","geoguessr.com","gifu-np.co.jp","giornalone.it","glaowners.com","glcforums.com","globalrph.com","glocktalk.com","golfforum.com","gopitbull.com","governing.com","gputrends.net","grantorrent.*","gromforum.com","gunboards.com","gundamlog.com","gunforums.net","gutefrage.net","h-donghua.com","hb-nippon.com","hdfungamezz.*","helpmonks.com","hentaipig.com","hentaivost.fr","hentaixnx.com","hesgoal-tv.io","hexupload.net","hilites.today","hispasexy.org","hobbytalk.com","hondagrom.net","honkailab.com","hornylips.com","hoyoverse.com","huntingpa.com","hvac-talk.com","hwbusters.com","ibtimes.co.in","igg-games.com","ikonforum.com","ilxforums.com","indiewire.com","inkvoyage.xyz","inutomo11.com","investing.com","ipalibrary.me","iq-forums.com","itdmusics.com","itmedia.co.jp","itunesfre.com","javsunday.com","jeepforum.com","jimdofree.com","jisakuhibi.jp","jkdamours.com","jobzhub.store","joongdo.co.kr","judgehype.com","justwatch.com","k900forum.com","kahrforum.com","kamababa.desi","kckingdom.com","khoaiphim.com","kijyokatu.com","kijyomita.com","kirarafan.com","kolnovel.site","kotaro269.com","krepsinis.net","krussdomi.com","ktmforums.com","kurashiru.com","lek-manga.net","lifehacker.jp","likemanga.ink","listar-mc.net","liteshort.com","livecamrips.*","livecricket.*","livedoor.blog","lmtonline.com","lotustalk.com","love4porn.com","lowellsun.com","m.inven.co.kr","macheclub.com","madaradex.org","majikichi.com","makeuseof.com","malaymail.com","mandatory.com","mangacrab.org","mangoporn.net","manofadan.com","marvel.church","md3b0j6hj.com","mdfx9dc8n.net","mdy48tn97.com","melangery.com","metin2hub.com","mhdsportstv.*","mhdtvsports.*","microsoft.com","minoplres.xyz","mixdrop21.net","mixdrop23.net","mixdropjmk.pw","mlbstreams.ai","mmsmasala.com","mobalytics.gg","mobygames.com","momtastic.com","mothering.com","motor-talk.de","motorgeek.com","moutogami.com","moviekhhd.biz","moviepilot.de","moviesleech.*","moviesverse.*","movieswbb.com","moviezwaphd.*","mp-pistol.com","mp4upload.com","multicanais.*","musescore.com","mx30forum.com","myfastgti.com","myflixertv.to","mygolfspy.com","myhomebook.de","myonvideo.com","myvidplay.com","myyouporn.com","mzansifun.com","nbcsports.com","neoseeker.com","newbeetle.org","newcelica.org","newcougar.org","newstimes.com","nexusmods.com","nflstreams.me","nft-media.net","nicomanga.com","nihonkuni.com","nl.pepper.com","nmb48-mtm.com","noblocktape.*","nordbayern.de","nouvelobs.com","novamovie.net","novelhall.com","nsjonline.com","o2tvseriesz.*","odiadance.com","onplustv.live","operawire.com","otonanswer.jp","ottawasun.com","overclock.net","ozlosleep.com","pagalworld.cc","painttalk.com","pandamovie.in","patrol4x4.com","pc-builds.com","pearforum.com","peliculas24.*","pelisflix20.*","perchance.org","petitfute.com","picdollar.com","pillowcase.su","piloteers.org","pinkueiga.net","pirate4x4.com","pirateiro.com","pitchfork.com","pkbiosfix.com","planet4x4.net","pnwriders.com","porn4fans.com","pornblade.com","pornfelix.com","pornhoarder.*","pornobr.ninja","pornofaps.com","pornoflux.com","pornredit.com","poseyoung.com","posterify.net","pottsmerc.com","pravda.com.ua","proboards.com","profitline.hu","ptcgpocket.gg","puckermom.com","punanihub.com","pvpoke-re.com","pwctrader.com","pwinsider.com","qqwebplay.xyz","quesignifi.ca","r125forum.com","r3-forums.com","ramforumz.com","rarethief.com","raskakcija.lt","rav4world.com","read.amazon.*","redketchup.io","references.be","reliabletv.me","respublika.lt","reviewdiv.com","reviveusa.com","rhinotalk.net","riggosrag.com","rnbxclusive.*","roadglide.org","rockdilla.com","rojadirecta.*","roleplayer.me","rootzwiki.com","rostercon.com","roystream.com","rswarrior.com","rugertalk.com","rumbunter.com","rzrforums.net","s3embtaku.pro","saabscene.com","saboroso.blog","sarforums.com","savefiles.com","scatkings.com","set.seturl.in","sexdicted.com","sexiezpix.com","shahed-4u.day","shahhid4u.cam","sharemods.com","sharkfish.xyz","shemaleup.net","shipin188.com","shoebacca.com","shorttrick.in","silverblog.tv","silverpic.com","simana.online","sinemalar.com","sinsitio.site","skymovieshd.*","slotforum.com","smartworld.it","snackfora.com","snapwordz.com","socceron.name","socialblog.tv","softarchive.*","songfacts.com","sparktalk.com","speedporn.net","speedwake.com","speypages.com","sportbar.live","sportshub.fan","sportsrec.com","sporttunatv.*","sr20forum.com","srtforums.com","stackmint.ink","starstyle.com","steyrclub.com","strcloud.club","strcloud.site","streampoi.com","streamporn.li","streamporn.pw","streamsport.*","streamta.site","streamvid.net","sulleiman.com","sumax43.autos","sushiscan.net","sv-portal.com","swissotel.com","t-goforum.com","taboosex.club","talksport.com","tamilarasan.*","tapenoads.com","techacode.com","techbloat.com","techradar.com","tempinbox.xyz","tennspeed.net","thekitchn.com","thelayoff.com","themgzr.co.uk","thepoke.co.uk","thothub.today","tidalfish.com","tiermaker.com","timescall.com","titantalk.com","tlnovelas.net","tlxforums.com","tokopedia.com","tokyocafe.org","topcinema.cam","torrentz2eu.*","torupload.com","totalcsgo.com","tourbobit.com","tourbobit.net","tpb-proxy.xyz","trailerhg.xyz","trangchu.news","transflix.net","travelbook.de","traxforum.com","tremamnon.com","trigonevo.com","trilltrill.jp","truthlion.com","trxforums.com","ttforum.co.uk","turbobeet.net","turbobita.net","turksub24.net","tweaktown.com","twstalker.com","ukcorsa-d.com","umamigirl.com","unblockweb.me","uniqueten.net","unlockxh4.com","up4stream.com","uploadboy.com","varnascan.xyz","vegamoviies.*","velostern.com","vibestreams.*","vid-guard.com","vidspeeds.com","vipstand.pm>>","vitamiiin.com","vladrustov.sx","vnexpress.net","voicenews.com","volkszone.com","vosfemmes.com","vpnmentor.com","vstorrent.org","vtubernews.jp","vweosclub.com","watchseries.*","web.skype.com","webcamrips.to","webxzplay.cfd","winbuzzer.com","wisevoter.com","wltreport.com","wolverdon.fun","wordhippo.com","worldsports.*","worldstar.com","wowstreams.co","wstream.cloud","www.iqiyi.com","xc40forum.com","xcamcovid.com","xfforum.co.uk","xhbranch5.com","xhchannel.com","xhlease.world","xhplanet1.com","xhplanet2.com","xhvictory.com","xhwebsite.com","xopenload.net","xxvideoss.org","xxxfree.watch","xxxscenes.net","xxxxvideo.uno","zdxowners.com","zorroplay.xyz","zotyezone.com","zx4rforum.com","123easy4me.com","123movieshub.*","300cforums.com","300cforumz.com","3dinosaurs.com","3dporndude.com","3rooodnews.net","42droids.co.uk","4gamers.com.tw","50isnotold.com","5boysbaker.com","7thmustang.com","99boulders.com","9to5google.com","a1-forum.co.uk","aboderie.co.uk","activewild.com","actu.orange.fr","actugaming.net","acuraworld.com","adimesaved.com","aerocorner.com","aerotrader.com","afeelachat.com","agoudalife.com","ahoramismo.com","aihumanizer.ai","ak47sports.com","akaihentai.com","akb48glabo.com","alexsports.*>>","alfalfalfa.com","aline-made.com","allcorsa.co.uk","alletbliss.com","alliecarte.com","allmovieshub.*","allrecipes.com","allthesvgs.com","alpineella.com","amanguides.com","amateurblog.tv","americanwx.com","anagrammer.com","andercooks.com","anerdcooks.com","animalspot.net","animeblkom.net","animefire.plus","animesaturn.cx","animespire.net","anymoviess.xyz","ar15forums.com","arcticchat.com","armslocker.com","arrmaforum.com","artbarblog.com","artoffocas.com","artsymomma.com","ashemaletube.*","astro-seek.com","astrostyle.com","at4xowners.com","atchfreeks.com","atvtorture.com","automoblog.net","avpcentral.com","azbasszone.com","babaganosh.org","baby-chick.com","balkanteka.net","bamahammer.com","bbqdryrubs.com","beautymone.com","bersaforum.com","bestplants.com","bgmiconfig.ink","bhugolinfo.com","biddytarot.com","bikesmarts.com","bimmerfest.com","bingotingo.com","birdnature.com","birdsphere.com","bitcotasks.com","blackwidof.org","blizzpaste.com","blogghetti.com","blogilates.com","blogmickey.com","blogofdoom.com","blondelish.com","bluearchive.gg","bluetracker.gg","bmw-driver.net","bmwevforum.com","boersennews.de","bookseries.org","boozyburbs.com","boredpanda.com","boxthislap.org","brainknock.net","britannica.com","broncozone.com","bsugarmama.com","btcsatoshi.net","btvsports.my>>","buceesfans.com","buchstaben.com","burgmanusa.com","butterhand.com","cafehailee.com","cakenknife.com","calfkicker.com","calgarysun.com","camarozone.com","camberlion.com","campaddict.com","campendium.com","can-amtalk.com","card-codex.com","carlaaston.com","carrnissan.com","cavsnation.com","celebitchy.com","cgdirector.com","cheatsheet.com","chefdehome.com","chefdenise.com","chelsweets.com","choco0202.work","cindermint.com","cine-calidad.*","cl500forum.com","clashdaddy.com","clashdaily.com","clicknupload.*","cloudvideotv.*","clubarmada.com","clubsearay.com","clubxterra.org","cncsourced.com","cocoandash.com","code9media.com","coleycooks.com","combotarot.com","comicleaks.com","comicsands.com","comicyears.com","cooksdream.com","coolcrafts.com","coolrom.com.au","cosplay18.pics","crackberry.com","cracksports.me","crazylaura.com","crespomods.com","cretaforum.com","cricstreams.re","cricwatch.io>>","crisanimex.com","cruisehive.com","crunchyscan.fr","ctsvowners.com","cuevana3hd.com","cumception.com","cupofflour.org","curlynikki.com","curseforge.com","cwbchicago.com","cx500forum.com","cx50forums.com","dailylocal.com","dailypress.com","dailysurge.com","dailyvoice.com","danseisama.com","dealsforum.com","deckbandit.com","delcotimes.com","denverpost.com","derstandard.at","derstandard.de","designbump.com","desiremovies.*","digitalhome.ca","dodge-dart.org","dodgersway.com","dofusports.xyz","dolldivine.com","dpselfhelp.com","dragonnest.com","dramabeans.com","ecranlarge.com","eigachannel.jp","eldiariony.com","elotrolado.net","embedsports.me","embedstream.me","emilybites.com","empire-anime.*","emturbovid.com","epaceforum.com","erayforums.com","esportbike.com","estrenosflix.*","estrenosflux.*","eurekaddl.baby","evoxforums.com","expatforum.com","extreme-down.*","f-typeclub.com","f150forumz.com","f800riders.org","faselhdwatch.*","femdom-joi.com","femestella.com","fiestastoc.com","filmizleplus.*","filmy4waps.org","fireblades.org","fishforums.com","fiskerbuzz.com","fitdynamos.com","fixthecfaa.com","flostreams.xyz","fm.sekkaku.net","foodtechnos.in","fordescape.org","fordforums.com","fordranger.net","forex-trnd.com","formyanime.com","forteturbo.org","forumchat.club","foxyfolksy.com","fpaceforum.com","freepasses.org","freetvsports.*","fstream365.com","fuckflix.click","furyforums.com","fz-10forum.com","g310rforum.com","gamefishin.com","gamepcfull.com","gameshop4u.com","gamingfora.com","gayforfans.com","gaypornhot.com","gearpatrol.com","gecmisi.com.tr","gemstreams.com","getfiles.co.uk","gettapeads.com","gknutshell.com","glockforum.com","glockforum.net","gmfullsize.com","goalsport.info","gofilmizle.com","golfdigest.com","golfstreams.me","goodreturns.in","gr-yaris.co.uk","gravureblog.tv","gtaaquaria.com","guitars101.com","gujjukhabar.in","gunandgame.com","gyanitheme.com","hauntforum.com","hdfilmsitesi.*","hdmoviesfair.*","hdmoviesflix.*","hdpornflix.com","healthmyst.com","hentai-sub.com","hentaihere.com","hentaiworld.tv","hesgoal-vip.io","hesgoal-vip.to","hinatasoul.com","hindilinks4u.*","hindimovies.to","hinoforums.com","hondatwins.net","horseforum.com","hotgranny.live","hotrodders.com","hotukdeals.com","hummerchat.com","hwnaturkya.com","imgtraffic.com","indiatimes.com","infinitifx.org","infogenyus.top","inshorturl.com","insidehook.com","ioniqforum.com","ios.codevn.net","iplayerhls.com","iplocation.net","isabeleats.com","isekaitube.com","itaishinja.com","itsuseful.site","javatpoint.com","javggvideo.xyz","javsubindo.com","javtsunami.com","jdfanatics.com","jeepgarage.org","jizzbunker.com","joemonster.org","joyousplay.xyz","jpaceforum.com","jpopsingles.eu","jukeforums.com","jyoseisama.com","k1600forum.com","kakarotfoot.ru","kanyetothe.com","katoikos.world","kawiforums.com","kia-forums.com","kickassanime.*","kijolariat.net","kimbertalk.com","kompasiana.com","ktmforum.co.uk","leaderpost.com","leahingram.com","letterboxd.com","lifehacker.com","liliputing.com","link.vipurl.in","liquipedia.net","listendata.com","localnews8.com","lokhung888.com","low-riders.com","lulustream.com","m.edaily.co.kr","m.shuhaige.net","m109riders.com","macanforum.com","mactechnews.de","mahajobwala.in","mahitimanch.in","majestyusa.com","makemytrip.com","malluporno.com","mangareader.to","manhwaclub.net","manutdtalk.com","marcialhub.xyz","mastkhabre.com","mazda6club.com","mazdaworld.org","meusanimes.net","microskiff.com","minitorque.com","mkv-pastes.com","mondeostoc.com","morikinoko.com","motogpstream.*","motorgraph.com","motorsport.com","motscroises.fr","moviebaztv.com","movies2watch.*","mtc3.jobsvb.in","mumuplayer.com","mundowuxia.com","musketfire.com","my.irancell.ir","myeasymusic.ir","mymbonline.com","nana-press.com","naszemiasto.pl","newmovierulz.*","newnissanz.com","news-buzz1.com","news30over.com","newscionxb.com","newtiburon.com","nhregister.com","ninernoise.com","niocarclub.com","nissanclub.com","nookgaming.com","nowinstock.net","nv200forum.com","nyfirearms.com","o2tvseries.com","ocregister.com","ohsheglows.com","onecall2ch.com","onlyfaucet.com","oregonlive.com","originporn.com","orovillemr.com","outbackers.com","pandamovies.me","pandamovies.pw","pandaspor.live","pantrymama.com","paste-drop.com","pastemytxt.com","pathofexile.gg","pelando.com.br","pencarian.link","petitrobert.fr","pinchofyum.com","pipandebby.com","piratefast.xyz","play-games.com","playcast.click","playhydrax.com","playingmtg.com","playtube.co.za","populist.press","pornhd720p.com","pornincest.net","pornohexen.com","pornstreams.co","powerover.site","preisjaeger.at","priusforum.com","projeihale.com","proxyninja.org","psychobike.com","q2forums.co.uk","qiqitvx84.shop","quest4play.xyz","rabbitdogs.net","ramblinfan.com","ramevforum.com","rc350forum.com","rc51forums.com","record-bee.com","reisefrage.net","remixsearch.es","ripplehub.site","rnbxclusive0.*","rnbxclusive1.*","robaldowns.com","robbreport.com","romancetv.site","rt3dmodels.com","rubyvidhub.com","rugbystreams.*","rugerforum.net","runeriders.com","rupyaworld.com","safefileku.com","sakurafile.com","sandrarose.com","saratogian.com","section215.com","seoschmiede.at","serienstream.*","severeporn.com","sextubebbw.com","sexvideos.host","sgvtribune.com","shadowverse.gg","shark-tank.com","shavetape.cash","shemaleraw.com","shoot-yalla.me","siennachat.com","sigarms556.com","singjupost.com","sizecharts.net","skidrowcpy.com","slatedroid.com","slickdeals.net","slideshare.net","smallencode.me","socceronline.*","softairbay.com","solanforum.com","soldionline.it","soranews24.com","soundcloud.com","speedostream.*","speedzilla.com","speisekarte.de","spieletipps.de","sportbikes.net","sportsurge.net","spyderchat.com","spydertalk.com","srt10forum.com","srt4mation.com","ssrfanatic.com","stbemuiptv.com","stocktwits.com","streamflash.sx","streamkiste.tv","streamruby.com","stripehype.com","studyfinds.org","superhonda.com","supexfeeds.com","swatchseries.*","swedespeed.com","swipebreed.net","swordalada.org","tamilprinthd.*","taosforums.com","tarokforum.com","taurusclub.com","tbssowners.com","techcrunch.com","techyorker.com","teksnologi.com","tempmail.ninja","thatgossip.com","theakforum.net","thefitchen.com","thehayride.com","themarysue.com","thenerdyme.com","thepiratebay.*","theporngod.com","theshedend.com","timesunion.com","tinxahoivn.com","tomarnarede.pt","tonaletalk.com","topsporter.net","tormalayalam.*","torontosun.com","torrsexvid.com","totalsportek.*","tournguide.com","toyokeizai.net","tracktheta.com","trafficnews.jp","trannyteca.com","trentonian.com","triumph675.net","triumphrat.net","troyrecord.com","tundratalk.net","turbocloud.xyz","turbododge.com","tvs-widget.com","tvseries.video","tw200forum.com","twincities.com","uberpeople.net","ufaucet.online","ultrahorny.com","universalis.fr","urlbluemedia.*","userscloud.com","usmagazine.com","vagdrivers.net","vahantoday.com","veo-hentai.com","videocelts.com","vikistream.com","viperalley.com","visifilmai.org","viveseries.com","volvoforum.com","wallpapers.com","watarukiti.com","watch-series.*","watchomovies.*","watchpornx.com","webcamrips.com","weldingweb.com","wellplated.com","whodatdish.com","wielerflits.be","winclassic.net","wnynewsnow.com","worldsports.me","wort-suchen.de","worthcrete.com","wpdeployit.com","www-y2mate.com","www.amazon.com","xanimeporn.com","xc100forum.com","xclusivejams.*","xeforums.co.uk","xhofficial.com","xhwebsite5.com","xmegadrive.com","xxxbfvideo.net","yabaisub.cloud","yfzcentral.com","yourcobalt.com","yourupload.com","z1000forum.com","z125owners.com","zeroupload.com","zkillboard.com","zx25rforum.com","101planners.com","1911addicts.com","240sxforums.com","368chickens.com","3dprinterly.com","40plusstyle.com","4activetalk.com","4lessbyjess.com","4pics1-word.com","51bonusrummy.in","7daysofplay.com","7thgenhonda.com","899panigale.org","959panigale.net","9thgencivic.com","acadiaforum.net","accordxclub.com","acedarspoon.com","acemanforum.com","adrinolinks.com","adz7short.space","agoneerfans.com","agrodigital.com","airfryermom.com","airfryeryum.com","alandacraft.com","aliezstream.pro","all-nationz.com","allaboutami.com","alldownplay.xyz","allsoundlab.net","allucanheat.com","alonelylife.com","alphafoodie.com","amarokforum.com","amazingribs.com","amytreasure.com","anderworthy.com","androjungle.com","animalnerdz.com","anime-loads.org","animeshqip.site","animesultra.net","aniroleplay.com","antennaland.com","app-sorteos.com","aquariadise.com","archerytalk.com","archtoolbox.com","areaconnect.com","areweranked.com","ariyaforums.com","arstechnica.com","artistforum.com","artofmemory.com","astrosafari.com","at-my-table.com","aternitylab.com","audi-forums.com","audif1forum.com","audiotools.blog","audioz.download","audiq3forum.com","averiecooks.com","aviationa2z.com","avyhaircare.com","bahaiforums.com","bakeorbreak.com","bakerstable.net","baketobefit.com","bakingbites.com","bargainbabe.com","bballrumors.com","beanrecipes.com","beautysided.com","becomebetty.com","beehivehero.com","beinmatch1.live","bellezashot.com","bestofvegan.com","bethebudget.com","bettasource.com","beyerbeware.net","bharathwick.com","bikinitryon.net","billyparisi.com","bimmerwerkz.com","bitesofberi.com","bizjournals.com","blazersedge.com","bluegraygal.com","bluemanhoop.com","bluemediafile.*","bluemedialink.*","bluemediaurls.*","boatdriving.org","bobsvagene.club","bodyketosis.com","bokepsin.in.net","boldjourney.com","bollyflix.cards","bonnibakery.com","boogieforum.com","boxerforums.com","boxingdaily.com","boxingforum.com","boxingstream.me","brandeating.com","breederbest.com","brilian-news.id","bromabakery.com","bromefields.com","brutusforum.com","budgetbytes.com","buffstreams.app","build-basic.com","bulbagarden.net","bussyhunter.com","busytoddler.com","bylisafonde.com","c.newsnow.co.uk","caabcrochet.com","cafedelites.com","cakesprices.com","calculateme.com","can-amforum.com","canonrumors.com","canvasrebel.com","cardsayings.net","careeralley.com","carseatsmom.com","casadecrews.com","caseihforum.com","catological.com","cattleforum.com","cattletoday.com","cbr300forum.com","celebsuburb.com","celicasupra.com","cempakajaya.com","chalkbucket.com","chefjacooks.com","chefspencil.com","chemicalaid.com","cheneetoday.com","chevyblazer.org","chevytrucks.org","chewoutloud.com","chilitochoc.com","chollometro.com","chordsworld.com","cigarforums.net","cinemablind.com","cinenerdle2.app","cizgivedizi.com","cjponyparts.com","classbforum.com","classic-jdm.com","classicnerd.com","cleantheair.org","clubthrifty.com","clubtouareg.com","comfyliving.net","comicbasics.com","computerbild.de","connections.run","contextures.com","convertcase.net","coopcancook.com","copycatchic.com","copykatchat.com","cordneutral.net","cosmicdeity.com","cosplay-xxx.com","cowboysnews.com","cowboyszone.com","cozydiyhome.com","craftionary.net","creatordrop.com","criticalhit.net","crizyman.online","crochething.com","crohnsforum.com","crownforums.com","cruiseradio.net","cryptoearns.com","ct200hforum.com","ctx700forum.com","cubbiescrib.com","customtacos.com","cycleforums.com","cycletrader.com","cyndispivey.com","dailybreeze.com","dailycamera.com","dailyknicks.com","databazeknih.cz","dawindycity.com","dendroboard.com","diariovasco.com","dieseljeeps.com","dieselplace.com","digimonzone.com","digiztechno.com","disneyembed.wtf","diychatroom.com","dizipal1536.com","dizipal1537.com","dizipal1538.com","dizipal1539.com","dizipal1540.com","dizipal1541.com","dizipal1542.com","dizipal1543.com","dizipal1544.com","dizipal1545.com","dizipal1546.com","dizipal1547.com","dizipal1548.com","dizipal1549.com","dizipal1550.com","dizipal1551.com","dizipal1552.com","dizipal1553.com","dizipal1554.com","dizipal1555.com","dizipal1556.com","dizipal1557.com","dizipal1558.com","dizipal1559.com","dizipal1560.com","dizipal1561.com","dizipal1562.com","dizipal1563.com","dizipal1564.com","dizipal1565.com","dizipal1566.com","dizipal1567.com","dizipal1568.com","dizipal1569.com","dizipal1570.com","dizipal1571.com","dizipal1572.com","dizipal1573.com","dizipal1574.com","dizipal1575.com","dizipal1576.com","dizipal1577.com","dizipal1578.com","dizipal1579.com","dizipal1580.com","dizipal1581.com","dizipal1582.com","dizipal1583.com","dizipal1584.com","dizipal1585.com","dizipal1586.com","dizipal1587.com","dizipal1588.com","dizipal1589.com","dizipal1590.com","dizipal1591.com","dizipal1592.com","dizipal1593.com","dizipal1594.com","dizipal1595.com","dizipal1596.com","dizipal1597.com","dizipal1598.com","dizipal1599.com","dizipal1600.com","dl-protect.link","doctormalay.com","dodge-nitro.com","dogfoodchat.com","donnerwetter.de","dopomininfo.com","driveaccord.net","drywalltalk.com","e-tronforum.com","e46fanatics.com","ebaumsworld.com","ebookhunter.net","economist.co.kr","edmontonsun.com","egoallstars.com","elamigosweb.com","empire-stream.*","escape-city.com","esportivos.site","exactpay.online","expedition33.gg","expressnews.com","extrapetite.com","extratorrent.st","fcportables.com","fdownloader.net","ferrarilife.com","fgochaldeas.com","filmizleplus.cc","filmovitica.com","filmy4wap.co.in","financemonk.net","financewada.com","finanzfrage.net","fiveslot777.com","fizzlefacts.com","fizzlefakten.de","fmradiofree.com","footyhunter.lol","forteforums.com","framedcooks.com","freeairpump.com","freeconvert.com","freeomovie.info","freewebcart.com","fsportshd.xyz>>","fxstreet-id.com","fxstreet-vn.com","gameplayneo.com","gaminginfos.com","gamingsmart.com","gatorforums.net","gazetaprawna.pl","gen3insight.com","gentosha-go.com","geogridgame.com","gewinnspiele.tv","ghibliforum.com","girlscanner.org","girlsreport.net","gmtruckclub.com","godairyfree.org","gofile.download","goproforums.com","gowatchseries.*","gratispaste.com","greatandhra.com","gunnerforum.com","gut-erklaert.de","hamrojaagir.com","havocxforum.com","hdmp4mania2.com","hdstreamss.club","heavyfetish.com","hentaicovid.com","hentaiporno.xxx","hentaistream.co","heygrillhey.com","hiidudemoviez.*","hockeyforum.com","hollymoviehd.cc","hondashadow.net","hotcopper.co.nz","hummusapien.com","i-paceforum.com","idoitmyself.xyz","ilovetoplay.xyz","infinitiq30.org","infinitiq50.org","infinitiq60.org","infosgj.free.fr","instabiosai.com","integratalk.com","istreameast.app","jaguarforum.com","japangaysex.com","jaysjournal.com","jeepevforum.com","jeeppatriot.com","jettajunkie.com","juliasalbum.com","jumpsokuhou.com","kandiforums.com","kawieriders.com","keltecforum.com","khatrimazaful.*","kiaevforums.com","kickrunners.com","kiddyearner.com","kijyomatome.com","kkinstagram.com","komikdewasa.art","krakenfiles.com","kurashinista.jp","lakestclair.net","lamarledger.com","ldoceonline.com","lexusfforum.com","lifematome.blog","linkss.rcccn.in","livenewschat.eu","livesports4u.pw","livestreames.us","lombardiave.com","lordchannel.com","lucid-forum.com","lugerforums.com","lulustream.live","lumberjocks.com","luxury4play.com","lynkcoforum.com","macombdaily.com","mais.sbt.com.br","mamieastuce.com","mangoparody.com","marlinforum.com","marvelrivals.gg","matomeblade.com","matomelotte.com","mclarenlife.com","mediacast.click","medstudentz.com","meganesport.net","mentalfloss.com","mercedescla.org","mercurynews.com","metrisforum.com","miamiherald.com","minievforum.com","miniwebtool.com","mmsmasala27.com","mobilestalk.net","modernhoney.com","modistreams.org","monoschino2.com","motogpstream.me","mov18plus.cloud","movierulzlink.*","moviessources.*","msonglyrics.com","mtc1.jobtkz.com","musiclutter.xyz","myanimelist.net","nativesurge.net","naughtypiss.com","ncgunowners.com","news-herald.com","news.zerkalo.io","nflspinzone.com","niice-woker.com","ninetowners.com","nitroforumz.com","noindexscan.com","nomnompaleo.com","notebookcheck.*","novelssites.com","nowsportstv.com","nu6i-bg-net.com","nutmegnanny.com","nuxhallas.click","nydailynews.com","oceanforums.com","onihimechan.com","onlineweb.tools","ontvtonight.com","otoko-honne.com","ourcoincash.xyz","pandamovie.info","pandamovies.org","passatworld.com","paviseforum.com","pawastreams.pro","peliculasmx.net","pelisxporno.net","pepperlive.info","persoenlich.com","pervyvideos.com","petforums.co.uk","phillyvoice.com","phongroblox.com","picsxxxporn.com","pierandsurf.com","pilotonline.com","piratehaven.xyz","pisshamster.com","pistolsmith.com","pistolworld.com","planetminis.com","planetrugby.com","plantedtank.net","poodleforum.com","popdaily.com.tw","powergam.online","powerstroke.org","premiumporn.org","priusonline.com","projectfreetv.*","prowlertalk.net","punishworld.com","qatarstreams.me","r1200rforum.com","rallyforums.com","rangerovers.net","rank1-media.com","raptorforum.com","readbitcoin.org","readhunters.xyz","recon-forum.com","regalforums.com","remixsearch.net","reportera.co.kr","resizer.myct.jp","rhinoforums.net","riderforums.com","risingapple.com","rnbastreams.com","robloxforum.com","rodsnsods.co.uk","roofingtalk.com","rugbystreams.me","rustorkacom.lib","saabcentral.com","saikyo-jump.com","sampledrive.org","sat-sharing.com","saxontheweb.net","scr950forum.com","seadoospark.org","seir-sanduk.com","seltosforum.com","sfchronicle.com","shadowrangers.*","shemalegape.net","shortxlinks.com","showcamrips.com","sipandfeast.com","ske48matome.net","skinnytaste.com","skyroadster.com","slapthesign.com","smokinvette.com","smsonline.cloud","sneakernews.com","socceronline.me","souq-design.com","sourceforge.net","southhemitv.com","sports-stream.*","sportsonline.si","sportsseoul.com","sportzonline.si","stdrivers.co.uk","streamnoads.com","stripers247.com","stylecaster.com","sudokutable.com","suicidepics.com","supraforums.com","sweetie-fox.com","taikoboards.com","talkbudgies.com","talkparrots.com","tapeantiads.com","tapeblocker.com","tasteofhome.com","taurusarmed.net","tennisforum.com","tennisstreams.*","teryxforums.net","the5krunner.com","thebassbarn.com","theblueclit.com","thebullspen.com","thegoatspot.net","thegrowthop.com","thejetpress.com","themoviesflix.*","theporndude.com","theprovince.com","thereeftank.com","thereporter.com","thesexcloud.com","timesherald.com","tntsports.store","topstarnews.net","topstreams.info","totalsportek.to","toursetlist.com","tradingview.com","trgoals1526.xyz","trgoals1527.xyz","trgoals1528.xyz","trgoals1529.xyz","trgoals1530.xyz","trgoals1531.xyz","trgoals1532.xyz","trgoals1533.xyz","trgoals1534.xyz","trgoals1535.xyz","trgoals1536.xyz","trgoals1537.xyz","trgoals1538.xyz","trgoals1539.xyz","trgoals1540.xyz","trgoals1541.xyz","trgoals1542.xyz","trgoals1543.xyz","truthsocial.com","tuktukcinma.com","turbobuicks.com","turbovidhls.com","tutorgaming.com","tutti-dolci.com","ufcfight.online","uk-muscle.co.uk","ukaudiomart.com","underhentai.net","unite-guide.com","uploadhaven.com","uranai.nosv.org","usaudiomart.com","uwakitaiken.com","v-twinforum.com","v8sleuth.com.au","valhallas.click","vantasforum.com","vik1ngfile.site","vikingforum.net","vikingforum.org","vinfasttalk.com","vipsister23.com","viralharami.com","volconforum.com","vwt4forum.co.uk","watchf1full.com","watchhentai.net","watchxxxfree.pw","welovetrump.com","weltfussball.at","wericmartin.com","wetteronline.de","wieistmeineip.*","willitsnews.com","windroid777.com","windsorstar.com","winnipegsun.com","wizistreamz.xyz","wordcounter.icu","worldsports.*>>","writerscafe.org","www.hoyolab.com","www.youtube.com","xmoviesforyou.*","xxxparodyhd.net","xxxwebdlxxx.top","yamahaforum.com","yanksgoyard.com","yoursciontc.com","yrtourguide.com","zakuzaku911.com","100layercake.com","101cookbooks.com","101dogbreeds.com","104homestead.com","10fragrances.com","15worksheets.com","2coolfishing.com","3boysandadog.com","3dprinterful.com","4thgentacoma.com","5itemsorless.com","5letterwords.org","6thgenaccord.com","7173mustangs.com","790dukeforum.com","abrams-media.com","abraskitchen.com","aclassclub.co.uk","acouplecooks.com","acozykitchen.com","acrylgiessen.com","acura-legend.com","adblockstrtape.*","adblockstrtech.*","addicted2diy.com","adultstvlive.com","affordwonder.net","afrugalchick.com","ahadventures.com","ahaparenting.com","aheadofthyme.com","airflowforum.com","airfryerlove.com","aisleofshame.com","akeupandkale.com","aldireviewer.com","alexroblesmd.com","alisononfoot.com","allaboutjazz.com","alluringsoul.com","allyscooking.com","allyskitchen.com","almarsguides.com","alphahistory.com","altherforums.com","altimaforums.net","amiablefoods.com","amindfullmom.com","amiraspantry.com","amishamerica.com","amortization.org","amtraktrains.com","anderthewest.com","andhereweare.net","androidadult.com","animestotais.xyz","antennasports.ru","apeachyplate.com","apistogramma.com","appletoolbox.com","appunwrapper.com","aquatic-eden.com","aquietrefuge.com","arboristsite.com","archeryaddix.com","arteonforums.com","arzyelbuilds.com","ascensionlogs.gg","ascentforums.com","ashadeofteal.com","asianacircus.com","asyaanimeleri.pw","attagirlsays.com","audio-forums.com","autismforums.com","automatelife.net","avocadopesto.com","awickedwhisk.com","awortheyread.com","azurelessons.com","backfirstwo.site","backyarddigs.com","badgerowners.com","bakeandbacon.com","bakersroyale.com","baking-sense.com","bakingbeauty.net","baldandhappy.com","ball-pythons.net","bananamovies.org","baptistboard.com","barbarabakes.com","base64decode.org","bassmagazine.com","bcsportbikes.com","beatofhawaii.com","beautymunsta.com","bedbuglawyer.org","beesandroses.com","beingpatient.com","belquistwist.com","benelliforum.com","bestdesserts.com","bestgirlsexy.com","bestpornflix.com","betterwander.com","beyondcruise.com","bigbearswife.com","bigblockdart.com","bikersrights.com","biplaneforum.com","birdswatcher.com","bitzngiggles.com","blackandteal.com","blesserhouse.com","blog.esuteru.com","blog.livedoor.jp","blowgunforum.com","boardingarea.com","bogglewizard.net","bojongourmet.com","boldappetite.com","bonappeteach.com","bookanalysis.com","bootstrapbee.com","bostonherald.com","bostonscally.com","bowl-me-over.com","boxycolonial.com","brandbrief.co.kr","brownsnation.com","brutecentral.com","budgettravel.com","buffalowdown.com","buickevforum.com","buildgreennh.com","bunnymuffins.lol","bunsinmyoven.com","burtonavenue.com","busbysbakery.com","buzzfeednews.com","bytheforkful.com","c-classforum.com","cadenzaforum.com","cakescottage.com","calendarkart.com","cambreabakes.com","camperreport.com","campersmarts.com","campgrilleat.com","canalesportivo.*","caneswarning.com","caribbeanpot.com","carlmurawski.com","carolinaroad.com","castandspear.com","castironketo.net","catchmyparty.com","cbr500riders.com","cellocentral.com","chainsawtalk.com","chalkacademy.com","chambanamoms.com","charexempire.com","chartmasters.org","cheerfulcook.com","chefjonwatts.com","chelseadamon.com","cherokeesrt8.com","cherokeetalk.com","chevronlemon.com","cheyennechat.com","chickenforum.com","chiefsreport.com","chinese-pics.com","choosingchia.com","cincyshopper.com","civic11forum.com","clarityforum.com","cleanerstalk.com","cleaningtalk.com","clever-tanken.de","clickndownload.*","clickorlando.com","cloudynights.com","clubfrontier.org","clubroadster.net","clutchpoints.com","coffeeforums.com","coffeelevels.com","collective.world","coloradofans.com","coloredmanga.com","comidacaseira.me","computeruser.com","conniekresin.com","construct101.com","controlbooth.com","cookeatpaleo.com","cookeryspace.com","cookilicious.com","cookincanuck.com","cookingandme.com","cookingbride.com","cookrepublic.com","cooksimply.co.uk","cookthestory.com","cookwithdana.com","cosascaseras.com","costcontessa.com","cottercrunch.com","counterstats.net","countryguess.com","countryrebel.com","courseleader.net","cr7-soccer.store","cracksports.me>>","craftbeering.com","craftknights.com","craftsyhacks.com","cravethegood.com","cravingtasty.com","cricketforum.com","crosswordjam.net","crowsurvival.com","cruisegalore.com","crxcommunity.com","cryptofactss.com","ctx1300forum.com","culinaryhill.com","culturequizz.com","cumminsforum.com","cupfulofkale.com","curbingcarbs.com","cybercityhelp.in","cyclingabout.com","daciaforum.co.uk","dailyfreeman.com","dailytribune.com","dailyuploads.net","dakotaforumz.com","darknessporn.com","dartsstreams.com","dataunlocker.com","desertxforum.com","destiny2zone.com","detikkebumen.com","diavel-forum.com","diecastcrazy.com","dieselforums.com","directupload.net","dobermantalk.com","dodgedurango.net","dodgeevforum.com","donanimhaber.com","donghuaworld.com","down.dataaps.com","downloadrips.com","duramaxforum.com","eastbaytimes.com","ebikerforums.com","echelonforum.com","elantraforum.com","elantrasport.com","empire-streamz.*","enclaveforum.net","envistaforum.com","evoqueforums.net","explorertalk.com","f150ecoboost.net","familyporner.com","favoyeurtube.net","feedmephoebe.com","ferrari-talk.com","filecatchers.com","filespayouts.com","financacerta.com","firearmstalk.com","flagandcross.com","flatpanelshd.com","flyfishing.co.uk","football-2ch.com","fordexplorer.org","fordstnation.com","forumlovers.club","freemcserver.net","freeomovie.co.in","freeusexporn.com","fullhdfilmizle.*","fullxxxmovies.me","g6ownersclub.com","gamesrepacks.com","garminrumors.com","gaydelicious.com","gbmwolverine.com","genialetricks.de","giuliaforums.com","giurgiuveanul.ro","gl1800riders.com","gledajcrtace.xyz","gmdietforums.com","gminsidenews.com","godstoryinfo.com","gourmetscans.net","grecaleforum.com","gsm-solution.com","hallofseries.com","handgunforum.net","happyinshape.com","happymoments.lol","hausbau-forum.de","hdfilmizlesene.*","hdsaprevodom.com","hechosfizzle.com","helpdeskgeek.com","hentaiseason.com","homemadehome.com","hondacb1000r.com","hondaevforum.com","hondaforeman.com","hornetowners.com","hotcopper.com.au","howsweeteats.com","huskercorner.com","husseinezzat.com","idmextension.xyz","ikarishintou.com","ildcatforums.net","imagereviser.com","impalaforums.com","infinitiqx30.org","infinitiqx50.org","infinitiqx60.org","infinitiqx80.org","infinityfree.com","inspiralized.com","jalshamoviezhd.*","jasminemaria.com","jointexploit.net","jovemnerd.com.br","jukeforums.co.uk","julieblanner.com","justblogbaby.com","justfullporn.net","kakarotfoot.ru>>","kawasakiz650.com","ketolifetalk.com","khatrimazafull.*","kianiroforum.com","kijolifehack.com","kimscravings.com","kingstreamz.site","kitchendivas.com","kleinezeitung.at","knowyourmeme.com","kobe-journal.com","kodiakowners.com","ktm1090forum.net","kyoteibiyori.com","lakeshowlife.com","latinomegahd.net","laurafuentes.com","lexusevforum.com","lexusnxforum.com","linkshortify.com","lizzieinlace.com","lonestarlive.com","loveinmyoven.com","madeeveryday.com","madworldnews.com","magnetoforum.com","magnumforumz.com","mahjongchest.com","mangaforfree.com","manishclasses.in","mardomreport.net","marlinowners.com","maseratilife.com","mathplayzone.com","maverickchat.com","mazda3forums.com","meconomynews.com","medievalists.net","megapornpics.com","millionscast.com","moddedraptor.com","moderncamaro.com","modularfords.com","moneycontrol.com","mostlymorgan.com","mountainbuzz.com","moviesmod.com.pl","mrproblogger.com","mudinmyblood.net","mullenowners.com","mybikeforums.com","mydownloadtube.*","mylargescale.com","mylivestream.pro","nationalpost.com","naturalblaze.com","netflixporno.net","newf150forum.com","newsinlevels.com","newsweekjapan.jp","ninersnation.com","nishankhatri.xyz","nissanforums.com","nissanmurano.org","nocrumbsleft.net","nordenforums.com","o2tvseries4u.com","ojearnovelas.com","onionstream.live","optimaforums.com","oumaga-times.com","paradisepost.com","pcgamingwiki.com","pcpartpicker.com","pelotonforum.com","pendujatt.com.se","perfectunion.com","phinphanatic.com","piranha-fury.com","plainchicken.com","planetisuzoo.com","player.buffed.de","plumbingzone.com","powerover.online","powerover.site>>","predatortalk.com","preludepower.com","pricearchive.org","programme-tv.net","protrumpnews.com","pursuitforum.com","puzzlegarage.com","r6messagenet.com","raetsel-hilfe.de","rangerforums.net","ranglerboard.com","ranglerforum.com","raptorforumz.com","readingeagle.com","rebajagratis.com","redbirdrants.com","repack-games.com","rinconriders.com","ripexbooster.xyz","risttwisters.com","rocketnews24.com","rollingstone.com","routerforums.com","rsoccerlink.site","rule34hentai.net","s1000rrforum.com","saradahentai.com","scioniaforum.com","scionimforum.com","seat-forum.co.uk","segwayforums.com","serial1forum.com","shercoforums.com","shotgunworld.com","shutterstock.com","skidrowcodex.net","skincaretalk.com","smartermuver.com","smartevforum.com","sniperforums.com","solitairehut.com","sonataforums.com","south-park-tv.fr","soxprospects.com","specialstage.com","sport-passion.fr","sportalkorea.com","sportmargin.live","sportshub.stream","sportsloverz.xyz","sportstream1.cfd","starlinktalk.com","statecollege.com","stellanspice.com","stelvioforum.com","stillcurtain.com","stream.nflbox.me","stream4free.live","streamblasters.*","streambucket.net","streamcenter.pro","streamcenter.xyz","streamingnow.mov","stromerforum.com","stromtrooper.com","strtapeadblock.*","subtitleporn.com","sukattojapan.com","sun-sentinel.com","sutekinakijo.com","taisachonthi.com","tapelovesads.org","tastingtable.com","team-integra.net","techkhulasha.com","telcoinfo.online","terrainforum.com","terrainforum.net","teslabottalk.com","text-compare.com","thebakermama.com","thebassholes.com","theboxotruth.com","thecustomrom.com","thedailymeal.com","thedigestweb.com","theflowspace.com","thegadgetking.in","thelandryhat.com","thelawnforum.com","thelinuxcode.com","thelupussite.com","thelureforum.com","thenerdstash.com","thenewcamera.com","thescranline.com","thevikingage.com","thewatchsite.com","titanxdforum.com","tomshardware.com","topvideosgay.com","total-sportek.to","toyotanation.com","tractorforum.com","trainerscity.com","trapshooters.com","trendytalker.com","trocforums.co.uk","tucson-forum.com","turbogvideos.com","turboplayers.xyz","tv.latinlucha.es","tv5mondeplus.com","twobluescans.com","usmle-forums.com","utahwildlife.net","v8bikeriders.com","valeriabelen.com","vancouversun.com","veggieboards.com","venuedrivers.com","veryfreeporn.com","vichitrainfo.com","vizslaforums.com","voiranime.stream","volvo-forums.com","volvoevforum.com","volvov40club.com","voyeurfrance.net","vulcanforums.com","vwatlasforum.com","watchfreexxx.net","watchmmafull.com","wbschemenews.com","weblivehdplay.ru","whipperberry.com","word-grabber.com","world-fusigi.net","worldhistory.org","worldjournal.com","wouterplanet.com","x-trail-uk.co.uk","xclassforums.com","xhamsterporno.mx","xpengevforum.com","xpowerforums.com","xsr700forums.com","yamaha-forum.net","yifysubtitles.ch","yourcountdown.to","youwatchporn.com","ziggogratis.site","100directions.com","12thmanrising.com","2-seriesforum.com","2foodtrippers.com","365cincinnati.com","48daysworkout.com","4chanarchives.com","730sagestreet.com","abarthforum.co.uk","abroadwithash.com","accelerate360.com","acurazdxforum.com","adblockplustape.*","adclickersbot.com","advocate-news.com","afewshortcuts.com","agratefulmeal.com","aircondlounge.com","airfryerworld.com","airoomplanner.com","alderwellness.com","alidaskitchen.com","allcakeprices.com","allfortheboys.com","allmycravings.com","allnutritious.com","allthenoodles.com","allthingsdogs.com","altarofgaming.com","amandascookin.com","amrapideforum.com","amybakesbread.com","amycakesbakes.com","andering-bird.com","anderlustingk.com","andhrafriends.com","andiemitchell.com","andrewzimmern.com","androidpolice.com","anightowlblog.com","anikasdiylife.com","anoffgridlife.com","antiqueradios.com","applecarforum.com","aquariumforum.com","aquiltinglife.com","armypowerinfo.com","aronaforums.co.uk","aroundthenook.com","artsandclassy.com","asimplepalate.com","asimplepantry.com","askmormongirl.com","asouthernsoul.com","aspdotnethelp.com","aspiringwinos.com","astrologyking.com","asweetpeachef.com","atastykitchen.com","atecaforums.co.uk","atlantatrails.com","atlasandboots.com","atvdragracers.com","audioassemble.com","aussieexotics.com","aussiepythons.com","auto-crypto.click","automatedhome.com","avengerforumz.com","avirtualvegan.com","awarenessdays.com","awaytothecity.com","ayunaconlaura.com","backyardables.com","backyardherds.com","badgerofhonor.com","bakeatmidnite.com","bakedambrosia.com","bakedbyrachel.com","bakemeacookie.com","bakeplaysmile.com","bakerbynature.com","bakewithjamie.com","baking-forums.com","bakingamoment.com","bakinghermann.com","ballershoesdb.com","barleyandsage.com","baseballrumors.me","basketballbuzz.ca","beargoggleson.com","beastlyenergy.com","beatthebudget.com","beautycrafter.com","beautyofbirds.com","beautytidbits.com","bebasbokep.online","beeyondcereal.com","beforeitsnews.com","bellybelly.com.au","berlyskitchen.com","besthdgayporn.com","bestporncomix.com","bestrecipebox.com","beyondkimchee.com","beyondtheflag.com","biancazapatka.com","bikergirllife.com","biteontheside.com","bitesbybianca.com","blackbeltwiki.com","blazerevforum.com","blessthismeal.com","blissfulbasil.com","blizzboygames.net","blog.tangwudi.com","boatbasincafe.com","bocadailynews.com","booboosbakery.com","bookishgoblin.com","borrowedbites.com","bottledprices.com","bottleraiders.com","boxingschedule.co","brewerfanatic.com","briana-thomas.com","brightsprouts.com","brilliantmaps.com","broccyourbody.com","broncoevforum.com","buggyandbuddy.com","buildabreak.co.uk","buildtheearth.net","buildyourbite.com","bulldogbreeds.com","butterbeready.com","bwillcreative.com","bykelseysmith.com","cadryskitchen.com","cagesideseats.com","calgaryherald.com","caliberforums.com","caliberforumz.com","camchickscaps.com","camillestyles.com","camperupgrade.com","cancerrehabpt.com","caninejournal.com","caralynmirand.com","carensureplan.com","carolbeecooks.com","castironforum.com","casualepicure.com","casualfoodist.com","cayenneforums.com","cdn.tiesraides.lv","chachingqueen.com","champsorchumps.us","chaptercheats.com","chargerforums.com","chargerforumz.com","chiselandfork.com","cichlid-forum.com","cillacrochets.com","cinemastervip.com","cinnamonsnail.com","circuitsforum.com","city-guide.london","cjeatsrecipes.com","claplivehdplay.ru","classicparker.com","classyclutter.net","claudiastable.com","clearlycoffee.com","cleverjourney.com","closetcooking.com","cloudykitchen.com","clubcrosstrek.com","cluckclucksew.com","clutterkeeper.com","coachrallyrus.com","cockroachzone.com","cocokara-next.com","coffeeatthree.com","coffeecopycat.com","coloradodaily.com","commandertalk.com","computerfrage.net","computerzilla.com","conanfanatics.com","convertbinary.com","cookathomemom.com","cookedbyjulie.com","cookieandkate.com","cookiewebplay.xyz","cookingclassy.com","cookingmaniac.com","cookitwithtim.com","cookwithkushi.com","cool-style.com.tw","cosplayadvice.com","couponingfor4.net","crackstreamer.net","craftsonsea.co.uk","craftymorning.com","crazybusymama.com","crazyforcrust.com","crazytogether.com","createandfind.com","creepycatalog.com","crochettoplay.com","crosswordbuzz.com","crowdworknews.com","cruisemummy.co.uk","cruisersforum.com","crvownersclub.com","cryptednews.space","crystaldigest.com","cubscoutideas.com","cucinabyelena.com","cuckoo4design.com","culturedtable.com","customdakotas.com","custommagnums.com","dailybulletin.com","dailydemocrat.com","dailytech-news.eu","dairygoatinfo.com","damndelicious.net","dawnofthedawg.com","daytonaowners.com","deepgoretube.site","deutschepornos.me","diabetesforum.com","ditjesendatjes.nl","dl.apkmoddone.com","dodgeintrepid.net","drinkspartner.com","ducatimonster.org","durangoforumz.com","eatingonadime.com","eatlittlebird.com","economictimes.com","ecosportforum.com","envisionforum.com","epaceforums.co.uk","etransitforum.com","euro2024direct.ru","everestowners.com","evolvingtable.com","extremotvplay.com","farmersjournal.ie","fetcheveryone.com","fiat500owners.com","fiestafaction.com","filmesonlinex.org","financialpost.com","fitnesssguide.com","focusfanatics.com","fordownloader.com","form.typeform.com","fort-shop.kiev.ua","forum.mobilism.me","fpaceforums.co.uk","freemagazines.top","freeporncomic.net","freethesaurus.com","french-streams.cc","frugalvillage.com","funtasticlife.com","fwmadebycarli.com","galonamission.com","gamejksokuhou.com","gamesmountain.com","gasserhotrods.com","gaypornhdfree.com","genesisforums.com","genesisforums.org","geocaching101.com","gimmesomeoven.com","globalstreams.xyz","goldwingfacts.com","gourbanhiking.com","greatlakes4x4.com","grizzlyowners.com","grizzlyriders.com","guitarscanada.com","havaneseforum.com","hdfilmcehennemi.*","headlinerpost.com","hemitruckclub.com","hentaitube.online","heresy-online.net","hindimoviestv.com","hollywoodlife.com","houseandgarden.co","hqcelebcorner.net","hunterscomics.com","iconicblogger.com","idownloadblog.com","iheartnaptime.net","impalassforum.com","infinityscans.net","infinityscans.org","infinityscans.xyz","innateblogger.com","intouchweekly.com","ipaceforums.co.uk","iphoneincanada.ca","islamicfinder.org","jaguarxeforum.com","jaysbrickblog.com","jeepcommander.com","jeeptrackhawk.org","jockeyjournal.com","justlabradors.com","kawasakiworld.com","kbconlinegame.com","kfx450central.com","kiasoulforums.com","kijomatomelog.com","kimcilonlyofc.com","konoyubitomare.jp","konstantinova.net","koora-online.live","langenscheidt.com","laughingsquid.com","leechpremium.link","letsdopuzzles.com","lettyskitchen.com","lewblivehdplay.ru","lexusrcowners.com","lexusrxowners.com","lineupexperts.com","locatedinfain.com","luciferdonghua.in","mamainastitch.com","marineinsight.com","mdzsmutpcvykb.net","mercurycougar.net","miaminewtimes.com","midhudsonnews.com","midwest-horse.com","mindbodygreen.com","mlbpark.donga.com","motherwellmag.com","motorradfrage.net","moviewatch.com.pk","mtc4.igimsopd.com","multicanaistv.com","musicfeeds.com.au","myjeepcompass.com","myturbodiesel.com","nationaltoday.com","newtahoeyukon.com","nextchessmove.com","nikkan-gendai.com","nishinippon.co.jp","nissan-navara.net","nodakoutdoors.com","notebookcheck.net","nudebabesin3d.com","nyitvatartas24.hu","ohiosportsman.com","okusama-kijyo.com","olympicstreams.co","onceuponachef.com","ondemandkorea.com","ontariofarmer.com","opensubtitles.org","ottawacitizen.com","outdoormatome.com","palisadeforum.com","paracordforum.com","paranormal-ch.com","pavementsucks.com","pcgeeks-games.com","peugeotforums.com","pinayscandalz.com","pioneerforums.com","pistonpowered.com","player.pcgames.de","plugintorrent.com","polarisriders.com","pornoenspanish.es","preludeonline.com","prepperforums.net","pressandguide.com","presstelegram.com","prowlerforums.net","pubgaimassist.com","pumpkinnspice.com","qatarstreams.me>>","ram1500diesel.com","ramrebelforum.com","read-onepiece.net","recipetineats.com","redlineforums.com","reidoscanais.life","renegadeforum.com","republicbrief.com","restlessouter.net","restlingforum.com","restmacizle23.cfd","retro-fucking.com","rightwingnews.com","rumahbokep-id.com","sambalpuristar.in","santafeforums.com","savemoneyinfo.com","scirocconet.co.uk","seatroutforum.com","secure-signup.net","series9movies.com","shahiid-anime.net","share.filesh.site","shootersforum.com","shootingworld.com","shotgunforums.com","shugarysweets.com","sideplusleaks.net","sierraevforum.com","siliconvalley.com","simplywhisked.com","sitm.al3rbygo.com","skylineowners.com","soccerworldcup.me","solsticeforum.com","solterraforum.com","souexatasmais.com","sportanalytic.com","sportlerfrage.net","sportzonline.site","squallchannel.com","stapadblockuser.*","steamidfinder.com","steamseries88.com","stellarthread.com","stingerforums.com","stitichsports.com","stream.crichd.vip","streamadblocker.*","streamcaster.live","streamingclic.com","streamoupload.xyz","streamshunters.eu","streamsoccer.site","streamtpmedia.com","streetinsider.com","subaruoutback.org","subaruxvforum.com","sumaburayasan.com","superherohype.com","supertipzz.online","suzuki-forums.com","suzuki-forums.net","suzukicentral.com","t-shirtforums.com","tablelifeblog.com","talkclassical.com","talonsxsforum.com","taycanevforum.com","thaihotmodels.com","thebazaarzone.com","thecelticblog.com","thecubexguide.com","thedieselstop.com","thefreebieguy.com","thehackernews.com","themorningsun.com","thenewsherald.com","thepiratebay0.org","thewoksoflife.com","thyroidboards.com","tightsexteens.com","tiguanevforum.com","tiktokcounter.net","timesofisrael.com","tivocommunity.com","tnhuntingclub.com","tokusatsuindo.com","toyotacelicas.com","toyotaevforum.com","tradingfact4u.com","traverseforum.com","truyen-hentai.com","tundraevforum.com","turkedebiyati.org","tvbanywherena.com","twitchmetrics.net","twowheelforum.com","umatechnology.org","undeadwalking.com","unsere-helden.com","v6performance.net","velarforums.co.uk","velosterturbo.org","victoryforums.com","viralitytoday.com","visualnewshub.com","volusiariders.com","wannacomewith.com","watchserie.online","wellnessbykay.com","workweeklunch.com","worldmovies.store","wutheringwaves.gg","www.hoyoverse.com","wyborkierowcow.pl","xxxdominicana.com","young-machine.com","yourcupofcake.com","10thcivicforum.com","11magnolialane.com","15minutebeauty.com","4-seriesforums.com","4runner-forums.com","502streetscene.net","5thrangerforum.com","5thwheelforums.com","8020automotive.com","abakingjourney.com","abcdeelearning.com","abcsofliteracy.com","abeautifulmess.com","abrotherabroad.com","accuretawealth.com","acooknamedmatt.com","acousticbridge.com","acraftyconcept.com","acrylicpouring.com","adamantkitchen.com","adaptive.marketing","adayinourshoes.com","adblockeronstape.*","addictinggames.com","adultasianporn.com","adultdeepfakes.com","adventureinyou.com","advertisertape.com","aflavorfulbite.com","aflavorjournal.com","aglassofbovino.com","ahnfiredigital.com","airhostacademy.com","airsoftsociety.com","alexandracooks.com","alittleandalot.com","allabouttattoo.com","allaboutthetea.com","allsalonprices.com","allthingsmamma.com","allthingsvegas.com","amarcoplumbing.com","amateurprochef.com","american-rails.com","americanoceans.org","andersomewhere.com","anestwithayard.com","anewwayforward.org","animated-teeth.com","animesorionvip.net","antimaximalist.com","apetogentleman.com","apieceoftravel.com","aquariumadvice.com","aquariumgenius.com","aquariumsource.com","aquariumsphere.com","arayofsunlight.com","arbirdfanatics.com","areinventedmom.com","arrestyourdebt.com","artfrommytable.com","artsy-traveler.com","artycraftykids.com","asialiveaction.com","asianclipdedhd.net","askannamoseley.com","astrakforums.co.uk","astrology-seek.com","atastefortravel.ca","atlasstudiousa.com","atsloanestable.com","aubreyskitchen.com","australiaforum.com","authenticateme.xyz","authenticforum.com","aviatorinsider.com","avirtuouswoman.org","avocadoskillet.com","axleandchassis.com","b-inspiredmama.com","backforseconds.com","backtoourroots.net","badbatchbaking.com","bakeitwithlove.com","bakingmehungry.com","ballexclusives.com","barkingroyalty.com","barleyandbirch.com","barstoolsports.com","baseballchannel.jp","bearfoottheory.com","becomingunbusy.com","bedbugsinsider.com","bemorewithless.com","beneathmyheart.net","bestappetizers.com","bestboatreport.com","bestgamingtips.com","bestreamsports.org","bestsportslive.org","betterfoodguru.com","beyondfrosting.com","bhookedcrochet.com","bicycle-guider.com","bigsmallscreen.com","bimmerforums.co.uk","birdwatchinghq.com","blackberrybabe.com","blackcrossword.com","blackgirlnerds.com","blackporncrazy.com","blacksmithtalk.com","blog-peliculas.com","blogredmachine.com","bluecinetech.co.uk","bluemediastorage.*","boardgamequest.com","bombshellbling.com","boomhavenfarms.com","boothfindernyc.com","boraboraphotos.com","bosoxinjection.com","boundlessroads.com","bowerpowerblog.com","brianakdesigns.com","browneyedbaker.com","brownthumbmama.com","bullnettlenews.com","burncitysports.com","burntpelletbbq.com","businessinsider.de","businessinsider.jp","busydaydinners.com","butterandbliss.net","cactusforums.co.uk","cadillacforums.com","cakebycourtney.com","calculator.academy","calculatorsoup.com","campsitephotos.com","can-amelectric.com","careercontessa.com","carnivalforums.com","carolinevencil.com","carriecarvalho.com","casamiacooking.com","cattitudedaily.com","celebratednest.com","celebschitchat.com","centslessdeals.com","challengerlife.com","challengertalk.com","chicagotribune.com","childhoodmagic.com","chilesandsmoke.com","chinacarforums.com","chooseveganism.org","ciaoflorentina.com","cinderstravels.com","classic-armory.org","cleanfoodcrush.com","cleanplatemama.com","clevelanddaily.com","cleverlysimple.com","clickondetroit.com","climbingforums.com","clubtraderjoes.com","cmaxownersclub.com","cmbarndominium.com","cocinarepublic.com","cockroachfacts.com","cockroachsavvy.com","codewordsolver.com","codingnepalweb.com","coffeeforums.co.uk","coldsorescured.com","collegefootball.gg","collegegazette.com","color-meanings.com","coloradodiesel.org","colormadehappy.com","comestayawhile.com","conscioushacker.io","consumerboomer.com","contractortalk.com","cookedandloved.com","cookiesandcups.com","cookiesfordays.com","cookingorgeous.com","cookingwithlei.com","cookingwithria.com","cookinwithmima.com","cookitrealgood.com","cookwithmanali.com","correotemporal.org","corsaeforums.co.uk","costaricavibes.com","cottageandvine.net","countrydiaries.com","couponcravings.com","cr7-soccer.store>>","craftberrybush.com","craftsbyamanda.com","craftyartideas.com","craftycookbook.com","cravetheplanet.com","creeklinehouse.com","crisslecrossle.com","crochetncrafts.com","crockpotladies.com","crooksandliars.com","crossbownation.com","crossplaygames.com","crowdedkitchen.com","cruisingkids.co.uk","crystalandcomp.com","culinaryginger.com","culinaryshades.com","customfighters.com","customonesixth.com","cutnmakecrafts.com","cyberquadforum.com","cybertrucktalk.com","dakota-durango.com","dcworldscollide.gg","defendersource.com","defensivecarry.com","descargaspcpro.net","diecastxchange.com","dieselramforum.com","digital-thread.com","dinneratthezoo.com","discoverysport.net","diyelectriccar.com","diymobileaudio.com","dogfoodadvisor.com","downshiftology.com","elantragtforum.com","elconfidencial.com","electro-torrent.pl","empire-streaming.*","equinoxevforum.com","esprinterforum.com","familycheftalk.com","feastingathome.com","feelgoodfoodie.net","filmizlehdizle.com","financenova.online","firebirdnation.com","fjlaboratories.com","flacdownloader.com","footballchannel.jp","fordfusionclub.com","fordinsidenews.com","forkknifeswoon.com","freeadultcomix.com","freepublicporn.com","fullsizebronco.com","galinhasamurai.com","games.arkadium.com","gaypornmasters.com","gdrivelatinohd.net","genesisevforum.com","georgiapacking.org","germancarforum.com","goldwingowners.com","grcorollaforum.com","greeleytribune.com","grizzlycentral.com","halloweenforum.com","haveibeenpwned.com","hdstreetforums.com","highkeyfinance.com","highlanderhelp.com","homeglowdesign.com","hondaatvforums.net","hopepaste.download","hungrypaprikas.com","hyundai-forums.com","hyundaitucson.info","iamhomesteader.com","iawaterfowlers.com","indianshortner.com","insider-gaming.com","insightcentral.net","insurancesfact.com","islamicpdfbook.com","isthereanydeal.com","jamaicajawapos.com","jigsawexplorer.com","jocjapantravel.com","kawasakiversys.com","kiatuskerforum.com","kijyomatome-ch.com","kirbiecravings.com","kodiaqforums.co.uk","laleggepertutti.it","lancerregister.com","landroversonly.com","leckerschmecker.me","lifeinleggings.com","lincolnevforum.com","listentotaxman.com","liveandletsfly.com","makeincomeinfo.com","maketecheasier.com","manchesterworld.uk","marinetraffic.live","marvelsnapzone.com","maverickforums.net","mediaindonesia.com","metalguitarist.org","millwrighttalk.com","moddedmustangs.com","modelrailforum.com","monaskuliner.ac.id","montereyherald.com","morningjournal.com","motorhomefacts.com","moviesonlinefree.*","mrmakeithappen.com","myquietkitchen.com","mytractorforum.com","nationalreview.com","newtorrentgame.com","ninja400riders.com","nissancubelife.com","nlab.itmedia.co.jp","nourishedbynic.com","observedtrials.net","oklahomahunter.net","olverineforums.com","omeuemprego.online","oneidadispatch.com","onlineradiobox.com","onlyfullporn.video","oodworkingtalk.com","orkingdogforum.com","orldseafishing.com","ourbeagleworld.com","pacificaforums.com","paintballforum.com","pancakerecipes.com","panigalev4club.com","passportforums.com","pathfindertalk.com","perfectmancave.com","player.gamezone.de","playoffsstream.com","polestar-forum.com","pornfetishbdsm.com","porno-baguette.com","porscheevforum.com","promasterforum.com","prophecyowners.com","q3ownersclub.co.uk","ranglerjlforum.com","readcomiconline.li","reporterherald.com","rimfirecentral.com","ripcityproject.com","roadbikereview.com","roadstarraider.com","roadtripliving.com","runnersforum.co.uk","runtothefinish.com","samsungmagazine.eu","scarletandgame.com","scramblerforum.com","shipsnostalgia.com","shuraba-matome.com","siamblockchain.com","sidelionreport.com","sidexsideworld.com","skyscrapercity.com","slingshotforum.com","snowplowforums.com","soft.cr3zyblog.com","softwaredetail.com","spoiledmaltese.com","sportbikeworld.com","sportmargin.online","sportstohfa.online","ssnewstelegram.com","stapewithadblock.*","starbikeforums.com","steamclouds.online","steamcommunity.com","stevesnovasite.com","stingrayforums.com","stormtrakforum.com","stream.nflbox.me>>","strtapeadblocker.*","subarubrzforum.com","subaruforester.org","talkcockatiels.com","talkparrotlets.com","tapeadsenjoyer.com","tcrossforums.co.uk","techtalkcounty.com","telegramgroups.xyz","telesintese.com.br","theblacksphere.net","thebussybandit.com","theendlessmeal.com","thefirearmblog.com","thepewterplank.com","thepolitistick.com","thespeedtriple.com","thestarphoenix.com","tiguanforums.co.uk","tiktokrealtime.com","times-standard.com","tips-and-tricks.co","torrentdosfilmes.*","toyotachrforum.com","transalpowners.com","travelplanspro.com","treadmillforum.com","truestreetcars.com","turboimagehost.com","tv.onefootball.com","tvshows4mobile.org","tweaksforgeeks.com","unofficialtwrp.com","upownersclub.co.uk","varminthunters.com","veggiegardener.com","vincenzosplate.com","washingtonpost.com","watchadsontape.com","watchpornfree.info","wblaxmibhandar.com","wemove-charity.org","windowscentral.com","worldle.teuteuf.fr","worldstreams.click","www.apkmoddone.com","xda-developers.com","yamahastarbolt.com","yariscrossclub.com","zafiraowners.co.uk","100percentfedup.com","12minuteathlete.com","208ownersclub.co.uk","23jumpmanstreet.com","2sistersmixitup.com","2sistersrecipes.com","320sycamoreblog.com","abnormalreturns.com","accordingtoelle.com","acharmingescape.com","acraftedpassion.com","activeweekender.com","acultivatednest.com","adblockstreamtape.*","addictedtodates.com","addsaltandserve.com","adventourbegins.com","adventuresofmel.com","africatwinforum.com","againstallgrain.com","airfryingfoodie.com","akb48matomemory.com","aliontherunblog.com","alittleinsanity.com","allaboutparrots.com","allfordmustangs.com","allhomerobotics.com","allthingstarget.com","allwritealright.com","alternativedish.com","alwaysusebutter.com","ambereverywhere.com","amomsimpression.com","amyinthekitchen.com","amynewnostalgia.com","andreasnotebook.com","anoregoncottage.com","antique-bottles.net","api.dock.agacad.com","apieceofrainbow.com","aplinsinthealps.com","architecturelab.net","areyouscreening.com","arkansashunting.net","arrowheadaddict.com","artsychicksrule.com","artsyfartsymama.com","ashevilletrails.com","aslobcomesclean.com","astonmartinlife.com","asumsikedaishop.com","atablefullofjoy.com","atchtalkforums.info","athletelunchbox.com","athomebyheather.com","attractiondiary.com","authoritytattoo.com","automaticwasher.org","awellstyledlife.com","bakedcollective.com","bakefromscratch.com","bakemesomesugar.com","bakinglikeachef.com","barcablaugranes.com","basicswithbails.com","basketballforum.com","basketballnoise.com","batesfamilyblog.com","bchtechnologies.com","beautyandbedlam.com","beerconnoisseur.com","believeintherun.com","bestofmachinery.com","betweencarpools.com","betweenjpandkr.blog","beyondthebutter.com","bible-knowledge.com","biblestudytools.com","bibliolifestyle.com","biggestuscities.com","biketestreviews.com","birdwatchingusa.org","bitesofwellness.com","blackcitadelrpg.com","blackcockchurch.org","blisseyhusbands.com","blog.itijobalert.in","blog.potterworld.co","blogtrabalhista.com","bluebowlrecipes.com","bluemediadownload.*","bluestarcrochet.com","boardoftheworld.com","bowfishingforum.com","braidhairstyles.com","breadboozebacon.com","breadsandsweets.com","breakingbourbon.com","brianlagerstrom.com","brightdropforum.com","brighteyedbaker.com","brightgreendoor.com","brightrockmedia.com","brisbanekids.com.au","broncosporttalk.com","bucketlisttummy.com","budgetsavvydiva.com","buttermilkbysam.com","butternutrition.com","buythiscookthat.com","calculatemyroof.com","campercommunity.com","canuckaudiomart.com","cardcollector.co.uk","carrowaycrochet.com","carwindshields.info","cassiescroggins.com","castironrecipes.com","cavaliersnation.com","challengerforum.com","checkhookboxing.com","cheerfulchoices.com","cheflindseyfarr.com","chefnotrequired.com","chickensandmore.com","chins-n-hedgies.com","chrislovesjulia.com","chromebookforum.com","chryslerminivan.net","ciaochowbambina.com","civicsquestions.com","classyyettrendy.com","clevercreations.org","cocinarodriguez.com","collectorfreaks.com","coloredhaircare.com","coloringpageshq.com","colorpsychology.org","comfortablefood.com","commanderforums.org","commonsensehome.com","competitionplus.com","concertarchives.org","contexturesblog.com","cookeatlivelove.com","cooking-therapy.com","cookingcarnival.com","cookingforkeeps.com","cookingmydreams.com","cookingwithayeh.com","cookingwithcoit.com","cookingwithnart.com","cookwithnabeela.com","cosmetologyguru.com","countylocalnews.com","courtneyssweets.com","cozinhalegal.com.br","cozycornercharm.com","cozylittlehouse.com","craftingjeannie.com","cre8tioncrochet.com","createmindfully.com","creativecanning.com","crosswordsolver.com","cruisingfreedom.com","crystalmathlabs.com","cubesnjuliennes.com","culturedvoyages.com","curbsideclassic.com","daddylivestream.com","deerhuntersclub.com","detroitjockcity.com","dexterclearance.com","didyouknowfacts.com","diendancauduong.com","dieself150forum.com","dk.pcpartpicker.com","dodgedartforumz.com","download.megaup.net","driveteslacanada.ca","ds4ownersclub.co.uk","duckhuntingchat.com","dvdfullestrenos.com","ecoboostmustang.org","edmontonjournal.com","elcaminocentral.com","electriciantalk.com","embed.wcostream.com","equipmenttrader.com","escaladeevforum.com","estrenosdoramas.net","explorerevforum.com","ferrari296forum.com","fjcruiserforums.com","flyfishingforum.com","footballtransfer.ru","fortmorgantimes.com","forums.hfboards.com","foxeslovelemons.com","franceprefecture.fr","frustfrei-lernen.de","genealogyspeaks.com","genesisg70forum.com","genesisg80forum.com","germanshepherds.com","girlsvip-matome.com","glaownersclub.co.uk","hailfloridahail.com","hardcoresledder.com","hardwoodhoudini.com","hdfilmcehennemi2.cx","hdlivewireforum.com","hedgehogcentral.com","historicaerials.com","hometownstation.com","hondarebelforum.com","honeygirlsworld.com","honyaku-channel.net","hoosierhomemade.com","horseshoeheroes.com","hostingdetailer.com","html.duckduckgo.com","hummingbirdhigh.com","ici.radio-canada.ca","ilovemycockapoo.com","indycityfishing.com","infinitijxforum.com","insidetheiggles.com","interfootball.co.kr","jacquieetmichel.net","jamaicaobserver.com","jornadaperfecta.com","joyfoodsunshine.com","justonecookbook.com","kenzo-flowertag.com","kiaownersclub.co.uk","kingjamesgospel.com","kitimama-matome.net","kreuzwortraetsel.de","ktmduke390forum.com","laughingspatula.com","learnmarketinfo.com","lifeandstylemag.com","lightningowners.com","lightningrodder.com","lite.duckduckgo.com","logicieleducatif.fr","louisianacookin.com","loverugbyleague.com","m.jobinmeghalaya.in","main.24jobalert.com","makeitdairyfree.com","matometemitatta.com","melskitchencafe.com","mendocinobeacon.com","michiganreefers.com","middletownpress.com","minimalistbaker.com","modeltrainforum.com","motorcycleforum.com","movie-locations.com","mtc5.flexthecar.com","mustangecoboost.net","mykoreankitchen.com","nandemo-uketori.com","natashaskitchen.com","negyzetmeterarak.hu","newjerseyhunter.com","ohiogamefishing.com","orlandosentinel.com","outlanderforums.com","paidshitforfree.com","pcgamebenchmark.com","pendidikandasar.net","personalitycafe.com","phoenixnewtimes.com","phonereviewinfo.com","picksandparlays.net","pllive.xmediaeg.com","pokemon-project.com","politicalsignal.com","poradyiwskazowki.pl","pornodominicano.net","pornotorrent.com.br","preparedsociety.com","pressenterprise.com","prologuedrivers.com","promodescuentos.com","quest.to-travel.net","radio-australia.org","radio-osterreich.at","registercitizen.com","renaultforums.co.uk","reptileforums.co.uk","roguesportforum.com","rojadirectaenvivo.*","royalmailchat.co.uk","santacruzforums.com","secondhandsongs.com","shoot-yalla-tv.live","silveradosierra.com","skidrowreloaded.com","slingshotforums.com","smartkhabrinews.com","snowblowerforum.com","snowmobileforum.com","snowmobileworld.com","soccerdigestweb.com","soccerworldcup.me>>","sourcingjournal.com","sportzonline.site>>","stormininnorman.com","streamadblockplus.*","streamshunters.eu>>","stylegirlfriend.com","supermotojunkie.com","sussexexpress.co.uk","suzukiatvforums.com","tainio-mania.online","tamilfreemp3songs.*","tapewithadblock.org","tarracoforums.co.uk","thecombineforum.com","thecookierookie.com","thedieselgarage.com","thefoodieaffair.com","thelastdisaster.vip","thelibertydaily.com","theoaklandpress.com","thepiratebay10.info","therecipecritic.com","thesciencetoday.com","thesmokingcuban.com","thewatchforum.co.uk","thewatchseries.live","tjcruiserforums.com","trailblazertalk.com","trucs-et-astuces.co","truyentranhfull.net","tundrasolutions.com","turkishseriestv.org","valleyofthesuns.com","vintage-mustang.com","watchlostonline.net","watchmonkonline.com","webdesignledger.com","whatjewwannaeat.com","worldaffairinfo.com","worldstarhiphop.com","worldsurfleague.com","yorkshirepost.co.uk","101cookingfortwo.com","123homeschool4me.com","125ccsportsbikes.com","2008ownersclub.co.uk","500xownersclub.co.uk","aberdeenskitchen.com","absolutesports.media","accountantforums.com","adabofgluewilldo.com","adamownersclub.co.uk","adamtheautomator.com","adayinthekitchen.com","adishofdailylife.com","adultdvdparadise.com","adventuresbylana.com","agirlandagluegun.com","airfryerfanatics.com","alexjessicamills.com","alkingstickforum.com","allflowerkitchen.com","alliancervforums.com","alliannaskitchen.com","allstreetnumbers.com","allthepartyideas.com","allthingsthrifty.com","alltopeverything.com","allwaysdelicious.com","allysonvanhouten.com","alwayseatdessert.com","amazonastroforum.com","ambitiouskitchen.com","amodernhomestead.com","anderingchickpea.com","anderingindisney.com","anderingourworld.com","andersonandgrant.com","androidauthority.com","androidheadlines.com","angelicalbalance.com","anorcadianabroad.com","antaraownersclub.com","anysoftwaretools.com","anytimecocktails.com","arizonagunowners.com","aroundthefoghorn.com","artandthekitchen.com","artfulhomemaking.com","aseasyasapplepie.com","aswbpracticeexam.com","atlantablackstar.com","atraditionallife.com","atthepicketfence.com","aussiegreenthumb.com","aussiehomebrewer.com","averagesocialite.com","backdoorsurvival.com","backyardchickens.com","baking4happiness.com","bakingforfriends.com","bakingupmemories.com","barrescueupdates.com","bcfishingreports.com","beaglesunlimited.com","beautymasterlist.com","beekeepingforums.com","beerintheevening.com","believeinabudget.com","bellacococrochet.com","bensabaconlovers.com","bersapistolforum.com","bestmenscolognes.com","bigdeliciouslife.com","blackwoodacademy.org","bleepingcomputer.com","blueovalfanatics.com","bmaxownersclub.co.uk","booknotification.com","breedingbusiness.com","breezynetworks.co.za","bricksandlogic.co.uk","brokenovenbaking.com","brushnewstribune.com","budgettravelbuff.com","buildingelements.com","butfirstwebrunch.com","butterandbaggage.com","caloriesburnedhq.com","caminoadventures.com","capitalcounselor.com","carolinafishtalk.com","carolinescooking.com","challengerforumz.com","chamberofcommerce.uk","charactercounter.com","chasingoursimple.com","chef-in-training.com","chemistrylearner.com","cherryonmysundae.com","chevycobaltforum.com","chevymalibuforum.com","chihuahua-people.com","chinasichuanfood.com","christinascucina.com","christmasonadime.com","chunkyinkentucky.com","cleangreensimple.com","cleverlyinspired.com","click.allkeyshop.com","climbingtalshill.com","cmaxownersclub.co.uk","coastalwandering.com","cocinadominicana.com","coffeeandcarpool.com","coloradoevowners.com","commandersnation.com","conceptartempire.com","confettiandbliss.com","coniferousforest.com","connoisseurusveg.com","continuousroamer.com","cookinginmygenes.com","cookinginthekeys.com","cookingintheyard.com","cookingkatielady.com","cookingperfected.com","cookingwithbliss.com","cookingwithkarli.com","cozypeachkitchen.com","crackstreamshd.click","crazymonkeygames.com","createcraftprint.com","createprintables.com","creativecolorlab.com","crinkledcookbook.com","culturedvultures.com","curlygirlkitchen.com","dailydishrecipes.com","dailynewshungary.com","dailytruthreport.com","dairylandexpress.com","danslescoulisses.com","daughtertraining.com","defienietlynotme.com","detailingworld.co.uk","digitalcorvettes.com","divinedaolibrary.com","dribbblegraphics.com","earn.punjabworks.com","everydaytechvams.com","favfamilyrecipes.com","foodfaithfitness.com","fordforumsonline.com","fordmuscleforums.com","freestreams-live.*>>","fullfilmizlesene.net","futabasha-change.com","gesundheitsfrage.net","goosehuntingchat.com","greensnchocolate.com","greentractortalk.com","gt86ownersclub.co.uk","heartlife-matome.com","hometheatershack.com","hondarebel3forum.com","houstonchronicle.com","hyundaikonaforum.com","ibreatheimhungry.com","indianasportsman.com","indianporngirl10.com","intercity.technology","investnewsbrazil.com","jeepcherokeeclub.com","jljbacktoclassic.com","journal-advocate.com","jukeownersclub.co.uk","juliescafebakery.com","kawasakininja300.com","knittingparadise.com","kugaownersclub.co.uk","labradoodle-dogs.net","labradorforums.co.uk","lamborghini-talk.com","landroverevforum.com","laweducationinfo.com","legendsofmodding.org","lehighvalleylive.com","letemsvetemapplem.eu","librarium-online.com","link.djbassking.live","loan.bgmi32bitapk.in","loan.creditsgoal.com","main.sportswordz.com","maturegrannyfuck.com","mazda2revolution.com","mazda3revolution.com","meilleurpronostic.fr","menstennisforums.com","mercedesclaforum.com","mercedesgleforum.com","minesweeperquest.com","mojomojo-licarca.com","motorbikecatalog.com","motorcitybengals.com","motorcycleforums.net","mt-soft.sakura.ne.jp","muscularmustangs.com","mustangevolution.com","mylawnmowerforum.com","nationalgunforum.com","neighborfoodblog.com","nissankicksforum.com","notebookcheck-cn.com","notebookcheck-hu.com","notebookcheck-ru.com","notebookcheck-tr.com","noteownersclub.co.uk","onelittleproject.com","onesixthwarriors.com","onlinesaprevodom.net","oraridiapertura24.it","pachinkopachisro.com","panamericaforums.com","pasadenastarnews.com","performanceboats.com","pickleballertalk.com","player.smashy.stream","pocketbikeplanet.com","polarisatvforums.com","popularmechanics.com","pornstarsyfamosas.es","preservationtalk.com","receitasdaora.online","redcurrantbakery.com","relevantmagazine.com","reptilesmagazine.com","reviewingthebrew.com","rollsroyceforums.com","scoutmotorsforum.com","securenetsystems.net","seededatthetable.com","silveradoevforum.com","slobodnadalmacija.hr","snowmobiletrader.com","spendwithpennies.com","sportstohfa.online>>","spotofteadesigns.com","springfieldforum.com","stamfordadvocate.com","starkroboticsfrc.com","streamingcommunity.*","strtapewithadblock.*","successstoryinfo.com","superfastrelease.xyz","talkwithstranger.com","tamilmobilemovies.in","tasteandtellblog.com","techsupportforum.com","thefirearmsforum.com","thefoodcharlatan.com","thefootballforum.net","thegatewaypundit.com","thekitchenmagpie.com","theprudentgarden.com","thisiswhyimbroke.com","totalsportek1000.com","travellingdetail.com","ultrastreamlinks.xyz","verdragonball.online","videoeditingtalk.com","videostreaming.rocks","visualcapitalist.com","volksliederarchiv.de","windsorexpress.co.uk","yetiownersclub.co.uk","yorkshire-divers.com","yourhomebasedmom.com","yourpatientvoice.com","yugioh-starlight.com","100daysofrealfood.com","1337x.ninjaproxy1.com","365daysofcrockpot.com","abowlfulloflemons.net","acasaencantada.com.br","aconsciousrethink.com","afarmgirlsdabbles.com","ainttooproudtomeg.com","akronnewsreporter.com","alekasgettogether.com","allpurposeveggies.com","allthedifferences.com","allthingsjewelryy.com","alwaysfromscratch.com","amylattacreations.com","anythingtranslate.com","applefitnessforum.com","applegreencottage.com","apracticalwedding.com","aquariustraveller.com","arizonasportsfans.com","aspicyperspective.com","asweetalternative.com","aturtleslifeforme.com","audreyslittlefarm.com","austinbassfishing.com","az900practicetest.com","backyardknoxville.com","bakesbybrownsugar.com","barnsleychronicle.com","basic-mathematics.com","basketballbuckets.com","basketballhistory.org","beekeepingforum.co.uk","benidormandbeyond.com","biblemoneymatters.com","bigleaguepolitics.com","birdwatchingdaily.com","biscuitsandburlap.com","blessherheartyall.com","blissfullylowcarb.com","bloominghomestead.com","bonvoyagewithkids.com","bowfishingcountry.com","broncoraptorforum.com","brooklynlimestone.com","brownsnationforum.com","burlington-record.com","busyfamilyrecipes.com","busylittlekiddies.com","butterloveandsalt.com","cakemehometonight.com","californiaevforum.com","campingforfoodies.com","canamspyderforums.com","candlepowerforums.com","capitalizemytitle.com","carolinahoneybees.com","carrotsandcookies.com","casecoltingersoll.com","ccmapracticetests.com","celebratingsimply.com","celebritynetworth.com","celiacandthebeast.com","centsationalstyle.com","chamberofcommerce.com","chevyequinoxforum.com","chocolatesandchai.com","choosingnutrition.com","classiccasualhome.com","classicrockforums.com","cleananddelicious.com","clevergirlfinance.com","client.pylexnodes.net","clovermeadowsbeef.com","collinsdictionary.com","coloradofisherman.com","columbusnavigator.com","confettidaydreams.com","cookdinnertonight.com","cookingforpeanuts.com","cookingupmemories.com","cookingwithcarlee.com","cookingwithclaudy.com","cookingwithgenius.com","cookingwithmammac.com","cookingwithparita.com","cookprimalgourmet.com","cordcuttingreport.com","cornercoffeestore.com","corollacrossforum.com","countrylifedreams.com","countrythangdaily.com","couponingtodisney.com","craftinghappiness.com","craftylittlegnome.com","cravinghomecooked.com","crazyvegankitchen.com","creative-culinary.com","creativecaincabin.com","crochet365knittoo.com","crochetwithcarrie.com","crunchtimekitchen.com","cryptoquoteanswer.com","dragontranslation.com","elementownersclub.com","eroticmoviesonline.me","everything2stroke.com","fancymicebreeders.com","foreverwallpapers.com","forum.release-apk.com","fusionsportforums.com","gardentractortalk.com","greaterlongisland.com","hackerranksolution.in","hollywoodreporter.com","homesteadingtoday.com","hondacivicforum.co.uk","hondapioneerforum.com","hoodtrendspredict.com","indianmotorcycles.net","invoice-generator.com","iphoneographytalk.com","jeeprenegadeforum.com","journaldemontreal.com","journey.to-travel.net","julesburgadvocate.com","kawasakininja1000.com","littlehouseliving.com","live.fastsports.store","livinggospeldaily.com","mainlinemedianews.com","marutisuzukiforum.com","mavericklightning.org","mitsubishi-forums.com","mokkaownersclub.co.uk","motorcycletherapy.net","mountainmamacooks.com","mybakingaddiction.com","nissanversaforums.com","notformembersonly.com","novascotiafishing.com","novascotiahunting.com","pelotalibrevivo.net>>","peugeot108forum.co.uk","politicaltownhall.com","powerstrokenation.com","publicsexamateurs.com","ramchargercentral.com","redbluffdailynews.com","retrievertraining.net","rivianownersforum.com","rottweilersonline.com","royalenfieldforum.com","rugerpistolforums.com","runningonrealfood.com","santacruzsentinel.com","scriptgrowagarden.com","smartcarofamerica.com","snapinstadownload.xyz","snowboardingforum.com","sonymobilityforum.com","sousou-no-frieren.com","statisticsanddata.org","stratolinerdeluxe.com","streamservicehd.click","survivalistboards.com","talkaboutmarriage.com","tapeadvertisement.com","tech.trendingword.com","teslaownersonline.com","thepalmierireport.com","thepatriotjournal.com","thereporteronline.com","theslingshotforum.com","timesheraldonline.com","tipsandtricksarab.com","trailhunterforums.com","transparentnevada.com","travelingformiles.com","ukiahdailyjournal.com","ultimateaircooled.com","uscreditcardguide.com","utkarshonlinetest.com","videogamesblogger.com","volkswagenforum.co.uk","watchkobestreams.info","whittierdailynews.com","xr1200ownersgroup.com","yamahastarstryker.com","zone-telechargement.*","1plus1plus1equals1.net","addictedtovacation.com","addisonswonderland.com","advanced-astrology.com","ahdafnews.blogspot.com","airsoftsniperforum.com","allairfryerrecipes.com","allevertakstream.space","amazingclassiccars.com","amberskitchencooks.com","americansongwriter.com","anderingcalifornia.com","andrenalynrushplay.cfd","anniedesigncrochet.com","apaigeofpositivity.com","artprojectsforkids.org","assessmentcentrehq.com","assistirtvonlinebr.net","asvabpracticetests.com","authenticfoodquest.com","automobile-catalog.com","babygearessentials.com","backpacksandbubbly.com","bakerstreetsociety.com","bakingwithgranny.co.uk","barefootinthepines.com","batteryequivalents.com","beardeddragonforum.com","beaumontenterprise.com","becomeawritertoday.com","bettacarefishguide.com","bettermindbodysoul.com","biggerbolderbaking.com","bigheartlittlestar.com","blackcockadventure.com","blankcalendarpages.com","botanicalinterests.com","bramblewinecottage.com","breastfeedingplace.com","brightgreenrecipes.com","britneybreaksbread.com","bunsenburnerbakery.com","businesschronicler.com","businesstechplanet.com","canadianmoneyforum.com","canarystreetcrafts.com","capturownersclub.co.uk","carriebradshawlied.com","casualgeographical.com","cedarhillfarmhouse.com","centreofexcellence.com","chascrazycreations.com","chelseasmessyapron.com","chicagolandfishing.com","chocolatewithgrace.com","christianheadlines.com","christinamariablog.com","classicrockhistory.com","cleanandscentsible.com","closetfulofclothes.com","codycrosssolutions.com","collegetransitions.com","comicallyincorrect.com","community.fortinet.com","condolencemessages.com","controlconceptsusa.com","cookingmadehealthy.com","countrymusicfamily.com","countrymusicnation.com","cravingsofalunatic.com","crayonsandcravings.com","creativehomekeeper.com","crossword-explorer.net","crunchycreamysweet.com","cupcakesandcutlery.com","dallashoopsjournal.com","discosportforums.co.uk","drop.carbikenation.com","eclipsecrossforums.com","elrefugiodelpirata.com","eurointegration.com.ua","evoqueownersclub.co.uk","fertilityfriends.co.uk","filmeserialeonline.org","filmymaza.blogspot.com","gardeninthekitchen.com","godlikeproductions.com","happyveggiekitchen.com","hindisubbedacademy.com","hiraethtranslation.com","housethathankbuilt.com","hyundaicoupeclub.co.uk","hyundaiperformance.com","jpop80ss3.blogspot.com","kawasakimotorcycle.org","kiatellurideforums.com","kingshotcalculator.com","littlesunnykitchen.com","longislandfirearms.com","mainehuntingforums.com","mexicanfoodjournal.com","michigan-sportsman.com","missouriwhitetails.com","mycolombianrecipes.com","nashobavalleyvoice.com","nathanmichaelphoto.com","nintendoeverything.com","oeffnungszeitenbuch.de","olympusbiblioteca.site","panel.freemcserver.net","patriotnationpress.com","player.gamesaktuell.de","portaldasnovinhas.shop","rangerraptorowners.com","redlandsdailyfacts.com","rubiconownersforum.com","salmonfishingforum.com","saturnoutlookforum.net","shakentogetherlife.com","shutupandtakemyyen.com","smartfeecalculator.com","snowmobilefanatics.com","sonsoflibertymedia.com","stellar.quoteminia.com","store.steampowered.com","thatballsouttahere.com","theflyfishingforum.com","tipsandtricksjapan.com","tipsandtrickskorea.com","totalsportek1000.com>>","triumphbobberforum.com","twopeasandtheirpod.com","utahconcealedcarry.com","watchdocumentaries.com","yourdailypornvideos.ws","52kitchenadventures.com","adblockeronstreamtape.*","addicted2decorating.com","adviceonlyfinancial.com","agrillforallseasons.com","alexwongcopywriting.com","allaboutplanners.com.au","allaccordingtoplann.com","allthehealthythings.com","alsothecrumbsplease.com","amazingfoodmadeeasy.com","amessagewithabottle.com","ancestral-nutrition.com","animalcrossingworld.com","anothercocktailblog.com","appellationmountain.net","aquaticplantcentral.com","ashcroftfamilytable.com","ashingtonflyfishing.com","askandyaboutclothes.com","attractionsmagazine.com","ayurvedawithrebecca.com","bajarjuegospcgratis.com","balancingeverything.com","balancingmotherhood.com","beatriceryandesigns.com","beautifulwithbrains.com","bellflowerlifestyle.com","berriesandbarnacles.com","bestjobdescriptions.com","blessthismessplease.com","braveryandbelonging.com","buildingwithkinfolk.com","businesswritingblog.com","butternutbakeryblog.com","caraudioclassifieds.org","chopstickchronicles.com","clashguideswithdusk.net","classiccountrymusic.com","cleaneatingwithkids.com","collegelifemadeeasy.com","completelydelicious.com","constellation-guide.com","cottageonbunkerhill.com","craftingagreenworld.com","craftyourhappyplace.com","crazylittleprojects.com","crosstourownersclub.com","crosswordanswers911.net","crosswordmasterhelp.com","cuddlystitchescraft.com","customcalendarmaker.com","cutegirlshairstyles.com","cycletraveloverload.com","danieldefenseforums.com","ducatisupersport939.net","excelsiorcalifornia.com","footballtransfer.com.ua","fordtransitusaforum.com","forums.redflagdeals.com","freedomfirstnetwork.com","freepornhdonlinegay.com","fromvalerieskitchen.com","healthyfitnessmeals.com","horairesdouverture24.fr","influencersgonewild.org","iwatchfriendsonline.net","japannews.yomiuri.co.jp","julieseatsandtreats.com","laurelberninteriors.com","makefreecallsonline.com","newbrunswickfishing.com","newbrunswickhunting.com","newlifeonahomestead.com","nothingbutnewcastle.com","onionringsandthings.com","orkingfromhomeforum.com","osteusfilmestuga.online","pcoptimizedsettings.com","platingsandpairings.com","player.smashystream.com","polarisgeneralforum.com","powerequipmentforum.com","predominantlyorange.com","ridgelineownersclub.com","runningtothekitchen.com","segops.madisonspecs.com","southplattesentinel.com","stockingfetishvideo.com","streamtapeadblockuser.*","tech.pubghighdamage.com","thebestideasforkids.com","theplantbasedschool.com","tropicalfishkeeping.com","whatgreatgrandmaate.com","zeromotorcycleforum.com","accidentalhappybaker.com","acrochetedsimplicity.com","afilmyhouse.blogspot.com","allthingswithpurpose.com","amandacooksandstyles.com","anitalianinmykitchen.com","antiquetractorsforum.com","apumpkinandaprincess.com","arizonahuntingforums.com","asprinklingofcayenne.com","astraownersnetwork.co.uk","athomewiththebarkers.com","athoughtfulplaceblog.com","awealthofcommonsense.com","barefeetinthekitchen.com","bbqingwiththenolands.com","beatsperminuteonline.com","bedroomproducersblog.com","behindthevoiceactors.com","beyondmeresustenance.com","bigislanditineraries.com","booksworthdiscussing.com","bostonterriersociety.com","bowlsarethenewplates.com","broomfieldenterprise.com","canoncitydailyrecord.com","carolinashootersclub.com","castleinthemountains.com","celebrateanddecorate.com","chiefmotorcycleforum.com","cookingontheweekends.com","creativecertificates.com","crochetconcupiscence.com","cupcakesandkalechips.com","cupcakesavvyskitchen.com","dictionary.cambridge.org","dimensionalseduction.com","ducatiscramblerforum.com","easttennesseefishing.com","ecosportownersclub.co.uk","first-names-meanings.com","freelancer.taxmachine.be","goldenretrieverforum.com","grandhighlanderforum.com","healthylittlefoodies.com","imgur-com.translate.goog","indianhealthyrecipes.com","lawyersgunsmoneyblog.com","makingthymeforhealth.com","manitobafishingforum.com","manitobahuntingforum.com","maseratilevanteforum.com","mediapemersatubangsa.com","ohiowaterfowlerforum.com","onepiece-mangaonline.com","percentagecalculator.net","player.videogameszone.de","playstationlifestyle.net","sandiegouniontribune.com","smithandwessonforums.com","socialanxietysupport.com","spaghetti-interactive.it","spicysouthernkitchen.com","stacysrandomthoughts.com","streetfighterv2forum.com","stresshelden-coaching.de","sundaysuppermovement.com","the-crossword-solver.com","thedesigninspiration.com","themediterraneandish.com","thewanderlustkitchen.com","thunderousintentions.com","tip.etip-staging.etip.io","tropicalfishforums.co.uk","volkswagenownersclub.com","watchdoctorwhoonline.com","watchfamilyguyonline.com","webnoveltranslations.com","workproductivityinfo.com","a-love-of-rottweilers.com","abudhabitravelplanner.com","actuallygoodteamnames.com","alittlepinchofperfect.com","alldayidreamaboutfood.com","appliancerepairforums.com","aterheaterleakinginfo.com","bakedbroiledandbasted.com","baseballtrainingworld.com","best-minecraft-servers.co","bestchristmasdesserts.com","betweenenglandandiowa.com","betweennapsontheporch.net","chachingonashoestring.com","charlottefashionplate.com","chevroletownersclub.co.uk","chicagolandsportbikes.com","chocolatecoveredkatie.com","cindyhattersleydesign.com","cleaneatingveggiegirl.com","colab.research.google.com","commercialtrucktrader.com","conservationinstitute.org","cookerofdeliciousness.com","cookingwithkatiecross.com","countryroadssourdough.com","couponsandfreebiesmom.com","craftaholicsanonymous.net","cravingsomecreativity.com","creamofthecropcrochet.com","creativehealthyfamily.com","crochet-patterns-free.com","crockpotsandflipflops.com","dancearoundthekitchen.com","dictionnaire.lerobert.com","floridaconcealedcarry.com","greatamericanrepublic.com","handgunsandammunition.com","harley-davidsonforums.com","hipointfirearmsforums.com","kitchenfunwithmy3sons.com","macizletaraftarium.online","motorsportsracingtalk.com","pensacolafishingforum.com","player.pcgameshardware.de","practicalselfreliance.com","premeditatedleftovers.com","sentinelandenterprise.com","simply-delicious-food.com","sportsgamblingpodcast.com","technicians0.blogspot.com","theprofilebrotherhood.com","transparentcalifornia.com","watchelementaryonline.com","365daysofbakingandmore.com","accuplacerpracticetest.com","allthenourishingthings.com","attainable-sustainable.net","beautyandthebenchpress.com","bestfriendsforfrosting.com","betterhealthwhileaging.net","bibliopanda.visblog.online","binkysculinarycarnival.com","blackweightlosssuccess.com","braziliankitchenabroad.com","business-opportunities.biz","cocktailsandappetizers.com","coconutsandkettlebells.com","collegefootballnetwork.com","coloradohometownweekly.com","conservativefiringline.com","conserve-energy-future.com","cookiedoughandovenmitt.com","cottageatthecrossroads.com","cryptoprofitcalculator.com","cuatrolatastv.blogspot.com","dipelis.junctionjive.co.uk","edinburghnews.scotsman.com","keyakizaka46matomemory.net","lakesimcoemessageboard.com","panelprograms.blogspot.com","portugues-fcr.blogspot.com","redditsoccerstreams.name>>","rojitadirecta.blogspot.com","theworldofarchitecture.com","watchbrooklynnine-nine.com","worldoftravelswithkids.com","adebtfreestressfreelife.com","alkingonsunshinerecipes.com","aprettylifeinthesuburbs.com","backyardchickencoops.com.au","bestbeginnermotorcycles.com","bootsandhooveshomestead.com","butterflyidentification.com","californiathroughmylens.com","chattanoogafishingforum.com","confessionsofafitfoodie.com","craftinessisnotoptional.com","cravingsomethinghealthy.com","forums.socialmediagirls.com","georgianbaymessageboard.com","maidenhead-advertiser.co.uk","optionsprofitcalculator.com","tastesbetterfromscratch.com","vauxhallownersnetwork.co.uk","verkaufsoffener-sonntag.com","watchmodernfamilyonline.com","amazingcharcuterieboards.com","bmacanberra.wpcomstaging.com","confidencemeetsparenting.com","cookingwithcocktailrings.com","electricmotorcyclesforum.com","freedownload.flash-files.com","mimaletamusical.blogspot.com","aroundtheworldpluskids.com.au","beautythroughimperfection.com","confessionsofabakingqueen.com","confessionsofaserialdiyer.com","gametohkenranbu.sakuraweb.com","russianmachineneverbreaks.com","tempodeconhecer.blogs.sapo.pt","unblockedgamesgplus.gitlab.io","alittlebitofeverythingblog.com","free-power-point-templates.com","oxfordlearnersdictionaries.com","commercialcompetentedigitale.ro","confessionsofagroceryaddict.com","the-girl-who-ate-everything.com","aestheticsmilereconstruction.com","everythinginherenet.blogspot.com","insuranceloan.akbastiloantips.in","watchrulesofengagementonline.com","countrylivinginacariboovalley.com","frogsandsnailsandpuppydogtail.com","ragnarokscanlation.opchapters.com","creatingreallyawesomefunthings.com","xn--verseriesespaollatino-obc.online","buckinghamshirelandscapegardeners.com","xn-----0b4asja7ccgu2b4b0gd0edbjm2jpa1b1e9zva7a0347s4da2797e8qri.xn--1ck2e1b"];

const $scriptletFromRegexes$ = /* 0 */ [];

const $hasEntities$ = true;
const $hasAncestors$ = true;
const $hasRegexes$ = false;

/******************************************************************************/

const entries = (( ) => {
    const docloc = document.location;
    const origins = [ docloc.origin ];
    if ( docloc.ancestorOrigins ) {
        origins.push(...docloc.ancestorOrigins);
    }
    return origins.map((origin, i) => {
        const beg = origin.indexOf('://');
        if ( beg === -1 ) { return; }
        const hn1 = origin.slice(beg+3)
        const end = hn1.indexOf(':');
        const hn2 = end === -1 ? hn1 : hn1.slice(0, end);
        const hnParts = hn2.split('.');
        if ( hn2.length === 0 ) { return; }
        const hns = [];
        for ( let i = 0; i < hnParts.length; i++ ) {
            hns.push(`${hnParts.slice(i).join('.')}`);
        }
        const ens = [];
        if ( $hasEntities$ ) {
            const n = hnParts.length - 1;
            for ( let i = 0; i < n; i++ ) {
                for ( let j = n; j > i; j-- ) {
                    ens.push(`${hnParts.slice(i,j).join('.')}.*`);
                }
            }
            ens.sort((a, b) => {
                const d = b.length - a.length;
                if ( d !== 0 ) { return d; }
                return a > b ? -1 : 1;
            });
        }
        return { hns, ens, i };
    }).filter(a => a !== undefined);
})();
if ( entries.length === 0 ) { return; }

const collectArglistRefIndices = (out, hn, r) => {
    let l = 0, i = 0, d = 0;
    let candidate = '';
    while ( l < r ) {
        i = l + r >>> 1;
        candidate = $scriptletHostnames$[i];
        d = hn.length - candidate.length;
        if ( d === 0 ) {
            if ( hn === candidate ) {
                out.add(i); break;
            }
            d = hn < candidate ? -1 : 1;
        }
        if ( d < 0 ) {
            r = i;
        } else {
            l = i + 1;
        }
    }
    return i;
};

const indicesFromHostname = (out, hnDetails, suffix = '') => {
    if ( hnDetails.hns.length === 0 ) { return; }
    let r = $scriptletHostnames$.length;
    for ( const hn of hnDetails.hns ) {
        r = collectArglistRefIndices(out, `${hn}${suffix}`, r);
    }
    if ( $hasEntities$ ) {
        let r = $scriptletHostnames$.length;
        for ( const en of hnDetails.ens ) {
            r = collectArglistRefIndices(out, `${en}${suffix}`, r);
        }
    }
};

const todoIndices = new Set();
indicesFromHostname(todoIndices, entries[0]);
if ( $hasAncestors$ ) {
    for ( const entry of entries ) {
        if ( entry.i === 0 ) { continue; }
        indicesFromHostname(todoIndices, entry, '>>');
    }
}
$scriptletHostnames$.length = 0;

// Collect arglist references
const todo = new Set();
if ( todoIndices.size !== 0 ) {
    const arglistRefs = $scriptletArglistRefs$.split(';');
    for ( const i of todoIndices ) {
        for ( const ref of JSON.parse(`[${arglistRefs[i]}]`) ) {
            todo.add(ref);
        }
    }
}
if ( $hasRegexes$ ) {
    const { hns } = entries[0];
    for ( let i = 0, n = $scriptletFromRegexes$.length; i < n; i += 3 ) {
        const needle = $scriptletFromRegexes$[i+0];
        let regex;
        for ( const hn of hns ) {
            if ( hn.includes(needle) === false ) { continue; }
            if ( regex === undefined ) {
                regex = new RegExp($scriptletFromRegexes$[i+1]);
            }
            if ( regex.test(hn) === false ) { continue; }
            for ( const ref of JSON.parse(`[${$scriptletFromRegexes$[i+2]}]`) ) {
                todo.add(ref);
            }
        }
    }
}
if ( todo.size === 0 ) { return; }

// Execute scriplets
{
    const arglists = $scriptletArglists$.split(';');
    const args = $scriptletArgs$;
    for ( const ref of todo ) {
        if ( ref < 0 ) { continue; }
        if ( todo.has(~ref) ) { continue; }
        const arglist = JSON.parse(`[${arglists[ref]}]`);
        const fn = $scriptletFunctions$[arglist[0]];
        try { fn(...arglist.slice(1).map(a => args[a])); }
        catch { }
    }
}

/******************************************************************************/

// End of local scope
})();

void 0;
