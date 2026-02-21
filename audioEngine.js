// ============================================
// AURIVO AUDIO ENGINE - JavaScript Wrapper
// C++ Native Addon Bridge for Electron
// ============================================

const path = require('path');
const fs = require('fs');

// Native addon'u lazy-load et (Windows'ta eksik DLL durumunda uygulamanın donup kalmaması için)
let nativeAudio = null;
let isNativeAvailable = false;
let lastNativeLoadError = null;
let loadedAddonPath = null;

function uniq(arr) {
    return [...new Set((arr || []).filter(Boolean))];
}

function getAddonCandidatePaths() {
    const name = 'aurivo_audio.node';
    const out = [];

    // Packaged: prefer files copied as extraResources
    if (process.resourcesPath) {
        out.push(path.join(process.resourcesPath, 'native', 'build', 'Release', name));
        // electron-builder default native unpack dir
        out.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'native', 'build', 'Release', name));
        out.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'build', 'Release', name));
    }

    // Dev / fallback
    out.push(path.join(__dirname, 'native', 'build', 'Release', name));
    out.push(path.join(__dirname, 'native-dist', name));
    out.push(path.join(__dirname, 'build', 'Release', name));

    return uniq(out);
}

function prependToWindowsPath(dir) {
    if (!dir || process.platform !== 'win32') return;
    const cur = process.env.PATH || '';
    const parts = cur.split(';').filter(Boolean);
    if (parts.includes(dir)) return;
    process.env.PATH = `${dir};${cur}`;
}

function tryLoadNativeAddon() {
    if (nativeAudio) return true;
    lastNativeLoadError = null;

    const addonPaths = getAddonCandidatePaths();
    let lastErr = null;

    for (const addonPath of addonPaths) {
        try {
            if (!fs.existsSync(addonPath)) continue;
            prependToWindowsPath(path.dirname(addonPath));
            if (process.platform === 'win32') {
                // Bonus: ensure common runtime dirs are also on PATH (BASS dlls etc.)
                try {
                    if (process.resourcesPath) {
                        prependToWindowsPath(path.join(process.resourcesPath, 'native-dist'));
                        prependToWindowsPath(path.join(process.resourcesPath, 'native', 'build', 'Release'));
                        prependToWindowsPath(path.join(process.resourcesPath, 'bin'));
                    }
                    // Dev fallback
                    prependToWindowsPath(path.join(__dirname, 'native', 'build', 'Release'));
                    prependToWindowsPath(path.join(__dirname, 'native-dist'));
                    prependToWindowsPath(path.join(__dirname, 'bin'));
                } catch {
                    // ignore
                }
            }
            nativeAudio = require(addonPath);
            isNativeAvailable = true;
            loadedAddonPath = addonPath;
            console.log('✓ Aurivo C++ Audio Engine yüklendi:', addonPath);
            return true;
        } catch (error) {
            lastErr = error;
            if (process.platform === 'win32') {
                console.warn(`[NativeAudio] Addon yükleme denemesi başarısız: ${addonPath}`);
                console.warn(`  Hata: ${error.message || error}`);
            }
        }
    }

    isNativeAvailable = false;
    loadedAddonPath = null;
    lastNativeLoadError = lastErr;
    console.warn('⚠ C++ Audio Engine yüklenemedi, HTML5 Audio kullanılacak');
    if (process.platform === 'win32' && lastErr) {
        console.warn('[NativeAudio] Windows yükleme hatası:', lastErr.message || lastErr);
        console.warn('[NativeAudio] Çözüm adımları:');
        console.warn('[NativeAudio]  1. Visual C++ Redistributable (VC++) yüklü mü?');
        console.warn('[NativeAudio]  2. .node dosyası mevcut mu?:', addonPaths);
        console.warn('[NativeAudio]  3. BASS DLL dosyaları native/build/Release/ içinde mi?');
    }
    return false;
}

class AurivoAudioEngine {
    constructor() {
        this.initialized = false;
        this.callbacks = {
            onPositionUpdate: null,
            onPlaybackEnd: null,
            onError: null
        };
        this.positionTimer = null;
    }

    /**
     * Audio engine'i başlat
     * @returns {boolean} Başarılı mı?
     */
    initialize() {
        if (!tryLoadNativeAddon() || !isNativeAvailable) {
            console.warn('Native audio mevcut değil');
            return false;
        }

        try {
            const result = nativeAudio.initialize();
            this.initialized = result;
            if (result) {
                console.log('✓ Aurivo Audio Engine başlatıldı');
            }
            return result;
        } catch (error) {
            console.error('Audio Engine başlatma hatası:', error);
            return false;
        }
    }

    /**
     * Audio engine'i kapat
     */
    cleanup() {
        if (this.positionTimer) {
            clearInterval(this.positionTimer);
            this.positionTimer = null;
        }

        if (isNativeAvailable && this.initialized) {
            nativeAudio.cleanup();
            this.initialized = false;
        }
    }

    /**
     * Dosya yükle
     * @param {string} filePath - Dosya yolu
     * @returns {boolean} Başarılı mı?
     */
    loadFile(filePath) {
        if (!isNativeAvailable || !this.initialized) {
            return false;
        }

        try {
            const result = nativeAudio.loadFile(filePath);
            const ok = (result === true) || (result && typeof result === 'object' && result.success === true);
            if (ok) {
                console.log('✓ Dosya yüklendi:', path.basename(filePath));
            } else if (result && typeof result === 'object' && result.error) {
                console.warn('⚠ Dosya yüklenemedi:', result.error, '|', path.basename(filePath));
            }
            return ok;
        } catch (error) {
            console.error('Dosya yükleme hatası:', error);
            return false;
        }
    }

    /**
     * True overlap crossfade to a new file.
     * @param {string} filePath
     * @param {number} durationMs
     * @returns {{success:boolean,error?:string|null}|boolean}
     */
    crossfadeTo(filePath, durationMs = 2000) {
        if (!isNativeAvailable || !this.initialized) {
            return false;
        }

        try {
            if (typeof nativeAudio.crossfadeTo !== 'function') {
                return false;
            }
            const res = nativeAudio.crossfadeTo(filePath, durationMs);
            const ok = (res === true) || (res && res.success);
            if (ok) {
                // Ensure position updates keep flowing after crossfadeTo (native side may already be playing).
                this.startPositionUpdates();
            }
            return res;
        } catch (error) {
            console.error('Crossfade hatası:', error);
            return false;
        }
    }

