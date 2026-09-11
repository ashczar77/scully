from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from scully.domain.capsules import CapsuleManifest
from scully.infrastructure.capsules import CapsuleConflictError, CapsuleRepository
from scully.infrastructure.database import Database


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
MANIFEST_PATH = (
    REPOSITORY_ROOT
    / "fixtures"
    / "capsules"
    / "proxy-identity-collapse"
    / "capsule.json"
)


class CapsuleRepositoryTests(unittest.TestCase):
    def test_save_get_and_conflict_are_transactional(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database = Database(Path(directory) / "scully.db")
            database.initialize()
            repository = CapsuleRepository(database)
            manifest = CapsuleManifest.model_validate_json(MANIFEST_PATH.read_text())

            expected = repository.save(manifest)
            self.assertEqual(repository.get(manifest.capsule_id), expected)

            payload = json.loads(MANIFEST_PATH.read_text())
            payload["title"] = "Different title"
            with self.assertRaises(CapsuleConflictError):
                repository.save(CapsuleManifest.model_validate(payload))

            with database.connect() as connection:
                capsule_count = connection.execute("SELECT COUNT(*) FROM capsules").fetchone()[0]
                evidence_count = connection.execute("SELECT COUNT(*) FROM evidence").fetchone()[0]
            self.assertEqual(capsule_count, 1)
            self.assertEqual(evidence_count, 5)

    def test_evidence_identifiers_are_scoped_to_the_capsule(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database = Database(Path(directory) / "scully.db")
            database.initialize()
            repository = CapsuleRepository(database)
            first_payload = json.loads(MANIFEST_PATH.read_text())
            second_payload = json.loads(MANIFEST_PATH.read_text())
            second_payload["capsule_id"] = "proxy-identity-collapse-copy"

            repository.save(CapsuleManifest.model_validate(first_payload))
            repository.save(CapsuleManifest.model_validate(second_payload))

            with database.connect() as connection:
                evidence_count = connection.execute("SELECT COUNT(*) FROM evidence").fetchone()[0]
            self.assertEqual(evidence_count, 10)


if __name__ == "__main__":
    unittest.main()
