# ArDali WebMedia v5.3.0

ArDali WebMedia v5.3.0 is a stable browser experience, performance, localization, and user-protection release.

## Highlights

- The new animated Smart Sidebar is now the default for new installations. Users can switch between the classic and radial styles in Settings, and the saved choice is restored on later launches.
- Smart Sidebar startup and animation work was reduced, and its edge handle now adapts to light and dark page backgrounds for reliable visibility.
- Link and image context menus now provide a more complete browser workflow, including opening in a new tab or window, copying and saving images, tab duplication, pinning, muting, restore, and close variants.
- Background tabs now finish their loading state correctly. Direct image tabs no longer reload into a blank page.
- Amazon and similar content-heavy marketplaces benefit from persistent cache use, lighter filtering, first-party resource fast paths, and fewer unnecessary navigation-state refreshes.
- New browser controls and external-protocol prompts follow the selected application language, including Turkish, English, and Arabic coverage.
- Built-in protection blocks known adult, malicious, phishing, and fraud domains with a clear warning page.
- Trusted system VPN connections are no longer blocked. Web traffic follows the operating system VPN route and resulting location while WebRTC privacy controls remain available.
- Electron, build workflows, and release metadata are aligned on Electron 40.8.5.

## Packaging

The tagged release workflow builds Linux and Windows artifacts. Linux output includes AppImage, DEB, and RPM packages.

## Notes

The local protection lists complement, but do not replace, operating-system security updates, DNS filtering, or careful browsing. Site classifications can change over time.
