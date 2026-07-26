'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
    shouldBlockRequest,
    evaluateDnrHeaderModifications
} = require('../modules/adblock-engine');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const main = read('main.js');
const preload = read('preload.js');
const renderer = read('renderer.js');
const tabs = read('modules/web-browser.js');
const index = read('index.html');
const eqPresetsRenderer = read('eqPresetsRenderer.js');
const pulseHost = read('modules/pulseHost.js');
const bridge = read('modules/embedded-api-bridge.js');
const newTab = read('modules/new-tab-customization.js');
const adblockWindow = read('adblockWindow.js');

assert.match(index, /class="settings-tab active" data-tab="web"/, 'workspace Settings sidebar must expose Web Settings');
assert.match(index, /class="settings-page active" id="webSettings"/, 'workspace Settings must provide the browser settings module target');
assert.match(index, /<script src="modules\/browser-settings-system\.js"><\/script>/, 'workspace Settings must load the browser settings implementation');
for (const id of [
    'behaviorWebSuspendWhenInactive',
    'behaviorWebClearCacheOnQuit',
    'webClearAllDataNowBtn',
    'behaviorWebPreferHttps',
    'behaviorWebReduceWebRtcIpLeaks',
    'behaviorWebSessionProfile',
    'behaviorWebAutoRecover',
    'behaviorWebAllowCamera',
    'webActiveSitePermissionStatus',
    'behaviorWebUserAgentMode',
    'behaviorWebReduceReferrers',
    'behaviorWebBackgroundThrottle'
]) {
    assert.match(index, new RegExp(`id="${id}"`), `workspace Web Settings must expose ${id}`);
}
assert.match(renderer, /applicationModuleLifecycle\.register\('videoTools'/);
assert.match(main, /settingPath === 'security\.sessionProfile'/);
assert.match(main, /String\(value \|\| ''\)\.toLowerCase\(\) === 'isolated' \? 'isolated' : 'persistent'/);
assert.match(adblockWindow, /let statsRefreshInterval = null/);
assert.match(adblockWindow, /function stopStatsRefresh\(\)/);
assert.match(adblockWindow, /clearInterval\(statsRefreshInterval\)/);
assert.match(adblockWindow, /function startStatsRefresh\(\)/);
assert.match(adblockWindow, /event\.data\?\.type !== 'workspace:lifecycle'/);
assert.match(renderer, /type: 'workspace:lifecycle',\s*phase: 'deactivate'/);
assert.doesNotMatch(
    renderer,
    /else if \(key === 'soundEffects'\) \{[\s\S]{0,450}frame\.src = 'about:blank'/,
    'Sound Effects deactivation must preserve its embedded renderer'
);
for (const key of ['music', 'video', 'gallery', 'videoTools', 'settings', 'about', 'soundEffects', 'eqPresets', 'pulse', 'downloader']) {
    const registrationStart = renderer.indexOf(`applicationModuleLifecycle.register('${key}', {`);
    assert.ok(registrationStart >= 0, `${key} lifecycle registration must exist`);
    const nextRegistration = renderer.indexOf('applicationModuleLifecycle.register(', registrationStart + 1);
    const registration = renderer.slice(registrationStart, nextRegistration >= 0 ? nextRegistration : renderer.length);
    for (const phase of ['activate', 'deactivate', 'suspend', 'resume', 'close']) {
        assert.match(registration, new RegExp(`\\b${phase}:`), `${key} must implement ${phase}()`);
    }
}
assert.match(renderer, /pulse: \{ titleKey: 'workspace\.tabs\.pulse', title: 'Find Song', icon: 'icons\/ui\/song-find\.svg' \}/);
assert.match(renderer, /function showPulseResultNotification\(result\)/);
assert.match(renderer, /const coverUrl = String\(result\?\.coverUrl \|\| result\?\.artwork \|\| ''\)\.trim\(\)/);
assert.match(renderer, /art\.className = 'ardali-pulse-result-art'/);
assert.match(renderer, /addPlatformButton\('youtube', uiT\('pulseQuick\.notification\.openYoutube'/);
assert.match(renderer, /addPlatformButton\('ytmusic', uiT\('pulseQuick\.notification\.openYoutubeMusic'/);
assert.match(renderer, /window\.createTab\(searchUrl, true\)/);
assert.match(renderer, /applicationModuleLifecycle\.close\(key\)/);
assert.match(renderer, /stopVideoStudioReplayBuffer\(\)/);
assert.match(renderer, /releaseVideoToolIdleResources\(\{ force: true \}\)/);
assert.doesNotMatch(renderer, /\(page === 'video' \|\| page === 'videoTools'\)[\s\S]{0,300}stopAudio\(\)/);
assert.match(renderer, /screenRecordingStopPromise/);
assert.match(renderer, /recording finalization failed/);
assert.match(renderer, /finally \{[\s\S]{0,1200}screenRecorder === recorderForSession/);
assert.match(tabs, /version: 2/);
assert.match(tabs, /kind: 'app'/);
assert.match(tabs, /window\.ardaliWorkspaceTabsReady = new Promise/);
assert.match(tabs, /restored = restoreTabSession\(\)/);
assert.match(tabs, /resolveWorkspaceTabsReady\?\.\(\{\s*restored,/);
assert.match(tabs, /localDownload: options\.localDownload === true/);
assert.match(newTab, /function shortcutLocalFaviconUrl\(rawUrl\)/);
assert.match(newTab, /'github\.com': 'icons\/platforms\/github\.svg'/);
assert.match(newTab, /image\.loading = hasLocalFavicon \? 'eager' : 'lazy'/);
assert.match(newTab, /image\.decoding = hasLocalFavicon \? 'sync' : 'async'/);
assert.match(tabs, /clearLoadWatchdog\(id\)/);
assert.match(tabs, /clearBlankPageChecks\(id\)/);
assert.doesNotMatch(bridge, /parent\?\.ardali/);
assert.doesNotMatch(renderer, /__ardaliGetEmbeddedApi|getEmbeddedCapabilityApi/);
assert.match(renderer, /document\.createElement\('webview'\)/);
assert.match(main, /getEmbeddedWorkspaceView/);
assert.match(main, /registerPulseIpc\(\{[\s\S]{0,180}webContents,/);
assert.match(pulseHost, /webContents\?\.getAllWebContents\?\.\(\)/);
assert.match(main, /--ardali-view=\$\{embeddedWorkspaceView\.view\}/);
assert.match(main, /EMBEDDED_WORKSPACE_PARTITION/);
assert.match(main, /isScopedVideoSoundEffectsSender/);
assert.match(main, /'eqPresets\.html': \[[^\]]*'system:'/);
assert.match(main, /actualStoragePath === expectedStoragePath/);
assert.match(main, /event\.sender\.hostWebContents\?\.id/);
assert.match(main, /function openApplicationTab\(/);
assert.match(main, /function createEQPresetsWindow\(\) \{\s*return openApplicationTab\('eqPresets'\)/);
assert.doesNotMatch(main, /eqPresetsWindow\s*=\s*new BrowserWindow/);
assert.match(main, /ipcMain\.handle\('eqPresets:getSelection'/);
assert.doesNotMatch(
    main,
    /ipcMain\.handle\('eqPresets:select'[\s\S]{0,1800}workspace:close-application-tab/,
    'EQ preset commit must return before the embedded page closes so beforeunload cannot revert the selection'
);
assert.match(renderer, /workspace-eq-presets-tab-active/);
assert.match(eqPresetsRenderer, /PRESET_SELECTION_STORAGE_KEY/);
assert.match(eqPresetsRenderer, /localStorage\.setItem\(PRESET_SELECTION_STORAGE_KEY, filename\)/);
assert.match(
    renderer,
    /\['gallery', 'settings', 'soundEffects', 'eqPresets', 'pulse', 'downloader', 'videoTools'\]\.includes\(nextKey\)/,
    'Gallery, Settings and EQ Presets must preserve active music/video playback like the other utility tabs'
);
assert.match(renderer, /const PLAYBACK_PRESERVING_WORKSPACE_KEYS = new Set\(\[\s*'gallery'/);
assert.match(renderer, /await window\.ardaliWorkspaceTabsReady/);
assert.match(renderer, /if \(!workspaceTabSession\?\.restored\) \{\s*restoreLastMainSection\(\)/);
assert.match(
    renderer,
    /else if \(targetPage === 'gallery'\) \{[\s\S]{0,350}return;/,
    'Gallery isolation must preserve the active media engine and playback state'
);
assert.doesNotMatch(
    renderer,
    /else if \(targetPage === 'gallery'\) \{[\s\S]{0,700}(?:audio\?\.pause|softPauseWebPlayback|videoPlayer\?\.pause|state\.activeMedia = 'none')/,
    'Gallery activation must not pause audio, web playback, or local video'
);
assert.match(renderer, /applicationModuleLifecycle\.register\('gallery', \{[\s\S]{0,700}closeGalleryLightbox\(\)/);
assert.match(renderer, /applicationModuleLifecycle\.register\('gallery', \{[\s\S]{0,700}galleryDisplayImageUrlCache\.clear\(\)/);
assert.match(renderer, /applicationModuleLifecycle\.register\('gallery', \{[\s\S]{0,700}galleryDisplayResourceGeneration \+= 1/);
assert.match(renderer, /resolveGalleryDisplayImageUrl[\s\S]{0,1500}resourceGeneration !== galleryDisplayResourceGeneration/);
assert.match(renderer, /applicationModuleLifecycle\.register\('gallery', \{[\s\S]{0,700}galleryDisplayResourcesOpen = false/);
assert.match(renderer, /__ardaliPendingEmbeddedDownloaderPayload/);
assert.match(renderer, /__ardaliHandleEmbeddedDownloaderPayload/);
assert.doesNotMatch(
    renderer,
    /restoreWorkspacePlaybackIfInterrupted/,
    'Utility tab transitions must not restart an already-playing audio engine'
);
assert.match(renderer, /workspacePendingAppKey = page/);
assert.match(renderer, /workspacePendingAppKey \|\| event\.detail\?\.nextKey/);
assert.match(renderer, /function shouldPreserveWorkspacePlayback\(\)/);
assert.match(
    renderer,
    /applicationModuleLifecycle\.register\('music', \{\s*deactivate: \(\) => \{\s*if \(shouldPreserveWorkspacePlayback\(\)\) return;/,
    'Music lifecycle must directly reject pause while a playback-preserving workspace is active'
);
assert.match(
    renderer,
    /else if \(targetPage === 'workspace'\) \{[\s\S]{0,400}return;[\s\S]{0,100}\} else \{/,
    'Workspace isolation must return before the generic branch that pauses active media'
);
assert.match(renderer, /uiT\('playlist\.context\.view', 'Görünüm'\)/);
assert.match(renderer, /role: 'menuitemradio'/);
assert.match(renderer, /onClick: \(\) => setLibraryViewMode\(entry\.mode, \{ persist: true \}\)/);
assert.match(renderer, /function persistLibraryViewMode\(mode = 'list'\)/);
assert.match(renderer, /saveSettings\(\{\s*library: \{\s*viewMode: nextMode/);
assert.match(renderer, /searchPlaylistItemOnPlatform\(index, 'youtube'\)/);
assert.match(renderer, /searchPlaylistItemOnPlatform\(index, 'ytmusic'\)/);
assert.match(renderer, /window\.createTab\(url, true\)/);
assert.match(renderer, /https:\/\/wa\.me\/\?text=/);
assert.match(renderer, /https:\/\/t\.me\/share\/url\?url=/);
assert.match(renderer, /https:\/\/www\.facebook\.com\/sharer\/sharer\.php\?u=/);
assert.match(renderer, /https:\/\/twitter\.com\/intent\/tweet\?text=/);
assert.match(renderer, /https:\/\/mail\.google\.com\/mail\/\?view=cm&fs=1/);
assert.match(renderer, /async function copyTextToClipboardVerified/);
assert.match(renderer, /updatePlaylistContextSubmenuPlacement\(menu\)/);
assert.doesNotMatch(renderer, /label: uiT\('playlist\.context\.openYoutubeBrowser'/);
assert.match(renderer, /plainDirectionKey === 'ArrowLeft'\s*\?\s*'prev'/);
assert.match(renderer, /plainDirectionKey === 'ArrowRight' \? 'next'/);
assert.match(renderer, /isGalleryLightboxFullscreenActive\(\)[\s\S]{0,350}setGalleryEditValue\('brightness'/);
assert.match(renderer, /showGalleryBrightnessHud\(nextBrightness\)/);
assert.match(renderer, /galleryLightboxStage\.addEventListener\('dblclick'[\s\S]{0,500}toggleGalleryFullscreenFromSurface/);
assert.match(renderer, /function setupGalleryEditRangeControls\(\)/);
assert.match(renderer, /className = 'gallery-edit-range-step'/);
assert.match(renderer, /row\?\.addEventListener\('wheel'[\s\S]{0,350}adjustGalleryEditRangeInput/);
assert.match(renderer, /input\.dispatchEvent\(new Event\('input', \{ bubbles: true \}\)\)/);
assert.match(renderer, /class="context-menu-share-icon"/);
assert.match(main, /const INTERNAL_DOWNLOAD_VIEW_EXTENSIONS = new Set\(\[/);
assert.match(main, /ipcMain\.handle\('downloads:openFile'/);
assert.match(main, /pathToFileURL\(resolvedPath\)\.href/);
assert.match(preload, /openFile: \(filePath\) => ipcRenderer\.invoke\('downloads:openFile'/);
assert.match(preload, /ipcRenderer\.on\('downloads-open-in-tab'/);
assert.match(renderer, /icons\/platforms\/\$\{name\}\.svg/);
assert.match(renderer, /'wa\.me'/);
assert.match(renderer, /data-gallery-action="share"/);
assert.match(renderer, /function showGalleryShareMenu\(/);
assert.match(renderer, /function shareGalleryImageVia\(/);
assert.match(renderer, /setAttribute\('nonce', 'ardali-local-style-v1'\)/);
assert.match(renderer, /https:\/\/www\.instagram\.com\//);
assert.match(renderer, /https:\/\/www\.reddit\.com\/submit\?type=IMAGE/);
assert.match(renderer, /https:\/\/photos\.google\.com\//);
assert.match(renderer, /https:\/\/www\.pinterest\.com\/pin-creation-tool\//);
assert.match(renderer, /clipboard\?\.setImageFromPath/);
assert.match(preload, /setImageFromPath: \(filePath\) => ipcRenderer\.invoke\('gallery:copyImageToClipboard'/);
assert.match(main, /ipcMain\.handle\('gallery:copyImageToClipboard'/);
assert.match(main, /nativeImage\.createFromPath\(targetPath\)/);
assert.match(renderer, /window\.ardali\.openContainingFolder\(item\.path\)/);
assert.match(renderer, /onClick: \(\) => showPlaylistItemProperties\(index\)/);
assert.match(renderer, /onClick: \(\) => confirmAndClearPlaylistAll\(\)/);
assert.doesNotMatch(renderer, /function removeFromPlaylist\(index\) \{[\s\S]{0,300}elements\.audio\.pause\(\)/);
assert.match(main, /backgroundThrottling: true/);
assert.doesNotMatch(pulseHost, /new BrowserWindow\(/);

const rules = [{
    id: 1,
    priority: 1,
    action: { type: 'block' },
    condition: { urlFilter: '||ads.example^', resourceTypes: ['script'] },
    ruleset: 'test'
}, {
    id: 2,
    priority: 2,
    action: { type: 'modifyHeaders', requestHeaders: [{ header: 'X-Test', operation: 'set', value: 'ok' }] },
    condition: { urlFilter: '||api.example^', resourceTypes: ['xmlhttprequest'] },
    ruleset: 'test'
}];
const config = { mode: 'ideal', dnrRules: rules };
assert.equal(shouldBlockRequest('https://ads.example/a.js', 'script', config, {
    initiator: 'https://site.example/'
})?.action, 'block');
assert.equal(shouldBlockRequest('https://ads.example/a.png', 'image', config, {
    initiator: 'https://site.example/'
}), null);
assert.equal(shouldBlockRequest('https://ads.example/a.js', 'script', {
    ...config,
    sitePolicies: { 'site.example': { whitelisted: true } }
}, { initiator: 'https://site.example/' }), null);
assert.equal(evaluateDnrHeaderModifications('https://api.example/data', 'xmlhttprequest', config, {
    initiator: 'https://site.example/',
    requestHeaders: {}
}, 'request')?.requestHeaders?.['X-Test']?.[0], 'ok');

console.log('tab architecture and adblock regression invariants: ok');
