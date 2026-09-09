# Changelog

All notable release-facing changes to ArDali Browser are documented here.

## [7.0.0] - 2026-09-10

### Added

- **GeneralDownloadManager Engine**: High-performance adaptive multi-connection segmented download pipeline with 1 → 2 → 4 → 8 parallel streams, dynamic work stealing, chunk pre-allocation, pause/resume/cancel/part-level retry, and 429 throttling backoff.
- **Download Management UI**: Dedicated toolbar download popup (`DownloadToolbarUI`) with live speed metering and an updated internal downloads page (`ardali://downloads`).
- **Smart Omnibox Navigation**: Composite navigation ranking aggregating history, bookmarks, and frequent sites with domain normalizer and real-time search suggestions (DuckDuckGo, Google, Brave, Bing).
- **Granular Site Permissions**: `SiteControlsBubble` and `SitePermissionPromptBubble` providing per-origin toggles for Camera, Microphone, Geolocation, Notifications, Popups, Insecure Content, and JavaScript optimization.
- **Encrypted Local Credential Vault**: Zero-cloud password management with AES-256-GCM encryption, PBKDF2-HMAC-SHA256 key derivation, in-page autofill controller, save bubbles, and vault unlock dialogs.
- **Hardware-Accelerated WebEngine**: Zero-copy video decoding pipelines, early GPU runtime flags, subprocess memory policy, tab memory hover cards, and tab memory pressure monitor.
- **AutoEQ Presets Integration**: Bundled 1,757 calibrated AutoEQ headphone correction profiles for audiophile hardware in `browser/resources/eq-presets/autoeq` and CMake install rules.
- **CMake & Packaging Integration**: Complete `GNUInstallDirs` support, unified `.desktop` specification, full hicolor icon resolution suite (16px to 1024px), and updated PKGBUILDs for Arch Linux and AUR.

### Changed

- Updated version metadata to 7.0.0 across CMake, application runtime, package manifests, and Arch/AUR packaging.
- Enhanced resource search paths to reliably locate AutoEQ presets and AdBlock rulesets in portable, build, and system-installed `/usr/share/ardali-browser/` environments.
- Enforced strict assertions (`-UNDEBUG`) across all 27 automated test suites.

## [6.1.2] - 2026-08-24

### Changed

- Displays the installed application name as `ArDali` in desktop launchers.
- Installs the verified ArDali bee-shield icon under the `ardali` icon identity.
- Standardized package manifests for Arch Linux, AUR, and the pacman repository.

## [6.0.1] - 2026-08-24

### Changed

- Clarified that ArDali Blocker is ArDali Browser's built-in advertising and
  tracker protection engine, while third-party filter and ruleset resources
  retain separate attribution in `NOTICE.txt`.
- Added the Qt image-format runtime dependency required for bundled WebP
  handling in Arch Linux packages.
- Stabilized GitHub CI and release builds with an Xvfb-backed Qt test
  environment and explicit release re-run support.

### Fixed

- Corrected release automation and Arch package metadata discovered during the
  6.0.0 publication verification.

## [6.0.0] - 2026-08-24

### Changed

- Rebuilt ArDali as a native Qt 6 and C++20 desktop browser.
- Reorganized the browser into modular core, tabs, settings, audio, blocker,
  password, Pulse, sidebar, and session components.
- Migrated the Linux desktop integration and Arch packaging to the
  `ardali-browser` executable and product identity.

### Added

- ArDali Blocker with local request filtering, cosmetic filtering, rule-set
  controls, per-site controls, and inspection tools.
- ArDali Pulse music recognition using system audio or microphone capture.
- An encrypted local credential vault and password-management interface.
- Custom new-tab, audio effects, 32-band equalizer presets, tab workspaces,
  and redesigned browser settings.

### Migration note

ArDali Browser 6.0.0 is a major architectural transition from
ArDali-WebMedia 5.5.2. Existing user-data migration is not guaranteed.
