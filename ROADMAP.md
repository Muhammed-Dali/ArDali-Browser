# Roadmap

This roadmap describes maintenance priorities, not delivery promises. Stability, compatibility, and preservation of hardware-aware optimizations take precedence over feature volume.

## Now: release confidence and project consistency

- Keep version, repository, license, Electron, and package metadata consistent.
- Make required CI checks reliable and least-privileged.
- Document supported packages, platforms, and verification steps.
- Triage security tooling results and dependency updates.
- Remove generated build output from future source commits after a reviewed cleanup plan.

## Next: contributor and user experience

- Establish reproducible smoke tests for core playback and native audio paths.
- Improve issue triage labels, support diagnostics, and translation contribution flow.
- Publish compatibility expectations for distributions, Wayland/X11, codecs, and GPU drivers.
- Improve release notes with upgrade notes, known issues, and checksums.

## Later: community growth

- Evaluate additional distribution channels only when their maintenance and sandbox requirements are sustainable.
- Add contributor-focused architecture notes for high-risk modules.
- Expand accessibility and keyboard-navigation review without changing established workflows unexpectedly.
- Maintain a public list of beginner-friendly documentation, translation, and packaging issues.

## Non-goals without prior design review

- Large rewrites or framework migrations
- Replacement of the audio engine or hardware-specific optimizations
- Broad refactors mixed into feature work
- New runtime dependencies without a clear security and maintenance case

Suggestions are welcome through a feature request, with the user problem, expected benefit, risks, and validation approach clearly described.