    /**
     * Oynat
     */
    play() {
        if (!isNativeAvailable || !this.initialized) return;

        nativeAudio.play();
        this.startPositionUpdates();
    }

    /**
     * Duraklat
     */
    pause() {
        if (!isNativeAvailable || !this.initialized) return;

        nativeAudio.pause();
        this.stopPositionUpdates();
    }

    /**
     * Durdur
     */
    stop() {
        if (!isNativeAvailable || !this.initialized) return;

        nativeAudio.stop();
        this.stopPositionUpdates();
    }

    /**
     * Pozisyon atla
     * @param {number} positionMs - Milisaniye cinsinden pozisyon
     */
    seek(positionMs) {
        if (!isNativeAvailable || !this.initialized) return;

        nativeAudio.seek(positionMs);
    }

    /**
     * Mevcut pozisyonu al
     * @returns {number} Milisaniye cinsinden pozisyon
     */
    getPosition() {
        if (!isNativeAvailable || !this.initialized) return 0;

        return nativeAudio.getPosition();
    }

    /**
     * Toplam süreyi al
     * @returns {number} Milisaniye cinsinden süre
     */
    getDuration() {
        if (!isNativeAvailable || !this.initialized) return 0;

        return nativeAudio.getDuration();
    }

    /**
     * Oynatılıyor mu?
     * @returns {boolean}
     */
    isPlaying() {
        if (!isNativeAvailable || !this.initialized) return false;

        return nativeAudio.isPlaying();
    }

    /**
     * Ses seviyesi ayarla
     * @param {number} volume - 0.0 - 1.0 arası
     */
    setVolume(volume) {
        if (!isNativeAvailable || !this.initialized) return;

        const clamped = Math.max(0, Math.min(1, volume));
        nativeAudio.setVolume(clamped);
    }

    /**
     * Ses seviyesini al
     * @returns {number} 0.0 - 1.0 arası
     */
    getVolume() {
        if (!isNativeAvailable || !this.initialized) return 1;

        return nativeAudio.getVolume();
    }

    // ============================================
    // DSP / EQ FUNCTIONS
    // ============================================

    /**
     * EQ bandı ayarla
     * @param {number} band - Band indeksi (0-31)
     * @param {number} gainDB - Kazanç (dB cinsinden, -15 ile +15 arası)
     */
    setEQBand(band, gainDB) {
        if (!isNativeAvailable || !this.initialized) return;
        nativeAudio.setEQBand(band, gainDB);
    }

    /**
     * Tüm EQ bandlarını sıfırla
     */
    resetEQ() {
        if (!isNativeAvailable || !this.initialized) return;
        if (typeof nativeAudio.resetEQ === 'function') {
            nativeAudio.resetEQ();
        }
    }

    /**
     * Tüm EQ bandlarını ayarla
     * @param {number[]} gains - 32 adet dB değeri
     */
    setEQBands(gains) {
        if (!isNativeAvailable || !this.initialized) return;

        nativeAudio.setEQBands(gains);
    }

    /**
     * Stereo genişliği ayarla
     * @param {number} width - 0.0 (mono) - 2.0 (extra wide)
     */
    setStereoWidth(width) {
        if (!isNativeAvailable || !this.initialized) return;

        nativeAudio.setStereoWidth(width);
    }

    /**
     * Balance ayarla
     * @param {number} balance - -100 (sol) ile +100 (sağ)
     */
    setBalance(balance) {
        if (!isNativeAvailable || !this.initialized) return;

        if (typeof nativeAudio.setBalance === 'function') {
            nativeAudio.setBalance(balance);
        }
    }

    /**
     * DSP'yi aç/kapat
     * @param {boolean} enabled
     */
    setDSPEnabled(enabled) {
        if (!isNativeAvailable || !this.initialized) return;

        if (typeof nativeAudio.setDSPEnabled === 'function') {
            nativeAudio.setDSPEnabled(enabled);
        }
    }

    /**
     * Bass ayarla (Aurivo Module)
     * @param {number} dB - -15 ile +15 dB
     */
    setBass(dB) {
        if (!isNativeAvailable || !this.initialized) return;

        if (typeof nativeAudio.setBass === 'function') {
            nativeAudio.setBass(dB);
        }
    }

    /**
     * Mid ayarla (Aurivo Module)
     * @param {number} dB - -15 ile +15 dB
     */
    setMid(dB) {
        if (!isNativeAvailable || !this.initialized) return;

        if (typeof nativeAudio.setMid === 'function') {
            nativeAudio.setMid(dB);
        }
    }

    /**
     * Treble ayarla (Aurivo Module)
     * @param {number} dB - -15 ile +15 dB
     */
    setTreble(dB) {
        if (!isNativeAvailable || !this.initialized) return;

        if (typeof nativeAudio.setTreble === 'function') {
            nativeAudio.setTreble(dB);
        } else {
            console.warn('setTreble fonksiyonu mevcut değil');
        }
    }

    /**
     * Compressor ayarla
     * @param {boolean} enabled
     * @param {number} thresh - threshold dB
     * @param {number} ratio - ratio
     * @param {number} att - attack ms
     * @param {number} rel - release ms
     * @param {number} makeup - makeup gain dB
     */
    setCompressor(enabled, thresh, ratio, att, rel, makeup) {
        if (!isNativeAvailable || !this.initialized) return;
        if (typeof nativeAudio.EnableCompressor === 'function') {
            nativeAudio.EnableCompressor(enabled);
            if (enabled) {
                if (typeof nativeAudio.SetCompressorThreshold === 'function') {
                    nativeAudio.SetCompressorThreshold(thresh);
                }
                if (typeof nativeAudio.SetCompressorRatio === 'function') {
                    nativeAudio.SetCompressorRatio(ratio);
                }
                if (typeof nativeAudio.SetCompressorAttack === 'function') {
                    nativeAudio.SetCompressorAttack(att);
                }
                if (typeof nativeAudio.SetCompressorRelease === 'function') {
                    nativeAudio.SetCompressorRelease(rel);
                }
                if (typeof nativeAudio.SetCompressorMakeupGain === 'function') {
                    nativeAudio.SetCompressorMakeupGain(makeup);
                }
            }
            return;
        }
        if (typeof nativeAudio.setCompressor === 'function') {
            nativeAudio.setCompressor(enabled, thresh, ratio, att, rel, makeup);
        }
    }

