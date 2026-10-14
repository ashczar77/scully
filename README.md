<p align="center">
  <img src="assets/branding/scully-friendly-nerd-transparent-v1.png" alt="Scully alien head logo" width="150">
</p>

<h1 align="center">Scully</h1>

<p align="center">A desktop workspace where engineering teammates plan, build, review and test software together, with people in control of every consequential action.</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-2563eb" alt="Apache 2.0 license"></a>
  <img src="https://img.shields.io/badge/status-active%20development-14b8a6" alt="Active development">
  <img src="https://img.shields.io/badge/desktop-Electron-47848f?logo=electron&amp;logoColor=white" alt="Electron desktop app">
  <img src="https://img.shields.io/badge/tested-macOS%20ARM64-334155?logo=apple&amp;logoColor=white" alt="Tested on macOS ARM64">
</p>

Scully brings implementation, testing and review into one visible room. Start from a new project or a selected snapshot of an existing repository, inspect each teammate's work, run checks with fresh permission, and decide whether to apply the reviewed files. The original source stays untouched until you approve an application.

> **Development status:** The desktop workflows have offline automated and Electron smoke coverage. Live Nebius model and Sandbox journeys have not yet been validated against an account. The macOS build is unsigned; Windows and Linux remain untested. See [validation and limits](docs/desktop-validation.md).

## What Scully does

| Capability            | Current behavior                                                                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Team room             | Maya and Jun work in separate private branches; Ellis reviews the combined draft. Ownership rules and optional early reviews are visible.                               |
| Review and correction | Inspect files, findings, specialist reviews, proposed checks and corrective attempts. Evidence can inform a user decision, but does not resolve findings automatically. |
| Local checks          | Review a command, then grant a separate, expiring, one-use execution permission. Results and failures remain attached to the run.                                       |
| Cloud experiments     | Review bounded Nebius Sandbox checks, saved environments and side-by-side results. This path has offline fixture coverage only.                                         |
| Apply and recovery    | Approve exact draft files for a chosen destination. Originals and a manifest are retained; read-only recovery inspection helps assess partial writes.                   |

<p align="center">
  <img src="assets/team-portraits.png" alt="Illustrated portraits of Maya, Ellis and Jun from Scully's fixed character roster" width="780">
</p>

The first launch shows an empty task list and the current team profiles. Team settings lets you choose from 16 fixed characters, save their roster under a team name, and create separate named teams. Every team includes Pearl, at least one builder and one independent auditor. For Plan first tasks, Pearl prepares the plan and waits for your review before work begins. At that pause, you can approve a specialist lineup and separately review one read-only planning consultation per selected specialist. You may then review the exact saved advice and explicitly attach selected planning advice to the next builder requests. This handoff adds input and may increase cost, with no extra model request or permission of its own. An approved verification specialist can also review the completed, audited draft. Each consultation needs its own exact upload and usage approval; advice does not change the plan, draft or audit decision. The current work dispatcher calls one selected builder, one selected auditor and an optional selected tester. Building and release phase specialist dispatch remain pending. The available library holds up to 20 teams. You can delete a team from that library and restore it later after selecting another default team. Each task keeps its own saved team details, even if its team is edited or deleted later. This version keeps one local task collection, with a separate project source choice for each task. Actual model work requires a Nebius key, an accessible model ID, explicit upload approval and an account with suitable billing controls. Model responses are untrusted proposals. A passing check or a zero process exit is not proof of correctness.

## Quick start

**Requirements:** Node.js 22.12 or newer, npm and a desktop environment. No Python runtime or provider credentials are needed to explore the room and run the offline checks.

```sh
npm ci
npm start
```

In the app:

