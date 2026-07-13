# Brand and visual assets

This is a production brief for future visual assets. It does not replace the current logo or introduce generated artwork into the application.

## Logo direction

Preserve the recognizable ArDali “A” mark and its round silhouette. Prepare a small, consistent master set:

- `ardali-mark.svg`: geometric mark, no text, with safe padding;
- `ardali-lockup-horizontal.svg`: mark plus “ArDali WebMedia” wordmark;
- monochrome light and dark variants;
- PNG exports at 32, 64, 128, 256, 512, and 1024 pixels;
- an icon test sheet at 16–64 pixels to confirm legibility.

Recommended visual language: deep navy background, mint/cyan signal color, restrained blue secondary glow, and high-contrast white typography. Avoid tiny waveform detail, gradients that disappear at tray-icon sizes, and embedding feature icons into the core mark.

## GitHub social preview banner

Create a 1280×640 image with the mark and short line “Your media, sound, and web workspace.” Keep essential content inside the center 1120×520 safe area. Use one uncluttered product screenshot crop, a dark overlay for text contrast, and no more than three short feature terms: `Play · Shape · Create`.

Export as optimized PNG or high-quality WebP below roughly 1 MB. Upload it through GitHub repository Settings → Social preview; do not rely on a README image for social cards.

## README banner

A separate 1600×500 banner can be added above the README introduction. It should contain no install instructions or version number, because those become stale. Retain the standalone logo below only if the banner remains readable on mobile.

## Demo GIF

Capture from the tagged release build at 1280×720. Recommended 15–25 second sequence:

1. open the music workspace;
2. start playback using copyright-safe demo media;
3. adjust one EQ band or choose a preset;
4. open the projectM visualizer;
5. briefly show the web media workspace.

Remove personal paths, account names, notifications, cookies, and copyrighted account content. Prefer MP4/WebM for the website. For GitHub, export a silent GIF at 960 px width, 12–15 fps, under 8–10 MB, with a stable first frame and reduced motion. Store it under `assets/demo/ardali-overview.gif` only after review.

## Screenshot standards

Use the same release, theme, window size, language, and demo library across all screenshots. Crop consistently, avoid desktop clutter, provide descriptive alt text, and keep one “hero” screenshot full width while secondary screens use a two-column grid.
