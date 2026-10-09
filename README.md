# Scully

A desktop workspace where engineering agents build, review and test software together, with visible collaboration and user-controlled execution.

## Status

The Electron application includes the team room, illustrated teammate profiles, task/profile persistence and an initial bounded builder-and-auditor loop.

The example room remains explicitly illustrative. Actual tasks can prepare a new project or selected existing source files, request a plan, then produce isolated file drafts and a separate model review through Nebius. Live provider acceptance remains pending; see the validation record.

Automatic checks cover output paths, size limits and JSON syntax. Proposed commands can run locally with fresh individual permission. Reviewed drafts can be applied to an explicitly chosen destination with separate permission and conflict checks. A model review or successful process exit is not evidence of complete runtime correctness. Read-only questions can run alongside coordination; automatic instruction injection and publishing remain unavailable.

Builders can propose up to six check commands. Each shows the exact executable, separate arguments, relative working directory, reason and timeout. Users can record approval or denial individually and revoke an approval. These review records are not execution grants. The local runner requires a separate, one-use approval tied to the snapshot, draft, command, resolved executable hash and fresh working directory. Reviews expire after two minutes and are not retained across restart. Local copies are not security sandboxes.

## Planned experience

- Start a new project or work with an existing repository.
- Watch teammates coordinate and request specialist reviews.
- Review changes and test results before accepting them.
- Choose cloud or permission-controlled local execution.
- Keep control over commits, pushes and pull requests.

## Development

Use Node.js 22.12 or newer and npm. No Python runtime is needed. Offline tests and room/profile features need no credentials. Approved model runs require a Nebius key and accessible model ID.

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

Tasks, profiles, runs and selected source snapshots are stored in `workspace.sqlite` in Electron's per-user application data directory. Private draft workspaces are stored under its `drafts/` directory. The application does not read the repository's `.env` file. A key entered in Settings is held in memory for the current session and is not stored in SQLite. The renderer has no direct Node access; validated IPC operations mediate intake and run control.

### First look

1. Explore the labelled example conversation.
2. Select a teammate, open their full profile, and edit their name or instructions.
3. Create a task using **New task**. It is saved, not executed.
4. Quit and reopen Scully to verify your task and profile remain.
5. Visit Changes, Preview and Settings to see the current capability boundaries.

### Bounded model run

1. In Settings, enter your Nebius key, exact accessible model ID and output-token limit. Saving configuration does not send a request.
2. Create a task. Choose Plan first or Start working.
3. Choose New project or Existing project. For existing sources, select a folder and inspect/select the files to share. This is a bounded partial snapshot, not a complete repository checkout. Custom ignore rules are not interpreted, so inspect content carefully.
4. Prepare the workspace and explicitly approve sharing and credit use. Plan first makes one request and pauses for a separate build approval.
5. New tasks automatically assign Maya to implementation and Jun to test files, with Ellis reviewing the combined result. Writers run in parallel in separate private folders. By default, Start working uses at most three requests, or four with Plan first. Optional early reviews add up to two requests, for limits of five or six respectively. Older saved single-writer runs keep their three-request cap. Each request has a 90-second deadline and no automatic retry. The configured token limit is not a currency cap; verify credits and billing controls yourself before use.
6. Review messages, checks, findings and before/after file content. Your original project remains untouched. Stopping halts local coordination but does not prove the provider stopped processing an already submitted request.

### Team coordination

The ownership panel shows each writer's scope, status and proposed files. Maya is assigned integration responsibility; deterministic integration checks refuse overlapping, case-conflicting, parent/child-conflicting or out-of-scope paths. No writer wins by finishing last. Failed/conflicting branches remain separate for inspection; execution and application stay unavailable. Clarify the task and prepare a new attempt rather than silently rerunning it.

Default test ownership uses visible filename/directory conventions, not full language-aware repository discovery. Before a run starts, open **Configure ownership and early reviews** to override exact files or directory subtrees using rules such as `jun checks/` or `maya tests/fixture.json`. Overlapping rules are rejected. Save settings, then approve the updated request allowance. Settings lock once planning or building starts; changed settings clear prior upload consent.

