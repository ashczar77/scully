# Scully Documentation

## Current direction

The project is building a safe incident-reproduction system for the Nebius x
NVIDIA Global AI Hackathon.

The system would turn a sanitized, read-only production incident bundle into a
minimal executable reproduction without giving AI production credentials or
customer data.

## Current status

- Phase: Trust UI and visual system
- Completed gates: G0.1 through G2.5 and checkpoints G1.2a through G1.3f
- Active step: Step 3.3, hypothesis map and experiment inspector
- Next checkpoint: Gate G3.3, investigation legibility review
- Implementation: Working offline path from safe capsule import through
  progressive branch execution and a runnable reproduction download
- Out-of-pocket cost limit: Zero
- Submission deadline: 30 October 2026

## Active documents

| Document | Purpose | Status |
|---|---|---|
| [Hackathon project plan](HACKATHON_PROJECT_PLAN.md) | Product boundary, trust UI, architecture, delivery phases, demo, risks, and acceptance gates | Active baseline |
| [Problem-first opportunity search](research/problem-first-opportunity-search.md) | Evidence and ranking that led to the current direction | Research complete |
| [Problem boundary](product/problem-boundary.md) | Primary user, incident class, system boundary, reproduction contract, assumptions, and kill conditions | Approved at G0.1 |
| [Gate G0.1 review](gates/G0.1-problem-framing-review.md) | Evidence and decision record for the problem framing | Approved |
| [Candidate incidents](validation/candidate-incidents.md) | Three synthetic incident capsules and their comparative safety case | Approved at G0.2 |
| [Gate G0.2 review](gates/G0.2-evidence-safety-review.md) | Evidence and decision record for candidate capsule safety | Approved after revision |
| [Manual reproduction results](validation/manual-reproduction-results.md) | Clean-run results, exact versions, failed attempts, and limitations for all three incidents | Approved at G0.3 |
| [Gate G0.3 review](gates/G0.3-reproduction-viability-review.md) | Evidence and decision record for manual reproduction viability | Approved |
| [Research-based proxy validation](validation/research-proxy-validation.md) | Public evidence, three proxy analyses, scorecard, and demonstration-case selection | Approved at G0.4 with validation debt |
| [Gate G0.4 review](gates/G0.4-phase-0-exit-review.md) | Evidence and decision record for the Phase 0 exit | Approved with validation debt |
| [Access, limits, and cost controls](feasibility/access-cost-controls.md) | Public service facts, local access audit, zero-spend policy, and Step 1.2 execution preflight | Approved at G1.1 with execution conditions |
| [Gate G1.1 review](gates/G1.1-access-and-cost-review.md) | Evidence and decision record for sponsor access and zero-spend controls | Approved with execution conditions |
| [Phase 1 scaffold specification](feasibility/scaffold-specification.md) | Minimal Python harness boundary for sponsor capability proofs | Approved at G1.2a |
| [Checkpoint G1.2a review](gates/G1.2a-scaffold-specification-review.md) | Decision record for the Phase 1 scaffold specification | Approved |
| [Checkpoint G1.2b review](gates/G1.2b-offline-scaffold-review.md) | Evidence and decision record for the initial offline scaffold | Approved |
| [Provider contracts](feasibility/provider-contracts.md) | Documented request, response, safety, and measurement boundaries for all three providers | Approved at G1.2c |
| [Checkpoint G1.2c review](gates/G1.2c-provider-contract-review.md) | Evidence and decision record for mocked provider contracts | Approved |
| [Execution preflight](feasibility/execution-preflight.md) | Locked SDKs, inert client construction, and local readiness report | Approved at G1.2d |
| [Checkpoint G1.2d review](gates/G1.2d-integration-preflight-review.md) | Evidence and decision record for provider integration | Approved |
| [Nemotron capability probe](feasibility/nemotron-probe.md) | Three bounded attempts and the successful structured tool call | Approved at G1.2h |
| [Checkpoint G1.2e review](gates/G1.2e-nemotron-probe-review.md) | Evidence and decision record for the first Nemotron attempt | Approved for one corrective attempt |
| [Checkpoint G1.2f review](gates/G1.2f-corrective-nemotron-review.md) | Evidence and decision record for attempt 002 and its root cause | Approved |
| [Checkpoint G1.2g review](gates/G1.2g-model-request-review.md) | Evidence and decision record for the model-specific request correction | Approved |
| [Checkpoint G1.2h review](gates/G1.2h-final-nemotron-review.md) | Evidence and decision record for successful attempt 003 | Approved |
| [Tavily capability probe](feasibility/tavily-probe.md) | One-credit search boundary and successful source-discovery result | Approved at G1.2j |
| [Checkpoint G1.2i review](gates/G1.2i-tavily-execution-review.md) | Offline evidence and execution decision for the Tavily probe | Approved |
| [Checkpoint G1.2j review](gates/G1.2j-tavily-result-review.md) | Evidence and decision record for the successful Tavily search | Approved |
| [Sandbox capability probe](feasibility/sandbox-probe.md) | Four-operation branch lifecycle and successful branching result | Approved at G1.2l |
| [Checkpoint G1.2k review](gates/G1.2k-sandbox-execution-review.md) | Offline evidence and execution decision for the Sandbox probe | Approved |
| [Checkpoint G1.2l review](gates/G1.2l-sandbox-result-review.md) | Evidence and decision record for the successful Sandbox lifecycle | Approved |
| [Primitive capability summary](feasibility/primitive-capability-summary.md) | Combined roles, measurements, limitations, fallbacks, and competition alignment | Approved at G1.2 |
| [Gate G1.2 review](gates/G1.2-primitive-capability-review.md) | Combined sponsor-primitive decision record | Approved |
| [Execution integrity](feasibility/execution-integrity.md) | Deterministic evaluator, experiment lifecycle, isolation checks, and bounded live proposal | Approved for one attempt at G1.3a |
| [Checkpoint G1.3a review](gates/G1.3a-execution-integrity-test-review.md) | Offline evidence and execution decision for the first integrity probe | Approved |
| [Checkpoint G1.3b review](gates/G1.3b-execution-integrity-result-review.md) | Evidence and decision record for the successful integrity probe | Approved |
| [Termination probe](feasibility/termination-probe.md) | Bounded timeout, exact-ID cancellation, status verification, cleanup, and evidence design | Corrective result in review at G1.3f |
| [Checkpoint G1.3c review](gates/G1.3c-termination-test-review.md) | Offline evidence and execution decision for the termination probe | Approved |
| [Checkpoint G1.3d review](gates/G1.3d-termination-result-review.md) | Failure evidence, root cause, and corrective preparation decision | Approved |
| [Checkpoint G1.3e review](gates/G1.3e-corrective-termination-review.md) | Corrected image-source contract, accounting, and execution decision | Approved |
| [Checkpoint G1.3f review](gates/G1.3f-corrective-termination-result-review.md) | Evidence and decision record for the corrected termination attempt | Approved for offline correction |
| [Checkpoint G1.3g review](gates/G1.3g-termination-diagnostic-review.md) | Bounded reason codes, fixtures, and execution decision | Deferred, no execution approved |
| [Gate G1.3 review](gates/G1.3-execution-integrity-review.md) | Accepted evidence, cancellation limitation, and timeout fallback | Accepted with limitation |
| [Implementation architecture](product/implementation-architecture.md) | Product stack, boundaries, data flow, capsule direction, and first build backlog | Approved at G1.4 |
| [Gate G1.4 review](gates/G1.4-phase-1-exit-review.md) | Phase 1 exit and Step 2.1 product-foundation decision | Approved |
| [Product foundation](product/product-foundation.md) | Implemented backend, SQLite, contracts, browser shell, commands, and verification | Implemented for G2.1 review |
| [Gate G2.1 review](gates/G2.1-foundation-review.md) | Evidence and decision record for the offline product foundation | Approved |
| [Safe capsule ingestion](product/capsule-ingestion.md) | Schema, seed, validation boundaries, artifact storage, product behavior, and limitations | Implemented for G2.2 review |
| [Gate G2.2 review](gates/G2.2-ingestion-safety-review.md) | Evidence and decision record for capsule ingestion safety | Approved |
| [Hypothesis planning](product/hypothesis-planning.md) | Planning contracts, evidence links, experiment allowlist, persistence, UI, and limitations | Implemented for G2.3 review |
| [Gate G2.3 review](gates/G2.3-planning-review.md) | Evidence and decision record for bounded hypothesis planning | Approved |
| [Branched execution](product/branched-execution.md) | Local branch isolation, signature evaluation, limits, event replay, UI, and Sandbox boundary | Implemented for G2.4 review |
| [Gate G2.4 review](gates/G2.4-execution-review.md) | Evidence and decision record for deterministic branch execution | Approved |
| [First end-to-end proof](product/end-to-end-proof.md) | Progressive execution, runnable reproduction, clean setup, measurements, and limitations | Implemented for G2.5 review |
| [Gate G2.5 review](gates/G2.5-phase-2-exit-review.md) | Evidence and decision record for the Phase 2 vertical proof | Approved |
| [Interaction and visual foundations](product/experience-foundations.md) | Five-screen architecture, state system, flows, tokens, responsiveness, and accessibility | Defined for G3.1 review |
| [Gate G3.1 review](gates/G3.1-experience-foundation-review.md) | Evidence and decision record for the trust-experience foundation | Approved |
| [Capsule intake and incident overview](product/intake-overview.md) | Intake safety, manifest review, observed facts, environment delta, responsiveness, and keyboard behavior | Implemented for G3.2 review |
| [Gate G3.2 review](gates/G3.2-intake-trust-review.md) | Evidence and decision record for intake and incident orientation | Approved |
| [User-value validation plan](validation/user-value-validation-plan.md) | Interview protocol retained for later direct validation | Deferred evidence |
| [Engineer interview record](templates/ENGINEER_INTERVIEW_RECORD_TEMPLATE.md) | Sanitized record template for later direct validation | Ready for future use |
| [Gate review template](templates/GATE_REVIEW_TEMPLATE.md) | Standard evidence and decision record for every delivery step | Active |

The Apache License 2.0 in the repository root remains the project license.

## Immediate decision

No further termination probe is approved. Explicit cancellation is tracked as
technical debt, with provider command timeout plus local deadlines as the
initial fallback. Gate G2.1 approved the offline product foundation and
authorized Step 2.2 safe seeded capsule ingestion. Gate G2.2 approved that
path and authorized Step 2.3 investigation and hypothesis planning only.
Gate G2.3 approved the planning path and authorized Step 2.4 local branched
execution and deterministic signature matching only. Live Sandbox use remains
separately gated.

Gate G2.4 approved the local execution path and authorized Step 2.5 only.
Gate G2.5 approved the complete vertical proof and authorized Step 3.1 only.
Gate G3.1 approved the experience foundation and authorized Step 3.2 only.
Gate G3.2 approved intake and incident orientation and authorized Step 3.3 only.
Live provider product paths remain disabled and separately gated.

New documentation should support the active hackathon project.
