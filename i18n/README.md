# ArDali Browser i18n

This directory provides the centralized internationalization and localization catalogs for ArDali Browser.

## Architecture

Inspired by Helium's modular i18n structure, ArDali uses metadata-driven language configuration and JSON-based semantic translation catalogs.

```
i18n/
├── languages.json         # Language registry, locale codes, native names, and layout directions
├── translations/          # Per-locale semantic translation catalogs
│   ├── en.json            # English (Base / Fallback catalog)
│   ├── tr.json            # Türkçe (Turkish catalog)
│   └── ar.json            # العربية (Arabic catalog with RTL support)
└── README.md              # Documentation
```

## Supported Languages

1. **English (`en`)**: Direction `ltr`, base/fallback language.
2. **Türkçe (`tr`)**: Direction `ltr`.
3. **العربية (`ar`)**: Direction `rtl`, application layout automatically switches to `Qt::RightToLeft`.

## How It Works

- **Configuration**: `languages.json` defines all supported locales and layout directions (`ltr` / `rtl`).
- **Runtime Manager**: `LanguageManager` (`ardali::i18n::LanguageManager`) loads catalogs into an in-memory hash cache, manages user preferences (`i18n/language` in `QSettings`), detects system language via `QLocale::system()`, and performs fallback resolution (`Active -> English -> Key`).
- **Runtime Switch**: Changing language via `LanguageManager::setLanguagePreference` immediately applies application layout direction and emits `languageChanged()`, allowing UI components to refresh dynamically without restarting the application.
- **Resource Bundling**: Catalogs are embedded directly into the binary via Qt resources (`:/i18n/...`), guaranteeing zero external path dependencies in packaged builds.
