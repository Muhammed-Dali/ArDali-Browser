# Security model

This document describes implemented defensive controls and their boundaries. It is not a guarantee that ArDali is vulnerability-free. Report suspected vulnerabilities through the private process in the repository [Security Policy](../SECURITY.md).

## Implemented controls

### Chromium and renderer isolation

- Chromium sandboxing is enabled for application renderers and web guests.
- Context isolation is enabled and Node.js integration is disabled in renderer windows.
- Web security remains enabled; insecure mixed content is not allowed.
- Local HTML surfaces define restrictive Content Security Policies (CSP), including blocked object embedding and constrained script sources.
- Remote web content receives a smaller trust surface than local application pages.

### IPC validation

- IPC registration is wrapped by deny-by-default sender authorization.
- Local pages receive page-specific channel-prefix allowlists.
- Guest webviews are limited to explicitly enumerated guest channels.
- IPC values are checked for depth, size, key names, cycles, binary limits, and channel format before feature handlers run.
- Sensitive handlers perform additional URL, origin, path, and value validation.

### Local password vault

- Credential records are stored locally and encrypted with AES-256-GCM.
- A master password protects vault access.
- Configurable automatic locking limits the unlocked period.
- Secure autofill requires a user-authorized, short-lived, single-use operation.
- Autofill is restricted to HTTPS and exact canonical origin matching.
- Authorization is bound to the requesting sender, frame, and origin, and is rejected if navigation changes the origin.
- Credential tests cover locking, origin validation, authorization, and encrypted persistence behavior.

The vault reduces exposure inside the application, but it cannot protect secrets after the operating system or user session has been compromised.

### Files, downloads, and native components

- File operations use main-process validation and renderer path capabilities for sensitive local paths.
- Subprocess workflows prefer argument arrays and validate user-controlled inputs.
- Bundled native shared libraries are tracked by SHA-256 in `third_party/binary-manifest.json`.
- Published artifacts include checksum-based verification instructions.

## Automated security checks

The mandatory pre-release command includes:

```bash
npm audit
npm run test:electron-security
npm run test:credential-vault
npm run dali:test:security
```

It also verifies the binary manifest and release metadata. The `.github/workflows/pre-release.yml` workflow runs this gate before its packaging stage. Separate Semgrep and Snyk workflows add static and dependency analysis; consult each workflow for whether a specific finding is blocking or advisory.

### Electron security tests

`scripts/test-electron-security.js` checks important configuration invariants such as sandboxing, context isolation, web security, CSP presence, IPC authorization, restricted preload exposure, and selected sanitization boundaries.

### Credential-vault tests

`scripts/test-credential-vault.js` exercises encrypted persistence, master-password behavior, lock enforcement, canonical HTTPS origins, and authorization requirements.

### Dali security tests

The Dali suite covers malformed inputs, denied capabilities, unit/range validation, hardened compilation requirements, fuzz cases, and signature-tamper scenarios.

## Trust boundaries

- Media files, subtitles, playlists, tags, rulesets, and imported settings are untrusted input.
- Remote webpages are untrusted even when displayed inside ArDali.
- Third-party services and content remain outside ArDali's security boundary.
- Native parsers and bundled libraries require ongoing dependency and provenance review.
- A passed automated check proves only the invariants it tests.

## Maintainer checklist

- Review every new IPC handler and preload export as a privileged API change.
- Keep webview permissions, navigation, and popup handling narrow.
- Validate executable paths and subprocess arguments.
- Keep CI permissions minimal and avoid exposing secrets to untrusted pull requests.
- Update binary hashes and provenance when native runtime files change.
- Coordinate vulnerability fixes through a GitHub Security Advisory when possible.

## Reporting

Do not disclose a suspected vulnerability in a public issue. Follow [SECURITY.md](../SECURITY.md) for private reporting, supported versions, scope, and safe-harbor expectations.
