![ArDali Browser](docs/images/ardali-browser-main.png)

<p align="center">
  <img src="browser/assets/icons/ardali-browser-128.png" width="112" height="112" alt="ArDali Browser icon">
</p>

<h1 align="center">ArDali Browser</h1>

<p align="center">
  A native, privacy-oriented desktop browser with integrated media tools.
</p>

<p align="center">
  <a href="https://github.com/Muhammed-Dali/ArDali-Browser/actions/workflows/ci.yml"><img alt="Native CI" src="https://github.com/Muhammed-Dali/ArDali-Browser/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/Muhammed-Dali/ArDali-Browser/releases/tag/v6.0.0"><img alt="Release 6.0.0" src="https://img.shields.io/badge/release-v6.0.0-21b7d8"></a>
  <a href="LICENSE"><img alt="License GPL-3.0-only" src="https://img.shields.io/badge/license-GPL--3.0--only-blue"></a>
  <img alt="Platform Linux" src="https://img.shields.io/badge/platform-Linux-FCC624?logo=linux&logoColor=111">
  <img alt="Qt 6" src="https://img.shields.io/badge/Qt-6.5%2B-41CD52?logo=qt&logoColor=white">
</p>

## About

ArDali Browser is an open-source desktop browser built with C++20, Qt 6, and
Qt WebEngine. It combines modern tabbed browsing with local privacy controls,
media-focused audio processing, music recognition, and an encrypted credential
vault. Linux is the verified release platform for version 6.0.0.

## Highlights

- **Native browsing:** Qt WebEngine rendering in a native Qt Widgets shell.
- **Modern tabs:** Reordering, detachable tabs, hover previews, session
  restoration, and internal application pages.
- **ArDali Blocker:** ArDali Browser's built-in advertising and tracker
  protection system, with site-specific controls, configurable filter lists,
  cosmetic and extended filtering, and logs.
- **ArDali Pulse:** Identify music captured from system audio or a microphone
  and open matching results on configured music services.
- **Password Manager:** Encrypted local credential vault with explicit unlock
  and fill controls.
- **Audio tools:** Output processing, equalizer presets, compressor, limiter,
  bass enhancement, and automatic gain controls.
- **Custom new tab:** Search, shortcuts, cards, background choices, and layout
  controls.
- **Browser settings:** Native settings for browsing, privacy, content,
  passwords, Pulse, downloads, accessibility, and appearance.

## Screenshots

### Native browsing

The main browser window uses native chrome, multi-tab navigation, and Qt
WebEngine content rendering.

![ArDali Browser main window](docs/images/ardali-browser-main.png)

### ArDali Blocker

ArDali Blocker is ArDali Browser's built-in advertising and tracker protection
engine. Its native filtering engine is developed as part of ArDali Browser.

It provides network filtering, tracker protection, site-specific controls,
configurable filter lists, cosmetic and extended filtering, logs, and developer
inspection through the built-in blocker interface.

![ArDali Blocker](docs/images/ardali-blocker.png)

### ArDali Pulse

Recognize music from system audio or a microphone without leaving the browser.

![ArDali Pulse](docs/images/ardali-pulse.png)

### Password Manager

Credentials are stored in an encrypted local vault that starts locked.

![ArDali Password Manager](docs/images/password-manager.png)

### Audio effects

Tune browser media with modular output processing and equalizer tools.

![ArDali audio effects](docs/images/audio-effects.png)

## Installation

### Arch Linux package recipe

The native source package is published in the
[`ardali-browser` AUR listing](https://aur.archlinux.org/packages/ardali-browser):

```bash
yay -S ardali-browser
```

The same recipe is kept in
[`packaging/archlinux/PKGBUILD`](packaging/archlinux/PKGBUILD) and can be built
directly from the repository:

```bash
cd packaging/archlinux
makepkg -si
```

The package replaces the historical `ardali-bin`/`ardali-webmedia` package
identity and installs the new `ardali-browser` executable.

### Build from source

On Arch Linux, install the verified native build dependencies:

```bash
sudo pacman -S --needed base-devel cmake ninja nodejs openssl ffmpeg \
  qt6-base qt6-imageformats qt6-svg qt6-webengine
```

Configure, build, and test:

```bash
cmake -S browser -B browser/build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build browser/build -j"$(nproc)"
ctest --test-dir browser/build --output-on-failure
```

Run the development build:

```bash
./browser/build/ardali-browser
```

Or install into a chosen prefix:

```bash
cmake --install browser/build --prefix /usr/local
```

### Platform status

- **Linux:** Verified build, test, desktop integration, and Arch packaging
  target for 6.0.0.
- **Windows:** The source tree contains Windows resource integration, but no
  official 6.0.0 Windows artifact is promised until its build pipeline is
  independently verified.

## Project structure

```text
ArDali/
├── browser/
│   ├── native/
│   │   ├── main.cpp
│   │   ├── audio/
│   │   ├── blocker/
│   │   ├── core/
│   │   ├── eq/
│   │   ├── newtab/
│   │   ├── passwords/
│   │   ├── pulse/
│   │   ├── session/
│   │   ├── settings/
│   │   ├── sidebar/
│   │   └── tabs/
│   ├── resources/
│   └── CMakeLists.txt
├── dali-lang/
├── docs/
├── packaging/
└── CMakeLists.txt
```

The DALI toolchain compiles the browser's declarative audio and policy inputs
during the native CMake build.

## Privacy and security

- Blocking and cosmetic filtering are performed locally from bundled rulesets.
- The credential vault encrypts stored records and starts locked.
- Internal pages use explicit capability boundaries in the native tab model.
- ArDali Pulse sends captured fingerprints to its configured recognition
  backend only when recognition is initiated.

No browser can guarantee complete privacy or protection. Review the source,
settings, and enabled rulesets for your environment.

## Contributing

Issues and pull requests are welcome. Please include reproducible steps for bug
reports, run the relevant CTest targets, and avoid committing generated build
output or personal data. Use GitHub's private security-advisory form for
vulnerabilities.

## Support ArDali Browser

ArDali Browser is an independent open-source project. If you find it useful,
you can support its continued development through the Sponsor button.

## License

ArDali Browser is licensed under **GPL-3.0-only**. See [LICENSE](LICENSE) for
the binding license text.

## Third-party components

Bundled third-party filter data, generated rulesets, scriptlets, and resources
retain their respective copyright and license notices. See
[`browser/resources/adblock/NOTICE.txt`](browser/resources/adblock/NOTICE.txt)
for attribution details.
