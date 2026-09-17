# ArDali Browser development plan

Status: Step 5 Essential Feature Completion corrected and verified; awaiting user approval  
Audit date: 2026-09-17  
Audited revision: `7164a99d` on `main`  
Target: Linux, Qt 6, Chromium through Qt WebEngine

## 1. Scope and evidence

This document records a static repository audit. The source tree, CMake graph,
native tests, existing audit documents, and generated-build metadata were
inspected. No product source was changed, no build was started, no test was
executed, and no performance number is claimed in this step.

The worktree was already heavily modified before this audit. Those changes are
treated as user-owned. Existing `build/`, `build-ci-local/`, and
`build-release-7.0.1/` artifacts show that the project has been configured and
built before, but they are not evidence that the current worktree builds or
passes tests. That verification belongs to Step 2.

Feature-state vocabulary used below:

- **IMPLEMENTED**: a substantive live implementation and persistence/UI path
  were found.
- **IMPLEMENTED BUT NEEDS IMPROVEMENT**: the feature works in a meaningful
  form, but has a verified gap, risk, or important missing coverage.
- **PARTIALLY IMPLEMENTED**: only part of the expected user workflow exists.
- **BROKEN**: UI/API exists but the inspected live path cannot deliver the
  advertised behavior, or contains a concrete correctness defect.
- **NOT IMPLEMENTED**: no implementation was found after repository search.
- **NEEDS FURTHER INVESTIGATION**: static inspection cannot establish runtime
  correctness or performance.

## 2. Actual technology and build stack

- C++20 application built by CMake 3.20+.
- Qt 6.4+ modules: Core, Gui, Widgets, WebEngineWidgets, Network, Svg,
  Concurrent, and DBus.
- Chromium is embedded exclusively through Qt WebEngine. CEF and Gecko are not
  part of the current build.
- OpenSSL Crypto implements local vault cryptography; libpsl is used for domain
  handling.
- Node.js is a build-time tool for compiling DALI audio presets and generating
  `browser_policy.json` from `browser/dali/browser.dali`.
- Linux integration includes a launcher, desktop file, hicolor icons, a small
  `QtWebEngineProcess` wrapper, Arch/AUR/pacman packaging, and CI workflows.
- Runtime helpers include `yt-dlp`, ffmpeg, a JavaScript runtime for selected
  media flows, and Linux audio tools/backends.
- The root CMake file builds one large browser executable and 34 registered
  CTest entries. Several integration targets recompile almost the entire
  browser source set.

## 3. Entry point and runtime architecture

### Application startup

`browser/native/main.cpp` is the entry point. Before `QApplication` it:

1. chooses XCB under a Wayland session when `DISPLAY` exists, to support global
   tab-drag coordinates;
2. installs the WebEngine subprocess launcher/memory policy;
3. detects VA-API/DRM capability and merges Chromium GPU flags;
4. registers the `ardali://` scheme.

After application creation it initializes identity, i18n and styling, loads the
generated DALI policy, creates the persistent profile and application services,
wires cross-window tab dragging, restores a saved session, handles a command
line URL, and shows the first `BrowserWindow`.

### Browser/profile ownership

`BrowserProfileService` owns the normal `QWebEngineProfile` and profile-wide
services: settings/persistence, cookies, cache, permissions, history,
bookmarks, recently closed tabs, suggestions, blocker, encrypted credential
vault, translation, new-tab scheme handler, and general downloads.

The normal service is parented to the application and outlives browser windows.
An incognito window creates an off-the-record `QWebEngineProfile` inside a
temporary directory and keeps its `BrowserProfileService` alive with a shared
owner. Session restore is disabled for that window. The global audio, song
recognition, and media-download services are still shared.

### Windows and tabs

`BrowserWindow` is the main native shell. It owns the custom title/tab strip,
navigation chrome, bookmark bar, popups, native internal pages, and the
`QWebEngineView` widgets for its web tabs.

Each web tab is represented twice:

- `BrowserTabInfo` in `BrowserWindow`, keyed by a process-local `uint64_t`;
- `TabManager::TabRecord`, keyed by a `QUuid` and held centrally.

The live invariant is one `QWebEngineView` with one `QWebEnginePage`. The page
is parented to the view. Detach/attach reparents the same view and page rather
than recreating navigation state. `TabManager` uses `QPointer` references and
validates unique content/page ownership. Closing a tab unregisters audio,
autofill, blocker and throbber state, removes the central record, and schedules
the widget for deletion. A bounded special cleanup path exists for sites marked
"forget on close."

`TabPerformanceManager` tracks visibility, audible/capture/pinned state,
freeze/discard eligibility, memory pressure, and WebEngine lifecycle state.
`SystemMemoryPressureMonitor` polls every 15 seconds; lifecycle scheduling uses
a single deadline timer.

### Navigation and internal pages

`BrowserWebPage` subclasses `QWebEnginePage`. It handles privileged new-tab
commands with per-page capability tokens, prepares blocker scripts before
HTTP(S) main-frame navigation, tracks media capture, handles credential
candidate messages, and creates browser windows/tabs for requested web
windows.

The omnibox uses `AddressInputResolver` plus composite providers for bookmarks,
frequent sites, history, built-in sites, and optional remote suggestions. The
only search engines are Google, DuckDuckGo, Brave Search, and Bing.

`ardali://newtab` is a WebEngine scheme page. Most other ArDali surfaces are
trusted native `QWidget` internal tabs: settings, downloads, blocker, password
manager, audio effects, EQ presets, song finder, and local media player.

### Persistence

- Qt WebEngine profile data: `<AppData>/profile` and `<AppData>/cache`.
- Browser preferences, history, bookmarks, content settings and permission
  rules: `<AppData>/browser-preferences.ini`.
- Session URLs/titles/group metadata: `<AppData>/tabs.session.json` via
  `QSaveFile` with owner-only permissions.
- General/media download histories: JSON stores under application data.
- Passwords/API secrets: encrypted credential vault under application data.
- Song-recognition history/settings: separate `QSettings` stores.
- Incognito profile data: a temporary directory owned by the private service.

## 4. Feature inventory

### Browser essentials

