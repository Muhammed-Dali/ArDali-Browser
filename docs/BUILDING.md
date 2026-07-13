# Building from source

ArDali's full Linux build combines Electron, Node.js native modules, CMake/C++, SDL2, projectM, and distribution packaging tools. The GitHub Linux workflow is the authoritative executable reference for CI dependencies.

## Baseline tools

- Git
- Node.js 22.12 or later in the Node 22 line
- npm with lockfile support
- CMake, Ninja or Make, a C/C++ toolchain, Python 3, and `pkg-config`
- Development headers for ALSA/PulseAudio, OpenGL, SDL2/SDL2_image, GTK, and related image/font libraries
- projectM 4 development libraries for the visualizer
- FFmpeg for media workflows

Package names differ by distribution. Review `.github/workflows/build-linux.yml` for the Ubuntu package list and translate it to your distribution.

## Checkout and JavaScript dependencies

```bash
git clone https://github.com/Muhammed-Dali/ArDali-WebMedia.git
cd ArDali-WebMedia
npm ci
npm --prefix native ci
```

Do not casually regenerate lockfiles with a different package manager. The root metadata currently contains historical package-manager information, while CI uses npm; keep changes reviewable and follow the CI path.

## Development run

```bash
npm start
```

The Linux development script configures native library paths and Chromium flags expected by this project. Running Electron directly may not reproduce the supported environment.

## Native and visualizer components

Rebuild the native addon with:

```bash
npm run rebuild-native
```

The projectM visualizer is built separately by CMake in CI. Its exact build and runtime library copy steps are documented in `.github/workflows/build-linux.yml`.

## Validation

```bash
npm run verify:i18n
npm run verify:binary:manifest
npm run native:audio:smoke
```

For a full Linux package build:

```bash
npm run build:linux
```

This is resource intensive and produces release-like artifacts under `dist/`. Do not commit generated output.

## Windows

See [WINDOWS-BUILD.md](../WINDOWS-BUILD.md). The Windows workflow and Electron ABI settings must match `package.json` before treating a build as release-ready.
