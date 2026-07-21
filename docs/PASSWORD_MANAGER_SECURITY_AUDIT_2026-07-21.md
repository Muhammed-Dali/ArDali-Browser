# ArDali Password Manager Security Audit

Date: 2026-07-21

## Executive result

The password-manager path is now materially hardened and suitable for controlled testing. The vault uses authenticated encryption, an OS-protected device secret, a memory-only unlocked key, exact HTTPS-origin matching, explicit user authorization for fill operations, and automatic locking. Electron renderer isolation, IPC authorization, navigation, permissions, CSP, XSS defenses, and dependencies were hardened across the application.

Production release remains conditional on signing each platform artifact and testing install/update flows with the real signing identities. Source configuration cannot substitute for possession and protection of those private keys.

## Requested 10-point report

1. **Electron security:** all reviewed `BrowserWindow` instances use `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true`, and disallow insecure content. Local windows deny new windows and unexpected navigation. Developer Tools are unavailable in production. The Linux launch command no longer disables Chromium's sandbox.
2. **CSP and XSS:** every local HTML entry point has CSP without `unsafe-inline` or `unsafe-eval`, and includes `object-src 'none'` and `base-uri 'none'`. Inline startup logic was moved into external scripts. DOMPurify 3.4.12 is locally bundled; untrusted playlist, download URL/path, and downloader templates pass through the shared sanitizer. Text-only values use `textContent` or escaping.
3. **IPC and permissions:** a central deny-by-default interceptor validates the sender and recursively bounds/validates all arguments. Only five narrow guest channels are allowed from HTTPS webviews in the dedicated partition. Camera, microphone, location, notifications, clipboard access, and popups default to denied unless explicitly enabled. Permission request and permission check handlers share the same policy.
4. **Vault cryptography:** vault v2 uses AES-256-GCM with a fresh 96-bit IV per encryption and authenticated associated data. The master password is processed with scrypt (`N=131072, r=8, p=1`) and HKDF, bound to a random device secret protected by Electron `safeStorage`. Linux `basic_text` storage is rejected. Origin, username, and password are all encrypted at rest. Legacy v1 data migrates after a successful unlock.
5. **Master password and brute force:** new master passwords require 12–256 characters with upper case, lower case, number, and symbol. Failed unlocks use an exponential delay up to 30 seconds, and concurrent verification is rejected. Password input fields are cleared before asynchronous IPC work.
6. **Autofill and domains:** autofill operates only in a visible top-frame HTTPS password form. Form actions must remain same-origin HTTPS. The main process independently verifies the webview's current origin. Origins are canonicalized with the URL parser and compared exactly, preventing subdomain, suffix, and Unicode/punycode lookalike matches. Filling requires a short-lived, one-use authorization token created by explicit user interaction; saving still requires confirmation.
7. **Locking and memory:** the default idle lock is five minutes; supported choices are 1, 5, 15, and 30 minutes. Manual lock, system suspend, and OS screen-lock events immediately lock the vault. The derived data key exists only while unlocked and buffers are zeroed where practical. Plaintext credentials are returned only for the authorized operation and are not persisted by the manager.
8. **Navigation, protocols, and logging:** webviews accept only HTTP(S), unsafe redirects are blocked, certificate bypass is opt-in through a development environment flag, and arbitrary executable/custom-protocol launching was removed. Sensitive settings are redacted before diagnostics. No credential or cookie values are deliberately logged; cookie maintenance logs contain only errors/counts/origin metadata.
9. **Dependencies and updates:** direct security-relevant dependencies were updated and pinned: Electron 43.2.0, electron-builder 26.15.3, electron-updater 6.8.9, DOMPurify 3.4.12, png-to-ico 3.0.2, and systeminformation 5.33.0. `npm audit --audit-level=low` returned zero vulnerabilities. Downgrades are disabled. Windows publisher metadata and macOS hardened runtime are configured. Release signing/notarization and updater validation must be exercised with real protected signing keys before production.
10. **Validation and performance:** automated vault tests cover strong-password policy, encrypted-at-rest absence of plaintext, exact/punycode origins, one-use authorization, locking, throttling, and master-password change. Static Electron tests cover sandbox preferences, CSP, IPC gates, TLS behavior, protocol removal, and sanitizer integration. Electron 43 completed a 25-second Wayland smoke test with preload, renderer, native audio engine, and webviews running. Scrypt runs only during vault setup/unlock/change; ordinary browsing and playback paths do not pay this cost.

## OWASP-oriented threat review

- **Spoofing / phishing:** exact canonical origins, HTTPS-only fill, visible password-form requirement, origin recheck, explicit gesture, and one-time authorization reduce credential disclosure to lookalike pages.
- **Tampering:** AES-GCM authentication rejects modified vault envelopes and records; strict schema, size, identifier, and base64 checks reject malformed vault files.
- **Information disclosure:** all credential metadata is encrypted, device binding uses OS secure storage, IPC is sender-scoped, and sensitive logging is avoided.
- **Elevation / remote code execution:** sandboxing, isolation, no renderer Node.js, restricted preload APIs, validated IPC, strict local CSP, navigation limits, and removal of arbitrary executable launching reduce renderer-to-host escalation paths.
- **Denial of service / brute force:** bounded IPC inputs, vault file limits, serialized unlock verification, and capped exponential backoff constrain expensive or repeated work.

## Commands verified

```text
npm run -s test:electron-security   -> electron security invariants: ok
npm run -s test:credential-vault    -> credential vault tests: ok
npm audit --audit-level=low         -> found 0 vulnerabilities
npm ls --depth=0                    -> clean dependency tree
git diff --check                    -> clean
timeout 25s npm run -s dev:linux    -> successful startup; stopped by test timeout
```

## Release gate

Do not label an artifact production-ready until Windows Authenticode signing, macOS signing/notarization, Linux package provenance/checksums, and a signed update upgrade test have all passed in CI using protected release credentials. A third-party penetration test is recommended before advertising the vault as a security product.