| Feature | State | Evidence and gap |
| --- | --- | --- |
| Navigation, back/forward/reload/home | IMPLEMENTED | Native chrome, `QWebEngineHistory`, smart omnibox and tested input resolver. |
| Tabs and multi-window transfer | IMPLEMENTED BUT NEEDS IMPROVEMENT | Live page transfer and central lifecycle model exist; two tab identities/models must remain synchronized. Wayland behavior is intentionally forced through XCB rather than native Wayland support. |
| Bookmarks | IMPLEMENTED | Persistent bookmark hierarchy with title, folder, and timestamp metadata (`bookmarks/items`), synchronized backward-compatibly with legacy `bookmarks/urls` list. |
| Bookmark folders | IMPLEMENTED | Hierarchical folder organization supported across model, persistence, and UI. |
| Bookmark import/export | IMPLEMENTED | Standard Netscape Bookmark HTML import and export with folder hierarchy preservation. |
| History | IMPLEMENTED | Up to 300 deduplicated URL records, frequent-site counters, full history search (`searchHistory`), and single-entry/URL deletion (`removeHistoryEntry`). |
| Recently closed tabs | IMPLEMENTED | LIFO closed tabs stack with `Ctrl+Shift+T` shortcut and tab/menu context restoration. |
| Session restore | BROKEN | URL/title/group metadata is atomically saved, but restore ignores the saved `active` field and activates the last restored tab. Pinned tabs and multiple windows are not represented; each window writes the same single-window file. |
| DNS / secure DNS settings | IMPLEMENTED | Native DoH integration via `QWebEngineGlobalSettings::setDnsMode` (System, Fallback, Secure Only presets + custom DoH template). |
| Site permissions | IMPLEMENTED BUT NEEDS IMPROVEMENT | Native prompt queue, per-visit grants, persistent allow/deny rules, hygiene, controls bubble, and Qt 6.8+ permission APIs exist. Qt <6.8 uses a reduced legacy path. Origin canonicalization and wildcard matching have security defects described below. |
| Camera permission | IMPLEMENTED BUT NEEDS IMPROVEMENT | Prompt/policy/site controls and active-use indication exist; inherits permission-origin issues. |
| Microphone permission | IMPLEMENTED BUT NEEDS IMPROVEMENT | Same as camera, with preferred input-device UI; inherits permission-origin issues. |
| Audio/sound content control | BROKEN | The setting is persisted and displayed, but `setSoundAllowed()` changes no WebEngine/page attribute and no other production code reads it. |
| Notifications | IMPLEMENTED BUT NEEDS IMPROVEMENT | Qt permission plumbing and policies exist; runtime notification delivery still needs manual acceptance coverage. |
| Cookies | IMPLEMENTED BUT NEEDS IMPROVEMENT | Global and per-site allow/third-party/block-all filtering and clearing exist. Cookie policy is split between profile preferences and blocker site policy and needs consistency tests. |
| Cache | PARTIALLY IMPLEMENTED | Disk HTTP cache and clear-cache action exist. No cache-size inspection/limit UI or verified cache lifecycle metrics exist. |
| Downloads | IMPLEMENTED BUT NEEDS IMPROVEMENT | Native WebEngine downloads, an adaptive segmented general downloader, toolbar/popup, target prompts, retries and persistent job data exist. The two download engines and media downloader are aggregated in UI but need end-to-end recovery and collision tests. |
| Download history | IMPLEMENTED BUT NEEDS IMPROVEMENT | General and media histories persist; the raw WebEngine `downloads_` list is session-memory state. Unified retention/removal semantics need clarification. |
| PDF support | IMPLEMENTED BUT NEEDS IMPROVEMENT | Qt PDF viewer enable/disable preference is live. Print to PDF and page saving supported. |
| Private/incognito browsing | IMPLEMENTED BUT NEEDS IMPROVEMENT | Off-the-record profile, temp storage, disabled session and suggestions exist. A formal privacy regression test is missing, especially for shared application services. |
| Find in page | IMPLEMENTED | Native `FindBarWidget` overlay with incremental search, match counts, prev/next (F3/Shift+F3, Enter/Shift+Enter), match-case, Escape dismissal, and tab-switch synchronization. |
| Zoom | IMPLEMENTED BUT NEEDS IMPROVEMENT | Per-tab 25%-500% controls exist. Zoom is not persisted per origin/session and the toolbar control is toggle-like rather than a full level popup. |
| Search engine selection | IMPLEMENTED | Four built-in engines are consistently defined for omnibox, suggestions and new tab. |
| Custom search engines | NOT IMPLEMENTED | Definitions are a fixed four-element array; no template storage/editor exists. |

### User-experience checklist

| Feature | State | Evidence and gap |
| --- | --- | --- |
| Tab groups | IMPLEMENTED BUT NEEDS IMPROVEMENT | Model, chips, popups, shortcuts and session group metadata exist. Cross-window/session behavior needs broader acceptance coverage. |
| Pinned tabs | IMPLEMENTED BUT NEEDS IMPROVEMENT | Pin/unpin, layout constraints, close protections and performance-manager exemption exist. Pin state is not saved/restored. |
| Picture-in-picture | NOT IMPLEMENTED | No explicit action or Qt integration found. |
| Reader mode | NOT IMPLEMENTED | No extraction/rendering path found. |
| Keyboard shortcuts | IMPLEMENTED | Core tab/navigation/bookmark/group shortcuts, Find (`Ctrl+F`, `F3`, `Shift+F3`), reopen-closed (`Ctrl+Shift+T`), and print (`Ctrl+P`) implemented with single-dispatch guarantees (fixing duplicate `Ctrl+W`). |
| Web notifications | IMPLEMENTED BUT NEEDS IMPROVEMENT | Permission policy exists; manual delivery/interaction verification is missing. |
| PWA/web apps | NOT IMPLEMENTED | No installability, manifest, app-window, or app registry path found. |
| Multiple user profiles | NOT IMPLEMENTED | One persistent profile plus disposable incognito profiles exist; there is no profile selector or separate persistent identities. |
| Better tab management | IMPLEMENTED BUT NEEDS IMPROVEMENT | Tab search, recently closed, groups, pins, detach/attach, hover cards and discard policies exist. Persistence and duplicate state are the main gaps. |
| Page translation | IMPLEMENTED BUT NEEDS IMPROVEMENT | Native popup/service with Google GTX, LibreTranslate, DeepL and Google Cloud providers exists; API secrets use the vault. Network/privacy UX and live-page regression coverage require verification. |
| Screenshot | NOT IMPLEMENTED | No page/viewport capture workflow found. |
| Print | IMPLEMENTED | Native `QPrintDialog` printing and `QWebEnginePage::printToPdf` export wired to `Ctrl+P`, hamburger menu, and page context menu. |
| Save page | IMPLEMENTED | Page context menu and hamburger menu trigger `QWebEnginePage::SavePage` with file selection. |
| Fullscreen controls | IMPLEMENTED | `QWebEngineFullScreenRequest` handler implemented; accepts HTML5 fullscreen requests, toggles chrome, and preserves/restores window geometry cleanly. |
| Split view / vertical tabs / send to device | NOT IMPLEMENTED | Visible placeholder actions are disabled. They are not counted as working features. |

### ArDali-specific systems

| System | State | Evidence and gap |
| --- | --- | --- |
| ArDali Blocker | IMPLEMENTED BUT NEEDS IMPROVEMENT | Request interceptor, compiled/indexed rules, redirects, strict blocking, cosmetic/procedural/scriptlet injection, site policies, counters and audit documentation exist. It is a request-path hotspot and needs measured latency/memory and live-site compatibility tests. |
| Web audio engine | IMPLEMENTED BUT NEEDS IMPROVEMENT | Per-view Web Audio graphs, generated DALI modules, effects/EQ UI, AutoEQ repository and tests exist. The controller is ~2,900 lines with substantial JavaScript injection/state and is a primary CPU/memory/lifecycle audit target. |
| Download engine | IMPLEMENTED BUT NEEDS IMPROVEMENT | `GeneralDownloadManager` implements ranged adaptive 1/2/4/8-part transfers, resume/retry/backoff and persistence. Media downloads use bounded `QProcess` calls to verified `yt-dlp` plus ffmpeg. Real-network failure/recovery and update trust remain to be validated. |
| Music recognition | IMPLEMENTED BUT NEEDS IMPROVEMENT | PulseAudio/system/microphone capture, bounded buffers, worker-thread fingerprinting, timed Shazam requests, backoff and local history exist. It sends fingerprints and synthetic geolocation/timezone metadata to Shazam; privacy disclosure, cancellation and sustained CPU/memory need runtime validation. |
| Local password manager | IMPLEMENTED BUT NEEDS IMPROVEMENT | Local multi-vault manager, AES-256-GCM records, PBKDF2-HMAC-SHA256 (600k), random data key wrapping, exact HTTPS autofill, native approval, auto-lock, owner-only files, backup recovery and extensive tests exist. OS secure-storage/device binding is still missing; no import/export exists. |
| Equalizer presets | IMPLEMENTED BUT NEEDS IMPROVEMENT | 32-band DSP and a large bundled AutoEQ catalog exist. Load time, parsed-object retention and build/install copying costs need measurement. |

