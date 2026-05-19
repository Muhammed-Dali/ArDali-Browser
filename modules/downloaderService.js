const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');

const CONFIG_NAME = 'ardali-downloader.json';
const HISTORY_NAME = 'ardali-download-history.json';
const YTDLP_LATEST_BASE_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download';
const WINDOWS_FFMPEG_ZIP_URL = 'https://github.com/aandrew-me/ffmpeg-builds/releases/download/v8/ffmpeg_win64.zip';

function spawnLowPriority(command, args = [], options = {}, niceValue = 10) {
    if ((process.platform === 'linux' || process.platform === 'darwin') && command) {
        return spawn('nice', ['-n', String(niceValue), command, ...args], {
            ...options,
            shell: false
        });
    }
    return spawn(command, args, options);
}

function getManagedBinDir(app) {
    try {
        return path.join(app.getPath('userData'), 'downloader-bin');
    } catch {
        return path.join(os.homedir(), '.ardali-dawlod');
    }
}

function getManagedYtDlpPath(app) {
    return path.join(getManagedBinDir(app), process.platform === 'win32' ? 'ytdlp.exe' : 'ytdlp');
}

function getManagedFfmpegPath(app) {
    return path.join(getManagedBinDir(app), process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
}

function resolveYtDlpBinary(app) {
    try {
        const result = spawnSync('which', ['yt-dlp'], {
            encoding: 'utf8',
            timeout: 1200,
            shell: false
        });
        if (result.status === 0) {
            const binary = String(result.stdout || '').trim().split(/\r?\n/)[0];
            if (binary) return binary;
        }
    } catch {
        // fall through to local candidates
    }

    const localName = process.platform === 'win32' ? 'ytdlp.exe' : 'ytdlp';
    const candidates = [
        process.env.ARDALI_YTDLP_PATH,
        process.env.YTDOWNLOADER_YTDLP_PATH,
        app ? getManagedYtDlpPath(app) : '',
        path.join(os.homedir(), '.ardali-dawlod', localName),
        path.join(os.homedir(), '.ardali-dawlod', 'yt-dlp')
    ].filter(Boolean);

    for (const candidate of candidates) {
        try {
            fs.accessSync(candidate, fs.constants.X_OK);
            return candidate;
        } catch {
            // keep looking
        }
    }

    return '';
}

function resolveFfmpegBinary(app) {
    const envCandidate = process.env.ARDALI_FFMPEG_PATH || process.env.FFMPEG_PATH;
    const candidates = [
        envCandidate,
        app ? getManagedFfmpegPath(app) : '',
        path.join(__dirname, '..', 'third_party', 'ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
        path.join(__dirname, '..', 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
        path.join(process.resourcesPath || '', 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
        path.join(process.resourcesPath || '', 'app.asar.unpacked', 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
        path.join(os.homedir(), '.ardali-dawlod', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
        process.platform === 'win32' ? '' : '/usr/bin/ffmpeg',
        process.platform === 'win32' ? '' : '/usr/local/bin/ffmpeg'
    ].filter(Boolean);

    try {
        const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['ffmpeg'], {
            encoding: 'utf8',
            timeout: 1200,
            shell: false
        });
        if (result.status === 0) {
            const binary = String(result.stdout || '').trim().split(/\r?\n/)[0];
            if (binary) candidates.unshift(binary);
        }
    } catch {
        // fall through to explicit candidates
    }

    for (const candidate of candidates) {
        try {
            fs.accessSync(candidate, fs.constants.X_OK);
            return candidate;
        } catch {
            // keep looking
        }
    }

    return '';
}

function getYtDlpDownloadUrl() {
    if (process.platform === 'win32') return `${YTDLP_LATEST_BASE_URL}/yt-dlp.exe`;
    if (process.platform === 'darwin') return `${YTDLP_LATEST_BASE_URL}/yt-dlp_macos`;
    if (process.platform === 'linux') {
        const arch = os.arch();
        if (arch === 'arm64') return `${YTDLP_LATEST_BASE_URL}/yt-dlp_linux_aarch64`;
        if (arch === 'arm') return `${YTDLP_LATEST_BASE_URL}/yt-dlp_linux_armv7l`;
        return `${YTDLP_LATEST_BASE_URL}/yt-dlp_linux`;
    }
    return `${YTDLP_LATEST_BASE_URL}/yt-dlp`;
}

function getLinuxFfmpegArchiveUrl() {
    if (process.platform !== 'linux') return '';
    const arch = os.arch();
    if (arch === 'x64') return 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz';
    if (arch === 'arm64') return 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz';
    return '';
}

function emitDependencyStatus(emit, tool, state, message, percent = 0) {
    if (typeof emit !== 'function') return;
    emit({
        id: `dependency-${tool}`,
        state,
        title: tool === 'ffmpeg' ? 'FFmpeg' : 'yt-dlp',
        percent,
        message,
        detail: ''
    });
}

function getDependencyStatus(app) {
    const ytDlpPath = resolveYtDlpBinary(app);
    const ffmpegPath = resolveFfmpegBinary(app);
    return {
        ytdlp: {
            installed: !!ytDlpPath,
            path: ytDlpPath,
            managedPath: getManagedYtDlpPath(app)
        },
        ffmpeg: {
            installed: !!ffmpegPath,
            path: ffmpegPath,
            managedPath: getManagedFfmpegPath(app)
        }
    };
}

function downloadFile(url, destinationPath, onProgress = () => {}, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        const request = https.get(url, (response) => {
            const statusCode = response.statusCode || 0;
            const location = response.headers.location;
            if ([301, 302, 303, 307, 308].includes(statusCode) && location && redirectCount < 6) {
                response.resume();
                downloadFile(location, destinationPath, onProgress, redirectCount + 1).then(resolve).catch(reject);
                return;
            }
            if (statusCode !== 200) {
                response.resume();
                reject(new Error(`İndirme başarısız. HTTP ${statusCode}`));
                return;
            }

            const totalBytes = Number(response.headers['content-length'] || 0);
            let downloadedBytes = 0;
            const output = fs.createWriteStream(destinationPath);
            response.on('data', (chunk) => {
                downloadedBytes += chunk.length;
                if (totalBytes > 0) onProgress((downloadedBytes / totalBytes) * 100);
            });
            response.pipe(output);
            output.on('finish', () => output.close(() => resolve(destinationPath)));
            output.on('error', (error) => output.close(() => reject(error)));
        });
        request.setTimeout(120000, () => {
            request.destroy(new Error('İndirme zaman aşımına uğradı.'));
        });
        request.on('error', reject);
    });
}

async function makeExecutable(filePath) {
    if (process.platform === 'win32') return;
    await fs.promises.chmod(filePath, 0o755);
}

function findFileRecursiveSync(dirPath, filename) {
    const stack = [dirPath];
    while (stack.length) {
        const current = stack.pop();
        let entries = [];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) stack.push(fullPath);
            else if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) return fullPath;
        }
    }
    return '';
}

