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

> **Development status:** Connected Room journeys have completed local application builds and repairs, browser verification, restart and provider-failure recovery. A disposable two-file edit also completed through a reviewed transaction with an explicitly enabled Nebius fallback. The interactive terminal has passed local desktop and packaged-app checks, but has not had a separate live-model acceptance run. Independent browser checks and transcript review cover the tested coding workflows; broader development and deployment remain unverified. The macOS app is unsigned. Windows and Linux are untested. See [validation status](docs/pearl-validation.md).

## Quick start

**Requirements:** Node.js 22.12 or newer, npm, and a desktop environment. A Nebius Token Factory API key is needed for Pearl's model replies. Public web search is optional and uses a separate Tavily API key.

```sh
npm ci
npm start
```

1. Open the full-page **Settings** view, choose a primary Nebius model, then enter a Nebius API key under **App & connection**. You can change the model later without re-entering the key. The key stays in memory for this app session.
2. To enable public web search, enter a Tavily API key in **Settings**. Pearl can search without an approved project. Search queries and selected public result URLs are sent to Tavily; results are saved in the chat. The key stays in memory until the app closes.
3. Choose **New chat**. Ask Pearl a general question or describe coding work.
4. Choose a local project folder and approve its read and edit scope when you want Pearl to inspect or change files. Pearl can chat without a project.
5. Review each proposed command or managed terminal start and choose its action button or **Deny**. Dependency installation has its own one-use approval that explicitly grants network access. Approved local processes can write inside the selected project folder.
6. Inspect Pearl's action record, changed project files, and check results. A successful command exit does not prove the requested behavior is correct.
7. To work remotely, connect a Nebius Sandbox project under **Settings > App & connection**, choose **Work in Sandbox** in the chat, select an image, review the upload list, and start the Sandbox. You can continue talking to Pearl in the same chat, switch branches, run reviewed checks, and review a local sync before any remote edits reach your project.

See [Using Scully](docs/using-scully.md) for permissions, recovery, and current limits.

## Current capabilities

| Capability     | Current behavior                                                                                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Chat           | Persistent Pearl-only Room conversations with Markdown replies, linked follow-up questions, ordinary digressions, and visible user corrections. The sidebar keeps at most one untouched **New chat** draft.              |
| Room interface | User and Pearl chat bubbles retain names and sent times. Pearl's avatar identifies her replies; long messages render Markdown, and the composer expands as needed.                                                       |
| Chat history   | Chats can be archived, restored, and permanently deleted from Archive after confirmation. Existing Trash chats move into Archive on upgrade. Active work and running terminals must finish before a chat can be moved.   |
| Activity       | Tool requests and results appear in a nested, collapsible Activity item for each user turn. Pearl's messages and required questions and approvals remain visible in the conversation.                                    |
| Web search     | Optional public search with attributed results and query-focused reading of a returned page. Searches and reads are bounded per turn.                                                                                    |
| Project access | Explicit approval of one selected folder per chat. Private paths and symlinks are rejected by file tools.                                                                                                                |
| Coding         | Pearl can map, list, and search project files, read bounded line ranges, edit one file with revision checks, or propose a reviewed transaction for two to eight files. Existing originals are backed up.                 |
| Browser        | Pearl can inspect static pages or start an approved local server, then interact with the app in a persistent isolated browser.                                                                                           |
| Commands       | Exact arguments and resolved executable are shown for one-use approval. Regular checks stay offline. Dependency setup requests a separate network-enabled approval and can save installed packages in the project or Sandbox checkpoint. Denial grants no authority. |
| Terminal       | A separately approved, managed project process can remain active for user keyboard input, full-screen interaction, resize, and later output inspection by Pearl. The Room provides Stop.                                 |
| Recovery       | Chats survive restart. Interrupted and budget-paused turns remain visible and can be continued. An action with an uncertain outcome is reported for inspection rather than replayed.                                     |
| Attachments    | Attach images, PDFs, DOCX documents, and supported text files with the paperclip. Images and visual PDF pages require an image-capable selected model; Send explains when the model cannot analyze them.                 |
| File review    | Open local and Sandbox files in center tabs. Common code languages have syntax colors. Text changes use a resizable Before/After comparison with highlighted additions and removals. The tab strip has overflow controls and holds at most ten open files. Turn review and Undo are bound to the changed files and checkpoint. |
| Sandbox        | Review the file manifest before upload, choose a base image and branch, inspect saved files and checks, and approve an exact local sync. Upload progress shows transferred files and bytes plus checkpoint verification. |
| External links | Web links in Pearl's replies require confirmation. The prompt offers installed browsers and the system default. A browser launch failure offers another browser or Copy link. |

