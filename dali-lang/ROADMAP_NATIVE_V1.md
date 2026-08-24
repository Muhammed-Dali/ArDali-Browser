# DALI Native Evolution Roadmap (v1)

This roadmap turns DALI into a production-grade language/runtime pipeline with predictable realtime behavior.

## Phase 1: Foundation (Current Sprint)

- [x] IR v2 metadata expansion (typing, capabilities, realtime profile)
- [x] Golden regression pipeline
- [x] Offline performance benchmark pipeline
- [ ] WASM runtime bridge (real DSP export path, not only fallback)
- [ ] Initial `dali build/test/bench` command aliases

## Phase 2: WASM Realtime Path

- [ ] Add a dedicated WASM DSP ABI:
  - `init(sampleRate, blockSize)`
  - `set_param(index, value)`
  - `process_block(inputPtr, outputPtr, frames)`
- [ ] Generate AudioWorklet adapter from compiler output
- [ ] Enforce `requireWasm=true` option for strict realtime profiles
- [ ] Add Web benchmark harness:
  - underrun count
  - average block processing time
  - p95 block time

## Phase 3: Native AOT (PoC -> Product)

- [ ] Introduce native backend target:
  - `--target native-poc` (first)
  - `--target native` (stable)
- [ ] Lower IR v2 into backend IR suitable for Cranelift/LLVM
- [ ] Generate `.so/.dll/.dylib` for a fixed preset family (bass enhancer first)
- [ ] Add host FFI API:
  - C ABI exports
  - Rust wrapper crate
  - C++ minimal wrapper

## Phase 4: Type System and Safety

- [ ] Full unit-aware type checking (frequency, time, gain_db, ratio)
- [ ] Compile-time failure for invalid capability and latency contracts
- [ ] Hardened profile:
  - no unsafe task source
  - bounded graph complexity
  - deterministic memory profile output

## Phase 5: Ecosystem

- [ ] `dali.toml` manifest
- [ ] dependency lockfile (`dali.lock`)
- [ ] formatter (`dali fmt`)
- [ ] language server (`dali lsp`)
- [ ] publish pipeline for VS Code extension + npm package

## Acceptance Gates

Each phase is accepted only if all gates pass:

1. Security suite passes (`npm run -s dali:test:security`)
2. Golden regression passes (`npm run -s dali:test:golden`)
3. Perf benchmark has no >20% regression in p95 compile metrics
4. New features include at least one example preset and one validation test