async function extractZipWithPowershell(zipPath, destinationDir) {
    await new Promise((resolve, reject) => {
        const child = spawn('powershell.exe', [
            '-NoProfile',
            '-Command',
            `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destinationDir.replace(/'/g, "''")}' -Force`
        ], { windowsHide: true });
        let stderr = '';
        child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(stderr.trim() || `PowerShell ${code} kodu ile kapandi.`));
        });
    });
}

async function extractTarXz(archivePath, destinationDir) {
    await new Promise((resolve, reject) => {
        const child = spawn('tar', ['-xJf', archivePath, '-C', destinationDir], {
            shell: false,
            windowsHide: true
        });
        let stderr = '';
        child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(stderr.trim() || `tar ${code} kodu ile kapandi.`));
        });
    });
}

async function ensureYtDlpBinary(app, emit) {
    const existing = resolveYtDlpBinary(app);
    if (existing) return existing;

    const targetPath = getManagedYtDlpPath(app);
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    emitDependencyStatus(emit, 'yt-dlp', 'running', 'yt-dlp indiriliyor', 0);
    await downloadFile(getYtDlpDownloadUrl(), targetPath, (percent) => {
        emitDependencyStatus(emit, 'yt-dlp', 'running', `%${Math.round(percent)}`, percent);
    });
    await makeExecutable(targetPath);
    emitDependencyStatus(emit, 'yt-dlp', 'done', 'Hazır', 100);
    return targetPath;
}

async function ensureFfmpegBinary(app, emit) {
    const existing = resolveFfmpegBinary(app);
    if (existing) return existing;

    const targetPath = getManagedFfmpegPath(app);
    const binDir = path.dirname(targetPath);
    await fs.promises.mkdir(binDir, { recursive: true });

    if (process.platform === 'win32') {
        const zipPath = path.join(binDir, 'ffmpeg_win64.zip');
        const extractDir = path.join(binDir, 'ffmpeg_extract');
        await fs.promises.rm(extractDir, { recursive: true, force: true });
        await fs.promises.mkdir(extractDir, { recursive: true });
        emitDependencyStatus(emit, 'ffmpeg', 'running', 'FFmpeg indiriliyor', 0);
        await downloadFile(WINDOWS_FFMPEG_ZIP_URL, zipPath, (percent) => {
            emitDependencyStatus(emit, 'ffmpeg', 'running', `%${Math.round(percent)}`, percent);
        });
        await extractZipWithPowershell(zipPath, extractDir);
        const extracted = findFileRecursiveSync(extractDir, 'ffmpeg.exe');
        if (!extracted) throw new Error('Arşiv içinde ffmpeg.exe bulunamadı.');
        await fs.promises.copyFile(extracted, targetPath);
        await fs.promises.rm(zipPath, { force: true });
        await fs.promises.rm(extractDir, { recursive: true, force: true });
        emitDependencyStatus(emit, 'ffmpeg', 'done', 'Hazır', 100);
        return targetPath;
    }

    const linuxArchiveUrl = getLinuxFfmpegArchiveUrl();
    if (linuxArchiveUrl) {
        const archivePath = path.join(binDir, 'ffmpeg-static.tar.xz');
        const extractDir = path.join(binDir, 'ffmpeg-static');
        await fs.promises.rm(extractDir, { recursive: true, force: true });
        await fs.promises.mkdir(extractDir, { recursive: true });
        emitDependencyStatus(emit, 'ffmpeg', 'running', 'FFmpeg indiriliyor', 0);
        await downloadFile(linuxArchiveUrl, archivePath, (percent) => {
            emitDependencyStatus(emit, 'ffmpeg', 'running', `%${Math.round(percent)}`, percent);
        });
        await extractTarXz(archivePath, extractDir);
        const extracted = findFileRecursiveSync(extractDir, 'ffmpeg');
        if (!extracted) throw new Error('Arşiv içinde ffmpeg bulunamadı.');
        await fs.promises.copyFile(extracted, targetPath);
        await makeExecutable(targetPath);
        await fs.promises.rm(archivePath, { force: true });
        await fs.promises.rm(extractDir, { recursive: true, force: true });
        emitDependencyStatus(emit, 'ffmpeg', 'done', 'Hazır', 100);
        return targetPath;
    }

    throw new Error('ffmpeg bulunamadı ve bu platform için otomatik kurulum desteklenmiyor.');
}

function getDefaultDownloadDir() {
    const home = os.homedir();
    const candidates = [
        path.join(home, 'Downloads'),
        path.join(home, 'İndirilenler'),
        path.join(home, 'Indirilenler')
    ];
    return candidates.find((dir) => fs.existsSync(dir)) || candidates[0];
}

function getConfigPath(app) {
    return path.join(app.getPath('userData'), CONFIG_NAME);
}

function getHistoryPath(app) {
    return path.join(app.getPath('userData'), HISTORY_NAME);
}

async function readSettings(app) {
    const defaults = {
        downloadDir: getDefaultDownloadDir(),
        customArgs: '',
        closeOnFinish: false,
        preferredVideoQuality: '1080',
        preferredVideoCodec: 'avc1',
        preferredAudioFormat: 'mp3',
        browserCookies: '',
        proxy: '',
        configPath: '',
        useConfigFile: false,
        showMoreFormats: false,
        theme: 'ardali',
        playlistFileTemplate: '%(playlist_index)s.%(title)s.%(ext)s',
        playlistFolderTemplate: '%(playlist_title)s',
        maxActiveDownloads: 1,
        closeToTray: false,
        disableAutoUpdates: false,
        compressorMode: 'video',
        compressorExtension: 'unchanged',
        compressorEncoder: 'x264',
        compressorSpeed: 'medium',
        compressorQuality: 23,
        compressorAudioFormat: 'copy',
        compressorEmbedCover: true,
        compressorSuffix: '_compressed',
        compressorSameFolder: true,
        compressorOutputDir: ''
    };
    try {
        const parsed = JSON.parse(await fs.promises.readFile(getConfigPath(app), 'utf8'));
        return { ...defaults, ...parsed };
    } catch {
        return defaults;
    }
}

