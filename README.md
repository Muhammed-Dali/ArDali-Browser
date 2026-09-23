<p align="center">
  <img src="docs/images/dalinira-icon.png" width="128" height="128" alt="DaliNira Browser Logo">
</p>

<h1 align="center">DaliNira Browser</h1>

<p align="center">
  <strong>A privacy-focused, high-performance Qt 6 / C++20 desktop web browser featuring an adaptive parallel download engine and an integrated audiophile DSP sound system.</strong>
</p>

<p align="center">
  <a href="https://github.com/Muhammed-Dali/DaliNira-Browser/releases/tag/v7.2.0"><img src="https://img.shields.io/badge/release-v7.2.0-007ACC.svg?style=flat-square" alt="Release v7.2.0"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0--only-success.svg?style=flat-square" alt="License GPL-3.0"></a>
  <img src="https://img.shields.io/badge/C%2B%2B-20-00599C.svg?style=flat-square&logo=c%2B%2B" alt="C++20">
  <img src="https://img.shields.io/badge/Qt-6.4+-41CD52.svg?style=flat-square&logo=qt" alt="Qt 6">
  <img src="https://img.shields.io/badge/Platform-Linux-FCC624.svg?style=flat-square&logo=linux&logoColor=black" alt="Linux">
  <img src="https://img.shields.io/badge/Tests-Passing-brightgreen.svg?style=flat-square" alt="Test Status">
  <img src="https://img.shields.io/badge/AutoEQ%20Presets-1757-9cf.svg?style=flat-square" alt="AutoEQ">
</p>

---

### Quick Download & Installation Options

