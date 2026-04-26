# Third-Party Binary Provenance

This repository tracks a small set of native shared libraries (`.so` / `.so.*`) required for runtime and packaging.

To avoid "random binary" risk, every tracked shared object is pinned by SHA-256 in:

- `third_party/binary-manifest.json`

Integrity check command:

```bash
npm run verify:binary:manifest
```

The check verifies:

1. Every tracked `.so` file is listed in the manifest.
2. No stale entries exist in the manifest.
3. SHA-256 of each file matches the pinned value.

## Provenance Groups

- `libs/linux/*` and `libs/bass/libs/*`: Un4seen BASS Linux runtime and architecture builds.
- `Aurivo-Pulse/libs/libchromaprint.so*`: vendored Aurivo-Pulse/SongRec lineage chromaprint shared object set.
- `packaging/flatpak/runtime-libs/*`: Flatpak/runtime compatibility libraries used by packaging flow.

## Reviewer Notes

- The project intentionally includes these binaries so CI/release builds can run without fetching opaque artifacts during packaging.
- Any binary update must include a matching manifest hash update in the same commit.
- If a new `.so` is added to git without manifest entry, CI/local verification will fail.
