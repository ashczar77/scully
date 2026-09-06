# Phase 0 Candidate Incidents

**Status:** Manual validation approved at Gate G0.3

**Date:** 2026-09-05

## Purpose

Step 0.2 requires three incident candidates that can be investigated without
production credentials, customer records, secrets, or unclear data rights.
These candidates are synthetic reconstructions based on publicly documented
behavior across three application ecosystems. No third-party application code,
private logs, or personal data is included.

## Selection rules

Phase 0 selects incidents by problem quality and evidence safety, not by the
language or framework that Scully may later use for its own implementation.
The candidate set must:

- define the capsule independently of programming language;
- cover at least two application ecosystems;
- represent different failure variables and evidence shapes;
- prefer a real, public, or safely reconstructable incident pattern when one
  is available;
- use synthetic evidence when it provides the clearest safety boundary;
- remain executable in an isolated environment;
- provide a stable machine-readable signature and known-good comparison;
- defer Scully's implementation stack decision to Gate G1.4.

Language diversity is not a product promise. It is a Phase 0 control against
mistaking one ecosystem's tooling conventions for a general capsule contract.

## Candidate summary

| Rank | Candidate | Ecosystem | Primary variable | Required signature | Safety disposition |
|---:|---|---|---|---|---|
| 1 | [Proxy identity collapse](candidates/proxy-identity-collapse.md) | Node.js and Express | Reverse-proxy trust configuration plus forwarded client addresses | Two distinct clients produce HTTP 200 then HTTP 429 under one internal identity | Safe to validate |
| 2 | [Pydantic settings migration failure](candidates/pydantic-settings-migration.md) | Python and Pydantic | Resolved dependency version plus a settings import | Process exits with a normalized `PydanticImportError` | Safe to validate |
| 3 | [Jackson classpath version skew](candidates/jackson-classpath-version-skew.md) | JVM and Jackson | Compile-time and runtime library-version mismatch | Request fails with a normalized `NoSuchMethodError` | Safe to validate |

The ranking is provisional. Gate G0.2 decides only whether the evidence is
safe and rights-cleared. Steps 0.3 and 0.4 determine reproducibility, user
value, and the final demonstration case.

## Technology-neutral capsule rules

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

| Dimension | Proxy identity collapse | Pydantic settings migration | Jackson classpath version skew |
|---|---|---|---|
| Production-specific quality | High, depends on reverse-proxy topology | Medium, depends on deployed dependency resolution | High, depends on the packaged runtime classpath |
| Branching value | High, several config and header hypotheses | Medium, package and import hypotheses | High, several transitive dependency and classpath hypotheses |
| Signature clarity | High, HTTP sequence plus normalized client identity | High, process exit plus stable error type and tokens | High, request failure plus missing method descriptor |
| Known-good comparison | Correct trusted-proxy boundary | Pydantic 1 or migrated settings import | Consistent Jackson versions managed as one set |
| External services required | None | None | None |
| Expected manual setup | Low | Low | Medium |
| Main validation risk | A custom limiter may feel artificial | Failure may be too easy to diagnose | Exact version-skew fixture may require careful pinning |

## Step 0.2 conclusion

All three candidate capsules are safe to assemble for manual reproduction.
They span Node.js, Python, and JVM applications while using the same
technology-neutral evidence contract. They use synthetic evidence, documented
software behavior, explicit licenses, reserved network examples where needed,
and no production access. Manual validation later reproduced all three cases
in three clean runs each, with three known-good non-matches each. The evidence
and limitations are recorded in the
[Step 0.3 results](manual-reproduction-results.md).
