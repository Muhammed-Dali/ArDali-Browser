# Locale Coverage

Updated: 2026-05-14

This report summarizes the active UI locale coverage for the main `Aurivo Medya Player` application.

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

- Total used keys: `1273`
- Supported locales checked: `22`
- Effective missing keys across all supported locales: `0`

That means:

- every supported language can be selected
- the UI remains translatable for every supported language
- no supported locale currently leaves referenced keys unresolved

## Coverage Table

| Locale | Raw Present | Raw Missing | Effective Missing | Override |
| --- | ---: | ---: | ---: | --- |
| `ar-SA` | 437 | 836 | 0 | yes |
| `bn-BD` | 235 | 1038 | 0 | yes |
| `de-DE` | 235 | 1038 | 0 | yes |
| `el-GR` | 235 | 1038 | 0 | yes |
| `en-US` | 908 | 365 | 0 | yes |
| `es-ES` | 228 | 1045 | 0 | yes |
| `fa-IR` | 235 | 1038 | 0 | yes |
| `fi-FI` | 235 | 1038 | 0 | yes |
| `fr-FR` | 228 | 1045 | 0 | yes |
| `hi-IN` | 235 | 1038 | 0 | yes |
| `hu-HU` | 235 | 1038 | 0 | yes |
| `it-IT` | 235 | 1038 | 0 | yes |
| `ja-JP` | 235 | 1038 | 0 | yes |
| `ne-NP` | 235 | 1038 | 0 | yes |
| `pl-PL` | 235 | 1038 | 0 | yes |
| `pt-BR` | 235 | 1038 | 0 | yes |
| `ru-RU` | 235 | 1038 | 0 | yes |
| `tr-TR` | 872 | 401 | 0 | yes |
| `uk-UA` | 235 | 1038 | 0 | yes |
| `vi-VN` | 235 | 1038 | 0 | yes |
| `zh-CN` | 220 | 1053 | 0 | yes |
| `zh-TW` | 220 | 1053 | 0 | yes |

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
