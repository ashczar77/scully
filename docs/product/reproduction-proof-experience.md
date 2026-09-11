# Reproduction Proof Experience

**Status:** Implemented for Gate G3.4 review

**Implementation date:** 2026-09-11

## Outcome

Scully now ends a conclusive investigation with a dedicated reproduction proof.
The proof gives another engineer one place to verify the supported cause, match
the original and reproduced signatures, inspect the causal delta and evidence
lineage, understand the failing-test contract, follow clean-run instructions,
download the deterministic archive, and see the remaining limitations.

The proof appears only when deterministic evaluation supports exactly one
causal alternative. An inconclusive investigation ends at the hypothesis map
and offers neither a success state nor a reproduction download.

## Claim boundary

The completed proof makes one bounded claim: disabling loopback proxy trust
causes two synthetic clients to collapse into one rate-limit identity. The
original accepted capsule and the local reproduction use the same signature ID.
The reproduced observation is `200,429`, compared with the known-good
expectation `200,200`.

The supported branch is a cause-eliminating intervention. Changing
`trust_proxy` from `false` to `loopback`, while retaining the same accepted
evidence, request sequence, and checkpoint, removes the failure. The interface
keeps that causal result distinct from sibling branches that still reproduce
the incident and therefore eliminate their own hypotheses.

## Inspectable evidence

The proof shows:

- the supported hypothesis, experiment, disposition, evaluator version, and
  isolation result;
- original and reproduced signature IDs side by side;
- the accepted incident summary and the reproduced response sequence;
- the count of declared and passing required signature matchers;
- a six-stage lineage from accepted evidence through the hashed archive;
- the unchanged input boundary and one allowlisted environment delta;
- the test command, expected responses, observed responses, and expected exit;
- clean-directory commands for installation, verification, and test execution;
- local execution source, operation count, retry count, and limitations.

Raw standard output is not presented because the execution contract does not
retain it. The observation digest and deterministic matcher results remain the
auditable output boundary.

## Export contract

The primary action downloads
`/api/investigations/{id}/reproduction.zip` as
`scully-proxy-identity-collapse.zip`. The archive builder remains allowlisted,
bounded to 2 MiB, deterministic, and symlink rejecting. Its generated manifest
binds the investigation ID, capsule ID, signature ID, supported cause,
execution facts, and SHA-256 hash of every included file.

The displayed run contract matches the archive:

```shell
npm ci
npm run verify
npm test
```

`npm run verify` must exit 0 after proving the incident, known-good comparison,
and failing-test behavior. `npm test` is intentionally expected to exit 1 while
showing observed responses `200,429` against the `200,200` expectation.

## Complete state model

- **Empty:** Before execution, the map states that proof is unavailable until
  all bounded branches complete.
- **Loading:** During execution, the proof area says it is building evidence,
  while completed sibling states remain visible.
- **Error:** A stopped execution exposes the bounded reason and a retry action,
  with no proof or download.
- **Partial:** A completed investigation with no single supported cause remains
  on the map and explicitly states why proof is unavailable.
- **Completed:** Exactly one supported cause exposes a proof-ready transition.
  The proof itself has one primary download action.

## Accessibility and responsive behavior

- Focus moves to the proof heading when it opens and returns to the hypothesis
  heading when the user goes back.
- The progress list identifies Proof as the current step.
- Native headings, lists, definition lists, buttons, and links preserve a
  meaningful source and keyboard order.
- Original and reproduced signatures use headings and text, not color alone.
- The smallest input and environment delta has a linear text representation.
- Empty, loading, error, partial, and completed states have explicit names.
- Primary actions retain a minimum 44 CSS pixel target.
- At medium widths, proof panels use a two-column layout. At narrow widths,
  every panel, signature, definition list, and diff stacks into one column.
- Reduced-motion mode does not remove any state meaning.

## Known limitations

1. The working proof covers one synthetic Express proxy-trust incident.
2. Raw standard output is not retained.
3. Investigation and proof state is not yet represented by reloadable routes.
4. Exact physical-device and assistive-technology validation remains pending.
5. Live provider execution and explicit remote cancellation are outside this
   local proof.
6. Previously recorded provider repeatability, Tavily deduplication and overage
   status, Sandbox retention and cost-unit questions, timeout evidence, and
   cancellation debt remain open.

## Step 3.5 comprehension corrections

The proxy comprehension pass replaced symbol-only signature equality with the
visible phrase `Exact match`. The runnable-test panel now states `Expected
failure, not a setup error` beside the exit-status contract. These changes make
the two most consequential proof interpretations available without requiring
the viewer to infer them from an icon or surrounding prose.
