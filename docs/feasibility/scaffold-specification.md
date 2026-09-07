# Phase 1 Feasibility Scaffold Specification

**Status:** Approved at checkpoint G1.2a

**Review date:** 2026-09-07

## Objective

Create the smallest reusable project structure needed to implement and measure
the Step 1.2 sponsor capability proofs. The scaffold is an engineering harness,
not the product application.

## Why Python for this step

The official ConTree SDK is Python-native, and Sandbox execution is the least
portable sponsor integration in the current stack. A Python harness lets the
project test that boundary directly with minimal glue code.

This choice applies only to Phase 1 orchestration. It does not select the later
web framework, frontend language, application API, state store, or the
languages allowed inside incident capsules.

## Proposed structure

```text
pyproject.toml
src/
    scully/
        __init__.py
        config.py
        measurement.py
        providers/
            __init__.py
            nemotron.py
            tavily.py
            sandbox.py
tests/
    test_config.py
    test_measurement.py
    providers/
        test_nemotron.py
        test_tavily.py
        test_sandbox.py
```

The initial scaffold will not add a web application, database, background job
system, capsule schema, or production deployment configuration.

## Component responsibilities

### Configuration

`config.py` will:

- read configuration from environment variables;
- validate required names without printing secret values;
- distinguish offline tests from explicitly enabled live probes;
- fail before a network call when required configuration is missing;
- expose bounded run settings such as model, token, operation, credit, and
  timeout caps.

### Provider boundaries

Each provider module will expose a narrow project-owned interface and keep
vendor request and response details at the edge:

- `nemotron.py` will support one bounded structured-output tool-calling probe;
- `tavily.py` will support one basic retrieval with URL provenance and reported
  credit usage;
- `sandbox.py` will support an explicit lifecycle covering image selection,
  execution, branching or an approved equivalent, comparison, and cleanup.

The feasibility harness will use the official `tavily-python` SDK with a
separately configured `TAVILY_API_KEY`. The existing CLI OAuth session remains
useful for local research, but it will not become an application runtime
dependency. No Tavily provider implementation or live SDK call is authorized
until the project key and account usage controls pass review.

### Measurement

`measurement.py` will define a redacted record for:

- provider and operation type;
- UTC start and end time;
- latency and terminal status;
- model tokens and calculated cost when applicable;
- Tavily credits when applicable;
- Sandbox operation count and available resource metrics;
- retry, timeout, cancellation, and rate-limit outcomes.

Records must exclude credentials, full prompts, full retrieved documents,
account identifiers, and sensitive capsule content.

## Dependency policy

- Use a standard `pyproject.toml` with an explicit supported Python version.
- Add only libraries required by the first approved provider implementation.
- Use the official ConTree SDK for Sandbox access.
- Use an OpenAI-compatible client for Token Factory unless a smaller maintained
  HTTP dependency is justified during implementation review.
- Use the official `tavily-python` SDK for the Tavily provider.
- Pin direct dependency ranges tightly enough for repeatable installation and
  record resolved versions in the selected lock mechanism.
- Keep development dependencies limited to formatting, static checks, and
  tests needed by the gate.

## Safety and cost boundaries

- Live execution is disabled by default.
- Offline tests must never require network access or real credentials.
- Each live provider call requires an explicit opt-in and declared budget.
- The Step 1.2 execution preflight must be approved before any live model call
  or Sandbox operation.
- Token Factory calls use bounded output tokens and `service_tier=default`.
- Tavily defaults to basic search with automatic depth selection disabled.
- Tavily requests keep queries below 400 characters, omit generated answers and
  raw page content by default, request usage metadata, and preserve each result
  URL for provenance.
- Sandbox work uses an explicit session key, one mutating operation at a time,
  bounded timeouts, and cleanup in failure paths.
- Secrets remain in the ignored local `.env` or tool-managed profiles and never
  enter fixtures, logs, measurements, or Git.

## Implementation sequence and review gates

1. Create the package structure, configuration loader, and offline tests.
2. Review the scaffold and offline test results before provider code proceeds.
3. Implement provider adapters with mocked contract tests.
4. Review the execution preflight and bounded budgets.
5. Run one primitive at a time, record measurements, and review each result.
6. Submit the combined capability evidence to Gate G1.2.

Each numbered step pauses for project-owner review. A later step is not
authorized by approval of an earlier step.

## G1.2a acceptance criteria

- The structure is minimal and supports all three required sponsor primitives.
- Python is scoped to the feasibility harness and does not predetermine the
  product frontend or capsule language.
- Configuration fails closed and never prints secrets.
- Offline tests can run from a clean checkout without service access.
- Live calls require explicit opt-in and approved budgets.
- Measurements support the latency, reliability, and usage evidence required by
  Gate G1.2.
- Tavily uses the official Python SDK and keeps its API key in the ignored local
  environment.
- No implementation file is created until this specification is approved.

## Review decision requested

Checkpoint G1.2a approved this scaffold specification on 7 September 2026 and
authorized implementation sequence item 1. Provider implementation and live
infrastructure use remain unauthorized pending their later reviews.
