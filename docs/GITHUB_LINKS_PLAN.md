# Optional in-app GitHub links: safe implementation plan

No application code was changed as part of this plan.

## Recommended placement

Add one compact “Community” section to the existing About or Help surface, not persistent toolbar buttons. Offer:

- **Star on GitHub** → repository home;
- **Report a bug** → bug issue form;
- **Request a feature** → feature issue form.

Keep the section optional and non-blocking. Do not display repeated prompts, startup dialogs, notifications, telemetry, or rewards for starring.

## Security design

Renderer content must not call arbitrary external URLs. Define the three constant HTTPS URLs in the trusted main process, expose a narrow action such as `community:openLink` with an enum (`repository`, `bug`, `feature`), validate the IPC sender using the project’s existing policy, and open only the mapped URL with Electron `shell.openExternal`.

Do not accept a URL from renderer input. Do not use a webview, disable navigation security, request new permissions, or add a dependency.

## Suggested URLs

- `https://github.com/Muhammed-Dali/ArDali-WebMedia`
- `https://github.com/Muhammed-Dali/ArDali-WebMedia/issues/new?template=bug_report.yml`
- `https://github.com/Muhammed-Dali/ArDali-WebMedia/issues/new?template=feature_request.yml`

## Validation before merge

1. Confirm each action opens only its expected HTTPS URL in the system browser.
2. Send invalid enum and unauthorized-sender IPC calls; both must be rejected.
3. Confirm offline/error behavior is silent and does not block the UI.
4. Test About/Help layout in all supported languages and narrow window sizes.
5. Confirm no startup, playback, audio, webview, or performance path changed.

This is a small code change but touches a privileged boundary; implement it in a separate reviewed pull request.
