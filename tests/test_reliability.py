from __future__ import annotations

import hashlib
import io
import json
import unittest
import zipfile

from scully.application.reproduction import PACKAGE_ROOT
from scully.reliability import proof_fingerprint


class ProofFingerprintTests(unittest.TestCase):
    def test_ignores_run_identity_but_preserves_proof_content(self) -> None:
        first = _package("inv-first", "inv-first-h1", [200, 429])
        second = _package("inv-second", "inv-second-h1", [200, 429])

        self.assertEqual(
            proof_fingerprint(
                first,
                expected_investigation_id="inv-first",
                expected_signature_id="signature-v1",
                expected_hypothesis_id="inv-first-h1",
            ),
            proof_fingerprint(
                second,
                expected_investigation_id="inv-second",
                expected_signature_id="signature-v1",
                expected_hypothesis_id="inv-second-h1",
            ),
        )

    def test_detects_changed_proof_content(self) -> None:
        first = _package("inv-first", "inv-first-h1", [200, 429])
        changed = _package("inv-second", "inv-second-h1", [200, 200])

        self.assertNotEqual(
            proof_fingerprint(
                first,
                expected_investigation_id="inv-first",
                expected_signature_id="signature-v1",
                expected_hypothesis_id="inv-first-h1",
            ),
            proof_fingerprint(
                changed,
                expected_investigation_id="inv-second",
                expected_signature_id="signature-v1",
                expected_hypothesis_id="inv-second-h1",
            ),
        )

    def test_rejects_file_content_that_does_not_match_manifest(self) -> None:
        package = _package(
            "inv-first",
            "inv-first-h1",
            [200, 429],
            declared_content=b"different",
        )

        with self.assertRaisesRegex(RuntimeError, "hashes"):
            proof_fingerprint(
                package,
                expected_investigation_id="inv-first",
                expected_signature_id="signature-v1",
                expected_hypothesis_id="inv-first-h1",
            )


def _package(
    investigation_id: str,
    hypothesis_id: str,
    responses: list[int],
    *,
    declared_content: bytes | None = None,
) -> bytes:
    content = b"proof\n"
    declared = content if declared_content is None else declared_content
    metadata = {
        "investigation_id": investigation_id,
        "capsule_id": "capsule-v1",
        "signature_id": "signature-v1",
        "supported_hypothesis_id": hypothesis_id,
        "supported_cause": "Proxy trust boundary mismatch",
        "execution": {"source": "local", "isolation_verified": True},
        "incident_fidelity": {"loopback_only": True},
        "result": {"incident_responses": responses},
        "minimization": {"equivalent_signature": True},
        "files": [
            {
                "path": "README.md",
                "sha256": hashlib.sha256(declared).hexdigest(),
                "byte_size": len(declared),
            }
        ],
    }
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr(
            f"{PACKAGE_ROOT}/reproduction.json",
            json.dumps(metadata),
        )
        archive.writestr(f"{PACKAGE_ROOT}/README.md", content)
    return output.getvalue()


if __name__ == "__main__":
    unittest.main()