async function writeSettings(app, nextSettings) {
    const current = await readSettings(app);
    const merged = { ...current, ...nextSettings };
    await fs.promises.mkdir(path.dirname(getConfigPath(app)), { recursive: true });
    await fs.promises.writeFile(getConfigPath(app), JSON.stringify(merged, null, 2));
    return merged;
}

async function readHistory(app) {
    try {
        const parsed = JSON.parse(await fs.promises.readFile(getHistoryPath(app), 'utf8'));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

async function writeHistory(app, history) {
    const clean = Array.isArray(history) ? history.slice(0, 800) : [];
    await fs.promises.mkdir(path.dirname(getHistoryPath(app)), { recursive: true });
    await fs.promises.writeFile(getHistoryPath(app), JSON.stringify(clean, null, 2));
    return clean;
}

async function addHistoryItem(app, item) {
    const history = await readHistory(app);
    const nextItem = {
        id: crypto.randomUUID(),
        title: item.title || 'Indirme',
        url: item.url || '',
        filename: item.filename || (item.filePath ? path.basename(item.filePath) : ''),
        filePath: item.filePath || '',
        fileSize: Number(item.fileSize || 0) || 0,
        format: item.format || 'unknown',
        status: item.status || 'done',
        error: item.error || '',
        thumbnail: item.thumbnail || '',
        duration: Number(item.duration || 0) || 0,
        downloadDate: new Date().toISOString(),
        downloadedAt: new Date().toISOString(),
        timestamp: Date.now()
    };
    history.unshift(nextItem);
    await writeHistory(app, history);
    return nextItem;
}

function sanitizeCSVField(value) {
    let text = value == null ? '' : String(value);
    text = text.replace(/"/g, '""');
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text}"`;
}

async function exportHistory(app, format) {
    const history = await readHistory(app);
    const normalized = String(format || 'json').toLowerCase();
    if (normalized === 'csv') {
        const headers = ['Title', 'URL', 'Filename', 'Format', 'Status', 'File Size', 'Date', 'Path', 'Error'];
        const rows = history.map((item) => [
            item.title,
            item.url,
            item.filename || (item.filePath ? path.basename(item.filePath) : ''),
            item.format,
            item.status || 'done',
            item.fileSize || 0,
            item.downloadDate || item.downloadedAt || '',
            item.filePath || '',
            item.error || ''
        ].map(sanitizeCSVField));
        return `${headers.join(',')}\n${rows.map((row) => row.join(',')).join('\n')}`;
    }
    return JSON.stringify(history, null, 2);
}

function formatDuration(seconds) {
    const total = Number(seconds || 0);
    if (!Number.isFinite(total) || total <= 0) return '';
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = Math.floor(total % 60);
    return h > 0
        ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
        : `${m}:${String(s).padStart(2, '0')}`;
}

function summarizeFormats(formats = []) {
    const videoFormats = [];
    const audioFormats = [];
    const seenVideo = new Set();
    const seenAudio = new Set();

    for (const format of formats) {
        const id = String(format.format_id || '').trim();
        if (!id) continue;
        const extRaw = String(format.ext || '').trim();
        const ext = extRaw.toLowerCase();
        const height = Number(format.height || 0);
        const fps = Number(format.fps || 0);
        const vcodec = String(format.vcodec || 'none');
        const acodec = String(format.acodec || 'none');
        const abr = Number(format.abr || format.tbr || 0);
        const filesize = Number(format.filesize || format.filesize_approx || 0);
        const sizeText = filesize > 0 ? `${(filesize / 1024 / 1024).toFixed(2)} MB` : '—';

        if (vcodec !== 'none' && height > 0 && !seenVideo.has(id)) {
            seenVideo.add(id);
            videoFormats.push({
                id,
                height,
                ext,
                vcodec,
                acodec,
                filesize,
                label: `${height}p${fps ? `${fps}` : ''}   | ${ext || 'video'}   | ${sizeText}`
            });
        }

        if (acodec !== 'none' && vcodec === 'none' && !seenAudio.has(id)) {
            const quality = abr >= 160 ? 'high' : abr >= 96 ? 'medium' : 'low';
            seenAudio.add(id);
            audioFormats.push({
                id,
                abr,
                ext,
                acodec,
                filesize,
                label: `${quality}   | ${ext || 'audio'}   | ${sizeText}`
            });
        }
    }

    videoFormats.sort((a, b) => b.height - a.height);
    audioFormats.sort((a, b) => b.abr - a.abr);

    return { videoFormats, audioFormats };
}

function runYtDlpJson(url, ytDlpBinary) {
    return new Promise((resolve, reject) => {
        if (!ytDlpBinary) {
            reject(new Error('yt-dlp bulunamadi. Lutfen sisteminize yt-dlp kurun.'));
            return;
        }

        const child = spawnLowPriority(ytDlpBinary, ['-J', '--no-playlist', '--no-warnings', url], {
            shell: false,
            windowsHide: true
        }, 12);
        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
        child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(stderr.trim() || `yt-dlp ${code} kodu ile kapandi.`));
                return;
            }
            try {
                const metadata = JSON.parse(stdout);
                const formats = summarizeFormats(metadata.formats || []);
                resolve({
                    id: metadata.id || '',
                    url,
                    title: metadata.title || '',
                    thumbnail: metadata.thumbnail || '',
                    extractor: metadata.extractor_key || metadata.extractor || '',
                    duration: metadata.duration || 0,
                    durationText: formatDuration(metadata.duration),
                    ...formats
                });
            } catch (error) {
                reject(new Error(`yt-dlp ciktisi okunamadi: ${error.message}`));
            }
        });
    });
}

