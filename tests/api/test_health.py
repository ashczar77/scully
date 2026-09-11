from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from scully.api.app import create_app
from scully.application.settings import ProductSettings


class HealthEndpointTests(unittest.TestCase):
    def test_health_initializes_local_state_without_live_providers(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            settings = ProductSettings(
                data_dir=root / "data",
                web_dist=root / "missing-web-dist",
            )
            with TestClient(create_app(settings)) as client:
                response = client.get("/api/health")

            self.assertEqual(response.status_code, 200)
            self.assertEqual(
                response.json(),
                {
                    "status": "ok",
                    "service": "scully",
                    "version": "0.1.0",
                    "database": "ready",
                    "live_providers_enabled": False,
                },
            )
            self.assertTrue(settings.database_path.is_file())
            self.assertTrue(settings.artifact_dir.is_dir())

    def test_built_frontend_is_served_from_the_same_application(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            web_dist = root / "web"
            web_dist.mkdir()
            (web_dist / "index.html").write_text(
                "<!doctype html><title>Scully shell</title>",
                encoding="utf-8",
            )
            settings = ProductSettings(
                data_dir=root / "data",
                web_dist=web_dist,
            )

            with TestClient(create_app(settings)) as client:
                response = client.get("/")

            self.assertEqual(response.status_code, 200)
            self.assertIn("Scully shell", response.text)


if __name__ == "__main__":
    unittest.main()
