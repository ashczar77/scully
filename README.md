# Scully

Scully turns sanitized production-incident evidence into a minimal executable
reproduction without giving AI unrestricted production access.

The project has completed its problem, boundary, sponsor-primitive, and
execution-integrity feasibility gates. It is now moving from the feasibility
harness into the working product. See the
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
```

Start the API and frontend development servers in separate terminals:

```shell
make dev-api
make dev-web
```

The API listens on `http://127.0.0.1:8000` and the frontend listens on
`http://127.0.0.1:5173`. Local application state is written under the ignored
`.scully/` directory.

Inspect local execution readiness without contacting a provider:

```shell
PYTHONPATH=src .venv/bin/python -m scully.preflight
```

Live provider access is disabled by default and remains subject to the review
gates in the project plan. A reviewed execution must also target exactly one
provider with `SCULLY_LIVE_PROVIDER`.

## License

Scully is licensed under the [Apache License 2.0](LICENSE).
