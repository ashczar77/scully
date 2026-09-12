from __future__ import annotations

import io
import json
import shutil
import tempfile
import unittest
import zipfile
from pathlib import Path

from scully.application.capsule_import import CapsuleImporter
from scully.application.execution import LocalExecutionAdapter
from scully.application.investigations import InvestigationService
from scully.application.planning import LocalPlanningAdapter
from scully.application.reproduction import (
    MAX_PACKAGE_BYTES,
    PACKAGE_ROOT,
    REPRODUCTION_FILES,
    ReproductionPackageError,
    ReproductionPackager,
)
from scully.infrastructure.capsules import CapsuleRepository
from scully.infrastructure.database import Database
from scully.infrastructure.investigations import InvestigationRepository


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SEED_CAPSULE = REPOSITORY_ROOT / "fixtures" / "capsules" / "proxy-identity-collapse"
REPRODUCTIONS = REPOSITORY_ROOT / "fixtures" / "reproductions"


class ReproductionPackagerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        database = Database(self.root / "scully.db")
        database.initialize()
        capsules = CapsuleRepository(database)
        artifacts = self.root / "artifacts"
        CapsuleImporter(artifacts, capsules).import_path(SEED_CAPSULE)
        self.service = InvestigationService(
            capsules,
            InvestigationRepository(database),
            LocalPlanningAdapter(),
            LocalExecutionAdapter(artifacts),
            id_factory=lambda: "inv-package",
        )
        self.reproductions = self.root / "reproductions"
        shutil.copytree(REPRODUCTIONS, self.reproductions)
        self.packager = ReproductionPackager(self.reproductions)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_completed_investigation_builds_a_repeatable_bounded_archive(self) -> None:
        planned = self.service.create("proxy-identity-collapse-v2")
        completed = self.service.execute(planned.investigation_id)

        first = self.packager.build(completed)
        second = self.packager.build(completed)

        self.assertEqual(first, second)
        with zipfile.ZipFile(io.BytesIO(first)) as archive:
            names = set(archive.namelist())
            self.assertEqual(
                names,
                {
                    f"{PACKAGE_ROOT}/reproduction.json",
                    *(f"{PACKAGE_ROOT}/{name}" for name in REPRODUCTION_FILES),
                },
            )
            metadata = json.loads(
                archive.read(f"{PACKAGE_ROOT}/reproduction.json")
            )
            readme = archive.read(f"{PACKAGE_ROOT}/README.md").decode("utf-8")
            package = json.loads(
                archive.read(f"{PACKAGE_ROOT}/package.json")
            )
            minimization = json.loads(
                archive.read(f"{PACKAGE_ROOT}/minimization.json")
            )
            signature = json.loads(
                archive.read(
                    f"{PACKAGE_ROOT}/signatures/proxy-identity-collapse-v1.json"
                )
            )
            trigger = json.loads(
                archive.read(f"{PACKAGE_ROOT}/fixtures/requests.json")
            )
        self.assertEqual(metadata["investigation_id"], "inv-package")
        self.assertEqual(metadata["capsule_id"], "proxy-identity-collapse-v2")
        self.assertEqual(metadata["signature_id"], "proxy-identity-collapse-v1")
        self.assertEqual(
            metadata["supported_cause"],
            "Proxy trust boundary is disabled",
        )
        self.assertTrue(metadata["execution"]["isolation_verified"])
        self.assertEqual(metadata["incident_fidelity"]["proxy_hops"], 1)
        self.assertTrue(metadata["incident_fidelity"]["proxy_writes_forwarded_header"])
        self.assertEqual(metadata["result"]["incident_responses"], [200, 429])
        self.assertEqual(metadata["result"]["known_good_responses"], [200, 200])
        self.assertEqual(metadata["result"]["expected_regression_test_exit_code"], 1)
        self.assertTrue(metadata["minimization"]["equivalent_signature"])
        self.assertEqual(len(metadata["minimization"]["full_payload_fields"]), 11)
        self.assertEqual(len(metadata["minimization"]["minimized_payload_fields"]), 4)
        self.assertEqual(len(metadata["minimization"]["removed_payload_fields"]), 7)
        self.assertEqual(minimization["signature_id"], metadata["signature_id"])
        self.assertTrue(minimization["equivalent_signature"])
        self.assertEqual(len(signature["matchers"]), 5)
        self.assertEqual(
            trigger["clients"],
            ["198.51.100.10", "198.51.100.11"],
        )
        self.assertIn("200,429", readme)
        self.assertIn("200,200", readme)
        self.assertIn("expected to fail", readme)
        self.assertEqual(
            package["scripts"]["minimize"],
            "node scripts/minimize.mjs",
        )
        self.assertEqual(
            package["scripts"]["test"],
            "node --test test/proxy-identity-collapse.test.mjs",
        )
        self.assertEqual(
            package["scripts"]["verify"],
            "node scripts/verify-reproduction.mjs",
        )
        self.assertNotIn("node_modules", "\n".join(names))
        self.assertNotIn(f"{PACKAGE_ROOT}/scripts/observe.mjs", names)
        self.assertNotIn(f"{PACKAGE_ROOT}/scripts/run-branch.mjs", names)

    def test_planned_and_inconclusive_investigations_cannot_be_packaged(self) -> None:
        planned = self.service.create("proxy-identity-collapse-v2")

        with self.assertRaisesRegex(ReproductionPackageError, "must complete"):
            self.packager.build(planned)

        completed = self.service.execute(planned.investigation_id)
        assert completed.execution is not None
        inconclusive = completed.model_copy(
            update={
                "execution": completed.execution.model_copy(
                    update={"supported_hypothesis_id": None}
                )
            }
        )
        with self.assertRaises(ReproductionPackageError) as blocked:
            self.packager.build(inconclusive)
        self.assertEqual(blocked.exception.code, "cause_not_selected")

    def test_export_rejects_sensitive_invalid_and_oversized_source(self) -> None:
        completed = self._completed()
        readme = (
            self.reproductions / "proxy-identity-collapse" / "README.md"
        )
        original = readme.read_bytes()

        readme.write_bytes(b'api_key="synthetic-secret-value-12345"\n')
        with self.assertRaises(ReproductionPackageError) as sensitive:
            self.packager.build(completed)
        self.assertEqual(sensitive.exception.code, "package_sensitive_content")

        readme.write_bytes(original + b"\x00")
        with self.assertRaises(ReproductionPackageError) as invalid:
            self.packager.build(completed)
        self.assertEqual(invalid.exception.code, "package_content_invalid")

        readme.write_text("x" * (MAX_PACKAGE_BYTES + 1), encoding="utf-8")
        with self.assertRaises(ReproductionPackageError) as oversized:
            self.packager.build(completed)
        self.assertEqual(oversized.exception.code, "package_too_large")

    def test_export_rejects_symlink_and_sensitive_result_metadata(self) -> None:
        completed = self._completed()
        readme = (
            self.reproductions / "proxy-identity-collapse" / "README.md"
        )
        original = readme.read_bytes()
        readme.unlink()
        try:
            readme.symlink_to("package.json")
        except (NotImplementedError, OSError):
            self.skipTest("Symlinks are not available")
        with self.assertRaises(ReproductionPackageError) as unsafe:
            self.packager.build(completed)
        self.assertEqual(unsafe.exception.code, "template_invalid")

        readme.unlink()
        readme.write_bytes(original)
        hypotheses = list(completed.hypotheses)
        hypotheses[0] = hypotheses[0].model_copy(
            update={"title": "password=synthetic-secret-value-12345"}
        )
        sensitive_detail = completed.model_copy(
            update={"hypotheses": tuple(hypotheses)}
        )
        with self.assertRaises(ReproductionPackageError) as sensitive:
            self.packager.build(sensitive_detail)
        self.assertEqual(sensitive.exception.code, "package_sensitive_content")

    def _completed(self):
        planned = self.service.create("proxy-identity-collapse-v2")
        return self.service.execute(planned.investigation_id)


if __name__ == "__main__":
    unittest.main()
