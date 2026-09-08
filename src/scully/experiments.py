"""Offline experiment lifecycle and sibling-isolation contracts."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class ExperimentState(StrEnum):
    """Allowed scheduler states for one experiment."""

    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    TIMED_OUT = "timed_out"
    CANCELLED = "cancelled"


class ExperimentEvent(StrEnum):
    """Events accepted by the deterministic lifecycle."""

    START = "start"
    COMPLETE = "complete"
    FAIL = "fail"
    TIME_OUT = "time_out"
    CANCEL = "cancel"


class InvalidExperimentTransition(ValueError):
    """Raised when an event would rewrite or skip lifecycle state."""


_TRANSITIONS = {
    (ExperimentState.QUEUED, ExperimentEvent.START): ExperimentState.RUNNING,
    (ExperimentState.QUEUED, ExperimentEvent.CANCEL): ExperimentState.CANCELLED,
    (ExperimentState.RUNNING, ExperimentEvent.COMPLETE): ExperimentState.COMPLETED,
    (ExperimentState.RUNNING, ExperimentEvent.FAIL): ExperimentState.FAILED,
    (ExperimentState.RUNNING, ExperimentEvent.TIME_OUT): ExperimentState.TIMED_OUT,
    (ExperimentState.RUNNING, ExperimentEvent.CANCEL): ExperimentState.CANCELLED,
}


def transition_experiment(
    state: ExperimentState,
    event: ExperimentEvent,
) -> ExperimentState:
    """Apply one legal event and reject all terminal-state rewrites."""

    try:
        return _TRANSITIONS[(state, event)]
    except KeyError as error:
        raise InvalidExperimentTransition(
            f"Cannot apply {event.value} while experiment is {state.value}"
        ) from error


@dataclass(frozen=True, slots=True)
class ExperimentPlan:
    """One sibling experiment and its unique mutation marker."""

    experiment_id: str
    checkpoint_id: str
    mutation_marker: str

    def __post_init__(self) -> None:
        for name, value in (
            ("Experiment ID", self.experiment_id),
            ("Checkpoint ID", self.checkpoint_id),
            ("Mutation marker", self.mutation_marker),
        ):
            if not value.strip():
                raise ValueError(f"{name} cannot be empty")


@dataclass(frozen=True, slots=True)
class ExecutionIntegrityPlan:
    """A common checkpoint and at least two bounded sibling experiments."""

    checkpoint_id: str
    baseline_marker: str
    experiments: tuple[ExperimentPlan, ...]

    def __post_init__(self) -> None:
        if not self.checkpoint_id.strip():
            raise ValueError("Checkpoint ID cannot be empty")
        if not self.baseline_marker.strip():
            raise ValueError("Baseline marker cannot be empty")
        if len(self.experiments) < 2:
            raise ValueError("Execution-integrity plan requires two experiments")
        experiment_ids = [item.experiment_id for item in self.experiments]
        mutation_markers = [item.mutation_marker for item in self.experiments]
        if len(set(experiment_ids)) != len(experiment_ids):
            raise ValueError("Experiment IDs must be unique")
        if len(set(mutation_markers)) != len(mutation_markers):
            raise ValueError("Mutation markers must be unique")
        if any(item.checkpoint_id != self.checkpoint_id for item in self.experiments):
            raise ValueError("Every experiment must use the common checkpoint")


@dataclass(frozen=True, slots=True)
class BranchSnapshot:
    """Redacted marker visibility reported by one completed branch."""

    experiment_id: str
    checkpoint_id: str
    visible_markers: frozenset[str]


@dataclass(frozen=True, slots=True)
class IsolationCheck:
    """One deterministic isolation assertion."""

    experiment_id: str
    baseline_inherited: bool
    own_mutation_visible: bool
    sibling_mutations_absent: bool

    @property
    def passed(self) -> bool:
        return (
            self.baseline_inherited
            and self.own_mutation_visible
            and self.sibling_mutations_absent
        )


@dataclass(frozen=True, slots=True)
class IsolationReport:
    """Aggregate decision for common-parent branch isolation."""

    passed: bool
    checks: tuple[IsolationCheck, ...]


def verify_sibling_isolation(
    plan: ExecutionIntegrityPlan,
    snapshots: tuple[BranchSnapshot, ...],
) -> IsolationReport:
    """Verify baseline inheritance, own writes, and sibling separation."""

    planned_ids = {item.experiment_id for item in plan.experiments}
    snapshot_ids = [item.experiment_id for item in snapshots]
    if len(set(snapshot_ids)) != len(snapshot_ids):
        raise ValueError("Snapshot experiment IDs must be unique")
    if set(snapshot_ids) != planned_ids:
        raise ValueError("Snapshots must cover every planned experiment exactly once")
    if any(item.checkpoint_id != plan.checkpoint_id for item in snapshots):
        raise ValueError("Every snapshot must report the common checkpoint")

    mutation_by_id = {
        item.experiment_id: item.mutation_marker for item in plan.experiments
    }
    checks = []
    for snapshot in snapshots:
        sibling_markers = {
            marker
            for experiment_id, marker in mutation_by_id.items()
            if experiment_id != snapshot.experiment_id
        }
        checks.append(
            IsolationCheck(
                experiment_id=snapshot.experiment_id,
                baseline_inherited=plan.baseline_marker in snapshot.visible_markers,
                own_mutation_visible=(
                    mutation_by_id[snapshot.experiment_id]
                    in snapshot.visible_markers
                ),
                sibling_mutations_absent=sibling_markers.isdisjoint(
                    snapshot.visible_markers
                ),
            )
        )
    normalized_checks = tuple(checks)
    return IsolationReport(
        passed=all(check.passed for check in normalized_checks),
        checks=normalized_checks,
    )
