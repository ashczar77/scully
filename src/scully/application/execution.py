"""Deterministic local branch execution and signature evaluation."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
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
from scully.measurement import Measurement
from scully.providers.sandbox import SandboxCommand, SandboxOutcome


BASELINE_MARKER = "checkpoint-baseline"
CLIENT_IDENTITIES = {
    "198.51.100.10": "identity:test-net-client-a",
    "198.51.100.11": "identity:test-net-client-b",
}
ProgressPayload = dict[str, str | int | float | bool | None]
ProgressCallback = Callable[[str, ProgressPayload], None]
MAX_LOCAL_OUTPUT_BYTES = 20_000
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
        self.code = (
            code
            if re.fullmatch(r"[a-z][a-z0-9_]{0,95}", code)
            else "execution_failed"
        )
        self.message = message
        self.status_code = status_code


class ExecutionAdapter(Protocol):
    """Application-owned boundary for planned branch execution."""

    def execute(
        self,
        investigation_id: str,
        capsule: CapsuleManifest,
        plans: tuple[ExperimentPlan, ...],
        *,
        progress: ProgressCallback | None = None,
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


class LocalBranchRunner(Protocol):
    """Application-owned boundary for the reviewed local HTTP fixture."""

    def run(
        self,
        *,
        variant: str,
        clients: tuple[str, ...],
        timeout_seconds: int,
    ) -> Mapping[str, object]:
        """Run one fixed branch and return its observed payload."""


class NodeProxyFixtureRunner:
    """Run the reviewed Express and loopback-proxy fixture without a shell."""

    def __init__(self, fixture_dir: Path, *, node_executable: str | None = None) -> None:
        self.fixture_dir = fixture_dir.resolve()
        self.node_executable = node_executable

    def run(
        self,
        *,
        variant: str,
        clients: tuple[str, ...],
        timeout_seconds: int,
    ) -> Mapping[str, object]:
        if variant not in EXPERIMENT_VARIANTS:
            raise ExecutionError(
                "local_variant_invalid",
                "Local branch variant is outside the reviewed allowlist",
            )
        if clients != tuple(CLIENT_IDENTITIES):
            raise ExecutionError(
                "local_clients_invalid",
                "Local branch clients are outside the reviewed fixture",
            )
        if self.fixture_dir.is_symlink() or not self.fixture_dir.is_dir():
            raise ExecutionError(
                "local_fixture_unavailable",
                "Reviewed local execution fixture is unavailable",
                status_code=503,
            )
        script = self.fixture_dir / "scripts" / "run-branch.mjs"
        package = self.fixture_dir / "package.json"
        if (
            script.is_symlink()
            or package.is_symlink()
            or not script.is_file()
            or not package.is_file()
        ):
            raise ExecutionError(
                "local_fixture_unavailable",
                "Reviewed local execution fixture is incomplete",
                status_code=503,
            )
        node = self.node_executable or shutil.which("node")
        if not node:
            raise ExecutionError(
                "local_runtime_unavailable",
                "Node.js is required for the reviewed local fixture",
                status_code=503,
            )
        try:
            process = subprocess.run(
                (node, str(script), variant),
                cwd=self.fixture_dir,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="strict",
                timeout=timeout_seconds,
                check=False,
                env={
                    "LANG": "C",
                    "LC_ALL": "C",
                    "PATH": os.environ.get("PATH", ""),
                },
            )
        except subprocess.TimeoutExpired as error:
            raise ExecutionError(
                "local_fixture_timeout",
                "Reviewed local fixture exceeded its branch timeout",
                status_code=504,
            ) from error
        except (OSError, UnicodeError) as error:
            raise ExecutionError(
                "local_fixture_failed",
                "Reviewed local fixture could not be executed",
                status_code=503,
            ) from error
        if process.returncode != 0:
            raise ExecutionError(
                "local_fixture_failed",
                "Reviewed local fixture returned a non-zero exit status",
                status_code=502,
            )
        if (
            len(process.stdout.encode("utf-8")) > MAX_LOCAL_OUTPUT_BYTES
            or len(process.stderr.encode("utf-8")) > MAX_LOCAL_OUTPUT_BYTES
        ):
            raise ExecutionError(
                "local_output_invalid",
                "Reviewed local fixture output exceeds the product limit",
                status_code=502,
            )
        return _parse_local_observation(process.stdout, clients)


class LocalExecutionAdapter:
    """Run the reviewed proxy incident on loopback without a shell."""

    def __init__(
        self,
        artifact_dir: Path,
        *,
        fixture_dir: Path | None = None,
        runner: LocalBranchRunner | None = None,
        timer: Callable[[], float] | None = None,
    ) -> None:
        self.artifact_dir = artifact_dir
        default_fixture = (
            Path(__file__).resolve().parents[3]
            / "fixtures"
            / "reproductions"
            / "proxy-identity-collapse"
        )
        self.runner = runner or NodeProxyFixtureRunner(fixture_dir or default_fixture)
        self.timer = timer or monotonic

    def execute(
        self,
        investigation_id: str,
        capsule: CapsuleManifest,
        plans: tuple[ExperimentPlan, ...],
        *,
        progress: ProgressCallback | None = None,
    ) -> ExecutionReport:
        """Execute three isolated variants from one immutable checkpoint."""

        _validate_plans(plans)
        environment = _load_json_evidence(capsule, "environment", self.artifact_dir)
        requests = _load_json_evidence(capsule, "requests", self.artifact_dir)
        checkpoint = _build_checkpoint(environment, requests)
        signature = _failure_signature(capsule)
        _emit(progress, "execution.started", {"source": "local"})
        _emit(
            progress,
            "checkpoint.created",
            {"checkpoint_id": plans[0].checkpoint_id},
        )
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
                timed_out = _timeout_outcome(plan, signature, 0.0)
                outcomes.append(timed_out)
                _emit_branch_result(progress, plan, timed_out)
                continue

            _emit(
                progress,
                "experiment.started",
                {
                    "experiment_id": plan.experiment_id,
                    "hypothesis_id": plan.hypothesis_id,
                },
            )
            branch = deepcopy(checkpoint)
            markers = branch["markers"]
            if not isinstance(markers, set):
                raise ExecutionError(
                    "checkpoint_invalid",
                    "Local checkpoint marker state is invalid",
                    status_code=500,
                )
            markers.add(plan.variant)
            _emit(
                progress,
                "experiment.operation",
                {
                    "experiment_id": plan.experiment_id,
                    "operation": "apply_allowlisted_variant",
                    "variant": plan.variant,
                },
            )
            _apply_variant(branch, plan)
            clients = branch.get("clients")
            if not isinstance(clients, list) or not all(
                isinstance(client, str) for client in clients
            ):
                raise ExecutionError(
                    "checkpoint_invalid",
                    "Local branch clients are invalid",
                    status_code=500,
                )
            observation = self.runner.run(
                variant=plan.variant,
                clients=tuple(clients),
                timeout_seconds=plan.timeout_seconds,
            )
            operation_count += 1
            branch_ended = self.timer()
            duration_ms = max(0.0, (branch_ended - branch_started) * 1_000)
            if branch_ended > deadline or duration_ms > plan.timeout_seconds * 1_000:
                deadline_reached = True
                timed_out = _timeout_outcome(plan, signature, duration_ms)
                outcomes.append(timed_out)
                _emit_branch_result(progress, plan, timed_out)
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
            completed = _completed_outcome(plan, evaluation, duration_ms)
            outcomes.append(completed)
            _emit_branch_result(progress, plan, completed)
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
        report = ExecutionReport(
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
        _emit(progress, "isolation.verified", {"passed": isolation_verified})
        _emit(
            progress,
            "investigation.completed"
            if report.status is InvestigationStatus.COMPLETED
            else "investigation.timed_out",
            {
                "status": report.status.value,
                "operation_count": report.operation_count,
                "retry_count": report.retry_count,
            },
        )
        return report


class SandboxExecutionAdapter:
    """Optional live wrapper using only fixed application-owned commands."""

    def __init__(self, runner: SandboxBranchRunner) -> None:
        self.runner = runner
        self.last_measurement: Measurement | None = None

    def execute(
        self,
        investigation_id: str,
        capsule: CapsuleManifest,
        plans: tuple[ExperimentPlan, ...],
        *,
        progress: ProgressCallback | None = None,
    ) -> ExecutionReport:
        """Map the fixed Sandbox branch lifecycle into the product contract."""

        _validate_plans(plans)
        signature = _failure_signature(capsule)
        _emit(progress, "execution.started", {"source": "sandbox"})
        _emit(
            progress,
            "checkpoint.created",
            {"checkpoint_id": plans[0].checkpoint_id},
        )
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
        self.last_measurement = outcome.measurement
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
            _emit(
                progress,
                "experiment.started",
                {
                    "experiment_id": plan.experiment_id,
                    "hypothesis_id": plan.hypothesis_id,
                },
            )
            _emit(
                progress,
                "experiment.operation",
                {
                    "experiment_id": plan.experiment_id,
                    "operation": "apply_allowlisted_variant",
                    "variant": plan.variant,
                },
            )
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
                failed_outcome = _inconclusive_outcome(
                    plan,
                    evaluation,
                    ExperimentStatus.FAILED,
                    branch.elapsed_seconds * 1_000,
                )
                results.append(failed_outcome)
                _emit_branch_result(progress, plan, failed_outcome)
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
            completed_outcome = _completed_outcome(
                plan,
                evaluation,
                branch.elapsed_seconds * 1_000,
            )
            results.append(completed_outcome)
            _emit_branch_result(progress, plan, completed_outcome)
        supported = [
            item.hypothesis_id
            for item in results
            if item.hypothesis_disposition is HypothesisDisposition.SUPPORTED
        ]
        failed = any(item.status is ExperimentStatus.FAILED for item in results)
        report = ExecutionReport(
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
        _emit(progress, "isolation.verified", {"passed": isolation_verified})
        _emit(
            progress,
            "investigation.failed" if failed else "investigation.completed",
            {
                "status": report.status.value,
                "operation_count": report.operation_count,
                "retry_count": report.retry_count,
            },
        )
        return report


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


def _parse_local_observation(
    value: str,
    clients: tuple[str, ...],
) -> Mapping[str, object]:
    try:
        parsed = json.loads(value, parse_constant=_reject_json_constant)
    except (json.JSONDecodeError, ValueError) as error:
        raise ExecutionError(
            "local_output_invalid",
            "Reviewed local fixture did not return valid JSON",
            status_code=502,
        ) from error
    if not isinstance(parsed, dict) or parsed.get("exit_code") != 0:
        raise ExecutionError(
            "local_output_invalid",
            "Reviewed local fixture returned an invalid result envelope",
            status_code=502,
        )
    payload = parsed.get("payload")
    if not isinstance(payload, dict):
        raise ExecutionError(
            "local_output_invalid",
            "Reviewed local fixture result is missing its payload",
            status_code=502,
        )
    required_lists = (
        "responses",
        "events",
        "identity_digests",
        "forwarded_clients",
        "normalized_ips",
        "socket_addresses",
        "limiter_bucket_counts",
    )
    if any(
        not isinstance(payload.get(name), list) or len(payload[name]) != len(clients)
        for name in required_lists
    ):
        raise ExecutionError(
            "local_output_invalid",
            "Reviewed local fixture observation has an invalid shape",
            status_code=502,
        )
    if payload.get("forwarded_clients") != list(clients) or payload.get("proxy_hops") != 1:
        raise ExecutionError(
            "local_output_invalid",
            "Reviewed local fixture observation left the declared topology",
            status_code=502,
        )
    return payload


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


def _emit(
    progress: ProgressCallback | None,
    event_type: str,
    payload: ProgressPayload,
) -> None:
    if progress is not None:
        progress(event_type, payload)


def _emit_branch_result(
    progress: ProgressCallback | None,
    plan: ExperimentPlan,
    outcome: ExperimentOutcome,
) -> None:
    _emit(
        progress,
        "experiment.result",
        {
            "experiment_id": plan.experiment_id,
            "status": outcome.status.value,
            "verdict": outcome.verdict.value,
        },
    )
    _emit(
        progress,
        "evaluation.completed",
        {
            "experiment_id": plan.experiment_id,
            "hypothesis_disposition": outcome.hypothesis_disposition.value,
        },
    )
