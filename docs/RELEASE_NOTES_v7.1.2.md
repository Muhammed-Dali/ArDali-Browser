# DaliNira Browser 7.1.2

Released on 13 September 2026.

DaliNira Browser 7.1.2 finalizes internal media playback, download manager reliability,
and Linux desktop and taskbar integration.

## Downloads & Internal Media Playback

- Enhanced download service lifecycle with accurate progress updates and persisted
  metadata (titles, sources, thumbnails, output paths).
- Integrated internal media player for downloaded audio and video files within
  DaliNira Browser.
- Connected internal audio and video playback with the DALI DSP engine, enabling
  full 32-band parametric EQ, bass enhancement, auto-gain, and limiter effects.
- Added internal media routing and seamless local playback controls.

## Desktop & Panel Integration

- Stabilized Linux desktop integration and panel/taskbar grouping with launcher
  wrapper and explicit `StartupWMClass=DaliNiraBrowser` configuration.
- Added standard default browser detection and prompt integration.

## Platform status

Linux x86_64 remains the verified build, test, packaging, and release platform.
The portable archive ships as
`dalinira-browser-7.1.2-linux-x86_64.tar.zst`.
