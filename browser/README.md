# ArDaliBrowser

ArDaliBrowser is a new native desktop browser project. Its first target is a
Chromium/Qt WebEngine host with a tab model that can move the *same* page instance
between a main browser window and a detached browser window.

## What this project is and is not

- It will use a real rendering engine: Chromium through CEF. A browser cannot
  be both independent of browser engines and render the modern web.
- It is not an Electron rewrite and it does not copy the existing Electron
  implementation.
- `dali-lang-repo` is currently an audio DSL, not a general-purpose systems
  language. The browser policy/configuration is being specified in DALI first;
  a safe native DALI backend is a separate compiler milestone.

## First milestone

The initial vertical slice is deliberately narrow:

1. Start one Chromium/Qt WebEngine browser window.
2. Open one tab using one browser/page instance.
3. Detach that exact instance into another native window.
4. Attach it back without navigation, reload, or context loss.

See [architecture](docs/ARCHITECTURE.md) and the first DALI browser manifest
at [dali/browser.dali](dali/browser.dali).

## Development

On Linux, build and launch with one command:

```bash
npm run dev:linux
```

Run the native policy, tab-model, and live-page transfer tests:

```bash
npm run test:runtime
```