Optional early reviews are off by default. When enabled, Ellis reviews each completed writer branch while the sibling can continue. Each review names an immutable branch revision; findings remain unverified. The final combined audit still runs. A failed early review does not cancel the sibling writer but prevents final integration; no automatic retry occurs. A chunk is currently one writer's complete bounded output, not arbitrary subdivisions within a file or a long-running stream of edits.

Each writer can change up to six files; the combined cap remains 12 files and 48 KB. Stale combined audits block execution/application. Team composition is still a fixed three-role arrangement. Elapsed writer/review time, summed writer time and integration time are observations, not a proven speedup over a single agent. Branch folders are retained beside private drafts; retention controls remain pending.

### Specialist reviews

Completed coordinated drafts expose **Audit testing**, **Audit security**, and **Audit maintainability** buttons. These select review focuses for Ellis, not additional independently validated models. Each dispatch requires fresh upload/usage approval and is tied to the exact draft revision. It uses at most two additional requests: one specialist audit and, if findings are raised, one implementation response. A run permits at most three dispatches, separately counted from its build requests. Failed/interrupted dispatches consume a slot; there are no automatic retries.

Findings and responses remain visible in the room. Contested or accepted findings both require review: discussion is not verification. No automatic code changes, experiments or command execution occur. No findings means only that the reviewer reported none. New specialist evidence invalidates a previously prepared apply approval. Automatic experiment branches, verified corrections and configurable disagreement budgets remain pending.

### Team notes and redirection

Each prepared run has a message panel. **Continue current work unchanged** saves a local note without uploading it or changing the active agent instructions. To change the task, choose **Stop local coordination and prepare a revised plan**. This retains the original run but marks it superseded, blocks its execution/application, and prepares a separate attempt with the redirection, prior plan and prior draft shown for review. It always requests a new plan first, with fresh upload approval and a further approval before building. Earlier local notes are not automatically included in prompts.

For a saved question, **Review reply upload** previews the exact task snapshot before a separate, explicit approval. Replies can run alongside planning, building or auditing through a separate worker. There is at most one reply worker and one coordinator, with the coordinator's existing internal request limits unchanged. Replies are also available on prepared, planned and complete runs; new replies are blocked during a running local check. Each attempt uses one provider request with the configured output-token cap, and at most three attempts per run. Failed attempts consume a slot.

During active work, the two-minute one-use approval uploads the frozen snapshot you reviewed, even if progress advances. Changed selected source, task, question, recipient profile, redirection or provider settings invalidate approval. For snapshots reviewed while idle, changes to plan or draft also require a new review. Other notes and command output are excluded. Answers from active work are labelled potentially out of date. **Stop reply** leaves coordination running; stopping or redirecting the task stops both local workers. Remote completion remains unconfirmed. Replies cannot change instructions, execute commands or grant permissions, and are not verification evidence. Interrupted replies are marked failed on restart without replay. Live concurrent-provider behavior remains unverified. Changing direction still requires the explicit revised-plan action, not automatic interpretation of a question.

Local checks must be stopped separately before redirection. Remote inference may still finish or consume credits after local coordination stops. Late worker updates cannot reactivate superseded work, and normal worker/execution saves preserve recorded notes. Messages are capped at 20 per run and 2,000 characters each, with at most three chained redirections. There is no new upload, execution, application or publishing permission implied by sending a message.

Saved questions can be addressed to Maya, Ellis or Jun, or left as a general engineering reply. Selection uses the current saved teammate role and instructions, visible in the exact upload snapshot. Changing the selection clears UI consent; changing the selected profile invalidates a prepared backend approval. Reply history retains the approved identity even after later profile edits. All recipients use the same configured model and the same three-attempt budget. This is one role-focused answer, not multi-model consensus, a broadcast, or a new audit. Profile instructions cannot grant execution or publishing permission.

### Suggestions for later

The final auditor can include up to three optional improvements in its existing response, without additional model requests. They appear after the run completes or stops, in a separate panel bound to the reviewed draft revision. **Mark reviewed** persists acknowledgement only: it neither schedules work nor grants permission, changes files, or resolves findings. Required correctness/security issues still belong in findings. Suggestions are unverified model output and may be misclassified. Legacy runs without suggestions remain valid. Collecting suggestions during every teammate's work and converting them into new tasks are not implemented.

### Local operational metrics

