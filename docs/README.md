# Scully Documentation

## Current direction

The project is exploring a safe incident-reproduction system for the Nebius x
NVIDIA Global AI Hackathon.

The system would turn a sanitized, read-only production incident bundle into a
minimal executable reproduction without giving AI production credentials or
customer data.

## Current status

- Phase: Problem and boundary validation
- Completed gates: G0.1 through G0.3
- Active step: Step 0.4, submitted for review
- Active gate: G0.4, Phase 0 exit review
- Implementation: Not started
- Out-of-pocket cost limit: Zero
- Submission deadline: 30 October 2026

## Active documents

| Document | Purpose | Status |
|---|---|---|
| [Hackathon project plan](HACKATHON_PROJECT_PLAN.md) | Product boundary, trust UI, architecture, delivery phases, demo, risks, and acceptance gates | Proposed |
| [Problem-first opportunity search](research/problem-first-opportunity-search.md) | Evidence and ranking that led to the current direction | Research complete |
| [Problem boundary](product/problem-boundary.md) | Primary user, incident class, system boundary, reproduction contract, assumptions, and kill conditions | Approved at G0.1 |
| [Gate G0.1 review](gates/G0.1-problem-framing-review.md) | Evidence and decision record for the problem framing | Approved |
| [Candidate incidents](validation/candidate-incidents.md) | Three synthetic incident capsules and their comparative safety case | Approved at G0.2 |
| [Gate G0.2 review](gates/G0.2-evidence-safety-review.md) | Evidence and decision record for candidate capsule safety | Approved after revision |
| [Manual reproduction results](validation/manual-reproduction-results.md) | Clean-run results, exact versions, failed attempts, and limitations for all three incidents | Approved at G0.3 |
| [Gate G0.3 review](gates/G0.3-reproduction-viability-review.md) | Evidence and decision record for manual reproduction viability | Approved |
| [Research-based proxy validation](validation/research-proxy-validation.md) | Public evidence, three proxy analyses, scorecard, and demonstration-case selection | Proposed for G0.4 |
| [Gate G0.4 review](gates/G0.4-phase-0-exit-review.md) | Evidence and decision record for the Phase 0 exit | In review |
| [User-value validation plan](validation/user-value-validation-plan.md) | Interview protocol retained for later direct validation | Deferred evidence |
| [Engineer interview record](templates/ENGINEER_INTERVIEW_RECORD_TEMPLATE.md) | Sanitized record template for later direct validation | Ready for future use |
| [Gate review template](templates/GATE_REVIEW_TEMPLATE.md) | Standard evidence and decision record for every delivery step | Active |

The Apache License 2.0 in the repository root remains the project license.

## Immediate decision

Gate G0.4 must decide whether public practitioner evidence and three explicit
proxy analyses provide enough confidence to enter sponsor-stack feasibility
work. The submission selects proxy identity collapse as the demonstration case
and Jackson classpath version skew as the backup while retaining direct user
validation as evidence debt.

New documentation should support the active hackathon project.
