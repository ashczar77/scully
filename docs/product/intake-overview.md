# Capsule Intake and Incident Overview

**Status:** Implemented for Gate G3.2 review

**Implementation date:** 2026-09-11

## Outcome

Scully now presents capsule intake and incident orientation as two distinct
engineering tasks. Before import, the interface explains exactly what will be
validated and states that no production connection is requested. After
acceptance, it replaces the intake surface with an observed-facts overview,
sanitized environment comparison, manifest review, exclusions, missing-evidence
status, and the explicit action that starts planning.

The existing local investigation and reproduction path remains functional. No
live provider control, client, request, or authority was added.

## Intake experience

The first screen asks: **What evidence will enter, and is it safe?** It exposes
two input paths:

- load the reviewed synthetic seed;
- choose a capsule schema 1.0 ZIP from the local machine.

The same fail-closed backend path handles both. The screen shows the four
acceptance boundaries before the user acts:

1. schema and file structure;
2. credentials and local paths;
3. file size, media type, and hash integrity;
4. evidence lineage.

A dedicated safety panel states that only selected files cross the boundary,
production access is not requested, and providers remain disabled by default.
The primary action is unavailable until the local API reports ready.

If validation fails, the interface retains no accepted capsule, displays the
fixed bounded reason, states that no evidence was accepted, and moves focus to
the alert. The user can select a corrected capsule without reloading the page.

## Bounded overview read model

The capsule response now includes the sanitized metadata needed for an honest
overview:

- signature ID and matcher count;
- the known-good description;
- incident and known-good environment facts already declared in the scanned
  manifest;
- explicit exclusions;
- runtime, duration, and offline execution limits;
- derived missing-comparison notices.

It does not expose raw evidence contents, matcher paths, matcher expected
values, commands, provider data, or credentials. The read model remains strict,
versioned, immutable, and fail closed for unknown fields.

## Incident overview

The second screen asks: **What do we know happened?** It shows:

- the capsule title and observed summary as direct evidence;
- evidence count, observed environment deltas, and execution boundary;
- signature identity and the number of deterministic matchers;
- an ordered sequence made only from the observed summary;
- the declared known-good comparison;
- a semantic environment table with real row and column headers;
- every included evidence ID, path, provenance statement, size, and redaction
  status;
- every explicit exclusion;
- missing known-good environment comparisons, or a clear no-gap state;
- a safety-review result adjacent to the planning action.

The overview does not present hypotheses or confidence as observed facts.
Planning begins only when the user selects **Create investigation**.

## Navigation and evidence states

A five-step progress list establishes the approved information architecture.
It is informational, not a set of inert controls. Intake is current before
acceptance, Overview becomes current afterward, and Hypotheses becomes current
once a plan exists. Later screens remain visibly pending.

Observed content always carries a visible `Observed` label and solid symbol.
Environment differences use the observed-state rail because they come directly
from the accepted manifest. Rejection uses a named alert and does not imply an
experimental conclusion.

## Accessibility and responsive behavior

The implementation includes:

- a keyboard-visible skip link to the main investigation content;
- 3 px focus indicators with separation from component boundaries;
- primary controls at least 44 CSS pixels high;
- focus transfer to the rejected-capsule alert;
- focus transfer to the overview heading after acceptance;
- native buttons, headings, definition lists, ordered lists, table headers, and
  landmark regions;
- a keyboard-focusable environment-table scroller;
- text and symbols paired with every color-based state cue;
- a horizontal progress list that can scroll without hiding labels;
- a single-column mobile layout for intake, metrics, panels, evidence, and
  exclusions;
- reduced-motion handling that removes continuous pulsing without removing
  state information.

At widths below 1,024 px, overview panels reflow from the desktop grid. At
widths below 760 px, the remaining paired panels, metrics, exclusions, and
controls stack into one readable column.

## Verification coverage

Tests cover:

- the strict expanded summary and derived missing-evidence notice;
- absence of raw failure-signature expectations from the API response;
- seed import and repeatable capsule lookup;
- the new intake question, safety boundary, runtime state, and skip link;
- accepted evidence, environment comparison, exclusion, and no-gap states;
- rejection reason and focus behavior;
- overview-heading focus after acceptance;
- the existing planning, branch execution, progressive event, supported-cause,
  and reproduction-download flow.

## Known limitations

1. The ordered incident sequence is segmented from the accepted observed
   summary because capsule schema 1.0 does not yet define structured incident
   timeline entries.
2. The five-step progress list reflects application state but is not yet backed
   by reloadable routes. Route persistence remains later implementation work.
3. The hypothesis map below the overview retains its Phase 2 presentation until
   Step 3.3.
4. Exact viewport and assistive-technology testing remains part of the later
   Phase 3 validation pass.
5. Artifact retention, live provider repeatability, Tavily deduplication,
   Sandbox cost-unit clarification, and explicit cancellation remain unchanged
   technical debt.
