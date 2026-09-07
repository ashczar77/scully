# Scully

Scully turns sanitized production-incident evidence into a minimal executable
reproduction without giving AI unrestricted production access.

The project has completed problem and boundary validation and is now proving
the sponsor stack through a review-gated feasibility scaffold. See the
[hackathon project plan](docs/HACKATHON_PROJECT_PLAN.md) and
[project documentation](docs/README.md) for its status and roadmap.

## Development

The Phase 1 feasibility scaffold has no runtime dependencies. Run its offline
tests without loading local credentials:

```shell
PYTHONPATH=src python3 -m unittest discover -s tests -v
```

Live provider access is disabled by default and remains subject to the review
gates in the project plan.

## License

Scully is licensed under the [Apache License 2.0](LICENSE).
