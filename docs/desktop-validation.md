# Desktop shell validation

Milestone: Phase 1.1, desktop room and local task/profile persistence.

## Environment

- Date: 2026-10-08.
- Physical development machine: macOS 26.6.2 (25G83), ARM64.
- Application: Scully 0.2.0, uncommitted clean-rebuild working tree.
- Electron 44.7.0; development Node.js 22.22.2; npm 10.9.7.

## Checks

Result: passed on the environment above. Unit/component/storage suite: 13 tests across 3 files. Development and packaged real-window smoke tests passed. Full npm dependency audit reported zero known vulnerabilities after updating the test runner. This is not a guarantee of vulnerability-free software.

- TypeScript check and Vite/esbuild production build.
- Contract validation, honest preview states, navigation and SQLite restart persistence tests.
- Real Electron smoke test: startup, task creation, profile editing, full profile, restart persistence, invalid IPC payload rejection and renderer Node isolation.
- Visual inspection of the desktop room and profile screenshots.
- Unsigned macOS ARM64 bundle and packaged launch check.
- Package archive exclusion of credentials, private notes and development dependencies.

Screenshots and build outputs are local, ignored artifacts. Repeat checks using the README commands; passing a previous run does not certify later edits.

## Limits

This is a shell, not a working agent product. The conversation and example check are labelled illustrative. Real tasks are saved but not run. Messaging and audit controls are disabled. Changes and Preview explain their unavailable state. Profiles have no completed agent work yet, so their counters remain zero.

The shell uses Node's built-in SQLite interface; development Node 22 reports it as experimental. It was exercised in the actual Electron runtime as well as unit tests. Reassess stability before release. Short local queries run in the main process at this milestone; long-running agent coordination must run outside it.

Windows, Linux, macOS x64, installer behaviour, signing/notarisation, upgrades, cloud/local agent execution, security penetration testing and comprehensive accessibility evaluation have not been validated. The bundle is unsigned and is not a release installer.

## Security boundary

Local custom protocol, context isolation, sandboxed renderer, no Node integration, blocked new windows/navigation, denied browser permissions, constrained preload API, sender validation and validated task/profile payloads. No secrets or provider clients are loaded, and no execution/publishing API exists in this milestone.

These controls are an initial boundary, not a claim that the future agent runtime is secure. Project access, command approvals, upload policy and untrusted tool-output handling require their own tests when implemented.
