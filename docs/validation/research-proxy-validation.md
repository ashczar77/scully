# Step 0.4 Research-Based Proxy Validation

**Status:** Proposed for Gate G0.4

**Research date:** 2026-09-06

## Executive result

Public engineering guidance and incident discussions support the value of
small, executable reproductions. Three source-grounded proxy analyses produce
two strong-value results and one partial-value result. They also distinguish
the candidates clearly enough to select proxy identity collapse as the
demonstration case and Jackson classpath version skew as the backup.

These are analytical proxies, not interviews. No response below is attributed
to a real person, and no quotation or participant opinion has been invented.
The analysis separates published observations from project inferences. Direct
user validation remains open evidence debt.

## Method

The substitute method uses two evidence layers:

1. Official engineering guidance establishes which information maintainers and
   operators request when a failure must be reproduced or handed off.
2. Public issue reports and maintainer discussions establish the real evidence,
   decisions, and verification steps associated with each candidate pattern.

Three proxy lenses then apply the Step 0.4 questions to those observed
behaviors. Each inferred response must cite its source basis, state the action
that executable proof would enable, and carry a confidence label.

This method can rank demonstration cases and test the plausibility of the value
proposition. It cannot measure willingness to adopt, organizational approval,
usability, or reactions to a working Scully interface.

## General problem evidence

The public guidance consistently treats reproduction as operational evidence,
not merely better prose:

- The [scikit-learn contributor guide](https://scikit-learn.org/stable/developers/minimal_reproducer.html)
  calls a minimal reproducible example central to effective and efficient
  communication for bug reports, tests, and technical discussions.
- [MDN's browser bug guidance](https://developer.mozilla.org/en-US/docs/Learn_web_development/Howto/Web_mechanics/File_browser_bugs)
  asks for a small standalone test, expected and actual results, version data,
  and comparative execution across browsers.
- [MDN's performance guidance](https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Fundamentals#test_cases_and_submitting_bugs)
  recommends isolating a reduced test case, removing private information, and
  sharing the result with diagnostic evidence.
- [Kubernetes debugging guidance](https://kubernetes.io/docs/tasks/debug/)
  asks bug reporters for versions, infrastructure and network context, runtime
  details, and reproduction steps.

These sources support the capsule's core fields: a runnable case, environment
facts, expected and actual outcomes, a controlled comparison, and a privacy
boundary.

## Proxy analysis P01: Platform and reliability operations

### Source basis

The
[express-rate-limit proxy guide](https://github.com/express-rate-limit/express-rate-limit/wiki/Troubleshooting-Proxy-Issues)
documents the failure mode in which a reverse proxy makes a rate limiter act as
one global limiter. It recommends exposing the interpreted client address and
forwarded header to determine the correct proxy-hop setting.

A
[2026 Kyma investigation](https://github.com/kyma-project/busola/issues/4848)
records the same operational pattern. Its acceptance criteria require logging
the interpreted address, inspecting a deployed environment, determining proxy
hops, configuring trust, verifying per-client behavior, and adding automated
tests.

### Observed behavior

- An explanation identifies proxy trust as a likely cause but does not establish
  the correct hop count or prove which identity the limiter uses.
- The published investigation requires measurement before configuration.
- Success is defined behaviorally: different clients must be limited
  independently after the change.

### Inferred Step 0.4 response

- **Executable proof value:** Yes
- **Specific action enabled:** Apply and regression-test the smallest trust
  configuration that produces distinct client identities without trusting an
  unsafe path.
- **Trust requirement:** Show the forwarded chain, interpreted identity,
  topology assumption, exact changed setting, failing run, and known-good run.
- **Boundary posture:** Synthetic addresses and a topology sketch are adequate;
  real client addresses and production hostnames are unnecessary.
- **Preferred case:** Proxy identity collapse
- **Backup case:** Jackson classpath version skew
- **Confidence:** High for problem relevance, medium for unobserved product
  reaction

### Reasoning

The public task itself moves from hypothesis to logging, deployment evidence,
configuration, behavioral verification, and tests. Scully's executable proof
compresses that same reasoning into a sanitized comparison. This is a direct
fit for the proposed value rather than a speculative new workflow.

## Proxy analysis P02: Python service integration

### Source basis

The
[Chroma Pydantic issue](https://github.com/chroma-core/chroma/issues/774)
contains the exact import stack and an error message stating that
`BaseSettings` moved to `pydantic-settings`. The message also links to migration
guidance.

### Observed behavior

- The failure is real and version-dependent.
- The exception already identifies the moved class, destination package, and
  migration documentation.
- A pinned environment can verify compatibility and guard against recurrence,
  but little hypothesis search is required to understand the first failure.

### Inferred Step 0.4 response

- **Executable proof value:** Partly
- **Specific action enabled:** Confirm whether pinning the old major version or
  migrating the import restores startup, then preserve the result as a
  regression check.
- **Trust requirement:** Show the dependency lock, interpreter version, exact
  exception, unchanged service source, and passing comparison.
- **Boundary posture:** Dependency metadata and a minimal import fixture are
  sufficient; application data is unnecessary.
- **Preferred case:** Pydantic settings migration
- **Backup case:** Jackson classpath version skew
- **Confidence:** High for the technical conclusion, medium for unobserved
  product reaction

### Reasoning

Executable proof adds verification and a reusable regression artifact, but the
explanation already contains the likely remediation. This case validates the
capsule contract while showing less of Scully's investigation value.

## Proxy analysis P03: JVM dependency maintenance

### Source basis

In a
[Jackson maintainer discussion](https://github.com/FasterXML/jackson-databind/discussions/4213),
a user reports a runtime `NoSuchMethodError`. Responses identify likely
compile-time and runtime incompatibility, ask for the dependency versions and
full stack trace, recommend aligning Jackson artifacts, and later identify an
old Swagger dependency as another relevant variable.

### Observed behavior

- The initial exception supports a version-skew hypothesis but does not identify
  the complete dependency path.
- Maintainers request the runtime dependency set and full stack to identify the
  caller.
- Changing one version can expose a second compatibility failure, so a single
  explanation does not complete the investigation.

### Inferred Step 0.4 response

- **Executable proof value:** Yes
- **Specific action enabled:** Align the Jackson runtime set or upgrade the
  incompatible caller, then rerun the same serialization signature as a
  regression check.
- **Trust requirement:** Show the resolved runtime classpath, compilation
  target, full normalized exception, one-variable comparison, and passing
  control.
- **Boundary posture:** Manifests, resolved public artifacts, and a project-owned
  serialization fixture are sufficient; proprietary service code is
  unnecessary.
- **Preferred case:** Jackson classpath version skew
- **Backup case:** Proxy identity collapse
- **Confidence:** High for problem relevance, medium for unobserved product
  reaction

### Reasoning

The discussion shows multiple plausible compatibility variables and repeated
requests for executable environment evidence. A controlled classpath
comparison can turn a likely explanation into a verified dependency action.

## Cross-proxy synthesis

| Test | P01 | P02 | P03 | Result |
|---|---|---|---|---|
| Executable proof materially more useful | Yes | Partly | Yes | 2 strong, 1 partial |
| Specific action supported by proof | Yes | Verification mainly | Yes | 2 strong |
| Capsule can avoid private operational data | Yes | Yes | Yes | 3 plausible |
| Case preference | Proxy | Pydantic | Jackson | Split |
| Backup preference | Jackson | Jackson | Proxy | Jackson leads |

The evidence supports executable proof most strongly when the failure has a
clear signature but several environment-level hypotheses. It supports the
value less strongly when the exception already states the migration action.

No public source establishes willingness to use Scully or proves that the
proposed interface communicates the boundary successfully. Those questions
remain outside this proxy method.

## Demonstration-case scorecard

All three candidates remain eligible under the G0.3 safety and reproducibility
rules. Ratings use the 1 to 5 scale defined in the Step 0.4 plan.

| Dimension | Weight | Proxy | Pydantic | Jackson |
|---|---:|---:|---:|---:|
| User relevance and urgency | 25 | 5 | 4 | 4 |
| Investigation and hypothesis depth | 20 | 5 | 2 | 5 |
| Demonstration clarity | 15 | 5 | 4 | 3 |
| Deterministic proof quality | 15 | 5 | 5 | 5 |
| Capsule portability | 10 | 4 | 5 | 3 |
| Setup reliability | 10 | 5 | 5 | 3 |
| Sponsor-stack fit | 5 | 5 | 2 | 5 |
| **Weighted total** | **100** | **98** | **77** | **81** |

### Rating evidence

- **Proxy identity collapse:** Two independent public sources show a damaging
  deployed behavior and an investigation that needs topology measurement,
  configuration experiments, behavioral verification, and tests. Its
  `200,429` versus `200,200` result is immediately legible. The capsule must
  still represent topology accurately.
- **Pydantic settings migration:** The public failure is relevant and the
  fixture is reliable, but the exception states the moved symbol and new
  package. This limits hypothesis depth and the need for branched experiments.
- **Jackson classpath version skew:** The public discussion shows real and
  recurring dependency ambiguity, with strong scope for classpath experiments.
  Maven setup and JVM linkage details make it harder to explain in a short
  demonstration.

## Selection

**Demonstration case:** Proxy identity collapse

**Backup case:** Jackson classpath version skew

The proxy case has the clearest user-visible failure, the strongest published
operational analogue, multiple safe hypotheses, a low-cost fixture, and a
compact failing-to-passing narrative. The Jackson case preserves strong
investigation depth if the proxy fixture proves too artificial during Phase 1.

## Validation debt

Before making claims based on direct user feedback, the project must still
complete real user validation. When access becomes practical, use the
[engineer interview protocol](user-value-validation-plan.md) with at least
three eligible participants.

Until then, project materials may claim that public practitioner behavior and
official engineering guidance support the problem. They must not claim that
engineers were interviewed, that users preferred a candidate, or that adoption
intent was measured.