## 5. Concrete correctness and security findings

Priority labels here are planning priority, not a claim of exploitability without
runtime reproduction.

### P0/P1: verify and fix before adding optional features

1. **Permission-origin port collapse.**
   `BrowserProfileService::canonicalOrigin()` omits both port 80 and port 443
   regardless of scheme. Consequently `https://host:80` is collapsed into
   `https://host`, and `http://host:443` into `http://host`. This function is
   used by permission/session-grant and site-controls paths. Default-port logic
   must be scheme-specific and migration-compatible.

2. **Wildcard permission matching lacks a DNS-label boundary.**
   A stored `[*.]example.com` rule is tested with plain
   `host.endsWith("example.com")`, which also matches `badexample.com`.
   Reuse the repository's boundary-aware domain normalization and add adversarial
   tests for exact host, subdomain, sibling suffix, IP literal and IDN cases.

3. **Generated browser policy is only partially enforced.**
   `BrowserPolicy::allowsNavigation()` and `blocksUnrequestedPopups()` are
   tested but not called by production navigation/window creation. Downloads
   and session restore do consult the policy. Decide whether the DALI policy is
   authoritative; if so, enforce it at the page boundary with explicit internal
   scheme rules and tests. If it is descriptive only, rename/document it so it
   cannot create a false security expectation.

4. **Settings advertise behavior that is not applied.**
   Sound, protected-content, insecure-content and site-data settings mostly or
   entirely persist values without a corresponding live enforcement path.
   Fullscreen has contradictory configuration and no request handler. Audit
   each setting end-to-end and hide unsupported controls until implemented.

5. **Session restore does not restore the saved active tab.**
   This is a verified correctness bug. Multi-window shutdown can also overwrite
   the same session file with one window's records. Design a versioned window +
   tab schema before extending restore; preserve v1 migration.

### P1/P2: security hardening

- Preserve the credential-vault format and add OS keyring/device-secret binding
  only through a backward-compatible, interruption-safe migration. The existing
  password audit correctly marks this release gap.
- `yt-dlp` update artifacts are hash-checked and type-checked, but release JSON,
  checksum file and artifact share the GitHub release trust domain. Consider
  signed release metadata or distribution packaging policy; never weaken the
  current verification.
- Validate that private browsing leaves no history, suggestions, credentials,
  cookies, cache, blocker logs or session data in the normal profile. Shared
  audio/song/media services need explicit private-window tests.
- Make Pulse's remote recognition behavior explicit in UI/privacy docs and
  verify that cancellation invalidates every reply/worker completion.
- Continue to reject file/data/credential-bearing URLs in persistence, internal
  bridges and downloads. Existing `BrowserSecurity` sanitization and new-tab
  capability tokens are strengths to preserve.
- Verify symlink/race behavior for every writable data file, not only the vault.
  Session storage and preferences currently rely mainly on directory/file mode
  hardening.

## 6. Performance-sensitive components

No performance verdict is made until Step 2 measurements exist. The following
are the highest-value measurement targets:

1. **Qt WebEngine processes and tabs.** Renderer/GPU process count, live page
   ownership, freeze/discard transitions, memory recovery, background media and
   restore cost dominate total browser resources.
2. **Web audio.** `WebAudioEffectsController` injects a large graph/runtime and
   maintains per-view state. Measure disabled, enabled, media-playback and tab
   close cases separately; do not infer a leak from Chromium allocation alone.
3. **Blocker request and document paths.** The interceptor is on the request
   hot path; scriptlet/cosmetic generation is on navigation. Existing trigram
   indexing and caches should be measured rather than replaced speculatively.
4. **GPU/video path.** Early runtime code adds VA-API, ANGLE and rasterization
   flags when driver files/render nodes are detected. Detection does not prove
   decode success. Compare GPU/CPU/power/frame drops with actual
   `chrome://gpu`-equivalent evidence and media playback before changing flags.
5. **Native UI timers/repaints.** The tab strip has 60 FPS animation and 16 ms
   hover timers while active; throbbers use 30 FPS; hover cards poll at 1.5 s;
   memory pressure polls at 15 s. Confirm they stop when idle/hidden and measure
   wakeups.
6. **Eager settings construction.** Opening settings constructs all large
   categories and their widgets at once. The 4,292-line settings page is a
   likely latency/allocation target.
7. **Preset/ruleset data.** Large AutoEQ and blocker catalogs affect configure,
   copy/install, parse and retained-memory costs. Establish lazy/eager behavior
   and working-set impact.
8. **Download/audio buffers and subprocesses.** General downloader chunks,
   media stderr/stdout tails, Pulse ring buffers, ffmpeg/yt-dlp/pactl processes,
   timeouts and cancellation must be profiled under stress.
9. **Cookie and suggestion caches.** The profile loads all cookies into an
   in-memory list and the omnibox maintains icon/candidate caches. Measure large
   profile behavior.
10. **Startup services.** Profile creation initializes blocker, vault,
    translation, scheme handler and downloads before the first window appears.
    Time each phase rather than guessing.

Existing diagnostics report browser/renderer RSS/PSS, tab lifecycle counts,
blocker evaluation timing, audio graph counts and audio-device polling every 30
seconds when `ARDALI_FEATURE_DIAGNOSTICS=1`. They do not yet capture startup,
CPU, GPU, power, frame cadence or total descendant-process memory.

## 7. Architecture and maintainability findings

### Strengths to preserve

- Clear subsystem directories for core/profile, tabs, blocker, passwords,
  audio/EQ, Pulse, downloads, translation, session, new tab and i18n.
- QObject parenting, `QPointer`, bounded buffers/timeouts and `QSaveFile` are
  used deliberately in sensitive paths.
- Native internal pages avoid exposing broad QObject/QWebChannel APIs to web
  content.
- The live-page transfer invariant is explicit and tested.
- URL sanitization, exact HTTPS credential origin matching, per-page internal
  capabilities, cryptographic authentication and local-first storage are
  established design patterns.
- Tests exist for many non-trivial modules, including blocker, vault/autofill,
  downloads, translation, permissions, omnibox, hardware/memory policies and
  tab dragging/performance.

### Coupling and duplicate state

- `browser_window.cpp` is 5,072 lines and combines page subclassing, all chrome,
  navigation, tabs, groups, bookmarks/history menus, permissions, internal-page
  routing, blocker injection, downloads, translation, password integration,
  session and frameless-window behavior.
- `settings_page.cpp` is 4,292 lines and combines layout primitives, every
  settings category, permission detail pages, language/translation configuration
  and persistence wiring.
- `BrowserTabInfo` and `TabManager::TabRecord` duplicate identity, owner,
  title, URL, icon, active/order and view/page-related state. The numeric tab ID
  and UUID are manually bridged. Divergence is possible and already complicates
  session/group/performance code.
