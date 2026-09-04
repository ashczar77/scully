# Safe Incident Reproduction: Hackathon Project Plan

**Status:** Proposed

**Date:** 2026-09-04

**Target:** Nebius x NVIDIA Global AI Hackathon

**Submission deadline:** 2026-10-30

**Working project name:** Scully

**Cost constraint:** Zero out-of-pocket spend

## 1. Product thesis

Production incidents are difficult to reproduce because the decisive evidence
often exists only on remote systems containing sensitive data. Existing tools
can summarize telemetry and suggest causes, but a plausible explanation is not
the same as an executable reproduction.

The proposed product converts a sanitized, read-only incident evidence bundle
into a minimal local reproduction. It searches competing hypotheses in
isolated sandboxes, synthesizes non-sensitive triggering data, and produces a
failing regression test with a traceable evidence trail.

The product promise is:

> Turn production evidence into an executable witness without giving AI
> production access.

## 2. User and job to be done

### Primary user

An experienced software, reliability, platform, or support engineer who owns a
service failure but cannot reproduce it safely outside production.

### Job to be done

When an incident occurs only in production, help the engineer create a small,
safe, deterministic reproduction so that the cause and eventual fix can be
verified without exposing production credentials or customer data.

### Initial incident class

The first version will focus on backend application failures caused by a
combination of:

- input shape;
- runtime or dependency version;
- environment configuration;
- ordering, retry, or timing behavior;
- relevant application code.

The validation sprint will select the narrowest incident class that can be
reproduced reliably from a sanitized bundle.

## 3. Product principles

1. **No unrestricted production access.** The agent never receives production
   shell access, cloud credentials, database credentials, or mutation rights.
2. **Evidence before explanation.** A diagnosis is successful only when an
   experiment recreates the observed failure.
3. **Visible uncertainty.** The UI distinguishes observations, inferences,
   experiments, reproductions, and eliminated hypotheses.
4. **Synthetic by default.** Triggering data must be generated or sanitized,
   not copied from customer records.
5. **Every claim has lineage.** Engineers can inspect which input evidence and
   experiment supports each conclusion.
6. **Human-controlled boundaries.** The engineer chooses what enters the
   evidence bundle and reviews anything exported.
7. **A polished UI is functional.** Visualization is how users understand,
   challenge, and trust the investigation.

## 4. Scope

### MVP

The MVP must:

- import one defined incident-capsule format;
- scan the capsule for obvious secrets and unsafe content;
- summarize observed facts without inventing missing evidence;
- generate several mutually exclusive causal hypotheses;
- create isolated experiments from a common clean checkpoint;
- execute those experiments in branchable sandboxes;
- visualize active, eliminated, inconclusive, and reproduced branches;
- minimize the successful reproduction where practical;
- output a runnable reproduction package and failing regression test;
- preserve an evidence and command audit trail;
- complete the prepared demonstration in less than three minutes.

### Stretch goals

- generate synthetic data that preserves a failure-causing shape;
- test a proposed patch in a fresh branch;
- compare behavior across dependency or runtime versions;
- export a shareable, vendor-neutral reproduction capsule;
- accept incident exports from a common observability format;
- support a timing or concurrency failure.

### Non-goals

- unrestricted or autonomous access to production;
- production mutation, remediation, deployment, or rollback;
- replacing observability platforms;
- claiming root cause without an executable reproduction;
- training a custom foundation model;
- supporting every programming language or incident class;
- storing real secrets or customer records;
- building enterprise authentication, billing, or multi-region operations for
  the hackathon.

## 5. The trust experience

The UI must answer five questions at a glance:

1. What do we know from the supplied evidence?
2. What does the AI merely suspect?
3. What experiment is running now?
4. Why was each hypothesis eliminated or retained?
5. Can I run the final reproduction myself?

### Evidence states

Every important item displayed in the interface uses one of these states:

