# Realistic Incident Integration

**Status:** Implemented for Gate G4.1 review

**Implementation date:** 2026-09-12

## Outcome

Scully now investigates a sanitized realistic Express incident through an
actual loopback reverse proxy and application server. The selected case keeps
the safe synthetic traffic boundary while reproducing the behavior that makes
the failure production-only: direct development traffic works, but two clients
behind an untrusted proxy collapse into one rate-limit identity.

The in-product path no longer determines branch observations through a Python
behavior table. It runs the reviewed Node.js fixture, observes HTTP behavior,
and gives the result to the existing deterministic signature evaluator.

## Reviewed capsule

Capsule `proxy-identity-collapse-v2` contains six JSON evidence files:

1. a pinned Node.js, Express, limiter, and proxy environment;
2. the exact two-request synthetic traffic sequence;
3. the observed incident result;
4. the one-variable known-good result;
5. public documentation and operational source links;
6. an explicit rights and restriction review.

The stable failure signature remains `proxy-identity-collapse-v1`. Keeping the
signature identifier stable makes the observation contract independent of the
capsule revision that carries richer provenance and topology evidence.

## Realistic topology

The fixture starts two separate servers on ephemeral loopback ports. The test
client sends a TEST-NET-2 identity marker to the proxy. The proxy validates the
marker, writes `X-Forwarded-For`, and forwards the request to Express. The
application never accepts the test-only marker as its normalized client
identity.

This creates the boundary that matters in deployed Express services:

1. the application sees the proxy socket as its direct peer;
2. the proxy supplies distinct forwarded client addresses;
3. Express ignores those addresses when `trust proxy` is false;
4. the limiter keys both requests to the same normalized identity;
5. the second client receives HTTP 429.

With only the loopback proxy trusted, Express resolves the two TEST-NET-2
addresses separately and both requests receive HTTP 200.

## Competing hypotheses

| Hypothesis | One-variable test | Expected discriminating result |
|---|---|---|
| Express proxy trust is disabled | Trust only the loopback hop | Signature disappears and responses become `200,200` |
| The proxy overwrites the forwarded chain | Preserve the incoming chain | Signature remains because distinct forwarded clients were already reaching Express |
| The limiter ignores request identity | Select the request-IP key | Signature remains because the normalized request IP is still the proxy socket |

All three branches execute the same reviewed HTTP fixture. Their results are
not selected by capsule ID. A regression test changes the signature expectation
while retaining the capsule ID and confirms that no fixed winning cause is
returned.

## Execution boundary

- The application launches Node.js directly and never invokes a shell.
- The local runner accepts only the three reviewed variant names.
- Node.js 22.22.2 is checked by the branch entry point.
- Both servers bind only to `127.0.0.1`.
- No provider client or external network request is made.
- Standard output and standard error are bounded before parsing.
- The runner requires a strict result envelope, exact client sequence, and one
  declared proxy hop.
- Capsule and planner text cannot supply an executable, path, argument list, or
  environment variable.

## Rights and privacy

The application, reverse proxy, limiter, harness, and observations are
project-created. The client addresses come from the RFC 5737 documentation
range. The capsule includes only URLs and project-authored source-purpose
labels, not copied third-party application material. Express is installed from
its pinned public package and retains its dependency license.

The capsule contains no credentials, customer records, production hostnames,
real network identities, or production source. The existing capsule import
scan and hash checks apply to every evidence file.

## Verification

- Three incident runs produced identical structured observations with
  responses `200,429`, one identity digest, one limiter bucket, and one proxy
  hop.
- Three known-good runs produced identical structured observations with
  responses `200,200`, two identity digests, two limiter buckets, and one proxy
  hop.
- The standalone verification command proved the incident, known-good result,
  and expected failing regression test.
- The full backend suite passed 162 tests.
- The frontend suite passed 6 tests.
- Type checking, production build, bytecode compilation, and dependency checks
  passed.
- Provider requests and credits used: zero.

## Retained limitations

1. The deterministic local planner still supports this selected incident only.
2. Step 4.2 must minimize and package the successful branch as an independently
   reviewed artifact.
3. Clean-checkout and sponsor-stack repeatability remain Gate G4.4 work.
4. Direct target-engineer validation remains explicit debt.
5. Previously recorded provider repeatability, Tavily deduplication and overage
   status, Sandbox retention and cost-unit questions, timeout evidence, and
   explicit cancellation debt remain open.