function splitArgs(value) {
    const text = String(value || '').trim();
    if (!text) return [];
    const matches = text.match(/"[^"]*"|'[^']*'|\S+/g) || [];
    return matches.map((item) => item.replace(/^["']|["']$/g, ''));
}

function sanitizeOutputTemplate(downloadDir) {
    return path.join(downloadDir, '%(title).200B.%(ext)s');
}

function normalizeMediaExt(value) {
    const ext = String(value || '').trim().toLowerCase();
    if (ext === 'webm') return 'opus';
    if (ext === 'aac' || ext === 'mp4') return 'm4a';
    return ext;
}

function getVideoMergeFormat(options) {
    const videoExt = String(options.videoFormatExt || '').trim().toLowerCase();
    const audioExt = normalizeMediaExt(options.audioForVideoFormatExt);
    const videoCodec = String(options.videoFormatCodec || '').toLowerCase();

    if (videoExt === 'mp4' && audioExt === 'opus') {
        if (videoCodec.includes('av01') || videoCodec.includes('vp9')) return 'webm';
        return 'mkv';
    }
    if (videoExt === 'webm' && ['m4a', 'mp4'].includes(audioExt)) return 'mkv';
    if (videoExt === 'webm') return 'webm';
    return 'mp4';
}

function cleanupPartialArtifacts(outputPath) {
    const target = String(outputPath || '').trim();
    if (!target) return;
    const candidates = target.endsWith('.part') ? [target] : [`${target}.part`];
    for (const candidate of candidates) {
        fs.promises.rm(candidate, { force: true }).catch(() => {});
    }
}

function buildDownloadArgs(options, settings) {
    const args = ['--newline', '--no-playlist', '--no-mtime'];
    const mode = String(options.mode || 'video');
    const downloadDir = settings.downloadDir || getDefaultDownloadDir();
    const extractFormat = String(options.extractFormat || 'mp3');
    const extractFormatLower = extractFormat.toLowerCase();

    if (mode === 'video') {
        const videoId = String(options.videoFormatId || '').trim();
        const audioId = String(options.audioForVideoFormatId || '').trim();
        if (videoId && audioId && audioId !== 'none') args.push('-f', `${videoId}+${audioId}`);
        else if (videoId) args.push('-f', `${videoId}+bestaudio[ext=m4a]/${videoId}+bestaudio/${videoId}/best`);
        else args.push('-f', 'bestvideo+bestaudio/best');
    } else {
        const audioId = String(options.audioFormatId || '').trim();
        if (mode === 'audio' && audioId) args.push('-f', audioId);
        else if (mode === 'audio' && extractFormatLower === 'm4a') args.push('-f', 'bestaudio[ext=m4a]/bestaudio/best');
        else if (mode === 'audio' && extractFormatLower === 'opus') args.push('-f', 'bestaudio[ext=webm]/bestaudio/best');
        else args.push('-f', 'bestaudio/best');
        args.push('-x', '--audio-format', extractFormat);
        args.push('--audio-quality', String(options.audioQuality || '0'));
        if (['mp3', 'm4a', 'mp4', 'opus', 'alac', 'flac'].includes(extractFormatLower)) {
            args.push('--embed-metadata', '--add-metadata', '--embed-thumbnail', '--convert-thumbnails', 'jpg');
        }
    }

    const start = String(options.startTime || '').trim();
    const end = String(options.endTime || '').trim();
    if (start || end) args.push('--download-sections', `*${start || '0'}-${end || 'inf'}`);
    if (options.subtitles) args.push('--write-subs', '--write-auto-subs');
    if (settings.browserCookies) args.push('--cookies-from-browser', settings.browserCookies);
    if (settings.proxy) args.push('--no-check-certificate', '--proxy', settings.proxy);
    if (settings.useConfigFile && settings.configPath) args.push('--config-location', settings.configPath);
    if (settings.ffmpegPath) args.push('--ffmpeg-location', path.dirname(settings.ffmpegPath));
    args.push(...splitArgs(settings.customArgs), ...splitArgs(options.customArgs));
    args.push('-o', sanitizeOutputTemplate(downloadDir));
    args.push(String(options.url || '').trim());
    return args.filter(Boolean);
}

function buildPlaylistArgs(options, settings) {
    const args = ['--newline', '--yes-playlist'];
    const mode = String(options.mode || 'playlist-video');
    const downloadDir = settings.downloadDir || getDefaultDownloadDir();
    const folderTemplate = String(options.playlistFolderTemplate || settings.playlistFolderTemplate || '%(playlist_title)s').trim() || '%(playlist_title)s';
    const fileTemplate = String(options.playlistFileTemplate || settings.playlistFileTemplate || '%(playlist_index)s.%(title)s.%(ext)s').trim() || '%(playlist_index)s.%(title)s.%(ext)s';
    const start = Math.max(1, Number(options.playlistStart || 1) || 1);
    const end = String(options.playlistEnd || '').trim();
    const outputTemplate = path.join(downloadDir, folderTemplate, fileTemplate);

    args.push('-o', outputTemplate);
    args.push('-I', `${start}:${end}`);
    args.push('--compat-options', 'no-youtube-unavailable-videos');
    if (settings.browserCookies) args.push('--cookies-from-browser', settings.browserCookies);
    if (settings.proxy) args.push('--no-check-certificate', '--proxy', settings.proxy);
    if (settings.useConfigFile && settings.configPath) args.push('--config-location', settings.configPath);
    if (settings.ffmpegPath) args.push('--ffmpeg-location', path.dirname(settings.ffmpegPath));

    if (mode === 'playlist-audio') {
        args.push('-x', '--audio-format', String(options.playlistAudioFormat || 'mp3'));
        args.push('--audio-quality', String(options.playlistAudioQuality || '0'));
        args.push('--embed-metadata');
    } else if (mode === 'playlist-thumbnails') {
        args.push('--write-thumbnail', '--convert-thumbnails', 'png', '--skip-download');
    } else if (mode === 'playlist-links') {
        args.push('--skip-download', '--print-to-file', 'webpage_url', path.join(downloadDir, folderTemplate, 'links.txt'));
    } else {
        const quality = String(options.playlistVideoQuality || 'best');
        const format = String(options.playlistVideoFormat || 'auto');
        if (quality === 'best') {
            args.push('-f', 'bv*+ba/best');
        } else if (quality === 'worst') {
            args.push('-f', 'wv+wa/worst');
        } else if (format === 'mp4') {
            args.push('-f', `bestvideo[height<=${quality}]+bestaudio[ext=m4a]/best[height<=${quality}]/best`);
            args.push('--merge-output-format', 'mp4', '--recode-video', 'mp4');
        } else if (format === 'webm') {
            args.push('-f', `bestvideo[height<=${quality}]+bestaudio[ext=webm]/best[height<=${quality}]/best`);
            args.push('--merge-output-format', 'webm', '--recode-video', 'webm');
        } else {
            args.push('-f', `bv*[height<=${quality}]+ba/best[height<=${quality}]/best`);
        }
        args.push('--embed-metadata');
        if (options.playlistSubtitles) args.push('--write-subs', '--sub-langs', 'all');
    }

    args.push(...splitArgs(settings.customArgs), ...splitArgs(options.customArgs));
    args.push(String(options.url || '').trim());
    return args.filter(Boolean);
}

function sanitizeCompressionFiles(files) {
    return (Array.isArray(files) ? files : [])
        .map((filePath) => String(filePath || '').trim())
        .filter((filePath) => path.isAbsolute(filePath) && fs.existsSync(filePath));
}

function normalizeCompressionSettings(options) {
    const mode = String(options.mode || 'video').toLowerCase() === 'audio' ? 'audio' : 'video';
    const extension = String(options.extension || 'unchanged').toLowerCase();
    const encoder = String(options.encoder || 'x264').toLowerCase();
    const speed = String(options.speed || 'medium').toLowerCase();
    const audioFormat = String(options.audioFormat || 'copy').toLowerCase();
    const outputSuffix = String(options.outputSuffix || '_compressed').trim() || '_compressed';
    const sameFolder = options.sameFolder !== false;
    const outputDir = String(options.outputDir || '').trim();
    const quality = Math.max(18, Math.min(51, Number(options.videoQuality || 23) || 23));

    return {
        mode,
        extension: ['unchanged', 'mp4', 'mkv'].includes(extension) ? extension : 'unchanged',
        encoder,
        speed: ['fast', 'medium', 'slow'].includes(speed) ? speed : 'medium',
        audioFormat: ['copy', 'aac', 'mp3', 'm4a', 'mp4', 'opus', 'ogg', 'flac', 'wav', 'alac'].includes(audioFormat) ? audioFormat : 'copy',
        embedCover: options.embedCover !== false,
        outputSuffix,
        sameFolder,
        outputDir,
        videoQuality: quality
    };
}

function buildCompressionOutputPath(inputPath, settings) {
    const parsed = path.parse(inputPath);
    const targetDir = settings.sameFolder || !settings.outputDir ? parsed.dir : settings.outputDir;
    const targetExt = settings.mode === 'audio'
        ? `.${getAudioOutputExtension(settings.audioFormat)}`
        : (settings.extension === 'unchanged' ? parsed.ext : `.${settings.extension}`);
    return path.join(targetDir, `${parsed.name}${settings.outputSuffix}${targetExt}`);
}

function getAudioOutputExtension(format) {
    if (format === 'alac') return 'm4a';
    if (format === 'copy') return 'mp3';
    return ['aac', 'mp3', 'm4a', 'mp4', 'opus', 'ogg', 'flac', 'wav'].includes(format) ? format : 'mp3';
}

function supportsEmbeddedCover(format) {
    return ['mp3', 'm4a', 'mp4', 'alac', 'flac'].includes(String(format || '').toLowerCase());
}

function getAudioCodecArgs(format) {
    switch (format) {
        case 'aac':
        case 'm4a':
        case 'mp4':
            return ['-c:a', 'aac', '-b:a', '256k'];
        case 'opus':
            return ['-c:a', 'libopus', '-b:a', '192k'];
        case 'ogg':
            return ['-c:a', 'libvorbis', '-q:a', '7'];
        case 'flac':
            return ['-c:a', 'flac'];
        case 'wav':
            return ['-c:a', 'pcm_s16le'];
        case 'alac':
            return ['-c:a', 'alac'];
        case 'mp3':
        default:
            return ['-c:a', 'libmp3lame', '-q:a', '0'];
    }
}

function mapCompressionPreset(encoder, speed) {
    if (encoder.includes('nvenc')) return speed === 'fast' ? 'p3' : speed === 'slow' ? 'p5' : 'p4';
    if (encoder.includes('amf')) return speed === 'fast' ? 'speed' : speed === 'slow' ? 'quality' : 'balanced';
    return speed;
}

function buildFFmpegArgs(inputPath, outputPath, settings) {
    const args = ['-hide_banner', '-y', '-stats', '-progress', 'pipe:2', '-i', inputPath];
    const preset = mapCompressionPreset(settings.encoder, settings.speed);

    switch (settings.encoder) {
        case 'copy':
            args.push('-c:v', 'copy');
            break;
        case 'x265':
            args.push('-c:v', 'libx265', '-threads', '1', '-vf', 'format=yuv420p', '-preset', preset, '-crf', String(settings.videoQuality));
            break;
        case 'qsv':
            args.push('-c:v', 'h264_qsv', '-vf', 'format=yuv420p', '-preset', preset, '-global_quality', String(settings.videoQuality));
            break;
        case 'nvenc':
            args.push('-c:v', 'h264_nvenc', '-vf', 'format=yuv420p', '-preset', preset, '-rc', 'vbr', '-cq', String(settings.videoQuality));
            break;
        case 'hevc_nvenc':
            args.push('-c:v', 'hevc_nvenc', '-vf', 'format=yuv420p', '-preset', preset, '-rc', 'vbr', '-cq', String(settings.videoQuality));
            break;
        case 'amf':
            args.push('-c:v', 'h264_amf', '-vf', 'format=yuv420p', '-quality', preset, '-qp_i', String(settings.videoQuality), '-qp_p', String(settings.videoQuality));
            break;
        case 'hevc_amf':
            args.push('-c:v', 'hevc_amf', '-vf', 'format=yuv420p', '-quality', preset, '-qp_i', String(settings.videoQuality), '-qp_p', String(settings.videoQuality));
            break;
        case 'vaapi':
            args.push('-vaapi_device', '/dev/dri/renderD128', '-vf', 'format=nv12,hwupload', '-c:v', 'h264_vaapi', '-qp', String(settings.videoQuality));
            break;
        case 'hevc_vaapi':
            args.push('-vaapi_device', '/dev/dri/renderD128', '-vf', 'format=nv12,hwupload', '-c:v', 'hevc_vaapi', '-qp', String(settings.videoQuality));
            break;
        case 'videotoolbox':
            args.push('-c:v', 'h264_videotoolbox', '-q:v', String(settings.videoQuality));
            break;
        case 'x264':
        default:
            args.push('-c:v', 'libx264', '-threads', '1', '-preset', preset, '-vf', 'format=yuv420p', '-crf', String(settings.videoQuality));
            break;
    }

    args.push('-c:a', settings.audioFormat);
    args.push(outputPath);
    return args;
}

async function extractAudioCover(ffmpegBinary, inputPath, batchId) {
    const coverPath = path.join(os.tmpdir(), `ardali-cover-${batchId}-${crypto.randomBytes(4).toString('hex')}.jpg`);
    await new Promise((resolve, reject) => {
        const child = spawnLowPriority(ffmpegBinary, [
            '-hide_banner',
            '-y',
            '-ss',
            '00:00:01',
            '-i',
            inputPath,
            '-frames:v',
            '1',
            '-vf',
            'scale=900:-1',
            coverPath
        ], {
            cwd: path.dirname(inputPath),
            shell: false,
            windowsHide: true
        }, 15);
        let stderr = '';
        child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0 && fs.existsSync(coverPath)) resolve();
            else reject(new Error(stderr.trim().slice(-500) || 'Kapak görseli çıkarılamadı.'));
        });
    });
    return coverPath;
}

