/* global aurivo */

const PREVIEW_W = 88;
const PREVIEW_H = 22;
const PAGE_SIZE = 60;

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
    totalCount: 0
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

function drawMiniCurve(canvas, bands) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // arka plan
    const bg = ctx.createLinearGradient(0, 0, w, 0);
    bg.addColorStop(0, 'rgba(255, 255, 255, 0.06)');
    bg.addColorStop(1, 'rgba(255, 255, 255, 0.02)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // gökkuşağı çizgisi
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0.00, '#ff2d2d');
    grad.addColorStop(0.18, '#ff9800');
    grad.addColorStop(0.35, '#ffeb3b');
    grad.addColorStop(0.52, '#00e676');
    grad.addColorStop(0.70, '#00b0ff');
    grad.addColorStop(0.86, '#7c4dff');
    grad.addColorStop(1.00, '#ff4fd8');

    const safeBands = normalizeBands(bands);

    const yMid = h / 2;
    const yScale = (h / 2) * 0.85; // +/- 12 dB

    ctx.lineWidth = 2.4;
    ctx.strokeStyle = grad;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    for (let i = 0; i < 32; i++) {
        const x = (i / 31) * (w - 10) + 5;
        const y = yMid - (safeBands[i] / 12) * yScale;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // hafif orta çizgi
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(5, yMid);
    ctx.lineTo(w - 5, yMid);
    ctx.stroke();
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
    preview.width = PREVIEW_W;
    preview.height = PREVIEW_H;

    const labelWrap = document.createElement('div');

    const nameEl = document.createElement('div');
    nameEl.className = 'preset-name';
    nameEl.textContent = preset.name;

    const subEl = document.createElement('div');
    subEl.className = 'preset-sub';
    subEl.textContent = preset.description || '';

    labelWrap.appendChild(nameEl);
    if (preset.description) labelWrap.appendChild(subEl);

    row.appendChild(check);
    row.appendChild(preview);
    row.appendChild(labelWrap);

    drawMiniCurve(preview, preset.bands || null);

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

function schedulePreviewHydration(container) {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(async (entry) => {
            if (!entry.isIntersecting) return;
            const row = entry.target;
            observer.unobserve(row);

            const filename = row.dataset.filename;
            if (!filename || filename === '__flat__') return;

            await ensureBandsLoaded(filename);
            const bands = state.bandsCache.get(filename);
            if (!bands) return;

            const canvas = row.querySelector('canvas.preset-preview');
            if (canvas) drawMiniCurve(canvas, bands);
        });
    }, { root: container, rootMargin: '120px' });

    container.querySelectorAll('.preset-item').forEach(row => observer.observe(row));
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
    next.forEach(preset => {
        const { row } = createItemRow(preset);
        frag.appendChild(row);
    });

    list.appendChild(frag);
    state.renderedCount += next.length;

    if (!state.selected) {
        selectPreset('__flat__');
    } else {
        // seçimi vurgulu tut
        selectPreset(state.selected);
    }

    schedulePreviewHydration(list);
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
    const groupSel = document.getElementById('presetGroup');

    if (!aurivo?.presets) {
        setEmpty(tSync('eqPresets.apiMissing', null, 'Preset API bulunamadı.'));
        return;
    }

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

    // Grup değişince filtrele
    groupSel?.addEventListener('change', async (e) => {
        state.selectedGroup = e.target.value || 'all';
        await runSearch(search?.value || '');
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
            if (!filename || filename === '__flat__') continue;
            ensureBandsLoaded(filename).then(() => {
                const bands = state.bandsCache.get(filename);
                if (!bands) return;
                const canvas = row.querySelector('canvas.preset-preview');
                if (canvas) drawMiniCurve(canvas, bands);
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
