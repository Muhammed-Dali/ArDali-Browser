# Step 4 — native tab-strip input

The tab strip uses Qt native pointer events only. It does not use HTML5
drag-and-drop or a `dataTransfer` payload.

Implemented behaviour:

- `QTabBar` native horizontal reorder, synchronized with the page stack and
  `TabManager` order.
- Mouse wheel and Shift+wheel move the horizontal tab strip.
- A drag held in either 32 px tab-strip edge zone starts 16 ms auto-scroll.
- A downward drag of at least 72 px, with vertical movement larger than
  horizontal movement, requests detach from the main browser window.

Manual checks are required because a synthetic unit test cannot faithfully
reproduce desktop pointer capture and the Linux window manager's drag loop.
