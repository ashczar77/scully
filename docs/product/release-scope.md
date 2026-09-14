# Release Scope

**Status:** Approved at Gate G4.5

**Candidate:** `v0.1.0-rc1`

**Freeze date:** 2026-09-14

## Release objective

The hackathon release proves one narrow claim: an engineer can turn a sanitized
incident capsule into an independently runnable failure witness without giving
the investigation system production access.

The accepted release uses one realistic Express proxy-trust incident. It
combines a deterministic browser demonstration with a separately gated live
sponsor-stack runner. Both paths share the same capsule, planning, execution,
evaluation, and reproduction-package contracts.

## Accepted feature scope

| Capability | Release behavior |
|---|---|
| Capsule intake | Import the reviewed seed or a bounded ZIP, verify schema, paths, hashes, sizes, provenance, and sensitive content |
| Incident overview | Show observed facts, known-good comparison, environment delta, evidence lineage, exclusions, and execution boundary |
| Hypothesis planning | Produce three evidence-linked causal alternatives with application-owned experiment slots |
| Branch execution | Run three fixed branches from one common checkpoint with no shell and no external fixture network access |
| Progressive feedback | Stream branch progress while local execution is running and retain ordered events for replay |
| Deterministic evaluation | Match observations against the declared failure signature and select exactly one supported cause |
| Reproduction proof | Show matcher results, causal delta, lineage, limitations, and the expected failing-test contract |
| Export | Download a bounded ZIP whose files are covered by a manifest, digests, and safety checks |
| Independent verification | Run minimization, verification, and the failing regression test outside the Scully interface |
| Sponsor-stack proof | Run one gated Tavily, Nemotron, and Token Factory Sandbox workflow with measured use and zero retries |
| Safe fallback | Demonstrate the complete product locally when credentials, free credits, or provider availability are unsuitable |

## Release blocker audit

| Area | Evidence | Disposition |
|---|---|---|
| Complete user path | Seed import through reproduction download is implemented and tested | Clear |
| Realistic incident fidelity | Separate Express application and loopback proxy reproduce the stable `200,429` signature | Clear |
| Executable deliverable | Exported package verifies independently and includes the expected failing regression test | Clear |
| Progressive execution | The streaming execution endpoint emits 16 bounded events before the terminal result | Clear |
| Sponsor integration | Live run 002 passed Tavily, Nemotron, Sandbox, deterministic evaluation, and export | Clear |
| Zero-spend control | Tavily pay-as-you-go stays disabled; live execution requires manual allowance and balance confirmations | Clear |
| Sensitive data | Capsule, prompt, result, event, and export boundaries fail closed under covered adversarial inputs | Clear |
| Repeatability | Two independent local product runs produced equivalent normalized proof | Clear |
| Clean setup | A tracked clean checkout passed installation, tests, build, preflight, dependency integrity, and proof verification | Clear |
| Demo duration | Local flow is subsecond and the live sponsor stages completed in about 24.64 seconds | Clear |

No critical or high-severity defect remains open inside the accepted release
scope.

## Deferred work

The following items are explicitly outside the hackathon release baseline:

1. Generalizing execution beyond the selected Express proxy-trust incident.
2. Loading live sponsor results into the browser investigation view.
3. Multi-user accounts, authentication, collaboration, billing, and hosted
   tenancy.
4. Reloadable browser routes and resuming an interrupted investigation.
5. Automatic remediation, production mutation, deployment, and rollback.
6. Retaining raw provider output or unrestricted command output.
7. Explicit remote cancellation. Provider timeout plus local deadlines remains
   the release fallback.
8. Sandbox state deletion until the SDK exposes a supported cleanup method.
9. Interpreting the Sandbox reported-cost value until Nebius documents its
   unit.
10. Expanded live repeatability runs that would consume additional credits.
11. Direct target-engineer interviews, physical-device testing, and
    assistive-technology validation.
12. Additional incident capsules, languages, package managers, or cloud
    infrastructure integrations.

## Freeze rules

After Gate G4.5 approval:

- do not add another baseline feature;
- accept code changes only for release blockers, verified defects, security,
  accessibility, or submission-critical documentation;
- do not run another live provider path without a separate reviewed need;
- keep the local deterministic path as the primary demonstration fallback;
- preserve run 001 and run 002 without rewriting their evidence;
- keep every public claim traceable to a test, measurement, or retained result;
- create tag `v0.1.0-rc1` only from the approved clean commit.

Step 5 may improve the story, README, demonstration script, screenshots, video,
and submission text. It may not broaden the product scope.
