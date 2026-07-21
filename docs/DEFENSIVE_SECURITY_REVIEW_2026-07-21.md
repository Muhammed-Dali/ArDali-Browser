# ArDali Defensive Security Review

> Historical baseline: the four High findings in this document were remediated and re-tested later on 2026-07-21. See `SECURITY_REVIEW_RETEST_2026-07-21.md` for the authoritative current result.

Date: 2026-07-21
Scope: Electron main process, BrowserWindow/webview configuration, preload bridges, IPC, CSP/DOM injection, password vault, credential capture and autofill.
Method: source review and existing defensive test execution. No exploit or attack code was produced or executed.

## Executive summary

No directly exploitable Critical issue was confirmed from source alone. Four High-risk design findings and several Medium/Low findings remain. The strongest controls are renderer sandboxing, context isolation, disabled Node integration, restrictive local CSP, centralized IPC sender checks, authenticated vault encryption, exact HTTPS-origin matching, and deny-by-default permission settings.

The principal weakness is compositional: local renderers receive a very broad preload API. Therefore, a DOM injection in any local window can become arbitrary file access or process-launch influence even though Chromium's sandbox is enabled. A separate autofill user-gesture gap can disclose a credential to a compromised page on the credential's exact origin while the vault is unlocked.

## Findings

### SEC-01 — Autofill does not prove a real user gesture

**Risk: High**
**OWASP:** A01:2025 Broken Access Control, A06:2025 Insecure Design; ASVS v5 access-control/business-logic principles.

**Evidence:** `webviewAdblockPreload.js:1119-1134` invokes `vault:guest:chooseAndFill` from the injected button's `pointerdown` handler, but neither the handler nor `main.js:9061-9084` verifies `event.isTrusted`, Chromium user activation, or a main-process-issued gesture nonce. The button is inserted into the page DOM at `webviewAdblockPreload.js:1139-1155`. The main process returns the decrypted record whenever the origin is exact and the vault is unlocked.

**Impact:** Script executing on the exact saved origin can programmatically activate the bridge and cause the credential to be placed into DOM inputs without the user intentionally selecting autofill. Page script can then observe the populated value. The prerequisite is control/XSS of the exact origin and an unlocked vault, so this is High rather than Critical.

**Fix:** Require `event.isTrusted === true`, `navigator.userActivation.isActive`, and a short-lived one-use nonce minted only after a trusted host-side interaction. Bind the nonce to webContents ID, frame routing ID, exact origin, target field identity, and a very short expiry. Consume it before decrypting. Do not rely solely on a DOM button inside an untrusted document.

### SEC-02 — Permission decision confuses top-level and requesting origins

**Risk: High**
**OWASP:** A01:2025 Broken Access Control; ASVS v5 access-control and browser-origin isolation principles.

**Evidence:** In `main.js:8437-8453`, a webview request is considered trusted when either `currentUrl` **or** `details.requestingOrigin` is allowlisted. `main.js:8475-8480` repeats this OR condition for permission checks. Global camera/microphone/location settings can then approve a non-allowlisted embedded origin because the top-level page is allowlisted. Pointer lock, keyboard lock, and fullscreen are unconditionally accepted by `main.js:2718-2725` once that outer trust check passes.

**Impact:** A third-party iframe embedded by an approved site may inherit sensitive permission approval intended for the top-level site. Depending on user settings, this can expose microphone/camera/location or enable stronger UI spoofing.

**Fix:** Require the requesting origin itself to be HTTPS and explicitly allowlisted/approved. For sensitive permissions require both the top-level origin and requesting origin to match the same site policy, preferably exact origin rather than suffix. Store site overrides against the requesting origin and deny opaque origins. Treat fullscreen/pointer/keyboard lock as gesture-bound permissions, not unconditional allowances.

### SEC-03 — Local renderers receive arbitrary filesystem capabilities

**Risk: High**
**OWASP:** A01:2025 Broken Access Control, A06:2025 Insecure Design; ASVS v5 least privilege, file/resource controls.

**Evidence:** The shared bridge exposes unrestricted absolute-path operations at `preload.js:673-679`. Main handlers at `main.js:10545-10667` normalize paths but do not confine them to user-selected roots or capability grants. `sanitizeIpcPath` at `main.js:276-281` only checks absolute form and NUL bytes. The same full preload is attached to the main, settings, adblock, downloader, sound-effects and preset windows.

**Impact:** Any script execution in a local renderer can read or overwrite files available to the user's OS account, move files to trash, and inspect arbitrary paths. This turns a renderer XSS into a host-data compromise despite process sandboxing.

**Fix:** Split preload bridges per window. Replace raw paths with opaque capability handles created by a file/folder picker. Enforce canonical realpath-based allowlists, operation type, expiry, file type and size in the main process. Remove write/read methods from windows that do not require them. Never treat “local renderer” as sufficient authorization.

