# Reproduction Minimization and Packaging

**Status:** Implemented for Gate G4.2 review

**Implementation date:** 2026-09-12

## Outcome

Scully now exports an independently runnable reproduction with its synthetic
trigger, declared target signature, automated minimization result, intentionally
failing regression test, and machine-readable result manifest. The package
preserves the reviewed proxy topology and the `proxy-identity-collapse-v1`
signature while excluding product-only observation and branch-control scripts.

The implementation is local and deterministic. It does not construct a live
provider client, make a provider request, or use credits.

## Minimization boundary

The automated minimizer executes the real incident and greedily removes each
top-level observation payload field that is not required to preserve all five
required signature matchers. It reduces the payload from 11 fields to four:

- `events`;
- `forwarded_clients`;
- `identity_digests`;
- `responses`.

Seven diagnostic fields remain useful inside Scully but are not necessary to
prove the exported signature. They are recorded as removed in
`minimization.json` and `reproduction.json`.

Structural reductions are guided rather than automated. The loopback proxy,
second client, and rate limiter are retained because each is part of the causal
mechanism. Removing any of them would replace the reviewed incident with a
different behavior instead of making the same proof smaller.

## Fail-closed signature check

The first minimizer verification exposed a correctness defect: two missing
paths could compare as equal for a `same_value` matcher. The path reader now
returns an explicit presence result, and equality succeeds only when both
declared paths exist. Missing required data therefore produces a non-match.

The checked-in comparison is not accepted on trust. `npm run verify` executes
the minimizer again and requires its exact result to match `minimization.json`.
It also verifies the incident response, known-good response, and intentional
regression-test exit code.

## Exported package

The archive contains 12 files under one directory:

1. package instructions;
2. pinned npm metadata;
3. synthetic request data;
4. the declared target signature;
5. the reviewed minimization comparison;
6. the reproduction and trigger implementation;
7. minimization and verification commands;
8. the intentionally failing regression test;
9. the generated `reproduction.json` result and file-hash manifest.

The packager copies only an explicit allowlist, rejects symlinks and missing
files, enforces a 2 MiB limit, fixes ZIP metadata, and records a SHA-256 digest
for every packaged source file. Product-only `observe` and `run-branch` scripts,
dependencies, local state, credentials, capsule source material, and provider
configuration are excluded.

## Independent execution result

The actual generated ZIP was extracted into a fresh temporary directory and
run without the Scully API or browser interface:

```shell
npm ci --offline
npm run minimize
npm run verify
npm test
```

The cached offline install found zero vulnerabilities. Minimization retained
four fields and removed seven while preserving the signature. Verification
exited 0 with incident responses `200,429` and known-good responses `200,200`.
The final regression test exited 1 with that exact `200,429` witness, as its
contract requires.

Normal reviewers can use `npm ci`; the offline flag was used only to prove that
the package run did not need the Scully interface or a live provider.

## Verification

- Backend suite: 162 tests passed.
- Frontend suite: 6 tests passed.
- TypeScript type check: passed.
- Production frontend build: passed.
- Python bytecode compilation: passed.
- Installed Python dependency check: passed.
- Template minimization and verification: passed.
- Extracted archive minimization and verification: passed.
- Extracted archive regression test: expected exit 1 observed.
- Live provider requests: zero.
- Provider credits consumed: zero.

## Retained limitations

1. Automated minimization currently removes observation fields only. Structural
   reductions are explicit reviewed decisions.
2. The package supports the selected Express proxy-trust incident only.
3. Broader adversarial export checks were added in Step 4.3.
4. Clean-checkout and sponsor-stack repeatability remain Step 4.4 work.
5. Direct target-engineer validation remains pending.
6. Previously recorded provider repeatability, Tavily deduplication and overage
   status, Sandbox retention and cost-unit questions, timeout evidence, and
   explicit cancellation debt remain open.
