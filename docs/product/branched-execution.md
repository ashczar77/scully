# Branched Execution and Signature Matching

**Status:** Implemented for Gate G2.4 review

**Implementation date:** 2026-09-11

## Outcome

Scully can execute all three planned proxy-identity experiments from one clean
local checkpoint, verify sibling isolation, evaluate every result against the
capsule's fixed failure signature, persist the terminal state, and display the
supported cause in the browser.

The working path is deterministic and local. It starts a reviewed Node.js
process directly, without a shell, and binds one Express application plus one
reverse proxy to temporary loopback ports. It makes no external network
request, constructs no provider client, and spends no credits.

## Local execution model

The executor reopens the accepted environment and request evidence from the
content-addressed artifact store. It verifies byte size and SHA-256 before
parsing either file. The fixed checkpoint contains:

- the two synthetic TEST-NET-2 clients;
- proxy trust disabled;
- the identity-based limiter setting;
- one baseline isolation marker.

Each experiment receives a deep copy of that checkpoint. The executor applies
only the exact parameter map already approved during planning and adds one
branch-specific marker. It then invokes one fixed, reviewed Node.js entry point
with the allowlisted variant as its only argument. It never executes text from
the capsule or planner.

The entry point starts a separate loopback reverse proxy and Express
application. Test clients send a project-defined identity marker to the proxy.
The proxy validates that marker, writes `X-Forwarded-For`, and forwards the
request to Express. This preserves the trusted-hop boundary instead of letting
the test client inject the application-facing forwarding header.

The three local variants produce these deterministic observations:

| Variant | Result | Hypothesis disposition |
|---|---|---|
| `trust-loopback` | Two distinct identities and responses `200,200`; failure signature does not match | Supported |
| `preserve-forwarded-chain` | Both requests still resolve to the loopback identity and responses `200,429`; signature matches | Eliminated |
| `per-request-identity` | The normalized request identity is still loopback and responses remain `200,429`; signature matches | Eliminated |

This establishes one supported causal alternative for the sanitized realistic
case. It does not claim that the same conclusion applies to an unsanitized
production incident.

## Deterministic evaluation

The capsule signature is translated into the existing evaluator contract
before branch execution. Every required `equals` and `same_value` matcher uses
AND semantics. The evaluator produces:

- a canonical observation digest;
- one bounded result per matcher;
- `reproduced`, `not_reproduced`, or `inconclusive`;
- no authority for a planner or branch payload to declare its own verdict.

For the planned intervention experiments, a non-matching failure signature
supports the hypothesis prediction. A matching signature eliminates that
hypothesis and records `failure_signature_still_reproduced` as its reason.

## Isolation, limits, and failure behavior

The product enforces:

- exactly three unique experiment IDs;
- one common checkpoint;
- the `local_fixture` executor only;
- three exact variant and parameter combinations;
- at most four declared operations per experiment;
- a maximum 60-second local deadline;
- zero automatic retries;
- no new branch after the local deadline is reached.

Isolation verification requires every completed branch to contain the
baseline marker and its own marker while excluding sibling markers. Timeout
results are explicit and evaluator-inconclusive. Failed Sandbox-wrapper
branches are also explicit and are never retried.

Explicit remote cancellation remains technical debt. The initial provider
fallback remains the proven provider timeout plus the local deadline. No
additional termination probe is authorized.

## Optional Sandbox boundary

`SandboxExecutionAdapter` implements the same application execution contract
but is not instantiated by the product. It can call the existing bounded
Sandbox branch adapter only with:

- the fixed `python:3.12-slim` image;
- a fixed checkpoint preparation command;
- one fixed Python executable and fixed simulation program;
- the three already-validated variant names;
- no planner-provided executable, arguments, image, timeout, or budget.

Its output must be bounded JSON, branches must return in the requested order,
and child image identifiers must be unique and different from the parent.
Malformed output and failed branches remain bounded failures. Using this live
path still requires a separate execution review and configuration change.

## Persistence and event stream

Execution completes through one SQLite transaction. It updates the
investigation and experiment states, writes the complete execution report,
and appends 16 events to the six planning events:

1. execution start and checkpoint creation;
2. start, allowlisted operation, result, and evaluation for each branch;
3. isolation verification;
4. terminal investigation status.

The 22-event sequence is contiguous. The API exposes the complete ordered
history as a replayable `text/event-stream` response at
`GET /api/investigations/{investigation_id}/events`.

Step 2.5 added a separate live execution endpoint at
`POST /api/investigations/{investigation_id}/execute/stream`. It emits progress
as execution happens and terminates with the persisted investigation. The
replay endpoint remains available for later audit. See the
[end-to-end proof](end-to-end-proof.md).

## Browser behavior

The investigation view now provides a **Run 3 branches** action. After the
bounded run it shows:

- a supported or eliminated disposition on every hypothesis;
- whether the failure reproduced in each branch;
- the single supported cause;
- isolation status, operation count, and retry count;
- the expanded persisted event timeline.

## Verification coverage

Tests cover:

- three normal local branches and the selected cause;
- exact repeatability with a deterministic timer;
- common-checkpoint sibling isolation;
- failure-signature matches and non-matches;
- local deadline behavior and stopping new work;
- zero retries;
- unallowlisted variants and excess operation budgets;
- artifact hash tampering;
- fixed Sandbox commands and branch order;
- malformed Sandbox output and failed branches;
- atomic execution persistence and one-time execution;
- API execution and event-stream replay;
- browser execution and cause display.

## Known limitations

1. Local branch execution covers the selected realistic Express incident only.
   It is not a general executor for arbitrary capsule code.
2. Live Sandbox execution, timeout repeatability, and state cleanup remain
   unproven in the product path.
3. Explicit remote cancellation remains unproven and no further termination
   probe is approved.
4. Sandbox retention policy and the provider-reported cost unit remain
   unresolved.
5. Nemotron needs further product-path repeatability evidence.
6. Tavily needs URL deduplication and an overage-status check before expanded
   use.
