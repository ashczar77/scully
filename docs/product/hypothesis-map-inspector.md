# Hypothesis Map and Experiment Inspector

**Status:** Implemented for Gate G3.3 review

**Implementation date:** 2026-09-11

## Outcome

Scully now presents the investigation as three mutually exclusive branches from
one immutable checkpoint. Each branch keeps observed evidence, inferred
mechanism, testable prediction, bounded plan, execution result, and hypothesis
disposition distinct. A focused inspector exposes the exact branch change,
retained output boundary, matcher results, and source lineage.

The complete path remains local. No provider authority, client construction,
request, credit use, or cost was introduced.

## Hypothesis map

The map answers: **What is suspected, tested, eliminated, or reproduced?** It
shows:

- one named checkpoint shared by all branches;
- three evidence-linked causal alternatives;
- the proposed mechanism and testable prediction for each branch;
- the exact allowlisted variant, operation budget, timeout, and supplementary
  confidence;
- a visible state label and symbol for hypothesis, testing, failure eliminated,
  reproduced, or inconclusive;
- the experiment result separately from the hypothesis disposition;
- a persisted event timeline and the latest live event;
- the supported cause and existing reproduction download after completion.

During execution, each server-sent branch event updates only its named branch.
A completed sibling remains visibly terminal while a later branch is testing.
This extends the progressive delivery already proved at Gate G2.5 into the
branch map instead of reducing progress to one global status.

## Experiment inspector

Every branch contains a named **Inspect branch** action. The inspector answers:
**What exactly happened in this branch?** It includes:

- experiment, checkpoint, result, and hypothesis disposition identifiers;
- a semantic selected-versus-alternative comparison table;
- the fixed adapter, variant, timeout, operation cap, and network boundary;
- a linear input diff stating that accepted evidence and requests are
  unchanged;
- the exact allowlisted environment change with before and after values;
- the retained operation status, verdict, duration, and observation digest;
- a semantic matcher-result table with required state, result, and bounded
  reason;
- an explicit explanation when the intervention hypothesis is eliminated;
- accepted evidence identifiers, provenance, and paths.

Raw standard output is not retained by the current execution contract. The
inspector says so beside the digest and deterministic matcher results. It does
not invent output that the product did not persist.

## State semantics

`Reproduced` describes the experiment: the incident signature still matched.
In that case the attempted intervention hypothesis is explicitly labeled
eliminated. `Failure eliminated` means the signature did not match and the
corresponding causal hypothesis is supported. `Inconclusive` remains distinct
from failure and does not suggest that an unchanged retry will add evidence.

Confidence remains planning metadata. It never determines a terminal state.

## Controls and safety

Run remains one explicit bounded action for all three branches. Inspect and
return actions do not execute work. Branch comparison changes only the local
view.

Pause and exclude controls are absent because neither behavior is supported by
the current execution contract. Presenting them as inert controls would imply
authority the product does not have.

## Accessibility and responsive behavior

- Focus moves to the hypothesis-map heading after planning.
- Focus moves to the inspector heading after selecting a branch.
- Branch cards are not clickable containers. Each has a named 44 px inspect
  control.
- State meaning uses visible text, symbols, rails, and structure in addition to
  color.
- Live progress uses a polite status region and terminal sibling states remain
  in the map.
- Comparison and matcher tables use real row and column headers and keyboard
  scroll containers.
- Input and environment diffs include linear text alternatives.
- Below 1,024 px, the branch graph becomes an ordered vertical list.
- At narrow widths, all inspector panels and diff content stack without hiding
  labels or actions.
- Reduced-motion mode removes the testing pulse without removing its label or
  symbol.

## Verification coverage

The frontend flow verifies planning, all three alternatives, checkpoint
identity, evidence links, pre-run inspection, focus movement, unchanged inputs,
the environment delta, delayed progressive branch completion, terminal states,
post-run output inspection, matcher results, elimination reasons, return to the
map, and the existing reproduction download.

The existing backend suite continues to verify strict planning, allowlisted
execution, event ordering, sibling isolation, deterministic evaluation,
persistence, and packaging.

## Known limitations

1. Reloadable investigation and branch routes remain later work.
2. The product retains a bounded observation digest and matcher results, not raw
   standard output.
3. Pause and exclude operations are unavailable in the execution contract.
4. The working investigation remains limited to the seeded proxy-identity
   incident.
5. Exact viewport and assistive-technology testing remains part of the later
   Phase 3 validation pass.
6. Previously recorded provider limitations, retention questions, and explicit
   cancellation debt remain open.
