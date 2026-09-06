# Scully Documentation

## Current direction

The project is exploring a safe incident-reproduction system for the Nebius x
NVIDIA Global AI Hackathon.

The system would turn a sanitized, read-only production incident bundle into a
minimal executable reproduction without giving AI production credentials or
customer data.

## Current status

- Phase: Sponsor-stack and architecture feasibility
- Completed gates: G0.1 through G0.4
- Active step: Step 1.1, confirm access, limits, and cost controls
- Next gate: G1.1, access and cost review
- Implementation: Not started
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
| [User-value validation plan](validation/user-value-validation-plan.md) | Interview protocol retained for later direct validation | Deferred evidence |
| [Engineer interview record](templates/ENGINEER_INTERVIEW_RECORD_TEMPLATE.md) | Sanitized record template for later direct validation | Ready for future use |
| [Gate review template](templates/GATE_REVIEW_TEMPLATE.md) | Standard evidence and decision record for every delivery step | Active |

The Apache License 2.0 in the repository root remains the project license.

## Immediate decision

Step 1.1 must verify access to the required sponsor services, document current
pricing and limits, establish a zero-spend usage budget, and define a method for
measuring each investigation. Gate G1.1 decides whether the required services
can be used without out-of-pocket spending.

New documentation should support the active hackathon project.
