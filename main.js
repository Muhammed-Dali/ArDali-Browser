const { app, BrowserWindow, ipcMain, dialog, nativeImage, Tray, Menu, shell, session, screen, globalShortcut, desktopCapturer, clipboard } = require('electron');

// Wayland/Flatpak: App ID synchronization must happen as early as possible.
const FLATPAK_APP_ID = 'com.ardali.mediaplayer';
const DESKTOP_FILE_ID = 'com.ardali.mediaplayer.desktop';
const LINUX_WM_CLASS = 'ardali';
const LINUX_WAYLAND_APP_ID = FLATPAK_APP_ID;

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
const crypto = require('crypto');
const https = require('https');
const { registerPulseIpc } = require('./modules/pulseHost');
const {
    normalizeAdblockConfig,
    shouldBlockRequest,
    evaluateDnrHeaderModifications,
    getRulesetSummary
} = require('./modules/adblock-engine');
const {
    RULESET_ROOT_DIR: ADBLOCK_RULESET_ROOT_DIR,
    getActiveRulesetPlan,
    getDevelopRulesetDetails,
    getRulesetAssetPath,
    readJsonFileSafe
} = require('./modules/adblock-ruleset-registry');
const { createDownloaderService } = require('./modules/downloaderService');
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

function isDisabledEnvFlag(name) {
    const value = String(process.env?.[name] || '').trim().toLowerCase();
    return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

function shouldEnableLinuxVaapi() {
    if (process.platform !== 'linux') return false;
    if (isDisabledEnvFlag('ARDALI_DISABLE_VAAPI')) return false;
    return true;
}

function shouldEnableAcceleratedVideoDecode() {
    if (isDisabledEnvFlag('ARDALI_DISABLE_ACCELERATED_VIDEO_DECODE')) return false;
    if (process.platform === 'linux') return shouldEnableLinuxVaapi();
    return isTruthyEnvFlag('ARDALI_ENABLE_ACCELERATED_VIDEO_DECODE');
}

function appendCommandLineCsvSwitch(name, csv) {
    if (!app?.commandLine || !csv) return;
    try {
        const current = app.commandLine.getSwitchValue(name) || '';
        const values = new Set(
            current
                .split(',')
                .concat(String(csv).split(','))
                .map((item) => String(item || '').trim())
                .filter(Boolean)
        );
        app.commandLine.appendSwitch(name, [...values].join(','));
    } catch {
        // en iyi çaba
    }
}

function isFlatpakRuntime() {
    if (process.platform !== 'linux') return false;
    const flatpakId = String(process.env.FLATPAK_ID || process.env.APP_ID || '').trim();
    if (flatpakId.length > 0) return true;
    try {
        return fs.existsSync('/.flatpak-info');
    } catch {
        return false;
    }
}

function isPackagedLinuxConservativeGpuMode() {
    if (process.platform !== 'linux') return false;
    // YouTube ve sosyal medya platformlarında video/ses takılmalarını çözmek için 
    // agresif GPU hızlandırma artık varsayılan olarak AÇIK bırakılmıştır.
    return process.env.ARDALI_FORCE_CONSERVATIVE_GPU === '1';
}

function shouldEnableWebviewAdblockPreloadOnThisRuntime() {
    if (isTruthyEnvFlag('ARDALI_DISABLE_WEBVIEW_ADBLOCK_PRELOAD')) return false;
    if (isTruthyEnvFlag('ARDALI_WEBVIEW_ADBLOCK_PRELOAD')) return true;
    return true;
}

function shouldUseRelaxedWebTimers(startupWebUi = readStartupWebUiSettings()) {
    return startupWebUi?.backgroundThrottle === false || isTruthyEnvFlag('ARDALI_RELAX_WEB_TIMERS');
}

function shouldEnableElectronUpdaterOnThisRuntime() {
    if (isFlatpakRuntime()) return false;
    // Linux/AUR kurulumlarında electron-updater yerine paket yöneticisi (yay/pacman) akışı kullanılmalı.
    // Bu akış bazı ortamlarda gereksiz crash riskini artırdığı için varsayılan kapalı.
    if (process.platform === 'linux' && app.isPackaged) {
        return isTruthyEnvFlag('ARDALI_ENABLE_ELECTRON_UPDATER');
    }
    return true;
}

function commandExists(command) {
    try {
        // Security: Pass command as a direct argument to 'which' instead of
        // interpolating into a shell string to prevent shell injection.
        const sanitized = String(command || '').trim();
        if (!sanitized || /[^a-zA-Z0-9._-]/.test(sanitized)) return false;
        const res = spawnSync('which', [sanitized], {
            encoding: 'utf8',
            timeout: 1200,
            shell: false
        });
        return res.status === 0;
    } catch {
        return false;
    }
}

function findExecutable(command, extraDirs = []) {
    const sanitized = String(command || '').trim();
    if (!sanitized || /[^a-zA-Z0-9._/-]/.test(sanitized)) return '';
    const candidates = [];
    if (path.isAbsolute(sanitized)) {
        candidates.push(sanitized);
    } else {
        const dirs = [
            ...String(process.env.PATH || '').split(path.delimiter),
            ...(Array.isArray(extraDirs) ? extraDirs : [])
        ];
        const seen = new Set();
        for (const dir of dirs) {
            const cleanDir = String(dir || '').trim();
            if (!cleanDir || seen.has(cleanDir)) continue;
            seen.add(cleanDir);
            candidates.push(path.join(cleanDir, sanitized));
        }
    }
    for (const candidate of candidates) {
        try {
            fs.accessSync(candidate, fs.constants.X_OK);
            return candidate;
        } catch {
            // sonraki aday
        }
    }
    return '';
}

function sanitizeIpcPath(value, { requireAbsolute = true } = {}) {
    const targetPath = String(value || '').trim();
    if (!targetPath || targetPath.includes('\0')) return '';
    if (requireAbsolute && !path.isAbsolute(targetPath)) return '';
    return path.normalize(targetPath);
}

function isArDaliBinInstalledViaPacman() {
    if (process.platform !== 'linux') return false;
    if (!commandExists('pacman')) return false;
    try {
        const res = spawnSync('pacman', ['-Q', 'ardali-bin'], {
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
    if (isFlatpakRuntime()) {
        return {
            aurUpdateSupported: false,
            aurPackageInstalled: false,
            hasYay: false
        };
    }
    const hasYay = commandExists('yay');
    const aurPackageInstalled = hasYay && isArDaliBinInstalledViaPacman();
    return {
        aurUpdateSupported: hasYay,
        aurPackageInstalled,
        hasYay
    };
}

function trySpawnDetached(command, args, probeMs = 450) {
    return new Promise((resolve) => {
        let settled = false;
        let child = null;

        const finish = (ok) => {
            if (settled) return;
            settled = true;
            try { child?.unref?.(); } catch { /* yoksay */ }
            resolve(Boolean(ok));
        };

        try {
            child = spawn(command, args, {
                detached: true,
                stdio: 'ignore'
            });
        } catch {
            finish(false);
            return;
        }

        child.once('error', () => finish(false));

        child.once('spawn', () => {
            // Bazı terminal komutları geçersiz argümanla anında kapanabiliyor.
            // Çok kısa bir pencere bekleyip hala canlıysa başarılı kabul et.
            setTimeout(() => {
                if (settled) return;
                const exitedEarly = child.exitCode !== null;
                finish(!exitedEarly);
            }, Math.max(120, Number(probeMs) || 450));
        });

        child.once('exit', () => {
            if (!settled) finish(false);
        });

        // Güvenlik ağı: beklenmedik bir durumda promise asılı kalmasın.
        setTimeout(() => {
            if (!settled) finish(false);
        }, Math.max(900, (Number(probeMs) || 450) + 700));
    });
}

function shellQuote(value) {
    return `'${String(value || '').replace(/'/g, `'\\''`)}'`;
}

function resolveLinuxRelaunchExecPath() {
    if (process.platform !== 'linux' || !app.isPackaged) return '';
    const appImagePath = String(process.env.APPIMAGE || '').trim();
    if (appImagePath && fs.existsSync(appImagePath)) return appImagePath;
    const wrapperPath = '/usr/bin/ardali';
    if (fs.existsSync(wrapperPath)) return wrapperPath;
    return '';
}

function getAppRelaunchArgs() {
    return Array.isArray(process.argv)
        ? process.argv.slice(1).filter((arg) => typeof arg === 'string' && arg.length > 0)
        : [];
}

function shouldUseAppImageExtractAndRunForRelaunch() {
    if (process.platform !== 'linux' || !app.isPackaged) return false;
    const appImagePath = String(process.env.APPIMAGE || '').trim();
    if (!appImagePath || !fs.existsSync(appImagePath)) return false;
    if (isTruthyEnvFlag('APPIMAGE_EXTRACT_AND_RUN')) return false;
    try {
        return !fs.existsSync('/dev/fuse');
    } catch {
        return true;
    }
}

function relaunchAppImageWithExtractAndRun(args) {
    const execPath = resolveLinuxRelaunchExecPath();
    if (!execPath) return false;
    try {
        const child = spawn(execPath, Array.isArray(args) ? args : [], {
            detached: true,
            stdio: 'ignore',
            env: {
                ...process.env,
                APPIMAGE_EXTRACT_AND_RUN: '1'
            }
        });
        child.unref();
        return true;
    } catch (error) {
        console.error('[APP] AppImage extract-and-run relaunch failed:', error?.message || error);
        return false;
    }
}

function buildAppRelaunchOptions() {
    const args = getAppRelaunchArgs();
    const execPath = resolveLinuxRelaunchExecPath();
    if (execPath) {
        return { execPath, args };
    }
    if (process.platform === 'linux' && app.isPackaged) {
        return null;
    }
    return {
        execPath: process.execPath,
        args
    };
}

function buildPostUpdateLaunchCommand() {
    const appImagePath = resolveLinuxRelaunchExecPath();
    if (appImagePath) {
        return `nohup ${shellQuote(appImagePath)} >/dev/null 2>&1 &`;
    }
    if (commandExists('ardali')) {
        return 'nohup ardali >/dev/null 2>&1 &';
    }
    if (commandExists('gtk-launch')) {
        return `nohup gtk-launch ${DESKTOP_FILE_ID} >/dev/null 2>&1 &`;
    }
    return '';
}

function writeArDaliUpdateScript() {
    const launchCommand = buildPostUpdateLaunchCommand();
    const scriptPath = path.join(os.tmpdir(), `ardali-update-${Date.now()}.sh`);
    const lines = [
        '#!/usr/bin/env bash',
        'set +e',
        'printf "\\nArDali (AUR) guncelleniyor...\\n\\n"',
        'yay -S ardali-bin',
        'exit_code=$?',
        'printf "\\nIslem tamamlandi (kod: %s).\\n" "$exit_code"',
        'if [ "$exit_code" -eq 0 ]; then'
    ];
    if (launchCommand) {
        lines.push('  printf "Yeni surum baslatiliyor...\\n"');
        lines.push(`  ${launchCommand}`);
        lines.push('  sleep 0.8');
        lines.push('  exit 0');
    } else {
        lines.push('  printf "Guncelleme tamamlandi. Uygulamayi elle yeniden acabilirsiniz.\\n"');
        lines.push('  printf "Kapatmak icin Enter...\\n"');
        lines.push('  read -r _');
        lines.push('  exit 0');
    }
    lines.push('fi');
    lines.push('printf "Guncelleme basarisiz. Kapatmak icin Enter...\\n"');
    lines.push('read -r _');
    fs.writeFileSync(scriptPath, `${lines.join('\n')}\n`, { mode: 0o700 });
    return scriptPath;
}

async function launchArDaliBinUpdateTerminal() {
    if (process.platform !== 'linux') {
        return { ok: false, reason: 'unsupported-platform' };
    }
    if (isFlatpakRuntime()) {
        return { ok: false, reason: 'flatpak-runtime' };
    }
    if (!commandExists('yay')) {
        return { ok: false, reason: 'yay-not-found' };
    }

    let updateScriptPath = '';
    try {
        updateScriptPath = writeArDaliUpdateScript();
    } catch (error) {
        console.error('[UPDATE] temporary update script could not be created:', error);
        return { ok: false, reason: 'script-create-failed' };
    }

    const attempts = [
        // Freedesktop uyumlu varsayılan terminal köprüsü
        ['xdg-terminal-exec', ['bash', updateScriptPath]],
        ['x-terminal-emulator', ['-e', 'bash', updateScriptPath]],
        ['gnome-terminal', ['--', 'bash', updateScriptPath]],
        ['kgx', ['--', 'bash', updateScriptPath]], // GNOME Console
        ['ptyxis', ['--', 'bash', updateScriptPath]], // GNOME Ptyxis
        ['konsole', ['-e', 'bash', updateScriptPath]],
        ['xfce4-terminal', ['--command', `bash ${shellQuote(updateScriptPath)}`]],
        ['mate-terminal', ['--', 'bash', updateScriptPath]],
        ['tilix', ['--', 'bash', updateScriptPath]],
        ['qterminal', ['-e', 'bash', updateScriptPath]],
        ['lxterminal', ['-e', 'bash', updateScriptPath]],
        ['terminator', ['-x', 'bash', updateScriptPath]],
        ['kitty', ['bash', updateScriptPath]],
        ['wezterm', ['start', '--', 'bash', updateScriptPath]],
        ['alacritty', ['-e', 'bash', updateScriptPath]],
        ['xterm', ['-e', 'bash', updateScriptPath]]
    ];

    for (const [cmd, args] of attempts) {
        if (!commandExists(cmd)) continue;
        // eslint-disable-next-line no-await-in-loop
        if (await trySpawnDetached(cmd, args)) {
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

async function checkForArDaliBinUpdates({ manual = false } = {}) {
    if (isFlatpakRuntime()) {
        setUpdateStatus('unsupported', {
            checkedAt: Date.now(),
            lastError: 'AUR update flow is disabled in Flatpak runtime (use Flatpak/Flathub updates).'
        });
        return snapshotUpdateState();
    }
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

        const rpcUrl = 'https://aur.archlinux.org/rpc/?v=5&type=info&arg[]=ardali-bin';
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
        return checkForArDaliBinUpdates({ manual });
    }
    return checkForAppUpdates({ manual });
}

const STARTUP_UPDATE_RETRY_DELAYS_MS = [3200, 30000, 120000];
let startupUpdateRetryTimer = null;
let startupUpdateAttempt = 0;
let startupUpdateDone = false;

function clearStartupUpdateRetryTimer() {
    if (!startupUpdateRetryTimer) return;
    clearTimeout(startupUpdateRetryTimer);
    startupUpdateRetryTimer = null;
}

function isTerminalUpdateStatus(status) {
    const s = String(status || '').toLowerCase();
    return s === 'available' ||
        s === 'not-available' ||
        s === 'downloaded' ||
        s === 'unsupported';
}

async function runStartupUpdateCheckAttempt() {
    try {
        await checkForRuntimeUpdates({ manual: false });
    } catch (e) {
        console.warn('[APP] startup update attempt error:', e?.message || e);
    }

    const status = String(updateRuntime.status || '').toLowerCase();
    if (isTerminalUpdateStatus(status)) {
        startupUpdateDone = true;
        clearStartupUpdateRetryTimer();
        return;
    }

    if (startupUpdateAttempt >= (STARTUP_UPDATE_RETRY_DELAYS_MS.length - 1)) return;
    startupUpdateAttempt += 1;
    const waitMs = Number(STARTUP_UPDATE_RETRY_DELAYS_MS[startupUpdateAttempt]) || 30000;
    clearStartupUpdateRetryTimer();
    startupUpdateRetryTimer = setTimeout(() => {
        runStartupUpdateCheckAttempt().catch(() => {});
    }, waitMs);
}

function scheduleStartupUpdateCheck() {
    if (startupUpdateDone) return;
    clearStartupUpdateRetryTimer();
    startupUpdateAttempt = 0;
    const initialDelayMs = Number(STARTUP_UPDATE_RETRY_DELAYS_MS[0]) || 3200;
    startupUpdateRetryTimer = setTimeout(() => {
        runStartupUpdateCheckAttempt().catch(() => {});
    }, initialDelayMs);
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
// Varsayılan: Linux'ta açık.
// Kapatmak için: ARDALI_DISABLE_MPRIS=1
// Açmayı zorlamak için: ARDALI_ENABLE_MPRIS=1
const MPRIS_ENABLE_OVERRIDE =
    ['1', 'true', 'yes'].includes(String(process.env.ARDALI_ENABLE_MPRIS || '').trim().toLowerCase());
const MPRIS_DISABLE_OVERRIDE =
    ['1', 'true', 'yes'].includes(String(process.env.ARDALI_DISABLE_MPRIS || '').trim().toLowerCase());
const MPRIS_RUNTIME_ENABLED =
    process.platform === 'linux' && (MPRIS_ENABLE_OVERRIDE || !MPRIS_DISABLE_OVERRIDE);
// Web platformlarının (YouTube, Spotify vb.) CERT_AUTHORITY_INVALID hatasında
// çalışmaya devam edebilmesi için varsayılan olarak açık.
// Kapatmak için: ARDALI_DISABLE_CERT_BYPASS=1
const ALLOW_TRUSTED_CERT_BYPASS =
    !['1', 'true', 'yes'].includes(String(process.env.ARDALI_DISABLE_CERT_BYPASS || '').trim().toLowerCase());
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

const TRANSIENT_HOME_FILES = ['ardali-freeze.log', 'imgui.ini'];

function readStartupSettingsForCommandLine() {
    try {
        const home = os.homedir();
        const base =
            process.platform === 'win32'
                ? (process.env.APPDATA || path.join(home, 'AppData', 'Roaming'))
                : process.platform === 'darwin'
                    ? path.join(home, 'Library', 'Application Support')
                    : (process.env.XDG_CONFIG_HOME || path.join(home, '.config'));
        const data = fs.readFileSync(path.join(base, FLATPAK_APP_ID, 'settings.json'), 'utf8');
        return JSON.parse(data);
    } catch {
        return {};
    }
}

function readStartupWebUiSettings() {
    const startupSettings = readStartupSettingsForCommandLine();
    return startupSettings?.webUi && typeof startupSettings.webUi === 'object'
        ? startupSettings.webUi
        : {};
}

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

// GNOME/KDE/Wayland üst bar & dock ikon eşleştirmesi için (desktop entry ile eşleşme)
if (app && app.commandLine) {
    const startupWebUi = readStartupWebUiSettings();

    if (process.platform === 'linux') {
        app.commandLine.appendSwitch('class', LINUX_WM_CLASS);
        app.commandLine.appendSwitch('name', LINUX_WAYLAND_APP_ID);
    }
    const startupAutoplayPolicy = String(startupWebUi.autoplayPolicy || 'allow').toLowerCase();
    app.commandLine.appendSwitch(
        'autoplay-policy',
        startupAutoplayPolicy === 'gesture' || startupAutoplayPolicy === 'block'
            ? 'user-gesture-required'
            : 'no-user-gesture-required'
    );
    if (shouldUseRelaxedWebTimers(startupWebUi)) {
        app.commandLine.appendSwitch('disable-background-timer-throttling');
    }
    if (isTruthyEnvFlag('ARDALI_MASK_AUTOMATION')) {
        app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
    }
    if (!shouldEnableAcceleratedVideoDecode()) {
        app.commandLine.appendSwitch('disable-accelerated-video-decode');
    } else {
        app.commandLine.appendSwitch('enable-accelerated-video-decode');
    }
    if (startupWebUi.reduceWebRtcIpLeaks !== false) {
        app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'default_public_interface_only');
    }

    // DÜZELTME: WebView'larda çift medya oynatıcıyı önlemek için Chromium MediaSessionService devre dışı
    const disabledFeatures = ['HardwareMediaKeyHandling', 'MediaSessionService'];
    // Windows'ta bazı ortamlarda Chromium built-in cert verifier, sistemde güvenilen
    // sertifikaları görmeyip net::ERR_CERT_AUTHORITY_INVALID (-202) üretebiliyor.
    // Sistem doğrulayıcıya dönerek tarayıcı ile davranışı hizala.
    if (process.platform === 'win32') {
        disabledFeatures.push('CertVerifierBuiltinFeature');
    }
    app.commandLine.appendSwitch('disable-features', disabledFeatures.join(','));
    if (process.platform === 'linux') {
        appendCommandLineCsvSwitch('enable-features', shouldEnableLinuxVaapi()
            ? 'VaapiVideoDecoder,WebRTCPipeWireCapturer'
            : 'WebRTCPipeWireCapturer');
    }
} else {
    console.warn('[Startup] app.commandLine not available');
}

// Windows 10/11: taskbar/dock ikon eşleştirmesi ve gruplama
if (process.platform === 'win32') {
    if (app && typeof app.setAppUserModelId === 'function') {
        app.setAppUserModelId('com.ardali.mediaplayer');
    } else {
        console.warn('[Startup] setAppUserModelId unavailable');
    }
}

// Linux Wayland: taskbar/dock grouping
if (process.platform === 'linux') {
    const flatpakId = String(process.env.FLATPAK_ID || process.env.APP_ID || '').trim();
    if (flatpakId && app && typeof app.setDesktopName === 'function') {
        app.setDesktopName(`${flatpakId.replace(/\.desktop$/i, '')}.desktop`);
    } else if (app && typeof app.setDesktopName === 'function') {
        app.setDesktopName(DESKTOP_FILE_ID);
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
        const visualizerExe = process.resourcesPath ? path.join(nativeDistDir, 'ardali-projectm-visualizer.exe') : '';
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
    const displayBackendOverride = String(process.env.ARDALI_DISPLAY_BACKEND || '').trim().toLowerCase();

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
    const forceSoftware = process.env.ARDALI_SOFTWARE_RENDER === '1' || process.env.ARDALI_SOFTWARE_RENDER === 'true';
    const forceGpu = process.env.ARDALI_FORCE_GPU === '1' || process.env.ARDALI_FORCE_GPU === 'true';
    const enableVaapi = shouldEnableLinuxVaapi();
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

    if (selectedBackend === 'wayland') {
        console.log('💻 Display Server: Wayland');
        app.commandLine.appendSwitch('ozone-platform-hint', 'wayland');
        app.commandLine.appendSwitch('disable-vulkan');
        app.commandLine.appendSwitch('use-angle', 'gl');
        appendCsvSwitch('disable-features', 'Vulkan');
        appendCsvSwitch('enable-features', enableVaapi
            ? 'UseOzonePlatform,WaylandWindowDecorations,VaapiVideoDecoder,WebRTCPipeWireCapturer'
            : 'UseOzonePlatform,WaylandWindowDecorations,WebRTCPipeWireCapturer');
    } else if (selectedBackend === 'x11') {
        console.log('💻 Display Server: X11');
        app.commandLine.appendSwitch('ozone-platform-hint', 'x11');
        appendCsvSwitch('enable-features', enableVaapi ? 'VaapiVideoDecoder,WebRTCPipeWireCapturer' : 'WebRTCPipeWireCapturer');
    } else {
        console.log('💻 Display Server: auto');
        if (!conservativeGpuMode) {
            app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
        }
        appendCsvSwitch('enable-features', enableVaapi ? 'VaapiVideoDecoder,WebRTCPipeWireCapturer' : 'WebRTCPipeWireCapturer');
    }
    effectiveDisplayBackend = selectedBackend;
    process.env.ARDALI_EFFECTIVE_DISPLAY_BACKEND = selectedBackend;

    if (ozoneHint && !displayBackendOverride) {
        console.log(`[Display] ELECTRON_OZONE_PLATFORM_HINT=${ozoneHint} (session-based auto mode takes precedence)`);
    }
    if (displayBackendOverride) {
        console.log(`[Display] ARDALI_DISPLAY_BACKEND override active: ${displayBackendOverride}`);
    }

    if (!forceSoftware && (!conservativeGpuMode || forceGpu)) {
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
            app.commandLine.appendSwitch('disable-gpu-rasterization');
            app.commandLine.appendSwitch('disable-zero-copy');
            console.log('[GPU] conservative linux mode: accelerated video decode, zero-copy and gpu rasterization disabled');
        }

        // Yazı tipi oluşturma iyileştirmeleri - Wayland/X11 uyumluluğu
        app.commandLine.appendSwitch('disable-font-subpixel-positioning');
        app.commandLine.appendSwitch('enable-font-antialiasing');
        app.commandLine.appendSwitch('force-device-scale-factor', '1');

        // Bağlam menüsü düzeltmeleri ve Linux Wayland GPU çökmelerini önleme
        if (process.platform === 'linux') {
            app.commandLine.appendSwitch('disable-gpu-sandbox');
            // Vulkan'ı tamamen devre dışı bırak (Wayland ve X11'de sık çökmelere neden oluyor)
            app.commandLine.appendSwitch('disable-features', 'Vulkan,DefaultANGLEVulkan,VulkanFromANGLE');
        } else if (isTruthyEnvFlag('ARDALI_DISABLE_GPU_SANDBOX')) {
            app.commandLine.appendSwitch('disable-gpu-sandbox');
        }
    }
}

// ============================================================
// GPU GÜVENLİ MOD (TÜM PLATFORMLAR)
// ============================================================
function installGpuFailsafe() {
    const alreadySoftware = process.env.ARDALI_SOFTWARE_RENDER === '1' || process.env.ARDALI_SOFTWARE_RENDER === 'true';

    const triggerFallback = (reason) => {
        if (alreadySoftware) return;
        console.warn(`[GPU] Crash detected (${reason})`);
        if (!isTruthyEnvFlag('ARDALI_GPU_CRASH_RELAUNCH')) return;
        console.warn('[GPU] relaunch fallback requested -> switching to software rendering');
        app.relaunch({
            env: {
                ...process.env,
                ARDALI_SOFTWARE_RENDER: '1'
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
            console.log('✓ C++ ArDali Audio Engine aktif');
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
let adblockWindow = null;
let downloaderWindow = null;
let downloaderService = null;
let pendingDownloaderUrl = '';
let pendingDownloaderNotice = null;
const libraryWatchSessions = new Map();
let tray = null;
let mainWindowCloseToTray = true;
let lastTrayState = { isPlaying: false, currentTrack: 'ArDali', isMuted: false, stopAfterCurrent: false };
const trayIconCache = new Map();
let mediaShortcutsRegistered = false;
const GLOBAL_MEDIA_SHORTCUTS = Object.freeze([
    ['MediaPlayPause', 'play-pause'],
    ['MediaNextTrack', 'next'],
    ['MediaPreviousTrack', 'previous']
]);
let studioShortcutsRegistered = false;
const DEFAULT_GLOBAL_STUDIO_SHORTCUTS = Object.freeze([
    ['CommandOrControl+Alt+Shift+R', 'video-studio-record'],
    ['CommandOrControl+Alt+Shift+P', 'video-studio-pause'],
    ['CommandOrControl+Alt+Shift+S', 'video-studio-stop'],
    ['CommandOrControl+Alt+Shift+B', 'video-studio-save-replay']
]);
let globalStudioShortcuts = DEFAULT_GLOBAL_STUDIO_SHORTCUTS.map((entry) => [...entry]);
let mprisPlayer = null;
let screenRecordingSystemAudioProc = null;
let screenRecordingSystemAudioPath = '';
const screenRecordingLiveOutputs = new Map();
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
    console.warn('[APP] single instance lock failed; exiting secondary instance');
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

// Security: only known, safe system commands may be passed to execCollect.
const EXEC_COLLECT_ALLOWED_COMMANDS = new Set([
    'arecord', 'pactl', 'pw-cli', 'pw-dump', 'ffmpeg', 'ffprobe',
    'wpctl', 'amixer', 'pacmd', 'pipewire-cli'
]);

async function execCollect(command, args = [], timeoutMs = 3500) {
    const sanitizedCommand = String(command || '').trim();
    // Security: validate command against allowlist before spawning.
    if (!sanitizedCommand || !EXEC_COLLECT_ALLOWED_COMMANDS.has(sanitizedCommand)) {
        return { success: false, output: '' };
    }
    return await new Promise((resolve) => {
        let combined = '';
        let timedOut = false;
        const resolvedCommand = findExecutable(sanitizedCommand, ['/usr/bin', '/usr/local/bin', '/bin', '/usr/sbin', '/sbin']) || sanitizedCommand;
        const child = spawn(resolvedCommand, args, {
            shell: false,
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
        child.once('close', (code) => {
            clearTimeout(timer);
            resolve({ success: !timedOut && code === 0, output: combined });
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

function shouldTreatUsbOutputAsHeadphones(sink, relatedInput) {
    const haystack = [
        sink?.description,
        sink?.activePort,
        sink?.name,
        relatedInput?.description,
        relatedInput?.activePort,
        relatedInput?.name
    ].join(' ').toLowerCase();

    if (!/\busb\b|usb-/.test(haystack)) return false;
    if (/headphone|headset|earbud|airpods|buds|analog-output-headphones/.test(haystack)) return true;
    return !!relatedInput && /(alsa_output\.usb|usb.*analog-stereo|usb pnp audio)/.test(haystack);
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

    const relatedInput = findRelatedLinuxInputForSink(current, sources);
    const classified = classifySystemOutputDevice(current);
    const usbHeadsetLike = shouldTreatUsbOutputAsHeadphones(current, relatedInput);
    const currentOutputKind = usbHeadsetLike ? 'headphones' : classified.kind;
    const currentOutputBadge = usbHeadsetLike ? 'Kulaklık' : classified.badge;
    return {
        success: true,
        supported: true,
        platform: process.platform,
        volumePercent: Math.max(0, Math.min(150, Number(current.volumePercent) || 0)),
        muted: !!current.muted,
        currentOutputName: String(current.description || current.name || '').trim() || 'Bilinmeyen çıkış',
        currentOutputId: String(current.name || '').trim(),
        currentOutputPort: String(current.activePort || '').trim(),
        currentOutputKind,
        currentOutputBadge,
        isHeadphones: !!classified.isHeadphones || usbHeadsetLike,
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

async function pickDefaultOutputMonitorDeviceId() {
    try {
        const pactlInfo = await execCollect('pactl', ['info']);
        const defaultSink = parsePactlInfoDefaultSink(pactlInfo.output);
        const devices = await listSystemAudioDevicesFallback();
        const list = Array.isArray(devices) ? devices : [];
        if (defaultSink) {
            const exactMonitor = `${defaultSink}.monitor`;
            const exact = list.find((dev) => String(dev?.id || '') === exactMonitor);
            if (exact?.id) return String(exact.id);
            const loose = list.find((dev) => String(dev?.id || '').includes(defaultSink) && /monitor/i.test(String(dev?.id || '')));
            if (loose?.id) return String(loose.id);
            return exactMonitor;
        }
        return pickPreferredMonitorDeviceId(list);
    } catch {
        const devices = await listSystemAudioDevicesFallback();
        return pickPreferredMonitorDeviceId(devices);
    }
}

function assignSafeOwnKeys(target, source) {
    if (!target || typeof target !== 'object') return;
    if (!source || typeof source !== 'object') return;
    for (const [key, value] of Object.entries(source)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
        target[key] = value;
    }
}

function normalizeAppRelativePath(relPath) {
    const raw = String(relPath || '').trim();
    if (!raw || raw.includes('\0') || path.isAbsolute(raw)) return '';
    const normalized = path.normalize(raw).replace(/^([/\\])+/, '');
    if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith(`..${path.sep}`)) return '';
    return normalized;
}

function getResourcePath(relPath) {
    const safeRelPath = normalizeAppRelativePath(relPath);
    if (!safeRelPath) return '';

    // Dev: doğrudan repo içinden
    if (!app.isPackaged) {
        // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
        return path.join(__dirname, safeRelPath);
    }

    // Prod: bazı dosyalar resources/, bazıları app.asar içinde kalır.
    // Önce resources/ kontrol edilir, yoksa app.asar kökünden çözülür.
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    const resourcePath = path.join(process.resourcesPath, safeRelPath);
    if (fs.existsSync(resourcePath)) {
        return resourcePath;
    }

    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    return path.join(app.getAppPath(), safeRelPath);
}

function getAppFilePath(relPath) {
    const safeRelPath = normalizeAppRelativePath(relPath);
    if (!safeRelPath) return '';
    // app.asar içindeki paketlenmiş dosyalar için çalışır (örn. locales/*.json)
    // Dev: app.getAppPath() proje kökünü gösterir; Prod: .../resources/app.asar konumunu gösterir
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    return path.join(app.getAppPath(), safeRelPath);
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
        return getResourcePath(path.join('icons', 'app', 'ardali.ico'));
    }
    return getResourcePath(path.join('icons', 'app', 'ardali_512.png'));
}

function getAppIconImage() {
    const iconPath = getAppIconPath();
    const img = nativeImage.createFromPath(iconPath);
    if (!img || img.isEmpty()) {
        return nativeImage.createFromPath(path.join(__dirname, 'icons', 'app', 'ardali_512.png'));
    }
    return img;
}

function applyLinuxTaskbarGrouping(win) {
    if (process.platform !== 'linux' || !win || win.isDestroyed?.()) return win;
    try {
        if (typeof win.setIcon === 'function') win.setIcon(getAppIconImage());
    } catch {
        // best effort
    }
    try {
        if (typeof win.setSkipTaskbar === 'function') win.setSkipTaskbar(false);
    } catch {
        // best effort
    }
    return win;
}

function getAuxiliaryWindowDefaults() {
    return {
        icon: getAppIconImage(),
        skipTaskbar: false
    };
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

function readSettingsFileSafeSync() {
    try {
        const data = fs.readFileSync(getSettingsPath(), 'utf8');
        return JSON.parse(data);
    } catch {
        return {};
    }
}

function normalizeMainWindowBounds(rawBounds = {}) {
    const width = Math.max(1024, Math.min(4096, Math.round(Number(rawBounds.width) || 1500)));
    const height = Math.max(700, Math.min(2304, Math.round(Number(rawBounds.height) || 900)));
    const x = Number.isFinite(Number(rawBounds.x)) ? Math.round(Number(rawBounds.x)) : undefined;
    const y = Number.isFinite(Number(rawBounds.y)) ? Math.round(Number(rawBounds.y)) : undefined;
    return {
        ...(Number.isFinite(x) ? { x } : {}),
        ...(Number.isFinite(y) ? { y } : {}),
        width,
        height
    };
}

function fitMainWindowBoundsToDisplay(bounds = {}) {
    const normalized = normalizeMainWindowBounds(bounds);
    try {
        const displays = screen.getAllDisplays();
        const targetDisplay = displays.find((display) => {
            const area = display.workArea || display.bounds;
            return Number.isFinite(normalized.x) &&
                Number.isFinite(normalized.y) &&
                normalized.x >= area.x - 80 &&
                normalized.x < area.x + area.width - 80 &&
                normalized.y >= area.y - 80 &&
                normalized.y < area.y + area.height - 80;
        }) || screen.getPrimaryDisplay();
        const area = targetDisplay.workArea || targetDisplay.bounds;
        normalized.width = Math.min(normalized.width, area.width);
        normalized.height = Math.min(normalized.height, area.height);
        normalized.x = Math.max(area.x, Math.min(
            Number.isFinite(normalized.x) ? normalized.x : area.x + Math.round((area.width - normalized.width) / 2),
            area.x + Math.max(0, area.width - normalized.width)
        ));
        normalized.y = Math.max(area.y, Math.min(
            Number.isFinite(normalized.y) ? normalized.y : area.y + Math.round((area.height - normalized.height) / 2),
            area.y + Math.max(0, area.height - normalized.height)
        ));
    } catch {
        // Screen can be unavailable during very early startup; normalized bounds are still safe.
    }
    return normalized;
}

function getSavedMainWindowStateSync() {
    const settings = readSettingsFileSafeSync();
    const windowState = settings?.ui?.mainWindow && typeof settings.ui.mainWindow === 'object'
        ? settings.ui.mainWindow
        : {};
    return {
        bounds: fitMainWindowBoundsToDisplay(windowState.bounds || windowState),
        maximized: windowState.maximized === true,
        fullscreen: windowState.fullscreen === true
    };
}

function persistMainWindowStateSync(win = mainWindow) {
    if (!win || win.isDestroyed?.()) return;
    try {
        const settings = readSettingsFileSafeSync();
        if (!settings || typeof settings !== 'object') return;
        if (!settings.ui || typeof settings.ui !== 'object') settings.ui = {};
        const bounds = typeof win.getNormalBounds === 'function'
            ? win.getNormalBounds()
            : win.getBounds();
        settings.ui.mainWindow = {
            bounds: normalizeMainWindowBounds(bounds),
            maximized: typeof win.isMaximized === 'function' ? win.isMaximized() : false,
            fullscreen: typeof win.isFullScreen === 'function' ? win.isFullScreen() : false,
            updatedAt: Date.now()
        };
        writeJsonFileAtomicSync(getSettingsPath(), sanitizeSensitiveSettings(settings));
    } catch (error) {
        console.warn('[WINDOW] main window state save failed:', error?.message || error);
    }
}

function installMainWindowStatePersistence(win) {
    if (!win || win.isDestroyed?.()) return;
    let timer = null;
    const schedule = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            persistMainWindowStateSync(win);
        }, 650);
    };
    win.on('resize', schedule);
    win.on('move', schedule);
    win.on('maximize', schedule);
    win.on('unmaximize', schedule);
    win.on('enter-full-screen', schedule);
    win.on('leave-full-screen', schedule);
    win.on('close', () => {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        persistMainWindowStateSync(win);
    });
}

function getDownloadsHistoryPath() {
    return path.join(app.getPath('userData'), 'downloads.json');
}

function readDownloadsHistorySync() {
    try {
        const data = fs.readFileSync(getDownloadsHistoryPath(), 'utf8');
        const history = JSON.parse(data);
        return Array.isArray(history) ? history : [];
    } catch {
        return [];
    }
}

function saveDownloadsHistorySync(history) {
    try {
        writeJsonFileAtomicSync(getDownloadsHistoryPath(), history);
    } catch (e) {
        console.warn('Failed to save downloads history:', e);
    }
}

function isIncompleteWebDownloadState(state) {
    return state === 'waiting_for_save' || state === 'downloading' || state === 'paused';
}

function normalizeDownloadsHistorySync(activeIds = new Set()) {
    const history = readDownloadsHistorySync();
    let changed = false;
    const normalized = history.map((item) => {
        if (!item || typeof item !== 'object') return item;
        if (!isIncompleteWebDownloadState(item.state)) return item;
        if (activeIds.has(item.id)) return item;
        changed = true;
        return {
            ...item,
            state: 'cancelled',
            endTime: item.endTime || Date.now(),
            cancelReason: item.cancelReason || 'app_closed'
        };
    });
    if (changed) saveDownloadsHistorySync(normalized);
    return normalized;
}

function markDownloadHistoryItemCancelled(id, reason = 'cancelled') {
    const targetId = String(id || '');
    if (!targetId) return null;
    let updatedItem = null;
    const history = readDownloadsHistorySync();
    const nextHistory = history.map((item) => {
        if (!item || item.id !== targetId) return item;
        updatedItem = {
            ...item,
            state: 'cancelled',
            endTime: Date.now(),
            cancelReason: reason
        };
        return updatedItem;
    });
    if (updatedItem) saveDownloadsHistorySync(nextHistory);
    return updatedItem;
}

function shouldClearWebCacheOnQuit() {
    const settings = readSettingsFileSafeSync();
    return settings?.webUi?.clearCacheOnQuit !== false;
}

function getWebQuitCleanupSettings() {
    const settings = readSettingsFileSafeSync();
    const webUi = settings?.webUi && typeof settings.webUi === 'object' ? settings.webUi : {};
    return {
        clearCacheOnQuit: webUi.clearCacheOnQuit !== false,
        clearCookiesOnQuit: webUi.clearCookiesOnQuit === true,
        clearSiteDataOnQuit: webUi.clearSiteDataOnQuit === true,
        clearHistoryOnQuit: webUi.clearHistoryOnQuit === true
    };
}

function getWebRuntimeSettingsSync() {
    const settings = readSettingsFileSafeSync();
    const webUi = settings?.webUi && typeof settings.webUi === 'object' ? settings.webUi : {};
    const security = settings?.security && typeof settings.security === 'object' ? settings.security : {};
    return {
        allowCamera: webUi.allowCamera === true,
        allowMicrophone: webUi.allowMicrophone === true,
        allowLocation: webUi.allowLocation === true,
        allowNotifications: webUi.allowNotifications === true,
        allowPopups: webUi.allowPopups !== false && security.allowPopups !== false,
        askDownloadLocation: webUi.askDownloadLocation !== false,
        reduceReferrers: webUi.reduceReferrers !== false,
        blockThirdPartyCookies: webUi.blockThirdPartyCookies === true
    };
}

function getWebSitePermissionOverrideSync(rawUrl = '') {
    try {
        const settings = readSettingsFileSafeSync();
        const permissions = settings?.webUi?.sitePermissions;
        if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) return null;
        const origin = new URL(String(rawUrl || '').trim()).origin;
        const entry = permissions[origin];
        return entry && typeof entry === 'object' ? entry : null;
    } catch {
        return null;
    }
}

function getWebPermissionFlag(permission = '') {
    const value = String(permission || '').trim();
    if (value === 'media' || value === 'audioCapture') return 'allowMicrophone';
    if (value === 'videoCapture') return 'allowCamera';
    if (value === 'geolocation') return 'allowLocation';
    if (value === 'notifications') return 'allowNotifications';
    return '';
}

function isWebPermissionAllowedBySettings(permission, currentUrl = '', originUrl = '') {
    const requestedPermission = String(permission || '').trim();
    if (
        requestedPermission === 'fullscreen' ||
        requestedPermission === 'pointerLock' ||
        requestedPermission === 'keyboardLock' ||
        requestedPermission === 'clipboard-read' ||
        requestedPermission === 'clipboard-sanitized-write' ||
        requestedPermission === 'clipboard-write'
    ) {
        return true;
    }
    const flag = getWebPermissionFlag(permission);
    if (!flag) return false;
    const override = getWebSitePermissionOverrideSync(originUrl || currentUrl);
    if (requestedPermission === 'media') {
        if (override && (typeof override.allowMicrophone === 'boolean' || typeof override.allowCamera === 'boolean')) {
            return override.allowMicrophone === true || override.allowCamera === true;
        }
        const webPrefs = getWebRuntimeSettingsSync();
        return webPrefs.allowMicrophone === true || webPrefs.allowCamera === true;
    }
    if (override && typeof override[flag] === 'boolean') return override[flag] === true;
    const webPrefs = getWebRuntimeSettingsSync();
    return webPrefs[flag] === true;
}

function isWebPopupAllowedBySettings(currentUrl = '', popupUrl = '') {
    const override = getWebSitePermissionOverrideSync(popupUrl || currentUrl);
    if (override && typeof override.allowPopups === 'boolean') return override.allowPopups === true;
    return getWebRuntimeSettingsSync().allowPopups !== false;
}

function buildWebStorageClearOptions(options = {}) {
    const opts = options && typeof options === 'object' ? options : {};
    if (opts.all === true) {
        return {
            cache: true,
            cookies: true,
            storageOptions: {
                storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage', 'serviceworkers', 'websql', 'shadercache']
            },
            cookieOrigin: ''
        };
    }

    const storages = [];
    if (opts.cookies === true) storages.push('cookies');
    if (opts.siteData === true || opts.storage === true) {
        storages.push('localstorage', 'indexdb', 'cachestorage', 'serviceworkers', 'websql');
    }
    return {
        cache: opts.cache === true,
        cookies: opts.cookies === true,
        storageOptions: storages.length ? {
            storages: [...new Set(storages)],
            ...(typeof opts.origin === 'string' && /^https?:\/\//i.test(opts.origin) ? { origin: opts.origin } : {})
        } : null,
        cookieOrigin: typeof opts.origin === 'string' && /^https?:\/\//i.test(opts.origin) ? opts.origin : ''
    };
}

function getCookieUrlForRemoval(cookie = {}) {
    const domain = String(cookie.domain || '').trim().replace(/^\./, '');
    if (!domain || !cookie.name) return '';
    const protocol = cookie.secure ? 'https:' : 'http:';
    const pathName = String(cookie.path || '/').trim() || '/';
    return `${protocol}//${domain}${pathName.startsWith('/') ? pathName : `/${pathName}`}`;
}

function getRelatedCookieDomainsForOrigin(origin = '') {
    try {
        const host = String(new URL(origin).hostname || '').toLowerCase();
        if (!host) return [];
        const domains = new Set([getRegistrableDomainMain(host)]);
        if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be') {
            ['youtube.com', 'google.com', 'googleusercontent.com', 'gstatic.com', 'ytimg.com'].forEach((domain) => domains.add(domain));
        }
        if (host === 'google.com' || host.endsWith('.google.com')) {
            ['google.com', 'youtube.com', 'googleusercontent.com', 'gstatic.com'].forEach((domain) => domains.add(domain));
        }
        return [...domains].filter(Boolean);
    } catch {
        return [];
    }
}

function cookieMatchesAnyDomain(cookie = {}, domains = []) {
    const cookieDomain = String(cookie.domain || '').trim().toLowerCase().replace(/^\./, '');
    return domains.some((domain) => {
        const value = String(domain || '').toLowerCase().replace(/^\./, '');
        return !!value && (cookieDomain === value || cookieDomain.endsWith(`.${value}`));
    });
}

async function clearCookiesFromSession(ses, origin = '') {
    if (!ses || typeof ses.cookies?.get !== 'function' || typeof ses.cookies?.remove !== 'function') return 0;
    const allCookies = await ses.cookies.get({});
    const relatedDomains = origin ? getRelatedCookieDomainsForOrigin(origin) : [];
    const cookies = origin
        ? (allCookies || []).filter((cookie) => cookieMatchesAnyDomain(cookie, relatedDomains))
        : (allCookies || []);
    let removed = 0;
    for (const cookie of cookies) {
        const url = getCookieUrlForRemoval(cookie);
        if (!url || !cookie.name) continue;
        try {
            await ses.cookies.remove(url, cookie.name);
            removed += 1;
        } catch (error) {
            console.warn('[WEB] cookie remove failed:', cookie.name, error?.message || error);
        }
    }
    return removed;
}

async function clearWebSessionData(options = {}) {
    const clearOptions = buildWebStorageClearOptions(options);
    const sessions = getWebSessions();
    let removedCookies = 0;
    for (const ses of sessions) {
        if (!ses) continue;
        if (clearOptions.cache && typeof ses.clearCache === 'function') {
            await ses.clearCache();
        }
        if (clearOptions.storageOptions && typeof ses.clearStorageData === 'function') {
            await ses.clearStorageData(clearOptions.storageOptions);
        }
        if (clearOptions.cookies) {
            removedCookies += await clearCookiesFromSession(ses, clearOptions.cookieOrigin);
        }
    }
    if (clearOptions.cookies) {
        console.log('[WEB] cookies cleared:', {
            origin: clearOptions.cookieOrigin || 'all',
            removed: removedCookies,
            sessions: sessions.length
        });
    }
    return {
        ok: true,
        removedCookies,
        sessions: sessions.length,
        cache: !!clearOptions.cache,
        cookies: !!clearOptions.cookies,
        siteData: !!clearOptions.storageOptions,
        origin: clearOptions.cookieOrigin || ''
    };
}

function clearLastWebHistoryFromSettingsSync() {
    try {
        const settings = readSettingsFileSafeSync();
        if (!settings || typeof settings !== 'object') return;
        if (!settings.ui || typeof settings.ui !== 'object') settings.ui = {};
        settings.ui.lastWebUrl = '';
        writeJsonFileAtomicSync(getSettingsPath(), sanitizeSensitiveSettings(settings));
    } catch (error) {
        console.warn('[WEB] son web adresi temizlenemedi:', error?.message || error);
    }
}

function clearWebCacheDirectoriesOnQuit() {
    if (!shouldClearWebCacheOnQuit()) return;

    const userDataPath = app.getPath('userData');
    for (const cacheDirName of ['Cache', 'GPUCache', 'Code Cache']) {
        try {
            const cachePath = path.join(userDataPath, cacheDirName);
            fs.rmSync(cachePath, { recursive: true, force: true });
        } catch (error) {
            console.warn(`[CACHE] ${cacheDirName} temizlenemedi:`, error?.message || error);
        }
    }
}

let webQuitCleanupInProgress = false;
let webQuitCleanupDone = false;

async function runWebQuitCleanup() {
    const cleanup = getWebQuitCleanupSettings();
    if (cleanup.clearHistoryOnQuit) {
        clearLastWebHistoryFromSettingsSync();
    }
    if (cleanup.clearCacheOnQuit || cleanup.clearCookiesOnQuit || cleanup.clearSiteDataOnQuit) {
        await clearWebSessionData({
            cache: cleanup.clearCacheOnQuit,
            cookies: cleanup.clearCookiesOnQuit,
            siteData: cleanup.clearSiteDataOnQuit
        });
    }
}

function getCurrentUiThemeSync() {
    const settings = readSettingsFileSafeSync();
    const theme = String(settings?.appearance?.theme || '').trim();
    return theme || 'black';
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

function unregisterGlobalStudioShortcuts() {
    try {
        for (const [accelerator] of globalStudioShortcuts) {
            if (globalShortcut.isRegistered(accelerator)) {
                globalShortcut.unregister(accelerator);
            }
        }
    } catch (error) {
        console.warn('[SHORTCUT] studio unregister failed:', error?.message || error);
    } finally {
        studioShortcutsRegistered = false;
    }
}

function registerGlobalStudioShortcuts() {
    if (studioShortcutsRegistered) return;
    let registeredAny = false;
    for (const [accelerator, action] of globalStudioShortcuts) {
        try {
            const ok = globalShortcut.register(accelerator, () => {
                dispatchMediaShortcutAction(action);
            });
            if (ok) registeredAny = true;
            else console.warn(`[SHORTCUT] studio register failed (in use?): ${accelerator}`);
        } catch (error) {
            console.warn(`[SHORTCUT] studio register error: ${accelerator}`, error?.message || error);
        }
    }
    studioShortcutsRegistered = registeredAny;
}

function normalizeStudioShortcutAccelerator(value = '') {
    const text = String(value || '').trim();
    if (!text) return '';
    return text
        .split('+')
        .map((part) => {
            const token = part.trim();
            const lower = token.toLowerCase();
            if (['ctrl', 'control', 'cmdorctrl', 'commandorcontrol'].includes(lower)) return 'CommandOrControl';
            if (['cmd', 'command', 'meta', 'super', 'win'].includes(lower)) return 'Super';
            if (lower === 'alt' || lower === 'option') return 'Alt';
            if (lower === 'shift') return 'Shift';
            if (lower === 'space') return 'Space';
            if (/^arrow/i.test(token)) return token.replace(/^arrow/i, '');
            return token;
        })
        .filter(Boolean)
        .join('+');
}

function setGlobalStudioShortcuts(shortcuts = {}) {
    const actionMap = {
        globalRecord: 'video-studio-record',
        globalPause: 'video-studio-pause',
        globalStop: 'video-studio-stop',
        globalReplay: 'video-studio-save-replay'
    };
    unregisterGlobalStudioShortcuts();
    globalStudioShortcuts = Object.entries(actionMap)
        .map(([key, action]) => [normalizeStudioShortcutAccelerator(shortcuts?.[key] || ''), action])
        .filter(([accelerator]) => !!accelerator);
    registerGlobalStudioShortcuts();
    return { success: true, registered: studioShortcutsRegistered, shortcuts: globalStudioShortcuts };
}

function refreshGlobalMediaShortcuts(settings) {
    if (!app.isReady()) return;
    if (isMediaKeyAutoDetectEnabled(settings)) {
        registerGlobalMediaShortcuts();
    } else {
        unregisterGlobalMediaShortcuts();
    }
    registerGlobalStudioShortcuts();
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

const WEBVIEW_PARTITION = 'persist:ardali-web';
const ADBLOCK_STRICTBLOCK_URL = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DeliBlock</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1016;color:#eef6ff;font-family:system-ui,-apple-system,Segoe UI,sans-serif}
main{width:min(620px,calc(100vw - 36px));padding:28px;border:1px solid rgba(89,210,255,.28);border-radius:14px;background:#101923;box-shadow:0 24px 80px rgba(0,0,0,.38)}
h1{margin:0 0 10px;font-size:24px}
p{margin:0;color:#afbdc9;line-height:1.55}
strong{color:#5ee6ff}
</style>
</head>
<body><main><h1>DeliBlock koruması</h1><p>Bu adres, zararlı veya aldatıcı yönlendirme listeleriyle eşleştiği için açılmadı. <strong>Strict Block</strong> bu sayfayı güvenli tarafta durdurdu.</p></main></body>
</html>`)}`;
const YOUTUBE_INITIATOR_DOMAINS = Object.freeze([
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com',
    'music.youtube.com'
]);
const YOUTUBE_HOSTNAMES = Object.freeze([
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com',
    'music.youtube.com',
    'youtu.be'
]);
const ADBLOCK_YOUTUBE_SERVER_CONTRACT_SCRIPTLET = String.raw`
(function installDeliBlockYouTubeServerContract() {
    if (window.__ardaliDeliBlockYouTubeServerContractPatch) return;
    window.__ardaliDeliBlockYouTubeServerContractPatch = true;

    try {
        const host = String(location.hostname || '').toLowerCase();
        if (!(host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be')) return;
        if (location.href.startsWith('https://www.youtube.com/tv#/') ||
            location.href.startsWith('https://www.youtube.com/embed/')) return;
    } catch {
        return;
    }

    const state = {
        originalUserAgent: '',
        probes: ['adunit', 'lactmilli', 'channel', 'instream', 'eafg'],
        pendingReload: false
    };

    function getPlayer() {
        try { return document.getElementById('movie_player'); } catch { return null; }
    }

    function getClient() {
        try {
            return window.ytcfg &&
                window.ytcfg.data_ &&
                window.ytcfg.data_.INNERTUBE_CONTEXT &&
                window.ytcfg.data_.INNERTUBE_CONTEXT.client;
        } catch {
            return null;
        }
    }

    function setClientProbe(probe) {
        try {
            const client = getClient();
            if (!client || !state.originalUserAgent) return;
            client.userAgent = probe
                ? state.originalUserAgent.replace(/(Mozilla\/5\.0 \([^)]+)/, '$1; ' + probe)
                : state.originalUserAgent;
        } catch {}
    }

    function initClientProbe() {
        try {
            const client = getClient();
            if (!client || state.originalUserAgent) return;
            state.originalUserAgent = String(client.userAgent || '');
        } catch {}
    }

    function maybeRecoverBlockedPlayback() {
        try {
            initClientProbe();
            const player = getPlayer();
            if (!player || !location.href.includes('/watch?')) {
                state.probes = ['adunit', 'lactmilli', 'channel', 'instream', 'eafg'];
                state.pendingReload = false;
                return;
            }

            const response = player.getPlayerResponse && player.getPlayerResponse();
            const progress = player.getProgressState && player.getProgressState();
            const stats = player.getStatsForNerds && player.getStatsForNerds();
            const stateObject = player.getPlayerStateObject && player.getPlayerStateObject();
            const isServerAd = String(stats && stats.debug_info || '').startsWith('SSAP, AD');
            const isBufferingBlank = !!stateObject && stateObject.isBuffering &&
                stats && stats.buffer_health_seconds === '0.00 s' && stats.resolution === '0x0';

            if (isServerAd && progress && Number(progress.duration) > 0) {
                player.seekTo && player.seekTo(Number(progress.duration), true);
                return;
            }

            if (!response || !progress || !(Number(progress.duration) > 0)) return;
            if (!(progress.loaded < progress.duration ||
                progress.duration - progress.current > 1 ||
                response.videoDetails && response.videoDetails.isLive)) return;

            const runs = JSON.stringify(response.playabilityStatus &&
                response.playabilityStatus.errorScreen &&
                response.playabilityStatus.errorScreen.playerErrorMessageRenderer &&
                response.playabilityStatus.errorScreen.playerErrorMessageRenderer.subreason &&
                response.playabilityStatus.errorScreen.playerErrorMessageRenderer.subreason.runs);
            const isRecoverableUnplayable = response.playabilityStatus &&
                response.playabilityStatus.status === 'UNPLAYABLE' &&
                !(response.playabilityStatus.errorScreen &&
                    response.playabilityStatus.errorScreen.playerErrorMessageRenderer &&
                    response.playabilityStatus.errorScreen.playerErrorMessageRenderer.playerCaptchaViewModel) &&
                runs && runs.includes('WEB_PAGE_TYPE_UNKNOWN') &&
                runs.includes('https://support.google.com/youtube/answer/3037019');

            if (isRecoverableUnplayable) {
                const videoId = response.videoDetails && response.videoDetails.videoId;
                const startSeconds = response.playerConfig && response.playerConfig.playbackStartConfig
                    ? response.playerConfig.playbackStartConfig.startSeconds || 0
                    : 0;
                state.probes = state.probes.slice(1);
                setClientProbe(state.probes[0] || '');
                state.pendingReload = false;
                if (videoId && player.loadVideoById) player.loadVideoById(videoId, startSeconds);
                return;
            }

            if (isBufferingBlank && state.pendingReload && state.probes.length > 0) {
                const videoId = response.videoDetails && response.videoDetails.videoId;
                const startSeconds = progress.current || 0;
                setClientProbe(state.probes[0]);
                state.pendingReload = false;
                if (videoId && player.loadVideoById) player.loadVideoById(videoId, startSeconds);
            }
        } catch {}
    }

    try {
        const originalHas = window.Map && window.Map.prototype && window.Map.prototype.has;
        if (typeof originalHas === 'function' && !window.__ardaliDeliBlockMapHasPatched) {
            window.__ardaliDeliBlockMapHasPatched = true;
            window.Map.prototype.has = new Proxy(originalHas, {
                apply(target, self, args) {
                    try {
                        if (args && args[0] === 'onSnackbarMessage' && !state.pendingReload) {
                            const player = getPlayer();
                            const stats = player && player.getStatsForNerds && player.getStatsForNerds();
                            const stateObject = player && player.getPlayerStateObject && player.getPlayerStateObject();
                            const tracking = player && player.getPlayerResponse && player.getPlayerResponse();
                            const playbackUrl = tracking && tracking.playbackTracking &&
                                tracking.playbackTracking.videostatsPlaybackUrl &&
                                tracking.playbackTracking.videostatsPlaybackUrl.baseUrl;
                            if (stateObject && stateObject.isBuffering &&
                                stats && stats.buffer_health_seconds === '0.00 s' && stats.resolution === '0x0' &&
                                state.probes.length > 0) {
                                if (String(playbackUrl || '').includes('reloadxhr')) state.probes = state.probes.slice(1);
                                state.pendingReload = true;
                            }
                        }
                    } catch {}
                    return Reflect.apply(target, self, args);
                }
            });
        }
    } catch {}

    try {
        const originalStringify = window.JSON && window.JSON.stringify;
        if (typeof originalStringify === 'function' && !window.__ardaliDeliBlockJsonStringifyPatched) {
            window.__ardaliDeliBlockJsonStringifyPatched = true;
            window.JSON.stringify = new Proxy(originalStringify, {
                apply(target, self, args) {
                    try {
                        const body = args && args[0];
                        const client = body && body.context && body.context.client;
                        if (body && typeof body === 'object' &&
                            'attestationRequest' in body &&
                            body.playbackContext && body.playbackContext.contentPlaybackContext &&
                            client && client.mainAppWebInfo &&
                            String(client.mainAppWebInfo.graftUrl || '').includes('/watch?')) {
                            body.playbackContext.contentPlaybackContext.lactMilliseconds = String(Date.now());
                        }
                    } catch {}
                    return Reflect.apply(target, self, args);
                }
            });
        }
    } catch {}

    try {
        const originalThen = window.Promise && window.Promise.prototype && window.Promise.prototype.then;
        if (typeof originalThen === 'function' && !window.__ardaliDeliBlockPromiseThenPatched) {
            window.__ardaliDeliBlockPromiseThenPatched = true;
            window.Promise.prototype.then = new Proxy(originalThen, {
                apply(target, self, args) {
                    try {
                        if (typeof args[0] === 'function' && String(args[0]).includes('onAbnormalityDetected')) {
                            args[0] = function noopAbnormalityDetected() {};
                        }
                    } catch {}
                    return Reflect.apply(target, self, args);
                }
            });
        }
    } catch {}

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', maybeRecoverBlockedPlayback, { once: true });
    } else {
        maybeRecoverBlockedPlayback();
    }
    try {
        new MutationObserver(maybeRecoverBlockedPlayback).observe(document, { childList: true, subtree: true });
    } catch {}
    setInterval(maybeRecoverBlockedPlayback, 800);
}());
`;
const ADBLOCK_NOOP_JS_URL = `data:application/javascript;base64,${Buffer.from('"use strict";\nvoid 0;\n', 'utf8').toString('base64')}`;
const ADBLOCK_NOOP_JSON_URL = `data:application/json;base64,${Buffer.from('{}\n', 'utf8').toString('base64')}`;
const ADBLOCK_NOOP_DNR_RULES = Object.freeze([
    {
        id: 1100001,
        priority: 65,
        action: { type: 'redirect', redirect: { url: ADBLOCK_NOOP_JS_URL } },
        condition: {
            urlFilter: '||pagead2.googlesyndication.com/pagead/js/adsbygoogle.js',
            resourceTypes: ['script']
        },
        ruleset: 'ardali-noop'
    },
    {
        id: 1100002,
        priority: 65,
        action: { type: 'redirect', redirect: { url: ADBLOCK_NOOP_JS_URL } },
        condition: {
            urlFilter: '||securepubads.g.doubleclick.net/tag/js/gpt.js',
            resourceTypes: ['script']
        },
        ruleset: 'ardali-noop'
    },
    {
        id: 1100003,
        priority: 65,
        action: { type: 'redirect', redirect: { url: ADBLOCK_NOOP_JS_URL } },
        condition: {
            urlFilter: '||www.googletagservices.com/tag/js/gpt.js',
            resourceTypes: ['script']
        },
        ruleset: 'ardali-noop'
    },
    {
        id: 1100004,
        priority: 65,
        action: { type: 'redirect', redirect: { url: ADBLOCK_NOOP_JS_URL } },
        condition: {
            urlFilter: '||www.google-analytics.com/analytics.js',
            resourceTypes: ['script']
        },
        ruleset: 'ardali-noop'
    },
    {
        id: 1100005,
        priority: 65,
        action: { type: 'redirect', redirect: { url: ADBLOCK_NOOP_JS_URL } },
        condition: {
            urlFilter: '||www.google-analytics.com/gtag/js',
            resourceTypes: ['script']
        },
        ruleset: 'ardali-noop'
    },
    {
        id: 1100006,
        priority: 65,
        action: { type: 'redirect', redirect: { url: ADBLOCK_NOOP_JSON_URL } },
        condition: {
            urlFilter: '/pagead/ppub_config',
            resourceTypes: ['xmlhttprequest']
        },
        ruleset: 'ardali-noop'
    }
]);
const ADBLOCK_YOUTUBE_DNR_RULES = Object.freeze([
    {
        id: 1000000,
        priority: 90,
        action: { type: 'allow' },
        condition: {
            initiatorDomains: YOUTUBE_INITIATOR_DOMAINS,
            requestDomains: [
                'i.ytimg.com',
                'yt3.ggpht.com',
                'ggpht.com',
                'youtube.com',
                'www.youtube.com',
                'm.youtube.com',
                'music.youtube.com',
                'youtubei.googleapis.com'
            ],
            resourceTypes: ['script', 'xmlhttprequest', 'image', 'stylesheet', 'font']
        },
        ruleset: 'ardali-youtube-core'
    },
    {
        id: 1000011,
        priority: 90,
        action: { type: 'allow' },
        condition: {
            initiatorDomains: YOUTUBE_INITIATOR_DOMAINS,
            requestDomains: ['googlevideo.com'],
            resourceTypes: ['media', 'xmlhttprequest']
        },
        ruleset: 'ardali-youtube-core'
    },
    {
        id: 1000001,
        priority: 110,
        action: { type: 'block' },
        condition: {
            initiatorDomains: YOUTUBE_INITIATOR_DOMAINS,
            requestDomains: [
                'ad.doubleclick.net',
                'googleads.g.doubleclick.net',
                'pagead2.googlesyndication.com',
                'tpc.googlesyndication.com',
                'static.doubleclick.net'
            ],
            resourceTypes: ['script', 'xmlhttprequest', 'sub_frame', 'image', 'media']
        },
        ruleset: 'ardali-youtube'
    },
    {
        id: 1000002,
        priority: 110,
        action: { type: 'block' },
        condition: {
            initiatorDomains: YOUTUBE_INITIATOR_DOMAINS,
            urlFilter: '||youtube.com/pagead/',
            resourceTypes: ['script', 'xmlhttprequest', 'sub_frame', 'image']
        },
        ruleset: 'ardali-youtube'
    },
    {
        id: 1000003,
        priority: 110,
        action: { type: 'block' },
        condition: {
            initiatorDomains: YOUTUBE_INITIATOR_DOMAINS,
            urlFilter: '/api/stats/ads',
            resourceTypes: ['xmlhttprequest', 'ping']
        },
        ruleset: 'ardali-youtube'
    },
    {
        id: 1000004,
        priority: 120,
        action: { type: 'redirect', redirect: { url: ADBLOCK_NOOP_JSON_URL } },
        condition: {
            initiatorDomains: YOUTUBE_INITIATOR_DOMAINS,
            urlFilter: '||youtube.com/youtubei/v1/player/ad_break',
            resourceTypes: ['xmlhttprequest']
        },
        ruleset: 'ardali-youtube'
    },
    {
        id: 1000005,
        priority: 120,
        action: { type: 'redirect', redirect: { url: ADBLOCK_NOOP_JSON_URL } },
        condition: {
            initiatorDomains: YOUTUBE_INITIATOR_DOMAINS,
            urlFilter: '||www.youtube.com/get_midroll_',
            resourceTypes: ['xmlhttprequest', 'script']
        },
        ruleset: 'ardali-youtube'
    },
    {
        id: 1000006,
        priority: 120,
        action: { type: 'redirect', redirect: { url: ADBLOCK_NOOP_JSON_URL } },
        condition: {
            initiatorDomains: YOUTUBE_INITIATOR_DOMAINS,
            urlFilter: '||m.youtube.com/get_midroll_',
            resourceTypes: ['xmlhttprequest', 'script']
        },
        ruleset: 'ardali-youtube'
    },
    {
        id: 1000007,
        priority: 120,
        action: { type: 'redirect', redirect: { url: ADBLOCK_NOOP_JSON_URL } },
        condition: {
            initiatorDomains: YOUTUBE_INITIATOR_DOMAINS,
            urlFilter: '||youtube.com/get_video_info?*adunit',
            resourceTypes: ['xmlhttprequest']
        },
        ruleset: 'ardali-youtube'
    },
    {
        id: 1000008,
        priority: 120,
        action: { type: 'redirect', redirect: { url: ADBLOCK_NOOP_JSON_URL } },
        condition: {
            initiatorDomains: YOUTUBE_INITIATOR_DOMAINS,
            urlFilter: '/api/stats/qoe?*adformat=',
            resourceTypes: ['xmlhttprequest', 'ping']
        },
        ruleset: 'ardali-youtube'
    },
    {
        id: 1000009,
        priority: 120,
        action: { type: 'block' },
        condition: {
            initiatorDomains: ['www.youtube.com'],
            regexFilter: '\\.googlevideo\\.com\\/videoplayback\\?expire=(?:[02-9]+|1[1-68-9]\\d+|17[1-48-9]\\d+)&',
            requestMethods: ['get'],
            resourceTypes: ['xmlhttprequest']
        },
        ruleset: 'ardali-youtube'
    },
    {
        id: 1000010,
        priority: 120,
        action: { type: 'block' },
        condition: {
            initiatorDomains: YOUTUBE_INITIATOR_DOMAINS,
            urlFilter: 'adformat=',
            requestDomains: ['googlevideo.com'],
            resourceTypes: ['xmlhttprequest', 'media']
        },
        ruleset: 'ardali-youtube'
    }
]);
const ADBLOCK_PLATFORM_CORE_DNR_RULES = Object.freeze([
    {
        id: 1010000,
        priority: 95,
        action: { type: 'allow' },
        condition: {
            initiatorDomains: ['deezer.com', 'www.deezer.com'],
            requestDomains: ['deezer.com', 'www.deezer.com', 'dzcdn.net'],
            resourceTypes: ['stylesheet', 'script', 'font', 'image', 'media', 'xmlhttprequest']
        },
        ruleset: 'ardali-platform-core'
    },
    {
        id: 1010001,
        priority: 95,
        action: { type: 'allow' },
        condition: {
            initiatorDomains: ['soundcloud.com', 'www.soundcloud.com'],
            requestDomains: ['soundcloud.com', 'www.soundcloud.com', 'sndcdn.com'],
            resourceTypes: ['stylesheet', 'script', 'font', 'image', 'media', 'xmlhttprequest']
        },
        ruleset: 'ardali-platform-core'
    },
    {
        id: 1010002,
        priority: 95,
        action: { type: 'allow' },
        condition: {
            initiatorDomains: ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'instagram.com', 'www.instagram.com'],
            requestDomains: [
                'facebook.com',
                'www.facebook.com',
                'm.facebook.com',
                'web.facebook.com',
                'graph.facebook.com',
                'static.xx.fbcdn.net',
                'fbcdn.net',
                'fbcdn.com',
                'fbsbx.com',
                'facebook.net',
                'instagram.com',
                'www.instagram.com',
                'cdninstagram.com'
            ],
            resourceTypes: ['stylesheet', 'script', 'font', 'image', 'media', 'xmlhttprequest']
        },
        ruleset: 'ardali-platform-core'
    },
    {
        id: 1010003,
        priority: 95,
        action: { type: 'allow' },
        condition: {
            initiatorDomains: ['tiktok.com', 'www.tiktok.com', 'm.tiktok.com'],
            requestDomains: [
                'tiktok.com',
                'www.tiktok.com',
                'm.tiktok.com',
                'tiktokcdn.com',
                'tiktokcdn-us.com',
                'tiktokv.com',
                'ttwstatic.com',
                'byteoversea.com',
                'ibyteimg.com',
                'byteimg.com',
                'ibytedtos.com',
                'muscdn.com'
            ],
            resourceTypes: ['stylesheet', 'script', 'font', 'image', 'media', 'xmlhttprequest']
        },
        ruleset: 'ardali-platform-core'
    },
    {
        id: 1010004,
        priority: 95,
        action: { type: 'allow' },
        condition: {
            initiatorDomains: ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'],
            requestDomains: ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'twimg.com'],
            resourceTypes: ['stylesheet', 'script', 'font', 'image', 'media', 'xmlhttprequest']
        },
        ruleset: 'ardali-platform-core'
    },
    {
        id: 1010005,
        priority: 95,
        action: { type: 'allow' },
        condition: {
            initiatorDomains: ['reddit.com', 'www.reddit.com', 'old.reddit.com'],
            requestDomains: ['reddit.com', 'www.reddit.com', 'old.reddit.com', 'redditstatic.com', 'redditmedia.com', 'redd.it'],
            resourceTypes: ['stylesheet', 'script', 'font', 'image', 'media', 'xmlhttprequest']
        },
        ruleset: 'ardali-platform-core'
    },
    {
        id: 1010006,
        priority: 95,
        action: { type: 'allow' },
        condition: {
            initiatorDomains: ['twitch.tv', 'www.twitch.tv'],
            requestDomains: ['twitch.tv', 'www.twitch.tv', 'jtvnw.net', 'ttvnw.net', 'twitchcdn.net', 'ext-twitch.tv'],
            resourceTypes: ['stylesheet', 'script', 'font', 'image', 'media', 'xmlhttprequest']
        },
        ruleset: 'ardali-platform-core'
    },
    {
        id: 1010007,
        priority: 95,
        action: { type: 'allow' },
        condition: {
            initiatorDomains: ['telegram.org', 'www.telegram.org', 'web.telegram.org', 't.me', 'www.t.me'],
            requestDomains: ['telegram.org', 'www.telegram.org', 'web.telegram.org', 't.me', 'www.t.me'],
            resourceTypes: ['stylesheet', 'script', 'font', 'image', 'media', 'xmlhttprequest']
        },
        ruleset: 'ardali-platform-core'
    },
    {
        id: 1010008,
        priority: 95,
        action: { type: 'allow' },
        condition: {
            initiatorDomains: ['whatsapp.com', 'www.whatsapp.com', 'web.whatsapp.com'],
            requestDomains: ['whatsapp.com', 'www.whatsapp.com', 'web.whatsapp.com', 'whatsapp.net'],
            resourceTypes: ['stylesheet', 'script', 'font', 'image', 'media', 'xmlhttprequest']
        },
        ruleset: 'ardali-platform-core'
    },
    {
        id: 1010009,
        priority: 95,
        action: { type: 'allow' },
        condition: {
            initiatorDomains: ['mixcloud.com', 'www.mixcloud.com'],
            requestDomains: ['mixcloud.com', 'www.mixcloud.com', 'mxcdn.net'],
            resourceTypes: ['stylesheet', 'script', 'font', 'image', 'media', 'xmlhttprequest']
        },
        ruleset: 'ardali-platform-core'
    },
    {
        id: 1010010,
        priority: 95,
        action: { type: 'allow' },
        condition: {
            initiatorDomains: ['spotify.com', 'www.spotify.com', 'open.spotify.com', 'accounts.spotify.com'],
            requestDomains: [
                'spotify.com',
                'www.spotify.com',
                'open.spotify.com',
                'accounts.spotify.com',
                'scdn.co',
                'spotifycdn.com',
                'spotifycdn.net',
                'akamaized.net'
            ],
            resourceTypes: ['stylesheet', 'script', 'font', 'image', 'media', 'xmlhttprequest']
        },
        ruleset: 'ardali-platform-core'
    }
]);

const adblockRuntime = {
    config: normalizeAdblockConfig(),
    installed: false,
    rulesetCache: new Map(),
    strictblockCache: new Map(),
    scriptingCache: new Map(),
    recentMatchKeys: new Map(),
    blockedSession: 0,
    blockedTotal: 0,
    blockedByRuleset: new Map(),
    recentBlocked: [],
    lastBlockedAt: 0,
    lastBlocked: null
};

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

function getAdblockStatsSnapshot() {
    const plan = getActiveRulesetPlan(adblockRuntime.config);
    const summary = getRulesetSummary(adblockRuntime.config, {
        rulesetCount: new Set([
            ...plan.dnr.map((item) => item.id),
            ...plan.strictblock.map((item) => `strictblock:${item.id}`),
            ...plan.scripting.map((item) => `scripting:${item.id}`)
        ]).size,
        domainRuleCount: (adblockRuntime.config?.dnrRules || []).filter((rule) => {
            const condition = rule?.condition || {};
            return Array.isArray(condition.requestDomains) ||
                Array.isArray(condition.initiatorDomains) ||
                String(condition.urlFilter || '').startsWith('||');
        }).length,
        cosmeticSelectorCount: plan.scripting.reduce((total, item) => {
            const assets = item.assets || {};
            return total + ['generic', 'generichigh', 'specific', 'procedural'].filter((key) => assets[key]).length;
        }, 0)
    });
    const { dnrRules, ...publicConfig } = adblockRuntime.config || {};
    return {
        ...summary,
        activeRulesets: {
            dnr: plan.dnr.map((item) => ({ id: item.id, label: item.label, hasRegex: !!item.regexPath })),
            strictblock: plan.strictblock.map((item) => ({ id: item.id, label: item.label })),
            scripting: plan.scripting.map((item) => ({
                id: item.id,
                label: item.label,
                assets: Object.keys(item.assets || {})
            }))
        },
        blocked: adblockRuntime.blockedSession,
        totalBlocked: adblockRuntime.blockedTotal,
        blockedByRuleset: Object.fromEntries(adblockRuntime.blockedByRuleset.entries()),
        recentBlocked: adblockRuntime.recentBlocked.slice(0, 20),
        lastBlockedAt: adblockRuntime.lastBlockedAt,
        lastBlocked: adblockRuntime.lastBlocked,
        config: publicConfig
    };
}

function getAdblockUrlParts(rawUrl = '') {
    try {
        const parsed = new URL(String(rawUrl || ''));
        return {
            hostname: String(parsed.hostname || '').toLowerCase(),
            path: `${parsed.pathname || '/'}${parsed.search || ''}`.slice(0, 220)
        };
    } catch {
        return { hostname: '', path: '' };
    }
}

function getAdblockHostnameVariants(hostname = '', includeEntities = false) {
    const parts = String(hostname || '').toLowerCase().split('.').filter(Boolean);
    const out = [];
    for (let i = 0; i < parts.length; i += 1) {
        out.push(parts.slice(i).join('.'));
    }
    if (includeEntities && parts.length > 1) {
        const n = parts.length - 1;
        for (let i = 0; i < n; i += 1) {
            for (let j = n; j > i; j -= 1) {
                out.push(`${parts.slice(i, j).join('.')}.*`);
            }
        }
    }
    return Array.from(new Set(out));
}

function adblockBinarySearch(sorted, target) {
    let left = 0;
    let right = Array.isArray(sorted) ? sorted.length : 0;
    while (left < right) {
        const index = (left + right) >>> 1;
        const candidate = String(sorted[index] || '');
        let diff = String(target || '').length - candidate.length;
        if (diff === 0) {
            if (target === candidate) return index;
            diff = target < candidate ? -1 : 1;
        }
        if (diff < 0) right = index;
        else left = index + 1;
    }
    return -1;
}

function addAdblockSelectorsFromListIndex(data, listIndex, result) {
    try {
        const list = JSON.parse(`[${data.selectorLists[listIndex]}]`);
        for (const selectorIndex of list) {
            if (selectorIndex >= 0) result.selectors.add(data.selectors[selectorIndex]);
            else result.exceptions.add(data.selectors[~selectorIndex]);
        }
    } catch {
        // ignore malformed upstream selector fragments
    }
}

function compileAdblockRegex(pattern) {
    const source = String(pattern || '');
    if (!source || source.length > 4096) return null;
    try {
        // Upstream adblock regex fragments are data, not user-authored input.
        // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
        return new RegExp(source);
    } catch {
        return null;
    }
}

function collectAdblockSelectorsForHostname(data, hostname) {
    const result = { selectors: new Set(), exceptions: new Set() };
    if (!data || typeof data !== 'object') return [];
    const variants = getAdblockHostnameVariants(hostname, data.hasEntities === true);
    for (const variant of variants) {
        const listRef = adblockBinarySearch(data.hostnames, variant);
        if (listRef !== -1) {
            addAdblockSelectorsFromListIndex(data, data.selectorListRefs[listRef], result);
        }
    }
    const regexes = Array.isArray(data.regexes) ? data.regexes : [];
    for (let i = 0; i < regexes.length; i += 3) {
        try {
            if (!String(hostname || '').includes(String(regexes[i] || ''))) continue;
            const regex = compileAdblockRegex(regexes[i + 1]);
            if (!regex) continue;
            if (!regex.test(hostname)) continue;
            addAdblockSelectorsFromListIndex(data, regexes[i + 2], result);
        } catch {
            // ignore invalid regex selector entry
        }
    }
    for (const exception of result.exceptions) result.selectors.delete(exception);
    return Array.from(result.selectors).filter(Boolean);
}

function collectAdblockProceduralRulesForHostname(data, hostname, sourceId = '') {
    return collectAdblockSelectorsForHostname(data, hostname)
        .map((entry) => {
            try {
                const parsed = JSON.parse(String(entry || ''));
                if (!parsed || typeof parsed !== 'object') return null;
                if (!parsed.selector && !Array.isArray(parsed.tasks) && !Array.isArray(parsed.action)) return null;
                return {
                    ...parsed,
                    source: sourceId
                };
            } catch {
                return null;
            }
        })
        .filter(Boolean)
        .slice(0, 600);
}

function readAdblockTextAsset(filePath) {
    const key = `text:${filePath}`;
    if (adblockRuntime.scriptingCache.has(key)) return adblockRuntime.scriptingCache.get(key);
    let text = '';
    try {
        text = fs.readFileSync(filePath, 'utf8');
    } catch {
        text = '';
    }
    adblockRuntime.scriptingCache.set(key, text);
    return text;
}

function readAdblockJsonAsset(filePath) {
    const key = `json:${filePath}`;
    if (adblockRuntime.scriptingCache.has(key)) return adblockRuntime.scriptingCache.get(key);
    const parsed = readJsonFileSafe(filePath);
    adblockRuntime.scriptingCache.set(key, parsed);
    return parsed;
}

function getAdblockCompanionJsonPath(filePath) {
    const value = String(filePath || '');
    if (!value.endsWith('.js')) return '';
    const jsonPath = `${value.slice(0, -3)}.json`;
    return fs.existsSync(jsonPath) ? jsonPath : '';
}

function stripAdblockCssLicenseHeader(css = '') {
    return String(css || '').replace(/^\/\*[\s\S]*?\*\/\s*/u, '');
}

function stripAdblockScriptLicenseHeader(script = '') {
    return String(script || '').replace(/^\/\*[\s\S]*?\*\/\s*/u, '');
}

function isAdblockYouTubeHostname(hostname = '') {
    const value = String(hostname || '').toLowerCase();
    return YOUTUBE_HOSTNAMES.some((domain) => value === domain || value.endsWith(`.${domain}`));
}

function isAdblockTikTokHostname(hostname = '') {
    const value = String(hostname || '').toLowerCase();
    return value === 'tiktok.com' || value === 'www.tiktok.com' || value === 'm.tiktok.com' || value.endsWith('.tiktok.com');
}

function isAdblockFacebookHostname(hostname = '') {
    const value = String(hostname || '').toLowerCase();
    return value === 'facebook.com' ||
        value === 'www.facebook.com' ||
        value === 'm.facebook.com' ||
        value === 'web.facebook.com' ||
        value.endsWith('.facebook.com');
}

function isAdblockFacebookCoreAssetHostname(hostname = '') {
    const value = String(hostname || '').toLowerCase();
    return [
        'facebook.com',
        'fbcdn.net',
        'fbcdn.com',
        'fbsbx.com',
        'facebook.net'
    ].some((domain) => value === domain || value.endsWith(`.${domain}`));
}

function isAdblockTikTokCoreAssetHostname(hostname = '') {
    const value = String(hostname || '').toLowerCase();
    return [
        'tiktok.com',
        'tiktokcdn.com',
        'tiktokcdn-us.com',
        'tiktokv.com',
        'ttwstatic.com',
        'byteoversea.com',
        'ibyteimg.com',
        'byteimg.com',
        'ibytedtos.com',
        'muscdn.com'
    ].some((domain) => value === domain || value.endsWith(`.${domain}`));
}

const ADBLOCK_PLATFORM_CORE_ASSET_TYPES = new Set([
    'stylesheet',
    'script',
    'font',
    'image',
    'media',
    'xmlhttprequest',
    'xhr',
    'fetch',
    'websocket',
    'ping',
    'other'
]);
const ADBLOCK_PLATFORM_CORE_DOMAINS = Object.freeze([
    {
        page: ['deezer.com'],
        assets: ['deezer.com', 'dzcdn.net']
    },
    {
        page: ['soundcloud.com'],
        assets: ['soundcloud.com', 'sndcdn.com']
    },
    {
        page: ['facebook.com', 'instagram.com'],
        assets: [
            'facebook.com',
            'fbcdn.com',
            'fbcdn.net',
            'fbsbx.com',
            'facebook.net',
            'instagram.com',
            'cdninstagram.com'
        ]
    },
    {
        page: ['tiktok.com'],
        assets: [
            'tiktok.com',
            'tiktokcdn.com',
            'tiktokcdn-us.com',
            'tiktokv.com',
            'ttwstatic.com',
            'byteoversea.com',
            'ibyteimg.com',
            'byteimg.com',
            'ibytedtos.com',
            'muscdn.com'
        ]
    },
    {
        page: ['x.com', 'twitter.com'],
        assets: ['x.com', 'twitter.com', 'twimg.com']
    },
    {
        page: ['reddit.com'],
        assets: ['reddit.com', 'redditstatic.com', 'redditmedia.com', 'redd.it']
    },
    {
        page: ['twitch.tv'],
        assets: ['twitch.tv', 'jtvnw.net', 'ttvnw.net', 'twitchcdn.net', 'ext-twitch.tv']
    },
    {
        page: ['telegram.org', 't.me'],
        assets: ['telegram.org', 't.me']
    },
    {
        page: ['whatsapp.com'],
        assets: ['whatsapp.com', 'whatsapp.net']
    },
    {
        page: ['mixcloud.com'],
        assets: ['mixcloud.com', 'mxcdn.net']
    },
    {
        page: ['spotify.com'],
        assets: ['spotify.com', 'scdn.co', 'spotifycdn.com', 'spotifycdn.net', 'akamaized.net']
    },
    {
        page: ['duckduckgo.com', 'google.com', 'bing.com', 'brave.com', 'github.com'],
        assets: [
            'duckduckgo.com',
            'google.com',
            'gstatic.com',
            'bing.com',
            'brave.com',
            'github.com',
            'githubassets.com'
        ]
    }
]);

function getAdblockHostnameFromUrl(rawUrl = '') {
    try {
        return String(new URL(String(rawUrl || '')).hostname || '').toLowerCase();
    } catch {
        return '';
    }
}

function adblockDomainMatches(hostname = '', domain = '') {
    const host = String(hostname || '').toLowerCase();
    const value = String(domain || '').toLowerCase();
    return !!host && !!value && (host === value || host.endsWith(`.${value}`));
}

function adblockAnyDomainMatches(hostname = '', domains = []) {
    return Array.isArray(domains) && domains.some((domain) => adblockDomainMatches(hostname, domain));
}

function getAdblockRequestSourceHostnames(details = {}) {
    return [
        details?.initiator,
        details?.documentUrl,
        details?.referrer
    ]
        .map((value) => getAdblockHostnameFromUrl(value))
        .filter(Boolean);
}

function isWhatsAppWebRequest(details = {}) {
    const hosts = [
        getAdblockHostnameFromUrl(details?.url),
        ...getAdblockRequestSourceHostnames(details)
    ].filter(Boolean);
    return hosts.some((host) => adblockDomainMatches(host, 'whatsapp.com') || adblockDomainMatches(host, 'whatsapp.net'));
}

function isSpotifyWebRequest(details = {}) {
    const hosts = [
        getAdblockHostnameFromUrl(details?.url),
        ...getAdblockRequestSourceHostnames(details)
    ].filter(Boolean);
    return hosts.some((host) =>
        adblockDomainMatches(host, 'spotify.com') ||
        adblockDomainMatches(host, 'scdn.co') ||
        adblockDomainMatches(host, 'spotifycdn.com') ||
        adblockDomainMatches(host, 'spotifycdn.net')
    );
}

function getWhatsAppCompatibilityUserAgentMain() {
    return 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36';
}

function applyWhatsAppRequestUserAgent(headers = {}) {
    const out = { ...(headers || {}) };
    const key = out['User-Agent'] ? 'User-Agent' : (out['user-agent'] ? 'user-agent' : 'User-Agent');
    out[key] = getWhatsAppCompatibilityUserAgentMain();
    return out;
}

function applySpotifyRequestUserAgent(headers = {}) {
    return applyWhatsAppRequestUserAgent(headers);
}

function normalizeAdblockWebRequestResourceType(value = '') {
    return String(value || '')
        .trim()
        .replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`)
        .replace(/^xml_http_request$/, 'xmlhttprequest')
        .toLowerCase();
}

function getRegistrableDomainMain(hostname = '') {
    const parts = String(hostname || '').toLowerCase().split('.').filter(Boolean);
    if (parts.length <= 2) return parts.join('.');
    return parts.slice(-2).join('.');
}

function isThirdPartyWebRequest(details = {}) {
    try {
        const targetHost = new URL(String(details?.url || '')).hostname;
        const sourceUrl = String(details?.initiator || details?.documentUrl || details?.referrer || '').trim();
        if (!targetHost || !sourceUrl) return false;
        
        const sourceHost = new URL(sourceUrl).hostname;
        const targetDomain = getRegistrableDomainMain(targetHost);
        const sourceDomain = getRegistrableDomainMain(sourceHost);
        
        if (targetDomain === sourceDomain) return false;
        
        // Eko-sistem akrabalıkları (First-Party Sets / Related Website Sets)
        const googleDomains = ['google.com', 'youtube.com', 'googlevideo.com', 'ytimg.com', 'googleapis.com', 'gstatic.com', 'googleusercontent.com', 'ggpht.com'];
        if (googleDomains.includes(targetDomain) && googleDomains.includes(sourceDomain)) return false;
        
        const msDomains = ['bing.com', 'microsoft.com', 'live.com', 'office.com', 'office.net', 'msn.com'];
        if (msDomains.includes(targetDomain) && msDomains.includes(sourceDomain)) return false;
        
        const metaDomains = ['facebook.com', 'fbcdn.net', 'instagram.com', 'cdninstagram.com', 'whatsapp.com'];
        if (metaDomains.includes(targetDomain) && metaDomains.includes(sourceDomain)) return false;

        return true;
    } catch {
        return false;
    }
}

function isPlatformCoreAssetBypassRequest(details = {}) {
    const type = normalizeAdblockWebRequestResourceType(details?.resourceType);
    if (!ADBLOCK_PLATFORM_CORE_ASSET_TYPES.has(type)) return false;
    const requestHostname = getAdblockHostnameFromUrl(details?.url);
    if (!requestHostname) return false;
    if (isAdblockFacebookCoreAssetHostname(requestHostname)) {
        const sourceHostnames = getAdblockRequestSourceHostnames(details);
        return sourceHostnames.some((sourceHostname) => isAdblockFacebookHostname(sourceHostname));
    }
    const sourceHostnames = getAdblockRequestSourceHostnames(details);
    if (!sourceHostnames.length) return false;

    return ADBLOCK_PLATFORM_CORE_DOMAINS.some((entry) => {
        if (!adblockAnyDomainMatches(requestHostname, entry.assets)) return false;
        return sourceHostnames.some((sourceHostname) => adblockAnyDomainMatches(sourceHostname, entry.page));
    });
}

function isGoogleAuthAdblockBypassUrl(rawUrl = '') {
    let parsed;
    try {
        parsed = new URL(String(rawUrl || ''));
    } catch {
        return false;
    }
    const host = String(parsed.hostname || '').toLowerCase();
    const path = `${parsed.pathname || ''}${parsed.search || ''}`.toLowerCase();
    if (
        host === 'gstatic.com' ||
        host.endsWith('.gstatic.com') ||
        host === 'googleusercontent.com' ||
        host.endsWith('.googleusercontent.com') ||
        host === 'googleapis.com' ||
        host.endsWith('.googleapis.com')
    ) {
        return true;
    }
    if (
        host === 'accounts.google.com' ||
        host === 'myaccount.google.com' ||
        host === 'oauth2.googleapis.com' ||
        host === 'accounts.youtube.com'
    ) {
        return true;
    }
    if ((host === 'google.com' || host === 'www.google.com') && (
        path.includes('/signin') ||
        path.includes('/servicelogin') ||
        path.includes('/accountchooser')
    )) {
        return true;
    }
    return false;
}

function isGoogleAuthAdblockBypassRequest(details = {}) {
    return isGoogleAuthAdblockBypassUrl(details?.url) ||
        isGoogleAuthAdblockBypassUrl(details?.initiator) ||
        isGoogleAuthAdblockBypassUrl(details?.documentUrl) ||
        isGoogleAuthAdblockBypassUrl(details?.referrer);
}

function shouldSkipBundledYouTubeServerContractScriptlet(hostname = '', code = '') {
    if (!isAdblockYouTubeHostname(hostname)) return false;
    return String(code || '').includes('serverContract');
}

function buildAdblockScriptingInjection(rawUrl = '') {
    let parsed;
    try {
        parsed = new URL(String(rawUrl || ''));
    } catch {
        return { ok: false, reason: 'invalid-url', css: [], scripts: [], sources: [] };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { ok: false, reason: 'unsupported-protocol', css: [], scripts: [], sources: [] };
    }
    if (isGoogleAuthAdblockBypassUrl(parsed.toString())) {
        return { ok: true, reason: 'google-auth-bypass', css: [], genericImports: [], proceduralRules: [], scripts: [], sources: [] };
    }

    const plan = getActiveRulesetPlan(adblockRuntime.config);
    const hostname = String(parsed.hostname || '').toLowerCase();
    const css = [];
    const genericImports = [];
    const proceduralRules = [];
    const scripts = [];
    const sources = [];

    if (isAdblockFacebookHostname(hostname)) {
        return {
            ok: true,
            reason: 'facebook-cosmetic-bypass',
            mode: plan.mode,
            hostname,
            css,
            genericImports,
            proceduralRules,
            scripts,
            sources: ['facebook:cosmetic-bypass']
        };
    }

    if (isAdblockYouTubeHostname(hostname) && shouldEnableWebviewAdblockPreloadOnThisRuntime()) {
        scripts.push({
            id: 'deliblock-youtube-server-contract',
            world: 'main',
            enabled: true,
            code: ADBLOCK_YOUTUBE_SERVER_CONTRACT_SCRIPTLET
        });
        sources.push('deliblock-youtube:scriptlet');
    }

    for (const item of plan.scripting) {
        const assets = item.assets || {};
        if (assets.generic) {
            const code = stripAdblockScriptLicenseHeader(readAdblockTextAsset(assets.generic));
            if (code.trim()) {
                genericImports.push({ id: item.id, code });
                sources.push(`${item.id}:generic`);
            }
        }
        if (assets.generichigh) {
            const text = stripAdblockCssLicenseHeader(readAdblockTextAsset(assets.generichigh));
            if (text.trim()) {
                css.push(text);
                sources.push(`${item.id}:generichigh`);
            }
        }
        if (assets.specific) {
            const jsonPath = getAdblockCompanionJsonPath(assets.specific);
            const data = jsonPath ? readAdblockJsonAsset(jsonPath) : null;
            const selectors = collectAdblockSelectorsForHostname(data, hostname);
            if (selectors.length > 0) {
                css.push(`${selectors.join(',\n')}{display:none!important;}`);
                sources.push(`${item.id}:specific`);
            }
        }
        if (assets.scriptletIsolated) {
            const code = stripAdblockScriptLicenseHeader(readAdblockTextAsset(assets.scriptletIsolated));
            if (!shouldSkipBundledYouTubeServerContractScriptlet(hostname, code)) {
                scripts.push({
                    id: `${item.id}:scriptletIsolated`,
                    world: 'isolated',
                    enabled: !!code.trim(),
                    code
                });
            }
        }
        if (assets.scriptletMain) {
            const code = stripAdblockScriptLicenseHeader(readAdblockTextAsset(assets.scriptletMain));
            if (!shouldSkipBundledYouTubeServerContractScriptlet(hostname, code)) {
                scripts.push({
                    id: `${item.id}:scriptletMain`,
                    world: 'main',
                    enabled: !!code.trim(),
                    code
                });
            }
        }
        if (assets.procedural) {
            const jsonPath = getAdblockCompanionJsonPath(assets.procedural);
            const data = jsonPath ? readAdblockJsonAsset(jsonPath) : null;
            const rules = collectAdblockProceduralRulesForHostname(data, hostname, item.id);
            if (rules.length > 0) {
                proceduralRules.push(...rules);
                sources.push(`${item.id}:procedural`);
            }
        }
    }

    return {
        ok: true,
        mode: plan.mode,
        hostname,
        css,
        genericImports,
        proceduralRules,
        scripts,
        sources
    };
}

function recordAdblockMatch(details = {}, match = {}) {
    const now = Date.now();
    const url = String(details?.url || '');
    const { hostname, path: urlPath } = getAdblockUrlParts(url);
    const ruleset = String(match?.ruleset || match?.reason || 'legacy').trim() || 'legacy';
    const record = {
        at: now,
        url,
        hostname,
        path: urlPath,
        resourceType: String(details?.resourceType || ''),
        method: String(details?.method || ''),
        initiator: String(details?.initiator || details?.documentUrl || details?.referrer || ''),
        reason: String(match?.reason || ''),
        action: String(match?.action || 'block'),
        rule: String(match?.rule || ''),
        ruleset
    };

    const countKey = [
        record.action,
        record.ruleset,
        record.rule,
        record.hostname,
        record.path,
        record.resourceType
    ].join('|');
    const lastSeen = Number(adblockRuntime.recentMatchKeys.get(countKey) || 0);
    const noisyYouTubeStat = (
        /(^|\.)youtube\.com$/i.test(record.hostname) &&
        (/\/api\/stats\//i.test(record.path) || /[?&](adformat|qoe)=/i.test(record.path))
    );
    const countable = !noisyYouTubeStat && (now - lastSeen > 2500);
    adblockRuntime.recentMatchKeys.set(countKey, now);
    for (const [key, at] of adblockRuntime.recentMatchKeys.entries()) {
        if (now - Number(at || 0) > 15000) adblockRuntime.recentMatchKeys.delete(key);
    }

    if (countable) {
        adblockRuntime.blockedSession += 1;
        adblockRuntime.blockedTotal += 1;
        adblockRuntime.blockedByRuleset.set(ruleset, Number(adblockRuntime.blockedByRuleset.get(ruleset) || 0) + 1);
    }
    adblockRuntime.lastBlockedAt = now;
    adblockRuntime.lastBlocked = record;
    adblockRuntime.recentBlocked.unshift(record);
    if (adblockRuntime.recentBlocked.length > 40) {
        adblockRuntime.recentBlocked.length = 40;
    }
}

function loadAdblockRuleset(rulesetId, realm = 'main') {
    const id = String(rulesetId || '').trim();
    if (!id) return [];
    const cacheKey = `${realm}:${id}`;
    if (adblockRuntime.rulesetCache.has(cacheKey)) return adblockRuntime.rulesetCache.get(cacheKey);

    const filePath = getRulesetAssetPath(id, realm);
    if (!filePath) return [];

    let rules = [];
    try {
        const parsed = readJsonFileSafe(filePath);
        if (Array.isArray(parsed)) {
            rules = parsed
                .filter((rule) => rule && typeof rule === 'object')
                .map((rule) => ({ ...rule, ruleset: id }));
        }
    } catch (error) {
        console.warn('[ADBLOCK] ruleset load failed:', { id, filePath, error: error?.message || error });
    }

    adblockRuntime.rulesetCache.set(cacheKey, rules);
    return rules;
}

function loadAdblockStrictblockRuleset(rulesetId, filePath = '') {
    const id = String(rulesetId || '').trim();
    if (!id) return [];
    if (adblockRuntime.strictblockCache.has(id)) return adblockRuntime.strictblockCache.get(id);

    const sourcePath = filePath || getRulesetAssetPath(id, 'strictblock');
    if (!sourcePath) return [];

    let rules = [];
    try {
        const parsed = readJsonFileSafe(sourcePath);
        if (Array.isArray(parsed)) {
            rules = parsed
                .filter((rule) => rule && typeof rule === 'object')
                .map((rule, index) => ({
                    ...rule,
                    id: 1200000 + (Number(rule.id) || index + 1),
                    priority: Math.max(80, Number(rule.priority || 0) || 0),
                    action: { type: 'redirect', redirect: { url: ADBLOCK_STRICTBLOCK_URL } },
                    ruleset: `strictblock-${id}`
                }));
        }
    } catch (error) {
        console.warn('[ADBLOCK] strictblock ruleset load failed:', { id, filePath: sourcePath, error: error?.message || error });
    }

    adblockRuntime.strictblockCache.set(id, rules);
    return rules;
}

function buildAdblockConfig(config = {}) {
    const normalized = normalizeAdblockConfig(config);
    const rules = [...ADBLOCK_NOOP_DNR_RULES, ...ADBLOCK_YOUTUBE_DNR_RULES, ...ADBLOCK_PLATFORM_CORE_DNR_RULES];
    const plan = getActiveRulesetPlan(normalized);
    for (const item of plan.dnr) {
        rules.push(...loadAdblockRuleset(item.id, 'main'));
        rules.push(...loadAdblockRuleset(item.id, 'regex'));
    }
    for (const item of plan.strictblock) {
        rules.push(...loadAdblockStrictblockRuleset(item.id, item.path));
    }
    return normalizeAdblockConfig({
        ...normalized,
        dnrRules: rules
    });
}

function getAdblockDevelopRulesetDetails() {
    return getDevelopRulesetDetails();
}

function listAdblockDevelopSources() {
    const rulesets = getAdblockDevelopRulesetDetails();
    return {
        ok: true,
        source: ADBLOCK_RULESET_ROOT_DIR,
        sources: [
            { id: 'modes', label: 'Filtreleme modu ayrıntıları', group: 'editors', editable: false },
            { id: 'dnr.rw.user', label: 'Özel DNR kuralları', group: 'editors', editable: true },
            { id: 'dnr.ro.dynamic', label: 'Dynamic ruleset', group: 'readonly', editable: false },
            { id: 'dnr.ro.session', label: 'Session ruleset', group: 'readonly', editable: false },
            ...rulesets.map((item) => ({
                id: `dnr.ro.${item.id}`,
                label: item.name,
                group: 'rulesets',
                rulesetId: item.id,
                editable: false
            }))
        ]
    };
}

function readRulesetRulesFromSource(rulesetId, realm) {
    const id = String(rulesetId || '').replace(/[^a-z0-9_.-]/gi, '');
    if (!id) return [];

    const filePath = getRulesetAssetPath(id, realm === 'regex' ? 'regex' : 'main');
    const parsed = filePath ? readJsonFileSafe(filePath) : null;
    return Array.isArray(parsed) ? parsed : [];
}

function formatAdblockDevelopJson(title, value) {
    const body = JSON.stringify(value, null, 1);
    return `# ${title}\n${body}\n`;
}

function readAdblockDevelopSource(sourceId) {
    const id = String(sourceId || 'modes');
    if (id === 'modes') {
        const plan = getActiveRulesetPlan(adblockRuntime.config);
        const formatItems = (items, fallback) => (
            Array.isArray(items) && items.length
                ? items.map((item) => `  - ${item.label || item.id}`).join('\n')
                : `  - ${fallback}`
        );
        return {
            ok: true,
            editable: false,
            text: [
                'DeliBlock registry:',
                `mode: ${plan.mode}`,
                '',
                'active network rulesets:',
                formatItems(plan.dnr, 'Henüz aktif kaynak yok'),
                '',
                'active strictblock rulesets:',
                formatItems(plan.strictblock, 'Kapalı'),
                '',
                'available scripting assets:',
                formatItems(plan.scripting.map((item) => ({
                    ...item,
                    label: `${item.label || item.id} (${Object.keys(item.assets || {}).join(', ')})`
                })), 'Henüz bağlı değil'),
                ''
            ].join('\n')
        };
    }

    if (id === 'dnr.rw.user') {
        return {
            ok: true,
            editable: true,
            text: '[\n]\n'
        };
    }

    if (id === 'dnr.ro.dynamic' || id === 'dnr.ro.session') {
        const rules = id.endsWith('.dynamic') ? (adblockRuntime.config?.dnrRules || []) : [];
        return {
            ok: true,
            editable: false,
            text: formatAdblockDevelopJson(id === 'dnr.ro.dynamic' ? 'Dynamic ruleset' : 'Session ruleset', rules)
        };
    }

    const match = /^dnr\.ro\.(.+)$/.exec(id);
    if (match) {
        const rulesetId = match[1];
        const details = getAdblockDevelopRulesetDetails().find((item) => item.id === rulesetId);
        const mainRules = readRulesetRulesFromSource(rulesetId, 'main');
        const regexRules = readRulesetRulesFromSource(rulesetId, 'regex');
        const rules = [...mainRules, ...regexRules];
        return {
            ok: true,
            editable: false,
            text: formatAdblockDevelopJson(`${details?.name || rulesetId} (${rules.length.toLocaleString()} DNR rules)`, rules)
        };
    }

    return { ok: false, editable: false, text: `# Bilinmeyen geliştirici kaynağı: ${id}\n` };
}

function installAdblockRequestBlocking() {
    adblockRuntime.config = buildAdblockConfig(adblockRuntime.config);
    if (adblockRuntime.installed) return;
    adblockRuntime.installed = true;

    const webSessions = getWebSessions();
    for (const ses of webSessions) {
        try {
            ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
                try {
                    if (isGoogleAuthAdblockBypassRequest(details)) {
                        callback({});
                        return;
                    }
                    if (isPlatformCoreAssetBypassRequest(details)) {
                        callback({});
                        return;
                    }
                    const resType = String(details?.resourceType || '').toLowerCase();
                    if (resType === 'mainframe' || resType === 'main_frame') {
                        callback({});
                        return;
                    }
                    const host = String(new URL(details?.url || 'https://empty').hostname).toLowerCase();
                    if (host.includes('google.com') || host.includes('duckduckgo.com') || host.includes('bing.com') || host.includes('brave.com')) {
                        callback({});
                        return;
                    }
                    const match = shouldBlockRequest(details?.url, details?.resourceType, adblockRuntime.config, details);
                    if (match) {
                        recordAdblockMatch(details, match);
                        if (adblockRuntime.config.developerMode) {
                            console.log('[ADBLOCK] blocked', adblockRuntime.lastBlocked);
                        }
                        if (match.action === 'redirect' && match.redirectUrl) {
                            callback({ redirectURL: String(match.redirectUrl) });
                        } else {
                            callback({ cancel: true });
                        }
                        return;
                    }
                } catch (error) {
                    console.warn('[ADBLOCK] request filter error:', error?.message || error);
                }
                callback({});
            });
        } catch (error) {
            console.warn('[ADBLOCK] install failed:', error?.message || error);
        }

        try {
            ses.webRequest.onBeforeSendHeaders({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
                try {
                    if (isGoogleAuthAdblockBypassRequest(details)) {
                        callback({ requestHeaders: details?.requestHeaders || {} });
                        return;
                    }
                    if (isWhatsAppWebRequest(details)) {
                        callback({ requestHeaders: applyWhatsAppRequestUserAgent(details?.requestHeaders || {}) });
                        return;
                    }
                    if (isSpotifyWebRequest(details)) {
                        callback({ requestHeaders: applySpotifyRequestUserAgent(details?.requestHeaders || {}) });
                        return;
                    }
                    if (isPlatformCoreAssetBypassRequest(details)) {
                        callback({ requestHeaders: details?.requestHeaders || {} });
                        return;
                    }
                    const match = evaluateDnrHeaderModifications(details?.url, details?.resourceType, adblockRuntime.config, details, 'request');
                    if (match?.requestHeaders) {
                        callback({ requestHeaders: match.requestHeaders });
                        return;
                    }
                    const webPrefs = getWebRuntimeSettingsSync();
                    const headers = { ...(details?.requestHeaders || {}) };
                    // Sadece üçüncü taraf isteklere giderken referer bilgisini gizle.
                    // Kendi sitesine (First-party API) giderken referer silinirse CSRF korumasına takılır (örn: Gemini batchexecute).
                    if (webPrefs.reduceReferrers && isThirdPartyWebRequest(details)) {
                        delete headers.Referer;
                        delete headers.referer;
                    }
                    if (webPrefs.blockThirdPartyCookies && isThirdPartyWebRequest(details)) {
                        delete headers.Cookie;
                        delete headers.cookie;
                    }

                    callback({ requestHeaders: headers });
                    return;
                } catch (error) {
                    console.warn('[ADBLOCK] request header filter error:', error?.message || error);
                }
                callback({ requestHeaders: details?.requestHeaders || {} });
            });
        } catch (error) {
            console.warn('[ADBLOCK] request header install failed:', error?.message || error);
        }

        try {
            ses.webRequest.onHeadersReceived({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
                try {
                    if (isGoogleAuthAdblockBypassRequest(details)) {
                        callback({ responseHeaders: details?.responseHeaders || {} });
                        return;
                    }
                    if (isPlatformCoreAssetBypassRequest(details)) {
                        callback({ responseHeaders: details?.responseHeaders || {} });
                        return;
                    }
                    const resType = String(details?.resourceType || '').toLowerCase();
                    if (resType === 'mainframe' || resType === 'main_frame') {
                        callback({ responseHeaders: details?.responseHeaders || {} });
                        return;
                    }
                    const host = String(new URL(details?.url || 'https://empty').hostname).toLowerCase();
                    if (host.includes('google.com') || host.includes('duckduckgo.com') || host.includes('bing.com') || host.includes('brave.com')) {
                        callback({ responseHeaders: details?.responseHeaders || {} });
                        return;
                    }
                    const blockMatch = shouldBlockRequest(details?.url, details?.resourceType, adblockRuntime.config, details);
                    if (blockMatch) {
                        recordAdblockMatch(details, blockMatch);
                        callback({ cancel: true });
                        return;
                    }

                    const headerMatch = evaluateDnrHeaderModifications(details?.url, details?.resourceType, adblockRuntime.config, details, 'response');
                    if (headerMatch?.responseHeaders) {
                        callback({ responseHeaders: headerMatch.responseHeaders });
                        return;
                    }
                    const webPrefs = getWebRuntimeSettingsSync();
                    if (webPrefs.blockThirdPartyCookies && isThirdPartyWebRequest(details)) {
                        const headers = { ...(details?.responseHeaders || {}) };
                        for (const key of Object.keys(headers)) {
                            if (String(key).toLowerCase() === 'set-cookie') delete headers[key];
                        }
                        callback({ responseHeaders: headers });
                        return;
                    }
                } catch (error) {
                    console.warn('[ADBLOCK] response header filter error:', error?.message || error);
                }
                callback({ responseHeaders: details?.responseHeaders || {} });
            });
        } catch (error) {
            console.warn('[ADBLOCK] response header install failed:', error?.message || error);
        }
    }
}

ipcMain.handle('adblock:setConfig', async (_event, config) => {
    adblockRuntime.config = buildAdblockConfig(config);
    installAdblockRequestBlocking();
    return { ok: true, stats: getAdblockStatsSnapshot() };
});

ipcMain.handle('adblock:getStats', async () => {
    adblockRuntime.config = buildAdblockConfig(adblockRuntime.config);
    installAdblockRequestBlocking();
    return getAdblockStatsSnapshot();
});

ipcMain.handle('adblock:resetStats', async () => {
    adblockRuntime.blockedSession = 0;
    adblockRuntime.blockedTotal = 0;
    adblockRuntime.blockedByRuleset.clear();
    adblockRuntime.recentMatchKeys.clear();
    adblockRuntime.recentBlocked = [];
    adblockRuntime.lastBlockedAt = 0;
    adblockRuntime.lastBlocked = null;
    return getAdblockStatsSnapshot();
});

ipcMain.handle('adblock:listDevelopSources', async () => {
    return listAdblockDevelopSources();
});

ipcMain.handle('adblock:readDevelopSource', async (_event, sourceId) => {
    return readAdblockDevelopSource(sourceId);
});

ipcMain.handle('adblock:getScriptingInjection', async (_event, payload = {}) => {
    adblockRuntime.config = buildAdblockConfig(adblockRuntime.config);
    return buildAdblockScriptingInjection(payload?.url || '');
});

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
    'www.t.me',
    'spotify.com',
    'www.spotify.com',
    'open.spotify.com',
    'accounts.spotify.com'
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
    '.telegram.org',
    '.spotify.com'
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
    '.gvt1.com',
    '.scdn.co',
    '.spotifycdn.com',
    '.spotifycdn.net',
    '.akamaized.net'
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
        // Security: block prototype pollution keys
        if (p === '__proto__' || p === 'constructor' || p === 'prototype') return undefined;
        if (!cur || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, p)) return undefined;
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
        path.join('/app', 'share', 'applications', 'com.ardali.mediaplayer.desktop'),
        path.join('/app', 'share', 'applications', 'ardali.desktop'),
        path.join(home, '.local', 'share', 'applications', 'ardali.desktop'),
        path.join(home, '.local', 'share', 'applications', 'com.ardali.mediaplayer.desktop'),
        path.join('/usr/local/share/applications', 'ardali.desktop'),
        path.join('/usr/local/share/applications', 'com.ardali.mediaplayer.desktop'),
        path.join('/usr/share/applications', 'ardali.desktop'),
        path.join('/usr/share/applications', 'com.ardali.mediaplayer.desktop')
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
    return 'com.ardali.mediaplayer';
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
                    label: tMainSync('about.github'),
                    click: () => shell.openExternal('https://github.com/muhammed-ardali-dev/ArDali-Medya-Player-Linux').catch(() => { /* yoksay */ })
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

function writeJsonFileAtomicSync(filePath, obj) {
    const dir = path.dirname(filePath);
    try {
        fs.mkdirSync(dir, { recursive: true });
    } catch {
        // yoksay
    }

    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(obj ?? {}, null, 2), 'utf8');
    try {
        fs.renameSync(tmpPath, filePath);
    } catch (error) {
        if (error && (error.code === 'EEXIST' || error.code === 'EPERM' || error.code === 'EACCES')) {
            try { fs.unlinkSync(filePath); } catch { /* yoksay */ }
            fs.renameSync(tmpPath, filePath);
            return;
        }
        throw error;
    } finally {
        try { fs.unlinkSync(tmpPath); } catch { /* yoksay */ }
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
        const settings = await readSettingsFileSafe();
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

function clampAudioNumber(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

function getPersistedMusicSfxEffect(settings, effectName) {
    const key = String(effectName || '').trim().toLowerCase();
    if (!key) return {};
    return settings?.sfxScopes?.music?.[key] || settings?.sfx?.[key] || {};
}

function callAudioEngine(methodName, ...args) {
    if (!audioEngine || !isNativeAudioAvailable) return false;
    const fn = audioEngine[methodName];
    if (typeof fn !== 'function') return false;
    try {
        fn.apply(audioEngine, args);
        return true;
    } catch (e) {
        console.warn(`[SFX] ${methodName} uygulanamadı:`, e?.message || e);
        return false;
    }
}

function boolSetting(value, fallback = false) {
    return value === undefined ? fallback : value === true;
}

function numSetting(value, min, max, fallback) {
    return clampAudioNumber(value, min, max, fallback);
}

function applyPersistedDynamicsSfx(settings) {
    const compressor = getPersistedMusicSfxEffect(settings, 'compressor');
    if (Object.keys(compressor).length > 0) {
        const enabled = boolSetting(compressor.enabled);
        callAudioEngine('enableCompressor', enabled);
        if (enabled) {
            callAudioEngine('setCompressorThreshold', numSetting(compressor.threshold, -80, 0, -20));
            callAudioEngine('setCompressorRatio', numSetting(compressor.ratio, 1, 20, 4));
            callAudioEngine('setCompressorAttack', numSetting(compressor.attack, 0.1, 1000, 10));
            callAudioEngine('setCompressorRelease', numSetting(compressor.release, 1, 5000, 100));
            callAudioEngine('setCompressorMakeupGain', numSetting(compressor.makeupGain, -24, 24, 0));
            callAudioEngine('setCompressorKnee', numSetting(compressor.knee, 0, 24, 3));
        }
    }

    const limiter = getPersistedMusicSfxEffect(settings, 'limiter');
    if (Object.keys(limiter).length > 0) {
        const enabled = boolSetting(limiter.enabled);
        callAudioEngine('EnableLimiter', enabled);
        if (enabled) {
            callAudioEngine('SetLimiterCeiling', numSetting(limiter.ceiling, -18, 0, -0.3));
            callAudioEngine('SetLimiterRelease', numSetting(limiter.release, 1, 1000, 50));
            callAudioEngine('SetLimiterLookahead', numSetting(limiter.lookahead, 0, 25, 5));
            callAudioEngine('SetLimiterGain', numSetting(limiter.gain, -24, 24, 0));
        }
    }

    const noiseGate = getPersistedMusicSfxEffect(settings, 'noisegate');
    if (Object.keys(noiseGate).length > 0) {
        const enabled = boolSetting(noiseGate.enabled);
        callAudioEngine('EnableNoiseGate', enabled);
        if (enabled) {
            callAudioEngine('SetNoiseGateThreshold', numSetting(noiseGate.threshold, -100, 0, -40));
            callAudioEngine('SetNoiseGateAttack', numSetting(noiseGate.attack, 0.1, 1000, 5));
            callAudioEngine('SetNoiseGateHold', numSetting(noiseGate.hold, 0, 2000, 100));
            callAudioEngine('SetNoiseGateRelease', numSetting(noiseGate.release, 1, 5000, 150));
            callAudioEngine('SetNoiseGateRange', numSetting(noiseGate.range, -100, 0, -80));
        }
    }
}

function applyPersistedColorSfx(settings) {
    const bassBoost = getPersistedMusicSfxEffect(settings, 'bassboost');
    if (Object.keys(bassBoost).length > 0) {
        callAudioEngine(
            'setBassBoostDsp',
            boolSetting(bassBoost.enabled),
            numSetting(bassBoost.gain, -24, 24, 6),
            numSetting(bassBoost.frequency, 20, 500, 80)
        );
    }

    const bassEnhancer = getPersistedMusicSfxEffect(settings, 'bass-enhancer');
    if (Object.keys(bassEnhancer).length > 0) {
        const enabled = boolSetting(bassEnhancer.enabled);
        callAudioEngine('EnableBassEnhancer', enabled);
        if (enabled) {
            callAudioEngine('SetBassEnhancerFrequency', numSetting(bassEnhancer.frequency, 20, 500, 80));
            callAudioEngine('SetBassEnhancerGain', numSetting(bassEnhancer.gain, -24, 24, 6));
            callAudioEngine('SetBassEnhancerHarmonics', numSetting(bassEnhancer.harmonics, 0, 100, 50));
            callAudioEngine('SetBassEnhancerWidth', numSetting(bassEnhancer.width, 0, 4, 1.5));
            callAudioEngine('SetBassEnhancerMix', numSetting(bassEnhancer.dryWet ?? bassEnhancer.mix, 0, 100, 50));
        }
    }

    const exciter = getPersistedMusicSfxEffect(settings, 'exciter');
    if (Object.keys(exciter).length > 0) {
        const enabled = boolSetting(exciter.enabled);
        callAudioEngine('EnableExciter', enabled);
        if (enabled) {
            const typeMap = { odd: 0, even: 1, tape: 2, tube: 3 };
            const type = Number.isFinite(Number(exciter.type))
                ? Number(exciter.type)
                : (typeMap[String(exciter.harmonics || 'odd')] ?? 0);
            callAudioEngine('SetExciterAmount', numSetting(exciter.amount, 0, 100, 50));
            callAudioEngine('SetExciterFrequency', numSetting(exciter.frequency, 500, 16000, 3000));
            callAudioEngine('SetExciterHarmonics', numSetting(exciter.amount, 0, 100, 50));
            callAudioEngine('SetExciterMix', numSetting(exciter.mix, 0, 100, 30));
            callAudioEngine('SetExciterType', type);
        }
    }

    const tapeSat = getPersistedMusicSfxEffect(settings, 'tapesat');
    if (Object.keys(tapeSat).length > 0) {
        const enabled = boolSetting(tapeSat.enabled);
        callAudioEngine('enableTapeSaturation', enabled);
        if (enabled) {
            callAudioEngine('setTapeDrive', numSetting(tapeSat.driveDb, 0, 24, 6));
            callAudioEngine('setTapeMix', numSetting(tapeSat.mix, 0, 100, 50));
            callAudioEngine('setTapeTone', numSetting(tapeSat.tone, 0, 100, 50));
            callAudioEngine('setTapeOutput', numSetting(tapeSat.outputDb, -24, 24, -1));
            callAudioEngine('setTapeMode', numSetting(tapeSat.mode, 0, 3, 0));
            callAudioEngine('setTapeHiss', numSetting(tapeSat.hiss, 0, 100, 0));
        }
    }
}

function applyPersistedSpaceSfx(settings) {
    const reverb = getPersistedMusicSfxEffect(settings, 'reverb');
    if (Object.keys(reverb).length > 0) {
        const enabled = boolSetting(reverb.enabled);
        callAudioEngine('setReverbEnabled', enabled);
        if (enabled) {
            callAudioEngine('setReverbRoomSize', numSetting(reverb.roomSize, 1, 10000, 1000));
            callAudioEngine('setReverbDamping', numSetting(reverb.damping, 0, 1, 0.5));
            callAudioEngine('setReverbWetDry', numSetting(reverb.wetDry, -96, 12, -10));
            callAudioEngine('setReverbHFRatio', numSetting(reverb.hfRatio, 0, 1, 0.7));
            callAudioEngine('setReverbInputGain', numSetting(reverb.inputGain, -24, 24, 0));
        }
    }

    const echo = getPersistedMusicSfxEffect(settings, 'echo');
    const softEcho = getPersistedMusicSfxEffect(settings, 'softecho');
    const softEnabled = boolSetting(softEcho.enabled);
    const echoEnabled = boolSetting(echo.enabled) && !softEnabled;
    if (Object.keys(echo).length > 0 || softEnabled) {
        callAudioEngine('EnableEchoEffect', echoEnabled);
        if (echoEnabled) {
            callAudioEngine('SetEchoDelayTime', numSetting(echo.delay, 1, 3000, 250));
            callAudioEngine('SetEchoFeedback', numSetting(echo.feedback, 0, 95, 40));
            callAudioEngine('SetEchoWetMix', numSetting(echo.wetMix ?? echo.wetDry, 0, 100, 30));
            callAudioEngine('SetEchoDryMix', numSetting(echo.dryMix, 0, 100, 100));
            callAudioEngine('SetEchoStereoMode', !!(echo.stereo || echo.pingPong));
            callAudioEngine('SetEchoLowCut', numSetting(echo.lowCut, 20, 500, 80));
            callAudioEngine('SetEchoHighCut', numSetting(echo.highCut, 2000, 16000, 8000));
        }
    }
    if (Object.keys(softEcho).length > 0) {
        callAudioEngine('EnableSoftEchoEffect', softEnabled);
        if (softEnabled) {
            callAudioEngine('EnableEchoEffect', false);
            callAudioEngine('SetSoftEchoDelayTime', numSetting(softEcho.delay, 1, 3000, 520));
            callAudioEngine('SetSoftEchoFeedback', numSetting(softEcho.feedback, 0, 95, 8));
            callAudioEngine('SetSoftEchoWetMix', numSetting(softEcho.wetMix, 0, 100, 28));
            callAudioEngine('SetSoftEchoDryMix', numSetting(softEcho.dryMix, 0, 100, 100));
            callAudioEngine('SetSoftEchoHighCut', numSetting(softEcho.highCut, 2000, 16000, 4200));
            callAudioEngine('SetSoftEchoStereoMode', !!softEcho.stereo);
        }
    }

    const conv = getPersistedMusicSfxEffect(settings, 'convreverb');
    if (Object.keys(conv).length > 0) {
        const enabled = boolSetting(conv.enabled);
        callAudioEngine('EnableConvolutionReverb', enabled);
        if (enabled) {
            callAudioEngine('SetConvReverbWetMix', numSetting(conv.mix ?? conv.wetMix, 0, 100, 30));
            callAudioEngine('SetConvReverbDryMix', numSetting(conv.dryMix, 0, 100, 100));
            callAudioEngine('SetConvReverbPreDelay', numSetting(conv.predelay ?? conv.preDelay, 0, 500, 20));
            callAudioEngine('SetConvReverbRoomSize', numSetting(conv.roomSize, 0, 100, 50));
            callAudioEngine('SetConvReverbDecay', numSetting(conv.decay, 0.1, 30, 1.5));
            callAudioEngine('SetConvReverbDamping', numSetting(conv.damping, 0, 1, 0.5));
            if (conv.roomType !== undefined) callAudioEngine('SetConvReverbRoomType', conv.roomType);
        }
    }
}

function applyPersistedStereoSfx(settings) {
    const stereo = getPersistedMusicSfxEffect(settings, 'stereowidener');
    if (Object.keys(stereo).length > 0) {
        const enabled = boolSetting(stereo.enabled);
        callAudioEngine('EnableStereoWidener', enabled);
        if (enabled) {
            callAudioEngine('SetStereoWidth', numSetting(stereo.width, 0, 300, 100));
            callAudioEngine('SetStereoBassCutoff', numSetting(stereo.bassToMono ?? stereo.bassFreq, 20, 500, 200));
            callAudioEngine('SetStereoDelay', numSetting(stereo.delay, 0, 40, 0));
            callAudioEngine('SetStereoBalance', numSetting(stereo.balance, -100, 100, 0));
            callAudioEngine('SetStereoMonoLow', stereo.monoLow !== false);
        }
    }

    const crossfeed = getPersistedMusicSfxEffect(settings, 'crossfeed');
    if (Object.keys(crossfeed).length > 0) {
        const enabled = boolSetting(crossfeed.enabled);
        callAudioEngine('enableCrossfeed', enabled);
        if (enabled) {
            callAudioEngine('setCrossfeedLevel', numSetting(crossfeed.level, 0, 100, 30));
            callAudioEngine('setCrossfeedDelay', numSetting(crossfeed.delay, 0, 2, 0.3));
            callAudioEngine('setCrossfeedLowCut', numSetting(crossfeed.lowCut, 20, 2000, 700));
            callAudioEngine('setCrossfeedHighCut', numSetting(crossfeed.highCut, 1000, 12000, 4000));
            callAudioEngine('setCrossfeedPreset', numSetting(crossfeed.preset, 0, 8, 0));
        }
    }

    const surround = getPersistedMusicSfxEffect(settings, 'surround');
    if (Object.keys(surround).length > 0) {
        const enabled = boolSetting(surround.enabled);
        callAudioEngine('EnableSurroundVirtualizer', enabled);
        if (enabled) {
            callAudioEngine('SetSurroundCenterLevel', numSetting(surround.center, -24, 24, 0));
            callAudioEngine('SetSurroundSideLevel', numSetting(surround.surround, -24, 24, 0));
            callAudioEngine('SetSurroundLfeLevel', numSetting(surround.lfe, -24, 24, 0));
            callAudioEngine('SetSurroundCrossover', numSetting(surround.crossover, 40, 250, 110));
            callAudioEngine('SetSurroundRearDelay', numSetting(surround.delay, 0, 50, 8));
            callAudioEngine('SetSurroundMix', numSetting(surround.mix, 0, 100, 75));
        }
    }

    const bassMono = getPersistedMusicSfxEffect(settings, 'bassmono');
    if (Object.keys(bassMono).length > 0) {
        const enabled = boolSetting(bassMono.enabled);
        callAudioEngine('EnableBassMono', enabled);
        if (enabled) {
            callAudioEngine('SetBassMonoCutoff', numSetting(bassMono.cutoff, 20, 500, 120));
            callAudioEngine('SetBassMonoSlope', numSetting(bassMono.slope, 6, 48, 24));
            callAudioEngine('SetBassMonoStereoWidth', numSetting(bassMono.stereoWidth, 0, 200, 100));
        }
    }
}

function applyPersistedEqToolsSfx(settings) {
    const peq = getPersistedMusicSfxEffect(settings, 'peq');
    if (Array.isArray(peq.bands)) {
        peq.bands.forEach((band, index) => {
            if (!band || typeof band !== 'object') return;
            callAudioEngine(
                'setPEQ',
                index,
                boolSetting(peq.enabled),
                numSetting(band.freq, 20, 22000, 1000),
                numSetting(band.gain, -24, 24, 0),
                numSetting(band.q, 0.1, 18, 1)
            );
        });
    }

    const autoGain = getPersistedMusicSfxEffect(settings, 'autogain');
    if (Object.keys(autoGain).length > 0) {
        const enabled = boolSetting(autoGain.enabled);
        callAudioEngine('setAutoGainEnabled', enabled);
        if (enabled) {
            callAudioEngine('setAutoGainTarget', numSetting(autoGain.targetLevel, -30, -3, -14));
            callAudioEngine('setAutoGainMaxGain', numSetting(autoGain.maxGain, 0, 24, 12));
        }
    }

    const truePeak = getPersistedMusicSfxEffect(settings, 'truepeak');
    if (Object.keys(truePeak).length > 0) {
        const enabled = boolSetting(truePeak.enabled);
        callAudioEngine('setTruePeakEnabled', enabled);
        if (enabled) {
            callAudioEngine('setTruePeakCeiling', numSetting(truePeak.ceiling, -18, 0, -0.1));
            callAudioEngine('setTruePeakRelease', numSetting(truePeak.release, 1, 1000, 50));
            callAudioEngine('setTruePeakLookahead', numSetting(truePeak.lookahead, 0, 25, 5));
            callAudioEngine('setTruePeakInputGain', numSetting(truePeak.drive, -24, 24, 0));
            callAudioEngine('setTruePeakOversampling', numSetting(truePeak.oversampling, 1, 8, 4));
            callAudioEngine('setTruePeakLinkChannels', truePeak.linkChannels !== false);
        }
    }

    const dynamicEq = getPersistedMusicSfxEffect(settings, 'dynamiceq');
    if (Object.keys(dynamicEq).length > 0) {
        const enabled = boolSetting(dynamicEq.enabled);
        callAudioEngine('enableDynamicEQ', enabled);
        if (enabled) {
            callAudioEngine('setDynamicEQFrequency', numSetting(dynamicEq.frequency, 20, 22000, 3500));
            callAudioEngine('setDynamicEQQ', numSetting(dynamicEq.q, 0.1, 18, 2));
            callAudioEngine('setDynamicEQThreshold', numSetting(dynamicEq.threshold, -100, 0, -40));
            callAudioEngine('setDynamicEQGain', numSetting(dynamicEq.gain, -24, 24, -6));
            callAudioEngine('setDynamicEQRange', numSetting(dynamicEq.range, 0, 24, 12));
            callAudioEngine('setDynamicEQAttack', numSetting(dynamicEq.attack, 0.1, 1000, 5));
            callAudioEngine('setDynamicEQRelease', numSetting(dynamicEq.release, 1, 5000, 120));
        }
    }

    const bitDither = getPersistedMusicSfxEffect(settings, 'bitdither');
    if (Object.keys(bitDither).length > 0) {
        const enabled = boolSetting(bitDither.enabled);
        callAudioEngine('enableBitDepthDither', enabled);
        if (enabled) {
            callAudioEngine('setBitDepth', numSetting(bitDither.bitDepth, 8, 32, 16));
            callAudioEngine('setDitherType', numSetting(bitDither.dither, 0, 4, 2));
            callAudioEngine('setNoiseShaping', numSetting(bitDither.shaping, 0, 4, 0));
            callAudioEngine('setDownsampleFactor', numSetting(bitDither.downsample, 1, 8, 1));
            callAudioEngine('setBitDitherMix', numSetting(bitDither.mix, 0, 100, 100));
            callAudioEngine('setBitDitherOutput', numSetting(bitDither.outputDb, -24, 24, 0));
        }
    }
}

async function applyPersistedNonEqMusicSfxFromSettings() {
    if (!audioEngine || !isNativeAudioAvailable) return;

    try {
        const settings = await readSettingsFileSafe();
        applyPersistedDynamicsSfx(settings);
        applyPersistedColorSfx(settings);
        applyPersistedSpaceSfx(settings);
        applyPersistedStereoSfx(settings);
        applyPersistedEqToolsSfx(settings);
        console.log('[SFX] Kayıtlı müzik efektleri yeniden uygulandı');
    } catch (e) {
        console.warn('[SFX] Müzik efektleri yeniden uygulanamadı:', e?.message || e);
    }
}

async function applyPersistedAudiophileSfxFromSettings() {
    if (!audioEngine || !isNativeAudioAvailable) return;

    try {
        const settings = await readSettingsFileSafe();
        const audiophile = getPersistedMusicSfxEffect(settings, 'audiophile');
        const preamp = clampAudioNumber(audiophile?.preamp, -24, 24, 0);

        if (typeof audioEngine.setPreamp === 'function') {
            audioEngine.setPreamp(preamp);
            console.log('[SFX] Audiophile preamp reapplied:', preamp);
        }

        const outputDevice = String(audiophile?.outputDevice || 'default').trim() || 'default';
        audioOutputProfileState = {
            ...audioOutputProfileState,
            requestedExclusive: audiophile?.exclusiveMode === true,
            requestedSampleRate: normalizeOutputSampleRate(audiophile?.sampleRate),
            requestedDeviceId: outputDevice,
            lastUpdatedAt: Date.now()
        };
    } catch (e) {
        console.warn('[SFX] Audiophile ayarları uygulanamadı:', e?.message || e);
    }
}

async function applyPersistedMusicSfxFromSettings() {
    await applyPersistedEq32SfxFromSettings();
    await applyPersistedNonEqMusicSfxFromSettings();
    await applyPersistedAudiophileSfxFromSettings();
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

        assignSafeOwnKeys(next.sfx.eq32, patch || {});
        assignSafeOwnKeys(next.sfxScopes.music.eq32, patch || {});

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
    const startupWebUi = readStartupWebUiSettings();
    const savedWindowState = getSavedMainWindowStateSync();

    let rendererRecoveryAttempts = 0;
    mainWindow = new BrowserWindow({
        ...getAuxiliaryWindowDefaults(),
        ...savedWindowState.bounds,
        minWidth: 1024,
        minHeight: 700,
        backgroundColor: '#121212',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            // sandbox: false gerekli — preload.js Node.js require() kullanıyor.
            // Webview'lar için sandbox will-attach-webview içinde ayrıca zorunlu tutuluyor.
            sandbox: false,
            webSecurity: true,
            allowRunningInsecureContent: false,
            // Ana pencere ayarlar/yardımcı pencere arkasında kalsa bile Web sekmesindeki
            // görünür YouTube videosunun compositor/timer akışı kısılmasın.
            backgroundThrottling: false,
            webviewTag: true,  // WebView desteği
            plugins: true, // DRM/CDM tabanlı web oynatıcılar için gerekli olabilir
            spellcheck: false
        },
        frame: true,
        titleBarStyle: 'default',
        show: false
    });
    if (savedWindowState.fullscreen) {
        try { mainWindow.setFullScreen(true); } catch { /* yoksay */ }
    } else if (savedWindowState.maximized) {
        try { mainWindow.maximize(); } catch { /* yoksay */ }
    }
    installMainWindowStatePersistence(mainWindow);

    let hasEverBeenShown = false;

    applyLinuxTaskbarGrouping(mainWindow);

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
            // YouTube gibi görünür medya webview'ları, ayarlar penceresi öne gelince
            // "arka plan" sayılıp video frame timer'ları kısılmasın. Ana pencere timer
            // politikası ayrı kalır; burada yalnızca guest webview'i akıcı tutuyoruz.
            webPreferences.backgroundThrottling = false;
            if (shouldEnableWebviewAdblockPreloadOnThisRuntime()) {
                // Guest preload: no app bridge, only early adblock scriptlet patch.
                webPreferences.preload = path.join(__dirname, 'webviewAdblockPreload.js');
            } else {
                delete webPreferences.preload;
            }

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

        const alreadySoftware = process.env.ARDALI_SOFTWARE_RENDER === '1' || process.env.ARDALI_SOFTWARE_RENDER === 'true';
        if (process.platform === 'linux' && app.isPackaged && !alreadySoftware) {
            console.warn('[WEB] unresponsive -> relaunching with safe software mode');
            app.relaunch({
                env: {
                    ...process.env,
                    ARDALI_SOFTWARE_RENDER: '1',
                    ARDALI_DISPLAY_BACKEND: process.env.DISPLAY ? 'x11' : (process.env.ARDALI_DISPLAY_BACKEND || 'auto'),
                    ARDALI_FORCE_GPU_TUNING: '0'
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
        const alreadySoftware = process.env.ARDALI_SOFTWARE_RENDER === '1' || process.env.ARDALI_SOFTWARE_RENDER === 'true';
        if (mainWindow && !hasEverBeenShown && !mainWindow.isVisible() && !alreadySoftware) {
            console.warn('[GPU] Window not visible -> fallback to software rendering');
            app.relaunch({
                env: {
                    ...process.env,
                    ARDALI_SOFTWARE_RENDER: '1'
                }
            });
            app.exit(0);
        }
    }, 6000);

    // DevTools (sadece geliştirme modunda açılır)
    // Geliştirme için: npm run dev veya ARDALI_DEV=1 npm start
    if (process.env.ARDALI_DEV === '1' || process.argv.includes('--dev')) {
        // mainWindow.webContents.openDevTools();
    }

    // Pencere kapatma davranışı: tray'e minimize et
    mainWindow.on('close', (event) => {
        if (!app.isQuitting) {
            if (mainWindowCloseToTray) {
                event.preventDefault();
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

async function createSettingsWindow(defaultTab = 'web') {
    const tab = String(defaultTab || 'web').trim() || 'web';

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
        ...getAuxiliaryWindowDefaults(),
        ...windowBounds,
        minWidth: 980,
        minHeight: 720,
        backgroundColor: '#121212',
        parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
        modal: false,
        show: false,
        title: 'ArDali Ayarlar',
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            additionalArguments: [`--ardali-view=settings`, `--ardali-settings-tab=${tab}`],
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

    applyLinuxTaskbarGrouping(settingsWindow);

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

function createAdblockWindow() {
    if (adblockWindow && !adblockWindow.isDestroyed()) {
        adblockWindow.show();
        adblockWindow.focus();
        return adblockWindow;
    }

    adblockWindow = new BrowserWindow({
        ...getAuxiliaryWindowDefaults(),
        width: 1120,
        height: 845,
        minWidth: 920,
        minHeight: 680,
        backgroundColor: '#121212',
        parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
        modal: false,
        show: false,
        title: 'DeliBlock',
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            additionalArguments: ['--ardali-view=adblock'],
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            webSecurity: true,
            allowRunningInsecureContent: false,
            spellcheck: false
        }
    });

    applyLinuxTaskbarGrouping(adblockWindow);

    adblockWindow.loadFile(path.join(__dirname, 'adblock.html'));

    adblockWindow.once('ready-to-show', () => {
        if (!adblockWindow || adblockWindow.isDestroyed()) return;
        adblockWindow.show();
        adblockWindow.focus();
    });

    adblockWindow.on('closed', () => {
        adblockWindow = null;
    });

    return adblockWindow;
}

function getDownloaderService() {
    if (!downloaderService) {
        downloaderService = createDownloaderService({
            app,
            webContentsProvider: () =>
                downloaderWindow && !downloaderWindow.isDestroyed()
                    ? downloaderWindow.webContents
                    : null
        });
    }
    return downloaderService;
}

function createDownloaderWindow() {
    if (downloaderWindow && !downloaderWindow.isDestroyed()) {
        downloaderWindow.show();
        downloaderWindow.focus();
        return downloaderWindow;
    }

    downloaderWindow = new BrowserWindow({
        ...getAuxiliaryWindowDefaults(),
        width: 1120,
        height: 820,
        minWidth: 760,
        minHeight: 620,
        backgroundColor: '#10141c',
        modal: false,
        show: false,
        title: 'ArDali Dawlod',
        frame: true,
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            additionalArguments: ['--ardali-view=downloader'],
            nodeIntegration: false,
            contextIsolation: true,
            backgroundThrottling: true,
            sandbox: false,
            webSecurity: true,
            allowRunningInsecureContent: false,
            spellcheck: false
        }
    });

    applyLinuxTaskbarGrouping(downloaderWindow);

    downloaderWindow.loadFile(path.join(__dirname, 'downloader.html'));

    downloaderWindow.once('ready-to-show', () => {
        if (!downloaderWindow || downloaderWindow.isDestroyed()) return;
        downloaderWindow.show();
        downloaderWindow.focus();
    });

    downloaderWindow.on('closed', () => {
        downloaderWindow = null;
    });

    return downloaderWindow;
}

function normalizeDownloaderUrlForAnalysis(rawUrl = '') {
    const value = String(rawUrl || '').trim();
    if (!/^https?:\/\//i.test(value)) return value;
    try {
        const url = new URL(value);
        const host = String(url.hostname || '').toLowerCase();
        const normalizeNestedYouTubeUrl = (paramName) => {
            const nested = url.searchParams.get(paramName);
            if (!nested) return '';
            try {
                return normalizeDownloaderUrlForAnalysis(new URL(nested, url.origin).toString());
            } catch {
                return normalizeDownloaderUrlForAnalysis(nested);
            }
        };
        if (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com' || host.endsWith('.youtube.com')) {
            const pathName = String(url.pathname || '').toLowerCase();
            if (pathName === '/attribution_link') {
                const nested = normalizeNestedYouTubeUrl('u');
                if (nested) return nested;
            }
            if (pathName === '/redirect') {
                const nested = normalizeNestedYouTubeUrl('q') || normalizeNestedYouTubeUrl('url');
                if (nested) return nested;
            }
        }
        if (host === 'youtu.be') {
            const id = String(url.pathname || '').split('/').filter(Boolean)[0] || '';
            return id ? `https://www.youtube.com/watch?v=${encodeURIComponent(id)}` : value;
        }
        if (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com' || host.endsWith('.youtube.com')) {
            const pathName = String(url.pathname || '').toLowerCase();
            const buildWatchUrl = (id) => {
                const cleanId = String(id || '').trim();
                return /^[\w-]{6,128}$/.test(cleanId)
                    ? `https://www.youtube.com/watch?v=${encodeURIComponent(cleanId)}`
                    : '';
            };
            const searchId = buildWatchUrl(url.searchParams.get('v'));
            if (searchId) return searchId;
            if (pathName === '/watch') {
                return value;
            }
            const shortsMatch = String(url.pathname || '').match(/^\/shorts\/([^/?#]+)/i);
            if (shortsMatch?.[1]) {
                const normalized = buildWatchUrl(shortsMatch[1]);
                return normalized || `https://www.youtube.com/shorts/${encodeURIComponent(shortsMatch[1])}`;
            }
            const liveMatch = String(url.pathname || '').match(/^\/live\/([^/?#]+)/i);
            if (liveMatch?.[1]) {
                const normalized = buildWatchUrl(liveMatch[1]);
                if (normalized) return normalized;
            }
            const embeddedMatch = String(url.pathname || '').match(/^\/(?:embed|v|e)\/([^/?#]+)/i);
            if (embeddedMatch?.[1]) {
                const normalized = buildWatchUrl(embeddedMatch[1]);
                if (normalized) return normalized;
            }
        }
    } catch {}
    return value;
}

function normalizeDownloaderTitleHint(value = '') {
    const text = String(value || '')
        .replace(/\s+/g, ' ')
        .replace(/\s+[·•]\s+(?:Follow|Following|Subscribe|Abone ol|Takip et)\b.*$/i, '')
        .replace(/\b(?:Follow|Following|Subscribe|Abone ol|Takip et)\b/gi, '')
        .trim()
        .slice(0, 180);
    const compact = text.replace(/\s+/g, '').toLowerCase();
    if (/^(seniniçin|seniniçinönerilenler|foryou|foryoupage|suggestedforyou)$/i.test(compact)) return '';
    return text;
}

function sendUrlToDownloaderWindow(url, options = {}) {
    const normalized = normalizeDownloaderUrlForAnalysis(url);
    if (!/^https?:\/\//i.test(normalized)) return;
    const titleHint = normalizeDownloaderTitleHint(options.titleHint || options.title || '');
    const payload = { url: normalized, titleHint };
    pendingDownloaderUrl = normalized;
    pendingDownloaderNotice = payload;
    const win = createDownloaderWindow();
    const send = () => {
        try {
            if (win && !win.isDestroyed()) {
                win.webContents.send('downloader:load-url', payload);
            }
        } catch (error) {
            console.warn('[DOWNLOADER] load-url send failed:', error?.message || error);
        }
    };
    if (win.webContents.isLoading()) {
        win.webContents.once('dom-ready', send);
    } else {
        setTimeout(send, 30);
    }
}

function sendDownloaderNoUrlNotice() {
    pendingDownloaderUrl = '';
    pendingDownloaderNotice = {
        url: '',
        error: 'İndirilebilir içerik bulunamadı. Önce bir video veya şarkı açın.'
    };
    const win = createDownloaderWindow();
    const send = () => {
        try {
            if (win && !win.isDestroyed()) {
                win.webContents.send('downloader:load-url', pendingDownloaderNotice);
            }
        } catch (error) {
            console.warn('[DOWNLOADER] no-url notice send failed:', error?.message || error);
        }
    };
    if (win.webContents.isLoading()) {
        win.webContents.once('dom-ready', send);
    } else {
        setTimeout(send, 30);
    }
}

function getDownloaderCookieDomainsForUrl(rawUrl = '') {
    let host = '';
    try {
        host = String(new URL(String(rawUrl || '')).hostname || '').toLowerCase();
    } catch {
        return [];
    }
    if (!host) return [];
    if (host === 'facebook.com' || host.endsWith('.facebook.com')) {
        return ['facebook.com', 'fbcdn.net', 'fbsbx.com', 'facebook.net'];
    }
    if (host === 'instagram.com' || host.endsWith('.instagram.com')) {
        return ['instagram.com', 'cdninstagram.com', 'facebook.com'];
    }
    if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be') {
        return [];
    }
    if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) {
        return ['tiktok.com'];
    }
    if (/(^|\.)tiktokv\.com$/i.test(host) ||
        /(^|\.)tiktokcdn(?:-us)?\.com$/i.test(host) ||
        /(^|\.)ttwstatic\.com$/i.test(host) ||
        /(^|\.)ibytedtos\.com$/i.test(host) ||
        /(^|\.)byteoversea\.com$/i.test(host) ||
        /(^|\.)ibyteimg\.com$/i.test(host) ||
        /(^|\.)byteimg\.com$/i.test(host) ||
        /(^|\.)muscdn\.com$/i.test(host)) {
        return ['tiktok.com', host.replace(/^www\./, '')];
    }
    return [host.replace(/^www\./, '')];
}

function cookieDomainMatches(cookieDomain = '', allowedDomain = '') {
    const cookieHost = String(cookieDomain || '').trim().toLowerCase().replace(/^\./, '');
    const allowed = String(allowedDomain || '').trim().toLowerCase().replace(/^\./, '');
    return !!cookieHost && !!allowed && (cookieHost === allowed || cookieHost.endsWith(`.${allowed}`));
}

function formatNetscapeCookieLine(cookie = {}) {
    const domainRaw = String(cookie.domain || '').trim();
    if (!domainRaw || !cookie.name) return '';
    const includeSubdomains = domainRaw.startsWith('.') || cookie.hostOnly === false;
    const normalizedDomain = includeSubdomains && !domainRaw.startsWith('.') ? `.${domainRaw}` : domainRaw;
    const domain = cookie.httpOnly ? `#HttpOnly_${normalizedDomain}` : normalizedDomain;
    const flag = includeSubdomains ? 'TRUE' : 'FALSE';
    const pathValue = String(cookie.path || '/').trim() || '/';
    const secure = cookie.secure ? 'TRUE' : 'FALSE';
    const expires = Math.max(0, Math.floor(Number(cookie.expirationDate || 0) || 0));
    return [domain, flag, pathValue, secure, String(expires), String(cookie.name), String(cookie.value || '')].join('\t');
}

async function writeDownloaderCookiesFileForUrl(rawUrl = '') {
    const allowedDomains = getDownloaderCookieDomainsForUrl(rawUrl);
    if (!allowedDomains.length) return '';
    try {
        const ses = session.fromPartition(WEBVIEW_PARTITION);
        const cookies = await ses.cookies.get({});
        const filtered = (Array.isArray(cookies) ? cookies : [])
            .filter((cookie) => allowedDomains.some((domain) => cookieDomainMatches(cookie.domain, domain)));
        if (!filtered.length) return '';
        const dir = path.join(app.getPath('userData'), 'downloader-cookies');
        await fs.promises.mkdir(dir, { recursive: true });
        const filePath = path.join(dir, `ardali-web-${crypto.createHash('sha1').update(String(rawUrl)).digest('hex').slice(0, 12)}.cookies.txt`);
        const lines = [
            '# Netscape HTTP Cookie File',
            '# Generated by ArDali Dawlod from the in-app web session.',
            ...filtered.map(formatNetscapeCookieLine).filter(Boolean)
        ];
        await fs.promises.writeFile(filePath, `${lines.join('\n')}\n`, { mode: 0o600 });
        return filePath;
    } catch (error) {
        console.warn('[DOWNLOADER] cookie export failed:', error?.message || error);
        return '';
    }
}

function createTray() {
    tray = new Tray(getTrayImage(false));

    updateTrayMenu({ isPlaying: false, currentTrack: 'ArDali' });

    tray.setToolTip('ArDali');

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

function getTrayBaseImage() {
    const trayIconName = process.platform === 'linux' ? 'ardali_24.png' : 'ardali_512.png';
    const iconPath = getResourcePath(path.join('icons', 'app', trayIconName));
    let trayIcon = nativeImage.createFromPath(iconPath);
    if (process.platform === 'linux' && trayIcon && !trayIcon.isEmpty()) {
        trayIcon = trayIcon.resize({ width: 24, height: 24 });
    }
    return trayIcon;
}

function blendTrayPixel(buffer, width, x, y, rgba) {
    if (!buffer || x < 0 || y < 0 || x >= width) return;
    const index = (y * width + x) * 4;
    if (index < 0 || index + 3 >= buffer.length) return;
    const alpha = Math.max(0, Math.min(255, Number(rgba.a ?? 255))) / 255;
    const invAlpha = 1 - alpha;
    const srcB = Math.max(0, Math.min(255, Number(rgba.b ?? 0)));
    const srcG = Math.max(0, Math.min(255, Number(rgba.g ?? 0)));
    const srcR = Math.max(0, Math.min(255, Number(rgba.r ?? 0)));
    buffer[index] = Math.round(srcB * alpha + buffer[index] * invAlpha);
    buffer[index + 1] = Math.round(srcG * alpha + buffer[index + 1] * invAlpha);
    buffer[index + 2] = Math.round(srcR * alpha + buffer[index + 2] * invAlpha);
    buffer[index + 3] = 255;
}

function createRecordingTrayImage(baseImage) {
    if (!baseImage || baseImage.isEmpty()) return baseImage;
    const { width, height } = baseImage.getSize();
    if (!width || !height) return baseImage;
    const bitmap = Buffer.from(baseImage.toBitmap());
    const radius = Math.max(3, Math.round(Math.min(width, height) * 0.2));
    const centerX = width - radius - Math.max(7, Math.round(width * 0.32));
    const centerY = radius + Math.max(2, Math.round(height * 0.08));
    const ringRadius = radius + 1;
    for (let y = Math.max(0, centerY - ringRadius - 1); y <= Math.min(height - 1, centerY + ringRadius + 1); y += 1) {
        for (let x = Math.max(0, centerX - ringRadius - 1); x <= Math.min(width - 1, centerX + ringRadius + 1); x += 1) {
            const distance = Math.hypot(x - centerX, y - centerY);
            if (distance <= radius) {
                blendTrayPixel(bitmap, width, x, y, { r: 244, g: 49, b: 49, a: 255 });
            } else if (distance <= ringRadius) {
                blendTrayPixel(bitmap, width, x, y, { r: 255, g: 255, b: 255, a: 232 });
            }
        }
    }
    try {
        return nativeImage.createFromBitmap(bitmap, { width, height, scaleFactor: 1 });
    } catch (_error) {
        return baseImage;
    }
}

function getTrayImage(recordingActive = false) {
    const key = `${process.platform}:${recordingActive ? 'recording' : 'idle'}`;
    if (trayIconCache.has(key)) return trayIconCache.get(key);
    const baseImage = getTrayBaseImage();
    const finalImage = recordingActive ? createRecordingTrayImage(baseImage) : baseImage;
    trayIconCache.set(key, finalImage);
    return finalImage;
}

// ============================================
// MPRIS (Linux Media Player Entegrasyonu)
// ============================================
function createMPRIS() {
    if (!MPRIS_RUNTIME_ENABLED) {
        console.log('MPRIS devre dışı bırakıldı (ARDALI_DISABLE_MPRIS=1)');
        return;
    }

    if (process.platform !== 'linux') {
        console.log('MPRIS sadece Linux için destekleniyor');
        return;
    }

    if (!Player) {
        console.log('MPRIS devre dışı: mpris-service bağımlılığı bulunamadı');
        return;
    }

    try {
        const flatpakAppId = (process.env.FLATPAK_ID || process.env.APP_ID || '').trim();
        const canonicalDesktopEntry = 'com.ardali.mediaplayer';
        // MPRIS player name becomes org.mpris.MediaPlayer2.<name>.
        // Keep it simple for KDE/GNOME media widgets; desktopEntry still maps the icon.
        const mprisName = 'ardali';
        const desktopEntry = flatpakAppId || canonicalDesktopEntry;

        mprisPlayer = Player({
            name: mprisName,
            identity: 'ArDali',
            desktopEntry, // KDE/GNOME sistem panelinde uygulama ikonunu eşleştirir
            supportedUriSchemes: ['file', 'http', 'https'],
            supportedMimeTypes: [
                'audio/mpeg', 'audio/flac', 'audio/x-wav', 'audio/ogg', 'audio/mp4',
                'video/mp4', 'video/x-matroska', 'video/webm', 'video/x-msvideo',
                'application/ogg'
            ],
            supportedInterfaces: ['player']
        });
        mprisPlayer.on('error', (error) => {
            console.log('[MPRIS] service error:', error?.message || error);
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
        const safeMetadata = (metadata && typeof metadata === 'object') ? metadata : {};
        const duration = Number(safeMetadata.duration) || 0;
        const position = Number(safeMetadata.position) || 0;
        const mediaType = String(safeMetadata.mediaType || '').trim().toLowerCase();
        const url = String(safeMetadata.url || '').trim();
        const title = String(safeMetadata.title || '').trim() || 'ArDali';
        const artist = String(safeMetadata.artist || '').trim();
        const album = String(safeMetadata.album || '').trim();
        const mprisMetadata = {
            'mpris:trackid': mprisPlayer.objectPath('track/' + (safeMetadata.trackId || '0')),
            'mpris:length': Math.floor(duration * 1000000), // saniye -> mikrosaniye
            'mpris:artUrl': safeMetadata.albumArt || '',
            'xesam:title': title,
            'xesam:artist': artist ? [artist] : ['ArDali'],
            'xesam:album': album,
            'xesam:genre': mediaType ? [mediaType] : []
        };
        if (url) {
            mprisMetadata['xesam:url'] = url;
        }
        if (safeMetadata.platform) {
            mprisMetadata['xesam:comment'] = `ArDali ${String(safeMetadata.platform)}`;
        }

        mprisPlayer.metadata = mprisMetadata;
        mprisPlayer.playbackStatus = safeMetadata.isPlaying ? Player.PLAYBACK_STATUS_PLAYING : Player.PLAYBACK_STATUS_PAUSED;

        // Pozisyon bilgisini güncelle (saniye -> mikrosaniye)
        if (Number.isFinite(position)) {
            mprisPlayer.position = Math.floor(Math.max(0, position) * 1000000);
            mprisPlayer._lastUpdateHRTime = process.hrtime();
        }

        // Seek yeteneklerini güncelle
        mprisPlayer.canSeek = (typeof safeMetadata.canSeek === 'boolean') ? safeMetadata.canSeek : true;
        mprisPlayer.canControl = true;
        mprisPlayer.canPlay = true;
        mprisPlayer.canPause = true;
        mprisPlayer.canStop = true;
        if (typeof safeMetadata.canGoNext === 'boolean') mprisPlayer.canGoNext = safeMetadata.canGoNext;
        if (typeof safeMetadata.canGoPrevious === 'boolean') mprisPlayer.canGoPrevious = safeMetadata.canGoPrevious;

        if (isTruthyEnvFlag('ARDALI_VERBOSE_LOGS')) {
            console.log('MPRIS metadata güncellendi:', title, 'type:', mediaType || '-', 'duration:', duration.toFixed(1), 's, position:', position.toFixed(1), 's');
        }
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

    const { isPlaying = false, currentTrack = 'ArDali', isMuted = false, stopAfterCurrent = false, recordingActive = false } = mergedState;

    // İkonları küçük ve tutarlı boyutta yükle
    const iconPath = (name) => {
        const p = getResourcePath(path.join('icons', 'ui', name));
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
    const trayImage = getTrayImage(!!recordingActive);
    if (trayImage && !trayImage.isEmpty()) {
        tray.setImage(trayImage);
    }
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
    if (normalized === 'web') return 'Ses Efektleri (Web) — ArDali';
    if (normalized === 'video') return 'Ses Efektleri (Video) — ArDali';
    return 'Ses Efektleri (Müzik) — ArDali';
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
        ...getAuxiliaryWindowDefaults(),
        width: 1300,
        height: 800,
        minWidth: 1000,
        minHeight: 600,
        backgroundColor: '#0a0a0f',
        parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
        modal: false,
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            additionalArguments: ['--ardali-view=sound-effects'],
            nodeIntegration: false,
            contextIsolation: true,
            // sandbox: false gerekli — preload.js Node.js require() kullanıyor.
            sandbox: false,
            webSecurity: true,
            allowRunningInsecureContent: false,
            backgroundThrottling: true,
            spellcheck: false
        },
        frame: true,
        title: getSoundEffectsWindowTitle(scope),
        show: false
    });

    applyLinuxTaskbarGrouping(soundEffectsWindow);

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
        ...getAuxiliaryWindowDefaults(),
        width: 980,
        height: 820,
        minWidth: 980,
        minHeight: 820,
        backgroundColor: '#111115',
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
        title: 'ArDali Hazır Ayarlar — ArDali',
        show: false
    });

    try {
        eqPresetsWindow.setMenuBarVisibility(false);
        if (typeof eqPresetsWindow.removeMenu === 'function') {
            eqPresetsWindow.removeMenu();
        }
    } catch { }

    let hasEverBeenShown = false;

    applyLinuxTaskbarGrouping(eqPresetsWindow);

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

ipcMain.on('soundEffects:scopedLiveParam', (event, payload) => {
    try {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        const senderWin = BrowserWindow.fromWebContents(event.sender);
        if (!senderWin || senderWin !== soundEffectsWindow) return;

        const rawScope = String(payload?.scope || '').trim().toLowerCase();
        const scope = rawScope === 'video' ? 'video' : (rawScope === 'web' ? 'web' : 'music');
        const effect = String(payload?.effect || '').trim().toLowerCase();
        if (!effect) return;
        const settings = payload?.settings && typeof payload.settings === 'object'
            ? payload.settings
            : {};

        mainWindow.webContents.send('sfx:scoped-live-param', { scope, effect, settings });
    } catch {
        // yoksay
    }
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

ipcMain.handle('soundEffects:getWebSpectrum', async (_event, numBands, options = {}) => {
    try {
        if (!mainWindow || mainWindow.isDestroyed()) return [];
        const safeBands = Math.max(64, Math.min(512, Number(numBands) || 128));
        const rawSpectrum = !!(options && typeof options === 'object' && (options.raw === true || options.pure === true));
        const result = await mainWindow.webContents.executeJavaScript(
            `window.__ardaliGetWebSpectrum ? window.__ardaliGetWebSpectrum(${safeBands}, { raw: ${rawSpectrum ? 'true' : 'false'} }) : []`,
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
            'window.__ardaliGetWebNoiseGateStatus ? window.__ardaliGetWebNoiseGateStatus() : ({ ok: false, enabled: false, open: true, gain: 1, envDb: -120, thresholdDb: -40 })',
            true
        );
        return (result && typeof result === 'object')
            ? result
            : { ok: false, enabled: false, open: true, gain: 1, envDb: -120, thresholdDb: -40 };
    } catch {
        return { ok: false, enabled: false, open: true, gain: 1, envDb: -120, thresholdDb: -40 };
    }
});

let webTruePeakStatusCache = {
    at: 0,
    pending: null,
    value: { ok: false, truePeakL: -96, truePeakR: -96, holdL: -96, holdR: -96, clippingCount: 0, gainReduction: 0 }
};

ipcMain.handle('soundEffects:getWebTruePeakStatus', async () => {
    const fallback = { ok: false, truePeakL: -96, truePeakR: -96, holdL: -96, holdR: -96, clippingCount: 0, gainReduction: 0 };
    try {
        if (!mainWindow || mainWindow.isDestroyed()) {
            webTruePeakStatusCache.value = fallback;
            webTruePeakStatusCache.pending = null;
            webTruePeakStatusCache.at = Date.now();
            return fallback;
        }
        const now = Date.now();
        if (now - Number(webTruePeakStatusCache.at || 0) < 180) {
            return webTruePeakStatusCache.value || fallback;
        }
        if (webTruePeakStatusCache.pending) {
            return webTruePeakStatusCache.pending;
        }
        webTruePeakStatusCache.pending = mainWindow.webContents.executeJavaScript(
            'window.__ardaliGetWebTruePeakStatus ? window.__ardaliGetWebTruePeakStatus() : ({ ok: false, truePeakL: -96, truePeakR: -96, holdL: -96, holdR: -96, clippingCount: 0, gainReduction: 0 })',
            true
        ).then((result) => (result && typeof result === 'object')
            ? result
            : fallback
        ).catch(() => fallback).finally(() => {
            webTruePeakStatusCache.pending = null;
        });
        const value = await webTruePeakStatusCache.pending;
        webTruePeakStatusCache.value = value;
        webTruePeakStatusCache.at = Date.now();
        return value;
    } catch {
        webTruePeakStatusCache.pending = null;
        return webTruePeakStatusCache.value || fallback;
    }
});

ipcMain.handle('soundEffects:getWebDynamicEqStatus', async () => {
    try {
        if (!mainWindow || mainWindow.isDestroyed()) {
            return { ok: false, enabled: false, currentGainDb: 0, gainReductionDb: 0, envDb: -120, thresholdDb: -40, triggered: false };
        }
        const result = await mainWindow.webContents.executeJavaScript(
            'window.__ardaliGetWebDynamicEqStatus ? window.__ardaliGetWebDynamicEqStatus() : ({ ok: false, enabled: false, currentGainDb: 0, gainReductionDb: 0, envDb: -120, thresholdDb: -40, triggered: false })',
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
            'window.__ardaliGetWebPerfStatus ? window.__ardaliGetWebPerfStatus() : ({ ok: false, loops: {}, build: { count: 0, lastMs: 0, avgMs: 0, maxMs: 0, rebuildCount: 0 }, apply: { count: 0, lastMs: 0, avgMs: 0, maxMs: 0 }, totalGlitches: 0, uptimeSec: 0 })',
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
    return ARDALI_EQ_FEATURED_LIST;
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

function applyVisualizerPcmVisualGain(floatArray, floatCount) {
    if (!(floatArray instanceof Float32Array) || floatCount <= 0) return floatArray;

    let peak = 0;
    let sumSq = 0;
    for (let i = 0; i < floatCount; i++) {
        const v = Number(floatArray[i]) || 0;
        const abs = Math.abs(v);
        if (abs > peak) peak = abs;
        sumSq += v * v;
    }
    if (peak <= 0) return floatArray;

    const rms = Math.sqrt(sumSq / Math.max(1, floatCount));
    const targetPeak = 0.72;
    const targetRms = 0.18;
    const peakGain = targetPeak / Math.max(peak, 1e-6);
    const rmsGain = targetRms / Math.max(rms, 1e-6);
    const gain = Math.max(1, Math.min(8, Math.min(peakGain, rmsGain)));
    if (gain <= 1.02) return floatArray;

    const out = new Float32Array(floatCount);
    for (let i = 0; i < floatCount; i++) {
        out[i] = Math.tanh((Number(floatArray[i]) || 0) * gain);
    }
    return out;
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
                            floatArray = applyVisualizerPcmVisualGain(floatArray, floatCount);

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
    // Dev modda (electron . / npm start), yeni derlenmiş native visualizer binary'lerini tercih ederiz.
    // Paketli sürümlerde native-dist kullanılır.
    return !app.isPackaged || process.env.ARDALI_DEV === '1' || process.argv.includes('--dev');
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
        out.push(path.join(process.resourcesPath, 'native-dist', 'ardali-projectm-visualizer.exe'));
        out.push(path.join(process.resourcesPath, 'native-dist', 'windows', 'ardali-projectm-visualizer.exe'));
        out.push(path.join(process.resourcesPath, 'third_party', 'projectm', 'ardali-projectm-visualizer.exe'));
        out.push(path.join(process.resourcesPath, 'third_party', 'projectm', 'bin', 'ardali-projectm-visualizer.exe'));
        return out;
    }

    const exeName = process.platform === 'win32'
        ? 'ardali-projectm-visualizer.exe'
        : 'ardali-projectm-visualizer';

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
        ? 'ardali-projectm-visualizer.exe'
        : 'ardali-projectm-visualizer';

    // Temel aday(lar)
    const baseCandidates = getVisualizerExecutableCandidates();
    const basePick = pickFirstExistingPath(baseCandidates);

    // Geliştirici kolaylığı: varsa yeni CMake çıktısını tercih et.
    const devCandidates = process.platform === 'win32'
        ? [
            path.join(__dirname, 'build-visualizer-ardali', 'Release', exeName),
            path.join(__dirname, 'build-visualizer-ardali', exeName),
            path.join(__dirname, 'build-visualizer', 'Release', exeName),
            path.join(__dirname, 'build-visualizer', exeName)
        ]
        : [
            path.join(__dirname, 'build-visualizer-ardali', exeName),
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
            lines.push('- Görselleştirici, Windows üzerinde çalışmak için `ardali-projectm-visualizer.exe` gerektirir.');
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
        // Native visualizer is often built without SDL2_image, so SDL can reliably load BMP.
        getResourcePath(path.join('icons', 'app', 'ardali_logo.bmp')),
        path.join(process.resourcesPath || '', 'icons', 'app', 'ardali_logo.bmp'),
        path.join(process.resourcesPath || '', 'native-dist', 'linux', 'icons', 'app', 'ardali_logo.bmp'),
        getResourcePath(path.join('icons', 'app', 'ardali_512.png')),
        path.join(process.resourcesPath || '', 'icons', 'app', 'ardali_512.png'),
        '/app/share/icons/hicolor/512x512/apps/com.ardali.mediaplayer.png'
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
    const visualizerDesktopEntry = resolveLinuxDesktopEntryId() || 'com.ardali.mediaplayer';
    const visualizerFontCandidates = [
        // Flatpak: native binary icin asar disi okunabilir font
        '/app/ardali/resources/native-dist/linux/fonts/Inter-Regular.ttf',
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
        ARDALI_UI_THEME: getCurrentUiThemeSync(),
        ARDALI_VISUALIZER_ICON: visualizerIconPath,
        ARDALI_VIS_FONT_PATH: visualizerFontPath,
        // Linux window grouping + icon lookup (Wayland app_id / X11 WM_CLASS)
        ARDALI_VIS_DESKTOP_ENTRY: process.env.ARDALI_VIS_DESKTOP_ENTRY || visualizerDesktopEntry,
        ARDALI_VIS_WMCLASS: process.env.ARDALI_VIS_WMCLASS || 'com.ardali.mediaplayer',
        SDL_APP_NAME: process.env.ARDALI_VIS_WMCLASS || 'com.ardali.mediaplayer',
        // Native görselleştirici için UI dili (SDL2/ImGui)
        ARDALI_LANG: uiLang,
        LANG: posixLocale,
        LC_ALL: posixLocale,
        LANGUAGE: localeChain,
        // Native visualizer i18n strings (all app locales can override these keys over time)
        ARDALI_VIS_CTX_DISPLAY: tVis('visualizerNative.context.display', 'Display'),
        ARDALI_VIS_CTX_RENDERING: tVis('visualizerNative.context.rendering', 'Rendering'),
        ARDALI_VIS_CTX_PRESETS: tVis('visualizerNative.context.presets', 'Presets'),
        ARDALI_VIS_CTX_TOGGLE_FULLSCREEN: tVis('visualizerNative.context.toggleFullscreen', 'Toggle fullscreen'),
        ARDALI_VIS_CTX_FRAME_RATE: tVis('visualizerNative.context.frameRate', 'Frame rate'),
        ARDALI_VIS_CTX_QUALITY: tVis('visualizerNative.context.quality', 'Quality'),
        ARDALI_VIS_CTX_CLARITY: tVis('visualizerNative.context.clarity', 'Clarity'),
        ARDALI_VIS_CTX_SELECT_VISUALS: tVis('visualizerNative.context.selectVisuals', 'Select visualizations...'),
        ARDALI_VIS_CTX_CLOSE: tVis('visualizerNative.context.close', 'Close visualization'),
        ARDALI_VIS_CTX_FPS_LOW: tVis('visualizerNative.context.fpsLow', 'Low (15 fps)'),
        ARDALI_VIS_CTX_FPS_MEDIUM: tVis('visualizerNative.context.fpsMedium', 'Medium (25 fps)'),
        ARDALI_VIS_CTX_FPS_HIGH: tVis('visualizerNative.context.fpsHigh', 'High (35 fps)'),
        ARDALI_VIS_CTX_FPS_SUPER: tVis('visualizerNative.context.fpsUltra', 'Super high (60 fps)'),
        ARDALI_VIS_CTX_QUALITY_LOW: tVis('visualizerNative.context.qualityLow', 'Low (256x256)'),
        ARDALI_VIS_CTX_QUALITY_MEDIUM: tVis('visualizerNative.context.qualityMedium', 'Medium (512x512)'),
        ARDALI_VIS_CTX_QUALITY_HIGH: tVis('visualizerNative.context.qualityHigh', 'High (1024x1024)'),
        ARDALI_VIS_CTX_QUALITY_SUPER: tVis('visualizerNative.context.qualityUltra', 'Super high (2048x2048)'),
        ARDALI_VIS_CTX_CLARITY_SOFT: tVis('visualizerNative.context.claritySoft', 'Soft'),
        ARDALI_VIS_CTX_CLARITY_BALANCED: tVis('visualizerNative.context.clarityBalanced', 'Balanced'),
        ARDALI_VIS_CTX_CLARITY_SHARP: tVis('visualizerNative.context.claritySharp', 'Sharp'),
        ARDALI_VIS_CTX_CLARITY_SHARP_PLUS: tVis('visualizerNative.context.claritySharpPlus', 'Sharp+'),
        ARDALI_VIS_PICKER_TITLE: tVis('visualizerNative.picker.title', 'ArDali Visuals'),
        ARDALI_VIS_PICKER_HERO_TITLE: tVis('visualizerNative.picker.heroTitle', 'Curate the visual atmosphere'),
        ARDALI_VIS_PICKER_HINT: tVis('visualizerNative.picker.heroHint', 'Choose the presets included in the premium-style auto switch flow.'),
        ARDALI_VIS_PICKER_PRESET_DIR: tVis('visualizerNative.picker.presetDirectory', 'Preset directory'),
        ARDALI_VIS_PICKER_SEARCH: tVis('visualizerNative.picker.search', 'Search presets...'),
        ARDALI_VIS_PICKER_DELAY: tVis('visualizerNative.picker.delay', 'Switch delay'),
        ARDALI_VIS_PICKER_ENABLED: tVis('visualizerNative.picker.enabled', 'Enabled'),
        ARDALI_VIS_PICKER_COMPACT: tVis('visualizerNative.picker.compact', 'Compact'),
        ARDALI_VIS_PICKER_FILTER_ACTIVE: tVis('visualizerNative.picker.filterActive', 'Filter active:'),
        ARDALI_VIS_PICKER_GALLERY: tVis('visualizerNative.picker.gallery', 'Preset gallery'),
        ARDALI_VIS_PICKER_NO_MATCH: tVis('visualizerNative.picker.noMatch', 'No preset matched your search.'),
        ARDALI_VIS_PICKER_IN_ROTATION: tVis('visualizerNative.picker.inRotation', 'In rotation'),
        ARDALI_VIS_PICKER_MANUAL_ONLY: tVis('visualizerNative.picker.manualOnly', 'Manual only'),
        ARDALI_VIS_PICKER_INCLUDED: tVis('visualizerNative.picker.includedInAutoSwitch', 'Included in auto-switch'),
        ARDALI_VIS_PICKER_ALL: tVis('visualizerNative.picker.selectAll', 'Select all'),
        ARDALI_VIS_PICKER_NONE: tVis('visualizerNative.picker.clearAll', 'Clear all'),
        ARDALI_VIS_PICKER_OK: tVis('visualizerNative.picker.done', 'Done'),
        // Varsayılan ana pencere boyutu (kullanıcı yeniden boyutlandırabilir; bir sonraki açılışta bu varsayılan kullanılır).
        ARDALI_VIS_MAIN_W: process.env.ARDALI_VIS_MAIN_W || '900',
        ARDALI_VIS_MAIN_H: process.env.ARDALI_VIS_MAIN_H || '650'
    };

    // Linux: SDL2 için görüntü değişkenleri (Wayland/X11)
    if (process.platform === 'linux') {
        const backendHint = String(
            process.env.ARDALI_DISPLAY_BACKEND ||
            process.env.ELECTRON_OZONE_PLATFORM_HINT ||
            process.env.ARDALI_EFFECTIVE_DISPLAY_BACKEND ||
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
        console.log('[Visualizer] ✓ Input source: ArDali PCM only (NO mic/capture)');
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
            const desktopId = env.ARDALI_VIS_DESKTOP_ENTRY || 'com.ardali.mediaplayer';
            actualArgs = ['-c', `exec -a ${shellQuote(desktopId)} ${shellQuote(exePath)} "$@"`, '--', '--presets', presetsPath];
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
const activeDownloadsMap = new Map();
const cancelledWebDownloadIds = new Set();

ipcMain.handle('downloads:pause', (_event, id) => {
    const item = activeDownloadsMap.get(id);
    if (item && item.getState() === 'progressing') {
        item.pause();
    }
});

ipcMain.handle('downloads:resume', (_event, id) => {
    const item = activeDownloadsMap.get(id);
    if (item && item.isPaused()) {
        item.resume();
    }
});

ipcMain.handle('downloads:cancel', (_event, id) => {
    const item = activeDownloadsMap.get(id);
    if (item) {
        try {
            item.cancel();
        } catch (error) {
            console.warn('[WEB] download cancel failed:', error?.message || error);
        }
    }
    if (item) {
        cancelledWebDownloadIds.add(id);
    } else {
        cancelledWebDownloadIds.delete(id);
    }
    activeDownloadsMap.delete(id);
    const cancelledItem = markDownloadHistoryItemCancelled(id, item ? 'user_cancelled' : 'stale_cancelled');
    if (cancelledItem && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-done', cancelledItem);
    }
    return Boolean(cancelledItem || item);
});

ipcMain.handle('downloads:getHistory', () => {
    return normalizeDownloadsHistorySync(new Set(activeDownloadsMap.keys()));
});

ipcMain.handle('downloads:clearHistory', () => {
    saveDownloadsHistorySync([]);
    return true;
});

ipcMain.handle('downloads:removeItem', (_event, id) => {
    let history = readDownloadsHistorySync();
    history = history.filter(d => d.id !== id);
    saveDownloadsHistorySync(history);
    return true;
});

ipcMain.handle('downloads:checkExists', (_event, filePath) => {
    try {
        return require('fs').existsSync(filePath);
    } catch {
        return false;
    }
});

ipcMain.handle('downloads:showInFolder', (_event, filePath) => {
    try {
        require('electron').shell.showItemInFolder(filePath);
    } catch (e) {
        console.warn('Failed to show item in folder:', e);
    }
});

ipcMain.handle('downloads:openDownloadsFolder', async () => {
    try {
        const downloadsPath = app.getPath('downloads');
        const error = await shell.openPath(downloadsPath);
        if (error) {
            console.warn('Failed to open downloads folder:', error);
            return false;
        }
        return true;
    } catch (e) {
        console.warn('Failed to open downloads folder:', e?.message || e);
        return false;
    }
});

ipcMain.handle('app:relaunch', async () => {
    try {
        // Ayrık native süreçlerin (örn. görselleştirici) yeniden başlatmadan sonra yaşamamasını sağla.
        stopVisualizer();
        // "close to tray" akışı yeniden başlatmayı engellememeli.
        app.isQuitting = true;
        const relaunchArgs = getAppRelaunchArgs();
        if (shouldUseAppImageExtractAndRunForRelaunch()) {
            const launched = relaunchAppImageWithExtractAndRun(relaunchArgs);
            if (!launched) return false;
        } else {
            const relaunchOptions = buildAppRelaunchOptions();
            if (relaunchOptions) {
                app.relaunch(relaunchOptions);
            } else {
                app.relaunch();
            }
        }

        // before-quit cleanup'larının çalışması için nazik kapanış.
        app.quit();

        // Güvenlik ağı: quit engellenirse süreç sonsuza kadar açık kalmasın.
        setTimeout(() => {
            try { app.exit(0); } catch { }
        }, 2500);
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

ipcMain.handle('app:setStudioShortcuts', async (_event, shortcuts = {}) => {
    try {
        return setGlobalStudioShortcuts(shortcuts || {});
    } catch (error) {
        return { success: false, error: error?.message || String(error) };
    }
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

ipcMain.handle('app:update:launchArDaliBinUpdate', async () => {
    const result = await launchArDaliBinUpdateTerminal();
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
                        // Kopyalama işlemleri web tarayıcısında her zaman serbest olmalı (Brave/Chrome standartı)
                        if (requestedPermission === 'clipboard-read' || 
                            requestedPermission === 'clipboard-sanitized-write' || 
                            requestedPermission === 'clipboard-write') {
                            callback(true);
                            return;
                        }

                        // Web platformlarda (allowlist) kullanıcı akışını bozmayacak şekilde
                        // izinleri host bazlı değerlendir.
                        const trustedContext =
                            isAllowedWebUrlMain(currentUrl) ||
                            isAllowedWebUrlMain(originUrl);
                        if (!trustedContext) {
                            callback(false);
                            return;
                        }
                        if (!isWebPermissionAllowedBySettings(requestedPermission, currentUrl, originUrl)) {
                            callback(false);
                            return;
                        }
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
            if (ses && typeof ses.setDisplayMediaRequestHandler === 'function') {
                ses.setDisplayMediaRequestHandler(async (request, callback) => {
                    try {
                        const frame = request?.frame || null;
                        const wc = frame?.top?.hostWebContents || frame?.hostWebContents || null;
                        const currentUrl = String(frame?.url || wc?.getURL?.() || '').trim();
                        if (!isLocalAppPageUrl(currentUrl)) {
                            callback({});
                            return;
                        }
                        const sources = await desktopCapturer.getSources({
                            types: ['screen', 'window'],
                            thumbnailSize: { width: 320, height: 180 },
                            fetchWindowIcons: false
                        });
                        const source = sources.find((item) => String(item.id || '').startsWith('screen:')) || sources[0] || null;
                        callback(source ? { video: source } : {});
                    } catch (error) {
                        console.warn('[SCREEN_REC] display media request failed:', error?.message || error);
                        callback({});
                    }
                }, { useSystemPicker: true });
            }

            if (ses && typeof ses.on === 'function') {
                ses.on('will-download', async (event, item, webContents) => {
                    try {
                        const prefs = getWebRuntimeSettingsSync();
                        const fileName = String(item?.getFilename?.() || 'download').trim() || 'download';
                        
                        if (!prefs.askDownloadLocation) {
                            item.setSavePath(path.join(app.getPath('downloads'), fileName));
                        } else {
                            item.setSaveDialogOptions({
                                defaultPath: path.join(app.getPath('downloads'), fileName)
                            });
                        }

                        // Create download record
                        const downloadId = Date.now().toString() + Math.random().toString(36).substring(7);
                        activeDownloadsMap.set(downloadId, item);
                        const downloadItem = {
                            id: downloadId,
                            url: item.getURL(),
                            fileName: fileName,
                            savePath: item.getSavePath(),
                            state: prefs.askDownloadLocation && !item.getSavePath() ? 'waiting_for_save' : 'downloading',
                            startTime: Date.now(),
                            totalBytes: item.getTotalBytes(),
                            receivedBytes: 0
                        };

                        if (!downloadItem.savePath) {
                            downloadItem.savePath = path.join(app.getPath('downloads'), fileName);
                        }

                        let history = readDownloadsHistorySync();
                        history.unshift(downloadItem);
                        if (history.length > 500) history = history.slice(0, 500);
                        saveDownloadsHistorySync(history);

                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send('download-progress', downloadItem);
                        }

                        item.on('updated', (event, state) => {
                            if (cancelledWebDownloadIds.has(downloadId)) {
                                downloadItem.state = 'cancelled';
                                if (mainWindow && !mainWindow.isDestroyed()) {
                                    mainWindow.webContents.send('download-progress', downloadItem);
                                }
                                return;
                            }
                            const currentSavePath = item.getSavePath();
                            if (state === 'interrupted') {
                                downloadItem.state = 'interrupted';
                            } else if (state === 'progressing') {
                                if (prefs.askDownloadLocation && !currentSavePath) {
                                    downloadItem.state = 'waiting_for_save';
                                } else {
                                    downloadItem.state = item.isPaused() ? 'paused' : 'downloading';
                                }
                                downloadItem.receivedBytes = item.getReceivedBytes();
                                downloadItem.totalBytes = item.getTotalBytes();
                                downloadItem.savePath = currentSavePath || downloadItem.savePath;
                            }
                            if (mainWindow && !mainWindow.isDestroyed()) {
                                mainWindow.webContents.send('download-progress', downloadItem);
                            }
                        });

                        item.once('done', (event, state) => {
                            activeDownloadsMap.delete(downloadId);
                            const wasCancelled = cancelledWebDownloadIds.has(downloadId) || state === 'cancelled';
                            cancelledWebDownloadIds.delete(downloadId);
                            downloadItem.state = wasCancelled ? 'cancelled' : state;
                            downloadItem.savePath = item.getSavePath() || downloadItem.savePath;
                            
                            let currentHistory = readDownloadsHistorySync();
                            const idx = currentHistory.findIndex(d => d.id === downloadId);
                            if (idx !== -1) {
                                currentHistory[idx] = downloadItem;
                                saveDownloadsHistorySync(currentHistory);
                            }

                            if (mainWindow && !mainWindow.isDestroyed()) {
                                mainWindow.webContents.send('download-done', downloadItem);
                            }

                            if (state === 'completed') {
                                const savePath = downloadItem.savePath;
                                const { Notification, shell } = require('electron');
                                const notification = new Notification({
                                    title: 'İndiriliyor (Bitti)',
                                    body: `${fileName}, İndirilenler konumuna kaydedildi.\nKlasörde göstermek için tıklayın.`
                                });
                                notification.on('click', () => {
                                    shell.showItemInFolder(savePath);
                                });
                                notification.show();
                            } else if (state === 'interrupted') {
                                const { Notification } = require('electron');
                                const notification = new Notification({
                                    title: 'İndirme Başarısız',
                                    body: `${fileName} indirilemedi (Durum: ${state}).`
                                });
                                notification.show();
                            }
                        });
                    } catch (error) {
                        console.warn('[WEB] download prompt failed:', error?.message || error);
                    }
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
        try {
            contents.setBackgroundThrottling?.(false);
        } catch (error) {
            console.warn('[WEB] setBackgroundThrottling failed:', error?.message || error);
        }

        // Block opening arbitrary external windows from embedded web content.
        if (typeof contents.setWindowOpenHandler === 'function') {
            contents.setWindowOpenHandler(({ url }) => {
                const popupUrl = String(url || '').trim();
                const currentUrl = String(contents?.getURL?.() || '').trim();
                if (!isWebPopupAllowedBySettings(currentUrl, popupUrl)) return { action: 'deny' };
                // OAuth flows often open an empty popup first, then navigate.
                if (!popupUrl || popupUrl === 'about:blank') {
                    return {
                        action: 'allow',
                        overrideBrowserWindowOptions: {
                            ...getAuxiliaryWindowDefaults(),
                            title: 'ArDali',
                            autoHideMenuBar: false
                        }
                    };
                }
                if (parseHttpUrlMain(popupUrl)) {
                    return {
                        action: 'allow',
                        overrideBrowserWindowOptions: {
                            ...getAuxiliaryWindowDefaults(),
                            title: 'ArDali',
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

// User-Agent maskelemesini global uygulama. WhatsApp gibi ihtiyaç duyan siteler
// renderer tarafında hedef URL'ye göre özel UA alır; Google/YouTube doğal webview
// kimliğiyle kalır.

app.whenReady().then(async () => {
    if (!gotSingleInstanceLock) return;
    // GPU ayarları burada uygula
    if (!isPackagedLinuxConservativeGpuMode()) {
        app.commandLine.appendSwitch('enable-gpu-rasterization');
        app.commandLine.appendSwitch('enable-zero-copy');
    } else {
        console.log('[GPU] startup conservative mode active (linux)');
    }
    cleanupTransientHomeFiles('startup');

    try { installWebviewHardening(); } catch (e) { console.error('[APP] installWebviewHardening error:', e); }
    try { installAdblockRequestBlocking(); } catch (e) { console.error('[APP] installAdblockRequestBlocking error:', e); }
    try { installTlsCompatibilityForWebPlatforms(); } catch (e) { console.error('[APP] installTlsCompatibilityForWebPlatforms error:', e); }
    try { initAutoUpdaterBridge(); } catch (e) { console.error('[APP] initAutoUpdaterBridge error:', e); }
    try { installAppMenu(); } catch (e) { console.error('[APP] installAppMenu error:', e); }
    try {
        registerPulseIpc({
            ipcMain,
            app,
            shell,
            BrowserWindow,
            getMainWindow: () => mainWindow,
            getAuxiliaryWindowDefaults,
            configureWindowForTaskbar: applyLinuxTaskbarGrouping
        });
    } catch (e) { console.error('[APP] registerPulseIpc error:', e); }
    try { createWindow(); } catch (e) { console.error('[APP] createWindow error:', e); }
    try { createTray(); } catch (e) { console.error('[APP] createTray error:', e); }
    try { createMPRIS(); } catch (e) { console.error('[APP] createMPRIS error:', e); }
    // Kullanıcı tercihi: arka planda otomatik güncelleme denetimi yapılmasın.
    // Güncelleme kontrolü yalnızca UI'daki manuel aksiyon ile çalışır.
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
    clearStartupUpdateRetryTimer();
    stopVisualizer();
    unregisterGlobalMediaShortcuts();
    unregisterGlobalStudioShortcuts();
    cleanupTransientHomeFiles('before-quit');
});

app.on('before-quit', (event) => {
    if (webQuitCleanupDone || webQuitCleanupInProgress) return;
    const cleanup = getWebQuitCleanupSettings();
    if (!cleanup.clearCacheOnQuit && !cleanup.clearCookiesOnQuit && !cleanup.clearSiteDataOnQuit && !cleanup.clearHistoryOnQuit) return;

    event.preventDefault();
    webQuitCleanupInProgress = true;
    runWebQuitCleanup()
        .catch((error) => {
            console.warn('[WEB] kapanış veri temizliği tamamlanamadı:', error?.message || error);
        })
        .finally(() => {
            webQuitCleanupDone = true;
            webQuitCleanupInProgress = false;
            app.quit();
        });
});

app.on('will-quit', () => {
    clearWebCacheDirectoriesOnQuit();
});

// ============================================
// IPC HANDLERS
// ============================================

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

ipcMain.handle('screenRecording:getSources', async () => {
    try {
        const sources = await desktopCapturer.getSources({
            types: ['screen', 'window'],
            thumbnailSize: { width: 0, height: 0 },
            fetchWindowIcons: false
        });
        return sources.map((source) => ({
            id: source.id,
            name: source.name,
            type: String(source.id || '').startsWith('screen:') ? 'screen' : 'window',
            displayId: source.display_id || ''
        })).sort((a, b) => {
            if (a.type !== b.type) return a.type === 'screen' ? -1 : 1;
            return String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' });
        });
    } catch (error) {
        console.error('[SCREEN_REC] getSources error:', error);
        return [];
    }
});

ipcMain.handle('screenRecording:getFfmpegCapabilities', async () => {
    const ffmpegPath = getFfmpegPathForEnv();
    return new Promise((resolve) => {
        let output = '';
        let settled = false;
        const child = spawn(ffmpegPath, ['-hide_banner', '-encoders'], { windowsHide: true });
        const finish = (payload) => resolve({
            ffmpegPath,
            formats: ['webm', 'mkv', 'mp4'],
            encoders: {
                libx264: /\blibx264\b/.test(output),
                h264_nvenc: /\bh264_nvenc\b/.test(output),
                hevc_nvenc: /\bhevc_nvenc\b/.test(output),
                h264_vaapi: /\bh264_vaapi\b/.test(output),
                h264_qsv: /\bh264_qsv\b/.test(output),
                libaom_av1: /\blibaom-av1\b|\blibaom_av1\b/.test(output),
                libsvtav1: /\blibsvtav1\b|\blibsvt_av1\b/.test(output)
            },
            ...payload
        });
        const finishOnce = (payload) => {
            if (settled) return;
            settled = true;
            finish(payload);
        };
        const timer = setTimeout(() => {
            try { child.kill('SIGTERM'); } catch {}
            finishOnce({ success: false, error: 'timeout' });
        }, 2500);
        child.stdout.on('data', (chunk) => { output += String(chunk || ''); });
        child.stderr.on('data', (chunk) => { output += String(chunk || ''); });
        child.once('error', (error) => {
            clearTimeout(timer);
            finishOnce({ success: false, error: error?.message || String(error) });
        });
        child.once('close', (code) => {
            clearTimeout(timer);
            finishOnce({ success: code === 0, code });
        });
    });
});

function normalizeScreenRecordingVideoEncoder(value) {
    const normalized = String(value || 'auto').trim().toLowerCase();
    return ['auto', 'libx264', 'h264_nvenc', 'h264_vaapi', 'h264_qsv'].includes(normalized) ? normalized : 'auto';
}

function pushScreenRecordingVideoEncoderArgs(args, encoder, bitrateKbps) {
    const normalized = normalizeScreenRecordingVideoEncoder(encoder);
    const target = normalized === 'auto' ? 'libx264' : normalized;
    const bitrate = Math.max(500, Math.min(60000, Math.round(Number(bitrateKbps) || 8000)));
    if (target === 'h264_nvenc') {
        args.push('-c:v', 'h264_nvenc', '-preset', 'p4', '-b:v', `${bitrate}k`, '-maxrate', `${bitrate}k`, '-bufsize', `${Math.max(1000, bitrate * 2)}k`, '-pix_fmt', 'yuv420p');
        return;
    }
    if (target === 'h264_vaapi') {
        args.push('-vaapi_device', '/dev/dri/renderD128', '-vf', 'format=nv12,hwupload', '-c:v', 'h264_vaapi', '-b:v', `${bitrate}k`, '-maxrate', `${bitrate}k`, '-bufsize', `${Math.max(1000, bitrate * 2)}k`);
        return;
    }
    if (target === 'h264_qsv') {
        args.push('-c:v', 'h264_qsv', '-preset', 'veryfast', '-b:v', `${bitrate}k`, '-maxrate', `${bitrate}k`, '-bufsize', `${Math.max(1000, bitrate * 2)}k`);
        return;
    }
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-b:v', `${bitrate}k`, '-pix_fmt', 'yuv420p');
}

ipcMain.handle('screenRecording:getCursorPoint', () => {
    try {
        const point = screen.getCursorScreenPoint();
        const display = screen.getDisplayNearestPoint(point) || screen.getPrimaryDisplay();
        const bounds = display?.bounds || { x: 0, y: 0, width: 1, height: 1 };
        return {
            x: Number(point.x) || 0,
            y: Number(point.y) || 0,
            display: {
                x: Number(bounds.x) || 0,
                y: Number(bounds.y) || 0,
                width: Math.max(1, Number(bounds.width) || 1),
                height: Math.max(1, Number(bounds.height) || 1),
                scaleFactor: Number(display?.scaleFactor) || 1
            }
        };
    } catch (error) {
        console.error('[SCREEN_REC] getCursorPoint error:', error);
        return null;
    }
});

ipcMain.handle('screenRecording:startSystemAudio', async () => {
    if (process.platform !== 'linux') return { success: false, error: 'unsupported-platform' };
    if (screenRecordingSystemAudioProc) {
        return { success: true, path: screenRecordingSystemAudioPath, alreadyRunning: true };
    }
    try {
        const audioDevice = await pickDefaultOutputMonitorDeviceId();
        if (!audioDevice) return { success: false, error: 'monitor-not-found' };
        const ffmpegPath = getFfmpegPathForEnv();
        const outPath = path.join(app.getPath('temp'), `ardali-screen-system-audio-${Date.now()}.wav`);
        const child = spawn(ffmpegPath, [
            '-y',
            '-f', 'pulse',
            '-i', audioDevice,
            '-ac', '2',
            '-ar', '48000',
            '-vn',
            outPath
        ], {
            env: process.env,
            windowsHide: true
        });
        screenRecordingSystemAudioProc = child;
        screenRecordingSystemAudioPath = outPath;
        child.stderr.on('data', () => {});
        child.once('error', (error) => {
            console.warn('[SCREEN_REC] system audio capture error:', error?.message || error);
            if (screenRecordingSystemAudioProc === child) screenRecordingSystemAudioProc = null;
        });
        child.once('close', () => {
            if (screenRecordingSystemAudioProc === child) screenRecordingSystemAudioProc = null;
        });
        return { success: true, path: outPath, device: audioDevice };
    } catch (error) {
        console.error('[SCREEN_REC] startSystemAudio error:', error);
        screenRecordingSystemAudioProc = null;
        screenRecordingSystemAudioPath = '';
        return { success: false, error: error?.message || String(error) };
    }
});

ipcMain.handle('screenRecording:stopSystemAudio', async () => {
    const child = screenRecordingSystemAudioProc;
    const outPath = screenRecordingSystemAudioPath;
    screenRecordingSystemAudioProc = null;
    screenRecordingSystemAudioPath = '';
    if (!child) {
        const size = outPath && fs.existsSync(outPath) ? fs.statSync(outPath).size : 0;
        return { success: !!size, path: outPath, size };
    }
    await new Promise((resolve) => {
        const done = () => resolve();
        child.once('close', done);
        try { child.kill('SIGINT'); } catch { done(); }
        setTimeout(() => {
            try { if (!child.killed) child.kill('SIGTERM'); } catch {}
            resolve();
        }, 1800);
    });
    const size = outPath && fs.existsSync(outPath) ? fs.statSync(outPath).size : 0;
    return { success: size > 128, path: outPath, size };
});

ipcMain.handle('screenRecording:muxSystemAudio', async (_event, videoPath, audioPath) => {
    const video = String(videoPath || '').trim();
    const audio = String(audioPath || '').trim();
    if (!video || !audio || !fs.existsSync(video) || !fs.existsSync(audio)) {
        return { success: false, error: 'missing-files' };
    }
    const tmpPath = video.replace(/\.webm$/i, '') + `.with-audio-${Date.now()}.webm`;
    const ffmpegPath = getFfmpegPathForEnv();
    const result = await new Promise((resolve) => {
        let err = '';
        const child = spawn(ffmpegPath, [
            '-y',
            '-i', video,
            '-i', audio,
            '-map', '0:v:0',
            '-map', '1:a:0',
            '-c:v', 'copy',
            '-c:a', 'libopus',
            '-shortest',
            tmpPath
        ], { windowsHide: true });
        child.stderr.on('data', (chunk) => { err += String(chunk || ''); });
        child.once('error', (error) => resolve({ success: false, error: error?.message || String(error) }));
        child.once('close', (code) => {
            if (code === 0 && fs.existsSync(tmpPath) && fs.statSync(tmpPath).size > 128) {
                try {
                    fs.renameSync(tmpPath, video);
                    try { fs.unlinkSync(audio); } catch {}
                    resolve({ success: true, path: video });
                } catch (error) {
                    resolve({ success: false, error: error?.message || String(error) });
                }
                return;
            }
            try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
            resolve({ success: false, error: String(err || `ffmpeg exited with code ${code}`).trim() });
        });
    });
    return result;
});

ipcMain.handle('screenRecording:finalizeRecording', async (_event, inputPath, outputPath, options = {}) => {
    const input = String(inputPath || '').trim();
    const output = String(outputPath || '').trim();
    const format = String(options?.format || path.extname(output).replace(/^\./, '') || 'webm').trim().toLowerCase();
    const bitrateKbps = Math.max(500, Math.min(60000, Math.round(Number(options?.bitrateKbps) || 8000)));
    const videoEncoder = normalizeScreenRecordingVideoEncoder(options?.videoEncoder);
    const externalAudioTracks = Array.isArray(options?.audioTracks)
        ? options.audioTracks
            .map((track) => ({
                path: String(track?.path || '').trim(),
                label: String(track?.label || track?.kind || 'Audio').trim() || 'Audio'
            }))
            .filter((track) => track.path && fs.existsSync(track.path))
            .slice(0, 8)
        : [];
    if (!input || !output || !fs.existsSync(input)) {
        return { success: false, error: 'missing-input' };
    }
    if (format === 'webm' && input === output && !externalAudioTracks.length) {
        return { success: true, path: output, passthrough: true };
    }
    const ffmpegPath = getFfmpegPathForEnv();
    const tmpPath = `${output}.ffmpeg-${Date.now()}.tmp.${format || 'webm'}`;
    const args = ['-y', '-i', input];
    externalAudioTracks.forEach((track) => {
        args.push('-i', track.path);
    });
    const pushExternalAudioMaps = () => {
        args.push('-map', '0:v:0');
        externalAudioTracks.forEach((_track, index) => {
            args.push('-map', `${index + 1}:a:0`);
        });
    };
    const pushAudioMetadata = () => {
        externalAudioTracks.forEach((track, index) => {
            args.push(`-metadata:s:a:${index}`, `title=${track.label}`);
        });
    };
    if (format === 'mp4') {
        if (externalAudioTracks.length) pushExternalAudioMaps();
        pushScreenRecordingVideoEncoderArgs(args, videoEncoder, bitrateKbps);
        args.push('-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart');
        if (externalAudioTracks.length) {
            pushAudioMetadata();
            args.push('-shortest');
        }
        args.push(tmpPath);
    } else if (format === 'mkv') {
        if (externalAudioTracks.length) {
            pushExternalAudioMaps();
            args.push('-c:v', 'copy', '-c:a', 'copy');
            pushAudioMetadata();
            args.push('-shortest', tmpPath);
        } else {
            args.push('-c', 'copy', tmpPath);
        }
    } else {
        if (externalAudioTracks.length) {
            pushExternalAudioMaps();
            args.push('-c:v', 'copy', '-c:a', 'libopus');
            pushAudioMetadata();
            args.push('-shortest', tmpPath);
        } else {
            args.push('-c', 'copy', tmpPath);
        }
    }
    const result = await new Promise((resolve) => {
        let err = '';
        const child = spawn(ffmpegPath, args, { windowsHide: true });
        child.stderr.on('data', (chunk) => { err += String(chunk || ''); });
        child.once('error', (error) => resolve({ success: false, error: error?.message || String(error) }));
        child.once('close', (code) => {
            if (code === 0 && fs.existsSync(tmpPath) && fs.statSync(tmpPath).size > 128) {
                try {
                    fs.renameSync(tmpPath, output);
                    if (input !== output) {
                        try { fs.unlinkSync(input); } catch {}
                    }
                    externalAudioTracks.forEach((track) => {
                        try { fs.unlinkSync(track.path); } catch {}
                    });
                    resolve({ success: true, path: output });
                } catch (error) {
                    resolve({ success: false, error: error?.message || String(error) });
                }
                return;
            }
            try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
            resolve({ success: false, error: String(err || `ffmpeg exited with code ${code}`).trim() });
        });
    });
    return result;
});

ipcMain.handle('screenRecording:repairRecording', async (_event, inputPath, outputPath, options = {}) => {
    const input = String(inputPath || '').trim();
    const output = String(outputPath || '').trim();
    const format = String(options?.format || path.extname(output).replace(/^\./, '') || 'mkv').trim().toLowerCase();
    const bitrateKbps = Math.max(500, Math.min(60000, Math.round(Number(options?.bitrateKbps) || 8000)));
    const videoEncoder = normalizeScreenRecordingVideoEncoder(options?.videoEncoder);
    if (!input || !output || !fs.existsSync(input)) {
        return { success: false, error: 'missing-input' };
    }
    const ffmpegPath = getFfmpegPathForEnv();
    const tmpPath = `${output}.repair-${Date.now()}.tmp.${format || 'mkv'}`;
    const runRepairArgs = (mode = 'copy') => {
        const args = [
            '-y',
            '-fflags', '+genpts+igndts',
            '-err_detect', 'ignore_err',
            '-i', input,
            '-map', '0:v:0?',
            '-map', '0:a?'
        ];
        if (mode === 'copy' && format !== 'mp4') {
            args.push('-c', 'copy');
        } else {
            if (format === 'webm') {
                args.push('-c:v', 'libvpx-vp9', '-deadline', 'good', '-cpu-used', '4', '-b:v', `${bitrateKbps}k`);
            } else {
                pushScreenRecordingVideoEncoderArgs(args, format === 'mp4' ? videoEncoder : 'libx264', bitrateKbps);
            }
            args.push('-c:a', format === 'webm' ? 'libopus' : 'aac', '-b:a', '160k');
            if (format === 'mp4') args.push('-movflags', '+faststart');
        }
        args.push(tmpPath);
        return args;
    };
    const runFfmpeg = (args) => new Promise((resolve) => {
        let err = '';
        const child = spawn(ffmpegPath, args, { windowsHide: true });
        child.stderr.on('data', (chunk) => { err += String(chunk || ''); });
        child.once('error', (error) => resolve({ success: false, error: error?.message || String(error) }));
        child.once('close', (code) => {
            if (code === 0 && fs.existsSync(tmpPath) && fs.statSync(tmpPath).size > 128) {
                resolve({ success: true });
                return;
            }
            try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
            resolve({ success: false, error: String(err || `ffmpeg exited with code ${code}`).trim() });
        });
    });
    let result = await runFfmpeg(runRepairArgs('copy'));
    if (!result.success) result = await runFfmpeg(runRepairArgs('transcode'));
    if (!result.success) return result;
    try {
        fs.renameSync(tmpPath, output);
        return { success: true, path: output };
    } catch (error) {
        try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
        return { success: false, error: error?.message || String(error) };
    }
});

ipcMain.handle('screenRecording:validateRecording', async (_event, filePath, options = {}) => {
    const targetPath = String(filePath || '').trim();
    const expectedDurationSec = Math.max(0, Number(options?.expectedDurationSec) || 0);
    const minSizeBytes = Math.max(128, Number(options?.minSizeBytes) || 1024);
    if (!targetPath || !fs.existsSync(targetPath)) {
        return { success: false, status: 'error', error: 'missing-file', checks: [{ id: 'file', status: 'error', detail: 'missing-file' }] };
    }
    const checks = [];
    let stat = null;
    try {
        stat = await fs.promises.stat(targetPath);
        checks.push({
            id: 'size',
            status: stat.size >= minSizeBytes ? 'ok' : 'error',
            detail: String(stat.size || 0)
        });
    } catch (error) {
        return { success: false, status: 'error', error: error?.message || String(error), checks };
    }

    const ffprobePath = getFfprobePathForEnv();
    const probe = await new Promise((resolve) => {
        let stdout = '';
        let stderr = '';
        const child = spawn(ffprobePath, [
            '-v', 'error',
            '-print_format', 'json',
            '-show_format',
            '-show_streams',
            targetPath
        ], { windowsHide: true });
        child.stdout.on('data', (chunk) => { stdout += String(chunk || ''); });
        child.stderr.on('data', (chunk) => { stderr += String(chunk || ''); });
        child.once('error', (error) => resolve({ ok: false, error: error?.message || String(error) }));
        child.once('close', (code) => {
            if (code !== 0) {
                resolve({ ok: false, error: String(stderr || `ffprobe exited with code ${code}`).trim() });
                return;
            }
            try {
                resolve({ ok: true, data: JSON.parse(stdout || '{}') });
            } catch (error) {
                resolve({ ok: false, error: error?.message || String(error) });
            }
        });
    });

    if (!probe.ok) {
        checks.push({ id: 'probe', status: 'warning', detail: probe.error || 'ffprobe-unavailable' });
        return {
            success: stat.size >= minSizeBytes,
            status: stat.size >= minSizeBytes ? 'warning' : 'error',
            path: targetPath,
            size: stat.size,
            checks,
            error: probe.error || ''
        };
    }

    const streams = Array.isArray(probe.data?.streams) ? probe.data.streams : [];
    const videoStreams = streams.filter((stream) => String(stream?.codec_type || '') === 'video');
    const audioStreams = streams.filter((stream) => String(stream?.codec_type || '') === 'audio');
    const primaryVideo = videoStreams[0] || {};
    const primaryAudio = audioStreams[0] || {};
    const durationSec = Math.max(0, Number(probe.data?.format?.duration) || 0);
    const parseRate = (value) => {
        const [num, den] = String(value || '').split('/').map(Number);
        if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return 0;
        return num / den;
    };
    checks.push({
        id: 'video',
        status: videoStreams.length > 0 ? 'ok' : 'error',
        detail: String(videoStreams.length)
    });
    checks.push({
        id: 'duration',
        status: durationSec > 0 ? 'ok' : 'error',
        detail: String(durationSec)
    });
    if (expectedDurationSec > 2 && durationSec > 0) {
        const delta = Math.abs(durationSec - expectedDurationSec);
        const tolerance = Math.max(2.5, expectedDurationSec * 0.25);
        checks.push({
            id: 'duration-match',
            status: delta <= tolerance ? 'ok' : 'warning',
            detail: String(delta)
        });
    }
    const hasError = checks.some((check) => check.status === 'error');
    const hasWarning = checks.some((check) => check.status === 'warning');
    return {
        success: !hasError,
        status: hasError ? 'error' : (hasWarning ? 'warning' : 'ok'),
        path: targetPath,
        size: stat.size,
        durationSec,
        videoStreams: videoStreams.length,
        audioStreams: audioStreams.length,
        formatName: String(probe.data?.format?.format_name || ''),
        bitRate: Math.max(0, Number(probe.data?.format?.bit_rate || primaryVideo.bit_rate || 0) || 0),
        fps: Math.max(0, parseRate(primaryVideo.avg_frame_rate || primaryVideo.r_frame_rate)),
        videoCodec: String(primaryVideo.codec_name || ''),
        audioCodec: String(primaryAudio.codec_name || ''),
        checks
    };
});

function normalizeLiveOutputId(value = '') {
    return String(value || '').trim().replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 80);
}

function stopScreenRecordingLiveOutput(id, signal = 'SIGINT') {
    const outputId = normalizeLiveOutputId(id);
    const live = screenRecordingLiveOutputs.get(outputId);
    if (!live) return { success: true, stopped: false };
    screenRecordingLiveOutputs.delete(outputId);
    try { live.proc.stdin?.end?.(); } catch {}
    try {
        if (!live.proc.killed) live.proc.kill(signal);
    } catch {}
    return { success: true, stopped: true, id: outputId };
}

ipcMain.handle('screenRecording:startLiveOutput', async (_event, options = {}) => {
    const id = normalizeLiveOutputId(options?.id || `live-${Date.now()}`);
    const kind = String(options?.kind || 'rtmp').trim().toLowerCase();
    const target = String(options?.target || '').trim();
    const bitrateKbps = Math.max(500, Math.min(60000, Math.round(Number(options?.bitrateKbps) || 8000)));
    const fps = Math.max(1, Math.min(120, Math.round(Number(options?.fps) || 30)));
    if (!id || !target) return { success: false, error: 'missing-target' };
    if (screenRecordingLiveOutputs.has(id)) return { success: false, error: 'already-running' };
    if (!['rtmp', 'virtual-camera'].includes(kind)) return { success: false, error: 'unsupported-kind' };
    if (kind === 'virtual-camera') {
        if (process.platform !== 'linux') return { success: false, error: 'unsupported-platform' };
        if (!/^\/dev\/video\d+$/i.test(target)) return { success: false, error: 'invalid-device' };
        if (!fs.existsSync(target)) return { success: false, error: 'device-not-found' };
    }
    const ffmpegPath = getFfmpegPathForEnv();
    const inputArgs = [
        '-hide_banner',
        '-loglevel', 'warning',
        '-fflags', '+genpts',
        '-f', 'webm',
        '-i', 'pipe:0'
    ];
    const args = kind === 'virtual-camera' ? [
        ...inputArgs,
        '-an',
        '-r', String(fps),
        '-vf', 'format=yuyv422',
        '-f', 'v4l2',
        target
    ] : [
        ...inputArgs,
        '-r', String(fps),
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-tune', 'zerolatency',
        '-b:v', `${bitrateKbps}k`,
        '-maxrate', `${bitrateKbps}k`,
        '-bufsize', `${Math.max(1000, bitrateKbps * 2)}k`,
        '-pix_fmt', 'yuv420p',
        '-g', String(Math.max(30, fps * 2)),
        '-c:a', 'aac',
        '-b:a', '160k',
        '-ar', '48000',
        '-f', 'flv',
        target
    ];
    try {
        const proc = spawn(ffmpegPath, args, { windowsHide: true });
        const live = { id, kind, target, proc, startedAt: Date.now(), lastError: '' };
        screenRecordingLiveOutputs.set(id, live);
        proc.stderr.on('data', (chunk) => {
            const text = String(chunk || '').trim();
            if (text) live.lastError = text.slice(-1200);
        });
        proc.once('error', (error) => {
            live.lastError = error?.message || String(error);
            screenRecordingLiveOutputs.delete(id);
        });
        proc.once('close', () => {
            screenRecordingLiveOutputs.delete(id);
        });
        return { success: true, id };
    } catch (error) {
        screenRecordingLiveOutputs.delete(id);
        return { success: false, error: error?.message || String(error) };
    }
});

ipcMain.handle('screenRecording:writeLiveOutput', async (_event, id, chunk) => {
    const outputId = normalizeLiveOutputId(id);
    const live = screenRecordingLiveOutputs.get(outputId);
    if (!live || !live.proc?.stdin || live.proc.stdin.destroyed) {
        return { success: false, error: live?.lastError || 'not-running' };
    }
    try {
        const buffer = Buffer.from(chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : chunk);
        if (!buffer.length) return { success: true, id: outputId, bytes: 0 };
        const wrote = live.proc.stdin.write(buffer);
        if (!wrote) {
            await new Promise((resolve) => live.proc.stdin.once('drain', resolve));
        }
        return { success: true, id: outputId, bytes: buffer.length };
    } catch (error) {
        return { success: false, error: error?.message || String(error) };
    }
});

ipcMain.handle('screenRecording:stopLiveOutput', async (_event, id) => {
    return stopScreenRecordingLiveOutput(id);
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

ipcMain.handle('web:clearData', async (_event, options) => {
    try {
        const opts = options && typeof options === 'object' ? options : {};
        console.log('[WEB] clearData request:', opts);
        if (opts.all === true || opts.history === true) {
            clearLastWebHistoryFromSettingsSync();
        }
        return await clearWebSessionData(opts);
    } catch (error) {
        console.error('[WEB] clearData error:', error);
        return false;
    }
});

ipcMain.handle('web:reloadActive', async () => {
    try {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('web:reload-active');
            return true;
        }
    } catch (error) {
        console.warn('[WEB] reload active send failed:', error?.message || error);
    }
    return false;
});

function buildCookieUrlForImport(rawCookie = {}) {
    const explicitUrl = String(rawCookie?.url || '').trim();
    if (/^https?:\/\//i.test(explicitUrl)) return explicitUrl;

    const rawDomain = String(rawCookie?.domain || '').trim().replace(/^\./, '');
    if (!rawDomain) return '';

    const secure = rawCookie?.secure === true;
    const scheme = secure ? 'https' : 'http';
    const pathName = String(rawCookie?.path || '/').trim() || '/';
    const normalizedPath = pathName.startsWith('/') ? pathName : `/${pathName}`;
    return `${scheme}://${rawDomain}${normalizedPath}`;
}

function normalizeCookieSameSiteValue(input = '') {
    const value = String(input || '').trim().toLowerCase();
    if (value === 'no_restriction' || value === 'lax' || value === 'strict' || value === 'unspecified') {
        return value;
    }
    if (value === 'none') return 'no_restriction';
    return '';
}

ipcMain.handle('web:exportCookies', async (_event, filePath) => {
    const targetPath = String(filePath || '').trim();
    if (!targetPath) return { ok: false, error: 'missing-path' };

    try {
        const ses = session.fromPartition(WEBVIEW_PARTITION);
        const cookies = await ses.cookies.get({});
        const payload = {
            version: 1,
            exportedAt: Date.now(),
            partition: WEBVIEW_PARTITION,
            cookies
        };
        await fs.promises.writeFile(targetPath, JSON.stringify(payload, null, 2), 'utf8');
        return { ok: true, count: Array.isArray(cookies) ? cookies.length : 0, path: targetPath };
    } catch (error) {
        console.error('[WEB] exportCookies error:', error);
        return { ok: false, error: String(error?.message || error || 'export-failed') };
    }
});

ipcMain.handle('web:importCookies', async (_event, filePath) => {
    const sourcePath = String(filePath || '').trim();
    if (!sourcePath) return { ok: false, error: 'missing-path' };

    try {
        const raw = await fs.promises.readFile(sourcePath, 'utf8');
        const parsed = JSON.parse(raw);
        const cookieList = Array.isArray(parsed)
            ? parsed
            : (Array.isArray(parsed?.cookies) ? parsed.cookies : []);
        if (!cookieList.length) {
            return { ok: false, error: 'no-cookies-found', imported: 0, skipped: 0, total: 0 };
        }

        const ses = session.fromPartition(WEBVIEW_PARTITION);
        let imported = 0;
        let skipped = 0;

        for (const rawCookie of cookieList) {
            const name = String(rawCookie?.name || '').trim();
            const value = String(rawCookie?.value || '');
            const url = buildCookieUrlForImport(rawCookie);
            if (!name || !url) {
                skipped += 1;
                continue;
            }

            const nextCookie = {
                url,
                name,
                value,
                path: String(rawCookie?.path || '/').trim() || '/',
                secure: rawCookie?.secure === true,
                httpOnly: rawCookie?.httpOnly === true
            };
            const sameSite = normalizeCookieSameSiteValue(rawCookie?.sameSite);
            if (sameSite) nextCookie.sameSite = sameSite;

            const expiry = Number(rawCookie?.expirationDate);
            if (Number.isFinite(expiry) && expiry > 0) {
                nextCookie.expirationDate = expiry;
            }

            try {
                await ses.cookies.set(nextCookie);
                imported += 1;
            } catch {
                skipped += 1;
            }
        }

        return {
            ok: imported > 0,
            imported,
            skipped,
            total: cookieList.length,
            path: sourcePath
        };
    } catch (error) {
        console.error('[WEB] importCookies error:', error);
        return { ok: false, error: String(error?.message || error || 'import-failed') };
    }
});



// Dizin Okuma
ipcMain.handle('fs:readDirectory', async (event, dirPath) => {
    try {
        const safeDirPath = sanitizeIpcPath(dirPath);
        if (!safeDirPath) return [];

        // Windows testleri için: kütüphane/kırpma filtreleri bu uzantılara göre çalışıyor.
        // Not: Bu liste "noktasız" (mp3) tutulur, kontrol `toLowerCase()` ile yapılır.
        const SUPPORTED_MEDIA_EXTENSIONS = new Set([
            'mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'wma', 'aiff', 'opus', 'ape', 'wv',
            'mp4', 'mkv', 'webm', 'avi', 'mov', 'wmv', 'm4v', 'flv', 'mpg', 'mpeg'
        ]);

        const items = await fs.promises.readdir(safeDirPath, { withFileTypes: true });
        const results = await Promise.all(items.map(async (item) => {
            const fullPath = path.join(safeDirPath, item.name);
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
    const desktopFolders = ['Desktop', 'Masaüstü', 'Masaustu', 'desktop'];
    const picturesFolders = ['Pictures', 'Resimler', 'pictures'];

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
        desktop: await findExisting(desktopFolders),
        pictures: await findExisting(picturesFolders),
        documents: path.join(home, 'Documents')
    };
});

// Dosya Varlık Kontrolü
ipcMain.handle('fs:exists', async (event, filePath) => {
    try {
        const targetPath = sanitizeIpcPath(filePath);
        if (!targetPath) return false;
        await fs.promises.access(targetPath);
        return true;
    } catch {
        return false;
    }
});

ipcMain.handle('fs:isWritable', async (_event, filePath) => {
    try {
        const targetPath = sanitizeIpcPath(filePath);
        if (!targetPath) return false;
        await fs.promises.access(targetPath, fs.constants.W_OK);
        return true;
    } catch {
        return false;
    }
});

// Dosya Bilgisi
ipcMain.handle('fs:getFileInfo', async (event, filePath) => {
    try {
        const targetPath = sanitizeIpcPath(filePath);
        if (!targetPath) return null;
        const stats = await fs.promises.stat(targetPath);
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

ipcMain.handle('fs:getStorageStats', async (_event, targetPath) => {
    try {
        let probePath = sanitizeIpcPath(targetPath || app.getPath('videos') || app.getPath('home'));
        if (!probePath) return null;
        try {
            const stats = await fs.promises.stat(probePath);
            if (stats.isFile()) probePath = path.dirname(probePath);
        } catch {
            probePath = path.dirname(probePath);
        }
        const stats = await fs.promises.statfs(probePath);
        const blockSize = Number(stats.bsize || stats.frsize || 0);
        const freeBlocks = Number(stats.bavail || stats.bfree || 0);
        const totalBlocks = Number(stats.blocks || 0);
        return {
            path: probePath,
            freeBytes: Math.max(0, freeBlocks * blockSize),
            totalBytes: Math.max(0, totalBlocks * blockSize)
        };
    } catch (error) {
        return { error: error?.message || String(error) };
    }
});

ipcMain.handle('app:getSystemStats', async () => {
    try {
        const memory = process.memoryUsage();
        return {
            memory: {
                rss: Number(memory.rss || 0),
                heapUsed: Number(memory.heapUsed || 0),
                heapTotal: Number(memory.heapTotal || 0),
                external: Number(memory.external || 0)
            },
            system: {
                totalMemory: Number(os.totalmem?.() || 0),
                freeMemory: Number(os.freemem?.() || 0),
                loadAverage: Array.isArray(os.loadavg?.()) ? os.loadavg() : [],
                cpuCount: Array.isArray(os.cpus?.()) ? os.cpus().length : 0
            }
        };
    } catch (error) {
        return { error: error?.message || String(error) };
    }
});

ipcMain.handle('screenRecording:listStudioPlugins', async () => {
    const pluginDirs = [
        path.join(app.getPath('userData'), 'video-studio-plugins'),
        path.join(app.getPath('home'), '.config', 'ardali', 'video-studio-plugins')
    ];
    const plugins = [];
    for (const dir of pluginDirs) {
        try {
            await fs.promises.mkdir(dir, { recursive: true });
            const entries = await fs.promises.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const manifestPath = entry.isDirectory()
                    ? path.join(dir, entry.name, 'plugin.json')
                    : (entry.isFile() && entry.name.endsWith('.json') ? path.join(dir, entry.name) : '');
                if (!manifestPath) continue;
                try {
                    const raw = await fs.promises.readFile(manifestPath, 'utf8');
                    const manifest = JSON.parse(raw);
                    plugins.push({
                        ...manifest,
                        path: manifestPath
                    });
                } catch (error) {
                    plugins.push({
                        id: `invalid-${entry.name}`,
                        name: entry.name,
                        path: manifestPath,
                        error: error?.message || String(error)
                    });
                }
            }
        } catch {
            // yoksay
        }
    }
    return {
        success: true,
        pluginDirs,
        plugins: plugins.slice(0, 64)
    };
});

ipcMain.handle('fs:readText', async (_event, filePath) => {
    try {
        const targetPath = sanitizeIpcPath(filePath);
        if (!targetPath) return null;
        return await fs.promises.readFile(targetPath, 'utf8');
    } catch (error) {
        return null;
    }
});

ipcMain.handle('fs:writeText', async (_event, filePath, text) => {
    try {
        const targetPath = sanitizeIpcPath(filePath);
        if (!targetPath) return false;
        await fs.promises.writeFile(targetPath, String(text ?? ''), 'utf8');
        return true;
    } catch (error) {
        console.error('[FS] writeText error:', error);
        return false;
    }
});

ipcMain.handle('fs:writeBase64', async (_event, filePath, base64Data) => {
    try {
        const target = sanitizeIpcPath(filePath);
        const encoded = String(base64Data || '').trim();
        if (!target || !encoded) return false;
        const buffer = Buffer.from(encoded, 'base64');
        await fs.promises.writeFile(target, buffer);
        return true;
    } catch (error) {
        console.error('[FS] writeBase64 error:', error);
        return false;
    }
});

ipcMain.handle('fs:writeBuffer', async (_event, filePath, arrayBuffer) => {
    try {
        const target = sanitizeIpcPath(filePath);
        if (!target || !arrayBuffer) return false;
        const buffer = Buffer.from(arrayBuffer);
        if (!buffer.length) return false;
        await fs.promises.writeFile(target, buffer);
        return true;
    } catch (error) {
        console.error('[FS] writeBuffer error:', error);
        return false;
    }
});

ipcMain.handle('fs:renameItem', async (_event, sourcePath, nextName) => {
    try {
        const src = sanitizeIpcPath(sourcePath);
        const rawName = String(nextName || '').trim();
        if (!src || !rawName) {
            return { ok: false, error: 'invalid-params' };
        }
        if (rawName.includes('/') || rawName.includes('\\') || rawName.includes('\0')) {
            return { ok: false, error: 'invalid-name' };
        }

        const srcDir = path.dirname(src);
        const targetPath = path.join(srcDir, rawName);
        if (targetPath === src) {
            return {
                ok: true,
                unchanged: true,
                path: src,
                name: path.basename(src)
            };
        }

        try {
            await fs.promises.access(targetPath);
            return { ok: false, error: 'target-exists' };
        } catch {
            // hedef yok, devam
        }

        await fs.promises.rename(src, targetPath);
        return {
            ok: true,
            path: targetPath,
            name: path.basename(targetPath)
        };
    } catch (error) {
        console.error('[FS] renameItem error:', error);
        return { ok: false, error: String(error?.message || error || 'rename-failed') };
    }
});

ipcMain.handle('fs:moveToTrash', async (_event, filePath) => {
    try {
        const targetPath = sanitizeIpcPath(filePath);
        if (!targetPath) return false;
        if (typeof shell?.trashItem !== 'function') return false;
        await shell.trashItem(targetPath);
        return true;
    } catch (error) {
        console.error('[FS] moveToTrash error:', error);
        return false;
    }
});

ipcMain.handle('fs:openContainingFolder', async (_event, filePath) => {
    try {
        const targetPath = sanitizeIpcPath(filePath);
        if (!targetPath) return false;

        try {
            await fs.promises.access(targetPath);
            shell.showItemInFolder(targetPath);
            return true;
        } catch {
            const parentPath = path.dirname(targetPath);
            const openError = await shell.openPath(parentPath);
            return openError === '';
        }
    } catch (error) {
        console.error('[FS] openContainingFolder error:', error);
        return false;
    }
});

ipcMain.handle('fs:getPathProperties', async (_event, filePath) => {
    try {
        const targetPath = sanitizeIpcPath(filePath);
        if (!targetPath) return null;
        const stat = await fs.promises.stat(targetPath);
        return {
            path: targetPath,
            name: path.basename(targetPath),
            directory: path.dirname(targetPath),
            extension: path.extname(targetPath).replace(/^\./, '').toLowerCase(),
            size: Number(stat.size || 0),
            created: stat.birthtime,
            modified: stat.mtime,
            isDirectory: stat.isDirectory(),
            isFile: stat.isFile()
        };
    } catch (error) {
        return null;
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

function readLinuxPowerStatus() {
    if (process.platform !== 'linux') {
        return { supported: false, onBattery: false, charging: true, level: null, source: process.platform };
    }
    const base = '/sys/class/power_supply';
    try {
        const names = fs.readdirSync(base);
        let hasBattery = false;
        let batteryCharging = false;
        let batteryLevel = null;
        let acOnline = false;

        for (const name of names) {
            const dir = path.join(base, name);
            const read = (file) => {
                try { return String(fs.readFileSync(path.join(dir, file), 'utf8')).trim(); } catch { return ''; }
            };
            const type = read('type').toLowerCase();
            if (type === 'mains' || type === 'usb' || /^a(c|dapter)/i.test(name)) {
                acOnline = read('online') === '1' || acOnline;
                continue;
            }
            if (type === 'battery' || /^bat/i.test(name)) {
                hasBattery = true;
                const status = read('status').toLowerCase();
                batteryCharging = batteryCharging || status === 'charging' || status === 'full';
                const cap = Number(read('capacity'));
                if (Number.isFinite(cap)) {
                    batteryLevel = batteryLevel === null ? cap / 100 : Math.max(batteryLevel, cap / 100);
                }
            }
        }

        return {
            supported: hasBattery,
            onBattery: hasBattery ? !acOnline && !batteryCharging : false,
            charging: hasBattery ? (acOnline || batteryCharging) : true,
            level: batteryLevel,
            source: 'linux-sysfs'
        };
    } catch {
        return { supported: false, onBattery: false, charging: true, level: null, source: 'linux-sysfs-error' };
    }
}

ipcMain.handle('system:getPowerStatus', async () => readLinuxPowerStatus());

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

        const senderId = event?.sender?.id || 0;
        const saveSource =
            adblockWindow && !adblockWindow.isDestroyed() && adblockWindow.webContents?.id === senderId ? 'adblock' :
            settingsWindow && !settingsWindow.isDestroyed() && settingsWindow.webContents?.id === senderId ? 'settings' :
            soundEffectsWindow && !soundEffectsWindow.isDestroyed() && soundEffectsWindow.webContents?.id === senderId ? 'soundEffects' :
            mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents?.id === senderId ? 'main' :
            'unknown';
        const reloadMeta = {
            source: saveSource,
            sourceWebContentsId: senderId,
            savedAt: Date.now()
        };

        for (const targetWindow of [mainWindow, settingsWindow, soundEffectsWindow, adblockWindow]) {
            if (!targetWindow || targetWindow.isDestroyed()) continue;
            if (event?.sender && targetWindow.webContents === event.sender) continue;
            if (event?.sender?.id && targetWindow.webContents?.id === event.sender.id) continue;
            // Sound effects already stream live Web/Video DSP changes through
            // soundEffects:scopedLiveParam. Broadcasting every persistence save
            // back to the main window rebuilds the web DALI graph while audio is
            // playing, which can surface as crackle.
            if (saveSource === 'soundEffects' && targetWindow === mainWindow) continue;
            try {
                targetWindow.webContents.send('settings:reloaded', sanitizedMerged, reloadMeta);
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
                previous: 'none',
                playPause: 'none',
                next: 'none'
            },
            startupState: {
                lastTrackPath: '',
                lastTrackIndex: -1,
                lastPositionMs: 0,
                lastWasPlaying: false,
                updatedAt: 0
            }
        },
        volume: 40,
        shuffle: false,
        repeat: false,
        webUi: {
            clearCacheOnQuit: true,
            clearCookiesOnQuit: false,
            clearSiteDataOnQuit: false,
            clearHistoryOnQuit: false,
            preferHttps: true,
            reduceWebRtcIpLeaks: true,
            backgroundThrottle: true,
            restoreLastSession: true,
            suspendWhenInactive: true,
            allowCamera: false,
            allowMicrophone: false,
            allowLocation: false,
            allowNotifications: false,
            allowPopups: true,
            userAgentMode: 'desktop',
            autoplayPolicy: 'allow',
            askDownloadLocation: true,
            reduceReferrers: true,
            stripTrackingParams: true,
            blockThirdPartyCookies: false,
            autoRecover: true
        }
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

ipcMain.handle('adblock:openWindow', async () => {
    try {
        createAdblockWindow();
        return true;
    } catch (error) {
        console.error('[ADBLOCK] openWindow error:', error);
        return false;
    }
});

ipcMain.handle('downloader:openWindow', async (_event, payload) => {
    try {
        const url = payload && typeof payload === 'object' ? payload.url : payload;
        const titleHint = payload && typeof payload === 'object'
            ? normalizeDownloaderTitleHint(payload.titleHint || payload.title || '')
            : '';
        const normalized = normalizeDownloaderUrlForAnalysis(url);
        if (/^https?:\/\//i.test(normalized)) {
            sendUrlToDownloaderWindow(normalized, { titleHint });
        } else {
            sendDownloaderNoUrlNotice();
        }
        return true;
    } catch (error) {
        console.error('[DOWNLOADER] openWindow error:', error);
        return false;
    }
});

ipcMain.handle('downloader:getSettings', async () => {
    return getDownloaderService().readSettings();
});

ipcMain.handle('downloader:getPendingUrl', async () => {
    const url = pendingDownloaderUrl;
    pendingDownloaderUrl = '';
    return url;
});

ipcMain.handle('downloader:getPendingNotice', async () => {
    const notice = pendingDownloaderNotice;
    pendingDownloaderNotice = null;
    return notice || null;
});

ipcMain.handle('downloader:getDependencyStatus', async () => {
    return getDownloaderService().getDependencyStatus();
});

ipcMain.handle('downloader:ensureDependencies', async () => {
    try {
        const status = await getDownloaderService().ensureDependencies();
        return { success: true, status };
    } catch (error) {
        return {
            success: false,
            error: String(error?.message || error || 'Gerekli araçlar hazırlanamadı'),
            status: getDownloaderService().getDependencyStatus()
        };
    }
});

ipcMain.handle('downloader:saveSettings', async (_event, settings) => {
    const payload = settings && typeof settings === 'object' ? settings : {};
    const allowed = {};
    if (payload.preferredVideoQuality != null) allowed.preferredVideoQuality = String(payload.preferredVideoQuality);
    if (payload.preferredVideoCodec != null) allowed.preferredVideoCodec = String(payload.preferredVideoCodec);
    if (payload.preferredAudioFormat != null) allowed.preferredAudioFormat = String(payload.preferredAudioFormat);
    if (payload.customArgs != null) allowed.customArgs = String(payload.customArgs);
    if (payload.closeOnFinish != null) allowed.closeOnFinish = payload.closeOnFinish === true;
    if (payload.browserCookies != null) allowed.browserCookies = String(payload.browserCookies);
    if (payload.proxy != null) allowed.proxy = String(payload.proxy);
    if (payload.configPath != null) allowed.configPath = String(payload.configPath);
    if (payload.useConfigFile != null) allowed.useConfigFile = payload.useConfigFile === true;
    if (payload.showMoreFormats != null) allowed.showMoreFormats = payload.showMoreFormats === true;
    if (payload.theme != null) allowed.theme = String(payload.theme);
    if (payload.playlistFileTemplate != null) allowed.playlistFileTemplate = String(payload.playlistFileTemplate);
    if (payload.playlistFolderTemplate != null) allowed.playlistFolderTemplate = String(payload.playlistFolderTemplate);
    if (payload.maxActiveDownloads != null) allowed.maxActiveDownloads = Math.max(1, Math.min(2, Number(payload.maxActiveDownloads) || 1));
    if (payload.closeToTray != null) allowed.closeToTray = payload.closeToTray === true;
    if (payload.disableAutoUpdates != null) allowed.disableAutoUpdates = payload.disableAutoUpdates === true;
    if (payload.compressorMode != null) allowed.compressorMode = String(payload.compressorMode);
    if (payload.compressorExtension != null) allowed.compressorExtension = String(payload.compressorExtension);
    if (payload.compressorEncoder != null) allowed.compressorEncoder = String(payload.compressorEncoder);
    if (payload.compressorSpeed != null) allowed.compressorSpeed = String(payload.compressorSpeed);
    if (payload.compressorQuality != null) allowed.compressorQuality = Math.max(18, Math.min(51, Number(payload.compressorQuality) || 23));
    if (payload.compressorAudioFormat != null) allowed.compressorAudioFormat = String(payload.compressorAudioFormat);
    if (payload.compressorEmbedCover != null) allowed.compressorEmbedCover = payload.compressorEmbedCover === true;
    if (payload.compressorSuffix != null) allowed.compressorSuffix = String(payload.compressorSuffix);
    if (payload.compressorSameFolder != null) allowed.compressorSameFolder = payload.compressorSameFolder === true;
    if (payload.compressorOutputDir != null) allowed.compressorOutputDir = String(payload.compressorOutputDir);
    return getDownloaderService().writeSettings(allowed);
});

ipcMain.handle('downloader:readClipboard', async () => {
    return clipboard.readText();
});

ipcMain.handle('downloader:chooseFolder', async () => {
    const targetWindow = downloaderWindow && !downloaderWindow.isDestroyed()
        ? downloaderWindow
        : mainWindow;
    const result = await dialog.showOpenDialog(targetWindow, {
        properties: ['openDirectory']
    });
    if (result.canceled || !result.filePaths?.[0]) {
        return { canceled: true };
    }
    const settings = await getDownloaderService().writeSettings({
        downloadDir: result.filePaths[0]
    });
    return { canceled: false, downloadDir: settings.downloadDir };
});

ipcMain.handle('downloader:chooseOutputFolder', async () => {
    const targetWindow = downloaderWindow && !downloaderWindow.isDestroyed()
        ? downloaderWindow
        : mainWindow;
    const result = await dialog.showOpenDialog(targetWindow, {
        properties: ['openDirectory']
    });
    if (result.canceled || !result.filePaths?.[0]) {
        return { canceled: true };
    }
    return { canceled: false, folder: result.filePaths[0] };
});

ipcMain.handle('downloader:chooseConfigFile', async () => {
    const targetWindow = downloaderWindow && !downloaderWindow.isDestroyed()
        ? downloaderWindow
        : mainWindow;
    const result = await dialog.showOpenDialog(targetWindow, {
        properties: ['openFile']
    });
    if (result.canceled || !result.filePaths?.[0]) {
        return { canceled: true };
    }
    const settings = await getDownloaderService().writeSettings({
        configPath: result.filePaths[0]
    });
    return { canceled: false, configPath: settings.configPath };
});

ipcMain.handle('downloader:getInfo', async (_event, url) => {
    try {
        const normalized = normalizeDownloaderUrlForAnalysis(url);
        if (!/^https?:\/\//i.test(normalized)) {
            return { success: false, error: 'Gecerli bir http/https baglantisi girin.' };
        }
        const cookiesFile = await writeDownloaderCookiesFileForUrl(normalized);
        let info;
        try {
            info = await getDownloaderService().getInfo(normalized, { cookiesFile });
        } catch (error) {
            if (!cookiesFile) throw error;
            console.warn('[DOWNLOADER] cookie based analysis failed, retrying without cookies:', error?.message || error);
            info = await getDownloaderService().getInfo(normalized, { cookiesFile: '' });
        }
        return { success: true, info };
    } catch (error) {
        return { success: false, error: String(error?.message || error || 'Analiz hatasi') };
    }
});

ipcMain.handle('downloader:start', async (_event, options) => {
    try {
        const payload = options && typeof options === 'object' ? options : {};
        const normalizedUrl = normalizeDownloaderUrlForAnalysis(payload.url);
        if (!/^https?:\/\//i.test(normalizedUrl)) {
            return { success: false, error: 'Indirme icin gecerli baglanti yok.' };
        }
        payload.url = normalizedUrl;
        const cookiesFile = await writeDownloaderCookiesFileForUrl(normalizedUrl);
        const job = await getDownloaderService().start({ ...payload, cookiesFile });
        return { success: true, job };
    } catch (error) {
        return { success: false, error: String(error?.message || error || 'Indirme baslatilamadi') };
    }
});

ipcMain.handle('downloader:cancel', async (_event, id) => {
    return getDownloaderService().cancel(String(id || ''));
});

ipcMain.handle('downloader:startCompression', async (_event, options) => {
    try {
        const payload = options && typeof options === 'object' ? options : {};
        const job = await getDownloaderService().startCompression(payload);
        return { success: true, job };
    } catch (error) {
        return { success: false, error: String(error?.message || error || 'Sıkıştırma başlatılamadı') };
    }
});

ipcMain.handle('downloader:cancelCompression', async (_event, id) => {
    return getDownloaderService().cancelCompression(String(id || ''));
});

ipcMain.handle('downloader:getHistory', async () => {
    return getDownloaderService().readHistory();
});

ipcMain.handle('downloader:exportHistory', async (_event, format) => {
    const normalized = String(format || 'json').toLowerCase() === 'csv' ? 'csv' : 'json';
    const targetWindow = downloaderWindow && !downloaderWindow.isDestroyed()
        ? downloaderWindow
        : mainWindow;
    const result = await dialog.showSaveDialog(targetWindow, {
        title: 'İndirme geçmişini dışa aktar',
        defaultPath: `ardali-download-history.${normalized}`,
        filters: [
            normalized === 'csv'
                ? { name: 'CSV', extensions: ['csv'] }
                : { name: 'JSON', extensions: ['json'] }
        ]
    });
    if (result.canceled || !result.filePath) {
        return { canceled: true };
    }
    const contents = await getDownloaderService().exportHistory(normalized);
    await fs.promises.writeFile(result.filePath, contents, 'utf8');
    return { canceled: false, filePath: result.filePath };
});

ipcMain.handle('downloader:clearHistory', async () => {
    await getDownloaderService().clearHistory();
    return true;
});

ipcMain.handle('downloader:removeHistoryItem', async (_event, id) => {
    return getDownloaderService().removeHistoryItem(String(id || ''));
});

ipcMain.handle('downloader:getFileThumbnail', async (_event, filePath) => {
    const target = sanitizeIpcPath(filePath, { requireAbsolute: true });
    if (!target || !fs.existsSync(target)) return '';
    try {
        return await getDownloaderService().getFileThumbnail(target);
    } catch (error) {
        console.warn('[DOWNLOADER] file thumbnail failed:', error?.message || error);
        return '';
    }
});

ipcMain.handle('downloader:showFile', async (_event, filePath) => {
    const target = sanitizeIpcPath(filePath, { requireAbsolute: true });
    if (!target) return false;
    try {
        if (fs.existsSync(target)) {
            shell.showItemInFolder(target);
            return true;
        }
        const parent = path.dirname(target);
        if (fs.existsSync(parent)) {
            await shell.openPath(parent);
            return true;
        }
    } catch (error) {
        console.error('[DOWNLOADER] showFile error:', error);
    }
    return false;
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

ipcMain.handle('media:getDisplayImagePath', async (_event, filePath, options = {}) => {
    try {
        const sourcePath = String(filePath || '').trim();
        if (!sourcePath) return null;
        try {
            await fs.promises.access(sourcePath);
        } catch {
            return null;
        }

        const forceConvert = options?.forceConvert === true;
        const ext = String(path.extname(sourcePath) || '').replace(/^\./, '').toLowerCase();
        const convertibleExts = new Set([
            'heic', 'heif',
            'dng', 'cr2', 'cr3', 'nef', 'nrw', 'arw', 'srf', 'sr2',
            'rw2', 'orf', 'raf', 'pef', 'srw', 'x3f', 'erf', 'kdc',
            'mrw', '3fr', 'fff', 'iiq', 'mos', 'rwl'
        ]);
        const shouldConvert = forceConvert || convertibleExts.has(ext);
        if (!shouldConvert) return sourcePath;

        const stat = await fs.promises.stat(sourcePath);
        const cacheDir = path.join(app.getPath('temp'), 'ardali-image-cache');
        await fs.promises.mkdir(cacheDir, { recursive: true });
        const cacheKey = crypto
            .createHash('sha1')
            .update(`${sourcePath}|${Number(stat.size) || 0}|${Number(stat.mtimeMs) || 0}`)
            .digest('hex');
        const outputPath = path.join(cacheDir, `${cacheKey}.png`);

        try {
            await fs.promises.access(outputPath);
            return outputPath;
        } catch {
            // cache miss
        }

        const converted = await convertStillImageToPngWithFFmpeg(sourcePath, outputPath);
        if (converted) return outputPath;
        return forceConvert ? null : sourcePath;
    } catch (error) {
        console.log('Display image conversion failed:', error?.message || error);
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
        process.env.ARDALI_FFMPEG_PREFER_SYSTEM === '1' ||
        process.env.ARDALI_FFMPEG_PREFER_SYSTEM === 'true';

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

function getFfprobePathForEnv() {
    const candidates = [];
    const preferSystemFirst =
        process.platform !== 'win32' ||
        process.env.ARDALI_FFMPEG_PREFER_SYSTEM === '1' ||
        process.env.ARDALI_FFMPEG_PREFER_SYSTEM === 'true';
    const systemCandidate = findExecutable('ffprobe', ['/usr/bin', '/usr/local/bin', '/bin']);
    if (preferSystemFirst && systemCandidate) candidates.push(systemCandidate);
    if (app.isPackaged) {
        const packed = process.platform === 'win32'
            ? path.join(process.resourcesPath, 'bin', 'ffprobe.exe')
            : path.join(process.resourcesPath, 'bin', 'ffprobe');
        candidates.push(packed);
    }
    if (!preferSystemFirst && systemCandidate) candidates.push(systemCandidate);
    candidates.push('ffprobe');
    for (const candidate of candidates) {
        const value = String(candidate || '').trim();
        if (!value) continue;
        if (value === 'ffprobe') return value;
        try {
            fs.accessSync(value, fs.constants.X_OK);
            return value;
        } catch {
            // sonraki adayı dene
        }
    }
    return 'ffprobe';
}

function parseFfmpegTimeToSeconds(value) {
    const match = String(value || '').trim().match(/^(\d{1,3}):(\d{2}):(\d{2}(?:\.\d+)?)$/);
    if (!match) return 0;
    const hours = Number(match[1]) || 0;
    const minutes = Number(match[2]) || 0;
    const seconds = Number(match[3]) || 0;
    return (hours * 3600) + (minutes * 60) + seconds;
}

function formatSrtTimestamp(totalSeconds) {
    const safeSeconds = Math.max(0, Number(totalSeconds) || 0);
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const seconds = Math.floor(safeSeconds % 60);
    const millis = Math.round((safeSeconds - Math.floor(safeSeconds)) * 1000);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

function parseSrtTimestamp(value) {
    const match = String(value || '').trim().match(/^(\d{2,}):(\d{2}):(\d{2}),(\d{3})$/);
    if (!match) return 0;
    return ((Number(match[1]) || 0) * 3600)
        + ((Number(match[2]) || 0) * 60)
        + (Number(match[3]) || 0)
        + ((Number(match[4]) || 0) / 1000);
}

async function createShiftedSubtitleFile(subtitlePath, delaySeconds) {
    const shift = Number(delaySeconds) || 0;
    if (Math.abs(shift) < 0.001) return subtitlePath;
    const source = await fs.promises.readFile(subtitlePath, 'utf8');
    const shifted = source.replace(
        /(\d{2,}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2,}:\d{2}:\d{2},\d{3})/g,
        (_match, start, end) => `${formatSrtTimestamp(parseSrtTimestamp(start) + shift)} --> ${formatSrtTimestamp(parseSrtTimestamp(end) + shift)}`
    );
    const targetPath = path.join(os.tmpdir(), `ardali-subtitle-${crypto.randomUUID()}.srt`);
    await fs.promises.writeFile(targetPath, shifted, 'utf8');
    return targetPath;
}

function escapeSubtitleFilterPath(filePath) {
    return String(filePath || '')
        .replace(/\\/g, '\\\\')
        .replace(/:/g, '\\:')
        .replace(/'/g, "\\'");
}

function buildVideoToolFfmpegArgs(options = {}) {
    const inputPath = String(options.inputPath || '').trim();
    const outputPath = String(options.outputPath || '').trim();
    const target = String(options.target || 'video').trim().toLowerCase();
    const format = String(options.format || 'mp4').trim().toLowerCase();
    const quality = String(options.quality || 'medium').trim().toLowerCase();
    const qualityMap = {
        low: { crf: 32, audioBitrate: '128k' },
        medium: { crf: 24, audioBitrate: '192k' },
        high: { crf: 18, audioBitrate: '256k' }
    };
    const profile = qualityMap[quality] || qualityMap.medium;
    const base = ['-y', '-hide_banner', '-i', inputPath];

    const appendH264OutputArgs = (args) => {
        args.push(
            '-c:v', 'libx264',
            '-preset', 'medium',
            '-crf', String(profile.crf)
        );
        return args;
    };

    const appendVideoContainerArgs = (args, includeAudio = true) => {
        if (format === 'webm') {
            args.push(
                '-c:v', 'libvpx-vp9',
                '-crf', String(Math.min(38, profile.crf + 5)),
                '-b:v', '0'
            );
            if (includeAudio) args.push('-c:a', 'libopus', '-b:a', profile.audioBitrate);
        } else {
            appendH264OutputArgs(args);
            if (includeAudio) args.push('-c:a', 'aac', '-b:a', profile.audioBitrate);
            if (format === 'mp4' || format === 'mov') {
                args.push('-movflags', '+faststart');
            }
        }
        return args;
    };

    if (target === 'thumbnail') {
        const thumbnail = options.thumbnail && typeof options.thumbnail === 'object' ? options.thumbnail : {};
        const atSeconds = Math.max(0, Number(thumbnail.atSeconds) || 0);
        const width = Math.max(0, Math.min(3840, Number(thumbnail.width) || 0));
        const imageFormat = ['jpg', 'jpeg', 'png', 'webp'].includes(format) ? format : 'jpg';
        const args = ['-y', '-hide_banner'];
        if (atSeconds > 0) args.push('-ss', String(atSeconds));
        args.push('-i', inputPath, '-frames:v', '1');
        if (width > 0) args.push('-vf', `scale=${width}:-2`);
        if (imageFormat === 'jpg' || imageFormat === 'jpeg') {
            args.push('-q:v', '2', '-update', '1');
        } else if (imageFormat === 'png') {
            args.push('-update', '1');
        } else if (imageFormat === 'webp') {
            args.push('-quality', '92');
        }
        args.push(outputPath);
        return args;
    }

    if (target === 'enhance') {
        const enhance = options.enhance && typeof options.enhance === 'object' ? options.enhance : {};
        const brightness = Math.max(-0.5, Math.min(0.5, Number(enhance.brightness) || 0));
        const contrast = Math.max(0.5, Math.min(2, Number(enhance.contrast) || 1));
        const saturation = Math.max(0, Math.min(3, Number(enhance.saturation) || 1));
        const sharpness = Math.max(0, Math.min(2, Number(enhance.sharpness) || 0));
        const filters = [
            `eq=brightness=${brightness.toFixed(3)}:contrast=${contrast.toFixed(3)}:saturation=${saturation.toFixed(3)}`
        ];
        if (enhance.denoise === true) filters.push('hqdn3d=1.5:1.5:6:6');
        if (sharpness > 0.001) {
            const amount = (sharpness * 0.75).toFixed(3);
            filters.push(`unsharp=5:5:${amount}:3:3:${(sharpness * 0.35).toFixed(3)}`);
        }

        const args = ['-y', '-hide_banner', '-i', inputPath, '-map', '0:v:0', '-map', '0:a:0?'];
        args.push('-vf', filters.join(','));
        appendVideoContainerArgs(args, true);
        if (enhance.normalizeAudio === true) {
            args.push('-af', 'loudnorm=I=-16:TP=-1.5:LRA=11');
        }
        args.push(outputPath);
        return args;
    }

    if (target === 'edit') {
        const edit = options.edit && typeof options.edit === 'object' ? options.edit : {};
        const startSeconds = Math.max(0, Number(edit.startSeconds) || 0);
        const endSeconds = Math.max(0, Number(edit.endSeconds) || 0);
        const durationSeconds = endSeconds > startSeconds ? endSeconds - startSeconds : 0;
        const speed = Math.max(0.25, Math.min(4, Number(edit.speed) || 1));
        const rotate = String(edit.rotate || 'none').trim().toLowerCase();
        const filters = [];

        if (rotate === '90') filters.push('transpose=1');
        if (rotate === '270') filters.push('transpose=2');
        if (rotate === '180') filters.push('transpose=1,transpose=1');
        if (edit.flipH === true) filters.push('hflip');
        if (edit.flipV === true) filters.push('vflip');
        if (Math.abs(speed - 1) > 0.001) filters.push(`setpts=${(1 / speed).toFixed(6)}*PTS`);

        const args = ['-y', '-hide_banner'];
        if (startSeconds > 0) args.push('-ss', String(startSeconds));
        args.push('-i', inputPath);
        if (durationSeconds > 0) args.push('-t', String(durationSeconds));
        args.push('-map', '0:v:0');
        if (edit.mute === true) {
            args.push('-an');
        } else {
            args.push('-map', '0:a:0?');
        }
        if (filters.length) args.push('-vf', filters.join(','));
        appendVideoContainerArgs(args, edit.mute !== true);
        if (edit.mute !== true && Math.abs(speed - 1) > 0.001) {
            args.push('-filter:a', `atempo=${speed.toFixed(3)}`);
        }
        args.push(outputPath);
        return args;
    }

    if (target === 'subtitle') {
        const subtitle = options.subtitle && typeof options.subtitle === 'object' ? options.subtitle : {};
        const subtitlePath = String(subtitle.path || '').trim();
        const subtitleMode = String(subtitle.mode || 'burn').trim().toLowerCase() === 'selectable' ? 'selectable' : 'burn';
        const delaySeconds = Number(subtitle.delaySeconds) || 0;

        if (subtitleMode === 'selectable') {
            const args = ['-y', '-hide_banner', '-i', inputPath];
            if (Math.abs(delaySeconds) > 0.001) args.push('-itsoffset', String(delaySeconds));
            args.push('-i', subtitlePath, '-map', '0:v:0', '-map', '0:a:0?', '-map', '1:0');
            appendVideoContainerArgs(args);
            args.push('-c:s', (format === 'mp4' || format === 'mov') ? 'mov_text' : 'srt');
            args.push(outputPath);
            return args;
        }

        const args = ['-y', '-hide_banner', '-i', inputPath, '-map', '0:v:0', '-map', '0:a:0?'];
        args.push('-vf', `subtitles='${escapeSubtitleFilterPath(subtitlePath)}'`);
        appendVideoContainerArgs(args);
        args.push(outputPath);
        return args;
    }

    if (target === 'audio') {
        if (format === 'wav') {
            return base.concat(['-vn', '-map', '0:a:0?', '-c:a', 'pcm_s16le', outputPath]);
        }
        return base.concat(['-vn', '-map', '0:a:0?', '-c:a', 'libmp3lame', '-b:a', profile.audioBitrate, outputPath]);
    }

    if (format === 'webm') {
        return base.concat([
            '-map', '0:v:0',
            '-map', '0:a:0?',
            '-c:v', 'libvpx-vp9',
            '-crf', String(Math.min(38, profile.crf + 5)),
            '-b:v', '0',
            '-c:a', 'libopus',
            '-b:a', profile.audioBitrate,
            outputPath
        ]);
    }

    const args = base.concat([
        '-map', '0:v:0',
        '-map', '0:a:0?'
    ]);
    appendVideoContainerArgs(args);
    args.push(outputPath);
    return args;
}

ipcMain.handle('videoTools:convert', async (event, options = {}) => {
    const inputPath = String(options?.inputPath || '').trim();
    const outputPath = String(options?.outputPath || '').trim();
    const jobId = String(options?.jobId || crypto.randomUUID()).trim();
    const target = String(options?.target || 'video').trim().toLowerCase();
    const format = String(options?.format || (target === 'audio' ? 'mp3' : 'mp4')).trim().toLowerCase();
    const allowedVideoFormats = new Set(['mp4', 'webm', 'mkv', 'mov']);
    const allowedAudioFormats = new Set(['mp3', 'wav']);
    const allowedImageFormats = new Set(['jpg', 'jpeg', 'png', 'webp']);

    const sendProgress = (payload) => {
        try {
            event.sender.send('videoTools:progress', { jobId, ...payload });
        } catch {
            // yoksay
        }
    };

    if (!inputPath || !outputPath) {
        return { ok: false, error: 'Eksik dosya yolu.' };
    }
    if (target !== 'video' && target !== 'audio' && target !== 'edit' && target !== 'subtitle' && target !== 'thumbnail' && target !== 'enhance') {
        return { ok: false, error: 'Geçersiz işlem türü.' };
    }
    if (((target === 'video' || target === 'edit' || target === 'subtitle' || target === 'enhance') && !allowedVideoFormats.has(format))
        || (target === 'audio' && !allowedAudioFormats.has(format))
        || (target === 'thumbnail' && !allowedImageFormats.has(format))) {
        return { ok: false, error: 'Desteklenmeyen çıktı formatı.' };
    }

    let originalSubtitlePath = '';
    let shiftedSubtitlePath = '';
    try {
        const inputStat = await fs.promises.stat(inputPath);
        if (!inputStat.isFile()) return { ok: false, error: 'Kaynak bir dosya değil.' };
        if (target === 'subtitle') {
            const subtitle = options?.subtitle && typeof options.subtitle === 'object' ? options.subtitle : {};
            const subtitlePath = String(subtitle.path || '').trim();
            originalSubtitlePath = subtitlePath;
            if (!subtitlePath) return { ok: false, error: 'Altyazı dosyası seçilmedi.' };
            const subtitleStat = await fs.promises.stat(subtitlePath);
            if (!subtitleStat.isFile()) return { ok: false, error: 'Altyazı yolu bir dosya değil.' };
            if (!/\.srt$/i.test(subtitlePath)) return { ok: false, error: 'Şimdilik yalnızca .srt altyazı destekleniyor.' };
            shiftedSubtitlePath = await createShiftedSubtitleFile(subtitlePath, Number(subtitle.delaySeconds) || 0);
            options = {
                ...options,
                subtitle: {
                    ...subtitle,
                    path: shiftedSubtitlePath
                }
            };
        }
        await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
    } catch (error) {
        return { ok: false, error: error?.message || String(error) };
    }

    const ffmpegPath = getFfmpegPathForEnv();
    const args = buildVideoToolFfmpegArgs({ ...options, target, format, inputPath, outputPath });

    return await new Promise((resolve) => {
        let stderrBuffer = '';
        let durationSeconds = 0;
        let settled = false;

        const finish = (result) => {
            if (settled) return;
            settled = true;
            resolve(result);
        };

        sendProgress({ status: 'running', percent: 0, message: 'FFmpeg başlatıldı.' });

        let child = null;
        try {
            child = spawn(ffmpegPath, args, { windowsHide: true });
        } catch (error) {
            finish({ ok: false, error: error?.message || String(error) });
            return;
        }

        child.stderr.on('data', (chunk) => {
            const text = String(chunk || '');
            stderrBuffer += text;
            if (stderrBuffer.length > 12000) stderrBuffer = stderrBuffer.slice(-12000);

            const durationMatch = text.match(/Duration:\s*(\d{2}:\d{2}:\d{2}(?:\.\d+)?)/);
            if (durationMatch) durationSeconds = parseFfmpegTimeToSeconds(durationMatch[1]);

            const timeMatches = Array.from(text.matchAll(/time=(\d{2}:\d{2}:\d{2}(?:\.\d+)?)/g));
            const latestTime = timeMatches.length ? timeMatches[timeMatches.length - 1][1] : '';
            if (latestTime && durationSeconds > 0) {
                const currentSeconds = parseFfmpegTimeToSeconds(latestTime);
                const percent = Math.max(1, Math.min(99, Math.round((currentSeconds / durationSeconds) * 100)));
                sendProgress({ status: 'running', percent, message: `${percent}%` });
            }
        });

        child.on('error', (error) => {
            sendProgress({ status: 'error', percent: 0, message: error?.message || String(error) });
            finish({ ok: false, error: error?.message || String(error) });
        });

        child.on('close', (code) => {
            if (shiftedSubtitlePath && originalSubtitlePath && shiftedSubtitlePath !== originalSubtitlePath) {
                fs.promises.unlink(shiftedSubtitlePath).catch(() => {});
            }
            if (code === 0) {
                sendProgress({ status: 'done', percent: 100, message: 'Tamamlandı.' });
                finish({ ok: true, path: outputPath, name: path.basename(outputPath) });
                return;
            }
            const lastLine = stderrBuffer
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean)
                .slice(-1)[0] || `ffmpeg exited with code ${code}`;
            sendProgress({ status: 'error', percent: 0, message: lastLine });
            finish({ ok: false, error: lastLine });
        });
    });
});

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

async function collectAudioFilesRecursive(rootDir, out = [], excludedPaths = [], audioExtensions = [], diagnostics = null, recursive = true) {
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
                if (recursive && !isPathExcluded(fullPath, excludedPaths)) {
                    await collectAudioFilesRecursive(fullPath, out, excludedPaths, audioExtensions, diagnostics, recursive);
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
    const scanSubfolders = performanceOptions?.scanSubfolders !== false;
    const diagnostics = {
        scanErrors: [],
        unreadableFiles: []
    };

    const allFiles = [];
    for (const folder of normalizedFolders) {
        await collectAudioFilesRecursive(folder.path, allFiles, excludedPaths, audioExtensions, diagnostics, scanSubfolders);
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
    const scanSubfolders = performanceOptions?.scanSubfolders !== false;
    const diagnostics = {
        scanErrors: [],
        unreadableFiles: []
    };
    const allFiles = [];
    for (const folder of normalizedFolders) {
        await collectAudioFilesRecursive(folder.path, allFiles, excludedPaths, audioExtensions, diagnostics, scanSubfolders);
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
    const scanSubfolders = performanceOptions?.scanSubfolders !== false;
    const allFiles = [];
    for (const folder of normalizedFolders) {
        await collectAudioFilesRecursive(folder.path, allFiles, excludedPaths, audioExtensions, diagnostics, scanSubfolders);
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

        // 2) M4A/MP4 içindeki covr atomunu doğrudan oku. Böylece ffmpeg olmayan
        // ortamlarda da Apple/MP4 kapakları kaybolmaz.
        const mp4Cover = await extractMp4Cover(filePath);
        if (mp4Cover) return mp4Cover;

        // 3) ffmpeg ile attached picture dene (m4a/mp3/flac dahil)
        const ffmpegCover = await extractCoverWithFFmpeg(filePath);
        if (ffmpegCover) return ffmpegCover;

        // 4) Son çare: manuel ID3 okuma
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

function readMp4AtomHeader(buffer, offset, end) {
    if (!Buffer.isBuffer(buffer) || offset + 8 > end) return null;
    let size = buffer.readUInt32BE(offset);
    const type = buffer.slice(offset + 4, offset + 8).toString('latin1');
    let headerSize = 8;

    if (size === 1) {
        if (offset + 16 > end) return null;
        const largeSize = buffer.readBigUInt64BE(offset + 8);
        if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) return null;
        size = Number(largeSize);
        headerSize = 16;
    } else if (size === 0) {
        size = end - offset;
    }

    if (!Number.isFinite(size) || size < headerSize || offset + size > end) return null;
    return {
        type,
        start: offset,
        end: offset + size,
        payloadStart: offset + headerSize
    };
}

function findMp4CoverDataAtom(buffer, start = 0, end = buffer?.length || 0, depth = 0) {
    if (!Buffer.isBuffer(buffer) || depth > 12) return null;

    let offset = Math.max(0, start);
    const limit = Math.min(Number(end) || 0, buffer.length);
    while (offset + 8 <= limit) {
        const atom = readMp4AtomHeader(buffer, offset, limit);
        if (!atom) break;

        if (atom.type === 'covr') {
            const found = findMp4CoverDataAtom(buffer, atom.payloadStart, atom.end, depth + 1);
            if (found) return found;
        } else if (atom.type === 'data') {
            return atom;
        } else if (['moov', 'udta', 'ilst', 'trak', 'mdia', 'minf', 'stbl'].includes(atom.type)) {
            const found = findMp4CoverDataAtom(buffer, atom.payloadStart, atom.end, depth + 1);
            if (found) return found;
        } else if (atom.type === 'meta') {
            const found = findMp4CoverDataAtom(buffer, atom.payloadStart + 4, atom.end, depth + 1);
            if (found) return found;
        }

        offset = atom.end;
    }

    return null;
}

async function extractMp4Cover(filePath) {
    try {
        const ext = path.extname(String(filePath || '')).toLowerCase();
        if (!['.m4a', '.mp4', '.m4b', '.m4p', '.aac'].includes(ext)) return null;

        const buffer = await fs.promises.readFile(filePath);
        const dataAtom = findMp4CoverDataAtom(buffer, 0, buffer.length, 0);
        if (!dataAtom) return null;

        const imageStart = dataAtom.payloadStart + 8;
        if (imageStart >= dataAtom.end) return null;

        const dataType = dataAtom.payloadStart + 4 <= dataAtom.end
            ? buffer.readUInt32BE(dataAtom.payloadStart)
            : 0;
        const imageBuffer = buffer.slice(imageStart, dataAtom.end);
        if (imageBuffer.length <= 100) return null;

        const isPng = imageBuffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
        const isJpeg = imageBuffer.slice(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
        const mimeType = (dataType === 14 || isPng) ? 'image/png' : ((dataType === 13 || isJpeg) ? 'image/jpeg' : 'image/jpeg');

        return toImageDataUrl(imageBuffer, mimeType);
    } catch (error) {
        console.log('MP4/M4A cover extraction failed:', error?.message || error);
        return null;
    }
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

async function convertStillImageToPngWithFFmpeg(sourcePath, outputPath) {
    return await new Promise((resolve) => {
        const ffmpegPath = getFfmpegPathForEnv();
        if (app.isPackaged && process.platform === 'win32' && !fs.existsSync(ffmpegPath)) {
            resolve(false);
            return;
        }
        if (process.platform === 'win32') {
            try {
                prependToProcessPath(path.dirname(ffmpegPath));
            } catch {
                // yoksay
            }
        }

        const ffmpeg = spawn(ffmpegPath, [
            '-y',
            '-hide_banner',
            '-loglevel', 'error',
            '-i', sourcePath,
            '-map', '0:v:0',
            '-frames:v', '1',
            '-f', 'image2',
            '-vcodec', 'png',
            outputPath
        ], { windowsHide: true });

        let done = false;
        const finish = (ok) => {
            if (done) return;
            done = true;
            resolve(!!ok);
        };

        const timeout = setTimeout(() => {
            try { ffmpeg.kill('SIGTERM'); } catch { }
            finish(false);
        }, 15000);

        ffmpeg.on('close', (code) => {
            clearTimeout(timeout);
            finish(code === 0 && fs.existsSync(outputPath));
        });
        ffmpeg.on('error', () => {
            clearTimeout(timeout);
            finish(false);
        });
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
        applyPersistedMusicSfxFromSettings().catch(() => { /* yoksay */ });
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
        applyPersistedMusicSfxFromSettings().catch(() => { /* yoksay */ });
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
        applyPersistedAudiophileSfxFromSettings().catch(() => { /* yoksay */ });
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

// Bass ayarla (ArDali Module)
ipcMain.handle('audio:setBass', (event, dB) => {
    try {
        if (!audioEngine || !isNativeAudioAvailable) return { success: false, error: 'Native audio yok' };
        audioEngine.setBass(dB);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Mid ayarla (ArDali Module)
ipcMain.handle('audio:setMid', (event, dB) => {
    try {
        if (!audioEngine || !isNativeAudioAvailable) return { success: false, error: 'Native audio yok' };
        audioEngine.setMid(dB);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Treble ayarla (ArDali Module)
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

const AUDIO_ENGINE_FIXED_SAMPLE_RATE = 44100;
let audioOutputProfileState = {
    requestedExclusive: false,
    requestedSampleRate: 'auto',
    requestedDeviceId: 'default',
    appliedDeviceId: 'default',
    deviceSwitchOk: true,
    deviceSwitchError: '',
    lastUpdatedAt: 0
};

function parseAudioDevicesRaw(raw) {
    try {
        if (Array.isArray(raw)) return raw;
        if (typeof raw === 'string') {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        }
        if (raw && typeof raw === 'object' && Array.isArray(raw.devices)) {
            return raw.devices;
        }
    } catch {
        // yoksay
    }
    return [];
}

function normalizeOutputSampleRate(requested) {
    const raw = String(requested ?? 'auto').trim().toLowerCase();
    if (!raw || raw === 'auto') return 'auto';
    const n = Number(raw);
    const allowed = new Set([44100, 48000, 88200, 96000, 176400, 192000]);
    if (!Number.isFinite(n) || !allowed.has(Math.round(n))) return 'auto';
    return Math.round(n);
}

function inferDeviceOutputCapabilities(device = {}) {
    const hay = `${device?.name || ''} ${device?.driver || ''}`.toLowerCase();
    const isBluetooth = /(bluetooth|a2dp|sco|handsfree)/.test(hay);
    const isHdmiLike = /(hdmi|displayport|dp-|spdif|digital)/.test(hay);
    const isPremiumPath = /(asio|wasapi|coreaudio|alsa|usb|dac)/.test(hay);
    const isSharedOnlyLike = /(directsound|mme|pulse|pipewire|dmix)/.test(hay);

    let supportedSampleRates = [44100, 48000];
    if (isPremiumPath || isHdmiLike) {
        supportedSampleRates = [44100, 48000, 96000, 192000];
    }
    if (isBluetooth) {
        supportedSampleRates = [44100, 48000];
    }

    // Bu sürümde native motor sabit 44.1kHz çalışır; yüksek oranlar donanım önerisi olarak raporlanır.
    const engineSupportedSampleRates = [AUDIO_ENGINE_FIXED_SAMPLE_RATE];
    const exclusiveCapableHint = isPremiumPath && !isSharedOnlyLike;
    return {
        supportedSampleRates,
        engineSupportedSampleRates,
        exclusiveCapableHint
    };
}

function listAudioDevicesWithCapabilities() {
    if (typeof initNativeAudioEngineSafe === 'function') initNativeAudioEngineSafe();
    if (!audioEngine || !isNativeAudioAvailable || typeof audioEngine.getAudioDevices !== 'function') return [];
    const raw = audioEngine.getAudioDevices();
    const parsed = parseAudioDevicesRaw(raw);
    return parsed.map((dev) => ({
        ...dev,
        ...inferDeviceOutputCapabilities(dev)
    }));
}

function getFallbackAudioDeviceId() {
    const devices = listAudioDevicesWithCapabilities();
    const selected = devices.find((d) => d?.isDefault) || devices[0] || null;
    const id = Number(selected?.id);
    return Number.isFinite(id) && id > 0 ? id : null;
}

function buildAudioPathQuality(status = {}) {
    if (!status.nativeAvailable) {
        return {
            score: 20,
            tier: 'basic',
            label: 'Uyumluluk Modu',
            detail: 'Native ses motoru aktif değil; web/uyumluluk çıkışı kullanılıyor.',
            bitPerfectLikely: false
        };
    }

    let score = 58;
    if (status.deviceSwitchOk && String(status.appliedDeviceId || 'default') !== 'default') score += 8;
    if (status.requestedSampleRate === 'auto' || Number(status.requestedSampleRate) === AUDIO_ENGINE_FIXED_SAMPLE_RATE) score += 10;
    if (status.resamplingActive) score -= 15;

    if (status.exclusiveRequested && status.exclusiveActive) score += 20;
    if (status.exclusiveRequested && !status.exclusiveActive) score -= 8;

    score = Math.max(0, Math.min(100, Math.round(score)));

    let tier = 'basic';
    let label = 'Uyumluluk';
    if (score >= 85) { tier = 'reference'; label = 'Referans Yol'; }
    else if (score >= 70) { tier = 'high'; label = 'Yüksek Sadakat'; }
    else if (score >= 55) { tier = 'balanced'; label = 'Dengeli'; }

    const bitPerfectLikely = !!(
        status.nativeAvailable &&
        !status.resamplingActive &&
        (status.requestedSampleRate === 'auto' || Number(status.requestedSampleRate) === AUDIO_ENGINE_FIXED_SAMPLE_RATE) &&
        (!status.exclusiveRequested || status.exclusiveActive)
    );

    let detail = 'Paylaşımlı çıkış yolu aktif.';
    if (status.exclusiveRequested && !status.exclusiveActive) {
        detail = status.exclusiveFailureReason || 'Exclusive kilit alınamadı, paylaşımlı moda dönüldü.';
    } else if (bitPerfectLikely) {
        detail = 'Bit-perfect olasılığı yüksek (motor sabit 44.1kHz).';
    } else if (status.resamplingActive) {
        detail = 'İstenen örnekleme oranı motor tarafından yeniden örnekleniyor.';
    }

    return { score, tier, label, detail, bitPerfectLikely };
}

function buildOutputProfileStatus() {
    const nativeAvailable = !!(audioEngine && isNativeAudioAvailable);
    const devices = listAudioDevicesWithCapabilities();
    const selected = devices.find((d) => String(d?.id) === String(audioOutputProfileState.appliedDeviceId))
        || devices.find((d) => d?.isDefault)
        || null;

    const engineExclusiveSupported = false;
    const exclusiveRequested = audioOutputProfileState.requestedExclusive === true;
    const exclusiveActive = false;
    const exclusiveFailureReason = exclusiveRequested && !exclusiveActive
        ? 'Bu sürümde native motor (BASS) gerçek exclusive device lock sunmuyor.'
        : '';

    const requestedSampleRate = audioOutputProfileState.requestedSampleRate;
    const effectiveSampleRate = nativeAvailable ? AUDIO_ENGINE_FIXED_SAMPLE_RATE : 0;
    const resamplingActive = nativeAvailable
        && requestedSampleRate !== 'auto'
        && Number(requestedSampleRate) !== AUDIO_ENGINE_FIXED_SAMPLE_RATE;

    const status = {
        nativeAvailable,
        backend: nativeAvailable ? 'bass-native' : 'web-fallback',
        requestedExclusive: exclusiveRequested,
        engineExclusiveSupported,
        deviceExclusiveCapableHint: !!selected?.exclusiveCapableHint,
        exclusiveActive,
        exclusiveFailureReason,
        requestedSampleRate,
        effectiveSampleRate,
        resamplingActive,
        requestedDeviceId: audioOutputProfileState.requestedDeviceId,
        appliedDeviceId: audioOutputProfileState.appliedDeviceId,
        deviceSwitchOk: audioOutputProfileState.deviceSwitchOk,
        deviceSwitchError: audioOutputProfileState.deviceSwitchError || '',
        selectedDevice: selected,
        devices,
        lastUpdatedAt: audioOutputProfileState.lastUpdatedAt || Date.now()
    };

    status.quality = buildAudioPathQuality(status);
    return status;
}

ipcMain.handle('audio:getOutputProfileStatus', () => {
    return buildOutputProfileStatus();
});

ipcMain.handle('audio:configureOutputProfile', (_event, payload = {}) => {
    const requestedExclusive = payload?.exclusiveMode === true;
    const requestedSampleRate = normalizeOutputSampleRate(payload?.sampleRate);
    const requestedDeviceIdRaw = String(payload?.outputDevice ?? 'default').trim();
    const requestedDeviceId = requestedDeviceIdRaw || 'default';

    let deviceSwitchOk = true;
    let deviceSwitchError = '';
    let appliedDeviceId = requestedDeviceId;

    if (typeof initNativeAudioEngineSafe === 'function') initNativeAudioEngineSafe();
    if (audioEngine && isNativeAudioAvailable && typeof audioEngine.setAudioDevice === 'function') {
        if (requestedDeviceId !== 'default') {
            const parsedId = Number(requestedDeviceId);
            if (Number.isFinite(parsedId)) {
                try {
                    const ok = audioEngine.setAudioDevice(parsedId);
                    deviceSwitchOk = !!ok;
                    if (!ok) deviceSwitchError = 'Çıkış cihazı değiştirilemedi.';
                    if (ok) appliedDeviceId = String(parsedId);
                } catch (error) {
                    deviceSwitchOk = false;
                    deviceSwitchError = String(error?.message || error || 'Çıkış cihazı hatası');
                }
                if (!deviceSwitchOk) {
                    try {
                        const fallbackDeviceId = getFallbackAudioDeviceId();
                        const fallbackOk = fallbackDeviceId !== null && audioEngine.setAudioDevice(fallbackDeviceId);
                        if (fallbackOk) {
                            appliedDeviceId = String(fallbackDeviceId);
                            console.warn('[AUDIO] Requested output device failed; fell back to active default device.');
                        }
                    } catch (fallbackError) {
                        console.warn('[AUDIO] Output fallback failed:', fallbackError?.message || fallbackError);
                    }
                }
            } else {
                deviceSwitchOk = false;
                deviceSwitchError = 'Geçersiz çıkış cihazı.';
            }
        }
    } else if (requestedDeviceId !== 'default') {
        deviceSwitchOk = false;
        deviceSwitchError = 'Native ses motoru hazır değil.';
    }

    audioOutputProfileState = {
        requestedExclusive,
        requestedSampleRate,
        requestedDeviceId,
        appliedDeviceId,
        deviceSwitchOk,
        deviceSwitchError,
        lastUpdatedAt: Date.now()
    };
    return buildOutputProfileStatus();
});

// Hardware Device Control
ipcMain.handle('audio:getDevices', (event) => {
    return JSON.stringify(listAudioDevicesWithCapabilities());
});

ipcMain.handle('audio:setDevice', (event, deviceId) => {
    if (!audioEngine || !isNativeAudioAvailable) return false;
    if (typeof audioEngine.setAudioDevice === 'function') {
        let ok = audioEngine.setAudioDevice(deviceId);
        let appliedDeviceId = String(deviceId ?? 'default');
        if (!ok && String(deviceId ?? 'default') !== 'default') {
            try {
                const fallbackDeviceId = getFallbackAudioDeviceId();
                const fallbackOk = fallbackDeviceId !== null && audioEngine.setAudioDevice(fallbackDeviceId);
                if (fallbackOk) {
                    ok = true;
                    appliedDeviceId = String(fallbackDeviceId);
                    console.warn('[AUDIO] setDevice failed; fell back to active default device.');
                }
            } catch (fallbackError) {
                console.warn('[AUDIO] setDevice fallback failed:', fallbackError?.message || fallbackError);
            }
        }
        audioOutputProfileState.appliedDeviceId = appliedDeviceId;
        audioOutputProfileState.requestedDeviceId = ok ? appliedDeviceId : String(deviceId ?? 'default');
        audioOutputProfileState.deviceSwitchOk = !!ok;
        audioOutputProfileState.deviceSwitchError = ok ? '' : 'Çıkış cihazı değiştirilemedi.';
        audioOutputProfileState.lastUpdatedAt = Date.now();
        return ok;
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

function loadArDaliEQBuiltins() {
    // JSON ile ayarlanabilir (ince ayar için)
    const filePath = getAppFilePath(path.join('resources', 'ardali', 'eq_presets.json'));
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
                category: 'ArDali',
                preamp: Number.isFinite(p.preamp) ? p.preamp : 0,
                bands
            };

            map[String(p.id)] = entry;
            list.push({ filename: String(p.id), name: entry.name, description: entry.description, bands: entry.bands });
        }

        return { map, list };
    } catch (e) {
        console.warn('[ArDali EQ] resources/ardali/eq_presets.json okunamadı:', e?.message || e);
        return { map: {}, list: [] };
    }
}

const ARDALI_EQ_BUILTINS_LOADED = loadArDaliEQBuiltins();
const ARDALI_EQ_BUILTINS = ARDALI_EQ_BUILTINS_LOADED.map;
const ARDALI_EQ_FEATURED_LIST = [
    { filename: '__flat__', name: 'Düz (Flat)', description: 'Tüm bantlar 0.0 dB', bands: new Array(32).fill(0) },
    ...ARDALI_EQ_BUILTINS_LOADED.list
];

function sanitizePresetFilename(filename) {
    const raw = String(filename || '').trim();
    if (!raw || raw.includes('/') || raw.includes('\\') || raw.includes('\0')) return '';
    if (raw === '.' || raw === '..' || raw.includes('..')) return '';
    if (!/^[A-Za-z0-9][A-Za-z0-9._(),+\-\s]*\.json$/u.test(raw)) return '';
    return raw;
}

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
        const safeFilename = sanitizePresetFilename(filename);
        if (!safeFilename) {
            return null;
        }
        const filePath = path.join(presetsPath, safeFilename);
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
        const requested = String(filename || '').trim();
        if (!requested) return null;

        let preset = null;
        let selectedFilename = requested;

        if (requested === '__flat__') {
            preset = {
                name: 'Düz (Flat)',
                description: 'Tüm bantlar 0.0 dB',
                category: 'ArDali',
                preamp: 0,
                bands: new Array(32).fill(0)
            };
        } else if (Object.prototype.hasOwnProperty.call(ARDALI_EQ_BUILTINS, requested)) {
            preset = ARDALI_EQ_BUILTINS[requested];
        } else {
            const safeFilename = sanitizePresetFilename(requested);
            if (!safeFilename) {
                return null;
            }
            selectedFilename = safeFilename;
            const filePath = path.join(presetsPath, safeFilename);
            const data = await fs.promises.readFile(filePath, 'utf8');
            preset = JSON.parse(data);
        }

        const payload = {
            filename: selectedFilename,
            preset
        };

        // Kalıcı olarak kaydet (tek kaynak: settings.json)
        const bands = normalizeEq32BandsForEngine(preset?.bands);
        const presetName = preset?.name || (selectedFilename === '__flat__' ? 'Düz (Flat)' : String(selectedFilename || ''));

        await updateEq32SettingsInFile({
            bands,
            lastPreset: {
                filename: selectedFilename,
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
