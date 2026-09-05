# Scully Documentation

## Current direction

The project is exploring a safe incident-reproduction system for the Nebius x
NVIDIA Global AI Hackathon.

The system would turn a sanitized, read-only production incident bundle into a
minimal executable reproduction without giving AI production credentials or
customer data.

## Current status

- Phase: Problem and boundary validation
- Active gate: G0.1, problem framing review
- Implementation: Not started
- Out-of-pocket cost limit: Zero
- Submission deadline: 30 October 2026

## Active documents

| Document | Purpose | Status |
|---|---|---|
| [Hackathon project plan](HACKATHON_PROJECT_PLAN.md) | Product boundary, trust UI, architecture, delivery phases, demo, risks, and acceptance gates | Proposed |
| [Problem-first opportunity search](research/problem-first-opportunity-search.md) | Evidence and ranking that led to the current direction | Research complete |
| [Problem boundary](product/problem-boundary.md) | Primary user, incident class, system boundary, reproduction contract, assumptions, and kill conditions | Proposed for G0.1 |
| [Gate G0.1 review](gates/G0.1-problem-framing-review.md) | Evidence and decision record for the problem framing | In review |
| [Gate review template](templates/GATE_REVIEW_TEMPLATE.md) | Standard evidence and decision record for every delivery step | Active |

The Apache License 2.0 in the repository root remains the project license.

## Immediate decision

Gate G0.1 must approve the problem framing before it becomes the project
baseline. Phase 0 must then determine whether at least two real or safely
reconstructable incidents can be reproduced using only sanitized evidence. If
not, the concept must be narrowed or rejected.

New documentation should support the active hackathon project.
