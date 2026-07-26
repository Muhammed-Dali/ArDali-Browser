# ArDali WebMedia v5.5.0

ArDali WebMedia v5.5.0 focuses on workspace reliability, integrated privacy tools, media workflow polish, performance, and release security.

## New

- New tab workspace architecture with persistent workspace tabs and explicit lifecycle handling.
- Integrated local Password Manager with an AES-256-GCM vault, master-password protection, Auto Lock, and exact-origin secure Autofill.
- Expanded professional Ad Block controls, including site policies, filter management, and element-selection workflows.
- Unified browser settings and hardened embedded application API boundaries.

## Improved

- Refined Gallery editing and conversion workflows, Music library behavior, Song Finder, Downloads, Settings, and Audio Effects startup.
- Improved workspace restoration, tab ownership, navigation state, and background-tab handling.
- Improved native projectM window integration and visualization lifecycle.
- Expanded Turkish, English, and Arabic interface coverage for updated surfaces.

## Fixed

- Corrected tab and embedded-window lifecycle edge cases that could leave stale workspace state.
- Corrected Ad Block rule, site-policy, and user-filter synchronization paths.
- Corrected media artwork, Audio Effects initialization, and downloader interface consistency issues.
- Aligned Electron and native build targets across Linux, Windows, and release workflows.

## Performance

- Reduced unnecessary background work, repeated UI synchronization, and inactive visual updates.
- Improved memory cleanup when tabs, media surfaces, and auxiliary windows close.
- Preserved lazy startup paths for Audio Effects and native visualization components.

## Security

- Preserved Chromium sandboxing, context isolation, strict Content Security Policy, and validated IPC boundaries.
- Extended automated coverage for the Password Manager, Ad Block, workspace tabs, Electron security, and release metadata.
- Updated and deduplicated the Electron build dependency chain; both complete and production-only npm audits report zero vulnerabilities.
