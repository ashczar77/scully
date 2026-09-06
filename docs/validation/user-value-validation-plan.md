# Step 0.4 User-Value Validation Plan

**Status:** Ready for interviews

**Date prepared:** 2026-09-06

## Objective

Determine whether target engineers find an executable incident reproduction
materially more useful than an explanation alone, identify the evidence they
need before trusting the result, and select one demonstration case plus one
backup for Gate G0.4.

This step does not select Scully's implementation language or framework.

## Capsule definition

In this project, a capsule is a small, sanitized incident package that gives an
investigation enough evidence to reproduce one observable failure without
access to production systems.

A useful capsule can contain:

- the observed symptom and a machine-readable failure signature;
- relevant versions, topology, configuration, and synthetic inputs;
- minimal project-owned fixture material needed to test a hypothesis;
- a known-good comparison;
- an inventory of each artifact's origin, sensitivity, redaction, and rights.

A capsule must not contain production credentials, customer data, private
source code without permission, or unrestricted access to production. The
contract is technology-neutral. The current Node.js, Python, and JVM fixtures
test whether that contract works across different evidence shapes.

## Required participants

Complete at least three interviews with people who have personally investigated
software failures that were difficult to reproduce outside a deployed
environment.

The participant set should include:

- at least two backend, platform, reliability, support, or infrastructure
  engineers;
- experience from at least two application ecosystems;
- at least one participant who regularly hands investigations to another
  engineer or team.

The project owner may participate if they meet the eligibility rule, but their
interview does not replace the need for independent viewpoints. Technology
familiarity is recorded for context and is not an eligibility requirement for
any candidate.

## Privacy and evidence handling

- Explain that a sanitized summary will be stored in the public repository.
- Record a respondent code such as `E01`, not a name or employer.
- Record only a broad role, experience band, and relevant ecosystem familiarity.
- Do not request customer names, production identifiers, secrets, private
  incident details, or proprietary source code.
- Paraphrase responses by default. Include an exact quotation only with explicit
  permission to publish it anonymously.
- Stop or redact the discussion if a participant begins sharing sensitive
  material.
- Store only completed, sanitized interview records in the repository.

## Materials shown consistently

Every participant receives the same core material:

1. the capsule definition and prohibited-content boundary above;
2. a concise explanation-only incident outcome;
3. the corresponding executable proof shape, including the failing signature,
   known-good comparison, and changed variable;
4. the three candidate summaries;
5. the proposed trust evidence: artifact inventory, experiment history, exact
   commands, observed output, and limitations.

Rotate the candidate presentation order across interviews to reduce ordering
bias. Do not reveal the provisional ranking before the participant has ranked
the cases.

## Interview protocol

Target duration: 20 to 25 minutes.

### 1. Eligibility and context

1. What kinds of software failures do you investigate?
2. Tell us about the last failure that was hard to reproduce outside its
   deployed environment. What made it difficult?
3. How was the investigation handed off, verified, or closed?

Record only a sanitized summary. Do not collect details about a real customer
or system.

### 2. Baseline response to explanation alone

Show the explanation-only outcome first.

1. What could you do next with this information?
2. What would you still need to verify before acting on it?
3. Who else could use this result without repeating the investigation?

### 3. Response to executable proof

Show the matching failing run, known-good run, changed variable, and evidence
inventory.

1. What can you do now that you could not do with the explanation alone?
2. Which part of the proof increases or reduces your confidence?
3. What evidence is missing before you would trust or share the result?
4. Would you rerun it, inspect it, modify it, or ignore it? Why?

### 4. Boundary and trust review

1. Which capsule inputs would you be comfortable exporting from a production
   investigation?
2. Which inputs would you refuse to include?
3. Does the artifact inventory make the boundary understandable?
4. What control or disclosure would be required before your organization could
   use this workflow?

### 5. Demonstration-case comparison

For each candidate, ask the participant to rate:

