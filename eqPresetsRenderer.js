/* global aurivo */

const PREVIEW_W = 280;
const PREVIEW_W_WHEEL = 312;
const PREVIEW_H = 88;
const PREVIEW_ZOOM_X = 2.0; // %100 yatay zoom (domain daraltma)
const PREVIEW_ZOOM_Y = 2.0; // %100 dikey zoom (genlik artırma)
const PREVIEW_Y_OFFSET = -7; // çizgileri tabandan biraz yukarı taşı
const PAGE_SIZE = 32;
const PRESET_PERF = {
    lowPower: false,
    autoLowPower: false,
    reason: 'default'
};
const PRESET_PROFILE_STORAGE_KEY = 'aurivo_eq_presets_preview_profile_v1';

function tSync(key, vars, fallback) {
    try {
        const v = window.i18n?.tSync?.(key, vars);
        if (typeof v === 'string' && v && v !== key) return v;
    } catch {
        // yoksay
    }
    return fallback ?? String(key);
}

const state = {
    all: [],
    filtered: [],
    selected: null,
    renderedCount: 0,
    bandsCache: new Map(),
    loadingBands: new Set(),
    searchTimer: null,
    featured: [],
    selectedGroup: 'all',
    totalCount: 0,
    previewProfile: 'balanced',
    previewStyle: 'graphic',
    previewDetail: 'sharp',
    previewHydrationObserver: null
};

function normalizeHaystack(preset) {
    const a = preset?.name || '';
    const b = preset?.filename || '';
    const c = preset?.description || '';
    return `${a} ${b} ${c}`.toLowerCase();
}

function computeGroupsForPreset(preset) {
    const hay = normalizeHaystack(preset);
    const groups = new Set();

    // Düz / kapalı / nötr
    if (/(^|\s)(flat|neutral|reference|default|eq[_\s-]?off|off)(\s|$)/.test(hay) || /d\s*ü\s*z/.test(hay)) {
        groups.add('flat');
    }

    // Bas
    if (/(^|\s)(bass|sub\s*-?bass|low\s*end|xbass|bass[_\s-]?boost)(\s|$)/.test(hay)) {
        groups.add('bass');
    }

    // Tiz / parlak
    if (/(^|\s)(treble|bright|sparkle|air|high\s*boost|treble[_\s-]?boost)(\s|$)/.test(hay) || /tiz/.test(hay)) {
        groups.add('treble');
    }

    // Vokal / konuşma
    if (/(^|\s)(vocal|voice|speech)(\s|$)/.test(hay) || /vokal/.test(hay)) {
        groups.add('vocal');
    }

    // Caz
    if (/(^|\s)(jazz)(\s|$)/.test(hay) || /caz/.test(hay)) {
        groups.add('jazz');
    }

    // Klasik
    if (/(^|\s)(classical|orchestra|orchestral)(\s|$)/.test(hay) || /klasik/.test(hay)) {
        groups.add('classical');
    }

    // Elektronik
    if (/(^|\s)(electronic|edm|dance|club|techno|house|trance)(\s|$)/.test(hay) || /elektronik/.test(hay)) {
        groups.add('electronic');
    }

    // Pop / Rock
    if (/(^|\s)(pop)(\s|$)/.test(hay)) groups.add('pop');
    if (/(^|\s)(rock|metal|guitar)(\s|$)/.test(hay)) groups.add('rock');

    // V-Şekil
    if (/(v\s*-?\s*shape|vshape)/.test(hay)) groups.add('vshape');

    if (groups.size === 0) groups.add('other');
    return Array.from(groups);
}

function tagPreset(preset) {
    if (!preset || typeof preset !== 'object') return preset;
    if (Array.isArray(preset.groups) && preset.groups.length) return preset;
    return { ...preset, groups: computeGroupsForPreset(preset) };
}

function filterByGroup(list) {
    const group = state.selectedGroup || 'all';
    if (group === 'all') return list;
    return (list || []).filter(p => Array.isArray(p?.groups) && p.groups.includes(group));
}

function updateStatusForList(list) {
    const group = state.selectedGroup || 'all';
    const shown = Array.isArray(list) ? list.length : 0;
    const total = state.totalCount || 0;
    const groupLabel = tSync(`eqPresets.groups.${group}`, null, group);
    setStatus(tSync('eqPresets.status', { shown, total, group: groupLabel }, `Gösterilen: ${shown} / ${total} • Grup: ${groupLabel}`));
}

