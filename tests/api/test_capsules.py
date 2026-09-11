from __future__ import annotations

import io
import tempfile
import unittest
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient

from scully.api.app import create_app
from scully.application.capsule_import import MAX_ARCHIVE_BYTES
from scully.application.settings import ProductSettings


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SEED_CAPSULES = REPOSITORY_ROOT / "fixtures" / "capsules"


class CapsuleEndpointTests(unittest.TestCase):
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

    def test_seed_import_and_get_return_the_normalized_summary(self) -> None:
        response = self.client.post(
            "/api/capsules/import",
            params={"seed": "proxy-identity-collapse"},
        )

        self.assertEqual(response.status_code, 201)
        payload = response.json()
        self.assertEqual(payload["capsule_id"], "proxy-identity-collapse-v1")
        self.assertEqual(payload["signature_id"], "proxy-identity-collapse-v1")
        self.assertEqual(len(payload["evidence"]), 5)
        self.assertNotIn("failure_signature", payload)

        loaded = self.client.get("/api/capsules/proxy-identity-collapse-v1")
        self.assertEqual(loaded.status_code, 200)
        self.assertEqual(loaded.json(), payload)

    def test_valid_zip_upload_is_accepted(self) -> None:
        response = self.client.post(
            "/api/capsules/import",
            content=self._seed_zip(),
            headers={"content-type": "application/zip"},
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["title"], "Proxy identity collapse")

    def test_invalid_requests_return_bounded_reason_codes(self) -> None:
        unknown = self.client.post(
            "/api/capsules/import",
            params={"seed": "not-available"},
        )
        self.assertEqual(unknown.status_code, 400)
        self.assertEqual(unknown.json()["detail"]["code"], "seed_unknown")

        wrong_type = self.client.post(
            "/api/capsules/import",
            content=b"not-a-zip",
            headers={"content-type": "text/plain"},
        )
        self.assertEqual(wrong_type.status_code, 400)
        self.assertEqual(
            wrong_type.json()["detail"]["code"],
            "import_type_unsupported",
        )

        invalid_zip = self.client.post(
            "/api/capsules/import",
            content=b"not-a-zip",
            headers={"content-type": "application/zip"},
        )
        self.assertEqual(invalid_zip.status_code, 400)
        self.assertEqual(invalid_zip.json()["detail"]["code"], "archive_invalid")

        oversized = self.client.post(
            "/api/capsules/import",
            content=b"x",
            headers={
                "content-type": "application/zip",
                "content-length": str(MAX_ARCHIVE_BYTES + 1),
            },
        )
        self.assertEqual(oversized.status_code, 400)
        self.assertEqual(oversized.json()["detail"]["code"], "archive_too_large")

        missing = self.client.get("/api/capsules/missing")
        self.assertEqual(missing.status_code, 404)
        self.assertEqual(missing.json()["detail"]["code"], "capsule_not_found")

    @staticmethod
    def _seed_zip() -> bytes:
        source = SEED_CAPSULES / "proxy-identity-collapse"
        content = io.BytesIO()
        with zipfile.ZipFile(content, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(source.rglob("*")):
                if path.is_file():
                    archive.write(path, path.relative_to(source).as_posix())
        return content.getvalue()


if __name__ == "__main__":
    unittest.main()
