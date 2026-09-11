from __future__ import annotations

import json
import unittest
from pathlib import Path

from pydantic import ValidationError

from scully.domain.capsules import CapsuleManifest


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
MANIFEST_PATH = (
    REPOSITORY_ROOT
    / "fixtures"
    / "capsules"
    / "proxy-identity-collapse"
    / "capsule.json"
)
SCHEMA_PATH = REPOSITORY_ROOT / "schemas" / "capsule-v1.0.schema.json"


class CapsuleContractTests(unittest.TestCase):
    def test_seed_manifest_matches_the_versioned_contract(self) -> None:
        manifest = CapsuleManifest.model_validate_json(MANIFEST_PATH.read_text())

        self.assertEqual(manifest.schema_version, "1.0")
        self.assertEqual(manifest.capsule_id, "proxy-identity-collapse-v1")
        self.assertEqual(len(manifest.evidence), 5)
        self.assertEqual(manifest.known_good.expected_verdict, "not_reproduced")
        self.assertFalse(manifest.execution_requirements.network_access)

    def test_public_schema_covers_every_manifest_field_and_fails_closed(self) -> None:
        schema = json.loads(SCHEMA_PATH.read_text())

        self.assertEqual(schema["$schema"], "https://json-schema.org/draft/2020-12/schema")
        self.assertFalse(schema["additionalProperties"])
        self.assertEqual(set(schema["required"]), set(CapsuleManifest.model_fields))
        self.assertEqual(schema["properties"]["schema_version"], {"const": "1.0"})

    def test_unknown_fields_and_future_versions_are_rejected(self) -> None:
        payload = json.loads(MANIFEST_PATH.read_text())
        payload["undeclared"] = True
        with self.assertRaises(ValidationError):
            CapsuleManifest.model_validate(payload)

        payload.pop("undeclared")
        payload["schema_version"] = "2.0"
        with self.assertRaises(ValidationError):
            CapsuleManifest.model_validate(payload)

    def test_signature_references_declared_known_good_evidence(self) -> None:
        payload = json.loads(MANIFEST_PATH.read_text())
        payload["known_good"]["observation_evidence_id"] = "missing"

        with self.assertRaisesRegex(ValidationError, "declared evidence"):
            CapsuleManifest.model_validate(payload)


if __name__ == "__main__":
    unittest.main()
