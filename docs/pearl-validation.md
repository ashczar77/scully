# Pearl validation status

Status: active development. Deterministic tests and a connected desktop fixture verify the Room protocol, storage, approvals, file tools, and recovery. They do not establish that a live model handles a user's full task well.

## Required connected journey

A release candidate must pass a human-reviewed Room journey using the configured Nebius model and a disposable project. The journey includes an ordinary unrelated question, a project discussion, a linked answer, a changed requirement, a substantive plan, file changes, command approval and denial, a check of the resulting application, restart, and recovery from an interrupted or failed turn. Additional unfamiliar tasks must test whether Pearl generalizes beyond one example. Review the visible replies and the resulting application, including browser actions for a web app. Record failures and skipped checks as open items.

An earlier live journey passed its structural script in 12 model requests and recovered after a restart and an intentional provider failure. Pearl answered an unrelated question, revised a plan after changed requirements, created six files, and ran 14 passing production-logic tests. An independent browser run added books from both form inputs with Enter, changed status, opened help, and retained books after reload without page errors.

Human review found two defects in that journey. Pearl listed first-release requirements as unfinished but marked its local prototype `done`; the backend accepted that contradictory completion. The generated app's add form was visible on initial load because its CSS overrode the HTML hidden state. The backend now rejects `done` when the completion action lists remaining work. The Room browser tool now retains initial and intermediate hidden-state defects even if later interactions remove them.

A later lower-cost model trial handled discussion and planning, then exhausted its request budget while coding. The harness interrupted an approved command; this has been corrected so the budget applies before the next model request. The saved disposable project has 27 passing and 7 failing local tests. Pearl also changed its implementation stack after presenting a plan without explaining the change. The runtime now retains Pearl's recent stated approach alongside earlier user requirements during long action histories; a new live run has not verified that this prevents the observed drift. Browser, restart, and recovery stages did not run in that trial. The connected gate is still open.

## Local checks

Run `npm test`, `npm run typecheck`, `npm run build`, and `npm run format:check` at an implementation gate. Run `npm run test:desktop` when the Room or privileged bridge changes. On macOS, run `npm run package` and `npm run test:package:mac` to verify the packaged app. The opt-in `SCULLY_LIVE_TEST=1 npm run test:live:pearl` uses a locally configured Nebius key and saves its transcript in ignored local test results. It asks Pearl to inspect and repair the generated page through the Room browser tool, then runs an independent static browser check for page errors and HTML hidden-state violations. Inspect the full transcript and exercise the generated app before treating a script exit as acceptance.

Current open engineering work includes model-aware context management, stronger command isolation, browser support for live applications, and connected verification of the full conversation and coding journey. A passing command or provider response is evidence of that action only.
Pearl now has a bounded browser tool for static pages in an approved project. It has passed a connected desktop fixture for input, keyboard behavior, pointer clicks and covered targets, startup hidden-state defects, script errors, blocked external requests, and symlink rejection. Its behavior with the live model and dynamically served apps remains unverified.