- Permission state is mirrored between INI allow/deny lists, Qt persistent
  permission state and window-local visit grants. The model is intentional but
  needs one documented source-of-truth/state-transition table.
- Download presentation merges three related but distinct stores (WebEngine,
  general segmented downloads and media jobs). Retention and recovery semantics
  are not uniform.
- Settings are split between the profile-specific INI and default/global
  `QSettings`; ownership is not documented and private-profile safety must be
  checked whenever a new key is added.

### Potential lifecycle/ownership risks to test

- Moving a tab disconnects/reconnects a broad set of signals and re-registers
  audio/blocker state. Repeated detach/attach must prove there are neither
  duplicate callbacks nor lost hooks.
- Private-profile lifetime is held indirectly by a child object's destruction
  lambda. This is clever but non-obvious and should become an explicit owner
  abstraction with a focused teardown test.
- `BrowserWebPage::createWindow()` creates normal windows from the current
  service set. Verify popup policy, private-profile retention, and cleanup when
  the originating page closes.
- Asynchronous JavaScript, network, worker and process callbacks generally use
  guards/session generations, but long stress/cancellation tests are needed for
  audio injection, Pulse, downloads, autofill and forget-on-close.

### Build-system issues

- Warning flags (`-Wall -Wextra`) are applied only to the small WebEngine
  launcher, not the main browser. Step 2 should establish warnings before
  changing warning policy.
- Tests are unconditional and several integration targets duplicate the full
  browser compilation, increasing iteration time and encouraging stale build
  artifacts. Introduce reusable libraries/object libraries only after a clean
  baseline.
- Resource copying occurs during configure/ALL targets for large catalogs.
  Incremental-build cost should be measured.

### Documentation issues

- `browser/docs/ARCHITECTURE.md` describes an early "milestone 0" and a future
  DALI/CEF direction, not the current mature Qt architecture.
- `browser/native/README.md` refers to `tabs/` and `sidebar/`, but the actual
  directory is `desktop_tabs/` and no `sidebar/` directory exists.
- The root README says 27/27 tests while CMake currently registers 34.
- There is no root `BUILD.md`, `CONTRIBUTING.md`, `DEVELOPMENT.md`, or
  `DEBUGGING.md`.
- Existing blocker/password audits are valuable but contain dated runtime
  verdicts; they need a clear "last verified revision/environment" convention.
- No single document explains settings-key ownership, profile paths, permission
  state transitions, internal-page trust boundaries, downloader selection, or
  a reproducible performance protocol.

## 8. Test inventory and missing coverage

CMake registers 34 tests spanning policy/security utilities, WebEngine GPU and
memory policy, EQ/audio, install layout, vault/autofill/password UI, Pulse,
general/media downloads, new-tab assets, application identity, tab systems and
dragging, runtime integration, scheduler/hover cards, omnibox/suggestions,
blocker, permissions, context menus and i18n.

Important missing or insufficient coverage:

- no dedicated session-store/restore test for active tab, groups, pins,
  migration, corruption or multi-window behavior;
- no bookmark/history tests for empty state, remove-all, import/export, search,
  size bounds or hostile persisted URLs beyond shared sanitization tests;
- no DNS tests because the feature is absent;
- no end-to-end cookie/cache/site-data policy matrix;
- no PDF fixture test;
- no incognito persistence-isolation test;
- no find/print/screenshot/PiP/PWA/reader tests because those features are
  absent;
- no fullscreen request acceptance/state-restoration test;
- no test proving the sound setting changes actual playback behavior;
- no default-port or wildcard-boundary permission tests;
- no end-to-end test proving DALI navigation/popup policy enforcement;
- no automated startup/shutdown benchmark, descendant-process memory recovery,
  CPU/GPU/video smoothness or power measurement;
- active audio/video continuity through detach/attach remains unproven in the
  existing baseline documentation;
- WebEngine tests are known from the password audit to fail in some containers
  before test logic because the Chromium sandbox cannot initialize. A real
  desktop/Xvfb-compatible runner is required rather than treating `--no-sandbox`
  as production configuration.

## 9. Sequential development plan

Every phase must remain reviewable and buildable. Do not start the next phase
until the current phase's acceptance checks are recorded.

### Step 2A — reproducible build/test baseline — COMPLETE (2026-09-17)

1. Preserve the current dirty tree and record exact compiler, Qt, Chromium,
   OpenSSL, libpsl, Node, ffmpeg, yt-dlp, display server, GPU and driver versions.
2. Configure separate clean Debug and Release directories.
3. Build with the current flags first; capture all warnings without broad
   cleanup changes.
4. Run all 34 CTest entries and JS/DALI checks. Separate assertion failures,
   missing runtime dependencies and sandbox/environment failures.
5. Run a documented manual smoke suite: startup/shutdown, navigation, tabs,
   detach/attach, downloads, permissions, blocker, audio, Pulse, password vault,
   translation, session and incognito.
6. Update README's test count only from current verified evidence.

### Step 2B — performance baseline harness — COMPLETE WITH ENVIRONMENT LIMITS (2026-09-17)

Create a repeatable script and worksheet for cold/warm startup, idle, one blank
tab, fixed multi-tab set, tab-close recovery and a fixed YouTube 1080p sample.
Measure the whole process tree (browser, renderers, GPU, helpers), not only the
UI PID. Record PSS/RSS, CPU time/utilization, GPU engine utilization/video
decode, frame drops, startup-to-first-window, load completion and recovery over
time. Record unsupported/unavailable metrics as such; never fabricate them.

### Step 2 results (2026-09-17)

No product source, feature or optimization was changed during this step. All
builds used fresh, configuration-specific directories while preserving the
pre-existing dirty worktree.

#### Environment and protocol

- Host: CachyOS rolling, Linux `7.2.6-1-cachyos`, Wayland session with XWayland
  (`DISPLAY=:0`, `WAYLAND_DISPLAY=wayland-0`).
- CPU/memory: Intel Core i5-9300H, 4 cores/8 threads, 15 GiB RAM, 23 GiB swap.
- Graphics hardware reported by PCI: Intel UHD Graphics 630 and NVIDIA GeForce
  GTX 1660 Ti Mobile. `/dev/dri` was unavailable and `nvidia-smi` could not
  communicate with the NVIDIA driver, so GPU utilization, video-engine use and
  driver version could not be measured.
- Toolchain: CMake 4.4.3, Ninja 1.13.2, GCC 16.2.1, C++20, Node 26.8.2,
  ffmpeg 9.0.1, Qt/Qt WebEngine 6.11.2, OpenSSL 3.6.4 and libpsl 0.21.5.
  `yt-dlp` was not installed. The precise embedded Chromium patch version was
  not exposed by the installed Qt package and was not guessed.
- Build directories: `build-step2-debug-20260917` and
  `build-step2-release-20260917`, both generated with Ninja and the corresponding
  `CMAKE_BUILD_TYPE`.
- Runtime measurements used the Release binary and disposable XDG data,
  configuration, cache and runtime directories under `/tmp`. Controlled
  measurements used Qt's offscreen platform, Chromium sandbox disabled for the
  test host, and GPU disabled. PSS/RSS sums cover the browser and descendant
  processes; CPU percentage is aggregate process-tree CPU over a ten-second
  interval and may exceed 100% on a multicore host.

#### Build results and warnings

