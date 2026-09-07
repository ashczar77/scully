# Safe Incident Reproduction: Hackathon Project Plan

**Status:** Active, Phase 1 feasibility

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

- Python for the Phase 1 feasibility harness because the official ConTree SDK
  is Python-native;
- provider boundaries that keep sponsor integrations replaceable and do not
  constrain the later product stack;
- web interface, API framework, state store, and streaming choices deferred
  until the sponsor primitives have been measured;
- SQLite or file-backed state for the single-user demo;
- containers locally as a fallback if hosted sandbox access is unavailable;
- a small, documented JSON schema for incident capsules and result artifacts.

These choices become binding only after the technical spike.

## 9. Incident capsule contract

An incident capsule is a portable, versioned, engineer-reviewed evidence
bundle. Its contract is technology-neutral even when an individual capsule
contains ecosystem-specific artifacts.

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

### 10.1 Gate system

Every step ends at a review gate. A gate has one of four outcomes:

- **Approved:** the step is complete and dependent work may begin;
- **Revise:** the step remains active until identified defects are corrected;
- **Rejected:** the proposed direction is not viable and must be replaced or
  the project must stop;
- **Deferred:** work is intentionally postponed, with an owner, reason, and
  latest acceptable decision date.

Each gate review must record:

- the reviewed deliverables and their locations;
- the acceptance criteria and evidence for each result;
- unresolved risks, assumptions, and deviations;
- the decision, reviewer, and review date;
- required follow-up work and its owner.

Gate records use `docs/gates/Gx.y-short-title.md` and begin from the
[gate review template](templates/GATE_REVIEW_TEMPLATE.md). A gate is not
approved until its record is complete and committed.

Downstream work may be explored before a gate, but it may not become the
project baseline until the prerequisite gate is approved. The last gate in
each phase is also the phase exit gate. A failed phase exit triggers a scope,
schedule, or viability decision before the next phase starts.

### Phase 0: Problem and boundary validation, 4 to 8 September

Goal: prove that Scully addresses a real, narrow problem using evidence that
can be handled safely.

#### Step 0.1: Define the problem boundary

Deliverables:

- a precise primary user and job to be done;
- an initial incident class and explicit exclusions;
- a deterministic definition of successful reproduction;
- falsifiable assumptions and concept kill conditions.

**Gate G0.1, problem framing review:** Approve only if the problem is narrow
enough for the hackathon, reproduction can be distinguished from diagnosis,
and the success condition can be measured without subjective model judgment.

#### Step 0.2: Assemble candidate incident capsules

Deliverables:

- three public, synthetic, or safely reconstructed incident candidates;
- a draft capsule for each candidate;
- an artifact-level inventory of provenance, sensitivity, and redaction;
- a documented failure signature and expected environment delta for each case.

**Gate G0.2, evidence safety review:** Approve only if all three candidates can
be investigated without production credentials, customer records, secrets, or
unclear data rights.

#### Step 0.3: Prove manual reproducibility

Deliverables:

- clean-room reproduction attempts for all three candidates;
- exact commands, environment details, and observed results;
- a comparison between the supplied and reproduced failure signatures;
- a record of missing evidence and failed attempts.

**Gate G0.3, reproduction viability review:** Approve only if at least two
incidents can be reproduced using only their sanitized capsules. Narrow or
reject the concept if reproduction depends on a production clone.

#### Step 0.4: Validate user value and select the demonstration case

Deliverables:

- a triangulated evidence base from primary public engineering sources;
- at least three source-grounded proxy analyses, with published observations
  separated from project inferences;
- evidence signals concerning the boundary, proof artifact, and trust needs;
- a ranked incident shortlist;
- one selected incident class and one backup case.

**Gate G0.4, Phase 0 exit review:** Approve only if target engineers consider
an executable reproduction materially more useful than an explanation alone,
or public practitioner behavior and explicit proxy analysis provide a credible
substitute. The selected incident must satisfy G0.3 and the project scope must
remain credible before the deadline. A proxy-based approval must record direct
user validation as evidence debt and must not be represented as interview
evidence.

