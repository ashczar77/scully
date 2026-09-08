# Step 1.2 Sandbox Capability Probe

**Status:** Offline implementation in review at checkpoint G1.2k

## Objective

Verify that one bounded ConTree lifecycle can prepare a shared parent image,
run two sibling branches, and show that both inherit parent state while the
second branch does not inherit the first branch's change.

## Lifecycle design

The fixed lifecycle uses `python:3.12-slim` and exactly four conservatively
counted operations:

1. Resolve the base image with `images.use(..., strict=True)`.
2. Run Python directly to write a synthetic marker, preserving the resulting
   image as the common parent.
3. From that parent, run Branch A to verify the marker and write an A-only
   file.
4. From the same parent, run Branch B to verify the marker, assert that the
   A-only file is absent, and write a B-only file.

Every command uses `/usr/local/bin/python` with an explicit argument vector.
No shell interpretation, package installation, file upload, external network
request from the sandbox, model-generated code, production data, or credential
is involved.

## Execution controls

| Control | Value |
|---|---:|
| Base image | `python:3.12-slim` |
| Strict image resolutions | 1 |
| Parent executions | 1 |
| Child executions | 2 |
| Maximum counted operations | 4 |
| Timeout per command and transport | 60 seconds |
| Captured output limit per stream | 20,000 characters |
| Application retry loops | 0 |
| Live provider target | `sandbox` only |

The ConTree SDK polls each submitted operation until completion. Version 0.3.3
also contains an internal retry path for rate-limited operation submission
within the configured timeout. The project runner adds no retry. The four-item
cap therefore bounds semantic lifecycle operations, not internal HTTP polling
or an SDK-managed rate-limit retry.

## Result contract

The adapter matches ConTree SDK 0.3.3 and the current Nebius documentation for
[direct command execution](https://docs.tokenfactory.nebius.com/sandboxes/sdk/python_sdk/running-commands)
and [branching workflows](https://docs.tokenfactory.nebius.com/sandboxes/sdk/python_sdk/branching):

- `wait()` returns a completed image that remains runnable;
- the resulting image UUID is available on the completed image;
- standard output, standard error, exit code, elapsed time, and reported cost
  are read from its public result object;
- both children are started from the same completed parent object.

Success requires all three commands to exit with code zero, exact fixed output,
empty standard error, and three distinct resulting image identifiers. The
durable record retains only:

- the public base-image tag;
- output-match and empty-error booleans;
- child exit codes;
- identifier presence and distinctness booleans, not UUID values;
- local wall time, public command elapsed time, reported cost, and operation
  counts;
- a safe error type and lifecycle stage on failure.

Command source, command output, image UUIDs, provider messages, project IDs,
and credentials are excluded from the record.

## Residual state

Branching requires `disposable=False` for the parent and both child results.
The installed SDK has tag and untag operations but no public image-delete
operation. A successful probe can therefore leave three untagged image states
in the project. They contain only the fixed synthetic marker files described
above. The runner drops all local references after it exits and does not tag or
reuse those states.

This is a known limitation, not a completed discard proof. The first live
result must report how many resulting UUIDs were observed without retaining
their values. Product-level retention and cleanup policy remains work for the
execution architecture.

## Offline verification

Mocked tests cover the exact image, parent, and branch call shapes; timeout and
output caps; four-operation budget; provider targeting; successful inheritance
and sibling separation; distinct result identifiers; redacted failures; and
exclusion of output and UUID values from the durable record.

No Sandbox image resolution or command has run during this increment.

## Proposed live execution

After checkpoint G1.2k approval, one command may temporarily set:

```shell
SCULLY_ENABLE_LIVE=true
SCULLY_LIVE_PROVIDER=sandbox
SCULLY_MAX_SANDBOX_OPERATIONS=4
```

The redacted preflight must show only the Sandbox live gate open. Approval
would authorize attempt `g1.2-sandbox-001` once. The runner must stop after the
first lifecycle result, whether it succeeds or fails, and submit the redacted
record at checkpoint G1.2l.
