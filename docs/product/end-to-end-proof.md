# First End-to-End Reproduction Proof

**Status:** Implemented for Gate G2.5 review

**Implementation date:** 2026-09-11

## Outcome

Scully now completes the seeded proxy-identity investigation from accepted
capsule to downloadable reproduction. The local product validates and stores
the evidence, creates three competing hypotheses, streams branch progress as
execution happens, selects one supported cause through deterministic signature
matching, and packages a runnable Express regression test.

The complete path is local and deterministic. It does not construct a live
provider client, make a provider request, or use credits.

## Product flow

1. The browser imports the `proxy-identity-collapse` seed through the public
   capsule API.
2. The planner creates three evidence-linked causal alternatives and three
   allowlisted experiments.
3. The browser opens `POST /api/investigations/{id}/execute/stream` and renders
   each server-sent event before the terminal investigation payload arrives.
4. The executor runs the three branches from isolated copies of one checkpoint.
5. The evaluator identifies disabled proxy trust as the only supported cause.
6. The completed map exposes **Review reproduction proof** only when one cause
   is supported.
7. The proof connects the original and reproduced signatures to the causal
   delta, evidence lineage, test contract, and archive manifest.
8. The proof exposes the primary **Download reproduction** action.
9. The ZIP contains a pinned Express project, the observed failure, a known-good
   comparison, an intentionally failing regression test, and a verification
   command.

The persisted replay endpoint remains available at
`GET /api/investigations/{id}/events`. It is separate from the live execution
stream and supports later inspection of the full timeline.

## Progressive delivery

The live execution endpoint starts work in a bounded worker and passes
application-owned progress events through a queue to the HTTP response. The
stream emits 16 progress messages in execution order, followed by exactly one
`complete` message containing the persisted investigation. A bounded `error`
message terminates the stream if execution fails.

The browser reads and parses response chunks incrementally. During execution it
shows the latest event and the number received. The frontend test supplies
delayed SSE chunks and verifies that `execution.started` is displayed before
the final supported cause. This resolves the earlier replay-only limitation.

## Reproduction package

The package uses Node.js 22.22.2 and Express 5.2.1. It binds to loopback and
sends two local requests with distinct synthetic TEST-NET-2 forwarded client
addresses. With Express proxy trust disabled, both requests resolve to the same
limiter identity and return `200,429`. With loopback proxy trust enabled, the
same requests resolve separately and return `200,200`.

The packager copies only seven allowlisted files, rejects symlinks or missing
files, caps the archive at 2 MiB, records SHA-256 hashes, and uses fixed ZIP
timestamps and permissions. Equal completed investigations therefore produce
identical archive bytes. Dependencies and local state are excluded.

The included regression test expects `200,200` and intentionally exits with
status 1 against the reproduced incident. `npm run verify` proves the incident,
the known-good comparison, and that exact failing-test exit code.

## Clean-checkout verification

Requirements:

- Python 3.12 or later;
- Node.js 22.22.2;
- npm 10 or later.

From a clean checkout:

```shell
make install
make test
make typecheck
make build
make dev-api
```

Open `http://127.0.0.1:8000` and select these actions in order:

1. **Load safe seed**
2. **Create investigation**
3. **Run 3 branches**
4. **Review reproduction proof**
5. **Download reproduction**

Extract the downloaded ZIP, enter its
`scully-proxy-identity-collapse` directory, and run:

```shell
npm ci
npm run observe
npm run verify
npm test
```

`npm run verify` must exit 0. The final `npm test` command must exit 1 and show
actual responses `200,429` where the regression expectation is `200,200`. That
failure is the delivered executable witness, not a setup failure.

The same API flow can be measured from a fresh temporary database without
starting a server:

```shell
PYTHONPATH=src .venv/bin/python scripts/measure-local-flow.py
```

## Measurement

One clean run on 2026-09-11 produced:

| Measure | Result |
|---|---:|
| Total API flow | 57.751 ms |
| Capsule import | 10.375 ms |
| Planning | 2.914 ms |
| Execution stream | 5.921 ms |
| Package generation | 2.671 ms |
| Progressive execution events | 16 |
| Reproduction ZIP | 11,888 bytes |
| Provider requests | 0 |
| Provider credits used | 0 |

Latency is a local development-machine observation, not a service-level
guarantee. The measurement script creates a new temporary database for every
run and reports the current result as bounded JSON.

## Known limitations and retained work

1. The product planner and branch executor are deterministic local
   implementations for one seeded incident. Live Nemotron planning and live
   Sandbox execution remain separately gated.
2. Nemotron needs further product-path repeatability evidence.
3. Tavily needs URL deduplication and an overage-status check before expanded
   use.
4. Sandbox needs a retention policy and clarification of its reported-cost
   unit before routine product use.
5. Explicit remote cancellation remains known technical debt. No further
   termination probe is approved. Provider timeouts plus local deadlines remain
   the initial fallback.
6. Live provider timeout repeatability and deterministic evaluation of live
   observations remain unproven.
7. The reproduction currently covers one Express proxy-trust incident and does
   not yet generalize to arbitrary capsules.
