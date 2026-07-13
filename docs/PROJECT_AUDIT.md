# Repository audit and maintainer recommendations

Audit date: 2026-07-14. Scope: repository structure, product metadata, Electron security boundaries, native/build configuration, Linux packaging, GitHub Actions, release automation, documentation, and community health.

## Outcome

The audit found a mature feature set and several good defensive controls: isolated Electron renderers, hardened webviews, permission/navigation handling, binary integrity verification, dependency automation, security scanning, release checksums, native smoke checks, and multi-format Linux packaging.

The critical consistency findings were corrected for the published v5.2.13 baseline:

- product version metadata is `5.2.13`;
- product licensing is `GPL-3.0-only`, matching the root license;
- repository and electron-builder publishing coordinates point to `Muhammed-Dali/ArDali-WebMedia`;
- Electron packaging, dependency, Linux CI, and Windows CI use `40.6.1`;
- the AUR AppImage uses its verified SHA-256 instead of `SKIP`;
- normal build jobs use read-only repository permissions;
- third-party Actions are pinned to reviewed commit SHAs;
- projectM release source is verified before extraction;
- automatic version commits and tags on every `main` push were removed;
- a metadata consistency gate now fails builds when release sources drift.

Independent subprojects and third-party dependencies retain their own versions and licenses.

## Remaining high-priority work

### Existing tags newer than the published release

Local repository history contains `v5.2.14` and `v5.2.15`, while GitHub's latest published release is v5.2.13. Determine whether those tags exist on the remote and whether they should remain reserved. Do not delete or move them without explicit coordination. The next release must use a never-published, never-tagged version.

### AUR publication is external

The in-repository AUR recipe is corrected, but the live AUR Git repository must be updated separately. Publishing to AUR is an external state change and was not performed by this audit.

### Flatpak publication is pending

The manifest, wrapper, AppStream metadata, submission preparation, and CI validation are present. Flathub publication remains pending because the current manifest consumes a locally prebuilt Electron bundle and may require an offline source-build redesign during review.

### Privileged IPC review

The main process exposes a broad IPC surface for filesystem writes, media repair/muxing, downloads, cookies, external URLs, settings, and recording. Existing hardening is positive, but a handler inventory should record allowed sender, input schema, path/URL policy, side effect, and tests. This is a risk area, not a confirmed vulnerability.

### Generated files in source history

Tracked CMake caches, object files, binaries, logs, and compilation databases enlarge clones and expose local paths. Remove them from the current tree in a dedicated reviewed cleanup. Git history rewriting is destructive and must remain a separate, explicitly approved operation.

### Security workflow consolidation

Two Semgrep workflows and chained scanner jobs overlap. Consolidate them only after deciding which checks are required for pull requests and which need authenticated main-branch monitoring.

## GitHub settings requiring maintainer action

Recommended description:

> Open-source Linux media workspace with music and video playback, web media, 32-band EQ, DSP, projectM visualizer, downloads, screen recording, and MPRIS.

Recommended topics:

`linux`, `media-player`, `music-player`, `video-player`, `electron`, `cpp`, `audio`, `dsp`, `equalizer`, `projectm`, `visualizer`, `mpris`, `appimage`, `arch-linux`, `wayland`, `open-source`

Set the website to `https://muhammed-dali.github.io/ArDali-WebMedia/`, upload a 1280×640 social preview, enable private vulnerability reporting, and protect `main` and release tags with required checks and review.

## Stability statement

No runtime application source, native C++ implementation, DSP behavior, hardware optimization, performance path, or renderer interaction was changed by the professionalization work. Workflow and packaging changes should still pass hosted CI before merge because they affect release infrastructure.
