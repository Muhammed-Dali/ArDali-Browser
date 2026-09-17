# Password Manager Port Audit

Status: NOT READY — implementation work in progress.

## A. Legacy Password Manager Architecture

The Electron source of truth is `ArDali-WebMedia/modules/credential-vault.js`.
It stores a randomly generated data key encrypted with AES-256-GCM, wraps that
key using scrypt plus an OS `safeStorage` device secret, encrypts each record
with AES-256-GCM, and accepts only canonical HTTPS origins.  Renderer access is
through narrowly scoped IPC handlers in `main.js`; form collection runs in the
guest preload and requests a user-approved save/update prompt.

## B. New Qt Password Manager Architecture

`CredentialVault` is owned by `BrowserProfileService`; it is the sole vault
implementation. `PasswordManagerPage` is a native internal tab. Web content is
not given a QObject, QWebChannel, or JavaScript API. `BrowserWindow` owns the
one-time user-approved fill and save/update prompt flow.

## B1. Legacy Save-Pipeline Evidence

The legacy implementation does **not** wait for a server-confirmed successful
login. `webviewAdblockPreload.js:1118-1200` captures a candidate on a form
submit, a login-control pointer press, or Enter. It requires a visible password
field in a visible HTML form whose resolved action is HTTPS and has the current
origin. The username is the last visible `email`, `text`, or `tel` field whose
autocomplete/name/id indicates user, email, login, or identifier.

On username input, `stageUsername` sends only the username to native code.
`main.js:9945-9951` stores it under a guest-frame-and-origin key for five
minutes. A later password document can use it only with that same key; a
cross-origin flow cannot consume it. `main.js:10001-10030` validates the
origin against the sender frame, rejects disabled or locked vaults, suppresses
concurrent prompts, and opens the native `dialog.showMessageBox` immediately.
Its exact buttons are `Kaydet`/`Şimdi değil`, or `Güncelle`/`Şimdi değil` for
an existing `(origin, username)` record. It has no “never for this site” state.

Consequently a wrong password can also produce a prompt in the legacy product;
the save signal is a candidate, not proof of authentication. The Qt port keeps
the candidate only in native memory for 45 seconds and defers its prompt until
the same tab/origin observes a successful main-frame navigation to a different
URL, or a SPA signal where the visible password field disappears after the
candidate. This is an intentional safety correction required by the current
acceptance criteria, rather than a claim of legacy parity. A vault that has
not been created is locked, so legacy suppresses the candidate rather than
retaining a plaintext password for later setup. Records carry origin, username,
and password only; `password-manager.js` renders the origin text and does not
resolve or persist a credential favicon/platform icon.

The Qt manager captures the current browser-tab favicon at an approved
login save and stores its small PNG representation inside that same encrypted
credential record. The manager renders this real site icon after restart; a
recognizable platform/generic-host badge remains only as a fallback when no
favicon was available. No separate unencrypted origin-to-icon index is kept.

## C. Parity Matrix

| Capability | Legacy | Qt state |
| --- | --- | --- |
| Single encrypted vault | Yes | Complete |
| Locked startup / manual lock | Yes | Complete |
| Auto-lock | Configurable | Complete: 1/5/15/30 minutes |
| Exact HTTPS origin policy | Yes | Complete |
| Save/update prompt | Yes | Complete, top-level form only |
| Password manager internal tab | Yes | Complete |
| Toolbar/settings entry | Yes | Complete |
| Generator | Yes | Complete, native CSPRNG UI |
| Master-password change | Yes | Complete |
| OS safe-storage device secret | Yes | Missing |
| Import/export | No user-default export | Not implemented |

## D. Toolbar/Icon Parity

The Qt toolbar uses the existing project password icon and opens or activates
one `ardali://passwords` tab. TabManager rejects a duplicate internal id. The
legacy app has `icons/app/ardali_password_manager_512.png`, but no independent
toolbar key-vector asset suitable for direct reuse was found; the Qt browser's
existing `browser-icons/password.svg` is retained to match its chrome.

## E. Vault/Crypto Design

Schema version 2 uses PBKDF2-HMAC-SHA256 (600,000 iterations), a random 16-byte
salt, AES-256-GCM wrapping of a random 32-byte data key, and AES-256-GCM per
record with a random 12-byte nonce. A record id is authenticated as AAD. Tags
are verified before JSON is parsed. The data key is cleared on lock.

## F. Master Password Flow

The master password is never persisted, logged, passed on the command line, or
stored in settings. Create, unlock, and master-password change are invoked by
the native page. The page runs expensive calls on a worker task and displays a
busy state. A recursive vault mutex serializes worker, UI, and idle-timer
access to sensitive vault state. Failed unlocks receive exponential bounded
delay.

Before a first vault can be created, the native page presents the legacy-style
experimental-feature consent card. Both the notice acknowledgement and the
local encrypted-storage acknowledgement are required. The creation card then
validates the master password live: 12+ characters, lowercase, uppercase,
number, symbol, and confirmation match. The create button remains disabled
until every rule is met. Once created, the empty-vault page exposes search,
masked-username visibility control, add, manual lock, auto-lock, disable,
master-change, and destructive reset controls. Reset deletes the encrypted
vault and backup after explicit confirmation.

