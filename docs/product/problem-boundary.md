# Scully Problem Boundary

**Status:** Approved at Gate G0.1

**Date:** 2026-09-05

## 1. Problem statement

An engineer owns a backend application failure that appears in production but
cannot safely copy the production environment or its data into a development
system. Existing evidence may support several plausible explanations, but an
explanation does not prove that the failure can be recreated or that a later
fix addresses it.

Scully addresses the gap between sanitized incident evidence and an executable
reproduction. It accepts an engineer-reviewed evidence capsule, tests competing
hypotheses in isolated environments, and returns a minimal runnable witness
when one experiment matches a predefined failure signature.

The product promise is:

> Turn production evidence into an executable witness without giving AI
> production access.

## 2. Primary user

The primary user is an experienced backend, reliability, platform, or support
engineer who:

- owns or is directly investigating an application incident;
- can identify the relevant service and observed failure;
- can export or construct a sanitized evidence bundle;
- cannot provide unrestricted production access or customer records;
- needs a runnable failing case before changing or approving code.

The initial product does not target general incident coordination, novice
debugging education, security forensics, or non-technical stakeholders.

## 3. Job to be done

When an important backend failure occurs only under production conditions,
help the responsible engineer turn a safe subset of the incident evidence into
a small, repeatable failing case, so the engineer can verify the failure and
evaluate a future fix without exposing production credentials or customer
data.

The required result is not a persuasive explanation. It is an executable
artifact that fails in the same defined way as the supplied incident.

## 4. Initial incident class

The first release covers application-layer failures in container-runnable
backend HTTP services, workers, or command-line programs when all of the
following are true:

1. Relevant source code or a public reproduction project can be placed in an
   isolated sandbox.
2. The failure is triggered by one or more bounded variables: sanitized input
   shape, runtime or dependency version, environment configuration, execution
   order, retry behavior, or controlled timing.
3. External systems can be replaced by fixtures, mocks, generated data, or
   local dependencies without changing the target failure signature.
4. The observed failure has a stable, machine-readable signature.
5. A known-good comparison can be stated or constructed.
6. The complete investigation can run within the hackathon time and credit
   budgets.

The validation phase may narrow this class further. It may not broaden it
without a new gate decision.

## 5. Explicit exclusions

The first release excludes:

- incidents that require production shell, cloud, database, or observability
  credentials;
- incidents that require real customer records or reversible personal data;
- production mutation, remediation, deployment, or rollback;
- infrastructure outages whose defining behavior cannot run in an isolated
  environment;
- failures that require production-scale traffic, proprietary hardware, or an
  unavailable third-party service;
- rare concurrency failures that cannot be reproduced reliably within a fixed
  run budget;
- malware analysis, intrusion investigation, and digital forensics;
- mobile, desktop, embedded, and browser-only failures;
- performance optimization where no discrete failure signature exists;
- automatic claims of root cause, causal certainty, or fix correctness;
- general observability, alert correlation, and incident-management features.

## 6. System boundary

An incident capsule is a portable, versioned, engineer-reviewed evidence
bundle. It describes the observed failure and contains only the artifacts that
the engineer has explicitly approved for investigation. It is independent of
programming language, package manager, application framework, and Scully's own
implementation stack. A capsule is not a production export, container image,
or request for live system access.

### Inputs

Scully may receive only artifacts explicitly selected for an incident capsule:

- a versioned failure-signature definition;
- sanitized logs and stack traces;
- relevant source files or a public test repository;
- runtime, operating-system, and dependency metadata;
- configuration with secrets removed;
- schemas, generated examples, fixtures, or mocks;
- known-good environment metadata;
- artifact provenance, sensitivity, and redaction declarations.

The capsule is a transfer boundary, not a request for live production access.
Import must fail closed when a required safety or validation check cannot run.

### Processing

Scully may normalize evidence, retrieve cited technical sources, propose
hypotheses, create isolated experiments, execute allowlisted tools, compare
results, minimize a successful case, and package a reproduction.

Experiments start from a controlled checkpoint. One branch must not be able to
change another branch or the source capsule.

### Outputs

A successful investigation produces:

- a self-contained reproduction package;
- a runnable failing regression test;
- the smallest known triggering input and environment delta;
- a machine-readable signature comparison;
- the commands and relevant outputs used to establish the match;
- evidence lineage from supplied artifact to hypothesis to experiment result;
- explicit limitations and unresolved uncertainty.

An unsuccessful investigation produces an inconclusive result, eliminated
hypotheses, missing-evidence requirements, and the same audit trail. It must not
substitute a plausible explanation for a reproduction.

## 7. Deterministic reproduction contract

### 7.1 Failure signature

Every investigation defines its target signature before experiments begin. A
signature contains one or more deterministic matchers appropriate to the case:

- process exit code or test outcome;
- exception or error type;
- normalized error-message tokens or an explicit regular expression;
- selected stack frames after unstable paths and line numbers are normalized;
- HTTP status and a defined response-body subset;
- structured log event name and required fields;
- output or state digest for a declared fixture.

