# Story and Demonstration Script

**Status:** Approved at Gate G5.1

**Target duration:** 2 minutes 40 seconds

**Release candidate:** `v0.1.0-rc1`

## Core story

### Problem

Production-only failures are hard to reproduce, but giving an investigation
tool production credentials or customer data creates a second problem. An
engineer needs executable evidence, not another plausible explanation.

### Product

Scully accepts an engineer-reviewed, sanitized incident capsule. It checks the
evidence boundary, forms constrained causal alternatives, tests fixed branches
from one clean checkpoint, and compares every result with a predefined failure
signature.

### Proof

The evaluator, not the model, decides what matched. When exactly one
intervention removes the signature, Scully produces a minimal, independently
runnable reproduction package with a failing regression test and evidence
lineage.

The release demonstrates the browser workflow deterministically and retains a
successful live sponsor-stack run. Tavily found current public documentation,
Nemotron produced the structured plan, and Token Factory Sandboxes executed the
isolated branches. The same deterministic evaluator and exporter completed the
result.

### Impact

Scully is designed to help backend and reliability engineers reach a testable
witness before changing production code. The hackathon release proves the
technical workflow and safety boundary for one realistic incident. It does not
claim measured adoption, time savings, or general incident coverage.

## Timed storyboard and narration

| Time | Screen and action | Narration |
|---:|---|---|
| 0:00 to 0:18 | Title over the empty Scully intake screen | "A production-only bug leaves engineers with a bad choice: copy sensitive systems into a debugger, or settle for another theory. Scully creates executable proof without production access." |
| 0:18 to 0:38 | Select **Load safe seed**. Pause on provenance, redaction status, known-good comparison, and explicit exclusions | "The engineer starts with a reviewed capsule. Scully verifies its schema, file hashes, provenance, redaction state, and known-good evidence before an investigation can begin." |
| 0:38 to 0:55 | Briefly show the sponsor-flow diagram and the retained run 002 status | "In the live workflow, Tavily supplies current public documentation, Nemotron returns a constrained plan, and Token Factory Sandboxes run isolated branches. Every provider is bounded, and none can declare the verdict." |
| 0:55 to 1:12 | Return to Scully. Select **Create investigation** and show the three hypothesis cards | "Three mutually exclusive alternatives are linked to accepted evidence and fixed experiments. Commands, variants, and execution limits remain application-owned." |
| 1:12 to 1:45 | Select **Run 3 branches**. Let progressive events and branch states appear | "Each branch starts from one clean checkpoint. Here the controlled proxy collapses two forwarded clients into one identity, producing the same second-request rejection seen in the incident." |
| 1:45 to 2:07 | Show the completed map and supported cause | "Only trusting the known loopback proxy restores distinct client identities and removes the signature. The other interventions leave the failure reproducible, so deterministic code eliminates them." |
| 2:07 to 2:27 | Select **Review reproduction proof**. Show exact signature match, causal delta, evidence lineage, and expected test failure | "The result is not a confidence score. It is an exact signature comparison, the smallest accepted trigger, and a trace from supplied evidence through experiment to verdict." |
| 2:27 to 2:35 | Select **Download reproduction**, then cut to the prepared terminal showing `npm run verify` success and the expected `npm test` failure | "The exported package runs outside Scully. Verification succeeds, while the included regression test fails with the reproduced `200,429` response sequence." |
| 2:35 to 2:40 | Return to title and product promise | "Scully turns production evidence into an executable witness, without giving AI production access." |

## Exact seeded demonstration

### Preparation before recording

From the release-candidate checkout:

```shell
make install
make test
make typecheck
make build
make verify-reliability
make dev-api
```

Open `http://127.0.0.1:8000`. Use a fresh ignored `.scully/` state or confirm the
seed can be imported idempotently. Prepare a terminal containing the extracted
reproduction package so the final verification cut does not depend on typing
speed.

### Recorded browser actions

1. Select **Load safe seed**.
2. Point out the known-good comparison, accepted evidence, exclusions, and
   disabled external network boundary.
3. Select **Create investigation**.
4. Show the three evidence-linked alternatives and common checkpoint.
5. Select **Run 3 branches**.
6. Pause while progressive events reach the browser.
7. Show the single supported cause and two eliminated alternatives.
8. Select **Review reproduction proof**.
9. Show the exact match, causal delta, lineage, minimization result, and expected
   test-failure contract.
