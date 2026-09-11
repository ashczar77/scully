from __future__ import annotations

import tempfile
import unittest
import json
from pathlib import Path
from types import SimpleNamespace

from scully.application.capsule_import import CapsuleImporter
from scully.application.execution import (
    SANDBOX_BASE_IMAGE,
    SANDBOX_EXECUTABLE,
    ExecutionError,
    LocalExecutionAdapter,
    SandboxExecutionAdapter,
)
from scully.application.planning import LocalPlanningAdapter
from scully.infrastructure.capsules import CapsuleRepository
from scully.infrastructure.database import Database


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SEED_CAPSULE = REPOSITORY_ROOT / "fixtures" / "capsules" / "proxy-identity-collapse"


class LocalExecutionAdapterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        root = Path(self.temporary.name)
        database = Database(root / "scully.db")
        database.initialize()
        repository = CapsuleRepository(database)
        self.artifact_dir = root / "artifacts"
        CapsuleImporter(self.artifact_dir, repository).import_path(SEED_CAPSULE)
        manifest = repository.get_manifest("proxy-identity-collapse-v1")
        assert manifest is not None
        self.manifest = manifest
        self.plans = LocalPlanningAdapter().plan("inv-execution", manifest).experiments

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_three_isolated_branches_select_one_supported_hypothesis(self) -> None:
        timer = iter([0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6])
        report = LocalExecutionAdapter(
            self.artifact_dir,
            timer=lambda: next(timer),
        ).execute("inv-execution", self.manifest, self.plans)

        self.assertEqual(report.status.value, "completed")
        self.assertTrue(report.isolation_verified)
        self.assertEqual(report.operation_count, 3)
        self.assertEqual(report.retry_count, 0)
        self.assertEqual(report.supported_hypothesis_id, "inv-execution-h1")
        self.assertEqual(
            [item.hypothesis_disposition.value for item in report.outcomes],
            ["supported", "eliminated", "eliminated"],
        )
        self.assertEqual(
            [item.verdict.value for item in report.outcomes],
            ["not_reproduced", "reproduced", "reproduced"],
        )
        self.assertTrue(
            all(len(item.observation_digest) == 64 for item in report.outcomes)
        )
        self.assertEqual(
            report.outcomes[1].elimination_reasons,
            ("failure_signature_still_reproduced",),
        )

    def test_local_deadline_stops_new_work_without_retry(self) -> None:
        timer = iter([0.0, 0.1, 61.0, 62.0, 63.0])
        report = LocalExecutionAdapter(
            self.artifact_dir,
            timer=lambda: next(timer),
        ).execute("inv-execution", self.manifest, self.plans)

        self.assertEqual(report.status.value, "timed_out")
        self.assertEqual(report.operation_count, 1)
        self.assertEqual(report.retry_count, 0)
        self.assertFalse(report.isolation_verified)
        self.assertTrue(all(item.status.value == "timed_out" for item in report.outcomes))

    def test_repeat_execution_produces_the_same_deterministic_report(self) -> None:
        values = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6]
        first_timer = iter(values)
        second_timer = iter(values)

        first = LocalExecutionAdapter(
            self.artifact_dir,
            timer=lambda: next(first_timer),
        ).execute("inv-execution", self.manifest, self.plans)
        second = LocalExecutionAdapter(
            self.artifact_dir,
            timer=lambda: next(second_timer),
        ).execute("inv-execution", self.manifest, self.plans)

        self.assertEqual(first, second)

    def test_unallowlisted_plan_and_tampered_evidence_fail_closed(self) -> None:
        invalid = self.plans[0].model_copy(update={"variant": "arbitrary-command"})
        with self.assertRaisesRegex(ExecutionError, "allowlist"):
            LocalExecutionAdapter(self.artifact_dir).execute(
                "inv-execution",
                self.manifest,
                (invalid, *self.plans[1:]),
            )

        over_budget = self.plans[0].model_copy(update={"operation_limit": 5})
        with self.assertRaisesRegex(ExecutionError, "allowlist"):
            LocalExecutionAdapter(self.artifact_dir).execute(
                "inv-execution",
                self.manifest,
                (over_budget, *self.plans[1:]),
            )

        environment = next(
            item for item in self.manifest.evidence if item.evidence_id == "environment"
        )
        artifact = self.artifact_dir / environment.sha256[:2] / environment.sha256
        artifact.write_bytes(b"{}")
        with self.assertRaisesRegex(ExecutionError, "integrity"):
            LocalExecutionAdapter(self.artifact_dir).execute(
                "inv-execution",
                self.manifest,
                self.plans,
            )

    def test_disabled_sandbox_wrapper_uses_only_fixed_commands(self) -> None:
        runner = FakeSandboxRunner()
        report = SandboxExecutionAdapter(runner).execute(
            "inv-execution",
            self.manifest,
            self.plans,
        )

        self.assertEqual(report.execution_source, "sandbox")
        self.assertEqual(report.supported_hypothesis_id, "inv-execution-h1")
        self.assertTrue(report.isolation_verified)
        self.assertEqual(runner.base_image, SANDBOX_BASE_IMAGE)
        self.assertEqual(runner.prepare.executable, "/bin/true")
        self.assertTrue(
            all(command.executable == SANDBOX_EXECUTABLE for command in runner.branches)
        )
        self.assertEqual(
            [command.label for command in runner.branches],
            [plan.variant for plan in self.plans],
        )

    def test_sandbox_wrapper_rejects_malformed_observations(self) -> None:
        runner = FakeSandboxRunner()
        runner.invalid_output = True

        with self.assertRaisesRegex(ExecutionError, "valid JSON"):
            SandboxExecutionAdapter(runner).execute(
                "inv-execution",
                self.manifest,
                self.plans,
            )

    def test_sandbox_wrapper_reports_failed_branch_without_retry(self) -> None:
        runner = FakeSandboxRunner()
        runner.failed_index = 1

        report = SandboxExecutionAdapter(runner).execute(
            "inv-execution",
            self.manifest,
            self.plans,
        )

        self.assertEqual(report.status.value, "failed")
        self.assertEqual(report.outcomes[1].status.value, "failed")
        self.assertEqual(report.outcomes[1].verdict.value, "inconclusive")
        self.assertEqual(report.retry_count, 0)


