# Reliability and Clean Setup

**Status:** Approved at Gate G4.4

**Verification date:** 2026-09-14

## Outcome so far

The deterministic product path passes two independent runs from separate
temporary databases and produces one equivalent proof fingerprint. The exact
tracked revision also passes a clean-checkout installation, the full backend
and frontend suites, type checking, production build, dependency integrity,
closed provider preflight, and the same two-run proof check.

The sponsor-backed product path passes offline with injected provider boundaries
and passed live as corrective run `g4.4-sponsor-002`. Failed run 001 remains
preserved without retry. Gate G4.4 is ready for review.

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
3. Nemotron makes one forced structured tool call with three application-owned
   experiment slots. Each slot accepts one evidence-linked hypothesis and a
   confidence weight. The application fixes the variant mapping and normalizes
   the weights into a valid distribution.
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

Live execution remains blocked until these facts receive explicit review:

1. Tavily pay-as-you-go is confirmed disabled in the account dashboard.
2. At least one free Tavily credit is confirmed remaining for the single
   approved search. The installed SDK exposes per-request usage but no account
   billing-status or remaining-credit method.
3. The Sandbox result cost unit remains undocumented. A reviewer must accept
   that uncertainty for one bounded run before execution.

With pay-as-you-go disabled, Scully cannot create a Tavily charge after the free
allowance is exhausted. The run has no automatic retry and must fail closed if
Tavily rejects the single search.

## Sponsor run 001 result and correction

Approved run `g4.4-sponsor-001` executed once on 14 September 2026. Tavily
completed its single bounded search and returned accepted sources. Nemotron
planning then failed with the retained reason `nemotron_stage_failed`. The
runner stopped immediately, made no automatic retry, and started no Sandbox
operation.

The retained reason proves the stage but is too broad to distinguish a provider
request failure, response-shape failure, or product-planning validation failure.
It also does not retain the successful Tavily measurement or any Nemotron usage
that may have preceded local validation. The failed result therefore makes no
exact latency or cost claim.

Offline review found two product constraints that were validated locally but
were not structurally guaranteed in the model response: using every experiment
variant exactly once and making confidence values sum to one. The correction:

1. defines three named experiment slots whose variant mapping is owned by the
   application;
2. accepts bounded confidence weights and normalizes them locally;
3. limits evidence references in the tool schema to the accepted capsule IDs;
4. maps provider, response-contract, planning-contract, rate-limit, timeout, and
   configuration failures to distinct safe reason codes.

Run 001 remains unchanged. Any corrective attempt requires a fresh run ID,
another free-credit confirmation, a passing offline suite, and explicit review.

## Sponsor run 002 result

Corrective run `g4.4-sponsor-002` executed once on 14 September 2026 and passed
the complete sponsor-backed product path:

| Stage | Result | Measured use | Duration |
|---|---|---:|---:|
| Tavily source discovery | Succeeded | 1 search, 1 free credit | 2.663827 s |
| Nemotron planning | Succeeded | 1 request, 1,739 input and 3,622 output tokens | 13.422531 s |
| Sandbox branch lifecycle | Succeeded | 5 operations | 8.549539 s |
| Deterministic evaluation | One supported cause | Local calculation | Included above |
| Reproduction export | Succeeded | 17,260 bytes | Included above |

Nemotron's calculated cost was $0.00097362 from the promotional balance. The
Sandbox response reported cost `0.00216227`; its unit remains undocumented, so
the record does not label that value as currency. The Sandbox also reported
0.191441 seconds of elapsed execution time and zero CPU seconds.

The run used five canonical Express documentation sources, made no automatic
retry, and produced proof fingerprint
`b069de521c89492585facefacd10498ea3c91053c83430773acb0b7915b1cf0a`.
The result retains no source snippets, generated hypothesis text, provider
messages, credentials, or Sandbox state identifiers.

This single live success satisfies the release proof's sponsor-stack execution
requirement. Repeatability is established separately by the two independent
local product runs with equivalent deterministic proof. No additional live run
is required for Gate G4.4.

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

1. Review the immutable failed run 001 and successful corrective run 002.
2. Confirm the local two-run proof and clean-checkout evidence remain sufficient
   for repeatability and reviewer setup.
3. Approve Gate G4.4 and move directly to Step 4.5 feature freeze.
4. Do not authorize another provider run unless a release blocker requires new
   evidence and receives a separate review.
