# ArDali WebMedia v5.2.16 release-preparation report

Date: 2026-07-14

## Prepared

- Application and lockfile version set to `5.2.16`.
- RPM, DEB, AppStream, README, website, promotion, changelog, and release-note references prepared for v5.2.16.
- Product license metadata standardized as `GPL-3.0-only`.
- Electron build and dependency version standardized as `40.6.1`.
- GitHub Actions permissions minimized and reusable Actions pinned to commit SHAs.
- Automatic version commits and tag creation removed from normal `main` builds.
- Release metadata consistency, Flatpak metadata, AppStream, desktop entry, and binary manifest checks added.
- GitHub Pages site, community files, documentation, and promotional copy prepared.

## Intentionally pending

- The canonical AUR recipe remains on the last artifact with a verified checksum until the v5.2.16 AppImage exists. Immediately after release CI uploads the final AppImage, calculate its SHA-256, update `pkgver`, `sha256sums`, and `.SRCINFO`, validate in a clean chroot, and publish the AUR update as a separate commit.
- Hosted Linux, Windows, release, Flatpak, Pacman, Semgrep, and Snyk workflows must pass after the review branch is pushed.
- GitHub Release remains a draft until the uploaded packages and checksums are independently verified.
- Flathub submission remains pending clean-environment testing and review.

## Stability statement

This release-preparation work does not modify application runtime source, C++ audio/DSP implementation, hardware-specific behavior, or performance optimizations.
