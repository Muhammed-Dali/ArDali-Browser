const { app, BrowserWindow, ipcMain, dialog, nativeImage, Tray, Menu, shell, session, screen, globalShortcut } = require('electron');

// Wayland/Flatpak: App ID synchronization must happen as early as possible.
const FLATPAK_APP_ID = 'com.aurivo.mediaplayer';
const DESKTOP_FILE_ID = 'com.aurivo.mediaplayer.desktop';

if (app) {
    app.name = FLATPAK_APP_ID;
    if (typeof app.setName === 'function') app.setName(FLATPAK_APP_ID);
    // Wayland/Windows: Unified App ID for grouping
    if (typeof app.setAppUserModelId === 'function') app.setAppUserModelId(FLATPAK_APP_ID);
    
    // Wayland: Link process to the .desktop file for icons and grouping
    if (process.platform === 'linux') {
        app.desktopFileName = DESKTOP_FILE_ID;
    }
}

const os = require('os');
const readline = require('readline');
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { registerDawlodIpc } = require('./modules/dawlodHost');
const {
    initAdBlocker,
    getStats: getAdBlockerStats,
    allowDomain,
    getConfig: getAdBlockerConfig,
    setConfig: setAdBlockerConfig,
    getDashboardUrl: getAdBlockerDashboardUrl,
    getDashboardLaunchInfo: getAdBlockerDashboardLaunchInfo,
} = require('./modules/adBlocker');
let autoUpdater = null;
try {
    ({ autoUpdater } = require('electron-updater'));
} catch (e) {
    console.warn('[UPDATER] electron-updater yüklenemedi:', e?.message || e);
}

const appVersionInfo = Object.freeze({
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron || '',
    chromiumVersion: process.versions.chrome || process.versions.chromium || ''
});

const updateRuntime = {
    initialized: false,
    supported: !!autoUpdater,
    status: 'idle', // idle|checking|available|not-available|downloading|downloaded|error|unsupported
    currentVersion: appVersionInfo.appVersion,
    targetVersion: '',
    releaseNotes: '',
    progress: 0,
    checkedAt: 0,
    lastError: ''
};

function isTruthyEnvFlag(name) {
    const value = String(process.env?.[name] || '').trim().toLowerCase();
    return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

function isPackagedLinuxConservativeGpuMode() {
    if (process.platform !== 'linux') return false;
    if (!app.isPackaged) return false;
    // İsteyen ileri seviye kullanıcılar env ile mevcut agresif GPU ayarlarını geri açabilir.
    return !isTruthyEnvFlag('AURIVO_FORCE_GPU_TUNING');
}

function shouldEnableElectronUpdaterOnThisRuntime() {
    // Linux/AUR kurulumlarında electron-updater yerine paket yöneticisi (yay/pacman) akışı kullanılmalı.
    // Bu akış bazı ortamlarda gereksiz crash riskini artırdığı için varsayılan kapalı.
    if (process.platform === 'linux' && app.isPackaged) {
        return isTruthyEnvFlag('AURIVO_ENABLE_ELECTRON_UPDATER');
    }
    return true;
}

function shouldUseAdblockExtensionOnThisRuntime() {
    // Paketli Linux'ta extension tabanlı mod bazı sistemlerde kararsız davranabildiği için
    // varsayılanı built-in moda çekiyoruz. Gelişmiş kullanıcı env ile tekrar açabilir.
    if (process.platform === 'linux' && app.isPackaged) {
        return isTruthyEnvFlag('AURIVO_ADBLOCK_EXTENSION');
    }
    return true;
}

function commandExists(command) {
    try {
        const res = spawnSync('bash', ['-lc', `command -v ${String(command || '').trim()}`], {
            encoding: 'utf8',
            timeout: 1200
        });
        return res.status === 0;
    } catch {
        return false;
    }
}

function isAurivoBinInstalledViaPacman() {
    if (process.platform !== 'linux') return false;
    if (!commandExists('pacman')) return false;
    try {
        const res = spawnSync('bash', ['-lc', 'pacman -Q aurivo-bin'], {
            encoding: 'utf8',
            timeout: 1800
        });
        return res.status === 0;
    } catch {
        return false;
    }
}

function getLinuxAurUpdateCapabilities() {
    if (process.platform !== 'linux') {
        return {
            aurUpdateSupported: false,
            aurPackageInstalled: false,
            hasYay: false
        };
    }
    const hasYay = commandExists('yay');
    const aurPackageInstalled = hasYay && isAurivoBinInstalledViaPacman();
    return {
        aurUpdateSupported: hasYay,
        aurPackageInstalled,
        hasYay
    };
}

function trySpawnDetached(command, args) {
    try {
        const child = spawn(command, args, {
            detached: true,
            stdio: 'ignore'
        });
        child.unref();
        return true;
    } catch {
        return false;
    }
}

function launchAurivoBinUpdateTerminal() {
    if (process.platform !== 'linux') {
        return { ok: false, reason: 'unsupported-platform' };
    }
    if (!commandExists('yay')) {
        return { ok: false, reason: 'yay-not-found' };
    }

    const updateScript = [
        'printf "\\nAurivo Media Player (AUR) guncelleniyor...\\n\\n"',
        'sleep 0.8',
        'yay -S aurivo-bin',
        'exit_code=$?',
        'printf "\\nIslem tamamlandi (kod: %s).\\n" "$exit_code"',
        'printf "Kapatmak icin Enter...\\n"',
        'read -r _'
    ].join('; ');

    const attempts = [
        ['x-terminal-emulator', ['-e', 'bash', '-lc', updateScript]],
        ['gnome-terminal', ['--', 'bash', '-lc', updateScript]],
        ['konsole', ['-e', 'bash', '-lc', updateScript]],
        ['xfce4-terminal', ['--command', `bash -lc '${updateScript.replace(/'/g, `'\\''`)}'`]],
        ['kitty', ['bash', '-lc', updateScript]],
        ['alacritty', ['-e', 'bash', '-lc', updateScript]],
        ['xterm', ['-e', 'bash', '-lc', updateScript]]
    ];

    for (const [cmd, args] of attempts) {
        if (!commandExists(cmd)) continue;
        if (trySpawnDetached(cmd, args)) {
            return { ok: true, terminal: cmd };
        }
    }

    return { ok: false, reason: 'terminal-not-found' };
}

function snapshotUpdateState() {
    return {
        supported: updateRuntime.supported,
        status: updateRuntime.status,
        currentVersion: updateRuntime.currentVersion,
        targetVersion: updateRuntime.targetVersion,
        releaseNotes: updateRuntime.releaseNotes,
        progress: updateRuntime.progress,
        checkedAt: updateRuntime.checkedAt,
        lastError: updateRuntime.lastError
    };
}

function parseSemverNumericParts(raw) {
    const value = String(raw || '').trim().replace(/^v/i, '');
    const core = value.split('-')[0].trim();
    const parts = core.split('.').map((v) => Number(v) || 0);
    while (parts.length < 3) parts.push(0);
    return parts.slice(0, 3);
}

function compareSemverStrings(a, b) {
    const pa = parseSemverNumericParts(a);
    const pb = parseSemverNumericParts(b);
    for (let i = 0; i < 3; i++) {
        if (pa[i] > pb[i]) return 1;
        if (pa[i] < pb[i]) return -1;
    }
    return 0;
}

function fetchJsonHttps(url, timeoutMs = 4500) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { timeout: timeoutMs }, (res) => {
            const status = Number(res?.statusCode) || 0;
            if (status < 200 || status >= 300) {
                res.resume();
                reject(new Error(`HTTP ${status}`));
                return;
            }
            const chunks = [];
            res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
            res.on('end', () => {
                try {
                    const text = Buffer.concat(chunks).toString('utf8');
                    resolve(JSON.parse(text));
                } catch (e) {
                    reject(e);
                }
            });
        });
        req.on('timeout', () => req.destroy(new Error('request-timeout')));
        req.on('error', reject);
    });
}

async function checkForAurivoBinUpdates({ manual = false } = {}) {
    const caps = getLinuxAurUpdateCapabilities();
    const checkedAt = Date.now();
    if (!caps.aurUpdateSupported || !caps.aurPackageInstalled) {
        setUpdateStatus('unsupported', {
            checkedAt,
            lastError: 'AUR update flow is unavailable on this runtime.'
        });
        return snapshotUpdateState();
    }

    try {
        setUpdateStatus('checking', {
            checkedAt,
            lastError: '',
            progress: 0
        });

        const rpcUrl = 'https://aur.archlinux.org/rpc/?v=5&type=info&arg[]=aurivo-bin';
        const data = await fetchJsonHttps(rpcUrl, 5200);
        const result = Array.isArray(data?.results) ? data.results[0] : null;
        const aurVersionRaw = String(result?.Version || '').trim();
        const aurVersion = aurVersionRaw.split('-')[0].trim();
        const currentVersion = String(appVersionInfo.appVersion || '').trim();

        if (!aurVersion) {
            throw new Error('AUR version not found in RPC response');
        }

        if (compareSemverStrings(aurVersion, currentVersion) > 0) {
            setUpdateStatus('available', {
                checkedAt,
                targetVersion: aurVersion,
                releaseNotes: `AUR paketi güncel sürüm: ${aurVersionRaw}\n\nChangelog: Kritik güvenlik güncellemesi ve bağımlılık sabitleme (Snyk Fix)`,
                progress: 0,
                lastError: ''
            });
        } else {
            setUpdateStatus('not-available', {
                checkedAt,
                targetVersion: '',
                releaseNotes: '',
                progress: 0,
                lastError: ''
            });
        }
        return snapshotUpdateState();
    } catch (error) {
        const message = `AUR check failed: ${String(error?.message || error || 'unknown').trim()}`;
        if (manual) {
            setUpdateStatus('error', {
                checkedAt,
                lastError: message
            });
            return snapshotUpdateState();
        }

        // Otomatik (startup) kontrol hatalarında kullanıcıya hata banner'ı göstermeyelim.
        // Son bilinen durumu koru; sadece check zamanını güncelle.
        const keepStatus = String(updateRuntime.status || '').toLowerCase() === 'checking'
            ? 'idle'
            : (updateRuntime.status || 'idle');
        setUpdateStatus(keepStatus, {
            checkedAt,
            lastError: ''
        });
        return snapshotUpdateState();
    }
}

function parseReleaseNotesToText(rawNotes) {
    if (Array.isArray(rawNotes)) {
        return rawNotes
            .map((entry) => String(entry?.note || entry?.version || '').trim())
            .filter(Boolean)
            .join('\n\n');
    }
    if (typeof rawNotes === 'string') return rawNotes.trim();
    return '';
}

function broadcastUpdateState(extra = {}) {
    const payload = {
        ...snapshotUpdateState(),
        ...extra,
        ts: Date.now()
    };
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((win) => {
        try {
            if (!win || win.isDestroyed()) return;
            win.webContents.send('app:update-status', payload);
        } catch {
            // yoksay
        }
    });
}

function setUpdateStatus(status, patch = {}) {
    updateRuntime.status = String(status || updateRuntime.status || 'idle');
    if (Object.prototype.hasOwnProperty.call(patch, 'targetVersion')) {
        updateRuntime.targetVersion = String(patch.targetVersion || '').trim();
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'releaseNotes')) {
        updateRuntime.releaseNotes = String(patch.releaseNotes || '').trim();
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'progress')) {
        updateRuntime.progress = Math.max(0, Math.min(100, Number(patch.progress) || 0));
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'checkedAt')) {
        updateRuntime.checkedAt = Number(patch.checkedAt) || 0;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'lastError')) {
        updateRuntime.lastError = String(patch.lastError || '').trim();
    }
    broadcastUpdateState();
}

function initAutoUpdaterBridge() {
    if (updateRuntime.initialized) return;
    updateRuntime.initialized = true;

    if (!shouldEnableElectronUpdaterOnThisRuntime()) {
        setUpdateStatus('unsupported', {
            checkedAt: Date.now(),
            lastError: 'Electron updater disabled on packaged Linux (use AUR/pacman updates).'
        });
        return;
    }

    if (!autoUpdater) {
        setUpdateStatus('unsupported', { lastError: 'electron-updater unavailable' });
        return;
    }

    try {
        autoUpdater.autoDownload = false;
        autoUpdater.autoInstallOnAppQuit = true;
        autoUpdater.allowDowngrade = false;
        autoUpdater.logger = console;
    } catch {
        // yoksay
    }

    autoUpdater.on('checking-for-update', () => {
        setUpdateStatus('checking', {
            checkedAt: Date.now(),
            lastError: '',
            progress: 0
        });
    });

    autoUpdater.on('update-available', (info) => {
        setUpdateStatus('available', {
            checkedAt: Date.now(),
            targetVersion: String(info?.version || '').trim(),
            releaseNotes: parseReleaseNotesToText(info?.releaseNotes),
            progress: 0,
            lastError: ''
        });
    });

    autoUpdater.on('update-not-available', () => {
        setUpdateStatus('not-available', {
            checkedAt: Date.now(),
            targetVersion: '',
            releaseNotes: '',
            progress: 0,
            lastError: ''
        });
    });

    autoUpdater.on('error', (error) => {
        setUpdateStatus('error', {
            checkedAt: Date.now(),
            lastError: String(error?.message || error || 'Unknown updater error').trim()
        });
    });

    autoUpdater.on('download-progress', (progressObj) => {
        setUpdateStatus('downloading', {
            progress: Number(progressObj?.percent) || 0
        });
    });

    autoUpdater.on('update-downloaded', (info) => {
        setUpdateStatus('downloaded', {
            targetVersion: String(info?.version || updateRuntime.targetVersion || '').trim(),
            releaseNotes: parseReleaseNotesToText(info?.releaseNotes) || updateRuntime.releaseNotes,
            progress: 100
        });
    });
}

async function checkForAppUpdates({ manual = false } = {}) {
    if (!autoUpdater) {
        setUpdateStatus('unsupported', {
            checkedAt: Date.now(),
            lastError: 'electron-updater unavailable'
        });
        return snapshotUpdateState();
    }
    if (!app.isPackaged) {
        setUpdateStatus('unsupported', {
            checkedAt: Date.now(),
            lastError: 'Update checks are only available in packaged builds.'
        });
        return snapshotUpdateState();
    }
    try {
        if (manual && updateRuntime.status === 'downloading') {
            return snapshotUpdateState();
        }
        await autoUpdater.checkForUpdates();
        return snapshotUpdateState();
    } catch (error) {
        setUpdateStatus('error', {
            checkedAt: Date.now(),
            lastError: String(error?.message || error || 'checkForUpdates failed').trim()
        });
        return snapshotUpdateState();
    }
}

async function checkForRuntimeUpdates({ manual = false } = {}) {
    if (process.platform === 'linux' && app.isPackaged && !shouldEnableElectronUpdaterOnThisRuntime()) {
        return checkForAurivoBinUpdates({ manual });
    }
    return checkForAppUpdates({ manual });
}

async function downloadAppUpdate() {
    if (!autoUpdater) {
        setUpdateStatus('unsupported', { lastError: 'electron-updater unavailable' });
        return snapshotUpdateState();
    }
    if (!app.isPackaged) {
        setUpdateStatus('unsupported', { lastError: 'Download is only available in packaged builds.' });
        return snapshotUpdateState();
    }
    try {
        await autoUpdater.downloadUpdate();
        return snapshotUpdateState();
    } catch (error) {
        setUpdateStatus('error', {
            lastError: String(error?.message || error || 'downloadUpdate failed').trim()
        });
        return snapshotUpdateState();
    }
}

function installDownloadedUpdate() {
    if (!autoUpdater) return false;
    if (updateRuntime.status !== 'downloaded') return false;
    try {
        autoUpdater.quitAndInstall(false, true);
        return true;
    } catch (error) {
        setUpdateStatus('error', {
            lastError: String(error?.message || error || 'quitAndInstall failed').trim()
        });
        return false;
    }
}

// MPRIS (Linux Medya Oynatıcı Uzaktan Arayüz Spesifikasyonu)
const MPRIS_RUNTIME_ENABLED =
    process.platform === 'linux' &&
    ['1', 'true', 'yes'].includes(String(process.env.AURIVO_ENABLE_MPRIS || '').trim().toLowerCase());
// Web platformlarının (YouTube, Spotify vb.) CERT_AUTHORITY_INVALID hatasında
// çalışmaya devam edebilmesi için varsayılan olarak açık.
// Kapatmak için: AURIVO_DISABLE_CERT_BYPASS=1
const ALLOW_TRUSTED_CERT_BYPASS =
    !['1', 'true', 'yes'].includes(String(process.env.AURIVO_DISABLE_CERT_BYPASS || '').trim().toLowerCase());
let Player = null;
if (MPRIS_RUNTIME_ENABLED) {
    try {
        Player = require('mpris-service');
    } catch (e) {
        console.log('mpris-service yüklenemedi (opsiyonel):', e.message);
    }
}

// stdout/stderr pipe kapandığında (örn. `| head`) Node `EPIPE` fırlatabilir.
// Uygulamanın bu yüzden çökmesini engelle.
for (const stream of [process.stdout, process.stderr]) {
    if (!stream || typeof stream.on !== 'function') continue;
    stream.on('error', (err) => {
        if (err && err.code === 'EPIPE') return;
    });
}

// Global yakalanmamış istisna işleyicisi - MPRIS/dbus hataları için
process.on('uncaughtException', (error) => {
    // EPIPE hataları - dbus bağlantısı koptuğunda oluşur
    if (error.code === 'EPIPE' ||
        (error.message && error.message.includes('EPIPE')) ||
        (error.message && error.message.includes('stream is closed')) ||
        (error.message && error.message.includes('Cannot send message'))) {
        // Sessizce yoksay - bu normal bir durum
        return;
    }

    // Diğer hatalar için log yaz ama dialog gösterme
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
});

function safeStdoutLine(line) {
    try {
        process.stdout.write(String(line) + '\n');
    } catch (err) {
        if (err && err.code === 'EPIPE') return;
    }
}

const TRANSIENT_HOME_FILES = ['aurivo-freeze.log', 'imgui.ini'];

function cleanupTransientHomeFiles(context = 'runtime') {
    if (process.platform !== 'linux') return;
    let homeDir = '';
    try {
        homeDir = app?.getPath?.('home') || os.homedir();
    } catch {
        homeDir = os.homedir();
    }
    if (!homeDir) return;

    for (const name of TRANSIENT_HOME_FILES) {
        const filePath = path.join(homeDir, name);
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log(`[Cleanup] removed ${name} (${context})`);
            }
        } catch (e) {
            console.warn(`[Cleanup] failed to remove ${name} (${context}):`, e?.message || e);
        }
    }
}

// GNOME/Wayland üst bar & dock ikon eşleştirmesi için (desktop entry ile eşleşme)
const LINUX_WM_CLASS = 'aurivo-media-player';
if (app && app.commandLine) {
    if (process.platform === 'linux') {
        app.commandLine.appendSwitch('class', LINUX_WM_CLASS);
    }
    app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
    app.commandLine.appendSwitch('disable-background-timer-throttling');
    app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');

    // DÜZELTME: WebView'larda çift medya oynatıcıyı önlemek için Chromium MediaSessionService devre dışı
    const disabledFeatures = ['HardwareMediaKeyHandling', 'MediaSessionService'];
    // Windows'ta bazı ortamlarda Chromium built-in cert verifier, sistemde güvenilen
    // sertifikaları görmeyip net::ERR_CERT_AUTHORITY_INVALID (-202) üretebiliyor.
    // Sistem doğrulayıcıya dönerek tarayıcı ile davranışı hizala.
    if (process.platform === 'win32') {
        disabledFeatures.push('CertVerifierBuiltinFeature');
    }
    app.commandLine.appendSwitch('disable-features', disabledFeatures.join(','));
} else {
    console.warn('[Startup] app.commandLine not available');
}

// Windows 10/11: taskbar/dock ikon eşleştirmesi ve gruplama
if (process.platform === 'win32') {
    if (app && typeof app.setAppUserModelId === 'function') {
        app.setAppUserModelId('com.aurivo.mediaplayer');
    } else {
        console.warn('[Startup] setAppUserModelId unavailable');
    }
}

// Linux Wayland: taskbar/dock grouping
if (process.platform === 'linux') {
    const flatpakId = String(process.env.FLATPAK_ID || process.env.APP_ID || '').trim();
    if (flatpakId && app && typeof app.setDesktopName === 'function') {
        // Use the base ID for grouping. Compositors append .desktop to look for files.
        app.setDesktopName(flatpakId);
    } else if (app && typeof app.setDesktopName === 'function') {
        app.setDesktopName('com.aurivo.mediaplayer');
    }
}

function prependToProcessPath(dir) {
    if (!dir) return;
    const delimiter = path.delimiter || (process.platform === 'win32' ? ';' : ':');
    const cur = process.env.PATH || '';
    const parts = cur.split(delimiter).filter(Boolean);
    if (parts.includes(dir)) return;
    process.env.PATH = `${dir}${delimiter}${cur}`;
}

function ensureWindowsRuntimePaths() {
    if (process.platform !== 'win32') return;

    // PATH: paketlenmiş native bağımlılıkların / ffmpeg'in alt süreç ve DLL yükleyici tarafından bulunabildiğinden emin ol.
    try {
        if (process.resourcesPath) {
            prependToProcessPath(path.join(process.resourcesPath, 'bin'));
            prependToProcessPath(path.join(process.resourcesPath, 'native', 'build', 'Release'));
            prependToProcessPath(path.join(process.resourcesPath, 'native-dist'));
            prependToProcessPath(path.join(process.resourcesPath, 'native-dist', 'windows'));
        }

        // Geliştirici yedekleri
        prependToProcessPath(path.join(__dirname, 'third_party', 'ffmpeg'));
        prependToProcessPath(path.join(__dirname, 'native', 'build', 'Release'));
        prependToProcessPath(path.join(__dirname, 'native-dist'));
        prependToProcessPath(path.join(__dirname, 'native-dist', 'windows'));
    } catch (e) {
        console.warn('[WIN] PATH prep failed:', e?.message || e);
    }
}

ensureWindowsRuntimePaths();

function prependToEnvList(envName, dir) {
    if (!dir) return;
    const delimiter = path.delimiter || (process.platform === 'win32' ? ';' : ':');
    const cur = process.env[envName] || '';
    const parts = cur.split(delimiter).filter(Boolean);
    if (parts.includes(dir)) return;
    process.env[envName] = cur ? `${dir}${delimiter}${cur}` : dir;
}

function ensureUnixRuntimePaths() {
    if (process.platform === 'win32') return;

    const platformDir = process.platform === 'darwin' ? 'darwin' : 'linux';
    try {
        if (process.resourcesPath) {
            const nativeDist = path.join(process.resourcesPath, 'native-dist');
            const nativeDistPlatform = path.join(nativeDist, platformDir);
            prependToProcessPath(nativeDist);
            prependToProcessPath(nativeDistPlatform);
            prependToEnvList(process.platform === 'darwin' ? 'DYLD_LIBRARY_PATH' : 'LD_LIBRARY_PATH', nativeDist);
            prependToEnvList(process.platform === 'darwin' ? 'DYLD_LIBRARY_PATH' : 'LD_LIBRARY_PATH', nativeDistPlatform);
        }

        const devNativeDist = path.join(__dirname, 'native-dist');
        const devNativeDistPlatform = path.join(devNativeDist, platformDir);
        prependToProcessPath(devNativeDist);
        prependToProcessPath(devNativeDistPlatform);
        prependToEnvList(process.platform === 'darwin' ? 'DYLD_LIBRARY_PATH' : 'LD_LIBRARY_PATH', devNativeDist);
        prependToEnvList(process.platform === 'darwin' ? 'DYLD_LIBRARY_PATH' : 'LD_LIBRARY_PATH', devNativeDistPlatform);
    } catch (e) {
        console.warn('[UNIX] runtime path prep failed:', e?.message || e);
    }
}

ensureUnixRuntimePaths();

// (removed) WebView2 host support

let winRuntimeDepsLogged = false;
function logWindowsRuntimeDepsOnce(context = '') {
    if (process.platform !== 'win32') return;
    if (winRuntimeDepsLogged) return;
    winRuntimeDepsLogged = true;

    try {
        const base = process.resourcesPath || '(no resourcesPath)';
        const releaseDir = process.resourcesPath ? path.join(process.resourcesPath, 'native', 'build', 'Release') : '';
        const nativeDistDir = process.resourcesPath ? path.join(process.resourcesPath, 'native-dist') : '';
        const binDir = process.resourcesPath ? path.join(process.resourcesPath, 'bin') : '';
        const visualizerExe = process.resourcesPath ? path.join(nativeDistDir, 'aurivo-projectm-visualizer.exe') : '';
        const ffmpegExe = process.resourcesPath ? path.join(binDir, 'ffmpeg.exe') : '';

        const requiredBassDlls = [
            'bass.dll',
            'bass_fx.dll',
            'bass_aac.dll',
            'bassape.dll',
            'bassflac.dll',
            'basswv.dll'
        ];

        const checkDir = (dir) => {
            if (!dir) return { dir, present: [], missing: requiredBassDlls.slice() };
            const present = [];
            const missing = [];
            for (const f of requiredBassDlls) {
                const p = path.join(dir, f);
                if (fs.existsSync(p)) present.push(f);
                else missing.push(f);
            }
            return { dir, present, missing };
        };

        console.log('[WIN][DEPS]' + (context ? ` (${context})` : ''), 'resourcesPath:', base);
        console.log('[WIN][DEPS] PATH head:', String(process.env.PATH || '').split(';').slice(0, 6).join(';'));
        if (visualizerExe) console.log('[WIN][DEPS] visualizer exe:', visualizerExe, 'exists:', fs.existsSync(visualizerExe));
        if (ffmpegExe) console.log('[WIN][DEPS] ffmpeg exe:', ffmpegExe, 'exists:', fs.existsSync(ffmpegExe));

        const a = checkDir(releaseDir);
        const b = checkDir(nativeDistDir);
        console.log('[WIN][DEPS] bass dll check:', a);
        console.log('[WIN][DEPS] bass dll check:', b);
    } catch (e) {
        console.warn('[WIN][DEPS] log failed:', e?.message || e);
    }
}
// ============================================
// WAYLAND / X11 OTOMATİK ALGILAMA
// ============================================
let effectiveDisplayBackend = 'auto';

function detectDisplayServer() {
    // Linux dışı sistemlerde atlama
    if (process.platform !== 'linux') return;

    const waylandDisplay = process.env.WAYLAND_DISPLAY;
    const xdgSessionType = process.env.XDG_SESSION_TYPE;
    const display = process.env.DISPLAY;
    const ozoneHint = process.env.ELECTRON_OZONE_PLATFORM_HINT;
    const displayBackendOverride = String(process.env.AURIVO_DISPLAY_BACKEND || '').trim().toLowerCase();

    const appendCsvSwitch = (name, csv) => {
        if (!app?.commandLine || !csv) return;
        try {
            const cur = app.commandLine.getSwitchValue(name) || '';
            const set = new Set(
                cur
                    .split(',')
                    .concat(String(csv).split(','))
                    .map(s => String(s || '').trim())
                    .filter(Boolean)
            );
            app.commandLine.appendSwitch(name, [...set].join(','));
        } catch {
            // en iyi çaba
        }
    };

    // Kullanıcı manuel olarak ayarladıysa kullan
    const forceSoftware = process.env.AURIVO_SOFTWARE_RENDER === '1' || process.env.AURIVO_SOFTWARE_RENDER === 'true';
    const forceGpu = process.env.AURIVO_FORCE_GPU === '1' || process.env.AURIVO_FORCE_GPU === 'true';
    const enableVaapi = isTruthyEnvFlag('AURIVO_ENABLE_VAAPI');
    const conservativeGpuMode = isPackagedLinuxConservativeGpuMode();

    const sessionLooksWayland =
        (xdgSessionType && String(xdgSessionType).toLowerCase() === 'wayland') ||
        !!waylandDisplay;
    const sessionLooksX11 =
        (xdgSessionType && String(xdgSessionType).toLowerCase() === 'x11') ||
        (!!display && !sessionLooksWayland);

    let selectedBackend = 'auto';
    if (displayBackendOverride === 'wayland' || displayBackendOverride === 'x11' || displayBackendOverride === 'auto') {
        selectedBackend = displayBackendOverride;
    } else if (sessionLooksWayland) {
        selectedBackend = 'wayland';
    } else if (sessionLooksX11) {
        selectedBackend = 'x11';
    }

    // Paketli Linux sürümünde daha stabil varsayılan: Wayland yerine X11/auto.
    if (conservativeGpuMode && !displayBackendOverride && selectedBackend === 'wayland') {
        selectedBackend = display ? 'x11' : 'auto';
        console.log(`[Display] conservative packaged mode -> backend fallback: ${selectedBackend}`);
    }

    if (selectedBackend === 'wayland') {
        console.log('💻 Display Server: Wayland');
        app.commandLine.appendSwitch('ozone-platform-hint', 'wayland');
        app.commandLine.appendSwitch('disable-vulkan');
        app.commandLine.appendSwitch('use-angle', 'gl');
        appendCsvSwitch('enable-features', enableVaapi
            ? 'UseOzonePlatform,WaylandWindowDecorations,VaapiVideoDecoder'
            : 'UseOzonePlatform,WaylandWindowDecorations');
    } else if (selectedBackend === 'x11') {
        console.log('💻 Display Server: X11');
        app.commandLine.appendSwitch('ozone-platform-hint', 'x11');
        if (enableVaapi) {
            appendCsvSwitch('enable-features', 'VaapiVideoDecoder');
        }
    } else {
        console.log('💻 Display Server: auto');
        app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
        // auto modunda bile Wayland secilebilir; ozone feature'i acik olsun.
        appendCsvSwitch('enable-features', enableVaapi ? 'UseOzonePlatform,VaapiVideoDecoder' : 'UseOzonePlatform');
    }
    effectiveDisplayBackend = selectedBackend;
    process.env.AURIVO_EFFECTIVE_DISPLAY_BACKEND = selectedBackend;

    if (ozoneHint && !displayBackendOverride) {
        console.log(`[Display] ELECTRON_OZONE_PLATFORM_HINT=${ozoneHint} (session-based auto mode takes precedence)`);
    }
    if (displayBackendOverride) {
        console.log(`[Display] AURIVO_DISPLAY_BACKEND override active: ${displayBackendOverride}`);
    }

    if (!forceSoftware) {
        // GPU kara listesine takılan makinelerde siyah pencere olabiliyor
        app.commandLine.appendSwitch('ignore-gpu-blocklist');
    }

    if (forceSoftware) {
        app.commandLine.appendSwitch('disable-gpu');
        app.commandLine.appendSwitch('disable-gpu-compositing');
        app.commandLine.appendSwitch('use-gl', 'swiftshader');
        appendCsvSwitch('disable-features', 'UseSkiaRenderer');
    } else if (forceGpu) {
        app.commandLine.appendSwitch('ignore-gpu-blocklist');
    }

    // Genel GPU ayarları (performans için) - uygulama hazır olduğunda uygula
    if (app && app.commandLine) {
        if (!conservativeGpuMode) {
            app.commandLine.appendSwitch('enable-gpu-rasterization');
            app.commandLine.appendSwitch('enable-zero-copy');
        } else {
            console.log('[GPU] conservative packaged mode: zero-copy/rasterization flags skipped');
        }

        // Yazı tipi oluşturma iyileştirmeleri - Wayland/X11 uyumluluğu
        app.commandLine.appendSwitch('disable-font-subpixel-positioning');
        app.commandLine.appendSwitch('enable-font-antialiasing');
        app.commandLine.appendSwitch('force-device-scale-factor', '1');

        // Bağlam menüsü düzeltmeleri
        if (isTruthyEnvFlag('AURIVO_DISABLE_GPU_SANDBOX')) {
            app.commandLine.appendSwitch('disable-gpu-sandbox');
        }
    }
}

// ============================================================
// GPU GÜVENLİ MOD (TÜM PLATFORMLAR)
// ============================================================
function installGpuFailsafe() {
    const alreadySoftware = process.env.AURIVO_SOFTWARE_RENDER === '1' || process.env.AURIVO_SOFTWARE_RENDER === 'true';

    const triggerFallback = (reason) => {
        if (alreadySoftware) return;
        console.warn(`[GPU] Crash detected (${reason}) -> switching to software rendering`);
        app.relaunch({
            env: {
                ...process.env,
                AURIVO_SOFTWARE_RENDER: '1'
            }
        });
        app.exit(0);
    };

    app.on('gpu-process-crashed', () => triggerFallback('gpu-process-crashed'));
    app.on('child-process-gone', (_event, details) => {
        if (details?.type === 'GPU' || details?.reason === 'crashed') {
            triggerFallback(`child-process-gone:${details?.reason || 'unknown'}`);
        }
    });
}

// Uygulama başlamadan önce görüntü sunucusunu algıla
detectDisplayServer();
installGpuFailsafe();
// node-id3'yı yükle (ID3 etiketi okumak için)
let NodeID3 = null;
try {
    NodeID3 = require('node-id3');
    console.log('node-id3 başarıyla yüklendi');
} catch (e) {
    console.error('node-id3 yüklenemedi:', e.message);
}

// C++ Ses Motoru (tembel başlatma - Windows'ta eksik DLL durumunda UI'nin donmaması için)
let audioEngine = null;
let isNativeAudioAvailable = false;
let audioEngineModule = null;
let nativeAudioInitAttempted = false;

function initNativeAudioEngineSafe({ force = false } = {}) {
    if (nativeAudioInitAttempted && !force) return isNativeAudioAvailable;
    nativeAudioInitAttempted = true;

    try {
        logWindowsRuntimeDepsOnce('native-audio-init');
        audioEngineModule = require('./audioEngine');
        audioEngine = audioEngineModule?.audioEngine || null;

        if (!audioEngine || typeof audioEngine.initialize !== 'function') {
            isNativeAudioAvailable = false;
            return false;
        }

        const ok = !!audioEngine.initialize();
        isNativeAudioAvailable = !!ok && !!audioEngineModule?.isNativeAvailable;

        if (isNativeAudioAvailable) {
            console.log('✓ C++ Aurivo Audio Engine aktif');
            if (process.platform === 'win32') {
                console.log('[NativeAudio] addon:', audioEngineModule?.loadedAddonPath || '(unknown)');
            }
        } else {
            console.warn('⚠ Native audio başlatılamadı, HTML5 Audio kullanılacak');
            const err = audioEngineModule?.lastNativeLoadError;
            if (process.platform === 'win32' && err) {
                console.warn('[NativeAudio] Detay:', err.message || err);
            }
        }

        return isNativeAudioAvailable;
    } catch (e) {
        isNativeAudioAvailable = false;
        audioEngine = null;
        console.warn('C++ Audio Engine yüklenemedi:', e?.message || e);
        return false;
    }
}

let mainWindow;
let settingsWindow = null;
let adblockDashboardWindow = null;
let adblockDashboardAutoSyncTimer = null;
let adblockConfigBackgroundSyncTimer = null;
const ADBLOCK_DASHBOARD_WINDOW_SIZE = Object.freeze({
    width: 1120,
    height: 820,
});
const AURIVO_ADBLOCK_DEFAULT_COMPLETE_HOSTS = Object.freeze([
    'youtube.com',
    'music.youtube.com',
    'm.youtube.com',
    'youtu.be',
    'soundcloud.com',
    'm.soundcloud.com',
    'reddit.com',
    'old.reddit.com',
]);
const libraryWatchSessions = new Map();
let tray = null;
let mainWindowCloseToTray = true;
let lastTrayState = { isPlaying: false, currentTrack: 'Aurivo Media Player', isMuted: false, stopAfterCurrent: false };
let mediaShortcutsRegistered = false;
const GLOBAL_MEDIA_SHORTCUTS = Object.freeze([
    ['MediaPlayPause', 'play-pause'],
    ['MediaNextTrack', 'next'],
    ['MediaPreviousTrack', 'previous']
]);
let mprisPlayer = null;
let aurivoPulseProc = null;
let aurivoPulseGuiProc = null;
let aurivoPulseGuiLang = '';
let aurivoPulseStatus = {
    running: false,
    startedAt: null,
    command: '',
    source: '',
    lastError: ''
};
let aurivoPulseLastRecognition = {
    fingerprint: '',
    ts: 0
};
let aurivoPulseRecentRecognitions = [];
let pulseBridgeServer = null;
let pulseBridgePort = 0;
const PULSE_BRIDGE_HOST = '127.0.0.1';
const PULSE_BRIDGE_PATH = '/pulse/open';
const PULSE_BRIDGE_FALLBACK_PORT = 38947;
let pendingOpenMediaFiles = [];
let rendererMediaOpenReady = false;

function normalizeLaunchFilePath(rawPath) {
    const value = String(rawPath || '').trim();
    if (!value) return '';
    if (value.startsWith('--')) return '';
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value) && !value.startsWith('file://')) return '';

    let decoded = value;
    if (decoded.startsWith('file://')) {
        try {
            decoded = decodeURIComponent(new URL(decoded).pathname || '');
        } catch {
            decoded = '';
        }
    }
    if (!decoded) return '';

    const resolvedPath = path.resolve(decoded);
    try {
        if (!fs.existsSync(resolvedPath)) return '';
        const stat = fs.statSync(resolvedPath);
        if (!stat?.isFile?.()) return '';
        return resolvedPath;
    } catch {
        return '';
    }
}

function extractMediaPathsFromArgv(argv) {
    if (!Array.isArray(argv) || !argv.length) return [];
    const out = [];
    argv.forEach((arg, index) => {
        // İlk argüman çoğunlukla executable yoludur.
        if (index === 0) return;
        const normalized = normalizeLaunchFilePath(arg);
        if (normalized && !out.includes(normalized)) out.push(normalized);
    });
    return out;
}

function queuePendingOpenMediaFiles(paths) {
    const list = Array.isArray(paths) ? paths : [];
    list.forEach((item) => {
        const normalized = normalizeLaunchFilePath(item);
        if (!normalized) return;
        if (!pendingOpenMediaFiles.includes(normalized)) {
            pendingOpenMediaFiles.push(normalized);
        }
    });
}

function focusMainWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
    } catch {
        // yoksay
    }
}

function dispatchPendingOpenMediaFiles() {
    if (!rendererMediaOpenReady) return false;
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    if (!pendingOpenMediaFiles.length) return false;
    try {
        const payload = pendingOpenMediaFiles.slice();
        pendingOpenMediaFiles = [];
        mainWindow.webContents.send('app:open-media-files', { paths: payload });
        return true;
    } catch (e) {
        console.warn('[OPEN_MEDIA] dispatch error:', e?.message || e);
        return false;
    }
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
    app.exit(0);
}

app.on('second-instance', (_event, argv) => {
    const paths = extractMediaPathsFromArgv(argv);
    if (paths.length) {
        queuePendingOpenMediaFiles(paths);
        dispatchPendingOpenMediaFiles();
    }
    focusMainWindow();
});

app.on('open-file', (event, filePath) => {
    event.preventDefault();
    queuePendingOpenMediaFiles([filePath]);
    dispatchPendingOpenMediaFiles();
    focusMainWindow();
});

queuePendingOpenMediaFiles(extractMediaPathsFromArgv(process.argv));

async function getPerformanceSnapshot() {
    const snapshot = {
        timestamp: Date.now(),
        platform: process.platform,
        pid: process.pid,
        metrics: [],
        windows: {},
        gpu: {}
    };

    try {
        const appMetrics = app.getAppMetrics();
        snapshot.metrics = Array.isArray(appMetrics)
            ? appMetrics.map((metric) => ({
                pid: metric?.pid ?? null,
                type: metric?.type || 'unknown',
                serviceName: metric?.serviceName || '',
                name: metric?.name || '',
                cpu: Number(metric?.cpu?.percentCPUUsage || 0),
                idleWakeupsPerSecond: Number(metric?.cpu?.idleWakeupsPerSecond || 0),
                memoryWorkingSetKb: Number(metric?.memory?.workingSetSize || 0),
                memoryPrivateKb: Number(metric?.memory?.privateBytes || 0),
                memorySharedKb: Number(metric?.memory?.sharedBytes || 0)
            }))
            : [];
    } catch (error) {
        snapshot.metricsError = error?.message || String(error);
    }

    try {
        if (mainWindow && !mainWindow.isDestroyed()) {
            const wc = mainWindow.webContents;
            snapshot.windows.main = {
                title: mainWindow.getTitle(),
                visible: mainWindow.isVisible(),
                focused: mainWindow.isFocused(),
                minimized: mainWindow.isMinimized(),
                osPid: typeof wc.getOSProcessId === 'function' ? wc.getOSProcessId() : null
            };
            if (typeof wc.getProcessMemoryInfo === 'function') {
                try {
                    snapshot.windows.main.memory = await wc.getProcessMemoryInfo();
                } catch (error) {
                    snapshot.windows.main.memoryError = error?.message || String(error);
                }
            }
        }
    } catch (error) {
        snapshot.windows.mainError = error?.message || String(error);
    }

    try {
        snapshot.gpu.featureStatus = app.getGPUFeatureStatus();
    } catch (error) {
        snapshot.gpu.featureStatusError = error?.message || String(error);
    }

    return snapshot;
}

function getPulseBridgeUrl() {
    const port = Number(pulseBridgePort) || PULSE_BRIDGE_FALLBACK_PORT;
    return `https://${PULSE_BRIDGE_HOST}:${port}${PULSE_BRIDGE_PATH}`;
}

function getPulseBridgeTlsOptions() {
    const keyPath = String(process.env.AURIVO_PULSE_TLS_KEY_PATH || '').trim();
    const certPath = String(process.env.AURIVO_PULSE_TLS_CERT_PATH || '').trim();
    if (!keyPath || !certPath) {
        return null;
    }
    try {
        return {
            key: fs.readFileSync(path.resolve(keyPath)),
            cert: fs.readFileSync(path.resolve(certPath)),
            minVersion: 'TLSv1.2'
        };
    } catch (error) {
        console.warn('[PULSE] invalid TLS cert/key configuration:', error?.message || error);
        return null;
    }
}

function startPulseBridgeServer() {
    if (pulseBridgeServer) return;
    const tlsOptions = getPulseBridgeTlsOptions();
    if (!tlsOptions) {
        console.warn('[PULSE] bridge disabled: set AURIVO_PULSE_TLS_KEY_PATH and AURIVO_PULSE_TLS_CERT_PATH to enable secure bridge');
        return;
    }
    const handler = (req, res) => {
        try {
            const method = String(req?.method || '').toUpperCase();
            const rawUrl = String(req?.url || '/');
            const u = new URL(rawUrl, `http://${PULSE_BRIDGE_HOST}`);
            if (method !== 'GET' || u.pathname !== PULSE_BRIDGE_PATH) {
                res.statusCode = 404;
                res.end('Not Found');
                return;
            }
            const query = String(u.searchParams.get('query') || u.searchParams.get('q') || '').trim();
            const platform = String(u.searchParams.get('platform') || '').trim().toLowerCase();
            if (query) {
                emitPulseEvent('pulse:open-query', { query, platform, source: 'aurivo-pulse-gui' });
            }
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.end('OK');
        } catch (e) {
            res.statusCode = 500;
            res.end('ERR');
        }
    };
    pulseBridgeServer = https.createServer(tlsOptions, handler);
    pulseBridgeServer.on('error', (e) => {
        console.warn('[PULSE] bridge server error:', e?.message || e);
    });
    pulseBridgeServer.listen(PULSE_BRIDGE_FALLBACK_PORT, PULSE_BRIDGE_HOST, () => {
        const addr = pulseBridgeServer?.address?.();
        if (addr && typeof addr === 'object' && Number(addr.port) > 0) {
            pulseBridgePort = Number(addr.port);
        } else {
            pulseBridgePort = PULSE_BRIDGE_FALLBACK_PORT;
        }
    });
}

function stopPulseBridgeServer() {
    if (!pulseBridgeServer) return;
    try {
        pulseBridgeServer.close();
    } catch {
        // best-effort
    }
    pulseBridgeServer = null;
    pulseBridgePort = 0;
}

function stopAurivoPulseGuiWindow() {
    const child = aurivoPulseGuiProc;
    aurivoPulseGuiProc = null;
    aurivoPulseGuiLang = '';
    emitPulseGuiWindowState(false);
    if (!child) return;
    try {
        if (!child.killed) child.kill('SIGTERM');
    } catch {
        // best-effort
    }
}

function getLinuxMainWindowXid() {
    try {
        if (process.platform !== 'linux') return '';
        if (!mainWindow || mainWindow.isDestroyed()) return '';
        const handle = mainWindow.getNativeWindowHandle();
        if (!handle || !handle.length) return '';
        // X11'de handle çoğunlukla unsigned long (LE) olarak gelir.
        const id32 = handle.readUInt32LE(0);
        if (id32 > 0) return `0x${id32.toString(16)}`;
        if (handle.length >= 8) {
            const id64 = Number(handle.readBigUInt64LE(0));
            if (Number.isFinite(id64) && id64 > 0) return `0x${id64.toString(16)}`;
        }
    } catch {
        // yoksay
    }
    return '';
}

async function applyPulseLinuxWindowHints(childPid) {
    try {
        if (process.platform !== 'linux') return;
        const pid = Number(childPid || 0);
        if (!Number.isFinite(pid) || pid <= 0) return;

        const xdotool = findExecutable('xdotool', ['/usr/bin', '/usr/local/bin', '/bin']);
        const wmctrl = findExecutable('wmctrl', ['/usr/bin', '/usr/local/bin', '/bin']);
        if (!xdotool && !wmctrl) return;

        let childWid = '';
        if (xdotool) {
            // Pencerenin map olmasını bekle (kısa timeout ile).
            const lookup = await execCollect(
                xdotool,
                ['search', '--onlyvisible', '--pid', String(pid), '--name', '.*'],
                4500
            );
            if (lookup?.success && lookup?.output) {
                const lines = String(lookup.output).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
                childWid = lines.length ? lines[lines.length - 1] : '';
            }
        }
        if (!childWid) return;

        // Taskbar grouping için sınıf adı ana uygulamayla hizalanır.
        if (xdotool) {
            await execCollect(xdotool, ['set_window', '--class', 'aurivo-media-player', '--classname', 'aurivo-media-player', childWid], 1500);
        }

        // Ayrı ikon oluşmasını engellemek için taskbar'dan gizle.
        if (wmctrl) {
            await execCollect(wmctrl, ['-i', '-r', childWid, '-b', 'add,skip_taskbar'], 1500);
            await execCollect(wmctrl, ['-i', '-r', childWid, '-b', 'remove,skip_pager'], 1500);
        }

        // Mümkünse ana pencereye transient ilişki ver (X11 ortamlarında bazı shell'ler bunu dikkate alır).
        const parentXid = getLinuxMainWindowXid();
        if (xdotool && parentXid) {
            await execCollect(xdotool, ['set_window', '--name', 'Aurivo-Pulse', childWid], 800);
            // Not: xdotool transient API sunmadığı için burada best-effort bırakıyoruz.
        }
    } catch (e) {
        console.warn('[PULSE] Linux window hints apply failed:', e?.message || e);
    }
}

function emitPulseEvent(channel, payload) {
    try {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(channel, payload);
        }
    } catch (e) {
        console.warn('[PULSE] emit event failed:', e?.message || e);
    }
}

function emitPulseGuiWindowState(open) {
    try {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('pulse:window-state', { open: !!open });
        }
    } catch (e) {
        console.warn('[PULSE] emit window-state failed:', e?.message || e);
    }
}

function isAsarPath(targetPath = '') {
    const normalized = String(targetPath || '').replace(/\\/g, '/');
    if (!normalized) return false;
    // Hem "app.asar" arşivinin kendisini hem de içindeki sanal yolları yakala.
    // Electron fs API'si .asar'ı dizin gibi gösterebildiği için spawn/cwd için
    // kullanılmaları ENOTDIR ile sonuçlanabiliyor.
    return /(^|\/)[^/]+\.asar(?:\/|$)/.test(normalized);
}

function isRealDirectory(targetPath = '') {
    if (!targetPath || isAsarPath(targetPath)) return false;
    try {
        return fs.statSync(targetPath).isDirectory();
    } catch {
        return false;
    }
}

function isSpawnableBinary(targetPath = '') {
    if (!targetPath || isAsarPath(targetPath)) return false;
    try {
        const st = fs.statSync(targetPath);
        if (!st.isFile()) return false;
        const mode = process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK;
        fs.accessSync(targetPath, mode);
        return true;
    } catch {
        return false;
    }
}

function getAurivoPulseRoot() {
    const candidates = [
        path.join(__dirname, 'Aurivo-Pulse'),
        path.join(process.resourcesPath || '', 'Aurivo-Pulse')
    ];
    for (const p of candidates) {
        try {
            if (isRealDirectory(p) && !isAsarPath(path.join(p, 'Cargo.toml')) && fs.existsSync(path.join(p, 'Cargo.toml'))) {
                return p;
            }
        } catch {
            // yoksay
        }
    }
    return '';
}

function resolveSafePulseCwd(preferredRoot = '') {
    const candidates = [
        preferredRoot,
        __dirname,
        app?.getAppPath?.(),
        process.resourcesPath,
        process.cwd()
    ].filter(Boolean);
    for (const p of candidates) {
        if (isRealDirectory(p)) return p;
    }
    return process.cwd();
}

function findExecutable(cmdName, extraDirs = []) {
    const raw = String(cmdName || '').trim();
    if (!raw) return '';
    if (raw.includes(path.sep)) {
        return isSpawnableBinary(raw) ? raw : '';
    }

    const dirs = [
        ...(String(process.env.PATH || '').split(path.delimiter).filter(Boolean)),
        ...extraDirs
    ];
    const uniqDirs = [...new Set(dirs)];
    for (const dir of uniqDirs) {
        try {
            const candidate = path.join(dir, raw);
            fs.accessSync(candidate, fs.constants.X_OK);
            return candidate;
        } catch {
            // devam
        }
    }
    return '';
}

function resolveAurivoPulseLaunch() {
    const root = getAurivoPulseRoot();
    const safeCwd = resolveSafePulseCwd(root);
    const exeName = process.platform === 'win32' ? 'aurivo-pulse.exe' : 'aurivo-pulse';
    const platformSubdir = process.platform === 'win32' ? 'windows' : (process.platform === 'linux' ? 'linux' : process.platform);
    const binCandidates = [
        path.join(root, 'target', 'release', exeName),
        path.join(root, 'target', 'debug', exeName),
        path.join(__dirname, 'Aurivo-Pulse', 'target', 'release', exeName),
        path.join(process.resourcesPath || '', 'Aurivo-Pulse', 'target', 'release', exeName),
        path.join(process.resourcesPath || '', 'Aurivo-Pulse', exeName),
        path.join(process.resourcesPath || '', 'native-dist', exeName),
        path.join(process.resourcesPath || '', 'native-dist', platformSubdir, exeName)
    ].filter(Boolean);

    for (const bin of binCandidates) {
        if (isSpawnableBinary(bin)) {
            return {
                command: bin,
                args: ['listen', '--json'],
                cwd: safeCwd,
                source: 'bundled-binary'
            };
        }
    }

    const systemSongrec = findExecutable('songrec', ['/usr/bin', '/usr/local/bin', '/bin']);
    return {
        command: systemSongrec || 'songrec',
        args: ['listen', '--json'],
        cwd: safeCwd,
        source: 'system-aurivo-pulse'
    };
}

function resolveAurivoPulseGuiLaunch() {
    const root = getAurivoPulseRoot();
    const safeCwd = resolveSafePulseCwd(root);
    const hasLocalPulseSource = !!(root && fs.existsSync(path.join(root, 'Cargo.toml')));
    const isWin = process.platform === 'win32';
    const isPackaged = !!app?.isPackaged;
    const platformSubdir = isWin ? 'windows' : (process.platform === 'linux' ? 'linux' : process.platform);
    const exeNames = isWin
        ? ['aurivo-pulse.exe', 'songrec.exe']
        : ['aurivo-pulse', 'songrec'];

    const pathCandidates = [];
    for (const exeName of exeNames) {
        pathCandidates.push(
            path.join(root, 'target', 'release', exeName),
            path.join(root, 'target', 'debug', exeName),
            path.join(__dirname, 'Aurivo-Pulse', 'target', 'release', exeName),
            path.join(__dirname, 'Aurivo-Pulse', 'target', 'debug', exeName),
            path.join(process.resourcesPath || '', 'Aurivo-Pulse', 'target', 'release', exeName),
            path.join(process.resourcesPath || '', 'Aurivo-Pulse', exeName),
            path.join(process.resourcesPath || '', 'native-dist', exeName),
            path.join(process.resourcesPath || '', 'native-dist', platformSubdir, exeName)
        );
    }

    for (const bin of pathCandidates.filter(Boolean)) {
        if (isSpawnableBinary(bin)) {
            return { command: bin, args: ['gui'], cwd: safeCwd, source: 'bundled-gui-binary' };
        }
    }

    // Repo içi kaynak varsa, sistemdeki eski SongRec yerine proje sürümünü çalıştır.
    const cargoToml = path.join(root, 'Cargo.toml');
    const cargoBin = findExecutable('cargo', ['/usr/bin', '/usr/local/bin', '/bin']);
    if (fs.existsSync(cargoToml) && cargoBin) {
        return {
            command: cargoBin,
            args: ['run', '--quiet', '--', 'gui'],
            cwd: root,
            source: 'cargo-run-gui'
        };
    }

    // Yerel Aurivo-Pulse kaynak kodu varsa, sistemdeki farklı aurivo-pulse/songrec binary'sine düşme.
    if (hasLocalPulseSource && !isPackaged) {
        return null;
    }

    const systemAurivoPulse = findExecutable('aurivo-pulse', ['/usr/bin', '/usr/local/bin', '/bin']);
    if (systemAurivoPulse) {
        return { command: systemAurivoPulse, args: ['gui'], cwd: safeCwd, source: 'system-aurivo-pulse' };
    }
    const systemSongrec = findExecutable('songrec', ['/usr/bin', '/usr/local/bin', '/bin']);
    if (systemSongrec) {
        return { command: systemSongrec, args: ['gui'], cwd: safeCwd, source: 'system-songrec' };
    }

    return null;
}

function parsePulseDeviceLines(text) {
    const out = [];
    const seen = new Set();
    const lines = String(text || '').split(/\r?\n/);
    for (const ln of lines) {
        const line = String(ln || '').trim();
        if (!line) continue;
        // Aurivo-Pulse CLI formatı: "<localized prefix> <inner_name> (<display_name>)"
        // Örnek: "Available device: alsa_output.xxx.monitor (Monitor of Built-in Audio)"
        // Çıktı dil bağımsız parse edilmelidir.
        let left = '';
        let right = '';
        const parenMatch = line.match(/^(.*?)(?:\s*\(([^()]*)\)\s*)$/);
        if (parenMatch) {
            left = String(parenMatch[1] || '').trim();
            right = String(parenMatch[2] || '').trim();
            const colonIdx = left.lastIndexOf(':');
            if (colonIdx >= 0) left = left.slice(colonIdx + 1).trim();
        } else {
            // Fallback: "(...)" yoksa satırın son bölümünü cihaz adı kabul et
            const colonIdx = line.lastIndexOf(':');
            left = (colonIdx >= 0 ? line.slice(colonIdx + 1) : line).trim();
            right = '';
        }
        if (!left && !right) continue;

        // Heuristik: teknik görünen değer id, okunabilir görünen değer label olsun.
        const looksTechnical = (s) => /[:._-]/.test(String(s || ''));
        let id = left;
        let label = right || left;
        if (!looksTechnical(left) && looksTechnical(right)) {
            id = right;
            label = left || right;
        }

        id = String(id || '').trim();
        label = String(label || '').trim() || id;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push({ id, label });
    }
    return out;
}

function dedupeAudioDevices(devices) {
    const out = [];
    const seen = new Set();
    for (const dev of Array.isArray(devices) ? devices : []) {
        const id = String(dev?.id || '').trim();
        const label = String(dev?.label || id).trim();
        if (!id) continue;
        if (/^(alsa:)?null$/i.test(id)) continue;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push({ id, label: label || id });
    }
    return out;
}

function ensureCommonLinuxAudioEngines(devices) {
    const merged = dedupeAudioDevices(devices);
    const has = (id) => merged.some((d) => String(d.id || '').toLowerCase() === id.toLowerCase());
    const common = [
        { id: 'alsa:pipewire', label: 'alsa:pipewire' },
        { id: 'alsa:default', label: 'alsa:default' },
        { id: 'pulse', label: 'pulse' }
    ];
    for (const c of common) {
        if (!has(c.id)) merged.push(c);
    }
    return dedupeAudioDevices(merged);
}

function parsePactlShortSources(text) {
    const out = [];
    const lines = String(text || '').split(/\r?\n/);
    for (const ln of lines) {
        const line = String(ln || '').trim();
        if (!line) continue;
        // pactl list short sources: "<index>\t<name>\t<driver>\t<state>"
        const cols = line.split(/\t+/).map((s) => String(s || '').trim());
        if (cols.length < 2) continue;
        const name = cols[1];
        if (!name) continue;
        out.push({ id: name, label: name });
    }
    return out;
}

function parseArecordList(text) {
    const out = [];
    const lines = String(text || '').split(/\r?\n/);
    for (const ln of lines) {
        const line = String(ln || '').trim();
        if (!line || line.startsWith('#')) continue;
        if (/^null$/i.test(line)) continue;
        const normalizedId = /^alsa:/i.test(line) ? line : `alsa:${line}`;
        out.push({ id: normalizedId, label: normalizedId });
    }
    return out;
}

async function execCollect(command, args = [], timeoutMs = 3500) {
    return await new Promise((resolve) => {
        let combined = '';
        let timedOut = false;
        const resolvedCommand = findExecutable(command, ['/usr/bin', '/usr/local/bin', '/bin', '/usr/sbin', '/sbin']) || command;
        const child = spawn(resolvedCommand, args, {
            env: {
                ...process.env,
                LANG: 'C',
                LC_ALL: 'C'
            }
        });
        const timer = setTimeout(() => {
            timedOut = true;
            try { child.kill('SIGTERM'); } catch { }
        }, timeoutMs);
        child.stdout.on('data', (d) => { combined += String(d || ''); });
        child.stderr.on('data', (d) => { combined += String(d || ''); });
        child.once('error', () => {
            clearTimeout(timer);
            resolve({ success: false, output: '' });
        });
        child.once('close', () => {
            clearTimeout(timer);
            resolve({ success: !timedOut, output: combined });
        });
    });
}

async function listSystemAudioDevicesFallback() {
    const merged = [];

    // PulseAudio/PipeWire (Pulse uyumluluk katmanı)
    const pactl = await execCollect('pactl', ['list', 'short', 'sources']);
    if (pactl.success && pactl.output) {
        merged.push(...parsePactlShortSources(pactl.output));
    }

    // ALSA fallback
    const arecord = await execCollect('arecord', ['-L']);
    if (arecord.success && arecord.output) {
        merged.push(...parseArecordList(arecord.output));
    }

    if (merged.length === 0) {
        merged.push({ id: 'alsa:default', label: 'alsa:default' });
    }
    return ensureCommonLinuxAudioEngines(merged);
}

function parsePactlInfoDefaultSink(text) {
    const match = String(text || '').match(/^\s*Default Sink:\s*(.+)\s*$/mi);
    return match ? String(match[1] || '').trim() : '';
}

function parsePactlSinksDetailed(text) {
    const blocks = String(text || '')
        .split(/\n(?=Sink #\d+)/g)
        .map((block) => String(block || '').trim())
        .filter(Boolean);
    const out = [];
    for (const block of blocks) {
        const name = String(block.match(/^\s*Name:\s*(.+)\s*$/mi)?.[1] || '').trim();
        if (!name) continue;
        const description = String(block.match(/^\s*Description:\s*(.+)\s*$/mi)?.[1] || '').trim();
        const activePort = String(block.match(/^\s*Active Port:\s*(.+)\s*$/mi)?.[1] || '').trim();
        const sampleSpec = String(block.match(/^\s*Sample Specification:\s*(.+)\s*$/mi)?.[1] || '').trim();
        const muteRaw = String(block.match(/^\s*Mute:\s*(yes|no)\s*$/mi)?.[1] || '').trim().toLowerCase();
        const volLine = String(block.match(/^\s*Volume:.*$/mi)?.[0] || '').trim();
        const percent = Number(volLine.match(/(\d+)%/)?.[1] || 0);
        const sampleRateHz = Number(sampleSpec.match(/(\d+)\s*Hz/i)?.[1] || 0);
        const channelCount = Number(sampleSpec.match(/(\d+)\s*ch/i)?.[1] || 0);
        const sampleFormat = String(sampleSpec.match(/^([A-Za-z0-9]+)\b/)?.[1] || '').trim();
        out.push({
            name,
            description: description || name,
            activePort,
            sampleSpec,
            sampleRateHz: Number.isFinite(sampleRateHz) ? sampleRateHz : 0,
            channelCount: Number.isFinite(channelCount) ? channelCount : 0,
            sampleFormat,
            muted: muteRaw === 'yes',
            volumePercent: Number.isFinite(percent) ? percent : 0
        });
    }
    return out;
}

function parsePactlSourcesDetailed(text) {
    const blocks = String(text || '')
        .split(/\n(?=Source #\d+)/g)
        .map((block) => String(block || '').trim())
        .filter(Boolean);
    const out = [];
    for (const block of blocks) {
        const name = String(block.match(/^\s*Name:\s*(.+)\s*$/mi)?.[1] || '').trim();
        if (!name) continue;
        const description = String(block.match(/^\s*Description:\s*(.+)\s*$/mi)?.[1] || '').trim();
        const activePort = String(block.match(/^\s*Active Port:\s*(.+)\s*$/mi)?.[1] || '').trim();
        const sampleSpec = String(block.match(/^\s*Sample Specification:\s*(.+)\s*$/mi)?.[1] || '').trim();
        const muteRaw = String(block.match(/^\s*Mute:\s*(yes|no)\s*$/mi)?.[1] || '').trim().toLowerCase();
        const sampleRateHz = Number(sampleSpec.match(/(\d+)\s*Hz/i)?.[1] || 0);
        const channelCount = Number(sampleSpec.match(/(\d+)\s*ch/i)?.[1] || 0);
        const sampleFormat = String(sampleSpec.match(/^([A-Za-z0-9]+)\b/)?.[1] || '').trim();
        out.push({
            name,
            description: description || name,
            activePort,
            sampleSpec,
            sampleRateHz: Number.isFinite(sampleRateHz) ? sampleRateHz : 0,
            channelCount: Number.isFinite(channelCount) ? channelCount : 0,
            sampleFormat,
            muted: muteRaw === 'yes'
        });
    }
    return out;
}

function normalizeAudioDeviceFamily(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/\b(monitor of|monitor|analog stereo|digital stereo|mono|stereo|input|output|source|sink|device|port|microphone|mikrofon|headset|headphones|speaker|hoparlor|hoparlör|tek kanalli|tek kanallı|analog|usb audio|audio)\b/g, ' ')
        .replace(/[._\-:/()[\]]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function getAudioDeviceFamilyTokens(device) {
    return Array.from(new Set(
        normalizeAudioDeviceFamily([
            device?.description,
            device?.name,
            device?.activePort
        ].join(' '))
            .split(' ')
            .map((token) => token.trim())
            .filter((token) => token.length >= 3)
    ));
}

function findRelatedLinuxInputForSink(sink, sources) {
    const candidateSources = Array.isArray(sources)
        ? sources.filter((source) => !/monitor/i.test(String(source?.name || '')) && !/monitor/i.test(String(source?.description || '')))
        : [];
    if (!sink || !candidateSources.length) return null;
    const sinkTokens = getAudioDeviceFamilyTokens(sink);
    if (!sinkTokens.length) return null;

    let best = null;
    let bestScore = 0;
    for (const source of candidateSources) {
        const sourceTokens = getAudioDeviceFamilyTokens(source);
        if (!sourceTokens.length) continue;
        const overlap = sinkTokens.filter((token) => sourceTokens.includes(token));
        const score = overlap.length;
        if (score > bestScore) {
            bestScore = score;
            best = source;
        }
    }
    return bestScore >= 1 ? best : null;
}

function parsePactlShortSinks(text) {
    const out = [];
    const lines = String(text || '').split(/\r?\n/);
    for (const ln of lines) {
        const line = String(ln || '').trim();
        if (!line) continue;
        const cols = line.split(/\t+/).map((s) => String(s || '').trim());
        if (cols.length < 2) continue;
        const name = cols[1];
        if (!name) continue;
        out.push({ id: name, label: name });
    }
    return out;
}

function classifySystemOutputDevice(device) {
    const haystack = [
        device?.description,
        device?.activePort,
        device?.name
    ].join(' ').toLowerCase();

    if (/headphone|headset|earbud|airpods|buds|analog-output-headphones/.test(haystack)) {
        return { kind: 'headphones', isHeadphones: true, badge: 'Kulaklık' };
    }
    if (/bluetooth|bluez|a2dp/.test(haystack)) {
        return { kind: 'bluetooth', isHeadphones: false, badge: 'Bluetooth' };
    }
    if (/hdmi|displayport|dp-output/.test(haystack)) {
        return { kind: 'display', isHeadphones: false, badge: 'HDMI / Display' };
    }
    if (/usb/.test(haystack)) {
        return { kind: 'usb', isHeadphones: false, badge: 'USB Ses' };
    }
    return { kind: 'speakers', isHeadphones: false, badge: 'Hoparlör' };
}

function getLinuxRaiseMaximumVolumeSetting() {
    if (process.platform !== 'linux') return false;
    try {
        const cfgPath = path.join(os.homedir(), '.config', 'plasmaparc');
        const text = fs.readFileSync(cfgPath, 'utf8');
        const sectionMatch = text.match(/\[General\]([\s\S]*?)(?:\n\[|$)/i);
        const body = sectionMatch ? sectionMatch[1] : text;
        const raw = String(body.match(/^\s*RaiseMaximumVolume\s*=\s*(.+)\s*$/mi)?.[1] || '').trim().toLowerCase();
        return raw === 'true' || raw === '1' || raw === 'yes';
    } catch {
        return false;
    }
}

function setLinuxRaiseMaximumVolumeSetting(enabled) {
    if (process.platform !== 'linux') return false;
    try {
        const cfgPath = path.join(os.homedir(), '.config', 'plasmaparc');
        const nextValue = enabled ? 'true' : 'false';
        let text = '';
        try {
            text = fs.readFileSync(cfgPath, 'utf8');
        } catch {
            text = '';
        }

        if (!/\[General\]/i.test(text)) {
            text = `${text.trim()}\n[General]\nRaiseMaximumVolume=${nextValue}\n`.trim() + '\n';
        } else if (/^\s*RaiseMaximumVolume\s*=.*$/mi.test(text)) {
            text = text.replace(/^\s*RaiseMaximumVolume\s*=.*$/mi, `RaiseMaximumVolume=${nextValue}`);
        } else {
            text = text.replace(/\[General\]\s*/i, `[General]\nRaiseMaximumVolume=${nextValue}\n`);
        }

        fs.writeFileSync(cfgPath, text, 'utf8');
        return true;
    } catch {
        return false;
    }
}

async function getLinuxSystemAudioState() {
    const pactlInfo = await execCollect('pactl', ['info']);
    const defaultSink = parsePactlInfoDefaultSink(pactlInfo.output);
    const pactlSinks = await execCollect('pactl', ['list', 'sinks']);
    const sinks = parsePactlSinksDetailed(pactlSinks.output);
    const pactlSources = await execCollect('pactl', ['list', 'sources']);
    const sources = parsePactlSourcesDetailed(pactlSources.output);
    const current = sinks.find((sink) => sink.name === defaultSink) || sinks[0];
    const raiseMaximumVolumeEnabled = getLinuxRaiseMaximumVolumeSetting();

    if (!current) {
        return {
            success: false,
            supported: false,
            platform: process.platform,
            error: 'Varsayılan ses çıkışı bulunamadı'
        };
    }

    const classified = classifySystemOutputDevice(current);
    const relatedInput = findRelatedLinuxInputForSink(current, sources);
    return {
        success: true,
        supported: true,
        platform: process.platform,
        volumePercent: Math.max(0, Math.min(150, Number(current.volumePercent) || 0)),
        muted: !!current.muted,
        currentOutputName: String(current.description || current.name || '').trim() || 'Bilinmeyen çıkış',
        currentOutputId: String(current.name || '').trim(),
        currentOutputPort: String(current.activePort || '').trim(),
        currentOutputKind: classified.kind,
        currentOutputBadge: classified.badge,
        isHeadphones: !!classified.isHeadphones,
        sampleSpec: String(current.sampleSpec || '').trim(),
        sampleRateHz: Number(current.sampleRateHz) || 0,
        channelCount: Number(current.channelCount) || 0,
        sampleFormat: String(current.sampleFormat || '').trim(),
        hasRelatedInput: !!relatedInput,
        relatedInputName: String(relatedInput?.description || relatedInput?.name || '').trim(),
        raiseMaximumVolumeEnabled,
        canBoostOver100: true,
        maxVolumePercent: 150
    };
}

async function listLinuxSystemAudioOutputs() {
    const pactlSinks = await execCollect('pactl', ['list', 'sinks']);
    const detailed = parsePactlSinksDetailed(pactlSinks.output);
    if (detailed.length) {
        return detailed.map((sink) => {
            const classified = classifySystemOutputDevice(sink);
            return {
                id: String(sink.name || '').trim(),
                name: String(sink.name || '').trim(),
                label: String(sink.description || sink.name || '').trim(),
                badge: classified.badge,
                kind: classified.kind,
                isHeadphones: !!classified.isHeadphones
            };
        }).filter((item) => item.id);
    }

    const short = await execCollect('pactl', ['list', 'short', 'sinks']);
    return parsePactlShortSinks(short.output).map((sink) => ({
        id: sink.id,
        name: sink.id,
        label: sink.label,
        badge: 'Ses Çıkışı',
        kind: 'unknown',
        isHeadphones: false
    }));
}

async function listSystemAudioOutputs() {
    if (process.platform === 'linux') {
        return {
            success: true,
            supported: true,
            platform: process.platform,
            outputs: await listLinuxSystemAudioOutputs()
        };
    }
    return {
        success: true,
        supported: false,
        platform: process.platform,
        outputs: []
    };
}

async function getSystemAudioState() {
    if (process.platform === 'linux') {
        return await getLinuxSystemAudioState();
    }
    return {
        success: true,
        supported: false,
        platform: process.platform,
        volumePercent: null,
        muted: false,
        currentOutputName: process.platform === 'win32' ? 'Windows varsayılan çıkış' : 'Sistem varsayılan çıkışı',
        currentOutputId: '',
        currentOutputPort: '',
        currentOutputKind: 'unknown',
        currentOutputBadge: process.platform === 'win32' ? 'Windows' : 'Sistem',
        isHeadphones: false,
        sampleSpec: '',
        sampleRateHz: 0,
        channelCount: 0,
        sampleFormat: '',
        hasRelatedInput: false,
        relatedInputName: '',
        canBoostOver100: false,
        maxVolumePercent: 100
    };
}

async function setLinuxSystemAudioVolume(percent) {
    const safePercent = Math.max(0, Math.min(150, Number(percent) || 0));
    if (safePercent > 100) {
        setLinuxRaiseMaximumVolumeSetting(true);
    }
    const result = await execCollect('pactl', ['set-sink-volume', '@DEFAULT_SINK@', `${safePercent}%`], 3500);
    if (!result.success) {
        return { success: false, error: 'Sistem ses seviyesi ayarlanamadı' };
    }
    const state = await getLinuxSystemAudioState();
    return { success: !!state.success, state };
}

async function setSystemAudioAllowOverdrive(enabled) {
    if (process.platform === 'linux') {
        const ok = setLinuxRaiseMaximumVolumeSetting(!!enabled);
        const state = await getLinuxSystemAudioState();
        return { success: ok && !!state.success, state };
    }
    return { success: false, error: 'Bu platformda 150% ses izni desteklenmiyor' };
}

async function setLinuxSystemAudioOutput(outputId) {
    const safeId = String(outputId || '').trim();
    if (!safeId) return { success: false, error: 'Çıkış cihazı belirtilmedi' };
    const result = await execCollect('pactl', ['set-default-sink', safeId], 3500);
    if (!result.success) {
        return { success: false, error: 'Varsayılan ses çıkışı değiştirilemedi' };
    }
    const state = await getLinuxSystemAudioState();
    return { success: !!state.success, state };
}

async function setSystemAudioOutput(outputId) {
    if (process.platform === 'linux') {
        return await setLinuxSystemAudioOutput(outputId);
    }
    return { success: false, error: 'Bu platformda çıkış cihazı değişimi desteklenmiyor' };
}

async function setSystemAudioVolume(percent) {
    if (process.platform === 'linux') {
        return await setLinuxSystemAudioVolume(percent);
    }
    return { success: false, error: 'Bu platformda sistem ses ayarı desteklenmiyor' };
}

async function listAurivoPulseDevices() {
    const launch = resolveAurivoPulseLaunch();
    return await new Promise((resolve) => {
        let combined = '';
        const child = spawn(launch.command, ['listen', '--list-devices'], {
            cwd: launch.cwd,
            env: buildPulseRuntimeEnv({
                AURIVO_PULSE_NO_GUI: '1',
                // Parse tutarlılığı için CLI çıktısını sabitle
                LANG: 'C',
                LC_ALL: 'C'
            })
        });
        child.stdout.on('data', (d) => { combined += String(d || ''); });
        child.stderr.on('data', (d) => { combined += String(d || ''); });
        child.once('error', async (e) => {
            const fallbackDevices = await listSystemAudioDevicesFallback();
            resolve({
                success: true,
                devices: fallbackDevices,
                warning: e?.message || String(e)
            });
        });
        child.once('close', async () => {
            let devices = dedupeAudioDevices(parsePulseDeviceLines(combined));
            if (!devices.length || (devices.length === 1 && String(devices[0]?.id || '').toLowerCase() === 'alsa:default')) {
                const fallbackDevices = await listSystemAudioDevicesFallback();
                if (fallbackDevices.length) {
                    devices = dedupeAudioDevices([...devices, ...fallbackDevices]);
                }
            }
            devices = ensureCommonLinuxAudioEngines(devices);
            resolve({ success: true, devices });
        });
    });
}

function pickPreferredMonitorDeviceId(devices) {
    const list = Array.isArray(devices) ? devices : [];
    if (!list.length) return '';

    const asText = (dev) => [
        String(dev?.id || ''),
        String(dev?.name || ''),
        String(dev?.label || ''),
        String(dev?.description || '')
    ].join(' ').toLowerCase();

    // 1) Dogrudan monitor cihazlarini tercih et
    const monitor = list.find((dev) => /\bmonitor\b/.test(asText(dev)));
    if (monitor?.id) return String(monitor.id);

    // 2) PipeWire/Pulse "output" benzeri yakalama kaynaklarini ikinci tercih yap
    const outputLike = list.find((dev) => /(alsa_output|output|loopback|monitor_of)/.test(asText(dev)));
    if (outputLike?.id) return String(outputLike.id);

    return '';
}

function parsePulseResultLine(line) {
    const raw = String(line || '').trim();
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw);
        const candidates = Array.isArray(parsed?.matches)
            ? parsed.matches
                .map((entry) => ({
                    title: String(entry?.track?.title || '').trim(),
                    artist: String(entry?.track?.subtitle || '').trim(),
                    trackKey: String(entry?.track?.key || '').trim()
                }))
                .filter((entry) => entry.title || entry.artist)
                .slice(0, 3)
            : [];
        const title =
            parsed?.track?.title ||
            parsed?.title ||
            parsed?.song?.title ||
            parsed?.matches?.[0]?.track?.title ||
            '';
        const artist =
            parsed?.track?.subtitle ||
            parsed?.subtitle ||
            parsed?.artist ||
            parsed?.song?.artist ||
            parsed?.matches?.[0]?.track?.subtitle ||
            '';
        const trackKey =
            parsed?.track?.key ||
            parsed?.track?.track_key ||
            parsed?.track?.hub?.track_key ||
            parsed?.matches?.[0]?.track?.key ||
            '';

        return {
            raw,
            parsed,
            title: String(title || '').trim(),
            artist: String(artist || '').trim(),
            trackKey: String(trackKey || '').trim(),
            candidates,
            ts: Date.now()
        };
    } catch {
        return {
            raw,
            parsed: null,
            title: '',
            artist: '',
            trackKey: '',
            candidates: [],
            ts: Date.now()
        };
    }
}

function makePulseRecognitionFingerprint(result) {
    const trackKey = String(result?.trackKey || '').trim().toLowerCase();
    if (trackKey) return `k:${trackKey}`;
    const title = String(result?.title || '').trim().toLowerCase();
    const artist = String(result?.artist || '').trim().toLowerCase();
    const raw = String(result?.raw || '').trim().toLowerCase();
    if (title || artist) return `s:${artist} - ${title}`;
    return `r:${raw}`;
}

function resetAurivoPulseRecognitionState() {
    aurivoPulseLastRecognition = { fingerprint: '', ts: 0 };
    aurivoPulseRecentRecognitions = [];
}

function shouldEmitStablePulseResult(result) {
    const now = Date.now();
    const fp = makePulseRecognitionFingerprint(result);
    if (!fp) return false;
    const candidateCount = Array.isArray(result?.candidates) ? result.candidates.length : 0;
    const hasTrackKey = !!String(result?.trackKey || '').trim();
    const hasTitle = !!String(result?.title || '').trim();
    const hasArtist = !!String(result?.artist || '').trim();
    const hasConfidentDirectTrack = !!(
        hasTitle &&
        hasArtist &&
        hasTrackKey &&
        candidateCount <= 1 &&
        (
            result?.parsed?.track?.title ||
            result?.parsed?.matches?.[0]?.track?.title
        )
    );

    if (hasConfidentDirectTrack) {
        if (
            aurivoPulseLastRecognition.fingerprint === fp &&
            (now - Number(aurivoPulseLastRecognition.ts || 0)) < 90000
        ) {
            return false;
        }
        aurivoPulseLastRecognition = { fingerprint: fp, ts: now };
        aurivoPulseRecentRecognitions = [{ fingerprint: fp, ts: now, result }];
        return true;
    }

    aurivoPulseRecentRecognitions = aurivoPulseRecentRecognitions
        .filter((entry) => entry && (now - Number(entry.ts || 0)) <= 28000);
    aurivoPulseRecentRecognitions.push({ fingerprint: fp, ts: now, result });
    if (aurivoPulseRecentRecognitions.length > 5) {
        aurivoPulseRecentRecognitions = aurivoPulseRecentRecognitions.slice(-5);
    }

    const matching = aurivoPulseRecentRecognitions.filter((entry) => entry.fingerprint === fp);
    if (matching.length < 2) {
        return false;
    }

    if (
        aurivoPulseLastRecognition.fingerprint === fp &&
        (now - Number(aurivoPulseLastRecognition.ts || 0)) < 90000
    ) {
        return false;
    }

    aurivoPulseLastRecognition = { fingerprint: fp, ts: now };
    aurivoPulseRecentRecognitions = aurivoPulseRecentRecognitions.filter((entry) => entry.fingerprint === fp);
    return true;
}

function maybeEmitUncertainPulseResult(result) {
    const now = Date.now();
    if (aurivoPulseRecentRecognitions.length < 3) return;
    const counts = new Map();
    for (const entry of aurivoPulseRecentRecognitions) {
        const cur = counts.get(entry.fingerprint) || 0;
        counts.set(entry.fingerprint, cur + 1);
    }
    const strongest = Math.max(0, ...Array.from(counts.values()));
    if (strongest >= 2) return;
    if ((now - Number(aurivoPulseLastRecognition.ts || 0)) < 12000) return;
    const candidates = Array.isArray(result?.candidates) ? result.candidates : [];
    if (!candidates.length) return;
    emitPulseEvent('pulse:uncertain', {
        ts: now,
        candidates
    });
    aurivoPulseLastRecognition = { fingerprint: `uncertain:${now}`, ts: now };
}

function getAurivoPulsePreferencePaths() {
    const home = os.homedir();
    const xdgConfigHome = String(process.env.XDG_CONFIG_HOME || '').trim();
    const candidates = [
        xdgConfigHome ? path.join(xdgConfigHome, 'aurivo-pulse', 'preferences.toml') : '',
        xdgConfigHome ? path.join(xdgConfigHome, 'Aurivo-Pulse', 'preferences.toml') : '',
        home ? path.join(home, '.config', 'aurivo-pulse', 'preferences.toml') : '',
        home ? path.join(home, '.config', 'Aurivo-Pulse', 'preferences.toml') : '',
        home ? path.join(home, '.var', 'app', 're.fossplant.songrec', 'config', 'aurivo-pulse', 'preferences.toml') : '',
        home ? path.join(home, '.var', 'app', 're.fossplant.songrec', 'config', 'Aurivo-Pulse', 'preferences.toml') : ''
    ];
    return [...new Set(candidates.filter(Boolean))];
}

function parseAurivoPulsePreferredDevice(text) {
    const raw = String(text || '');
    if (!raw) return '';
    const match = raw.match(/^\s*current_device_name\s*=\s*"((?:[^"\\]|\\.)*)"/m);
    if (!match) return '';
    return String(match[1] || '')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\')
        .trim();
}

function parseAurivoPulseStringPref(text, key) {
    const raw = String(text || '');
    const match = raw.match(new RegExp(`^\\s*${key}\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'm'));
    if (!match) return '';
    return String(match[1] || '')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\')
        .trim();
}

function parseAurivoPulseBoolPref(text, key, fallback = false) {
    const raw = String(text || '');
    const match = raw.match(new RegExp(`^\\s*${key}\\s*=\\s*(true|false)\\s*$`, 'mi'));
    if (!match) return !!fallback;
    return String(match[1]).toLowerCase() === 'true';
}

function parseAurivoPulseIntPref(text, key, fallback = 0) {
    const raw = String(text || '');
    const match = raw.match(new RegExp(`^\\s*${key}\\s*=\\s*(\\d+)\\s*$`, 'm'));
    if (!match) return Number(fallback) || 0;
    const num = Number(match[1]);
    return Number.isFinite(num) ? num : (Number(fallback) || 0);
}

function getDefaultAurivoPulsePreferences() {
    return {
        enable_notifications: true,
        enable_mpris: false,
        enable_systray: false,
        no_duplicates: false,
        // Dengeli kalite/hiz: hizli (2/5) profile gore daha guvenilir sonuc verir.
        request_interval_secs_v3: 4,
        buffer_size_secs: 8,
        current_device_name: '',
        recognition_engine: 'hybrid',
        acoustid_api_key: ''
    };
}

async function migrateLegacyAurivoPulsePerformancePrefsIfNeeded() {
    const current = readAurivoPulsePreferences();
    const preferences = current?.preferences || {};
    const requestInterval = Number(preferences.request_interval_secs_v3) || 0;
    const bufferSize = Number(preferences.buffer_size_secs) || 0;
    // Eski profilleri dengeli varsayilana getir:
    // - cok hizli: 2/5
    // - eski SongRec varsayilani: 8/12
    if ((requestInterval === 2 && bufferSize === 5) || (requestInterval === 8 && bufferSize === 12)) {
        await saveAurivoPulsePreferences({
            request_interval_secs_v3: getDefaultAurivoPulsePreferences().request_interval_secs_v3,
            buffer_size_secs: getDefaultAurivoPulsePreferences().buffer_size_secs
        });
    }
}

function readAurivoPulsePreferences() {
    const defaults = getDefaultAurivoPulsePreferences();
    const candidates = getAurivoPulsePreferencePaths();
    const parsed = [];

    for (const prefPath of candidates) {
        try {
            if (!fs.existsSync(prefPath)) continue;
            const stat = fs.statSync(prefPath);
            const mtimeMs = Number(stat?.mtimeMs || 0);
            const text = fs.readFileSync(prefPath, 'utf8');
            parsed.push({
                path: prefPath,
                mtimeMs,
                preferences: {
                    enable_notifications: parseAurivoPulseBoolPref(text, 'enable_notifications', defaults.enable_notifications),
                    enable_mpris: parseAurivoPulseBoolPref(text, 'enable_mpris', defaults.enable_mpris),
                    enable_systray: parseAurivoPulseBoolPref(text, 'enable_systray', defaults.enable_systray),
                    no_duplicates: parseAurivoPulseBoolPref(text, 'no_duplicates', defaults.no_duplicates),
                    request_interval_secs_v3: parseAurivoPulseIntPref(text, 'request_interval_secs_v3', defaults.request_interval_secs_v3),
                    buffer_size_secs: parseAurivoPulseIntPref(text, 'buffer_size_secs', defaults.buffer_size_secs),
                    current_device_name: parseAurivoPulseStringPref(text, 'current_device_name') || defaults.current_device_name,
                    recognition_engine: parseAurivoPulseStringPref(text, 'recognition_engine') || '',
                    acoustid_api_key: parseAurivoPulseStringPref(text, 'acoustid_api_key') || ''
                }
            });
        } catch (e) {
            console.warn('[PULSE] preferences read/stat error:', prefPath, e?.message || e);
        }
    }

    if (!parsed.length) {
        return { success: true, source: candidates[0] || '', preferences: defaults };
    }

    parsed.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const selected = parsed[0];
    const fallbackWithKey = parsed.find((entry) => String(entry?.preferences?.acoustid_api_key || '').trim().length > 0);

    const recognitionEngine = ['hybrid', 'songrec_only', 'acoustid_only'].includes(
        String(selected.preferences.recognition_engine || '').trim().toLowerCase()
    )
        ? String(selected.preferences.recognition_engine).trim().toLowerCase()
        : (fallbackWithKey?.preferences?.recognition_engine || defaults.recognition_engine);

    const acoustidApiKey = String(selected.preferences.acoustid_api_key || '').trim()
        || String(fallbackWithKey?.preferences?.acoustid_api_key || '').trim()
        || defaults.acoustid_api_key;

    return {
        success: true,
        source: selected.path,
        preferences: {
            ...selected.preferences,
            recognition_engine: recognitionEngine,
            acoustid_api_key: acoustidApiKey
        }
    };
}

function upsertAurivoPulsePref(text, key, value) {
    const raw = String(text || '');
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let serialized = '';
    if (typeof value === 'boolean') {
        serialized = value ? 'true' : 'false';
    } else if (typeof value === 'number') {
        serialized = String(Math.max(0, Math.round(value)));
    } else {
        const escaped = String(value || '')
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"');
        serialized = `"${escaped}"`;
    }
    const line = `${key} = ${serialized}`;
    const pattern = new RegExp(`^\\s*${escapedKey}\\s*=.*$`, 'm');
    if (pattern.test(raw)) {
        return raw.replace(pattern, line);
    }
    return `${raw.trimEnd()}\n${line}\n`;
}

async function saveAurivoPulsePreferences(update = {}) {
    const current = readAurivoPulsePreferences();
    const candidatePaths = getAurivoPulsePreferencePaths();
    const next = {
        ...getDefaultAurivoPulsePreferences(),
        ...(current?.preferences || {}),
        ...(update && typeof update === 'object' ? update : {})
    };
    const prefPath = current?.source || candidatePaths[0];
    if (!prefPath) {
        throw new Error('Aurivo-Pulse preference path bulunamadi');
    }
    await fs.promises.mkdir(path.dirname(prefPath), { recursive: true });
    let text = '';
    try {
        text = await fs.promises.readFile(prefPath, 'utf8');
    } catch {
        text = '';
    }
    text = upsertAurivoPulsePref(text, 'enable_notifications', !!next.enable_notifications);
    text = upsertAurivoPulsePref(text, 'enable_mpris', !!next.enable_mpris);
    text = upsertAurivoPulsePref(text, 'enable_systray', !!next.enable_systray);
    text = upsertAurivoPulsePref(text, 'no_duplicates', !!next.no_duplicates);
    text = upsertAurivoPulsePref(
        text,
        'request_interval_secs_v3',
        Number(next.request_interval_secs_v3) || getDefaultAurivoPulsePreferences().request_interval_secs_v3
    );
    text = upsertAurivoPulsePref(
        text,
        'buffer_size_secs',
        Number(next.buffer_size_secs) || getDefaultAurivoPulsePreferences().buffer_size_secs
    );
    text = upsertAurivoPulsePref(text, 'current_device_name', String(next.current_device_name || ''));
    text = upsertAurivoPulsePref(text, 'recognition_engine', String(next.recognition_engine || 'hybrid'));
    text = upsertAurivoPulsePref(text, 'acoustid_api_key', String(next.acoustid_api_key || ''));
    await fs.promises.writeFile(prefPath, text, 'utf8');

    // Keep lowercase/uppercase config directories synchronized to avoid split settings.
    for (const mirrorPath of candidatePaths) {
        if (!mirrorPath || mirrorPath === prefPath) continue;
        try {
            await fs.promises.mkdir(path.dirname(mirrorPath), { recursive: true });
            await fs.promises.writeFile(mirrorPath, text, 'utf8');
        } catch (e) {
            console.warn('[PULSE] preferences mirror write error:', mirrorPath, e?.message || e);
        }
    }

    return { success: true, source: prefPath, preferences: next };
}

function getAurivoPulsePreferredDevice() {
    for (const prefPath of getAurivoPulsePreferencePaths()) {
        try {
            if (!fs.existsSync(prefPath)) continue;
            const text = fs.readFileSync(prefPath, 'utf8');
            const audioDevice = parseAurivoPulsePreferredDevice(text);
            if (audioDevice) {
                return {
                    success: true,
                    audioDevice,
                    source: prefPath
                };
            }
        } catch (e) {
            console.warn('[PULSE] preference read error:', e?.message || e);
        }
    }
    return { success: true, audioDevice: '', source: '' };
}

function stopAurivoPulseListening() {
    if (!aurivoPulseProc) {
        aurivoPulseStatus.running = false;
        return { success: true, running: false };
    }

    try {
        aurivoPulseProc.kill('SIGTERM');
    } catch (e) {
        console.warn('[PULSE] kill error:', e?.message || e);
    }

    aurivoPulseProc = null;
    aurivoPulseStatus.running = false;
    aurivoPulseStatus.startedAt = null;
    resetAurivoPulseRecognitionState();
    emitPulseEvent('pulse:state', { running: false, reason: 'stopped', ...aurivoPulseStatus });
    return { success: true, running: false };
}

function startAurivoPulseListening(options = {}) {
    const requestedAudioDevice = String(options?.audioDevice || '').trim();
    const requestedDisableMpris = !!options?.disableMpris;
    const requestedBackgroundMode = !!options?.backgroundMode;
    const requestedProfile = String(options?.profile || '').trim().toLowerCase();
    const requestedIntervalRaw = Number(options?.requestInterval);
    const requestedInterval = Number.isFinite(requestedIntervalRaw) && requestedIntervalRaw > 0
        ? Math.max(1, Math.floor(requestedIntervalRaw))
        : null;

    if (aurivoPulseProc) {
        const activeDevice = String(aurivoPulseStatus?.audioDevice || '').trim();
        const activeDisableMpris = !!aurivoPulseStatus?.disableMpris;
        const activeBackgroundMode = !!aurivoPulseStatus?.backgroundMode;
        const activeProfile = String(aurivoPulseStatus?.profile || '').trim().toLowerCase();
        const activeInterval = Number(aurivoPulseStatus?.requestInterval || 10);

        const deviceChanged = !!requestedAudioDevice && requestedAudioDevice !== activeDevice;
        const mprisChanged = requestedDisableMpris !== activeDisableMpris;
        const backgroundModeChanged = requestedBackgroundMode !== activeBackgroundMode;
        const profileChanged = requestedProfile !== activeProfile;
        const intervalChanged = requestedInterval !== null && requestedInterval !== activeInterval;
        const forceRestart = !!options?.forceRestart;

        if (forceRestart || deviceChanged || mprisChanged || backgroundModeChanged || profileChanged || intervalChanged) {
            stopAurivoPulseListening();
        } else {
            return { success: true, running: true, alreadyRunning: true, ...aurivoPulseStatus };
        }
    }

    const launch = resolveAurivoPulseLaunch();
    const args = ['listen', '--json'];
    const audioDevice = requestedAudioDevice;
    if (audioDevice) {
        args.push('-d', audioDevice);
    }
    if (requestedDisableMpris) {
        args.push('--disable-mpris');
    }
    if (requestedInterval !== null) {
        args.push('-i', String(requestedInterval));
    }
    const child = spawn(launch.command, args, {
        cwd: launch.cwd,
        env: buildPulseRuntimeEnv({
            AURIVO_PULSE_NO_GUI: '1',
            AURIVO_PULSE_BACKGROUND_MODE: requestedBackgroundMode ? '1' : '0',
            AURIVO_PULSE_BACKGROUND_PROFILE: requestedProfile || (requestedBackgroundMode ? 'background' : 'normal')
        })
    });

    aurivoPulseProc = child;
    aurivoPulseStatus = {
        running: true,
        startedAt: Date.now(),
        command: `${launch.command} ${args.join(' ')}`,
        source: launch.source,
        audioDevice: audioDevice || '',
        disableMpris: requestedDisableMpris,
        backgroundMode: requestedBackgroundMode,
        profile: requestedProfile || (requestedBackgroundMode ? 'background' : 'normal'),
        requestInterval: requestedInterval !== null ? requestedInterval : 10,
        lastError: ''
    };
    resetAurivoPulseRecognitionState();

    const onStdoutLine = (line) => {
        const result = parsePulseResultLine(line);
        if (!result) return;
        if (!shouldEmitStablePulseResult(result)) {
            maybeEmitUncertainPulseResult(result);
            return;
        }
        emitPulseEvent('pulse:result', result);
    };
    const onStderrLine = (line) => {
        const text = String(line || '').trim();
        if (!text) return;
        aurivoPulseStatus.lastError = text;
        emitPulseEvent('pulse:state', { running: true, warning: text, ...aurivoPulseStatus });
    };

    readline.createInterface({ input: child.stdout }).on('line', onStdoutLine);
    readline.createInterface({ input: child.stderr }).on('line', onStderrLine);

    child.once('error', (err) => {
        // Eski bir process'in geç gelen olayı yeni oturumu bozmasın.
        if (aurivoPulseProc !== child) return;
        const message = err?.message || String(err || 'Aurivo-Pulse başlatılamadı');
        aurivoPulseProc = null;
        aurivoPulseStatus.running = false;
        aurivoPulseStatus.startedAt = null;
        aurivoPulseStatus.lastError = message;
        emitPulseEvent('pulse:state', { running: false, error: message, ...aurivoPulseStatus });
    });

    child.once('close', (code, signal) => {
        // stop->start sırasında eski process kapanışı yeni süreci "stopped" yapmamalı.
        if (aurivoPulseProc !== child) return;
        aurivoPulseProc = null;
        aurivoPulseStatus.running = false;
        aurivoPulseStatus.startedAt = null;
        if (typeof code === 'number' && code !== 0) {
            aurivoPulseStatus.lastError = `Aurivo-Pulse process exited with code ${code}`;
        }
        emitPulseEvent('pulse:state', {
            running: false,
            code,
            signal,
            ...aurivoPulseStatus
        });
    });

    emitPulseEvent('pulse:state', { running: true, ...aurivoPulseStatus });
    return { success: true, running: true, ...aurivoPulseStatus };
}

async function recognizeSongFromFileWithPulse(filePath) {
    const input = String(filePath || '').trim();
    if (!input) return { success: false, error: 'Geçersiz dosya yolu' };
    if (!fs.existsSync(input)) return { success: false, error: 'Dosya bulunamadı' };

    const launch = resolveAurivoPulseLaunch();
    return await new Promise((resolve) => {
        let out = '';
        let err = '';
        const child = spawn(launch.command, ['recognize', '--json', input], {
            cwd: launch.cwd,
            env: buildPulseRuntimeEnv({ AURIVO_PULSE_NO_GUI: '1' })
        });

        const timeout = setTimeout(() => {
            try { child.kill('SIGTERM'); } catch { }
            resolve({ success: false, error: 'Tanıma zaman aşımına uğradı' });
        }, 60000);

        child.stdout.on('data', (d) => { out += String(d || ''); });
        child.stderr.on('data', (d) => { err += String(d || ''); });
        child.once('error', (e) => {
            clearTimeout(timeout);
            resolve({ success: false, error: e?.message || String(e) });
        });
        child.once('close', () => {
            clearTimeout(timeout);
            const raw = String(out || '').trim();
            if (!raw) {
                resolve({ success: false, error: String(err || 'Tanıma sonucu alınamadı').trim() });
                return;
            }

            const parsedResult = parsePulseResultLine(raw);
            resolve({
                success: true,
                result: parsedResult
            });
        });
    });
}

async function captureMonitorSampleAndRecognizeWithPulse(options = {}) {
    if (process.platform !== 'linux') {
        return { success: false, error: 'Bu fallback şu anda Linux ile sınırlı' };
    }

    const audioDevice = String(options?.audioDevice || '').trim();
    if (!audioDevice) return { success: false, error: 'Ses cihazı gerekli' };
    if (!/monitor/i.test(audioDevice)) {
        return { success: false, error: 'Fallback için monitor cihazı gerekli' };
    }

    const durationSec = Math.max(6, Math.min(18, Number(options?.durationSec) || 10));
    const ffmpegPath = getFfmpegPathForEnv();
    const samplePath = path.join(app.getPath('temp'), `aurivo-pulse-sample-${Date.now()}.wav`);

    const captureOk = await new Promise((resolve) => {
        let err = '';
        const child = spawn(ffmpegPath, [
            '-y',
            '-f', 'pulse',
            '-i', audioDevice,
            '-t', String(durationSec),
            '-ac', '1',
            '-ar', '16000',
            '-vn',
            samplePath
        ], {
            env: buildPulseRuntimeEnv({ AURIVO_PULSE_NO_GUI: '1' })
        });

        const timeout = setTimeout(() => {
            try { child.kill('SIGTERM'); } catch { }
            resolve({ success: false, error: 'Örnek kayıt zaman aşımına uğradı' });
        }, (durationSec + 8) * 1000);

        child.stderr.on('data', (d) => { err += String(d || ''); });
        child.once('error', (e) => {
            clearTimeout(timeout);
            resolve({ success: false, error: e?.message || String(e) });
        });
        child.once('close', (code) => {
            clearTimeout(timeout);
            if (code === 0 && fs.existsSync(samplePath)) {
                resolve({ success: true });
                return;
            }
            resolve({ success: false, error: String(err || `ffmpeg exited with code ${code}`).trim() });
        });
    });

    if (!captureOk?.success) {
        try { fs.unlinkSync(samplePath); } catch { }
        return captureOk;
    }

    try {
        return await recognizeSongFromFileWithPulse(samplePath);
    } finally {
        try { fs.unlinkSync(samplePath); } catch { }
    }
}

function getResourcePath(relPath) {
    // Dev: doğrudan repo içinden
    if (!app.isPackaged) {
        return path.join(__dirname, relPath);
    }

    // Prod: bazı dosyalar resources/, bazıları app.asar içinde kalır.
    // Önce resources/ kontrol edilir, yoksa app.asar kökünden çözülür.
    const resourcePath = path.join(process.resourcesPath, relPath);
    if (fs.existsSync(resourcePath)) {
        return resourcePath;
    }

    return path.join(app.getAppPath(), relPath);
}

function getAppFilePath(relPath) {
    // app.asar içindeki paketlenmiş dosyalar için çalışır (örn. locales/*.json)
    // Dev: app.getAppPath() proje kökünü gösterir; Prod: .../resources/app.asar konumunu gösterir
    return path.join(app.getAppPath(), relPath);
}

function getLocaleCandidatePaths(lang) {
    const normalized = normalizeUiLang(lang) || 'en-US';
    const filename = `${normalized}.json`;

    // Tercih: app.asar (paket) / proje kökü (dev)
    const candidates = [
        getAppFilePath(path.join('locales', filename)),
        path.join(__dirname, 'locales', filename),
        // Bazı paketleme düzenlerinde app.asar açıkça resourcesPath altında olabilir
        path.join(process.resourcesPath || '', 'app.asar', 'locales', filename),
        path.join(process.resourcesPath || '', 'locales', filename)
    ];

    // Tekilleştir
    return [...new Set(candidates.filter(Boolean))];
}

function readFirstJsonSync(paths) {
    for (const p of paths || []) {
        try {
            const json = JSON.parse(fs.readFileSync(p, 'utf8'));
            return json || {};
        } catch {
            // sonrakini dene
        }
    }
    return null;
}

async function readFirstJson(paths) {
    for (const p of paths || []) {
        try {
            const data = await fs.promises.readFile(p, 'utf8');
            const json = JSON.parse(data);
            return json || {};
        } catch {
            // sonrakini dene
        }
    }
    return null;
}

function getAppIconPath() {
    if (process.platform === 'win32') {
        return getResourcePath(path.join('icons', 'aurivo.ico'));
    }
    return getResourcePath(path.join('icons', 'aurivo_512.png'));
}

function getAppIconImage() {
    const iconPath = getAppIconPath();
    const img = nativeImage.createFromPath(iconPath);
    if (!img || img.isEmpty()) {
        return nativeImage.createFromPath(path.join(__dirname, 'icons', 'aurivo_512.png'));
    }
    return img;
}

function getSettingsPath() {
    return path.join(app.getPath('userData'), 'settings.json');
}

async function readSettingsFileSafe() {
    try {
        const data = await fs.promises.readFile(getSettingsPath(), 'utf8');
        return JSON.parse(data);
    } catch {
        return {};
    }
}

function isMediaKeyAutoDetectEnabled(settings) {
    return settings?.playback?.mediaKeyAutoDetect !== false;
}

function dispatchMediaShortcutAction(action) {
    try {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.webContents.send('media-control', action);
    } catch (error) {
        console.warn('[SHORTCUT] media action dispatch failed:', error?.message || error);
    }
}

function unregisterGlobalMediaShortcuts() {
    if (!mediaShortcutsRegistered) return;
    try {
        for (const [accelerator] of GLOBAL_MEDIA_SHORTCUTS) {
            if (globalShortcut.isRegistered(accelerator)) {
                globalShortcut.unregister(accelerator);
            }
        }
    } catch (error) {
        console.warn('[SHORTCUT] unregister failed:', error?.message || error);
    } finally {
        mediaShortcutsRegistered = false;
    }
}

function registerGlobalMediaShortcuts() {
    if (mediaShortcutsRegistered) return;
    let registeredAny = false;
    for (const [accelerator, action] of GLOBAL_MEDIA_SHORTCUTS) {
        try {
            const ok = globalShortcut.register(accelerator, () => {
                dispatchMediaShortcutAction(action);
            });
            if (ok) registeredAny = true;
            else console.warn(`[SHORTCUT] register failed (in use?): ${accelerator}`);
        } catch (error) {
            console.warn(`[SHORTCUT] register error: ${accelerator}`, error?.message || error);
        }
    }
    mediaShortcutsRegistered = registeredAny;
}

function refreshGlobalMediaShortcuts(settings) {
    if (!app.isReady()) return;
    if (isMediaKeyAutoDetectEnabled(settings)) {
        registerGlobalMediaShortcuts();
    } else {
        unregisterGlobalMediaShortcuts();
    }
}

function deriveMainWindowCloseToTray(settings) {
    const ui = (settings?.ui && typeof settings.ui === 'object') ? settings.ui : {};
    if (typeof ui.closeToTray === 'boolean') return ui.closeToTray;
    return true;
}

function refreshMainWindowBehaviorSettingsSync() {
    try {
        const data = fs.readFileSync(getSettingsPath(), 'utf8');
        const parsed = JSON.parse(data);
        mainWindowCloseToTray = deriveMainWindowCloseToTray(parsed);
    } catch {
        mainWindowCloseToTray = true;
    }
}

function clampSettingsWindowBounds(rawBounds) {
    if (!rawBounds || typeof rawBounds !== 'object') return null;

    const width = Math.max(980, Math.min(1800, Number(rawBounds.width) || 1180));
    const height = Math.max(720, Math.min(1400, Number(rawBounds.height) || 860));
    const x = Number(rawBounds.x);
    const y = Number(rawBounds.y);

    const display = screen.getDisplayMatching({
        x: Number.isFinite(x) ? x : 0,
        y: Number.isFinite(y) ? y : 0,
        width,
        height
    }) || screen.getPrimaryDisplay();
    const workArea = display?.workArea || { x: 0, y: 0, width: 1920, height: 1080 };

    const nextX = Number.isFinite(x)
        ? Math.min(Math.max(x, workArea.x), workArea.x + Math.max(0, workArea.width - width))
        : undefined;
    const nextY = Number.isFinite(y)
        ? Math.min(Math.max(y, workArea.y), workArea.y + Math.max(0, workArea.height - height))
        : undefined;

    return {
        width,
        height,
        ...(Number.isFinite(nextX) ? { x: nextX } : {}),
        ...(Number.isFinite(nextY) ? { y: nextY } : {})
    };
}

async function getSettingsWindowState() {
    const settings = await readSettingsFileSafe();
    const ui = (settings?.ui && typeof settings.ui === 'object') ? settings.ui : {};
    const stored = (ui.settingsWindow && typeof ui.settingsWindow === 'object') ? ui.settingsWindow : {};
    return {
        bounds: clampSettingsWindowBounds(stored.bounds),
        maximized: stored.maximized === true
    };
}

async function persistSettingsWindowState(win) {
    if (!win || win.isDestroyed()) return;
    try {
        const settings = await readSettingsFileSafe();
        if (!settings.ui || typeof settings.ui !== 'object') settings.ui = {};
        settings.ui.settingsWindow = {
            bounds: clampSettingsWindowBounds(win.getBounds()),
            maximized: win.isMaximized()
        };
        await writeJsonFileAtomic(getSettingsPath(), sanitizeSensitiveSettings(settings));
    } catch (error) {
        console.error('[SETTINGS] persist window state error:', error);
    }
}

const WEBVIEW_PARTITION = 'persist:aurivo-web';

function getWebSessions() {
    const out = [];
    const seen = new Set();
    const add = (ses) => {
        if (!ses) return;
        const key = ses.id || ses.partition || Math.random().toString(36);
        if (seen.has(key)) return;
        seen.add(key);
        out.push(ses);
    };
    try { add(session.fromPartition(WEBVIEW_PARTITION)); } catch { }
    try { add(session.defaultSession); } catch { }
    return out;
}

const WEB_ALLOWED_HOSTS_MAIN = new Set([
    'google.com',
    'www.google.com',
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com',
    'music.youtube.com',
    'youtu.be',
    'accounts.google.com',
    'www.deezer.com',
    'deezer.com',
    'soundcloud.com',
    'www.soundcloud.com',
    'facebook.com',
    'www.facebook.com',
    'm.facebook.com',
    'instagram.com',
    'www.instagram.com',
    'tiktok.com',
    'www.tiktok.com',
    'm.tiktok.com',
    'x.com',
    'www.x.com',
    'twitter.com',
    'www.twitter.com',
    'reddit.com',
    'www.reddit.com',
    'old.reddit.com',
    'twitch.tv',
    'www.twitch.tv',
    'whatsapp.com',
    'www.whatsapp.com',
    'web.whatsapp.com',
    'telegram.org',
    'www.telegram.org',
    'web.telegram.org',
    't.me',
    'www.t.me'
]);

const WEB_ALLOWED_SUFFIXES_MAIN = [
    '.youtube.com',
    '.google.com',
    '.googleusercontent.com',
    '.deezer.com',
    '.soundcloud.com',
    '.facebook.com',
    '.instagram.com',
    '.tiktok.com',
    '.x.com',
    '.twitter.com',
    '.reddit.com',
    '.twitch.tv',
    '.whatsapp.com',
    '.telegram.org'
];

function parseHttpUrlMain(raw) {
    try {
        const u = new URL(String(raw || '').trim());
        if (!/^https?:$/i.test(u.protocol)) return null;
        return u;
    } catch {
        return null;
    }
}

function isAllowedWebUrlMain(raw) {
    const parsed = parseHttpUrlMain(raw);
    if (!parsed) return false;
    const host = String(parsed.hostname || '').toLowerCase();
    if (WEB_ALLOWED_HOSTS_MAIN.has(host)) return true;
    return WEB_ALLOWED_SUFFIXES_MAIN.some((suffix) => host.endsWith(suffix));
}

function isAllowedWebHostMain(hostname) {
    const host = String(hostname || '').trim().toLowerCase();
    if (!host) return false;
    if (WEB_ALLOWED_HOSTS_MAIN.has(host)) return true;
    return WEB_ALLOWED_SUFFIXES_MAIN.some((suffix) => host.endsWith(suffix));
}

// Cert doğrulama için platformların kullandığı CDN hostları.
// Not: Bu liste gezinme allowlist'i değildir; yalnızca -202 TLS zinciri sorununda kullanılır.
const WEB_CERT_TRUST_SUFFIXES_MAIN = [
    '.sndcdn.com',
    '.googlevideo.com',
    '.gvt1.com'
];

function isTrustedWebCertHostMain(hostname) {
    const host = String(hostname || '').trim().toLowerCase();
    if (!host) return false;
    if (isAllowedWebHostMain(host)) return true;
    return WEB_CERT_TRUST_SUFFIXES_MAIN.some((suffix) => host.endsWith(suffix));
}

function isTrustedWebCertUrlMain(raw) {
    try {
        const u = new URL(String(raw || '').trim());
        return isTrustedWebCertHostMain(u.hostname);
    } catch {
        return false;
    }
}

function sanitizeSensitiveSettings(input) {
    const source = (input && typeof input === 'object') ? input : {};
    const clone = JSON.parse(JSON.stringify(source));

    const sensitiveKeyPattern = /(^|_|\.)((pass(word)?)|(email)|(token)|(cookie)|(session)|(auth)|(credential))/i;

    const walk = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        for (const key of Object.keys(obj)) {
            const value = obj[key];
            if (sensitiveKeyPattern.test(key)) {
                delete obj[key];
                continue;
            }
            if (value && typeof value === 'object') {
                walk(value);
            }
        }
    };

    walk(clone);

    // Explicit deny-list for potential future fields.
    if (clone.web && typeof clone.web === 'object') {
        delete clone.web.credentials;
        delete clone.web.cookies;
        delete clone.web.auth;
    }

    return clone;
}

// ============================================================
// UI I18N (Ana İşlem)
// - Renderer seçilen dili settings.json'a yazar: ui.language
// - Yedek: app.getLocale(), sonra İngilizce
// ============================================================
const UI_SUPPORTED_LANGS = new Set([
    'ar-SA',
    'bn-BD',
    'de-DE',
    'el-GR',
    'en-US',
    'es-ES',
    'fa-IR',
    'fi-FI',
    'fr-FR',
    'hi-IN',
    'hu-HU',
    'it-IT',
    'ja-JP',
    'ne-NP',
    'pl-PL',
    'pt-BR',
    'ru-RU',
    'tr-TR',
    'uk-UA',
    'vi-VN',
    'zh-CN',
    'zh-TW'
]);
const UI_DEFAULT_BY_BASE = {
    ar: 'ar-SA',
    bn: 'bn-BD',
    de: 'de-DE',
    el: 'el-GR',
    en: 'en-US',
    es: 'es-ES',
    fa: 'fa-IR',
    fi: 'fi-FI',
    fr: 'fr-FR',
    hi: 'hi-IN',
    hu: 'hu-HU',
    it: 'it-IT',
    ja: 'ja-JP',
    ne: 'ne-NP',
    pl: 'pl-PL',
    pt: 'pt-BR',
    ru: 'ru-RU',
    tr: 'tr-TR',
    uk: 'uk-UA',
    vi: 'vi-VN',
    zh: 'zh-CN'
};
const uiMessagesCache = new Map(); // lang -> messages

function normalizeUiLang(lang) {
    if (!lang) return null;
    const raw = String(lang).trim().replace('_', '-');
    const [basePart, regionPart] = raw.split('-');
    const base = String(basePart || '').toLowerCase();
    const region = regionPart ? String(regionPart).toUpperCase() : '';

    if (base && region) {
        const full = `${base}-${region}`;
        if (UI_SUPPORTED_LANGS.has(full)) return full;
    }

    return UI_DEFAULT_BY_BASE[base] || null;
}

function deepGet(obj, pathStr) {
    if (!obj || typeof obj !== 'object') return undefined;
    const parts = String(pathStr).split('.').filter(Boolean);
    let cur = obj;
    for (const p of parts) {
        if (!cur || typeof cur !== 'object' || !(p in cur)) return undefined;
        cur = cur[p];
    }
    return cur;
}

function formatTemplate(str, vars) {
    if (!vars || typeof vars !== 'object') return String(str);
    return String(str).replace(/\{(\w+)\}/g, (_m, k) => {
        if (Object.prototype.hasOwnProperty.call(vars, k)) return String(vars[k]);
        return `{${k}}`;
    });
}

function getUiLanguageSync() {
    try {
        const data = fs.readFileSync(getSettingsPath(), 'utf8');
        const parsed = JSON.parse(data);
        const saved = normalizeUiLang(parsed?.ui?.language);
        if (saved) return saved;
    } catch {
        // yoksay
    }

    return normalizeUiLang(app.getLocale()) || 'en-US';
}

function uiLangToPosixLocale(lang) {
    const normalized = normalizeUiLang(lang) || 'en-US';
    const parts = normalized.split('-');
    const base = String(parts[0] || 'en').toLowerCase();
    const region = String(parts[1] || 'US').toUpperCase();
    return `${base}_${region}.UTF-8`;
}

function uiLangToLocaleChain(lang) {
    const normalized = normalizeUiLang(lang) || 'en-US';
    const parts = normalized.split('-');
    const base = String(parts[0] || 'en').toLowerCase();
    const region = String(parts[1] || 'US').toUpperCase();
    return `${base}_${region}:${base}:en_US:en`;
}

function resolveLinuxDesktopFileHint() {
    if (process.platform !== 'linux') return '';
    const home = app?.getPath?.('home') || process.env.HOME || '';
    const candidates = [
        path.join('/app', 'share', 'applications', 'com.aurivo.mediaplayer.desktop'),
        path.join('/app', 'share', 'applications', 'aurivo-media-player.desktop'),
        path.join(home, '.local', 'share', 'applications', 'aurivo-media-player.desktop'),
        path.join(home, '.local', 'share', 'applications', 'com.aurivo.mediaplayer.desktop'),
        path.join('/usr/local/share/applications', 'aurivo-media-player.desktop'),
        path.join('/usr/local/share/applications', 'com.aurivo.mediaplayer.desktop'),
        path.join('/usr/share/applications', 'aurivo-media-player.desktop'),
        path.join('/usr/share/applications', 'com.aurivo.mediaplayer.desktop')
    ];
    for (const p of candidates) {
        try {
            if (p && fs.existsSync(p)) return p;
        } catch {
            // yoksay
        }
    }
    return '';
}

function resolveLinuxDesktopEntryId() {
    if (process.platform !== 'linux') return '';
    const flatpakId = String(process.env.FLATPAK_ID || process.env.APP_ID || '').trim();
    if (flatpakId) return flatpakId.replace(/\.desktop$/i, '');

    const desktopHint = resolveLinuxDesktopFileHint();
    if (desktopHint) {
        const base = path.basename(desktopHint).replace(/\.desktop$/i, '').trim();
        if (base) return base;
    }
    return 'com.aurivo.mediaplayer';
}

function buildPulseRuntimeEnv(extra = {}) {
    const env = {
        ...process.env,
        ...(extra && typeof extra === 'object' ? extra : {})
    };

    const platformSubdir = process.platform === 'win32'
        ? 'windows'
        : (process.platform === 'linux' ? 'linux' : process.platform);
    const libCandidates = [
        path.join(process.resourcesPath || '', 'app.asar.unpacked', 'Aurivo-Pulse', 'libs'),
        path.join(process.resourcesPath || '', 'Aurivo-Pulse', 'libs'),
        path.join(__dirname, 'Aurivo-Pulse', 'libs'),
        path.join(process.resourcesPath || '', 'native-dist', platformSubdir),
        path.join(process.resourcesPath || '', 'native-dist')
    ].filter(Boolean);

    const existing = String(env.LD_LIBRARY_PATH || '').split(path.delimiter).filter(Boolean);
    const finalPaths = [];
    const seen = new Set();
    for (const p of [...libCandidates, ...existing]) {
        if (!p || seen.has(p)) continue;
        seen.add(p);
        try {
            if (fs.existsSync(p)) finalPaths.push(p);
        } catch {
            // yoksay
        }
    }
    if (finalPaths.length) {
        env.LD_LIBRARY_PATH = finalPaths.join(path.delimiter);
    }
    return env;
}

function buildPulseGuiEnv() {
    const uiLang = getUiLanguageSync();
    const posixLocale = uiLangToPosixLocale(uiLang);
    const localeChain = uiLangToLocaleChain(uiLang);
    const env = buildPulseRuntimeEnv({
        AURIVO_PULSE_NO_GUI: '0',
        AURIVO_LANG: uiLang,
        LANG: posixLocale,
        LC_ALL: posixLocale,
        LANGUAGE: localeChain,
        AURIVO_PULSE_BRIDGE_URL: getPulseBridgeUrl()
    });

    // Linux'ta masaüstü eşleştirme ipucu ver (GNOME/KDE panel grouping için).
    if (process.platform === 'linux') {
        const desktopHint = resolveLinuxDesktopFileHint();
        if (desktopHint) {
            env.BAMF_DESKTOP_FILE_HINT = desktopHint;
            env.GIO_LAUNCHED_DESKTOP_FILE = desktopHint;
        }
        // Flatpak/Native Wayland kimliğini kullanarak doğru eşleştirme yap
        const flatpakId = String(process.env.FLATPAK_ID || process.env.APP_ID || '').trim();
        if (flatpakId) {
            env.AURIVO_APP_ID = flatpakId;
        } else {
            env.AURIVO_APP_ID = 'com.aurivo.mediaplayer';
        }
        env.AURIVO_ICON_NAME = env.AURIVO_APP_ID;
    }

    return env;
}

function applyUiLocaleOverrides(lang, messages) {
    const normalized = normalizeUiLang(lang) || 'en-US';
    const out = (messages && typeof messages === 'object') ? { ...messages } : {};
    const deepSet = (obj, pathStr, value) => {
        const parts = String(pathStr).split('.').filter(Boolean);
        if (!parts.length) return;
        let cur = obj;
        for (let i = 0; i < parts.length - 1; i++) {
            const p = parts[i];
            if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {};
            cur = cur[p];
        }
        cur[parts[parts.length - 1]] = value;
    };
    const deepEnsure = (key, value) => {
        if (deepGet(out, key) === undefined) deepSet(out, key, value);
    };

    deepEnsure('trayMedia.previous', 'Previous track');
    deepEnsure('trayMedia.play', 'Play');
    deepEnsure('trayMedia.pause', 'Pause');
    deepEnsure('trayMedia.stop', 'Stop');
    deepEnsure('trayMedia.stopAfterCurrent', 'Stop after current track');
    deepEnsure('trayMedia.next', 'Next track');
    deepEnsure('trayMedia.mute', 'Mute');
    deepEnsure('trayMedia.unmute', 'Unmute');
    deepEnsure('trayMedia.like', 'Like');
    deepEnsure('trayMedia.show', 'Show');
    deepEnsure('trayMedia.exit', 'Exit');

    if (normalized === 'tr-TR') {
        deepEnsure('appMenu.file', 'Dosya');
        deepEnsure('appMenu.edit', 'Düzen');
        deepEnsure('appMenu.view', 'Görünüm');
        deepEnsure('appMenu.window', 'Pencere');
        deepEnsure('appMenu.help', 'Yardım');
        deepEnsure('appMenu.quit', 'Çıkış');
        deepEnsure('appMenu.close', 'Kapat');
        deepEnsure('appMenu.minimize', 'Küçült');
        deepEnsure('appMenu.reload', 'Yenile');
        deepEnsure('appMenu.toggleDevTools', 'Geliştirici araçları');
        deepEnsure('appMenu.resetZoom', 'Yakınlaştırmayı sıfırla');
        deepEnsure('appMenu.zoomIn', 'Yakınlaştır');
        deepEnsure('appMenu.zoomOut', 'Uzaklaştır');
        deepEnsure('appMenu.toggleFullscreen', 'Tam ekran');
        deepEnsure('appMenu.undo', 'Geri al');
        deepEnsure('appMenu.redo', 'Yinele');
        deepEnsure('appMenu.cut', 'Kes');
        deepEnsure('appMenu.copy', 'Kopyala');
        deepEnsure('appMenu.paste', 'Yapıştır');
        deepEnsure('appMenu.selectAll', 'Tümünü seç');
        deepEnsure('trayMedia.previous', 'Önceki parça');
        deepEnsure('trayMedia.play', 'Oynat');
        deepEnsure('trayMedia.pause', 'Duraklat');
        deepEnsure('trayMedia.stop', 'Durdur');
        deepEnsure('trayMedia.stopAfterCurrent', 'Bu parçadan sonra durdur');
        deepEnsure('trayMedia.next', 'Sonraki parça');
        deepEnsure('trayMedia.mute', 'Sessiz');
        deepEnsure('trayMedia.unmute', 'Sesi aç');
        deepEnsure('trayMedia.like', 'Beğen');
        deepEnsure('trayMedia.show', 'Göster');
        deepEnsure('trayMedia.exit', 'Çık');
    }
    if (normalized === 'ar-SA') {
        deepEnsure('appMenu.file', 'ملف');
        deepEnsure('appMenu.edit', 'تحرير');
        deepEnsure('appMenu.view', 'عرض');
        deepEnsure('appMenu.window', 'نافذة');
        deepEnsure('appMenu.help', 'مساعدة');
        deepEnsure('appMenu.quit', 'خروج');
        deepEnsure('appMenu.close', 'إغلاق');
        deepEnsure('appMenu.minimize', 'تصغير');
        deepEnsure('appMenu.reload', 'إعادة تحميل');
        deepEnsure('appMenu.toggleDevTools', 'أدوات المطور');
        deepEnsure('appMenu.resetZoom', 'إعادة تعيين التكبير');
        deepEnsure('appMenu.zoomIn', 'تكبير');
        deepEnsure('appMenu.zoomOut', 'تصغير التكبير');
        deepEnsure('appMenu.toggleFullscreen', 'ملء الشاشة');
        deepEnsure('appMenu.undo', 'تراجع');
        deepEnsure('appMenu.redo', 'إعادة');
        deepEnsure('appMenu.cut', 'قص');
        deepEnsure('appMenu.copy', 'نسخ');
        deepEnsure('appMenu.paste', 'لصق');
        deepEnsure('appMenu.selectAll', 'تحديد الكل');
        deepEnsure('trayMedia.previous', 'المقطع السابق');
        deepEnsure('trayMedia.play', 'تشغيل');
        deepEnsure('trayMedia.pause', 'إيقاف مؤقت');
        deepEnsure('trayMedia.stop', 'إيقاف');
        deepEnsure('trayMedia.stopAfterCurrent', 'إيقاف بعد المقطع الحالي');
        deepEnsure('trayMedia.next', 'المقطع التالي');
        deepEnsure('trayMedia.mute', 'كتم');
        deepEnsure('trayMedia.unmute', 'إلغاء الكتم');
        deepEnsure('trayMedia.like', 'إعجاب');
        deepEnsure('trayMedia.show', 'إظهار');
        deepEnsure('trayMedia.exit', 'خروج');
    }

    return out;
}

const UI_LEGACY_KEY_MAP = {
    'settings.title': ['preferences'],
    'settings.tabs.download': ['download'],
    'settings.tabs.audio': ['audio'],
    'about.title': ['about'],
    'appMenu.quit': ['quit'],
    'appMenu.close': ['close']
};

function tFromMessagesWithLegacy(messages, lang, key, vars) {
    let raw = deepGet(messages, key);
    if (typeof raw !== 'string') {
        const legacy = UI_LEGACY_KEY_MAP[key];
        if (Array.isArray(legacy)) {
            for (const lk of legacy) {
                raw = deepGet(messages, lk);
                if (typeof raw === 'string') break;
            }
        }
    }

    if (typeof raw !== 'string' && lang !== 'en-US') {
        const en = loadUiMessagesSync('en-US');
        raw = deepGet(en, key);
        if (typeof raw !== 'string') {
            const legacy = UI_LEGACY_KEY_MAP[key];
            if (Array.isArray(legacy)) {
                for (const lk of legacy) {
                    raw = deepGet(en, lk);
                    if (typeof raw === 'string') break;
                }
            }
        }
    }

    if (typeof raw !== 'string') return String(key);
    return formatTemplate(raw, vars);
}

function loadUiMessagesSync(lang) {
    const normalized = normalizeUiLang(lang) || 'en-US';
    if (uiMessagesCache.has(normalized)) return uiMessagesCache.get(normalized);
    try {
        const json = readFirstJsonSync(getLocaleCandidatePaths(normalized));
        if (json) {
            const patched = applyUiLocaleOverrides(normalized, json || {});
            uiMessagesCache.set(normalized, patched);
            return patched;
        }
    } catch {
        if (normalized !== 'en-US') return loadUiMessagesSync('en-US');
        uiMessagesCache.set('en-US', {});
        return {};
    }
}

function tMainSync(key, vars) {
    const lang = getUiLanguageSync();
    const messages = loadUiMessagesSync(lang);
    return tFromMessagesWithLegacy(messages, lang, key, vars);
}

function installAppMenu() {
    const isMac = process.platform === 'darwin';

    const template = [
        ...(isMac ? [{
            label: app.getName(),
            submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit', label: tMainSync('appMenu.quit') }
            ]
        }] : []),
        {
            label: tMainSync('appMenu.file'),
            submenu: [
                ...(isMac ? [] : [{ role: 'quit', label: tMainSync('appMenu.quit') }])
            ]
        },
        {
            label: tMainSync('appMenu.edit'),
            submenu: [
                { role: 'undo', label: tMainSync('appMenu.undo') },
                { role: 'redo', label: tMainSync('appMenu.redo') },
                { type: 'separator' },
                { role: 'cut', label: tMainSync('appMenu.cut') },
                { role: 'copy', label: tMainSync('appMenu.copy') },
                { role: 'paste', label: tMainSync('appMenu.paste') },
                { role: 'selectAll', label: tMainSync('appMenu.selectAll') }
            ]
        },
        {
            label: tMainSync('appMenu.view'),
            submenu: [
                { role: 'reload', label: tMainSync('appMenu.reload') },
                { role: 'toggleDevTools', label: tMainSync('appMenu.toggleDevTools') },
                { type: 'separator' },
                { role: 'resetZoom', label: tMainSync('appMenu.resetZoom') },
                { role: 'zoomIn', label: tMainSync('appMenu.zoomIn') },
                { role: 'zoomOut', label: tMainSync('appMenu.zoomOut') },
                { type: 'separator' },
                { role: 'togglefullscreen', label: tMainSync('appMenu.toggleFullscreen') }
            ]
        },
        {
            label: tMainSync('appMenu.window'),
            submenu: [
                { role: 'minimize', label: tMainSync('appMenu.minimize') },
                { role: 'close', label: tMainSync('appMenu.close') }
            ]
        },
        {
            label: tMainSync('appMenu.help'),
            submenu: [
                {
                    label: 'aurivo.app',
                    click: () => shell.openExternal('https://aurivo.app').catch(() => { /* yoksay */ })
                }
            ]
        }
    ];

    try {
        Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    } catch (e) {
        console.warn('[MENU] Failed to set application menu:', e?.message || e);
    }
}

async function writeJsonFileAtomic(filePath, obj) {
    const dir = path.dirname(filePath);
    try {
        await fs.promises.mkdir(dir, { recursive: true });
    } catch {
        // yoksay
    }

    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    const json = JSON.stringify(obj ?? {}, null, 2);
    await fs.promises.writeFile(tmpPath, json, 'utf8');

    try {
        await fs.promises.rename(tmpPath, filePath);
    } catch (e) {
        // Windows'ta hedef dosya varsa yeniden adlandırma bazen hata verebilir.
        if (e && (e.code === 'EEXIST' || e.code === 'EPERM' || e.code === 'EACCES')) {
            await fs.promises.unlink(filePath).catch(() => { /* yoksay */ });
            await fs.promises.rename(tmpPath, filePath);
            return;
        }
        throw e;
    } finally {
        await fs.promises.unlink(tmpPath).catch(() => { /* yoksay */ });
    }
}

function normalizeEq32BandsForEngine(bands) {
    const out = new Array(32).fill(0);
    if (!Array.isArray(bands)) return out;
    for (let i = 0; i < 32; i++) {
        const n = Number(bands[i]);
        out[i] = Number.isFinite(n) ? Math.max(-12, Math.min(12, n)) : 0;
    }
    return out;
}

async function applyPersistedEq32SfxFromSettings() {
    if (!audioEngine || !isNativeAudioAvailable) return;

    try {
        const data = await fs.promises.readFile(getSettingsPath(), 'utf8');
        const settings = JSON.parse(data);
        const eq32 = settings?.sfxScopes?.music?.eq32 || settings?.sfx?.eq32;
        if (!eq32) return;

        const bands = normalizeEq32BandsForEngine(eq32.bands);
        if (typeof audioEngine.setEQBands === 'function') {
            audioEngine.setEQBands(bands);
        } else if (typeof audioEngine.setEQBand === 'function') {
            bands.forEach((v, i) => audioEngine.setEQBand(i, v));
        }

        if (Number.isFinite(eq32.balance) && typeof audioEngine.setBalance === 'function') {
            audioEngine.setBalance(eq32.balance);
        }
        if (Number.isFinite(eq32.bass) && typeof audioEngine.setBass === 'function') {
            audioEngine.setBass(eq32.bass);
        }
        if (Number.isFinite(eq32.mid) && typeof audioEngine.setMid === 'function') {
            audioEngine.setMid(eq32.mid);
        }
        if (Number.isFinite(eq32.treble) && typeof audioEngine.setTreble === 'function') {
            audioEngine.setTreble(eq32.treble);
        }
        if (Number.isFinite(eq32.stereoExpander) && typeof audioEngine.setStereoExpander === 'function') {
            audioEngine.setStereoExpander(eq32.stereoExpander);
        }

        const name = eq32?.lastPreset?.name;
        console.log(`[SFX] EQ32 ayarları yüklendi${name ? `: ${name}` : ''}`);
    } catch {
        // Ayar dosyası yoksa sorun değil
    }
}

async function updateEq32SettingsInFile(patch) {
    try {
        let current = null;
        try {
            const data = await fs.promises.readFile(getSettingsPath(), 'utf8');
            current = JSON.parse(data);
        } catch {
            current = {};
        }

        const next = { ...(current || {}) };
        next.sfx = { ...(next.sfx || {}) };
        next.sfx.eq32 = { ...(next.sfx.eq32 || {}) };
        next.sfxScopes = { ...(next.sfxScopes || {}) };
        next.sfxScopes.music = { ...(next.sfxScopes.music || {}) };
        next.sfxScopes.music.eq32 = { ...(next.sfxScopes.music.eq32 || {}) };

        Object.assign(next.sfx.eq32, patch || {});
        Object.assign(next.sfxScopes.music.eq32, patch || {});

        await writeJsonFileAtomic(getSettingsPath(), next);
        return next;
    } catch (e) {
        console.error('[SFX] EQ32 settings update error:', e);
        return null;
    }
}

function createWindow() {
    refreshMainWindowBehaviorSettingsSync();
    rendererMediaOpenReady = false;

    let rendererRecoveryAttempts = 0;
    mainWindow = new BrowserWindow({
        width: 1500,
        height: 900,
        backgroundColor: '#121212',
        icon: getAppIconImage(),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            // sandbox: false gerekli — preload.js Node.js require() kullanıyor.
            // Webview'lar için sandbox will-attach-webview içinde ayrıca zorunlu tutuluyor.
            sandbox: false,
            webSecurity: true,
            allowRunningInsecureContent: false,
            // Medya oynatım zamanlayıcıları arka planda da akıcı çalışsın.
            // Aksi halde track-end / next-track akışı gizli pencerede gecikebiliyor.
            backgroundThrottling: false,
            webviewTag: true,  // WebView desteği
            plugins: true, // DRM/CDM tabanlı web oynatıcılar için gerekli olabilir
            spellcheck: false
        },
        frame: true,
        titleBarStyle: 'default',
        show: false
    });

    let hasEverBeenShown = false;

    if (process.platform === 'linux' && typeof mainWindow.setIcon === 'function') {
        mainWindow.setIcon(getAppIconImage());
    }

    // WebView attach hardening: force isolated guest settings and block preload injection.
    mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
        try {
            webPreferences.nodeIntegration = false;
            webPreferences.contextIsolation = true;
            webPreferences.sandbox = true;
            webPreferences.webSecurity = true;
            webPreferences.enableRemoteModule = false;
            webPreferences.allowRunningInsecureContent = false;
            webPreferences.plugins = true;
            // Guest preload disallow: no bridge in third-party pages.
            delete webPreferences.preload;

            const targetUrl = String(params?.src || '').trim();
            // Initial webview src is often about:blank; block only non-blank external URLs.
            if (targetUrl && targetUrl !== 'about:blank' && !isAllowedWebUrlMain(targetUrl)) {
                event.preventDefault();
            }
        } catch (e) {
            console.warn('[SECURITY] will-attach-webview hardening error:', e?.message || e);
            event.preventDefault();
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'index.html'));

    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
        console.error('[WEB] did-fail-load:', { errorCode, errorDescription, validatedURL });
        try {
            const url = String(validatedURL || '');
            const isMainDoc = url.startsWith('file:') || url === '' || url === 'about:blank';
            if (isMainDoc && rendererRecoveryAttempts < 2) {
                rendererRecoveryAttempts += 1;
                setTimeout(() => {
                    if (!mainWindow || mainWindow.isDestroyed()) return;
                    mainWindow.loadFile(path.join(__dirname, 'index.html')).catch(() => {});
                }, 450);
            }
        } catch {
            // yoksay
        }
    });

    mainWindow.webContents.on('render-process-gone', (_event, details) => {
        console.error('[WEB] render-process-gone:', details);
        if (rendererRecoveryAttempts >= 2) return;
        rendererRecoveryAttempts += 1;
        setTimeout(() => {
            if (!mainWindow || mainWindow.isDestroyed()) return;
            mainWindow.loadFile(path.join(__dirname, 'index.html')).catch(() => {});
        }, 500);
    });

    let unresponsiveRecoveryTriggered = false;
    mainWindow.webContents.on('unresponsive', () => {
        console.warn('[WEB] renderer unresponsive');
        if (unresponsiveRecoveryTriggered) return;
        unresponsiveRecoveryTriggered = true;

        const alreadySoftware = process.env.AURIVO_SOFTWARE_RENDER === '1' || process.env.AURIVO_SOFTWARE_RENDER === 'true';
        if (process.platform === 'linux' && app.isPackaged && !alreadySoftware) {
            console.warn('[WEB] unresponsive -> relaunching with safe software mode');
            app.relaunch({
                env: {
                    ...process.env,
                    AURIVO_SOFTWARE_RENDER: '1',
                    AURIVO_DISPLAY_BACKEND: process.env.DISPLAY ? 'x11' : (process.env.AURIVO_DISPLAY_BACKEND || 'auto'),
                    AURIVO_FORCE_GPU_TUNING: '0'
                }
            });
            app.exit(0);
            return;
        }

        try {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.reloadIgnoringCache();
            }
        } catch {
            // yoksay
        } finally {
            setTimeout(() => { unresponsiveRecoveryTriggered = false; }, 2500);
        }
    });

    mainWindow.webContents.on('responsive', () => {
        console.log('[WEB] renderer responsive');
    });

    // İlk açılışta pencereyi zorla görünür yap
    mainWindow.show();
    mainWindow.center();
    mainWindow.focus();

    // Renderer loglarını terminale düşür (çapraz geçiş gibi UI tarafı hata ayıklama için)
    mainWindow.webContents.on('console-message', (_event, _level, message, line, sourceId) => {
        // sourceId boş olabiliyor
        const src = sourceId ? String(sourceId).split('/').slice(-1)[0] : 'renderer';
        safeStdoutLine(`[RENDERER] ${message} (${src}:${line})`);
    });

    const broadcastWindowFullscreenState = () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        try {
            mainWindow.webContents.send('window:fullscreen-changed', {
                fullscreen: mainWindow.isFullScreen()
            });
        } catch {
            // yoksay
        }
    };
    mainWindow.on('enter-full-screen', broadcastWindowFullscreenState);
    mainWindow.on('leave-full-screen', broadcastWindowFullscreenState);

    // Pencere hazır olduğunda göster (flash önleme)
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        mainWindow.focus();
        hasEverBeenShown = true;
    });

    // Wayland/GPU sorunlarında ready-to-show tetiklenmezse yedek
    mainWindow.webContents.once('did-finish-load', () => {
        rendererRecoveryAttempts = 0;
        if (!mainWindow.isVisible()) {
            mainWindow.show();
            mainWindow.focus();
            hasEverBeenShown = true;
        }
        // Pencereyi öne getir
        mainWindow.setAlwaysOnTop(true);
        setTimeout(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.setAlwaysOnTop(false);
            }
        }, 1500);

        // Native ses başlatmayı UI yüklendikten sonra dene (başarısız olursa uygulama akışı bozulmasın)
        setTimeout(() => {
            try {
                const success = initNativeAudioEngineSafe();
                if (!success && process.platform === 'win32') {
                    logWindowsRuntimeDepsOnce('after-native-init-failed');
                    console.error('[WINDOWS] Native audio başarısız oldu - Sistem gereksinimleri kontrol et:');
                    console.error('[WINDOWS] 1. Visual C++ Runtime gerekli');
                    console.error('[WINDOWS] 2. libs/windows/*.dll dosyaları derleme klasöründe olmalı');
                    console.error('[WINDOWS] 3. native/build/Release/*.dll dosyaları derleme klasöründe olmalı');
                }
            } catch (e) {
                console.warn('[NativeAudio] init error:', e?.message || e);
            }
        }, 0);
    });
    setTimeout(() => {
        if (mainWindow && !mainWindow.isVisible()) {
            mainWindow.show();
            mainWindow.focus();
            hasEverBeenShown = true;
        }
    }, 2000);

    // Eğer pencere hiç görünmezse yazılım render'a otomatik düş
    setTimeout(() => {
        const alreadySoftware = process.env.AURIVO_SOFTWARE_RENDER === '1' || process.env.AURIVO_SOFTWARE_RENDER === 'true';
        if (mainWindow && !hasEverBeenShown && !mainWindow.isVisible() && !alreadySoftware) {
            console.warn('[GPU] Window not visible -> fallback to software rendering');
            app.relaunch({
                env: {
                    ...process.env,
                    AURIVO_SOFTWARE_RENDER: '1'
                }
            });
            app.exit(0);
        }
    }, 6000);

    // DevTools (sadece geliştirme modunda açılır)
    // Geliştirme için: npm run dev veya AURIVO_DEV=1 npm start
    if (process.env.AURIVO_DEV === '1' || process.argv.includes('--dev')) {
        // mainWindow.webContents.openDevTools();
    }

    // Pencere kapatma davranışı: tray'e minimize et
    mainWindow.on('close', (event) => {
        if (!app.isQuitting) {
            if (mainWindowCloseToTray) {
                event.preventDefault();
                // Ana uygulama arka plana alınırken dinle penceresi açık kalmamalı.
                stopAurivoPulseGuiWindow();
                mainWindow.hide();
                return false;
            }
            // "Kapatınca çık" modunda kapanışın gerçekten tüm süreci sonlandırmasını garantile.
            event.preventDefault();
            app.isQuitting = true;
            try {
                app.quit();
            } catch { }
            return false;
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
        // Ana pencere kapandığında ses efektleri penceresini de kapat
        if (soundEffectsWindow && !soundEffectsWindow.isDestroyed()) {
            soundEffectsWindow.close();
        }
    });

}

async function createSettingsWindow(defaultTab = 'playback') {
    const tab = String(defaultTab || 'playback').trim() || 'playback';

    if (settingsWindow && !settingsWindow.isDestroyed()) {
        try {
            settingsWindow.webContents.send('settings:navigate', { tab });
        } catch (e) {
            console.error('[SETTINGS] navigate existing window error:', e);
        }
        settingsWindow.show();
        settingsWindow.focus();
        return settingsWindow;
    }

    const windowState = await getSettingsWindowState();
    const windowBounds = windowState.bounds || { width: 1180, height: 860 };

    let allowSettingsWindowClose = false;

    settingsWindow = new BrowserWindow({
        ...windowBounds,
        minWidth: 980,
        minHeight: 720,
        backgroundColor: '#121212',
        icon: getAppIconImage(),
        parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
        modal: false,
        show: false,
        title: 'Aurivo Ayarlar',
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            additionalArguments: [`--aurivo-view=settings`, `--aurivo-settings-tab=${tab}`],
            nodeIntegration: false,
            contextIsolation: true,
            // sandbox: false gerekli — preload.js Node.js require() kullanıyor.
            sandbox: false,
            webviewTag: true,
            webSecurity: true,
            allowRunningInsecureContent: false,
            plugins: true,
            spellcheck: false
        }
    });

    if (process.platform === 'linux' && typeof settingsWindow.setIcon === 'function') {
        settingsWindow.setIcon(getAppIconImage());
    }

    settingsWindow.loadFile(path.join(__dirname, 'settings.html'));

    settingsWindow.once('ready-to-show', () => {
        if (!settingsWindow || settingsWindow.isDestroyed()) return;
        if (windowState.maximized) {
            settingsWindow.maximize();
        }
        settingsWindow.show();
        settingsWindow.focus();
    });

    let persistTimer = null;
    const queuePersist = () => {
        if (!settingsWindow || settingsWindow.isDestroyed()) return;
        clearTimeout(persistTimer);
        persistTimer = setTimeout(() => {
            persistSettingsWindowState(settingsWindow);
        }, 180);
    };

    settingsWindow.on('resize', queuePersist);
    settingsWindow.on('move', queuePersist);
    settingsWindow.on('maximize', queuePersist);
    settingsWindow.on('unmaximize', queuePersist);

    settingsWindow.on('close', (event) => {
        if (allowSettingsWindowClose) return;
        event.preventDefault();
        try {
            settingsWindow.webContents.send('settings:requestClose');
        } catch (error) {
            console.error('[SETTINGS] requestClose send error:', error);
            allowSettingsWindowClose = true;
            settingsWindow.close();
        }
    });

    settingsWindow.on('closed', () => {
        clearTimeout(persistTimer);
        settingsWindow = null;
    });

    settingsWindow.webContents.on('destroyed', () => {
        clearTimeout(persistTimer);
    });

    settingsWindow.__allowClose = () => {
        allowSettingsWindowClose = true;
    };

    return settingsWindow;
}

function createTray() {
    const trayIconName = process.platform === 'linux' ? 'aurivo_24.png' : 'aurivo_512.png';
    const iconPath = getResourcePath(path.join('icons', trayIconName));
    let trayIcon = nativeImage.createFromPath(iconPath);
    if (process.platform === 'linux' && trayIcon && !trayIcon.isEmpty()) {
        trayIcon = trayIcon.resize({ width: 24, height: 24 });
    }

    tray = new Tray(trayIcon);

    updateTrayMenu({ isPlaying: false, currentTrack: 'Aurivo Media Player' });

    tray.setToolTip('Aurivo Media Player');

    // Tray ikonuna sol tık: pencereyi göster/gizle
    tray.on('click', () => {
        if (mainWindow) {
            if (mainWindow.isVisible()) {
                mainWindow.hide();
            } else {
                mainWindow.show();
                mainWindow.focus();
            }
        }
    });
}

// ============================================
// MPRIS (Linux Media Player Entegrasyonu)
// ============================================
function createMPRIS() {
    if (!MPRIS_RUNTIME_ENABLED) {
        console.log('MPRIS varsayılan olarak kapalı (AURIVO_ENABLE_MPRIS=1 ile açılabilir)');
        return;
    }

    if (!Player || process.platform !== 'linux') {
        console.log('MPRIS sadece Linux için destekleniyor');
        return;
    }

    try {
        const flatpakAppId = (process.env.FLATPAK_ID || process.env.APP_ID || '').trim();
        const mprisName = (flatpakAppId || 'aurivo').replace(/[^A-Za-z0-9_.-]/g, '') || 'aurivo';
        const desktopEntryCandidates = [
            flatpakAppId,
            'com.aurivo.mediaplayer',
            'aurivo-media-player',
            'aurivo'
        ].filter(Boolean);
        const desktopEntry = desktopEntryCandidates.find((entry) => {
            const file = `${entry}.desktop`;
            const paths = [
                path.join('/app/share/applications', file),
                path.join('/usr/share/applications', file),
                path.join('/usr/local/share/applications', file),
                path.join(app.getPath('home'), '.local/share/applications', file)
            ];
            return paths.some((p) => fs.existsSync(p));
        }) || (flatpakAppId || 'aurivo');

        mprisPlayer = Player({
            name: mprisName,
            identity: 'Aurivo Media Player',
            desktopEntry, // KDE/GNOME sistem panelinde uygulama ikonunu eşleştirir
            supportedUriSchemes: ['file'],
            supportedMimeTypes: ['audio/mpeg', 'audio/flac', 'audio/x-wav', 'audio/ogg'],
            supportedInterfaces: ['player']
        });

        // Oynatma yeteneklerini ayarla
        mprisPlayer.canSeek = true;
        mprisPlayer.canControl = true;
        mprisPlayer.canPlay = true;
        mprisPlayer.canPause = true;
        mprisPlayer.canStop = true;
        mprisPlayer.canRaise = true;
        mprisPlayer.canQuit = true;
        mprisPlayer.canGoNext = true;
        mprisPlayer.canGoPrevious = true;

        // Oynatma kontrollerini bağla (toggle yerine explicit komutlar)
        mprisPlayer.on('play', () => {
            console.log('[MPRIS] play');
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('media-control', 'play');
            }
        });

        mprisPlayer.on('pause', () => {
            console.log('[MPRIS] pause');
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('media-control', 'pause');
            }
        });

        mprisPlayer.on('playpause', () => {
            console.log('[MPRIS] playpause');
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('media-control', 'play-pause');
            }
        });

        mprisPlayer.on('stop', () => {
            console.log('[MPRIS] stop');
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('media-control', 'stop');
            }
        });

        mprisPlayer.on('next', () => {
            console.log('[MPRIS] next');
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('media-control', 'next');
            }
        });

        mprisPlayer.on('previous', () => {
            console.log('[MPRIS] previous');
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('media-control', 'previous');
            }
        });

        // Sistem medya menüsündeki "Aç / Çık" için
        mprisPlayer.on('raise', () => {
            console.log('[MPRIS] raise');
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.show();
                mainWindow.focus();
            }
        });

        mprisPlayer.on('quit', () => {
            console.log('[MPRIS] quit');
            app.isQuitting = true;
            app.quit();
        });

        mprisPlayer.on('seek', (offset) => {
            console.log('MPRIS seek event, offset:', offset);
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('mpris-seek', offset);
            }
        });

        mprisPlayer.on('position', (event) => {
            console.log('MPRIS position event:', event.position);
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('mpris-position', event.position);
            }
        });

        // getPosition desteği (MPRIS tarafından çağrılır)
        mprisPlayer.getPosition = () => {
            // Çalıyorsa, son güncellemeden bu yana geçen süreyi ekle (Ekstrapolasyon)
            if (mprisPlayer.playbackStatus === Player.PLAYBACK_STATUS_PLAYING && mprisPlayer._lastUpdateHRTime) {
                const elapsed = process.hrtime(mprisPlayer._lastUpdateHRTime);
                const elapsedMicros = (elapsed[0] * 1000000) + Math.floor(elapsed[1] / 1000);
                return (mprisPlayer.position || 0) + elapsedMicros;
            }
            return mprisPlayer.position || 0;
        };

        console.log('✓ MPRIS player başlatıldı (name:', mprisName + ', desktopEntry:', desktopEntry + ')');
    } catch (e) {
        // MPRIS başlatma hatalarını sessizce yoksay
        console.log('MPRIS başlatma atlandı:', e.message);
    }
}

// MPRIS metadata güncelleme
function updateMPRISMetadata(metadata) {
    if (!mprisPlayer) return;

    try {
        const mprisMetadata = {
            'mpris:trackid': mprisPlayer.objectPath('track/' + (metadata.trackId || '0')),
            'mpris:length': Math.floor((metadata.duration || 0) * 1000000), // saniye -> mikrosaniye
            'mpris:artUrl': metadata.albumArt || '',
            'xesam:title': metadata.title || 'Bilinmeyen Parça',
            'xesam:artist': metadata.artist ? [metadata.artist] : ['Bilinmeyen Sanatçı'],
            'xesam:album': metadata.album || ''
        };

        mprisPlayer.metadata = mprisMetadata;
        mprisPlayer.playbackStatus = metadata.isPlaying ? Player.PLAYBACK_STATUS_PLAYING : Player.PLAYBACK_STATUS_PAUSED;

        // Pozisyon bilgisini güncelle (saniye -> mikrosaniye)
        if (typeof metadata.position === 'number') {
            mprisPlayer.position = Math.floor(metadata.position * 1000000);
            mprisPlayer._lastUpdateHRTime = process.hrtime();
        }

        // Seek yeteneklerini güncelle
        mprisPlayer.canSeek = (typeof metadata.canSeek === 'boolean') ? metadata.canSeek : true;
        mprisPlayer.canControl = true;
        if (typeof metadata.canGoNext === 'boolean') mprisPlayer.canGoNext = metadata.canGoNext;
        if (typeof metadata.canGoPrevious === 'boolean') mprisPlayer.canGoPrevious = metadata.canGoPrevious;

        console.log('MPRIS metadata güncellendi:', metadata.title, 'duration:', metadata.duration.toFixed(1), 's, position:', metadata.position.toFixed(1), 's');
    } catch (e) {
        // D-Bus bağlantı hataları - sessizce yoksay (normal durum)
        // EPIPE, akış kapalı gibi hatalar dbus bağlantısı hazır olmadığında oluşur
        const ignoredErrors = ['EPIPE', 'stream is closed', 'Cannot send message'];
        const shouldIgnore = ignoredErrors.some(err =>
            e.code === err || (e.message && e.message.includes(err))
        );

        if (!shouldIgnore) {
            console.error('MPRIS metadata güncelleme hatası:', e.message);
        }
        // Hata gösterme - bu normal bir durum
    }
}

function updateTrayMenu(state) {
    if (!tray) return;

    const safeState = (state && typeof state === 'object') ? state : {};
    const mergedState = {
        ...lastTrayState,
        ...safeState
    };
    lastTrayState = mergedState;

    const { isPlaying = false, currentTrack = 'Aurivo Media Player', isMuted = false, stopAfterCurrent = false } = mergedState;

    // İkonları küçük ve tutarlı boyutta yükle
    const iconPath = (name) => {
        const p = getResourcePath(path.join('icons', name));
        const img = nativeImage.createFromPath(p);
        if (!img || img.isEmpty()) return undefined;
        const menuIconSize = process.platform === 'linux' ? 18 : 16;
        return img.resize({ width: menuIconSize, height: menuIconSize });
    };

    const contextMenu = Menu.buildFromTemplate([
        {
            label: tMainSync('trayMedia.previous'),
            icon: iconPath('tray-previous.png'),
            click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('media-control', 'previous');
                }
            }
        },
        {
            label: isPlaying ? tMainSync('trayMedia.pause') : tMainSync('trayMedia.play'),
            icon: iconPath(isPlaying ? 'tray-pause.png' : 'tray-play.png'),
            click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('media-control', 'play-pause');
                }
            }
        },
        {
            label: tMainSync('trayMedia.stop'),
            icon: iconPath('tray-stop.png'),
            click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('media-control', 'stop');
                }
            }
        },
        {
            label: tMainSync('trayMedia.stopAfterCurrent'),
            type: 'checkbox',
            checked: stopAfterCurrent,
            click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('media-control', 'stop-after-current');
                }
            }
        },
        {
            label: tMainSync('trayMedia.next'),
            icon: iconPath('tray-next.png'),
            click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('media-control', 'next');
                }
            }
        },
        { type: 'separator' },
        {
            label: isMuted ? tMainSync('trayMedia.unmute') : tMainSync('trayMedia.mute'),
            icon: iconPath(isMuted ? 'tray-volume.png' : 'tray-mute.png'),
            click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('media-control', 'mute-toggle');
                }
            }
        },
        {
            label: tMainSync('trayMedia.like'),
            icon: iconPath('tray-like.png'),
            click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('media-control', 'like');
                }
            }
        },
        { type: 'separator' },
        {
            label: tMainSync('trayMedia.show'),
            icon: iconPath('tray-show.png'),
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                }
            }
        },
        {
            label: tMainSync('trayMedia.exit'),
            icon: iconPath('tray-exit.png'),
            click: () => {
                app.isQuitting = true;
                app.quit();
            }
        }
    ]);

    tray.setContextMenu(contextMenu);
}

// ============================================
// SES EFEKTLERİ PENCERESİ
// ============================================
let soundEffectsWindow = null;
let soundEffectsWindowScope = 'music';

// ============================================
// EQ HAZIR AYARLAR (AUTOEQ) PENCERESİ
// ============================================
let eqPresetsWindow = null;

function normalizeSoundEffectsScope(rawScope) {
    const scope = String(rawScope || '').trim().toLowerCase();
    if (scope === 'web' || scope === 'video' || scope === 'music') return scope;
    return 'music';
}

function getSoundEffectsWindowTitle(scope) {
    const normalized = normalizeSoundEffectsScope(scope);
    if (normalized === 'web') return 'Ses Efektleri (Web) — Aurivo Medya Player';
    if (normalized === 'video') return 'Ses Efektleri (Video) — Aurivo Medya Player';
    return 'Ses Efektleri (Müzik) — Aurivo Medya Player';
}

function createSoundEffectsWindow(rawScope = 'music') {
    const scope = normalizeSoundEffectsScope(rawScope);
    const htmlPath = path.join(__dirname, 'soundEffects.html');

    // Pencere zaten açıksa, önne getir
    if (soundEffectsWindow && !soundEffectsWindow.isDestroyed()) {
        const shouldReloadForScope = soundEffectsWindowScope !== scope;
        soundEffectsWindowScope = scope;
        soundEffectsWindow.setTitle(getSoundEffectsWindowTitle(scope));
        if (shouldReloadForScope) {
            soundEffectsWindow.loadFile(htmlPath, { query: { scope } }).catch((err) => {
                console.error('[SFX] scope reload error:', err);
            });
        }
        soundEffectsWindow.focus();
        return;
    }

    soundEffectsWindowScope = scope;
    soundEffectsWindow = new BrowserWindow({
        width: 1300,
        height: 800,
        minWidth: 1000,
        minHeight: 600,
        backgroundColor: '#0a0a0f',
        icon: getAppIconImage(),
        parent: null, // Bağımsız pencere (ana pencereden ayrı)
        modal: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            // sandbox: false gerekli — preload.js Node.js require() kullanıyor.
            sandbox: false,
            webSecurity: true,
            allowRunningInsecureContent: false,
            backgroundThrottling: false,
            spellcheck: false
        },
        frame: false, // Özel başlık çubuğu için çerçevesiz
        title: getSoundEffectsWindowTitle(scope),
        show: false
    });

    if (process.platform === 'linux' && typeof soundEffectsWindow.setIcon === 'function') {
        soundEffectsWindow.setIcon(getAppIconImage());
    }

    soundEffectsWindow.loadFile(htmlPath, { query: { scope } });

    // Pencere hazır olduğunda göster
    soundEffectsWindow.once('ready-to-show', () => {
        soundEffectsWindow.show();
    });

    soundEffectsWindow.on('closed', () => {
        soundEffectsWindow = null;
        soundEffectsWindowScope = 'music';
    });
}

function createEQPresetsWindow() {
    console.log('[createEQPresetsWindow] Fonksiyon çağrıldı');

    // Pencere zaten açıksa, önne getir
    if (eqPresetsWindow && !eqPresetsWindow.isDestroyed()) {
        console.log('[createEQPresetsWindow] Pencere zaten açık, focus yapılıyor');
        eqPresetsWindow.focus();
        return;
    }

    // Üst pencere: ses efektleri penceresini bul; yoksa ana pencereyi kullan
    let parentWindow = null;
    if (soundEffectsWindow && !soundEffectsWindow.isDestroyed()) {
        parentWindow = soundEffectsWindow;
        console.log('[createEQPresetsWindow] Parent: soundEffectsWindow');
    } else if (mainWindow && !mainWindow.isDestroyed()) {
        parentWindow = mainWindow;
        console.log('[createEQPresetsWindow] Parent: mainWindow');
    } else {
        console.log('[createEQPresetsWindow] UYARI: Parent pencere bulunamadı!');
    }

    console.log('[createEQPresetsWindow] BrowserWindow oluşturuluyor...');
    eqPresetsWindow = new BrowserWindow({
        width: 980,
        height: 820,
        minWidth: 980,
        minHeight: 820,
        backgroundColor: '#111115',
        icon: getAppIconImage(),
        parent: parentWindow,
        modal: false,
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            // sandbox: false gerekli — preload.js Node.js require() kullanıyor.
            sandbox: false,
            webSecurity: true,
            allowRunningInsecureContent: false
        },
        frame: true,
        title: 'Aurivo Hazır Ayarlar — Aurivo Medya Player',
        show: false
    });

    try {
        eqPresetsWindow.setMenuBarVisibility(false);
        if (typeof eqPresetsWindow.removeMenu === 'function') {
            eqPresetsWindow.removeMenu();
        }
    } catch { }

    let hasEverBeenShown = false;

    if (process.platform === 'linux' && typeof eqPresetsWindow.setIcon === 'function') {
        eqPresetsWindow.setIcon(getAppIconImage());
    }

    const htmlPath = path.join(__dirname, 'eqPresets.html');
    console.log('[createEQPresetsWindow] HTML dosyası yükleniyor:', htmlPath);

    eqPresetsWindow.loadFile(htmlPath)
        .then(() => {
            console.log('[createEQPresetsWindow] HTML yükleme başarılı, pencere gösteriliyor');
            if (eqPresetsWindow && !eqPresetsWindow.isDestroyed()) {
                eqPresetsWindow.show();
            }
        })
        .catch(err => {
            console.error('[createEQPresetsWindow] loadFile HATA:', err);
        });

    eqPresetsWindow.once('ready-to-show', () => {
        console.log('[createEQPresetsWindow] ready-to-show event tetiklendi');
    });

    eqPresetsWindow.on('closed', () => {
        eqPresetsWindow = null;
    });
}

// Ses Efektleri Penceresini Aç
ipcMain.handle('soundEffects:openWindow', (_event, options) => {
    const rawScope = typeof options === 'string' ? options : options?.scope;
    const scope = normalizeSoundEffectsScope(rawScope);
    createSoundEffectsWindow(scope);
    return true;
});

// Ses Efektleri Penceresini Kapat
ipcMain.handle('soundEffects:closeWindow', () => {
    if (soundEffectsWindow && !soundEffectsWindow.isDestroyed()) {
        soundEffectsWindow.close();
    }
    return true;
});

ipcMain.handle('soundEffects:applyInMainWindow', async (_event, script) => {
    try {
        if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'main-window-missing' };
        const js = String(script || '');
        if (!js.trim()) return { ok: false, error: 'empty-script' };
        if (js.length > 2_000_000) return { ok: false, error: 'script-too-large' };
        const result = await mainWindow.webContents.executeJavaScript(js, true);
        return (result && typeof result === 'object') ? result : { ok: !!result, result };
    } catch (error) {
        return { ok: false, error: String(error?.message || error) };
    }
});

ipcMain.handle('soundEffects:getWebSpectrum', async (_event, numBands) => {
    try {
        if (!mainWindow || mainWindow.isDestroyed()) return [];
        const safeBands = Math.max(64, Math.min(512, Number(numBands) || 128));
        const result = await mainWindow.webContents.executeJavaScript(
            `window.__aurivoGetWebSpectrum ? window.__aurivoGetWebSpectrum(${safeBands}) : []`,
            true
        );
        return Array.isArray(result) ? result : [];
    } catch {
        return [];
    }
});

ipcMain.handle('soundEffects:getWebNoiseGateStatus', async () => {
    try {
        if (!mainWindow || mainWindow.isDestroyed()) {
            return { ok: false, enabled: false, open: true, gain: 1, envDb: -120, thresholdDb: -40 };
        }
        const result = await mainWindow.webContents.executeJavaScript(
            'window.__aurivoGetWebNoiseGateStatus ? window.__aurivoGetWebNoiseGateStatus() : ({ ok: false, enabled: false, open: true, gain: 1, envDb: -120, thresholdDb: -40 })',
            true
        );
        return (result && typeof result === 'object')
            ? result
            : { ok: false, enabled: false, open: true, gain: 1, envDb: -120, thresholdDb: -40 };
    } catch {
        return { ok: false, enabled: false, open: true, gain: 1, envDb: -120, thresholdDb: -40 };
    }
});

ipcMain.handle('soundEffects:getWebTruePeakStatus', async () => {
    try {
        if (!mainWindow || mainWindow.isDestroyed()) {
            return { ok: false, truePeakL: -96, truePeakR: -96, holdL: -96, holdR: -96, clippingCount: 0, gainReduction: 0 };
        }
        const result = await mainWindow.webContents.executeJavaScript(
            'window.__aurivoGetWebTruePeakStatus ? window.__aurivoGetWebTruePeakStatus() : ({ ok: false, truePeakL: -96, truePeakR: -96, holdL: -96, holdR: -96, clippingCount: 0, gainReduction: 0 })',
            true
        );
        return (result && typeof result === 'object')
            ? result
            : { ok: false, truePeakL: -96, truePeakR: -96, holdL: -96, holdR: -96, clippingCount: 0, gainReduction: 0 };
    } catch {
        return { ok: false, truePeakL: -96, truePeakR: -96, holdL: -96, holdR: -96, clippingCount: 0, gainReduction: 0 };
    }
});

ipcMain.handle('soundEffects:getWebDynamicEqStatus', async () => {
    try {
        if (!mainWindow || mainWindow.isDestroyed()) {
            return { ok: false, enabled: false, currentGainDb: 0, gainReductionDb: 0, envDb: -120, thresholdDb: -40, triggered: false };
        }
        const result = await mainWindow.webContents.executeJavaScript(
            'window.__aurivoGetWebDynamicEqStatus ? window.__aurivoGetWebDynamicEqStatus() : ({ ok: false, enabled: false, currentGainDb: 0, gainReductionDb: 0, envDb: -120, thresholdDb: -40, triggered: false })',
            true
        );
        return (result && typeof result === 'object')
            ? result
            : { ok: false, enabled: false, currentGainDb: 0, gainReductionDb: 0, envDb: -120, thresholdDb: -40, triggered: false };
    } catch {
        return { ok: false, enabled: false, currentGainDb: 0, gainReductionDb: 0, envDb: -120, thresholdDb: -40, triggered: false };
    }
});

ipcMain.handle('soundEffects:getWebPerfStatus', async () => {
    try {
        if (!mainWindow || mainWindow.isDestroyed()) {
            return {
                ok: false,
                loops: {},
                build: { count: 0, lastMs: 0, avgMs: 0, maxMs: 0, rebuildCount: 0 },
                apply: { count: 0, lastMs: 0, avgMs: 0, maxMs: 0 },
                totalGlitches: 0,
                uptimeSec: 0
            };
        }
        const result = await mainWindow.webContents.executeJavaScript(
            'window.__aurivoGetWebPerfStatus ? window.__aurivoGetWebPerfStatus() : ({ ok: false, loops: {}, build: { count: 0, lastMs: 0, avgMs: 0, maxMs: 0, rebuildCount: 0 }, apply: { count: 0, lastMs: 0, avgMs: 0, maxMs: 0 }, totalGlitches: 0, uptimeSec: 0 })',
            true
        );
        return (result && typeof result === 'object')
            ? result
            : {
                ok: false,
                loops: {},
                build: { count: 0, lastMs: 0, avgMs: 0, maxMs: 0, rebuildCount: 0 },
                apply: { count: 0, lastMs: 0, avgMs: 0, maxMs: 0 },
                totalGlitches: 0,
                uptimeSec: 0
            };
    } catch {
        return {
            ok: false,
            loops: {},
            build: { count: 0, lastMs: 0, avgMs: 0, maxMs: 0, rebuildCount: 0 },
            apply: { count: 0, lastMs: 0, avgMs: 0, maxMs: 0 },
            totalGlitches: 0,
            uptimeSec: 0
        };
    }
});

// EQ Hazır Ayarlar Penceresini Aç
ipcMain.handle('eqPresets:openWindow', async () => {
    try {
        console.log('[EQ Presets] IPC handler çağrıldı, pencere açılıyor...');
        createEQPresetsWindow();
        console.log('[EQ Presets] Pencere oluşturuldu');
        return true;
    } catch (err) {
        console.error('[EQ Presets] Hata:', err);
        return false;
    }
});

ipcMain.handle('eqPresets:closeWindow', () => {
    if (eqPresetsWindow && !eqPresetsWindow.isDestroyed()) {
        eqPresetsWindow.close();
    }
    return true;
});

ipcMain.handle('eqPresets:getFeaturedList', () => {
    return AURIVO_EQ_FEATURED_LIST;
});

// ============================================
// PROJECTM GÖRSELLEŞTİRİCİ (NATIVE ÇALIŞTIRILABİLİR)
// ============================================
let visualizerProc = null;
let visualizerLang = '';
let visualizerFeedTimer = null;
let visualizerFeedStats = null;
let visualizerVideoSpectrumFrame = null;

function clamp01(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    if (n <= 0) return 0;
    if (n >= 1) return 1;
    return n;
}

function updateVisualizerVideoSpectrum(payload) {
    const source = payload && typeof payload === 'object' ? payload : {};
    const input = Array.isArray(source.bands) ? source.bands : [];
    const bands = input
        .slice(0, 512)
        .map((v) => clamp01(v))
        .filter((v) => Number.isFinite(v));

    visualizerVideoSpectrumFrame = {
        updatedAt: Date.now(),
        isPlaying: !!source.isPlaying,
        targetFps: Math.max(20, Math.min(60, Number(source.targetFps) || 30)),
        sourceMode: (() => {
            const raw = String(source.sourceMode || '').trim().toLowerCase();
            return (raw === 'video' || raw === 'web') ? raw : '';
        })(),
        bands,
        phases: (visualizerVideoSpectrumFrame && Array.isArray(visualizerVideoSpectrumFrame.phases))
            ? visualizerVideoSpectrumFrame.phases
            : [],
        smooth: (visualizerVideoSpectrumFrame && Array.isArray(visualizerVideoSpectrumFrame.smooth))
            ? visualizerVideoSpectrumFrame.smooth
            : []
    };
}

function getVisualizerFeedIntervalMs() {
    const fps = Math.max(20, Math.min(60, Number(visualizerVideoSpectrumFrame?.targetFps) || 30));
    return Math.max(12, Math.min(60, Math.round(1000 / fps)));
}

function buildVisualizerVideoPcmFallback(framesPerChannel) {
    const frame = visualizerVideoSpectrumFrame;
    if (!frame || !Array.isArray(frame.bands) || frame.bands.length === 0) return null;
    if (Date.now() - Number(frame.updatedAt || 0) > 700) return null;
    const hasEnergy = frame.bands.some((v) => Number(v) > 0.0035);
    if (!frame.isPlaying && !hasEnergy) return null;

    const oscCount = Math.max(24, Math.min(64, frame.bands.length));
    const sampleRate = 48000;
    const channels = 2;
    const countPerChannel = Math.max(128, Math.min(4096, Number(framesPerChannel) || 1024));

    if (!Array.isArray(frame.phases) || frame.phases.length !== oscCount) {
        frame.phases = Array.from({ length: oscCount }, () => Math.random() * Math.PI * 2);
    }
    if (!Array.isArray(frame.smooth) || frame.smooth.length !== oscCount) {
        frame.smooth = Array.from({ length: oscCount }, () => 0);
    }

    const amps = new Array(oscCount);
    const phaseIncs = new Array(oscCount);
    const maxIdx = Math.max(1, frame.bands.length - 1);
    const maxOsc = Math.max(1, oscCount - 1);

    for (let i = 0; i < oscCount; i++) {
        const t = i / maxOsc;
        const bandIdx = Math.round(t * maxIdx);
        const band = clamp01(frame.bands[bandIdx] || 0);
        const target = Math.pow(band, 1.18);
        const prev = Number(frame.smooth[i]) || 0;
        const smoothed = prev * 0.72 + target * 0.28;
        frame.smooth[i] = smoothed;

        amps[i] = smoothed;
        const freq = 35 * Math.pow(2, t * 8.5);
        phaseIncs[i] = (2 * Math.PI * freq) / sampleRate;
    }

    const floatArray = new Float32Array(countPerChannel * channels);
    const norm = 1 / Math.max(1, Math.sqrt(oscCount) * 1.25);
    const activityScale = frame.isPlaying ? 1 : 0.65;

    for (let s = 0; s < countPerChannel; s++) {
        let mono = 0;
        for (let i = 0; i < oscCount; i++) {
            mono += Math.sin(frame.phases[i]) * amps[i];
            frame.phases[i] += phaseIncs[i];
            if (frame.phases[i] > Math.PI * 2) frame.phases[i] -= Math.PI * 2;
        }
        const soft = Math.tanh(mono * norm * 1.8) * 0.7 * activityScale;
        floatArray[s * 2] = soft;
        floatArray[s * 2 + 1] = soft;
    }

    return { channels, countPerChannel, data: floatArray };
}

function stopVisualizerFeed() {
    if (visualizerFeedTimer) {
        clearTimeout(visualizerFeedTimer);
        visualizerFeedTimer = null;
    }
    visualizerFeedStats = null;
}

function startVisualizerFeed() {
    stopVisualizerFeed();
    if (!visualizerProc || !visualizerProc.stdin) return;
    const hasNativePcm = !!(audioEngine && typeof audioEngine.getPCMData === 'function');
    if (!hasNativePcm) {
        console.warn('[Visualizer] Native PCM yok, web/video spectrum fallback feed aktif');
    }

    const requestedFramesPerChannel = 1024;
    visualizerFeedStats = {
        startedAt: Date.now(),
        lastLogAt: 0,
        packets: 0,
        bytes: 0,
        drops: 0,
        noData: 0,
        backpressure: 0,
        firstWriteOk: false
    };

    const tick = () => {
        let shouldStop = false;
        try {
            if (!visualizerProc || visualizerProc.killed || !visualizerProc.stdin || visualizerProc.stdin.destroyed) {
                shouldStop = true;
            }
            if (!shouldStop && !visualizerProc.stdin.writable) {
                shouldStop = true;
            }
            if (!shouldStop) {
                let skipWrite = false;

                // Native ses motorundan kanallar arası (interleaved) float PCM al.
                // Video/WebAudio yolunda veri yoksa, renderer'dan gelen spektrumdan fallback PCM üret.
                const fallback = buildVisualizerVideoPcmFallback(requestedFramesPerChannel);
                const fallbackFrame = visualizerVideoSpectrumFrame;
                const shouldPreferFallback = !!(
                    fallback &&
                    fallbackFrame &&
                    (fallbackFrame.sourceMode === 'video' || fallbackFrame.sourceMode === 'web')
                );

                let pcmRes = shouldPreferFallback
                    ? fallback
                    : (hasNativePcm ? audioEngine.getPCMData(requestedFramesPerChannel) : null);
                if (!pcmRes || !pcmRes.data || pcmRes.data.length === 0) {
                    if (fallback) {
                        pcmRes = fallback;
                    } else {
                        if (visualizerFeedStats) visualizerFeedStats.noData++;
                        skipWrite = true;
                    }
                }

                if (!skipWrite) {
                    let channels = Number(pcmRes.channels) || 0;
                    if (channels <= 0) {
                        if (visualizerFeedStats) visualizerFeedStats.noData++;
                        skipWrite = true;
                    } else {
                        if (channels > 2) channels = 2;

                        let floatArray = (pcmRes.data instanceof Float32Array) ? pcmRes.data : Float32Array.from(pcmRes.data);
                        const countPerChannel = Math.floor(floatArray.length / channels);
                        if (countPerChannel <= 0) {
                            if (visualizerFeedStats) visualizerFeedStats.noData++;
                            skipWrite = true;
                        } else {
                            const floatCount = countPerChannel * channels;
                            if (floatCount !== floatArray.length) {
                                floatArray = floatArray.subarray(0, floatCount);
                            }

                            // Protokol v2: [u32 channels][u32 countPerChannel][float32 * (channels*countPerChannel)]
                            const header = Buffer.allocUnsafe(8);
                            header.writeUInt32LE(channels, 0);
                            header.writeUInt32LE(countPerChannel, 4);

                            const payload = Buffer.from(floatArray.buffer, floatArray.byteOffset, floatCount * 4);

                            // Geri basınç olursa kare atla.
                            const ok1 = visualizerProc.stdin.write(header);
                            const ok2 = visualizerProc.stdin.write(payload);
                            if (!ok1 || !ok2) {
                                // Drain beklemeyelim; bir sonraki tick'te tekrar deneriz.
                                if (visualizerFeedStats) visualizerFeedStats.backpressure++;
                            }
                            if (visualizerFeedStats) {
                                visualizerFeedStats.packets++;
                                visualizerFeedStats.bytes += header.length + payload.length;
                                if (!visualizerFeedStats.firstWriteOk) {
                                    visualizerFeedStats.firstWriteOk = true;
                                    console.log('[Visualizer] PCM pipe active (first write ok)');
                                }
                            }
                        }
                    }
                }
            }
        } catch (e) {
            // en iyi çaba
            if (visualizerFeedStats) visualizerFeedStats.drops++;
        }

        if (visualizerFeedStats) {
            const now = Date.now();
            if (now - visualizerFeedStats.lastLogAt > 5000) {
                visualizerFeedStats.lastLogAt = now;
                const up = Math.max(1, Math.round((now - visualizerFeedStats.startedAt) / 1000));
                console.log('[Visualizer] PCM stats', {
                    up_s: up,
                    packets: visualizerFeedStats.packets,
                    bytes: visualizerFeedStats.bytes,
                    backpressure: visualizerFeedStats.backpressure,
                    noData: visualizerFeedStats.noData,
                    drops: visualizerFeedStats.drops
                });
            }
        }
        if (shouldStop) {
            stopVisualizerFeed();
            return;
        }
        if (visualizerProc && !visualizerProc.killed) {
            visualizerFeedTimer = setTimeout(tick, getVisualizerFeedIntervalMs());
        }
    };

    visualizerFeedTimer = setTimeout(tick, getVisualizerFeedIntervalMs());
}

function isDevMode() {
    // Dev modda (electron . / npm start), build-visualizer içindeki yeni derlenmiş native binary'leri tercih ederiz.
    // Paketli sürümlerde native-dist kullanılır.
    return !app.isPackaged || process.env.AURIVO_DEV === '1' || process.argv.includes('--dev');
}

function pickFirstExistingPath(paths) {
    for (const p of paths || []) {
        try {
            if (p && fs.existsSync(p)) return p;
        } catch {
            // yoksay
        }
    }
    return '';
}

function getProjectMPresetsPath() {
    const candidates = [];

    if (app.isPackaged) {
        // Tercih edilen paket yolu (extraResources ile açıkça eşlenmiş)
        candidates.push(path.join(process.resourcesPath, 'visualizer-presets'));
        // Yedek: third_party tamamen taşınmışsa
        candidates.push(path.join(process.resourcesPath, 'third_party', 'projectm', 'presets'));
    } else {
        candidates.push(getResourcePath(path.join('third_party', 'projectm', 'presets')));
    }

    return pickFirstExistingPath(candidates);
}

function getVisualizerExecutableCandidates() {
    const out = [];
    const platformSubdir = process.platform === 'win32'
        ? 'windows'
        : (process.platform === 'darwin' ? 'darwin' : 'linux');

    // Paketlenmiş (Windows): native-dist tercih edilir; gerekirse taşınmış third_party'ye düş (binary içeriyorsa)
    if (app.isPackaged && process.platform === 'win32') {
        out.push(path.join(process.resourcesPath, 'native-dist', 'aurivo-projectm-visualizer.exe'));
        out.push(path.join(process.resourcesPath, 'native-dist', 'windows', 'aurivo-projectm-visualizer.exe'));
        out.push(path.join(process.resourcesPath, 'third_party', 'projectm', 'aurivo-projectm-visualizer.exe'));
        out.push(path.join(process.resourcesPath, 'third_party', 'projectm', 'bin', 'aurivo-projectm-visualizer.exe'));
        return out;
    }

    const exeName = process.platform === 'win32'
        ? 'aurivo-projectm-visualizer.exe'
        : 'aurivo-projectm-visualizer';

    // Paketlenmiş (Linux/Mac): resources/native-dist (extraResources)
    if (app.isPackaged) {
        out.push(path.join(process.resourcesPath, 'native-dist', exeName));
        out.push(path.join(process.resourcesPath, 'native-dist', platformSubdir, exeName));
        // third_party taşınmış ve binary içeriyorsa isteğe bağlı yedek
        out.push(path.join(process.resourcesPath, 'third_party', 'projectm', exeName));
        out.push(path.join(process.resourcesPath, 'third_party', 'projectm', 'bin', exeName));
        return out;
    }

    // Dev: mevcut davranışı koru (distPath + build-visualizer adayları aşağıda)
    out.push(getResourcePath(path.join('native-dist', exeName)));
    out.push(getResourcePath(path.join('native-dist', platformSubdir, exeName)));
    return out;
}

function getVisualizerExecutablePath() {
    const exeName = process.platform === 'win32'
        ? 'aurivo-projectm-visualizer.exe'
        : 'aurivo-projectm-visualizer';

    // Temel aday(lar)
    const baseCandidates = getVisualizerExecutableCandidates();
    const basePick = pickFirstExistingPath(baseCandidates);

    // Geliştirici kolaylığı: varsa yeni CMake çıktısını tercih et.
    const devCandidates = process.platform === 'win32'
        ? [
            path.join(__dirname, 'build-visualizer', 'Release', exeName),
            path.join(__dirname, 'build-visualizer', exeName)
        ]
        : [
            path.join(__dirname, 'build-visualizer', exeName)
        ];

    // Geliştirici kolaylığı: varsa yeni CMake çıktısını tercih et.
    // Bu, native-dist'e kopyalamayı unutunca oluşan "derlemede çalışıyor ama uygulamada çalışmıyor" sorunlarını önler.
    if (isDevMode()) {
        for (const p of devCandidates) {
            if (fs.existsSync(p)) return p;
        }
        return basePick || ((baseCandidates && baseCandidates[0]) ? baseCandidates[0] : '');
    }

    // Dev dışı: paketli adayları tercih et; yoksa yedeğe izin ver.
    if (basePick && fs.existsSync(basePick)) return basePick;
    for (const p of devCandidates) {
        if (fs.existsSync(p)) {
            console.warn('[Visualizer] native-dist bulunamadı; build-visualizer çıktısına fallback:', p);
            return p;
        }
    }
    return basePick || ((baseCandidates && baseCandidates[0]) ? baseCandidates[0] : '');
}

function validateVisualizerBinaryForCurrentRuntime(exePath) {
    if (!exePath || !fs.existsSync(exePath)) {
        return { ok: false, reason: 'missing-executable' };
    }
    if (process.platform !== 'linux') {
        return { ok: true };
    }
    const isFlatpakRuntime = !!(process.env.FLATPAK_ID || process.env.APP_ID);
    if (!isFlatpakRuntime) {
        return { ok: true };
    }

    try {
        const check = spawnSync('ldd', [exePath], {
            encoding: 'utf8',
            timeout: 3000,
            env: { ...process.env }
        });
        const output = `${check?.stdout || ''}\n${check?.stderr || ''}`;

        if (/GLIBC_[0-9.]+['`]?\s+not found/i.test(output)) {
            return { ok: false, reason: 'glibc-mismatch', detail: output.trim() };
        }
        if (/=>\s+not found/i.test(output)) {
            return { ok: false, reason: 'missing-shared-lib', detail: output.trim() };
        }
    } catch (error) {
        return { ok: false, reason: 'runtime-check-failed', detail: String(error?.message || error || '') };
    }

    return { ok: true };
}

function startVisualizer() {
    if (visualizerProc && !visualizerProc.killed) return true;

    const exeCandidates = getVisualizerExecutableCandidates();
    const exePath = getVisualizerExecutablePath();

    const presetsCandidates = [
        path.join(process.resourcesPath || '', 'visualizer-presets'),
        path.join(process.resourcesPath || '', 'third_party', 'projectm', 'presets'),
        getProjectMPresetsPath()
    ].filter(Boolean);
    const presetsPath = pickFirstExistingPath(presetsCandidates);

    const exeOk = fs.existsSync(exePath);
    const presetsOk = fs.existsSync(presetsPath);
    if (!exeOk || !presetsOk) {
        if (!exeOk) console.error('[Visualizer] executable bulunamadı:', exePath);
        if (!presetsOk) console.error('[Visualizer] presets bulunamadı:', presetsPath);

        const title = tMainSync('visualizer.notFoundTitle') || (process.platform === 'win32'
            ? 'Görselleştirici Windows uyumlu değil'
            : 'Görselleştirici bileşenleri eksik');
        let body = tMainSync('visualizer.notFoundBody', { path: exePath }) || '';

        const lines = [];
        lines.push('Aranan yollar:');
        lines.push(`- Visualizer: ${exePath}`);
        if (exeCandidates?.length) {
            lines.push('  Adaylar:');
            for (const p of exeCandidates) lines.push(`  - ${p}`);
        }
        lines.push(`- Presets: ${presetsPath}`);
        lines.push('  Adaylar:');
        for (const p of presetsCandidates) lines.push(`  - ${p}`);
        lines.push('');
        lines.push('Çözüm:');
        if (process.platform === 'win32') {
            lines.push('- Görselleştirici, Windows üzerinde çalışmak için `aurivo-projectm-visualizer.exe` gerektirir.');
        }
        lines.push('- Uygulamayı yeniden kurmayı deneyin.');
        lines.push('- Paketleme sırasında `native-dist` (exe) ve presets klasörünün `extraResources` içine dahil olduğundan emin olun.');
        lines.push('- Bu eksiklik müzik kütüphanesini/oynatıcıyı etkilemez; sadece görselleştirici devre dışı kalır.');

        body = [body, lines.join('\n')].filter(Boolean).join('\n\n');
        // Uygulamayı kilitlemeyelim: uyarı göster ve çık.
        dialog.showMessageBox({
            type: 'warning',
            title,
            message: title,
            detail: body,
            buttons: ['Tamam']
        }).catch(() => { /* yoksay */ });
        return false;
    }
    const runtimeCheck = validateVisualizerBinaryForCurrentRuntime(exePath);
    if (!runtimeCheck.ok) {
        const title = tMainSync('visualizer.runtimeUnsupportedTitle') || 'Görselleştirici bu Flatpak ortamında başlatılamadı';
        const reasonText = runtimeCheck.reason === 'glibc-mismatch'
            ? 'Native visualizer binary bu runtime ile ABI uyumlu değil (GLIBC mismatch).'
            : (runtimeCheck.reason === 'missing-shared-lib'
                ? 'Native visualizer için gereken paylaşımlı kütüphaneler bulunamadı.'
                : 'Native visualizer runtime doğrulaması başarısız oldu.');
        const detail = [
            reasonText,
            '',
            `Binary: ${exePath}`,
            runtimeCheck.detail ? `Detay:\n${runtimeCheck.detail}` : ''
        ].filter(Boolean).join('\n');

        dialog.showMessageBox({
            type: 'warning',
            title,
            message: title,
            detail,
            buttons: ['Tamam']
        }).catch(() => {});

        console.warn('[Visualizer] runtime uyumsuz -> native visualizer devre dışı:', runtimeCheck.reason);
        return { started: false, reason: runtimeCheck.reason };
    }

    const visualizerIconCandidates = [
        getResourcePath(path.join('icons', 'aurivo_512.png')),
        path.join(process.resourcesPath || '', 'icons', 'aurivo_512.png'),
        '/app/share/icons/hicolor/512x512/apps/com.aurivo.mediaplayer.png'
    ].filter(Boolean);
    const visualizerIconPath = visualizerIconCandidates.find((p) => {
        if (!p || p.includes('.asar/')) return false;
        try { return fs.existsSync(p); } catch { return false; }
    }) || visualizerIconCandidates.find(Boolean) || '';
    const tVis = (key, fallback, vars) => {
        const v = tMainSync(key, vars);
        if (!v || v === key) return '';
        return v;
    };

    const uiLang = getUiLanguageSync();
    const posixLocale = uiLangToPosixLocale(uiLang);
    const localeChain = uiLangToLocaleChain(uiLang);
    const visualizerDesktopEntry = resolveLinuxDesktopEntryId() || 'com.aurivo.mediaplayer';
    const visualizerFontCandidates = [
        // Flatpak: native binary icin asar disi okunabilir font
        '/app/aurivo/resources/native-dist/linux/fonts/Inter-Regular.ttf',
        path.join(process.resourcesPath || '', 'native-dist', 'linux', 'fonts', 'Inter-Regular.ttf'),
        // Gelistirme ortami
        path.join(__dirname, 'assets', 'fonts', 'Inter-Regular.ttf')
    ].filter(Boolean);
    const visualizerFontPath = visualizerFontCandidates.find((p) => {
        if (!p || p.includes('.asar/')) return false;
        try { return fs.existsSync(p); } catch { return false; }
    }) || '';
    const env = {
        ...process.env,
        PROJECTM_PRESETS_PATH: presetsPath,
        AURIVO_VISUALIZER_ICON: visualizerIconPath,
        AURIVO_VIS_FONT_PATH: visualizerFontPath,
        // Linux window grouping + icon lookup (Wayland app_id / X11 WM_CLASS)
        AURIVO_VIS_DESKTOP_ENTRY: process.env.AURIVO_VIS_DESKTOP_ENTRY || visualizerDesktopEntry,
        AURIVO_VIS_WMCLASS: process.env.AURIVO_VIS_WMCLASS || 'com.aurivo.mediaplayer',
        SDL_APP_NAME: process.env.AURIVO_VIS_WMCLASS || 'com.aurivo.mediaplayer',
        // Native görselleştirici için UI dili (SDL2/ImGui)
        AURIVO_LANG: uiLang,
        LANG: posixLocale,
        LC_ALL: posixLocale,
        LANGUAGE: localeChain,
        // Native visualizer i18n strings (all app locales can override these keys over time)
        AURIVO_VIS_CTX_DISPLAY: tVis('visualizerNative.context.display', 'Display'),
        AURIVO_VIS_CTX_RENDERING: tVis('visualizerNative.context.rendering', 'Rendering'),
        AURIVO_VIS_CTX_PRESETS: tVis('visualizerNative.context.presets', 'Presets'),
        AURIVO_VIS_CTX_TOGGLE_FULLSCREEN: tVis('visualizerNative.context.toggleFullscreen', 'Toggle fullscreen'),
        AURIVO_VIS_CTX_FRAME_RATE: tVis('visualizerNative.context.frameRate', 'Frame rate'),
        AURIVO_VIS_CTX_QUALITY: tVis('visualizerNative.context.quality', 'Quality'),
        AURIVO_VIS_CTX_CLARITY: tVis('visualizerNative.context.clarity', 'Clarity'),
        AURIVO_VIS_CTX_SELECT_VISUALS: tVis('visualizerNative.context.selectVisuals', 'Select visualizations...'),
        AURIVO_VIS_CTX_CLOSE: tVis('visualizerNative.context.close', 'Close visualization'),
        AURIVO_VIS_CTX_FPS_LOW: tVis('visualizerNative.context.fpsLow', 'Low (15 fps)'),
        AURIVO_VIS_CTX_FPS_MEDIUM: tVis('visualizerNative.context.fpsMedium', 'Medium (25 fps)'),
        AURIVO_VIS_CTX_FPS_HIGH: tVis('visualizerNative.context.fpsHigh', 'High (35 fps)'),
        AURIVO_VIS_CTX_FPS_SUPER: tVis('visualizerNative.context.fpsUltra', 'Super high (60 fps)'),
        AURIVO_VIS_CTX_QUALITY_LOW: tVis('visualizerNative.context.qualityLow', 'Low (256x256)'),
        AURIVO_VIS_CTX_QUALITY_MEDIUM: tVis('visualizerNative.context.qualityMedium', 'Medium (512x512)'),
        AURIVO_VIS_CTX_QUALITY_HIGH: tVis('visualizerNative.context.qualityHigh', 'High (1024x1024)'),
        AURIVO_VIS_CTX_QUALITY_SUPER: tVis('visualizerNative.context.qualityUltra', 'Super high (2048x2048)'),
        AURIVO_VIS_CTX_CLARITY_SOFT: tVis('visualizerNative.context.claritySoft', 'Soft'),
        AURIVO_VIS_CTX_CLARITY_BALANCED: tVis('visualizerNative.context.clarityBalanced', 'Balanced'),
        AURIVO_VIS_CTX_CLARITY_SHARP: tVis('visualizerNative.context.claritySharp', 'Sharp'),
        AURIVO_VIS_CTX_CLARITY_SHARP_PLUS: tVis('visualizerNative.context.claritySharpPlus', 'Sharp+'),
        AURIVO_VIS_PICKER_TITLE: tVis('visualizerNative.picker.title', 'Aurivo Visuals'),
        AURIVO_VIS_PICKER_HERO_TITLE: tVis('visualizerNative.picker.heroTitle', 'Curate the visual atmosphere'),
        AURIVO_VIS_PICKER_HINT: tVis('visualizerNative.picker.heroHint', 'Choose the presets included in the premium-style auto switch flow.'),
        AURIVO_VIS_PICKER_PRESET_DIR: tVis('visualizerNative.picker.presetDirectory', 'Preset directory'),
        AURIVO_VIS_PICKER_SEARCH: tVis('visualizerNative.picker.search', 'Search presets...'),
        AURIVO_VIS_PICKER_DELAY: tVis('visualizerNative.picker.delay', 'Switch delay'),
        AURIVO_VIS_PICKER_ENABLED: tVis('visualizerNative.picker.enabled', 'Enabled'),
        AURIVO_VIS_PICKER_COMPACT: tVis('visualizerNative.picker.compact', 'Compact'),
        AURIVO_VIS_PICKER_FILTER_ACTIVE: tVis('visualizerNative.picker.filterActive', 'Filter active:'),
        AURIVO_VIS_PICKER_GALLERY: tVis('visualizerNative.picker.gallery', 'Preset gallery'),
        AURIVO_VIS_PICKER_NO_MATCH: tVis('visualizerNative.picker.noMatch', 'No preset matched your search.'),
        AURIVO_VIS_PICKER_IN_ROTATION: tVis('visualizerNative.picker.inRotation', 'In rotation'),
        AURIVO_VIS_PICKER_MANUAL_ONLY: tVis('visualizerNative.picker.manualOnly', 'Manual only'),
        AURIVO_VIS_PICKER_INCLUDED: tVis('visualizerNative.picker.includedInAutoSwitch', 'Included in auto-switch'),
        AURIVO_VIS_PICKER_ALL: tVis('visualizerNative.picker.selectAll', 'Select all'),
        AURIVO_VIS_PICKER_NONE: tVis('visualizerNative.picker.clearAll', 'Clear all'),
        AURIVO_VIS_PICKER_OK: tVis('visualizerNative.picker.done', 'Done'),
        // Varsayılan ana pencere boyutu (kullanıcı yeniden boyutlandırabilir; bir sonraki açılışta bu varsayılan kullanılır).
        AURIVO_VIS_MAIN_W: process.env.AURIVO_VIS_MAIN_W || '900',
        AURIVO_VIS_MAIN_H: process.env.AURIVO_VIS_MAIN_H || '650'
    };

    // Linux: SDL2 için görüntü değişkenleri (Wayland/X11)
    if (process.platform === 'linux') {
        const backendHint = String(
            process.env.AURIVO_DISPLAY_BACKEND ||
            process.env.ELECTRON_OZONE_PLATFORM_HINT ||
            process.env.AURIVO_EFFECTIVE_DISPLAY_BACKEND ||
            effectiveDisplayBackend ||
            'auto'
        ).trim().toLowerCase();
        env.DISPLAY = process.env.DISPLAY || '';
        env.WAYLAND_DISPLAY = process.env.WAYLAND_DISPLAY || '';
        if (backendHint === 'x11' || backendHint === 'wayland') {
            env.SDL_VIDEODRIVER = backendHint;
            env.XDG_SESSION_TYPE = process.env.XDG_SESSION_TYPE || backendHint;
        } else {
            env.XDG_SESSION_TYPE = process.env.XDG_SESSION_TYPE || (process.env.WAYLAND_DISPLAY ? 'wayland' : 'x11');
            env.SDL_VIDEODRIVER = process.env.WAYLAND_DISPLAY ? 'wayland' : 'x11';
        }
    }

    try {
        console.log('[Visualizer] starting:', exePath);
        console.log('[Visualizer] presets:', presetsPath);
        console.log('[Visualizer] ✓ Input source: Aurivo PCM only (NO mic/capture)');
        console.log('[Visualizer] DISPLAY:', env.DISPLAY);
        console.log('[Visualizer] SDL_VIDEODRIVER:', env.SDL_VIDEODRIVER);

        // Hata ayıklama: strace ile çalıştır
        const useStrace = false; // hata ayıklama için true yap
        let actualExe = useStrace ? 'strace' : exePath;
        let actualArgs = useStrace ? ['-o', '/tmp/visualizer-strace.log', '-ff', exePath, '--presets', presetsPath] : ['--presets', presetsPath];

        // [KDE / Wayland Fix] KWin'in pencere açılır açılmaz anında gruplama yapabilmesi için
        // process'in argv[0]'ını zorla desktop ID'si ile başlatıyoruz (bash exec -a kullanarak).
        // Bu sayede Wayland app_id daha SDL2 tarafından iletilmeden süreç ismi tanınır.
        if (process.platform === 'linux' && !useStrace) {
            actualExe = 'bash';
            const desktopId = env.AURIVO_VIS_DESKTOP_ENTRY || 'com.aurivo.mediaplayer';
            actualArgs = ['-c', `exec -a "${desktopId}" "${exePath}" "$@"`, '--', '--presets', presetsPath];
        }

        visualizerProc = spawn(actualExe, actualArgs, {
            env,
            stdio: ['pipe', 'inherit', 'inherit'], // Hata ayıklama için stdout/stderr her zaman inherit
            detached: true // Electron GL context çakışmalarını önlemek için ayrı process grubunda çalıştır
        });
        visualizerLang = normalizeUiLang(uiLang) || uiLang || 'en-US';

        // Electron'ın görselleştiriciyi beklememesi için unref
        visualizerProc.unref();

        startVisualizerFeed();

        visualizerProc.on('exit', (code, signal) => {
            console.log(`[Visualizer] kapandı (code=${code}, signal=${signal})`);
            stopVisualizerFeed();
            visualizerProc = null;
        });

        visualizerProc.on('error', (err) => {
            console.error('[Visualizer] spawn error:', err);
            stopVisualizerFeed();
            visualizerProc = null;
        });

        // stdin hata yönetimi (EPIPE önleme)
        if (visualizerProc.stdin) {
            visualizerProc.stdin.on('error', (err) => {
                if (err.code === 'EPIPE') {
                    console.warn('[Visualizer] stdin EPIPE (visualizer closed)');
                } else {
                    console.error('[Visualizer] stdin error:', err);
                }
                stopVisualizerFeed();
            });
        }

        return { started: true };
    } catch (e) {
        console.error('[Visualizer] startVisualizer exception:', e);
        visualizerProc = null;
        return { started: false, reason: 'spawn-failed' };
    }
}

function stopVisualizer() {
    if (!visualizerProc) return true;
    try {
        console.log('[Visualizer] stopping...');
        stopVisualizerFeed();
        visualizerProc.kill('SIGTERM');
    } catch (e) {
        // en iyi çaba
    }
    visualizerProc = null;
    visualizerLang = '';
    return true;
}

ipcMain.handle('visualizer:toggle', () => {
    if (visualizerProc && !visualizerProc.killed) {
        console.log('[Visualizer] toggle -> stop');
        stopVisualizer();
        return { running: false };
    }

    console.log('[Visualizer] toggle -> start');
    const result = startVisualizer();
    if (typeof result === 'boolean') return { running: result };
    return { running: !!result?.started, reason: result?.reason || '' };
});

ipcMain.on('visualizer:videoSpectrum', (_event, payload) => {
    updateVisualizerVideoSpectrum(payload);
});

ipcMain.handle('diagnostics:getPerformanceSnapshot', async () => {
    return await getPerformanceSnapshot();
});

// ============================================
// I18N (LOCALE'LER)
// ============================================
ipcMain.handle('i18n:loadLocale', async (_event, lang) => {
    const normalized = normalizeUiLang(lang) || 'en-US';
    try {
        const json = await readFirstJson(getLocaleCandidatePaths(normalized));
        if (json) return json;
    } catch (e) {
        if (normalized !== 'en-US') {
            try {
                const json = await readFirstJson(getLocaleCandidatePaths('en-US'));
                if (json) return json;
            } catch {
                return {};
            }
        }
        return {};
    }
    // Yedek
    if (normalized !== 'en-US') {
        const json = await readFirstJson(getLocaleCandidatePaths('en-US'));
        if (json) return json;
    }
    return {};
});

ipcMain.handle('get-system-locale', async () => {
    try {
        if (app && typeof app.getSystemLocale === 'function') {
            return app.getSystemLocale();
        }
        if (app && typeof app.getLocale === 'function') {
            return app.getLocale();
        }
    } catch {
        // ignore
    }
    return 'en-US';
});

// ============================================
// APP KONTROL (YENİDEN BAŞLAT)
// ============================================
ipcMain.handle('app:relaunch', async () => {
    try {
        // Ayrık native süreçlerin (örn. görselleştirici) yeniden başlatmadan sonra yaşamamasını sağla.
        stopVisualizer();

        app.relaunch();
        // before-quit handler'larının çalışması için nazik çıkışı tercih et.
        app.quit();
        // Güvenlik ağı: çıkışı engelleyen bir şey varsa zorla çık.
        setTimeout(() => {
            try { app.exit(0); } catch { }
        }, 900);
        return true;
    } catch (e) {
        console.error('[APP] relaunch failed:', e);
        return false;
    }
});

ipcMain.handle('app:consumePendingOpenMediaFiles', async () => {
    const payload = pendingOpenMediaFiles.slice();
    pendingOpenMediaFiles = [];
    return payload;
});

ipcMain.on('app:renderer-media-open-ready', () => {
    rendererMediaOpenReady = true;
    dispatchPendingOpenMediaFiles();
});

ipcMain.handle('app:getVersionInfo', async () => {
    const aur = getLinuxAurUpdateCapabilities();
    return {
        ...appVersionInfo,
        update: snapshotUpdateState(),
        aur
    };
});

ipcMain.handle('app:update:getState', async () => {
    return snapshotUpdateState();
});

ipcMain.handle('app:update:check', async (_event, options) => {
    const manual = options?.manual !== false;
    return checkForRuntimeUpdates({ manual });
});

ipcMain.handle('app:update:download', async () => {
    return downloadAppUpdate();
});

ipcMain.handle('app:update:install', async () => {
    return installDownloadedUpdate();
});

ipcMain.handle('app:update:launchAurivoBinUpdate', async () => {
    const result = launchAurivoBinUpdateTerminal();
    if (!result?.ok) {
        return result;
    }
    try {
        // Terminal açıldıktan sonra uygulamayı tamamen kapat.
        stopVisualizer();
    } catch {
        // yoksay
    }
    setTimeout(() => {
        try { app.quit(); } catch { }
        setTimeout(() => {
            try { app.exit(0); } catch { }
        }, 700);
    }, 220);
    return result;
});

// ============================================
// PENCERE KONTROL IPC HANDLERS
// ============================================
ipcMain.handle('window:minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
        win.minimize();
    }
    return true;
});

ipcMain.handle('window:maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
        if (win.isMaximized()) {
            win.unmaximize();
        } else {
            win.maximize();
        }
    }
    return win ? win.isMaximized() : false;
});

ipcMain.handle('window:close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
        win.close();
    }
    return true;
});

ipcMain.handle('window:isMaximized', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win ? win.isMaximized() : false;
});

ipcMain.handle('window:isFullscreen', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win ? win.isFullScreen() : false;
});

ipcMain.handle('window:setFullscreen', (event, enabled) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return false;
    win.setFullScreen(Boolean(enabled));
    return win.isFullScreen();
});

ipcMain.handle('window:toggleFullscreen', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return false;
    win.setFullScreen(!win.isFullScreen());
    return win.isFullScreen();
});

function installWebviewHardening() {
    const isLocalAppPageUrl = (rawUrl) => {
        try {
            const u = new URL(String(rawUrl || '').trim());
            if (u.protocol !== 'file:') return false;
            const decodedPath = decodeURIComponent(String(u.pathname || ''));
            const normalizedPath = process.platform === 'win32' && /^\/[A-Za-z]:/.test(decodedPath)
                ? decodedPath.slice(1)
                : decodedPath;
            const absPath = path.resolve(normalizedPath);
            const appRoots = [
                path.resolve(__dirname),
                path.resolve(app?.getAppPath?.() || '')
            ].filter(Boolean);
            return appRoots.some((root) => absPath === root || absPath.startsWith(`${root}${path.sep}`));
        } catch {
            return false;
        }
    };

    // Permission defaults: deny sensitive requests for embedded web content.
    try {
        const webSessions = getWebSessions();
        for (const ses of webSessions) {
            if (ses && typeof ses.setPermissionRequestHandler === 'function') {
                ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
                    const wcType = webContents?.getType?.();
                    const requestedPermission = String(permission || '').trim();
                    const currentUrl = String(webContents?.getURL?.() || '').trim();
                    const originUrl = String(details?.requestingOrigin || '').trim();

                    if (wcType === 'webview') {
                        // Web platformlarda (allowlist) kullanıcı akışını bozmayacak şekilde
                        // izinleri host bazlı değerlendir.
                        const trustedContext =
                            isAllowedWebUrlMain(currentUrl) ||
                            isAllowedWebUrlMain(originUrl);
                        callback(!!trustedContext);
                        return;
                    }

                    // Uygulamanın kendi local sayfaları (pulseWindow vb.) için
                    // gerçek giriş ölçümü gereken ses/video yakalama izinlerini aç.
                    const isInternalPage = isLocalAppPageUrl(currentUrl) || isLocalAppPageUrl(originUrl);
                    const isCapturePermission = requestedPermission === 'media' ||
                        requestedPermission === 'audioCapture' ||
                        requestedPermission === 'videoCapture' ||
                        requestedPermission === 'display-capture';
                    if (isInternalPage && isCapturePermission) {
                        callback(true);
                        return;
                    }

                    callback(false);
                });
            }

            // Kurumsal MITM/yerel güvenlik yazılımı olan sistemlerde Electron
            // bazen -202 (CERT_AUTHORITY_INVALID) üretip web platform çalmayı kesiyor.
            // Sadece izinli platform hostları için bu spesifik hatayı yumuşat.
            if (ses && typeof ses.setCertificateVerifyProc === 'function') {
                ses.setCertificateVerifyProc((request, callback) => {
                    try {
                        if (ALLOW_TRUSTED_CERT_BYPASS) {
                            const code = Number(request?.errorCode);
                            const host = String(request?.hostname || '').toLowerCase();
                            if (code === -202 && isTrustedWebCertHostMain(host)) {
                                callback(0); // trust
                                return;
                            }
                        }
                    } catch {
                        // fall through
                    }
                    callback(-3); // use default verification
                });
            }
        }
    } catch (e) {
        console.warn('[SECURITY] setPermissionRequestHandler failed:', e?.message || e);
    }

    // Harden all webviews created in this app.
    app.on('web-contents-created', (_event, contents) => {
        const type = contents.getType?.();
        if (type !== 'webview') return;

        // Block opening arbitrary external windows from embedded web content.
        if (typeof contents.setWindowOpenHandler === 'function') {
            contents.setWindowOpenHandler(({ url }) => {
                const popupUrl = String(url || '').trim();
                // OAuth flows often open an empty popup first, then navigate.
                if (!popupUrl || popupUrl === 'about:blank') {
                    return {
                        action: 'allow',
                        overrideBrowserWindowOptions: {
                            icon: getAppIconImage(),
                            title: 'Aurivo Medya Player',
                            autoHideMenuBar: false
                        }
                    };
                }
                if (parseHttpUrlMain(popupUrl)) {
                    return {
                        action: 'allow',
                        overrideBrowserWindowOptions: {
                            icon: getAppIconImage(),
                            title: 'Aurivo Medya Player',
                            autoHideMenuBar: false
                        }
                    };
                }
                return { action: 'deny' };
            });
        }

        contents.on('will-navigate', (event, url) => {
            // WebView içinde https/http gezinmeye izin ver; tehlikeli şemaları engelle.
            if (!parseHttpUrlMain(url)) {
                event.preventDefault();
            }
        });

        contents.on('will-redirect', (event, url) => {
            // Web platformları sıkça farklı hostlara redirect eder; yalnızca şema bazlı kısıtla.
            if (!parseHttpUrlMain(url)) {
                event.preventDefault();
            }
        });
    });
}

function installTlsCompatibilityForWebPlatforms() {
    // Bazı sistemlerde HTTPS trafiği yerel sertifika ile MITM edildiğinde
    // Electron webview'da -202 (CERT_AUTHORITY_INVALID) oluşabiliyor.
    // Yalnızca izinli web platformları için bu hatayı kontrollü şekilde bypass et.
    app.on('certificate-error', (event, _webContents, url, error, _certificate, callback) => {
        try {
            if (ALLOW_TRUSTED_CERT_BYPASS &&
                String(error || '') === 'net::ERR_CERT_AUTHORITY_INVALID' &&
                isTrustedWebCertUrlMain(url)) {
                event.preventDefault();
                callback(true);
                return;
            }
        } catch {
            // fall through
        }
        callback(false);
    });
}

app.whenReady().then(async () => {
    if (!gotSingleInstanceLock) return;
    // GPU ayarları burada uygula
    if (!isPackagedLinuxConservativeGpuMode()) {
        app.commandLine.appendSwitch('enable-gpu-rasterization');
        app.commandLine.appendSwitch('enable-zero-copy');
    } else {
        console.log('[GPU] startup conservative mode active (packaged linux)');
    }
    cleanupTransientHomeFiles('startup');

    try { installWebviewHardening(); } catch (e) { console.error('[APP] installWebviewHardening error:', e); }
    try { installTlsCompatibilityForWebPlatforms(); } catch (e) { console.error('[APP] installTlsCompatibilityForWebPlatforms error:', e); }
    try { initAutoUpdaterBridge(); } catch (e) { console.error('[APP] initAutoUpdaterBridge error:', e); }
    try { installAppMenu(); } catch (e) { console.error('[APP] installAppMenu error:', e); }
    try { registerDawlodIpc({ ipcMain, app, dialog, shell, BrowserWindow, getMainWindow: () => mainWindow }); } catch (e) { console.error('[APP] registerDawlodIpc error:', e); }
    try {
        const useAdblockExtension = shouldUseAdblockExtensionOnThisRuntime();
        if (!useAdblockExtension) {
            console.log('[AdBlocker] packaged Linux safe mode -> built-in filtering (extension disabled)');
        }
        await initAdBlocker(session, {
            app,
            webviewPartition: WEBVIEW_PARTITION,
            includeDefaultSession: true,
            preferUbol: true,
            enabled: true,
            useExtension: useAdblockExtension
        });
    } catch (e) {
        console.error('[APP] initAdBlocker error:', e);
    }
    try { scheduleAdblockConfigBackgroundSync(WEBVIEW_PARTITION); } catch (e) { console.error('[APP] scheduleAdblockConfigBackgroundSync error:', e); }
    try { startPulseBridgeServer(); } catch (e) { console.error('[APP] startPulseBridgeServer error:', e); }
    try { createWindow(); } catch (e) { console.error('[APP] createWindow error:', e); }
    try { createTray(); } catch (e) { console.error('[APP] createTray error:', e); }
    try { createMPRIS(); } catch (e) { console.error('[APP] createMPRIS error:', e); }
    try {
        setTimeout(() => {
            checkForRuntimeUpdates({ manual: false }).catch(() => {});
        }, 3200);
    } catch (e) {
        console.error('[APP] startup update check error:', e);
    }
    try { refreshGlobalMediaShortcuts(await readSettingsFileSafe()); } catch (e) { console.error('[APP] media shortcut init error:', e); }

    // Kayıtlı EQ32 presetini açılışta uygula
    try { await applyPersistedEq32SfxFromSettings(); } catch (e) { console.error('[SFX] applyPersistedEq32SfxFromSettings error:', e); }

    app.on('activate', () => {
        if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
        } else {
            createWindow();
        }
    });
}).catch((e) => {
    console.error('[APP] whenReady error:', e);
});

app.on('window-all-closed', () => {
    // Linux/Windows: kullanıcı gerçekten çıkış akışını tetiklediyse (app.isQuitting)
    // tray olsa bile uygulamayı tamamen sonlandır.
    if (process.platform !== 'darwin' && (app.isQuitting || !tray)) {
        app.quit();
    }
});

app.on('before-quit', () => {
    stopPulseBridgeServer();
    stopVisualizer();
    stopAurivoPulseListening();
    stopAurivoPulseGuiWindow();
    unregisterGlobalMediaShortcuts();
    cleanupTransientHomeFiles('before-quit');
});

// ============================================
// IPC HANDLERS
// ============================================

ipcMain.handle('pulse:openWindow', async () => {
    await migrateLegacyAurivoPulsePerformancePrefsIfNeeded();
    const launch = resolveAurivoPulseGuiLaunch();
    if (!launch?.command) {
        throw new Error('Aurivo-Pulse GUI çalıştırılabilir dosyası bulunamadı');
    }
    const nextUiLang = getUiLanguageSync();

    if (aurivoPulseGuiProc && !aurivoPulseGuiProc.killed) {
        if (aurivoPulseGuiLang === nextUiLang) {
            emitPulseGuiWindowState(true);
            return { success: true, source: 'existing-gui-process', command: launch.command };
        }
        stopAurivoPulseGuiWindow();
    }
    const attempts = [];
    const seenAttempt = new Set();
    const pushAttempt = (candidate) => {
        if (!candidate?.command) return;
        const command = String(candidate.command || '').trim();
        if (!command) return;
        const args = Array.isArray(candidate.args) ? candidate.args : [];
        const cwd = resolveSafePulseCwd(candidate.cwd || '');
        const key = `${command}__${cwd}__${args.join(' ')}`;
        if (seenAttempt.has(key)) return;
        seenAttempt.add(key);
        attempts.push({
            command,
            args,
            cwd,
            source: candidate.source || launch.source || 'unknown'
        });
    };

    pushAttempt(launch);

    const platformSubdir = process.platform === 'win32' ? 'windows' : (process.platform === 'linux' ? 'linux' : process.platform);
    const extraBins = [
        path.join(process.resourcesPath || '', 'native-dist', platformSubdir, process.platform === 'win32' ? 'aurivo-pulse.exe' : 'aurivo-pulse'),
        path.join(process.resourcesPath || '', 'native-dist', process.platform === 'win32' ? 'aurivo-pulse.exe' : 'aurivo-pulse'),
        path.join(__dirname, 'native-dist', platformSubdir, process.platform === 'win32' ? 'aurivo-pulse.exe' : 'aurivo-pulse'),
        path.join(__dirname, 'native-dist', process.platform === 'win32' ? 'aurivo-pulse.exe' : 'aurivo-pulse'),
        findExecutable(process.platform === 'win32' ? 'aurivo-pulse.exe' : 'aurivo-pulse', ['/usr/bin', '/usr/local/bin', '/bin']),
        findExecutable(process.platform === 'win32' ? 'songrec.exe' : 'songrec', ['/usr/bin', '/usr/local/bin', '/bin'])
    ].filter(Boolean);

    for (const candidateCmd of extraBins) {
        if (candidateCmd.includes(path.sep) && !isSpawnableBinary(candidateCmd)) continue;
        pushAttempt({
            command: candidateCmd,
            args: ['gui'],
            cwd: resolveSafePulseCwd(''),
            source: 'pulse-fallback'
        });
    }

    let lastError = '';
    for (const attempt of attempts) {
        let child = null;
        let startupStderr = '';
        try {
            let actualCmd = attempt.command;
            let actualArgs = attempt.args || [];

            // [KDE / Wayland Fix] KWin'in pencere açılır açılmaz anında gruplama yapabilmesi için
            // process'in argv[0]'ını zorla desktop ID'si ile başlatıyoruz (bash exec -a kullanarak).
            if (process.platform === 'linux') {
                const desktopId = process.env.FLATPAK_ID || 'com.aurivo.mediaplayer';
                actualCmd = 'bash';
                actualArgs = ['-c', `exec -a "${desktopId}" "${attempt.command}" "$@"`, '--', ...(attempt.args || [])];
            }

            child = spawn(actualCmd, actualArgs, {
                cwd: attempt.cwd,
                env: buildPulseGuiEnv(),
                detached: false,
                stdio: ['ignore', 'pipe', 'pipe']
            });
        } catch (spawnError) {
            lastError = `spawn ${attempt.command} failed: ${spawnError?.message || spawnError}`;
            continue;
        }

        aurivoPulseGuiProc = child;
        aurivoPulseGuiLang = nextUiLang;
        emitPulseGuiWindowState(true);
        child.stderr?.on('data', (chunk) => {
            startupStderr += String(chunk || '');
            if (startupStderr.length > 4000) {
                startupStderr = startupStderr.slice(-4000);
            }
        });
        child.stdout?.on('data', () => { /* başlangıçta sadece alive kontrolü için pipe açık */ });

        const startupResult = await new Promise((resolve) => {
            let settled = false;
            const settle = (payload) => {
                if (settled) return;
                settled = true;
                resolve(payload);
            };
            const timer = setTimeout(() => settle({ ok: true }), 1400);
            child.once('error', (err) => {
                clearTimeout(timer);
                settle({ ok: false, error: err?.message || String(err || 'spawn error') });
            });
            child.once('close', (code) => {
                clearTimeout(timer);
                settle({
                    ok: false,
                    error: `Aurivo-Pulse erken kapandı (exit code ${code ?? 'unknown'})`
                });
            });
        });

        if (!startupResult?.ok) {
            if (aurivoPulseGuiProc === child) {
                aurivoPulseGuiProc = null;
                aurivoPulseGuiLang = '';
                emitPulseGuiWindowState(false);
            }
            const stderrShort = String(startupStderr || '').trim();
            const extra = stderrShort ? ` | stderr: ${stderrShort.split('\n').slice(-2).join(' ')}` : '';
            lastError = `${startupResult?.error || 'Aurivo-Pulse GUI başlatılamadı'}${extra}`;
            continue;
        }

        child.once('close', () => {
            if (aurivoPulseGuiProc === child) {
                aurivoPulseGuiProc = null;
                aurivoPulseGuiLang = '';
                emitPulseGuiWindowState(false);
            }
        });
        child.once('error', () => {
            if (aurivoPulseGuiProc === child) {
                aurivoPulseGuiProc = null;
                aurivoPulseGuiLang = '';
                emitPulseGuiWindowState(false);
            }
        });

        // Linux'ta ayrı uygulama gibi görünmeyi azaltmak için pencere hintlerini uygula.
        applyPulseLinuxWindowHints(child.pid);
        return { success: true, source: attempt.source, command: attempt.command };
    }

    const fallback = startAurivoPulseListening({
        backgroundMode: true,
        profile: 'background'
    });
    if (fallback?.success) {
        return {
            success: true,
            source: 'aurivo-pulse-cli-fallback',
            command: fallback.command || '',
            degraded: true
        };
    }

    throw new Error(lastError || 'Aurivo-Pulse GUI başlatılamadı');
});

ipcMain.handle('pulse:getWindowState', async () => {
    const guiOpen = !!(aurivoPulseGuiProc && !aurivoPulseGuiProc.killed);
    const listenOpen = !!aurivoPulseStatus?.running;
    return {
        open: guiOpen || listenOpen,
        mode: guiOpen ? 'gui' : (listenOpen ? 'listen' : 'none')
    };
});

ipcMain.handle('pulse:listDevices', async () => {
    return await listAurivoPulseDevices();
});

ipcMain.handle('pulse:getStatus', async () => {
    return { success: true, status: { ...aurivoPulseStatus } };
});

ipcMain.handle('pulse:getPreferredDevice', async () => {
    return getAurivoPulsePreferredDevice();
});

ipcMain.handle('pulse:getPreferences', async () => {
    return readAurivoPulsePreferences();
});

ipcMain.handle('pulse:savePreferences', async (_event, update) => {
    try {
        return await saveAurivoPulsePreferences(update);
    } catch (error) {
        console.error('[PULSE] save preferences error:', error);
        return { success: false, error: error?.message || String(error) };
    }
});

ipcMain.handle('pulse:startListening', async (_event, options) => {
    const next = (options && typeof options === 'object') ? { ...options } : {};
    const chosenDevice = String(next.audioDevice || '').trim();
    if (!chosenDevice) {
        try {
            const pref = await getAurivoPulsePreferredDevice();
            const prefId = String(pref?.audioDevice || '').trim();
            if (prefId) {
                next.audioDevice = prefId;
                console.log('[PULSE] startListening auto device: preferred', prefId);
            } else {
                const listed = await listAurivoPulseDevices();
                const autoPick = pickPreferredMonitorDeviceId(listed?.devices || []);
                if (autoPick) {
                    next.audioDevice = autoPick;
                    console.log('[PULSE] startListening auto device: monitor', autoPick);
                }
            }
        } catch (e) {
            console.warn('[PULSE] auto monitor pick failed:', e?.message || e);
        }
    }
    return startAurivoPulseListening(next);
});

ipcMain.handle('pulse:stopListening', async () => {
    return stopAurivoPulseListening();
});

ipcMain.handle('pulse:recognizeSample', async (_event, options) => {
    return captureMonitorSampleAndRecognizeWithPulse(options || {});
});

// Dosya/Klasör Seçimi
ipcMain.handle('dialog:openFile', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile', 'multiSelections'],
        filters: [
            { name: tMainSync('dialog.filters.audioFiles'), extensions: ['mp3', 'wav', 'flac', 'm4a', 'ogg', 'aac', 'wma', 'opus', 'aiff'] },
            { name: tMainSync('dialog.filters.videoFiles'), extensions: ['mp4', 'mkv', 'webm', 'avi', 'mov', 'wmv', 'm4v'] },
            { name: tMainSync('dialog.filters.allFiles'), extensions: ['*'] }
        ]
    });
    return result.filePaths;
});

ipcMain.handle('dialog:openFolder', async (_event, opts) => {
    const title = (opts && typeof opts === 'object' && opts.title) ? String(opts.title) : tMainSync('dialog.selectMusicFolder');
    const defaultPath = (opts && typeof opts === 'object' && opts.defaultPath) ? String(opts.defaultPath) : undefined;
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title,
        defaultPath
    });

    if (result.canceled || result.filePaths.length === 0) {
        return null;
    }

    const folderPath = result.filePaths[0];
    const folderName = path.basename(folderPath);

    return {
        path: folderPath,
        name: folderName
    };
});

// Dosyaları seçme dialog'u (müzik/video gibi farklı filtreler için kullanılabilir)
// Geriye uyumluluk:
// - openFiles(filtersArray)
// - openFiles({ title, filters })
ipcMain.handle('dialog:openFiles', async (event, filtersOrOpts) => {
    const opts = (filtersOrOpts && typeof filtersOrOpts === 'object' && !Array.isArray(filtersOrOpts))
        ? filtersOrOpts
        : { filters: filtersOrOpts };

    const title = (opts && typeof opts.title === 'string' && opts.title.trim())
        ? opts.title.trim()
        : tMainSync('dialog.selectMusicFiles');

    const filters = opts?.filters;

    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile', 'multiSelections'],
        title,
        filters: filters || [
            { name: tMainSync('dialog.filters.musicFiles'), extensions: ['mp3', 'flac', 'wav', 'ogg', 'm4a', 'aac', 'wma', 'opus', 'ape', 'wv'] },
            { name: tMainSync('dialog.filters.allFiles'), extensions: ['*'] }
        ]
    });

    if (result.canceled || result.filePaths.length === 0) {
        return null;
    }

    return result.filePaths.map(filePath => ({
        path: filePath,
        name: path.basename(filePath)
    }));
});

ipcMain.handle('dialog:confirm', async (event, opts) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender)
        || (settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : null)
        || (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null);
    const title = (opts && typeof opts.title === 'string' && opts.title.trim())
        ? opts.title.trim()
        : app.getName();
    const message = (opts && typeof opts.message === 'string' && opts.message.trim())
        ? opts.message.trim()
        : title;
    const detail = (opts && typeof opts.detail === 'string')
        ? opts.detail
        : '';
    const okLabel = (opts && typeof opts.okLabel === 'string' && opts.okLabel.trim())
        ? opts.okLabel.trim()
        : 'Tamam';
    const cancelLabel = (opts && typeof opts.cancelLabel === 'string' && opts.cancelLabel.trim())
        ? opts.cancelLabel.trim()
        : 'İptal';

    const result = await dialog.showMessageBox(parentWindow, {
        type: 'question',
        buttons: [okLabel, cancelLabel],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        title,
        message,
        detail
    });

    return result.response === 0;
});

ipcMain.handle('dialog:saveFile', async (_event, opts) => {
    const title = (opts && typeof opts === 'object' && opts.title) ? String(opts.title) : 'Save file';
    const defaultPath = (opts && typeof opts === 'object' && opts.defaultPath) ? String(opts.defaultPath) : undefined;
    const filters = Array.isArray(opts?.filters) ? opts.filters : undefined;
    const result = await dialog.showSaveDialog(mainWindow, {
        title,
        defaultPath,
        filters
    });
    if (result.canceled || !result.filePath) return null;
    return {
        path: result.filePath,
        name: path.basename(result.filePath)
    };
});

// ============================================================
// WEB GÜVENLİĞİ / GİZLİLİK
// ============================================================
ipcMain.handle('web:openExternal', async (_event, url) => {
    const u = String(url || '').trim();
    if (!u) return false;
    if (!isAllowedWebUrlMain(u)) return false;
    try {
        await shell.openExternal(u);
        return true;
    } catch (e) {
        console.error('[WEB] openExternal error:', e);
        return false;
    }
});

function detectVpnInterfaces() {
    try {
        const ifaces = os.networkInterfaces() || {};
        const suspiciousName = /(wintun|wireguard|openvpn|tap|tun|ppp|pptp|l2tp|ikev2|zerotier|tailscale|hamachi)/i;
        const hits = [];
        for (const [name, entries] of Object.entries(ifaces)) {
            const n = String(name || '');
            const hasNet = Array.isArray(entries) && entries.some((e) => e && e.internal === false);
            if (hasNet && suspiciousName.test(n)) hits.push(n);
        }
        return { detected: hits.length > 0, interfaces: hits };
    } catch {
        return { detected: false, interfaces: [] };
    }
}

ipcMain.handle('web:getSecurityState', async () => {
    const vpn = detectVpnInterfaces();
    return { vpnDetected: vpn.detected, vpnInterfaces: vpn.interfaces };
});

// ─── Ad Blocker IPC ────────────────────────────────────────────────────
ipcMain.handle('adblock:getStats', () => {
    try { return getAdBlockerStats(); } catch { return null; }
});

ipcMain.handle('adblock:allowDomain', (_event, domain) => {
    try { allowDomain(domain); return true; } catch { return false; }
});

ipcMain.handle('adblock:getConfig', () => {
    try { return getAdBlockerConfig(); } catch { return null; }
});

ipcMain.handle('adblock:setConfig', (_event, config) => {
    try {
        const next = setAdBlockerConfig(config || {});
        if (adblockDashboardWindow && !adblockDashboardWindow.isDestroyed()) {
            syncAdblockConfigToDashboard(adblockDashboardWindow).catch(() => {});
            ensureAdblockDefaultFilteringDetails(adblockDashboardWindow).catch(() => {});
        } else {
            scheduleAdblockConfigBackgroundSync();
        }
        return next;
    } catch { return null; }
});

function mapUiLangToAdblockLocale(uiLang = '') {
    const normalized = normalizeUiLang(uiLang) || 'en-US';
    const lower = normalized.toLowerCase();
    if (lower.startsWith('pt-br')) return 'pt_BR';
    if (lower.startsWith('zh-cn')) return 'zh_CN';
    if (lower.startsWith('zh-tw')) return 'zh_TW';
    const base = lower.split('-')[0];
    return base || 'en';
}

function getAdblockSavedToastText(uiLang = '') {
    const normalized = normalizeUiLang(uiLang) || 'en-US';
    const base = String(normalized).split('-')[0].toLowerCase();
    if (base === 'tr') return 'Kaydedildi';
    if (base === 'ar') return 'تم الحفظ';
    if (base === 'fr') return 'Enregistre';
    if (base === 'es') return 'Guardado';
    if (base === 'de') return 'Gespeichert';
    if (base === 'ru') return 'Сохранено';
    if (base === 'zh') return '已保存';
    return 'Saved';
}

function mapAdblockModeToUbolLevel(mode = '') {
    const normalized = String(mode || '').trim().toLowerCase();
    if (normalized === 'basic') return 1;
    if (normalized === 'aggressive') return 3;
    return 2;
}

function mapUbolLevelToAdblockMode(level) {
    const n = Number(level);
    if (n === 1) return 'basic';
    if (n === 3) return 'aggressive';
    return 'ideal';
}

async function updateAdblockSettingsInFile(patch = {}) {
    try {
        let current = {};
        try {
            const data = await fs.promises.readFile(getSettingsPath(), 'utf8');
            current = JSON.parse(data);
        } catch {
            current = {};
        }

        const next = { ...(current || {}) };
        next.adblock = { ...(next.adblock || {}) };
        Object.assign(next.adblock, patch || {});

        const sanitized = sanitizeSensitiveSettings(next);
        await writeJsonFileAtomic(getSettingsPath(), sanitized);

        for (const targetWindow of [mainWindow, settingsWindow, soundEffectsWindow]) {
            if (!targetWindow || targetWindow.isDestroyed()) continue;
            try {
                targetWindow.webContents.send('settings:reloaded', sanitized);
            } catch {
                // yoksay
            }
        }

        return sanitized;
    } catch (e) {
        console.error('[ADBLOCK] settings file update error:', e);
        return null;
    }
}

async function readAdblockStateFromDashboard(win) {
    try {
        if (!win || win.isDestroyed()) {
            return {
                mode: '',
                autoReload: undefined,
                showBlockedCount: undefined,
                strictBlock: undefined,
                developerMode: undefined,
            };
        }
        const state = await win.webContents.executeJavaScript(`
            (async () => {
                const out = {};
                try {
                    const normalize = (v) => {
                        const n = Number(v);
                        if (n === 1) return 'basic';
                        if (n === 3) return 'aggressive';
                        return 'ideal';
                    };

                    try {
                        const options = await chrome.runtime.sendMessage({ what: 'getOptionsPageData' });
                        if (options && typeof options === 'object') {
                            if (typeof options.defaultFilteringMode !== 'undefined') {
                                out.mode = normalize(options.defaultFilteringMode);
                            }
                            if (typeof options.autoReload === 'boolean') {
                                out.autoReload = options.autoReload;
                            }
                            if (typeof options.showBlockedCount === 'boolean') {
                                out.showBlockedCount = options.showBlockedCount;
                            }
                            if (typeof options.strictBlockMode === 'boolean') {
                                out.strictBlock = options.strictBlockMode;
                            }
                            if (typeof options.developerMode === 'boolean') {
                                out.developerMode = options.developerMode;
                            }
                        }
                    } catch {}

                    try {
                        const levelRes = await chrome.runtime.sendMessage({ what: 'getDefaultFilteringMode' });
                        if (typeof levelRes === 'number') out.mode = normalize(levelRes);
                        if (levelRes && typeof levelRes === 'object' && typeof levelRes.level !== 'undefined') {
                            out.mode = normalize(levelRes.level);
                        }
                    } catch {}

                    try {
                        const modes = await chrome.runtime.sendMessage({ what: 'getFilteringModeDetails' });
                        if (modes && typeof modes === 'object') {
                            const hasAll = (arr) => Array.isArray(arr) && arr.includes('all-urls');
                            if (hasAll(modes.complete)) out.mode = 'aggressive';
                            else if (hasAll(modes.basic)) out.mode = 'basic';
                            else out.mode = 'ideal';
                        }
                    } catch {}
                } catch {}
                return out;
            })();
        `, true);

        const next = (state && typeof state === 'object') ? state : {};
        const normalizedMode = String(next.mode || '').trim().toLowerCase();
        return {
            mode: (normalizedMode === 'basic' || normalizedMode === 'ideal' || normalizedMode === 'aggressive')
                ? normalizedMode
                : '',
            autoReload: typeof next.autoReload === 'boolean' ? next.autoReload : undefined,
            showBlockedCount: typeof next.showBlockedCount === 'boolean' ? next.showBlockedCount : undefined,
            strictBlock: typeof next.strictBlock === 'boolean' ? next.strictBlock : undefined,
            developerMode: typeof next.developerMode === 'boolean' ? next.developerMode : undefined,
        };
    } catch {
        return {
            mode: '',
            autoReload: undefined,
            showBlockedCount: undefined,
            strictBlock: undefined,
            developerMode: undefined,
        };
    }
}

async function syncAdblockStateFromDashboardToApp(win) {
    const dashboardState = await readAdblockStateFromDashboard(win);
    if (!dashboardState || typeof dashboardState !== 'object') return false;

    const currentCfg = getAdBlockerConfig?.() || {};
    const currentMode = String(currentCfg.mode || '').trim().toLowerCase();
    const patch = {};

    if (dashboardState.mode && currentMode !== dashboardState.mode) {
        patch.mode = dashboardState.mode;
    }
    if (typeof dashboardState.autoReload === 'boolean' && !!currentCfg.autoReload !== dashboardState.autoReload) {
        patch.autoReload = dashboardState.autoReload;
    }
    if (typeof dashboardState.showBlockedCount === 'boolean' && !!currentCfg.showBlockedCount !== dashboardState.showBlockedCount) {
        patch.showBlockedCount = dashboardState.showBlockedCount;
    }
    if (typeof dashboardState.strictBlock === 'boolean' && !!currentCfg.strictBlock !== dashboardState.strictBlock) {
        patch.strictBlock = dashboardState.strictBlock;
    }
    if (typeof dashboardState.developerMode === 'boolean' && !!currentCfg.developerMode !== dashboardState.developerMode) {
        patch.developerMode = dashboardState.developerMode;
    }

    if (Object.keys(patch).length === 0) return true;

    const updatedCfg = setAdBlockerConfig(patch) || {};
    await updateAdblockSettingsInFile({
        mode: String(updatedCfg.mode || dashboardState.mode || currentMode || 'ideal'),
        showBlockedCount: !!updatedCfg.showBlockedCount,
        autoRefreshOnModeChange: !!updatedCfg.autoReload,
        strictBlock: !!updatedCfg.strictBlock,
        developerMode: !!updatedCfg.developerMode
    });

    try {
        if (win && !win.isDestroyed()) {
            await win.webContents.executeJavaScript(`
                try {
                    if (typeof window.__aurivoShowSavedToast === 'function') {
                        window.__aurivoShowSavedToast();
                    }
                } catch {}
            `, true);
        }
    } catch {
        // yoksay
    }
    return true;
}

async function syncAdblockConfigToDashboard(win) {
    try {
        if (!win || win.isDestroyed()) return;
        const cfg = getAdBlockerConfig?.() || {};
        const modeLevel = mapAdblockModeToUbolLevel(cfg.mode);
        const payload = {
            autoReload: !!cfg.autoReload,
            showBlockedCount: !!cfg.showBlockedCount,
            strictBlock: !!cfg.strictBlock,
            developerMode: !!cfg.developerMode,
            modeLevel
        };
        await win.webContents.executeJavaScript(`
            try {
                const send = (what, state) => {
                    try { chrome.runtime.sendMessage({ what, state }); } catch {}
                };
                const cfg = ${JSON.stringify(payload)};
                try {
                    chrome.runtime.sendMessage({ what: 'setDefaultFilteringMode', level: Number(cfg.modeLevel) || 2 });
                } catch {}
                send('setAutoReload', cfg.autoReload);
                send('setShowBlockedCount', cfg.showBlockedCount);
                // Bazı uBOL sürümlerinde anahtar adları farklı olabiliyor; tüm olası setter'ları dene.
                send('setStrictBlockMode', cfg.strictBlock);
                send('setStrictBlock', cfg.strictBlock);
                send('setDeveloperMode', cfg.developerMode);

                // Dashboard UI fallback: runtime message desteklenmese bile checkbox durumunu eşitle.
                const setCheckbox = (selector, checked) => {
                    try {
                        const el = document.querySelector(selector);
                        if (!el) return;
                        if (!!el.checked === !!checked) return;
                        el.checked = !!checked;
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                    } catch {}
                };
                setCheckbox('#strictBlockMode', !!cfg.strictBlock);
                setCheckbox('#developerMode', !!cfg.developerMode);
            } catch {}
        `, true);
    } catch {
        // yoksay
    }
}

async function ensureAdblockDefaultFilteringDetails(win) {
    try {
        if (!win || win.isDestroyed()) return;
        await win.webContents.executeJavaScript(`
            (async () => {
                try {
                    const defaults = ${JSON.stringify(AURIVO_ADBLOCK_DEFAULT_COMPLETE_HOSTS)};
                    const getModes = async () => {
                        try {
                            return await chrome.runtime.sendMessage({ what: 'getFilteringModeDetails' });
                        } catch {
                            return null;
                        }
                    };
                    const setModes = async (modes) => {
                        try {
                            return await chrome.runtime.sendMessage({ what: 'setFilteringModeDetails', modes });
                        } catch {
                            return null;
                        }
                    };

                    const modes = await getModes();
                    if (!modes || typeof modes !== 'object') return;

                    const next = {
                        none: Array.isArray(modes.none) ? Array.from(new Set(modes.none.map(v => String(v || '').trim()).filter(Boolean))) : [],
                        basic: Array.isArray(modes.basic) ? Array.from(new Set(modes.basic.map(v => String(v || '').trim()).filter(Boolean))) : [],
                        optimal: Array.isArray(modes.optimal) ? Array.from(new Set(modes.optimal.map(v => String(v || '').trim()).filter(Boolean))) : [],
                        complete: Array.isArray(modes.complete) ? Array.from(new Set(modes.complete.map(v => String(v || '').trim()).filter(Boolean))) : [],
                    };

                    let changed = false;
                    const completeSet = new Set(next.complete);
                    for (const host of defaults) {
                        if (!completeSet.has(host)) {
                            completeSet.add(host);
                            changed = true;
                        }
                    }
                    next.complete = Array.from(completeSet);

                    if (changed) {
                        await setModes(next);
                        try {
                            const bc = new BroadcastChannel('uBOL');
                            bc.postMessage({ filteringModeDetails: next });
                            bc.close();
                        } catch {}
                    }
                } catch {}
            })();
        `, true);
    } catch {
        // yoksay
    }
}

function startAdblockDashboardAutoSync(win) {
    try {
        if (adblockDashboardAutoSyncTimer) {
            clearInterval(adblockDashboardAutoSyncTimer);
            adblockDashboardAutoSyncTimer = null;
        }
    } catch {
        // yoksay
    }

    if (!win || win.isDestroyed()) return;

    adblockDashboardAutoSyncTimer = setInterval(() => {
        syncAdblockStateFromDashboardToApp(win).catch(() => {});
    }, 1200);
}

function stopAdblockDashboardAutoSync() {
    try {
        if (adblockDashboardAutoSyncTimer) {
            clearInterval(adblockDashboardAutoSyncTimer);
            adblockDashboardAutoSyncTimer = null;
        }
    } catch {
        // yoksay
    }
}

async function applyAdblockDashboardBranding(win, uiLang = 'en-US') {
    try {
        if (!win || win.isDestroyed()) return;
        win.setTitle('Aurivo');
        const targetLocale = mapUiLangToAdblockLocale(uiLang);
        const savedToastText = getAdblockSavedToastText(uiLang);
        await win.webContents.executeJavaScript(`
            try {
                document.title = 'Aurivo';
                document.documentElement.lang = ${JSON.stringify(targetLocale)}.replace('_', '-');

                const applyLocale = async () => {
                    const pickMessage = (messages, key) => {
                        const entry = messages?.[key];
                        return entry && typeof entry.message === 'string' ? entry.message : '';
                    };
                    const applyMessages = (messages) => {
                        if (!messages || typeof messages !== 'object') return;
                        const setPreservedText = (el, msg) => {
                            if (!el || typeof msg !== 'string' || !msg) return;
                            const hasStructuredChildren = el.childElementCount > 0;
                            if (!hasStructuredChildren) {
                                el.textContent = msg;
                                return;
                            }
                            const textNodes = Array.from(el.childNodes || []).filter((n) => n && n.nodeType === Node.TEXT_NODE);
                            if (textNodes.length) {
                                textNodes[textNodes.length - 1].textContent = msg;
                                return;
                            }
                            el.appendChild(document.createTextNode(msg));
                        };
                        for (const el of document.querySelectorAll('[data-i18n]')) {
                            const key = el.getAttribute('data-i18n');
                            const msg = pickMessage(messages, key);
                            if (msg) setPreservedText(el, msg);
                        }
                        for (const el of document.querySelectorAll('[data-i18n-title]')) {
                            const key = el.getAttribute('data-i18n-title');
                            const msg = pickMessage(messages, key);
                            if (msg) el.setAttribute('title', msg);
                        }
                        for (const el of document.querySelectorAll('[data-i18n-label]')) {
                            const key = el.getAttribute('data-i18n-label');
                            const msg = pickMessage(messages, key);
                            if (msg) el.setAttribute('label', msg);
                        }
                        for (const el of document.querySelectorAll('[placeholder]')) {
                            const key = String(el.getAttribute('placeholder') || '').trim();
                            const msg = pickMessage(messages, key);
                            if (msg) el.setAttribute('placeholder', msg);
                        }
                    };
                    const loadMessages = async (locale) => {
                        try {
                            const url = chrome?.runtime?.getURL?.('_locales/' + locale + '/messages.json');
                            if (!url) return null;
                            const res = await fetch(url);
                            if (!res.ok) return null;
                            return await res.json();
                        } catch {
                            return null;
                        }
                    };

                    const primary = await loadMessages(${JSON.stringify(targetLocale)});
                    const fallback = await loadMessages('en');
                    applyMessages(primary || fallback);
                };
                applyLocale().catch(() => {});

                if (!document.getElementById('aurivo-dashboard-premium-style')) {
                    const style = document.createElement('style');
                    style.id = 'aurivo-dashboard-premium-style';
                    style.textContent = \`
                        :root {
                            --aurivo-accent: #31d0ff;
                            --aurivo-accent-2: #4ef0b7;
                            --aurivo-bg-1: #000000;
                            --aurivo-bg-2: #000000;
                            --aurivo-card: rgba(0, 0, 0, 0.92);
                        }
                        html, body {
                            background: #000000 !important;
                            color: #e9f6ff !important;
                        }
                        body {
                            align-items: stretch !important;
                            padding-inline: 12px !important;
                        }
                        body > *,
                        body > section,
                        body > header,
                        body [data-pane-related] {
                            width: 100% !important;
                            max-width: none !important;
                        }
                        section[data-pane] {
                            padding-inline: 2px !important;
                        }
                        .body, .pane, .card, .panel, .box, section, main {
                            border-radius: 14px !important;
                        }
                        .card, .panel, .box, section {
                            background: var(--aurivo-card) !important;
                            border: 1px solid rgba(103, 182, 255, 0.25) !important;
                            box-shadow: 0 12px 30px rgba(0, 0, 0, 0.28) !important;
                            backdrop-filter: none !important;
                        }
                        button, .button, input, select {
                            border-radius: 10px !important;
                        }
                        .active, [aria-selected="true"], [aria-checked="true"], [data-selected="true"] {
                            outline-color: var(--aurivo-accent) !important;
                            border-color: var(--aurivo-accent) !important;
                            box-shadow: 0 0 0 1px rgba(49, 208, 255, 0.28), 0 0 0 6px rgba(49, 208, 255, 0.08) !important;
                        }
                        a, .link {
                            color: #7fe6ff !important;
                        }
                        #dashboard-nav .logo {
                            display: inline-flex;
                            align-items: center;
                            justify-content: center;
                            width: 30px;
                            height: 30px;
                            margin-inline-end: 6px;
                            border-radius: 8px;
                            background: linear-gradient(145deg, rgba(49,208,255,0.24), rgba(78,240,183,0.14));
                            border: 1px solid rgba(109, 218, 255, 0.35);
                            box-shadow: 0 6px 18px rgba(5, 13, 33, 0.45);
                        }
                        #aurivo-logo-shield {
                            font-size: 15px;
                            line-height: 1;
                            filter: drop-shadow(0 0 6px rgba(49,208,255,0.55));
                        }
                        #aurivo-save-toast {
                            position: fixed;
                            left: 50%;
                            bottom: max(80px, env(safe-area-inset-bottom, 0px) + 16px);
                            z-index: 2147483647;
                            display: inline-flex;
                            align-items: center;
                            justify-content: center;
                            padding: 7px 11px;
                            min-height: 32px;
                            max-width: min(92vw, 520px);
                            border-radius: 9px;
                            border: 1px solid rgba(76, 234, 185, 0.55);
                            background: rgba(5, 16, 28, 0.92);
                            color: #d8fff2;
                            font-size: 12px;
                            font-weight: 700;
                            letter-spacing: 0.01em;
                            white-space: nowrap;
                            text-overflow: ellipsis;
                            overflow: hidden;
                            opacity: 0;
                            transform: translate(-50%, 6px);
                            pointer-events: none;
                            transition: opacity .15s ease, transform .15s ease;
                            box-shadow: 0 10px 24px rgba(0,0,0,0.4);
                        }
                        #aurivo-save-toast.show {
                            opacity: 1;
                            transform: translate(-50%, 0);
                        }
                    \`;
                    document.head.appendChild(style);
                }
                if (!window.__aurivoSaveToastInit) {
                    window.__aurivoSaveToastInit = true;
                    window.__aurivoShowSavedToast = () => {
                        try {
                            let el = document.getElementById('aurivo-save-toast');
                            if (!el) {
                                el = document.createElement('div');
                                el.id = 'aurivo-save-toast';
                                (document.documentElement || document.body).appendChild(el);
                            }
                            el.textContent = window.__aurivoSaveToastText || 'Saved';
                            el.classList.add('show');
                            clearTimeout(window.__aurivoSaveToastTimer);
                            window.__aurivoSaveToastTimer = setTimeout(() => {
                                try { el.classList.remove('show'); } catch {}
                            }, 1100);
                        } catch {}
                    };
                    const onUiMutate = (event) => {
                        try {
                            const target = event && event.target;
                            if (!target || !(target instanceof Element)) return;
                            if (target.closest('#defaultFilteringMode, #autoReload, #showBlockedCount, #strictBlockMode, #developerMode')) {
                                if (typeof window.__aurivoShowSavedToast === 'function') {
                                    window.__aurivoShowSavedToast();
                                }
                            }
                        } catch {}
                    };
                    document.addEventListener('change', onUiMutate, true);
                }
                window.__aurivoSaveToastText = ${JSON.stringify(savedToastText)};
                const logo = document.querySelector('#dashboard-nav .logo');
                if (logo && !logo.querySelector('#aurivo-logo-shield')) {
                    const shield = document.createElement('span');
                    shield.id = 'aurivo-logo-shield';
                    shield.setAttribute('aria-hidden', 'true');
                    shield.textContent = '🛡';
                    if (typeof logo.replaceChildren === 'function') logo.replaceChildren(shield);
                    else {
                        while (logo.firstChild) logo.removeChild(logo.firstChild);
                        logo.appendChild(shield);
                    }
                    logo.setAttribute('title', 'Aurivo');
                }
                const brandTargets = Array.from(document.querySelectorAll('h1, h2, .title, .brand, [data-i18n], [data-l10n-id]'));
                for (const el of brandTargets) {
                    if (!el || typeof el.textContent !== 'string') continue;
                    if (/uBO\\s*Lite/i.test(el.textContent)) {
                        el.textContent = el.textContent.replace(/uBO\\s*Lite/gi, 'Aurivo');
                    }
                }
            } catch {}
        `, true);
    } catch {
        // dashboard CSP/içerik kısıtları nedeniyle başarısız olabilir; en azından pencere başlığı set edilir.
    }
}

async function ensureAdblockDashboardVisibleContent(win) {
    try {
        if (!win || win.isDestroyed()) return;
        const wc = win.webContents;
        if (!wc || wc.isDestroyed()) return;
        const currentUrl = String(wc.getURL() || '');
        if (!/\/dashboard\.html(?:[#?]|$)/i.test(currentUrl)) return;
        const probe = await wc.executeJavaScript(`
            (() => {
                try {
                    const hasDashboardUi = !!document.querySelector(
                        '#dashboard-nav, #defaultFilteringMode, .filteringModeCard, .dashboard'
                    );
                    const hasPopupUi = !!document.querySelector(
                        '#moreButton, .popupPanel, .filteringModeSlider'
                    );
                    const textLen = String(document.body?.innerText || '').trim().length;
                    return { hasDashboardUi, hasPopupUi, textLen };
                } catch {
                    return { hasDashboardUi: false, hasPopupUi: false, textLen: 0 };
                }
            })();
        `, true);
        const hasUi = !!(probe && (probe.hasDashboardUi || probe.hasPopupUi));
        const textLen = Number(probe?.textLen || 0);
        if (!hasUi && textLen === 0) {
            const fallbackUrl = currentUrl.replace('/dashboard.html', '/popup.html');
            await wc.loadURL(fallbackUrl);
        }
    } catch {
        // yoksay
    }
}

async function waitForAdblockDashboardUiReady(win, timeoutMs = 2500) {
    const startedAt = Date.now();
    while ((Date.now() - startedAt) < timeoutMs) {
        try {
            if (!win || win.isDestroyed()) return false;
            const wc = win.webContents;
            if (!wc || wc.isDestroyed()) return false;
            const probe = await wc.executeJavaScript(`
                (() => {
                    try {
                        const hasDashboardUi = !!document.querySelector(
                            '#dashboard-nav, #defaultFilteringMode, .filteringModeCard, .dashboard'
                        );
                        const hasPopupUi = !!document.querySelector(
                            '#moreButton, .popupPanel, .filteringModeSlider'
                        );
                        const textLen = String(document.body?.innerText || '').trim().length;
                        return { hasDashboardUi, hasPopupUi, textLen };
                    } catch {
                        return { hasDashboardUi: false, hasPopupUi: false, textLen: 0 };
                    }
                })();
            `, true);
            if (probe?.hasDashboardUi || probe?.hasPopupUi || Number(probe?.textLen || 0) > 0) {
                return true;
            }
        } catch {
            // yoksay
        }
        await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return false;
}

function resolveAdblockDashboardUrlFallback(preferredPartition = '') {
    const getSessionExtensionsApiMain = (ses) => {
        return (ses && typeof ses === 'object' && ses.extensions && typeof ses.extensions === 'object')
            ? ses.extensions
            : null;
    };
    const getAllExtensionsMain = (ses) => {
        const extApi = getSessionExtensionsApiMain(ses);
        if (extApi && typeof extApi.getAllExtensions === 'function') {
            return extApi.getAllExtensions();
        }
        if (ses && typeof ses.getAllExtensions === 'function') {
            return ses.getAllExtensions();
        }
        return {};
    };

    const pickFromSession = (ses, partitionLabel = '') => {
        try {
            if (!ses) return { url: '', partition: '' };
            const all = getAllExtensionsMain(ses);
            const list = Array.isArray(all) ? all : Object.values(all || {});
            const ext = list.find((item) => /uBlock(?:\s+Origin)?\s+Lite|uBO\s+Lite/i.test(String(item?.name || '')));
            const extId = String(ext?.id || '').trim();
            if (!extId) return { url: '', partition: '' };
            return { url: `chrome-extension://${extId}/dashboard.html`, partition: String(partitionLabel || '') };
        } catch {
            return { url: '', partition: '' };
        }
    };

    if (preferredPartition) {
        try {
            const byPreferred = pickFromSession(session.fromPartition(preferredPartition), preferredPartition);
            if (byPreferred.url) return byPreferred;
        } catch {
            // yoksay
        }
    }
    try {
        const byWebview = pickFromSession(session.fromPartition(WEBVIEW_PARTITION), WEBVIEW_PARTITION);
        if (byWebview.url) return byWebview;
    } catch {
        // yoksay
    }
    try {
        const byDefault = pickFromSession(session.defaultSession, '');
        if (byDefault.url) return byDefault;
    } catch {
        // yoksay
    }
    const extensionPath = resolveBundledUbolExtensionPathForDashboard();
    const dashboardFile = extensionPath ? path.join(extensionPath, 'dashboard.html') : '';
    if (dashboardFile && fs.existsSync(dashboardFile)) {
        return { url: `file://${dashboardFile}`, partition: '' };
    }
    return { url: '', partition: preferredPartition || WEBVIEW_PARTITION };
}

function resolveBundledUbolExtensionPathForDashboard() {
    const roots = [
        path.join(process.resourcesPath || '', 'uDALİ-weman-home', 'chromium'),
        path.join(process.resourcesPath || '', 'app.asar.unpacked', 'uDALİ-weman-home', 'chromium'),
        path.join(__dirname, 'uDALİ-weman-home', 'chromium'),
        path.join(__dirname, '..', 'uDALİ-weman-home', 'chromium'),
    ];

    for (const candidate of roots) {
        if (!candidate) continue;
        if (!isRealDirectory(candidate)) continue;
        if (fs.existsSync(path.join(candidate, 'manifest.json'))) {
            return candidate;
        }
    }

    const scanRoots = [
        process.resourcesPath || '',
        path.join(process.resourcesPath || '', 'app.asar.unpacked'),
        __dirname
    ].filter(Boolean);
    for (const root of scanRoots) {
        if (!isRealDirectory(root)) continue;
        try {
            const entries = fs.readdirSync(root, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry?.isDirectory?.()) continue;
                const name = String(entry.name || '').toLowerCase();
                if (!name.includes('weman-home')) continue;
                const candidate = path.join(root, entry.name, 'chromium');
                if (isRealDirectory(candidate) && fs.existsSync(path.join(candidate, 'manifest.json'))) {
                    return candidate;
                }
            }
        } catch {
            // yoksay
        }
    }
    return '';
}

async function ensureAdblockDashboardLaunchInfo(preferredPartition = '') {
    const getSessionExtensionsApiMain = (ses) => {
        return (ses && typeof ses === 'object' && ses.extensions && typeof ses.extensions === 'object')
            ? ses.extensions
            : null;
    };
    const getAllExtensionsMain = (ses) => {
        const extApi = getSessionExtensionsApiMain(ses);
        if (extApi && typeof extApi.getAllExtensions === 'function') {
            return extApi.getAllExtensions();
        }
        if (ses && typeof ses.getAllExtensions === 'function') {
            return ses.getAllExtensions();
        }
        return {};
    };
    const loadExtensionMain = async (ses, extensionPath) => {
        const extApi = getSessionExtensionsApiMain(ses);
        if (extApi && typeof extApi.loadExtension === 'function') {
            return await extApi.loadExtension(extensionPath, { allowFileAccess: true });
        }
        if (ses && typeof ses.loadExtension === 'function') {
            return await ses.loadExtension(extensionPath, { allowFileAccess: true });
        }
        throw new Error('Session extension loader unavailable');
    };

    const initial = resolveAdblockDashboardUrlFallback(preferredPartition);
    // file://dashboard.html uzantı bağlamı olmadan siyah/boş pencere verebilir.
    // Bu yüzden önce extension'ı session'a yüklemeyi dene; yalnızca chrome-extension://
    // zaten mevcutsa doğrudan dönebiliriz.
    const initialUrl = String(initial?.url || '').trim().toLowerCase();
    if (initialUrl.startsWith('chrome-extension://')) return initial;

    const extensionPath = resolveBundledUbolExtensionPathForDashboard();
    if (!extensionPath) return initial;

    const partitionToTry = String(preferredPartition || WEBVIEW_PARTITION).trim() || WEBVIEW_PARTITION;
    const targets = [];
    try { targets.push({ ses: session.fromPartition(partitionToTry), partition: partitionToTry }); } catch { }
    try { targets.push({ ses: session.defaultSession, partition: '' }); } catch { }

    for (const target of targets) {
        const ses = target?.ses;
        if (!ses) continue;
        try {
            const all = getAllExtensionsMain(ses);
            const list = Array.isArray(all) ? all : Object.values(all || {});
            const existing = list.find((item) => /uBlock(?:\s+Origin)?\s+Lite|uBO\s+Lite/i.test(String(item?.name || '')));
            const existingId = String(existing?.id || '').trim();
            if (existingId) {
                return {
                    url: `chrome-extension://${existingId}/dashboard.html`,
                    partition: target.partition
                };
            }
        } catch {
            // yoksay
        }
        try {
            const loaded = await loadExtensionMain(ses, extensionPath);
            const loadedId = String(loaded?.id || '').trim();
            if (loadedId) {
                return {
                    url: `chrome-extension://${loadedId}/dashboard.html`,
                    partition: target.partition
                };
            }
        } catch {
            // yoksay
        }
    }

    return resolveAdblockDashboardUrlFallback(partitionToTry);
}

async function syncAdblockConfigInBackground(preferredPartition = '') {
    try {
        if (adblockDashboardWindow && !adblockDashboardWindow.isDestroyed()) {
            await syncAdblockConfigToDashboard(adblockDashboardWindow);
            await ensureAdblockDefaultFilteringDetails(adblockDashboardWindow);
            return true;
        }

        const launchInfo = await ensureAdblockDashboardLaunchInfo(preferredPartition || WEBVIEW_PARTITION);
        const dashboardUrl = String(launchInfo?.url || '').trim();
        const targetPartition = String(launchInfo?.partition || preferredPartition || WEBVIEW_PARTITION).trim() || WEBVIEW_PARTITION;
        if (!dashboardUrl) return false;

        const backgroundWin = new BrowserWindow({
            width: 860,
            height: 680,
            show: false,
            focusable: false,
            skipTaskbar: true,
            autoHideMenuBar: true,
            backgroundColor: '#0f0f0f',
            webPreferences: {
                partition: targetPartition,
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true,
                webSecurity: true,
                allowRunningInsecureContent: false
            }
        });

        try {
            backgroundWin.setMenuBarVisibility(false);
            backgroundWin.setMenu(null);
        } catch { }

        try {
            try {
                await backgroundWin.loadURL(dashboardUrl);
            } catch {
                const fallbackUrl = dashboardUrl.replace('/dashboard.html', '/popup.html');
                await backgroundWin.loadURL(fallbackUrl);
            }
            await ensureAdblockDashboardVisibleContent(backgroundWin);
            await syncAdblockConfigToDashboard(backgroundWin);
            await ensureAdblockDefaultFilteringDetails(backgroundWin);
            return true;
        } finally {
            try {
                if (!backgroundWin.isDestroyed()) {
                    backgroundWin.destroy();
                }
            } catch { }
        }
    } catch {
        return false;
    }
}

function scheduleAdblockConfigBackgroundSync(preferredPartition = '') {
    try {
        if (adblockConfigBackgroundSyncTimer) {
            clearTimeout(adblockConfigBackgroundSyncTimer);
            adblockConfigBackgroundSyncTimer = null;
        }
    } catch { }
    adblockConfigBackgroundSyncTimer = setTimeout(() => {
        adblockConfigBackgroundSyncTimer = null;
        syncAdblockConfigInBackground(preferredPartition).catch(() => {});
    }, 180);
}

ipcMain.handle('adblock:openDashboard', async () => {
    try {
        const launchInfo = getAdBlockerDashboardLaunchInfo?.() || {};
        let dashboardUrl = String(launchInfo.url || getAdBlockerDashboardUrl() || '').trim();
        let targetPartition = String(launchInfo.partition || WEBVIEW_PARTITION).trim();
        const uiLang = getUiLanguageSync();
        // Modül içindeki saklı launch bilgisi (id/partition) güncel olmayabilir.
        // Her açılışta canlı session'lardan yeniden çözerek siyah/boş dashboard penceresini önle.
        const resolved = await ensureAdblockDashboardLaunchInfo(targetPartition);
        if (resolved && resolved.url) {
            dashboardUrl = String(resolved.url || '').trim();
            targetPartition = String(resolved.partition || targetPartition || WEBVIEW_PARTITION).trim();
        }
        if (dashboardUrl.toLowerCase().startsWith('file://')) {
            const secondTry = resolveAdblockDashboardUrlFallback(targetPartition);
            const secondUrl = String(secondTry?.url || '').trim();
            if (secondUrl.toLowerCase().startsWith('chrome-extension://')) {
                dashboardUrl = secondUrl;
                targetPartition = String(secondTry.partition || targetPartition || WEBVIEW_PARTITION).trim();
            }
        }
        if (!dashboardUrl) return false;

        const currentPartition = String(
            adblockDashboardWindow?.webContents?.session?.partition || ''
        ).trim();
        const needsRecreate =
            adblockDashboardWindow &&
            !adblockDashboardWindow.isDestroyed() &&
            currentPartition &&
            targetPartition &&
            currentPartition !== targetPartition;

        if (needsRecreate) {
            try { adblockDashboardWindow.close(); } catch { }
            adblockDashboardWindow = null;
        }

        if (adblockDashboardWindow && !adblockDashboardWindow.isDestroyed()) {
            await syncAdblockStateFromDashboardToApp(adblockDashboardWindow);
            adblockDashboardWindow.show();
            adblockDashboardWindow.focus();
            try {
                const currentUrl = String(adblockDashboardWindow.webContents?.getURL?.() || '').trim();
                if (!currentUrl) {
                    await adblockDashboardWindow.loadURL(dashboardUrl);
                }
            } catch { }
            try {
                adblockDashboardWindow.setAutoHideMenuBar(true);
                adblockDashboardWindow.setMenuBarVisibility(false);
                adblockDashboardWindow.setMenu(null);
            } catch { }
            await applyAdblockDashboardBranding(adblockDashboardWindow, uiLang);
            await ensureAdblockDefaultFilteringDetails(adblockDashboardWindow);
            await syncAdblockStateFromDashboardToApp(adblockDashboardWindow);
            startAdblockDashboardAutoSync(adblockDashboardWindow);
            return true;
        }

        let adblockDashboardCloseSyncInProgress = false;

        adblockDashboardWindow = new BrowserWindow({
            width: ADBLOCK_DASHBOARD_WINDOW_SIZE.width,
            height: ADBLOCK_DASHBOARD_WINDOW_SIZE.height,
            minWidth: ADBLOCK_DASHBOARD_WINDOW_SIZE.width,
            minHeight: ADBLOCK_DASHBOARD_WINDOW_SIZE.height,
            title: 'Aurivo',
            icon: getAppIconImage(),
            autoHideMenuBar: true,
            show: false,
            backgroundColor: '#0f0f0f',
            parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
            webPreferences: {
                partition: targetPartition || WEBVIEW_PARTITION,
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true,
                webSecurity: true,
                allowRunningInsecureContent: false
            }
        });

        adblockDashboardWindow.on('close', (event) => {
            if (adblockDashboardCloseSyncInProgress) return;
            event.preventDefault();
            adblockDashboardCloseSyncInProgress = true;
            syncAdblockStateFromDashboardToApp(adblockDashboardWindow)
                .catch(() => {})
                .finally(() => {
                    try {
                        if (adblockDashboardWindow && !adblockDashboardWindow.isDestroyed()) {
                            adblockDashboardWindow.destroy();
                        }
                    } catch {
                        // yoksay
                    }
                });
        });

        adblockDashboardWindow.on('closed', () => {
            stopAdblockDashboardAutoSync();
            adblockDashboardWindow = null;
        });
        try {
            adblockDashboardWindow.setMenuBarVisibility(false);
            adblockDashboardWindow.setMenu(null);
        } catch { }
        adblockDashboardWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
            console.error('[ADBLOCK] dashboard did-fail-load:', { errorCode, errorDescription, validatedURL });
        });
        adblockDashboardWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
            if (level >= 2) {
                console.warn('[ADBLOCK][dashboard][console]', { message, line, sourceId });
            }
        });
        adblockDashboardWindow.webContents.on('page-title-updated', (event) => {
            event.preventDefault();
            try { adblockDashboardWindow.setTitle('Aurivo'); } catch { }
        });
        let adblockDashboardShowInProgress = false;
        const finalizeAndShowAdblockDashboard = async () => {
            if (adblockDashboardShowInProgress) return;
            adblockDashboardShowInProgress = true;
            try {
                if (!adblockDashboardWindow || adblockDashboardWindow.isDestroyed()) return;
                try {
                    adblockDashboardWindow.setMenuBarVisibility(false);
                    adblockDashboardWindow.setMenu(null);
                } catch { }
                await ensureAdblockDashboardVisibleContent(adblockDashboardWindow);
                const uiReady = await waitForAdblockDashboardUiReady(adblockDashboardWindow, 2600);
                if (!uiReady) {
                    try {
                        const currentUrl = String(adblockDashboardWindow.webContents?.getURL?.() || '').trim();
                        if (/\/dashboard\.html(?:[#?]|$)/i.test(currentUrl)) {
                            await adblockDashboardWindow.loadURL(currentUrl.replace('/dashboard.html', '/popup.html'));
                            await waitForAdblockDashboardUiReady(adblockDashboardWindow, 1200);
                        }
                    } catch { }
                }
                await applyAdblockDashboardBranding(adblockDashboardWindow, uiLang);
                await ensureAdblockDefaultFilteringDetails(adblockDashboardWindow);
                await syncAdblockStateFromDashboardToApp(adblockDashboardWindow);
                startAdblockDashboardAutoSync(adblockDashboardWindow);
                if (!adblockDashboardWindow.isVisible()) adblockDashboardWindow.show();
                adblockDashboardWindow.focus();
            } catch {
                // yoksay
            } finally {
                adblockDashboardShowInProgress = false;
            }
        };

        adblockDashboardWindow.webContents.on('did-finish-load', () => {
            try {
                adblockDashboardWindow.setMenuBarVisibility(false);
                adblockDashboardWindow.setMenu(null);
            } catch { }
            finalizeAndShowAdblockDashboard().catch(() => {});
        });

        try {
            await adblockDashboardWindow.loadURL(dashboardUrl);
        } catch {
            const fallbackUrl = dashboardUrl.replace('/dashboard.html', '/popup.html');
            await adblockDashboardWindow.loadURL(fallbackUrl);
        }
        await finalizeAndShowAdblockDashboard();
        return true;
    } catch (e) {
        console.error('[ADBLOCK] openDashboard error:', e);
        return false;
    }
});

ipcMain.handle('web:clearData', async (_event, options) => {
    const opts = (options && typeof options === 'object') ? options : {};
    const sessions = getWebSessions();
    if (!sessions.length) return false;

    const wantsAll = opts.all === true;
    const wantsCookies = wantsAll || opts.cookies === true;
    const wantsCache = wantsAll || opts.cache === true;
    const wantsStorage = wantsAll || opts.storage === true;

    try {
        for (const ses of sessions) {
            if (wantsCache) {
                await ses.clearCache();
            }

            const storages = [];
            if (wantsCookies) storages.push('cookies');
            if (wantsStorage) {
                storages.push('localstorage', 'indexdb', 'cachestorage', 'serviceworkers');
            }

            if (storages.length) {
                await ses.clearStorageData({ storages });
            }
        }

        return true;
    } catch (e) {
        console.error('[WEB] clearData error:', e);
        return false;
    }
});

// Dizin Okuma
ipcMain.handle('fs:readDirectory', async (event, dirPath) => {
    try {
        if (!dirPath || typeof dirPath !== 'string') return [];

        // Windows testleri için: kütüphane/kırpma filtreleri bu uzantılara göre çalışıyor.
        // Not: Bu liste "noktasız" (mp3) tutulur, kontrol `toLowerCase()` ile yapılır.
        const SUPPORTED_MEDIA_EXTENSIONS = new Set([
            'mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'wma', 'aiff', 'opus', 'ape', 'wv',
            'mp4', 'mkv', 'webm', 'avi', 'mov', 'wmv', 'm4v', 'flv', 'mpg', 'mpeg'
        ]);

        const items = await fs.promises.readdir(dirPath, { withFileTypes: true });
        const results = await Promise.all(items.map(async (item) => {
            const fullPath = path.join(dirPath, item.name);
            const ext = path.extname(item.name || '').slice(1).toLowerCase();
            const isSupportedMedia = !!ext && SUPPORTED_MEDIA_EXTENSIONS.has(ext);

            let isDirectory = item.isDirectory();
            let isFile = item.isFile();

            // Bazı dosya sistemlerinde d_type "unknown" gelebilir (FUSE/NFS vb.).
            // Bu durumda stat() ile gerçek türü belirle.
            if (item.isSymbolicLink?.() || (!isDirectory && !isFile)) {
                try {
                    const st = await fs.promises.stat(fullPath);
                    isDirectory = st.isDirectory();
                    isFile = st.isFile();
                } catch {
                    // yoksay
                }
            }

            // Ek yedek: tür belirlenemediyse ama desteklenen uzantıysa dosya kabul et
            if (!isDirectory && !isFile && isSupportedMedia) {
                isFile = true;
            }

            return {
                name: item.name,
                path: fullPath,
                isDirectory,
                isFile,
                ext,
                isSupportedMedia
            };
        }));

        return results;
    } catch (error) {
        console.error('Directory read error:', error);
        return [];
    }
});

ipcMain.handle('library:getStats', async (_event, folders, metadataCache, excludedFolders, audioExtensions, performanceOptions) => {
    try {
        return await buildLibraryStatsFromFolders(folders, metadataCache, excludedFolders, audioExtensions, performanceOptions);
    } catch (error) {
        console.error('[LIBRARY] stats error:', error);
        return {
            totalSongs: 0,
            totalArtists: 0,
            totalAlbums: 0,
            totalDurationSec: 0,
            missingMetadataCount: 0,
            missingCoverCount: 0,
            scannedFolderCount: 0,
            generatedAt: Date.now(),
            error: String(error?.message || error || 'unknown')
        };
    }
});

ipcMain.handle('library:getStatsComposite', async (_event, folders, extraFiles, metadataCache, excludedFolders, audioExtensions, performanceOptions) => {
    try {
        return await buildLibraryStatsComposite(folders, extraFiles, metadataCache, excludedFolders, audioExtensions, performanceOptions);
    } catch (error) {
        console.error('[LIBRARY] composite stats error:', error);
        return {
            totalSongs: 0,
            totalArtists: 0,
            totalAlbums: 0,
            totalDurationSec: 0,
            missingMetadataCount: 0,
            missingCoverCount: 0,
            scannedFolderCount: 0,
            generatedAt: Date.now(),
            error: String(error?.message || error || 'unknown')
        };
    }
});

ipcMain.handle('library:refreshMetadata', async (_event, folders, options, excludedFolders, audioExtensions, performanceOptions) => {
    try {
        return await buildLibraryMetadataCacheFromFolders(folders, options, excludedFolders, audioExtensions, performanceOptions);
    } catch (error) {
        console.error('[LIBRARY] metadata refresh error:', error);
        return {
            items: {},
            summary: {
                refreshedCount: 0,
                inferredCount: 0,
                cleanedCount: 0,
                generatedAt: Date.now(),
                error: String(error?.message || error || 'unknown')
            }
        };
    }
});

ipcMain.handle('library:startWatch', async (event, folders, excludedFolders) => {
    try {
        return await startLibraryWatchSession(event.sender, folders, excludedFolders);
    } catch (error) {
        console.error('[LIBRARY] start watch error:', error);
        return {
            watching: false,
            watchedFolders: 0,
            watchedDirectories: 0,
            error: String(error?.message || error || 'unknown')
        };
    }
});

ipcMain.handle('library:stopWatch', async (event) => {
    try {
        disposeLibraryWatchSession(event.sender.id);
        return true;
    } catch (error) {
        console.error('[LIBRARY] stop watch error:', error);
        return false;
    }
});

// Özel Klasörler (Linux için Türkçe klasör isimleri de desteklenir)
ipcMain.handle('fs:getSpecialPaths', async () => {
    const home = os.homedir();

    // Olası klasör isimleri
    const musicFolders = ['Music', 'Müzik', 'music'];
    const videoFolders = ['Videos', 'Videolar', 'Video', 'videos'];
    const downloadFolders = ['Downloads', 'İndirilenler', 'downloads'];

    // Var olan klasörü bul
    const findExisting = async (folders) => {
        for (const folder of folders) {
            const fullPath = path.join(home, folder);
            try {
                await fs.promises.access(fullPath);
                return fullPath;
            } catch { }
        }
        return path.join(home, folders[0]); // Bulunamazsa ilkini döndür
    };

    return {
        home: home,
        music: await findExisting(musicFolders),
        videos: await findExisting(videoFolders),
        downloads: await findExisting(downloadFolders),
        documents: path.join(home, 'Documents')
    };
});

// Dosya Varlık Kontrolü
ipcMain.handle('fs:exists', async (event, filePath) => {
    try {
        await fs.promises.access(filePath);
        return true;
    } catch {
        return false;
    }
});

// Dosya Bilgisi
ipcMain.handle('fs:getFileInfo', async (event, filePath) => {
    try {
        const stats = await fs.promises.stat(filePath);
        return {
            size: stats.size,
            created: stats.birthtime,
            modified: stats.mtime,
            isDirectory: stats.isDirectory(),
            isFile: stats.isFile()
        };
    } catch (error) {
        return null;
    }
});

ipcMain.handle('fs:readText', async (_event, filePath) => {
    try {
        return await fs.promises.readFile(String(filePath || ''), 'utf8');
    } catch (error) {
        return null;
    }
});

ipcMain.handle('fs:writeText', async (_event, filePath, text) => {
    try {
        await fs.promises.writeFile(String(filePath || ''), String(text ?? ''), 'utf8');
        return true;
    } catch (error) {
        console.error('[FS] writeText error:', error);
        return false;
    }
});

ipcMain.handle('system:getHardwareHints', async () => {
    const ramGiB = Math.max(1, Math.round(Number(os.totalmem?.() || 0) / (1024 ** 3)));
    const cpuCores = Array.isArray(os.cpus?.()) ? os.cpus().length : 0;
    let gpuRenderer = '';
    try {
        const gpuInfo = await app.getGPUInfo('basic');
        const firstGpu = Array.isArray(gpuInfo?.gpuDevice) ? gpuInfo.gpuDevice[0] : null;
        gpuRenderer = String(
            firstGpu?.deviceString
            || firstGpu?.driverVendor
            || firstGpu?.vendorString
            || gpuInfo?.auxAttributes?.gl_renderer
            || ''
        ).trim();
    } catch {
        gpuRenderer = '';
    }
    return { ramGiB, cpuCores, gpuRenderer };
});

ipcMain.handle('settings:save', async (event, settings) => {
    try {
        const incoming = sanitizeSensitiveSettings(settings);

        const deepMerge = (base, patch) => {
            const out = (base && typeof base === 'object' && !Array.isArray(base)) ? { ...base } : {};
            if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return out;
            for (const [k, v] of Object.entries(patch)) {
                if (v && typeof v === 'object' && !Array.isArray(v)) {
                    out[k] = deepMerge(out[k], v);
                } else {
                    out[k] = v;
                }
            }
            return out;
        };

        let existing = {};
        try {
            const data = await fs.promises.readFile(getSettingsPath(), 'utf8');
            existing = JSON.parse(data);
        } catch {
            existing = {};
        }
        const prevUiLang = normalizeUiLang(existing?.ui?.language) || '';

        // Merge to preserve keys written by other windows (e.g. sfx.eq32.lastPreset)
        const merged = deepMerge(existing, incoming);
        const sanitizedMerged = sanitizeSensitiveSettings(merged);
        const nextUiLang = normalizeUiLang(sanitizedMerged?.ui?.language) || '';
        mainWindowCloseToTray = deriveMainWindowCloseToTray(sanitizedMerged);
        await writeJsonFileAtomic(getSettingsPath(), sanitizedMerged);
        refreshGlobalMediaShortcuts(sanitizedMerged);

        for (const targetWindow of [mainWindow, settingsWindow, soundEffectsWindow]) {
            if (!targetWindow || targetWindow.isDestroyed()) continue;
            try {
                targetWindow.webContents.send('settings:reloaded', sanitizedMerged);
            } catch (e) {
                console.error('[SETTINGS] reload broadcast error:', e);
            }
        }

        // Dil değiştiyse, çalışan native görselleştiriciyi yeni locale ile yeniden başlat.
        if (visualizerProc && !visualizerProc.killed && prevUiLang && nextUiLang && prevUiLang !== nextUiLang) {
            try {
                console.log(`[Visualizer] language changed (${prevUiLang} -> ${nextUiLang}), restarting...`);
                stopVisualizer();
                startVisualizer();
            } catch (e) {
                console.error('[Visualizer] failed to restart after language change:', e);
            }
        }

        return true;
    } catch (error) {
        console.error('Settings save error:', error);
        return false;
    }
});

ipcMain.handle('settings:load', async () => {
    const defaultSettings = {
        playback: {
            crossfadeStopEnabled: true,
            crossfadeManualEnabled: true,
            crossfadeAutoEnabled: false,
            sameAlbumNoCrossfade: true,
            crossfadeMs: 2000,
            fadeOnPauseResume: false,
            pauseFadeMs: 250,
            crossfadeSkipShortTracks: true,
            crossfadeSafetyPaddingMs: 300,
            seekStepSeconds: 10,
            restoreLastTrackOnStartup: true,
            autoplayLastTrackOnStartup: false,
            resumePositionOnStartup: true,
            endWarningEnabled: false,
            endWarningSeconds: 10,
            smartVolumeLevelingEnabled: false,
            smartVolumeLevelingMode: 'balanced',
            mediaKeyAutoDetect: true,
            customHotkeys: {
                previous: 'F2',
                playPause: 'F3',
                next: 'F4'
            },
            startupState: {
                lastTrackPath: '',
                lastTrackIndex: -1,
                lastPositionMs: 0,
                lastWasPlaying: false,
                updatedAt: 0
            }
        },
        adblock: {
            mode: 'ideal',
            showBlockedCount: true,
            autoRefreshOnModeChange: false,
            strictBlock: false,
            developerMode: false
        },
        volume: 40,
        shuffle: false,
        repeat: false
    };

    // Eşzamanlı yazma anında (truncate/partial) parse hatası oluşursa kısa retry.
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const data = await fs.promises.readFile(getSettingsPath(), 'utf8');
            const parsed = JSON.parse(data);
            const sanitized = sanitizeSensitiveSettings(parsed);
            mainWindowCloseToTray = deriveMainWindowCloseToTray(sanitized);
            if (JSON.stringify(parsed) !== JSON.stringify(sanitized)) {
                await writeJsonFileAtomic(getSettingsPath(), sanitized);
            }
            return sanitized;
        } catch (error) {
            if (attempt < 2) {
                await new Promise(r => setTimeout(r, 40));
                continue;
            }
            mainWindowCloseToTray = true;
            return defaultSettings;
        }
    }

    mainWindowCloseToTray = true;
    return defaultSettings;
});

ipcMain.handle('settings:openWindow', async (_event, defaultTab) => {
    try {
        await createSettingsWindow(defaultTab);
        return true;
    } catch (error) {
        console.error('[SETTINGS] openWindow error:', error);
        return false;
    }
});

ipcMain.handle('settings:confirmClose', () => {
    try {
        if (settingsWindow && !settingsWindow.isDestroyed()) {
            if (typeof settingsWindow.__allowClose === 'function') {
                settingsWindow.__allowClose();
            }
            settingsWindow.close();
            return true;
        }
    } catch (error) {
        console.error('[SETTINGS] confirmClose error:', error);
    }
    return false;
});

ipcMain.handle('systemAudio:getState', async () => {
    try {
        const state = await getSystemAudioState();
        const outputs = await listSystemAudioOutputs();
        return {
            ...state,
            outputs: Array.isArray(outputs?.outputs) ? outputs.outputs : []
        };
    } catch (error) {
        return {
            success: false,
            supported: false,
            platform: process.platform,
            error: error?.message || String(error)
        };
    }
});

ipcMain.handle('systemAudio:setVolume', async (_event, percent) => {
    try {
        return await setSystemAudioVolume(percent);
    } catch (error) {
        return {
            success: false,
            error: error?.message || String(error)
        };
    }
});

ipcMain.handle('systemAudio:setAllowOverdrive', async (_event, enabled) => {
    try {
        return await setSystemAudioAllowOverdrive(enabled);
    } catch (error) {
        return {
            success: false,
            error: error?.message || String(error)
        };
    }
});

ipcMain.handle('systemAudio:setOutput', async (_event, outputId) => {
    try {
        return await setSystemAudioOutput(outputId);
    } catch (error) {
        return {
            success: false,
            error: error?.message || String(error)
        };
    }
});

// Playlist Kaydet/Yükle
const playlistPath = path.join(app.getPath('userData'), 'playlist.json');

ipcMain.handle('playlist:save', async (event, playlist) => {
    try {
        await fs.promises.writeFile(playlistPath, JSON.stringify(playlist, null, 2));
        return true;
    } catch (error) {
        console.error('Playlist save error:', error);
        return false;
    }
});

ipcMain.handle('playlist:load', async () => {
    try {
        const data = await fs.promises.readFile(playlistPath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return [];
    }
});

// Sistem Tepsisi Durum Güncelleme (renderer'dan güncel oynatma durumu)
ipcMain.on('update-tray-state', (event, state) => {
    updateTrayMenu(state);
    if (tray && state.currentTrack) {
        tray.setToolTip(state.currentTrack);
    }
});

// MPRIS Metadata Güncelle (renderer'dan media bilgileri)
ipcMain.on('update-mpris-metadata', (event, metadata) => {
    updateMPRISMetadata(metadata);
});

// Albüm Kapağı Çıkarma (ID3 etiketi'lerinden)
ipcMain.handle('media:getAlbumArt', async (event, filePath) => {
    try {
        console.log('Albüm kapağı istendi:', filePath);

        // node-id3 kullan
        if (NodeID3) {
            const tags = NodeID3.read(filePath);

            if (tags && tags.image) {
                const img = tags.image;
                let imageBuffer;
                let mimeType = 'image/jpeg';

                if (img.imageBuffer) {
                    imageBuffer = img.imageBuffer;
                    mimeType = img.mime || 'image/jpeg';
                } else if (Buffer.isBuffer(img)) {
                    imageBuffer = img;
                }

                if (imageBuffer) {
                    const base64 = imageBuffer.toString('base64');
                    console.log('Kapak bulundu! Boyut:', base64.length, 'format:', mimeType);
                    return toImageDataUrl(imageBuffer, mimeType);
                }
            }
            console.log('Bu dosyada kapak yok (node-id3)');
        } else {
            console.log('node-id3 yüklü değil, fallback kullanılıyor');
        }

        // Yedek - Manuel okuma veya ffmpeg
        return await extractEmbeddedCover(filePath);

    } catch (error) {
        console.log('Albüm kapağı çıkarılamadı:', error.message);
        return null;
    }
});

ipcMain.handle('media:getBestAlbumArt', async (_event, filePath, options) => {
    try {
        const prefs = (options && typeof options === 'object') ? options : {};
        const preferEmbedded = prefs.preferEmbedded !== false;
        const allowFolderCover = prefs.allowFolderCover !== false;

        if (preferEmbedded) {
            const embedded = await extractEmbeddedCover(filePath);
            if (embedded) return embedded;
        }

        if (allowFolderCover) {
            const folderCover = await readFolderCoverImage(filePath);
            if (folderCover) return folderCover;
        }

        if (!preferEmbedded) {
            const embedded = await extractEmbeddedCover(filePath);
            if (embedded) return embedded;
        }

        return null;
    } catch (error) {
        console.log('En uygun kapak bulunamadı:', error?.message || error);
        return null;
    }
});

// Video küçük resmi çıkarma (ffmpeg ile 1 kare al)
ipcMain.handle('media:getVideoThumbnail', async (_event, filePath) => {
    try {
        const fp = String(filePath || '').trim();
        if (!fp) return null;
        try {
            await fs.promises.access(fp);
        } catch {
            return null;
        }
        return await extractVideoThumbnailWithFFmpeg(fp);
    } catch (e) {
        console.log('Video thumbnail çıkarılamadı:', e?.message || e);
        return null;
    }
});

function getFfmpegPathForEnv() {
    // Linux/macOS'ta sistem ffmpeg genelde daha güncel codec desteği sunduğu için
    // önce sistemi dene; paketlenmiş sürümü fallback olarak kullan.
    // Windows'ta bundle önceliğini koru.
    const candidates = [];

    const preferSystemFirst =
        process.platform !== 'win32' ||
        process.env.AURIVO_FFMPEG_PREFER_SYSTEM === '1' ||
        process.env.AURIVO_FFMPEG_PREFER_SYSTEM === 'true';

    const systemCandidate = findExecutable('ffmpeg', ['/usr/bin', '/usr/local/bin', '/bin']);
    if (preferSystemFirst) {
        if (systemCandidate) candidates.push(systemCandidate);
    }

    if (app.isPackaged) {
        const packed = process.platform === 'win32'
            ? path.join(process.resourcesPath, 'bin', 'ffmpeg.exe')
            : path.join(process.resourcesPath, 'bin', 'ffmpeg');
        candidates.push(packed);
    }

    if (!preferSystemFirst) {
        if (systemCandidate) candidates.push(systemCandidate);
    }

    candidates.push('ffmpeg');

    for (const candidate of candidates) {
        const value = String(candidate || '').trim();
        if (!value) continue;
        if (value === 'ffmpeg') return value;
        try {
            fs.accessSync(value, fs.constants.X_OK);
            return value;
        } catch {
            // sonraki adayı dene
        }
    }
    return 'ffmpeg';
}

function normalizeExcludedPaths(excludedFolders = []) {
    return Array.isArray(excludedFolders)
        ? excludedFolders
            .map((folder) => String(folder?.path || folder || '').trim())
            .filter(Boolean)
            .map((folderPath) => path.resolve(folderPath))
        : [];
}

function isPathExcluded(targetPath, excludedPaths = []) {
    const normalizedTarget = String(targetPath || '').trim();
    if (!normalizedTarget) return false;
    const resolvedTarget = path.resolve(normalizedTarget);
    return excludedPaths.some((excludedPath) => {
        const resolvedExcluded = path.resolve(String(excludedPath || '').trim());
        return resolvedTarget === resolvedExcluded || resolvedTarget.startsWith(`${resolvedExcluded}${path.sep}`);
    });
}

function normalizeAudioExtensions(extensions = []) {
    const fallback = ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'wma', 'aiff', 'opus', 'ape', 'wv'];
    const normalized = Array.isArray(extensions)
        ? Array.from(new Set(extensions.map((value) => String(value || '').trim().replace(/^\./, '').toLowerCase()).filter(Boolean)))
        : [];
    return normalized.length ? normalized : fallback;
}

async function collectAudioFilesRecursive(rootDir, out = [], excludedPaths = [], audioExtensions = [], diagnostics = null) {
    const AUDIO_SET = new Set(normalizeAudioExtensions(audioExtensions));
    if (isPathExcluded(rootDir, excludedPaths)) {
        return out;
    }
    let entries = [];
    try {
        entries = await fs.promises.readdir(rootDir, { withFileTypes: true });
    } catch (error) {
        if (diagnostics) {
            diagnostics.scanErrors.push({
                path: rootDir,
                error: String(error?.message || error || 'directory-read-failed')
            });
        }
        return out;
    }

    for (const entry of entries) {
        const fullPath = path.join(rootDir, entry.name);
        try {
            if (entry.isDirectory()) {
                if (!isPathExcluded(fullPath, excludedPaths)) {
                    await collectAudioFilesRecursive(fullPath, out, excludedPaths, audioExtensions, diagnostics);
                }
                continue;
            }
            if (!entry.isFile()) continue;
        } catch (error) {
            if (diagnostics) {
                diagnostics.scanErrors.push({
                    path: fullPath,
                    error: String(error?.message || error || 'entry-read-failed')
                });
            }
            continue;
        }

        const ext = path.extname(entry.name || '').slice(1).toLowerCase();
        if (AUDIO_SET.has(ext)) {
            out.push(fullPath);
        }
    }
    return out;
}

function parseMediaDurationWithFfmpeg(filePath) {
    return new Promise((resolve) => {
        const ffmpegPath = getFfmpegPathForEnv();
        const child = spawn(ffmpegPath, ['-i', filePath], { windowsHide: true });
        let stderr = '';

        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        child.on('error', () => resolve(0));
        child.on('close', () => {
            const match = stderr.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/i);
            if (!match) {
                resolve(0);
                return;
            }
            const hours = Number(match[1] || 0);
            const minutes = Number(match[2] || 0);
            const seconds = Number(match[3] || 0);
            resolve((hours * 3600) + (minutes * 60) + seconds);
        });
    });
}

function getImageMimeTypeFromFileName(fileName = '') {
    const ext = path.extname(String(fileName || '')).toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.png') return 'image/png';
    if (ext === '.webp') return 'image/webp';
    return null;
}

function normalizeImageMimeType(rawMime = '') {
    const value = String(rawMime || '')
        .replace(/\0/g, '')
        .trim()
        .toLowerCase()
        .split(';')[0];

    if (!value) return 'image/jpeg';
    if (value === 'jpg' || value === 'jpeg' || value === 'image/jpg') return 'image/jpeg';
    if (value === 'png' || value === 'image/png') return 'image/png';
    if (value === 'webp' || value === 'image/webp') return 'image/webp';
    if (value === 'gif' || value === 'image/gif') return 'image/gif';
    if (value === 'bmp' || value === 'image/bmp') return 'image/bmp';
    if (value === 'image/jpeg') return 'image/jpeg';
    if (value.startsWith('image/')) return value;
    return 'image/jpeg';
}

function toImageDataUrl(imageBuffer, mimeType = 'image/jpeg') {
    if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length <= 0) return null;
    const safeMime = normalizeImageMimeType(mimeType);
    return `data:${safeMime};base64,${imageBuffer.toString('base64')}`;
}

async function findBestFolderCoverPath(filePath) {
    const dir = path.dirname(filePath);
    const trackBaseName = path.basename(filePath, path.extname(filePath || '')).toLowerCase();
    let entries = [];
    try {
        entries = await fs.promises.readdir(dir);
    } catch {
        return null;
    }

    // case-insensitive lookup map: "cover.jpg" -> "Cover.JPG"
    const entryMap = new Map(entries.map((name) => [String(name).toLowerCase(), String(name)]));
    const candidates = [
        'cover.jpg', 'cover.jpeg', 'cover.png', 'cover.webp',
        'folder.jpg', 'folder.jpeg', 'folder.png', 'folder.webp',
        'front.jpg', 'front.jpeg', 'front.png', 'front.webp',
        'albumart.jpg', 'albumart.jpeg', 'albumart.png', 'albumart.webp',
        'artwork.jpg', 'artwork.jpeg', 'artwork.png', 'artwork.webp',
        `${trackBaseName}.jpg`, `${trackBaseName}.jpeg`, `${trackBaseName}.png`, `${trackBaseName}.webp`
    ];

    for (const lowerCandidate of candidates) {
        const realName = entryMap.get(lowerCandidate);
        if (realName) {
            return path.join(dir, realName);
        }
    }

    return null;
}

async function hasFolderCoverImage(filePath) {
    return !!(await findBestFolderCoverPath(filePath));
}

async function readFolderCoverImage(filePath) {
    const coverPath = await findBestFolderCoverPath(filePath);
    if (!coverPath) return null;

    try {
        const buffer = await fs.promises.readFile(coverPath);
        const mime = getImageMimeTypeFromFileName(coverPath) || 'image/jpeg';
        if (buffer?.length) {
            return toImageDataUrl(buffer, mime);
        }
    } catch {
        // yoksay
    }

    return null;
}

async function collectDirectoriesRecursive(rootDir, out = [], excludedPaths = []) {
    if (isPathExcluded(rootDir, excludedPaths)) {
        return out;
    }
    let entries = [];
    try {
        entries = await fs.promises.readdir(rootDir, { withFileTypes: true });
    } catch {
        return out;
    }

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const fullPath = path.join(rootDir, entry.name);
        if (isPathExcluded(fullPath, excludedPaths)) continue;
        out.push(fullPath);
        await collectDirectoriesRecursive(fullPath, out, excludedPaths);
    }
    return out;
}

function disposeLibraryWatchSession(senderId) {
    const session = libraryWatchSessions.get(senderId);
    if (!session) return;
    if (session.refreshTimer) clearTimeout(session.refreshTimer);
    if (session.eventTimer) clearTimeout(session.eventTimer);
    for (const watcher of session.watchers || []) {
        try {
            watcher.close();
        } catch {
            // yoksay
        }
    }
    libraryWatchSessions.delete(senderId);
}

async function startLibraryWatchSession(webContents, folders, excludedFolders = []) {
    const senderId = webContents.id;
    disposeLibraryWatchSession(senderId);

    const normalizedFolders = Array.isArray(folders)
        ? folders
            .map((folder) => String(folder?.path || folder || '').trim())
            .filter(Boolean)
        : [];
    const excludedPaths = normalizeExcludedPaths(excludedFolders);

    if (!normalizedFolders.length) {
        return {
            watching: false,
            watchedFolders: 0,
            watchedDirectories: 0
        };
    }

    const uniqueDirectories = new Set();
    for (const rootDir of normalizedFolders) {
        if (isPathExcluded(rootDir, excludedPaths)) continue;
        uniqueDirectories.add(rootDir);
        const subdirs = [];
        await collectDirectoriesRecursive(rootDir, subdirs, excludedPaths);
        for (const dir of subdirs) uniqueDirectories.add(dir);
    }

    const session = {
        senderId,
        webContents,
        roots: normalizedFolders,
        excludedPaths,
        watchers: [],
        refreshTimer: null,
        eventTimer: null,
        eventCount: 0
    };
    libraryWatchSessions.set(senderId, session);

    const scheduleRefresh = async (changePath = '', reason = 'change') => {
        if (session.refreshTimer) clearTimeout(session.refreshTimer);
        if (session.eventTimer) clearTimeout(session.eventTimer);
        session.eventTimer = setTimeout(() => {
            if (!webContents.isDestroyed()) {
                webContents.send('library:watch-event', {
                    type: 'detected',
                    changePath,
                    reason,
                    watchedFolders: session.roots.length,
                    watchedDirectories: session.watchers.length,
                    timestamp: Date.now()
                });
            }
        }, 20);
        session.refreshTimer = setTimeout(async () => {
            try {
                await startLibraryWatchSession(webContents, session.roots, session.excludedPaths);
                if (!webContents.isDestroyed()) {
                    webContents.send('library:watch-event', {
                        type: 'resynced',
                        changePath,
                        reason,
                        watchedFolders: session.roots.length,
                        watchedDirectories: libraryWatchSessions.get(senderId)?.watchers?.length || 0,
                        timestamp: Date.now()
                    });
                }
            } catch (error) {
                if (!webContents.isDestroyed()) {
                    webContents.send('library:watch-event', {
                        type: 'error',
                        changePath,
                        reason,
                        error: String(error?.message || error || 'unknown'),
                        timestamp: Date.now()
                    });
                }
            }
        }, 900);
    };

    for (const dirPath of uniqueDirectories) {
        try {
            const watcher = fs.watch(dirPath, { persistent: false }, (_eventType, filename) => {
                const nextPath = filename ? path.join(dirPath, String(filename)) : dirPath;
                scheduleRefresh(nextPath, 'fs-change').catch(() => {});
            });
            session.watchers.push(watcher);
            watcher.on('error', (error) => {
                if (!webContents.isDestroyed()) {
                    webContents.send('library:watch-event', {
                        type: 'error',
                        changePath: dirPath,
                        reason: 'watch-error',
                        error: String(error?.message || error || 'unknown'),
                        timestamp: Date.now()
                    });
                }
            });
        } catch {
            // erişilemeyen klasörleri yoksay
        }
    }

    webContents.once('destroyed', () => {
        disposeLibraryWatchSession(senderId);
    });

    return {
        watching: session.watchers.length > 0,
        watchedFolders: normalizedFolders.length,
        watchedDirectories: session.watchers.length
    };
}

function readAudioTagMetadata(filePath) {
    if (!NodeID3) {
        return { title: '', artist: '', album: '', hasEmbeddedCover: false, error: 'id3-unavailable' };
    }
    try {
        const tags = NodeID3.read(filePath) || {};
        return {
            title: String(tags.title || '').trim(),
            artist: String(tags.artist || tags.performerInfo || '').trim(),
            album: String(tags.album || '').trim(),
            hasEmbeddedCover: !!tags.image,
            error: ''
        };
    } catch (error) {
        return {
            title: '',
            artist: '',
            album: '',
            hasEmbeddedCover: false,
            error: String(error?.message || error || 'metadata-read-failed')
        };
    }
}

function sanitizeMetadataString(value) {
    return String(value || '')
        .replace(/\uFFFD/g, '')
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

function inferMetadataFromFilename(filePath) {
    const base = path.basename(filePath, path.extname(filePath));
    const clean = sanitizeMetadataString(base);
    const parts = clean.split(' - ').map((part) => sanitizeMetadataString(part)).filter(Boolean);
    if (parts.length >= 2) {
        return {
            artist: parts[0],
            title: parts.slice(1).join(' - '),
            album: ''
        };
    }
    return {
        artist: '',
        title: clean,
        album: ''
    };
}

async function buildLibraryMetadataCacheFromFolders(folders, options = {}, excludedFolders = [], audioExtensions = [], performanceOptions = {}) {
    const normalizedFolders = Array.isArray(folders)
        ? folders
            .map((folder) => ({
                path: String(folder?.path || '').trim(),
                name: String(folder?.name || '').trim()
            }))
            .filter((folder) => folder.path)
        : [];
    const cleanBrokenChars = options?.cleanBrokenChars !== false;
    const inferFromFilename = !!options?.inferFromFilename;
    const excludedPaths = normalizeExcludedPaths(excludedFolders);
    const fastScan = performanceOptions?.fastScan !== false;
    const lightweightMode = !!performanceOptions?.lightweightMode;
    const diagnostics = {
        scanErrors: [],
        unreadableFiles: []
    };

    const allFiles = [];
    for (const folder of normalizedFolders) {
        await collectAudioFilesRecursive(folder.path, allFiles, excludedPaths, audioExtensions, diagnostics);
    }

    const items = {};
    let refreshedCount = 0;
    let inferredCount = 0;
    let cleanedCount = 0;

    for (const filePath of Array.from(new Set(allFiles))) {
        const raw = readAudioTagMetadata(filePath);
        if (raw.error) {
            diagnostics.unreadableFiles.push({
                path: filePath,
                error: raw.error
            });
        }
        const before = {
            title: String(raw.title || ''),
            artist: String(raw.artist || ''),
            album: String(raw.album || '')
        };
        const next = { ...before };

        if (cleanBrokenChars) {
            next.title = sanitizeMetadataString(next.title);
            next.artist = sanitizeMetadataString(next.artist);
            next.album = sanitizeMetadataString(next.album);
            if (next.title !== before.title || next.artist !== before.artist || next.album !== before.album) {
                cleanedCount += 1;
            }
        }

        if (inferFromFilename && (!next.title || !next.artist)) {
            const inferred = inferMetadataFromFilename(filePath);
            if (!next.title && inferred.title) next.title = inferred.title;
            if (!next.artist && inferred.artist) next.artist = inferred.artist;
            if (!next.album && inferred.album) next.album = inferred.album;
            if (inferred.title || inferred.artist || inferred.album) {
                inferredCount += 1;
            }
        }

        const hasFolderCover = (fastScan || lightweightMode) ? false : await hasFolderCoverImage(filePath);
        items[filePath] = {
            title: next.title,
            artist: next.artist,
            album: next.album,
            hasEmbeddedCover: !!raw.hasEmbeddedCover,
            hasFolderCover,
            hasCover: !!raw.hasEmbeddedCover || hasFolderCover
        };
        refreshedCount += 1;
    }

    return {
        items,
        summary: {
            refreshedCount,
            inferredCount,
            cleanedCount,
            generatedAt: Date.now(),
            scanErrors: diagnostics.scanErrors.slice(0, 20),
            unreadableFiles: diagnostics.unreadableFiles.slice(0, 20)
        }
    };
}

async function buildLibraryStatsFromFolders(folders, metadataCache = {}, excludedFolders = [], audioExtensions = [], performanceOptions = {}) {
    const normalizedFolders = Array.isArray(folders)
        ? folders
            .map((folder) => ({
                path: String(folder?.path || '').trim(),
                name: String(folder?.name || '').trim()
            }))
            .filter((folder) => folder.path)
        : [];

    const excludedPaths = normalizeExcludedPaths(excludedFolders);
    const fastScan = performanceOptions?.fastScan !== false;
    const lightweightMode = !!performanceOptions?.lightweightMode;
    const diagnostics = {
        scanErrors: [],
        unreadableFiles: []
    };
    const allFiles = [];
    for (const folder of normalizedFolders) {
        await collectAudioFilesRecursive(folder.path, allFiles, excludedPaths, audioExtensions, diagnostics);
    }

    const uniqueFiles = Array.from(new Set(allFiles));
    return buildLibraryStatsFromFileList(uniqueFiles, metadataCache, performanceOptions, normalizedFolders.length, diagnostics);
}

async function buildLibraryStatsFromFileList(filePaths, metadataCache = {}, performanceOptions = {}, scannedFolderCount = 0, diagnostics = null) {
    const uniqueFiles = Array.isArray(filePaths)
        ? Array.from(new Set(filePaths.map((value) => String(value || '').trim()).filter(Boolean)))
        : [];
    const fastScan = performanceOptions?.fastScan !== false;
    const lightweightMode = !!performanceOptions?.lightweightMode;
    const artists = new Set();
    const albums = new Set();
    let totalDurationSec = 0;
    let missingMetadataCount = 0;
    let missingCoverCount = 0;
    const nextDiagnostics = diagnostics || {
        scanErrors: [],
        unreadableFiles: []
    };

    for (const filePath of uniqueFiles) {
        const rawMeta = readAudioTagMetadata(filePath);
        if (rawMeta.error) {
            nextDiagnostics.unreadableFiles.push({
                path: filePath,
                error: rawMeta.error
            });
        }
        const override = metadataCache && typeof metadataCache === 'object' ? metadataCache[filePath] || {} : {};
        const meta = {
            title: sanitizeMetadataString(override.title || rawMeta.title || ''),
            artist: sanitizeMetadataString(override.artist || rawMeta.artist || ''),
            album: sanitizeMetadataString(override.album || rawMeta.album || ''),
            hasEmbeddedCover: rawMeta.hasEmbeddedCover
        };
        if (meta.artist) artists.add(meta.artist.toLowerCase());
        if (meta.album) albums.add(meta.album.toLowerCase());

        if (!meta.title || !meta.artist || !meta.album) {
            missingMetadataCount += 1;
        }

        const hasCover = meta.hasEmbeddedCover || (!(fastScan || lightweightMode) && await hasFolderCoverImage(filePath));
        if (!hasCover) {
            missingCoverCount += 1;
        }

        if (!(fastScan || lightweightMode)) {
            totalDurationSec += await parseMediaDurationWithFfmpeg(filePath);
        }
    }

    return {
        totalSongs: uniqueFiles.length,
        totalArtists: artists.size,
        totalAlbums: albums.size,
        totalDurationSec: Math.round(totalDurationSec),
        missingMetadataCount,
        missingCoverCount,
        scannedFolderCount,
        generatedAt: Date.now(),
        scanErrors: nextDiagnostics.scanErrors.slice(0, 20),
        unreadableFiles: nextDiagnostics.unreadableFiles.slice(0, 20)
    };
}

async function buildLibraryStatsComposite(folders, extraFiles = [], metadataCache = {}, excludedFolders = [], audioExtensions = [], performanceOptions = {}) {
    const normalizedFolders = Array.isArray(folders)
        ? folders
            .map((folder) => ({
                path: String(folder?.path || '').trim(),
                name: String(folder?.name || '').trim()
            }))
            .filter((folder) => folder.path)
        : [];
    const excludedPaths = normalizeExcludedPaths(excludedFolders);
    const diagnostics = {
        scanErrors: [],
        unreadableFiles: []
    };
    const allFiles = [];
    for (const folder of normalizedFolders) {
        await collectAudioFilesRecursive(folder.path, allFiles, excludedPaths, audioExtensions, diagnostics);
    }
    const mergedFiles = [
        ...allFiles,
        ...(Array.isArray(extraFiles) ? extraFiles : [])
    ];
    return buildLibraryStatsFromFileList(
        mergedFiles,
        metadataCache,
        performanceOptions,
        normalizedFolders.length,
        diagnostics
    );
}

// Albüm kapağı çıkarma - ID3v2 veya ffmpeg kullan
async function extractEmbeddedCover(filePath) {
    try {
        // 1) Önce node-id3 dene (MP3/ID3 etiketli dosyalarda daha güvenilir)
        if (NodeID3) {
            try {
                const tags = NodeID3.read(filePath) || {};
                const img = tags?.image;
                if (img) {
                    let imageBuffer = null;
                    let mimeType = 'image/jpeg';
                    if (img.imageBuffer && Buffer.isBuffer(img.imageBuffer)) {
                        imageBuffer = img.imageBuffer;
                        mimeType = String(img.mime || mimeType);
                    } else if (Buffer.isBuffer(img)) {
                        imageBuffer = img;
                    }
                    if (imageBuffer && imageBuffer.length > 100) {
                        return toImageDataUrl(imageBuffer, mimeType);
                    }
                }
            } catch {
                // yoksay, fallback'lere geç
            }
        }

        // 2) ffmpeg ile attached picture dene (m4a/mp3/flac dahil)
        const ffmpegCover = await extractCoverWithFFmpeg(filePath);
        if (ffmpegCover) return ffmpegCover;

        // 3) Son çare: manuel ID3 okuma
        return await extractID3Cover(filePath);

    } catch (error) {
        console.log('Cover extraction failed:', error.message);
        return null;
    }
}

// ffmpeg ile M4A/MP4 dosyalarından album art çıkar
async function extractCoverWithFFmpeg(filePath) {
    return new Promise((resolve) => {
        const { spawn } = require('child_process');

        const ffmpegPath = getFfmpegPathForEnv();

        // Windows'ta ffmpeg yoksa yedek
        if (process.platform === 'win32' && app.isPackaged) {
            if (!fs.existsSync(ffmpegPath)) {
                console.log('ffmpeg.exe bundled değil, M4A album art çıkarılamayabilir');
                resolve(null);
                return;
            }
        }

        // Windows: ffmpeg klasörünü PATH'e ekle (dll/loader & codec uyumluluğu için)
        if (process.platform === 'win32') {
            try {
                prependToProcessPath(path.dirname(ffmpegPath));
            } catch {
                // yoksay
            }
        }

        // ffmpeg ile embedded image'ı pipe'la al
        const ffmpeg = spawn(ffmpegPath, [
            '-hide_banner',
            '-loglevel', 'error',
            '-i', filePath,
            '-map', '0:v:0?',
            '-an',
            '-frames:v', '1',
            '-c:v', 'mjpeg',
            '-f', 'image2pipe',
            'pipe:1'
        ]);

        const chunks = [];

        ffmpeg.stdout.on('data', (chunk) => {
            chunks.push(chunk);
        });

        ffmpeg.stderr.on('data', (data) => {
            // ffmpeg stderr'ı ignore et (verbose olabilir)
        });

        ffmpeg.on('close', (code) => {
            if (code === 0 && chunks.length > 0) {
                const imageBuffer = Buffer.concat(chunks);
                if (imageBuffer.length > 100) { // En az 100 byte olmalı
                    const base64 = imageBuffer.toString('base64');
                    console.log('ffmpeg ile kapak bulundu! Boyut:', base64.length);
                    resolve(`data:image/jpeg;base64,${base64}`);
                    return;
                }
            }
            console.log('ffmpeg ile kapak bulunamadı');
            resolve(null);
        });

        ffmpeg.on('error', (err) => {
            console.log('ffmpeg error:', err.message);
            resolve(null);
        });
    });
}

// ffmpeg ile videodan küçük resim al (JPEG)
async function extractVideoThumbnailWithFFmpeg(filePath) {
    return new Promise((resolve) => {
        const { spawn } = require('child_process');

        const ffmpegPath = getFfmpegPathForEnv();

        if (app.isPackaged && process.platform === 'win32' && !fs.existsSync(ffmpegPath)) {
            resolve(null);
            return;
        }

        if (process.platform === 'win32') {
            try {
                prependToProcessPath(path.dirname(ffmpegPath));
            } catch {
                // yoksay
            }
        }

        // 1. saniyeden 1 kare al (çok kısa videolarda yine de çalışır)
        const ffmpeg = spawn(ffmpegPath, [
            '-hide_banner',
            '-loglevel', 'error',
            '-ss', '00:00:01',
            '-i', filePath,
            '-frames:v', '1',
            '-vf', 'scale=512:-1',
            '-f', 'image2pipe',
            '-vcodec', 'mjpeg',
            'pipe:1'
        ]);

        const chunks = [];
        ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk));
        ffmpeg.stderr.on('data', () => { /* yoksay */ });

        ffmpeg.on('close', (code) => {
            if (code === 0 && chunks.length) {
                const imageBuffer = Buffer.concat(chunks);
                if (imageBuffer.length > 1000) {
                    const base64 = imageBuffer.toString('base64');
                    resolve(`data:image/jpeg;base64,${base64}`);
                    return;
                }
            }
            resolve(null);
        });

        ffmpeg.on('error', () => resolve(null));
    });
}

// ID3v2 için manuel cover çıkarma
async function extractID3Cover(filePath) {
    try {
        const buffer = await fs.promises.readFile(filePath);

        // ID3v2 header kontrolü
        if (buffer.slice(0, 3).toString() !== 'ID3') {
            return null;
        }

        // APIC kare ara (albüm kapağı)
        const apicIndex = buffer.indexOf('APIC');
        if (apicIndex === -1) return null;

        // Frame boyutunu oku
        const frameSize = buffer.readUInt32BE(apicIndex + 4);
        if (frameSize <= 0 || frameSize > 5000000) return null; // Max 5MB

        // MIME type'ı atla ve resim verisini bul
        let dataStart = apicIndex + 10;

        // MIME type'ı oku (null-terminated)
        let mimeEnd = buffer.indexOf(0, dataStart);
        if (mimeEnd === -1 || mimeEnd > dataStart + 50) return null;

        const mimeType = buffer.slice(dataStart, mimeEnd).toString('ascii') || 'image/jpeg';
        dataStart = mimeEnd + 1;

        // Picture type (1 byte) atla
        dataStart += 1;

        // Description (null-terminated) atla
        const descEnd = buffer.indexOf(0, dataStart);
        if (descEnd === -1) return null;
        dataStart = descEnd + 1;

        // Resim verisini çıkar
        const imageData = buffer.slice(dataStart, apicIndex + 10 + frameSize);

        if (imageData.length > 0) {
            return toImageDataUrl(imageData, mimeType);
        }

        return null;
    } catch (error) {
        return null;
    }
}

// ============================================
// C++ SES MOTORU IPC İŞLEYİCİLERİ
// ============================================

// Native ses motoru mevcut mu?
ipcMain.handle('audio:isNativeAvailable', () => {
    // Renderer preload genelde ilk açılışta bunu çağırır; burada lazy-init dene.
    try {
        if (!isNativeAudioAvailable) {
            initNativeAudioEngineSafe();
        }
    } catch (e) {
        // en iyi çaba
    }
    return isNativeAudioAvailable;
});

// Dosya yükle
ipcMain.handle('audio:loadFile', async (event, filePath) => {
    if (!audioEngine || !isNativeAudioAvailable) {
        try { initNativeAudioEngineSafe(); } catch { }
    }
    if (!audioEngine || !isNativeAudioAvailable) {
        console.warn('[MAIN] Native audio yok, loadFile atlandı');
        return { success: false, error: 'Native audio yok' };
    }
    const ok = audioEngine.loadFile(filePath);
    console.log('[MAIN] loadFile:', ok ? 'ok' : 'fail', filePath);
    if (ok) {
        applyPersistedEq32SfxFromSettings().catch(() => { /* yoksay */ });
    }
    return ok ? { success: true } : { success: false, error: 'Dosya yüklenemedi' };
});

// Gerçek örtüşmeli crossfade
ipcMain.handle('audio:crossfadeTo', async (event, filePath, durationMs) => {
    if (!audioEngine || !isNativeAudioAvailable) {
        return { success: false, error: 'Native audio yok' };
    }
    if (typeof audioEngine.crossfadeTo !== 'function') {
        return { success: false, error: 'Crossfade API yok' };
    }
    const ms = Math.max(0, Number(durationMs) || 0);
    const res = audioEngine.crossfadeTo(filePath, ms);
    const ok = (res === true) || (res && res.success);
    console.log('[MAIN] crossfadeTo:', ok ? 'ok' : 'fail', 'ms=', ms, filePath);
    if (ok) {
        applyPersistedEq32SfxFromSettings().catch(() => { /* yoksay */ });
    }
    return ok ? { success: true } : { success: false, error: (res && res.error) || 'Crossfade başarısız' };
});

// Oynat
ipcMain.handle('audio:play', () => {
    if (!audioEngine || !isNativeAudioAvailable) {
        console.error('[AUDIO] play: Native audio yok');
        return { success: false, error: 'Native audio engine yüklenmedi' };
    }
    try {
        audioEngine.play();
        return { success: true };
    } catch (e) {
        console.error('[AUDIO] play error:', e);
        return { success: false, error: e.message };
    }
});

// Duraklat
ipcMain.handle('audio:pause', () => {
    if (!audioEngine || !isNativeAudioAvailable) {
        console.error('[AUDIO] pause: Native audio yok');
        return { success: false, error: 'Native audio engine yüklenmedi' };
    }
    try {
        audioEngine.pause();
        return { success: true };
    } catch (e) {
        console.error('[AUDIO] pause error:', e);
        return { success: false, error: e.message };
    }
});

// Durdur
ipcMain.handle('audio:stop', () => {
    if (!audioEngine || !isNativeAudioAvailable) {
        console.error('[AUDIO] stop: Native audio yok');
        return { success: false, error: 'Native audio engine yüklenmedi' };
    }
    try {
        audioEngine.stop();
        return { success: true };
    } catch (e) {
        console.error('[AUDIO] stop error:', e);
        return { success: false, error: e.message };
    }
});

// Pozisyon atla
ipcMain.handle('audio:seek', (event, positionMs) => {
    if (!audioEngine || !isNativeAudioAvailable) {
        console.error('[AUDIO] seek: Native audio yok');
        return { success: false, error: 'Native audio engine yüklenmedi' };
    }
    try {
        audioEngine.seek(positionMs);
        return { success: true };
    } catch (e) {
        console.error('[AUDIO] seek error:', e);
        return { success: false, error: e.message };
    }
});

// Pozisyon al
ipcMain.handle('audio:getPosition', () => {
    if (!audioEngine || !isNativeAudioAvailable) return 0;
    try {
        return audioEngine.getPosition();
    } catch (e) {
        console.error('[AUDIO] getPosition error:', e);
        return 0;
    }
});

// Süre al
ipcMain.handle('audio:getDuration', () => {
    if (!audioEngine || !isNativeAudioAvailable) return 0;
    try {
        return audioEngine.getDuration();
    } catch (e) {
        console.error('[AUDIO] getDuration error:', e);
        return 0;
    }
});

// Çalıyor mu?
ipcMain.handle('audio:isPlaying', () => {
    if (!audioEngine || !isNativeAudioAvailable) return false;
    try {
        return audioEngine.isPlaying();
    } catch (e) {
        console.error('[AUDIO] isPlaying error:', e);
        return false;
    }
});

// Ses seviyesi ayarla
ipcMain.handle('audio:setVolume', (event, volume) => {
    if (!audioEngine || !isNativeAudioAvailable) {
        console.error('[AUDIO] setVolume: Native audio yok');
        return { success: false, error: 'Native audio engine yüklenmedi' };
    }
    try {
        audioEngine.setVolume(volume);
        return { success: true };
    } catch (e) {
        console.error('[AUDIO] setVolume error:', e);
        return { success: false, error: e.message };
    }
});

// Ses fade (native motor): yoğun IPC spam yerine main'de ramp
let volumeFadeTimer = null;
let volumeFadeResolve = null;

ipcMain.handle('audio:fadeVolumeTo', async (event, targetVolume, durationMs) => {
    try {
        if (!audioEngine || !isNativeAudioAvailable) return false;
        if (typeof audioEngine.getVolume !== 'function' || typeof audioEngine.setVolume !== 'function') return false;

        const target = Math.max(0, Math.min(1, Number(targetVolume)));
        const ms = Math.max(0, Number(durationMs) || 0);

        // Devam eden fade varsa iptal et
        if (volumeFadeTimer) {
            clearInterval(volumeFadeTimer);
            volumeFadeTimer = null;
        }
        if (typeof volumeFadeResolve === 'function') {
            try { volumeFadeResolve(false); } catch { }
            volumeFadeResolve = null;
        }

        const start = Math.max(0, Math.min(1, Number(audioEngine.getVolume()) || 0));
        if (ms === 0 || Math.abs(target - start) < 0.0005) {
            audioEngine.setVolume(target);
            return true;
        }

        const tickMs = 30;
        const steps = Math.max(1, Math.round(ms / tickMs));
        const delta = (target - start) / steps;
        let step = 0;

        return await new Promise((resolve) => {
            volumeFadeResolve = resolve;
            volumeFadeTimer = setInterval(() => {
                step++;
                const v = step >= steps ? target : (start + delta * step);
                audioEngine.setVolume(v);

                if (step >= steps) {
                    clearInterval(volumeFadeTimer);
                    volumeFadeTimer = null;
                    volumeFadeResolve = null;
                    resolve(true);
                }
            }, tickMs);
        });
    } catch (e) {
        console.error('[MAIN] audio:fadeVolumeTo error:', e);
        return false;
    }
});

// Ses seviyesini al
ipcMain.handle('audio:getVolume', () => {
    if (!audioEngine || !isNativeAudioAvailable) return 0;
    try {
        return audioEngine.getVolume ? audioEngine.getVolume() : 1;
    } catch (e) {
        console.error('[AUDIO] getVolume error:', e);
        return 0;
    }
});

// EQ band ayarla
ipcMain.handle('audio:setEQBand', (event, band, gainDB) => {
    try {
        if (!audioEngine || !isNativeAudioAvailable) {
            return { success: false, error: 'Native audio yok' };
        }
        audioEngine.setEQBand(band, gainDB);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Tüm EQ bantlarını ayarla
ipcMain.handle('audio:setEQBands', (event, gains) => {
    try {
        if (!audioEngine || !isNativeAudioAvailable) return { success: false, error: 'Native audio yok' };
        audioEngine.setEQBands(gains);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Stereo genişliği
ipcMain.handle('audio:setStereoWidth', (event, width) => {
    try {
        if (!audioEngine || !isNativeAudioAvailable) return { success: false, error: 'Native audio yok' };
        audioEngine.setStereoWidth(width);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Balance
ipcMain.handle('audio:setBalance', (event, balance) => {
    try {
        if (!audioEngine || !isNativeAudioAvailable) {
            return { success: false, error: 'Native audio yok' };
        }
        audioEngine.setBalance(balance);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// DSP aç/kapat
ipcMain.handle('audio:setDSPEnabled', (event, enabled) => {
    try {
        if (!audioEngine || !isNativeAudioAvailable) return { success: false, error: 'Native audio yok' };
        audioEngine.setDSPEnabled(enabled);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// FFT verisi (visualizer için)
ipcMain.handle('audio:getFFTData', () => {
    if (!audioEngine || !isNativeAudioAvailable) return [];
    return audioEngine.getFFTData();
});

// Spektrum bantları (visualizer için)
ipcMain.handle('audio:getSpectrumBands', (event, numBands) => {
    if (!audioEngine || !isNativeAudioAvailable) return [];
    return audioEngine.getSpectrumBands(numBands || 64);
});

// Ham PCM verisi (visualizer fallback için)
ipcMain.handle('audio:getPCMData', (event, framesPerChannel) => {
    if (!audioEngine || !isNativeAudioAvailable || typeof audioEngine.getPCMData !== 'function') {
        return { channels: 0, data: new Float32Array(0) };
    }
    try {
        const frames = Math.max(128, Math.min(4096, Number(framesPerChannel) || 1024));
        return audioEngine.getPCMData(frames);
    } catch {
        return { channels: 0, data: new Float32Array(0) };
    }
});

// Reverb parametreleri (destekleniyorsa)
ipcMain.handle('audio:setReverbParams', (event, roomSize, damping, wetDry) => {
    try {
        if (!audioEngine || !isNativeAudioAvailable) return { success: false, error: 'Native audio yok' };
        if (typeof audioEngine.setReverbParams === 'function') {
            audioEngine.setReverbParams(roomSize, damping, wetDry);
            return { success: true };
        }
        return { success: false, error: 'Reverb desteklenmiyor' };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Reverb aç/kapat
ipcMain.handle('audio:setReverbEnabled', (event, enabled) => {
    try {
        if (!audioEngine || !isNativeAudioAvailable) return { success: false, error: 'Native audio yok' };
        if (typeof audioEngine.setReverbEnabled === 'function') {
            audioEngine.setReverbEnabled(enabled);
            return { success: true };
        }
        return { success: false, error: 'Reverb desteklenmiyor' };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('audio:enableReverb', (event, enabled) => {
    try {
        if (!audioEngine || !isNativeAudioAvailable) return { success: false, error: 'Native audio yok' };
        if (typeof audioEngine.setReverbEnabled === 'function') {
            audioEngine.setReverbEnabled(enabled);
            return { success: true };
        }
        return { success: false, error: 'Reverb desteklenmiyor' };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Tone (Bass/Mid/Treble)
ipcMain.handle('audio:setToneParams', (event, bass, mid, treble) => {
    try {
        if (!audioEngine || !isNativeAudioAvailable) return { success: false, error: 'Native audio yok' };
        if (typeof audioEngine.setToneParams === 'function') {
            audioEngine.setToneParams(bass, mid, treble);
            return { success: true };
        }
        return { success: false, error: 'Tone desteklenmiyor' };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Bass ayarla (Aurivo Module)
ipcMain.handle('audio:setBass', (event, dB) => {
    try {
        if (!audioEngine || !isNativeAudioAvailable) return { success: false, error: 'Native audio yok' };
        audioEngine.setBass(dB);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Mid ayarla (Aurivo Module)
ipcMain.handle('audio:setMid', (event, dB) => {
    try {
        if (!audioEngine || !isNativeAudioAvailable) return { success: false, error: 'Native audio yok' };
        audioEngine.setMid(dB);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Treble ayarla (Aurivo Module)
ipcMain.handle('audio:setTreble', (event, dB) => {
    try {
        if (!audioEngine || !isNativeAudioAvailable) return { success: false, error: 'Native audio yok' };
        audioEngine.setTreble(dB);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Stereo Expander ayarla
ipcMain.handle('audio:setStereoExpander', (event, percent) => {
    try {
        if (!audioEngine || !isNativeAudioAvailable) return { success: false, error: 'Native audio yok' };
        audioEngine.setStereoExpander(percent);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ============================================
// AUTO GAIN / NORMALIZE IPC İŞLEYİCİLERİ
// ============================================
let lastAutoGainEnabledState = null;
ipcMain.handle('audio:setAutoGainEnabled', (event, enabled) => {
    const nextEnabled = enabled === true;
    try {
        if (!audioEngine || !isNativeAudioAvailable) {
            console.log('[MAIN] Native audio not available');
            return { success: false, error: 'Native audio yok' };
        }
        if (lastAutoGainEnabledState === nextEnabled) {
            return { success: true, skipped: true };
        }
        if (typeof audioEngine.setAutoGainEnabled === 'function') {
            audioEngine.setAutoGainEnabled(nextEnabled);
            // Native tarafta AGC kapatılırken ses 1.0'a dönebilen sürümler için
            // mevcut master volume'u tekrar uygula.
            if (!nextEnabled && typeof audioEngine.getVolume === 'function' && typeof audioEngine.setVolume === 'function') {
                const current = Math.max(0, Math.min(1, Number(audioEngine.getVolume()) || 0));
                audioEngine.setVolume(current);
            }
            lastAutoGainEnabledState = nextEnabled;
            return { success: true };
        }
        console.log('[MAIN] setAutoGainEnabled function not found');
        return { success: true };
    } catch (error) {
        console.error('[MAIN] setAutoGainEnabled error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('audio:setAutoGainTarget', (event, target) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setAutoGainTarget === 'function') {
        audioEngine.setAutoGainTarget(target);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:setAutoGainMaxGain', (event, maxGain) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setAutoGainMaxGain === 'function') {
        audioEngine.setAutoGainMaxGain(maxGain);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:setAutoGainAttack', (event, attack) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setAutoGainAttack === 'function') {
        audioEngine.setAutoGainAttack(attack);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:setAutoGainRelease', (event, release) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setAutoGainRelease === 'function') {
        audioEngine.setAutoGainRelease(release);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:setAutoGainMode', (event, mode) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setAutoGainMode === 'function') {
        audioEngine.setAutoGainMode(mode);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:updateAutoGain', () => {
    console.log('[MAIN] audio:updateAutoGain called');
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.updateAutoGain === 'function') {
        audioEngine.updateAutoGain();
        return { success: true };
    }
    console.log('[MAIN] updateAutoGain not available');
    return { success: false };
});

ipcMain.handle('audio:normalizeAudio', (event, targetDB) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.normalizeAudio === 'function') {
        const gain = audioEngine.normalizeAudio(targetDB);
        return { success: true, gain };
    }
    return { success: false };
});

ipcMain.handle('audio:resetAutoGain', () => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.resetAutoGain === 'function') {
        audioEngine.resetAutoGain();
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:getAutoGainStats', () => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.getAutoGainStats === 'function') {
        return audioEngine.getAutoGainStats();
    }
    return { enabled: false, peakLevel: -96, rmsLevel: -96, currentGain: 0 };
});

ipcMain.handle('audio:getPeakLevel', () => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.getPeakLevel === 'function') {
        return audioEngine.getPeakLevel();
    }
    return -96;
});

ipcMain.handle('audio:getChannelLevels', () => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.getChannelLevels === 'function') {
        try {
            const levels = audioEngine.getChannelLevels();
            const left = Number(Array.isArray(levels) ? levels[0] : levels?.left) || 0;
            const right = Number(Array.isArray(levels) ? levels[1] : levels?.right) || 0;
            return {
                left: Math.max(0, Math.min(1, left)),
                right: Math.max(0, Math.min(1, right))
            };
        } catch {
            // yoksay
        }
    }
    return { left: 0, right: 0 };
});

ipcMain.handle('audio:getGainReduction', () => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.getAutoGainReduction === 'function') {
        return audioEngine.getAutoGainReduction();
    }
    return 0;
});

// ============================================
// TRUE PEAK LIMITER + METER IPC İŞLEYİCİLERİ
// ============================================
ipcMain.handle('audio:setTruePeakEnabled', (event, enabled) => {
    console.log('[MAIN] audio:setTruePeakEnabled called with:', enabled);
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setTruePeakEnabled === 'function') {
        audioEngine.setTruePeakEnabled(enabled);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:setTruePeakCeiling', (event, ceiling) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setTruePeakCeiling === 'function') {
        audioEngine.setTruePeakCeiling(ceiling);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:setTruePeakRelease', (event, release) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setTruePeakRelease === 'function') {
        audioEngine.setTruePeakRelease(release);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:setTruePeakLookahead', (event, lookahead) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setTruePeakLookahead === 'function') {
        audioEngine.setTruePeakLookahead(lookahead);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:setTruePeakInputGain', (event, gain) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setTruePeakInputGain === 'function') {
        audioEngine.setTruePeakInputGain(gain);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:setTruePeakOversampling', (event, rate) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setTruePeakOversampling === 'function') {
        audioEngine.setTruePeakOversampling(rate);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:setTruePeakLinkChannels', (event, link) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setTruePeakLinkChannels === 'function') {
        audioEngine.setTruePeakLinkChannels(link);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:getTruePeakMeter', () => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.getTruePeakMeter === 'function') {
        return audioEngine.getTruePeakMeter();
    }
    return { peakL: -96, peakR: -96, truePeakL: -96, truePeakR: -96, holdL: -96, holdR: -96, clippingCount: 0 };
});

ipcMain.handle('audio:resetTruePeakClipping', () => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.resetTruePeakClipping === 'function') {
        audioEngine.resetTruePeakClipping();
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:resetTruePeakLimiter', () => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.resetTruePeakLimiter === 'function') {
        audioEngine.resetTruePeakLimiter();
        return { success: true };
    }
    return { success: false };
});

// EQ sıfırla
ipcMain.handle('audio:resetEQ', () => {
    try {
        if (!audioEngine || !isNativeAudioAvailable) return false;
        audioEngine.resetEQ();

        // Reset'i kalıcı olarak da kaydet
        updateEq32SettingsInFile({
            bands: new Array(32).fill(0),
            lastPreset: {
                filename: '__flat__',
                name: 'Düz (Flat)'
            }
        }).catch(() => { /* yoksay */ });

        return true;
    } catch (error) {
        return false;
    }
});

// Reverb Room Size
ipcMain.handle('audio:setReverbRoomSize', (event, ms) => {
    try {
        if (!audioEngine || !isNativeAudioAvailable) return { success: false };
        audioEngine.setReverbRoomSize(ms);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Reverb Damping
ipcMain.handle('audio:setReverbDamping', (event, value) => {
    try {
        if (!audioEngine || !isNativeAudioAvailable) return { success: false };
        audioEngine.setReverbDamping(value);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Reverb WetDry
ipcMain.handle('audio:setReverbWetDry', (event, dB) => {
    try {
        if (!audioEngine || !isNativeAudioAvailable) return { success: false };
        audioEngine.setReverbWetDry(dB);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Reverb HF Ratio
ipcMain.handle('audio:setReverbHFRatio', (event, ratio) => {
    try {
        if (!audioEngine || !isNativeAudioAvailable) return { success: false };
        audioEngine.setReverbHFRatio(ratio);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Reverb Input Gain
ipcMain.handle('audio:setReverbInputGain', (event, dB) => {
    try {
        if (!audioEngine || !isNativeAudioAvailable) return { success: false };
        audioEngine.setReverbInputGain(dB);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Preamp
ipcMain.handle('audio:setPreamp', (event, gainDB) => {
    if (!audioEngine || !isNativeAudioAvailable) return;
    if (typeof audioEngine.setPreamp === 'function') {
        console.log("[MAIN] Preamp set to", gainDB); audioEngine.setPreamp(gainDB);
    }
});

// Hardware Device Control
ipcMain.handle('audio:getDevices', (event) => {
    if (typeof initNativeAudioEngineSafe === 'function') initNativeAudioEngineSafe();
    if (!audioEngine || !isNativeAudioAvailable) return "[]";
    if (typeof audioEngine.getAudioDevices === 'function') {
        return audioEngine.getAudioDevices();
    }
    return "[]";
});

ipcMain.handle('audio:setDevice', (event, deviceId) => {
    if (!audioEngine || !isNativeAudioAvailable) return false;
    if (typeof audioEngine.setAudioDevice === 'function') {
        return audioEngine.setAudioDevice(deviceId);
    }
    return false;
});

// New Effects Handlers
ipcMain.handle('audio:setCompressor', (event, enabled, thresh, ratio, att, rel, makeup) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setCompressor === 'function') {
        audioEngine.setCompressor(enabled, thresh, ratio, att, rel, makeup);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:enableCompressor', (event, enabled) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.enableCompressor === 'function') {
        audioEngine.enableCompressor(enabled);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:setCompressorThreshold', (event, threshold) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setCompressorThreshold === 'function') {
        audioEngine.setCompressorThreshold(threshold);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:setCompressorRatio', (event, ratio) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setCompressorRatio === 'function') {
        audioEngine.setCompressorRatio(ratio);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:setCompressorAttack', (event, attack) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setCompressorAttack === 'function') {
        audioEngine.setCompressorAttack(attack);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:setCompressorRelease', (event, release) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setCompressorRelease === 'function') {
        audioEngine.setCompressorRelease(release);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:setCompressorMakeupGain', (event, makeupGain) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setCompressorMakeupGain === 'function') {
        audioEngine.setCompressorMakeupGain(makeupGain);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:setCompressorKnee', (event, knee) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setCompressorKnee === 'function') {
        audioEngine.setCompressorKnee(knee);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:getCompressorGainReduction', () => {
    if (!audioEngine || !isNativeAudioAvailable || typeof audioEngine.getCompressorGainReduction !== 'function') {
        return 0;
    }
    return audioEngine.getCompressorGainReduction();
});

ipcMain.handle('audio:resetCompressor', () => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.resetCompressor === 'function') {
        audioEngine.resetCompressor();
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:setGate', (event, enabled, thresh, att, rel) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setGate === 'function') {
        audioEngine.setGate(enabled, thresh, att, rel);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:setLimiter', (event, enabled, ceiling, rel) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setLimiter === 'function') {
        audioEngine.setLimiter(enabled, ceiling, rel);
        return { success: true };
    }
    return { success: false };
});

// Limiter tekil kontrolleri
ipcMain.handle('audio:enableLimiter', (event, enabled) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.EnableLimiter === 'function') {
        return audioEngine.EnableLimiter(enabled);
    }
    return false;
});

ipcMain.handle('audio:setLimiterCeiling', (event, ceiling) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetLimiterCeiling === 'function') {
        audioEngine.SetLimiterCeiling(ceiling);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setLimiterRelease', (event, release) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetLimiterRelease === 'function') {
        audioEngine.SetLimiterRelease(release);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setLimiterLookahead', (event, lookahead) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetLimiterLookahead === 'function') {
        audioEngine.SetLimiterLookahead(lookahead);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setLimiterGain', (event, gain) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetLimiterGain === 'function') {
        audioEngine.SetLimiterGain(gain);
        return true;
    }
    return false;
});

ipcMain.handle('audio:getLimiterReduction', (event) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.GetLimiterReduction === 'function') {
        return audioEngine.GetLimiterReduction();
    }
    return 0;
});

ipcMain.handle('audio:resetLimiter', (event) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.ResetLimiter === 'function') {
        audioEngine.ResetLimiter();
        return true;
    }
    return false;
});

// Bass Enhancer tekil kontrolleri
ipcMain.handle('audio:enableBassEnhancer', (event, enabled) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.EnableBassEnhancer === 'function') {
        return audioEngine.EnableBassEnhancer(enabled);
    }
    return false;
});

ipcMain.handle('audio:setBassEnhancerFrequency', (event, frequency) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetBassEnhancerFrequency === 'function') {
        audioEngine.SetBassEnhancerFrequency(frequency);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setBassEnhancerGain', (event, gain) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetBassEnhancerGain === 'function') {
        audioEngine.SetBassEnhancerGain(gain);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setBassEnhancerHarmonics', (event, harmonics) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetBassEnhancerHarmonics === 'function') {
        audioEngine.SetBassEnhancerHarmonics(harmonics);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setBassEnhancerWidth', (event, width) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetBassEnhancerWidth === 'function') {
        audioEngine.SetBassEnhancerWidth(width);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setBassEnhancerMix', (event, mix) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetBassEnhancerMix === 'function') {
        audioEngine.SetBassEnhancerMix(mix);
        return true;
    }
    return false;
});

ipcMain.handle('audio:resetBassEnhancer', (event) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.ResetBassEnhancer === 'function') {
        audioEngine.ResetBassEnhancer();
        return true;
    }
    return false;
});

// Noise Gate tekil kontrolleri
ipcMain.handle('audio:enableNoiseGate', (event, enabled) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.EnableNoiseGate === 'function') {
        return audioEngine.EnableNoiseGate(enabled);
    }
    return false;
});

ipcMain.handle('audio:setNoiseGateThreshold', (event, threshold) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetNoiseGateThreshold === 'function') {
        audioEngine.SetNoiseGateThreshold(threshold);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setNoiseGateAttack', (event, attack) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetNoiseGateAttack === 'function') {
        audioEngine.SetNoiseGateAttack(attack);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setNoiseGateHold', (event, hold) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetNoiseGateHold === 'function') {
        audioEngine.SetNoiseGateHold(hold);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setNoiseGateRelease', (event, release) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetNoiseGateRelease === 'function') {
        audioEngine.SetNoiseGateRelease(release);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setNoiseGateRange', (event, range) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetNoiseGateRange === 'function') {
        audioEngine.SetNoiseGateRange(range);
        return true;
    }
    return false;
});

ipcMain.handle('audio:getNoiseGateStatus', (event) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.GetNoiseGateStatus === 'function') {
        return audioEngine.GetNoiseGateStatus();
    }
    return false;
});

ipcMain.handle('audio:resetNoiseGate', (event) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.ResetNoiseGate === 'function') {
        audioEngine.ResetNoiseGate();
        return true;
    }
    return false;
});

// ============== DE-ESSER IPC HANDLERS ==============
ipcMain.handle('audio:enableDeEsser', (event, enable) => {
    console.log('[MAIN] audio:enableDeEsser called with:', enable);
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.EnableDeEsser === 'function') {
        console.log('[MAIN] Calling audioEngine.EnableDeEsser');
        audioEngine.EnableDeEsser(enable);
        return true;
    }
    console.log('[MAIN] audioEngine.EnableDeEsser not available');
    return false;
});

ipcMain.handle('audio:setDeEsserFrequency', (event, frequency) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetDeEsserFrequency === 'function') {
        audioEngine.SetDeEsserFrequency(frequency);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setDeEsserThreshold', (event, threshold) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetDeEsserThreshold === 'function') {
        audioEngine.SetDeEsserThreshold(threshold);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setDeEsserRatio', (event, ratio) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetDeEsserRatio === 'function') {
        audioEngine.SetDeEsserRatio(ratio);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setDeEsserRange', (event, range) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetDeEsserRange === 'function') {
        audioEngine.SetDeEsserRange(range);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setDeEsserListenMode', (event, listen) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetDeEsserListenMode === 'function') {
        audioEngine.SetDeEsserListenMode(listen);
        return true;
    }
    return false;
});

ipcMain.handle('audio:getDeEsserActivity', (event) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.GetDeEsserActivity === 'function') {
        return audioEngine.GetDeEsserActivity();
    }
    return 0;
});

ipcMain.handle('audio:resetDeEsser', (event) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.ResetDeEsser === 'function') {
        audioEngine.ResetDeEsser();
        return true;
    }
    return false;
});

// ============== EXCITER IPC HANDLERS ==============
ipcMain.handle('audio:enableExciter', (event, enable) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.EnableExciter === 'function') {
        audioEngine.EnableExciter(enable);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setExciterAmount', (event, amount) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetExciterAmount === 'function') {
        audioEngine.SetExciterAmount(amount);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setExciterFrequency', (event, frequency) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetExciterFrequency === 'function') {
        audioEngine.SetExciterFrequency(frequency);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setExciterHarmonics', (event, harmonics) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetExciterHarmonics === 'function') {
        audioEngine.SetExciterHarmonics(harmonics);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setExciterMix', (event, mix) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetExciterMix === 'function') {
        audioEngine.SetExciterMix(mix);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setExciterType', (event, type) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetExciterType === 'function') {
        audioEngine.SetExciterType(type);
        return true;
    }
    return false;
});

ipcMain.handle('audio:resetExciter', (event) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.ResetExciter === 'function') {
        audioEngine.ResetExciter();
        return true;
    }
    return false;
});

// ============================================
// STEREO WIDENER IPC İŞLEYİCİLERİ
// ============================================

ipcMain.handle('audio:enableStereoWidener', (event, enabled) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.EnableStereoWidener === 'function') {
        audioEngine.EnableStereoWidener(enabled);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setStereoWidenerWidth', (event, percent) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetStereoWidth === 'function') {
        audioEngine.SetStereoWidth(percent);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setStereoBassCutoff', (event, hz) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetStereoBassCutoff === 'function') {
        audioEngine.SetStereoBassCutoff(hz);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setStereoDelay', (event, ms) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetStereoDelay === 'function') {
        audioEngine.SetStereoDelay(ms);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setStereoWidenerBalance', (event, value) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetStereoBalance === 'function') {
        audioEngine.SetStereoBalance(value);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setStereoMonoLow', (event, enabled) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetStereoMonoLow === 'function') {
        audioEngine.SetStereoMonoLow(enabled);
        return true;
    }
    return false;
});

ipcMain.handle('audio:getStereoPhase', (event) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.GetStereoPhase === 'function') {
        return audioEngine.GetStereoPhase();
    }
    return 0.0;
});

ipcMain.handle('audio:resetStereoWidener', (event) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.ResetStereoWidener === 'function') {
        audioEngine.ResetStereoWidener();
        return true;
    }
    return false;
});

// ============== ECHO EFFECT IPC HANDLERS ==============

ipcMain.handle('audio:enableEchoEffect', (event, enabled) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.EnableEchoEffect === 'function') {
        return audioEngine.EnableEchoEffect(enabled);
    }
    return false;
});

ipcMain.handle('audio:setEchoDelay', (event, delayMs) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetEchoDelayTime === 'function') {
        return audioEngine.SetEchoDelayTime(delayMs);
    }
    return false;
});

ipcMain.handle('audio:setEchoFeedback', (event, feedback) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetEchoFeedback === 'function') {
        return audioEngine.SetEchoFeedback(feedback);
    }
    return false;
});

ipcMain.handle('audio:setEchoWetMix', (event, wetMix) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetEchoWetMix === 'function') {
        return audioEngine.SetEchoWetMix(wetMix);
    }
    return false;
});

ipcMain.handle('audio:setEchoDryMix', (event, dryMix) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetEchoDryMix === 'function') {
        return audioEngine.SetEchoDryMix(dryMix);
    }
    return false;
});

ipcMain.handle('audio:setEchoStereoMode', (event, stereo) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetEchoStereoMode === 'function') {
        return audioEngine.SetEchoStereoMode(stereo);
    }
    return false;
});

ipcMain.handle('audio:setEchoLowCut', (event, freq) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetEchoLowCut === 'function') {
        return audioEngine.SetEchoLowCut(freq);
    }
    return false;
});

ipcMain.handle('audio:setEchoHighCut', (event, freq) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetEchoHighCut === 'function') {
        return audioEngine.SetEchoHighCut(freq);
    }
    return false;
});

ipcMain.handle('audio:setEchoTempo', (event, bpm, division) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetEchoTempo === 'function') {
        return audioEngine.SetEchoTempo(bpm, division);
    }
    return false;
});

ipcMain.handle('audio:resetEchoEffect', (event) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.ResetEchoEffect === 'function') {
        return audioEngine.ResetEchoEffect();
    }
    return false;
});

// ============== SOFT ECHO EFFECT IPC HANDLERS ==============
ipcMain.handle('audio:enableSoftEchoEffect', (event, enabled) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.EnableSoftEchoEffect === 'function') {
        return audioEngine.EnableSoftEchoEffect(enabled);
    }
    return false;
});

ipcMain.handle('audio:setSoftEchoDelay', (event, delayMs) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetSoftEchoDelayTime === 'function') {
        return audioEngine.SetSoftEchoDelayTime(delayMs);
    }
    return false;
});

ipcMain.handle('audio:setSoftEchoFeedback', (event, feedback) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetSoftEchoFeedback === 'function') {
        return audioEngine.SetSoftEchoFeedback(feedback);
    }
    return false;
});

ipcMain.handle('audio:setSoftEchoWetMix', (event, wetMix) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetSoftEchoWetMix === 'function') {
        return audioEngine.SetSoftEchoWetMix(wetMix);
    }
    return false;
});

ipcMain.handle('audio:setSoftEchoDryMix', (event, dryMix) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetSoftEchoDryMix === 'function') {
        return audioEngine.SetSoftEchoDryMix(dryMix);
    }
    return false;
});

ipcMain.handle('audio:setSoftEchoStereoMode', (event, stereo) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetSoftEchoStereoMode === 'function') {
        return audioEngine.SetSoftEchoStereoMode(stereo);
    }
    return false;
});

ipcMain.handle('audio:setSoftEchoHighCut', (event, freq) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetSoftEchoHighCut === 'function') {
        return audioEngine.SetSoftEchoHighCut(freq);
    }
    return false;
});

ipcMain.handle('audio:resetSoftEchoEffect', (event) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.ResetSoftEchoEffect === 'function') {
        return audioEngine.ResetSoftEchoEffect();
    }
    return false;
});

// ============== CONVOLUTION REVERB IPC İŞLEYİCİLERİ ==============

ipcMain.handle('audio:enableConvolutionReverb', (event, enabled) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.EnableConvolutionReverb === 'function') {
        return audioEngine.EnableConvolutionReverb(enabled);
    }
    return false;
});

ipcMain.handle('audio:loadIRFile', (event, filepath) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.LoadIRFile === 'function') {
        return audioEngine.LoadIRFile(filepath);
    }
    return false;
});

ipcMain.handle('audio:setConvReverbRoomSize', (event, roomSize) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetConvReverbRoomSize === 'function') {
        return audioEngine.SetConvReverbRoomSize(roomSize);
    }
    return false;
});

ipcMain.handle('audio:setConvReverbDecay', (event, decay) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetConvReverbDecay === 'function') {
        return audioEngine.SetConvReverbDecay(decay);
    }
    return false;
});

ipcMain.handle('audio:setConvReverbDamping', (event, damping) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetConvReverbDamping === 'function') {
        return audioEngine.SetConvReverbDamping(damping);
    }
    return false;
});

ipcMain.handle('audio:setConvReverbWetMix', (event, wetMix) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetConvReverbWetMix === 'function') {
        return audioEngine.SetConvReverbWetMix(wetMix);
    }
    return false;
});

ipcMain.handle('audio:setConvReverbDryMix', (event, dryMix) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetConvReverbDryMix === 'function') {
        return audioEngine.SetConvReverbDryMix(dryMix);
    }
    return false;
});

ipcMain.handle('audio:setConvReverbPreDelay', (event, preDelay) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetConvReverbPreDelay === 'function') {
        return audioEngine.SetConvReverbPreDelay(preDelay);
    }
    return false;
});

ipcMain.handle('audio:setConvReverbRoomType', (event, roomType) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetConvReverbRoomType === 'function') {
        return audioEngine.SetConvReverbRoomType(roomType);
    }
    return false;
});

ipcMain.handle('audio:getIRPresets', (event) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.GetIRPresets === 'function') {
        return audioEngine.GetIRPresets();
    }
    return [];
});

ipcMain.handle('audio:resetConvolutionReverb', (event) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.ResetConvolutionReverb === 'function') {
        return audioEngine.ResetConvolutionReverb();
    }
    return false;
});

// ============================================
// CROSSFEED (Kulaklık İyileştirme)
// ============================================
ipcMain.handle('audio:enableCrossfeed', (event, enabled) => {
    if (audioEngine && isNativeAudioAvailable) {
        return audioEngine.enableCrossfeed(enabled);
    }
    return false;
});

ipcMain.handle('audio:setCrossfeedLevel', (event, percent) => {
    if (audioEngine && isNativeAudioAvailable) {
        return audioEngine.setCrossfeedLevel(percent);
    }
    return false;
});

ipcMain.handle('audio:setCrossfeedDelay', (event, ms) => {
    if (audioEngine && isNativeAudioAvailable) {
        return audioEngine.setCrossfeedDelay(ms);
    }
    return false;
});

ipcMain.handle('audio:setCrossfeedLowCut', (event, hz) => {
    if (audioEngine && isNativeAudioAvailable) {
        return audioEngine.setCrossfeedLowCut(hz);
    }
    return false;
});

ipcMain.handle('audio:setCrossfeedHighCut', (event, hz) => {
    if (audioEngine && isNativeAudioAvailable) {
        return audioEngine.setCrossfeedHighCut(hz);
    }
    return false;
});

ipcMain.handle('audio:setCrossfeedPreset', (event, preset) => {
    if (audioEngine && isNativeAudioAvailable) {
        return audioEngine.setCrossfeedPreset(preset);
    }
    return false;
});

ipcMain.handle('audio:getCrossfeedParams', (event) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.getCrossfeedParams === 'function') {
        return audioEngine.getCrossfeedParams();
    }
    return { enabled: false, level: 30, delay: 0.3, lowCut: 700, highCut: 4000, preset: 0 };
});

ipcMain.handle('audio:resetCrossfeed', (event) => {
    if (audioEngine && isNativeAudioAvailable) {
        return audioEngine.resetCrossfeed();
    }
    return false;
});

// ============================================
// SURROUND VIRTUALIZER (5.1/7.1 Simülasyon)
// ============================================
ipcMain.handle('audio:enableSurroundVirtualizer', (event, enabled) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.EnableSurroundVirtualizer === 'function') {
        return audioEngine.EnableSurroundVirtualizer(enabled);
    }
    return false;
});

ipcMain.handle('audio:setSurroundCenterLevel', (event, dB) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetSurroundCenterLevel === 'function') {
        return audioEngine.SetSurroundCenterLevel(dB);
    }
    return false;
});

ipcMain.handle('audio:setSurroundSideLevel', (event, dB) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetSurroundSideLevel === 'function') {
        return audioEngine.SetSurroundSideLevel(dB);
    }
    return false;
});

ipcMain.handle('audio:setSurroundLfeLevel', (event, dB) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetSurroundLfeLevel === 'function') {
        return audioEngine.SetSurroundLfeLevel(dB);
    }
    return false;
});

ipcMain.handle('audio:setSurroundCrossover', (event, hz) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetSurroundCrossover === 'function') {
        return audioEngine.SetSurroundCrossover(hz);
    }
    return false;
});

ipcMain.handle('audio:setSurroundRearDelay', (event, ms) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetSurroundRearDelay === 'function') {
        return audioEngine.SetSurroundRearDelay(ms);
    }
    return false;
});

ipcMain.handle('audio:setSurroundMix', (event, percent) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.SetSurroundMix === 'function') {
        return audioEngine.SetSurroundMix(percent);
    }
    return false;
});

ipcMain.handle('audio:resetSurroundVirtualizer', (event) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.ResetSurroundVirtualizer === 'function') {
        return audioEngine.ResetSurroundVirtualizer();
    }
    return false;
});

// ============================================
// BASS MONO (Düşük Frekansları Mono Birleştirme)
// ============================================
ipcMain.handle('audio:enableBassMono', (event, enabled) => {
    if (audioEngine && isNativeAudioAvailable) {
        return audioEngine.EnableBassMono ? audioEngine.EnableBassMono(enabled) : false;
    }
    return false;
});

ipcMain.handle('audio:setBassMonoCutoff', (event, hz) => {
    if (audioEngine && isNativeAudioAvailable) {
        return audioEngine.SetBassMonoCutoff ? audioEngine.SetBassMonoCutoff(hz) : false;
    }
    return false;
});

ipcMain.handle('audio:setBassMonoSlope', (event, slope) => {
    if (audioEngine && isNativeAudioAvailable) {
        return audioEngine.SetBassMonoSlope ? audioEngine.SetBassMonoSlope(slope) : false;
    }
    return false;
});

ipcMain.handle('audio:setBassMonoStereoWidth', (event, width) => {
    if (audioEngine && isNativeAudioAvailable) {
        return audioEngine.SetBassMonoStereoWidth ? audioEngine.SetBassMonoStereoWidth(width) : false;
    }
    return false;
});

ipcMain.handle('audio:resetBassMono', (event) => {
    if (audioEngine && isNativeAudioAvailable) {
        return audioEngine.ResetBassMono ? audioEngine.ResetBassMono() : false;
    }
    return false;
});

// ============================================
// DYNAMIC EQ IPC İŞLEYİCİLERİ
// ============================================
ipcMain.handle('audio:enableDynamicEQ', (event, enable) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.enableDynamicEQ === 'function') {
        return audioEngine.enableDynamicEQ(enable);
    }
    return false;
});

ipcMain.handle('audio:setDynamicEQFrequency', (event, hz) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setDynamicEQFrequency === 'function') {
        audioEngine.setDynamicEQFrequency(hz);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setDynamicEQGain', (event, dB) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setDynamicEQGain === 'function') {
        audioEngine.setDynamicEQGain(dB);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setDynamicEQQ', (event, q) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setDynamicEQQ === 'function') {
        audioEngine.setDynamicEQQ(q);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setDynamicEQThreshold', (event, dB) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setDynamicEQThreshold === 'function') {
        audioEngine.setDynamicEQThreshold(dB);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setDynamicEQAttack', (event, ms) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setDynamicEQAttack === 'function') {
        audioEngine.setDynamicEQAttack(ms);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setDynamicEQRelease', (event, ms) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setDynamicEQRelease === 'function') {
        audioEngine.setDynamicEQRelease(ms);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setDynamicEQRange', (event, dB) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setDynamicEQRange === 'function') {
        audioEngine.setDynamicEQRange(dB);
        return true;
    }
    return false;
});

// TAPE SATURATION IPC İŞLEYİCİLERİ
// ============================================
ipcMain.handle('audio:enableTapeSaturation', (event, enable) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.enableTapeSaturation === 'function') {
        return audioEngine.enableTapeSaturation(enable);
    }
    return false;
});

ipcMain.handle('audio:setTapeDrive', (event, dB) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setTapeDrive === 'function') {
        audioEngine.setTapeDrive(dB);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setTapeMix', (event, percent) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setTapeMix === 'function') {
        audioEngine.setTapeMix(percent);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setTapeTone', (event, value) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setTapeTone === 'function') {
        audioEngine.setTapeTone(value);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setTapeOutput', (event, dB) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setTapeOutput === 'function') {
        audioEngine.setTapeOutput(dB);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setTapeMode', (event, mode) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setTapeMode === 'function') {
        audioEngine.setTapeMode(mode);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setTapeHiss', (event, percent) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setTapeHiss === 'function') {
        audioEngine.setTapeHiss(percent);
        return true;
    }
    return false;
});

// BIT-DEPTH / DITHER IPC İŞLEYİCİLERİ
// ============================================
ipcMain.handle('audio:enableBitDepthDither', (event, enable) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.enableBitDepthDither === 'function') {
        return audioEngine.enableBitDepthDither(enable);
    }
    return false;
});

ipcMain.handle('audio:setBitDepth', (event, bits) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setBitDepth === 'function') {
        audioEngine.setBitDepth(bits);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setDitherType', (event, type) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setDitherType === 'function') {
        audioEngine.setDitherType(type);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setNoiseShaping', (event, shape) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setNoiseShaping === 'function') {
        audioEngine.setNoiseShaping(shape);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setDownsampleFactor', (event, factor) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setDownsampleFactor === 'function') {
        audioEngine.setDownsampleFactor(factor);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setBitDitherMix', (event, percent) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setBitDitherMix === 'function') {
        audioEngine.setBitDitherMix(percent);
        return true;
    }
    return false;
});

ipcMain.handle('audio:setBitDitherOutput', (event, dB) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setBitDitherOutput === 'function') {
        audioEngine.setBitDitherOutput(dB);
        return true;
    }
    return false;
});

ipcMain.handle('audio:resetBitDepthDither', (event) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.resetBitDepthDither === 'function') {
        return audioEngine.resetBitDepthDither();
    }
    return false;
});

ipcMain.handle('audio:setEcho', (event, enabled, delay, feedback, mix) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setEcho === 'function') {
        audioEngine.setEcho(enabled, delay, feedback, mix);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:setBassBoostDsp', (event, enabled, gain, freq) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setBassBoostDsp === 'function') {
        audioEngine.setBassBoostDsp(enabled, gain, freq);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:setPEQ', (event, band, enabled, freq, gain, q) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setPEQ === 'function') {
        audioEngine.setPEQ(band, enabled, freq, gain, q);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('audio:setPEQFilterType', (event, band, filterType) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setPEQFilterType === 'function') {
        const result = audioEngine.setPEQFilterType(band, filterType);
        return { success: result };
    }
    return { success: false };
});

ipcMain.handle('audio:getPEQBand', (event, band) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.getPEQBand === 'function') {
        const bandData = audioEngine.getPEQBand(band);
        return { success: true, data: bandData };
    }
    return { success: false, data: null };
});

ipcMain.handle('audio:setBassBoost', (event, value) => {
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setBassBoost === 'function') { // Legacy 0-100
        audioEngine.setBassBoost(value);
        return { success: true };
    }
    return { success: false };
});

// ============================================
// AUTOEQ PRESET IPC İŞLEYİCİLERİ
// ============================================

// Preset klasörü yolu (packaged/app.asar içinden okunur)
const presetsPath = getAppFilePath(path.join('resources', 'autoeq'));

function clampNumber(v, min, max) {
    const n = Number(v);
    if (!Number.isFinite(n)) return min;
    return Math.min(Math.max(n, min), max);
}

function normalize32Bands(bands, minDb = -12, maxDb = 12) {
    const out = new Array(32).fill(0);
    if (!Array.isArray(bands)) return out;
    for (let i = 0; i < 32; i++) {
        out[i] = clampNumber(bands[i], minDb, maxDb);
    }
    return out;
}

function makeBandsFromPoints(points, minDb = -12, maxDb = 12) {
    const out = new Array(32).fill(0);
    if (!Array.isArray(points) || points.length === 0) return out;

    const sorted = points
        .filter(p => p && Number.isFinite(p.i) && Number.isFinite(p.v))
        .map(p => ({ i: clampNumber(Math.round(p.i), 0, 31), v: clampNumber(p.v, minDb, maxDb) }))
        .sort((a, b) => a.i - b.i);

    if (sorted.length === 0) return out;

    for (let i = 0; i <= sorted[0].i; i++) out[i] = sorted[0].v;

    for (let p = 0; p < sorted.length - 1; p++) {
        const a = sorted[p];
        const b = sorted[p + 1];
        const span = Math.max(1, b.i - a.i);
        for (let i = a.i; i <= b.i; i++) {
            const t = (i - a.i) / span;
            out[i] = a.v + (b.v - a.v) * t;
        }
    }

    for (let i = sorted[sorted.length - 1].i; i < 32; i++) out[i] = sorted[sorted.length - 1].v;
    return normalize32Bands(out, minDb, maxDb);
}

function loadAurivoEQBuiltins() {
    // JSON ile ayarlanabilir (ince ayar için)
    const filePath = getAppFilePath(path.join('resources', 'aurivo', 'eq_presets.json'));
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        const minDb = Number.isFinite(parsed?.minDb) ? parsed.minDb : -12;
        const maxDb = Number.isFinite(parsed?.maxDb) ? parsed.maxDb : 12;
        const presets = Array.isArray(parsed?.presets) ? parsed.presets : [];

        const map = {};
        const list = [];
        for (const p of presets) {
            if (!p?.id || !p?.name) continue;
            const bands = Array.isArray(p.bands)
                ? normalize32Bands(p.bands, minDb, maxDb)
                : makeBandsFromPoints(p.points || [], minDb, maxDb);

            const entry = {
                name: String(p.name),
                description: p.description ? String(p.description) : '',
                category: 'Aurivo',
                preamp: Number.isFinite(p.preamp) ? p.preamp : 0,
                bands
            };

            map[String(p.id)] = entry;
            list.push({ filename: String(p.id), name: entry.name, description: entry.description, bands: entry.bands });
        }

        return { map, list };
    } catch (e) {
        console.warn('[Aurivo EQ] resources/aurivo/eq_presets.json okunamadı:', e?.message || e);
        return { map: {}, list: [] };
    }
}

const AURIVO_EQ_BUILTINS_LOADED = loadAurivoEQBuiltins();
const AURIVO_EQ_BUILTINS = AURIVO_EQ_BUILTINS_LOADED.map;
const AURIVO_EQ_FEATURED_LIST = [
    { filename: '__flat__', name: 'Düz (Flat)', description: 'Tüm bantlar 0.0 dB', bands: new Array(32).fill(0) },
    ...AURIVO_EQ_BUILTINS_LOADED.list
];

// Preset listesi önbelleği
let presetListCache = null;

function computeEq32GroupsFromData({ filename, name, description, preset }) {
    const hay = `${name || ''} ${filename || ''} ${description || ''}`.toLowerCase();
    const groups = new Set();

    // Keyword tabanlı (varsa direkt yakala)
    if (/(^|\s)(jazz)(\s|$)/.test(hay) || hay.includes('caz')) groups.add('jazz');
    if (/(^|\s)(classical|orchestra|orchestral)(\s|$)/.test(hay) || hay.includes('klasik')) groups.add('classical');
    if (/(^|\s)(electronic|edm|dance|club|techno|house|trance)(\s|$)/.test(hay) || hay.includes('elektronik')) groups.add('electronic');
    if (/(^|\s)(pop)(\s|$)/.test(hay)) groups.add('pop');
    if (/(^|\s)(rock|metal|guitar)(\s|$)/.test(hay)) groups.add('rock');
    if (/(v\s*-?\s*shape|vshape)/.test(hay)) groups.add('vshape');
    if (/(^|\s)(vocal|voice|speech)(\s|$)/.test(hay) || hay.includes('vokal')) groups.add('vocal');
    if (/(^|\s)(bass|sub\s*-?bass|low\s*end|xbass|bass[_\s-]?boost)(\s|$)/.test(hay)) groups.add('bass');
    if (/(^|\s)(treble|bright|sparkle|air|high\s*boost|treble[_\s-]?boost)(\s|$)/.test(hay) || hay.includes('tiz')) groups.add('treble');
    if (/(^|\s)(flat|neutral|reference|default|eq[_\s-]?off|off)(\s|$)/.test(hay) || /d\s*ü\s*z/.test(hay)) groups.add('flat');

    // Bant analizine dayalı otomatik gruplama (isimde ipucu yoksa bile çalışır)
    const bands = normalize32Bands(preset?.bands, -12, 12);
    const absMax = Math.max(...bands.map(v => Math.abs(v)));

    const avg = (start, end) => {
        let s = 0;
        let c = 0;
        for (let i = start; i <= end; i++) {
            s += bands[i] || 0;
            c++;
        }
        return c ? s / c : 0;
    };

    const lowAvg = avg(0, 9);   // ~20-160 Hz
    const midAvg = avg(10, 21); // ~200-4 kHz
    const highAvg = avg(22, 31); // ~5 kHz+

    if (absMax <= 0.6) {
        groups.add('flat');
    }

    // Bas / Tiz vurgusu
    if (lowAvg - midAvg >= 1.2 || lowAvg >= 1.0) groups.add('bass');
    if (highAvg - midAvg >= 1.2 || highAvg >= 1.0) groups.add('treble');

    // Vokal (mid/presence öne çıkıyorsa)
    if (midAvg - ((lowAvg + highAvg) / 2) >= 1.0 && midAvg >= 0.8) groups.add('vocal');

    // V-shape (bas+tiz, mid düşük)
    if (lowAvg >= 0.9 && highAvg >= 0.9 && midAvg <= -0.4) groups.add('vshape');

    if (groups.size === 0) groups.add('other');
    return Array.from(groups);
}

async function buildPresetListCacheIfNeeded() {
    if (presetListCache) return presetListCache;

    try {
        const files = await fs.promises.readdir(presetsPath);
        const jsonFiles = files.filter(f => f.endsWith('.json'));

        const presetList = [];
        const batchSize = 40;
        for (let i = 0; i < jsonFiles.length; i += batchSize) {
            const batch = jsonFiles.slice(i, i + batchSize);
            const results = await Promise.allSettled(batch.map(async (f) => {
                const filePath = path.join(presetsPath, f);
                const raw = await fs.promises.readFile(filePath, 'utf8');
                const parsed = JSON.parse(raw);
                const name = (parsed?.name && String(parsed.name).trim())
                    ? String(parsed.name).trim()
                    : f.replace(/\.json$/i, '').replace(/_/g, ' ');
                const description = parsed?.description ? String(parsed.description) : '';
                const groups = computeEq32GroupsFromData({
                    filename: f,
                    name,
                    description,
                    preset: parsed
                });
                return { filename: f, name, groups };
            }));

            for (const r of results) {
                if (r.status === 'fulfilled' && r.value) presetList.push(r.value);
            }
        }

        presetList.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        presetListCache = presetList;
        const groupCounts = presetList.reduce((acc, p) => {
            const gs = Array.isArray(p.groups) ? p.groups : [];
            for (const g of gs) acc[g] = (acc[g] || 0) + 1;
            return acc;
        }, {});
        console.log(`AutoEQ: ${presetList.length} preset yüklendi (gruplu)`);
        console.log('[AutoEQ] Grup dağılımı:', groupCounts);
        return presetListCache;
    } catch (error) {
        console.error('Preset listesi okunamadı:', error);
        presetListCache = [];
        return presetListCache;
    }
}

// Tüm presetleri listele
ipcMain.handle('presets:loadList', async () => {
    return await buildPresetListCacheIfNeeded();
});

// Belirli bir preset'i yükle
ipcMain.handle('presets:load', async (event, filename) => {
    try {
        const filePath = path.join(presetsPath, filename);
        const data = await fs.promises.readFile(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Preset yüklenemedi:', filename, error);
        return null;
    }
});

// Presetlerde ara
ipcMain.handle('presets:search', async (event, query) => {
    try {
        const list = await buildPresetListCacheIfNeeded();

        const q = String(query || '').toLowerCase();
        if (!q) return list;

        return list.filter(p => (p?.name || '').toLowerCase().includes(q));
    } catch (error) {
        console.error('Preset araması başarısız:', error);
        return [];
    }
});

// EQ preset seçimi (Hazır Ayarlar penceresinden)
ipcMain.handle('eqPresets:select', async (event, filename) => {
    try {
        let preset = null;

        if (filename === '__flat__') {
            preset = {
                name: 'Düz (Flat)',
                description: 'Tüm bantlar 0.0 dB',
                category: 'Aurivo',
                preamp: 0,
                bands: new Array(32).fill(0)
            };
        } else if (AURIVO_EQ_BUILTINS[filename]) {
            preset = AURIVO_EQ_BUILTINS[filename];
        } else {
            const filePath = path.join(presetsPath, filename);
            const data = await fs.promises.readFile(filePath, 'utf8');
            preset = JSON.parse(data);
        }

        const payload = {
            filename,
            preset
        };

        // Kalıcı olarak kaydet (tek kaynak: settings.json)
        const bands = normalizeEq32BandsForEngine(preset?.bands);
        const presetName = preset?.name || (filename === '__flat__' ? 'Düz (Flat)' : String(filename || ''));

        await updateEq32SettingsInFile({
            bands,
            lastPreset: {
                filename,
                name: presetName
            }
        });

        // Engine'e uygula (Ses Efektleri penceresi kapalı olsa bile geçerli olsun)
        if (audioEngine && isNativeAudioAvailable) {
            try {
                if (typeof audioEngine.setEQBands === 'function') {
                    audioEngine.setEQBands(bands);
                } else if (typeof audioEngine.setEQBand === 'function') {
                    bands.forEach((v, i) => audioEngine.setEQBand(i, v));
                }
            } catch {
                // en iyi çaba
            }
        }

        // Sound Effects penceresine gönder
        if (soundEffectsWindow && !soundEffectsWindow.isDestroyed()) {
            soundEffectsWindow.webContents.send('audio:eqPresetSelected', payload);
            soundEffectsWindow.focus();
        }

        // Ana pencereye de gönder (ileride gerekebilir)
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('audio:eqPresetSelected', payload);
        }

        // Preset penceresini kapat
        if (eqPresetsWindow && !eqPresetsWindow.isDestroyed()) {
            eqPresetsWindow.close();
        }

        return { success: true };
    } catch (error) {
        console.error('EQ preset uygulanamadı:', filename, error);
        return { success: false, error: String(error?.message || error) };
    }
});

// Uygulama kapanırken temizlik
app.on('before-quit', () => {
    if (audioEngine) {
        audioEngine.cleanup();
    }
});
