# Codex Extension Principles

- Keep setup logic headless in `CodexSetup`; SwiftUI only renders state, binds controls, and triggers headless actions.
- Do not use global singletons for business logic. Pass state through runtime, service, and session boundaries.
- Every setup step must have a clear state, a clear action, and a recoverable error path.
- Long-running setup actions expose in-progress state; UI must show that state with disabled controls and a spinner.
- App mutation requires explicit App Management permission and Codex must be fully quit before patch, restore, repair, or uninstall.
- Prefer CLI coverage for setup flows before wiring or debugging SwiftUI.
- Keep UI minimal: show only current setup facts, the next useful action, and any error needed to recover.
- Test headless parsing/planning/action-selection logic without the app UI.