## G. Credential Storage

`credential-vault/vault-v2.json` contains only KDF parameters, wrapped key,
and encrypted records. Directory and vault permissions are owner-only; writes
use `QSaveFile` and keep an encrypted `.bak` copy. A corrupt primary vault can
only fall back to a schema-validated non-symlink backup.

## H. Autofill and Save Flow

Fill is explicit: the user chooses “Bu sayfayı kayıtlı girişle doldur”. The
browser checks vault unlock state and exact canonical HTTPS origin, chooses an
account if ambiguous, and writes only visible enabled login fields in the
top-level document. Candidate collection uses an ApplicationWorld script for
trusted form submission, submit-control clicks, and Enter submissions. It
stages a username only in native memory for up to five minutes and only for the
same tab and canonical HTTPS origin, allowing username-first login flows. It
rejects subframes, validates same-origin HTTPS form actions and the active
native URL. A password candidate is then kept only in native memory for 45
seconds and prompts only after same-origin successful-navigation or SPA
password-disappearance evidence. The native prompt remains bound to the
origin and originating tab before calling save/update.

When an unlocked vault contains a credential for the loaded origin, the native
browser injects the legacy-style yellow key (`🔑`) button beside a safe visible
password field. The key is also available while an existing vault is locked,
so users can unlock-and-fill from the field without visiting the manager tab.
The page receives neither account metadata nor a vault API. Its click must
carry a fresh, per-tab/per-origin random token known only to the isolated
ApplicationWorld script; native code validates that token and then runs the
same account-selection/fill flow as the browser menu. A locked vault requires
native master-password verification; its decrypted key is never retained by
the page.

For HTTPS registration forms, a separate isolated `✦` suggestion button is
shown only for safe visible `new-password` fields or a password/confirmation
pair. Its native request carries a fresh tab-and-origin token. Each accepted
click uses `QRandomGenerator::system()` to generate a new 24-character value
with upper/lowercase letters, digits, and symbols, then fills every detected
new-password/confirmation field with that same ephemeral value. It is not
saved until the normal post-registration save approval is accepted.

## I. Origin/Phishing and JS Boundary Protections

Origin comparison is scheme + canonical host + non-default port equality. No
substring, eTLD approximation, HTTP downgrade, opaque origin, file/data URL,
or iframe fill is allowed. Page code has no vault list/read/key bridge. Page
scripts can observe values after browser fills the DOM, which is an inherent
web autofill limitation; user gesture and exact-origin checks constrain it.

## J. Threat Model Results

| Threat | Control | Remaining risk |
| --- | --- | --- |
| Lookalike site | Exact canonical HTTPS origin | User can manually save a bad origin |
| Cross-origin iframe | No subframe capture/fill | None in current fill path |
| Stolen vault file | PBKDF2 + AES-GCM | PBKDF2 is weaker than Argon2id/scrypt |
| Corrupt vault | Bounds checks, GCM tag, backup | Backup can be older |
| Local symlink | Reject symlink vault/backup | Parent directory race needs OS-level hardening |
| Clipboard snooping | Explicit copy, conditional 30-second clear | OS clipboard is globally observable |
| Brute force | Bounded exponential delay | Offline PBKDF2 attacks remain possible |
| Web API abuse | No bridge/QWebChannel | Console-based candidate signal is user-prompt gated |

## K. Automated Evidence

`browser-credential-vault-test` covers locked startup, weak/wrong/correct
master handling, changed master handling, encrypted-at-rest strings, origin
mismatch, HTTP denial, record update/delete/persistence, nonce refresh,
tampered GCM tag fail-closed, restart locking, owner-only permissions, and
vault reset removal.

`browser-password-manager-page-test` runs the native widget offscreen and
checks the two mandatory consent checkboxes, disabled/enabled experimental
action, every live master-password rule, confirmation gating, and the empty
vault's search, visibility, add, lock, auto-lock, disable, master-change, and
reset controls.

The full CTest suite has pre-existing Chromium sandbox-host failures in this
environment. Those failures prevent a full runtime acceptance claim.

Latest `npm test`: 7/16 tests passed, including `browser-credential-vault-test`.
The other 9 failures terminate before test logic at Chromium
`sandbox_host_linux.cc` with `Operation not permitted`; they are not password
manager assertion failures, but still block the required end-to-end acceptance
result in this environment.

The WebEngine internal-tab test was retried with both
`QTWEBENGINE_DISABLE_SANDBOX=1` and `QTWEBENGINE_CHROMIUM_FLAGS=--no-sandbox`.
Both still terminate in `sandbox_host_linux.cc` before test setup, so neither
can prove the script-to-native console bridge in this container. The normal
native build and the vault test pass; a desktop runtime login remains the
required acceptance check.

## L. Release Verdict

High: OS secure-storage binding is incomplete.

Medium: import/export/restore and full WebEngine runtime coverage are missing.

Low: UI does not yet display recovery provenance prominently.

FINAL: NOT READY.
