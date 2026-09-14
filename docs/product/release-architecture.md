# Release Architecture

**Status:** Approved at Gate G4.5

**Version:** `0.1.0-rc1`

## Runtime shape

Scully has two controlled entry points over shared contracts:

1. The browser product uses deterministic local planning and a reviewed local
   execution fixture. It requires no provider credential and is the reliable
   demonstration path.
2. The sponsor runner uses Tavily for source discovery, Nemotron for structured
   planning, and Token Factory Sandboxes for isolated branches. It is disabled
   by default and requires an exact approved run identifier plus manual cost
   confirmations.

Both paths end at the same deterministic evaluator and reproduction exporter.
Neither provider can decide that a cause is supported or that a reproduction
is valid.

## Component architecture

```mermaid
flowchart LR
    U[Engineer] --> B[React browser]

    subgraph Local product process
        B --> A[FastAPI boundary]
        A --> I[Capsule and investigation services]
        I --> LP[Deterministic local planner]
        I --> LE[Reviewed Node execution fixture]
        I --> DB[(SQLite metadata and events)]
        I --> FS[(Content-addressed artifacts)]
        LE --> E[Deterministic evaluator]
        E --> X[Reproduction exporter]
    end

    U --> R[Explicit sponsor runner]

    subgraph Sponsor services
        R --> T[Tavily source discovery]
        T --> N[Nemotron structured planning]
        N --> S[Token Factory Sandbox branches]
    end

    S --> E
    X --> Z[Runnable reproduction ZIP]
    Z --> U
```

## Product data flow

```mermaid
sequenceDiagram
    actor Engineer
    participant Browser
    participant API
    participant Intake
    participant Planner
    participant Executor
    participant Evaluator
    participant Exporter

    Engineer->>Browser: Load reviewed capsule
    Browser->>API: Import seed or bounded ZIP
    API->>Intake: Validate schema, files, digests, and safety
    Intake-->>Browser: Sanitized incident overview
    Engineer->>Browser: Create investigation
    Browser->>API: Request bounded plan
    API->>Planner: Supply accepted evidence metadata
    Planner-->>API: Three constrained alternatives
    Engineer->>Browser: Run three branches
    Browser->>API: Open execution stream
    API->>Executor: Start fixed branches from common checkpoint
    Executor-->>Browser: Progressive bounded events
    Executor->>Evaluator: Normalized observations
    Evaluator-->>API: One supported cause or inconclusive result
    API-->>Browser: Persisted terminal proof
    Engineer->>Browser: Download reproduction
    Browser->>API: Request package
    API->>Exporter: Verify lineage, integrity, and safety
    Exporter-->>Engineer: Runnable ZIP
```

## Sponsor data flow

```mermaid
flowchart TD
    P[Read-only preflight] --> G{Every gate ready?}
    G -- No --> Stop[Stop before client construction]
    G -- Yes --> Q[One Tavily basic search]
    Q --> C[Canonicalize and deduplicate sources]
    C --> M[One forced Nemotron tool call]
    M --> V[Validate fixed slots, evidence IDs, and content]
    V --> W[Normalize confidence weights]
    W --> SB[One parent and three Sandbox branches]
    SB --> D[Deterministic signature evaluation]
    D --> O{Exactly one supported cause?}
    O -- No --> Fail[Terminal inconclusive result]
    O -- Yes --> Pack[Verify and export reproduction]
```

Every provider stage has a fixed request or operation cap, a 60-second timeout,
and zero application retries. A failure ends the run and requires a new reviewed
identifier.

## Trust and threat boundaries

```mermaid
flowchart LR
    subgraph Untrusted inputs
        C[Capsule archive]
        TS[Tavily source metadata]
        MO[Nemotron tool arguments]
        SO[Sandbox observations]
    end

    subgraph Validation boundary
        IV[Schema, path, hash, size, and secret checks]
        PV[Tool schema, fixed slots, evidence allowlist, and output scan]
        EV[Command allowlist, result envelope, operation and output limits]
    end

    subgraph Trusted authority
        AP[Application-owned policies]
        DE[Deterministic evaluator]
        PE[Package integrity and safety checks]
    end

    C --> IV --> AP
    TS --> PV
    MO --> PV --> AP
    SO --> EV --> DE
    AP --> DE --> PE
    PE --> R[Released reproduction]

    Secrets[Credentials in ignored local environment] --> AP
```

The browser never receives provider credentials. Capsule data, public-source
metadata, model output, and Sandbox output remain untrusted until their local
contracts pass. Only application-owned code selects commands, maps variants,
evaluates matchers, and releases a package.

## Persistence and recovery

- SQLite stores normalized investigation state and ordered audit events.
- Evidence files use content hashes under ignored local storage.
- Streaming progress is delivered during local execution, while the persisted
  event endpoint remains available for audit replay.
- Terminal investigations cannot be rewritten or resumed.
- Recovery starts a new investigation after the cause of failure is reviewed.
- Provider execution results are retained only as bounded measurement and
  evidence records approved for the repository.

## Release deployment boundary

The release candidate is a local single-user product. FastAPI serves the built
frontend from one process, and the demonstration runs on loopback. Public
hosting, remote user data, and production credentials are not required for the
submission proof and remain outside the frozen scope.