### Phase 1: Sponsor-stack and architecture feasibility, 9 to 15 September

Goal: prove that every required platform capability works, remains within the
cost limit, and contributes directly to the product.

#### Step 1.1: Confirm access, limits, and cost controls

Deliverables:

- verified access to Nebius Token Factory, Nemotron, and required sandbox
  features;
- verified Tavily access and applicable limits;
- a written record of pricing, supplied credits, egress rules, and quotas;
- a hard usage budget and a method for measuring each investigation.

**Gate G1.1, access and cost review:** Approve only if the required services are
available, no step requires out-of-pocket spend, and usage can be stopped
before supplied credits are exhausted. Live inference and Sandbox operations
may be deferred to Step 1.2 when authenticated read-only checks establish
access and the first execution is protected by an approved preflight budget.

#### Step 1.2: Prove the sponsor primitives independently

Deliverables:

- a minimal reusable Python feasibility scaffold with configuration validation,
  provider boundaries, measurement records, and offline tests;
- one Nemotron tool-calling loop with structured output;
- one Tavily retrieval with source provenance;
- one sandbox lifecycle covering create, execute, branch or equivalent,
  compare, and discard;
- latency, reliability, and usage measurements for each primitive.

Before implementation begins, the scaffold specification must pass checkpoint
G1.2a. Before the first live model call or Sandbox operation, the current
balance, account stop behavior, applicable limits, and bounded run budget must
be reviewed. The live probes must be implemented through the project scaffold,
not as disconnected manual experiments.

**Checkpoint G1.2a, scaffold specification review:** Approve only if the
proposed structure is minimal, keeps credentials outside Git, supports offline
testing, and avoids prematurely selecting the product UI or application
framework.

**Checkpoint G1.2b, offline scaffold review:** Approve only if a clean checkout
can run the configuration and measurement tests without credentials, provider
dependencies, network access, or live infrastructure use.

**Checkpoint G1.2c, provider contract review:** Approve only if mocked tests show
that every provider boundary enforces its budget, validates external output,
preserves required provenance, and matches the documented sponsor interfaces.

**Checkpoint G1.2d, integration and execution-preflight review:** Approve only
if exact provider dependencies install together, real clients can be
constructed without requests, the local preflight exposes no credentials, and
live access remains closed. Approval authorizes only the first bounded
Nemotron probe. Tavily and Sandbox execution require their own subsequent
reviews.

**Checkpoint G1.2e, Nemotron probe review:** Approve only if one real request
returns a schema-valid tool call, reported usage stays within the fixed token
and cost caps, retries remain zero, and the saved record contains no generated
argument values or credentials.

**Checkpoint G1.2f, corrective Nemotron review:** If the first attempt fails,
approve only if the exact failure is recorded without a retry and the corrected
runner captures a safe failure category plus usage before validation. The
corrective attempt must remain a single request with parallel tool calls and
automatic retries disabled.

**Checkpoint G1.2g, model-specific request review:** Approve only if the
Nemotron request uses NVIDIA's tool-calling sampling guidance, the larger output
allowance remains below the hard cost ceiling, structural diagnostics are
tested offline, and live access remains closed. Approval authorizes one final
corrective Nemotron attempt.

**Gate G1.2, primitive capability review:** Approve only if each sponsor
technology performs a necessary role with stable enough behavior for the demo.
Record any fallback and confirm that it remains competition-compliant.

#### Step 1.3: Prove isolation and deterministic evaluation

Deliverables:

- two experiments created from the same clean checkpoint;
- evidence that changes in one experiment do not leak into another;
- a deterministic failure-signature evaluator;
- timeout, cancellation, and failed-experiment behavior.

**Gate G1.3, execution integrity review:** Approve only if experiment isolation
is demonstrated and only deterministic code, not the language model, can mark
a reproduction as successful.

#### Step 1.4: Establish the implementation architecture

Deliverables:

