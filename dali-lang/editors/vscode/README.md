# DALI VS Code Syntax

This folder contains a local VS Code language extension for `.dali` and `.dl` files.

## Features

- Syntax highlighting for core DSL keywords (`preset`, `engine`, `chain`, `quality`, etc.)
- Effect names (`preamp`, `eq32`, `peaking`, `limiter`, ...)
- Number + unit tokens (`hz`, `ms`, `db`, `x`)
- `//` comments, string literals, operators, and property keys
- Snippets: `dali-preset`, `dali-eq32`, `dali-limiter`, `dali-legacy-fx`
- Autocomplete for blocks, parameter keys, and common values
- Diagnostics: warns on unknown block/effect names in DALI files

## Use In Development Host (Fastest)

1. Open `dali-lang/editors/vscode` in VS Code.
2. Press `F5` to launch Extension Development Host.
3. Open your project in the new host window.
4. `.dali` and `.dl` files will use `DALI` language mode.

## Package As VSIX (Optional)

```bash
cd dali-lang/editors/vscode
npx @vscode/vsce package
```

Then in VS Code: `Extensions` -> `...` -> `Install from VSIX...` and pick the generated `.vsix` file.
