# Troubleshooting

## AppImage does not start

Make the file executable and start it from a terminal to capture diagnostics:

```bash
chmod +x ArDali-*-linux-*.AppImage
./ArDali-*-linux-*.AppImage
```

Install your distribution's FUSE 2 compatibility package if the output reports a FUSE error. As a diagnostic fallback, AppImage may support `APPIMAGE_EXTRACT_AND_RUN=1`; normal package installation is preferable for long-term use.

## No audio or native audio errors

Confirm that PipeWire/PulseAudio or ALSA works for other applications, then include the active audio server and device in a bug report. If building from source, verify that native libraries were built for the Electron ABI selected by the package configuration.

## Visualizer does not open

Check GPU/OpenGL support and start ArDali from a terminal. Include GPU model, driver, display server, and logs. Do not replace bundled projectM libraries with system copies unless testing a specific compatibility hypothesis.

## Wayland display issues

Record whether the problem also occurs in an X11 session and include the desktop environment and GPU driver. Avoid adding Chromium flags permanently until the issue is isolated; flags can affect acceleration and stability.

## Web playback or sign-in problems

Web services can change independently of ArDali. Confirm the behavior in the latest release and distinguish service-side availability from application navigation, permissions, or filtering. Never attach exported cookies, session tokens, or account credentials to an issue.

## A useful bug report

Include the ArDali version, installation type, distribution, architecture, X11/Wayland session, desktop environment, GPU/audio details when relevant, exact reproduction steps, expected and actual behavior, and sanitized logs.
