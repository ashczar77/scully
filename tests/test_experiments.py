from __future__ import annotations

import unittest

from scully.experiments import (
    BranchSnapshot,
    ExecutionIntegrityPlan,
    ExperimentEvent,
    ExperimentPlan,
    ExperimentState,
    InvalidExperimentTransition,
    transition_experiment,
    verify_sibling_isolation,
)


def integrity_plan() -> ExecutionIntegrityPlan:
    return ExecutionIntegrityPlan(
        checkpoint_id="checkpoint-001",
        baseline_marker="baseline",
        experiments=(
            ExperimentPlan(
                experiment_id="experiment-a",
                checkpoint_id="checkpoint-001",
                mutation_marker="branch-a",
            ),
            ExperimentPlan(
                experiment_id="experiment-b",
                checkpoint_id="checkpoint-001",
                mutation_marker="branch-b",
            ),
        ),
    )


class ExperimentLifecycleTests(unittest.TestCase):
    def test_successful_lifecycle(self) -> None:
        running = transition_experiment(ExperimentState.QUEUED, ExperimentEvent.START)
        completed = transition_experiment(running, ExperimentEvent.COMPLETE)

        self.assertEqual(completed, ExperimentState.COMPLETED)

    def test_queued_or_running_experiment_can_be_cancelled(self) -> None:
        self.assertEqual(
            transition_experiment(ExperimentState.QUEUED, ExperimentEvent.CANCEL),
            ExperimentState.CANCELLED,
        )
        self.assertEqual(
            transition_experiment(ExperimentState.RUNNING, ExperimentEvent.CANCEL),
            ExperimentState.CANCELLED,
        )

    def test_running_experiment_can_fail_or_time_out(self) -> None:
        self.assertEqual(
            transition_experiment(ExperimentState.RUNNING, ExperimentEvent.FAIL),
            ExperimentState.FAILED,
        )
        self.assertEqual(
            transition_experiment(ExperimentState.RUNNING, ExperimentEvent.TIME_OUT),
            ExperimentState.TIMED_OUT,
        )

    def test_terminal_state_cannot_be_rewritten(self) -> None:
        for state in (
            ExperimentState.COMPLETED,
            ExperimentState.FAILED,
            ExperimentState.TIMED_OUT,
            ExperimentState.CANCELLED,
        ):
            for event in ExperimentEvent:
                with self.subTest(state=state, event=event):
                    with self.assertRaises(InvalidExperimentTransition):
                        transition_experiment(state, event)

    def test_experiment_cannot_complete_before_start(self) -> None:
        with self.assertRaises(InvalidExperimentTransition):
            transition_experiment(ExperimentState.QUEUED, ExperimentEvent.COMPLETE)


class SiblingIsolationTests(unittest.TestCase):
    def test_common_checkpoint_with_no_sibling_leak_passes(self) -> None:
        report = verify_sibling_isolation(
            integrity_plan(),
            (
                BranchSnapshot(
                    experiment_id="experiment-a",
                    checkpoint_id="checkpoint-001",
                    visible_markers=frozenset({"baseline", "branch-a"}),
                ),
                BranchSnapshot(
                    experiment_id="experiment-b",
                    checkpoint_id="checkpoint-001",
                    visible_markers=frozenset({"baseline", "branch-b"}),
                ),
            ),
        )

        self.assertTrue(report.passed)
        self.assertTrue(all(check.passed for check in report.checks))

    def test_sibling_mutation_leak_fails(self) -> None:
        report = verify_sibling_isolation(
            integrity_plan(),
            (
                BranchSnapshot(
                    experiment_id="experiment-a",
                    checkpoint_id="checkpoint-001",
                    visible_markers=frozenset(
                        {"baseline", "branch-a", "branch-b"}
                    ),
                ),
                BranchSnapshot(
                    experiment_id="experiment-b",
                    checkpoint_id="checkpoint-001",
                    visible_markers=frozenset({"baseline", "branch-b"}),
                ),
            ),
        )

        self.assertFalse(report.passed)
        self.assertFalse(report.checks[0].sibling_mutations_absent)

    def test_plan_rejects_mixed_checkpoints(self) -> None:
        with self.assertRaisesRegex(ValueError, "common checkpoint"):
            ExecutionIntegrityPlan(
                checkpoint_id="checkpoint-001",
                baseline_marker="baseline",
                experiments=(
                    ExperimentPlan("experiment-a", "checkpoint-001", "branch-a"),
                    ExperimentPlan("experiment-b", "checkpoint-002", "branch-b"),
                ),
            )

    def test_snapshots_must_cover_plan_exactly_once(self) -> None:
        with self.assertRaisesRegex(ValueError, "exactly once"):
            verify_sibling_isolation(
                integrity_plan(),
                (
                    BranchSnapshot(
                        experiment_id="experiment-a",
                        checkpoint_id="checkpoint-001",
                        visible_markers=frozenset({"baseline", "branch-a"}),
                    ),
                ),
            )


if __name__ == "__main__":
    unittest.main()
