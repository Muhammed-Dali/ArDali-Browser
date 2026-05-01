# Code Scanning Cleanup Notes

## Current Semgrep Policy

The Electron runtime intentionally starts local tools such as `ffmpeg`, `ffprobe`, PipeWire/PulseAudio helpers, and the visualizer process. Semgrep's generic `detect-child-process` rule reports every `child_process.spawn` use, so each alert must be reviewed instead of hiding the rule globally.

Runtime process usage must still follow these rules:

- Use `shell: false`.
- Use fixed argument arrays, not concatenated shell strings.
- Resolve binaries through existing allowlist helpers where possible.
- Never pass renderer-controlled command names directly to `spawn`.
- Prefer app-owned temp/output paths generated in the main process.
- If a finding is a false positive, suppress it only at the specific reviewed line with a short reason.

## Semgrep Scope

`.semgrepignore` excludes cloned subprojects, build outputs, vendored libraries, generated artifacts, local dev caches, and helper scripts that are not shipped as runtime application code.

This keeps alerts focused on the shipped Electron app surface:

- `main.js`
- `preload.js`
- `renderer.js`
- `modules/`
- app HTML/CSS/runtime assets

## GitHub Alert Cleanup Flow

1. Push the workflow and `.semgrepignore` changes to `main`.
2. Run the Semgrep workflow manually from GitHub Actions.
3. Wait for SARIF upload to complete.
4. GitHub should automatically close alerts no longer present in the latest scan.
5. Remaining alerts should be triaged by rule:
   - Fix real tainted path, command, or file access issues in code.
   - Suppress only documented false positives with a clear reason.