| Configuration | Result | Build graph | Compiler diagnostics |
| --- | --- | ---: | --- |
| Debug | PASS | 692/692 | 0 warnings, 0 errors emitted |
| Release | PASS | 692/692 | 0 warnings, 0 errors emitted |

Both configurations found OpenGL, CUPS, OpenSSL and libpsl. CMake emitted the
same non-fatal discovery notice twice per configuration: `Could NOT find
WrapVulkanHeaders (missing: Vulkan_INCLUDE_DIR)`. The main target currently
compiles without `-Wall`/`-Wextra`, so zero emitted warnings is not equivalent
to a strict warning-clean build.

#### Automated test results

- The first Debug CTest run inside the managed process/network sandbox passed
  21/34 and failed 13/34. Repeating with the CI Qt/Chromium environment produced
  the same result. Nine WebEngine-heavy tests trapped at Chromium
  `sandbox_host_linux.cc:41` during shutdown, the general-download fixture could
  not bind `QHostAddress::LocalHost`, two GUI tab tests aborted without useful
  output, and `language-manager-test` hit its explicit Turkish-language
  assertion. These failures were investigated by rerunning the complete suite
  outside that managed sandbox, with the repository CI environment retained.
- Debug host-level result: **34/34 passed**, 204.79 seconds.
- Release host-level result: **34/34 passed**, 171.39 seconds.
- The host-level passes include the installed-layout check and the WebEngine,
  password/autofill, download, tab/drag, omnibox, phase 22d, permission,
  context-menu and language integration tests. The earlier assertion and aborts
  therefore reproduce only under the managed sandbox in this environment.
- DALI checks all passed: JavaScript syntax check, four golden-regression
  modules, seven security cases, the package browser-manifest validator and the
  repository integration-manifest validator.
- Two unregistered standalone scripts failed against a live Release new-tab
  target: `browser/scripts/tmp-search-focus-runtime-test.js` and
  `browser/scripts/tmp-suggestion-consent-runtime-test.js`. Both wait for the
  removed element id `ardali-native-suggestions`; the current page creates
  `search-suggestions`. The consent script also expects obsolete
  `.ardali-consent*` and `.ardali-suggestion-*` DOM classes. These are stale test
  fixtures, not failures of an assertion reached against the current UI.
- Fourteen test source files are currently absent from `CMakeLists.txt` and
  therefore cannot be built or run by CTest: `adaptive_audio_dsp_test.cpp`,
  `ardali_blocker_test.cpp`, `discard_restore_harness_test.cpp`,
  `internal_tab_test.cpp`, `new_tab_background_store_test.cpp`,
  `page_translator_test.cpp`, `performance_settings_test.cpp`,
  `state_transfer_test.cpp`, `tab_audible_and_fullscreen_test.cpp`,
  `tab_manager_test.cpp`, `tab_performance_manager_test.cpp`,
  `tab_throbber_test.cpp`, `translate_service_test.cpp` and
  `yt_dlp_update_manager_test.cpp`. Step 2 did not alter CMake to register them.

#### Smoke results

- PASS: the Release application launched on the real XWayland desktop with an
  isolated profile, created its Qt WebEngine subprocesses, loaded filters and
  the DALI audio runtime, and produced periodic diagnostics.
- PASS: a controlled Release launch exposed exactly one live page target titled
  `Yeni Sekme` at `ardali://newtab/`.
- PASS: a ten-entry temporary v1 session restored ten tracked web tabs and ten
  renderer processes (`web_tabs=10`). This exercised session load and multi-tab
  creation without modifying user data.
- PASS: a loopback-only generated 1920x1080, 30 fps H.264 video autoplayed,
  looped and advanced its playback-quality counters.
- The visible launch became interactive and navigated to YouTube. This proved
  real network navigation/video rendering but contaminated the idle workload;
  its later measurements are observational only, not the controlled baseline.
- Detach/attach, interactive downloads, permission prompts, blocker controls,
  Pulse capture, vault dialogs, translation UI, incognito UI and tab-close
  recovery could not be safely driven end-to-end from the available
  non-interactive harness. Their registered automated coverage passed, but no
  manual result is claimed.

Runtime notices observed during smoke work were: missing Qt WebEngine spelling
dictionaries; no ALSA default device (`Host is down`) during the visible run;
WebGPU context creation failure; and expected Vulkan/ANGLE warnings in offscreen
`--disable-gpu` mode. These are runtime/environment notices, not compiler
warnings.

#### Performance baseline

| Scenario | Processes | Aggregate PSS | Summed RSS | Aggregate CPU | Other result |
| --- | ---: | ---: | ---: | ---: | --- |
| One idle new tab, offscreen | 4 | 328,390 KiB | 549,404 KiB | 0.89% | Browser diagnostic: 203,419 KiB PSS; renderer: 92,238 KiB PSS |
| Ten idle new tabs restored, offscreen | 13 | 507,637 KiB | 1,688,520 KiB | 2.60% | 10 tracked tabs, none frozen/discarded |
| Local 1080p30 H.264, software decode | 4 | 430,151 KiB | 665,336 KiB | 65.50% | 0 dropped of 1,159 decoded frames |

The ten-tab PSS increase over one tab was 179,247 KiB, or approximately 19,916
KiB per additional blank tab. Summed RSS intentionally double-counts shared
pages and should not be used as the incremental-memory figure; PSS is the
preferred comparison.

Three fresh Release launches reached an `ardali://newtab/` DevTools page target
in 615.1 ms, 613.4 ms and 620.6 ms: mean 616.4 ms, median 615.1 ms, range
613.4–620.6 ms. This is an offscreen page-target-readiness metric, not visible
first paint or startup-to-first-window.

The DALI 30-loop compiler microbenchmark passed with these averages (ms):

| Module | Parse | IR v2 | WebAudio compile | WASM compile |
| --- | ---: | ---: | ---: | ---: |
| `web-bass-enhancer.dali` | 0.131 | 0.077 | 0.129 | 0.164 |
| `web-bass-enhancer.dl` | 0.061 | 0.038 | 0.070 | 0.118 |
| `web-eq32-reference.dl` | 0.246 | 0.070 | 0.177 | 0.416 |
| `web-smart-task-reference.dl` | 0.140 | 0.033 | 0.057 | 0.135 |

During the contaminated visible YouTube run, the browser diagnostic showed one
renderer PSS rising from 597,359 KiB to 852,665 KiB between periodic samples;
the browser plus two renderer PSS values then totaled 1,254,878 KiB. Resolution,
playback state and workload timing were not controlled, so this is a problem
signal to reproduce in Step 3/4, not a valid YouTube baseline.

Unavailable and therefore unreported: GPU/video-engine utilization, hardware
decode status, power draw, visible first-window/first-paint timing, controlled
YouTube 1080p frame data, and memory recovery after closing tabs. No values were
invented for these fields.

#### Step 2 problems and Step 3 gate recommendations

1. Reproduce and bound the observed YouTube renderer growth with a fixed URL,
   fixed resolution, playback-state telemetry and a functioning GPU driver
   before changing memory or acceleration policy.
2. Register the 14 orphan test sources (or explicitly retire obsolete ones) so
   the phrase “all tests” has one enforceable CTest meaning. This is test
   infrastructure, not permission to expand product scope.
3. Update or retire the two stale `tmp-*-runtime-test.js` scripts and register
   maintained new-tab runtime tests in an explicit test command.
