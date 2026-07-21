'use strict';

(() => {
    const themes = new Set([
        'aur-renk-efektleri', 'performance-balanced', 'performance-lite', 'ardali',
        'dark', 'black', 'light', 'frappe', 'onedark', 'matrix', 'latte',
        'solarized-dark', 'neon-night', 'retro-amber', 'deep-ocean', 'forest-mint'
    ]);
    const page = String(location.pathname || '').split('/').pop();
    const fallbackTheme = ['soundEffects.html', 'eqPresets.html'].includes(page) ? 'black' : '';

    try {
        const theme = String(localStorage.getItem('ardali_ui_theme') || localStorage.getItem('theme') || fallbackTheme).trim();
        if (themes.has(theme)) {
            document.documentElement.dataset.ardaliTheme = theme;
            document.documentElement.setAttribute('theme', theme);
            document.addEventListener('DOMContentLoaded', () => {
                document.body?.setAttribute('data-ardali-theme', theme);
            }, { once: true });
        }
    } catch (_) {}

    if (page === 'index.html') {
        document.documentElement.classList.add('material-icons-loading');
        const markIconsReady = () => {
            document.documentElement.classList.remove('material-icons-loading');
            document.documentElement.classList.add('material-icons-ready');
        };
        if (document.fonts?.load) {
            Promise.race([
                document.fonts.load('24px "Material Symbols Rounded"', 'visibility'),
                new Promise((resolve) => setTimeout(resolve, 1200))
            ]).then(markIconsReady, markIconsReady);
        } else {
            markIconsReady();
        }
    }

    if (page === 'soundEffects.html') {
        try {
            const embedded = new URLSearchParams(location.search).get('embedded') === '1';
            document.documentElement.classList.add(embedded ? 'embedded-sfx' : 'framed-sfx');
            if (embedded) {
                // Do not reuse a parent bridge: scoped audio effects must remain isolated.
                try { window.ardali = {}; } catch (_) {}
                if (!window.i18n) {
                    try {
                        if (window.parent && window.parent !== window && window.parent.i18n) window.i18n = window.parent.i18n;
                    } catch (_) {}
                }
            }
        } catch (_) {}
    }

    document.addEventListener('click', (event) => {
        const trigger = event.target?.closest?.('.custom-dropdown-trigger');
        if (trigger) {
            trigger.parentElement?.classList.toggle('open');
            event.stopPropagation();
            return;
        }
        const option = event.target?.closest?.('.custom-dropdown-option');
        if (option) {
            window.handleCustomDropdownOptionClick?.(option);
            event.stopPropagation();
            return;
        }
        if (event.target?.closest?.('[data-open-web-settings]')) window.openSettings?.('web');
    });

    window.addEventListener('DOMContentLoaded', () => {
        const cover = document.getElementById('coverArt');
        cover?.addEventListener('error', () => {
            if (!cover.src.endsWith('/icons/app/ardali_256.png')) cover.src = 'icons/app/ardali_256.png';
        });
        document.querySelectorAll('.about-logo').forEach((image) => {
            image.addEventListener('error', () => image.classList.add('hidden'));
        });
    }, { once: true });
})();
