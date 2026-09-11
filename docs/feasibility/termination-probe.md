# Step 1.3 Termination Probe

**Status:** Diagnostic correction in review at checkpoint G1.3g

**Review date:** 2026-09-08

## Objective

Verify that Token Factory Sandbox command timeout and explicit cancellation
reach their documented remote terminal states, leave no result image, and
remain inconclusive to Scully's deterministic evaluator.

No live termination operation has run during preparation of this checkpoint.

## Client selection

The installed `contree-cli==0.9.4` is not the test runner. Local inspection
showed that it constructs its client with unbounded transient retries and
unsafe retries enabled. That behavior is unsuitable for this reviewed probe.

The probe instead pins the official lower-level `contree-client==0.4.0` and
uses its standard-library HTTP backend. The client receives credentials
directly from the ignored local environment and is configured with:

- a five-second transport timeout;
- `max_attempts=1` in its retry policy;
- server-error retries disabled;
- retry statuses disabled;
- unsafe retries disabled;
- one pooled connection.

The backend may resend an idempotent call once if a reused keepalive connection
is found stale during the send. This is separate from the disabled retry
policy, cannot duplicate the non-idempotent spawn calls, and is bounded to one
resend for an affected status or cancellation call.

The higher-level `contree-sdk==0.3.3` remains the branching client. The direct
client is added only because the SDK's reviewed public surface does not expose
the explicit operation-cancellation method required by this test.

Platform references:

