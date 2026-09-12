from __future__ import annotations

import io
import tempfile
import unittest
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient

from scully.api.app import create_app
from scully.application.settings import ProductSettings


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SEED_CAPSULES = REPOSITORY_ROOT / "fixtures" / "capsules"


class InvestigationEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        root = Path(self.temporary.name)
        settings = ProductSettings(
            data_dir=root / "data",
            web_dist=root / "missing-web",
            seed_capsules_dir=SEED_CAPSULES,
        )
        self.client_context = TestClient(create_app(settings))
        self.client = self.client_context.__enter__()

    def tearDown(self) -> None:
        self.client_context.__exit__(None, None, None)
        self.temporary.cleanup()

    def test_create_and_get_return_the_same_offline_plan(self) -> None:
        imported = self.client.post(
            "/api/capsules/import",
            params={"seed": "proxy-identity-collapse"},
        )
        self.assertEqual(imported.status_code, 201)

        created = self.client.post(
            "/api/investigations",
            json={"capsule_id": "proxy-identity-collapse-v2"},
        )
        self.assertEqual(created.status_code, 201)
        payload = created.json()
        self.assertEqual(payload["status"], "ready")
        self.assertEqual(payload["planning_source"], "local")
        self.assertEqual(len(payload["hypotheses"]), 3)
        self.assertEqual(len(payload["experiments"]), 3)
        self.assertEqual(len(payload["events"]), 7)

        loaded = self.client.get(
            f"/api/investigations/{payload['investigation_id']}"
        )
        self.assertEqual(loaded.status_code, 200)
        self.assertEqual(loaded.json(), payload)

        premature_package = self.client.get(
            f"/api/investigations/{payload['investigation_id']}/reproduction.zip"
        )
        self.assertEqual(premature_package.status_code, 409)
        self.assertEqual(
            premature_package.json()["detail"]["code"],
            "investigation_not_completed",
        )

        executed = self.client.post(
            f"/api/investigations/{payload['investigation_id']}/execute"
        )
        self.assertEqual(executed.status_code, 200)
        completed = executed.json()
        self.assertEqual(completed["status"], "completed")
        self.assertTrue(completed["execution"]["isolation_verified"])
        self.assertEqual(completed["execution"]["operation_count"], 3)
        self.assertEqual(completed["execution"]["retry_count"], 0)
        self.assertEqual(
            completed["execution"]["supported_hypothesis_id"],
            f"{payload['investigation_id']}-h1",
        )

        replay = self.client.get(
            f"/api/investigations/{payload['investigation_id']}/events"
        )
        self.assertEqual(replay.status_code, 200)
        self.assertIn("text/event-stream", replay.headers["content-type"])
        self.assertIn("event: experiment.operation", replay.text)
        self.assertIn("event: investigation.completed", replay.text)

        second = self.client.post(
            "/api/investigations",
            json={"capsule_id": "proxy-identity-collapse-v2"},
        )
        self.assertEqual(second.status_code, 201)
        streamed = self.client.post(
            f"/api/investigations/{second.json()['investigation_id']}/execute/stream"
        )
        self.assertEqual(streamed.status_code, 200)
        self.assertIn("text/event-stream", streamed.headers["content-type"])
        self.assertIn("event: execution.started", streamed.text)
        self.assertEqual(streamed.text.count("event: experiment.result"), 3)
        self.assertIn("event: complete", streamed.text)
        event_types = [
            line.removeprefix("event: ")
            for line in streamed.text.splitlines()
            if line.startswith("event: ")
        ]
        self.assertEqual(len(event_types), 17)
        self.assertEqual(event_types[0], "execution.started")
        self.assertEqual(event_types[-1], "complete")

        package = self.client.get(
            f"/api/investigations/{payload['investigation_id']}/reproduction.zip"
        )
        self.assertEqual(package.status_code, 200)
        self.assertEqual(package.headers["content-type"], "application/zip")
        self.assertEqual(
            package.headers["content-disposition"],
            "attachment; filename=scully-proxy-identity-collapse.zip",
        )
        with zipfile.ZipFile(io.BytesIO(package.content)) as archive:
            self.assertIn(
                "scully-proxy-identity-collapse/reproduction.json",
                archive.namelist(),
            )

    def test_missing_capsule_and_investigation_return_reason_codes(self) -> None:
        missing_capsule = self.client.post(
            "/api/investigations",
            json={"capsule_id": "missing"},
        )
        self.assertEqual(missing_capsule.status_code, 404)
        self.assertEqual(
            missing_capsule.json()["detail"]["code"],
            "capsule_not_found",
        )

        missing_investigation = self.client.get("/api/investigations/missing")
        self.assertEqual(missing_investigation.status_code, 404)
        self.assertEqual(
            missing_investigation.json()["detail"]["code"],
            "investigation_not_found",
        )


if __name__ == "__main__":
    unittest.main()
