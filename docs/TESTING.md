# Testing DaliNira Browser

DaliNira uses standalone C++ regression executables, CTest, and deterministic
local fixtures. Assertions remain enabled in Release test targets. The core
suite must not depend on public internet services or a real user profile.

## Build and run

```bash
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build build -j$(nproc)
ctest --test-dir build --output-on-failure
```

Run a subsystem by test-name regex or label:

```bash
ctest --test-dir build -R 'password|credential-vault' --output-on-failure
ctest --test-dir build -R 'tab|step5' --output-on-failure
ctest --test-dir build -L security --output-on-failure
ctest --test-dir build -L webengine --output-on-failure
```

A test executable can also be run directly for its per-case diagnostics:

```bash
./build/dalinira-browser-password-autofill-test
./build/dalinira-browser-step5-test
```

Do not encode the current suite count in scripts; use `ctest --test-dir build
-N` when an inventory is needed.

## Test categories

- Core/unit: policies, URL security, address resolution, application identity,
  new-tab assets/backgrounds, download models, media routing and platform
  registries.
- Component: vaults, password UI, translation providers, blocker rules,
  Web Audio, song recognition, media downloads, performance settings and tab
  lifecycle managers.
- Integration/WebEngine: BrowserWindow commands, site permissions, menus,
  session restoration, page translation, live view transfer, fullscreen,
  omnibox behavior and the phase 22d browser bridge.
- Security: credential vault/autofill, origin canonicalization, private-mode
  boundaries, URL sanitization and encrypted translation secrets.
- Golden/script checks: DALI generation and manifest scripts are invoked by
  their build targets and repository tooling rather than being separate native
  CTest executables.

CTest labels currently provide `security`, `passwords`, `audio`, `integration`
and `webengine` entry points. A test may have more than one label.

## Registered standalone regressions

The following older standalone programs are first-class CTest suites in
addition to the original browser suites:

- `adaptive_audio_dsp_test.cpp` — adaptive audio state and persistence.
- `dalinira_blocker_test.cpp` — blocker policy, UI, rules and migrations.
- `internal_tab_test.cpp` — native-tab/session and private-session isolation.
- `new_tab_background_store_test.cpp` — image validation and size limits.
- `page_translator_test.cpp` and `translate_service_test.cpp` — translator
  lifecycle, provider behavior, vault-backed secrets and local fake replies.
- `performance_settings_test.cpp` — Settings performance controls and keys.
- `state_transfer_test.cpp` — live WebEngine view transfer/rollback stress.
- `tab_audible_and_fullscreen_test.cpp` — audible metadata, hover data and
  fullscreen restoration.
- `tab_manager_test.cpp`, `tab_performance_manager_test.cpp` and
  `tab_throbber_test.cpp` — ownership, cleanup and loading lifecycle.
- `yt_dlp_update_manager_test.cpp` — managed-tool updates using two local
  synthetic executables; no GitHub access is performed.

`discard_restore_harness_test.cpp` remains a specialized developer benchmark,
not a CTest. It mixes deterministic policy checks with renderer memory and
restore-latency measurements, so it is unsuitable for pass/fail CI. The
`yt_dlp_version_fixture.cpp` program and `suggestion_test_transport.h` are test
helpers, not independent suites.

The scripts in `browser/scripts/tmp-*-runtime-test.js` are manual
DevTools-protocol smoke helpers for a developer-launched new-tab page. They are
kept aligned with the current `search-suggestions` DOM contract, but are not
registered because they require an externally supplied debugging endpoint.

## Isolation and network policy

- Put profile storage, vaults, histories, downloads, sessions and QSettings in
  `QTemporaryDir` paths. Set the QSettings format/path before constructing the
  first settings-backed object.
- Use off-the-record or explicitly temporary `QWebEngineProfile` storage.
- Never read or write the normal DaliNira profile, credential vault or desktop
  settings from a test.
- Use loopback servers, fake `QNetworkAccessManager` replies and checked-in
  fixtures. URLs such as `example.com` used only as values do not perform
  network access.
- Never print credential plaintext, master passwords, device secrets, fill
  tokens, encryption keys or raw private audio in failure diagnostics.

## Headless Qt WebEngine

CTest supplies the required offscreen/X11 and Chromium flags per suite. For a
direct WebEngine test invocation, the usual local equivalent is:

```bash
QT_QPA_PLATFORM=offscreen \
QTWEBENGINE_DISABLE_SANDBOX=1 \
QTWEBENGINE_CHROMIUM_FLAGS='--no-sandbox --disable-gpu' \
./build/dalinira-browser-step5-test
```

Disabling Chromium's sandbox is for isolated test processes in containerized
CI only; it is not a browser runtime recommendation. Some managed containers
deny namespace/process operations even with these flags. In that case run the
same CTest command on the host/CI executor rather than weakening assertions.

Offscreen widgets are not compositor-mapped. Prefer command results, model
state, signals and explicit hidden state over assuming `isVisible()` is true.
Use signals or bounded event loops for asynchronous behavior; do not add long
arbitrary sleeps.

## Optional sanitizers

GCC and Clang developer builds may opt in without changing normal Release
builds:

```bash
cmake -S . -B build-asan -G Ninja -DCMAKE_BUILD_TYPE=RelWithDebInfo \
  -DDALINIRA_ENABLE_ASAN=ON
cmake -S . -B build-ubsan -G Ninja -DCMAKE_BUILD_TYPE=RelWithDebInfo \
  -DDALINIRA_ENABLE_UBSAN=ON
```

ASan and UBSan flags apply to DaliNira targets. Qt/Chromium libraries and
WebEngine helper processes are not rebuilt with those flags, so begin with
native unit/component suites. Treat WebEngine sanitizer execution as a
developer diagnostic, not a mandatory CI gate.

## Manual desktop-only checks

Automation does not reliably prove compositor dialogs, a physical microphone
or system-audio capture, GPU/video decode, Secret Service integration, or live
third-party services. Before a release, limit manual testing to affected gaps:

- invoke Print and Save as PDF from a real desktop dialog and confirm the
  browser remains alive until asynchronous printing completes;
- enter/exit HTML5 fullscreen and capture a visible-page screenshot under the
  desktop compositor;
- perform one real microphone/system-audio recognition attempt when audio code
  changed;
- verify Secret Service unlock/persistence when keyring integration changed.

## Adding a regression

Place a case in the closest existing suite and name the broken contract. Drive
the real command boundary when practical, then assert the expected observable
state and the important negative state (for example, one Ctrl+W activation
reduces the tab count by exactly one). Add a new executable only when the test
has genuinely distinct dependencies or lifecycle requirements.