function syncActiveGroupChip() {
    const chips = document.querySelectorAll('.preset-group-chip');
    chips.forEach((chip) => {
        const isActive = chip?.dataset?.group === (state.selectedGroup || 'all');
        chip.classList.toggle('is-active', isActive);
        chip.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
}

function makeBandsFromPoints(points) {
    // noktalar: [{ i: 0..31, v: -12..12 }]
    const out = new Array(32).fill(0);
    if (!Array.isArray(points) || points.length === 0) return out;

    const sorted = [...points]
        .filter(p => p && Number.isFinite(p.i) && Number.isFinite(p.v))
        .map(p => ({ i: clamp(Math.round(p.i), 0, 31), v: clamp(Number(p.v), -12, 12) }))
        .sort((a, b) => a.i - b.i);

    if (sorted.length === 0) return out;

    // İlk nokta öncesini doldur
    for (let i = 0; i <= sorted[0].i; i++) out[i] = sorted[0].v;

    // Noktalar arasında doğrusal interpolasyon
    for (let p = 0; p < sorted.length - 1; p++) {
        const a = sorted[p];
        const b = sorted[p + 1];
        const span = Math.max(1, b.i - a.i);
        for (let i = a.i; i <= b.i; i++) {
            const t = (i - a.i) / span;
            out[i] = a.v + (b.v - a.v) * t;
        }
    }

    // Son nokta sonrasını doldur
    for (let i = sorted[sorted.length - 1].i; i < 32; i++) out[i] = sorted[sorted.length - 1].v;

    return normalizeBands(out);
}

function getFeaturedPresetsFallback() {
    return [
        {
            filename: '__flat__',
            name: tSync('eqPresets.flatName', null, 'Düz (Flat)'),
            description: tSync('eqPresets.flatDesc', null, 'Tüm bantlar 0.0 dB'),
            bands: new Array(32).fill(0)
        }
    ];
}

function clamp(v, min, max) {
    return Math.min(Math.max(v, min), max);
}

function normalizeBands(bands) {
    const out = new Array(32).fill(0);
    if (Array.isArray(bands)) {
        for (let i = 0; i < 32; i++) {
            const n = Number(bands[i]);
            out[i] = Number.isFinite(n) ? clamp(n, -12, 12) : 0;
        }
    }
    return out;
}

function checkIconSvg() {
    return `
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M20 6L9 17l-5-5" stroke="#10b981" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
    `.trim();
}

function getCanvasDpr() {
    const dpr = Number(window.devicePixelRatio || 1);
    if (!Number.isFinite(dpr)) return 1;
    const cores = Number(navigator.hardwareConcurrency || 0);
    const dprCap = PRESET_PERF.lowPower
        ? 1.25
        : (cores > 0 && cores <= 4 ? 1.5 : 2.0);
    return Math.max(1, Math.min(dprCap, dpr));
}

function parsePositiveNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

function decideEqPresetLowPowerMode(appSettings, hardwareHints) {
    const appearance = appSettings?.appearance || {};
    const libraryPerf = appSettings?.library?.performance || {};
    const mode = String(appearance.sfxPerfMode || 'auto').trim().toLowerCase();
    if (mode === 'lite') return { lowPower: true, reason: 'setting-lite' };
    if (mode === 'full') return { lowPower: false, reason: 'setting-full' };
    if (libraryPerf.lightweightMode === true) return { lowPower: true, reason: 'library-lightweight' };

    const autoHardwareProfile = appearance.autoHardwareProfile !== false;
    const visualMode = String(appearance.visualMode || '').trim().toLowerCase();
    if (visualMode === 'minimal') return { lowPower: true, reason: 'appearance-minimal' };

    if (autoHardwareProfile) {
        const ramGiB = parsePositiveNumber(hardwareHints?.ramGiB) || parsePositiveNumber(navigator.deviceMemory);
        const cpuCores = parsePositiveNumber(hardwareHints?.cpuCores) || parsePositiveNumber(navigator.hardwareConcurrency);
        const lowHardware = (ramGiB > 0 && ramGiB <= 4) || (cpuCores > 0 && cpuCores <= 4);
        if (lowHardware) return { lowPower: true, reason: 'hardware-low' };
    }
    return { lowPower: false, reason: 'normal' };
}

async function applyEqPresetPerformanceProfile() {
    let appSettings = null;
    try {
        appSettings = await aurivo?.loadSettings?.();
    } catch {
        appSettings = null;
    }
    let hardwareHints = null;
    try {
        hardwareHints = await aurivo?.system?.getHardwareHints?.();
    } catch {
        hardwareHints = null;
    }
    const decision = decideEqPresetLowPowerMode(appSettings || {}, hardwareHints || {});
    PRESET_PERF.autoLowPower = !!decision.lowPower;
    PRESET_PERF.lowPower = PRESET_PERF.autoLowPower;
    PRESET_PERF.reason = String(decision.reason || (PRESET_PERF.lowPower ? 'low' : 'normal'));
    document.documentElement.dataset.eqPresetPerf = PRESET_PERF.lowPower ? 'lite' : 'normal';
    console.log(`[EQ PRESETS PERF] mode=${PRESET_PERF.lowPower ? 'lite' : 'normal'} reason=${PRESET_PERF.reason}`);
}

function syncActiveProfileChip() {
    const chips = document.querySelectorAll('.preset-profile-chip');
    chips.forEach((chip) => {
        const isActive = chip?.dataset?.profile === state.previewProfile;
        chip.classList.toggle('is-active', isActive);
        chip.setAttribute('aria-checked', isActive ? 'true' : 'false');
    });
}

function syncProfileUiTexts() {
    const qualityBtn = document.getElementById('presetProfileQualityBtn');
    const balancedBtn = document.getElementById('presetProfileBalancedBtn');
    const performanceBtn = document.getElementById('presetProfilePerformanceBtn');
    const hintEl = document.getElementById('presetProfileHint');

    // Mevcut global i18n anahtarlarını kullan: tüm dillerde hazır çeviriyle gelir.
    if (qualityBtn) qualityBtn.textContent = tSync('ui.visualMode.options.full', null, 'Kalite');
    if (balancedBtn) balancedBtn.textContent = tSync('ui.visualMode.options.balanced', null, 'Dengeli');
    if (performanceBtn) performanceBtn.textContent = tSync('ui.visualMode.options.minimal', null, 'Performans');

    if (!hintEl) return;
    const profile = String(state.previewProfile || 'balanced').toLowerCase();
    if (profile === 'quality') {
        hintEl.textContent = tSync('ui.visualMode.hintFull', null, 'Kalite modu: en detaylı çizim.');
        return;
    }
    if (profile === 'performance') {
        hintEl.textContent = tSync('ui.visualMode.hintMinimal', null, 'Performans modu: daha hafif çizim.');
        return;
    }
    hintEl.textContent = tSync('ui.visualMode.hintBalanced', null, 'Dengeli mod: kalite ve performans dengesi.');
}

function applyPreviewProfile(profile, { redraw = true } = {}) {
    const normalized = String(profile || '').trim().toLowerCase();
    const nextProfile = ['quality', 'balanced', 'performance'].includes(normalized)
        ? normalized
        : 'balanced';

    state.previewProfile = nextProfile;
    if (nextProfile === 'quality') {
        state.previewDetail = 'sharp';
        PRESET_PERF.lowPower = false;
        PRESET_PERF.reason = 'profile-quality';
    } else if (nextProfile === 'performance') {
        state.previewDetail = 'normal';
        PRESET_PERF.lowPower = true;
        PRESET_PERF.reason = 'profile-performance';
    } else {
        state.previewDetail = 'sharp';
        PRESET_PERF.lowPower = !!PRESET_PERF.autoLowPower;
        PRESET_PERF.reason = PRESET_PERF.autoLowPower ? 'auto-low' : 'auto-normal';
    }

    document.documentElement.dataset.eqPresetPerf = PRESET_PERF.lowPower ? 'lite' : 'normal';
    try {
        localStorage.setItem(PRESET_PROFILE_STORAGE_KEY, state.previewProfile);
    } catch {
        // yoksay
    }
    syncActiveProfileChip();
    syncProfileUiTexts();
    if (redraw) redrawVisiblePreviews();
}

function configurePreviewCanvas(canvas, cssW = PREVIEW_W, cssH = PREVIEW_H) {
    if (!canvas) return;
    const dpr = getCanvasDpr();
    const targetW = Math.max(1, Math.round(cssW * dpr));
    const targetH = Math.max(1, Math.round(cssH * dpr));

    if (canvas.width !== targetW) canvas.width = targetW;
    if (canvas.height !== targetH) canvas.height = targetH;

    if (canvas.style.width !== `${cssW}px`) canvas.style.width = `${cssW}px`;
    if (canvas.style.height !== `${cssH}px`) canvas.style.height = `${cssH}px`;
}

function traceSmoothLine(ctx, points) {
    if (!Array.isArray(points) || points.length === 0) return;
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const curr = points[i];
        const midX = (prev.x + curr.x) * 0.5;
        const midY = (prev.y + curr.y) * 0.5;
        ctx.quadraticCurveTo(prev.x, prev.y, midX, midY);
    }
    const last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
}

function traceSharpLine(ctx, points) {
    if (!Array.isArray(points) || points.length === 0) return;
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
    }
}