## Attachments, files, and Sandbox

The composer paperclip adds up to four attachments per message, with a 20 MiB limit for each. Supported formats include PNG, JPEG, WebP, PDF, DOCX, plain text, Markdown, CSV, and JSON. Text can be extracted from supported documents; screenshots and visual PDF pages depend on the selected model's image capability. The send control stays disabled with an explanation when a visual attachment cannot be analyzed by that model.

The composer shows the selected model and a blue permissions control that opens Settings. While Pearl works, the send control becomes Stop. Permissions lets you turn command requests and dependency downloads on or off for the current chat. Turning them on does not approve an action: each command and dependency installation still requires an exact, one-use approval. Project selection, Sandbox mode, local sync, and external links retain their own review flows.

The **Files** and **Sandbox** icons in the left rail reopen their panels. The Sandbox panel shows an empty state until the chat has a saved remote checkpoint. File tabs are read-only views: opening an eleventh file closes the oldest inactive tab, and the file remains available in its project or Sandbox. Text reviews show Before and After in the center with a draggable, keyboard-adjustable divider. Added files have an empty Before side; deleted files have an empty After side. Binary files show metadata rather than a code preview.

Sandbox setup checks the session connection before listing images. A project/image mismatch receives a warning before upload because transferring source files does not install a compiler or runtime. For example, Java files can be uploaded into a Node image, but Java checks may fail if the image has no JDK. The warning is advisory for mixed-language projects. Progress reports bytes transferred to the remote service and then distinguishes checkpoint verification; transfer completion alone is not a saved checkpoint. The current upload review limits are 20,000 files, 64 MiB per file, and 256 MiB total. Git ignored and private paths are not uploaded. Local changes require a separate sync review tied to the selected branch checkpoint.

## Runtime architecture

Scully owns its conversation and coding runtime. Pearl's model proposes replies and actions; the Electron main process validates chat state and executes permitted actions. The renderer displays the Room and sends user decisions through a narrow desktop bridge.

| Component                                                     | Responsibility                                                                                                                                                         |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Model adapter](src/engine/pearl-model.ts)                    | Streams Nebius replies, declares the available tools, and preserves provider continuation for tool-using turns.                                                        |
| [Agent loop](src/main/pearl-agent-runtime.ts)                 | Requests the next model response, validates ordered action batches, records observations, detects repeated work, and pauses resumably at safety limits.                |
| [Chat manager](src/main/pearl-chat-manager.ts)                | Enforces project binding, question identity, plan revisions, tool permissions, one-use approvals, command identity, and completion evidence in the privileged process. |
| [File transactions](src/main/pearl-file-transaction.ts)       | Stages reviewed multi-file changes, keeps a recovery journal, rolls back failed batches, and restores interrupted batches after restart.                               |
| [Chat store](src/main/pearl-chat-store.ts)                    | Saves conversation and work state in local SQLite and marks interrupted actions and terminals for review after restart.                                                |
| [Context helpers](src/main/pearl-context.ts)                  | Provide tool-history compaction and a model-facing character budget; the chat manager selects the messages while preserving saved history.                             |
| [Room](src/renderer/PearlApp.tsx)                             | Shows messages, Markdown, working plans, nested Activity, project selection, approvals, chat history, and interactive terminal sessions.                               |
| [Desktop bridge](src/main/pearl-main.ts)                      | Exposes validated Room operations through trusted Electron IPC handlers.                                                                                               |
| [Command sandbox](src/main/pearl-command-sandbox.ts)          | Launches reviewed macOS commands under a project policy. On Windows and Linux, regular commands use a local Docker engine with a constrained, cached language runtime image. Dependency setup is a separate network-enabled approval. |
| [Managed terminal](src/main/pearl-terminal.ts)                | Tracks terminal state, bounded output, user input, resize, stop, and process exit.                                                                                     |
| [Terminal supervisor](src/main/pearl-terminal-supervisor.cjs) | Owns each pseudoterminal process group separately from the app and stops that group on stop, normal exit, or connection loss.                                          |
| [Terminal view](src/renderer/PearlTerminalView.tsx)           | Renders interactive terminal output and forwards user keystrokes and resize events through the desktop bridge.                                                         |
| [Browser work surface](src/main/pearl-browser.ts)             | Observes and interacts with static project pages or a reviewed local preview using an isolated browser session.                                                        |
| [Web access](src/main/pearl-web.ts)                           | Restricts public searches and same-turn result reads, validates targets, and bounds returned content.                                                                  |
| [Telemetry contract](src/shared/telemetry.ts)                 | Defines local, allowlisted operational metrics without content-bearing fields or external export.                                                                      |

