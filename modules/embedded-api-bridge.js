(() => {
    // Embedded workspace modules run in isolated WebContents. Their preload
    // capability profile is selected by the main process from the verified
    // local page URL; renderer-controlled filenames and parent globals are
    // deliberately not consulted here.
    if (!window.ardali) {
        console.error('[EMBEDDED] verified preload capability bridge unavailable');
    }
})();
