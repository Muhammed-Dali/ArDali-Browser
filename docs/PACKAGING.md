# Linux packaging

## Published formats

The release workflow is designed to produce AppImage, DEB, and RPM artifacts. An AUR binary package installs a published AppImage. Flatpak metadata exists in `packaging/flatpak/`, but publication status should be verified before advertising it as an official channel.

## Sources of truth

| Concern | Source |
| --- | --- |
| Application version and Electron Builder config | `package.json` and `package-lock.json` |
| AUR recipe | the published `ardali-bin` AUR repository; in-repo recipes must be kept synchronized |
| Desktop integration | `packaging/linux/` and `packaging/appstream/` |
| Flatpak manifest | `packaging/flatpak/` |
| Release artifacts | `.github/workflows/release.yml` |
| Binary integrity | `third_party/binary-manifest.json` |

## Packaging rules

- Never publish when tag, application, package, and updater versions disagree.
- Use immutable URLs and real checksums in package recipes; avoid `SKIP` for remote release assets.
- Keep license identifiers consistent with the root `LICENSE` file.
- Validate desktop and AppStream metadata with the appropriate distribution tools.
- Do not copy build directories, logs, editor files, or obsolete release artifacts into packages.
- Preserve native ABI compatibility and hardware-specific runtime libraries.

## Maintainer verification

Before publishing, install each artifact in a clean environment, start the application, play representative local audio/video, open the visualizer, verify the native audio addon, confirm desktop integration, and test uninstall/upgrade behavior. Follow [RELEASE-CHECKLIST.md](../RELEASE-CHECKLIST.md) and [RELEASES.md](RELEASES.md).