The model can request up to eight ordered actions in one response. Approval, question, and completion actions form decision boundaries, so file work cannot be combined around them. A working-plan update can immediately precede one decision action, but plan state never grants access. The runtime compares actions with their observed results; after three identical cycles it asks Pearl to change approach, and after a fourth it pauses. After 32 model responses it checks for new observations every 16 responses. Productive work can continue up to 128 responses or 15 minutes in one stretch, then the chat pauses with **Continue** available. These limits apply to a stretch of work, not the lifetime of a chat or project.

Context selection retains the latest user request, recent replies, linked answers, the working plan, and current source observations within a character budget. It also replays provider continuation during the active turn, including across approval and restart, without exposing that continuation in the Room. Older requirements are not yet semantically summarized, so a long conversation can still lose detail. The full saved chat remains available for inspection even when less of it fits into a model request. See [runtime design](docs/pearl-runtime.md) for the exact progress and completion rules.

## How the current workflow works

1. **Conversation:** Pearl receives the current chat through a Nebius-hosted model. It may reply, ask a question tied to a durable question ID, update a revisioned working plan, or request tools. User answers and changed requirements remain part of the saved conversation. The model does not grant itself permission.
2. **Project work:** The user approves a project folder for the chat. Backend file tools enforce relative paths, size limits, symlink and private-path restrictions, and SHA-256 revision checks. A patch can make up to 20 exact replacements in one file. For two to eight files, Pearl can propose a transaction with a complete diff. A separate one-use review is required; the backend rechecks every baseline at approval, stages the changes, and records a recovery journal before applying them. Existing file contents are backed up.
3. **Execution:** Each command, local preview server, or managed terminal start requires a separate one-use review of the exact arguments and executable. Approval cards name the requested command and action. When a Sandbox check fails and Pearl requests dependency installation, the next card shows the failed check; after installation, a new card explains that verification needs its own approval. On macOS regular commands use a project-scoped system policy. On Windows and Linux regular commands use a local Docker engine and a cached language runtime image. The distinct dependency setup action grants network access once; Sandbox setup saves the resulting image as a new checkpoint. The browser tool can observe and interact with a static page or an approved local preview. A terminal lets the user type directly while Pearl can read recent output or stop its session.
4. **Progress and completion:** The runtime records tool results, detects repeated action cycles, and pauses unproductive or overlong turns with a **Continue** path. After file changes, Pearl reports `done`, `partial`, `blocked`, or `unverified`. Scully requires the completion action after repeated plain replies. If the selected model cannot provide it, the edit stays saved and the Room explains the problem with a path to model settings. A rejected completion returns Pearl to the available check tools instead of trapping her in repeated completion requests. The backend checks recorded edits, command results, plan state, and applicable browser observations before accepting `done`. An unchecked edit is labeled as such and is not presented as a safety finding. These observations do not prove every requested behavior.
5. **Persistence:** SQLite stores chats, plans, questions, approvals, action results, and terminal output tails locally. An interrupted action is marked for inspection; it is not automatically repeated. API keys remain in memory and must be entered again after restart. Local operational metrics record bounded operation names, outcomes, and durations; external telemetry is disabled.

## Managed terminal

