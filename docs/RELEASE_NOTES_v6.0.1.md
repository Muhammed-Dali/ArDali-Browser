# ArDali Browser 6.0.1

Released on 24 August 2026.

ArDali Browser 6.0.1 is a maintenance release focused on release automation,
Arch Linux integration, and clear product documentation.

## Highlights

- Clarifies that ArDali Blocker is ArDali Browser's built-in advertising and
  tracker protection engine, implemented as part of the native browser.
- Keeps bundled third-party filter data, generated rulesets, scriptlets, and
  resources attributed separately in `browser/resources/adblock/NOTICE.txt`.
- Adds the `qt6-imageformats` runtime dependency needed for bundled WebP image
  support in Arch Linux packages.
- Runs GitHub browser tests under Xvfb and supports safe release workflow
  re-runs against an existing version tag.

## Platform status

Linux remains the verified build, test, packaging, and release platform. No
Windows binary is included until the Windows pipeline is independently
verified.

## License and third-party components

ArDali Browser remains licensed under GPL-3.0-only. Third-party filter and
ruleset resources retain their respective copyright and license notices in
`browser/resources/adblock/NOTICE.txt`.