function buildAudioConversionArgs(inputPath, outputPath, settings, coverPath = '') {
    const format = settings.audioFormat === 'copy' ? 'mp3' : settings.audioFormat;
    const shouldEmbedCover = !!coverPath && settings.embedCover && supportsEmbeddedCover(format);
    const args = ['-hide_banner', '-y', '-stats', '-progress', 'pipe:2', '-i', inputPath];
    if (shouldEmbedCover) args.push('-i', coverPath);
    args.push('-map', '0:a:0');
    if (shouldEmbedCover) args.push('-map', '1:v:0');
    else args.push('-vn');
    args.push(...getAudioCodecArgs(format));
    if (shouldEmbedCover) {
        args.push(
            '-c:v', 'copy',
            '-disposition:v:0', 'attached_pic',
            '-metadata:s:v', 'title=Album cover',
            '-metadata:s:v', 'comment=Cover (front)'
        );
        if (format === 'mp3') args.push('-id3v2_version', '3');
    }
    args.push(outputPath);
    return args;
}

function parseFfmpegDuration(text) {
    const match = String(text || '').match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (!match) return 0;
    return (Number(match[1]) * 3600) + (Number(match[2]) * 60) + Number(match[3]);
}

function parseFfmpegTime(text) {
    const match = String(text || '').match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (!match) return 0;
    return (Number(match[1]) * 3600) + (Number(match[2]) * 60) + Number(match[3]);
}

