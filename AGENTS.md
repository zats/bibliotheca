# Bibliotheca Principles

- Keep setup logic headless in `BibliothecaSetup`; SwiftUI only renders state, binds controls, and triggers headless actions.
- Do not use global singletons for business logic. Pass state through runtime, service, and session boundaries.
- Every setup step must have a clear state, a clear action, and a recoverable error path.
- Long-running setup actions expose in-progress state; UI must show that state with disabled controls and a spinner.
- App mutation requires explicit App Management permission and Codex must be fully quit before patch, restore, repair, or uninstall.
- App mutation must be idempotent. Re-running a setup action after interruption should either no-op from current disk state, clean stale staging, or complete the same intended mutation.
- The headless setup state machine must be idempotent at every transition: every action starts by re-inspecting current disk/process/permission state, performs only the next valid mutation, and a second run after success must return a no-op state.
- Restore must validate downloads before touching `Codex.app`, stage clean apps beside the target, and use a single replace operation for the app bundle.
- Rollback/restore means a known clean `Codex.app`: remove our provisioning receipt before mutation, never auto-repatch during restore, validate the resulting app is unpatched, and keep extension user data unless uninstall is explicitly requested.
- Interrupted restore downloads must leave the installed Codex unchanged; stale temp or staging data must be safe to delete on the next run.
- Use mature download tooling such as `aria2c` for accelerated multi-connection downloads when available; keep progress sourced from headless restore state.
- Prefer CLI coverage for setup flows before wiring or debugging SwiftUI.
- Keep UI minimal: show only current setup facts, the next useful action, and any error needed to recover.
- Test headless parsing/planning/action-selection logic without the app UI.
