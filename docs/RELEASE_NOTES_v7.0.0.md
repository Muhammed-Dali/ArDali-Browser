# ArDali Browser 7.0.0

Released on 11 September 2026.

ArDali Browser 7.0.0 is a major release built from every completed, release-ready change since the last public release, v6.1.2. It expands the native Qt 6 / C++20 browser across privacy, media downloads, language support, permissions, navigation, desktop tabs, audio, credentials, performance, packaging, and the official website.

## Highlights

- A redesigned native desktop-tab architecture with detach/attach, drag sessions, tab groups, search, hover cards, animations, memory-pressure handling, and lifecycle-safe session restore.
- A full media downloader powered by yt-dlp and ffmpeg, plus an adaptive parallel engine for regular downloads.
- Centralized English, Turkish, and Arabic localization with runtime switching, RTL/LTR metadata, system-language detection, and persistent language preferences.
- Modern site controls, permission prompts, an encrypted local password vault, secure autofill, and hardened URL/path handling.
- ArDali Listen music recognition with system-audio capture, device discovery, live levels, persistent settings, and dedicated internal pages.
- The official static ArDali Browser website in English, Turkish, and Arabic, with no tracking or external runtime dependencies.

## Privacy & Ad Blocking

- Made ArDali Blocker statistics tab-scoped and thread-safe, including request, cosmetic, and scriptlet hit accounting.
- Prevented duplicate cosmetic counters, preserved counts across SPA navigation, handled subdomain changes correctly, and cleaned state when tabs close.
- Added initiator-based first-party URL fallback and expanded rules for Facebook, Reels, article layouts, and sponsored content.
- Reflected cosmetic blocking totals correctly in the shield and site-controls UI.
- Expanded bundled filter, cosmetic, procedural, scriptlet, anti-adblock, and regional ruleset integration while retaining third-party notices.

## Downloads & Media

- Added a yt-dlp media analysis pipeline with metadata and thumbnail retrieval, format and quality selection, video/audio handling, and adaptive-stream merging through ffmpeg.
- Added audio conversion, metadata embedding, cover art, subtitles, time-range downloads, playlist support, queues, progress reporting, cancellation, retry, persistent history, and export.
- Isolated helper-process execution and hardened URL, option, filename, and output-path validation.
- Added automatic yt-dlp discovery/update handling and platform capability reporting.
- Added `GeneralDownloadManager`, an adaptive 1 → 2 → 4 → 8 connection engine with preallocation, pause/resume/cancel, part-level retry, rate-limit backoff, and live-speed UI.
- Added the toolbar download popup and the `ardali://downloads` management page.

## Languages & Translation

- Added the centralized `LanguageManager` with English, Turkish, and Arabic JSON catalogs, semantic keys, English fallback, `QLocale::system()` detection, `QSettings` persistence, and live language switching.
- Added metadata-driven RTL/LTR behavior across browser chrome, settings, menus, context menus, and the new-tab page.
- Added a Brave-style Languages center for preferred-language ordering, `Accept-Language`, display-language selection, spell-check languages, and custom dictionary controls.
- Added ArDali Translate settings for target, automatic, and never-translate languages, plus selectable translation providers.
- Integrated page-language detection, translation injection, provider adapters, secrets storage, and the translation bubble.

## Permissions & Security

- Added a modern per-origin permission architecture and inspection APIs for camera, microphone, geolocation, notifications, popups, insecure content, and JavaScript optimization.
- Added permission prompts and the site-controls bubble with session/persistent decisions, active-permission inspection, quick reset, and dormant-permission cleanup.
- Added a local AES-256-GCM credential vault with PBKDF2-HMAC-SHA256 derivation, master-password unlock, origin-bound autofill, save prompts, and in-memory secret cleanup.
- Hardened URL parsing, local-network checks, helper-process environments, path handling, and translation-provider secret storage.

## Tabs & Navigation

- Added smart address resolution that distinguishes URLs, hosts, localhost addresses, and searches safely.
- Added a composite omnibox architecture that ranks history, bookmarks, frequent sites, and live suggestions from configured search engines.
- Rebuilt desktop tabs around explicit layout, drag-session, window-registry, detach/attach, animation, appearance, group, search, and hover-card components.
- Added audible/fullscreen state handling, tab/link context menus, retry scheduling, discard/restore support, and session-compatible lifecycle cleanup.

## ArDali Listen / Song Finder

- Added PipeWire and PulseAudio device discovery with policy-based input selection.
- Added ffmpeg-backed 16 kHz mono PCM capture, live input levels, persistent device settings, and recognition lifecycle cleanup.
- Added `ardali://listen` and `ardali://listen-settings`, single-instance internal-tab behavior, and browser menu/toolbar integration.

## Website

- Added the official `website/` distribution in English, Turkish, and Arabic with responsive RTL support.
- Added Download, Features, Privacy, and Open Source content using real ArDali screenshots and local assets.
- Added a strict CSP/security-header template, SEO metadata, sitemap, robots policy, and zero tracking or external runtime dependencies.

## Performance & Reliability

- Added WebEngine hardware-acceleration policy, early GPU/process flags, memory-pressure monitoring, and tab resource diagnostics.
- Added tab memory usage to hover cards and strengthened discard/restore behavior under pressure.
- Expanded the web-audio effects pipeline, platform audio policy, and the bundled 1,757-profile AutoEQ catalog.
- Unified the top-level CMake build, resource discovery, install layout, desktop integration, and Arch/AUR/pacman package metadata.
- Preserved Qt 6.4 compatibility by guarding newer WebEngine and color-scheme APIs and fixing complete-type and permission-bubble build issues.

## Tests & Quality

- Added regression coverage for blocker accounting, song recognition, downloader services and UI, permissions, address resolution, omnibox ranking, translation, i18n, tab dragging, tab lifecycle, memory policy, hardware acceleration, security utilities, password autofill, and runtime integration.
- Verified a clean Linux Release build with Qt 6 and all 29 CTest suites passing.
- Updated CI and release automation for the unified source layout, Debian 12 release builds, Xvfb-backed Qt tests, version validation, checksums, and Arch repository publication.

## Platform status

Linux x86_64 is the verified build, test, packaging, and release platform. The portable archive is built against the Debian 12 baseline and published with `SHA256SUMS`.

## License and third-party components

ArDali Browser is licensed under GPL-3.0-only. Bundled third-party filters and generated ruleset resources retain their respective copyright and license notices in `browser/resources/adblock/NOTICE.txt`.