function parseFfmpegProgressTime(text) {
    const value = String(text || '');
    const microsMatch = value.match(/out_time_(?:ms|us)=(\d+)/);
    if (microsMatch) return Number(microsMatch[1]) / 1000000;
    const secondsMatch = value.match(/out_time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (!secondsMatch) return 0;
    return (Number(secondsMatch[1]) * 3600) + (Number(secondsMatch[2]) * 60) + Number(secondsMatch[3]);
}

function createDownloaderService({ app, webContentsProvider }) {
    const jobs = new Map();
    const compressionBatches = new Map();
    const downloadQueue = [];
    const activeDownloads = new Set();
    let maxActiveDownloadLimit = 1;

    function emit(payload) {
        const contents = webContentsProvider();
        if (contents && !contents.isDestroyed()) contents.send('downloader:job-update', payload);
    }

    function getMaxActiveDownloads(settings) {
        return Math.max(1, Math.min(2, Number(settings?.maxActiveDownloads || 1) || 1));
    }

    function pumpDownloadQueue() {
        while (downloadQueue.length > 0) {
            const next = downloadQueue[0];
            if (activeDownloads.size >= maxActiveDownloadLimit) return;
            downloadQueue.shift();
            launchDownloadTask(next);
        }
    }

    function finishDownloadTask(id) {
        activeDownloads.delete(id);
        jobs.delete(id);
        pumpDownloadQueue();
    }

    function launchDownloadTask(task) {
        const { id, ytDlpBinary, args, settings, options, mode, title } = task;
        activeDownloads.add(id);
        console.log('[DOWNLOADER] spawn:', ytDlpBinary, args.join(' '));
        const child = spawnLowPriority(ytDlpBinary, args, {
            cwd: settings.downloadDir,
            shell: false,
            windowsHide: true
        }, 12);

        jobs.set(id, child);
        emit({
            id,
            state: 'running',
            title,
            percent: 0,
            message: 'Hazırlanıyor',
            detail: '',
            thumbnail: options.thumbnail || '',
            mode
        });

        let settled = false;
        let stderr = '';
        let outputPath = '';
        let ffmpegDurationSeconds = 0;
        const parseTimestampSeconds = (value) => {
            const match = String(value || '').match(/(\d+):(\d+):(\d+(?:\.\d+)?)/);
            if (!match) return 0;
            return (Number(match[1]) * 3600) + (Number(match[2]) * 60) + Number(match[3]);
        };
        const parseProgress = (text) => {
            const line = String(text || '').replace(/\x1b\[[0-9;]*m/g, '').trim();
            if (!line) return;
            const destination = line.match(/\[download\]\s+Destination:\s+(.+)/i) || line.match(/\[Merger\]\s+Merging formats into\s+"?([^"\n]+)"?/i);
            if (destination) {
                outputPath = destination[1].trim();
                emit({ id, state: 'running', title, percent: 0, message: 'İndiriliyor', detail: '', thumbnail: options.thumbnail || '', mode });
                return;
            }
            if (/^\[(Merger|ExtractAudio|VideoRemuxer|Metadata|EmbedThumbnail|Fixup)\]/i.test(line)) {
                emit({ id, state: 'running', title, percent: 100, message: 'İşleniyor', detail: '', thumbnail: options.thumbnail || '', mode });
                return;
            }
            const durationMatch = line.match(/\bDuration:\s+(\d+:\d+:\d+(?:\.\d+)?)/i);
            if (durationMatch) {
                ffmpegDurationSeconds = parseTimestampSeconds(durationMatch[1]) || ffmpegDurationSeconds;
                return;
            }
            const ffmpegTimeMatch = line.match(/\btime=(\d+:\d+:\d+(?:\.\d+)?)/i);
            if (ffmpegTimeMatch && ffmpegDurationSeconds > 0) {
                const currentSeconds = parseTimestampSeconds(ffmpegTimeMatch[1]);
                const percent = Math.max(0, Math.min(99, (currentSeconds / ffmpegDurationSeconds) * 100));
                const speed = line.match(/\bspeed=\s*([^\s]+)/i)?.[1] || '';
                emit({
                    id,
                    state: 'running',
                    title,
                    percent,
                    message: speed ? `Hız ${speed}` : 'İndiriliyor',
                    detail: '',
                    speed,
                    thumbnail: options.thumbnail || '',
                    mode
                });
                return;
            }
            const match = line.match(/^\[download\].*?(\d+(?:\.\d+)?)%/i);
            if (!match) return;
            const percent = Math.max(0, Math.min(100, Number(match[1]) || 0));
            const speed = line.match(/\bat\s+([^\s]+\/s)/i)?.[1] || '';
            emit({
                id,
                state: 'running',
                title,
                percent,
                message: speed ? `Hız ${speed}` : 'İndiriliyor',
                detail: '',
                speed,
                thumbnail: options.thumbnail || '',
                mode
            });
        };

        child.stdout.on('data', (chunk) => {
            chunk.toString().split(/[\r\n]+/).forEach(parseProgress);
        });
        child.stderr.on('data', (chunk) => {
            const text = chunk.toString();
            stderr += text;
            if (text.trim()) console.warn('[DOWNLOADER:stderr]', text.trim());
            text.split(/[\r\n]+/).forEach(parseProgress);
        });
        child.on('error', (error) => {
            if (settled) return;
            settled = true;
            finishDownloadTask(id);
            emit({ id, state: 'error', title, percent: 0, message: 'Hata', detail: error.message });
        });
        child.on('close', (code, signal) => {
            if (settled) return;
            settled = true;
            finishDownloadTask(id);
            if (signal) {
                cleanupPartialArtifacts(outputPath);
                addHistoryItem(app, {
                    title,
                    url: options.url,
                    filePath: outputPath || '',
                    format: mode,
                    status: 'cancelled',
                    error: 'Kullanıcı tarafından iptal edildi.',
                    thumbnail: options.thumbnail || ''
                }).catch((error) => {
                    console.warn('[DOWNLOADER] history save failed:', error?.message || error);
                });
                emit({ id, state: 'cancelled', title, percent: 0, message: 'Iptal edildi', detail: '' });
                return;
            }
            if (code === 0) {
                addHistoryItem(app, {
                    title,
                    url: options.url,
                    filePath: outputPath || settings.downloadDir,
                    format: mode,
                    thumbnail: options.thumbnail || ''
                }).catch((error) => {
                    console.warn('[DOWNLOADER] history save failed:', error?.message || error);
                });
                emit({
                    id,
                    state: 'done',
                    title,
                    percent: 100,
                    message: 'Tamamlandi',
                    detail: outputPath || settings.downloadDir,
                    outputPath,
                    thumbnail: options.thumbnail || '',
                    mode,
                    closeOnFinish: options.closeOnFinish === true
                });
                return;
            }
            cleanupPartialArtifacts(outputPath);
            emit({
                id,
                state: 'error',
                title,
                percent: 0,
                message: 'Hata',
                detail: stderr.trim().slice(-500) || `yt-dlp ${code} kodu ile kapandi.`
            });
            addHistoryItem(app, {
                title,
                url: options.url,
                filePath: outputPath || '',
                format: mode,
                status: 'error',
                error: stderr.trim().slice(-500) || `yt-dlp ${code} kodu ile kapandi.`,
                thumbnail: options.thumbnail || ''
            }).catch((error) => {
                console.warn('[DOWNLOADER] history save failed:', error?.message || error);
            });
        });
    }

    return {
        readSettings: () => readSettings(app),
        async writeSettings(settings) {
            const nextSettings = await writeSettings(app, settings);
            maxActiveDownloadLimit = getMaxActiveDownloads(nextSettings);
            pumpDownloadQueue();
            return nextSettings;
        },
        getDependencyStatus: () => getDependencyStatus(app),
        async ensureDependencies() {
            const ytDlpPath = await ensureYtDlpBinary(app, emit);
            const ffmpegPath = await ensureFfmpegBinary(app, emit);
            const status = getDependencyStatus(app);
            return {
                ...status,
                ytdlp: { ...status.ytdlp, path: ytDlpPath || status.ytdlp.path },
                ffmpeg: { ...status.ffmpeg, path: ffmpegPath || status.ffmpeg.path }
            };
        },
        readHistory: () => readHistory(app),
        async getFileThumbnail(filePath) {
            const target = String(filePath || '').trim();
            if (!path.isAbsolute(target) || !fs.existsSync(target)) return '';
            const ffmpegBinary = await ensureFfmpegBinary(app, emit);
            const thumbnailPath = await extractAudioCover(ffmpegBinary, target, 'preview').catch((error) => {
                console.warn('[DOWNLOADER] file thumbnail failed:', error?.message || error);
                return '';
            });
            if (!thumbnailPath) return '';
            try {
                const buffer = await fs.promises.readFile(thumbnailPath);
                return `data:image/jpeg;base64,${buffer.toString('base64')}`;
            } finally {
                fs.promises.unlink(thumbnailPath).catch(() => {});
            }
        },
        exportHistory: (format) => exportHistory(app, format),
        clearHistory: () => writeHistory(app, []),
        async removeHistoryItem(id) {
            const targetId = String(id || '');
            const history = await readHistory(app);
            const next = history.filter((item) => item.id !== targetId);
            await writeHistory(app, next);
            return next.length !== history.length;
        },
        async getInfo(url) {
            const ytDlpBinary = await ensureYtDlpBinary(app, emit);
            return runYtDlpJson(url, ytDlpBinary);
        },
        async start(options) {
            const ytDlpBinary = await ensureYtDlpBinary(app, emit);
            if (!ytDlpBinary) {
                throw new Error('yt-dlp bulunamadi. Lutfen sisteminize yt-dlp kurun.');
            }
            const mode = String(options.mode || 'video');
            let ffmpegPath = '';
            if (!['playlist-links', 'playlist-thumbnails'].includes(mode)) {
                ffmpegPath = await ensureFfmpegBinary(app, emit).catch((error) => {
                    console.warn('[DOWNLOADER] ffmpeg auto-prepare failed:', error?.message || error);
                    return '';
                });
            }
            const settings = await writeSettings(app, {
                customArgs: String(options.customArgs || ''),
                closeOnFinish: options.closeOnFinish === true,
                ffmpegPath
            });
            maxActiveDownloadLimit = getMaxActiveDownloads(settings);
            await fs.promises.mkdir(settings.downloadDir, { recursive: true });

            const id = crypto.randomBytes(6).toString('hex');
            const isPlaylist = mode.startsWith('playlist-');
            const args = isPlaylist
                ? buildPlaylistArgs(options, settings)
                : buildDownloadArgs(options, settings);
            const title = String(options.title || 'Indirme');

            const task = { id, ytDlpBinary, args, settings, options, mode, title };
            if (activeDownloads.size >= maxActiveDownloadLimit) {
                downloadQueue.push(task);
                emit({
                    id,
                    state: 'queued',
                    title,
                    percent: 0,
                    message: 'Sırada',
                    detail: `${downloadQueue.length}. sırada bekliyor.`
                });
            } else {
                launchDownloadTask(task);
            }

            return { id };
        },
        cancel(id) {
            const targetId = String(id || '');
            const queueIndex = downloadQueue.findIndex((task) => task.id === targetId);
            if (queueIndex >= 0) {
                const [task] = downloadQueue.splice(queueIndex, 1);
                emit({ id: targetId, state: 'cancelled', title: task.title, percent: 0, message: 'Iptal edildi', detail: 'Sıradan çıkarıldı.' });
                addHistoryItem(app, {
                    title: task.title,
                    url: task.options.url,
                    filePath: '',
                    format: task.mode,
                    status: 'cancelled',
                    error: 'Sıradan çıkarıldı.',
                    thumbnail: task.options.thumbnail || ''
                }).catch((error) => {
                    console.warn('[DOWNLOADER] history save failed:', error?.message || error);
                });
                return true;
            }
            const child = jobs.get(targetId);
            if (!child) return false;
            child.kill('SIGTERM');
            return true;
        },
        async startCompression(options) {
            const ffmpegBinary = await ensureFfmpegBinary(app, emit);
            if (!ffmpegBinary) {
                throw new Error('ffmpeg bulunamadi. Lutfen sisteminize ffmpeg kurun.');
            }
            const files = sanitizeCompressionFiles(options.files);
            if (!files.length) {
                throw new Error('Sıkıştırılacak geçerli dosya bulunamadı.');
            }
            const settings = normalizeCompressionSettings(options);
            if (!settings.sameFolder) {
                if (!path.isAbsolute(settings.outputDir)) {
                    throw new Error('Geçerli bir çıktı klasörü seçin.');
                }
                await fs.promises.mkdir(settings.outputDir, { recursive: true });
            }

            const batchId = crypto.randomBytes(6).toString('hex');
            compressionBatches.set(batchId, { cancelled: false, children: new Set() });

            (async () => {
                for (const inputPath of files) {
                    const batch = compressionBatches.get(batchId);
                    if (!batch || batch.cancelled) break;

                    const id = `${batchId}-${crypto.randomBytes(4).toString('hex')}`;
                    const title = path.basename(inputPath);
                    const outputPath = buildCompressionOutputPath(inputPath, settings);
                    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
                    let coverPath = '';
                    if (settings.mode === 'audio' && settings.embedCover) {
                        coverPath = await extractAudioCover(ffmpegBinary, inputPath, batchId).catch((error) => {
                            console.warn('[DOWNLOADER] audio cover extraction failed:', error?.message || error);
                            return '';
                        });
                    }
                    const args = settings.mode === 'audio'
                        ? buildAudioConversionArgs(inputPath, outputPath, settings, coverPath)
                        : buildFFmpegArgs(inputPath, outputPath, settings);
                    const child = spawnLowPriority(ffmpegBinary, args, {
                        cwd: path.dirname(inputPath),
                        shell: false,
                        windowsHide: true
                    }, 15);

                    jobs.set(id, child);
                    batch.children.add(child);
                    const jobMode = settings.mode === 'audio' ? 'audio' : 'video';
                    emit({ id, batchId, state: 'running', title, percent: 0, message: settings.mode === 'audio' ? 'Dönüştürülüyor' : 'Sıkıştırılıyor', detail: outputPath, sourcePath: inputPath, mode: jobMode });

                    await new Promise((resolve) => {
                        let stderr = '';
                        let duration = 0;
                        child.stderr.on('data', (chunk) => {
                            const text = chunk.toString();
                            stderr += text;
                            duration = duration || parseFfmpegDuration(text);
                            const current = parseFfmpegProgressTime(text) || parseFfmpegTime(text);
                            if (duration > 0 && current > 0) {
                                const percent = Math.min(99, (current / duration) * 100);
                                emit({
                                    id,
                                    batchId,
                                    state: 'running',
                                    title,
                                    percent,
                                    message: `%${Math.round(percent)}`,
                                    detail: outputPath,
                                    sourcePath: inputPath,
                                    mode: jobMode
                                });
                            }
                        });
                        child.on('error', (error) => {
                            jobs.delete(id);
                            batch.children.delete(child);
                            emit({ id, batchId, state: 'error', title, percent: 0, message: 'Hata', detail: error.message, sourcePath: inputPath, mode: jobMode });
                            resolve();
                        });
                        child.on('close', (code, signal) => {
                            jobs.delete(id);
                            batch.children.delete(child);
                            if (coverPath) {
                                fs.promises.unlink(coverPath).catch(() => {});
                            }
                            if (signal || batch.cancelled) {
                                emit({ id, batchId, state: 'cancelled', title, percent: 0, message: 'İptal edildi', detail: '', sourcePath: inputPath, mode: jobMode });
                                resolve();
                                return;
                            }
                            if (code === 0) {
                                emit({ id, batchId, state: 'done', title, percent: 100, message: 'Tamamlandı', detail: outputPath, outputPath, sourcePath: inputPath, mode: jobMode });
                                resolve();
                                return;
                            }
                            emit({
                                id,
                                batchId,
                                state: 'error',
                                title,
                                percent: 0,
                                message: 'Hata',
                                detail: stderr.trim().slice(-500) || `ffmpeg ${code} kodu ile kapandi.`,
                                sourcePath: inputPath,
                                mode: jobMode
                            });
                            resolve();
                        });
                    });
                }
                const batch = compressionBatches.get(batchId);
                const wasCancelled = !batch || batch.cancelled;
                compressionBatches.delete(batchId);
                emit({
                    id: batchId,
                    batchId,
                    batchDone: true,
                    state: wasCancelled ? 'cancelled' : 'done',
                    title: 'Sıkıştırıcı',
                    percent: wasCancelled ? 0 : 100,
                    message: wasCancelled ? 'İptal edildi' : 'Tamamlandı',
                    detail: wasCancelled ? '' : 'Sıkıştırma görevi tamamlandı.'
                });
            })().catch((error) => {
                compressionBatches.delete(batchId);
                emit({
                    id: batchId,
                    batchId,
                    state: 'error',
                    title: 'Sıkıştırıcı',
                    percent: 0,
                    message: 'Hata',
                    detail: String(error?.message || error)
                });
            });

            return { id: batchId };
        },
        cancelCompression(batchId) {
            const batch = compressionBatches.get(String(batchId || ''));
            if (!batch) return false;
            batch.cancelled = true;
            for (const child of batch.children) {
                try {
                    child.kill('SIGTERM');
                } catch {
                    // ignore stale process handles
                }
            }
            compressionBatches.delete(String(batchId || ''));
            return true;
        }
    };
}

module.exports = {
    createDownloaderService,
    getDefaultDownloadDir
};
