# Changelog

All notable release-facing changes to ArDali Browser are documented here.

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