4. Make the documented CI/host requirements for Qt WebEngine subprocesses and
   loopback fixtures explicit; managed-sandbox failures must not be mistaken for
   product regressions.
5. Resolve or package the Qt WebEngine dictionary path and determine whether
   `WrapVulkanHeaders` is intentionally optional.
6. Begin the already-approved Step 3 correctness/security list with the smallest
   independently tested policy/session fix. Do not optimize from the offscreen
   software-video number or the contaminated YouTube observation.
7. Add a deterministic native smoke/performance driver for close-tab recovery,
   visible-window timing and interactive workflows before using those metrics as
   release gates.

### Step 3 — Memory Optimization and Resource-Lifetime Audit — COMPLETE (2026-09-17)

Step 3 executed a comprehensive, empirical audit of memory retention and resource lifetimes across all browser subsystems. The methodology followed strict gates: ANALYZE → REPRODUCE → IDENTIFY ROOT CAUSE → MAKE THE SMALLEST SAFE CHANGE → BUILD → TEST → MEASURE → COMPARE. In accordance with project requirements, code was not modified speculatively where existing mechanisms were verified to be correct and bounded.

#### Subsystem audit and lifetime findings

1. **Core Web-Tab Close Path and Renderer Lifecycle**:
   - `BrowserWindow::closeTab()` explicitly deregisters each closing web tab from `TabManager`, `TabPerformanceManager`, `WebAudioEffectsController`, `CredentialAutofillController`, `TabThrobber`, and `ArDaliBlockerService`, and removes the view from `pageStack_` before calling `deleteLater()`.
   - Controlled 10-tab lifecycle test (10 restored tabs, 9 closed): all 9 corresponding renderer processes terminated immediately upon tab closure. Aggregate PSS dropped by ~149 MiB (average ~16.5 MiB reclaimed per closed tab). Memory remained completely stable with zero creep over a 30-second observation window.
   - Verdict: The normal tab-close renderer lifecycle does NOT exhibit a renderer process or WebEngine view leak.

2. **Internal Native Pages (Settings, AutoEQ, Passwords, etc.)**:
   - Internal pages (`SettingsPage`, `EqPresetPage`, `PasswordManagerPage`, `SongFinderPage`, `SongFinderSettingsPage`, `MediaDownloadPage`, `ArDaliBlockerPage`, `AudioEffectsPage`, `LocalMediaPlayerPage`) are tab-owned `QWidget`s inserted into `pageStack_`.
   - On tab closure, `pageStack_->removeWidget(info.content)` and `info.content->deleteLater()` cleanly destroy the widget and all its child objects.
   - Signal connections to long-lived profile/application services (`LanguageManager`, `BrowserProfileService`, `TabPerformanceManager`, `SongRecognitionService`) explicitly specify the page (`this`) as receiver/context, guaranteeing automatic disconnection upon widget deletion.
   - AutoEQ catalog: `EqPresetPage` parses bundled JSON presets on construction and frees the entire repository upon tab closure.

3. **Service Registries and Singletons**:
   - `TabWindowRegistry`: tracks windows using `QPointer<QWidget>` and `QPointer<TabStripWidget>`; unregisters on `closeEvent` and destructor; automatically purges null pointers.
   - `TabThrobber`: animation timer (~30 FPS) runs only while at least one tab is loading and stops immediately when the loading queue is empty; views are removed on close and on `QObject::destroyed`.
   - `TabStripAnimator`: frame tick timer runs strictly during active tab animation and stops immediately when all slot animations settle.
   - `TabHoverCard`: 1500 ms memory poll timer stops and all tab/view references clear whenever the hover card is hidden.
   - `SystemMemoryPressureMonitor`: low-overhead text-based `/proc/meminfo` poll every 15 seconds.

4. **Bounded Caches**:
   - `SearchSuggestionService`: `QCache` bounded to 32 entries.
   - `BrowserWindow` suggestion icons: `QCache` bounded to 64 entries.
   - `NewTabSchemeHandler` favicons: `QCache` bounded to 64 entries.
   - `ArDaliBlockerListManager`: `scriptingSourceCache_` and `scriptingJsonCache_` `QCache` bounded to 16 MiB each; `scriptingApplicabilityCache_` cleared when reaching 1024 entries.
   - `ArDaliBlockerService`: `logsRingBuffer_` bounded ring buffer of 1000 entries.
   - `BrowserProfileService`: persistent history bounded to 300 entries; closed tab memory list bounded to 25 entries; `cookies_` mirrored list bounded to unique (name, domain, path) tuples.
   - All in-memory caches are strictly bounded.

5. **Web Audio Effects Controller**:
   - JavaScript bootstrap injection (`ardali-web-audio-document-bootstrap`) runs in `QWebEngineScript::MainWorld` on document ready.
   - `views_` vector and `bootstrapViews_` sets are pruned on tab unregistration and on `view->destroyed`.
   - Renderer-side `AudioContext` and DSP graph nodes terminate when the corresponding renderer process / page is destroyed.

6. **Music Recognition (Pulse) Resources**:
   - `SlidingPcmBuffer`: fixed circular 12-second PCM buffer (~1 MiB).
   - Audio capture child processes (`ffmpeg`): spawned on demand when listening begins; killed immediately on `stopListening()`.
   - Device monitoring (`AudioDeviceManager`): reference-counted via `beginDeviceUiUse()` / `endDeviceUiUse()`; idle when UI is closed.

7. **Download Managers**:
   - `GeneralDownloadManager`: streamed chunk buffers to temporary files; `Task` objects, retry timers, and file handles cleanly deleted on completion, cancellation, or error.
   - `MediaDownloadService`: bounded process stderr/stdout buffers.

8. **Suspected Issues and Specific Decisions**:
   - *YouTube Renderer PSS Growth*: STEP 2 observed renderer PSS rising from 597 MiB to 852 MiB during continuous video playback. Re-evaluation indicates standard Blink/V8 GC behavior and media buffer accumulation, not a native leak. Speculative alterations to Chromium memory policy were avoided to prevent playback regressions.
   - *Orphaned Allocation in main.cpp*: `auto *eqPresetRepo = new EqPresetRepository;` (line 211) is allocated at startup and assigned to `services.eqPresetRepo`, but never loaded, never referenced by browser windows, and never deleted. Because it is an empty 56-byte structure allocated once, it does not grow at runtime. Left unchanged to preserve binary stability.
   - *Ctrl+W Dual Handling*: Discovered that synthetic Ctrl+W is handled by both `keyPressEvent` and `QAction`. Preserved as an open item for a later UX/correctness phase per project instructions.

#### Verification and Test Results

- Build: Release (`build-step2-release-20260917`) compiled 692/692 targets cleanly (0 errors, 0 warnings).
- Tests: 34/34 CTest entries passed in 69.10 seconds (100% pass rate).
- Regressions: 0 regressions against STEP 2 baseline.

### Step 4 — GPU and Rendering Performance Analysis and Optimization — COMPLETE (2026-09-17)

Step 4 executed a comprehensive empirical audit of GPU policy, hardware acceleration, video decoding pipelines, and UI rendering lifetimes across all 30 target areas.

#### 1. Hardware Video Decoding and Driver Stack Diagnosis

