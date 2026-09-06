# Step 1.1 Access, Limits, and Cost Controls

**Status:** In progress, account verification required

**Review date:** 2026-09-06

## Objective

Verify access to every required sponsor service, document current pricing and
operational limits, and establish controls that prevent out-of-pocket spending
before any paid request or sandbox execution occurs.

Gate G1.1 is not ready for review. Public service capabilities are documented,
but this workspace has no configured credentials and the account-level billing
controls have not been inspected.

## Competition requirement

The
[official rules](https://nebiusglobalaihackathon.devpost.com/rules)
require a working application that runs on Nebius Token Factory or Nebius AI
Cloud and uses at least one NVIDIA open-source model. A Token Factory runtime
inference call satisfies the platform portion of that requirement.

Scully's current architecture also depends on Token Factory Sandboxes and
Tavily. Those services are therefore required by this project's approved plan
even where the competition rules would permit a narrower integration.

## Public access and credit facts

### Builder Program

The
[Nebius Builder Program](https://dev.nebius.com/builders)
advertises $25 in Token Factory credit and $25 in Tavily credit during its early
preview. The program is free for eligible members, but its benefits,
eligibility, and availability may change.

The advertised credits are not treated as available until the relevant account
dashboard shows the balance, expiration, and applicable services.

### Token Factory inference

The
[Token Factory quickstart](https://docs.tokenfactory.nebius.com/quickstart)
uses an OpenAI-compatible API at
`https://api.tokenfactory.nebius.com/v1/` and a project API key. Current model
availability and exact per-token prices are account and model-card facts.

The
[Token Factory model-card documentation](https://docs.tokenfactory.nebius.com/ai-models-inference/playground)
states that each card displays input and output prices in USD per million
tokens. The API can return an extended model list with `verbose=true`.

The
[rate-limit documentation](https://docs.tokenfactory.nebius.com/ai-models-inference/rate-limits)
describes dynamic request and token limits. Its example baseline is 60 requests
per minute and 400,000 tokens per minute, with automatic scaling based on
rolling 15-minute utilization. Actual limits must be read from response headers.
Rate limits control throughput, not spending.

### Token Factory billing risk

Current
[billing documentation](https://docs.tokenfactory.nebius.com/other-capabilities/billing-new)
states that onboarding requires a bank card and that card-backed accounts can
be charged automatically when a billing threshold is reached or when a
negative balance is settled at the start of a month. A $1 initial trial credit
is described separately from promotional credit.

No public account-wide hard stop at the promotional balance was found. Token
Factory use is therefore prohibited until the account shows either:

- a hard zero-dollar overage limit;
- disabled automatic charging and no path to a negative payable balance; or
- another account-level control that prevents any card charge.

Application-side estimates and rate limits are useful secondary controls. They
do not replace an account-level spending stop.

### Token Factory Sandboxes

The
[Sandboxes overview](https://docs.tokenfactory.nebius.com/sandboxes/overview)
describes a beta service with VM-level isolation, branching, rollback, OCI
images, execution metrics, asynchronous operations, and cancellation. The
published beta limits are 50 simultaneous operations and 180-day retention for
untagged, unreferenced checkpoint images.

The
[ConTree authentication guide](https://docs.tokenfactory.nebius.com/sandboxes/cli/tutorial/installation)
requires a bearer token and project ID. A successful `contree auth ls` health
check reports `ok` only when the token is valid and has the required sandbox
permission.

The public documentation reviewed here does not establish:

- whether this account has beta access;
- sandbox prices or whether promotional credit covers sandbox execution;
- the general outbound-network policy for running commands;
- account-specific CPU, memory, storage, runtime, or operation quotas.

These items require an authenticated console check and a minimal capability
probe before Gate G1.1.

### Tavily

The
[Tavily credit documentation](https://docs.tavily.com/documentation/api-credits)
provides 1,000 free API credits per month without a credit card. Basic search
costs 1 credit, advanced search costs 2, and basic extraction costs 1 credit
per five successful URLs. Tavily Research has a much wider dynamic cost range
and is not authorized for the initial prototype.

The
[Tavily rate-limit documentation](https://docs.tavily.com/documentation/rate-limits)
lists 100 requests per minute for development keys, 20 research-task creations
per minute, and 10 usage requests per 10 minutes. A 429 response includes a
`retry-after` value.

The
[Tavily usage endpoint](https://docs.tavily.com/documentation/api-reference/endpoint/usage)
reports key and account usage, limits, plan usage, and pay-as-you-go usage. Each
search response can also report the credits consumed.

Tavily use is prohibited if pay-as-you-go billing or a paid plan is active for
the project key. The free Researcher allocation is sufficient for Step 1.1 and
the planned prototype.

## Local access audit

The audit inspected credential names and tool presence without reading or
printing any secret value.

| Check | Result |
|---|---|
| `NEBIUS_API_KEY`, `CONTREE_TOKEN`, or related environment name | Not present |
| `TAVILY_API_KEY` environment name | Not present |
| Nebius CLI | Not installed |
| ConTree CLI | Not installed |
| Saved ConTree profile | Not present |
| Saved Nebius CLI profile | Not present |
| Tavily CLI | Not installed |
| Docker client | Installed |
| Docker daemon | Unavailable |
| `curl` and `jq` | Available |

No inference, search, sandbox, or billable request was made.

## Credential handling

- Store local values only in `.env` or an external secret manager.
- Never put a token in a command-line argument, committed file, log, fixture,
  screenshot, or gate record.
- Use `.env.example` for required variable names only.
- Use a project-specific key for each service.
- Prefer least-privilege project membership and revoke test keys after the
  event.
- Never upload an unreviewed capsule to an external service.

The repository ignores `.env` and all `.env.*` variants except
`.env.example`.

## Zero-spend policy

### Global rules

1. Out-of-pocket spending limit is exactly $0.
2. Paid plans, pay-as-you-go, automatic top-ups, dedicated endpoints,
   fine-tuning, and other hourly resources are prohibited.
3. A service cannot be used until its account-level overage control is verified.
4. Promotional and free balances are the only authorized funding sources.
5. Stop at the lower of the internal cap or the verified remaining free balance.
6. Unknown prices count as unaffordable until verified.

### Internal caps

| Resource | Step 1.1 cap | Hackathon cap | Required reserve |
|---|---:|---:|---:|
| Token Factory inference | $0.50 | Lower of $10 or 40% of verified promotional balance | At least 60% of verified promotional balance |
| Tavily | 5 API credits | 250 API credits per calendar month | At least 750 free monthly credits |
| Sandboxes | 2 minimal operations | 100 operations, subject to verified pricing | At least 80% of any metered free allowance |

The sandbox operation caps do not authorize execution while pricing and credit
coverage remain unknown.

## Per-investigation budget

Each development investigation must declare its budget before execution:

| Meter | Default maximum |
|---|---:|
| Token Factory model calls | 8 |
| Total model input tokens | 200,000 |
| Total model output tokens | 32,000 |
| Tavily credits | 10 |
| Sandbox operations | 12 |
| Sandbox aggregate CPU time | 20 minutes |
| Wall-clock duration | 30 minutes |

The monetary model cap is calculated from the current model card before the
first request. If the worst-case input and output token cost exceeds the
remaining investigation allocation, reduce the token caps or do not run.

## Measurement record

Record the following for every investigation without storing secrets or full
sensitive prompts:

- investigation ID and UTC start and end time;
- starting and ending promotional balance;
- model ID, published input price, and published output price;
- input, output, cached, and reasoning tokens reported by each model response;
- calculated model cost and relevant rate-limit headers;
- Tavily endpoint, search or extraction depth, response credit usage, and
  usage-endpoint totals;
- sandbox operation IDs, terminal state, CPU time, memory, I/O, and wall time;
- cancellation, retry, 429, timeout, and failed-operation counts;
- final remaining budget and the reason for any early stop.

## Fail-closed controls

- Set Token Factory `service_tier` to `default`, not `auto`, so crossing the
  active throughput limit returns 429 rather than using over-limit processing.
- Set explicit maximum output tokens and maximum tool calls on every request.
- Use basic Tavily search by default and set `auto_parameters=false` so search
  depth cannot silently become advanced.
- Request Tavily usage before and after each investigation.
- Reject a run when remaining allowance cannot cover its declared worst case.
- Cancel all outstanding sandbox operations when the investigation budget or
  wall-clock limit is reached.
- Treat missing usage metadata, missing prices, or an unreadable balance as a
  hard stop.

## Account verification checklist

- [ ] Hackathon registration is active.
- [ ] Builder Program eligibility is confirmed.
- [ ] Token Factory promotional balance and expiration are recorded.
- [ ] A bank card cannot be charged by project usage.
- [ ] A project-scoped Token Factory key authenticates successfully.
- [ ] An available NVIDIA Nemotron model accepts promotional credit.
- [ ] Current Nemotron input and output prices are recorded.
- [ ] Token Factory rate-limit headers are captured.
- [ ] Sandbox beta permission is active for the project.
- [ ] Sandbox price and promotional-credit coverage are recorded.
- [ ] Sandbox outbound-network and resource limits are recorded.
- [ ] A development Tavily key authenticates on the free Researcher plan.
- [ ] Tavily pay-as-you-go usage and limit are both zero.
- [ ] Tavily `/usage` confirms the free limit and remaining credits.
- [ ] All test keys are stored outside Git.

## Gate G1.1 readiness

**Current disposition:** Not ready

The service documentation and internal controls are sufficient to guide account
setup, but none of the required authenticated services is currently available
from this workspace. The Token Factory automatic-charging behavior and unknown
sandbox pricing are unresolved zero-spend risks.

Gate G1.1 may be submitted only after every account-verification item above is
complete and a minimal authenticated check succeeds for inference, Nemotron,
Sandboxes, and Tavily without exceeding the Step 1.1 caps.