function smoothBandsForPreview(bands, passes = 2) {
    let out = [...bands];
    for (let p = 0; p < passes; p++) {
        const next = out.slice();
        for (let i = 0; i < out.length; i++) {
            const a = out[Math.max(0, i - 1)];
            const b = out[i];
            const c = out[Math.min(out.length - 1, i + 1)];
            next[i] = (a * 0.22) + (b * 0.56) + (c * 0.22);
        }
        out = next;
    }
    return out;
}

function sampleBandsLinear(bands, t) {
    const safe = normalizeBands(bands);
    const n = safe.length;
    if (n <= 1) return safe[0] || 0;
    const x = clamp(t, 0, 1) * (n - 1);
    const i0 = Math.floor(x);
    const i1 = Math.min(n - 1, i0 + 1);
    const frac = x - i0;
    return safe[i0] + ((safe[i1] - safe[i0]) * frac);
}

function zoomBandsDomain(bands, zoomX = 1) {
    const safe = normalizeBands(bands);
    if (!Number.isFinite(zoomX) || zoomX <= 1.001) return safe;
    const out = new Array(safe.length).fill(0);
    for (let i = 0; i < safe.length; i++) {
        const t = i / (safe.length - 1);
        const srcT = 0.5 + ((t - 0.5) / zoomX);
        out[i] = sampleBandsLinear(safe, srcT);
    }
    return out;
}

function microDetailOffset(index, baseValue) {
    // Deterministic, düşük genlikli mikro detay (rastgele değil)
    const a = Math.sin((index * 0.93) + (baseValue * 0.07));
    const b = Math.cos((index * 1.61) - (baseValue * 0.05));
    return (a * 0.09) + (b * 0.07);
}

function detailScale() {
    if (state.previewDetail === 'soft') return 0.55;
    if (state.previewDetail === 'sharp') return 2.7;
    return 1.0;
}

function getPreviewProfileTuning() {
    const profile = String(state.previewProfile || 'balanced').toLowerCase();
    if (profile === 'quality') {
        return {
            yScaleMult: 1.22,
            mainDetailMult: 1.28,
            layerDetailMult: 1.36,
            layerStructureMult: 1.25,
            mainLineWidthMult: 1.18,
            layerWidthMult: 1.15,
            layerAlphaMult: 1.12,
            layerCount: 5,
            glowAlphaMult: 1.22,
            eq32LineMult: 1.16,
            wheelSmoothPasses: 1
        };
    }
    if (profile === 'performance') {
        return {
            yScaleMult: 0.76,
            mainDetailMult: 0.7,
            layerDetailMult: 0.58,
            layerStructureMult: 0.72,
            mainLineWidthMult: 0.9,
            layerWidthMult: 0.82,
            layerAlphaMult: 0.72,
            layerCount: 2,
            glowAlphaMult: 0.55,
            eq32LineMult: 0.84,
            wheelSmoothPasses: 2
        };
    }
    return {
        yScaleMult: 1.0,
        mainDetailMult: 1.0,
        layerDetailMult: 1.0,
        layerStructureMult: 1.0,
        mainLineWidthMult: 1.0,
        layerWidthMult: 1.0,
        layerAlphaMult: 1.0,
        layerCount: PRESET_PERF.lowPower ? 3 : 5,
        glowAlphaMult: 1.0,
        eq32LineMult: 1.0,
        wheelSmoothPasses: 1
    };
}