10. Select **Download reproduction**.

### Recorded terminal proof

Inside the extracted `scully-proxy-identity-collapse` directory:

```shell
npm ci
npm run minimize
npm run verify
npm test
```

`npm run verify` must exit successfully. `npm test` must exit with failure and
show actual responses `200,429` against expected responses `200,200`. Say
explicitly that this is the delivered failing witness, not a setup error.

## Exact sponsor evidence segment

The release video does not make a fresh provider request. It shows the immutable
successful result already produced by the frozen candidate:

```shell
python3 -m json.tool validation/results/g4.4-sponsor-002.json
```

Frame these fields together before recording:

- `status: verified`;
- Tavily `request_count: 1` and `tavily_credits: 1`;
- Nemotron `request_count: 1`, token counts, and calculated cost;
- Sandbox `sandbox_operations: 5`;
- `deterministic_evaluation: one_supported_cause`;
- `automatic_retries: 0`;
- the proof fingerprint.

Use the sponsor-flow diagram in
[`release-architecture.md`](../product/release-architecture.md) to explain why
each service is necessary. Do not imply that the browser recording itself is
contacting providers.

## Public claim evidence checklist

| Public claim | Evidence |
|---|---|
| Scully requires no production access for the demonstrated incident | Capsule execution boundary, explicit exclusions, threat-boundary diagram, and ingestion safety tests |
| Capsule evidence is checked before planning | Capsule schema, importer implementation, adversarial importer tests, and evidence-boundary events |
| Three alternatives run from one common checkpoint | Experiment plans, sibling-isolation checks, local execution tests, and browser branch map |
| Execution progress appears while branches run | Streaming execution endpoint, browser stream reader, 16-event tests, and reliability runs |
| Deterministic code owns the verdict | Evaluator implementation and matcher tests |
| The selected incident is realistic and independently runnable | Separate Express and loopback proxy fixture, Gate G4.1 record, and reproduction verification |
| The reproduction package includes a failing regression test | Exporter tests, package manifest, `npm run verify`, and expected `npm test` failure |
| Tavily, Nemotron, and Sandbox completed the workflow | Immutable run `g4.4-sponsor-002` result and Gate G4.4 record |
| Provider use was bounded and did not retry | Run 002 measurements, sponsor preflight, and provider-client configuration |
| The release is repeatable locally | Two-run reliability fingerprint and clean-checkout record |
| The workflow completes within the demo budget | Local subsecond measurements and approximately 24.64 seconds of live provider-stage time |
| Out-of-pocket infrastructure cost remained zero | Disabled Tavily pay-as-you-go control, free-credit confirmation, promotional Nebius balance, and bounded run records |

Do not claim proven root cause, fix correctness, production safety for arbitrary
incidents, measured engineer time savings, customer adoption, or general
language and framework support.

## Demonstration fallback plan

### Provider or network failure

Do not run providers during the main recording. Use the immutable run 002 result
and the deterministic browser path. If sponsor evidence cannot be displayed,
show the sponsor-flow diagram and Gate G4.4 measurement table.

### Browser or server failure

Restart `make dev-api`, reload `http://127.0.0.1:8000`, and repeat the seed path.
If the browser remains unavailable, run:

```shell
PYTHONPATH=src .venv/bin/python scripts/verify-local-reliability.py
```

Then show the verified fingerprint and the prepared reproduction terminal.

### Event-stream interruption

Create a fresh investigation and rerun the deterministic branches. Do not resume
or rewrite a terminal investigation. If recording time is limited, use a clean
second take rather than splicing inconsistent investigation IDs.

### Download or archive failure

Use the reviewed reproduction source at
`fixtures/reproductions/proxy-identity-collapse` and run `npm ci`,
`npm run minimize`, `npm run verify`, and `npm test`. Explain that the packaged
download is covered separately by exporter and clean-checkout evidence.

### Timing overrun

Remove cursor narration and secondary UI detail first. Preserve the problem,
safety boundary, sponsor roles, progressive branches, deterministic verdict,
independent failing test, and closing promise.
