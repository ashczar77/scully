"""Deterministic local branch execution and signature evaluation."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Mapping, Sequence
from copy import deepcopy
from pathlib import Path
from time import monotonic
from typing import Protocol

from scully.application.planning import EXPERIMENT_VARIANTS
from scully.domain.capsules import CapsuleManifest
from scully.domain.contracts import (
    ExecutionReport,
    ExperimentOutcome,
    ExperimentPlan,
    ExperimentStatus,
    HypothesisDisposition,
    InvestigationStatus,
    ReproductionVerdict,
    SignatureMatchResult,
)
from scully.evaluation import (
    EVALUATOR_VERSION,
    EvaluationReport,
    EvaluationVerdict,
    ExecutionResult,
    ExecutionStatus,
    FailureSignature,
    MatcherKind,
    SignatureMatcher,
    evaluate_signature,
)
from scully.experiments import (
    BranchSnapshot,
    ExecutionIntegrityPlan,
    ExperimentPlan as IsolationExperimentPlan,
    verify_sibling_isolation,
)
from scully.providers.sandbox import SandboxCommand, SandboxOutcome


BASELINE_MARKER = "checkpoint-baseline"
LOOPBACK_IDENTITY = "identity:loopback-proxy"
CLIENT_IDENTITIES = {
    "198.51.100.10": "identity:test-net-client-a",
    "198.51.100.11": "identity:test-net-client-b",
}
SANDBOX_BASE_IMAGE = "python:3.12-slim"
SANDBOX_EXECUTABLE = "/usr/local/bin/python"
SANDBOX_SCRIPT = """import json
import sys

variant = sys.argv[1]
clients = ["198.51.100.10", "198.51.100.11"]
if variant == "trust-loopback":
    identities = ["identity:test-net-client-a", "identity:test-net-client-b"]
    responses = [200, 200]
    events = ["request_accepted", "request_accepted"]
else:
    identities = ["identity:loopback-proxy", "identity:loopback-proxy"]
    responses = [200, 429]
    events = ["request_accepted", "rate_limit_rejected"]
