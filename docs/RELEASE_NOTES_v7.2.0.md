# ArDali Browser 7.2.0

Released on 21 September 2026.

ArDali Browser 7.2.0 strengthens local credential security, improves translation
and browser interaction reliability, and makes the native codebase easier to
maintain and contribute to.

## Security and privacy

- Added Linux Secret Service-backed device keyring integration for the encrypted
  credential vault, with safe migration and fallback behavior.
- Hardened autofill tokens, origin checks, save prompts, private-profile isolation,
  and sensitive-memory cleanup.

## Browser experience

- Added the persistent **ArDali Bağlantılı** tab style as the new-profile default
  and refined tab geometry, dragging, loading indicators, toolbar icons, keyboard
  shortcuts, and Reload/Stop feedback.
- Expanded New Tab search and card controls and fixed secure custom-background
  upload, preview, replacement, removal, restart persistence, and cross-tab updates.
- Improved page translation lifecycle, provider handling, language selection, and
  restoration of translated and dynamically added content.
- Prevented blocker rules and scriptlets from interrupting normal YouTube playback
  while retaining explicit video-ad stream blocking.
- Refined settings, downloads, local media playback, audio effects, and Pulse song
  recognition, and corrected session and asynchronous Qt WebEngine lifetime edges.

## Development and quality

- Modularized browser-window and settings code and expanded contributor,
  architecture, build, testing, debugging, and security documentation.
- Expanded deterministic regression coverage across security, translation, blocker,
  media, audio, tab, settings, omnibox, and internal-page behavior.

## Platform status

Linux x86_64 remains the verified build, test, packaging, and release platform.
The portable archive ships as
`ardali-browser-7.2.0-linux-x86_64.tar.zst`.
