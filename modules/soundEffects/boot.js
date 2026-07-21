'use strict';

(() => {
    const startedAt = performance.now();
    const metrics = {
        startedAt,
        shellPaintMs: 0,
        scriptsReadyMs: 0,
        interactiveMs: 0
    };
    window.__ARDALI_SFX_BOOT_METRICS__ = metrics;

    const loadScript = (src) => new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.async = false;
        script.addEventListener('load', resolve, { once: true });
        script.addEventListener('error', () => reject(new Error(`Unable to load ${src}`)), { once: true });
        document.body.appendChild(script);
    });

    const loadHeavyUi = async () => {
        const sources = [
            'modules/i18n.js',
            'modules/soundEffects/widgets/colorKnob.js',
            'modules/soundEffects/widgets/rainbowSlider.js',
            'modules/soundEffects/widgets/barAnalyzer.js',
            'soundEffectsRenderer.js'
        ];
        for (const src of sources) {
            await loadScript(src);
        }
        metrics.scriptsReadyMs = performance.now() - startedAt;
    };

    // Let Chromium paint the static shell and left navigation before parsing
    // the DSP renderer and widget implementations (~900 KB combined).
    requestAnimationFrame(() => {
        metrics.shellPaintMs = performance.now() - startedAt;
        document.documentElement.dataset.sfxShellReady = 'true';
        console.log(`[SFX PERF] shell-painted=${metrics.shellPaintMs.toFixed(1)}ms`);
        setTimeout(() => {
            loadHeavyUi().catch((error) => {
                console.error('[SFX BOOT] Heavy UI load failed:', error);
            });
        }, 0);
    });
})();