### SEC-04 — Executable dependencies are downloaded and run without integrity verification

**Risk: High**
**OWASP:** A03:2025 Software Supply Chain Failures, A08:2025 Software or Data Integrity Failures.

**Evidence:** `modules/downloaderService.js:155-194` downloads HTTPS responses directly to disk. `ensureYtDlpBinary` and `ensureFfmpegBinary` at lines 257-320 make the result executable or extract/copy it, without a pinned SHA-256 digest, signature, trusted manifest, maximum size, or atomic verification step. The source uses mutable “latest” URLs for yt-dlp.

**Impact:** Compromise of a release account, CDN/origin, redirect target, or upstream artifact can produce code execution as the logged-in user at the next downloader operation.

**Fix:** Pin an approved version and platform-specific digest in a signed application manifest. Download to a new mode-0600 temporary file with a strict size cap, restrict every redirect to HTTPS and expected hosts, verify SHA-256 plus upstream signature where available, then atomically rename and make executable. Prefer packaging trusted tools or OS package management. Record provenance/SBOM data.

### SEC-05 — IPC authorization is origin-wide, not channel/window-specific

**Risk: Medium**
**OWASP:** A01:2025 Broken Access Control; Electron checklist item 17.

**Evidence:** The central wrapper at `main.js:24-113` is a valuable control, but `isTrustedLocalAppSender` at `main.js:8914-8924` authorizes every local file under the application root for every normal IPC channel. It does not map channels to the expected BrowserWindow or preload role. The downloader window, for example, receives the same bridge as the main media window.

**Impact:** A compromise of the least-trusted local window inherits all filesystem, recording, cookie import/export, updater, and downloader operations exposed by the shared preload.

**Fix:** Maintain a channel-to-role policy in the main process. Bind each BrowserWindow webContents ID to a fixed role at creation, verify sender frame is the top frame, and allow only the minimal channel set for that role. Use distinct preload files/APIs for each window.

### SEC-06 — Remote search suggestions enter privileged local DOM as raw HTML

**Risk: Medium**
**OWASP:** A05:2025 Injection; ASVS v5 encoding and sanitization.

**Evidence:** DuckDuckGo response field `item.phrase` is interpolated into `innerHTML` at `modules/web-browser.js:2132` and `modules/web-browser.js:2210`. These sinks bypass the available `ardaliSetHTML` sanitizer. The affected document is the privileged local main renderer.

**Impact:** A compromised or malformed suggestion response can inject markup, spoof application UI, load permitted remote resources, or create dangerous composition with future CSP/preload changes. Current `script-src 'self'` blocks straightforward inline script execution, reducing but not eliminating the impact.

**Fix:** Construct the icon and text with DOM methods and assign the phrase only through `textContent`. Validate that response entries are plain strings with a short length. Apply the shared sanitizer to every remaining intentional rich-HTML sink and add Trusted Types where supported.

### SEC-07 — CSP permits broad exfiltration and sanitization coverage is incomplete

**Risk: Medium**
**OWASP:** A02:2025 Security Misconfiguration, A05:2025 Injection.

**Evidence:** `index.html:6` permits `connect-src https: wss:`, `img-src https:` and `frame-src https:` without host restriction. Multiple renderer files still assign template strings to `innerHTML`; DOMPurify is used only at selected sinks. `modules/i18n.js:4788` and `downloaderRenderer.js:603` deliberately render translation HTML without the shared sanitizer.

**Impact:** If a local DOM injection becomes script execution through a future regression or trusted local script compromise, arbitrary HTTPS endpoints are available for data exfiltration. Unsanitized rich translations/assets make package or update tampering more powerful.

**Fix:** Reduce connect/image/frame origins to explicit required hosts; use per-feature custom protocols or mediated main-process requests. Sanitize every rich translation and template sink. Adopt Trusted Types enforcement and CI lint rules banning raw `innerHTML`, `outerHTML`, `insertAdjacentHTML`, and string-to-DOM APIs outside a reviewed wrapper.

### SEC-08 — Advanced downloader arguments can become process-execution influence

**Risk: Medium**
**OWASP:** A05:2025 Injection, A06:2025 Insecure Design.

**Evidence:** `main.js:11061-11090` persists arbitrary `customArgs`, proxy and config paths. `modules/downloaderService.js:739-742` and related builders append those options to yt-dlp. `shell:false` prevents shell metacharacter injection, but yt-dlp itself supports powerful options and config directives, including post-processing execution features. All local windows can reach the downloader bridge through the shared preload.

**Impact:** A compromised local renderer or malicious imported configuration can influence a native child process and potentially request command execution under the user account.

