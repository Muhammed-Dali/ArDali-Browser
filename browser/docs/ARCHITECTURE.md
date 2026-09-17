# ArDaliBrowser architecture — milestone 0

## Engine decision

The initial engine is **Chromium via Qt WebEngine** because its native Linux
development package is installed and it provides a native C++ Chromium host.
CEF remains a possible later embedder backend, but it is not currently part of
this build. Firefox/Gecko is not selected for the first host; its embedding
path is materially less practical for a new desktop application.

## The non-negotiable tab invariant

```text
Tab record -> one live Chromium browser/page instance -> one current native host window
```

Detach and attach change only the owner window/view. They must not create a
new page instance, issue navigation, or serialize/restore the page as a way of
moving it. Acceptance checks include JavaScript marker, history index, scroll
position, media time, and active download state.

## Native host boundary

Qt WebEngine's native API requires a systems-language host. The bootstrap host
is C++ because the public Qt/Chromium API and platform window handles are C++
APIs. This is intentionally a small audited boundary: window creation,
WebEngine callbacks, and DALI runtime FFI only.

DALI will be expanded in stages rather than pretending its current audio-only
grammar can replace C++ today:

1. A typed browser manifest grammar and validator.
2. Capability-gated browser state machine IR.
3. Native DALI runtime/FFI ABI for that IR.
4. An ahead-of-time native backend before reducing the C++ host further.

The DALI manifest cannot run arbitrary host code. A strict capability policy
limits it to tab/window operations, navigation policy, and declared browser
preferences.

## Detach / attach state machine

```text
MAIN_ACTIVE --drag threshold--> DETACHING --host transfer succeeds--> DETACHED
DETACHED --native window released over tab strip--> ATTACHING --> MAIN_ACTIVE
```

On every failed transition, the source owner and its page instance remain
unchanged. The main window never attaches a tab simply because it was clicked.
Wayland is treated separately: automatic attach is enabled only when global
coordinates and native move completion can be verified; otherwise the action
is not guessed.

## Next implementation gate

Do not add CEF download files or a fake browser window yet. First add and test
the `browser` DALI parser/validator in `dali-lang-repo`; then create the CEF
host only after its installed SDK version and platform toolchain are known.
