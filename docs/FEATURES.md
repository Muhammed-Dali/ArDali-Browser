# Features

This guide groups ArDali's user-facing capabilities. Availability can vary by operating system, package type, installed native dependencies, website behavior, and media format.

## 🌐 Browser

- Built-in Chromium browser with multiple tabs and session restoration
- Customizable new-tab page, quick sites, search engines, bookmarks, and downloads
- DeliBlock ad filtering with selectable modes, filter lists, custom filters, strict blocking, and statistics
- Site information, permissions, zoom, and privacy controls
- Web media shortcuts and integrated web audio effects

## 🔐 Security and privacy

- Local-only password vault encrypted with AES-256-GCM
- Master password and configurable automatic lock
- User-authorized secure autofill for exact HTTPS origins
- Chromium sandbox, context isolation, disabled renderer Node.js integration, and strict CSPs
- Deny-by-default IPC sender validation and page-role channel permissions
- Electron security, credential-vault, dependency, and CI security checks

Read the [Security model](SECURITY.md) for limitations and precise boundaries.

## 🎵 Audio

- Native C++ Audio Engine for local playback and DSP
- Dali Web Audio Engine for supported browser playback
- Professional 32-band equalizer and AutoEQ presets
- Parametric and dynamic EQ, compressor, limiters, noise gate, de-esser, and exciter
- Bass enhancement, stereo widening, crossfeed, echo, convolution reverb, and additional processing tools
- Real-time meters, spectrum analysis, output-device controls, playlists, and MPRIS integration
- Music recognition from supported audio sources and webpages

Read [Audio Engine](AUDIO_ENGINE.md) for the processing model.

## ⬇ Smart Downloader

- Automatic URL detection from supported browsing workflows
- Audio and video download modes
- Format, quality, and output selection
- Media information and download history
- Optional conversion and compression workflows
- Multiple platform support through the bundled downloader integration

Users remain responsible for service terms, copyright, and applicable law.

## 🎨 Visualizer

- Native projectM integration
- Real-time spectrum-driven visualization
- Preset discovery, selection, and automated switching
- Hardware-accelerated OpenGL rendering where supported
- Separate native window so visualization does not own playback

## 🎬 Multimedia tools

- **Music player:** local library, folders, playlists, metadata, album art, favorites, history, and multiple views
- **Video player:** local video playback, subtitles, queue controls, thumbnails, and playback tools
- **Photo gallery:** folder browsing, thumbnails, lightbox, slideshow, transitions, and background options
- **Screen recorder:** display/window capture, microphone/system-audio options, and FFmpeg-based finalization
- **Media tools:** supported conversion, extraction, and editing workflows

These features are documented here without additional README screenshots so the repository landing page stays focused.

## 🌍 Localization

- Locale packs under `locales/`
- Runtime language switching for the main application and feature windows
- RTL-aware interfaces for supported languages
- Automated key and placeholder verification through `npm run verify:i18n`

## ⚡ Performance and platform integration

- Native components for audio and visualization
- Lazy rendering and deferred background work for heavier UI panels
- Adjustable library, animation, web, and audio performance profiles
- Linux desktop integration including MPRIS, tray controls, Wayland/X11 behavior, and packaged formats
- Windows build workflow and platform-specific runtime packaging
- Renderer sandboxing and isolated preload bridges as performance-conscious security boundaries

## Packaging

- Linux AppImage, DEB, and RPM release configuration
- Arch Linux AUR binary package recipe
- Flatpak metadata and local-build documentation
- Windows build and packaging workflow
- Release checksums and binary-manifest verification

See [Building](BUILDING.md), [Packaging](PACKAGING.md), and [Releases](RELEASES.md).