`start_terminal` is a separate tool for an attended process such as a development server, shell, or interactive program. It uses the same exact-command, one-use approval and macOS project policy as a regular command. After approval, a local supervisor creates a pseudoterminal. The Room renders it with keyboard, paste, scrollback, and resize support, including terminal programs that redraw the screen. Only the user can send terminal input; Pearl can read the latest output through `read_terminal` and stop its own session through `stop_terminal`. The user can stop it directly in the Room.

Managed interactive terminals currently require macOS. Windows and Linux have a constrained Docker route for approved one-shot commands and dependency setup, but the interactive terminal path still needs platform implementation and live validation.

The supervisor owns the process group and attempts to stop descendants when the user stops the terminal, the app exits, or the app loses its connection to the supervisor. The app also stops the group if a supervisor fails while the app remains open. A terminal does not count as a successful command check merely because it started. Its output and exit state remain visible in the chat. Saved running sessions become **interrupted** after restart rather than being relaunched automatically.

The current capacity is eight running terminals per chat and sixteen across the app. There is no fixed 30-minute lifetime for an attended session. Each terminal retains its latest 128,000 output characters, while a model read returns at most the latest 16,000; trimming old output does not stop the process. The Room's terminal view has 1,000 lines of scrollback, accepts a paste of up to 65,536 characters at once, and sends it in bounded chunks. Resizes are limited to 20 to 300 columns and 5 to 120 rows. A collapsed or restarted view may not reconstruct an earlier full-screen image from the saved tail. Input entered into an approved shell can start further commands inside the same sandbox. A program that deliberately moves itself into another process group can escape group cleanup, so this remains a bounded local execution feature, not a full container. The native terminal dependency is packaged with the macOS app and checked by the packaged-app smoke test; a separate live-model terminal journey remains to be reviewed.

**V2 follow-up:** Preserve a bounded terminal screen checkpoint so a long full-screen session still reopens accurately after its raw output tail rolls over. Verify the restored screen after collapsing and reopening the terminal, switching chats, and restarting the app. The v1 tail limit remains in place until that recovery path is implemented and tested.

## Limits and considerations

