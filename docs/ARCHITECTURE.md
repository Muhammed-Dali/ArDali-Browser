# Architecture

ArDali separates remote web content, local application UI, privileged desktop operations, native media processing, and visualization into distinct runtime layers.

## System flow

```text
┌──────────────────────────────────────────────┐
│ Browser UI · Local media UI · Feature windows│
└──────────────────────┬───────────────────────┘
                       ↓
┌──────────────────────────────────────────────┐
│ Electron renderer sandbox + isolated preload │
└──────────────────────┬───────────────────────┘
                       ↓ validated IPC
┌──────────────────────────────────────────────┐
│ Electron main process and desktop services   │
└───────────────┬──────────────────┬───────────┘
                ↓                  ↓
┌──────────────────────┐  ┌──────────────────────┐
│ Native C++ Audio     │  │ Dali Web Audio       │
│ Engine               │  │ Engine               │
└───────────┬──────────┘  └───────────┬──────────┘
            └──────────────┬───────────┘
                           ↓
               ┌──────────────────────┐
               │ Real-time DSP chain  │
               └───────────┬──────────┘
                           ↓
          ┌────────────────┴────────────────┐
          │ Audio output · projectM visuals │
          └─────────────────────────────────┘
```

The diagram is intentionally conceptual. Local playback and web playback use different capture and processing paths, and not every feature traverses every box.

## Runtime layers

| Layer | Primary locations | Responsibility |
| --- | --- | --- |
| Electron main process | `main.js`, `modules/` | Window lifecycle, validated IPC, filesystem access, downloads, permissions, settings, subprocesses, and OS integration |
| Preload bridges | `preload.js`, `webviewAdblockPreload.js`, `password-manager-preload.js` | Narrow APIs between isolated renderers and privileged operations |
| Renderer UI | `renderer.js`, `*Renderer.js`, `*.html`, `styles/` | Browser chrome, playback workflows, settings, and feature windows |
| Remote web content | Electron `<webview>` guests | Sandboxed Chromium pages without the unrestricted local application bridge |
| Native audio | `native/` | C++ audio addon, BASS-backed playback, device integration, and DSP |
| Dali audio | `dali-lang/`, generated Dali modules | Validated `.dali`/`.dl` definitions and web audio graph/runtime targets |
| Visualizer | `visualizer/`, `third_party/imgui/` | Native projectM executable, rendering, preset selection, and application integration |
| Resources | `resources/`, `assets/`, `icons/`, `locales/` | Rulesets, presets, media assets, icons, fonts, and translations |
| Packaging and CI | `package.json`, `packaging/`, `.github/workflows/` | Builds, security gates, checksums, packages, and releases |

## Browser boundary

The main renderer owns browser controls and creates isolated webview guests. Remote pages do not receive Node.js integration or the full application preload API. Navigation, popups, permissions, credential operations, and privileged requests are mediated by local code.

## Audio paths

- **Local media:** the main process hosts the native addon and exposes bounded audio controls through IPC.
- **Web media:** the Dali Web Audio path applies supported graphs and real-time parameters to web playback.
- **Visualization:** spectrum data feeds the native projectM integration without making the visualizer responsible for playback.

See [Audio Engine](AUDIO_ENGINE.md) for processing details.

## Data and settings

User settings and caches use Electron application paths and main-process services. Credentials are handled separately by the local vault. New storage locations or migrations require a documented compatibility and rollback plan.

## Sensitive change boundaries

Treat changes to these areas as security- or compatibility-sensitive:

- renderer-to-main IPC and preload exports;
- remote webview navigation and permissions;
- credential autofill and origin matching;
- user-selected filesystem capabilities;
- downloader and media subprocess arguments;
- native ABI and bundled runtime libraries;
- Dali compiler validation and generated runtime code.

## Further reading

- [Features](FEATURES.md)
- [Security](SECURITY.md)
- [Audio Engine](AUDIO_ENGINE.md)
- [Dali Language](DALI_LANGUAGE.md)
- [Building](BUILDING.md)
- [Packaging](PACKAGING.md)