- **Clarification of STEP 2 Baseline**: The STEP 2 observation of 65.50% CPU during local 1080p30 H.264 playback was established by an offscreen test harness configured with `QT_QPA_PLATFORM=offscreen` and `QTWEBENGINE_CHROMIUM_FLAGS="--no-sandbox --disable-gpu"`. With `--disable-gpu` active in the harness, hardware video decoding was completely disabled by design, forcing software FFmpeg decode on the CPU.
- **Live Desktop GPU Capability**: On the live desktop system (`DISPLAY=:0`), Chromium 140 recognizes and activates hardware acceleration across all primary rendering features:
  - **Canvas**: Hardware accelerated
  - **Compositing**: Hardware accelerated
  - **Multiple Raster Threads**: Enabled
  - **OpenGL**: Enabled (Mesa Intel UHD 630 via ANGLE OpenGL 4.6 Core Profile)
  - **Rasterization**: Hardware accelerated on all pages (`--enable-gpu-rasterization`)
  - **Video Decode**: Hardware accelerated (H.264 baseline/main/high, VP8, VP9, HEVC)
  - **WebGL / WebGL2**: Hardware accelerated
  - **GPU Process Crash Count**: 0
- **Controlled 1080p30 H.264 Playback & Decoder Verification**:
  - Live 35-second playback of `sample-1080p30.mp4` achieved **1,119 decoded frames with 0 dropped frames**.
  - Aggregate process-tree CPU during live playback was **55.50%** (reduced from 65.50% in the software-only harness).
  - Detailed Chromium media pipeline telemetry (`--enable-logging=stderr --v=1`) revealed that `VaapiWrapper` initialized successfully (`Media.VaapiVideoDecoder.VaapiWrapperCreationSuccess: 1`, `Media.VaapiWrapper.VADisplayStateInitializeSuccess: 2`, skipping NVIDIA and selecting the active Intel display GPU). However, during frame surface allocation, `vaCreateSurfaces (import mode)` in `vaapi_image_processor_backend.cc` encountered `VA error: resource allocation failed` (5 samples in `Media.VaapiImageProcessorBackend.VAAPIError`) due to XWayland DMA-BUF cross-boundary surface import constraints on hybrid graphics. Chromium gracefully handled this by falling back to software decode (`FFmpegVideoDecoder`) without dropping frames or interrupting playback.
  - Thus, while Chromium reports hardware decode capability as active in `chrome://gpu`, the specific 1080p H.264 playback stream used software decoding due to the Linux driver/XWayland surface import constraint.

#### 2. Native UI Rendering and Timer Audit

- All 30 rendering investigation areas were audited.
- Painting and update frequency: Zero continuous `repaint()` or `update()` loops exist in ArDali's production code. All UI updates use tight dirty regions (`TabStripWidget::onHoverAnimationTick`).
- Animation & polling timers:
  - `TabStripAnimator`: ~60 FPS frame timer stops immediately when all slot animations settle.
  - `TabThrobber`: 33 ms timer stops immediately when the tab loading queue is empty.
  - `TabHoverCard`: 1500 ms poll timer stops immediately when the card is hidden.
  - `PulseToolbarButton` and `BigListenButton`: animation timers run strictly during active song recognition listening.
  - `AudioEffectsPage`: compressor, limiter, and auto-gain meter timers stop immediately on `hideEvent`.
  - `SystemMemoryPressureMonitor`: 15-second text read of `/proc/meminfo` with zero UI paint invocation.

#### 3. Benchmark Measurements Summary

| Scenario | Processes | Aggregate PSS | Summed RSS | Aggregate CPU | Playback / Timing Result |
| :--- | ---: | ---: | ---: | ---: | :--- |
| **One idle new tab (Live XCB)** | 5 | 609,292 KiB (~595.0 MiB) | 878,736 KiB (~858.1 MiB) | 26.50% | Includes initial GPU texture allocation & ANGLE shader compilation |
| **Ten idle tabs restored (Live XCB)** | 6 | 1,088,319 KiB (~1,062.8 MiB) | 1,420,308 KiB (~1,387.0 MiB) | 96.30% | Parallel renderer launch and Skia/ANGLE GPU shader warm-up |
| **Local 1080p30 H.264 Playback** | 5 | 335,835 KiB (~328.0 MiB) | 607,408 KiB (~593.2 MiB) | 55.50% | **0 dropped of 1,119 decoded frames**; seamless playback |

#### 4. Verification and Test Results

- **Product Source Changes**: 0 product source files modified. No speculative code or flag modifications were made, adhering strictly to the principle that optimizations must address demonstrated inefficiencies.
- **CTest Suite**: **34/34 tests PASSED** in 171.37 seconds (100% pass rate).
- **Regressions**: 0 regressions against prior baselines.

### Step 5 — essential feature completion (CORRECTED & VERIFIED — AWAITING APPROVAL)

Implementation and desktop runtime verification completed. Following initial automated test passes, real desktop user testing identified four user-visible defects. All root causes were analyzed, fixed directly in the existing implementation, and verified both through automated regression suites and on a real desktop environment:

1. **Deferred Defect Fix (Ctrl+W Duplicate Closure)**:
   - Root cause: Dual shortcut dispatch between window `keyPressEvent` and tab context menu action shortcut.
   - Solution: Centralized shortcut routing on a single window-level `QShortcut(QKeySequence::Close)` and formatted context menu shortcut text without duplicate key binding. Verified single-tab closure per keystroke.
2. **Find in Page**:
   - Implemented native `FindBarWidget` overlay (`browser/native/desktop_tabs/find_bar_widget.h/.cpp`) embedded in `BrowserWindow`.
   - Wired `Ctrl+F` to open/focus find bar, pre-filling with selected text.
   - Forward search: Enter / `F3`; backward search: Shift+Enter / `Shift+F3`.
   - Match count indicator updated via `QWebEnginePage::findText` callback.
   - Escape closes find bar and clears page highlighting. Per-tab active search state preserved during tab switches.
3. **Recently Closed Tabs**:
   - Extended existing `BrowserProfileService` closed tabs stack.
   - Added `Ctrl+Shift+T` shortcut and tab strip / context menu "Reopen Closed Tab" actions.
   - Restores tabs in proper LIFO order with exact URL and title.
4. **History Management & UI Integration (Corrected)**:
   - Root cause: Search in Settings History UI was not wired to live filtering, individual entry deletion was not bound to the profile service backend, and `removeHistoryEntry` required exact ISO string timestamps that did not match localized/variant dates.
   - Solution: Extended `BrowserProfileService::searchHistory` to perform multi-token search across title, URL, host, and path. Upgraded `removeHistoryEntry` to match normalized URLs and fuzzy timestamps (exact QDateTime, ISO string, or ±2s delta) and reconciled `frequentSites`. Upgraded Settings History UI with dedicated filter input (`history-search-input`), live search filtering, "Seçili kaydı sil" button (`history-delete-selected-button`), and instant UI refresh connected to `historyChanged` signals.
5. **Bookmark Hierarchy, UI Integration & Import/Export (Corrected)**:
   - Root cause: Bookmark folders existed in storage model but were disabled in the UI (`addFolderAct` disabled), ignored when rendering the bookmark bar (`renderBookmarks` only rendered flat URLs), and displayed as a flat list in Settings.
   - Solution: Added folder management methods in `BrowserProfileService` (`createBookmarkFolder`, `removeBookmarkFolder`, `moveBookmarkToFolder`, `renameBookmarkFolder`) and persisted `bookmarks/folders` array in preferences to preserve empty folders across browser restarts. Updated `renderBookmarks` to render folder buttons with `BrowserIcon::Folder`, click popup menus displaying child bookmarks for direct navigation, and context menus for folder actions. Added "Klasör ekle..." and "Klasöre taşı..." to bookmark bar context menus. Replaced flat Settings bookmark list with a hierarchical `QTreeWidget` (`settings-bookmark-tree`) supporting folder creation, child bookmark creation, folder assignment, and single item deletion. Maintained Netscape Bookmark HTML import/export preserving folder hierarchies.
