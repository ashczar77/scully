# Scully Product Foundation

**Status:** Implemented for Gate G2.1 review

**Implementation date:** 2026-09-11

## Outcome

Step 2.1 establishes a runnable offline product foundation. It adds the
backend application, durable local schema, internal domain contracts, browser
shell, and repeatable development commands needed for the first vertical
slice.

No live provider client is created during application startup or health
checks. Nemotron, Tavily, and Sandbox access remain disabled by default.

## Delivered foundation

### Backend application

- A FastAPI application factory initializes local product state during its
  lifespan.
- `GET /api/health` reports application and database readiness without
  exposing environment details.
- The backend serves the compiled browser application from the same origin
  when `web/dist` exists.
- Local storage locations are configurable through `SCULLY_DATA_DIR` and
  `SCULLY_WEB_DIST`.

### Domain contracts

Strict, immutable Pydantic contracts cover:

- capsule summaries and sanitized evidence references;
- hypotheses and bounded experiment plans;
- investigation and experiment states;
- ordered investigation events;
- deterministic reproduction verdicts and results.

The contracts reject unknown fields and use an explicit `1.x` schema version.
The published `capsule.json` JSON Schema and its seeded proxy-identity capsule
are Step 2.2 deliverables under the approved implementation architecture.

### Persistence

SQLite schema version `1` includes normalized tables for capsules, evidence,
investigations, hypotheses, experiments, events, and results. Initialization
is idempotent, foreign-key checks are enabled per connection, and write-ahead
logging is configured for the local product process.

Generated database files and artifacts live under ignored `.scully/` storage
by default.

### Browser application

The React and TypeScript shell provides:

- local runtime readiness from the typed health response;
- a clear incident-reproduction product boundary;
- a preview of the proxy identity collapse investigation;
- visible statements that providers are disabled and verdicts are
  deterministic;
- a disabled capsule-import action that becomes active in Step 2.2.

### Development workflow

The root `Makefile` provides separate commands for installation, backend and
frontend tests, type checking, production builds, and both development
servers. Python and frontend dependencies are pinned, and the frontend lockfile
supports deterministic installation with `npm ci`.

## Verification

The implementation was checked with:

```text
make test
make typecheck
make build
.venv/bin/python -m pip check
python -m compileall -q src tests
npm --prefix web ci
```

The complete suite passed with 117 Python tests and one browser component test.
The production frontend build completed successfully. A local end-to-end smoke
check confirmed that the API reported ready SQLite state and served the built
browser application from `http://127.0.0.1:8000`.

## Deliberate exclusions

Step 2.1 does not include:

- capsule ZIP or directory ingestion;
- the public capsule JSON Schema;
- the seeded capsule files;
- application workflow services or server-sent events;
- live Nemotron, Tavily, or Sandbox calls;
- provider cancellation changes.

These exclusions preserve the approved gate sequence. Gate G2.1 approval
authorizes only Step 2.2, safe seeded capsule ingestion.
