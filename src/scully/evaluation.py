"""Deterministic failure-signature evaluation without model authority."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from math import isfinite
from typing import TypeAlias


JsonScalar: TypeAlias = str | int | float | bool | None
JsonValue: TypeAlias = JsonScalar | list["JsonValue"] | dict[str, "JsonValue"]
FieldPath: TypeAlias = tuple[str | int, ...]

EVALUATOR_VERSION = "1"


class ExecutionStatus(StrEnum):
    """Terminal execution states visible to the evaluator."""

    COMPLETED = "completed"
    FAILED = "failed"
    TIMED_OUT = "timed_out"
    CANCELLED = "cancelled"


class EvaluationVerdict(StrEnum):
    """Outcomes produced only by deterministic evaluation."""

    MATCHED = "matched"
    NOT_MATCHED = "not_matched"
    INCONCLUSIVE = "inconclusive"


class MatcherKind(StrEnum):
    """Supported deterministic comparison operations."""

    EQUALS = "equals"
    SAME_VALUE = "same_value"


@dataclass(frozen=True, slots=True)
class SignatureMatcher:
    """One required or informational matcher over a structured observation."""

    matcher_id: str
    kind: MatcherKind
    path: FieldPath
    required: bool = True
    expected: JsonValue = None
    comparison_path: FieldPath | None = None

    def __post_init__(self) -> None:
        if not self.matcher_id.strip():
            raise ValueError("Matcher ID cannot be empty")
        _validate_path(self.path)
        if self.kind is MatcherKind.EQUALS:
            if self.comparison_path is not None:
                raise ValueError("Equals matcher cannot define a comparison path")
            _normalize_json(self.expected)
        elif self.kind is MatcherKind.SAME_VALUE:
            if self.comparison_path is None:
                raise ValueError("Same-value matcher requires a comparison path")
            _validate_path(self.comparison_path)


@dataclass(frozen=True, slots=True)
class FailureSignature:
    """A versioned set of matchers fixed before execution begins."""

    signature_id: str
    matchers: tuple[SignatureMatcher, ...]

    def __post_init__(self) -> None:
        if not self.signature_id.strip():
            raise ValueError("Signature ID cannot be empty")
        if not self.matchers:
            raise ValueError("Signature must contain at least one matcher")
        matcher_ids = [matcher.matcher_id for matcher in self.matchers]
        if len(set(matcher_ids)) != len(matcher_ids):
            raise ValueError("Matcher IDs must be unique")
        if not any(matcher.required for matcher in self.matchers):
            raise ValueError("Signature must contain a required matcher")


@dataclass(frozen=True, slots=True)
class ExecutionResult:
    """Normalized terminal result supplied to the evaluator."""

    experiment_id: str
    checkpoint_id: str
    status: ExecutionStatus
    exit_code: int | None = None
    payload: Mapping[str, JsonValue] | None = None
    error_code: str | None = None

    def __post_init__(self) -> None:
        if not self.experiment_id.strip():
            raise ValueError("Experiment ID cannot be empty")
        if not self.checkpoint_id.strip():
            raise ValueError("Checkpoint ID cannot be empty")
        if self.status is ExecutionStatus.COMPLETED:
            if isinstance(self.exit_code, bool) or not isinstance(self.exit_code, int):
                raise ValueError("Completed execution requires an integer exit code")
            if self.payload is None:
                raise ValueError("Completed execution requires a payload")
            _normalize_json(dict(self.payload))
            if self.error_code is not None:
                raise ValueError("Completed execution cannot define an error code")
        else:
            if self.exit_code is not None:
                raise ValueError("Incomplete execution cannot define an exit code")
            if not self.error_code or not self.error_code.strip():
                raise ValueError("Incomplete execution requires an error code")
            if self.payload is not None:
                _normalize_json(dict(self.payload))


@dataclass(frozen=True, slots=True)
class MatcherResult:
    """Redacted result for one matcher."""

    matcher_id: str
    required: bool
    passed: bool
    reason: str


@dataclass(frozen=True, slots=True)
class EvaluationReport:
    """Versioned evaluator decision with a canonical input digest."""

    signature_id: str
    evaluator_version: str
    experiment_id: str
    verdict: EvaluationVerdict
    observation_digest: str
    matcher_results: tuple[MatcherResult, ...]


def evaluate_signature(
    signature: FailureSignature,
    execution: ExecutionResult,
) -> EvaluationReport:
    """Evaluate all required matchers with AND semantics."""

    digest = _observation_digest(execution)
    if execution.status is not ExecutionStatus.COMPLETED:
        return EvaluationReport(
            signature_id=signature.signature_id,
            evaluator_version=EVALUATOR_VERSION,
            experiment_id=execution.experiment_id,
            verdict=EvaluationVerdict.INCONCLUSIVE,
            observation_digest=digest,
            matcher_results=(),
        )

    root: JsonValue = {
        "exit_code": execution.exit_code,
        "payload": dict(execution.payload or {}),
    }
    results = tuple(_evaluate_matcher(matcher, root) for matcher in signature.matchers)
    required_passed = all(result.passed for result in results if result.required)
    return EvaluationReport(
        signature_id=signature.signature_id,
        evaluator_version=EVALUATOR_VERSION,
        experiment_id=execution.experiment_id,
        verdict=(
            EvaluationVerdict.MATCHED
            if required_passed
            else EvaluationVerdict.NOT_MATCHED
        ),
        observation_digest=digest,
        matcher_results=results,
    )


def _evaluate_matcher(matcher: SignatureMatcher, root: JsonValue) -> MatcherResult:
    found, actual = _resolve_path(root, matcher.path)
    if not found:
        return MatcherResult(
            matcher_id=matcher.matcher_id,
            required=matcher.required,
            passed=False,
            reason="path_missing",
        )
    if matcher.kind is MatcherKind.EQUALS:
        expected = _normalize_json(matcher.expected)
        passed = _canonical_json(actual) == _canonical_json(expected)
        reason = "equal" if passed else "not_equal"
    else:
        comparison_found, comparison = _resolve_path(
            root,
            matcher.comparison_path or (),
        )
        if not comparison_found:
            return MatcherResult(
                matcher_id=matcher.matcher_id,
                required=matcher.required,
                passed=False,
                reason="comparison_path_missing",
            )
        passed = _canonical_json(actual) == _canonical_json(comparison)
        reason = "same_value" if passed else "different_value"
    return MatcherResult(
        matcher_id=matcher.matcher_id,
        required=matcher.required,
        passed=passed,
        reason=reason,
    )


def _resolve_path(root: JsonValue, path: FieldPath) -> tuple[bool, JsonValue]:
    current: object = root
    for part in path:
        if isinstance(part, str):
            if not isinstance(current, Mapping) or part not in current:
                return False, None
            current = current[part]
        else:
            if (
                not isinstance(current, Sequence)
                or isinstance(current, (str, bytes, bytearray))
                or part >= len(current)
            ):
                return False, None
            current = current[part]
    return True, _normalize_json(current)


def _validate_path(path: FieldPath) -> None:
    if not path:
        raise ValueError("Matcher path cannot be empty")
    for part in path:
        if isinstance(part, bool) or not isinstance(part, (str, int)):
            raise ValueError("Matcher path parts must be strings or integers")
        if isinstance(part, str) and not part:
            raise ValueError("Matcher path keys cannot be empty")
        if isinstance(part, int) and part < 0:
            raise ValueError("Matcher path indexes cannot be negative")


def _observation_digest(execution: ExecutionResult) -> str:
    normalized = {
        "checkpoint_id": execution.checkpoint_id,
        "error_code": execution.error_code,
        "exit_code": execution.exit_code,
        "experiment_id": execution.experiment_id,
        "payload": dict(execution.payload) if execution.payload is not None else None,
        "status": execution.status.value,
    }
    return hashlib.sha256(_canonical_json(normalized).encode("utf-8")).hexdigest()


def _canonical_json(value: object) -> str:
    return json.dumps(
        _normalize_json(value),
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    )


def _normalize_json(value: object) -> JsonValue:
    if value is None or isinstance(value, (str, bool)):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if not isfinite(value):
            raise ValueError("JSON numbers must be finite")
        return value
    if isinstance(value, Mapping):
        normalized: dict[str, JsonValue] = {}
        for key, item in value.items():
            if not isinstance(key, str):
                raise ValueError("JSON object keys must be strings")
            normalized[key] = _normalize_json(item)
        return normalized
    if isinstance(value, Sequence) and not isinstance(
        value, (str, bytes, bytearray)
    ):
        return [_normalize_json(item) for item in value]
    raise ValueError("Observation values must be JSON-compatible")
