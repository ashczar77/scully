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
        planned = self.service.create("proxy-identity-collapse-v1")
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
        self.assertEqual(metadata["investigation_id"], "inv-package")
        self.assertEqual(
            metadata["supported_cause"],
            "Proxy trust boundary is disabled",
        )
        self.assertTrue(metadata["execution"]["isolation_verified"])
        self.assertNotIn("node_modules", "\n".join(names))

    def test_planned_investigation_cannot_be_packaged(self) -> None:
        planned = self.service.create("proxy-identity-collapse-v1")

        with self.assertRaisesRegex(ReproductionPackageError, "must complete"):
            self.packager.build(planned)


if __name__ == "__main__":
    unittest.main()