Each matcher is marked required or informational. Required matchers use AND
semantics unless the signature explicitly declares a versioned alternative.
Changing a target signature after experiments begin invalidates the current
result and starts a new evaluation version.

### 7.2 Successful reproduction

A result is a successful reproduction only when all of the following are true:

1. The input capsule passed its safety and schema checks.
2. The experiment began from the declared clean checkpoint.
3. Deterministic code reports that every required signature matcher passed.
4. The match occurs in at least three consecutive clean runs using the same
   reproduction package and declared seed.
5. The declared known-good comparison does not match the target signature.
6. The generated failing test reproduces the target signature outside the
   investigation interface using documented commands.
7. The result manifest identifies exact inputs, environment, evaluator version,
   commands, and relevant output digests.
8. No prohibited credential, secret, or customer record is present in the
   package, prompts, logs, or result artifacts.

The evaluator owns the reproduced or not reproduced decision. A language model
may propose or explain an experiment, but it cannot change matcher results or
declare its own hypothesis proven.

### 7.3 Claim boundaries

- **Diagnosis:** an explanation consistent with available evidence. A diagnosis
  may remain inferred without an executable match.
- **Reproduction:** an experiment that satisfies the complete deterministic
  reproduction contract.
- **Root cause:** a causal claim supported by additional intervention evidence.
  A reproduction alone does not automatically prove root cause.
- **Fix verification:** evidence that a proposed change prevents the signature
  in a separate clean branch while appropriate positive behavior still works.
  This is outside the initial required result.

## 8. Falsifiable assumptions

| ID | Assumption | Test | Failure consequence |
|---|---|---|---|
| A1 | A useful class of production failures can be reproduced from sanitized evidence | Attempt three candidate cases in Steps 0.2 and 0.3 | Narrow or reject the incident class if fewer than two succeed |
| A2 | The capsule can exclude credentials and customer records without removing decisive evidence | Perform artifact-level safety review at G0.2 | Reject any candidate that requires prohibited evidence |
| A3 | Target engineers value an executable witness more than another incident explanation | Conduct at least three structured interviews in Step 0.4 | Reframe or stop if the proof artifact does not change trust or action |
| A4 | Stable machine-readable signatures can represent the selected failures | Define and run an evaluator for every candidate by G0.3 | Reject cases that depend on subjective visual or model judgment |
| A5 | Isolated competing experiments improve the investigation over a scripted linear baseline | Compare branch results and effort by G4.4 | Remove or reposition branching if it adds no practical value |
| A6 | The sponsor stack can support the complete workflow within supplied credits | Measure access, latency, reliability, and cost in Phase 1 | Use an approved compliant fallback or stop before Phase 2 |
| A7 | A complete proof can be communicated in less than three minutes | Time comprehension tests and demo rehearsals by G5.3 | Narrow the case and interface until the proof fits |
| A8 | The safety boundary can fail closed under malformed or adversarial evidence | Run ingestion and prompt-injection tests by G4.3 | Block release while any high-severity escape remains |
| A9 | The resulting package can run independently of Scully | Test clean setup and execution by G4.4 | Do not claim a delivered reproduction until independence is proven |

## 9. Kill conditions

The current concept must be stopped, narrowed, or materially repositioned when
any of these conditions is established:

1. Fewer than two of three validation incidents can be reproduced from safe
   capsules.
2. The decisive evidence for the selected class requires production access,
   customer records, secrets, or a full production clone.
3. Success cannot be determined by a versioned deterministic evaluator.
4. The reproduction package cannot run independently of the investigation
   interface.
5. Sponsor services or a competition-compliant fallback cannot support the
   required workflow within the zero-spend limit.
6. Branching, evidence lineage, and executable proof do not create a material
   advantage over a simpler scripted workflow or established product.
7. The realistic investigation cannot complete reliably inside the demo and
   credit budgets.
8. A high-severity safety failure cannot be corrected without breaking the
   core workflow.

## 10. Scope control

A proposed capability enters the hackathon baseline only when it is necessary
to complete the selected incident from capsule to executable proof, supports a
gate criterion, and fits the remaining schedule and credit budget. Otherwise it
is deferred.

The following do not justify scope expansion by themselves:

- making the product resemble a general observability platform;
- supporting another language or incident class;
- adding autonomous remediation;
- adding collaboration, billing, or enterprise administration;
- creating visual effects that do not improve investigation comprehension.

## 11. Gate G0.1 acceptance mapping

| Gate criterion | Boundary evidence |
|---|---|
| Precise primary user and job | Sections 2 and 3 identify the responsible engineer, qualifying context, required result, and excluded audiences |
| Narrow hackathon scope | Sections 4, 5, and 10 constrain the incident class, systems, data, and feature surface |
| Reproduction differs from diagnosis | Sections 1, 6, and 7.3 define separate outputs and claim boundaries |
| Success is measurable without model judgment | Section 7 defines versioned matchers, clean runs, a known-good non-match, and an independent failing test |
| Assumptions can be disproved | Sections 8 and 9 attach tests and consequences to the core product assumptions |
