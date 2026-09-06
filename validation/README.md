# Phase 0 Validation Fixtures

These fixtures support Step 0.3 of the project plan. They are deliberately
small and contain only original source, synthetic data, and public dependency
metadata.

## Proxy identity collapse

Requirements: Node.js 18 or later and npm.

```sh
cd validation/fixtures/proxy-identity-collapse
npm ci --ignore-scripts
SCULLY_CASE=incident npm run validate
SCULLY_CASE=known-good npm run validate
```

The incident case passes its evaluator when two synthetic clients produce
HTTP statuses `200,429` under one identity. The known-good case passes when
they produce `200,200` under distinct identities.

## Pydantic settings migration

Requirements: Python 3.14 and pip.

Use separate virtual environments for the two dependency sets:

```sh
cd validation/fixtures/pydantic-settings-migration
python3 -m venv .venv/incident
.venv/incident/bin/python -m pip install -r requirements-incident.txt
.venv/incident/bin/python service.py

python3 -m venv .venv/known-good
.venv/known-good/bin/python -m pip install -r requirements-known-good.txt
.venv/known-good/bin/python service.py
```

The incident command must exit nonzero with `PydanticImportError` and the
tokens `BaseSettings`, `moved`, and `pydantic-settings`. The known-good command
must print `{"service": "scully-validation-service", "status": "ready"}`.

## Jackson classpath version skew

Requirements: Maven and a Java runtime capable of compiling for Java 21.

Build the probe against Jackson 2.18.2, then run it with either Jackson Core
2.18.2 or 2.15.4:

```sh
cd validation/fixtures/jackson-classpath-version-skew
mvn clean package
mvn dependency:get -Dartifact=com.fasterxml.jackson.core:jackson-core:2.15.4
maven_repo=$(mvn -q help:evaluate -Dexpression=settings.localRepository \
  -DforceStdout)
java_home=$(mvn --version | sed -n 's/^Java home: //p')

"$java_home/bin/java" -cp \
  "target/classes:$maven_repo/com/fasterxml/jackson/core/jackson-databind/2.18.2/jackson-databind-2.18.2.jar:$maven_repo/com/fasterxml/jackson/core/jackson-annotations/2.18.2/jackson-annotations-2.18.2.jar:$maven_repo/com/fasterxml/jackson/core/jackson-core/2.15.4/jackson-core-2.15.4.jar" \
  dev.scully.validation.JacksonSkewProbe

"$java_home/bin/java" -cp \
  "target/classes:$maven_repo/com/fasterxml/jackson/core/jackson-databind/2.18.2/jackson-databind-2.18.2.jar:$maven_repo/com/fasterxml/jackson/core/jackson-annotations/2.18.2/jackson-annotations-2.18.2.jar:$maven_repo/com/fasterxml/jackson/core/jackson-core/2.18.2/jackson-core-2.18.2.jar" \
  dev.scully.validation.JacksonSkewProbe
```

The incident case must exit nonzero with `java.lang.NoSuchMethodError` for
`BufferRecycler.releaseToPool()`. The known-good case must print
`{"status":"ready"}`.

## Clean-run standard

The gate evidence used three unique temporary directories per candidate. Node
dependencies were installed from the committed lockfile. Python dependencies
were installed into a new virtual environment. The JVM fixture was copied and
built with `mvn clean package` for each run.

Package downloads may use a shared package-manager cache. Source, installed
dependencies, process state, and build output must be fresh for every run.