- **Model and search data:** Nebius receives the relevant conversation and project tool observations needed for Pearl's replies. Optional Tavily search receives short queries and selected public result URLs. Web content and project files are untrusted inputs. Search allows up to 12 provider attempts and 20 result reads per user turn; only public HTTPS results returned in that turn can be read.
- **Provider recovery:** A model request has a 90-second backend deadline. Connection failures and timeouts show an actionable error; Continue resumes from the saved user request and completed actions with one new provider request. An optional, explicitly enabled Nebius fallback starts when the selected model has not begun responding within 25 seconds or fails before an action is accepted. Later steps of that user turn stay on the fallback, while a new user message starts with the selected primary. Fallback replies are labeled. Authentication failures do not use the fallback. The Room shows when it is waiting for a response. A timeout alone does not identify whether the network or model caused the delay.
- **Command authority:** A regular command has a 60-second timeout and a 200,000-byte output buffer. Dependency setup has a ten-minute local timeout and a larger output buffer. The macOS policy limits writes to the approved project, restricts reads from common private directories, and blocks remote networking for checks. Dependency approval permits network access. On Windows and Linux, regular commands require a local Docker engine. Scully mounts only the approved project, uses a read-only container root, drops capabilities, and disables networking for checks. Setup permits container networking and can pull a missing public runtime image. Commands without a configured runtime image or Docker engine fail closed. A container command runs in its language image, which can differ from tools installed on the host. These boundaries do not make arbitrary approved scripts safe.
- **Managed terminals:** Terminal cleanup and output retention have the boundaries described [above](#managed-terminal). The Room cannot restore a live process after restart, and terminal input can run further project-sandboxed commands.
- **Browser scope:** A project preview lasts at most ten minutes and is confined to its allocated local origin. One browser request can perform at most twelve bounded interactions. Browser checks can expose defects in tested flows, but cannot establish that an entire application works. Deployment, signing, and live Windows/Linux behavior remain unverified.
- **File transactions:** A reviewed batch is limited to two to eight files and 400,000 combined before/after characters. Ordinary failures roll back the batch; startup recovery rolls back a batch interrupted before its committed marker. Another process can still change a project during the brief commit window, and multiple file names cannot become visible to external processes in one filesystem operation. A recovery conflict leaves the external content untouched and requires inspection. Single-file tools retain their existing behavior.
- **Remote MCP:** Connect one HTTPS Streamable HTTP server in Settings, with an optional bearer token kept in memory for the app session. Pearl can inspect its tools and request a call. The Room shows the exact tool, arguments, and endpoint for one-use approval before Scully sends the call. OAuth sign-in and multiple concurrent server connections are future work.
- **Planned work:** Full IDE language-server diagnostics and semantic highlighting are V2 work. A possible extensions store also belongs to V2 and needs a permission and review design before third-party code can run. Visible team-agent workflows are outside the active product.

Pearl's model may still misunderstand a requirement or produce a poor plan. [Runtime design](docs/pearl-runtime.md) describes the current safeguards and limits. [Validation status](docs/pearl-validation.md) records the connected journeys, observed failures and validated scope.

## Development and verification

| Command                                      | Purpose                                                                       |
| -------------------------------------------- | ----------------------------------------------------------------------------- |
| `npm test`                                   | Run the default unit, component, storage, and provider boundary suite.        |
| `npm run typecheck`                          | Check TypeScript.                                                             |
| `npm run build`                              | Build the desktop app.                                                        |
| `npm run format:check`                       | Check source and script formatting.                                           |
| `npm run test:desktop`                       | Run Electron smoke tests, including a local model HTTP fixture.               |
| `npm run package`                            | Build an unsigned macOS app bundle in `out/`.                                 |
| `npm run test:package:mac`                   | Launch and inspect the packaged macOS app.                                    |
| `SCULLY_LIVE_TEST=1 npm run test:live:pearl` | Run an opt-in connected Room journey with `NEBIUS_API_KEY` set locally.       |
| `node scripts/pearl-web-live.manual.mjs`     | Run an opt-in public web search Room check with local Nebius and Tavily keys. |

The desktop fixture verifies the integrated protocol and UI, not model reasoning. It includes terminal input, resize, process cleanup, crash recovery, Room state, browser boundaries, transaction review, and approval checks. The packaged macOS smoke checks that the native terminal helper runs and that the app archive excludes local credentials and notes. At the 23 October 2026 file transaction gate, 238 default tests, typecheck, build, formatting, the full desktop gate, packaging, and packaged smoke passed. The file transaction did not receive a separate live Nebius model run at that gate. The provider-recovery follow-up passed 246 default tests, typecheck, build, formatting, the full desktop gate, packaging, and packaged smoke; its connected desktop fixture forced a provider disconnect and resumed the saved file read. The later explicit-fallback gate passed 254 default tests and completed a live disposable two-file edit with reviewed approval and observed file checks. The opt-in live script saves a detailed transcript only in ignored local `test-results/` for manual review. Do not put credentials in chat messages or repository files.

For offline packaging, set `SCULLY_ELECTRON_ZIP_DIR` to a directory containing the Electron ZIP for the current platform and architecture. Forge otherwise downloads that runtime during packaging.

## Privacy and permissions

Conversations and backups are stored locally in Electron's per-user application data. The Nebius and Tavily keys remain in memory and must be entered again after an app restart. Model requests send the relevant conversation and project tool observations to Nebius. When web search is connected, Pearl sends short queries and selected public result URLs to Tavily. Search content is untrusted and may be incomplete. External telemetry is disabled. Local operational metrics retain bounded operation names, outcomes, and durations, without prompts, source text, command arguments, credentials, or absolute paths.

File edits are confined to the approved project root and checked against the revision Pearl read. Commands require a separate review. Review the executable, arguments, package source, and project scripts before approval. On macOS, a system policy confines writes to the project and blocks remote networking for routine checks. Windows and Linux regular commands use a local Docker engine with a constrained language runtime. Dependency installation has a distinct network-enabled approval, and downloaded packages may execute install scripts. Missing local runtimes fail closed. Managed interactive terminals still require the macOS process policy.

The previous implementation and dirty checkout state were saved under `legacy/garbage/2026-10-20-pre-pearl-chat/` before this path was added. Legacy code remains available for recovery and is not the active Room controller.

## License

Scully is licensed under [Apache-2.0](LICENSE).
