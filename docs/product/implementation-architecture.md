# Scully Implementation Architecture

**Status:** In review at Gate G1.4

**Review date:** 2026-09-11

## Objective

Turn the Phase 1 feasibility harness into a working product without adding
infrastructure that does not directly support the hackathon demonstration.

The first vertical slice must load the seeded proxy-identity incident, create
an investigation, expose its evidence and hypotheses, run deterministic local
experiment fixtures, and display the reproduction verdict. Sponsor providers
will then replace local planning, research, and execution adapters behind the
same application contracts.

## Architecture decisions

| Area | Decision | Reason |
|---|---|---|
| Backend language | Python 3.12 | Reuses the proven provider adapters and ConTree SDK boundary |
| API framework | FastAPI | Provides typed HTTP and streaming endpoints with a small application surface |
| Domain models | Pydantic models plus versioned JSON Schema | Keeps validation and published capsule contracts aligned |
| Frontend | React with TypeScript and Vite | Supports the investigation timeline and branch comparison interface |
| Node.js role | Frontend build and test tooling only | The application server and provider orchestration remain Python |
| State store | SQLite through the Python standard library | Provides durable local state without an external database or ORM |
| Artifact store | Content-addressed files under ignored `.scully/` storage | Keeps evidence and exports out of database rows and Git |
| Live updates | Server-sent events | Fits a server-to-browser event stream without WebSocket coordination |
| Background work | One bounded in-process worker | Avoids Redis and a separate queue while preserving concurrency limits |
| Production shape | One backend process serving the built frontend | Minimizes deployment and same-origin configuration |

JavaScript and Node.js now have a specific role: building and testing the
interactive browser interface. They are not requirements for incident
capsules, backend orchestration, or Sandbox execution.

## Component boundaries

### Web application

The browser application owns presentation state only. It can import a capsule,
start and inspect an investigation, display evidence and experiment branches,
consume ordered events, and request exports.

It cannot decide that a reproduction succeeded, construct unrestricted shell
commands, access provider credentials, or read capsule files directly.

### HTTP and event API

The API validates requests, calls application services, returns read models,
and streams persisted events. It does not contain provider-specific request
logic or deterministic matcher logic.

The first product endpoints are:

| Method and path | Purpose |
|---|---|
| `GET /api/health` | Local readiness without provider access |
| `POST /api/capsules/import` | Validate and import one capsule |
| `GET /api/capsules/{id}` | Return the sanitized capsule summary |
| `POST /api/investigations` | Create an investigation from a capsule |
| `GET /api/investigations/{id}` | Return the current investigation read model |
| `POST /api/investigations/{id}/start` | Start the bounded workflow |
| `GET /api/investigations/{id}/events` | Stream ordered server-sent events |
| `GET /api/investigations/{id}/result` | Return the deterministic result |

### Application services

Application services coordinate capsule import, investigation creation,
hypothesis planning, experiment scheduling, deterministic evaluation, and
result export. They depend on project-owned interfaces for planning, research,
execution, persistence, events, time, and identifiers.

### Domain core

The domain core owns versioned models and state transitions for capsules,
evidence, investigations, hypotheses, experiment branches, ordered events,
failure signatures, deterministic verdicts, and reproduction packages.

The existing deterministic evaluator and experiment lifecycle move into this
core only when a product use case needs them. They retain sole authority over
final reproduction verdicts.

### Provider and execution adapters

The existing Nemotron, Tavily, and Sandbox adapters remain behind narrow
interfaces. The product initially uses deterministic local adapters to prove
the application flow without credentials, spend, or remote execution.

Sponsor adapters are enabled one at a time after the local vertical slice is
working. Provider credentials never enter the browser, capsule, generated
command, or exported artifact.

### Persistence and artifacts

SQLite stores normalized metadata, state transitions, and ordered events. File
artifacts use content hashes as names under `.scully/artifacts/`. Database rows
store the hash, media type, byte size, provenance, and redaction status instead
of unrestricted paths.

Every event is written before it is streamed. A reconnecting browser supplies
the last received event number and receives missing events in order.

## Data flow

1. The user imports a directory or ZIP archive containing `capsule.json` and
   declared evidence files.
2. Ingestion validates paths, sizes, hashes, media types, and the manifest
   before copying accepted files into local artifact storage.
3. The API creates an investigation from the sanitized normalized capsule.
4. The planning adapter returns constrained hypotheses with evidence
   references and allowlisted experiment plans.
5. The scheduler creates branches from a common checkpoint and enforces fixed
   operation, duration, output, and concurrency limits.
6. The execution adapter emits normalized events and observations.
7. Deterministic matcher code compares each observation with the fixed failure
   signature and known-good case.
