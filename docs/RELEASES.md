# Releases and artifact verification

## Maintainer release flow

1. Confirm the intended version across application, lockfile, packaging, and updater metadata.
2. Update `CHANGELOG.md` with user-visible changes, fixes, known issues, and upgrade notes.
3. Run relevant checks and complete `RELEASE-CHECKLIST.md`.
4. Create a signed or protected `vX.Y.Z` tag from the reviewed commit.
5. Let `.github/workflows/release.yml` build artifacts and confirm the tag matches the application version.
6. Verify artifact contents, SHA-256 checksums, optional GPG signature, and clean-machine installation.
7. Publish or synchronize distribution-specific packages only after GitHub artifacts are final.

Avoid automatic version bumps on every `main` push. A release should be an explicit, reviewable decision with a changelog and a known commit.

## Verify a download

Download the package and `SHA256SUMS.txt` from the same GitHub release, then run:

```bash
sha256sum -c SHA256SUMS.txt
```

If `SHA256SUMS.txt.asc` is present and the project's public signing key has been obtained through a trusted channel:

```bash
gpg --verify SHA256SUMS.txt.asc SHA256SUMS.txt
```

A checksum detects corruption or replacement relative to the checksum file. A trusted signature additionally authenticates that file. Do not treat an unsigned checksum downloaded from the same compromised location as independent proof of authenticity.

## Release notes template

Each release should include highlights, fixed bugs, security notes, package availability, compatibility changes, known issues, upgrade guidance, contributor credits, and verification instructions.
