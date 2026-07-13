# ArDali WebMedia v5.2.16

ArDali WebMedia v5.2.16 is a release-readiness and project-quality update. It keeps the existing playback, native audio, DSP, visualizer, web media, download, recording, and hardware-aware behavior unchanged while strengthening packaging, release safety, documentation, and community infrastructure.

## Highlights

- Consistent GPL-3.0-only license, repository, application, package, and Electron metadata
- Least-privilege GitHub Actions with reusable Actions pinned to reviewed commits
- Explicit reviewed releases instead of automatic version commits and tags from `main`
- Improved AppImage, DEB, RPM, AUR, checksum, signature, and artifact verification guidance
- Flatpak/AppStream validation and a documented Flathub preparation path
- New responsive GitHub Pages project site integrated with the Pacman repository deployment
- Professional README, contributor guidance, security policy, issue forms, roadmap, and maintainer documentation

## Security and supply chain

- Downloaded projectM 4.1.6 source is verified with SHA-256 before extraction.
- Normal Linux and Windows builds use read-only repository permissions.
- Release, Pages, security-event, and package publishing permissions are scoped to the jobs that need them.
- A metadata consistency gate prevents version, license, repository, Electron, and packaging drift.

## Packages

The release workflow is expected to produce:

- `ArDali-5.2.16-linux-x86_64.AppImage`
- `ArDali-5.2.16-linux-amd64.deb`
- `ArDali-5.2.16-linux-x86_64.rpm`
- `latest-linux.yml`
- `SHA256SUMS.txt`
- `SHA256SUMS.txt.asc` when release signing is configured

The AUR package update follows only after the final AppImage checksum is available and verified.

## Upgrade notes

No user setting, library, playlist, or media migration is expected. Install the new package over the previous release using the same distribution channel. Back up important application data as part of normal upgrade practice.

## Verification

Download the package and `SHA256SUMS.txt` from the same GitHub Release, then run:

```bash
sha256sum -c SHA256SUMS.txt
```

If a signature is published and the trusted ArDali signing key has been imported:

```bash
gpg --verify SHA256SUMS.txt.asc SHA256SUMS.txt
```

## Known release-process note

The historical `v5.2.14` and `v5.2.15` tags are preserved and are not moved or reused. v5.2.16 is created from the reviewed release commit after all local gates pass.
