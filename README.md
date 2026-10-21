<p align="center">
  <img src="assets/branding/scully-friendly-nerd-transparent-v1.png" alt="Scully alien head logo" width="150">
</p>

<h1 align="center">Scully</h1>

<p align="center">A desktop coding assistant with Pearl in the Room.</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-2563eb" alt="Apache 2.0 license"></a>
  <img src="https://img.shields.io/badge/status-active%20development-14b8a6" alt="Active development">
  <img src="https://img.shields.io/badge/desktop-Electron-47848f?logo=electron&amp;logoColor=white" alt="Electron desktop app">
</p>

Pearl can discuss an idea, answer general questions, plan a change, and work on code in one persistent chat. The Room is the active interface. Team features and older task history are outside the current Pearl-only workflow.

> **Development status:** Connected Room journeys on one Nebius model have completed local application builds and repairs, browser verification, restart and provider-failure recovery. Independent browser checks and transcript review cover the tested workflows; broader development and deployment remain unverified. The macOS app is unsigned. Windows and Linux are untested. See [validation status](docs/pearl-validation.md).

## Quick start

**Requirements:** Node.js 22.12 or newer, npm, and a desktop environment. A Nebius Token Factory API key is needed for Pearl's model replies.

```sh
npm ci
npm start
```

1. Open **Settings**, enter a Nebius API key and compatible model ID, then connect. The key stays in memory for this app session.
2. Choose **New chat**. Ask Pearl a general question or describe coding work.
3. Choose a local project folder and approve its read and edit scope when you want Pearl to inspect or change files. Pearl can chat without a project.
4. Review each proposed command and choose **Run once** or **Deny**. Commands run under your account in the selected project folder.
5. Inspect Pearl's action record, changed project files, and check results. A successful command exit does not prove the requested behavior is correct.

See [Using Scully](docs/using-scully.md) for permissions, recovery, and current limits.

## Current capabilities

| Capability     | Current behavior                                                                                                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat           | Persistent Room conversations with Markdown replies, follow-up questions, linked answers, and ordinary digressions.                                                                    |
| Project access | Explicit approval of one selected folder per chat. Private paths and symlinks are rejected by file tools.                                                                              |
| Coding         | Pearl can list and search project files, read bounded line ranges, apply exact multi-edit patches, or create and replace files with revision checks. Existing originals are backed up. |
| Browser        | Pearl can inspect static pages or start an approved local server, then interact with the app in a persistent isolated browser.                                                         |
| Commands       | Exact arguments and resolved executable are shown for one-use approval. Execution is time and output limited. Denial grants no authority.                                              |
| Recovery       | Chats survive restart. Interrupted and budget-paused turns remain visible and can be continued. A command with an uncertain outcome is reported for inspection.                        |

Pearl's model may still misunderstand a requirement or produce a poor plan. [Runtime design](docs/pearl-runtime.md) describes the current safeguards and limits. [Validation status](docs/pearl-validation.md) records the connected journeys, observed failures and validated scope.

## Development and verification

| Command                                      | Purpose                                                                 |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| `npm test`                                   | Run the default unit, component, storage, and provider boundary suite.  |
| `npm run typecheck`                          | Check TypeScript.                                                       |
| `npm run build`                              | Build the desktop app.                                                  |
| `npm run format:check`                       | Check source and script formatting.                                     |
| `npm run test:desktop`                       | Run Electron smoke tests, including a local model HTTP fixture.         |
| `npm run package`                            | Build an unsigned macOS app bundle in `out/`.                           |
| `npm run test:package:mac`                   | Launch and inspect the packaged macOS app.                              |
| `SCULLY_LIVE_TEST=1 npm run test:live:pearl` | Run an opt-in connected Room journey with `NEBIUS_API_KEY` set locally. |

The desktop fixture verifies the integrated protocol and UI, not model reasoning. The live script saves a detailed transcript only in ignored local `test-results/` for manual review. Do not put credentials in chat messages or repository files.

## Privacy and permissions

Conversations and backups are stored locally in Electron's per-user application data. The Nebius key remains in memory and must be entered again after an app restart. Model requests send the relevant conversation and project tool observations to Nebius. External telemetry is disabled. Local operational metrics retain bounded operation names, outcomes, and durations, without prompts, source text, command arguments, credentials, or absolute paths.

File edits are confined to the approved project root and checked against the revision Pearl read. Commands require a separate review and can run arbitrary programs under your account. Review the command and the project's scripts before approval. On macOS, a system policy confines writes to the project, restricts reads from private directories, and blocks remote networking. Local loopback and project files remain accessible. Other platforms currently fail closed; this is not a full container.

The previous implementation and dirty checkout state were saved under `legacy/garbage/2026-10-20-pre-pearl-chat/` before this path was added. Legacy code remains available for recovery and is not the active Room controller.

## License

Scully is licensed under [Apache-2.0](LICENSE).
