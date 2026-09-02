# Pragtig Documentation and Review Governance

**Status:** Draft for Gate G0.2  
**Date:** 2026-09-02

## 1. Purpose

This document defines how Pragtig records decisions, reviews work, approves
progress, and maintains documentation.

## 2. Roles

### Project owner

The project owner:

- approves or rejects review gates;
- approves changes to charter, scope, and public positioning;
- decides when internal documents become public;
- appoints additional maintainers or reviewers;
- makes the final release decision.

### Step author

The step author:

- performs only the active approved step;
- produces the required artifacts and evidence;
- updates related documentation and risks;
- prepares the gate review;
- does not proceed while the gate is unresolved.

### Domain reviewer

A domain reviewer may be requested for architecture, security, performance,
language interoperability, legal, or release decisions. Once maintainers are
available, an author should not be the only approver for a high-impact gate.

## 3. Source of truth

The current precedence is:

1. Approved gate records.
2. Approved ADRs.
3. Approved feature and architecture specifications.
4. PROJECT_PLAN.md.
5. Draft research and working notes.

A more specific approved record takes precedence over a general one. Conflicts
must be resolved explicitly and may not be left to implementation convention.

## 4. Step workflow

Every project step follows this sequence:

1. Confirm that the previous gate is approved.
2. Mark one step active.
3. Restate its objective, scope, deliverables, and acceptance criteria.
4. Perform the work without beginning a later step.
5. Update documentation, decisions, tests, and risks.
6. Prepare a gate review using the standard template.
7. Stop and request project-owner review.
8. Record the decision.
9. Begin the next step only after approval.

Parallel work requires explicit project-owner approval and must identify which
gates depend on it.

## 5. Gate decisions

Allowed gate outcomes:

- Approved
- Approved with recorded follow-ups
- Changes requested
- Rejected
- Deferred

An approval with follow-ups may proceed only when each follow-up has an owner,
target date, and gate dependency. A prerequisite cannot be relabeled as a
follow-up to bypass a gate.

## 6. Gate evidence

Every gate review must include:

- objective and scope;
- artifacts produced;
- acceptance criteria;
- evidence for each criterion;
- tests and validations;
- alternatives and trade-offs;
- open questions;
- risks and technical debt;
- documentation changes;
- recommended outcome.

Statements such as looks good, tests pass, or seems faster are not sufficient
without linked evidence.

## 7. Decision records

An ADR is required when a decision:

- changes a public API or compatibility promise;
- establishes an architectural boundary;
- selects an important dependency or tool;
- changes compile-time or runtime semantics;
- creates a security or privacy consequence;
- affects Java/Kotlin parity;
- changes benchmark methodology;
- creates meaningful migration cost;
- rejects a plausible alternative for a durable reason.

ADRs are append-only after approval. A later ADR may supersede an earlier one.

## 8. Feature specifications

A feature may not enter implementation until its specification covers:

- user problem and outcome;
- scope and non-goals;
- Java and Kotlin APIs;
- semantic rules;
- compile-time processing;
- application-plan representation;
- validation and diagnostics;
- generated artifacts;
- runtime behavior;
- explainability;
- extension points;
- security;
- failure modes;
- tests;
- performance;
- compatibility;
- alternatives and risks.

The amount of detail should be proportional to the feature's risk, but none of
these subjects may be silently ignored.

## 9. Change control

Changes to an approved artifact require:

1. A clear reason.
2. An impact assessment.
3. Identification of affected decisions, steps, tests, benchmarks, and users.
4. A new review at the appropriate gate.
5. A revision or superseding record.

Typographical corrections that do not change meaning may be made with a
revision note.

## 10. Documentation quality

- Use direct, specific language.
- Use plain punctuation.
- Do not use em dashes or en dashes.
- Avoid generic filler and inflated claims.
- Keep public examples executable or validated.
- Link claims to evidence where practical.
- Record limitations and rejected alternatives.
- Never include secrets or sensitive personal data.
- Do not add assistant branding or signatures unless disclosure is required.

## 11. Review expectations

Reviewers should check:

- consistency with the charter;
- correctness and completeness;
- user impact;
- Java/Kotlin parity;
- explainability;
- security and privacy;
- build and runtime performance;
- test evidence;
- dependency and maintenance cost;
- documentation quality;
- future compatibility.

Approval means the evidence is sufficient to proceed. It does not mean the
decision can never be revisited.

## 12. Publication

Internal plans and standards remain excluded from version control until the
project owner approves a public version. Public documents should be extracted,
edited, and reviewed instead of publishing internal working notes unchanged.

Required legal, employer, repository, platform, and license disclosures must
be preserved.