- accepted component boundaries and data flow;
- selected language, framework, state store, and streaming mechanism;
- an incident-capsule schema direction;
- identified technical risks, fallback decisions, and measured cost envelope;
- a thin vertical proof backlog.

**Gate G1.4, Phase 1 exit review:** Approve only if the sponsor stack can run
the proposed end-to-end path within the budget, the architecture preserves the
safety boundary, and no unresolved dependency blocks Phase 2.

### Phase 2: Thin vertical proof, 16 to 24 September

Goal: build the smallest complete path from capsule import to runnable failing
test before investing in presentation quality.

#### Step 2.1: Establish the project foundation and contracts

Deliverables:

- evolve the Phase 1 feasibility scaffold into the product foundation with
  repeatable local development commands;
- versioned schemas for capsules, normalized evidence, hypotheses,
  experiments, events, and reproduction results;
- fixture conventions and a seeded simple incident;
- baseline unit, integration, and schema validation checks.

**Gate G2.1, foundation review:** Approve only if a clean checkout can install,
run checks, and load the seeded fixture, and the contracts cover the complete
vertical path without hidden production dependencies.

#### Step 2.2: Implement safe capsule ingestion

Deliverables:

- capsule import and manifest validation;
- path, size, type, and malformed-input controls;
- secret scanning and fail-closed behavior;
- evidence normalization with provenance and redaction status;
- tests for valid, invalid, adversarial, and partial capsules.

**Gate G2.2, ingestion safety review:** Approve only if unsafe capsules are
rejected predictably, accepted evidence retains its lineage, and tests show
that secrets are not copied into normalized output or logs.

#### Step 2.3: Implement hypothesis planning

Deliverables:

- a constrained Nemotron planning loop;
- structured, mutually exclusive hypotheses;
- evidence references and stated uncertainty for every hypothesis;
- tool and experiment plans constrained by an explicit allowlist;
- tests for missing evidence, malformed model output, and prompt injection.

**Gate G2.3, planning review:** Approve only if hypotheses are traceable to
evidence, model output cannot bypass tool restrictions, and unsupported claims
remain visibly inferred rather than observed.

#### Step 2.4: Implement branched execution and signature matching

Deliverables:

- experiment scheduling from a clean checkpoint;
- at least three isolated hypothesis branches;
- streamed command, status, and result events;
- deterministic signature matching and elimination reasons;
- cancellation, timeout, retry, and resource-limit handling.

**Gate G2.4, execution review:** Approve only if branches remain isolated,
results are reproducible, failure states are explicit, and a model response
cannot override the evaluator.

#### Step 2.5: Produce the first end-to-end proof

Deliverables:

- a minimal diagnostic interface for the full event stream;
- one complete seeded investigation;
- a generated reproduction package and runnable failing test;
- exact clean-machine setup and execution instructions;
- recorded latency, usage, and known limitations.

**Gate G2.5, Phase 2 exit review:** Approve only if a clean machine can process
the seeded capsule, execute competing branches, identify the matching
signature, and run the resulting failing test without manual repair.

### Phase 3: Trust UI and visual system, 25 September to 6 October

Goal: make the investigation understandable, auditable, and visually distinct
without hiding uncertainty or execution detail.

#### Step 3.1: Define the interaction and visual foundations

Deliverables:

- navigation and information architecture for the five primary screens;
- color, typography, spacing, motion, and evidence-state tokens;
- low-fidelity flows for new, active, failed, inconclusive, and completed
  investigations;
- keyboard, contrast, focus, and reduced-motion requirements.

**Gate G3.1, experience foundation review:** Approve only if every screen
answers a defined engineering question, all evidence states are distinguishable
without color alone, and the primary flow works without decorative motion.

#### Step 3.2: Build intake and incident overview

Deliverables:

- capsule selection, manifest review, and start controls;
- secret-scan, redaction, and excluded-evidence states;
- incident signature, environment delta, timeline, observed facts, and
  missing-evidence views;
- responsive and keyboard-accessible behavior for both screens.

