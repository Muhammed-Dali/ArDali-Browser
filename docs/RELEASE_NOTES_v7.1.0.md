# ArDali Browser 7.1.0

Released on 13 September 2026.

ArDali Browser 7.1.0 improves the New Tab search experience and strengthens
the reliability of the Linux integration test suite.

## New Tab and search improvements

- Set DuckDuckGo as the default search engine.
- Added custom search history to the New Tab experience.
- Added quick search-engine switching.
- Added privacy metrics to the New Tab page.

## Reliability improvements

- Hardened password autofill integration tests across supported Linux CI
  distributions, including Arch Linux.
- Improved New Tab integration test reliability on Ubuntu, Debian, Fedora, and
  Arch Linux.
- Preserved compatibility with both DuckDuckGo and Google search destinations
  in the automated New Tab checks.

## Verification

- The Linux Release workflow completed its build and all 29 CTest targets
  before the original publication attempt reached the release-notes step.
- The Linux CI workflow passed for the 7.1.0 release commit.

## Platform status

Linux x86_64 remains the verified build, test, packaging, and release platform.
The portable archive uses the existing `/usr` installation layout and ships as
`ardali-browser-7.1.0-linux-x86_64.tar.zst`.
