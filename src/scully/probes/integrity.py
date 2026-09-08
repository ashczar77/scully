"""One bounded Sandbox execution-integrity probe."""

from __future__ import annotations

import json
from collections.abc import Callable
from datetime import UTC, datetime

from scully.config import ConfigurationError, Provider, Settings
from scully.evaluation import (
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
    ExperimentPlan,
    verify_sibling_isolation,
)
from scully.measurement import Measurement, OperationStatus
from scully.preflight import build_preflight_report
from scully.providers import ProviderContractError
from scully.providers.clients import create_sandbox_client
from scully.providers.sandbox import SandboxAdapter, SandboxCommand, SandboxOutcome
from scully.probes.sandbox import (
    SandboxClient,
    SandboxExecutionTracker,
    TrackingSandboxClient,
)


PROBE_ID = "g1.3-execution-integrity-001"
PROBE_IMAGE = "python:3.12-slim"
CHECKPOINT_ID = "g1.3-common-parent-001"
BASELINE_MARKER = "baseline"
BRANCH_A_MARKER = "branch-a"
BRANCH_B_MARKER = "branch-b"
PARENT_OUTPUT = "parent-ready\n"

INCIDENT_PAYLOAD = {
    "identities": ["same-digest", "same-digest"],
    "records": [
        {
            "event": "request_allowed",
            "forwardedClient": "198.51.100.10",
        },
        {
            "event": "rate_limit_rejected",
            "forwardedClient": "198.51.100.11",
        },
    ],
    "statuses": [200, 429],
    "visible_markers": [BASELINE_MARKER, BRANCH_A_MARKER],
}
KNOWN_GOOD_PAYLOAD = {
    "identities": ["first-digest", "second-digest"],
    "records": [
        {
            "event": "request_allowed",
            "forwardedClient": "198.51.100.10",
        },
        {
            "event": "request_allowed",
            "forwardedClient": "198.51.100.11",
        },
    ],
    "statuses": [200, 200],
    "visible_markers": [BASELINE_MARKER, BRANCH_B_MARKER],
}


def proxy_signature() -> FailureSignature:
    """Return the fixed primary-demo incident signature."""

    return FailureSignature(
        signature_id="proxy-identity-collapse-v1",
        matchers=(
            SignatureMatcher(
                matcher_id="process-exit",
                kind=MatcherKind.EQUALS,
                path=("exit_code",),
                expected=0,
            ),
            SignatureMatcher(
                matcher_id="response-sequence",
                kind=MatcherKind.EQUALS,
                path=("payload", "statuses"),
                expected=[200, 429],
            ),
            SignatureMatcher(
                matcher_id="rejection-event",
                kind=MatcherKind.EQUALS,
                path=("payload", "records", 1, "event"),
                expected="rate_limit_rejected",
            ),
            SignatureMatcher(
                matcher_id="identity-collapse",
                kind=MatcherKind.SAME_VALUE,
                path=("payload", "identities", 0),
                comparison_path=("payload", "identities", 1),
            ),
            SignatureMatcher(
                matcher_id="forwarded-client",
                kind=MatcherKind.EQUALS,
                path=("payload", "records", 1, "forwardedClient"),
                expected="198.51.100.11",
            ),
        ),
    )


def integrity_plan() -> ExecutionIntegrityPlan:
    """Return the fixed two-branch common-checkpoint plan."""

    return ExecutionIntegrityPlan(
        checkpoint_id=CHECKPOINT_ID,
        baseline_marker=BASELINE_MARKER,
        experiments=(
            ExperimentPlan("incident", CHECKPOINT_ID, BRANCH_A_MARKER),
            ExperimentPlan("known-good", CHECKPOINT_ID, BRANCH_B_MARKER),
        ),
    )


