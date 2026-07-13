# Flatpak and Flathub preparation

This directory contains the `com.ardali.mediaplayer` Flatpak manifest and wrapper. The manifest is validated in CI, but the application is not advertised as published on Flathub until its submission is accepted.

## Prerequisites

Install `flatpak`, `flatpak-builder`, and AppStream tooling. Then add Flathub and install the runtime declared by the manifest:

```bash
flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
flatpak install flathub org.gnome.Platform//47 org.gnome.Sdk//47
```

Package names vary by distribution.

## Local build

The current manifest packages a locally built `dist/linux-unpacked/ardali`, so first produce the Linux application bundle with the documented native dependencies:

```bash
npm run build:linux
flatpak-builder --user --install --force-clean build-flatpak packaging/flatpak/com.ardali.mediaplayer.yml
flatpak run com.ardali.mediaplayer
```

## Validate metadata

```bash
appstreamcli validate --no-net packaging/appstream/com.ardali.mediaplayer.metainfo.xml
desktop-file-validate packaging/linux/com.ardali.mediaplayer.desktop
bash scripts/prepare-flathub-pr.sh
```

The `Validate Flatpak` GitHub workflow performs these metadata and submission-layout checks for relevant pull requests.

## Flathub status and limitations

- The wrapper does not disable Electron's sandbox.
- Flatpak permissions are explicit and avoid blanket session-bus/device access.
- In-app AUR/self-update behavior is disabled in the Flatpak environment.
- The manifest currently consumes a prebuilt local Electron bundle. Flathub review may require a fully offline source build with generated Node/Electron sources.
- Network, audio, display, GPU, and user media-folder permissions are feature-driven and must be justified during review.

Prepare the submission directory with `scripts/prepare-flathub-pr.sh`, then follow [FLATHUB-SUBMISSION.md](../../FLATHUB-SUBMISSION.md). Do not publish a Flatpak artifact as official until playback, native audio, visualizer, downloads, file access, portals, and uninstall behavior have been tested in a clean environment.