1. Create a task with **New task**. Edit its title or details later, or delete it from the task room before model work starts. A new installation has no saved tasks or run activity.
2. Choose **New project** or **Existing project**. Existing intake shares a selected, bounded source snapshot rather than a full checkout.
3. Use **Plan first** or **Start working**. Run usage, alerts and model cost settings have defaults and can be changed in Settings after preparing a run. Review the exact upload and request allowance before approving any model call.
4. Inspect the draft, findings and checks. Local commands and cloud experiments each require their own permission.
5. Choose a destination, review the exact file changes and approve application only when ready.

See [Using Scully](docs/using-scully.md) for the full workflows, limits and recovery guidance.

## Development and verification

| Command                    | Purpose                                                               |
| -------------------------- | --------------------------------------------------------------------- |
| `npm test`                 | Run the offline unit, component, storage and provider-boundary suite. |
| `npm run typecheck`        | Check TypeScript without emitting files.                              |
| `npm run build`            | Typecheck and build the desktop application.                          |
| `npm run format:check`     | Check source and script formatting.                                   |
| `npm run test:desktop`     | Launch Electron and exercise the offline desktop journey.             |
| `npm run package`          | Build an unsigned application bundle in `out/`.                       |
| `npm run test:package:mac` | Smoke test the packaged macOS ARM64 application.                      |

The desktop smoke test uses a temporary workspace and stores screenshots under ignored `test-results/`. The package command does not create a signed installer. Passing offline checks does not establish live provider compatibility or support on untested platforms.

## Permissions and data

- Selected source files, drafts, runs and profiles are stored locally in Electron's per-user application data directory. The Nebius key entered in Settings stays in memory for the current session.
- Model uploads, local command execution, cloud checks and file application have separate reviews. Reviews are bound to the relevant snapshot and expire; they do not transfer to another action.
- Local commands run under your account in a fresh partial copy. That copy is not a security sandbox, and approved programs may access local files and the network.
- Applying several files is not atomic. Scully retains originals and a manifest and offers read-only recovery inspection; it does not automatically overwrite later edits during recovery.
- Scully does not commit, push or open a pull request. Deleting a task before work starts removes its saved task, prepared runs, usage settings and cost settings. Tasks with saved work keep their run and recovery records. Settings shows a read-only inventory of local draft, check and recovery files. Artifact cleanup controls are not yet available.

## Project layout

The desktop app uses Electron, React, TypeScript, Vite and local SQLite storage. Model coordination runs in an Electron utility process; the renderer uses a constrained preload API rather than direct Node access.

| Path                                                       | Contents                                                               |
| ---------------------------------------------------------- | ---------------------------------------------------------------------- |
| [`src/main/`](src/main/)                                   | Desktop lifecycle, persistence, permissions and privileged operations. |
| [`src/renderer/`](src/renderer/)                           | Team room, reviews, settings and recovery UI.                          |
| [`src/engine/`](src/engine/)                               | Coordination and draft validation.                                     |
| [`tests/`](tests/)                                         | Offline behavior, storage and boundary tests.                          |
| [`docs/using-scully.md`](docs/using-scully.md)             | Detailed user workflows.                                               |
| [`docs/desktop-validation.md`](docs/desktop-validation.md) | Tested journeys, limitations and validation history.                   |

## Brand assets

The header uses the transparent logo, so only the alien head appears on the reader's page. The other background variants remain available for project materials:

| Light backgrounds                                                                                             | Dark backgrounds                                                                                        |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| <img src="assets/branding/scully-friendly-nerd-transparent-v1.png" alt="Scully transparent logo" width="110"> | <img src="assets/branding/scully-friendly-nerd-charcoal-v1.png" alt="Scully charcoal logo" width="110"> |

The [team portraits](assets/team-portraits.png) are part of the current desktop room. The in-app wordmark uses [Chelsea Market](assets/fonts/ChelseaMarket-Regular.ttf), distributed under its [SIL Open Font License](assets/fonts/OFL.txt).

A [light-background logo](assets/branding/scully-friendly-nerd-light-v1.png) is also saved for future use.

## License

Scully is licensed under [Apache-2.0](LICENSE).