def probe_commands() -> tuple[SandboxCommand, tuple[SandboxCommand, ...]]:
    """Return the fixed parent and child commands for the reviewed probe."""

    executable = "/usr/local/bin/python"
    parent_program = """from pathlib import Path
root = Path("/tmp/scully-integrity")
root.mkdir(parents=True, exist_ok=True)
(root / "baseline").write_text("baseline", encoding="utf-8")
print("parent-ready")
"""
    return (
        SandboxCommand(
            label="prepare",
            executable=executable,
            args=("-c", parent_program),
        ),
        (
            SandboxCommand(
                label="incident",
                executable=executable,
                args=(
                    "-c",
                    _branch_program(
                        own_marker=BRANCH_A_MARKER,
                        forbidden_marker=BRANCH_B_MARKER,
                        payload=INCIDENT_PAYLOAD,
                    ),
                ),
            ),
            SandboxCommand(
                label="known-good",
                executable=executable,
                args=(
                    "-c",
                    _branch_program(
                        own_marker=BRANCH_B_MARKER,
                        forbidden_marker=BRANCH_A_MARKER,
                        payload=KNOWN_GOOD_PAYLOAD,
                    ),
                ),
            ),
        ),
    )


def run_probe(
    settings: Settings,
    *,
    client_factory: Callable[[Settings], SandboxClient] | None = None,
    clock: Callable[[], datetime] | None = None,
) -> dict[str, object]:
    """Execute one reviewed lifecycle and return redacted evidence."""

    readiness = build_preflight_report(settings).providers["sandbox"]
    if not readiness.live_gate_open:
        raise ConfigurationError("Sandbox execution preflight is not ready")

    create_client = client_factory or create_sandbox_client
    tracker = SandboxExecutionTracker()
    client = TrackingSandboxClient(create_client(settings), tracker)
    prepare, branches = probe_commands()
    now = clock or (lambda: datetime.now(UTC))
    started_at = now()
    try:
        outcome = SandboxAdapter(client, settings, clock=now).run_branches(
            investigation_id=PROBE_ID,
            base_image=PROBE_IMAGE,
            prepare=prepare,
            branches=branches,
        )
        evidence = _evaluate_outcome(outcome)
    except Exception as error:
        return _failure_record(error, tracker, started_at, now())

    return {
        "probe_id": PROBE_ID,
        "provider": Provider.SANDBOX.value,
        "status": OperationStatus.SUCCEEDED.value,
        "base_image": PROBE_IMAGE,
        "common_checkpoint": True,
        "isolation_passed": evidence["isolation_passed"],
        "incident_verdict": evidence["incident_verdict"],
        "known_good_verdict": evidence["known_good_verdict"],
        "incident_matcher_count": evidence["incident_matcher_count"],
        "known_good_failed_matcher_count": evidence[
            "known_good_failed_matcher_count"
        ],
        "untagged_resulting_images": sum(
            not result.tagged for result in (outcome.parent, *outcome.branches)
        ),
        "measurement": outcome.measurement.to_record(),
    }


def main() -> int:
    """Run once, print a redacted JSON record, and return its status."""

    record = run_probe(Settings.from_environment())
    print(json.dumps(record, indent=2, sort_keys=True))
    return 0 if record["status"] == OperationStatus.SUCCEEDED.value else 1


def _branch_program(
    *,
    own_marker: str,
    forbidden_marker: str,
    payload: dict[str, object],
) -> str:
    encoded_payload = json.dumps(payload, separators=(",", ":"), sort_keys=True)
    return f'''from pathlib import Path
root = Path("/tmp/scully-integrity")
assert (root / "baseline").read_text(encoding="utf-8") == "baseline"
assert not (root / {forbidden_marker!r}).exists()
(root / {own_marker!r}).write_text({own_marker!r}, encoding="utf-8")
print({encoded_payload!r})
'''


