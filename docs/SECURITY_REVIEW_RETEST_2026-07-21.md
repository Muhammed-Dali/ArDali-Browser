# ArDali Security Review Re-test

Date: 2026-07-21
Baseline: `DEFENSIVE_SECURITY_REVIEW_2026-07-21.md`
Scope: re-test of SEC-01 through SEC-04, followed by a reasoned review of remaining Medium and Low findings. No exploit code was produced or executed.

## Result

**Critical: 0 — High: 0 — Medium: 4 — Low/residual: 3**

All four previously reported High findings are closed in the reviewed source. The application completed its Electron 43 Wayland startup smoke test with sandboxing enabled after the changes. Existing vault and Electron security test suites pass, and the security invariant suite now explicitly covers the four remediations.

## High finding re-test

### SEC-01 — Autofill trusted gesture: Closed

The isolated guest preload now rejects any fill event unless `event.isTrusted === true` and transient `navigator.userActivation.isActive === true`. It first requests a random 192-bit fill authorization from `vault:guest:beginFill`. The main process binds that authorization to the guest webContents ID, top-frame routing ID and exact HTTPS origin, expires it after three seconds, and consumes it before decrypting. Navigation/origin revalidation remains in place.

**Evidence:** `webviewAdblockPreload.js` trusted-event/user-activation checks; `main.js` `pendingCredentialFillAuthorizations`, `vault:guest:beginFill`, and token consumption in `vault:guest:chooseAndFill`.

**Why no longer High:** page-created synthetic events are untrusted and cannot reach decryption. A stolen/replayed token fails after one use, expiry, frame change, webContents change or origin change.

### SEC-02 — Permission origin confusion: Closed

Both permission request and permission check handlers now independently require the current top-level webview URL and the actual requesting origin to pass the URL policy. A trusted embedder can no longer lend permission to an untrusted iframe. Permission overrides are evaluated against the requesting origin.

**Evidence:** `main.js` requires `isAllowedWebUrlMain(currentUrl) && isAllowedWebUrlMain(requestingUrl)` in both handlers.

**Why no longer High:** a non-allowlisted requesting origin is denied even when embedded by an allowlisted top-level site.

### SEC-03 — Broad preload/filesystem authority: Closed

IPC authorization is now top-frame and page-role aware. Password manager, downloader, adblock, sound-effects, presets and pulse pages receive explicit channel-prefix allowlists. Their preload surface is separately reduced through `STANDALONE_API_KEYS`; the visualizer bridge is exposed only to the main window. The main renderer's raw filesystem operations additionally require canonical, symlink-aware path capabilities seeded from existing user library locations or issued by a user file/folder/save dialog. Arbitrary absolute paths are no longer sufficient.

**Evidence:** `main.js` `LOCAL_PAGE_IPC_PREFIXES`, `isLocalPageChannelAllowed`, `rendererPathGrants`, `grantRendererPath`, `isRendererPathGranted`; `preload.js` `STANDALONE_API_KEYS`.

**Why no longer High:** compromise of a secondary local renderer does not inherit host-wide APIs, and a main-renderer injection cannot turn an arbitrary absolute string into raw file read/write. Access is bounded to the media roots previously configured/selected by the user.

### SEC-04 — Unverified runtime executables: Closed

yt-dlp is pinned to immutable release `2026.07.04`; platform artifacts have embedded SHA-256 values and size limits. FFmpeg artifacts use fixed v8 URLs with embedded archive and extracted-binary hashes. Downloads permit HTTPS only and restrict all redirect hops to the expected GitHub release hosts. Data is written mode 0600 to a random temporary file, streamed under a maximum size, hashed, and only atomically installed after a match. Previously managed yt-dlp/FFmpeg binaries are selected only when their binary hash matches the embedded value; unverified legacy yt-dlp is replaced.

**Evidence:** `modules/downloaderService.js` `YTDLP_ARTIFACTS`, `FFMPEG_ARTIFACTS`, `VERIFIED_DOWNLOAD_HOSTS`, `downloadVerifiedFile`, `isVerifiedManagedBinary`.

**Why no longer High:** mutable latest URLs, unbounded downloads, unchecked redirects and execute-after-download behavior were removed. A modified upstream response fails closed before executable permission or selection.

## Remaining Medium findings and rationale

### MED-01 — Broad local CSP egress and incomplete safe-DOM enforcement

