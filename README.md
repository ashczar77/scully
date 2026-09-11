# Scully

Scully turns sanitized production-incident evidence into a minimal executable
reproduction without giving AI unrestricted production access.

The project has completed its problem, boundary, sponsor-primitive, and
execution-integrity feasibility gates. It is now moving from the feasibility
harness into the working product. See the
[hackathon project plan](docs/HACKATHON_PROJECT_PLAN.md) and
[project documentation](docs/README.md) for its status and roadmap.

## Development

Create an isolated environment and install the reviewed dependency lock:

```shell
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.lock
.venv/bin/python -m pip install --no-build-isolation --no-deps -e .
```

Run the offline tests without loading local credentials:

```shell
PYTHONPATH=src .venv/bin/python -m unittest discover -s tests -v
```

Inspect local execution readiness without contacting a provider:

```shell
PYTHONPATH=src .venv/bin/python -m scully.preflight
```

Live provider access is disabled by default and remains subject to the review
gates in the project plan. A reviewed execution must also target exactly one
provider with `SCULLY_LIVE_PROVIDER`.

## License

Scully is licensed under the [Apache License 2.0](LICENSE).
