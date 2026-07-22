# Audio Engine

ArDali uses separate but coordinated processing paths for local files and browser media. The goal is to expose consistent, real-time sound controls while respecting the different constraints of native playback and Chromium web audio.

## Native C++ Audio Engine

The native addon under `native/` hosts local audio playback and DSP outside the renderer. It uses BASS/BASS_FX runtime components and a C++ master DSP implementation.

Implemented capabilities include:

- float-sample local playback and output-device selection;
- 32-band equalization and parametric EQ controls;
- compressor, limiter, noise gate, and true-peak controls;
- bass enhancement, tone controls, stereo processing, and crossfeed;
- dynamic EQ, de-essing, excitation, echo, convolution, tape saturation, and bit-depth/dither processing;
- spectrum and level data for meters and visualization.

Renderer controls send validated parameters through IPC; the native module remains owned by the main process.

## Dali Web Audio Engine

Browser media cannot be treated as an ordinary local file. ArDali's Dali Web Audio path builds controlled Web Audio graphs for supported effects and synchronizes settings with the web playback scope.

The Dali toolchain validates `.dali` and `.dl` definitions before producing JavaScript, AudioWorklet, or WASM-oriented output. Generated graphs use guarded connection behavior and bounded effect parameters.

## Processing flow

```text
Local file ──→ Native decoder ──→ Native C++ DSP ──┐
                                                   ├─→ Output device
Web media ───→ Chromium capture ─→ Dali Web DSP ───┘
                                  │
                                  └─→ meters / spectrum / projectM feed
```

The exact route depends on the media source, selected effects, runtime capabilities, and output configuration.

## Real-time DSP

ArDali applies parameter changes while playback continues. Controls are rate-limited or batched where appropriate to avoid flooding IPC or rebuilding expensive graphs for every UI event. Effects can be enabled independently, while the master effects switch controls the processing chain as a whole.

## How this differs from standard browser audio

A normal webpage typically exposes only the controls chosen by the site. ArDali adds application-level processing around supported web playback: a 32-band EQ, dynamics, spatial tools, restoration effects, metering, and shared presets. Local media uses the native path rather than depending on a webpage's audio graph.

This does not bypass protected media rules or guarantee identical processing on every site. Browser security policy, media capture support, DRM, and platform audio behavior still apply.

## Performance model

- Native processing operates on float audio buffers in the C++ DSP path.
- Web effects use generated and guarded Web Audio graphs, with AudioWorklet support for relevant targets.
- UI meters and spectrum polling are scoped and throttled.
- Heavy panels are lazy-rendered, and animations pause when not needed.
- Settings include performance profiles for lower-powered systems.

## Related source and validation

| Area | Location or command |
| --- | --- |
| Native addon | `native/ardali_audio.cpp` |
| Native DSP | `native/ardali_dsp.cpp` |
| Dali compiler/runtime | `dali-lang/src/` |
| Dali examples | `dali-lang/examples/` |
| Native smoke test | `npm run native:audio:smoke` |
| Dali regression suite | `npm run dali:test:regression` |
| Dali security suite | `npm run dali:test:security` |

See [Dali Language](DALI_LANGUAGE.md), [Architecture](ARCHITECTURE.md), and [Building](BUILDING.md).
