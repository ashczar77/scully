# Step 1.2 Tavily Capability Probe

**Status:** Live result in review at checkpoint G1.2j

## Objective

Verify that one Tavily search can find current, attributable public evidence
for the synthetic proxy-identity incident within a one-credit boundary.

## Search design

The fixed search asks for official Express documentation about `trust proxy`,
`X-Forwarded-For`, and `req.ip`. It is 74 characters and contains no production
data, customer data, credential, or generated model output.

The request is fixed to:

| Control | Value |
|---|---:|
| Search depth | `basic` |
| Topic | `general` |
| Maximum results | 5 |
| Included domain | `expressjs.com` |
| Maximum credits | 1 |
| Automatic parameters | Disabled |
| Generated answer | Disabled |
| Raw page content | Disabled |
| Images | Disabled |
| Usage metadata | Required |
| Timeout | 60 seconds |

The installed Tavily Python client sends one HTTP request for one `search()`
call. The project runner has no retry loop.

## Response contract

The existing adapter rejects:

- missing or malformed usage metadata;
- usage above one credit;
- more than five results;
- no result for the capability probe;
- results without non-empty titles;
- URLs without valid HTTP or HTTPS provenance;
- returned sources outside `expressjs.com`;
- non-text or oversized snippets;
- non-numeric, non-finite, or out-of-range relevance scores.

The live response is validated in memory. The durable probe record retains
only:

- source count and source URLs;
- whether a request identifier was present, not its value;
- provider-reported response time when valid;
- local start, end, duration, request count, retry count, and credit usage;
- a safe failure class and stage if the request fails.

Returned titles, snippets, query text, request identifiers, provider error
messages, and credentials are not written to the record.

## Offline verification

The complete suite passes 62 tests. Tavily-specific tests verify:

- the exact request options and `expressjs.com` allowlist;
- preservation of source URLs without returned text;
- one-credit usage capture;
- preflight rejection before client construction;
- redacted request-failure handling;
- safe structural and usage capture on contract failure;
- rejection of invalid allowlist values before a request;
- rejection of sources outside the allowlist and an empty probe result;
- rejection of invalid provenance, oversized content, and missing usage.

Dependency validation and bytecode compilation are part of the checkpoint
verification. No live Tavily search or Sandbox operation was made.

## Credential state

Tavily CLI authentication is separate from the project SDK credential. The
project preflight currently reports `credentials_configured: false` for Tavily
because `TAVILY_API_KEY` is empty in the ignored `.env` file. The live gate
therefore remains closed.

Before execution, the project owner must copy a Tavily project API key into the
local `TAVILY_API_KEY` value. The key must not be shown in chat, committed, or
added to `.env.example`.

## Live result

Checkpoint G1.2i approved exactly one search after local credential setup. The
redacted preflight confirmed that Tavily was the only open live gate, then
attempt `g1.2-tavily-001` succeeded.

The result records:

- one request and zero retries;
- one Tavily credit;
- five HTTP or HTTPS source URLs, all on `expressjs.com`;
- 3.553558 seconds of local wall time;
- 2.76 seconds of provider-reported response time;
- presence of a provider request identifier without retaining its value;
- no Nemotron request and no Sandbox operation.

The durable record is
`validation/results/g1.2-tavily-probe-001.json`. It contains no returned title,
snippet, query text, request identifier, provider message, or credential.

## Capability conclusion

Tavily has demonstrated bounded source discovery through the project adapter
with attributable public URLs and measured one-credit usage. The five results
include localized and protocol variants of the same Express guide. That does
not affect the capability proof, but production evidence handling should
canonicalize and deduplicate URLs before presenting sources.
