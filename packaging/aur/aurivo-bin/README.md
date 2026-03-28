# aurivo-bin (AUR)

This folder contains a ready-to-publish `PKGBUILD` for AUR.

## Publish flow

1. Create or clone your AUR repo:
   - `ssh://aur@aur.archlinux.org/aurivo-bin.git`
2. Copy `PKGBUILD` from this folder into that repo.
3. Update `pkgver` to your release version (`X.Y.Z`).
4. Sign release AppImage with your PGP release key and upload/update `.sig`.
5. Keep `validpgpkeys` updated in `PKGBUILD` (full 40-char fingerprint).
6. Generate checksums:
   - `updpkgsums`
7. Generate `.SRCINFO`:
   - `makepkg --printsrcinfo > .SRCINFO`
8. Commit and push to AUR:
   - `git add PKGBUILD .SRCINFO`
   - `git commit -m "aurivo-bin: update to vX.Y.Z"`
   - `git push`

## User install

- With AUR helper: `yay -S aurivo-bin`
- Manual:
  - `git clone https://aur.archlinux.org/aurivo-bin.git`
  - `cd aurivo-bin && makepkg -si`

## One-time PGP key import for users

```bash
curl -fsSL https://raw.githubusercontent.com/muhammed-aurivo-dev/Aurivo-Medya-Player-Linux/main/packaging/keys/aurivo-release-signing.asc | gpg --import
```
