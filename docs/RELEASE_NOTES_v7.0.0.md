# ArDali Browser 7.0.0 FINAL RELEASE

Released on 10 September 2026.

ArDali Browser 7.0.0 is a major milestone release that elevates the native Qt 6 / C++20 browser platform with an adaptive segmented download engine, intelligent Omnibox navigation, granular site permissions, hardware acceleration, full AutoEQ headphone preset integration, and a production-grade packaging foundation.

## Key Highlights

### 1. GeneralDownloadManager & Adaptive Parallel Engine
- **Adaptive Stream Scaling**: Dynamic connection ramp-up (1 → 2 → 4 → 8 parallel streams) adapting to network latency and bandwidth.
- **Resilient Transfer Pipeline**: Robust pause, resume, cancel, and segment-level automatic retry with direct-offset preallocation and chunk-level integrity verification.
- **Bandwidth & Concurrency Controls**: Intelligent global slot concurrency budgeting, anti-thrashing heuristics, and HTTP 429 backoff.
- **Download UI & Management**: Dedicated toolbar download popup (`DownloadToolbarUI`) with live speed metering and a full-featured internal downloads page (`ardali://downloads`).

### 2. Smart Omnibox & Address Input Resolution
- **Composite Candidate Architecture**: Seamlessly merges history candidates, bookmark matches, and frequent sites with weighted relevance scoring.
- **Domain Normalization**: Robust host and URL parsing with IPv4/IPv6 sanitization.
- **Multi-Engine Search Suggestions**: Real-time asynchronous suggestion provider supporting DuckDuckGo, Google, Brave, and Bing.

### 3. Site Permissions & Security Bubble
- **Granular Origin Permissions**: Per-site control over camera, microphone, geolocation, desktop notifications, popups, insecure content, and JavaScript optimization.
- **Site Controls Bubble**: Intuitive toolbar popup displaying active permissions, tracker stats, and quick reset actions.
- **Permission Hygiene**: Automatic revocation of dormant permissions for enhanced privacy.

### 4. Encrypted Local Password Vault & Autofill
- **Zero-Cloud Local Storage**: Credentials protected via AES-256-GCM encryption and PBKDF2-HMAC-SHA256 key derivation.
- **Native Autofill Controller**: In-page credential detection, secure login autofill, and automatic credential save bubbles.
- **Protected Vault Management**: Dedicated `ardali://passwords` interface with master password authentication and experimental vault locking.

### 5. ArDali Blocker & Content Filter
- **Three-Tier Filtering**: Temel (Light 35%), İdeal (Balanced 65%), and Kapsamlı (Aggressive 95%) protection modes.
- **Cosmetic & Procedural Filtering**: Injected stylesheet runtime, DOM mutation observers, scriptlet isolation, and anti-adblock mitigation.
- **Full Ruleset Catalog**: Bundled EasyList, EasyPrivacy, Peter Lowe, regional filters, and web-accessible mock resources.

### 6. Audiophile Sound Engine & 1,757 AutoEQ Presets
- **32-Band Studio Equalizer**: High-precision peaking filters driven by DALI Web Audio DSP.
- **Comprehensive Audio Suite**: BASS FX Reverb, Dynamic Compressor, Brickwall Limiter, True Peak Limiter, Parametric EQ, Dynamic EQ, Exciter, De-esser, Noise Gate, Stereo Widener v2, and Echo.
- **1,757 Calibrated Headphone Profiles**: Complete AutoEQ database bundled directly into the application for studio-grade frequency response calibration.

### 7. Desktop Integration & Packaging
- **Clean Linux Integration**: XDG `.desktop` specifications, full hicolor icon resolution set (16px to 1024px), and MIME associations.
- **Packaging Parity**: Verified PKGBUILDs and `.SRCINFO` for Arch Linux, AUR (`ardali`, `ardali-bin`), and pacman repository.
- **CMake Install Standard**: Complete GNUInstallDirs compliance distributing executables, icons, AutoEQ presets, and adblock filters.

## Verification & Platform Status

- **Build Target**: Linux x86_64 (Qt 6.4+, GCC 12+ / Clang 15+).
- **Test Suite**: 27/27 CTest suites passing (100% pass rate) with strict assertion verification (`-UNDEBUG`).
- **Packaging Invariants**: Verified clean destination install tree with all 1,757 AutoEQ JSON files and filter rulesets.

## License

ArDali Browser is licensed under GPL-3.0-only. Third-party adblock filters and ruleset resources retain their respective copyright and license notices in `browser/resources/adblock/NOTICE.txt`.