Settings includes **Refresh local metrics**. Instrumentation uses a typed, versioned interface with injectable sinks and a no-op default outside the application wiring. The current sink is an in-memory ring capped at 1,000 events. Events older than 24 hours are removed on reads/writes; exit clears the entire window. No telemetry files, external SDK or exporter are enabled.

Each event contains only schema version, a fixed operation label, returned/threw outcome, rounded duration in milliseconds and a main-process timestamp. Unknown fields are discarded and unknown labels or invalid measurements rejected. No identifiers, prompts, source, arguments, output, paths, credentials or free-text errors are recorded. Sink exceptions and rejected promises do not change operation outcomes or trigger retries. Adapters must remain nonblocking; synchronous adapter work still executes on the calling thread.

Instrumented actions include task creation, source selection, run preparation/start/stop, coordination/session configuration, audit dispatch, finding decisions, correction preparation, command decisions, execution review/start/stop and apply review/write. These measure backend invocation time, including dialogs where present, not background task or process completion. `model.request` measures a complete provider call in the worker. Counts and means cover only the retained window. A returned action may still contain a failed business outcome; it is not a successful-test or correctness metric. Token usage, cost, detailed failure categories, process/run completion metrics and external monitoring remain future instrumentation work.

### Cloud sandbox checks

The desktop can review and submit a bounded Nebius Sandbox check for a completed run. Enter a project ID and API key, search the tagged public sandbox image catalog, and choose an image by name. Scully inspects the selected image and fills in the proposed executable path when it verifies a matching file and execute permission. If inspection cannot verify a match, enter an absolute path for review, marked as unverified. This check does not prove that runtime dependencies work. The app binds the chosen immutable image UUID to the exact command and snapshot files before a separate, one-use approval. It uploads at most 12 files and runs with no guest networking or shell. Execution is disposable by default; saving the environment is an explicit choice included in the review. It saves the operation ID and checks status up to 12 times after a confirmed submission while the panel stays open. Manual status refresh remains available. The key remains in memory, so re-enter it after a restart to refresh an existing operation. No automatic command retry or cancellation occurs. If submission times out, its outcome is unknown and you should inspect Nebius operation history before trying again. This flow has offline fixture coverage only. It has not been tested against a live Nebius account, and the app cannot verify billing or overage settings.

Choose **Save this environment for another experiment** before reviewing a check to retain its filesystem. When Nebius returns a result image, a saved-environment card becomes available for this run and code revision. A follow-up check verifies access to that image, uploads the current reviewed files over their matching paths, and inherits other saved files. Every branch has its own approval and result; the starting image is unchanged. Parent links and returned image IDs survive restart, and all branches share the five-check limit. A saved image can accompany a nonzero process exit, which remains visibly failed. An absent result image creates no new continuation point.

After two completed checks use the same project, draft revision, and starting image, **Compare sandbox checks** shows their service status, process exit, and recorded output side by side. Choose which two checks to inspect when more are available. Long output is previewed; the individual check retains the captured text. Matching captured output and a zero exit do not prove correctness. Checks from different starting images are not grouped, even when they share a parent checkpoint.

