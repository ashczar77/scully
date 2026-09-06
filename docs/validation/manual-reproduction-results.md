# Step 0.3 Manual Reproduction Results

**Status:** Approved at Gate G0.3

**Run date:** 2026-09-06

## Executive result

All three approved candidate incidents were reproduced from their synthetic
capsule specifications. Each incident matched its declared signature in three
clean runs. Each known-good comparison avoided the incident signature and
produced its expected successful result in three clean runs.

Gate G0.3 requires at least two reproducible incidents. The measured result is
three of three.

This result establishes manual reproducibility only. It does not establish
user value, autonomous investigation quality, sponsor-stack feasibility, or a
final demonstration case.

## Method

Each run used a unique temporary directory. Installed dependencies, build
output, and process state were not reused between runs. Package-manager caches
were shared for downloaded public artifacts.

Docker was available as a client but its local daemon was not running. Clean
temporary directories and isolated Python virtual environments were used
instead. Container execution remains a later platform-feasibility question.

No diagnostic evidence beyond the approved capsule specifications was used.
The network was used only to acquire pinned public dependencies. All fixture
execution was local.

## Result summary

| Candidate | Incident result | Known-good result | Clean runs | Disposition |
|---|---|---|---:|---|
| Proxy identity collapse | `200,429` and one normalized identity | `200,200` and two normalized identities | 3 incident, 3 known-good | Reproduced |
| Pydantic settings migration | Exit 1 with `PydanticImportError` and required migration tokens | Exit 0 with ready result | 3 incident, 3 known-good | Reproduced |
| Jackson classpath version skew | Exit 1 with `NoSuchMethodError` for `BufferRecycler.releaseToPool()` | Exit 0 with serialized ready result | 3 incident, 3 known-good | Reproduced |

The normalized machine-readable summary is in
`validation/results/step-0.3.json`.

## Candidate 1: Proxy identity collapse

### Pinned environment

- Node.js 22.22.2
- Express 5.2.1
- npm lockfile version 3
- project-created HTTP proxy and in-memory limiter

### Clean-run procedure

For each run, the fixture source and lockfile were copied into a new temporary
directory. `npm ci --ignore-scripts` installed the exact dependency graph.
The incident and known-good configurations were then executed separately.

```sh
SCULLY_CASE=incident node run-case.mjs
SCULLY_CASE=known-good node run-case.mjs
```

### Observed incident result

All three runs produced:

- response statuses `200,429`;
- `request_allowed` followed by `rate_limit_rejected`;
- one shared identity digest for two different TEST-NET-2 clients;
- evaluator result `matches=true`.

### Observed known-good result

All three runs produced:

- response statuses `200,200`;
- two `request_allowed` events;
- distinct identity digests for the two synthetic clients;
- evaluator result `matches=true` for the known-good expectation;
- no match for the incident signature.

### Finding

The trusted-proxy configuration alone is sufficient to move between the
incident and known-good behaviors in the fixture. The capsule signature is
stable and fully machine-readable.

## Candidate 2: Pydantic settings migration

### Pinned environment

- Python 3.14.6
- Pydantic 2.13.5 for the incident
- Pydantic 1.10.26 for the known-good comparison
- identical project-created service module for both environments

### Clean-run procedure

Each run created a new Python virtual environment. Dependencies were installed
from a local wheel directory populated from the exact version requirements.
The service module was then executed once.

```sh
python -m pip install --no-index --find-links WHEEL_DIRECTORY \
  --requirement requirements-incident.txt
python service.py
```

The known-good command used `requirements-known-good.txt` in a separate virtual
environment.

### Observed incident result

All three runs exited with status 1 and contained:

- error type `PydanticImportError`;
- required token `BaseSettings`;
- required statement that the class moved;
- required package token `pydantic-settings`.

### Observed known-good result

All three runs exited with status 0 and printed:

```json
{"service": "scully-validation-service", "status": "ready"}
```

### Finding

The Pydantic major version alone is sufficient to move between the incident
and known-good behaviors with identical service source. A startup-ready marker
is sufficient for this validation fixture, so an HTTP framework is not needed.

## Candidate 3: Jackson classpath version skew

### Pinned environment

- Java source compiled for release 21
- observed local runtime 26.0.2.1
- Maven 3.9.16
- Jackson Databind 2.18.2
- Jackson Annotations 2.18.2
- Jackson Core 2.15.4 for the incident
- Jackson Core 2.18.2 for the known-good comparison

### Clean-run procedure

For each run, the fixture was copied into a new temporary directory and built
with `mvn clean package`. The resulting application class and Jackson Databind
artifact remained the same. Only the Jackson Core artifact on the runtime
classpath changed.

The normalized classpath shape was:

```text
target/classes
jackson-databind-2.18.2.jar
jackson-annotations-2.18.2.jar
jackson-core-2.15.4.jar or jackson-core-2.18.2.jar
```

The executable commands are documented in `validation/README.md`. They derive
the Maven repository and Java runtime paths from Maven rather than embedding
machine-specific paths.

### Observed incident result

All three runs exited with status 1 and contained:

```text
java.lang.NoSuchMethodError:
com.fasterxml.jackson.core.util.BufferRecycler.releaseToPool()
```

The call originated while Jackson Databind attempted to serialize the fixed
ready object.

### Observed known-good result

All three runs exited with status 0 and printed:

```json
{"status":"ready"}
```

### Finding

Changing only Jackson Core from 2.18.2 to 2.15.4 is sufficient to produce the
stable linkage failure. A minimal serialization probe is sufficient for this
validation fixture. An HTTP framework would add setup without changing the
version-skew evidence.

## Failed attempts and adjustments

| Attempt | Result | Adjustment | Effect on evidence |
|---|---|---|---|
| Use Docker for clean environments | Docker daemon was not running | Used unique temporary directories and isolated virtual environments | Does not affect the compared source, dependencies, or process state; hosted isolation remains untested |
| Install Express fully offline before the lockfile dependencies were cached | One transitive archive was missing | Acquired the pinned public dependency graph, then installed from the committed lockfile | No diagnostic evidence was added |
| Run Maven without artifact-cache access | Maven could not update local plugin metadata | Allowed normal access to the local Maven artifact cache | No change to fixture inputs or signature |
| First three-run JVM shell command | A shell quoting error stopped before fixture execution | Corrected the command and restarted with a new temporary root | No failed fixture run was counted |

## Missing evidence and limitations

- All three cases are synthetic reconstructions. They establish safe
  reproducibility, not market urgency.
- The proxy limiter is intentionally small and may not represent the behavior
  of a common production limiter package.
- The Pydantic failure is direct enough that hypothesis branching may add
  little value.
- The Jackson fixture is a serialization probe rather than a complete HTTP
  service.
- Clean runs shared package-manager caches and the same host kernel.
- Token Factory Sandbox behavior remains untested until Phase 1.
- No target engineer has yet reviewed the fixtures or proof format.

These limitations do not prevent G0.3 from deciding manual reproducibility.
They must inform incident selection and user interviews at G0.4.

## Step 0.3 conclusion

The approved incident class passes the Phase 0 manual reproduction threshold.
Three incidents from three ecosystems can be represented with safe synthetic
evidence, reproduced under a declared environment delta, distinguished from a
known-good comparison, and evaluated without model judgment.
