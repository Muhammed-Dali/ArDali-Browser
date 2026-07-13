# Security model

This document summarizes the intended defensive boundaries. Vulnerability reports belong in the private process described by [SECURITY.md](../SECURITY.md).

## Trust boundaries

- Remote web content must not receive Node.js integration or an unrestricted preload bridge.
- Renderer processes request privileged operations through explicit IPC channels.
- Main-process handlers must validate the sender, data type, allowed values, URLs, and filesystem paths.
- External URLs must use an allowlisted protocol and should require user intent where appropriate.
- Downloaded tools and bundled native binaries require provenance and integrity checks.
- Media files, subtitles, playlists, tags, rulesets, and imported settings are untrusted input.

## Electron baseline

Keep `contextIsolation` enabled, `nodeIntegration` disabled for renderers, `webSecurity` enabled, insecure mixed content disabled, popup/navigation handlers restrictive, and sensitive permissions denied by default. A required exception must be narrow, documented, tested, and periodically reviewed.

## Native and subprocess safety

Prefer argument arrays with `spawn`/`execFile` over shell command construction. Validate executable paths and user-controlled arguments. Native parsers and DSP code should be tested with malformed and oversized input, and binary ABI changes must be coordinated with the Electron version used for packaging.

## Supply chain

Lock dependencies, review automated updates, pin or otherwise control CI actions, minimize workflow permissions, verify downloaded source archives, and preserve `third_party/binary-manifest.json` checks. Release checksums should be signed with a documented public key.

## Maintainer checklist

- Review all new IPC handlers and preload exports as privileged API changes.
- Keep security scanners independent of untrusted pull-request secrets.
- Remove expired suppressions only after confirming the underlying condition.
- Do not publish scanner reports containing secrets or sensitive local paths.
- Coordinate fixes and disclosure through a GitHub Security Advisory when possible.
