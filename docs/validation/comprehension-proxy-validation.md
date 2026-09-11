# Step 3.5 Comprehension Proxy Validation

**Status:** Completed for Gate G3.5 review with direct-validation debt

**Validation date:** 2026-09-11

## Result

Five consistently structured, role-based proxy walkthroughs were applied to
the complete Scully workflow. The initial pass found four critical sources of
avoidable hesitation. After the interface corrections, all five modeled paths
identified the observed failure, three current hypotheses, winning experiment,
and reproduction proof within the 60-second target.

These are analytical simulations, not interviews or observations of real
people. They support an interface correction pass and a provisional Phase 3
decision. They do not establish adoption intent, organizational acceptance, or
observed human usability. Direct target-engineer validation remains open.

## Consistent protocol

Each walkthrough starts on the accepted incident overview and follows the same
four prompts without explanatory commentary:

1. What failure was observed?
2. What causal explanations are currently being tested?
3. Which experiment won, and why?
4. What can another engineer download and verify?

A walkthrough stops when all four answers can be stated from visible interface
content. A correct answer must identify:

- two synthetic clients collapsing to one identity, with the second request
  receiving HTTP 429;
- disabled proxy trust, an overwritten forwarded chain, and a global limiter
  key as the three alternatives;
- `trust loopback` as the winning experiment because the one-variable change
  removes the failure;
- an exact signature match, `200,429` observed against `200,200` expected, and
  a downloadable archive with an intentionally failing regression test.

The same local seed, screen order, prompts, and stopping rule apply to every
walkthrough. The optional inspector is available but is not required for the
happy path.

## Timing method

Because no eligible participants are presently available, timing is modeled
rather than observed. Each role-based scan path records the visible words that
must be traversed before all four answers are available. The fixed model uses:

- 220 words per minute;
- 1.5 seconds for each of four required actions;
- 2 seconds to formulate each of four answers.

The result is a repeatable interface-density measure, not a human performance
claim. Values are rounded to one decimal place.

## Walkthrough lenses

| Code | Target-engineer lens | Primary scan behavior |
|---|---|---|
| W01 | Platform or reliability engineer | Reads topology, state, and intervention labels first |
| W02 | Node.js backend engineer | Looks for the exact setting, response sequence, and test command |
| W03 | Support or escalation engineer | Looks for a concise cause, handoff artifact, and limitations |
| W04 | Security-minded platform engineer | Checks evidence boundary, unchanged inputs, and export scope before trusting the result |
| W05 | Cross-ecosystem backend engineer | Reads terminology and state explanations before interpreting Express-specific details |

These lenses are derived from the approved Step 0.4 public-source analysis.
They are not presented as respondent identities or opinions.

## Initial pass

| Lens | Words traversed | Modeled time | Outcome | Main hesitation |
|---|---:|---:|---|---|
| W01 | 105 | 42.6 s | Pass | Cause was prominent, but the winning experiment was not named as such |
| W02 | 87 | 37.7 s | Pass | Progress rail made the inspector look mandatory |
| W03 | 132 | 50.0 s | Pass | Needed to reconcile failure elimination with hypothesis support |
| W04 | 149 | 54.6 s | Pass | Equals symbol did not provide a textual signature-match statement |
| W05 | 185 | 64.5 s | Fail | Reproduced and failure-eliminated branch semantics were easy to reverse |

Initial median: 50.0 seconds. Initial maximum: 64.5 seconds. Four of five
modeled paths met the target.

## Ranked confusion points and corrections

| Rank | Severity | Confusion | Evidence | Correction |
|---|---|---|---|---|
| 1 | Critical | `Failure eliminated` could be mistaken for an eliminated hypothesis | W03 and W05 | Added a two-part reading key that explains both experiment result and hypothesis disposition |
| 2 | Critical | Supported cause was clear, but the winning experiment required inference | W01, W03, and W05 | Renamed the result heading to `Winning experiment`, exposed `trust loopback`, and stated the one-variable causal result |
| 3 | Critical | Signature equality depended on a symbol | W04 and W05 | Added the visible text `Exact match` between original and reproduced signatures |
| 4 | High | An intentionally failing test could still resemble a broken setup | W03 | Added `Expected failure, not a setup error` beside the test contract |
| 5 | High | The progress rail implied that branch inspection was mandatory | W02 and W05 | Labeled Inspector as `Optional audit` and stopped marking it complete unless visited |

No additional visual ornament was added. Every correction answers one of the
four comprehension prompts or removes a misleading workflow implication.

## Revised pass

| Lens | Words traversed | Modeled time | Outcome | Decisive cue |
|---|---:|---:|---|---|
| W01 | 75 | 34.5 s | Pass | `Winning experiment` and the one-variable result |
| W02 | 62 | 30.9 s | Pass | `Optional audit`, exact delta, and test contract |
| W03 | 95 | 39.9 s | Pass | State reading key and expected-failure notice |
| W04 | 110 | 44.0 s | Pass | Exact signature-match text and unchanged-input boundary |
| W05 | 128 | 48.9 s | Pass | Plain-language result-to-hypothesis definitions |

Revised median: 39.9 seconds. Revised maximum: 48.9 seconds. All five modeled
paths meet the 60-second target, with 11.1 seconds of headroom in the slowest
path.

## Remaining evidence debt

1. No eligible target engineer has completed this interface test.
2. Modeled scan time does not capture hesitation, distraction, prior knowledge,
   visual acuity, assistive technology, or device constraints.
3. The role lenses cannot establish whether engineers would trust, adopt, or
   share the artifact in real work.
4. Exact viewport, keyboard, and assistive-technology checks remain separate
   from human comprehension evidence.
5. Before public claims based on user feedback, run the retained direct
   validation protocol and publish only sanitized records.

## Conclusion

The corrected interface satisfies the Step 3.5 proxy criterion: every defined
role-based path can locate the required facts within the modeled 60-second
budget. Gate G3.5 may close Phase 3 with explicit direct-validation debt. It
must not be cited as evidence that engineers were interviewed or that real
users completed the workflow in under 60 seconds.
