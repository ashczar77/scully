"""Versioned contracts for the complete investigation path."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


Identifier = Annotated[str, Field(min_length=1, max_length=128)]
SchemaVersion = Annotated[str, Field(pattern=r"^1\.[0-9]+$")]


class ContractModel(BaseModel):
    """Strict immutable base for persisted and API contracts."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class RedactionStatus(str, Enum):
    """Safety status assigned to one evidence item."""

    CLEAN = "clean"
    REDACTED = "redacted"
    REJECTED = "rejected"


class InvestigationStatus(str, Enum):
    """Investigation lifecycle states."""

    DRAFT = "draft"
    READY = "ready"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    TIMED_OUT = "timed_out"
    TERMINATION_UNCONFIRMED = "termination_unconfirmed"

    def is_terminal(self) -> bool:
        return self in {
            self.COMPLETED,
            self.FAILED,
            self.TIMED_OUT,
            self.TERMINATION_UNCONFIRMED,
        }


class ExperimentStatus(str, Enum):
    """Experiment branch lifecycle states."""

    QUEUED = "queued"
    RUNNING = "running"
    REPRODUCED = "reproduced"
    ELIMINATED = "eliminated"
    INCONCLUSIVE = "inconclusive"
    FAILED = "failed"
    TIMED_OUT = "timed_out"
    TERMINATION_UNCONFIRMED = "termination_unconfirmed"


class ReproductionVerdict(str, Enum):
    """Deterministic final evaluation result."""

    REPRODUCED = "reproduced"
    NOT_REPRODUCED = "not_reproduced"
    INCONCLUSIVE = "inconclusive"


class EvidenceReference(ContractModel):
    """Sanitized evidence metadata without file contents."""

    evidence_id: Identifier
    relative_path: Annotated[str, Field(min_length=1, max_length=512)]
    sha256: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
    byte_size: Annotated[int, Field(ge=0, le=10_485_760)]
    media_type: Annotated[str, Field(min_length=1, max_length=128)]
    provenance: Annotated[str, Field(min_length=1, max_length=256)]
    redaction_status: RedactionStatus


class CapsuleSummary(ContractModel):
    """Normalized capsule metadata used by investigations."""

    schema_version: SchemaVersion = "1.0"
    capsule_id: Identifier
    title: Annotated[str, Field(min_length=1, max_length=160)]
    observed_summary: Annotated[str, Field(min_length=1, max_length=2_000)]
    signature_id: Identifier
    evidence: tuple[EvidenceReference, ...]


class Hypothesis(ContractModel):
    """Evidence-linked explanation proposed for one investigation."""

    schema_version: SchemaVersion = "1.0"
    hypothesis_id: Identifier
    title: Annotated[str, Field(min_length=1, max_length=160)]
    mechanism: Annotated[str, Field(min_length=1, max_length=1_000)]
    rationale: Annotated[str, Field(min_length=1, max_length=2_000)]
    testable_prediction: Annotated[str, Field(min_length=1, max_length=1_000)]
    alternative_group: Identifier
    evidence_ids: Annotated[tuple[Identifier, ...], Field(min_length=1, max_length=16)]
    confidence: Annotated[float, Field(ge=0, le=1)]


class ExperimentPlan(ContractModel):
    """Bounded execution plan linked to one hypothesis."""

    schema_version: SchemaVersion = "1.0"
    experiment_id: Identifier
    hypothesis_id: Identifier
    checkpoint_id: Identifier
    adapter: Annotated[str, Field(min_length=1, max_length=64)]
    variant: Identifier
    parameters: dict[str, str | int | bool]
    operation_limit: Annotated[int, Field(ge=1, le=16)]
    timeout_seconds: Annotated[int, Field(ge=1, le=300)]


class InvestigationEvent(ContractModel):
    """Ordered event persisted before delivery to the browser."""

    schema_version: SchemaVersion = "1.0"
    investigation_id: Identifier
    sequence: Annotated[int, Field(ge=1)]
    event_type: Annotated[str, Field(min_length=1, max_length=96)]
    occurred_at: datetime
    payload: dict[str, str | int | float | bool | None]

    @field_validator("occurred_at")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("Event timestamps must include a timezone")
        return value


class ReproductionResult(ContractModel):
    """Deterministic result and its evidence lineage."""

    schema_version: SchemaVersion = "1.0"
    investigation_id: Identifier
    verdict: ReproductionVerdict
    signature_id: Identifier
    experiment_id: Identifier | None = None
    matched_evidence_ids: tuple[Identifier, ...] = ()
    limitations: tuple[Annotated[str, Field(max_length=500)], ...] = ()


class InvestigationDetail(ContractModel):
    """Current persisted investigation planning state."""

    schema_version: SchemaVersion = "1.0"
    investigation_id: Identifier
    capsule_id: Identifier
    status: InvestigationStatus
    planning_source: Literal["local", "nemotron"]
    created_at: datetime
    hypotheses: Annotated[tuple[Hypothesis, ...], Field(min_length=1, max_length=8)]
    experiments: Annotated[tuple[ExperimentPlan, ...], Field(min_length=1, max_length=8)]
    events: Annotated[tuple[InvestigationEvent, ...], Field(min_length=1, max_length=64)]

    @field_validator("created_at")
    @classmethod
    def require_created_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("Investigation timestamps must include a timezone")
        return value

    @model_validator(mode="after")
    def validate_plan_links(self) -> InvestigationDetail:
        hypothesis_ids = [item.hypothesis_id for item in self.hypotheses]
        experiment_hypothesis_ids = [
            item.hypothesis_id for item in self.experiments
        ]
        if (
            len(hypothesis_ids) != len(set(hypothesis_ids))
            or len(experiment_hypothesis_ids) != len(set(experiment_hypothesis_ids))
            or set(hypothesis_ids) != set(experiment_hypothesis_ids)
        ):
            raise ValueError("Every hypothesis must have exactly one experiment plan")
        if any(event.investigation_id != self.investigation_id for event in self.events):
            raise ValueError("Every event must belong to the investigation")
        if [event.sequence for event in self.events] != list(range(1, len(self.events) + 1)):
            raise ValueError("Investigation event sequence must be contiguous")
        return self
