# ArDali Browser Native Modules

This directory contains the native C++/Qt components powering ArDali Browser.

## Directory Structure

- `main.cpp`
  Application entry point and central integration layer.
  It intentionally remains at the `native/` root.

- `core/`
  Shared browser runtime, profile services, policies, icons, and reusable core widgets.

- `tabs/`
  Tab management, tab bar integrations, tab throbber animations, and hover cards.

- `newtab/`
  Custom New Tab page scheme handler, background manager, and thumbnail cache.

- `audio/`
  Shared audio infrastructure, device enumeration, capture services, and effects controller.

- `pulse/`
  ArDali Pulse music recognition subsystem, audio fingerprinting, and search UI.

- `blocker/`
  ArDali Blocker network request filtering, cosmetic CSS injection, ruleset manager, and shield button.

- `passwords/`
  Password Manager, encrypted Credential Vault, and auto-fill integration.

- `eq/`
  Equalizer preset repository and 32-band audio effect profiles.

- `settings/`
  Main browser settings page and configuration hub.

- `sidebar/`
  Side widget, sidebar quick access tools, and configuration panel.

- `session/`
  Session storage, tab restoration, and state persistence.

- `tests/`
  Native automated test suite and release verification audit tests.
