# ArDali WebMedia v5.2.17

ArDali WebMedia v5.2.17 is a release-engineering and Linux packaging reliability update. It does not change playback behavior, the native C++/DSP engine, hardware-specific optimizations, or performance paths.

## Fixed

- Completed the required post-release AUR synchronization using the published AppImage SHA-256.
- Restored the Pacman repository publication gate after the expected application/AUR version mismatch in v5.2.16.
- Clarified that AUR and Pacman publication occur only after the final GitHub Release AppImage exists and its digest is independently verified.

## Electron dependency decision

Electron remains at `40.6.1`. Dependabot PR #44 proposes `40.8.5`, but only changes the npm development dependency. ArDali also pins Electron in `build.electronVersion`, native node-gyp targets, and Linux/Windows workflows. The PR is therefore not safe to merge as-is. A coordinated Electron patch upgrade may be evaluated separately with all ABI targets aligned and complete native/package smoke tests.

## Expected assets

- `ArDali-5.2.17-linux-x86_64.AppImage`
- `ArDali-5.2.17-linux-amd64.deb`
- `ArDali-5.2.17-linux-x86_64.rpm`
- `latest-linux.yml`
- `SHA256SUMS.txt`
- optional `SHA256SUMS.txt.asc`

## Verification

```bash
sha256sum -c SHA256SUMS.txt
```

When a signature is published:

```bash
gpg --verify SHA256SUMS.txt.asc SHA256SUMS.txt
```

The AUR recipe must remain on v5.2.16 until the final v5.2.17 AppImage digest is available.