function previewTypeFromBands(bands, filename = '') {
    const id = String(filename || '').trim().toLowerCase();
    if (id.startsWith('__aurivo_')) return 'wheel';

    const safe = normalizeBands(bands);
    let deltaSum = 0;
    let zigzag = 0;
    let prevSign = 0;
    for (let i = 1; i < safe.length; i++) {
        const d = safe[i] - safe[i - 1];
        const abs = Math.abs(d);
        deltaSum += abs;
        const sign = d > 0.04 ? 1 : (d < -0.04 ? -1 : 0);
        if (sign !== 0 && prevSign !== 0 && sign !== prevSign) zigzag++;
        if (sign !== 0) prevSign = sign;
    }
    const meanDelta = deltaSum / Math.max(1, safe.length - 1);
    return (meanDelta > 0.28 || zigzag >= 5) ? 'wheel' : 'eq32';
}

function eq32IconSvg() {
    return `
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M6 4v16M12 4v16M18 4v16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <circle cx="6" cy="9" r="2.2" fill="currentColor"/>
            <circle cx="12" cy="15" r="2.2" fill="currentColor"/>
            <circle cx="18" cy="11" r="2.2" fill="currentColor"/>
        </svg>
    `.trim();
}

function wheelIconSvg() {
    return `
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <circle cx="8" cy="8" r="4.1" stroke="currentColor" stroke-width="2"/>
            <circle cx="8" cy="8" r="1.25" fill="currentColor"/>
            <circle cx="16" cy="16" r="4.1" stroke="currentColor" stroke-width="2"/>
            <circle cx="16" cy="16" r="1.25" fill="currentColor"/>
        </svg>
    `.trim();
}

function menuIconSvg() {
    return `
        <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <circle cx="12" cy="5.5" r="2"/>
            <circle cx="12" cy="12" r="2"/>
            <circle cx="12" cy="18.5" r="2"/>
        </svg>
    `.trim();
}

function setRowPreviewType(row, previewType) {
    if (!row) return;
    const type = previewType === 'wheel' ? 'wheel' : 'eq32';
    row.dataset.previewType = type;
    const icon = row.querySelector('.preset-type-icon');
    if (icon) {
        icon.innerHTML = type === 'wheel' ? wheelIconSvg() : eq32IconSvg();
    }
}

function buildWheelLayerPoints(baseBands, innerW, yMid, yScale, pad, layer, minY, maxY, tuning) {
    const points = [];
    const n = baseBands.length;
    for (let i = 0; i < 32; i++) {
        const x = pad + ((i / 31) * innerW);
        const b = baseBands[i];
        const prev = baseBands[Math.max(0, i - 1)];
        const next = baseBands[Math.min(n - 1, i + 1)];
        const slope = (next - prev) * 0.5;
        const curvature = next - (2 * b) + prev;
        const structural = (slope * 0.92) + (curvature * 1.06);

        // Ana çizginin etrafında daha belirgin renkli zigzag katmanları.
        const micro = microDetailOffset(i, b) * detailScale() * layer.detailGain * 3.0 * tuning.layerDetailMult;
        const wave = Math.sin((i * layer.freq) + layer.phase) * layer.waveAmp;
        const hf = i >= 18 ? Math.sin((i - 18) * layer.hfFreq + layer.phase * 0.6) * layer.hfAmp : 0;
        const notch = Math.cos((i * layer.notchFreq) + layer.phase) * layer.notchAmp;
        const zig = i >= 15 ? Math.sin((i - 15) * layer.zigFreq + layer.phase * 1.4) * layer.zigAmp : 0;
        const tilt = ((i / 31) - 0.5) * layer.tilt;

        const v = (b * layer.bandGain) + (structural * layer.structureGain * 3.0 * tuning.layerStructureMult) + micro + wave + hf + notch + zig + tilt;
        const yRaw = yMid - (v / 12) * yScale + layer.off;
        const y = clamp(yRaw, minY, maxY);
        points.push({ x, y });
    }
    return points;
}

