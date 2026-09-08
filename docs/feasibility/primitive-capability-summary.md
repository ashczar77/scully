# Step 1.2 Primitive Capability Summary

**Status:** In review at Gate G1.2

## Decision question

Do Nemotron, Tavily, and Token Factory Sandboxes each perform a necessary role
with behavior stable enough to support the Scully demonstration?

## Measured capability evidence

| Primitive | Necessary product role | Reviewed result | Measured usage | Wall time |
|---|---|---|---:|---:|
| NVIDIA Nemotron through Token Factory | Convert normalized evidence into constrained hypotheses and tool instructions | One schema-valid forced tool call under the final configuration | 474 input tokens, 935 output tokens, $0.00025284 | 3.830568 seconds |
| Tavily | Find attributable, version-specific public evidence for an incident | Five validated Express source URLs from one basic search | 1 credit | 3.553558 seconds |
| Token Factory Sandboxes through ConTree | Prepare a common execution state and test competing changes in sibling branches | One parent and two successful, distinct branches with sibling separation | 4 counted operations, reported cost 0.00144547 with unspecified unit | 7.325823 seconds |

The successful probes took 14.709949 seconds in aggregate. The figure is a
sum of separate capability probes, not an end-to-end product latency claim.

## Capability conclusions

### Nemotron

Nemotron is suitable for constrained hypothesis planning and tool selection.
The final request produced exactly one schema-valid tool call with four required
fields, no retry, and cost well below the reviewed ceiling.

Reliability evidence is limited. The first attempt exposed an instrumentation
ordering defect. The second used all 1,024 allowed output tokens on reasoning
without reaching a tool call. The final model-specific configuration succeeded
once with a 10,000-token allowance, temperature 0.6, top-p 0.95, a forced tool,
and parallel calls disabled. That exact configuration is the current baseline,
but one success is not enough to claim broad production reliability.

### Tavily

Tavily is suitable for retrieving attributable public documentation. One
basic-depth search returned five valid URLs from the requested official domain
and reported exactly one credit.

The results were language and protocol variants of one Express guide. The
retrieval primitive is proven, while canonicalization and deduplication remain
required before sources are presented or counted as independent evidence.
Paid-overage status and remaining allowance were not read from the usage
endpoint, so expanded Tavily use remains blocked pending that account check.

### Token Factory Sandboxes

ConTree is suitable for creating a common parent state and running independent
experiment branches. Both children inherited the parent marker, and the second
child confirmed that the first child's change was absent.

The successful lifecycle left three untagged states containing only fixed
synthetic files. ConTree SDK 0.3.3 exposes no public delete operation. The
public result also returned a cost value without documenting its unit. Those
facts require a retention policy and further cost interpretation before a
general investigation budget can be enforced.

## Combined architecture fit

The primitives form a coherent path:

```text
Sanitized evidence
    -> Nemotron proposes constrained hypotheses and tool instructions
    -> Tavily attaches current public sources where external facts are needed
    -> ConTree executes sibling experiments from a common checkpoint
    -> Deterministic code compares each result with the incident signature
```

No primitive substitutes for the deterministic evaluator. Nemotron may propose
an experiment, but only code may decide whether the observed failure signature
was reproduced.

## Fallback decisions

| Failure | Development fallback | Submission boundary |
|---|---|---|
| Selected Nemotron endpoint unavailable | Use another available NVIDIA open-source model through Token Factory after repeating the structured-output probe | The final application must still make a runtime Token Factory or Nebius AI Cloud call using an NVIDIA open-source model |
| Tavily temporarily unavailable | Use a reviewed local source fixture so ingestion and evidence-lineage work can continue | A cached fixture does not qualify for the Best Use of Tavily bonus; the submitted solution must make a functional runtime Tavily call to claim it |
| Token Factory Sandbox temporarily unavailable | Use local containers for deterministic development and fixture testing | A local-only execution path is not the intended Coding and Agentic Engineering submission; the final product must retain functioning Token Factory Sandbox execution or move to an approved Nebius AI Cloud design |

Fallbacks preserve development progress. They do not justify representing a
local replay or cached result as a functioning sponsor integration.

## Competition alignment

The [official rules](https://nebiusglobalaihackathon.devpost.com/rules), checked
on 2026-09-08, require a working application that runs on Token Factory or
Nebius AI Cloud and uses at least one NVIDIA open-source model. They define a
Token Factory inference request as a qualifying runtime call. The Coding and
Agentic Engineering track specifically covers developer tools that write, run,
and test code in Token Factory Sandboxes.

Scully's planned runtime use of Nemotron through Token Factory satisfies the
base platform and model requirement. Its experiment scheduler and ConTree
branches directly match the proposed track. Tavily is an authorized third-party
integration and supports the source-evidence function. Eligibility for the Best
Use of Tavily bonus requires a functional runtime Tavily call in the submitted
solution, not only the feasibility probe.

The current scaffold is a capability harness, not yet a working submission.
Competition compliance therefore remains conditional on the later product
integrating these runtime paths, publishing the required working demo and
source, and satisfying all submission requirements.

## Step 1.2 conclusion

All three primitives perform necessary, non-duplicative roles and have passed
their bounded capability contracts. Their behavior is stable enough to proceed
to execution-integrity testing, provided the recorded limits remain explicit.

Approval should authorize Step 1.3 offline design and mocked implementation
only. Any new live timeout, cancellation, or branch operation requires a
separate execution review with an exact operation budget. Expanded Tavily use
also requires verification of its remaining allowance and paid-overage state.
