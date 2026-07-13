# Locale Coverage

Updated: 2026-07-13

This report summarizes the active UI locale coverage for the main `ArDali Medya Player` application.

## Active i18n stack

- Runtime loader: [`modules/i18n.js`](./modules/i18n.js)
- Locale source files: [`locales/*.json`](./locales)
- Electron bridge: [`main.js`](./main.js)
- Main UI entrypoint: [`index.html`](./index.html)

Removed legacy files:

- `locales/i18n.js`
- `locales/i18n-init.js`

These were not part of the active main-app loading path.

## What the numbers mean

- `used keys`: total i18n keys currently referenced by the main UI
- `raw present`: keys found directly inside that locale JSON file
- `raw missing`: keys not present directly in that locale JSON file
- `effective missing`: keys still unresolved after:
  - locale JSON lookup
  - `en-US.json` fallback
  - runtime overrides inside `modules/i18n.js`
- `override`: whether that language also receives runtime UI overrides in `modules/i18n.js`

## Summary

- Total used keys: `1315`
- Supported locales checked: `22`
- Effective missing keys across all supported locales: `0`

That means:

- every supported language can be selected
- the UI remains translatable for every supported language
- no supported locale currently leaves referenced keys unresolved

## Coverage Table

| Locale | Raw Present | Raw Missing | Effective Missing | Override |
| --- | ---: | ---: | ---: | --- |
| `ar-SA` | 512 | 803 | 0 | yes |
| `bn-BD` | 264 | 1051 | 0 | yes |
| `de-DE` | 264 | 1051 | 0 | yes |
| `el-GR` | 264 | 1051 | 0 | yes |
| `en-US` | 935 | 380 | 0 | yes |
| `es-ES` | 258 | 1057 | 0 | yes |
| `fa-IR` | 264 | 1051 | 0 | yes |
| `fi-FI` | 264 | 1051 | 0 | yes |
| `fr-FR` | 258 | 1057 | 0 | yes |
| `hi-IN` | 264 | 1051 | 0 | yes |
| `hu-HU` | 264 | 1051 | 0 | yes |
| `it-IT` | 264 | 1051 | 0 | yes |
| `ja-JP` | 264 | 1051 | 0 | yes |
| `ne-NP` | 264 | 1051 | 0 | yes |
| `pl-PL` | 264 | 1051 | 0 | yes |
| `pt-BR` | 264 | 1051 | 0 | yes |
| `ru-RU` | 264 | 1051 | 0 | yes |
| `tr-TR` | 900 | 415 | 0 | yes |
| `uk-UA` | 264 | 1051 | 0 | yes |
| `vi-VN` | 264 | 1051 | 0 | yes |
| `zh-CN` | 250 | 1065 | 0 | yes |
| `zh-TW` | 250 | 1065 | 0 | yes |

## Interpretation

### Strong local coverage

These languages have dedicated runtime override coverage for the newer UI areas:

- `ar-SA`
- `bn-BD`
- `de-DE`
- `el-GR`
- `en-US`
- `es-ES`
- `fa-IR`
- `fi-FI`
- `fr-FR`
- `hi-IN`
- `hu-HU`
- `it-IT`
- `ja-JP`
- `ne-NP`
- `pl-PL`
- `pt-BR`
- `ru-RU`
- `tr-TR`
- `uk-UA`
- `vi-VN`
- `zh-CN`
- `zh-TW`

### JSON-extended coverage

These languages now include localized strings for the newer `Listen`, theme, and VPN/security areas directly in their JSON files:



## Notes

- `effective missing = 0` does not mean every string is deeply hand-localized across the entire app.
- It means the current UI keyset resolves cleanly for every supported language.
- Some languages still rely more on fallback and shared wording than others.

## Recommended next step

If desired, the next quality pass should focus on:

1. expanding native wording in locale JSON files beyond the current shared/fallback coverage
2. reviewing tone consistency for each language
3. testing long labels in RTL and CJK layouts
