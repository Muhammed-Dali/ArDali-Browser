# dali-lang 5-Phase Roadmap

This roadmap tracks the long-term evolution path we agreed on.

## Phase 1: Powerful Audio DSL (In Progress)
- Stabil grammar for `.dali/.dl`.
- Strong validation + security checks.
- Developer tooling (`compile`, `lint`, security tests).
- Better diagnostics and preset quality hints.

## Phase 2: Dual Runtime (Web + Native)
- `dali-runtime-web` (WebAudio path).
- `dali-runtime-native` (system/post-mix DSP path).
- Automatic fallback for DRM-restricted streams.

## Phase 3: Host Decoupling
- Reduce hard Electron coupling.
- Host adapter layer abstraction.
- First non-Electron host prototype (Chromium embed path).

## Phase 4: Language Expansion
- Stronger type model for DSP params.
- Module/import structure.
- Shared preset libraries and reusable blocks.

## Phase 5: General-Purpose Evolution (Long Term)
- Optional IR pipeline and optimizer stages.
- Broader runtime targets.
- Potential path from domain DSL to wider language capabilities.

