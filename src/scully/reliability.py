"""Independent local product-run reliability verification."""

from __future__ import annotations

import hashlib
import json
import tempfile
import zipfile
from io import BytesIO
from pathlib import Path
from time import perf_counter_ns

from fastapi.testclient import TestClient

from scully.api.app import create_app
from scully.application.reproduction import PACKAGE_ROOT
from scully.application.settings import ProductSettings


def verify_local_reliability(repository_root: Path, *, run_count: int = 2) -> dict:
    """Run independent seeded flows and require equivalent proof artifacts."""

    if run_count < 2:
        raise ValueError("Reliability verification requires at least two runs")

    runs = tuple(_run_once(repository_root) for _ in range(run_count))
    fingerprints = {run["proof_fingerprint"] for run in runs}
    investigation_ids = {run.pop("investigation_id") for run in runs}
    if len(investigation_ids) != run_count:
        raise RuntimeError("Independent runs reused an investigation identifier")
    if len(fingerprints) != 1:
        raise RuntimeError("Independent runs produced different proof artifacts")

    totals = [run["total_ms"] for run in runs]
    return {
        "status": "verified",
        "run_count": run_count,
        "independent_investigation_ids": len(investigation_ids),
        "equivalent_proof": True,
        "proof_fingerprint": runs[0]["proof_fingerprint"],
        "latency_ms": {
            "minimum": min(totals),
            "maximum": max(totals),
        },
        "runs": list(runs),
        "provider_requests": 0,
        "provider_credits_used": 0,
    }


def _run_once(repository_root: Path) -> dict:
    stages: dict[str, float] = {}
    with tempfile.TemporaryDirectory() as temporary:
        settings = ProductSettings(
            data_dir=Path(temporary) / "data",
            web_dist=repository_root / "web" / "dist",
            seed_capsules_dir=repository_root / "fixtures" / "capsules",
        )
        started = perf_counter_ns()
        with TestClient(create_app(settings)) as client:
            health, stages["health_ms"] = _timed(lambda: client.get("/api/health"))
            health.raise_for_status()
            if health.json()["live_providers_enabled"]:
                raise RuntimeError("Reliability verification must keep providers disabled")

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
            event_types = [
                line.removeprefix("event: ")
                for line in execution.text.splitlines()
                if line.startswith("event: ")
            ]
            if not event_types or event_types[-1] != "complete":
                raise RuntimeError("Execution stream did not end with a complete event")
            completed = client.get(f"/api/investigations/{investigation_id}")
            completed.raise_for_status()
            detail = completed.json()

            package, stages["package_ms"] = _timed(
                lambda: client.get(
                    f"/api/investigations/{investigation_id}/reproduction.zip"
                )
            )
            package.raise_for_status()
        total_ms = (perf_counter_ns() - started) / 1_000_000

    if detail["status"] != "completed" or detail["execution"] is None:
        raise RuntimeError("Investigation did not reach completed state")

    fingerprint = proof_fingerprint(
        package.content,
        expected_investigation_id=investigation_id,
        expected_signature_id=detail["execution"]["signature_id"],
        expected_hypothesis_id=detail["execution"]["supported_hypothesis_id"],
    )
    return {
        "investigation_id": investigation_id,
        "status": "verified",
        "total_ms": _milliseconds(total_ms),
        "stages_ms": {
            name: _milliseconds(value) for name, value in stages.items()
        },
        "progress_event_count": len(event_types) - 1,
        "terminal_event": event_types[-1],
        "package_bytes": len(package.content),
        "proof_fingerprint": fingerprint,
    }


def proof_fingerprint(
    package: bytes,
    *,
    expected_investigation_id: str,
    expected_signature_id: str,
    expected_hypothesis_id: str,
) -> str:
    with zipfile.ZipFile(BytesIO(package)) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise RuntimeError("Reproduction package contains duplicate paths")
        metadata_name = f"{PACKAGE_ROOT}/reproduction.json"
        if metadata_name not in names:
            raise RuntimeError("Reproduction package is missing its manifest")
        metadata = json.loads(archive.read(metadata_name))
        if metadata["investigation_id"] != expected_investigation_id:
            raise RuntimeError("Reproduction manifest has the wrong investigation")
        if metadata["signature_id"] != expected_signature_id:
            raise RuntimeError("Reproduction manifest has the wrong signature")
        if metadata["supported_hypothesis_id"] != expected_hypothesis_id:
            raise RuntimeError("Reproduction manifest has the wrong supported cause")

        expected_files = {
            item["path"]: (item["sha256"], item["byte_size"])
            for item in metadata["files"]
        }
        actual_files: dict[str, tuple[str, int]] = {}
        prefix = f"{PACKAGE_ROOT}/"
        for name in names:
            if name == metadata_name:
                continue
            if not name.startswith(prefix):
                raise RuntimeError("Reproduction package contains an invalid root")
            content = archive.read(name)
            actual_files[name.removeprefix(prefix)] = (
                hashlib.sha256(content).hexdigest(),
                len(content),
            )
        if actual_files != expected_files:
            raise RuntimeError("Reproduction file hashes do not match the manifest")

    proof = {
        "capsule_id": metadata["capsule_id"],
        "signature_id": metadata["signature_id"],
        "supported_cause": metadata["supported_cause"],
        "execution": metadata["execution"],
        "incident_fidelity": metadata["incident_fidelity"],
        "result": metadata["result"],
        "minimization": metadata["minimization"],
        "files": metadata["files"],
    }
    canonical = json.dumps(proof, separators=(",", ":"), sort_keys=True).encode()
    return hashlib.sha256(canonical).hexdigest()


def _timed(operation):
    started = perf_counter_ns()
    result = operation()
    return result, (perf_counter_ns() - started) / 1_000_000


def _milliseconds(value: float) -> float:
    return round(value, 3)
