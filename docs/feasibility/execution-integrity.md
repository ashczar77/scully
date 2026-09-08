# Step 1.3 Execution Integrity

**Status:** Integrity result approved at checkpoint G1.3b

**Review date:** 2026-09-08

## Objective

Prove that Scully can distinguish an incident match from a known-good
non-match using deterministic code, preserve a common checkpoint across
sibling experiments, detect sibling leakage, and represent termination states
without treating them as reproduction evidence.

## Offline implementation

### Deterministic evaluator

`scully.evaluation` defines a versioned failure signature, structured
execution result, matcher results, and one of three verdicts:

- `matched` when every required matcher passes;
- `not_matched` when a completed run fails at least one required matcher;
- `inconclusive` when execution failed, timed out, or was cancelled.

The initial evaluator supports exact JSON-value comparison and comparison of
two observed fields. Required matchers use AND semantics. Missing paths fail
their matcher. Non-finite numbers and other non-JSON inputs are rejected. A
canonical SHA-256 digest makes equivalent observations repeatable regardless
of JSON object key order.

The evaluator has no parameter through which a language model can set or
override the verdict. A payload field such as `matches: true` has no authority.

The primary probe uses five fixed matchers for
`proxy-identity-collapse-v1`:

1. process exit code equals `0`;
2. response sequence equals `200,429`;
3. the second event equals `rate_limit_rejected`;
4. the two normalized identity digests are equal;
5. the second forwarded client equals the fixed TEST-NET-2 address.

### Experiment lifecycle

`scully.experiments` implements explicit state transitions:

- queued experiments may start or be cancelled;
- running experiments may complete, fail, time out, or be cancelled;
- terminal states cannot be rewritten;
- an experiment cannot complete before it starts.

This is scheduler behavior only. It does not prove that the remote platform
honors timeout or cancellation requests.

### Sibling-isolation verification

An execution-integrity plan requires at least two uniquely identified
experiments from one checkpoint. Each branch must:

- observe the common baseline marker;
- observe its own unique mutation marker;
- not observe another branch's mutation marker.

The verifier rejects missing, duplicate, or mixed-checkpoint snapshots before
making an isolation decision.

## Offline verification

The complete suite contains 91 passing tests. Twenty-one Step 1.3 tests cover:

- a full incident match;
- a known-good non-match;
- repeatable reports for reordered JSON keys;
- missing matcher paths and invalid signatures;
- rejection of non-finite inputs;
- rejection of model-style verdict fields;
- failed, timed-out, and cancelled results as inconclusive;
- all legal lifecycle terminal states;
- rejection of invalid and terminal-state transitions;
- common-checkpoint sibling separation and deliberate leak detection;
- redacted live-probe success, timeout, cancellation, and contract failures.

No provider client was constructed and no provider request occurred during
this implementation or its tests.

## Proposed live attempt

Checkpoint G1.3a is asked to authorize attempt
`g1.3-execution-integrity-001` once.

### Fixed scope

- Provider: Token Factory Sandbox only.
- Base image: strict resolution of `python:3.12-slim`.
- Input: fixed project-created Python programs and TEST-NET-2 addresses.
- Network from the Sandbox: none required.
- Package installation or file upload: none.
- Application retries: zero.
- Per-command timeout: 60 seconds.
- Per-command output limit: 20,000 characters.
- Durable evidence: redacted booleans, verdicts, matcher counts, status,
  operation count, timing, reported cost, and untagged-state count.
- Excluded evidence: command source, stdout, stderr, image identifiers,
  provider messages, credentials, project identifiers, and raw observations.

### Exact operation budget

| Count | Operation | Expected result |
|---:|---|---|
| 1 | Strict base-image resolution | `python:3.12-slim` is selected |
| 2 | Persisted parent command | Writes only the baseline marker |
| 3 | Incident child from the parent | Sees baseline and its own marker, emits the fixed incident observation |
| 4 | Known-good child from the same parent | Does not see the incident marker, sees its own marker, emits the fixed known-good observation |

The attempt succeeds only when isolation passes, the incident is `matched`,
the known-good result is `not_matched`, all command exits are zero, standard
error is empty, and the measurement records exactly four operations. The
runner stops after the first result and is not automatically retried.

The attempt may leave one parent and two child states untagged. Their values
will not be retained in the committed result. The retention and cleanup policy
remains due at G1.4.

## Termination verification boundary

Token Factory documents a command timeout, detached execution, operation
status inspection, and explicit operation cancellation. The pinned Python SDK
applies command and operation timeouts and internally cancels an unfinished
operation while unwinding its wait path. Its documented public client surface
does not expose a direct cancellation method.

Relevant platform references:

- [Run command and timeout behavior](https://docs.tokenfactory.nebius.com/sandboxes/cli/commands/run)
- [Cancel active operations](https://docs.tokenfactory.nebius.com/sandboxes/cli/commands/kill)
- [Sandbox cancellation API](https://docs.tokenfactory.nebius.com/api-reference/sandboxes/operations/cancel-an-operation)

Attempt `g1.3-execution-integrity-001` does not claim live timeout or
cancellation proof. If its result passes review, a separate checkpoint will
bound one timeout and one explicit cancellation test, including how operation
identifiers are captured, how terminal status is verified, and how residual
state is handled.

## Live result

Checkpoint G1.3a approved one execution of
`g1.3-execution-integrity-001`. The redacted preflight showed Sandbox as the
only open provider gate. The first and only attempt then succeeded.

The result records:

- exactly four counted operations and zero retries;
- one common parent checkpoint;
- successful baseline inheritance and sibling separation;
- all five required incident matchers passing;
- three required incident matchers failing for the known-good branch;
- an incident verdict of `matched` and known-good verdict of `not_matched`;
- 8.758663 seconds of local wall time;
- 0.13022 seconds of aggregate public command elapsed time;
- provider-reported cost `0.00148712` without assigning it a unit;
- three untagged resulting image states;
- zero model tokens and zero Tavily credits.

The durable record is
`validation/results/g1.3-execution-integrity-probe-001.json`. It retains no
command source, command output, raw observation, image identifier, provider
message, credential, or project identifier.

## Decision

Checkpoint G1.3b approved the successful integrity result and authorized
offline preparation of the separate termination test. The bounded proposal is
now documented in `termination-probe.md` and awaits checkpoint G1.3c review.
