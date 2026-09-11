"""Application service for creating evidence-linked investigations."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
from uuid import uuid4

from scully.application.planning import PlanningAdapter, PlanningError, PlanningSource
from scully.domain.contracts import (
    ExperimentPlan,
    Hypothesis,
    InvestigationDetail,
    InvestigationEvent,
    InvestigationStatus,
)
from scully.infrastructure.capsules import CapsuleRepository
from scully.infrastructure.investigations import (
    InvestigationConflictError,
    InvestigationRepository,
)


class InvestigationError(ValueError):
    """Bounded application error for investigation requests."""

    def __init__(self, code: str, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


class InvestigationService:
    """Create and retrieve a complete offline planning snapshot."""

    def __init__(
        self,
        capsules: CapsuleRepository,
        investigations: InvestigationRepository,
        planner: PlanningAdapter,
        *,
        clock: Callable[[], datetime] | None = None,
        id_factory: Callable[[], str] | None = None,
    ) -> None:
        self.capsules = capsules
        self.investigations = investigations
        self.planner = planner
        self.clock = clock or (lambda: datetime.now(UTC))
        self.id_factory = id_factory or (lambda: f"inv-{uuid4().hex[:12]}")

    def create(self, capsule_id: str) -> InvestigationDetail:
        """Plan one accepted capsule and persist ordered evidence of the work."""

        manifest = self.capsules.get_manifest(capsule_id)
        if manifest is None:
            raise InvestigationError(
                "capsule_not_found",
                "Accepted capsule was not found",
                status_code=404,
            )
        investigation_id = self.id_factory()
        if not investigation_id or len(investigation_id) > 128:
            raise InvestigationError(
                "investigation_id_invalid",
                "Investigation identifier is invalid",
                status_code=500,
            )
        try:
            bundle = self.planner.plan(investigation_id, manifest)
        except PlanningError as error:
            raise InvestigationError(
                error.code,
                error.message,
                status_code=error.status_code,
            ) from error

        created_at = self.clock()
        if created_at.tzinfo is None or created_at.utcoffset() is None:
            raise InvestigationError(
                "clock_invalid",
                "Investigation clock must provide a timezone",
                status_code=500,
            )
        events = _planning_events(
            investigation_id,
            capsule_id,
            bundle.source,
            bundle.hypotheses,
            bundle.experiments,
            created_at,
        )
        detail = InvestigationDetail(
            investigation_id=investigation_id,
            capsule_id=capsule_id,
            status=InvestigationStatus.READY,
            planning_source=bundle.source,
            created_at=created_at,
            hypotheses=bundle.hypotheses,
            experiments=bundle.experiments,
            events=events,
        )
        try:
            self.investigations.save(detail)
        except InvestigationConflictError as error:
            raise InvestigationError(
                "investigation_conflict",
                "Investigation identifier already exists",
                status_code=409,
            ) from error
        return detail

    def get(self, investigation_id: str) -> InvestigationDetail:
        """Return one persisted investigation or a bounded not-found error."""

        detail = self.investigations.get(investigation_id)
        if detail is None:
            raise InvestigationError(
                "investigation_not_found",
                "Investigation was not found",
                status_code=404,
            )
        return detail


def _planning_events(
    investigation_id: str,
    capsule_id: str,
    source: PlanningSource,
    hypotheses: tuple[Hypothesis, ...],
    experiments: tuple[ExperimentPlan, ...],
    occurred_at: datetime,
) -> tuple[InvestigationEvent, ...]:
    events = [
        InvestigationEvent(
            investigation_id=investigation_id,
            sequence=1,
            event_type="investigation.created",
            occurred_at=occurred_at,
            payload={"capsule_id": capsule_id},
        ),
        InvestigationEvent(
            investigation_id=investigation_id,
            sequence=2,
            event_type="planning.started",
            occurred_at=occurred_at,
            payload={"source": source},
        ),
    ]
    for hypothesis, experiment in zip(hypotheses, experiments, strict=True):
        events.append(
            InvestigationEvent(
                investigation_id=investigation_id,
                sequence=len(events) + 1,
                event_type="hypothesis.created",
                occurred_at=occurred_at,
                payload={
                    "hypothesis_id": hypothesis.hypothesis_id,
                    "experiment_id": experiment.experiment_id,
                    "confidence": hypothesis.confidence,
                },
            )
        )
    events.append(
        InvestigationEvent(
            investigation_id=investigation_id,
            sequence=len(events) + 1,
            event_type="planning.completed",
            occurred_at=occurred_at,
            payload={"source": source, "hypothesis_count": len(hypotheses)},
        )
    )
    return tuple(events)
