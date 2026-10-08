# Scully

A desktop workspace where engineering agents build, review and test software together, with visible collaboration and user-controlled execution.

## Status

The first Electron desktop shell is runnable. It includes the team room, illustrated teammate profiles, profile editing, task creation and local SQLite persistence.

The example room is explicitly illustrative. Agents, messaging, audits, code execution, repository integration and publishing are not connected yet. Saved tasks do not start execution.

## Planned experience

- Start a new project or work with an existing repository.
- Watch teammates coordinate and request specialist reviews.
- Review changes and test results before accepting them.
- Choose cloud or permission-controlled local execution.
- Keep control over commits, pushes and pull requests.

## Development

Use Node.js 22.12 or newer and npm. No Python runtime, provider credentials or cloud account is needed for this shell.

```sh
npm ci
npm start
```

Checks and packaging:

```sh
npm test
npm run build
npm run test:desktop
npm run package
```

On macOS ARM64, `npm run test:package:mac` checks the packaged application after packaging.

The desktop smoke test opens real windows, uses a temporary workspace, verifies persistence across restart, and saves screenshots under ignored `test-results/`. Packaging produces an unsigned application under `out/`, not a signed installer.

Tasks and profiles are stored in `workspace.sqlite` in Electron's per-user application data directory. This shell never reads the repository's `.env` file. The renderer has no direct Node access and can only invoke three validated workspace operations.

### First look

1. Explore the labelled example conversation.
2. Select a teammate, open their full profile, and edit their name or instructions.
3. Create a task using **New task**. It is saved, not executed.
4. Quit and reopen Scully to verify your task and profile remain.
5. Visit Changes, Preview and Settings to see the current capability boundaries.

Only macOS ARM64 is being validated at this milestone. Windows/Linux installation and signed distribution are pending. See [desktop validation](docs/desktop-validation.md) for exact checks and limits.

## Licence

Apache-2.0. See [LICENSE](LICENSE).
