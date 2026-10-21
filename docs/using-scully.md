# Using Scully

Scully opens a Room chat with Pearl. Pearl can answer ordinary questions, discuss requirements, plan, and use project tools in the same conversation. The current interface is Pearl-only. Team workflows and old task history are preserved as legacy implementation, not displayed in the Room.

## Connect a model

Open **Settings** and enter a Nebius Token Factory API key and a compatible model ID. New connections default to `zai-org/GLM-5.3-Flash`. The key remains in memory for this app session and is needed again after restart. Do not paste keys into chat or project files. A provider failure keeps the user's message and shows a recoverable error; select **Continue** after the connection is restored.

## Start a chat

Choose **New chat**, then ask Pearl a question or describe work. Chats are saved in local SQLite storage and appear in the sidebar. Pearl may answer directly, propose a project action, or ask a linked product question. A linked answer is attached to that exact question. The composer stays available while a question is pending, so you can ask about alternatives or change the subject.

A new requirement can change an earlier recommendation. Check that Pearl acknowledges the correction before relying on a plan or code change. The [validation status](pearl-validation.md) records the observed quality checks and their limits.

## Work in a project

Choose a local project folder from the Room header. Scully shows the exact folder and asks for approval before Pearl may read or edit its files. The approval is scoped to that folder for this chat. Pearl's file tools use relative paths, reject private paths and symlinks, and limit file size. Existing files require the SHA-256 revision returned by a prior read. If a file changed after Pearl read it, the edit is rejected and Pearl must inspect it again. Scully retains the original content of existing files in local backups before a write.

Pearl can propose a command. The Room shows its arguments and resolved executable, and the backend accepts one approval for that pending command only. Choose **Run once** or **Deny**. Commands run in the project under your local account with a time and output limit. On macOS, a system policy limits writes to the project, restricts reads from private directories, and blocks remote networking. Project files and local loopback services remain accessible. Other platforms currently reject execution. A command exit code is an observation, not proof that a feature works. Review project scripts before running package-manager commands. After file changes, Pearl must report a completion status tied to recorded edits and checks. Read the [runtime design](pearl-runtime.md) for the exact limits of that evidence.

For a static web page in the approved project, Pearl can use `browser_check` to load an HTML entry, inspect visible text and controls, and perform a short sequence of click, fill, key, or reload actions. The browser blocks external requests, private project paths, and permissions. For a backend-driven app, Pearl requests separate approval to start the exact local server command. The server receives HOST and PORT settings, and an isolated browser retains cookies and page state across interactions. The preview ends on completion, source edits, Stop, or its ten-minute limit. Browser actions can change application data. Only the allocated local origin is accessible; arbitrary web browsing is unavailable. These observations do not prove every user journey. After an HTML, style or component edit, the backend requires a clean browser observation as well as a successful command check before accepting `done`. Once browser verification is used, later file edits invalidate that result, and passing command tests cannot hide a failed browser check.

## Stop and recover

**Stop** cancels a current model request or command when possible. A command may already have made partial changes, so inspect the project before retrying. An app restart preserves chat and question state. An action whose result was not recorded is marked unknown rather than silently repeated. **Continue** resumes from the saved conversation after an interruption or work budget pause. The model connection must be re-entered after restart.

## Verification status

`npm test`, `npm run typecheck`, `npm run build`, `npm run format:check`, `npm run test:desktop`, and the package checks are separate gates. The desktop fixture runs a Room journey through a local model HTTP endpoint and disposable project. It verifies wiring, persistence, and permission boundaries. It does not measure Pearl's reasoning or tone. The opt-in `npm run test:live:pearl` exercises the configured provider and saves a local transcript for human review. The recorded live journeys include varied wording, changed requirements, implementation, browser-discovered repairs and recovery. Their results apply to the tested local application workflows. See [validation status](pearl-validation.md) for the current scope and evidence map.