function drawMiniCurve(canvas, bands, previewType = 'eq32') {
    const tuning = getPreviewProfileTuning();
    const previewW = previewType === 'wheel' ? PREVIEW_W_WHEEL : PREVIEW_W;
    configurePreviewCanvas(canvas, previewW, PREVIEW_H);
    const dpr = getCanvasDpr();
    const ctx = canvas.getContext('2d');
    const w = previewW;
    const h = PREVIEW_H;
    const pad = previewType === 'wheel' ? 5 : 3;
    const innerW = Math.max(1, w - (pad * 2));
    const innerH = Math.max(1, h - (pad * 2));
    const yMid = pad + (innerH * 0.56) + PREVIEW_Y_OFFSET;
    const yScale = (innerH / 2) * (previewType === 'wheel' ? 1.34 : 0.94) * PREVIEW_ZOOM_Y * tuning.yScaleMult; // +/- 12 dB

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const normalizedBands = normalizeBands(bands);
    const bandsForRender = previewType === 'wheel'
        ? normalizedBands // ana çizgi her zaman orijinal JSON bantlarını temsil etsin
        : zoomBandsDomain(normalizedBands, PREVIEW_ZOOM_X);
    // Wheel tipte de köşeleri kırmadan, hafif yumuşatma ile kavisli zigzag görünüm.
    const smoothPasses = previewType === 'wheel' ? tuning.wheelSmoothPasses : 2;
    const safeBands = smoothBandsForPreview(bandsForRender, smoothPasses);
    const points = [];
    const minY = pad + 1.8;
    const maxY = h - pad - 1.8;
    for (let i = 0; i < 32; i++) {
        const x = pad + ((i / 31) * innerW);
        const detail = previewType === 'wheel'
            ? microDetailOffset(i, safeBands[i]) * detailScale() * tuning.mainDetailMult
            : 0;
        const yRaw = yMid - ((safeBands[i] + detail) / 12) * yScale;
        const y = clamp(yRaw, minY, maxY);
        points.push({ x, y });
    }

    if (previewType !== 'wheel') {
        // 32-band ikonlu tip: sade, keskin tek çizgi
        ctx.strokeStyle = 'rgba(220, 228, 240, 0.28)';
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(pad, yMid);
        ctx.lineTo(w - pad, yMid);
        ctx.stroke();

        ctx.lineWidth = 2.1 * tuning.eq32LineMult;
        ctx.strokeStyle = 'rgba(118, 240, 96, 0.18)';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        traceSmoothLine(ctx, points);
        ctx.stroke();

        const simpleGrad = ctx.createLinearGradient(0, 0, w, 0);
        simpleGrad.addColorStop(0.00, '#d5e63c');
        simpleGrad.addColorStop(0.72, '#4be980');
        simpleGrad.addColorStop(1.00, '#3ad8ff');
        ctx.lineWidth = 1.28 * tuning.eq32LineMult;
        ctx.strokeStyle = simpleGrad;
        ctx.beginPath();
        traceSmoothLine(ctx, points);
        ctx.stroke();
        ctx.lineWidth = 0.56 * tuning.eq32LineMult;
        ctx.strokeStyle = 'rgba(246, 255, 228, 0.78)';
        ctx.beginPath();
        traceSmoothLine(ctx, points);
        ctx.stroke();
        return;
    }

    // Wheel ikonlu tip: çok katmanlı zigzag, Poweramp benzeri
    ctx.strokeStyle = 'rgba(220, 228, 240, 0.26)';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(pad, yMid);
    ctx.lineTo(w - pad, yMid);
    ctx.stroke();

    // Önce ana çizgi: doğrudan preset JSON bantları.
    const mainGrad = ctx.createLinearGradient(0, 0, w, 0);
    mainGrad.addColorStop(0.00, '#d8f655');
    mainGrad.addColorStop(0.52, '#64f57a');
    mainGrad.addColorStop(1.00, '#43d8ff');
    ctx.lineWidth = 1.9 * tuning.mainLineWidthMult;
    ctx.strokeStyle = mainGrad;
    ctx.globalAlpha = 0.96;
    ctx.beginPath();
    traceSmoothLine(ctx, points);
    ctx.stroke();

    const layered = [
        { color: '#35f467', off: -1.75, lw: 1.20, alpha: 0.94, bandGain: 1.00, detailGain: 1.18, structureGain: 1.00, freq: 0.56, phase: 0.35, waveAmp: 0.72, hfFreq: 1.28, hfAmp: 1.02, notchFreq: 0.94, notchAmp: 0.54, zigFreq: 2.18, zigAmp: 0.72, tilt: -0.28 },
        { color: '#d9ef3d', off: -0.36, lw: 1.08, alpha: 0.90, bandGain: 0.98, detailGain: 1.04, structureGain: 0.92, freq: 0.64, phase: 1.14, waveAmp: 0.64, hfFreq: 1.44, hfAmp: 0.86, notchFreq: 1.08, notchAmp: 0.56, zigFreq: 2.30, zigAmp: 0.62, tilt: -0.10 },
        { color: '#1680ff', off: 1.30, lw: 1.02, alpha: 0.92, bandGain: 0.92, detailGain: 1.48, structureGain: 1.20, freq: 0.76, phase: 2.18, waveAmp: 1.06, hfFreq: 1.64, hfAmp: 1.58, notchFreq: 1.34, notchAmp: 1.00, zigFreq: 2.56, zigAmp: 0.88, tilt: 0.22 },
        { color: '#c73ad9', off: 2.14, lw: 0.96, alpha: 0.88, bandGain: 0.88, detailGain: 1.54, structureGain: 1.24, freq: 0.86, phase: 3.02, waveAmp: 1.14, hfFreq: 1.80, hfAmp: 1.76, notchFreq: 1.46, notchAmp: 1.06, zigFreq: 2.76, zigAmp: 0.98, tilt: 0.36 },
        { color: '#ffffff', off: 2.34, lw: 0.70, alpha: 0.34, bandGain: 0.60, detailGain: 0.88, structureGain: 0.70, freq: 0.68, phase: 1.78, waveAmp: 0.40, hfFreq: 1.30, hfAmp: 0.58, notchFreq: 1.20, notchAmp: 0.36, zigFreq: 2.20, zigAmp: 0.44, tilt: 0.08 }
    ];
    const layersToDraw = layered.slice(0, Math.max(1, Math.min(layered.length, tuning.layerCount)));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const layer of layersToDraw) {
        const layerPoints = buildWheelLayerPoints(
            safeBands,
            innerW,
            yMid,
            yScale,
            pad,
            layer,
            minY,
            maxY,
            tuning
        );
        ctx.beginPath();
        traceSmoothLine(ctx, layerPoints);
        ctx.strokeStyle = layer.color;
        ctx.globalAlpha = Math.min(1, layer.alpha * tuning.layerAlphaMult);
        ctx.lineWidth = layer.lw * tuning.layerWidthMult;
        ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Hafif toplam glow (ana çizgiyi öldürmeden)
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0.00, '#f4ff66');
    grad.addColorStop(0.52, '#6dff57');
    grad.addColorStop(1.00, '#2ed1ff');
    ctx.lineWidth = 1.18;
    ctx.strokeStyle = grad;
    ctx.globalAlpha = Math.min(1, 0.72 * tuning.glowAlphaMult);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    traceSmoothLine(ctx, points);
    ctx.stroke();
    ctx.globalAlpha = 1;
}

