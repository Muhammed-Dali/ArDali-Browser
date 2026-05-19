# Main Release Notes (2026-04-08)

## DALI language and tooling

- Added Linux MIME/icon installer for `.dali`, `.dl`, and `.vsix`.
- Added `.vsix` MIME definition and dedicated icon for cleaner file manager UX.
- Kept malicious preset files editor-clean and moved malicious payloads to dynamic generation in security tests.
- Expanded DALI security suite coverage (unknown effect, unsafe capability, invalid unit, out-of-range latency, insecure URL, hardened capability enforcement).
- Added CI hardening workflows:
  - `DALI Multi-Arch CI`
  - `DALI Setup Smoke`
  - `Publish DALI VS Code Extension`
- Scoped Linux app build triggers so DALI-only changes do not run full app Linux build.

## Package versions

- npm package: `ardali-dali-lang@0.1.4` published.
- VS Code extension package version bumped to `0.1.5` (tag `dali-vscode-v0.1.5`).
