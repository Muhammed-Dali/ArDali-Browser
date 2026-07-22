# Dali Language

Dali is ArDali's small domain-specific language for describing validated audio-processing presets and runtime graphs. Source files use the `.dali` or `.dl` extension.

The language exists to keep audio intent readable, validate parameters before execution, and generate consistent processing code for more than one web-audio runtime target.

## Small example

```dali
preset "Clean Boost" {
  input web;
  output speakers;

  chain {
    preamp gain=2db;
    limiter ceiling=-1db;
  }
}
```

Compile it with the CLI:

```bash
npx dali clean-boost.dali clean-boost.generated.js --hardened
```

## Toolchain

| Component | Purpose |
| --- | --- |
| Parser | Reads `.dali` and `.dl` source and produces validated structures |
| Validator | Enforces allowed targets, effects, parameters, units, numeric ranges, and complexity limits |
| Compiler | Generates Web Audio JavaScript, AudioWorklet output, or the available WASM-oriented target |
| Runtime guards | Check AudioNode types, audio-context boundaries, and bounded connect/disconnect behavior |
| CLI | Compiles, lints, signs, verifies, emits IR, and runs supported task-runtime modes |
| VS Code extension | Adds syntax highlighting, snippets, completion, diagnostics, and task integration |

## Supported audio vocabulary

The baseline compiler supports `preamp`, `low_shelf`, `peaking`, `high_shelf`, `compressor`, and `limiter`. The `.dl` v2 syntax also supports structured `engine`, `chain`, `quality`, and `eq32` blocks used by ArDali's web audio references.

## Compiler and runtime targets

Examples of project commands:

```bash
# Compile the web references used by the application
npm run dali:compile:web

# Generate an AudioWorklet target
node dali-lang/src/cli.js input.dl output.worklet.js --backend audioworklet

# Generate the WASM-oriented target
node dali-lang/src/cli.js input.dl output.wasm.js --target wasm

# Lint and run security tests
npm run dali:test:security
```

Generated AudioWorklet modules expose an async graph builder. Hardened compilation enables stricter capability and validation requirements.

## Validation and safety

Dali uses deny-by-default capability policy and validates:

- input and output targets;
- allowed effects and parameter names;
- numeric ranges and units such as `hz`, `db`, and `ms`;
- source size, line count, effect count, and other complexity limits;
- runtime graph connections and audio-context ownership;
- optional Ed25519 signatures for preset provenance.

These controls reduce the risk of treating preset text as unrestricted executable code. They do not replace review of generated output and runtime integrations.

## VS Code extension

Install editor support from the npm package:

```bash
npm install ardali-dali-lang
npx dali setup
```

The bundled extension is located at `dali-lang/editors/vscode/` and provides syntax highlighting for `.dali` and `.dl`, snippets, completion, diagnostics, and ready-made VS Code tasks.

## Package and source

- Package: `ardali-dali-lang`
- CLI entry: `dali-lang/src/cli.js`
- Capability policy: `dali-lang/spec/capability-policy.json`
- Examples: `dali-lang/examples/`
- Complete package guide: [`dali-lang/README.md`](../dali-lang/README.md)
- Extension guide: [`dali-lang/editors/vscode/README.md`](../dali-lang/editors/vscode/README.md)

See [Audio Engine](AUDIO_ENGINE.md) for how generated graphs participate in web playback.