- [Run commands and set a timeout](https://docs.tokenfactory.nebius.com/sandboxes/cli/commands/run)
- [Cancel an active operation](https://docs.tokenfactory.nebius.com/sandboxes/cli/commands/kill)
- [Cancel one operation through the API](https://docs.tokenfactory.nebius.com/api-reference/sandboxes/operations/cancel-an-operation)

## Fixed live paths

Both paths use the fixed direct API image source
`tag:python:3.12-slim`, direct executable mode, `/usr/bin/sleep`, no shell, no
package installation, no file upload, no command output, and a 1,024-byte
stream cap. Both operations are disposable.

### Timeout path

1. Spawn `/usr/bin/sleep 10` with a one-second command timeout.
2. Read only that operation's status at most ten times.
3. Stop when a terminal state is observed, or after the 15-second path
   deadline.
4. Accept only remote status `SUCCESS` with `metadata.result.state.timed_out`
   equal to `true`.
5. Require `metadata.disposable` to be true and `result_image_uuid` to be
   absent.
6. If the operation was created but no terminal state was observed, send one
   best-effort cleanup cancellation for its exact identifier.

### Explicit cancellation path

This path starts only after the timeout path passes.

1. Spawn `/usr/bin/sleep 30` with a 30-second command timeout.
2. Read only that operation's status once and require an active state.
3. Send one explicit cancellation for its exact identifier.
4. Use the remaining status-read allowance, for at most ten reads across the
   path, to verify remote status `CANCELLED` within the 15-second deadline.
5. Require `metadata.disposable` to be true and `result_image_uuid` to be
   absent.
6. If no terminal state was observed, send at most one additional best-effort
   cleanup cancellation for the same identifier.

If cancellation cannot be confirmed and both cancellation requests fail, the
remote sleep remains bounded by its 30-second command timeout. The probe does
not list, cancel, or alter any other operation.

If a spawn reaches the provider but its response does not contain a usable
operation identifier, exact-ID cleanup is impossible. The fixed remote command
timeout still limits that operation to one second on the timeout path or 30
seconds on the cancellation path.

## Aggregate execution bounds

| Item | Maximum |
|---|---:|
| Disposable Sandbox operations spawned | 2 |
| Status reads | 20 |
| Primary cancellation requests | 1 |
| Best-effort cleanup cancellation requests | 1 |
| Application client calls | 24 |
| Retry-policy attempts per call | 1 |
| Stale-connection resends per idempotent call | 1 |
| Physical HTTP sends under every worst case | 46 |
| Status polling interval | 0.5 seconds |
| Per-path observation deadline | 15 seconds |
| Per-request transport timeout | 5 seconds |
| Maximum local probe duration including final cleanup | 60 seconds |

The 46-send ceiling is deliberately conservative: two spawn sends, up to two
physical sends for each of 20 idempotent status reads, and up to two physical
sends for each of two exact-ID cancellation calls.

The 15-second deadline prevents a new status read from starting after the
path bound. One already-running idempotent read can consume up to ten seconds
when stale-connection recovery is needed. A final cleanup cancellation can
consume the same bounded maximum, producing the conservative 60-second total
across a passing first path and failing second path.

## Evaluation and retained evidence

The timeout observation is normalized as `timed_out`; the cancellation
observation is normalized as `cancelled`. Both are passed to the existing
deterministic evaluator and must produce `inconclusive` without evaluating any
failure-signature matcher.

The durable result may retain:

- probe and provider identifiers;
- fixed image name;
- terminal status and timeout boolean for each path;
- evaluator verdicts;
- disposable and no-result-image booleans;
- application call and operation counts;
- status-read, cancellation, and cleanup counts;
- local wall time and provider operation duration when supplied;
- the fact that provider-reported cost is unavailable from this client.

It must not retain operation identifiers, command output, provider error
messages, credentials, project identifiers, raw event streams, or generated
image identifiers.

## Offline verification

The full suite contains 108 passing tests. The termination tests cover:

- fixed commands, timeouts, disposable mode, and output caps;
- timeout confirmation and exact-ID cancellation;
- a maximum of ten status reads per path;
- stop-on-first-failure behavior;
- one exact-ID cleanup attempt after an unconfirmed terminal state;
- a second cancellation attempt only as bounded cleanup;
- rejection of a status response for another operation;
- rejection of a non-disposable or result-image-bearing terminal response;
- failure records that exclude provider details and operation identifiers;
- both termination states remaining evaluator-inconclusive;
- closed preflight for a wrong dependency version or budget;
- acceptance of direct API tags and canonical image UUIDs;
- rejection of unprefixed tags and noncanonical UUIDs before a client call;
- separate spawn-call and confirmed-operation-ID accounting;
- inert construction of the one-attempt direct client.

No provider endpoint method or network request was used by these tests.

## Success and stop conditions

The live probe succeeds only if both paths reach their exact expected remote
states, both remain evaluator-inconclusive, both are disposable, neither
produces a result image, no cleanup request is needed, and the reviewed limits
hold.

Any mismatch stops the probe. A timeout-path failure prevents the cancellation
operation from being created. There is no automatic second probe attempt.

## First live result

Checkpoint G1.3c approved one execution of `g1.3-termination-001`. Its local
preflight passed with the exact package, credentials, provider target, and
reviewed budget. The first and only attempt then stopped on the first spawn
call with `BadRequestError`.

The redacted result records:

- one attempted spawn call;
- no returned operation identifier;
- zero status reads;
- zero primary or cleanup cancellation requests;
- no cancellation-path spawn call;
- zero retries;
- 1.078011 seconds of local wall time;
- no provider-reported cost.

The durable record is
`validation/results/g1.3-termination-probe-001.json`. The fields
`operations_spawned` and `sandbox_operations` currently count attempted spawn
calls, not confirmed remote operation creation. That accounting name is a
corrective item.

## Root cause

The direct API schema requires `image` to be either an image UUID or a tag
prefixed with `tag:`. The probe passed the SDK-style value
`python:3.12-slim`, while the direct request required
`tag:python:3.12-slim`. The HTTP 400 response contained no operation
identifier, so no status or cleanup request could safely be made.

The failure is in the local request adapter, not evidence that remote timeout
or cancellation is broken. Neither termination behavior was tested.

## Corrective offline implementation

Checkpoint G1.3d accepted the failure record and authorized offline
preparation of a correction. The corrected runner now:

- uses the new probe ID `g1.3-termination-002`;
- passes `tag:python:3.12-slim` to the direct API;
- accepts only a schema-shaped `tag:` source or canonical hyphenated UUID;
- rejects an unprefixed image tag before constructing a provider request;
- records `spawn_calls_attempted` separately from
  `operation_ids_confirmed`;
- counts only confirmed operation IDs as Sandbox operations in measurements;
- preserves every previously reviewed timeout, status, cancellation, cleanup,
  retry, duration, and evidence limit.

The failed result for attempt 001 remains unchanged.

## Corrective live result

Checkpoint G1.3e approved exactly one execution of
`g1.3-termination-002`. Its redacted preflight passed, and the attempt ran once
with no retry. The timeout path passed and allowed the cancellation path to
start. The cancellation path then stopped with `ProviderContractError` after
the primary cancellation request and after a terminal response was observed.

The redacted result records:

- two attempted spawn calls and two confirmed operation identifiers;
- five status reads across both paths;
- one primary cancellation request;
- zero cleanup cancellation requests;
- eight application client calls;
- zero retries;
- 4.923579 seconds of local wall time;
- no provider-reported cost.

The durable record is
`validation/results/g1.3-termination-probe-002.json`. It contains no operation
identifier, command output, provider message, credential, or project ID.

## Offline failure localization

The counters and control flow prove that the timeout observation passed every
required check: remote `SUCCESS`, `timed_out=true`, disposable execution, no
result image, and a valid duration. They also prove that the explicit cancel
request was accepted and a terminal cancellation-path response was returned.
No unexplained active operation remained, so cleanup was neither required nor
sent.

The current redaction is too coarse to identify which post-terminal invariant
failed. The remaining possibilities are limited to:

1. the terminal status was not `CANCELLED`;
2. disposable or no-result-image retention facts did not match the contract;
3. the reported duration did not satisfy the numeric contract.

No additional provider call is needed to improve this diagnosis. A future
offline correction can assign non-sensitive reason codes to these individual
checks and test their redaction before any new execution proposal.

## G1.3f decision

Checkpoint G1.3f accepted the failed corrective result but did not approve Gate
G1.3. It authorized offline addition of bounded, non-sensitive failure reason
codes and fixture coverage. It did not authorize another live attempt.

## Offline diagnostic correction

The runner now assigns any future attempt the distinct ID
`g1.3-termination-003`. Results 001 and 002 remain unchanged. A specialized
contract error carries exactly one of four fixed reason codes:

| Reason code | Meaning |
|---|---|
| `cancellation_status_mismatch` | The terminal status was not `CANCELLED` |
| `cancellation_disposable_invalid` | Disposable metadata was false or malformed |
| `cancellation_result_image_present` | A result image was reported |
| `cancellation_duration_invalid` | Duration did not satisfy the numeric contract |

Only the fixed reason value may enter a failure record. Exception messages,
provider content, operation identifiers, credentials, project identifiers,
and command output remain excluded.

Fixture tests exercise all four mappings. A runner test proves the bounded
reason reaches the redacted result while both operation identifiers remain
absent. The full suite contains 109 passing tests.

No request, operation, status read, or cancellation call was made while
implementing this correction. The image, commands, timeouts, two-operation
cap, status-read cap, cancellation and cleanup caps, transport behavior,
evidence boundary, and no-retry rule remain unchanged.

## Decision requested

Approve exactly one execution of `g1.3-termination-003` within the unchanged
reviewed bounds. Approval does not authorize a retry or any other provider
use. Submit the redacted result for review before deciding Gate G1.3.
