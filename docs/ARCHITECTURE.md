# Architecture overview

This document is a contributor map, not a specification. Confirm behavior in the source before changing a subsystem.

## Runtime layers

| Layer | Primary locations | Responsibility |
| --- | --- | --- |
| Electron main process | `main.js`, `modules/` | Windows, lifecycle, IPC, filesystem access, downloads, permissions, updates, and OS integration |
| Preload bridge | `preload.js`, `webviewAdblockPreload.js` | Narrow APIs between isolated renderers and privileged main-process operations |
| Renderer UI | `renderer.js`, `*Renderer.js`, `*.html`, `styles/` | User interface, playback workflow, settings, and feature windows |
| Native audio | `native/` | C++ audio/DSP addon and native runtime libraries |
| Visualizer | `visualizer/`, `third_party/imgui/` | C++ projectM visualization executable and UI integration |
| Resources | `resources/`, `assets/`, `icons/`, `locales/` | Rulesets, presets, media assets, icons, fonts, and translations |
| Packaging | `package.json`, `packaging/`, `.github/workflows/` | Electron Builder outputs, distribution metadata, CI, and releases |

## Change boundaries

The most sensitive boundaries are renderer-to-main IPC, remote web content in Electron webviews, user-selected filesystem paths, spawned media tools, native ABI compatibility, and bundled shared libraries. Treat changes across these boundaries as security- and compatibility-sensitive.

Hardware-aware audio and rendering paths are intentional. Do not simplify or replace them based only on style preferences. Changes require representative measurements and maintainer review.

## Data and settings

User settings and caches are managed through main-process services and Electron application paths. Contributors should not introduce new storage locations or silently migrate data without a documented compatibility and rollback plan.

## Further reading

- [Building](BUILDING.md)
- [Security model](SECURITY.md)
- [Packaging](PACKAGING.md)
