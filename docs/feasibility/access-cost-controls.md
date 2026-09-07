# Step 1.1 Access, Limits, and Cost Controls

**Status:** Approved at G1.1, execution checks deferred to Step 1.2

**Review date:** 2026-09-07

## Objective

Verify access to every required sponsor service, document current pricing and
operational limits, and establish controls that prevent out-of-pocket spending
before any paid request or sandbox execution occurs.

Gate G1.1 is approved with execution conditions. Token Factory, Tavily, and
Sandbox access are authenticated, the zero-spend boundary is recorded, and the
account is configured to stop usage after the trial. Live inference and
Sandbox probes, rate-limit capture, and final usage measurements move to the
Step 1.2 execution preflight and must be reviewed before the first live run.

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
probe before Step 1.2 can execute live infrastructure.

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

Tavily application API use is prohibited until the available free allocation,
paid-overage behavior, and a stop-before-overage control are verified for the
project key. The planned prototype must stay within the recorded free
allocation.

## Local access audit

The audit inspected credential names and tool presence without reading or
printing any secret value.

| Check | Result |
|---|---|
| `NEBIUS_API_KEY` environment name | Present in ignored local `.env`; value not inspected or printed |
| `CONTREE_PROJECT` environment name | Present in ignored local `.env`; value not published |
| `TAVILY_API_KEY` environment name | Not present |
| Nebius CLI | Not installed |
| ConTree CLI | Installed, version 0.9.4 |
| Saved ConTree profile | Present; authenticated health status is `ok` |
| Saved Nebius CLI profile | Not present |
| Tavily CLI | Installed, version 0.1.8; OAuth authenticated |
| Docker client | Installed |
| Docker daemon | Unavailable |
| `curl` and `jq` | Available |

No inference or Sandbox operation has been performed. A read-only Token Factory
model-list request authenticated successfully. Tavily authentication and live
basic search were verified.

## Account verification evidence

The following account-specific facts were verified on 7 September 2026 without
publishing credentials or account identifiers:

- hackathon registration is active;
- the Builder Program application was accepted and the activation flow supplied
  a Token Factory promotional code;
- the Token Factory account shows a $25 promotional balance;
- the account also shows a $1 trial balance with 29 days remaining;
- the selected account usage mode states that usage stops after the trial;
- the project-scoped Token Factory key authenticated with HTTP 200 against the
  read-only model-list endpoint;
- `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` is available through a public endpoint
  in `eu-north1`, with tool calling and reasoning support;
- the displayed price is $0.06 per million input tokens and $0.24 per million
  output tokens;
- the Sandbox console states that the beta is free and does not consume credits;
- Sandbox beta access is active for the project;
- ConTree CLI 0.9.4 is installed, its project identifier is stored locally, and
  its authenticated profile health status is `ok`;
- a read-only ConTree request returned the public Python image catalog;
- Tavily CLI 0.1.8 is OAuth authenticated and completed a live basic search.

Detailed consumption checks are deferred until immediately before the first
live infrastructure run. The zero-spend policy and fail-closed controls remain
the acceptance boundary for that run.

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

| Resource | First live probe cap | Hackathon cap | Required reserve |
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

## G1.1 setup checklist

- [x] Hackathon registration is active.
- [x] Builder Program eligibility is confirmed.
- [x] Token Factory promotional balance is recorded.
- [x] The account usage mode is set to stop usage after the trial.
- [x] A project-scoped Token Factory key authenticates successfully.
- [x] Current Nemotron input and output prices are recorded.
- [x] Sandbox beta permission is active for the project.
- [x] The Sandbox console records beta usage as free and not consuming credits.
- [x] Tavily CLI OAuth authentication and a live basic search succeed.
- [x] All configured test keys are stored outside Git.

## Step 1.2 execution preflight

The following checks remain deliberately incomplete. They must be reviewed
immediately before the first live inference call or Sandbox operation:

- [ ] Record the current Token Factory balance and promotional expiration.
- [ ] Confirm the selected Nemotron model can use the available balance.
- [ ] Calculate and approve the first probe's worst-case token cost.
- [ ] Capture Token Factory rate-limit headers from the first bounded response.
- [ ] Confirm current Sandbox beta pricing and account coverage.
- [ ] Record applicable Sandbox outbound-network and resource limits.
- [ ] Confirm Tavily pay-as-you-go usage and limit are both zero.
- [ ] Record Tavily usage and remaining credits before and after the probe.
- [ ] Declare operation, token, credit, CPU-time, and wall-clock limits.

No live infrastructure execution is authorized until this preflight is
reviewed. The probes will then run through the Step 1.2 scaffold so their
behavior, latency, reliability, and usage become reusable project evidence.

## Gate G1.1 disposition

**Current disposition:** Approved with execution conditions

Access, account controls, credentials, published pricing, Sandbox beta status,
and measurement rules are sufficient to begin the Step 1.2 scaffold. This
approval does not authorize an unbounded model request or Sandbox operation.
The execution preflight above remains a mandatory checkpoint before live use.
