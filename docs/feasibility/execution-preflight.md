# Step 1.2 Integration and Execution Preflight

**Status:** Approved at checkpoint G1.2d

**Review date:** 2026-09-07

## Objective

Prove that the current provider SDKs install together, construct the real
clients behind the approved contracts, and expose a credential-safe local
preflight before any provider request is authorized.

## Locked integration

The direct runtime dependencies are:

| Package | Version | Role |
|---|---:|---|
| `openai` | 3.8.0 | OpenAI-compatible Token Factory client |
| `tavily-python` | 0.8.1 | Tavily search client |
| `contree-sdk` | 0.3.3 | Token Factory Sandbox client |

The direct constraints and build backend are exact in `pyproject.toml`.
`requirements.lock` records the complete environment resolved on Python
3.14.6. Package versions were checked against their current PyPI releases on
2026-09-07:

- [OpenAI Python package](https://pypi.org/project/openai/)
- [Tavily Python package](https://pypi.org/project/tavily-python/)
- [ConTree SDK package](https://pypi.org/project/contree-sdk/)
- [Setuptools build backend](https://pypi.org/project/setuptools/)

The separate `contree-client` package is not a runtime dependency. ConTree SDK
0.3.3 supplies its own transport and accepts explicit `IAMAuth` and
`ContreeConfig` values.

## Client construction

`src/scully/providers/clients.py` constructs each reviewed client only after
the provider-specific live gate and exact package-version check pass:

- Nemotron uses the Token Factory base URL, the configured timeout, and zero
  automatic retries;
- Tavily receives its key and optional project identifier explicitly;
- ConTree receives its key, project identifier, transport timeout, and
  operation timeouts explicitly.

No client is created during module import. The constructors do not invoke a
model, search endpoint, image operation, identity endpoint, or other provider
method.

## Read-only preflight

`python -m scully.preflight` reads only process environment metadata and local
package metadata. It reports:

- whether live mode is enabled;
- which single provider is targeted by `SCULLY_LIVE_PROVIDER`;
- whether each credential is configured, never its value;
- whether each exact direct dependency is installed;
- whether the per-provider budget matches the reviewed probe shape;
- the worst-case Nemotron token cost under the configured caps.

The report always declares `performs_provider_calls` as false and
`review_required` as true. The module has no import or call path to a provider
client constructor. Shared dependency checks read installed-package metadata
without importing a provider SDK.

At the safe defaults, the local report keeps every live gate closed. The
Sandbox budget is intentionally invalid for the branch proof because the
default permits one operation while the minimum reviewed lifecycle requires
four. That value must be changed to exactly four only when the Sandbox probe is
separately reviewed.

Live execution now requires both the global switch and an exact provider
target. Selecting `sandbox`, for example, leaves the Nemotron and Tavily gates
closed even when their credentials and budgets are otherwise valid. This
prevents one approval from enabling an unrelated provider.

## Verification evidence

The following checks passed in an ignored Python 3.14.6 virtual environment:

```shell
.venv/bin/python -m pip check
PYTHONPATH=src .venv/bin/python -m unittest discover -s tests -v
.venv/bin/python -m compileall -q src tests
PYTHONPATH=src .venv/bin/python -m scully.preflight
```

- All exact dependencies installed together.
- Forty-eight tests passed.
- Real clients constructed with synthetic credentials without sending
  requests.
- The CLI emitted valid JSON with no credential values.
- The default report showed live mode disabled.
- No model, Tavily API, or Sandbox operation was used.

## Remaining execution review

Before the first Nemotron request:

1. confirm the displayed Token Factory balance remains positive;
2. confirm usage still stops at the account limit;
3. load the local environment into one terminal session;
4. run the preflight and inspect its redacted output;
5. approve one call with the fixed model, token caps, and $0.01 maximum model
   cost.

Approval at G1.2d authorizes implementation and execution of that single
Nemotron probe only. It does not authorize a Tavily API request or a Sandbox
operation.
