# Evidence-Linked Hypothesis Planning

**Status:** Implemented for Gate G2.3 review

**Implementation date:** 2026-09-11

## Outcome

Scully can create a persisted investigation from the accepted proxy-identity
capsule and present three causal alternatives. Every alternative includes a
proposed mechanism, an evidence-based rationale, a testable prediction,
explicit uncertainty, accepted evidence references, and one bounded
experiment plan.

The working product uses the deterministic local planner. The Nemotron
planning adapter is connected behind the same application contract and tested
with structured fixtures, but it is not selected by the application and made
no live request in this step.

## Planning contract

One planning result contains exactly:

- three hypotheses in the `primary-cause` alternative group;
- unique titles and identifiers;
- confidence values between zero and one that sum to one;
- one or more evidence IDs from the accepted capsule per hypothesis;
- one app-owned experiment per hypothesis;
- one shared clean checkpoint;
- a fixed local executor, operation limit, and timeout.

The hypothesis contract separates observed lineage from inference. Evidence
IDs point to accepted capsule records. The proposed mechanism, rationale, and
prediction are displayed as claims to test, not established facts.

## Experiment allowlist

Planning cannot create commands, choose an executor, expand budgets, or add
new parameters. It can select only one of these exact variants:

| Variant | App-owned parameters | Question tested |
|---|---|---|
| `trust-loopback` | `trust_proxy=loopback` | Does the application trust boundary cause identity collapse? |
| `preserve-forwarded-chain` | `proxy_mode=preserve` | Does the controlled proxy overwrite forwarded identities? |
| `per-request-identity` | `limiter_key=request_ip` | Does the limiter ignore normalized request identity? |

Every plan uses the `local_fixture` adapter, at most four operations, and a
60-second deadline. These are data contracts only in Step 2.3. No experiment
is executable yet.

## Nemotron boundary

The optional adapter requests one strict tool call with exactly three
hypothesis candidates. It accepts only bounded text fields, confidence,
accepted evidence IDs, and an allowlisted variant name. The application then
assigns identifiers, checkpoint ownership, executor, parameters, operation
limit, and timeout.

Incident JSON is introduced as untrusted data. The planning prompt states
that it must never be treated as instructions. Nested runtime validation then
rejects:

- missing or additional fields;
- unallowlisted variants;
- evidence IDs outside the accepted capsule;
- duplicate alternatives or evidence links;
- confidence totals that do not equal one;
- executor, parameter, checkpoint, or budget changes.

Prompt text alone is not considered a security boundary. The app-owned schema
and post-validation allowlists are the enforcement boundary.

## Persistence and API

SQLite schema version `4` adds the planning source to an investigation. A
single transaction persists:

1. the ready investigation;
2. three complete hypothesis payloads;
3. three queued experiment plans;
4. six ordered events from `investigation.created` through
   `planning.completed`.

The event sequence is contiguous and is written before the plan is returned
to the browser.

The API adds:

- `POST /api/investigations` with one accepted `capsule_id`;
- `GET /api/investigations/{investigation_id}`.

Errors use bounded reason codes and fixed messages. Missing capsules,
unsupported local-planner capsules, duplicate investigation identifiers, and
missing investigations fail closed.

## Browser behavior

After accepting a capsule, the user can create an investigation. The browser
then shows:

- planning source and investigation ID;
- three alternative cards with confidence;
- proposed mechanism, evidence inference, and testable prediction;
- the accepted evidence links;
- the matched allowlisted experiment and its budget;
- the persisted event timeline;
- an explicit execution lock pending Gate G2.4.

## Verification coverage

Tests cover:

- deterministic local planning;
- exact hypothesis and experiment counts;
- unique alternatives and confidence totals;
- evidence-reference containment;
- exact variant, parameter, checkpoint, executor, and budget restrictions;
- unsupported capsules;
- strict structured Nemotron response mapping with no live call;
- additional model fields and unallowlisted variants;
- hostile instructions embedded in capsule text;
- atomic persistence and round-trip loading;
- missing resources and identifier conflicts;
- API creation and retrieval;
- browser creation and display of all three alternatives.

## Known limitations

1. The deterministic local planner supports only the seeded proxy incident.
2. Nemotron has not been exercised through the product path, so live
   repeatability remains unproven.
3. The three hypotheses are constrained as primary-cause alternatives, but
   semantic exclusivity still depends on the planner and later experiment
   results.
4. Planning does not yet execute branches or evaluate the failure signature.
5. Streaming, retries, local execution deadlines, and terminal-state behavior
   begin in Step 2.4.
6. Explicit provider cancellation remains known technical debt. No further
   termination probe is approved.
