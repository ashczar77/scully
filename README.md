# Scully

Scully turns sanitized production-incident evidence into a minimal executable
reproduction without giving AI unrestricted production access.

The project now includes a working local product path from safe capsule import
to progressive branch execution, deterministic cause selection, and a
downloadable runnable reproduction. The selected realistic incident runs an
Express application behind a separate loopback reverse proxy. See the
[hackathon project plan](docs/HACKATHON_PROJECT_PLAN.md) and
[project documentation](docs/README.md) for its status and roadmap.

## Development

Install the backend and frontend dependencies:

```shell
make install
```

Run the complete offline test suite and build the frontend:

```shell
make test
make typecheck
make build
make verify-reliability
```

Start the API and frontend development servers in separate terminals:

```shell
make dev-api
make dev-web
```

The API listens on `http://127.0.0.1:8000` and the frontend listens on
`http://127.0.0.1:5173`. Local application state is written under the ignored
`.scully/` directory.

## Try the investigation path

Build the browser application and start the local product:

```shell
make build
make dev-api
```

Open `http://127.0.0.1:8000`, then select **Load safe seed**. Scully validates
the capsule before storing its evidence and displays the accepted provenance,
redaction status, and deterministic signature ID. Select **Create
investigation** to persist and display three evidence-linked causal
alternatives with bounded experiment plans. Select **Run 3 branches** to test
all three from one clean checkpoint and display the deterministically supported
cause. The local branches execute the reviewed Node.js HTTP fixture without a
shell or external network access.

Select **Review reproduction proof**, then **Download reproduction**. Extract
the ZIP, then run `npm ci`, `npm run minimize`, and `npm run verify` inside its
directory. The minimizer reduces the proof from 11 observation fields to four
while preserving the declared signature. The included regression test is
expected to fail with the reproduced `200,429` response sequence. Full
clean-checkout instructions and measurements are in the
[end-to-end proof](docs/product/end-to-end-proof.md).

The public capsule contract is
[`schemas/capsule-v1.0.schema.json`](schemas/capsule-v1.0.schema.json). The
included proxy-identity capsule is under
[`fixtures/capsules/proxy-identity-collapse`](fixtures/capsules/proxy-identity-collapse).

Capsule intake, structured planning output, and reproduction export share one
sensitive-content policy. Unsafe execution failures close the affected run with
bounded audit events. After correcting the cause, start a fresh investigation
from the accepted capsule.

Inspect local execution readiness without contacting a provider:

```shell
PYTHONPATH=src .venv/bin/python -m scully.preflight
```

Live provider access is disabled by default and remains subject to the review
gates in the project plan. A reviewed execution must also target exactly one
provider with `SCULLY_LIVE_PROVIDER`.

Inspect the three-provider product-path preflight without constructing a client
or making a provider request:

```shell
make sponsor-preflight
```

The execution command is intentionally separate from the Makefile and requires
an exact approved run identifier plus manual cost confirmations. See the
[reliability and clean-setup record](docs/product/reliability-clean-setup.md).

## License

Scully is licensed under the [Apache License 2.0](LICENSE).
