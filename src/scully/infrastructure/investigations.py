"""SQLite persistence for investigation plans and ordered events."""

from __future__ import annotations

from scully.domain.contracts import (
    ExperimentPlan,
    Hypothesis,
    InvestigationDetail,
    InvestigationEvent,
    InvestigationStatus,
)
from scully.infrastructure.database import Database


class InvestigationConflictError(ValueError):
    """Raised when an investigation identifier is already present."""


class InvestigationRepository:
    """Persist and load one complete planning snapshot."""

    def __init__(self, database: Database) -> None:
        self.database = database

    def save(self, detail: InvestigationDetail) -> None:
        """Persist a new investigation, plans, and events atomically."""

        with self.database.connect() as connection:
            existing = connection.execute(
                "SELECT 1 FROM investigations WHERE investigation_id = ?",
                (detail.investigation_id,),
            ).fetchone()
            if existing is not None:
                raise InvestigationConflictError("Investigation ID already exists")
            timestamp = detail.created_at.isoformat()
            connection.execute(
                """
                INSERT INTO investigations(
                    investigation_id,
                    capsule_id,
                    status,
                    planning_source,
                    created_at,
                    updated_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    detail.investigation_id,
                    detail.capsule_id,
                    detail.status.value,
                    detail.planning_source,
                    timestamp,
                    timestamp,
                ),
            )
            connection.executemany(
                """
                INSERT INTO hypotheses(hypothesis_id, investigation_id, payload_json)
                VALUES (?, ?, ?)
                """,
                [
                    (
                        hypothesis.hypothesis_id,
                        detail.investigation_id,
                        hypothesis.model_dump_json(),
                    )
                    for hypothesis in detail.hypotheses
                ],
            )
            connection.executemany(
                """
                INSERT INTO experiments(
                    experiment_id,
                    investigation_id,
                    hypothesis_id,
                    status,
                    checkpoint_id,
                    payload_json
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        experiment.experiment_id,
                        detail.investigation_id,
                        experiment.hypothesis_id,
                        "queued",
                        experiment.checkpoint_id,
                        experiment.model_dump_json(),
                    )
                    for experiment in detail.experiments
                ],
            )
            connection.executemany(
                """
                INSERT INTO events(
                    investigation_id,
                    sequence,
                    event_type,
                    schema_version,
                    occurred_at,
                    payload_json
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        event.investigation_id,
                        event.sequence,
                        event.event_type,
                        event.schema_version,
                        event.occurred_at.isoformat(),
                        event.model_dump_json(),
                    )
                    for event in detail.events
                ],
            )

    def get(self, investigation_id: str) -> InvestigationDetail | None:
        """Load the ordered planning snapshot by investigation ID."""

        with self.database.connect() as connection:
            row = connection.execute(
                """
                SELECT investigation_id, capsule_id, status, planning_source, created_at
                FROM investigations
                WHERE investigation_id = ?
                """,
                (investigation_id,),
            ).fetchone()
            if row is None:
                return None
            hypothesis_rows = connection.execute(
                """
                SELECT payload_json FROM hypotheses
                WHERE investigation_id = ?
                ORDER BY hypothesis_id
                """,
                (investigation_id,),
            ).fetchall()
            experiment_rows = connection.execute(
                """
                SELECT payload_json FROM experiments
                WHERE investigation_id = ?
                ORDER BY experiment_id
                """,
                (investigation_id,),
            ).fetchall()
            event_rows = connection.execute(
                """
                SELECT payload_json FROM events
                WHERE investigation_id = ?
                ORDER BY sequence
                """,
                (investigation_id,),
            ).fetchall()

        return InvestigationDetail(
            investigation_id=str(row["investigation_id"]),
            capsule_id=str(row["capsule_id"]),
            status=InvestigationStatus(str(row["status"])),
            planning_source=str(row["planning_source"]),
            created_at=str(row["created_at"]),
            hypotheses=tuple(
                Hypothesis.model_validate_json(str(item["payload_json"]))
                for item in hypothesis_rows
            ),
            experiments=tuple(
                ExperimentPlan.model_validate_json(str(item["payload_json"]))
                for item in experiment_rows
            ),
            events=tuple(
                InvestigationEvent.model_validate_json(str(item["payload_json"]))
                for item in event_rows
            ),
        )
