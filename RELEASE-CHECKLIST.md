# Release checklist

Releases are explicit maintainer actions. A successful `main` build does not create a version or tag.

## 1. Prepare

- [ ] Choose a version that has never been tagged or published.
- [ ] Update `package.json`, `package-lock.json`, RPM/DEB reference metadata, and AppStream release metadata.
- [ ] Keep the canonical AUR recipe on the last verified artifact until the new AppImage exists; stage its `pkgver`, SHA-256, and `.SRCINFO` as a separate post-build commit.
- [ ] Move relevant `CHANGELOG.md` entries from `Unreleased` into a dated version section.
- [ ] Run `npm run verify:release:metadata` and `npm run verify:binary:manifest` before tagging.
- [ ] Confirm Electron `devDependencies`, `build.electronVersion`, native rebuild target, and CI targets match.
- [ ] Confirm the root and package metadata use `GPL-3.0-only`.

## 2. Validate

- [ ] Linux CI succeeds from the exact candidate commit.
- [ ] Windows CI succeeds when Windows is included in the release.
- [ ] Flatpak metadata validation succeeds.
- [ ] Core playback, native audio, visualizer, downloads, web media, settings, and update paths pass smoke testing.
- [ ] AppImage, DEB, and RPM install/launch checks pass in clean environments.
- [ ] Release notes include highlights, fixes, compatibility notes, known issues, packages, and verification instructions.

## 3. Publish

- [ ] Merge the reviewed release-preparation commit.
- [ ] Create an annotated `vX.Y.Z` tag on that commit and push it once.
- [ ] Confirm the `Release` workflow validates tag/version equality.
- [ ] Confirm AppImage, DEB, RPM, updater metadata, `SHA256SUMS.txt`, and optional signature are attached.
- [ ] Download the published assets and independently verify checksums and startup.
- [ ] Publish the synchronized AUR recipe and `.SRCINFO` only after the asset digest is final.
- [ ] Run `node scripts/verify-release-metadata.js --include-aur` in the AUR follow-up commit.
- [ ] Confirm the Pacman repository job completes and existing repository URLs still work.

## 4. Post-release

- [ ] Mark the release as latest only after verification.
- [ ] Verify README and website links.
- [ ] Announce using reviewed copy from `docs/PROMOTION.md`.
- [ ] Monitor issues and crash reports during the initial release window.
- [ ] Never move an existing release tag or silently replace published assets.
