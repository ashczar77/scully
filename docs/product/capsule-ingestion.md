# Safe Capsule Ingestion

**Status:** Implemented for Gate G2.2 review

**Implementation date:** 2026-09-11

## Outcome

Scully can now import its seeded proxy-identity incident from a directory or
ZIP archive, validate the complete capsule before accepting any evidence,
store evidence by content hash, persist its normalized lineage, and display
the accepted result in the browser.

The browser exposes a ZIP upload and an allowlisted seed action. Arbitrary
server filesystem paths are not accepted through the HTTP API.

## Capsule contract

Schema version `1.0` defines:

- stable capsule and signature identifiers;
- an observed-facts summary;
- deterministic `equals` and `same_value` matchers;
- a declared known-good observation;
- sanitized incident and comparison environment facts;
- evidence path, hash, size, media type, provenance, and redaction status;
- bounded runtime requirements with network access fixed to false;
- explicit exclusions.

Unknown fields and unknown schema versions fail closed. The runtime Pydantic
contract validates cross-field rules that JSON Schema cannot express simply,
including unique evidence identifiers and paths, unique matcher identifiers,
a required signature matcher, and a declared known-good evidence reference.

## Ingestion controls

| Boundary | Control |
|---|---|
| HTTP upload | ZIP only, with a 2 MiB request limit enforced while streaming |
| Expanded capsule | 2 MiB total and no more than 32 files, including the manifest |
| Manifest | `capsule.json` must be at the archive root and at most 128 KiB |
| Evidence | Each file must be at most 512 KiB and declared exactly once |
| Paths | Absolute paths, parent traversal, backslashes, control characters, non-normal paths, duplicates, and symlinks are rejected |
| Types | JSON, plain text, Markdown, and JavaScript text use an extension and media-type allowlist |
| Text | UTF-8 is required and null bytes are rejected |
| JSON | Malformed data, duplicate object keys, and non-finite numbers are rejected |
| Integrity | Declared byte size and SHA-256 digest must match the accepted bytes |
| Completeness | Missing declared files and undeclared files are rejected |
| Sensitive content | Common private-key, provider-key, token, password, credential-URL, and local-user-path patterns are rejected |
| Identity reuse | An existing capsule ID can be reimported only with identical canonical content |

Validation finishes before artifact storage begins. Error responses use stable
reason codes and fixed messages, never untrusted file contents or validation
details.

## Storage and lineage

Accepted evidence is written with mode `0600` under
`.scully/artifacts/<hash-prefix>/<sha256>`. Existing content must still match
its expected size and digest before it can be reused.

SQLite schema version `4` stores the canonical manifest and scopes evidence
identifiers and paths to their capsule. The migration preserves evidence from
the earlier foundation schema. Version `4` also adds the investigation
planning source without changing capsule storage.

The public read model includes capsule metadata, evidence lineage, sanitized
environment comparisons, explicit exclusions, runtime boundaries, the
known-good description, and the signature matcher count. It does not return
evidence contents, matcher paths or expectations, commands, credentials, or
unrestricted provider data.

## Seeded incident

The `proxy-identity-collapse-v2` capsule contains six small sanitized JSON
evidence files:

1. sanitized environment facts;
2. the two-client request sequence;
3. a failing observation with responses `200,429`;
4. a known-good observation with responses `200,200`;
5. public source URLs and their purpose labels;
6. a rights and restriction review.

The addresses `198.51.100.10` and `198.51.100.11` are documentation-only
TEST-NET-2 examples. The capsule contains no credentials, customer records,
production hostnames, or copied application source.

## Product behavior

The browser can load the seed or upload a ZIP. An accepted capsule replaces
the pre-import safety explanation with:

- the observed summary;
- schema and signature versions;
- sanitized incident and known-good environment values;
- explicit exclusions and runtime boundaries;
- the evidence count;
- every evidence identifier, provenance statement, byte size, and redaction
  status.

The Step 3.2 overview presents those values without broadening the ingestion
or evidence-content boundary.

A rejected capsule displays only the fixed rejection reason. Providers remain
disabled throughout ingestion.

## Verification coverage

Tests cover:

- valid directory and ZIP import;
- repeatable import of identical content;
- public schema and runtime-contract alignment;
- future versions and unknown fields;
- missing and undeclared evidence;
- size and hash mismatches;
- unsupported media types;
- duplicate paths and duplicate JSON keys;
- traversal and symlink entries;
- non-finite JSON numbers;
- obvious secret material;
- oversized archives;
- conflicting capsule identifiers;
- evidence identifier scoping;
- migration from the earlier SQLite schema;
- API acceptance, lookup, and bounded rejection responses;
- accepted and rejected browser states.

## Known limitations

1. The sensitive-content scan is a conservative safety net, not a replacement
   for sanitization at the source.
2. The HTTP interface accepts ZIP archives only. Directory import is reserved
   for trusted local application sources such as the included seed.
3. Artifact retention and deletion policy remain technical debt before broader
   use.
4. An accepted capsule starts an investigation only when the user selects the
   planning action.
5. Live provider access remains disabled and was not required for this step.
