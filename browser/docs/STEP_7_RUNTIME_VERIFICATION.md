# Step 7 — runtime verification and crash containment

## Automated transfer fixture

`ardali-browser-state-test` now creates a muted looping WAV audio fixture in
the test page. Its temporary profile disables `PlaybackRequiresUserGesture`
only because the automated fixture cannot produce a real user gesture; the
production profile is unchanged.

The test proves across main host → detached host → main host:

- same `QWebEnginePage` pointer;
- JavaScript marker, history length, and scroll position preserved;
- the same HTML media element remains playing;
- its `currentTime` increases after both transfers.

Setting `ARDALI_TAB_ATTACH_RUNTIME_TEST=1` when launching the browser runs the
browser-shell attach fixture. It additionally verifies that the detached shell
contains no legacy manual attach action, the requested insertion index is
honored, ownership returns to the root window, and JavaScript/history state is
preserved by the production detach/attach methods.

## Crash containment

`renderProcessTerminated` marks only that `TabRecord` as crashed and records
the Chromium termination status and exit code. Its tab label receives a warning
prefix. No automatic reload is issued, no other page is recreated, and the
main session metadata remains available for the next startup.

The `TabManager` unit test directly covers that crash-state transition. An
intentional live Chromium renderer kill is not part of the automated suite yet.

## Still manual

- Browser-window restart after a user session must be checked on the desktop.
- File URL, popup, and download chooser flows require desktop interaction.
- Native drag gestures should receive a final hands-on smoke test on both
  Wayland and X11 because compositor input routing cannot be reproduced by the
  headless transfer fixture.
