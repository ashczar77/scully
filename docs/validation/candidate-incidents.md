# Phase 0 Candidate Incidents

**Status:** Proposed for Gate G0.2

**Date:** 2026-09-05

## Purpose

Step 0.2 requires three incident candidates that can be investigated without
production credentials, customer records, secrets, or unclear data rights.
These candidates are synthetic reconstructions based on publicly documented
Node.js and Express behavior. No third-party application code, private logs, or
personal data is included.

All three candidates use the same broad implementation environment so later
validation measures the reproduction workflow rather than cross-language
support:

- JavaScript or TypeScript;
- Node.js;
- small HTTP services or workers;
- container-runnable dependencies;
- machine-readable failure signatures.

## Candidate summary

| Rank | Candidate | Primary variable | Required signature | Safety disposition |
|---:|---|---|---|---|
| 1 | [Proxy identity collapse](candidates/proxy-identity-collapse.md) | Reverse-proxy trust configuration plus forwarded client addresses | Two distinct clients produce HTTP 200 then HTTP 429 under one internal identity | Safe to validate |
| 2 | [Express wildcard upgrade failure](candidates/express-wildcard-upgrade.md) | Express 4 to Express 5 dependency change plus an unnamed wildcard route | Process exits with a normalized missing-parameter route error | Safe to validate |
| 3 | [Localhost address-family mismatch](candidates/localhost-address-family.md) | Node.js DNS result order plus an IPv4-only local dependency | Connection fails with `ECONNREFUSED` to `::1` | Safe to validate |

The ranking is provisional. Gate G0.2 decides only whether the evidence is
safe and rights-cleared. Steps 0.3 and 0.4 determine reproducibility, user
value, and the final demonstration case.

## Common capsule rules

Each draft capsule contains or plans only:

- original project-created fixture code;
- synthetic requests, logs, configuration, and test output;
- public package names and version metadata;
- citations to primary technical documentation or public issue records;
- a versioned failure-signature definition;
- a known-good comparison;
- an artifact inventory with provenance, sensitivity, redaction, and rights.

The capsules must not contain:

- access tokens, passwords, connection strings, or private keys;
- real hostnames, account identifiers, customer data, or employee data;
- copied third-party application source;
- private incident exports or telemetry;
- live network dependencies after packages are installed.

## Shared safety decisions

### Synthetic network identities

Candidate 1 uses `198.51.100.10` and `198.51.100.11`. These addresses are in
TEST-NET-2, which [RFC 5737](https://www.rfc-editor.org/info/rfc5737/) reserves
for documentation. They do not identify real clients.

### Public technical evidence

The cited documentation and issue records establish relevant platform
behavior. They are not copied into the capsule. The capsule records URLs,
concise project-authored summaries, and the date accessed.

### Fixture rights

All fixture source, logs, manifests, and test data will be created for Scully
and distributed under the repository license. Package dependencies retain
their own licenses and will be installed through their normal package manager.

## Cross-candidate comparison

| Dimension | Proxy identity collapse | Express wildcard upgrade | Localhost address-family mismatch |
|---|---|---|---|
| Production-specific quality | High, depends on reverse-proxy topology | Medium, depends on deployed dependency version | High, depends on runtime and resolver environment |
| Branching value | High, several config and header hypotheses | Medium, dependency and route hypotheses | Medium, runtime, resolver, bind-address, and network hypotheses |
| Signature clarity | High, HTTP sequence plus normalized client identity | High, process exit plus stable error tokens | High, error code, address, and port |
| Known-good comparison | Correct trusted-proxy boundary | Express 4 or named Express 5 wildcard | IPv4-first resolution or dual-stack listener |
| External services required | None | None | None |
| Expected manual setup | Low | Low | Medium |
| Main validation risk | A custom limiter may feel artificial | Failure may be too easy to diagnose | Host resolver behavior may vary unless fully controlled |

## Step 0.2 conclusion

All three candidate capsules are safe to assemble for manual reproduction.
They use synthetic evidence, documented software behavior, explicit licenses,
reserved network examples, and no production access. This conclusion does not
claim that the cases reproduce successfully. That claim belongs to Gate G0.3.
