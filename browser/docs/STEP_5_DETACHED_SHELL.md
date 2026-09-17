# Step 5 — detached tab shell and native attach

Detached windows use the same `BrowserWindow` host but enter a constrained
single-tab shell mode:

- browser windows use client-side chrome, so the tab strip is the topmost
  window row and contains minimize, maximize/restore, and close controls;
- new-tab creation is hidden;
- the same live `QWebEngineView` and `QWebEnginePage` move into that window;
- its page is not navigated or recreated;
- the detached navigation toolbar has no manual “attach to main” action;
- dragging the detached tab header moves the whole detached window with the
  pointer and shows an accent outline/insertion marker when the pointer reaches
  the main tab strip.

During the initial downward detach gesture, the pointer keeps its horizontal
offset within the tab and the newly created window immediately continues the
native system move. Releasing leaves the single tab aligned at the start of the
strip, matching the detach behavior of Chromium-family browsers.
The downward detach threshold is deliberately short (twice the platform drag
distance, with a 28 px floor) so the tab does not feel held by the source bar.
Because that short threshold can initially overlap the root strip's drop halo,
the first detached move must leave the root target once before snap-back is
enabled. This prevents a new detached window from immediately reattaching.
On Wayland, continuation is requested only after the new `QWindow` reports
itself exposed; sending `xdg_toplevel.move` before the compositor's first
configure event is a fatal protocol error. If the button is released before
that point, the continuation is safely skipped.

## Atomic Transaction State Machine (`TabTransferTransaction`)

Tab transfer flows are governed by an atomic state machine:
`Preparing -> Moving -> DestinationReady -> Committed / RolledBack`

- **Preparing**: Destination window is instantiated and initial state validated.
- **Moving**: Source tab is removed from source layout without intermediate `setParent(nullptr)` surface drop.
- **DestinationReady**: View is adopted by destination layout and top-level surface is exposed.
- **Committed**: Hand-off is committed and ownership validated.
- **RolledBack**: Any timeout, exposure failure, or adoption rejection triggers an immediate rollback to the source window layout without context loss.

On Wayland, global coordinate APIs (`move()`, `pos()`, `QCursor::pos()`) are not used for global hit-testing or attach decisions. Attach operations rely on local Qt Drag-and-Drop (DnD) target detection between visible windows. `startSystemMove()` is used strictly for moving window shells. Tab favicon state is preserved across transfers in `TabRecord`.
