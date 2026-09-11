from __future__ import annotations

import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path

from scully.application.capsule_import import CapsuleImporter
from scully.application.investigations import InvestigationError, InvestigationService
from scully.application.planning import LocalPlanningAdapter
from scully.infrastructure.capsules import CapsuleRepository
from scully.infrastructure.database import Database
from scully.infrastructure.investigations import InvestigationRepository


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SEED_CAPSULE = REPOSITORY_ROOT / "fixtures" / "capsules" / "proxy-identity-collapse"
FIXED_TIME = datetime(2026, 9, 11, 10, 30, tzinfo=UTC)


class InvestigationServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        root = Path(self.temporary.name)
        database = Database(root / "scully.db")
        database.initialize()
        capsules = CapsuleRepository(database)
        CapsuleImporter(root / "artifacts", capsules).import_path(SEED_CAPSULE)
        self.repository = InvestigationRepository(database)
        self.service = InvestigationService(
            capsules,
            self.repository,
            LocalPlanningAdapter(),
            clock=lambda: FIXED_TIME,
            id_factory=lambda: "inv-fixed",
        )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_create_persists_a_complete_ordered_planning_snapshot(self) -> None:
        detail = self.service.create("proxy-identity-collapse-v1")

        self.assertEqual(detail.status.value, "ready")
        self.assertEqual(detail.planning_source, "local")
        self.assertEqual(len(detail.hypotheses), 3)
        self.assertEqual(len(detail.experiments), 3)
        self.assertEqual([item.sequence for item in detail.events], list(range(1, 7)))
        self.assertEqual(detail.events[-1].event_type, "planning.completed")
        self.assertEqual(self.repository.get("inv-fixed"), detail)

    def test_missing_capsule_and_duplicate_id_have_bounded_errors(self) -> None:
        with self.assertRaises(InvestigationError) as missing:
            self.service.create("missing")
        self.assertEqual(missing.exception.code, "capsule_not_found")
        self.assertEqual(missing.exception.status_code, 404)

        self.service.create("proxy-identity-collapse-v1")
        with self.assertRaises(InvestigationError) as conflict:
            self.service.create("proxy-identity-collapse-v1")
        self.assertEqual(conflict.exception.code, "investigation_conflict")
        self.assertEqual(conflict.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