8. The application persists the verdict, lineage, measurements, and export
   manifest before the UI presents the result.

## Capsule schema direction

The canonical capsule is a directory or ZIP archive with `capsule.json` at its
root. The manifest uses a required `schema_version` and contains:

- a stable capsule identifier and title;
- a sanitized incident summary containing observed facts only;
- a deterministic failure signature made from allowlisted matcher types;
- an optional known-good signature or comparison observation;
- environment facts represented as names and sanitized values;
- an evidence index with relative path, SHA-256 hash, byte size, media type,
  provenance, and redaction status;
- declared execution requirements without credentials or host paths;
- import limits and exclusions.

Version `1.0` supports the proxy-identity fixture. Unknown major versions,
absolute paths, parent traversal, undeclared files, hash mismatches, oversized
content, unsupported media types, and detected credentials fail closed.

## State and event contracts

An investigation moves through `draft`, `ready`, `running`, `completed`,
`failed`, `timed_out`, or `termination_unconfirmed`. Only application services
may change state, and terminal states cannot be rewritten.

The initial ordered event types are:

- `investigation.created`;
- `capsule.accepted`;
- `planning.started` and `planning.completed`;
- `hypothesis.created`;
- `experiment.queued`, `experiment.started`, and `experiment.finished`;
- `evaluation.completed`;
- `investigation.completed`, `investigation.failed`, or
  `investigation.timed_out`.

Every event includes an investigation-local sequence number, UTC timestamp,
type, schema version, and bounded payload. Events never include credentials,
raw provider responses, or unrestricted command output.

## Timeout and cancellation fallback

The first product version does not depend on proven explicit cancellation.
Remote commands receive provider-enforced timeouts, while the application uses
a separate local deadline and stops scheduling new work after it expires.

If a terminal provider state cannot be confirmed by the local deadline, the
experiment becomes `termination_unconfirmed`. That state is never interpreted
as a successful reproduction. Best-effort exact-ID cancellation can be added
later behind a separate feature flag and review.

## Initial repository shape

```text
src/scully/
    api/
    application/
    domain/
    infrastructure/
    providers/
web/
    src/
    tests/
schemas/
fixtures/
tests/
    api/
    application/
    domain/
```

The product foundation must not perform a broad mechanical rewrite of the
proven feasibility code.

## First vertical-slice backlog

### Step 2.1, product foundation

1. Add the backend application factory, health endpoint, and configuration.
2. Add SQLite schema initialization and repository contracts.
3. Add the React and TypeScript application shell with a typed API boundary.
4. Add repeatable install, test, build, and local-run commands.
5. Prove a clean offline startup and submit Gate G2.1.

### Step 2.2, safe seeded capsule

1. Publish capsule schema version `1.0`.
2. Convert the proxy-identity fixture into a valid seeded capsule.
3. Implement bounded import, hash verification, path controls, and redaction
   status.
4. Display the accepted capsule summary and rejected-input reasons.
5. Submit Gate G2.2 before planning work.

### Steps 2.3 through 2.5, complete path

1. Implement deterministic local hypotheses and evidence references, then
   replace the planner with the bounded Nemotron adapter at Gate G2.3.
2. Implement local branch events and evaluation, then replace execution with
   the bounded Sandbox adapter at Gate G2.4.
3. Produce and run the first proxy-identity reproduction package, measure the
   complete flow, and submit Gate G2.5.

Each numbered project step retains its existing review gate. Approval of Gate
G1.4 authorizes Step 2.1 only.

## Risks and controls

| Risk | Initial control | Fallback |
|---|---|---|
| Frontend setup consumes too much time | One route and one read model in Step 2.1 | Serve a minimal static interface from FastAPI |
| In-process worker is interrupted | Persist state and events before work | Mark running work interrupted on restart |
| SQLite write contention | One bounded worker and short transactions | Serialize writes through one repository lock |
| Capsule scope expands | Version `1.0` supports one seeded incident | Reject unsupported fields and versions |
| Provider integration destabilizes the app | Local adapters remain the default | Demo the deterministic local path |
| Explicit cancellation remains uncertain | Provider timeout plus local deadline | Record `termination_unconfirmed` and stop new work |
| Sponsor cost is unclear | Preserve existing request and operation caps | Keep provider features disabled by default |

## Phase 1 exit criteria

- The stack and component ownership are explicit.
- The product can be built without Redis, an external database, or cloud
  deployment.
- The capsule direction covers the selected incident without embedding one
  language into the platform contract.
- The deterministic evaluator remains the only reproduction authority.
- Provider credentials stay at the backend edge.
- The cancellation limitation has a safe initial fallback.
- Step 2.1 is small enough to begin immediately and requires no live provider
  call.
