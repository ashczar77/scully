# Safety and Operational Hardening

**Status:** Implemented for Gate G4.3 review

**Implementation date:** 2026-09-12

## Outcome

Scully now applies one shared sensitive-content policy at capsule intake,
structured planning output, and reproduction export. Audit events accept only
known event types and exact payload shapes. Insufficient evidence blocks
planning, and an unsafe or unexpected execution failure closes the affected
investigation with a bounded, redacted terminal record.

The implementation remains local. It does not construct a live provider
client, make a provider request, or use credits.

## Shared sensitive-content boundary

The intake and export paths now use the same detection policy for private-key
markers, common credential families, bearer-style tokens, credential-bearing
URLs, password or secret assignments, and local user paths.

Capsule content is scanned before accepted artifacts are stored. Structured
planner output is scanned before hypotheses are mapped into product-owned
plans. Every allowlisted reproduction source file and the generated result
manifest are scanned immediately before ZIP construction. Export also rejects
null bytes and non-UTF-8 source.

This provides defense in depth. A value that passes one boundary is checked
again before it can enter a public artifact.

## Adversarial input and planning controls

The capsule suite now covers absolute POSIX paths, Windows paths, parent-path
segments, null bytes, duplicate entries, symlinks, undeclared files, malformed
JSON, non-finite values, incorrect media types, hash mismatches, oversized
input, and credential patterns.

Incident text remains JSON-delimited and labeled as untrusted data in the
planning prompt. Planner responses cannot introduce commands, executors, tool
fields, evidence outside the accepted capsule, or experiment variants outside
the fixed application allowlist. Sensitive planner output is rejected before
persistence.

## Export controls

The reproduction builder now rejects:

- missing or symlinked allowlisted files;
- null bytes and non-UTF-8 content;
- sensitive content in source or generated metadata;
- source totals or final archives above 2 MiB;
- incomplete or inconclusive investigations.

The existing deterministic file allowlist, fixed archive metadata, SHA-256
manifest, and path-independent package root remain unchanged.

## Audit contract

Persisted events now use an explicit event-type allowlist. Every event type has
one exact set of payload keys, and serialized payloads are capped at 4 KiB.
Unknown event types, extra fields, missing fields, and oversized payloads fail
contract validation.

Each planned investigation records an `evidence.boundary.verified` event with
accepted evidence, provenance, clean, and redacted counts plus the successful
secret-scan status. It stores counts and status only, not evidence content.

Execution errors store `execution.blocked` with a bounded reason code and
`retryable: false`, followed by `investigation.failed`. Provider detail and
unexpected exception text are not persisted or returned through the product
service.

## Failure, resource, and recovery behavior

- Branch plans remain limited to three fixed variants, four operations per
  branch, and 60 seconds.
- Local command output remains capped at 20,000 bytes.
- Reproduction archives remain capped at 2 MiB.
- Local execution makes zero automatic retries.
- Provider command timeout plus the local deadline remains the approved initial
  fallback.
- Explicit remote cancellation remains known technical debt. No additional
  termination probe was run.
- A failed investigation is terminal. Correct the cause and create a fresh
  investigation from the accepted capsule. The interface now offers that
  recovery path instead of retrying the closed run.

## Insufficient and inconclusive evidence

An accepted capsule that lacks a required known-good environment comparison
cannot enter planning. The API returns `insufficient_evidence`, and the browser
shows `Investigation blocked` with a disabled action until the evidence is
corrected.

A completed execution that does not support exactly one causal alternative
remains inconclusive. It does not expose a proof or reproduction download. This
existing behavior remains covered by deterministic evaluation and interface
tests.

## Verification

- Backend suite: 173 tests passed.
- Frontend suite: 7 tests passed.
- TypeScript type check: passed.
- Production frontend build: passed.
- Python bytecode compilation: passed.
- Installed Python dependency check: passed.
- Standalone reproduction verification: passed.
- Live provider requests: zero.
- Provider credits consumed: zero.

## Retained limitations

1. Pattern matching reduces common accidental secret exposure but is not a
   complete data-loss-prevention system.
2. Explicit remote cancellation remains unproven and is not required by the
   local product path.
3. The application does not resume a terminal investigation. Recovery creates
   a new investigation after the underlying cause is corrected.
4. Clean-checkout and sponsor-stack repeatability remain Step 4.4 work.
5. Direct target-engineer validation remains pending.
6. Nemotron repeatability, Tavily URL deduplication and overage status, and
   Sandbox retention and cost-unit questions remain open.
