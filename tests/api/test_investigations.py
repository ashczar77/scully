from __future__ import annotations

import tempfile
import unittest
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
            json={"capsule_id": "proxy-identity-collapse-v1"},
        )
        self.assertEqual(created.status_code, 201)
        payload = created.json()
        self.assertEqual(payload["status"], "ready")
        self.assertEqual(payload["planning_source"], "local")
        self.assertEqual(len(payload["hypotheses"]), 3)
        self.assertEqual(len(payload["experiments"]), 3)
        self.assertEqual(len(payload["events"]), 6)

        loaded = self.client.get(
            f"/api/investigations/{payload['investigation_id']}"
        )
        self.assertEqual(loaded.status_code, 200)
        self.assertEqual(loaded.json(), payload)

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
