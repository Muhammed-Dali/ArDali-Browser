# DaliNira Browser 7.2.1

Released on 23 September 2026.

DaliNira Browser 7.2.1 improves media page resolution and download handling reliability, resolves search suggestion behavior, fixes false-positive content protection triggers in the download manager, and adds robust regression coverage across supported media platforms.

## Media and Downloads

- Enhanced TikTok media page URL resolution to reliably detect and extract video and photo/slideshow media items from modern DOM structures, rehydration state, and direct media candidate links.
- Added platform feed URL protection (`isGenericPlatformFeedUrl`) across browser UI and download manager to suppress single-media download suggestions and auto-analysis triggers when users browse root, explore, or feed pages on supported platforms.
- Fixed an issue where Adult Content Protection could erroneously flag legitimate files in the Download Manager.

## Search and New Tab

- Fixed search suggestion queries and New Tab omnibox search interaction to ensure smooth suggestion retrieval and navigation.

## Quality and Verification

- Expanded test coverage with dedicated test cases for modern TikTok extraction scenarios, platform feed detection, adult content protection verification, and full-suite integration tests (50/50 tests passing).

## Platform Status

Linux x86_64 remains the verified build, test, packaging, and release platform.
The portable archive ships as
`dalinira-browser-7.2.1-linux-x86_64.tar.zst`.
