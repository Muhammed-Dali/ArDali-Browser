# ArDali Browser 7.0.1

Released on 11 September 2026.

ArDali Browser 7.0.1 is a reliability release for the Linux test and release
pipeline.

## Reliability fixes

- Hardened the Qt WebEngine JavaScript test helper against callbacks arriving
  after a local timeout, avoiding dangling stack references.
- Changed JavaScript polling to use one real deadline with bounded renderer
  probes instead of stacking independent inner timeouts.
- Corrected the new-tab suggestion selection retry flow so a transient first
  attempt does not terminate the test before later attempts run.
- Made the General Download Manager changed-resource resume scenario
  deterministic by keeping the fixture transfer in flight until pause is
  observed.
- Preserved strict download assertions for positive progress, the
  `Downloading → Paused → Queued → Completed` transition, resume acceptance,
  and byte-for-byte content replacement after an ETag change.

## Verification

- All 29 CTest targets pass in the local Linux Release validation suite.
- The General Download Manager integration test passes in three consecutive
  runs.

## Platform status

Linux x86_64 remains the verified build, test, packaging, and release platform.
The portable archive uses the existing `/usr` installation layout and ships as
`ardali-browser-7.0.1-linux-x86_64.tar.zst`.
