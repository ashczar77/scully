from __future__ import annotations

import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from scully.application.capsule_import import CapsuleImporter
from scully.application.execution import LocalExecutionAdapter
from scully.application.investigations import InvestigationService
from scully.application.planning import LocalPlanningAdapter
from scully.application.reproduction import (
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
        root = Path(self.temporary.name)
        database = Database(root / "scully.db")
        database.initialize()
        capsules = CapsuleRepository(database)
        artifacts = root / "artifacts"
        CapsuleImporter(artifacts, capsules).import_path(SEED_CAPSULE)
        self.service = InvestigationService(
            capsules,
            InvestigationRepository(database),
            LocalPlanningAdapter(),
            LocalExecutionAdapter(artifacts),
            id_factory=lambda: "inv-package",
        )
        self.packager = ReproductionPackager(REPRODUCTIONS)

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

    def test_planned_investigation_cannot_be_packaged(self) -> None:
        planned = self.service.create("proxy-identity-collapse-v2")

        with self.assertRaisesRegex(ReproductionPackageError, "must complete"):
            self.packager.build(planned)


if __name__ == "__main__":
    unittest.main()
