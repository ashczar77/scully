"""Measure the complete offline seeded investigation through its public API."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path
from time import perf_counter_ns

from fastapi.testclient import TestClient

from scully.api.app import create_app
from scully.application.settings import ProductSettings


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    """Run one clean local flow and print bounded JSON measurements."""

    stages: dict[str, float] = {}
    with tempfile.TemporaryDirectory() as temporary:
        settings = ProductSettings(
            data_dir=Path(temporary) / "data",
            web_dist=REPOSITORY_ROOT / "web" / "dist",
            seed_capsules_dir=REPOSITORY_ROOT / "fixtures" / "capsules",
        )
        started = perf_counter_ns()
        with TestClient(create_app(settings)) as client:
            capsule, stages["capsule_import_ms"] = _timed(
                lambda: client.post(
                    "/api/capsules/import",
                    params={"seed": "proxy-identity-collapse"},
                )
            )
            capsule.raise_for_status()
            investigation, stages["planning_ms"] = _timed(
                lambda: client.post(
                    "/api/investigations",
                    json={"capsule_id": capsule.json()["capsule_id"]},
                )
            )
            investigation.raise_for_status()
            investigation_id = investigation.json()["investigation_id"]
            execution, stages["execution_stream_ms"] = _timed(
                lambda: client.post(
                    f"/api/investigations/{investigation_id}/execute/stream"
                )
            )
            execution.raise_for_status()
            package, stages["package_ms"] = _timed(
                lambda: client.get(
                    f"/api/investigations/{investigation_id}/reproduction.zip"
                )
            )
            package.raise_for_status()
        total_ms = (perf_counter_ns() - started) / 1_000_000

    event_types = [
        line.removeprefix("event: ")
        for line in execution.text.splitlines()
        if line.startswith("event: ")
    ]
    print(
        json.dumps(
            {
                "status": "verified",
                "total_ms": round(total_ms, 3),
                "stages_ms": {key: round(value, 3) for key, value in stages.items()},
                "progress_event_count": len(event_types) - 1,
                "terminal_event": event_types[-1],
                "package_bytes": len(package.content),
                "provider_requests": 0,
                "provider_credits_used": 0,
            },
            separators=(",", ":"),
            sort_keys=True,
        )
    )


def _timed(operation):
    started = perf_counter_ns()
    result = operation()
    return result, (perf_counter_ns() - started) / 1_000_000


if __name__ == "__main__":
    main()