Saving retains files and installed tools, not running processes. Nebius documents 180-day checkpoint retention, after which untagged and unreferenced images may be deleted; tagged or referenced retention and deletion requirements need provider confirmation. Scully has no remote deletion control yet. See [checkpoint semantics](https://docs.tokenfactory.nebius.com/sandboxes/concepts/images-checkpoints-and-branches) and [retention guidance](https://docs.tokenfactory.nebius.com/sandboxes/operate/limits-retention-and-usage).

Operation completion is separate from process exit. Failed or uncertain submissions do not imply that no remote work happened. Returned image IDs are separate from operation IDs, and raw cost fields are not interpreted as currency. The public picker shows the first 100 tagged matches per prefix. Image inspection checks standard executable directories only. Arbitrary private image discovery, cross-run checkpoint reuse, automatic experiment selection, background status tracking across app restarts, explicit cancellation and retention controls remain future work. Cloud execution requires a user-approved transfer and is unavailable without configured credentials.

### Local execution workflow

For a specialist finding, **Prepare corrective draft** creates a separate attempt without uploading or executing anything. Review its parent draft and approve **Build and audit** separately. The attempt uses at most two requests, one corrective writer and one independent audit. Parent files not replaced by the correction remain in the combined draft, within the existing file/size limits. The original run remains unchanged, and no command, finding decision or apply permission transfers. Proposed rechecks require fresh local permission. One corrective attempt per original run is supported, without recursive correction or automatic retries. A completed audit is not a verified fix. Apply still compares against the original selected source baseline, so an already-applied parent may require a new source snapshot.

Each specialist finding has a decision review: keep unresolved, accept risk, dismiss, or resolve. A reason is required. Resolving requires one to three linked completed checks for the current finding and draft. These are user decisions, not automated proof that a fix is correct. Nonzero exits may be relevant evidence; the user must interpret the assertion and output. Timeouts, interrupted checks and stale results cannot support resolution. Reopening appends history rather than removing an earlier decision. Changed finding/revision/evidence links make previous decisions stale. New decisions invalidate previously prepared apply approvals; they never grant execution or publishing permission.

Specialist responses can propose up to three focused checks within the run's six-command total. Each links a specific finding and snapshot to expected observations. These are proposals, not validated test oracles. Empty proposals are allowed when an executable check is not meaningful. The response uses the existing specialist request allowance, without another model call.

Review and run these through the same local execution controls below. Actual output appears beside the finding, with stale evidence labelled. A zero exit does not resolve the finding. New proposals invalidate previous command approvals and execution reviews; previous results remain in history. Finding changes invalidate linked checks. No test code is added automatically and no check output is uploaded automatically.

1. For a completed draft with proposed checks, select **Review local execution**. Denied commands are unavailable.
2. Inspect the resolved executable, arguments, full working directory, timeout and revision. If the runtime is missing, Scully reports it without installing anything.
3. Check the permission box and select **Approve and run locally**. Previous review approval is insufficient. The runner rechecks files and executable content before starting, without an implicit shell or inherited credentials.
4. Watch output and inspect the recorded exit code. A zero exit code means only that the process exited successfully. Findings are not automatically resolved and output is not automatically uploaded for further model review.
5. Stop if needed. Output is capped at 64 KiB, commands at 120 seconds, and each run at 20 executions. There are no automatic retries. Restart marks unfinished executions interrupted, not passed or resumed.

Each check receives a new partial snapshot, so outputs and installed dependencies from a previous check are not reused. Programs can access local files and the network under your account permissions. The minimal environment reduces accidental credential inheritance but is not isolation. Stop requests termination of the process group on macOS/Linux and the direct process on Windows; detached descendants may survive. Windows shell shims are unsupported; direct executables are required. Runtime discovery uses the desktop app's PATH, which may differ from your terminal.

Drafts, snapshots, execution copies (under `executions/` in application data) and output remain local until manually removed; there is no retention UI yet. Preflight checks detect ordinary stale files and symlinks but do not protect against a malicious local process racing file changes. No source is automatically sent to Tavily or Sandboxes in this milestone.

### Review and apply

1. Review draft content, unresolved findings and actual check results. Local command outputs are not automatically incorporated into the draft.
2. Select **Choose destination and review**. All selected baseline files must still match. Added paths must not exist. For a new project, choose an empty folder or a destination with no conflicting paths.
3. Review the full destination and exact before/after content, then explicitly approve **Apply reviewed files**. Reviews expire after two minutes, cannot be reused, and are invalidated by changed draft or review evidence.
4. Inspect the application record. Only draft files are written; unrelated files are preserved. No deletion, commit or push occurs. Originals and a manifest are retained under `applications/` in the app's local data directory.

Multi-file application is not atomic. If a write fails or the app closes, earlier files may already be written. Inspect the destination and recovery manifest before manually restoring originals; Scully does not automatically roll back over later user changes. Failed/interrupted applications cannot silently retry the same draft. Recovery UI, automatic merging and backup retention controls remain future work. Avoid concurrent editing during application; path checks do not defeat a malicious local filesystem race.

Only macOS ARM64 is being validated at this milestone. Windows/Linux installation and signed distribution are pending. See [desktop validation](docs/desktop-validation.md) for exact checks and limits.

## Licence

Apache-2.0. See [LICENSE](LICENSE).