**Fix:** Remove free-form arguments from production or parse against a strict option allowlist. Explicitly deny execution/postprocessor/plugin/config/network-security options. Restrict config files to picker-issued capability handles and the downloader window role. Do not automatically add `--no-check-certificate` when a proxy is configured.

### SEC-09 — Electron fuses are not hardened and local content uses `file://`

**Risk: Medium**
**OWASP:** A02:2025 Security Misconfiguration; Electron checklist items 18 and 19.

**Evidence:** No `@electron/fuses` configuration or post-package fuse step is present. All local windows use `loadFile`, and IPC trust is based on `file:` URLs. The package includes ASAR but no explicit embedded ASAR integrity or `OnlyLoadAppFromAsar` policy.

**Impact:** Default runtime modes such as RunAsNode/Node CLI inspection and extra file-protocol privileges remain available depending on Electron defaults/platform. `file://` has broader filesystem semantics and makes origin authorization less precise.

**Fix:** After compatibility testing, disable RunAsNode and Node CLI inspect, enable cookie encryption, embedded ASAR integrity validation and OnlyLoadAppFromAsar, and disable unnecessary file-protocol extra privileges. Serve packaged UI through a privileged, standard-scheme custom protocol restricted to the application bundle.

### SEC-10 — Unlock throttling is memory-only

**Risk: Low**
**OWASP:** A07:2025 Authentication Failures; ASVS v5 authentication throttling principles.

**Evidence:** `failedUnlocks` and `nextUnlockAt` are initialized in memory at `modules/credential-vault.js:76-77` and reset after successful verification. No authenticated persistent throttle state exists.

**Impact:** Restarting the application resets the online delay. Offline guessing remains significantly constrained by scrypt and the OS-protected device secret, so severity is Low.

**Fix:** Persist a tamper-evident coarse failure counter/next-attempt timestamp using OS secure storage, add bounded jitter, and consider an increasing cool-down after repeated application restarts. Avoid permanent account lockout.

### SEC-11 — Vault plaintext lifetime cannot be fully controlled in JavaScript

**Risk: Low / residual**
**OWASP:** A04:2025 Cryptographic Failures, A08:2025 Integrity/Data Protection considerations.

**Evidence:** Buffers are zeroed where practical, but decrypted credentials become immutable JavaScript strings in `decryptRecord`, IPC serialization, and DOM input values. The editor clears the password field after 15 seconds, while autofill leaves the value for site submission.

**Impact:** A same-user memory dumper, debugger, accessibility tool, malicious extension/native module, or already-compromised origin may recover plaintext while it is in use. This cannot be eliminated in a JavaScript/Electron password manager.

**Fix:** Minimize decrypt-to-string conversions and lifetime, lock on blur/session changes where usable, clear editor/fill state on navigation, and document the device-compromise threat model. Consider a small audited native secret container for high-assurance use, while recognizing DOM fill necessarily reveals the secret to the destination page.

## Controls that passed review

- All reviewed BrowserWindows explicitly use `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true`, and `allowRunningInsecureContent: false`.
- Production DevTools are disabled by window preferences.
- Webview attachment overwrites insecure preferences, controls preload selection, and rejects non-allowed initial URLs.
- New-window and navigation handlers reject non-HTTP(S) destinations; external native protocols require a confirmation dialog.
- Permission request and permission check handlers exist and default unknown permission types to deny.
- Local CSP contains no `unsafe-inline` or `unsafe-eval`, with `object-src 'none'` and `base-uri 'none'`.
- IPC arguments have channel, depth, collection, type, cycle, prototype-key and size checks; guest IPC has a five-channel allowlist and partition/HTTPS checks.
- Password-manager window uses a dedicated narrow preload, strict CSP, denied navigation and denied new windows.
- Vault records use AES-256-GCM with random 96-bit IVs and authenticated data; the data key is wrapped with scrypt/HKDF plus an OS-protected device secret.
- Linux `safeStorage` `basic_text` fallback is rejected. Vault and activation files are created with restrictive modes.
- Credential origins are canonical exact HTTPS origins; suffix/subdomain and Unicode/punycode confusion is not used for matching.
- Vault metadata, usernames and passwords are encrypted at rest; schema/size/base64/ID constraints and authenticated decryption reject tampering.
- Automatic lock, manual lock, suspend/screen lock handling, one-use manager authorization tokens and password-field clearing are implemented.
- `npm audit --audit-level=low` returned zero known package vulnerabilities on the review date.

## Electron Security Checklist matrix