**Gate G3.2, intake trust review:** Approve only if a user can determine what
will enter the investigation, what was rejected, and why no production access
is required before starting a run.

#### Step 3.3: Build the hypothesis map and experiment inspector

Deliverables:

- branch graph with active, eliminated, inconclusive, and reproduced states;
- evidence-linked hypothesis cards and experiment plans;
- branch comparison, command output, input diff, and environment diff views;
- pause, inspect, and exclude controls where supported.

**Gate G3.3, investigation legibility review:** Approve only if an unfamiliar
viewer can identify what is known, what is suspected, what is running, and why
a branch changed state without reading a chat transcript.

#### Step 3.4: Build the reproduction proof experience

Deliverables:

- original and reproduced signatures shown side by side;
- evidence lineage from observation through experiment to result;
- smallest known input and environment delta;
- runnable test, reproduction steps, export controls, and limitations;
- complete empty, loading, error, partial, and completed states.

**Gate G3.4, proof and accessibility review:** Approve only if the final claim
is supported by inspectable evidence, exported artifacts match the displayed
result, and the primary workflow meets the defined accessibility requirements.

#### Step 3.5: Validate comprehension

Deliverables:

- five short, consistently moderated tests with target engineers;
- time-to-understanding measurements;
- observed confusion points and ranked corrections;
- a revised interface with critical issues resolved.

**Gate G3.5, Phase 3 exit review:** Approve only if a new viewer can identify
the observed failure, current hypotheses, winning experiment, and proof in
under 60 seconds without verbal guidance.

### Phase 4: Realistic investigation and artifact quality, 7 to 16 October

Goal: replace the teaching fixture with a credible incident and make the result
safe, repeatable, and useful outside the interface.

#### Step 4.1: Integrate the selected realistic incident

Deliverables:

- a sanitized, rights-cleared realistic capsule;
- a stable target failure signature;
- at least three plausible competing hypotheses;
- a documented expected reproduction and known-good comparison;
- updated fixtures and test coverage.

**Gate G4.1, incident fidelity review:** Approve only if the case represents a
credible production-only failure, contains no restricted data, and cannot be
solved by a trivial hard-coded lookup.

#### Step 4.2: Minimize and package the reproduction

Deliverables:

- automated or guided minimization of the successful branch;
- synthetic triggering data where the case requires data shape;
- a self-contained reproduction package;
- a failing regression test and machine-readable result manifest;
- a comparison between full and minimized reproductions.

**Gate G4.2, artifact usefulness review:** Approve only if the package preserves
the target signature, removes unrelated material, contains no source secrets,
and can be run independently of the Scully interface.

#### Step 4.3: Harden safety and operational behavior

Deliverables:

- adversarial capsule and prompt-injection coverage;
- secret, path traversal, command policy, and export tests;
- resource ceilings, cancellation, retry, and recovery behavior;
- audit logs with provenance and redaction evidence;
- explicit handling for insufficient evidence and inconclusive results.

**Gate G4.3, safety review:** Approve only if high-severity safety tests pass,
unsafe failures close the investigation rather than weaken controls, and no
secret reaches prompts, logs, screenshots, fixtures, or exported artifacts.

#### Step 4.4: Prove reliability and clean setup

Deliverables:

- repeated local and sponsor-stack runs;
- clean-checkout installation and setup verification;
- latency, failure-rate, and credit-consumption measurements;
- a deterministic seeded path and a tested live path;
- documented recovery instructions for external-service failure.

**Gate G4.4, reliability review:** Approve only if two independent runs produce
equivalent proof, a clean reviewer setup succeeds, and the demo remains within
the measured time and credit budgets.

#### Step 4.5: Freeze the feature set

Deliverables:

- an accepted release scope and deferred-work list;
- resolved critical and high-severity defects;
- final architecture, data-flow, and threat-boundary diagrams;
- a release candidate tagged for submission work.

**Gate G4.5, Phase 4 exit review:** Approve only if the product proves its core
claim with the realistic incident, has no open release-blocking defect, and can
enter submission work without additional feature development.

