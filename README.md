# ArDali Ecosystem Monorepo

Welcome to the **ArDali** monorepo repository. ArDali brings together a native C++20 desktop browser and the DALI audio/DSP domain-specific language toolchain into a unified, modular architecture.

---

## Architecture Overview

```
ArDali/
├── browser/         # C++20 + Qt6 + QtWebEngine Native Desktop Browser
├── dali-lang/       # DALI Language, Compiler, Security Validator & Audio DSP Toolchain
├── cmake/           # Shared CMake utilities
├── tools/           # Integration tests & build helpers
└── .vscode/         # Monorepo workspace configuration
```

### Responsibility Breakdown:
- **`browser/`**: Native desktop GUI, tab management, QtWebEngine integration, and runtime security policy enforcement (`BrowserPolicy` reading `browser_policy.json`). 
- **`dali-lang/`**: Independent DALI DSL compiler/toolchain, parsing `.dali`/`.dl` files, producing WebAudio JS, AudioWorklet JS, WASM modules, Native C DSP code, and compiling `browser.dali` manifests into `browser_policy.json` at build time.

---

## Build & Test Instructions

### Official Build Directory:
The official supported build directory is `browser/build`.

```bash
# 1. Navigate to browser module
cd browser

# 2. Configure with CMake (exports compile_commands.json automatically)
mkdir -p build && cd build
cmake -DCMAKE_EXPORT_COMPILE_COMMANDS=ON ..

# 3. Build executable
make -j$(nproc)

# 4. Run CTest suite (9/9 tests)
ctest --output-on-failure
```

### Running DALI Toolchain & Security Suite:

```bash
cd dali-lang

# Run security test suite (7/7 cases)
node scripts/dali-security-suite.js

# Run internal DALI manifest unit test
node scripts/dali-browser-manifest-test.js

# Compile sample DALI audio preset to WebAudio
node src/cli.js examples/web-bass-enhancer.dali /tmp/web-bass-enhancer.generated.js
```

### Running Monorepo Integration Test:

```bash
node tools/integration-manifest-test.js
```

---

## VS Code Setup

Opening `/home/muhammetdali/ArDali` as the single workspace root automatically configures:
- C/C++ IntelliSense via `browser/build/compile_commands.json`
- CMake Tools pointing to `${workspaceFolder}/browser`
- DALI `.dali` / `.dl` file associations