| State | Meaning | Visual treatment |
|---|---|---|
| Observed | Directly present in the supplied bundle | Neutral blue with source link |
| Inferred | Proposed by the model but not yet tested | Amber with explicit hypothesis label |
| Testing | An isolated experiment is executing | Animated teal pulse and live command status |
| Eliminated | Experiment did not recreate the signature | Muted gray with elimination reason |
| Reproduced | Experiment recreated the defined signature | High-contrast green with proof link |
| Inconclusive | Evidence or experiment was insufficient | Orange with required next evidence |

Confidence scores must not substitute for these states. Trust comes from
inspectable evidence and repeatable execution.

## 6. UI information architecture

### Screen 1: New investigation

Purpose: establish safety and scope before the AI acts.

Required elements:

- drag-and-drop incident capsule;
- manifest showing included and excluded evidence;
- redaction and secret-scan results;
- reproduction signature definition;
- visible statement that no production connection is requested;
- review and start control.

### Screen 2: Incident overview

Purpose: orient the engineer in under 20 seconds.

Required elements:

- concise incident signature;
- environment and version differences;
- event timeline;
- observed-facts panel;
- missing-evidence warnings;
- investigation progress.

### Screen 3: Hypothesis map

Purpose: make the agent's reasoning and execution visible.

Required elements:

- branch graph rooted at the clean sandbox checkpoint;
- one card per hypothesis with evidence, planned experiment, and status;
- branch comparison controls;
- live but rate-limited command and test output;
- clear elimination reasons;
- ability to inspect, pause, or exclude a branch.

This is the signature visual experience. It should feel like watching a
scientific investigation rather than reading an AI chat transcript.

### Screen 4: Experiment inspector

Purpose: let a skeptical engineer audit a selected branch.

Required elements:

- exact environment changes;
- synthetic input diff;
- commands executed;
- relevant output and failure-signature comparison;
- cited external documentation;
- evidence lineage from observation to hypothesis to result.

### Screen 5: Reproduction proof

Purpose: deliver the useful result.

Required elements:

- original and reproduced failure signatures side by side;
- smallest known triggering input and environment delta;
- runnable regression test;
- reproduction steps;
- download or repository export;
- limitations and unresolved uncertainty;
- optional fix-verification result in a separate clean branch.

## 7. Visual design direction

The interface should look like a high-quality engineering instrument, not a
generic AI dashboard.

- Use a calm dark or near-white base with a restrained teal, amber, green, and
  slate status palette.
- Use monospaced type only for evidence, commands, diffs, and identifiers.
- Prefer diagrams, timelines, diffs, and state transitions over paragraphs.
- Reserve motion for real state changes such as a branch starting, splitting,
  being eliminated, or reproducing the incident.
- Show progressive detail: a clear overview first, with evidence available on
  demand.
- Design loading, empty, partial-evidence, failure, and inconclusive states.
- Meet keyboard-navigation, focus, contrast, and reduced-motion requirements.
- Test the primary demo at 1440 x 900 and a common laptop viewport.

Polish is accepted only when it improves comprehension. Decorative animation
that obscures state or delays work is rejected.

## 8. Technical architecture

```text
Browser UI
    |
Investigation API and state store
    |
Capsule validator and redaction boundary
    |
Evidence normalizer
    |
Nemotron hypothesis planner
    |------------------- Tavily evidence retrieval
    |
Experiment scheduler
    |
Clean sandbox checkpoint
    |-------- branch A: input hypothesis
    |-------- branch B: dependency hypothesis
    |-------- branch C: configuration hypothesis
    |-------- branch D: timing hypothesis
    |
Failure-signature evaluator
    |
Reproduction minimizer and artifact builder
    |
UI evidence graph and downloadable proof
```

### Sponsor technology roles

| Technology | Necessary role |
|---|---|
| NVIDIA Nemotron through Nebius Token Factory | Reconcile long evidence, construct mutually exclusive hypotheses, select tools, revise plans, and explain results |
| Token Factory Sandboxes | Execute untrusted reproduction projects and test branches from a clean checkpoint |
| ConTree branch behavior | Preserve common state while competing environment, input, and timing hypotheses are explored independently |
| Tavily | Retrieve version-specific documentation, changelogs, advisories, and known failure behavior with provenance |

