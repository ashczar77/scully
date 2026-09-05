# Scully Documentation

## Current direction

The project is exploring a safe incident-reproduction system for the Nebius x
NVIDIA Global AI Hackathon.

The system would turn a sanitized, read-only production incident bundle into a
minimal executable reproduction without giving AI production credentials or
customer data.

## Current status

- Phase: Problem and boundary validation
- Completed gates: G0.1
- Active step: Step 0.2, assemble candidate incident capsules
- Next gate: G0.2, evidence safety review
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
| [Gate review template](templates/GATE_REVIEW_TEMPLATE.md) | Standard evidence and decision record for every delivery step | Active |

The Apache License 2.0 in the repository root remains the project license.

## Immediate decision

Step 0.2 must assemble three safe candidate incident capsules with explicit
provenance, sensitivity, redaction, failure signatures, and expected
environment deltas. Gate G0.2 must approve their evidence safety before manual
reproduction begins.

New documentation should support the active hackathon project.
