# Step 1.2 Provider Contracts

**Status:** Approved at checkpoint G1.2c

**Review date:** 2026-09-07

## Objective

Define and test the narrow boundaries between Scully and each sponsor service
before installing provider dependencies or sending live requests.

## Verified interfaces

The contracts were checked against the current official documentation:

- [Token Factory function calling](https://docs.tokenfactory.nebius.com/ai-models-inference/function-calling)
  defines OpenAI-compatible function tools and tool calls;
- [Token Factory chat completions](https://docs.tokenfactory.nebius.com/api-reference/inference/create-chat-completion)
  defines model, message, tool, token, storage, streaming, and service-tier
  parameters;
- [Tavily Python SDK](https://docs.tavily.com/sdk/python/reference)
  defines basic search, the 400-character query boundary, result provenance,
  automatic-parameter control, and optional usage reporting;
- [ConTree command execution](https://docs.tokenfactory.nebius.com/sandboxes/sdk/python_sdk/running-commands)
  defines direct command arguments, persisted image states, output, exit code,
  and resulting image identifiers;
- [ConTree branching](https://docs.tokenfactory.nebius.com/sandboxes/sdk/python_sdk/branching)
  defines independent child runs from one common image state;
- [ConTree client construction](https://docs.tokenfactory.nebius.com/sandboxes/sdk/python_sdk/reference/client)
  defines client configuration, authentication, and operation behavior.

## Contract boundaries

### Nemotron

`NemotronAdapter` accepts an injected OpenAI-compatible completion client and:

- requires explicit live enablement and a Nebius key;
- estimates request size before the call;
- rejects a worst-case token cost above the declared cap;
- requests one non-streaming, non-stored completion;
- sets `service_tier` to `default` and caps output tokens;
- forces one named tool and accepts exactly one completion choice and tool call;
- parses tool arguments as JSON and validates required fields, extra fields,
  primitive types, and enums;
- requires non-negative token usage and calculates cost with decimal arithmetic;
- records only usage, timing, operation, and status metadata.

### Tavily

`TavilyAdapter` accepts an injected official Python SDK client and:

- requires explicit live enablement and a Tavily key;
- rejects empty queries and queries above 400 characters before the request;
- fixes search depth to `basic` and disables automatic parameters;
- excludes generated answers, raw page content, and images;
- requests at most five results and requests usage metadata;
- accepts only HTTP or HTTPS source URLs with a network location;
- validates titles, snippets, and finite relevance scores;
- fails closed when credit usage is absent or exceeds the declared cap;
- preserves source URLs while excluding request content from measurements.

### Sandboxes

`SandboxAdapter` accepts an injected synchronous ConTree client and:

- requires explicit live enablement, a Nebius key, and a project identifier;
- selects the base image with strict resolution;
- accepts an explicit executable and argument vector instead of implicit shell
  mode;
- rejects non-absolute executables and null bytes;
- rejects a lifecycle that exceeds the operation cap before selecting an image;
- persists one prepared parent and runs at least two children from that same
  parent;
- records branch image identifiers, text output, exit codes, available CPU time,
  operation count, and wall time;
- stops before child execution if parent preparation fails.

Sandbox operation accounting conservatively includes image selection,
preparation, and every branch. Each captured standard-output or standard-error
value is limited to 20,000 characters. Tavily snippets are limited to 5,000
characters per result.

The current contract leaves all resulting states untagged. Exact cleanup and
discard behavior must be verified during the bounded Sandbox probe because the
documented SDK flow relies on unreferenced image retention rather than an
explicit image-delete method.

## Dependency boundary at review

The provider modules use structural protocols and injected clients. They do not
import or install `openai`, `tavily-python`, `contree-sdk`, or a transport
package. Mocked tests therefore exercise the call shapes, validation, budgets,
and normalization without a path to any external service.

Provider dependency versions and real client construction were intentionally
deferred to the next reviewed increment. Supplying an injected real client
still requires `SCULLY_ENABLE_LIVE=true` and the appropriate provider
credentials.

## Test evidence

The command below passes 39 tests:

```shell
PYTHONPATH=src python3 -m unittest discover -s tests -v
```

The provider-specific tests verify:

- fixed cost and storage controls in the Nemotron request;
- rejection of malformed, unexpected, or wrongly typed tool arguments;
- pre-request blocking when the declared model budget is unsafe;
- fixed basic Tavily search parameters and retained URL provenance;
- rejection of missing usage, invalid URLs, and oversized queries;
- common-parent Sandbox branching and aggregate CPU accounting;
- pre-request Sandbox operation limits and parent-failure behavior.

No test imports a provider package, reads a local credential, opens a network
connection, or creates an infrastructure operation.

## Risks recorded at checkpoint G1.2c

- Tavily documents the `include_usage` option but does not show the usage field
  shape in its search response table. The bridge must capture one bounded
  response and either confirm or revise the accepted normalization shape.
- Token Factory rate-limit headers require access to the underlying HTTP
  response and are not yet represented by the injected completion interface.
- ConTree CPU metrics and cleanup behavior require inspection of the first
  bounded operation result.
- Provider package versions and their Python 3.14 compatibility were not yet
  locked or tested at this checkpoint. The G1.2d submission resolves this item.
- Failure measurements for SDK exceptions belong in the executable probe runner,
  which is not implemented at this checkpoint.

## Review decision

Approved on 2026-09-07. The decision authorized dependency locking, inert
real-client construction, and preparation of the execution preflight. It did
not authorize a live provider request or Sandbox operation.
