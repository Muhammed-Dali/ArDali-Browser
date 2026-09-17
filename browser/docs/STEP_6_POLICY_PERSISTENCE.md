# Step 6 — DALI policy, persistence, and platform matrix

## Enforced policy chain

`dali/browser.dali` is parsed and validated by `dali-lang-repo`, then CMake
generates `build/browser_policy.json`. The native host refuses startup if that
policy is invalid. The current policy grants only:

- HTTP(S) top-level navigation;
- user-confirmed downloads;
- session restore;
- live-page window reparenting.

It denies unrequested popups, unscoped filesystem access, and process spawn.

## Persistence

The persistent Qt WebEngine profile lives below the operating system app-data
directory. Main-window tabs are atomically stored in `tabs.session.json` using
`QSaveFile`; detached windows are deliberately not written into the main
session. Restored URLs are revalidated against the HTTP(S) policy.

## Platform result matrix

| Platform | Result | Notes |
| --- | --- | --- |
| Current Wayland session | Partial / safe fallback | `XDG_SESSION_TYPE=wayland`; automatic cross-window attach is disabled and the detached window shows an explicit attach action. Global-coordinate attach is not claimed as tested. |
| X11 | Manual test required | Movement-settle attach uses the 260 ms native move debounce. Test must verify hover marker and release over the strip. |
| Windows | Not tested | Native move/coordinate path needs an actual Windows run. |
| macOS | Not tested | Native move/coordinate path needs an actual macOS run. |

## Manual security checks

1. Enter `https://example.com` in the address bar: navigation is allowed.
2. Enter `file:///etc/passwd`: navigation is rejected by the page policy.
3. Visit a page that calls `window.open`: no unsolicited popup should appear.
4. Start a download: a save-file dialog must appear; canceling it must cancel
   the request.
5. Open two HTTP(S) tabs, close the browser, then reopen it: main-window tabs
   should restore. A detached tab should not be restored as a main tab.
