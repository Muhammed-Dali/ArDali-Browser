# Step 3 — authoritative tab model

`TabManager` is the browser host's single source of truth for a live browser
tab. A `TabRecord` has a stable UUID and tracks exactly one `QWebEngineView`,
its one `QWebEnginePage`, owner native window, title, URL, active state,
detached state, and order.

## Invariants

- One live page belongs to exactly one tab record.
- A record's page must be the page of its current live view.
- Every record has one owner native window.
- A native window has at most one active record.
- Detach/attach changes the owner record; it does not create a new page.

`ardali-browser-tab-manager-test` covers owner transfer, active state,
detached state, ordering, and invariant validation without navigation.
