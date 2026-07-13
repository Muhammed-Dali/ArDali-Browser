# Security Policy

## Supported versions

Security fixes are provided for the latest published release. Older releases may not receive patches. Check the [latest GitHub release](https://github.com/Muhammed-Dali/ArDali-WebMedia/releases/latest) before reporting a problem.

## Reporting a vulnerability

Do not open a public issue, discussion, or pull request for a suspected vulnerability.

Use [GitHub private vulnerability reporting](https://github.com/Muhammed-Dali/ArDali-WebMedia/security/advisories/new) when available. If it is unavailable, email `support@ardali.app` with the subject `ArDali security report`.

Include:

- the affected version and package type;
- operating system and architecture;
- the affected component and impact;
- minimal reproduction steps or a proof of concept;
- relevant logs with credentials, cookies, tokens, and personal data removed;
- any suggested mitigation, if known.

You should receive an acknowledgement within 7 days. Triage, remediation, and disclosure timelines depend on severity and complexity. Please allow a reasonable remediation period before public disclosure.

## Scope

In scope are vulnerabilities in ArDali-owned source code, build/release workflows, update behavior, privileged IPC surfaces, local file handling, and bundled project assets.

Third-party websites, service availability, social engineering, denial-of-service testing against public infrastructure, and vulnerabilities that require an already-compromised operating system are generally out of scope. Vulnerabilities in a third-party dependency may still be reported when you can show a concrete impact on ArDali.

## Safe-harbor expectations

Act in good faith, avoid privacy violations and service disruption, access only data you own or are authorized to use, and do not retain or disclose sensitive data. The project will not pursue action against good-faith research that follows this policy.

## Release integrity

Published releases include SHA-256 checksums and may include a detached GPG signature. Verification instructions are in [docs/RELEASES.md](docs/RELEASES.md).