print(json.dumps({
    "responses": responses,
    "events": events,
    "identity_digests": identities,
    "forwarded_clients": clients,
}, sort_keys=True))
"""


class ExecutionError(ValueError):
    """Bounded local execution failure safe for an API response."""

    def __init__(self, code: str, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


class ExecutionAdapter(Protocol):
    """Application-owned boundary for planned branch execution."""

    def execute(
        self,
        investigation_id: str,
        capsule: CapsuleManifest,
        plans: tuple[ExperimentPlan, ...],
    ) -> ExecutionReport:
        """Run all allowed plans and return deterministic evaluation results."""


class SandboxBranchRunner(Protocol):
    """Existing bounded provider adapter used by the optional product wrapper."""

    def run_branches(
        self,
        *,
        investigation_id: str,
        base_image: str,
        prepare: SandboxCommand,
        branches: Sequence[SandboxCommand],
    ) -> SandboxOutcome:
        """Run fixed child commands from one provider checkpoint."""


class LocalExecutionAdapter:
    """Run the proxy incident simulation without a shell or network access."""

    def __init__(
        self,
        artifact_dir: Path,
        *,
        timer: Callable[[], float] | None = None,
    ) -> None:
        self.artifact_dir = artifact_dir
        self.timer = timer or monotonic

    def execute(
        self,
        investigation_id: str,
        capsule: CapsuleManifest,
        plans: tuple[ExperimentPlan, ...],
    ) -> ExecutionReport:
        """Execute three isolated variants from one immutable checkpoint."""

        _validate_plans(plans)
        environment = _load_json_evidence(capsule, "environment", self.artifact_dir)
        requests = _load_json_evidence(capsule, "requests", self.artifact_dir)
        checkpoint = _build_checkpoint(environment, requests)
        signature = _failure_signature(capsule)
        global_started = self.timer()
        deadline = global_started + min(plan.timeout_seconds for plan in plans)
        outcomes: list[ExperimentOutcome] = []
        snapshots: list[BranchSnapshot] = []
        operation_count = 0
        deadline_reached = False

        for plan in plans:
            branch_started = self.timer()
            if branch_started >= deadline:
                deadline_reached = True
                outcomes.append(_timeout_outcome(plan, signature, 0.0))
                continue

            branch = deepcopy(checkpoint)
            markers = branch["markers"]
            if not isinstance(markers, set):
                raise ExecutionError(
                    "checkpoint_invalid",
                    "Local checkpoint marker state is invalid",
                    status_code=500,
                )
            markers.add(plan.variant)
            _apply_variant(branch, plan)
            observation = _simulate_proxy_incident(branch)
            operation_count += 1
            branch_ended = self.timer()
            duration_ms = max(0.0, (branch_ended - branch_started) * 1_000)
            if branch_ended > deadline or duration_ms > plan.timeout_seconds * 1_000:
                deadline_reached = True
                outcomes.append(_timeout_outcome(plan, signature, duration_ms))
                continue

            evaluation = evaluate_signature(
                signature,
                ExecutionResult(
                    experiment_id=plan.experiment_id,
                    checkpoint_id=plan.checkpoint_id,
                    status=ExecutionStatus.COMPLETED,
                    exit_code=0,
                    payload=observation,
                ),
            )
            outcomes.append(_completed_outcome(plan, evaluation, duration_ms))
            snapshots.append(
                BranchSnapshot(
                    experiment_id=plan.experiment_id,
                    checkpoint_id=plan.checkpoint_id,
                    visible_markers=frozenset(markers),
                )
            )

        isolation_verified = False
        if len(snapshots) == len(plans):
            isolation_verified = verify_sibling_isolation(
                _isolation_plan(plans),
                tuple(snapshots),
            ).passed
        supported = [
            item.hypothesis_id
            for item in outcomes
            if item.hypothesis_disposition is HypothesisDisposition.SUPPORTED
        ]
        limitations = []
        if deadline_reached:
            limitations.append(
                "Local execution deadline reached; no retry or new branch was started"
            )
        if len(supported) != 1:
            limitations.append("Execution did not support exactly one causal alternative")
        return ExecutionReport(
            investigation_id=investigation_id,
            checkpoint_id=plans[0].checkpoint_id,
            status=(
                InvestigationStatus.TIMED_OUT
                if deadline_reached
                else InvestigationStatus.COMPLETED
            ),
            signature_id=signature.signature_id,
            evaluator_version=EVALUATOR_VERSION,
            execution_source="local",
            isolation_verified=isolation_verified,
            operation_count=operation_count,
            retry_count=0,
            supported_hypothesis_id=supported[0] if len(supported) == 1 else None,
            outcomes=tuple(outcomes),
            limitations=tuple(limitations),
        )


class SandboxExecutionAdapter:
    """Optional live wrapper using only fixed application-owned commands."""

    def __init__(self, runner: SandboxBranchRunner) -> None:
        self.runner = runner

    def execute(
        self,
        investigation_id: str,
        capsule: CapsuleManifest,
        plans: tuple[ExperimentPlan, ...],
    ) -> ExecutionReport:
        """Map the fixed Sandbox branch lifecycle into the product contract."""

        _validate_plans(plans)
        signature = _failure_signature(capsule)
        outcome = self.runner.run_branches(
            investigation_id=investigation_id,
            base_image=SANDBOX_BASE_IMAGE,
            prepare=SandboxCommand(
                label="prepare-checkpoint",
                executable="/bin/true",
            ),
            branches=tuple(
                SandboxCommand(
                    label=plan.variant,
                    executable=SANDBOX_EXECUTABLE,
                    args=("-c", SANDBOX_SCRIPT, plan.variant),
                )
                for plan in plans
            ),
        )
        if [branch.label for branch in outcome.branches] != [
            plan.variant for plan in plans
        ]:
            raise ExecutionError(
                "sandbox_branch_mismatch",
                "Sandbox returned branches outside the requested order",
                status_code=502,
            )
        image_ids = [branch.image_id for branch in outcome.branches]
        isolation_verified = (
            len(set(image_ids)) == len(plans)
            and outcome.parent_image_id not in set(image_ids)
        )
        results = []
        for plan, branch in zip(plans, outcome.branches, strict=True):
            if branch.exit_code != 0:
                evaluation = evaluate_signature(
                    signature,
                    ExecutionResult(
                        experiment_id=plan.experiment_id,
                        checkpoint_id=plan.checkpoint_id,
                        status=ExecutionStatus.FAILED,
                        error_code="sandbox_branch_failed",
                    ),
                )
                results.append(
                    _inconclusive_outcome(
                        plan,
                        evaluation,
                        ExperimentStatus.FAILED,
                        branch.elapsed_seconds * 1_000,
                    )
                )
                continue
            observation = _parse_sandbox_observation(branch.stdout)
            evaluation = evaluate_signature(
                signature,
                ExecutionResult(
                    experiment_id=plan.experiment_id,
                    checkpoint_id=plan.checkpoint_id,
                    status=ExecutionStatus.COMPLETED,
                    exit_code=branch.exit_code,
                    payload=observation,
                ),
            )
            results.append(
                _completed_outcome(
                    plan,
                    evaluation,
                    branch.elapsed_seconds * 1_000,
                )
            )
        supported = [
            item.hypothesis_id
            for item in results
            if item.hypothesis_disposition is HypothesisDisposition.SUPPORTED
        ]
        failed = any(item.status is ExperimentStatus.FAILED for item in results)
        return ExecutionReport(
            investigation_id=investigation_id,
            checkpoint_id=plans[0].checkpoint_id,
            status=(
                InvestigationStatus.FAILED if failed else InvestigationStatus.COMPLETED
            ),
            signature_id=signature.signature_id,
            evaluator_version=EVALUATOR_VERSION,
            execution_source="sandbox",
            isolation_verified=isolation_verified,
            operation_count=outcome.measurement.sandbox_operations,
            retry_count=0,
            supported_hypothesis_id=supported[0] if len(supported) == 1 else None,
            outcomes=tuple(results),
            limitations=("Explicit remote cancellation remains unproven",),
        )


def _validate_plans(plans: tuple[ExperimentPlan, ...]) -> None:
    if len(plans) != 3:
        raise ExecutionError("experiment_count_invalid", "Exactly three branches are required")
    if len({plan.experiment_id for plan in plans}) != len(plans):
        raise ExecutionError("experiment_duplicate", "Experiment IDs must be unique")
    if len({plan.checkpoint_id for plan in plans}) != 1:
        raise ExecutionError("checkpoint_invalid", "Branches must share one checkpoint")
    for plan in plans:
        expected = EXPERIMENT_VARIANTS.get(plan.variant)
        if (
            expected is None
            or plan.adapter != "local_fixture"
            or dict(plan.parameters) != dict(expected)
            or plan.operation_limit > 4
            or plan.timeout_seconds > 60
        ):
            raise ExecutionError(
                "experiment_plan_invalid",
                "Experiment plan is outside the local execution allowlist",
            )


def _load_json_evidence(
    capsule: CapsuleManifest,
    evidence_id: str,
    artifact_dir: Path,
) -> Mapping[str, object]:
    evidence = next(
        (item for item in capsule.evidence if item.evidence_id == evidence_id),
        None,
    )
    if evidence is None:
        raise ExecutionError("evidence_missing", "Required execution evidence is missing")
    path = artifact_dir / evidence.sha256[:2] / evidence.sha256
    try:
        content = path.read_bytes()
    except OSError as error:
        raise ExecutionError(
            "evidence_unavailable",
            "Required execution evidence is unavailable",
            status_code=409,
        ) from error
    if (
        len(content) != evidence.byte_size
        or hashlib.sha256(content).hexdigest() != evidence.sha256
    ):
        raise ExecutionError(
            "evidence_integrity_failed",
            "Stored execution evidence failed its integrity check",
            status_code=409,
        )
    try:
        value = json.loads(content, parse_constant=_reject_json_constant)
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
        raise ExecutionError(
            "evidence_invalid",
            "Stored execution evidence is not valid JSON",
            status_code=409,
        ) from error
    if not isinstance(value, dict):
        raise ExecutionError(
            "evidence_invalid",
            "Stored execution evidence must contain a JSON object",
            status_code=409,
        )
    return value


def _build_checkpoint(
    environment: Mapping[str, object],
    requests: Mapping[str, object],
) -> dict[str, object]:
    trust_proxy = environment.get("trust_proxy")
    request_values = requests.get("requests")
    if trust_proxy is not False or not isinstance(request_values, list):
        raise ExecutionError("evidence_invalid", "Execution evidence shape is invalid")
    clients = []
    for request in request_values:
        if not isinstance(request, dict) or not isinstance(request.get("client"), str):
            raise ExecutionError("evidence_invalid", "Request evidence shape is invalid")
        clients.append(request["client"])
    if len(clients) != 2 or any(client not in CLIENT_IDENTITIES for client in clients):
        raise ExecutionError("evidence_invalid", "Request evidence is outside the fixture")
    return {
        "environment": {"trust_proxy": False, "limiter_key": "identity"},
        "clients": clients,
        "markers": {BASELINE_MARKER},
    }


def _apply_variant(branch: dict[str, object], plan: ExperimentPlan) -> None:
    environment = branch.get("environment")
    if not isinstance(environment, dict):
        raise ExecutionError("checkpoint_invalid", "Local checkpoint is invalid")
    for name, value in plan.parameters.items():
        environment[name] = value


def _simulate_proxy_incident(branch: Mapping[str, object]) -> dict[str, object]:
    environment = branch.get("environment")
    clients = branch.get("clients")
    if not isinstance(environment, dict) or not isinstance(clients, list):
        raise ExecutionError("checkpoint_invalid", "Local branch is invalid")
    trust_proxy = environment.get("trust_proxy") == "loopback"
    resolved = list(clients) if trust_proxy else ["loopback", "loopback"]
    identities = [
        CLIENT_IDENTITIES.get(value, LOOPBACK_IDENTITY) for value in resolved
    ]
    seen: set[str] = set()
    responses = []
    events = []
    for identity in identities:
        if identity in seen:
            responses.append(429)
            events.append("rate_limit_rejected")
        else:
            seen.add(identity)
            responses.append(200)
            events.append("request_accepted")
    return {
        "responses": responses,
        "events": events,
        "identity_digests": identities,
        "forwarded_clients": list(clients),
    }


def _failure_signature(capsule: CapsuleManifest) -> FailureSignature:
    return FailureSignature(
        signature_id=capsule.failure_signature.signature_id,
        matchers=tuple(
            SignatureMatcher(
                matcher_id=item.matcher_id,
                kind=MatcherKind(item.kind),
                path=tuple(item.path),
                required=item.required,
                expected=item.expected,
                comparison_path=(
                    tuple(item.comparison_path)
                    if item.comparison_path is not None
                    else None
                ),
            )
            for item in capsule.failure_signature.matchers
        ),
    )


def _completed_outcome(
    plan: ExperimentPlan,
    evaluation: EvaluationReport,
    duration_ms: float,
) -> ExperimentOutcome:
    if evaluation.verdict is EvaluationVerdict.MATCHED:
        status = ExperimentStatus.REPRODUCED
        verdict = ReproductionVerdict.REPRODUCED
        disposition = HypothesisDisposition.ELIMINATED
        elimination_reasons = ("failure_signature_still_reproduced",)
    elif evaluation.verdict is EvaluationVerdict.NOT_MATCHED:
        status = ExperimentStatus.ELIMINATED
        verdict = ReproductionVerdict.NOT_REPRODUCED
        disposition = HypothesisDisposition.SUPPORTED
        elimination_reasons = ()
    else:
        status = ExperimentStatus.INCONCLUSIVE
        verdict = ReproductionVerdict.INCONCLUSIVE
        disposition = HypothesisDisposition.INCONCLUSIVE
        elimination_reasons = ()
    return ExperimentOutcome(
        experiment_id=plan.experiment_id,
        hypothesis_id=plan.hypothesis_id,
        status=status,
        verdict=verdict,
        hypothesis_disposition=disposition,
        observation_digest=evaluation.observation_digest,
        matcher_results=tuple(
            SignatureMatchResult(
                matcher_id=item.matcher_id,
                required=item.required,
                passed=item.passed,
                reason=item.reason,
            )
            for item in evaluation.matcher_results
        ),
        elimination_reasons=elimination_reasons,
        duration_ms=duration_ms,
    )


def _timeout_outcome(
    plan: ExperimentPlan,
    signature: FailureSignature,
    duration_ms: float,
) -> ExperimentOutcome:
    evaluation = evaluate_signature(
        signature,
        ExecutionResult(
            experiment_id=plan.experiment_id,
            checkpoint_id=plan.checkpoint_id,
            status=ExecutionStatus.TIMED_OUT,
            error_code="local_deadline_reached",
        ),
    )
    return ExperimentOutcome(
        experiment_id=plan.experiment_id,
        hypothesis_id=plan.hypothesis_id,
        status=ExperimentStatus.TIMED_OUT,
        verdict=ReproductionVerdict.INCONCLUSIVE,
        hypothesis_disposition=HypothesisDisposition.INCONCLUSIVE,
        observation_digest=evaluation.observation_digest,
        duration_ms=duration_ms,
    )


def _inconclusive_outcome(
    plan: ExperimentPlan,
    evaluation: EvaluationReport,
    status: ExperimentStatus,
    duration_ms: float,
) -> ExperimentOutcome:
    return ExperimentOutcome(
        experiment_id=plan.experiment_id,
        hypothesis_id=plan.hypothesis_id,
        status=status,
        verdict=ReproductionVerdict.INCONCLUSIVE,
        hypothesis_disposition=HypothesisDisposition.INCONCLUSIVE,
        observation_digest=evaluation.observation_digest,
        duration_ms=duration_ms,
    )


def _parse_sandbox_observation(value: str) -> Mapping[str, object]:
    if len(value) > 20_000:
        raise ExecutionError(
            "sandbox_output_invalid",
            "Sandbox observation exceeds the product size limit",
            status_code=502,
        )
    try:
        parsed = json.loads(value, parse_constant=_reject_json_constant)
    except (json.JSONDecodeError, ValueError) as error:
        raise ExecutionError(
            "sandbox_output_invalid",
            "Sandbox observation is not valid JSON",
            status_code=502,
        ) from error
    if not isinstance(parsed, dict):
        raise ExecutionError(
            "sandbox_output_invalid",
            "Sandbox observation must contain a JSON object",
            status_code=502,
        )
    return parsed


def _isolation_plan(plans: Sequence[ExperimentPlan]) -> ExecutionIntegrityPlan:
    return ExecutionIntegrityPlan(
        checkpoint_id=plans[0].checkpoint_id,
        baseline_marker=BASELINE_MARKER,
        experiments=tuple(
            IsolationExperimentPlan(
                experiment_id=plan.experiment_id,
                checkpoint_id=plan.checkpoint_id,
                mutation_marker=plan.variant,
            )
            for plan in plans
        ),
    )


def _reject_json_constant(value: str) -> None:
    raise ValueError(f"Unsupported JSON constant: {value}")
