# Contributing to ArDali WebMedia

Thank you for helping improve ArDali WebMedia. Stability is the project's first priority: keep changes focused, preserve existing behavior unless a change is explicitly agreed, and avoid unrelated refactoring.

## Before you start

- Search existing issues and pull requests.
- Use an issue for bugs and feature proposals. Security vulnerabilities must follow [SECURITY.md](SECURITY.md).
- For large UI, architecture, dependency, packaging, or performance changes, discuss the proposal before implementation.
- Do not modify hardware-specific or performance-sensitive paths without measurements and maintainer agreement.

## Development setup

The project combines Electron, Node.js, native C++ audio code, and a projectM visualizer. See [docs/BUILDING.md](docs/BUILDING.md) for complete prerequisites.

```bash
git clone https://github.com/Muhammed-Dali/ArDali-WebMedia.git
cd ArDali-WebMedia
npm ci
npm --prefix native ci
npm start
```

Use `npm ci`, not `npm install`, when validating a pull request so the committed lockfiles remain authoritative.

## Making a change

1. Create a focused branch such as `fix/player-resume` or `docs/packaging`.
2. Match the style and structure of the code you touch.
3. Keep generated files, build directories, logs, credentials, and editor state out of commits.
4. Add or update tests when practical; otherwise provide exact manual verification steps.
5. Update user-facing documentation for observable changes.

Avoid introducing a dependency when the existing platform or project utilities can solve the problem safely. Any necessary dependency must include its purpose, license, maintenance status, and bundle-size/security impact in the pull request.

## Validation

Run checks relevant to the changed area:

```bash
npm run verify:i18n
npm run verify:binary:manifest
npm run native:audio:smoke
```

For release-impacting Linux work, follow [BUILD-TEST.md](BUILD-TEST.md). Native, packaging, and UI changes may require additional platform-specific validation.

## Pull requests

A good pull request:

- solves one clearly described problem;
- links its issue when one exists;
- explains user-visible behavior before and after;
- lists commands and manual scenarios tested;
- includes screenshots or recordings for UI changes;
- calls out packaging, security, performance, localization, and compatibility effects;
- contains no unrelated formatting or refactoring.

Maintainers may ask for a smaller scope when a change is difficult to review safely. By contributing, you agree that your contribution is licensed under the repository's [GPL-3.0 license](LICENSE).

## Translations

Locale files live in `locales/`. Preserve keys and placeholders, use valid JSON, and run `npm run verify:i18n`. Note the language and reviewer fluency in the pull request.

## Community standards

Be respectful and constructive. Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).
