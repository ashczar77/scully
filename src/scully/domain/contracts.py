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


class HypothesisDisposition(str, Enum):
    """Evidence state assigned after testing one hypothesis prediction."""

    SUPPORTED = "supported"
    ELIMINATED = "eliminated"
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


class EnvironmentComparison(ContractModel):
    """Sanitized incident and known-good environment values."""

    name: Identifier
    incident_value: Annotated[str, Field(min_length=1, max_length=256)]
    known_good_value: Annotated[str, Field(min_length=1, max_length=256)] | None = None


class ExecutionBoundary(ContractModel):
    """Non-secret runtime limits declared by an accepted capsule."""

    runtime: Identifier
    runtime_version: Annotated[str, Field(min_length=1, max_length=64)]
    network_access: Literal[False]
    max_duration_seconds: Annotated[int, Field(ge=1, le=300)]


class CapsuleSummary(ContractModel):
    """Normalized capsule metadata used by investigations."""

    schema_version: SchemaVersion = "1.0"
    capsule_id: Identifier
    title: Annotated[str, Field(min_length=1, max_length=160)]
    observed_summary: Annotated[str, Field(min_length=1, max_length=2_000)]
    signature_id: Identifier
    signature_matcher_count: Annotated[int, Field(ge=1, le=32)]
    known_good_summary: Annotated[str, Field(min_length=1, max_length=1_000)]
    environment: Annotated[tuple[EnvironmentComparison, ...], Field(min_length=1, max_length=32)]
    evidence: tuple[EvidenceReference, ...]
    exclusions: Annotated[tuple[str, ...], Field(min_length=1, max_length=32)]
    execution_boundary: ExecutionBoundary
    missing_evidence: tuple[Annotated[str, Field(min_length=1, max_length=320)], ...] = ()


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


class SignatureMatchResult(ContractModel):
    """One bounded deterministic matcher result."""

    matcher_id: Identifier
    required: bool
    passed: bool
    reason: Annotated[str, Field(min_length=1, max_length=96)]


class ExperimentOutcome(ContractModel):
    """Terminal outcome for one isolated experiment branch."""

    schema_version: SchemaVersion = "1.0"
    experiment_id: Identifier
    hypothesis_id: Identifier
    status: ExperimentStatus
    verdict: ReproductionVerdict
    hypothesis_disposition: HypothesisDisposition
    observation_digest: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
    matcher_results: tuple[SignatureMatchResult, ...] = ()
    elimination_reasons: tuple[
        Annotated[str, Field(min_length=1, max_length=160)], ...
    ] = ()
    duration_ms: Annotated[float, Field(ge=0, allow_inf_nan=False)]


class ExecutionReport(ContractModel):
    """Deterministic aggregate result for all planned branches."""

    schema_version: SchemaVersion = "1.0"
    investigation_id: Identifier
    checkpoint_id: Identifier
    status: InvestigationStatus
    signature_id: Identifier
    evaluator_version: Identifier
    execution_source: Literal["local", "sandbox"]
    isolation_verified: bool
    operation_count: Annotated[int, Field(ge=0, le=16)]
    retry_count: Annotated[int, Field(ge=0, le=1)]
    supported_hypothesis_id: Identifier | None = None
    outcomes: Annotated[
        tuple[ExperimentOutcome, ...],
        Field(min_length=1, max_length=8),
    ]
    limitations: tuple[Annotated[str, Field(max_length=500)], ...] = ()

    @model_validator(mode="after")
    def validate_execution_links(self) -> ExecutionReport:
        experiment_ids = [item.experiment_id for item in self.outcomes]
        if len(experiment_ids) != len(set(experiment_ids)):
            raise ValueError("Execution outcome IDs must be unique")
        supported = [
            item.hypothesis_id
            for item in self.outcomes
            if item.hypothesis_disposition is HypothesisDisposition.SUPPORTED
        ]
        if len(supported) == 1 and self.supported_hypothesis_id != supported[0]:
            raise ValueError("Single supported outcome requires its aggregate ID")
        if len(supported) != 1 and self.supported_hypothesis_id is not None:
            raise ValueError("Aggregate hypothesis requires exactly one supported outcome")
        return self


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
    execution: ExecutionReport | None = None

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
        if self.execution is not None:
            if self.execution.investigation_id != self.investigation_id:
                raise ValueError("Execution report must belong to the investigation")
            if {item.experiment_id for item in self.execution.outcomes} != {
                item.experiment_id for item in self.experiments
            }:
                raise ValueError("Execution outcomes must cover every experiment")
        return self