def _evaluate_outcome(outcome: SandboxOutcome) -> dict[str, object]:
    if outcome.parent.exit_code != 0 or outcome.parent.stdout != PARENT_OUTPUT:
        raise ProviderContractError("Integrity parent result did not match")
    if outcome.parent.stderr or len(outcome.branches) != 2:
        raise ProviderContractError("Integrity branch structure did not match")

    payloads = []
    for branch in outcome.branches:
        if branch.exit_code != 0 or branch.stderr:
            raise ProviderContractError("Integrity branch execution failed")
        try:
            payload = json.loads(
                branch.stdout,
                parse_constant=lambda value: (_ for _ in ()).throw(
                    ValueError(f"Invalid JSON constant: {value}")
                ),
            )
        except (json.JSONDecodeError, ValueError) as error:
            raise ProviderContractError(
                "Integrity branch output was not strict JSON"
            ) from error
        if not isinstance(payload, dict):
            raise ProviderContractError("Integrity branch output must be an object")
        payloads.append(payload)

    plan = integrity_plan()
    isolation = verify_sibling_isolation(
        plan,
        tuple(
            BranchSnapshot(
                experiment_id=experiment.experiment_id,
                checkpoint_id=CHECKPOINT_ID,
                visible_markers=frozenset(payload.get("visible_markers", [])),
            )
            for experiment, payload in zip(plan.experiments, payloads, strict=True)
        ),
    )
    signature = proxy_signature()
    incident = evaluate_signature(
        signature,
        ExecutionResult(
            experiment_id="incident",
            checkpoint_id=CHECKPOINT_ID,
            status=ExecutionStatus.COMPLETED,
            exit_code=outcome.branches[0].exit_code,
            payload=payloads[0],
        ),
    )
    known_good = evaluate_signature(
        signature,
        ExecutionResult(
            experiment_id="known-good",
            checkpoint_id=CHECKPOINT_ID,
            status=ExecutionStatus.COMPLETED,
            exit_code=outcome.branches[1].exit_code,
            payload=payloads[1],
        ),
    )
    if not isolation.passed:
        raise ProviderContractError("Sibling isolation checks failed")
    if incident.verdict is not EvaluationVerdict.MATCHED:
        raise ProviderContractError("Incident signature did not match")
    if known_good.verdict is not EvaluationVerdict.NOT_MATCHED:
        raise ProviderContractError("Known-good result matched incident signature")
    return {
        "isolation_passed": isolation.passed,
        "incident_verdict": incident.verdict.value,
        "known_good_verdict": known_good.verdict.value,
        "incident_matcher_count": len(incident.matcher_results),
        "known_good_failed_matcher_count": sum(
            not item.passed for item in known_good.matcher_results if item.required
        ),
    }


def _failure_record(
    error: Exception,
    tracker: SandboxExecutionTracker,
    started_at: datetime,
    ended_at: datetime,
) -> dict[str, object]:
    status_code = getattr(error, "status_code", None)
    is_rate_limited = status_code == 429
    error_name = type(error).__name__.lower()
    is_timeout = "timeout" in error_name or "timedout" in error_name
    is_cancelled = "cancel" in error_name
    status = (
        OperationStatus.RATE_LIMITED
        if is_rate_limited
        else OperationStatus.TIMED_OUT
        if is_timeout
        else OperationStatus.CANCELLED
        if is_cancelled
        else OperationStatus.FAILED
    )
    measurement = Measurement(
        investigation_id=PROBE_ID,
        provider=Provider.SANDBOX,
        operation="execution_integrity",
        status=status,
        started_at=started_at,
        ended_at=ended_at,
        request_count=tracker.operations_attempted,
        sandbox_operations=tracker.operations_attempted,
        sandbox_elapsed_seconds=tracker.elapsed_seconds,
        sandbox_reported_cost=tracker.reported_cost,
        rate_limit_count=int(is_rate_limited),
    )
    return {
        "probe_id": PROBE_ID,
        "provider": Provider.SANDBOX.value,
        "status": status.value,
        "error_type": type(error).__name__,
        "failure_stage": (
            "contract_validation"
            if isinstance(error, ProviderContractError)
            else tracker.current_stage
        ),
        "http_status": status_code if isinstance(status_code, int) else None,
        "operations_completed": tracker.operations_completed,
        "measurement": measurement.to_record(),
    }


if __name__ == "__main__":
    raise SystemExit(main())
