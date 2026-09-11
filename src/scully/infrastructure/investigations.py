"""SQLite persistence for investigation plans and ordered events."""

from __future__ import annotations

from scully.domain.contracts import (
    ExecutionReport,
    ExperimentPlan,
    Hypothesis,
    InvestigationDetail,
    InvestigationEvent,
    InvestigationStatus,
)
from scully.infrastructure.database import Database


class InvestigationConflictError(ValueError):
    """Raised when an investigation identifier is already present."""


class InvestigationStateError(ValueError):
    """Raised when persisted state cannot accept an execution result."""


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
            result_row = connection.execute(
                "SELECT payload_json FROM results WHERE investigation_id = ?",
                (investigation_id,),
            ).fetchone()

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
            execution=(
                ExecutionReport.model_validate_json(str(result_row["payload_json"]))
                if result_row is not None
                else None
            ),
        )

    def complete_execution(
        self,
        report: ExecutionReport,
        events: tuple[InvestigationEvent, ...],
    ) -> InvestigationDetail:
        """Persist terminal experiment results and ordered events atomically."""

        with self.database.connect() as connection:
            row = connection.execute(
                """
                SELECT status FROM investigations WHERE investigation_id = ?
                """,
                (report.investigation_id,),
            ).fetchone()
            if row is None:
                raise InvestigationStateError("Investigation does not exist")
            if str(row["status"]) != InvestigationStatus.READY.value:
                raise InvestigationStateError("Investigation is not ready for execution")
            existing_result = connection.execute(
                "SELECT 1 FROM results WHERE investigation_id = ?",
                (report.investigation_id,),
            ).fetchone()
            if existing_result is not None:
                raise InvestigationStateError("Investigation already has a result")
            maximum = connection.execute(
                "SELECT MAX(sequence) AS value FROM events WHERE investigation_id = ?",
                (report.investigation_id,),
            ).fetchone()
            next_sequence = int(maximum["value"] or 0) + 1
            if [event.sequence for event in events] != list(
                range(next_sequence, next_sequence + len(events))
            ):
                raise InvestigationStateError("Execution event sequence is not contiguous")

            experiment_rows = connection.execute(
                """
                SELECT experiment_id FROM experiments WHERE investigation_id = ?
                """,
                (report.investigation_id,),
            ).fetchall()
            if {str(item["experiment_id"]) for item in experiment_rows} != {
                item.experiment_id for item in report.outcomes
            }:
                raise InvestigationStateError("Execution outcomes do not cover the plan")

            completed_at = events[-1].occurred_at.isoformat()
            connection.execute(
                """
                UPDATE investigations
                SET status = ?, updated_at = ?
                WHERE investigation_id = ?
                """,
                (report.status.value, completed_at, report.investigation_id),
            )
            connection.executemany(
                """
                UPDATE experiments SET status = ? WHERE experiment_id = ?
                """,
                [
                    (outcome.status.value, outcome.experiment_id)
                    for outcome in report.outcomes
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
                    for event in events
                ],
            )
            connection.execute(
                """
                INSERT INTO results(
                    investigation_id,
                    verdict,
                    signature_id,
                    completed_at,
                    payload_json
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (
                    report.investigation_id,
                    "supported" if report.supported_hypothesis_id else "inconclusive",
                    report.signature_id,
                    completed_at,
                    report.model_dump_json(),
                ),
            )
        completed = self.get(report.investigation_id)
        if completed is None:
            raise InvestigationStateError("Completed investigation could not be loaded")
        return completed