| # | Control | Result | Notes |
|---:|---|---|---|
| 1 | Secure content only | Partial | Web browser intentionally permits HTTP as well as HTTPS. Autofill is HTTPS-only. |
| 2 | No Node integration for remote content | Pass | Forced false for webviews/popups. |
| 3 | Context isolation | Pass | Explicitly true. |
| 4 | Process sandboxing | Pass | Explicitly true; launch command does not disable sandbox. |
| 5 | Permission request handler | Partial | Present/default deny, but SEC-02 origin confusion remains. |
| 6 | Keep webSecurity enabled | Pass | Explicitly true. |
| 7 | Restrictive CSP | Partial | No unsafe script directives; broad egress and raw sinks remain (SEC-06/07). |
| 8 | No insecure mixed content | Pass | Explicitly false. |
| 9 | No experimental features | Pass | No enabling option found. |
| 10 | No enableBlinkFeatures | Pass | No enabling option found. |
| 11 | No webview allowpopups | Pass | Popup policy is main-process controlled. |
| 12 | Verify webview options | Pass | `will-attach-webview` overwrites sensitive preferences. |
| 13 | Limit navigation | Pass/intentional exception | Webview supports browsing HTTP(S); unsafe schemes are blocked. |
| 14 | Limit new windows | Pass | Default deny with explicit popup settings and hardened overrides. |
| 15 | Safe shell.openExternal | Pass | HTTP(S) validated; native schemes confirmed and allowlisted. |
| 16 | Current Electron | Pass | 43.2.0; `npm outdated` produced no entries on review date. |
| 17 | Validate IPC sender | Partial | Central validation exists; per-role/channel authorization is missing (SEC-05). |
| 18 | Avoid file:// | Fail | All local pages use `loadFile` (SEC-09). |
| 19 | Harden fuses | Fail | No fuse configuration found (SEC-09). |
| 20 | Do not expose Electron APIs to untrusted content | Partial | Remote webview bridge is narrow; local shared preload is excessively broad (SEC-03/05). |

## OWASP ASVS / Top 10 coverage summary

- **Architecture and threat modeling / A06 Insecure Design:** privilege boundaries exist but window roles and autofill gesture trust need explicit models.
- **Encoding and sanitization / A05 Injection:** strict CSP and partial DOMPurify use pass; remote suggestion and rich-HTML sinks fail complete coverage.
- **Authentication / A07:** strong master-password policy, scrypt and throttling exist; throttle persistence is missing.
- **Access control / A01:** central sender validation passes baseline; per-window authorization and requesting-origin permission checks are incomplete.
- **Cryptography and data protection / A04:** authenticated encryption, random IVs, OS binding and restrictive files pass; runtime plaintext is a documented residual risk.
- **Communication security:** autofill is HTTPS-only and TLS defaults are secure. General browsing still intentionally accepts HTTP, and proxy configuration disables certificate checks in yt-dlp.
- **Software supply chain and integrity / A03/A08:** npm state is clean, but runtime executable downloads lack artifact verification.
- **Security configuration / A02:** BrowserWindow defaults are strong; file protocol and fuses remain incomplete.
- **Logging and exception handling / A09/A10:** credential values are not intentionally logged and most IPC errors are reduced to codes; operational security alerts and audit telemetry are limited.

## Verification evidence

```text
npm run -s test:electron-security  -> electron security invariants: ok
npm run -s test:credential-vault   -> credential vault tests: ok
npm audit --audit-level=low        -> found 0 vulnerabilities
npm outdated --long                -> no outdated direct packages reported
```

These tests demonstrate selected invariants, not absence of vulnerabilities. In particular, they currently do not test trusted-event enforcement, permission origin separation, per-window IPC roles, executable artifact integrity, fuse state, or raw DOM sink taint flow.

## Recommended remediation order

1. Fix SEC-01 and SEC-02 before enabling the password manager outside experimental testing.
2. Split preload/IPC roles and replace arbitrary path APIs with capability handles (SEC-03/05).
3. Add cryptographic provenance verification for runtime binaries (SEC-04).
4. Remove raw suggestion HTML and establish a Trusted Types/sanitizer enforcement rule (SEC-06/07).
5. Restrict downloader advanced options (SEC-08), then migrate local content protocol and harden fuses (SEC-09).
6. Add regression tests specifically for each finding before changing the feature's security claim.

## Reference baseline

- Electron Security Checklist: https://www.electronjs.org/docs/latest/tutorial/security
- Electron Context Isolation: https://www.electronjs.org/docs/latest/tutorial/context-isolation
- Electron Process Sandboxing: https://www.electronjs.org/docs/latest/tutorial/sandbox
- Electron Fuses: https://www.electronjs.org/docs/latest/tutorial/fuses
- OWASP ASVS 5.0.0: https://github.com/OWASP/ASVS/tree/v5.0.0
- OWASP Top 10:2025: https://owasp.org/Top10/