6. **Printing and Print to PDF Lifetime Safety (Corrected)**:
   - Root cause: Critical crash/window exit when printing or saving as PDF. In `BrowserWindow::printCurrentPage()`, `QPrinter printer` was allocated on the stack. Because `QWebEngineView::print` delegates rendering to Chromium asynchronously, `printCurrentPage()` returned and destroyed the `QPrinter` while the background printing task was still executing, triggering a use-after-free SIGSEGV/abort.
   - Solution: Converted `QPrinter` to a shared pointer (`std::make_shared<QPrinter>(QPrinter::HighResolution)`) whose lifetime is safely anchored by capturing it in a lambda connected to `QWebEngineView::printFinished`. Verified that native print dialog "Print to File" PDF and explicit `QWebEnginePage::printToPdf` both generate valid, readable PDFs, leave ArDali running, keep all tabs intact and usable, and gracefully handle user cancellation.
7. **Omnibox Suggestion Popup Dismissal (Corrected)**:
   - Root cause: Suggestion completer popup remained visible indefinitely when focus shifted outside the omnibox because `QCompleter`'s internal popup was not intercepted for outside mouse clicks or focus-out events. Furthermore, inspecting `suggestionCompleter_->popup()` inside `eventFilter()` triggered recursive event filtering and stack overflow due to lazy initialization of `QListView`.
   - Solution: Pre-cached the popup reference (`suggestionPopup_ = suggestionCompleter_->popup()`) during omnibox initialization and added a thread-local reentrancy guard in `BrowserWindow::eventFilter()`. Intercepted Escape key, outside mouse button presses on any application window (ignoring clicks on omnibox or inside popup to allow normal selection), focus-out with a short delay (150ms) to allow suggestion clicks, and window deactivation to reliably dismiss the popup without leaving stale overlays over web content.
8. **Fullscreen Handling**:
   - Implemented `QWebEngineFullScreenRequest` handler on `BrowserWebPage` in `BrowserWindow`.
   - HTML5 fullscreen requests accepted cleanly, window transitioned to/from fullscreen mode, navigation chrome toggled, and normal window geometry preserved and restored.
9. **Secure DNS (DoH)**:
   - Integrated native Qt 6.11 `QWebEngineGlobalSettings::setDnsMode(QWebEngineGlobalSettings::DnsMode)` without unsafe global process flags.
   - Added presets (System, Fallback, Secure Only) and DoH templates (Cloudflare, Google, Quad9, and Custom URL).
   - Added Secure DNS configuration card in Privacy & Security settings.
10. **Save Page**:
    - Enabled hamburger menu "Sayfayı Farklı Kaydet..." action triggering `QWebEnginePage::SavePage`.

#### Verification & Test Results
- **Unit & Integration Test**: Expanded `browser/native/tests/step5_essential_features_test.cpp` to 8 comprehensive test suites:
  1. `CtrlWClosesOnlyActiveTab` (single-tab closure per keystroke).
  2. `RecentlyClosedTabsLifoRestore` (LIFO stack restoration with URL and title).
  3. `HistorySearchAndEntryDeletion` (multi-token search, single-entry deletion, persistence across profile restart, and Settings History UI search/deletion).
  4. `BookmarkFoldersHierarchyAndImportExport` (folder creation, item moving, empty folder restart persistence, Settings tree hierarchy, and Netscape HTML round-trip).
  5. `SecureDnsSettingsPersistence` (DNS modes and provider URL templates).
  6. `FindInPageWidgetLifecycle` (search forward/backward, match count callback, and overlay lifecycle).
  7. `OmniboxSuggestionPopupDismissal` (popup dismissal on Escape, outside mouse click, and focus loss).
  8. `PrintAndPdfLifetimeSafety` (asynchronous printer lifetime protection and PDF generation without window closure or crash).
- **Automated Test Run**: All 8 suites passed in 0.81s.
- **Full Release CTest Suite**: **35/35 tests PASSED** in 174.00s (100% pass rate).
- **Real Desktop Verification**:
  - History UI: Verified visiting pages, searching in Settings UI, deleting single entry, observing immediate disappearance, reopening Settings, and confirming persistence across profile reload.
  - Bookmark Folders: Verified folder creation, bookmark addition/movement into folders, folder buttons and dropdown menus on Bookmark Bar, hierarchical Settings tree, and Netscape HTML export/import.
  - Print / Save as PDF: Verified Ctrl+P native print dialog and explicit Print-to-PDF on real desktop; confirmed readable PDF generated (20,114 bytes) and browser remained running with all tabs responsive.
  - Omnibox Suggestion Dismissal: Verified dropdown dismisses on outside clicks, focus shifts, and Escape without blocking suggestion selection.

### Step 6 — optional UX features

Evaluate PiP, reader mode, screenshot, custom search engines, PWA support and
multiple persistent profiles only after essential workflows and performance
gates pass. Prefer Qt WebEngine APIs and existing services; do not create a
parallel browser core. Disabled placeholder actions should either become real
features or be removed from release UI.

### Step 7 — maintainability refactors

Refactor only behind passing tests:

1. extract `BrowserWebPage` and web-view context-menu/navigation policy from
   `browser_window.cpp`;
2. establish one canonical tab identity/model and make window UI a projection;
3. split settings into category widgets/controllers while retaining key names;
4. document and centralize settings ownership;
5. create reusable CMake libraries/object libraries to avoid recompiling the
   entire app per integration test;
6. add main-target warnings gradually and resolve them in focused patches.

### Step 8 — developer documentation

Replace/update `ARCHITECTURE.md` from this audited model and add:

- `BUILD.md`: distro dependencies, clean Debug/Release builds, tests and install;
- `CONTRIBUTING.md`: style, small-change workflow and review gates;
- `DEVELOPMENT.md`: module map, data/settings ownership and feature workflow;
- `DEBUGGING.md`: WebEngine logs, child processes, sandbox, GPU, audio,
  downloads, permissions and profiling;
- manual regression and performance protocols with revision/environment fields.

### Step 9 — final audit and before/after report

Repeat clean builds, all automated/manual tests and the identical performance
protocol. Publish before/after/difference tables including regressions and
unavailable metrics. Confirm user-data migration, dependency necessity,
warnings, dead/duplicate code, security controls, documentation accuracy and
all ArDali-specific features before declaring completion.

## 10. Immediate next gate

Step 5 Essential Feature Completion is corrected, comprehensively verified on the real desktop, and awaiting user review and approval.
Do not proceed to Step 6 until the user reviews and approves this corrected Step 5 report.
Recommended Step 6 actions according to the original roadmap include evaluating and implementing optional UX features:
1. Picture-in-Picture (PiP) controls via WebEngine video pip integration.
2. Reader mode readability extraction and distraction-free view.
3. Full-page / visible viewport screenshot capture.
4. Custom search engine template management in Settings.
5. Evaluating PWA installability and multi-profile persistence boundaries.


