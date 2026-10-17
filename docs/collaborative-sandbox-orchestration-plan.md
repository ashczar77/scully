# Collaborative sandbox orchestration plan

Status: agreed product direction, proposed technical design, implementation pending.

Handoff note: this plan does not itself authorize implementation or cloud spending. Start implementation only when the user explicitly asks to proceed. Inspect the repository and current Git state before changing code. Preserve unrelated work, and do not treat this document as evidence that any proposed behavior is already working.

Scully is a desktop workspace where a team can plan, build, test, review, and discuss a software project with its user. The selected local project folder is the project's source of truth. When Nebius Sandboxes are configured, an approved build should use independent, branchable sandbox environments so teammates can work at the same time, inspect each other's progress, resolve dependencies, and recover from failures. A local-only option must remain available for projects the user does not want uploaded.

This document records the agreed behavior and the work needed to deliver it. Descriptions under **Current state** describe the existing application. The other sections describe the target design and are not claims of implementation.

## Product decisions

- The Room is a real team conversation. Teammates ask direct questions, answer one another, and report observed progress. Dialogue is not assembled from preset handoff lines or fixed numbers of exchanges.
- Questions to the user appear in the Room, with a badge on the asking teammate. A question has an explicit pending, answered, or withdrawn state so the badge clears for the right reason. The user can answer naturally without numbering responses or addressing only Pearl.
- Pearl coordinates planning, dependencies, and the team. She does not claim to write code, start building while still planning, or dispatch a team before its proposal is ready for review. She asks no more than two related user questions at once and includes recommendations.
- Every active or newly dispatched teammate participates in the same communication, checkpoint, visibility, and recovery system. Approved role permissions determine whether a teammate can edit, execute, advise, test, or audit.
- A configured Nebius Sandbox is the default collaborative build environment. Local-only work is an explicit alternative. The selected local folder stays authoritative; sandbox branches are isolated work environments, not replacement projects.
- The user can see each teammate's sandbox activity, changed files, checks, and checkpoints. Selecting a file opens it in a central preview or editor while the file list remains available.
- A failed step preserves useful work, states what is known, and offers relevant ways forward. It does not invent a cause or leave the task at a dead end. A stalled agent can be paused with **Continue** and **Redirect** actions. Unaffected agents may continue.
- Scully imposes no default lifetime model-request count. User-set limits and usage alerts remain available. Automatic retries are bounded by progress, repetition, permission, and spending guards.
- Model selection lives in Settings. Pearl defaults to Nemotron 3 Super; builders, testers, auditors, and each specialist default to Nemotron 3.5 Lightning. A searchable model modal shows the two recommendations first, then all returned models, with incompatible models disabled and explained. Each member can have an appropriate thinking preset.
- The Room renders supported Markdown as formatted content, preserving paragraphs and lists. It does not flatten newlines or rely on growing lists of regex substitutions to make model text readable. Names, portraits, and send times are separate from message bubbles; teammate bubbles have distinct colors, sufficient spacing, and clickable profiles.

### Defaults and exceptions to settle in code

| Situation                                                              | Expected default                                                                                                                                                     |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nebius Sandboxes are configured and the project scope is approved      | Use a branchable sandbox build. Show the approved upload manifest and the selected local folder.                                                                     |
| Nebius is not configured, unavailable, or its limits prevent the build | Explain the observed condition and offer configure, retry when safe, or an explicitly chosen local-only run. Never silently change execution or data boundaries.     |
| The selected folder is not a Git repository                            | Files and workspaces still function. Changes offers Git setup or help from Pearl; it does not invent commit history.                                                 |
| A selected model lacks a capability needed by its role                 | Disable that choice with a reason or ask for another model. Do not silently substitute a different model or advertise thinking controls the provider ignores.        |
| A user edits the local folder during a build                           | Continue isolated branch work when safe, then detect the new local revision before synchronization and present a merge decision. Never overwrite that edit silently. |
| One teammate waits for a peer or user answer                           | Keep independent teammates working. Show the pending dependency and question owner.                                                                                  |
| Token use, Sandbox price, or account limit is unavailable              | Say unknown or unavailable. Never display zero or claim that available credits guarantee the next operation.                                                         |

## Current state and gap