function bandsDigest32(bands) {
    const safe = normalizeBands(bands);
    return safe.map(v => Number(v).toFixed(2)).join(',');
}

function drawMiniCurveIfNeeded(canvas, bands, previewType = 'eq32') {
    if (!canvas) return;
    const key = `${previewType}|${bandsDigest32(bands)}|${state.previewProfile}|${state.previewDetail}|${PRESET_PERF.lowPower ? 1 : 0}|${PREVIEW_W}|${PREVIEW_W_WHEEL}|${PREVIEW_H}|${PREVIEW_ZOOM_X}|${PREVIEW_ZOOM_Y}|${PREVIEW_Y_OFFSET}`;
    if (canvas.dataset.drawKey === key) return;
    drawMiniCurve(canvas, bands, previewType);
    canvas.dataset.drawKey = key;
}

function bandsForPreview(filename) {
    if (!filename) return new Array(32).fill(0);
    const fromCache = state.bandsCache.get(filename);
    if (Array.isArray(fromCache)) return fromCache;

    const fromFiltered = state.filtered.find(p => p?.filename === filename)?.bands;
    if (Array.isArray(fromFiltered)) return normalizeBands(fromFiltered);

    const fromAll = state.all.find(p => p?.filename === filename)?.bands;
    if (Array.isArray(fromAll)) return normalizeBands(fromAll);

    return new Array(32).fill(0);
}

function redrawVisiblePreviews() {
    const rows = document.querySelectorAll('.preset-item');
    rows.forEach((row) => {
        const filename = row?.dataset?.filename;
        const canvas = row.querySelector('canvas.preset-preview');
        if (!canvas) return;
        const bands = bandsForPreview(filename);
        const type = previewTypeFromBands(bands, filename);
        setRowPreviewType(row, type);
        drawMiniCurveIfNeeded(canvas, bands, type);
    });
}

function createItemRow(preset) {
    const row = document.createElement('div');
    row.className = 'preset-item';
    row.dataset.filename = preset.filename;

    const check = document.createElement('div');
    check.className = 'preset-check';
    check.innerHTML = checkIconSvg();

    const preview = document.createElement('canvas');
    preview.className = 'preset-preview';
    configurePreviewCanvas(preview, PREVIEW_W, PREVIEW_H);
    const previewType = previewTypeFromBands(preset?.bands || null, preset?.filename || '');

    const labelWrap = document.createElement('div');
    labelWrap.className = 'preset-label';

    const nameEl = document.createElement('div');
    nameEl.className = 'preset-name';
    nameEl.textContent = preset.name;

    const subEl = document.createElement('div');
    subEl.className = 'preset-sub';
    subEl.textContent = preset.description || '';

    labelWrap.appendChild(nameEl);
    if (preset.description) labelWrap.appendChild(subEl);

    const meta = document.createElement('div');
    meta.className = 'preset-meta';

    const typeIcon = document.createElement('div');
    typeIcon.className = 'preset-type-icon';
    typeIcon.innerHTML = previewType === 'wheel' ? wheelIconSvg() : eq32IconSvg();

    const menuIcon = document.createElement('div');
    menuIcon.className = 'preset-menu-icon';
    menuIcon.innerHTML = menuIconSvg();

    meta.appendChild(typeIcon);
    meta.appendChild(menuIcon);

    row.appendChild(check);
    row.appendChild(preview);
    row.appendChild(labelWrap);
    row.appendChild(meta);

    row.dataset.previewType = previewType;

    // İlk açılışta tüm satırları hemen çizmek yerine lazy çizim:
    // görünür satırlar IntersectionObserver ile çizilir.
    preview.dataset.drawKey = '';

    row.addEventListener('click', () => {
        selectPreset(preset.filename);
    });

    return { row, preview, check };
}

function selectPreset(filename) {
    state.selected = filename;

    document.querySelectorAll('.preset-item').forEach(el => {
        const isSel = el.dataset.filename === filename;
        el.classList.toggle('selected', isSel);
        const c = el.querySelector('.preset-check');
        if (c) c.classList.toggle('checked', isSel);
    });
}

function setEmpty(message) {
    const list = document.getElementById('presetList');
    if (!list) return;
    list.innerHTML = `<div class="preset-empty">${message}</div>`;
}

function setStatus(message) {
    const el = document.getElementById('presetStatus');
    if (!el) return;
    el.textContent = message || '';
}

async function ensureBandsLoaded(filename) {
    if (!filename || filename === '__flat__') return;
    if (filename.startsWith('__aurivo_')) return;
    if (state.bandsCache.has(filename) || state.loadingBands.has(filename)) return;

    state.loadingBands.add(filename);
    try {
        const data = await aurivo?.presets?.loadPreset(filename);
        if (data && Array.isArray(data.bands)) {
            state.bandsCache.set(filename, normalizeBands(data.bands));
        }
    } catch {
        // yoksay
    } finally {
        state.loadingBands.delete(filename);
    }
}

async function hydratePresetPreviewRow(row) {
    if (!row) return;
    const filename = row.dataset.filename;
    if (!filename) return;

    const canvas = row.querySelector('canvas.preset-preview');
    const initialBands = bandsForPreview(filename);
    const initialType = previewTypeFromBands(initialBands, filename);
    setRowPreviewType(row, initialType);
    if (canvas) drawMiniCurveIfNeeded(canvas, initialBands, initialType);

    if (filename === '__flat__' || filename.startsWith('__aurivo_')) return;

    await ensureBandsLoaded(filename);
    const hydratedBands = state.bandsCache.get(filename);
    if (!hydratedBands) return;

    const type = previewTypeFromBands(hydratedBands, filename);
    setRowPreviewType(row, type);
    if (canvas) drawMiniCurveIfNeeded(canvas, hydratedBands, type);
}

