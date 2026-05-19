# Security Runbook

This document defines the security workflow for ArDali-Medya-Player.

## 1) Release Security Pipeline (Ordered)

Security checks run in this order:

1. `Release`
2. `Publish Pacman Repo`
3. `Snyk Security Gate`
4. `Semgrep Security Gate`

The chain is enforced by GitHub Actions `workflow_run` triggers:

- Snyk starts only after Pacman workflow finishes successfully.
- Semgrep starts only after Snyk workflow finishes successfully.

## 2) Required GitHub Secrets

Repository: `ArDali-Medya-Player-Linux`

Required secrets:

- `SNYK_TOKEN`
- `SEMGREP_APP_TOKEN`

If either token is missing, the related workflow will fail by design.

## 3) Daily Developer Flow

1. Develop feature in branch.
2. Push changes.
3. Verify build/release workflows.
4. Verify `Snyk Security Gate` is green.
5. Verify `Semgrep Security Gate` is green.
6. Merge/release only after all required workflows pass.
7. Run `npm run verify:binary:manifest` before release tagging to verify tracked `.so` integrity.

## 4) Local vs CI Scans

- Local scans are for fast feedback.
- GitHub Actions scans are the final security decision source.

Use local scans for early fixes, but always trust CI result before release.

## 5) Scope Hygiene

Semgrep scan scope is controlled with `.semgrepignore`.

Ignored categories include:

- backups/cloned trees (for example `**/chromium.backup_*/`)
- generated/build/cache folders
- vendor/third-party non-product trees
- browser ruleset data folders under `uDAL*-weman-home/*/rulesets/`

Keep this file updated to avoid false positives from non-product content.

## 6) Electron Security Baseline

For app-owned BrowserWindow configurations:

- `nodeIntegration: false`
- `contextIsolation: true`
- `webSecurity: true`
- `allowRunningInsecureContent: false`

When preload requires Node APIs, `sandbox: false` may be required.
In that case:

- keep strict preload bridge surface
- enforce `sandbox: true` for untrusted webviews
- keep policy exceptions documented in `.snyk` with reason + expiry

## 7) Failure Triage Playbook

### Snyk fails

1. Open `Snyk Security Gate` logs.
2. Check whether failure is `SCA` or `Code`.
3. Review SARIF findings in `Security > Code scanning alerts`.
4. Fix high/critical issues first.

### Semgrep fails

1. Open `Semgrep Security Gate` logs.
2. If exit code is `2`, check `SEMGREP_APP_TOKEN`.
3. If findings are out-of-scope, confirm `.semgrepignore` coverage.
4. Re-run workflow after fix.

## 8) Memory/Performance Notes (VS Code)

For local stability:

- prefer manual scanning mode for Snyk
- avoid running Semgrep + Snyk at the same time locally
- use CI as final gate to reduce local machine pressure