class FakeSandboxRunner:
    def __init__(self) -> None:
        self.invalid_output = False
        self.failed_index = None
        self.base_image = ""
        self.prepare = None
        self.branches = ()

    def run_branches(
        self,
        *,
        investigation_id: str,
        base_image: str,
        prepare: object,
        branches: tuple,
    ) -> object:
        self.base_image = base_image
        self.prepare = prepare
        self.branches = branches
        values = []
        for index, branch in enumerate(branches):
            good = branch.label == "trust-loopback"
            payload = {
                "responses": [200, 200] if good else [200, 429],
                "events": (
                    ["request_accepted", "request_accepted"]
                    if good
                    else ["request_accepted", "rate_limit_rejected"]
                ),
                "identity_digests": (
                    ["identity:test-net-client-a", "identity:test-net-client-b"]
                    if good
                    else ["identity:loopback-proxy", "identity:loopback-proxy"]
                ),
                "forwarded_clients": ["198.51.100.10", "198.51.100.11"],
            }
            values.append(
                SimpleNamespace(
                    label=branch.label,
                    image_id=f"branch-{index}",
                    stdout="not-json" if self.invalid_output else json.dumps(payload),
                    exit_code=1 if self.failed_index == index else 0,
                    elapsed_seconds=0.1,
                )
            )
        return SimpleNamespace(
            branches=tuple(values),
            parent_image_id="parent",
            measurement=SimpleNamespace(sandbox_operations=5),
        )


if __name__ == "__main__":
    unittest.main()