function schedulePreviewHydration(container, rowsToObserve) {
    if (!container) return;
    if (!state.previewHydrationObserver) {
        state.previewHydrationObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                const row = entry.target;
                state.previewHydrationObserver?.unobserve(row);
                hydratePresetPreviewRow(row).catch(() => { });
            });
        }, { root: container, rootMargin: '120px' });
    }

    const observer = state.previewHydrationObserver;
    const rows = Array.isArray(rowsToObserve) && rowsToObserve.length
        ? rowsToObserve
        : Array.from(container.querySelectorAll('.preset-item'));
    rows.forEach((row) => observer.observe(row));
}

function renderNextPage() {
    const list = document.getElementById('presetList');
    if (!list) return;

    const next = state.filtered.slice(state.renderedCount, state.renderedCount + PAGE_SIZE);
    if (next.length === 0 && state.renderedCount === 0) {
        setEmpty(tSync('eqPresets.noResults', null, 'Sonuç bulunamadı.'));
        return;
    }

    const frag = document.createDocumentFragment();
    const appendedRows = [];
    next.forEach(preset => {
        const { row } = createItemRow(preset);
        frag.appendChild(row);
        appendedRows.push(row);
    });

    list.appendChild(frag);
    state.renderedCount += next.length;

    if (!state.selected) {
        selectPreset('__flat__');
    } else {
        // seçimi vurgulu tut
        selectPreset(state.selected);
    }

    schedulePreviewHydration(list, appendedRows);
}

function focusSelected() {
    const list = document.getElementById('presetList');
    if (!list || !state.selected) return;

    const idx = state.filtered.findIndex(p => p?.filename === state.selected);
    if (idx < 0) return;

    // Seçili preset ilk sayfalarda değilse, o sayfaya kadar render et
    while (state.renderedCount <= idx && state.renderedCount < state.filtered.length) {
        renderNextPage();
    }

    const sel = state.selected;
    const rows = Array.from(list.querySelectorAll('.preset-item'));
    const row = rows.find(r => r?.dataset?.filename === sel);
    if (!row) return;

    // Vurgunun uygulandığından emin ol (sanal liste yeniden render edebilir)
    selectPreset(sel);

    // Sağlam kaydırma: pencereyi değil liste kapsayıcısını kaydır
    const scrollToCenter = () => {
        const top = row.offsetTop - (list.clientHeight / 2) + (row.offsetHeight / 2);
        const maxTop = Math.max(0, list.scrollHeight - list.clientHeight);
        list.scrollTop = Math.min(maxTop, Math.max(0, top));
    };

    // Artımlı render sonrası yerleşim için 1-2 frame bekle
    requestAnimationFrame(() => requestAnimationFrame(scrollToCenter));
}

function ensureSelectedNotFilteredOut() {
    if (!state.selected) return;
    const inFiltered = state.filtered.some(p => p?.filename === state.selected);
    if (inFiltered) return;

    // Seçili preset grup filtresi nedeniyle görünmüyorsa:
    // Filtreyi bozmadan (dropdown'u "Tümü"ne geri almadan) listeden ilk preset'i seç.
    const first = (state.filtered || []).find(p => p?.filename) || null;
    if (!first) {
        state.selected = null;
        return;
    }
    state.selected = first.filename;
    try { selectPreset(state.selected); } catch { }
}

function renderList(presets) {
    const list = document.getElementById('presetList');
    if (!list) return;

    if (state.previewHydrationObserver) {
        try { state.previewHydrationObserver.disconnect(); } catch { }
        state.previewHydrationObserver = null;
    }
    list.innerHTML = '';
    state.filtered = presets;
    state.renderedCount = 0;

    renderNextPage();
    updateStatusForList(state.filtered);

    list.onscroll = () => {
        const nearBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 140;
        if (nearBottom) renderNextPage();
    };
}

async function runSearch(query) {
    const q = (query || '').trim();

    // Boş arama: tüm liste (Öne çıkanlar + tüm AutoEQ)
    if (!q) {
        renderList(filterByGroup(state.all));
        ensureSelectedNotFilteredOut();
        focusSelected();
        return;
    }

    const results = await aurivo?.presets?.searchPresets(q);

    // Öne çıkanlardan eşleşenleri en üste sabitle + AutoEQ sonuçları
    const base = state.featured.length ? state.featured : getFeaturedPresetsFallback();
    const featuredMatched = base.filter(p => (p.name || '').toLowerCase().includes(q.toLowerCase()));
    const merged = [];
    const seen = new Set();

    for (const p of featuredMatched) {
        if (!p?.filename || seen.has(p.filename)) continue;
        seen.add(p.filename);
        merged.push(p);
    }
    for (const p of (results || [])) {
        if (!p?.filename || seen.has(p.filename)) continue;
        seen.add(p.filename);
        merged.push(p);
    }

    renderList(filterByGroup(merged));
    ensureSelectedNotFilteredOut();
    focusSelected();
}

