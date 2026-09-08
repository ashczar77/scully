# Scully Documentation

## Current direction

The project is building a safe incident-reproduction system for the Nebius x
NVIDIA Global AI Hackathon.

The system would turn a sanitized, read-only production incident bundle into a
minimal executable reproduction without giving AI production credentials or
customer data.

## Current status

- Phase: Sponsor-stack and architecture feasibility
- Completed gates: G0.1 through G1.2 and checkpoints G1.2a through G1.2l
- Active step: Step 1.3, isolation and deterministic evaluation
- Next checkpoint: G1.3b, execution-integrity result review
- Implementation: All three sponsor primitives proven independently
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
| [User-value validation plan](validation/user-value-validation-plan.md) | Interview protocol retained for later direct validation | Deferred evidence |
| [Engineer interview record](templates/ENGINEER_INTERVIEW_RECORD_TEMPLATE.md) | Sanitized record template for later direct validation | Ready for future use |
| [Gate review template](templates/GATE_REVIEW_TEMPLATE.md) | Standard evidence and decision record for every delivery step | Active |

The Apache License 2.0 in the repository root remains the project license.

## Immediate decision

Step 1.3 offline implementation is complete with 91 passing tests. Checkpoint
G1.3a authorizes one exact four-operation Sandbox integrity probe. No timeout,
cancellation, Nemotron, Tavily, or second integrity attempt is authorized.

New documentation should support the active hackathon project.
