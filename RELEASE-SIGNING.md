# Release Signing

ArDali release artifacts are integrity-pinned with SHA-256 and can be GPG-signed.

## What is produced

- `SHA256SUMS.txt`: SHA-256 checksums for files in `dist/`
- `SHA256SUMS.txt.asc`: optional detached armored GPG signature (if signing secret exists in CI)

Release workflow (`.github/workflows/release.yml`) automatically:

1. builds release artifacts
2. runs `npm run release:checksums`
3. signs checksums when `RELEASE_GPG_PRIVATE_KEY` secret is configured
4. uploads checksum and signature files to GitHub Release assets

## Verify a release locally

1. Download assets:
- release package(s)
- `SHA256SUMS.txt`
- `SHA256SUMS.txt.asc` (if available)

2. Verify checksums:

```bash
sha256sum -c SHA256SUMS.txt
```

3. Verify signature (if `.asc` exists):

```bash
gpg --verify SHA256SUMS.txt.asc SHA256SUMS.txt
```

## CI secrets (optional, for signing)

- `RELEASE_GPG_PRIVATE_KEY`: ASCII-armored private key
- `RELEASE_GPG_PASSPHRASE`: passphrase for the private key (if protected)
