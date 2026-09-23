# DaliNira Browser 6.0.0

Released on 24 August 2026.

DaliNira Browser 6.0.0 is a major architectural transition from
DaliNira-WebMedia 5.5.2. The Electron-based media application has been replaced
by a modular native browser built with Qt 6, Qt WebEngine, and C++20.

## Highlights

- Native multi-tab browser architecture with session restoration, tab
  reordering, detachable tabs, hover previews, and custom new-tab pages.
- DaliNira Blocker for local request filtering, tracker and advertisement
  protection, cosmetic filtering, per-site controls, logs, and rule-set
  management.
- DaliNira Pulse for recognizing music from system audio or a microphone and
  opening results on configured music services.
- Encrypted local credential vault and integrated password-management UI.
- Audio effects, 32-band equalizer presets, output processing, and live media
  controls integrated into the browser.
- Redesigned settings, side tools, browser chrome, and modular native source
  layout.
- New Arch Linux source package recipe and standards-based desktop/icon
  installation for the `dalinira-browser` executable.

## Platform status

Linux is the verified 6.0.0 build and packaging target. The source contains a
Windows application-resource path, but no Windows binary is included in this
release until that pipeline is independently verified.

## Upgrade note

This release changes the application architecture, executable, package name,
and storage implementation. A seamless migration from DaliNira-WebMedia 5.5.2
is not claimed; keep a backup of existing data before switching.

## License and third-party components

DaliNira Browser is distributed under GPL-3.0-only. Bundled filter rules,
scriptlets, lists, and other third-party resources retain their own notices;
see `browser/resources/adblock/NOTICE.txt` in the source tree.