Today, coordinated writers are started in parallel from the same selected source, but each makes a one-shot model request for complete file contents. They cannot inspect or modify files during that request, publish an intermediate result, or ask another teammate a question. After a response, Scully writes the proposed files into separate local folders and integrates only when writers finish. If a writer returns no files, the current error asserts that missing requirements need clarification without evidence. See [`src/engine/loop.ts`](../src/engine/loop.ts) and [team coordination guidance](using-scully.md#team-coordination).

Nebius Sandboxes currently support optional checks after a draft. A saved result image can be used as the starting point for another check, but this path is not the active builder workspace. The current cloud check has limits designed for that narrow operation, not for a full project build. See [`src/engine/sandbox.ts`](../src/engine/sandbox.ts), [`src/main/cloud-manager.ts`](../src/main/cloud-manager.ts), and [cloud sandbox checks](using-scully.md#cloud-sandbox-checks). Existing offline fixture coverage does not establish live Nebius build behavior; [desktop validation](desktop-validation.md) records that gap.

The target design replaces one-shot file proposals with tool-using agents that can inspect, edit, run permitted checks, and continue from results. It retains backend-enforced permissions, revision binding, independent review, and user control over consequential actions.

## Remove scripted and brittle interaction rules

This is a repository-wide migration requirement, not a prompt wording change. Before implementing the new runtime, inventory rules in prompts, backend orchestration, shared helpers, UI rendering, tests, and documentation. For each rule, record its purpose and classify it as **remove**, **replace with explicit state or a standard parser**, or **retain as a justified boundary**. Remove superseded paths when the replacement is verified; leaving both active would preserve the old behavior and make failures hard to diagnose.

The initial inventory must include the phrase-specific dialogue repair and numbered-answer matching in [`src/shared/plan-conversation.ts`](../src/shared/plan-conversation.ts), keyword-based direction detection in [`src/shared/message-intent.ts`](../src/shared/message-intent.ts), fixed response templates and one-shot file contracts in [`src/engine/loop.ts`](../src/engine/loop.ts), and Markdown stripping or partial regex rendering in [`src/renderer/RichText.tsx`](../src/renderer/RichText.tsx). Audit the rest of the repository for equivalent behavior rather than treating these files as the complete list.

Remove text-replacement and regex chains that try to interpret or rewrite the meaning of user or teammate messages. Do not repair a model reply by deleting phrases such as "before I start coding," changing "the user wants" to "you'd like," matching only numbered answers, or inferring a user's intent from a few opening keywords. Those techniques have caused lost formatting, repeated questions, false routing, and misleading claims. A new wording failure must not be handled by adding one more substitution.

Replace those heuristics with durable question and decision records, model reasoning over relevant conversation and artifacts, explicit tool results, and clarification when meaning is uncertain. Keep the original message content intact in the conversation record. Replace canned start, handoff, and failure messages with real event state plus agent-authored conversation where a reply is needed. Use a maintained Markdown parser and safe rendering policy for model text; do not strip Markdown into plain text, flatten structured text, and then try to repair every observed wording pattern. Remove limits that exist only because a writer must return whole files in one response, such as the current small file and output contracts, as the tool loop takes over. Evaluate each remaining resource limit against actual service constraints and runaway protection instead of carrying forward arbitrary counts.

Keep deterministic checks where correctness or security requires them: schema and path validation, role and tool permissions, revision binding, one-use approvals where required, provider compatibility, idempotency, and rolling spending or no-progress guards. These rules constrain actions, not what a teammate may naturally say or how many useful exchanges can occur. The user's preference for no more than two related questions at once is a presentation and pacing rule, not a lifetime conversation cap.

Completion requires tests with previously unseen, unnumbered user replies, questions from different teammates, changed decisions, overlapping work, varied Markdown, and recoverable provider failures. Tests must prove the new state and tool flow works; they should not merely encode another list of phrases to replace. Verify that ordinary message text reaches the Room without semantic cleanup, and that Markdown is parsed and rendered safely instead of displayed raw or removed with regex. Remove or update old tests and user documentation only when their acceptance criteria have intentionally changed, and record the reason.

## Core architecture

### Project source and branch lifecycle

1. Before a build, Scully inspects the selected local checkout or project folder and records a base revision and an upload manifest. The right-hand Files view shows that folder immediately, including before any agent writes a file. Ignored files, secrets, and material outside the approved scope are excluded from upload.
2. With configured Nebius Sandboxes and an approved upload and execution scope, Scully prepares a base image containing the approved project snapshot and required tooling. It records the immutable image UUID, manifest hashes, project identity, and effective permissions.
3. Each approved teammate who needs write access starts from an appropriate checkpoint on an independent branch. Subsequent saved operations advance only that branch. Read-only teammates can inspect an immutable checkpoint without gaining write authority. A teammate joining mid-task starts from a current, relevant checkpoint and receives the latest task decisions, not just the original prompt.
4. Each agent can publish an inspectable checkpoint before its assignment is complete. The checkpoint carries parent image, owner, file manifest, diff, checks, and status. Other teammates can inspect it, ask about it, or incorporate it into their own branch under their permissions.
5. An integration workspace combines compatible changes as they become ready. Conflicting edits are reported with exact paths and revisions to the responsible owners. An owner can revise their branch; no branch silently wins by finishing last. The tester and auditor can inspect integrated checkpoints while other approved work continues.
6. Scully synchronizes a reviewed integration to the selected local folder with preflight checks against the recorded base and any intervening user edits. It presents conflicts rather than overwriting user changes. The local Git history remains real Git history; Nebius image branches are execution checkpoints, not Git commits.

Nebius defines a branch as an independent operation from an immutable image. Saved images preserve files and installed dependencies, but not processes, memory, or live services. Scully therefore needs its own durable branch graph, file exchange, and merge logic; the sandbox service does not provide a shared writable checkout or resolve Git conflicts for the team. See [Nebius images, checkpoints, and branches](https://docs.tokenfactory.nebius.com/sandboxes/concepts/images-checkpoints-and-branches) and the [ConTree SDK session model](https://github.com/nebius/contree-sdk#core-concepts).

### Agent runtime and communication

Each teammate has a persistent task thread and a bounded tool loop. A model can request an authorized action, receive its result, inspect the changed workspace, and decide what to do next. The runtime preserves conversation state across calls and can resume from a checkpoint after interruption. A model response is a proposal, never permission to expand its scope.

A durable task event stream connects the Room, agent threads, branch state, and audit history. Messages have an actor, recipient or audience, task and branch revision, timestamp, message type, and references to any relevant file, diff, check, question, or checkpoint. Their natural-language content remains flexible. The backend validates routing and permissions; it does not prescribe the words or count of teammate exchanges. Agents can message peers directly, while Pearl sees enough of the exchange to manage dependencies without becoming a bottleneck. The user sees meaningful discussion in the Room and can open detailed activity when needed.

Task decisions and interface contracts are versioned shared state. Each agent receives the relevant decisions and a precise checkpoint reference, while keeping its own working context. Switching models does not transfer a model's hidden state; Scully must explicitly provide the teammate's thread, current decisions, and referenced artifacts. If a decision changes, dependent work is marked stale and the affected agents are notified.

Questions are first-class records with an owner, recipient, status, and resolution linked to a user or teammate message. A teammate should ask another teammate when that person can answer from implementation evidence. Product choices, changed scope, permissions, additional spending, publication, and acceptance of risk go to the user. User replies can be conversational; resolution should be based on meaning and explicit linkage, with clarification when an answer remains ambiguous. The badge clears only when the question is resolved or withdrawn.

For example, Maya can publish a storage interface checkpoint and ask Jun to check a behavior. Jun can inspect it, run or adapt tests, and ask Maya about an ambiguity while she continues implementing. If either needs an authentication product decision, that question goes to the user. This is concurrent work with communication, not two isolated requests that happen to start together.

### Durable records and concurrency contract

The backend should persist a task record, approved scope and base manifest; one thread and inbox per teammate; messages and question resolutions; branch heads and their immutable parent image UUIDs; sandbox operation IDs and outcomes; integration revisions; review findings; and local synchronization results. Every message, check, approval, and merge decision references the revision it concerns. Persist an event before presenting it as complete in the UI. A restart reconstructs the Room and each branch from these records rather than re-running model actions.

Only one mutating operation may advance a particular branch head at a time. Different branches can advance concurrently within the account-effective Nebius limits and the user's approved resource policy. An agent may inspect another branch's published checkpoint, but never mutate that checkpoint or assume unpublished work is visible. Importing another agent's work creates a new revision on the recipient or integration branch. Keep the parent and imported revision IDs so stale reads and conflicting updates can be detected.

Each tool action has a recorded actor, scope, input revision, operation ID or idempotency key where available, and terminal outcome. A timed-out submission is **uncertain**, not automatically failed; reconcile its operation status before retrying. A saved result image is usable only after it is returned and inspectable, including when the command itself exited nonzero. A missing result image leaves the previous known-good checkpoint as the continuation point. These conditions follow Nebius's [result-image guidance](https://docs.tokenfactory.nebius.com/sandboxes/concepts/images-checkpoints-and-branches#interpret-the-result-image).

Sandbox visibility means immediate start, status, and completion events, followed by file and diff inspection when a result image becomes available. It does not promise per-keystroke visibility into an operation or a live shared filesystem. The UI must label the local folder, each agent branch, and the integration workspace so users know where a displayed file actually exists.

### Dispatch applies to the whole team

The dispatcher can bring in any approved builder, tester, auditor, or specialist when their skills are relevant. Pearl may recommend a new teammate with a reason, intended scope, context to be shared, tool permissions, and spending impact. The user reviews any expansion of the approved lineup or authority. Dispatch then joins the current work, using its latest relevant checkpoint and decisions.

All teammates can communicate and expose progress. Edit and execution rights remain role- and task-specific. A specialist can advise, investigate, or review without an automatic right to alter production files. An auditor remains independent of changes it reviews. A teammate may request an additional capability, but the backend must enforce the resulting decision; a message or prompt cannot grant it.

## Visibility in the desktop app

- **Room:** user and teammate messages, direct questions, decisions, substantive work milestones, and recoverable pauses. A short typing transition may improve readability, but it reflects a real pending event; Scully does not insert artificial dialogue or a minimum delay.
- **Activity:** each active teammate's current model request or tool operation, elapsed time, sandbox operation status, checks, checkpoints, and failures. Start and finish events appear even if an operation produces no files. The display distinguishes observed activity from a claim that work succeeded.
- **Files:** the selected local folder, integration workspace, and each teammate's branch are clearly identified. The file list updates when a sandbox result becomes inspectable. A file opens centrally with source, revision, and diff context; it does not imply that an unmerged branch file is already on the user's disk.
- **Changes:** actual Git branches, commits, and working-tree changes from the selected local repository. When no repository is configured, the page offers setup or help from Pearl. Sandbox checkpoint lineage is available as task activity rather than being mislabeled Git history.
- **Settings:** per-member models and thinking presets, advanced output controls, usage and spending settings, and the searchable model catalog. Output allowance is chosen for the model and task by default; an advanced override remains possible.

The Room composer must remain focusable and editable in planning, running, paused, and failed states unless an explicit, visible permission boundary blocks sending. Saving a planning temperature should show a padded, styled, temporary confirmation rather than a permanent "Saved" label beside the button. Failure diagnostics must be available in the app and in privacy-safe local logs; an empty terminal must not be the only explanation for a stopped task. The existing Chromium disk-cache messages require separate diagnosis and must not be presented as the cause of a model or build failure without evidence.

## Failure handling and recovery

An operation failure is not automatically a task failure. Scully records what was attempted, what completed, what is uncertain, and the latest usable revision. It pauses only the affected dependency unless other work cannot safely continue. The Room offers actions grounded in that evidence.

| Observed condition                                                      | Default response                                                                                      | User path when needed                                              |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Response truncated at the model output allowance                        | Preserve prior checkpoint; retry or continue with an appropriate allowance and smaller step when safe | Continue or redirect the agent                                     |
| Response contains no file change and no blocking question               | Ask the agent to inspect its tool results and state its next step; do not infer missing requirements  | Continue, redirect, or reassign after repeated lack of progress    |
| Recoverable provider or transport error                                 | Retry with bounded backoff only when duplicate work cannot cause harm                                 | Continue when retry allowance or service availability is exhausted |
| Sandbox submission outcome unknown                                      | Inspect operation history and status before resubmitting; never assume it failed                      | Inspect status, then choose a safe continuation                    |
| Command or test fails                                                   | Preserve output and checkpoint; let the responsible agent investigate and communicate with teammates  | Redirect or accept a documented limitation where permitted         |
| Branches conflict or a dependency changes                               | Keep both branches and identify exact files, owners, and revisions                                    | Ask owners to reconcile, choose a direction, or revise scope       |
| Agent repeats an unproductive action or spends rapidly without progress | Pause that agent and retain all inspectable work                                                      | Continue or Redirect with a concise explanation                    |
| App closes or worker stops                                              | Recover durable task, branch, and operation records; reconcile any uncertain remote operation         | Resume from the last verified checkpoint                           |

Automatic recovery uses error type, idempotency, observed progress, and rolling resource usage. It does not impose a small default lifetime request cap or allow an agent to loop indefinitely. Unknown token or sandbox cost is displayed as unknown, never zero. A failed check is not a verified fix, and a successful process exit is not proof of task correctness.

Track task status separately from teammate status. A task can be running while one teammate is waiting for a peer, awaiting the user, or paused for lack of progress. A teammate's recoverable failure does not mark the whole task failed. The task pauses only when a required dependency cannot proceed safely. **Continue** resumes from a recorded checkpoint after showing the cause and likely cost; **Redirect** records new guidance and sends it to the affected teammate without erasing branch history. Reassignment starts a new authorized teammate from a specified checkpoint. None of these actions replays an uncertain external operation blindly.

Diagnostics must separate provider rejection, output truncation, invalid tool arguments, permission denial, sandbox service failure, command exit, integration conflict, and local synchronization failure. Show the responsible teammate, stage, last verified revision, observed error code, and available actions. Keep full sensitive request and command content out of operational telemetry and default terminal logs; diagnostic access must follow the project's privacy controls.

## Permissions, privacy, and operational defaults

The default configured build should feel continuous after the user has reviewed the project upload scope and authorized the task's model and sandbox work. Routine actions inside that approved scope do not need a fresh modal for every request. Permission expansions, destructive or external actions, changed upload scope, new teammates with broader authority, and material spending changes require review. The backend binds authority to the task, actor, tool, project, revision, and scope; UI controls alone do not enforce it.

Sandbox work is isolated from the local host, but uploaded files and operation metadata are remote. Before upload, inspect paths and file types, exclude secrets and unneeded content, and display the manifest. Never place credentials in saved sandbox files, environment metadata, commands, model prompts, or diagnostic output. Local-only execution must be clearly labeled because local copies and processes are not security sandboxes. Check account-effective Nebius concurrency, retention, and usage limits rather than assuming published beta limits apply to every account. See [Nebius security and data handling](https://docs.tokenfactory.nebius.com/sandboxes/operate/security-and-data-handling) and [limits, retention, and usage](https://docs.tokenfactory.nebius.com/sandboxes/operate/limits-retention-and-usage).

Use a small, versioned, vendor-independent telemetry interface with injectable sinks. Capture bounded counts, durations, outcomes, retries, pause reasons as codes, and branch/checkpoint counts. Keep prompts, source, responses, command text, credentials, and absolute user paths out of operational metrics. Telemetry failure must not alter permissions or fail a task. Local trace records can hold detailed diagnostics under separate retention and privacy rules. External telemetry remains disabled by default.

## Implementation and validation gates

The order below creates a working vertical slice before broadening roles and UI. Every behavior change needs requirement-derived tests, including invalid input, failure, permission, restart, and stale-revision cases. Existing failures must not be hidden by weakening tests.

1. **Rule inventory and replacement map.** Find scripted conversation, phrase repair, output-shape workarounds, arbitrary counts, and hard-coded handoffs across the repository. Specify what replaces each one and what safety invariants remain. No conversational patchwork should be added to the old path.
2. **Durable task state and agent messages.** Model actor threads, questions, decisions, branch references, and recoverable status. Prove a user reply resolves the correct teammate question without numbered-answer matching or a hard-coded Pearl route.
3. **Tool-using runtime.** Replace one-shot whole-file proposals with inspect, edit, check, checkpoint, and message actions. Prove an agent can read the result of a write and continue; handle truncated output and no-change responses without false diagnoses.
4. **Branchable sandbox workspace.** Snapshot an approved local project, start two branches from one immutable image, save and inspect their independent results, and recover from a failed or uncertain operation. Verify upload boundaries and checkpoint lineage in the backend.
5. **Concurrent coordination and integration.** Let builders, testers, and dispatched specialists exchange references and messages while working. Integrate published checkpoints, detect overlap and stale bases, and return conflicts to their owners. Preserve independent audit authority.
6. **Desktop visibility and conversational presentation.** Show live operation status, branch files, questions, badges, central file preview, rendered Markdown, and contextual recovery actions. Validate keyboard access, focus, and restart behavior.
7. **Defaults and operational controls.** Add per-member model and thinking settings, a complete compatible-model catalog, model-aware output allowance, rolling progress and spending guards, and local-only mode. Validate that ordinary approved work proceeds without repetitive prompts while expanded authority still requires review.
8. **Legacy-path removal.** Delete superseded phrase repair, canned dialogue, one-shot file contracts, and related limits after the new behavior passes the acceptance gates. Confirm no runtime path silently falls back to them.

Each gate requires the complete default suite, type/build and formatting checks, relevant desktop and package smoke tests, and a security review of changed boundaries. A live Nebius acceptance path is required before claiming sandbox collaboration works end to end; offline provider fixtures alone are insufficient. Report passed, failed, and skipped checks separately.

### End-to-end acceptance scenario

A user selects a local repository and approves a collaborative build. Maya and Jun start from the same base image. Maya edits an interface and publishes a checkpoint while Jun writes tests. Jun inspects Maya's change, asks her a question, and receives an answer without stopping the task. A relevant specialist joins mid-work with approved scope, inspects the current checkpoint, and shares a finding. Maya revises her branch; Jun runs tests against an integrated checkpoint; Ellis reviews that exact revision. The Files view shows each branch's files and the integrated result. After preflight and review, the selected local folder contains the integrated changes. A deliberately failed sandbox operation leaves the team with a usable checkpoint and a clear Continue or Redirect path.

### Execution handoff and definition of done

The first end-to-end milestone, built through the small reviewable gates above, should prove a complete path through the architecture rather than merely add another UI panel or prompt. It must start from a selected local project, obtain the required scope approval, create one inspectable Nebius base image, run two teammate branches concurrently, publish an intermediate checkpoint, exchange a teammate message tied to that checkpoint, inspect a file and check result, integrate without silent overwrite, and show the result and a recovery action in the Room. A local-only fixture should exercise the same orchestration contract without paid services. Broaden role dispatch and polish after this milestone works.

Before any gate is called complete, verify all of the following:

- Previously unseen user wording and unnumbered answers route to the correct open question or trigger a clarification. No phrase replacement is required for the case to pass.
- Teammates can ask and answer one another more than once, exchange current checkpoint evidence, and continue working while unrelated branches advance.
- A newly dispatched teammate receives current decisions and the correct revision, while backend authority remains limited to the role and reviewed scope.
- The Room shows real activity and formatted Markdown, the composer works, question badges clear on recorded resolution, and Files distinguishes local, agent, and integrated versions.
- Truncation, no-change output, command failure, conflict, unknown Sandbox submission, and app restart preserve usable work and present accurate next actions. No test treats an unknown outcome as a known failure.
- A changed local file, stale branch, forged path, denied action, and unapproved upload cannot be applied or executed through direct backend calls even if UI controls are bypassed.
- Live Nebius acceptance confirms checkpoint creation, independent branches, inspection, and recovery with the real service. Record the account and service limits observed, without exposing credentials or project contents. If that check is skipped, label the gate unverified rather than complete.
- The old one-shot file proposal, semantic regex cleanup, canned dialogue, and arbitrary request/file ceilings are no longer reachable in the new flow. Any retained legacy path is named, justified, and kept out of the default workflow.

## Engineering references

The sources below inform the design; they do not establish that Scully already implements it or reveal another product's complete internal retry policy.

- [Nebius images, checkpoints, and branches](https://docs.tokenfactory.nebius.com/sandboxes/concepts/images-checkpoints-and-branches), [sandbox limits and retention](https://docs.tokenfactory.nebius.com/sandboxes/operate/limits-retention-and-usage), and [ConTree SDK examples](https://github.com/nebius/contree-sdk): immutable image branching, persistence choices, inspection, and service boundaries.
- [Claude managed-agent orchestration](https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration) and [Microsoft multi-agent patterns](https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/multi-agent-patterns): distinct agent contexts, explicit handoffs, routing, and coordination patterns.
- [OpenHands architecture](https://github.com/OpenHands/docs/blob/main/openhands/usage/architecture/backend.mdx), [Aider's coder loop](https://github.com/Aider-AI/aider/blob/main/aider/coders/base_coder.py), [SWE-agent](https://github.com/SWE-agent/SWE-agent/blob/main/sweagent/agent/agents.py), and [Gemini CLI core client](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/core/client.ts): implementation examples of iterative tool use and recovery. Their exact policies must be evaluated for Scully's permissions and provider behavior.
- [IBM multi-agent orchestration](https://www.ibm.com/think/insights/boost-productivity-efficiency-multi-agent-orchestration), [Kimi multi-agent overview](https://www.kimi.ai/resources/multi-agent), [FME multi-agent systems guide](https://fme.safe.com/guides/ai-agent-architecture/multi-agent-systems/), [CoSupport collaboration overview](https://cosupport.ai/articles/multi-agent-systems-orchestration-communication-collaboration), and [multi-agent orchestration research](https://arxiv.org/html/2601.13671v1): additional patterns and tradeoffs, not product-specific guarantees.