    enableCompressor(enabled) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.EnableCompressor === 'function') {
            return nativeAudio.EnableCompressor(enabled);
        }
        return false;
    }

    setCompressorThreshold(threshold) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetCompressorThreshold === 'function') {
            return nativeAudio.SetCompressorThreshold(threshold);
        }
        return false;
    }

    setCompressorRatio(ratio) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetCompressorRatio === 'function') {
            return nativeAudio.SetCompressorRatio(ratio);
        }
        return false;
    }

    setCompressorAttack(attack) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetCompressorAttack === 'function') {
            return nativeAudio.SetCompressorAttack(attack);
        }
        return false;
    }

    setCompressorRelease(release) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetCompressorRelease === 'function') {
            return nativeAudio.SetCompressorRelease(release);
        }
        return false;
    }

    setCompressorMakeupGain(makeup) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetCompressorMakeupGain === 'function') {
            return nativeAudio.SetCompressorMakeupGain(makeup);
        }
        return false;
    }

    setCompressorKnee(knee) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetCompressorKnee === 'function') {
            return nativeAudio.SetCompressorKnee(knee);
        }
        return false;
    }

    getCompressorGainReduction() {
        if (!isNativeAvailable || !this.initialized) return 0;
        if (typeof nativeAudio.GetGainReduction === 'function') {
            return nativeAudio.GetGainReduction();
        }
        return 0;
    }

    resetCompressor() {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.ResetCompressor === 'function') {
            return nativeAudio.ResetCompressor();
        }
        return false;
    }

    /**
     * Noise Gate ayarla
     * @param {boolean} enabled
     * @param {number} thresh - threshold dB
     * @param {number} att - attack ms
     * @param {number} rel - release ms
     */
    setGate(enabled, thresh, att, rel) {
        if (!isNativeAvailable || !this.initialized) return;
        if (typeof nativeAudio.setGate === 'function') {
            nativeAudio.setGate(enabled, thresh, att, rel);
        }
    }

    /**
     * Limiter ayarla
     * @param {boolean} enabled
     * @param {number} ceiling - ceiling dB
     * @param {number} rel - release ms
     */
    setLimiter(enabled, ceiling, rel) {
        if (!isNativeAvailable || !this.initialized) return;
        if (typeof nativeAudio.setLimiter === 'function') {
            nativeAudio.setLimiter(enabled, ceiling, rel);
        }
    }

    // ============================================
    // LIMITER INDIVIDUAL CONTROLS
    // ============================================
    EnableLimiter(enabled) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.EnableLimiter === 'function') {
            return nativeAudio.EnableLimiter(enabled);
        }
        return false;
    }

    SetLimiterCeiling(ceiling) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetLimiterCeiling === 'function') {
            return nativeAudio.SetLimiterCeiling(ceiling);
        }
        return false;
    }

    SetLimiterRelease(release) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetLimiterRelease === 'function') {
            return nativeAudio.SetLimiterRelease(release);
        }
        return false;
    }

    SetLimiterLookahead(lookahead) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetLimiterLookahead === 'function') {
            return nativeAudio.SetLimiterLookahead(lookahead);
        }
        return false;
    }

    SetLimiterGain(gain) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetLimiterGain === 'function') {
            return nativeAudio.SetLimiterGain(gain);
        }
        return false;
    }

    GetLimiterReduction() {
        if (!isNativeAvailable || !this.initialized) return 0;
        if (typeof nativeAudio.GetLimiterReduction === 'function') {
            return nativeAudio.GetLimiterReduction();
        }
        return 0;
    }

    ResetLimiter() {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.ResetLimiter === 'function') {
            return nativeAudio.ResetLimiter();
        }
        return false;
    }

    // ============================================
    // CROSSFEED CONTROLS
    // ============================================
    enableCrossfeed(enabled) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.EnableCrossfeed === 'function') {
            return nativeAudio.EnableCrossfeed(enabled);
        }
        return false;
    }

    setCrossfeedLevel(percent) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetCrossfeedLevel === 'function') {
            return nativeAudio.SetCrossfeedLevel(percent);
        }
        return false;
    }

    setCrossfeedDelay(ms) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetCrossfeedDelay === 'function') {
            return nativeAudio.SetCrossfeedDelay(ms);
        }
        return false;
    }

    setCrossfeedLowCut(hz) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetCrossfeedLowCut === 'function') {
            return nativeAudio.SetCrossfeedLowCut(hz);
        }
        return false;
    }

    setCrossfeedHighCut(hz) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetCrossfeedHighCut === 'function') {
            return nativeAudio.SetCrossfeedHighCut(hz);
        }
        return false;
    }

    setCrossfeedPreset(preset) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetCrossfeedPreset === 'function') {
            return nativeAudio.SetCrossfeedPreset(preset);
        }
        return false;
    }

    getCrossfeedParams() {
        if (!isNativeAvailable || !this.initialized) return null;
        if (typeof nativeAudio.GetCrossfeedParams === 'function') {
            return nativeAudio.GetCrossfeedParams();
        }
        return null;
    }

    resetCrossfeed() {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.ResetCrossfeed === 'function') {
            return nativeAudio.ResetCrossfeed();
        }
        return false;
    }

    // ============================================
    // BASS ENHANCER INDIVIDUAL CONTROLS
    // ============================================
    EnableBassEnhancer(enabled) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.EnableBassEnhancer === 'function') {
            return nativeAudio.EnableBassEnhancer(enabled);
        }
        return false;
    }

    SetBassEnhancerFrequency(frequency) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetBassEnhancerFrequency === 'function') {
            return nativeAudio.SetBassEnhancerFrequency(frequency);
        }
        return false;
    }

    SetBassEnhancerGain(gain) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetBassEnhancerGain === 'function') {
            return nativeAudio.SetBassEnhancerGain(gain);
        }
        return false;
    }

    SetBassEnhancerHarmonics(harmonics) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetBassEnhancerHarmonics === 'function') {
            return nativeAudio.SetBassEnhancerHarmonics(harmonics);
        }
        return false;
    }

    SetBassEnhancerWidth(width) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetBassEnhancerWidth === 'function') {
            return nativeAudio.SetBassEnhancerWidth(width);
        }
        return false;
    }

    SetBassEnhancerMix(mix) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetBassEnhancerMix === 'function') {
            return nativeAudio.SetBassEnhancerMix(mix);
        }
        return false;
    }

    ResetBassEnhancer() {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.ResetBassEnhancer === 'function') {
            return nativeAudio.ResetBassEnhancer();
        }
        return false;
    }

    // ============================================
    // NOISE GATE INDIVIDUAL CONTROLS
    // ============================================
    EnableNoiseGate(enabled) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.EnableNoiseGate === 'function') {
            return nativeAudio.EnableNoiseGate(enabled);
        }
        return false;
    }

    SetNoiseGateThreshold(threshold) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetNoiseGateThreshold === 'function') {
            return nativeAudio.SetNoiseGateThreshold(threshold);
        }
        return false;
    }

    SetNoiseGateAttack(attack) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetNoiseGateAttack === 'function') {
            return nativeAudio.SetNoiseGateAttack(attack);
        }
        return false;
    }

    SetNoiseGateHold(hold) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetNoiseGateHold === 'function') {
            return nativeAudio.SetNoiseGateHold(hold);
        }
        return false;
    }

    SetNoiseGateRelease(release) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetNoiseGateRelease === 'function') {
            return nativeAudio.SetNoiseGateRelease(release);
        }
        return false;
    }

    SetNoiseGateRange(range) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetNoiseGateRange === 'function') {
            return nativeAudio.SetNoiseGateRange(range);
        }
        return false;
    }

    GetNoiseGateStatus() {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.GetNoiseGateStatus === 'function') {
            return nativeAudio.GetNoiseGateStatus();
        }
        return false;
    }

    ResetNoiseGate() {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.ResetNoiseGate === 'function') {
            return nativeAudio.ResetNoiseGate();
        }
        return false;
    }

    // ============== DE-ESSER ==============
    EnableDeEsser(enable) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.EnableDeEsser === 'function') {
            return nativeAudio.EnableDeEsser(enable);
        }
        return false;
    }

    SetDeEsserFrequency(frequency) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetDeEsserFrequency === 'function') {
            return nativeAudio.SetDeEsserFrequency(frequency);
        }
        return false;
    }

    SetDeEsserThreshold(threshold) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetDeEsserThreshold === 'function') {
            return nativeAudio.SetDeEsserThreshold(threshold);
        }
        return false;
    }

    SetDeEsserRatio(ratio) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetDeEsserRatio === 'function') {
            return nativeAudio.SetDeEsserRatio(ratio);
        }
        return false;
    }

    SetDeEsserRange(range) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetDeEsserRange === 'function') {
            return nativeAudio.SetDeEsserRange(range);
        }
        return false;
    }

    SetDeEsserListenMode(listen) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetDeEsserListenMode === 'function') {
            return nativeAudio.SetDeEsserListenMode(listen);
        }
        return false;
    }

    GetDeEsserActivity() {
        if (!isNativeAvailable || !this.initialized) return 0;
        if (typeof nativeAudio.GetDeEsserActivity === 'function') {
            return nativeAudio.GetDeEsserActivity();
        }
        return 0;
    }

    ResetDeEsser() {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.ResetDeEsser === 'function') {
            return nativeAudio.ResetDeEsser();
        }
        return false;
    }

    // ============== EXCITER ==============
    EnableExciter(enable) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.EnableExciter === 'function') {
            return nativeAudio.EnableExciter(enable);
        }
        return false;
    }

    SetExciterAmount(amount) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetExciterAmount === 'function') {
            return nativeAudio.SetExciterAmount(amount);
        }
        return false;
    }

    SetExciterFrequency(frequency) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetExciterFrequency === 'function') {
            return nativeAudio.SetExciterFrequency(frequency);
        }
        return false;
    }

    SetExciterHarmonics(harmonics) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetExciterHarmonics === 'function') {
            return nativeAudio.SetExciterHarmonics(harmonics);
        }
        return false;
    }

    SetExciterMix(mix) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetExciterMix === 'function') {
            return nativeAudio.SetExciterMix(mix);
        }
        return false;
    }

    SetExciterType(type) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetExciterType === 'function') {
            return nativeAudio.SetExciterType(type);
        }
        return false;
    }

    ResetExciter() {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.ResetExciter === 'function') {
            return nativeAudio.ResetExciter();
        }
        return false;
    }

    // ============================================
    // STEREO WIDENER
    // ============================================

    EnableStereoWidener(enabled) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.EnableStereoWidener === 'function') {
            return nativeAudio.EnableStereoWidener(enabled);
        }
        return false;
    }

    SetStereoWidth(percent) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetStereoWidth === 'function') {
            return nativeAudio.SetStereoWidth(percent);
        }
        return false;
    }

    SetStereoBassCutoff(hz) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetStereoBassCutoff === 'function') {
            return nativeAudio.SetStereoBassCutoff(hz);
        }
        return false;
    }

    SetStereoDelay(ms) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetStereoDelay === 'function') {
            return nativeAudio.SetStereoDelay(ms);
        }
        return false;
    }

    SetStereoBalance(value) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetStereoBalance === 'function') {
            return nativeAudio.SetStereoBalance(value);
        }
        return false;
    }

    SetStereoMonoLow(enabled) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetStereoMonoLow === 'function') {
            return nativeAudio.SetStereoMonoLow(enabled);
        }
        return false;
    }

    GetStereoPhase() {
        if (!isNativeAvailable || !this.initialized) return 0.0;
        if (typeof nativeAudio.GetStereoPhase === 'function') {
            return nativeAudio.GetStereoPhase();
        }
        return 0.0;
    }

    ResetStereoWidener() {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.ResetStereoWidener === 'function') {
            return nativeAudio.ResetStereoWidener();
        }
        return false;
    }

    // ============== ECHO EFFECT ==============

    /**
     * Echo efekti etkinleştir/devre dışı bırak
     * @param {boolean} enabled
     */
    EnableEchoEffect(enabled) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.EnableEchoEffect === 'function') {
            return nativeAudio.EnableEchoEffect(enabled);
        }
        return false;
    }

    /**
     * Echo delay süresini ayarla
     * @param {number} delayMs - 1-2000 ms
     */
    SetEchoDelayTime(delayMs) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetEchoDelayTime === 'function') {
            return nativeAudio.SetEchoDelayTime(delayMs);
        }
        return false;
    }

    /**
     * Echo feedback ayarla
     * @param {number} feedback - 0-95 %
     */
    SetEchoFeedback(feedback) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetEchoFeedback === 'function') {
            return nativeAudio.SetEchoFeedback(feedback);
        }
        return false;
    }

    /**
     * Echo wet mix ayarla
     * @param {number} wetMix - 0-100 %
     */
    SetEchoWetMix(wetMix) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetEchoWetMix === 'function') {
            return nativeAudio.SetEchoWetMix(wetMix);
        }
        return false;
    }

    /**
     * Echo dry mix ayarla
     * @param {number} dryMix - 0-100 %
     */
    SetEchoDryMix(dryMix) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetEchoDryMix === 'function') {
            return nativeAudio.SetEchoDryMix(dryMix);
        }
        return false;
    }

    /**
     * Echo stereo/ping-pong modu ayarla
     * @param {boolean} stereo
     */
    SetEchoStereoMode(stereo) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetEchoStereoMode === 'function') {
            return nativeAudio.SetEchoStereoMode(stereo);
        }
        return false;
    }

    /**
     * Echo low cut filtresi ayarla
     * @param {number} freq - 20-500 Hz
     */
    SetEchoLowCut(freq) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetEchoLowCut === 'function') {
            return nativeAudio.SetEchoLowCut(freq);
        }
        return false;
    }

    /**
     * Echo high cut filtresi ayarla
     * @param {number} freq - 2000-16000 Hz
     */
    SetEchoHighCut(freq) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetEchoHighCut === 'function') {
            return nativeAudio.SetEchoHighCut(freq);
        }
        return false;
    }

    /**
     * Echo tempo senkronizasyonu ayarla
     * @param {number} bpm - BPM değeri
     * @param {number} division - Nota bölümü (0.25, 0.5, 1.0, etc.)
     */
    SetEchoTempo(bpm, division) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetEchoTempo === 'function') {
            return nativeAudio.SetEchoTempo(bpm, division);
        }
        return false;
    }

    /**
     * Echo ayarlarını sıfırla
     */
    ResetEchoEffect() {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.ResetEchoEffect === 'function') {
            return nativeAudio.ResetEchoEffect();
        }
        return false;
    }

    // ============== CONVOLUTION REVERB ==============

    /**
     * Convolution Reverb etkinleştir/devre dışı bırak
     * @param {boolean} enabled
     */
    EnableConvolutionReverb(enabled) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.EnableConvolutionReverb === 'function') {
            return nativeAudio.EnableConvolutionReverb(enabled);
        }
        return false;
    }

    /**
     * IR dosyası yükle
     * @param {string} filepath - IR dosya yolu (.wav)
     */
    LoadIRFile(filepath) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.LoadIRFile === 'function') {
            return nativeAudio.LoadIRFile(filepath);
        }
        return false;
    }

    /**
     * Convolution Reverb oda boyutu ayarla
     * @param {number} roomSize - 0-100 %
     */
    SetConvReverbRoomSize(roomSize) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetConvReverbRoomSize === 'function') {
            return nativeAudio.SetConvReverbRoomSize(roomSize);
        }
        return false;
    }

    /**
     * Convolution Reverb decay süresi ayarla
     * @param {number} decay - 0.1-10 saniye
     */
    SetConvReverbDecay(decay) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetConvReverbDecay === 'function') {
            return nativeAudio.SetConvReverbDecay(decay);
        }
        return false;
    }

    /**
     * Convolution Reverb damping ayarla
     * @param {number} damping - 0.0-1.0
     */
    SetConvReverbDamping(damping) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetConvReverbDamping === 'function') {
            return nativeAudio.SetConvReverbDamping(damping);
        }
        return false;
    }

    /**
     * Convolution Reverb wet mix ayarla
     * @param {number} wetMix - 0-100 %
     */
    SetConvReverbWetMix(wetMix) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetConvReverbWetMix === 'function') {
            return nativeAudio.SetConvReverbWetMix(wetMix);
        }
        return false;
    }

    /**
     * Convolution Reverb dry mix ayarla
     * @param {number} dryMix - 0-100 %
     */
    SetConvReverbDryMix(dryMix) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetConvReverbDryMix === 'function') {
            return nativeAudio.SetConvReverbDryMix(dryMix);
        }
        return false;
    }

    /**
     * Convolution Reverb pre-delay ayarla
     * @param {number} preDelay - 0-200 ms
     */
    SetConvReverbPreDelay(preDelay) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetConvReverbPreDelay === 'function') {
            return nativeAudio.SetConvReverbPreDelay(preDelay);
        }
        return false;
    }

    /**
     * Convolution Reverb oda tipi ayarla
     * @param {number} roomType - 0-7 (0=Small, 1=Medium, 2=Large, 3=Hall, 4=Cathedral, 5=Plate, 6=Spring, 7=Chamber)
     */
    SetConvReverbRoomType(roomType) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetConvReverbRoomType === 'function') {
            return nativeAudio.SetConvReverbRoomType(roomType);
        }
        return false;
    }

    /**
     * IR preset listesi al
     * @returns {Array} - Preset listesi
     */
    GetIRPresets() {
        if (!isNativeAvailable || !this.initialized) return [];
        if (typeof nativeAudio.GetIRPresets === 'function') {
            return nativeAudio.GetIRPresets();
        }
        return [];
    }

    /**
     * Convolution Reverb ayarlarını sıfırla
     */
    ResetConvolutionReverb() {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.ResetConvolutionReverb === 'function') {
            return nativeAudio.ResetConvolutionReverb();
        }
        return false;
    }

    /**
     * Echo ayarla (eski basit API - geriye uyumluluk)
     * @param {boolean} enabled
     * @param {number} delay - delay ms
     * @param {number} feedback - 0-1
     * @param {number} mix - 0-1
     */
    setEcho(enabled, delay, feedback, mix) {
        if (!isNativeAvailable || !this.initialized) return;
        if (typeof nativeAudio.setEcho === 'function') {
            nativeAudio.setEcho(enabled, delay, feedback, mix);
        }
    }

    /**
     * Bass Boost DSP ayarla
     * @param {boolean} enabled
     * @param {number} gain - dB
     * @param {number} freq - Hz
     */
    setBassBoostDsp(enabled, gain, freq) {
        if (!isNativeAvailable || !this.initialized) return;
        if (typeof nativeAudio.setBassBoostDsp === 'function') {
            nativeAudio.setBassBoostDsp(enabled, gain, freq);
        }
    }

    setPEQ(band, enabled, freq, gain, q) {
        if (!isNativeAvailable || !this.initialized) return;
        if (typeof nativeAudio.setPEQ === 'function') {
            nativeAudio.setPEQ(band, enabled, freq, gain, q);
        }
    }

    setPEQFilterType(band, filterType) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.setPEQFilterType === 'function') {
            return nativeAudio.setPEQFilterType(band, filterType);
        }
        return false;
    }

    getPEQBand(band) {
        if (!isNativeAvailable || !this.initialized) return null;
        if (typeof nativeAudio.getPEQBand === 'function') {
            return nativeAudio.getPEQBand(band);
        }
        return null;
    }

    // ============================================
    // AUTO GAIN / NORMALIZE
    // ============================================
    setAutoGainEnabled(enabled) {
        if (!isNativeAvailable || !this.initialized) return;
        if (typeof nativeAudio.setAutoGainEnabled === 'function') {
            nativeAudio.setAutoGainEnabled(enabled);
        }
    }

    setAutoGainTarget(dBFS) {
        if (!isNativeAvailable || !this.initialized) return;
        if (typeof nativeAudio.setAutoGainTarget === 'function') {
            nativeAudio.setAutoGainTarget(dBFS);
        }
    }

    setAutoGainMaxGain(dB) {
        if (!isNativeAvailable || !this.initialized) return;
        if (typeof nativeAudio.setAutoGainMaxGain === 'function') {
            nativeAudio.setAutoGainMaxGain(dB);
        }
    }

    setAutoGainAttack(ms) {
        if (!isNativeAvailable || !this.initialized) return;
        if (typeof nativeAudio.setAutoGainAttack === 'function') {
            nativeAudio.setAutoGainAttack(ms);
        }
    }

    setAutoGainRelease(ms) {
        if (!isNativeAvailable || !this.initialized) return;
        if (typeof nativeAudio.setAutoGainRelease === 'function') {
            nativeAudio.setAutoGainRelease(ms);
        }
    }

    setAutoGainMode(mode) {
        if (!isNativeAvailable || !this.initialized) return;
        if (typeof nativeAudio.setAutoGainMode === 'function') {
            nativeAudio.setAutoGainMode(mode);
        }
    }

    updateAutoGain() {
        if (!isNativeAvailable || !this.initialized) return;
        if (typeof nativeAudio.updateAutoGain === 'function') {
            nativeAudio.updateAutoGain();
        }
    }

    normalizeAudio(targetDB) {
        if (!isNativeAvailable || !this.initialized) return 0;
        if (typeof nativeAudio.normalizeAudio === 'function') {
            return nativeAudio.normalizeAudio(targetDB);
        }
        return 0;
    }

    resetAutoGain() {
        if (!isNativeAvailable || !this.initialized) return;
        if (typeof nativeAudio.resetAutoGain === 'function') {
            nativeAudio.resetAutoGain();
        }
    }

    getAutoGainStats() {
        if (!isNativeAvailable || !this.initialized) return null;
        if (typeof nativeAudio.getAutoGainStats === 'function') {
            return nativeAudio.getAutoGainStats();
        }
        return null;
    }

    getPeakLevel() {
        if (!isNativeAvailable || !this.initialized) return -96;
        if (typeof nativeAudio.getPeakLevel === 'function') {
            return nativeAudio.getPeakLevel();
        }
        return -96;
    }

    getAutoGainReduction() {
        if (!isNativeAvailable || !this.initialized) return 0;
        if (typeof nativeAudio.getAutoGainReduction === 'function') {
            return nativeAudio.getAutoGainReduction();
        }
        return 0;
    }

    // ============================================
    // TRUE PEAK LIMITER
    // ============================================
    setTruePeakEnabled(enabled) {
        if (!isNativeAvailable || !this.initialized) return;
        if (typeof nativeAudio.setTruePeakEnabled === 'function') {
            nativeAudio.setTruePeakEnabled(enabled);
        }
    }

    setTruePeakCeiling(ceiling) {
        if (!isNativeAvailable || !this.initialized) return;
        if (typeof nativeAudio.setTruePeakCeiling === 'function') {
            nativeAudio.setTruePeakCeiling(ceiling);
        }
    }

    setTruePeakRelease(release) {
        if (!isNativeAvailable || !this.initialized) return;
        if (typeof nativeAudio.setTruePeakRelease === 'function') {
            nativeAudio.setTruePeakRelease(release);
        }
    }

    setTruePeakLookahead(lookahead) {
        if (!isNativeAvailable || !this.initialized) return;
        if (typeof nativeAudio.setTruePeakLookahead === 'function') {
            nativeAudio.setTruePeakLookahead(lookahead);
        }
    }

    setTruePeakOversampling(rate) {
        if (!isNativeAvailable || !this.initialized) return;
        if (typeof nativeAudio.setTruePeakOversampling === 'function') {
            nativeAudio.setTruePeakOversampling(rate);
        }
    }

    setTruePeakLinkChannels(link) {
        if (!isNativeAvailable || !this.initialized) return;
        if (typeof nativeAudio.setTruePeakLinkChannels === 'function') {
            nativeAudio.setTruePeakLinkChannels(link);
        }
    }

    getTruePeakMeter() {
        if (!isNativeAvailable || !this.initialized) return null;
        if (typeof nativeAudio.getTruePeakMeter === 'function') {
            return nativeAudio.getTruePeakMeter();
        }
        return null;
    }

    resetTruePeakClipping() {
        if (!isNativeAvailable || !this.initialized) return;
        if (typeof nativeAudio.resetTruePeakClipping === 'function') {
            nativeAudio.resetTruePeakClipping();
        }
    }

    resetTruePeakLimiter() {
        if (!isNativeAvailable || !this.initialized) return;
        if (typeof nativeAudio.resetTruePeakLimiter === 'function') {
            nativeAudio.resetTruePeakLimiter();
        }
    }

    isTruePeakEnabled() {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.isTruePeakEnabled === 'function') {
            return nativeAudio.isTruePeakEnabled();
        }
        return false;
    }

    /**
     * Stereo Expander ayarla
     * @param {number} percent - 0 ile 200 arası (100 = normal)
     */
    setStereoExpander(percent) {
        if (!isNativeAvailable || !this.initialized) return;

        if (typeof nativeAudio.setStereoExpander === 'function') {
            nativeAudio.setStereoExpander(percent);
        } else {
            console.warn('setStereoExpander fonksiyonu mevcut değil');
        }
    }

    /**
     * Tone parametrelerini ayarla (Bass/Mid/Treble)
     * @param {number} bassDB - Bas kazancı (-15 ile +15 dB)
     * @param {number} midDB - Orta kazancı (-15 ile +15 dB)
     * @param {number} trebleDB - Tiz kazancı (-15 ile +15 dB)
     */
    setToneParams(bassDB, midDB, trebleDB) {
        if (!isNativeAvailable || !this.initialized) return;

        // Yeni API: Ayrı fonksiyonlar kullan
        this.setBass(bassDB);
        this.setMid(midDB);
        this.setTreble(trebleDB);
    }

    /**
     * Reverb parametrelerini ayarla
     * @param {number} roomSize - 0-3000 ms
     * @param {number} damping - 0-1
     * @param {number} wetDry - -96 ile 0 dB
     */
    setReverbParams(roomSize, damping, wetDry) {
        if (!isNativeAvailable || !this.initialized) return;
        if (typeof nativeAudio.setReverbRoomSize === 'function') {
            nativeAudio.setReverbRoomSize(roomSize);
        }
        if (typeof nativeAudio.setReverbDamping === 'function') {
            nativeAudio.setReverbDamping(damping);
        }
        if (typeof nativeAudio.setReverbWetDry === 'function') {
            nativeAudio.setReverbWetDry(wetDry);
        }
    }

    /**
     * Reverb aç/kapat
     * @param {boolean} enabled
     */
    setReverbEnabled(enabled) {
        if (!isNativeAvailable || !this.initialized) return;
        if (typeof nativeAudio.setReverbEnabled === 'function') {
            nativeAudio.setReverbEnabled(enabled);
        } else {
            console.warn('setReverbEnabled fonksiyonu mevcut değil');
        }
    }

    /**
     * Reverb Room Size ayarla
     * @param {number} ms - 0.001 ile 3000 ms
     */
    setReverbRoomSize(ms) {
        if (!isNativeAvailable || !this.initialized) return;
        if (typeof nativeAudio.setReverbRoomSize === 'function') {
            nativeAudio.setReverbRoomSize(ms);
        }
    }

    /**
     * Reverb Damping ayarla
     * @param {number} value - 0 ile 1
     */
    setReverbDamping(value) {
        if (!isNativeAvailable || !this.initialized) return;
        if (typeof nativeAudio.setReverbDamping === 'function') {
            nativeAudio.setReverbDamping(value);
        }
    }

    /**
     * Reverb Wet/Dry ayarla
     * @param {number} dB - -96 ile 0 dB
     */
    setReverbWetDry(dB) {
        if (!isNativeAvailable || !this.initialized) return;
        if (typeof nativeAudio.setReverbWetDry === 'function') {
            nativeAudio.setReverbWetDry(dB);
        }
    }

    /**
     * Reverb HF Ratio ayarla
     * @param {number} ratio - 0.001 ile 0.999
     */
    setReverbHFRatio(ratio) {
        if (!isNativeAvailable || !this.initialized) return;
        if (typeof nativeAudio.setReverbHFRatio === 'function') {
            nativeAudio.setReverbHFRatio(ratio);
        }
    }

    /**
     * Reverb Input Gain ayarla
     * @param {number} dB - -96 ile 0 dB
     */
    setReverbInputGain(dB) {
        if (!isNativeAvailable || !this.initialized) return;
        if (typeof nativeAudio.setReverbInputGain === 'function') {
            nativeAudio.setReverbInputGain(dB);
        }
    }

    // ============================================
    // VISUALIZER DATA
    // ============================================

    /**
     * FFT verisi al (tam spektrum)
     * @returns {number[]} FFT değerleri
     */
    getFFTData() {
        if (!isNativeAvailable || !this.initialized) return [];

        return nativeAudio.getFFTData();
    }

    /**
     * Spektrum bantları al (visualizer için)
     * @param {number} numBands - Bant sayısı (varsayılan: 64)
     * @returns {number[]} Bant değerleri
     */
    getSpectrumBands(numBands = 64) {
        if (!isNativeAvailable || !this.initialized) return new Array(numBands).fill(0);

        return nativeAudio.getSpectrumBands(numBands);
    }

    /**
     * Ham PCM float verisi al (visualizer feed için)
     * @param {number} framesPerChannel - kanal başına frame sayısı
     * @returns {{channels:number, data:Float32Array}} interleaved PCM (stereo ise LRLR...)
     */
    getPCMData(framesPerChannel = 1024) {
        if (!isNativeAvailable || !this.initialized) return { channels: 0, data: new Float32Array(0) };
        if (typeof nativeAudio.getPCMData !== 'function') return { channels: 0, data: new Float32Array(0) };

        const res = nativeAudio.getPCMData(framesPerChannel);
        if (res && typeof res === 'object' && res.data instanceof Float32Array) {
            const ch = (typeof res.channels === 'number') ? res.channels : 0;
            return { channels: ch, data: res.data };
        }

        // Geriye dönük: native eski sürümde doğrudan array döndürebilir.
        const floatArray = (res instanceof Float32Array) ? res : Float32Array.from(res || []);
        const channels = (floatArray.length % 2 === 0 && floatArray.length > 0) ? 2 : 1;
        return { channels, data: floatArray };
    }

    // ============================================
    // BASS MONO CONTROLS
    // ============================================
    EnableBassMono(enabled) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.EnableBassMono === 'function') {
            return nativeAudio.EnableBassMono(enabled);
        }
        return false;
    }

    SetBassMonoCutoff(hz) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetBassMonoCutoff === 'function') {
            return nativeAudio.SetBassMonoCutoff(hz);
        }
        return false;
    }

    SetBassMonoSlope(slope) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetBassMonoSlope === 'function') {
            return nativeAudio.SetBassMonoSlope(slope);
        }
        return false;
    }

    SetBassMonoStereoWidth(width) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetBassMonoStereoWidth === 'function') {
            return nativeAudio.SetBassMonoStereoWidth(width);
        }
        return false;
    }

    ResetBassMono() {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.ResetBassMono === 'function') {
            return nativeAudio.ResetBassMono();
        }
        return false;
    }

    // ============================================
    // DYNAMIC EQ CONTROLS
    // ============================================
    enableDynamicEQ(enabled) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.EnableDynamicEQ === 'function') {
            return nativeAudio.EnableDynamicEQ(enabled);
        }
        return false;
    }

    setDynamicEQFrequency(hz) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetDynamicEQFrequency === 'function') {
            return nativeAudio.SetDynamicEQFrequency(hz);
        }
        return false;
    }

    setDynamicEQGain(dB) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetDynamicEQGain === 'function') {
            return nativeAudio.SetDynamicEQGain(dB);
        }
        return false;
    }

    setDynamicEQQ(q) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetDynamicEQQ === 'function') {
            return nativeAudio.SetDynamicEQQ(q);
        }
        return false;
    }

    setDynamicEQThreshold(dB) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetDynamicEQThreshold === 'function') {
            return nativeAudio.SetDynamicEQThreshold(dB);
        }
        return false;
    }

    setDynamicEQAttack(ms) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetDynamicEQAttack === 'function') {
            return nativeAudio.SetDynamicEQAttack(ms);
        }
        return false;
    }

    setDynamicEQRelease(ms) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetDynamicEQRelease === 'function') {
            return nativeAudio.SetDynamicEQRelease(ms);
        }
        return false;
    }

    setDynamicEQRange(dB) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.SetDynamicEQRange === 'function') {
            return nativeAudio.SetDynamicEQRange(dB);
        }
        return false;
    }

    // ============================================
    // TAPE SATURATION
    // ============================================
    enableTapeSaturation(enabled) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.enableTapeSaturation === 'function') {
            return nativeAudio.enableTapeSaturation(enabled);
        }
        return false;
    }

    setTapeDrive(dB) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.setTapeDrive === 'function') {
            return nativeAudio.setTapeDrive(dB);
        }
        return false;
    }

    setTapeMix(percent) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.setTapeMix === 'function') {
            return nativeAudio.setTapeMix(percent);
        }
        return false;
    }

    setTapeTone(value) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.setTapeTone === 'function') {
            return nativeAudio.setTapeTone(value);
        }
        return false;
    }

    setTapeOutput(dB) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.setTapeOutput === 'function') {
            return nativeAudio.setTapeOutput(dB);
        }
        return false;
    }

    setTapeMode(mode) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.setTapeMode === 'function') {
            return nativeAudio.setTapeMode(mode);
        }
        return false;
    }

    setTapeHiss(percent) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.setTapeHiss === 'function') {
            return nativeAudio.setTapeHiss(percent);
        }
        return false;
    }

    // ============================================
    // BIT-DEPTH / DITHER
    // ============================================
    enableBitDepthDither(enabled) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.enableBitDepthDither === 'function') {
            return nativeAudio.enableBitDepthDither(enabled);
        }
        return false;
    }

    setBitDepth(bits) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.setBitDepth === 'function') {
            return nativeAudio.setBitDepth(bits);
        }
        return false;
    }

    setDitherType(type) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.setDitherType === 'function') {
            return nativeAudio.setDitherType(type);
        }
        return false;
    }

    setNoiseShaping(shape) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.setNoiseShaping === 'function') {
            return nativeAudio.setNoiseShaping(shape);
        }
        return false;
    }

    setDownsampleFactor(factor) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.setDownsampleFactor === 'function') {
            return nativeAudio.setDownsampleFactor(factor);
        }
        return false;
    }

    setBitDitherMix(percent) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.setBitDitherMix === 'function') {
            return nativeAudio.setBitDitherMix(percent);
        }
        return false;
    }

    setBitDitherOutput(dB) {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.setBitDitherOutput === 'function') {
            return nativeAudio.setBitDitherOutput(dB);
        }
        return false;
    }

    resetBitDepthDither() {
        if (!isNativeAvailable || !this.initialized) return false;
        if (typeof nativeAudio.resetBitDepthDither === 'function') {
            return nativeAudio.resetBitDepthDither();
        }
        return false;
    }

    // ============================================
    // CALLBACKS
    // ============================================

    /**
     * Pozisyon güncelleme callback'i ayarla
     * @param {function} callback - (positionMs, durationMs) => void
     */
    onPositionUpdate(callback) {
        this.callbacks.onPositionUpdate = callback;
    }

    /**
     * Şarkı bittiğinde callback
     * @param {function} callback - () => void
     */
    onPlaybackEnd(callback) {
        this.callbacks.onPlaybackEnd = callback;
    }

    /**
     * Hata callback'i
     * @param {function} callback - (error) => void
     */
    onError(callback) {
        this.callbacks.onError = callback;
    }

    // ============================================
    // INTERNAL
    // ============================================

    startPositionUpdates() {
        if (this.positionTimer) return;

        this.positionTimer = setInterval(() => {
            if (this.callbacks.onPositionUpdate && this.isPlaying()) {
                const pos = this.getPosition();
                const dur = this.getDuration();
                this.callbacks.onPositionUpdate(pos, dur);
            }

            // Şarkı bitti mi kontrol et
            const dur = this.getDuration();
            if (dur > 250 && !this.isPlaying() && this.getPosition() >= dur - 100) {
                if (this.callbacks.onPlaybackEnd) {
                    this.callbacks.onPlaybackEnd();
                }
                this.stopPositionUpdates();
            }
        }, 100);
    }

    stopPositionUpdates() {
        if (this.positionTimer) {
            clearInterval(this.positionTimer);
            this.positionTimer = null;
        }
    }

    /**
     * Native audio mevcut mu?
     * @returns {boolean}
     */
    static isAvailable() {
        tryLoadNativeAddon();
        return isNativeAvailable;
    }
}

// Singleton instance
const audioEngine = new AurivoAudioEngine();

module.exports = {
    AurivoAudioEngine,
    audioEngine,
    get isNativeAvailable() { return isNativeAvailable; },
    get loadedAddonPath() { return loadedAddonPath; },
    get lastNativeLoadError() { return lastNativeLoadError; },
    _tryLoadNativeAddon: tryLoadNativeAddon
};
