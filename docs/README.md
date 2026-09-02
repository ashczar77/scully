# Pragtig Documentation

This directory contains the product, design, decision, review, research, and
delivery records for Pragtig.

**Pronunciation:** prakh-tik

## Current status

- Current phase: Phase 0, Charter and project governance
- Completed gates: G0.1, G0.2, and G0.3
- Active step: Step 0.4, Risk, licensing, and naming
- Pending gate: G0.4, Phase 0 exit approval
- Implementation status: Not started

## Authoritative documents

| Document | Purpose | Status |
|---|---|---|
| PROJECT_PLAN.md | Product charter, architecture direction, standards, roadmap, phases, and gates | Active internal plan |
| STANDARDS.md | Enforceable project standards, checks, and exception process | Approved at G0.3 |
| GOVERNANCE.md | Documentation ownership, decision workflow, review gates, and contribution process | Approved at G0.2 |
| gates/G0.1-charter-approval.md | Durable approval record for the project charter | Approved |
| gates/G0.2-documentation-governance-review.md | Approval record for Step 0.2 | Approved |
| gates/G0.3-project-standards-review.md | Approval record for Step 0.3 | Approved |
| risks/register.md | Current project risks, mitigations, owners, and review points | Draft for G0.4 |
| decisions/ADR-0001-project-license.md | Project license options and recommendation | Proposed for G0.4 |
| research/naming-and-brand.md | Preliminary collision findings and formal clearance plan | Draft for G0.4 |
| gates/G0.4-phase-0-exit-review.md | Review package for Step 0.4 and Phase 0 | In review |

PROJECT_PLAN.md remains the authoritative plan. Specialized documents become
authoritative for their subject only after an approval record says so.

## Planned structure

    docs/
    ├── README.md
    ├── PROJECT_PLAN.md
    ├── STANDARDS.md
    ├── GOVERNANCE.md
    ├── vision.md
    ├── charter.md
    ├── principles.md
    ├── glossary.md
    ├── architecture/
    ├── benchmarks/
    ├── decisions/
    ├── features/
    ├── gates/
    ├── research/
    ├── risks/
    ├── roadmap/
    └── templates/

Directories and documents should be created when their approved phase requires
them. Empty structure should not be added only for appearance.

## Document types

### Project plan

Defines project intent, scope, standards, sequence, acceptance criteria, and
review gates.

### Architecture Decision Record

Records one significant decision, the alternatives considered, the reason for
the choice, consequences, and reconsideration triggers.

Template: templates/ADR_TEMPLATE.md

### Feature specification

Defines the developer experience and complete implementation approach for one
capability.

Template: templates/FEATURE_SPEC_TEMPLATE.md

### Gate review

Presents the evidence required to approve, revise, reject, or defer a project
step.

Template: templates/GATE_REVIEW_TEMPLATE.md

### Risk record

Tracks a risk, its impact, likelihood, mitigation, evidence, owner, and review
date.

Template: templates/RISK_TEMPLATE.md

## Document lifecycle

Documents use one of these statuses:

- Draft
- In review
- Approved
- Superseded
- Withdrawn

Approved records should not be silently rewritten. Corrections may be made
with a revision note. A changed decision requires a new ADR or gate record
that supersedes the previous one.

## Naming

- ADRs: decisions/ADR-NNNN-short-title.md
- Gate records: gates/Gx.y-short-title.md
- Feature specifications: features/short-capability-name.md
- Risk records: risks/RISK-NNNN-short-title.md
- Benchmark reports: benchmarks/reports/YYYY-MM-DD-short-name.md

Use lowercase names except for the standard uppercase prefixes and the current
internal files already established by the plan.

## Public and internal material

Internal working documents listed in the root .gitignore remain local until
the project owner approves publication. Ignoring a file is not a security
control. Sensitive data must never be added to documentation.

Public material must follow the project-writing standard. Use direct language,
plain punctuation, and no assistant signatures or generated-by notices unless
disclosure is required by policy or law.
