# ArDali Browser 7.1.1

Released on 13 September 2026.

ArDali Browser 7.1.1 is a Linux packaging reliability update that restores all
New Tab artwork and controls in system-installed builds.

## New Tab asset fixes

- Corrected the installed-package path from the application under
  `/usr/lib/ardali-browser` to its assets under `/usr/share/ardali-browser`.
- Restored the ArDali logo, search box artwork, search-engine icons,
  customization controls, and built-in background preview.
- Added embedded application-resource fallbacks so these assets remain visible
  even if an external package path is incomplete.

## Regression coverage

- Added explicit coverage for system-installed, portable, and build-tree asset
  layouts.
- The release pipeline builds and tests the Linux x86_64 package before
  publication.

## Platform status

Linux x86_64 remains the verified build, test, packaging, and release platform.
The portable archive ships as
`ardali-browser-7.1.1-linux-x86_64.tar.zst`.
