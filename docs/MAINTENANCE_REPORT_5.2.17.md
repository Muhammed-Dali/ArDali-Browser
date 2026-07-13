# v5.2.17 CI/CD and packaging report

## Root cause

The v5.2.16 Pacman workflow failed at `Verify release and AUR metadata consistency`: application metadata was v5.2.16 while the canonical AUR recipe intentionally remained on v5.2.13 until a final release AppImage existed. After v5.2.16 was published, the AUR follow-up had not yet been committed.

## Correction

The published v5.2.16 AppImage digest was verified through both the GitHub Release API and `SHA256SUMS.txt`. The canonical `PKGBUILD` and `.SRCINFO` were updated to v5.2.16 with SHA-256 `e855bcc324c0a3f34ace1e2f4d2c6ec671df1f2ff715ff2bf97bedd84ced3143`, then pushed as a focused packaging commit.

## Electron PR #44

The proposed update from Electron 40.6.1 to 40.8.5 is not included. The PR updates only `devDependencies.electron`; ArDali also uses `build.electronVersion`, node-gyp ABI targets, and CI environment targets. Its Linux CI correctly fails the metadata consistency gate. Evaluate it separately by aligning every target and rebuilding/testing all native modules and packages.

## v5.2.17 policy

Application, DEB, RPM, AppStream, README, site, changelog, and release notes are prepared as v5.2.17. The canonical AUR recipe stays on the last verified artifact until v5.2.17 release CI produces the final AppImage. This prevents `SKIP`, placeholder, stale, or locally non-reproducible checksums from reaching users.