Deterministic code must decide whether an experiment matches the incident
signature. The language model may propose experiments, but it may not mark its
own hypothesis as proven.

### Provisional implementation choices

- TypeScript throughout where sponsor SDK support permits;
- React or Next.js for the web interface;
- a lightweight API and job coordinator;
- SQLite or file-backed state for the single-user demo;
- server-sent events or WebSockets for live experiment state;
- containers locally as a fallback if hosted sandbox access is unavailable;
- a small, documented JSON schema for incident capsules and result artifacts.

These choices become binding only after the technical spike.

## 9. Incident capsule contract

The first capsule should contain only explicitly selected artifacts:

- failure signature and expected matching rules;
- sanitized logs and stack traces;
- runtime, operating-system, and dependency versions;
- relevant configuration with secrets removed;
- schemas or generated examples instead of customer records;
- selected source files or a public test repository;
- known-good environment metadata where available;
- collection and redaction declarations.

The capsule must record provenance, sensitivity, and redaction status per
artifact. Import must fail closed when a required safety check cannot run.

## 10. Delivery plan

### Phase 0: Problem and boundary validation, 4 to 8 September

Objectives:

- collect three public or personally known, safely reconstructable incidents;
- define the smallest plausible capsule for each;
- reproduce them manually without production access;
- interview at least three engineers about the workflow and trust UI;
- select one narrow incident class for the demo.

Gate P0 passes only if at least two incidents can be reproduced from sanitized
evidence and engineers identify reproduction as materially more useful than an
AI explanation.

### Phase 1: Sponsor-stack feasibility, 9 to 15 September

Objectives:

- verify Token Factory model access and remaining credit;
- confirm sandbox beta access, pricing, egress, limits, and checkpoint support;
- run one Nemotron tool-calling loop;
- create, branch, execute, compare, and discard a minimal sandbox experiment;
- retrieve one version-specific source through Tavily;
- measure the credit cost of one investigation.

Gate P1 passes only if all sponsor technologies have necessary roles and the
complete demo can remain within supplied credits. If hosted branching is not
available, decide whether a local fallback remains competition-compliant
before continuing.

### Phase 2: Thin vertical proof, 16 to 24 September

Build one end-to-end path with an intentionally simple incident:

1. import a capsule;
2. normalize evidence;
3. generate three hypotheses;
4. execute three isolated branches;
5. detect the matching failure signature;
6. return a runnable failing test;
7. stream state to an unstyled diagnostic UI.

Gate P2 passes only when the result is repeatable on a clean machine and the
model cannot declare success without the deterministic evaluator.

### Phase 3: Trust UI and visual system, 25 September to 6 October

Objectives:

- establish navigation, tokens, typography, evidence states, and components;
- implement the five primary screens;
- build the interactive hypothesis map and branch transitions;
- implement evidence lineage, diff, timeline, and command-output views;
- cover loading, error, partial, inconclusive, and completed states;
- conduct five short comprehension tests with engineers.

Gate P3 passes when a new viewer can identify the observed failure, current
hypotheses, winning experiment, and supporting proof in under 60 seconds
without verbal guidance.

### Phase 4: Realistic investigation and artifact quality, 7 to 16 October

Objectives:

- replace the simple incident with the selected realistic case;
- add reproduction minimization and synthetic-data support if needed;
- make runs deterministic enough for a live demonstration;
- export the reproduction package and regression test;
- add audit logs, redaction evidence, and explicit limitations;
- test clean setup from the public repository.

Gate P4 passes when two independent runs produce an equivalent proof and no
secret or customer data enters stored fixtures, prompts, logs, or artifacts.

### Phase 5: Submission and demo, 17 to 27 October

Objectives:

- write a public README with architecture, setup, safety, and limitations;
- add the required open-source license and dependency notices;
- create a polished seeded demo and optional live path;
- record a three-minute video with captions;
- prepare the Devpost narrative around problem, proof, sponsor fit, and impact;
- test the repository with a clean reviewer setup.