| Installation Method | Command / Source | Description |
|---|---|---|
| **AUR** | `yay -S dalinira` | Precompiled Linux x86_64 package from the Arch User Repository |
| **DaliNira Pacman Repo** | `sudo pacman -Syu dalinira` | Binary package from the DaliNira repository *(configure it first)* |
| **GitHub Releases** | [Releases Page](https://github.com/Muhammed-Dali/DaliNira-Browser/releases) | Precompiled standalone `.tar.zst` bundles and source tarballs |
| **Official Website** | [DaliNira Browser Website](https://muhammed-dali.github.io/DaliNira-Browser/) | Product overview, features, screenshots, and download links |

---

<p align="center">
  <img src="docs/images/dalinira-browser.png" width="100%" alt="DaliNira Browser Hero Interface">
</p>

---

## About the Project

**DaliNira Browser** is an independent, native Qt 6 / C++20 desktop web browser engineered to unite modern web standards, rigorous personal privacy, high-throughput file downloading, and studio-grade sound reproduction.

Built on top of the Chromium-powered **Qt WebEngine** foundation, DaliNira Browser delivers a full-featured internet experience without relying on bloated third-party extensions or intrusive cloud synchronizations. Everything operates locally on your device: an ad and tracking blocker, an adaptive segmented download manager, an encrypted password vault, instant music recognition, and a 32-band peaking equalizer with over 1,750 calibrated AutoEQ headphone correction profiles.

---

## Key Features and Advantages

- **Native Qt 6 & C++20 Architecture:** Zero Electron or web-wrapper overhead. Fast startup, minimal idle RAM consumption, and a responsive Fusion dark theme designed specifically for Linux desktop environments.
- **Hardware-Accelerated WebEngine:** Zero-copy GPU video decoding pipelines, early driver initialization, a child subprocess memory allocator, and active memory pressure monitoring.
- **GeneralDownloadManager (Adaptive Parallel Engine):** Multi-stream downloader that automatically scales connections from **1 → 2 → 4 → 8** parallel streams, featuring dynamic work-stealing, chunk pre-allocation, part-level retries, and HTTP 429 throttling backoff.
- **Smart Omnibox Navigation:** Composite candidate ranking engine combining browser history, bookmarks, and frequent sites with domain normalization and real-time search suggestions (DuckDuckGo, Google, Brave, Bing).
- **DaliNira Blocker & Privacy Shield:** Three protection modes (Basic, Balanced, and Aggressive) supporting network request interception, CSS cosmetic filtering, scriptlet injection, and tracking parameter stripping.
- **Zero-Cloud Encrypted Password Vault:** AES-256-GCM encryption with PBKDF2-HMAC-SHA256 key derivation. Completely local, zero-leak credential storage with intelligent in-page autofill and save prompts.
- **Granular Origin Permissions (Site Controls):** Instant toolbar bubble to monitor and toggle permissions per site for Camera, Microphone, Geolocation, Notifications, Popups, and JavaScript optimization, backed by automatic hygiene policies.
- **DALI Web Audio & 1,757 AutoEQ Presets:** 32-band peaking equalizer, BASS FX Reverb, Dynamic Compressor, Brickwall Limiter, Stereo Widener, and factory-calibrated frequency curves for thousands of audiophile headphones.
- **DaliNira Pulse (Song Recognition):** Built-in audio analyzer that identifies playing music directly from system audio or microphone input without third-party services.
- **Seamless Linux Desktop Integration:** Strict XDG desktop standards, complete hicolor icon sets (16px through 1024px), and Wayland/X11 compatibility.

---

## Screenshots & Feature Walkthrough

### 1. Modern Desktop Interface & Smart New Tab Experience

> **Main Browser Window & New Tab Page (`dalinira://newtab`)**
>
> The hero image above presents DaliNira Browser's distraction-free desktop interface and customizable New Tab page. Users can choose colorful backgrounds, clock styles and positions, switch search engines, recall saved searches through autocomplete, open frequently visited sites, and monitor real-time blocked-request statistics. The top tab strip adds memory-aware hover cards, animated loading indicators, and an optional bookmarks bar.

---

### 2. DaliNira Blocker — Integrated Ad and Tracker Protection

![DaliNira Blocker](docs/images/dalinira-blocker.png)

> **DaliNira Blocker Dashboard (`dalinira://blocker`)**
>
> Designed to preserve bandwidth and privacy, DaliNira Blocker offers three distinct operational tiers: **Basic (35% - Light)**, **Ideal (65% - Balanced)**, and **Comprehensive (95% - Strict)**. It evaluates EasyList, EasyPrivacy, Peter Lowe, and regional filter lists locally. Advanced cosmetic filtering eliminates blank ad spaces, scriptlet injection mitigates anti-adblock mechanisms, and strict blocking prevents unwanted popups.

---

### 3. Password Manager — Encrypted Local Credential Vault

![Password Manager](docs/images/password-manager.png)

> **Secure Local Vault (`dalinira://passwords`)**
>
> Your passwords are never transmitted to cloud servers. DaliNira's Credential Vault uses **PBKDF2** key derivation and **AES-256-GCM** encryption to safeguard credentials in isolated disk storage. When login fields are detected, the browser securely offers autofill options, while newly entered credentials can be added to the master-password-protected vault with a single click.

---

### 4. DaliNira Pulse — Real-Time Music & Audio Recognition

![DaliNira Pulse](docs/images/dalinira-pulse.png)

> **Song Finder & Spectrum Analyzer (`dalinira://song-finder`)**
>
> Whether music is playing in a browser tab or any other desktop application, DaliNira Pulse captures and identifies the track within seconds using system audio or microphone input. Recognition history, artist names, and album details are archived locally for quick reference.

---

### 5. Advanced Download Manager & Adaptive Parallel Engine

![Downloads Manager](docs/images/downloads.png)

> **Downloads Center (`dalinira://downloads`) & Toolbar Download Popup**
>
> Powered by the **GeneralDownloadManager** engine, the browser analyzes incoming links and leverages HTTP `Range` headers to split files into concurrent chunks. The engine dynamically ramps connection counts from **1 → 2 → 4 → 8** streams depending on latency and server capabilities, resumes interrupted downloads from the exact byte, and performs automatic chunk-level retries.

---

### 6. 32-Band Studio Equalizer & 1,757 AutoEQ Presets

![Audio Effects and Equalizer](docs/images/audio-effects.png)

> **DALI Web Audio Processing Suite (`dalinira://audio-effects` & `dalinira://eq-presets`)**
>
> Geared toward audiophiles, this system routes web media through 32 precision peaking filters. The suite features **BASS FX Reverb, Dynamic Compressor, Brickwall Limiter, True Peak Limiter, Parametric EQ, Dynamic EQ, Harmonic Exciter, De-esser, Intelligent Noise Gate, Stereo Widener v2, and Echo**. Furthermore, **1,757 calibrated AutoEQ headphone profiles** (covering Sony, Sennheiser, AKG, Beyerdynamic, Apple, Bose, and Audio-Technica) are bundled out of the box.

---

## Installation Methods

### 1. Arch Linux / Manjaro (AUR)

DaliNira Browser is officially packaged in the Arch User Repository:

Install the precompiled x86_64 package:

```bash
yay -S dalinira
```

---

### 2. Official DaliNira Pacman Repository (Signed)

All packages and repository databases are cryptographically signed with the official GPG release key (`BC741FD0AC804351B0DDBB86FDFEC60C11202588`).

You can automatically import the GPG signing key, register the repository into `/etc/pacman.conf`, and install DaliNira Browser without manually editing configuration files:

```bash
# 1. Import and locally trust the official GPG signing key
curl -sL https://github.com/Muhammed-Dali/DaliNira-Browser/releases/download/pacman-repo/dalinira.gpg | sudo pacman-key --add -
sudo pacman-key --lsign-key BC741FD0AC804351B0DDBB86FDFEC60C11202588

# 2. Add the repository to pacman.conf and install
echo -e "\n[dalinira]\nSigLevel = Required DatabaseOptional\nServer = https://github.com/Muhammed-Dali/DaliNira-Browser/releases/download/pacman-repo" | sudo tee -a /etc/pacman.conf
sudo pacman -Syu dalinira
```

---

### 3. Standalone GitHub Releases Archive

For a direct, package-manager-free installation:

1. Download the latest `dalinira-browser-7.2.0-linux-x86_64.tar.zst` from the [GitHub Releases](https://github.com/Muhammed-Dali/DaliNira-Browser/releases) page.
2. Extract the archive and merge the directory tree into `/usr`:

```bash
tar -I zstd -xvf dalinira-browser-7.2.0-linux-x86_64.tar.zst
sudo cp -r usr/* /usr/
```

---

## Building from Source

### 1. System Prerequisites

Building DaliNira Browser requires a C++20-compliant compiler, CMake, Ninja, and Qt 6 development libraries:

**Arch Linux / Manjaro:**
```bash
sudo pacman -S --needed base-devel cmake ninja git nodejs \
  qt6-base qt6-webengine qt6-svg qt6-imageformats \
  openssl libpsl pkgconf ffmpeg libsecret
```

**Ubuntu 24.04+ / Debian 13+:**
```bash
sudo apt update
sudo apt install build-essential cmake ninja-build git nodejs \
  qt6-base-dev qt6-webengine-dev libqt6svg6-dev libqt6webenginewidgets6 \
  libssl-dev libpsl-dev pkg-config ffmpeg libsecret-1-dev
```

**Fedora 39+:**
```bash
sudo dnf install gcc-c++ cmake ninja-build git nodejs \
  qt6-qtbase-devel qt6-qtwebengine-devel qt6-qtsvg-devel \
  openssl-devel libpsl-devel pkgconf-pkg-config ffmpeg-free libsecret-devel
```

---

### 2. Compilation Steps

```bash
# Clone the repository
git clone https://github.com/Muhammed-Dali/DaliNira-Browser.git
cd DaliNira-Browser

# Configure with CMake (Release mode)
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release

# Compile across all available CPU cores
cmake --build build -j$(nproc)
```

### 3. Running & Verifying

Run the browser directly from the build directory:

```bash
./build/dalinira-browser
```

Execute the full automated test suite:

```bash
ctest --test-dir build --output-on-failure
```

Install directly to the system prefix:

```bash
sudo cmake --install build
```

---

## Developer & Contributor Documentation

For detailed technical guides, architecture design documents, and contribution workflows:

- **[Architecture Guide](docs/ARCHITECTURE.md):** Subsystem architecture, process startup sequence, ownership and lifetime models, and source map.
- **[Building Guide](docs/BUILDING.md):** Detailed build dependencies, distro package lists, and optional integration fallbacks.
- **[Testing Guide](docs/TESTING.md):** CTest test suites, running targeted test binaries, and headless CI execution.
- **[Debugging Guide](docs/DEBUGGING.md):** Terminal diagnostics, remote Chromium inspection, GDB backtraces, and subsystem logging.
- **[Contributing Guide](CONTRIBUTING.md):** Development guidelines, coding conventions, and pull request workflows.
- **[Security Policy](SECURITY.md):** Vulnerability reporting and security architecture summary.

### Contributor Workflow

Major native modules live under `browser/native/` (with subsystem directories such as
`core/`, `desktop_tabs/`, `downloads/`, `blocker/`, `passwords/`, `audio/`, `eq/`,
and `pulse/`); runtime assets are in `browser/resources/`, tests are in
`browser/native/tests/`, and release recipes are in `packaging/`.

Configure and build a Release tree with:

```bash
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build build -j$(nproc)
```

During development, run a focused test by name or label, for example:

```bash
ctest --test-dir build -R 'password|credential-vault' --output-on-failure
```

Before final submission, run the complete suite with `ctest --test-dir build
--output-on-failure`. Prefer small, understandable changes and pull requests that
address one concern.

### Core Source Layout

DaliNira Browser employs a clean, decoupled C++ module structure:

- **`browser/native/core/`**: Profile lifecycle, smart address input resolver, async search suggestions, and GPU hardware acceleration.
- **`browser/native/desktop_tabs/`**: Tab layout engine, tab drag-and-drop controller, tab hover memory cards, and memory pressure monitoring.
- **`browser/native/downloads/`**: `GeneralDownloadManager` adaptive multi-connection engine, transfer UI models, and platform registries.
- **`browser/native/blocker/`**: `DaliNiraBlockerEngine`, cosmetic CSS injection runtime, ruleset list manager, and toolbar shield button.
- **`browser/native/passwords/`**: Encrypted `CredentialVault`, `DeviceKeyring` OS secret service binding, autofill coordinator, and credential save bubbles.
- **`browser/native/audio/` & `browser/native/eq/`**: Web Audio DSP pipeline, 32-band peaking equalizer, and 1,757 AutoEQ JSON profiles.
- **`browser/native/pulse/`**: `SongRecognitionService` real-time audio capture and music recognition.
- **`browser/resources/`**: AdBlock filter catalogs, AutoEQ frequency JSON files, and Linux `.desktop.in` templates.
- **`packaging/`**: Arch Linux PKGBUILD recipes, AUR manifests, and pacman repository publication definitions.

---

## License & Third-Party Notices

- **DaliNira Browser**: Licensed under the [GNU General Public License v3.0](LICENSE).
- **AdBlock Filters & Rulesets**: EasyList, EasyPrivacy, Peter Lowe, and community filter lists retain their respective copyrights and licenses. See [NOTICE.txt](browser/resources/adblock/NOTICE.txt) for full details.
- **AutoEQ Profiles**: Derived from calibrated headphone frequency response curves curated by Jaakko Pasanen and the AutoEQ project.
