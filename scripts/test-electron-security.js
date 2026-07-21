'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const main = read('main.js');
const preload = read('preload.js');
const packageJson = JSON.parse(read('package.json'));
const safeHtml = read('modules/safe-html.js');
const guestPreload = read('webviewAdblockPreload.js');
const downloaderService = read('modules/downloaderService.js');
const webBrowser = read('modules/web-browser.js');
const passwordManager = read('password-manager.js');
const passwordManagerPreload = read('password-manager-preload.js');
const localPages = [
    'index.html', 'settings.html', 'adblock.html', 'downloader.html',
    'soundEffects.html', 'eqPresets.html', 'pulse.html', 'password-manager.html'
];

assert.doesNotMatch(main, /nodeIntegration\s*:\s*true/);
assert.doesNotMatch(main, /contextIsolation\s*:\s*false/);
assert.doesNotMatch(main, /sandbox\s*:\s*false/);
assert.doesNotMatch(main, /webSecurity\s*:\s*false/);
assert.doesNotMatch(main, /allowRunningInsecureContent\s*:\s*true/);
assert.doesNotMatch(packageJson.scripts['dev:linux'], /--no-sandbox|ELECTRON_DISABLE_SANDBOX/);
assert.match(main, /ARDALI_ALLOW_CERT_BYPASS/);
assert.doesNotMatch(main, /customProtocolHandlers|web:chooseAndOpenExternal/);
assert.doesNotMatch(preload, /web:chooseAndOpenExternal/);
assert.doesNotMatch(main, /vault:guest:(?:list|fill)'/);
assert.match(main, /GUEST_IPC_CHANNELS/);
assert.match(main, /unauthorized-ipc-sender/);
assert.match(main, /isAuthorizedIpcSender\(event, channel\)/);
assert.match(main, /validateIpcArguments\(channel, args\)/);
assert.match(main, /IPC_FORBIDDEN_KEYS/);
assert.match(main, /vault:guest:beginFill/);
assert.match(main, /pendingCredentialFillAuthorizations/);
assert.match(main, /frameRoutingId/);
assert.match(guestPreload, /event\?\.isTrusted !== true/);
assert.match(guestPreload, /navigator\.userActivation\?\.isActive !== true/);
assert.match(guestPreload, /vault:guest:beginFill/);
assert.match(main, /isAllowedWebUrlMain\(currentUrl\) &&\s*isAllowedWebUrlMain\(requestingUrl\)/);
assert.match(main, /LOCAL_PAGE_IPC_PREFIXES/);
assert.match(main, /'password-manager\.html': \['vault:', 'settings:load', 'i18n:', 'get-system-locale'\]/);
assert.match(main, /passwordManagerWindow/);
assert.match(main, /event\.senderFrame\?\.parent/);
assert.match(main, /isRendererPathGranted/);
assert.match(main, /grantRendererPath\(event\.sender/);
assert.match(preload, /STANDALONE_API_KEYS/);
assert.match(downloaderService, /downloadVerifiedFile/);
assert.match(downloaderService, /download-integrity-failed/);
assert.match(downloaderService, /binarySha256/);
assert.doesNotMatch(downloaderService, /releases\/latest\/download|johnvansickle\.com/);
assert.doesNotMatch(webBrowser, /<span>\$\{item\.phrase\}<\/span>/);
assert.equal(packageJson.dependencies.dompurify, '3.4.12');
assert.match(safeHtml, /DOMPurify/);
assert.match(safeHtml, /FORBID_TAGS/);
assert.match(read('renderer.js'), /ardaliSetHTML\(div/);
assert.match(read('webDownloadsRenderer.js'), /ardaliSetHTML\(detailsPanel/);
assert.match(read('downloaderRenderer.js'), /ardaliSetHTML\(row/);
assert.match(read('password-manager.html'), /src="modules\/i18n\.js"/);
assert.match(passwordManager, /window\.i18n\.init\(\)/);
assert.match(passwordManager, /onSettingsReload/);
assert.doesNotMatch(passwordManager, /[ÇĞİÖŞÜçğıöşü]/);
assert.match(passwordManagerPreload, /i18n:loadLocale/);
assert.match(passwordManagerPreload, /settings:reloaded/);

for (const file of localPages) {
    const html = read(file);
    const meta = (html.match(/<meta\b[^>]*>/gi) || []).find((tag) => /http-equiv=["']Content-Security-Policy["']/i.test(tag)) || '';
    const csp = meta.match(/content="([^"]+)"/i)?.[1] || '';
    assert.ok(csp, `${file}: CSP missing`);
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/, `${file}: unsafe CSP directive`);
    assert.match(csp, /object-src\s+'none'/, `${file}: object-src missing`);
    assert.match(csp, /base-uri\s+'none'/, `${file}: base-uri missing`);
}

console.log('electron security invariants: ok');
