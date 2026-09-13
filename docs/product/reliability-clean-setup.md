# Reliability and Clean Setup

**Status:** Step 4.4 in progress

**Verification date:** 2026-09-12

## Outcome so far

The deterministic product path passes two independent runs from separate
temporary databases and produces one equivalent proof fingerprint. The exact
tracked revision also passes a clean-checkout installation, the full backend
and frontend suites, type checking, production build, dependency integrity,
closed provider preflight, and the same two-run proof check.

The sponsor-backed product path is implemented and passes offline with injected
provider boundaries. Live execution has not been approved or attempted. Gate
G4.4 remains open until the reviewed live evidence is complete.

## Independent local runs

Run:

```shell
make verify-reliability
```

The verifier performs the real seeded API flow twice. Each run uses a separate
temporary database and investigation identifier, consumes all 16 progressive
execution events, creates a reproduction ZIP, checks every packaged file
against its declared SHA-256 digest and size, and computes a normalized proof
fingerprint.

Run-specific identifiers and timestamps are excluded from the fingerprint.
The supported cause, signature, execution facts, incident fidelity, result,
minimization decision, file list, and file digests remain included.

| Measure | Working directory run 1 | Working directory run 2 | Clean checkout run 1 | Clean checkout run 2 |
|---|---:|---:|---:|---:|
| Total flow | 380.153 ms | 254.365 ms | 301.051 ms | 246.477 ms |
| Progressive events | 16 | 16 | 16 | 16 |
| Package size | 17,248 bytes | 17,248 bytes | 17,247 bytes | 17,248 bytes |
| Provider requests | 0 | 0 | 0 | 0 |
| Provider credits | 0 | 0 | 0 | 0 |

All four runs produced proof fingerprint
`6fa6502664e882e0f978466f2fe2bf5df5dbf89b4dbca8da668fb6fabcbd5cd5`.
Small compressed-size variation is permitted because the manifest contains a
different run identifier. The normalized proof content must remain identical.

## Clean-checkout result

Revision `44f0507` was exported as tracked files into an empty temporary
directory. The audit first verified that `.env`, `AGENTS.md`, `.scully`, local
virtual environments, built frontend output, and dependency directories were
absent.

The reviewer sequence then passed with Python 3.14.6, Node.js 22.22.2, and npm
10.9.7:

```shell
make install
make test
make typecheck
make build
make verify-reliability
.venv/bin/python -m pip check
PYTHONPATH=src .venv/bin/python -m scully.preflight
```

Results:

- 176 backend tests passed;
- 7 frontend tests passed;
- both npm dependency trees reported zero vulnerabilities;
- type checking and the production build passed;
- Python reported no broken requirements;
- all live provider gates remained closed;
- the clean-checkout proof fingerprint matched the working-directory result.

The clean-checkout temporary directory was removed after verification.

## Sponsor-backed product path

The explicit sponsor path performs these stages in order:

1. Tavily runs one basic search restricted to `expressjs.com`, reports usage,
   canonicalizes URLs, removes tracking parameters and fragments, and
   deduplicates equivalent sources.
2. Canonical source titles and URLs are added to the Nemotron prompt as bounded,
   untrusted research context. Snippet content is not added.
3. Nemotron makes one forced structured tool call. The result must contain three
   evidence-linked hypotheses whose confidence sums to one and exactly one of
   each approved experiment variant.
4. Token Factory Sandboxes resolves one fixed base image, prepares one common
   parent, and runs three fixed Python branches. No shell, package installation,
   external sandbox network request, model-written command, production data, or
   customer data is used.
5. Deterministic matcher code selects the supported cause. The provider cannot
   declare the verdict.
6. Export succeeds only after one supported cause exists and every packaged
   file passes the safety and integrity checks.

The default `make sponsor-preflight` path performs no provider calls and does
not construct clients. Live execution additionally requires an exact approved
run identifier that matches the command argument.

## One-run live budget

| Boundary | Maximum |
|---|---:|
| Nemotron completion requests | 1 |
| Nemotron calculated worst-case cost | $0.00289152 |
| Nemotron hard cost cap | $0.01 |
| Tavily searches | 1 |
| Tavily credits | 1 |
| Sandbox counted operations | 5 |
| Timeout per provider operation | 60 seconds |
| Application retries | 0 |

The read-only preflight confirms that the three credentials, exact SDK
versions, and exact operation budgets are ready. It also confirms the previously
reported $25 Nebius balance is above the two-run model-cost cap.

Live execution remains blocked until both of these facts receive explicit
review:

1. Tavily paid-overage status is confirmed in the account dashboard. The
   installed SDK exposes per-request usage but no account billing-status method.
2. The Sandbox result cost unit remains undocumented. A reviewer must accept
   that uncertainty for one bounded run before execution.

## Sandbox retention policy

Each reviewed product run may create one parent and three untagged child states.
They contain fixed synthetic code and data only. Scully does not tag, reuse, or
publish them, and local references are dropped when the run ends. No production
data, customer data, credential, uploaded artifact, or external sandbox network
request is allowed.

The installed SDK exposes no public delete method. Routine or broader Sandbox
use remains blocked until Nebius documents retention or a supported cleanup
mechanism. The bounded hackathon run must record four resulting state identifiers
as observed without retaining their values.

## External-service recovery

The live runner has no automatic retry. It stops at the first failed Tavily,
Nemotron, Sandbox, deterministic-evaluation, or export stage and emits only a
bounded stage reason code. Provider messages and response content are not
written to the result.

Recovery requires these steps:

1. Leave the failed run terminal and preserve its redacted measurement.
2. Check service availability, account limits, and the relevant credential or
   contract without widening the approved budget.
3. Correct the cause locally and rerun the offline boundary suite.
4. Request a new review with a new exact run identifier.
5. Start a fresh investigation. Never resume or silently retry the failed run.

Provider timeouts plus local deadlines remain the initial cancellation fallback.
Explicit remote cancellation remains known technical debt, and no new
termination probe is authorized.

## Remaining Gate G4.4 evidence

1. Confirm Tavily overage status.
2. Review the Sandbox unknown-cost-unit exception for one bounded run.
3. Approve and execute sponsor run `g4.4-sponsor-001` only.
4. Review its redacted result before any second run.
5. If approved, execute `g4.4-sponsor-002` under the same limits.
6. Compare the two sponsor proof fingerprints, latency, failure rate, token use,
   credits, Sandbox operation count, and reported cost.
