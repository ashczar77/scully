from __future__ import annotations

import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path

from scully.application.capsule_import import CapsuleImporter
from scully.application.execution import ExecutionError, LocalExecutionAdapter
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
        self.capsules = CapsuleRepository(database)
        artifact_dir = root / "artifacts"
        CapsuleImporter(artifact_dir, self.capsules).import_path(SEED_CAPSULE)
        self.repository = InvestigationRepository(database)
        self.service = InvestigationService(
            self.capsules,
            self.repository,
            LocalPlanningAdapter(),
            LocalExecutionAdapter(artifact_dir),
            clock=lambda: FIXED_TIME,
            id_factory=lambda: "inv-fixed",
        )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_create_persists_a_complete_ordered_planning_snapshot(self) -> None:
        detail = self.service.create("proxy-identity-collapse-v2")

        self.assertEqual(detail.status.value, "ready")
        self.assertEqual(detail.planning_source, "local")
        self.assertEqual(len(detail.hypotheses), 3)
        self.assertEqual(len(detail.experiments), 3)
        self.assertEqual([item.sequence for item in detail.events], list(range(1, 8)))
        boundary = detail.events[1]
        self.assertEqual(boundary.event_type, "evidence.boundary.verified")
        self.assertEqual(
            boundary.payload,
            {
                "evidence_count": 6,
                "provenance_count": 6,
                "clean_count": 6,
                "redacted_count": 0,
                "secret_scan": "passed",
            },
        )
        self.assertEqual(detail.events[-1].event_type, "planning.completed")
        self.assertEqual(self.repository.get("inv-fixed"), detail)

    def test_missing_capsule_and_duplicate_id_have_bounded_errors(self) -> None:
        with self.assertRaises(InvestigationError) as missing:
            self.service.create("missing")
        self.assertEqual(missing.exception.code, "capsule_not_found")
        self.assertEqual(missing.exception.status_code, 404)

        self.service.create("proxy-identity-collapse-v2")
        with self.assertRaises(InvestigationError) as conflict:
            self.service.create("proxy-identity-collapse-v2")
        self.assertEqual(conflict.exception.code, "investigation_conflict")
        self.assertEqual(conflict.exception.status_code, 409)

    def test_execute_persists_results_and_terminal_events_once(self) -> None:
        planned = self.service.create("proxy-identity-collapse-v2")
        completed = self.service.execute(planned.investigation_id)

        self.assertEqual(completed.status.value, "completed")
        self.assertIsNotNone(completed.execution)
        assert completed.execution is not None
        self.assertEqual(
            completed.execution.supported_hypothesis_id,
            "inv-fixed-h1",
        )
        self.assertEqual(len(completed.events), 23)
        self.assertEqual(completed.events[-1].event_type, "investigation.completed")
        self.assertEqual(self.repository.get("inv-fixed"), completed)

        with self.assertRaises(InvestigationError) as repeated:
            self.service.execute(planned.investigation_id)
        self.assertEqual(repeated.exception.code, "investigation_not_ready")

    def test_insufficient_known_good_evidence_blocks_planning(self) -> None:
        manifest = self.capsules.get_manifest("proxy-identity-collapse-v2")
        assert manifest is not None
        environment = list(manifest.environment)
        environment[0] = environment[0].model_copy(
            update={"known_good_value": None}
        )
        incomplete = manifest.model_copy(
            update={
                "capsule_id": "insufficient-capsule",
                "environment": tuple(environment),
            }
        )
        self.capsules.save(incomplete)

        with self.assertRaises(InvestigationError) as blocked:
            self.service.create(incomplete.capsule_id)

        self.assertEqual(blocked.exception.code, "insufficient_evidence")
        self.assertEqual(blocked.exception.status_code, 422)

    def test_execution_policy_failure_closes_audited_investigation(self) -> None:
        identifiers = iter(("inv-blocked", "inv-recovery"))
        service = InvestigationService(
            self.capsules,
            self.repository,
            LocalPlanningAdapter(),
            FailingExecutionAdapter(),
            clock=lambda: FIXED_TIME,
            id_factory=lambda: next(identifiers),
        )
        planned = service.create("proxy-identity-collapse-v2")

        with self.assertRaises(InvestigationError) as blocked:
            service.execute(planned.investigation_id)

        self.assertEqual(blocked.exception.code, "command_policy_violation")
        self.assertNotIn("sensitive-provider-detail", blocked.exception.message)
        failed = service.get(planned.investigation_id)
        self.assertEqual(failed.status.value, "failed")
        self.assertIsNone(failed.execution)
        self.assertEqual(
            [event.event_type for event in failed.events[-2:]],
            ["execution.blocked", "investigation.failed"],
        )
        self.assertEqual(
            failed.events[-2].payload,
            {"reason_code": "command_policy_violation", "retryable": False},
        )
        self.assertNotIn("sensitive-provider-detail", failed.model_dump_json())
        with self.assertRaises(InvestigationError) as repeated:
            service.execute(planned.investigation_id)
        self.assertEqual(repeated.exception.code, "investigation_not_ready")
        recovery = service.create("proxy-identity-collapse-v2")
        self.assertEqual(recovery.investigation_id, "inv-recovery")
        self.assertEqual(recovery.status.value, "ready")

    def test_unexpected_execution_failure_is_redacted_and_terminal(self) -> None:
        service = InvestigationService(
            self.capsules,
            self.repository,
            LocalPlanningAdapter(),
            UnexpectedExecutionAdapter(),
            clock=lambda: FIXED_TIME,
            id_factory=lambda: "inv-unexpected",
        )
        planned = service.create("proxy-identity-collapse-v2")

        with self.assertRaises(InvestigationError) as blocked:
            service.execute(planned.investigation_id)

        self.assertEqual(blocked.exception.code, "execution_failed")
        self.assertNotIn("sensitive-provider-detail", blocked.exception.message)
        failed = service.get(planned.investigation_id)
        self.assertEqual(failed.status.value, "failed")
        self.assertEqual(
            failed.events[-2].payload["reason_code"],
            "execution_failed",
        )
        self.assertNotIn("sensitive-provider-detail", failed.model_dump_json())


class FailingExecutionAdapter:
    def execute(self, *unused_args, **unused_kwargs):
        raise ExecutionError(
            "command_policy_violation",
            "sensitive-provider-detail",
            status_code=502,
        )


class UnexpectedExecutionAdapter:
    def execute(self, *unused_args, **unused_kwargs):
        raise RuntimeError("sensitive-provider-detail")


if __name__ == "__main__":
    unittest.main()