- relevance to real investigation work;
- value of testing competing hypotheses;
- clarity of the failing and known-good comparison;
- usefulness in a short demonstration;
- confidence that the capsule can remain sanitized.

Then ask:

1. Which case best demonstrates the product's value, and why?
2. Which case should be the backup?
3. Is any candidate too obvious, artificial, or narrow to be convincing?

### 6. Closing test

1. In your own words, what problem does this workflow solve?
2. Is executable proof materially more useful than explanation alone in this
   scenario? Answer yes, partly, or no, then explain.
3. What is the smallest change that would make the workflow more useful or
   trustworthy?

## Response classification

Classify each completed record using only the participant's stated reasoning.

| Field | Allowed values |
|---|---|
| Executable proof value | Yes, partly, no |
| Action enabled | Specific action stated, vague action, no action |
| Trust posture | Would use, would test further, would not use |
| Critical boundary objection | None, resolved, unresolved |
| Preferred case | Proxy, Pydantic, Jackson, none |
| Backup case | Proxy, Pydantic, Jackson, none |

## Gate G0.4 pass criteria

The step is ready for review only when all of the following are true:

- at least three eligible interviews are complete and sanitized;
- at least two participants answer yes to executable proof being materially
  more useful than explanation alone;
- at least two participants identify a specific action enabled by the
  executable proof;
- there is no unresolved critical objection to the evidence boundary;
- one demonstration case and one backup satisfy the selection rules below;
- the selected case still satisfies the approved G0.3 reproduction contract;
- the resulting Phase 1 scope remains credible before the submission deadline.

A partly response does not count toward the two-participant value threshold.
Contradictory or negative feedback must remain visible in the result summary.

## Demonstration-case selection

### Hard eligibility rules

A candidate is ineligible if it:

- requires production access, credentials, customer data, or unlicensed source;
- cannot reproduce its declared signature from the approved capsule;
- lacks a known-good comparison;
- cannot be explained and demonstrated within the intended product boundary.

### Weighted score

Score each eligible candidate from 1 to 5 on each dimension. Multiply the
rating by the listed weight divided by 5. Record evidence for every rating.

| Dimension | Weight | Evidence source |
|---|---:|---|
| User relevance and urgency | 25 | Interview examples and participant ratings |
| Investigation and hypothesis depth | 20 | Candidate design plus interview feedback |
| Demonstration clarity | 15 | Participant comprehension and preference |
| Deterministic proof quality | 15 | G0.3 runs and signature evaluation |
| Capsule portability | 10 | Evidence needed across environments |
| Setup reliability | 10 | G0.3 clean runs and observed setup effort |
| Sponsor-stack fit | 5 | Credible role for later platform capabilities |
| **Total** | **100** | |

Select the highest-scoring eligible candidate unless the Gate G0.4 review
records a specific evidence-backed reason to override it. Select the next
highest as backup. A tie is resolved by higher user relevance, then higher
demonstration clarity, then lower setup risk.

## Current evidence baseline

The following observations come from approved G0.3 evidence. They are not a
final Step 0.4 ranking.

| Candidate | Established strengths | Open validation question |
|---|---|---|
| Proxy identity collapse | Low setup, clear HTTP comparison, several configuration and header hypotheses | Does the project-created limiter feel representative enough? |
| Pydantic settings migration | Low setup and an exact startup failure | Is the cause too obvious to demonstrate an investigation? |
| Jackson classpath version skew | Stable linkage failure and several dependency hypotheses | Is the classpath explanation legible enough for a short demonstration? |

User relevance, trust, comprehension, and case preference remain unscored until
the interviews are complete.

## Required outputs

- at least three completed copies of the
  [engineer interview record template](../templates/ENGINEER_INTERVIEW_RECORD_TEMPLATE.md);
- an anonymized cross-interview findings summary;
- a completed scorecard with evidence for every rating;
- one selected demonstration case and one backup;
- a Gate G0.4 review packet with approval, revision, rejection, or deferral.
