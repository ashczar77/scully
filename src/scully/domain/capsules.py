"""Version 1 capsule manifest contracts."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    JsonValue,
    StrictBool,
    StrictInt,
    StrictStr,
    model_validator,
)

from scully.domain.contracts import CapsuleSummary, EvidenceReference, RedactionStatus


CapsuleIdentifier = Annotated[
    StrictStr,
    Field(min_length=1, max_length=128, pattern=r"^[a-z0-9][a-z0-9._-]*$"),
]
BoundedText = Annotated[StrictStr, Field(min_length=1, max_length=2_000)]
MatcherPathPart = StrictStr | StrictInt


class CapsuleModel(BaseModel):
    """Strict immutable base for public capsule contracts."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class CapsuleEvidence(CapsuleModel):
    """One declared and sanitized evidence file."""

    evidence_id: CapsuleIdentifier
    path: Annotated[str, Field(min_length=1, max_length=512)]
    sha256: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
    byte_size: Annotated[StrictInt, Field(ge=0, le=524_288)]
    media_type: Annotated[str, Field(min_length=1, max_length=128)]
    provenance: Annotated[str, Field(min_length=1, max_length=256)]
    redaction_status: Literal["clean", "redacted"]

    def to_reference(self) -> EvidenceReference:
        """Return normalized evidence metadata without file content."""

        return EvidenceReference(
            evidence_id=self.evidence_id,
            relative_path=self.path,
            sha256=self.sha256,
            byte_size=self.byte_size,
            media_type=self.media_type,
            provenance=self.provenance,
            redaction_status=RedactionStatus(self.redaction_status),
        )


class EnvironmentFact(CapsuleModel):
    """Sanitized incident and comparison environment values."""

    name: CapsuleIdentifier
    incident_value: Annotated[str, Field(min_length=1, max_length=256)]
    known_good_value: Annotated[str, Field(min_length=1, max_length=256)] | None = None


class SignatureMatcher(CapsuleModel):
    """One deterministic matcher declared before execution."""

    matcher_id: CapsuleIdentifier
    kind: Literal["equals", "same_value"]
    path: Annotated[tuple[MatcherPathPart, ...], Field(min_length=1, max_length=16)]
    required: StrictBool = True
    expected: JsonValue = None
    comparison_path: (
        Annotated[tuple[MatcherPathPart, ...], Field(min_length=1, max_length=16)]
        | None
    ) = None

    @model_validator(mode="after")
    def validate_matcher(self) -> SignatureMatcher:
        """Enforce kind-specific fields and safe path indexes."""

        for path in (self.path, self.comparison_path or ()):
            for part in path:
                if isinstance(part, str) and not part:
                    raise ValueError("Matcher path keys cannot be empty")
                if isinstance(part, int) and (isinstance(part, bool) or part < 0):
                    raise ValueError("Matcher path indexes must be non-negative integers")
        if self.kind == "equals" and self.comparison_path is not None:
            raise ValueError("Equals matcher cannot define comparison_path")
        if self.kind == "equals" and "expected" not in self.model_fields_set:
            raise ValueError("Equals matcher requires expected")
        if self.kind == "same_value" and self.comparison_path is None:
            raise ValueError("Same-value matcher requires comparison_path")
        return self


class FailureSignatureDefinition(CapsuleModel):
    """Fixed signature used by deterministic evaluation."""

    signature_id: CapsuleIdentifier
    matchers: Annotated[tuple[SignatureMatcher, ...], Field(min_length=1, max_length=32)]

    @model_validator(mode="after")
    def validate_matchers(self) -> FailureSignatureDefinition:
        matcher_ids = [matcher.matcher_id for matcher in self.matchers]
        if len(matcher_ids) != len(set(matcher_ids)):
            raise ValueError("Matcher IDs must be unique")
        if not any(matcher.required for matcher in self.matchers):
            raise ValueError("At least one matcher must be required")
        return self


class KnownGoodDefinition(CapsuleModel):
    """Declared comparison observation for a future experiment."""

    description: Annotated[str, Field(min_length=1, max_length=1_000)]
    observation_evidence_id: CapsuleIdentifier
    expected_verdict: Literal["not_reproduced"]


class ExecutionRequirements(CapsuleModel):
    """Bounded environment facts without commands or credentials."""

    runtime: CapsuleIdentifier
    runtime_version: Annotated[str, Field(min_length=1, max_length=64)]
    network_access: Literal[False]
    max_duration_seconds: Annotated[StrictInt, Field(ge=1, le=300)]


class CapsuleManifest(CapsuleModel):
    """Canonical public manifest for capsule schema version 1.0."""

    schema_version: Literal["1.0"]
    capsule_id: CapsuleIdentifier
    title: Annotated[str, Field(min_length=1, max_length=160)]
    observed_summary: BoundedText
    failure_signature: FailureSignatureDefinition
    known_good: KnownGoodDefinition
    environment: Annotated[tuple[EnvironmentFact, ...], Field(min_length=1, max_length=32)]
    evidence: Annotated[tuple[CapsuleEvidence, ...], Field(min_length=1, max_length=31)]
    execution_requirements: ExecutionRequirements
    exclusions: Annotated[tuple[BoundedText, ...], Field(min_length=1, max_length=32)]

    @model_validator(mode="after")
    def validate_references(self) -> CapsuleManifest:
        evidence_ids = [item.evidence_id for item in self.evidence]
        evidence_paths = [item.path for item in self.evidence]
        if len(evidence_ids) != len(set(evidence_ids)):
            raise ValueError("Evidence IDs must be unique")
        if len(evidence_paths) != len(set(evidence_paths)):
            raise ValueError("Evidence paths must be unique")
        if self.known_good.observation_evidence_id not in evidence_ids:
            raise ValueError("Known-good observation must reference declared evidence")
        return self

    def to_summary(self) -> CapsuleSummary:
        """Return the bounded read model exposed by the API."""

        return CapsuleSummary(
            schema_version=self.schema_version,
            capsule_id=self.capsule_id,
            title=self.title,
            observed_summary=self.observed_summary,
            signature_id=self.failure_signature.signature_id,
            evidence=tuple(item.to_reference() for item in self.evidence),
        )