Gate P5 passes when an unfamiliar reviewer can run the project, understand the
value in the first 30 seconds of the video, and see the complete proof within
three minutes.

### Submission buffer, 28 to 30 October

Only bug fixes, documentation corrections, rehearsal, upload verification, and
submission checks are permitted during the buffer.

## 11. Demo storyboard

The final video should target 2 minutes 40 seconds, leaving upload margin.

| Time | Story beat |
|---:|---|
| 0:00 to 0:20 | A production-only failure exists, but the AI receives no production access or customer data |
| 0:20 to 0:40 | Engineer reviews the sanitized capsule and redaction boundary |
| 0:40 to 1:15 | Nemotron forms hypotheses while the UI distinguishes facts from inference |
| 1:15 to 1:50 | Sandbox branches test competing input, version, config, and timing explanations |
| 1:50 to 2:15 | One branch recreates the exact failure and the others show why they were eliminated |
| 2:15 to 2:35 | The system produces a minimal synthetic case and failing regression test |
| 2:35 to 2:40 | Close on the promise: executable proof without production access |

## 12. Quality and test strategy

### Engine

- schema and malformed-capsule tests;
- secret-detection and redaction tests;
- deterministic signature-matching tests;
- branch isolation and clean-checkpoint tests;
- adversarial evidence and prompt-injection tests;
- cancellation, retry, timeout, and credit-budget tests;
- golden tests for the final reproduction artifact.

### UI

- component states and visual regression tests;
- keyboard-only navigation and automated accessibility checks;
- streaming-state and reconnection tests;
- long logs, missing evidence, failed branch, and inconclusive-run tests;
- comprehension testing with engineers;
- final screenshot and video review at target resolution.

### Release proof

- setup from a clean checkout;
- one deterministic seeded demo;
- one live sponsor-stack run;
- no secrets in repository history, fixtures, logs, screenshots, or video;
- dependency and license review;
- total hosted usage remains within supplied credits.

## 13. Success measures

The hackathon build succeeds when:

- at least two independent incidents are reproducible from sanitized capsules;
- the selected demo generates a runnable failing test;
- the reproduced signature matches the supplied signature deterministically;
- no production credentials or real customer records are required;
- a target engineer understands the investigation state within 60 seconds;
- the complete value is visible in a sub-three-minute demonstration;
- Nemotron, Tavily, and branchable execution each have an indispensable role;
- out-of-pocket infrastructure cost remains zero.

Longer-term product demand is not proven by winning or completing the
hackathon. It requires repeated use with real engineering teams.

## 14. Primary risks and kill conditions

| Risk | Response or kill condition |
|---|---|
| Sanitized evidence is insufficient | Kill or narrow the incident class if two of three cases require a production clone |
| Existing tools already provide the same input-to-test result | Reposition only if our safety boundary or proof artifact is materially different |
| Sandbox beta is unavailable or consumes uncovered spend | Confirm in Phase 1; stop any design that depends on unavailable infrastructure |
| Model produces plausible but unproductive experiments | Constrain tools, use deterministic evaluators, and kill if branching does not outperform a scripted baseline |
| UI becomes an animated AI transcript | Test comprehension and remove any element without a clear engineering question |
| Demo depends on nondeterministic live behavior | Maintain a seeded deterministic path and disclose it honestly |
| Secret or personal data leaks into prompts or artifacts | Fail closed, redact locally, log provenance, and block export |
| Scope expands into observability or autonomous remediation | Enforce the MVP and non-goals at every phase gate |

## 15. Immediate next actions

1. Select three safely reconstructable incident candidates.
2. Write the first draft of the incident-capsule schema.
3. Reproduce one incident manually from only that capsule.
4. Sketch the five screens using the exact evidence from that incident.
5. Ask three engineers whether the proof view changes what they would trust.
6. Confirm sponsor sandbox access and zero-cost limits.
7. Approve, narrow, or reject the concept at Gate P0 before building the full
   interface.

The UI concept and technical architecture should develop from the same real
incident. A visually polished fictional workflow is not sufficient validation.