### Phase 5: Submission narrative and demonstration, 17 to 27 October

Goal: make the finished work easy for judges and developers to understand,
verify, and run.

#### Step 5.1: Lock the story and demonstration script

Deliverables:

- a concise problem, product, proof, and impact narrative;
- a timed storyboard targeting 2 minutes 40 seconds;
- exact seeded and live demo scripts;
- an evidence checklist for every public claim;
- a fallback plan for network or service failure.

**Gate G5.1, narrative review:** Approve only if the first 30 seconds establish
the user problem and safety boundary, the demonstration proves the claim, and
all sponsor technologies have clear, necessary roles.

#### Step 5.2: Prepare the public repository

Deliverables:

- a README covering value, architecture, setup, demonstration, safety, and
  limitations;
- license, dependency notices, contribution guidance, and example capsule;
- verified installation and execution commands;
- repository-history, secret, link, spelling, and formatting checks.

**Gate G5.2, public repository review:** Approve only if an unfamiliar developer
can understand and run the project from a clean checkout, every public claim is
supportable, and no private or sensitive material is present.

#### Step 5.3: Record and finish the demonstration video

Deliverables:

- a polished recording at the target resolution;
- captions and legible interface text;
- clear coverage of capsule review, competing branches, deterministic proof,
  and the resulting test;
- a verified upload-ready video within the competition limit.

**Gate G5.3, video review:** Approve only if a first-time viewer understands the
value within 30 seconds, sees the complete proof within three minutes, and can
read all critical evidence without pausing.

#### Step 5.4: Complete the submission package

Deliverables:

- final title, summary, problem statement, technical description, and impact;
- accurate sponsor-technology and prize-category selections;
- repository, video, demonstration, and supporting links;
- required team, license, eligibility, and disclosure fields;
- a character-limit and link validation pass.

**Gate G5.4, submission completeness review:** Approve only if every required
field is complete, all links work without private access, claims match the
repository and video, and the selected categories are defensible.

#### Step 5.5: Conduct an independent release review

Deliverables:

- one full review by a person unfamiliar with the project;
- a clean-machine setup run;
- a complete video and submission read-through;
- a final release-blocker list and disposition;
- the approved submission candidate.

**Gate G5.5, Phase 5 exit review:** Approve only if the independent reviewer can
run the project, understand the submission, and observe the promised proof
without author assistance, with no unresolved release blocker.

### Phase 6: Submission buffer, 28 to 30 October

Goal: protect the submission from late regression, upload, and administrative
failure. New features are prohibited in this phase.

#### Step 6.1: Freeze and verify the release

Deliverables:

- a versioned release commit and artifact checksum;
- a final automated test, secret scan, and clean-setup result;
- verified seeded-demo data and service configuration;
- a documented rollback point.

**Gate G6.1, release freeze review:** Approve only if the release candidate is
reproducible, all required checks pass, and any remaining issue is explicitly
accepted as non-blocking.

#### Step 6.2: Upload and verify every submission artifact

Deliverables:

- uploaded video, repository link, images, and submission text;
- playback, permissions, link, caption, and rendering verification;
- screenshots of the completed submission fields;
- a deadline and timezone check.

**Gate G6.2, upload review:** Approve only if every artifact is accessible in a
signed-out session, the correct versions are live, and the submission can be
completed before the deadline without another build.

#### Step 6.3: Submit and archive the final evidence

Deliverables:

- confirmed submission receipt;
- final submitted text and link inventory;
- archived release commit, video, screenshots, and gate records;
- a short list of post-submission issues that do not alter the entry.

**Gate G6.3, Phase 6 exit review:** Approve only after receipt is confirmed and
the exact submitted state can be reconstructed from the archived evidence.
After approval, only competition-requested corrections are permitted.

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
7. Complete Gate G0.1 before treating the current problem framing as the
   project baseline.

The UI concept and technical architecture should develop from the same real
incident. A visually polished fictional workflow is not sufficient validation.
