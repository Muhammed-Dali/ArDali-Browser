# Changelog

Notable user-facing changes to ArDali WebMedia will be documented here. The project follows [Semantic Versioning](https://semver.org/) for release identifiers where practical and uses [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) headings.

## [Unreleased]

## [5.2.17] - 2026-07-14

### Fixed

- Synchronized the published AppImage version and verified SHA-256 with the canonical AUR recipe before Pacman publication.
- Restored the `Publish Pacman Repo` metadata gate by completing the required post-release AUR phase for v5.2.16.
- Documented the two-phase release ordering so future Pacman publication waits for the final AppImage digest.

### Release engineering

- Prepared v5.2.17 as a CI/CD and packaging-only follow-up release.
- Kept Electron at the validated `40.6.1` ABI target; Dependabot PR #44 is not included because it updates only the npm dependency and leaves native/build targets inconsistent.
- Preserved application behavior, native C++/DSP code, hardware-aware paths, and performance optimizations.

## [5.2.16] - 2026-07-14

### Changed

- Standardized application, package, license, repository, and Electron release metadata.
- Reduced GitHub Actions permissions and pinned reusable Actions to reviewed commits.
- Replaced automatic version/tag creation with an explicit reviewed release process.
- Added release metadata, Flatpak, AppStream, desktop-entry, and binary-integrity validation.
- Improved AppImage, AUR, DEB, RPM, checksum, signing, and release documentation.
- Reorganized the README, installation guidance, screenshots, badges, and project documentation.

### Added

- GitHub Pages product site integrated with the existing Pacman repository deployment.
- Security policy, Code of Conduct, roadmap, contribution guidance, issue forms, and pull request checklist.
- Architecture, building, packaging, troubleshooting, brand, promotion, and maintainer documentation.
- Safe implementation plan for optional GitHub community links inside the application.

### Security

- Added SHA-256 verification for downloaded projectM release sources.
- Scoped workflow write permissions to release and deployment jobs that require them.
- Preserved existing Electron isolation, native audio, performance, and hardware-aware behavior.

### Documentation

- Reorganized the English project overview and installation guidance.
- Added contribution, conduct, security, roadmap, maintainer audit, build, packaging, release, architecture, and troubleshooting documentation.
- Improved GitHub issue and pull request guidance.

## Release history

Earlier releases predate this curated changelog. Their generated notes and artifacts remain available on the [GitHub Releases page](https://github.com/Muhammed-Dali/ArDali-WebMedia/releases).

Future releases should move entries from `Unreleased` into a dated `X.Y.Z` section and link the version comparison.