**Status: Open — Medium.** The main CSP still permits general HTTPS/WSS connections and HTTPS images/frames. A number of legacy, mostly static/template `innerHTML` sites remain outside the shared sanitizer. The confirmed remote search-suggestion sink was removed and now uses `textContent`, and script execution is constrained by `script-src 'self'` without unsafe-inline/eval.

**Why Medium:** exploitation still requires a separate local script-execution or trusted-resource compromise; raw remote suggestion data no longer reaches HTML parsing. Broad egress increases the consequence of a future XSS but is not independently executable.

**Recommended action:** introduce Trusted Types, lint raw HTML sinks, sanitize rich translations, and replace scheme-wide CSP sources with explicit hosts per feature.

### MED-02 — Advanced downloader arguments remain powerful

**Status: Open — Medium.** Free-form yt-dlp options and config paths remain an intentional advanced capability. `shell:false` prevents shell parsing, and role-based IPC/preload controls now limit these APIs to the downloader and settings contexts, but yt-dlp itself supports powerful post-processing/config options.

**Why Medium:** no remote webview can directly invoke this path, and exploitation requires compromise of a privileged local page or malicious user-approved configuration. It remains an avoidable process-control amplifier.

**Recommended action:** replace free-form arguments with an allowlist and explicitly reject execution/plugin/config and TLS-disabling options. Remove automatic `--no-check-certificate` behavior for proxies.

### MED-03 — Electron fuses and `file://` remain unhardened

**Status: Open — Medium.** Local UI still uses `loadFile`; no explicit `@electron/fuses` post-package policy was found.

**Why Medium:** renderer sandbox, isolation, CSP, top-frame IPC checks and path capabilities materially reduce immediate exploitability, but default RunAsNode/CLI inspection/file-protocol behavior leaves unnecessary attack surface in packaged binaries.

**Recommended action:** migrate UI to a restricted standard custom protocol and, after platform testing, disable RunAsNode/Node CLI inspect, enable cookie encryption, ASAR integrity validation and OnlyLoadAppFromAsar, and disable extra file-protocol privileges.

### MED-04 — Allowed remote origins retain fullscreen/pointer/keyboard-lock capability

**Status: Open — Medium.** These permissions remain allowed for approved top-level/requesting origins. SEC-02 ensures an unapproved iframe cannot inherit them, but an approved origin compromised upstream may use them for UI deception.

**Why Medium:** the origin must already be on the application allowlist; there is no direct host privilege. The primary impact is phishing/UI spoofing.

**Recommended action:** require a trusted user activation, exact per-origin opt-in and visible escape affordance for fullscreen, pointer lock and keyboard lock.

## Remaining Low/residual findings and rationale

### LOW-01 — Unlock throttling is process-memory only

Restarting the app clears the exponential delay. Offline guessing is still protected by scrypt plus the OS-protected device secret, and each attempt remains computationally expensive. Persist a coarse, tamper-evident cool-down in secure storage if stronger online throttling is required.

### LOW-02 — JavaScript plaintext lifetime

Credentials necessarily become JavaScript strings and destination DOM values during reveal/fill. Buffers are zeroed where possible and manager fields are cleared, but garbage collection and page submission prevent deterministic erasure. This is inherent residual risk; continue minimizing scope and lifetime and document the device-compromise boundary.

### LOW-03 — Trusted local/system executable search paths

Explicit environment overrides, OS `PATH` tools and packaged binaries are still trusted without the runtime-download manifest. This is consistent with the OS/application trust boundary: an attacker able to replace system or packaged executables already has same-user installation compromise. Prefer absolute packaged paths and signed package provenance for additional defense in depth.

## Re-test evidence

```text
node --check main.js                           -> pass
node --check preload.js                        -> pass
node --check webviewAdblockPreload.js          -> pass
node --check modules/downloaderService.js      -> pass
node --check modules/web-browser.js            -> pass
npm run -s test:electron-security              -> electron security invariants: ok
npm run -s test:credential-vault               -> credential vault tests: ok
git diff --check                               -> pass
timeout 25s npm run -s dev:linux               -> main/preload/audio/webviews started; test ended by timeout
```

The artifact hashes were independently checked against the fixed upstream release artifacts during remediation. The re-test does not claim that Medium/Low residual risks are eliminated; it confirms that none of the four original High conditions remain at High severity in the current reviewed source.