async function init() {
    const list = document.getElementById('presetList');
    const search = document.getElementById('presetSearch');
    const okBtn = document.getElementById('presetOkBtn');
    const groupChips = document.getElementById('presetGroupChips');
    const profileRow = document.getElementById('presetProfileRow');

    if (!aurivo?.presets) {
        setEmpty(tSync('eqPresets.apiMissing', null, 'Preset API bulunamadı.'));
        return;
    }

    await applyEqPresetPerformanceProfile();
    let savedProfile = 'balanced';
    try {
        const raw = String(localStorage.getItem(PRESET_PROFILE_STORAGE_KEY) || '').trim().toLowerCase();
        if (raw === 'quality' || raw === 'balanced' || raw === 'performance') savedProfile = raw;
    } catch {
        // yoksay
    }
    applyPreviewProfile(savedProfile, { redraw: false });
    syncProfileUiTexts();

    // Öne çıkan presetleri ana süreçten al (tek kaynak). Yoksa yedek.
    try {
        const featured = await aurivo.presets.getFeaturedEQPresets?.();
        state.featured = (Array.isArray(featured) && featured.length ? featured : getFeaturedPresetsFallback()).map(tagPreset);
    } catch {
        state.featured = getFeaturedPresetsFallback().map(tagPreset);
    }

    // Kayıtlı seçimi (uygulama ayarları) oku
    try {
        const appSettings = await aurivo.loadSettings?.();
        const saved = appSettings?.sfx?.eq32?.lastPreset?.filename;
        if (saved) {
            state.selected = saved;
            console.log('[EQ PRESETS] Kayıtlı seçim:', saved);
        } else {
            console.log('[EQ PRESETS] Kayıtlı seçim yok, varsayılan: __flat__');
        }
    } catch (e) {
        console.warn('[EQ PRESETS] Ayar okunamadı:', e);
    }

    // Tüm AutoEQ presetlerini yükle (tek pencerede göster)
    try {
        setStatus(tSync('eqPresets.loading', null, 'AutoEQ presetleri yükleniyor...'));
        setEmpty(tSync('eqPresets.loading', null, 'AutoEQ presetleri yükleniyor...'));
        await new Promise(r => setTimeout(r, 0));

        const presets = (await aurivo.presets.loadPresetList()) || [];
        const base = state.featured.length ? state.featured : getFeaturedPresetsFallback().map(tagPreset);

        const taggedAuto = presets.map(tagPreset);
        state.all = [...base, ...taggedAuto];
        state.totalCount = state.all.length;

        renderList(filterByGroup(state.all));
        if (!state.selected) state.selected = '__flat__';
        selectPreset(state.selected);
        ensureSelectedNotFilteredOut();
        focusSelected();
    } catch {
        setStatus(tSync('eqPresets.loadError', null, 'AutoEQ yüklenemedi (loglara bakın).'));
        renderList(state.featured);
        if (!state.selected) state.selected = '__flat__';
        selectPreset(state.selected);
        ensureSelectedNotFilteredOut();
        focusSelected();
    }

    // Grup chip seçimi
    syncActiveGroupChip();
    groupChips?.addEventListener('click', async (e) => {
        const chip = e.target?.closest?.('.preset-group-chip');
        if (!chip) return;
        const nextGroup = chip.dataset.group || 'all';
        if (nextGroup === state.selectedGroup) return;
        try {
            chip.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        } catch {
            // yoksay
        }
        state.selectedGroup = nextGroup;
        syncActiveGroupChip();
        await runSearch(search?.value || '');
    });

    // Hızlı ayar penceresi için sabit çizgi modu: Grafik + Sharp
    state.previewStyle = 'graphic';
    state.previewDetail = 'sharp';

    profileRow?.addEventListener('click', (e) => {
        const chip = e.target?.closest?.('.preset-profile-chip');
        if (!chip) return;
        const profile = chip.dataset.profile || 'balanced';
        if (profile === state.previewProfile) return;
        applyPreviewProfile(profile, { redraw: true });
    });

    if (search) {
        search.addEventListener('input', (e) => {
            const value = e.target.value;
            if (state.searchTimer) clearTimeout(state.searchTimer);
            state.searchTimer = setTimeout(() => runSearch(value), 180);
        });

        search.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                okBtn?.click();
            }
        });
    }

    okBtn?.addEventListener('click', async () => {
        const filename = state.selected || '__flat__';
        try {
            await aurivo.presets.selectEQPreset(filename);
        } catch {
            // yoksay
        }
        window.close();
    });

    // varsayılan seçim
    if (list) {
        // İlk görünen öğelerin önizlemesini hızlıca yükle
        const firstRows = Array.from(list.querySelectorAll('.preset-item')).slice(0, 14);
        for (const row of firstRows) {
            const filename = row.dataset.filename;
            if (!filename) continue;

            const canvas = row.querySelector('canvas.preset-preview');
            const initialBands = bandsForPreview(filename);
            const initialType = previewTypeFromBands(initialBands, filename);
            setRowPreviewType(row, initialType);
            if (canvas) drawMiniCurveIfNeeded(canvas, initialBands, initialType);

            if (filename === '__flat__' || filename.startsWith('__aurivo_')) continue;
            ensureBandsLoaded(filename).then(() => {
                const bands = state.bandsCache.get(filename);
                if (!bands) return;
                if (canvas) {
                    const type = previewTypeFromBands(bands, filename);
                    setRowPreviewType(row, type);
                    drawMiniCurveIfNeeded(canvas, bands, type);
                }
        });
    }
}
}

document.addEventListener('DOMContentLoaded', () => {
    (async () => {
        try {
            if (window.i18n?.init) {
                await window.i18n.init();
                try {
                    document.title = await window.i18n.t('eqPresets.windowTitle');
                } catch {
                    // yoksay
                }
            }
        } catch {
            // yoksay
        }

        init().catch(() => {
            setEmpty(tSync('eqPresets.loadFailed', null, 'Presetler yüklenemedi.'));
        });
    })();
});
