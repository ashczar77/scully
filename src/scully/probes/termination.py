"""One bounded Sandbox timeout and cancellation probe."""

from __future__ import annotations

import json
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Protocol

from scully.config import ConfigurationError, Provider, Settings
from scully.dependencies import LOCKED_PROVIDER_VERSIONS, installed_version
from scully.evaluation import (
    EvaluationVerdict,
    ExecutionResult,
    ExecutionStatus,
    FailureSignature,
    MatcherKind,
    SignatureMatcher,
    evaluate_signature,
)
from scully.measurement import Measurement, OperationStatus
from scully.providers.clients import create_termination_client
from scully.providers.termination import (
    PATH_DEADLINE_SECONDS,
    REQUIRED_SANDBOX_OPERATIONS,
    TerminationAdapter,
    TerminationClient,
    TerminationOutcome,
    TerminationTracker,
)


PROBE_ID = "g1.3-termination-002"
PROBE_IMAGE = "tag:python:3.12-slim"
REQUIRED_BUDGET_TIMEOUT_SECONDS = 15
CLIENT_PACKAGE = "contree-client"


class ClientFactory(Protocol):
    """Factory for an inertly constructed direct Sandbox client."""

    def __call__(self, settings: Settings) -> TerminationClient:
        """Construct the client without making a provider request."""


def build_termination_preflight(
    settings: Settings,
    *,
    version_lookup: Callable[[str], str | None] = installed_version,
) -> dict[str, object]:
    """Return redacted readiness facts without constructing a client."""

    package_version = version_lookup(CLIENT_PACKAGE)
    package_matches = package_version == LOCKED_PROVIDER_VERSIONS[CLIENT_PACKAGE]
    credentials_configured = (
        settings.nebius_api_key is not None
        and settings.nebius_project_id is not None
    )
    budget_valid = (
        settings.budget.max_sandbox_operations == REQUIRED_SANDBOX_OPERATIONS
        and settings.budget.timeout_seconds == REQUIRED_BUDGET_TIMEOUT_SECONDS
        and PATH_DEADLINE_SECONDS == float(REQUIRED_BUDGET_TIMEOUT_SECONDS)
    )
    gate_open = (
        settings.live_enabled
        and settings.live_provider is Provider.SANDBOX
        and package_matches
        and credentials_configured
        and budget_valid
    )
    return {
        "performs_provider_calls": False,
        "review_required": True,
        "package": CLIENT_PACKAGE,
        "installed_version": package_version,
        "package_matches_lock": package_matches,
        "credentials_configured": credentials_configured,
        "budget_valid": budget_valid,
        "live_gate_open": gate_open,
    }


def termination_signature() -> FailureSignature:
    """Return a fixed signature that termination states cannot satisfy."""

    return FailureSignature(
        signature_id="termination-inconclusive-v1",
        matchers=(
            SignatureMatcher(
                matcher_id="process-exit",
                kind=MatcherKind.EQUALS,
                path=("exit_code",),
                expected=0,
            ),
        ),
    )


def run_probe(
    settings: Settings,
    *,
    client_factory: ClientFactory | None = None,
    version_lookup: Callable[[str], str | None] = installed_version,
    clock: Callable[[], datetime] | None = None,
    monotonic: Callable[[], float] | None = None,
    sleeper: Callable[[float], None] | None = None,
) -> dict[str, object]:
    """Execute the reviewed termination paths and return redacted evidence."""

    preflight = build_termination_preflight(
        settings,
        version_lookup=version_lookup,
    )
    if not preflight["live_gate_open"]:
        raise ConfigurationError("Termination execution preflight is not ready")

    tracker = TerminationTracker()
    now = clock or (lambda: datetime.now(UTC))
    started_at = now()
    create_client = client_factory or create_termination_client
    client = create_client(settings)
    try:
        outcome = TerminationAdapter(
            client,
            settings,
            tracker=tracker,
            monotonic=monotonic,
            sleeper=sleeper,
        ).run(base_image=PROBE_IMAGE)
        return _success_record(outcome, tracker, started_at, now())
    except Exception as error:
        return _failure_record(error, tracker, started_at, now())
    finally:
        client.close()


def main() -> int:
    """Run once, print a redacted JSON record, and return its status."""

    record = run_probe(Settings.from_environment())
    print(json.dumps(record, indent=2, sort_keys=True))
    return 0 if record["status"] == OperationStatus.SUCCEEDED.value else 1


def _success_record(
    outcome: TerminationOutcome,
    tracker: TerminationTracker,
    started_at: datetime,
    ended_at: datetime,
) -> dict[str, object]:
    signature = termination_signature()
    timeout_evaluation = evaluate_signature(
        signature,
        ExecutionResult(
            experiment_id="timeout",
            checkpoint_id=PROBE_ID,
            status=ExecutionStatus.TIMED_OUT,
            error_code="remote_timeout_confirmed",
        ),
    )
    cancellation_evaluation = evaluate_signature(
        signature,
        ExecutionResult(
            experiment_id="cancellation",
            checkpoint_id=PROBE_ID,
            status=ExecutionStatus.CANCELLED,
            error_code="remote_cancellation_confirmed",
        ),
    )
    if (
        timeout_evaluation.verdict is not EvaluationVerdict.INCONCLUSIVE
        or cancellation_evaluation.verdict is not EvaluationVerdict.INCONCLUSIVE
    ):
        raise RuntimeError("Termination evaluation did not remain inconclusive")

    measurement = Measurement(
        investigation_id=PROBE_ID,
        provider=Provider.SANDBOX,
        operation="termination_verification",
        status=OperationStatus.SUCCEEDED,
        started_at=started_at,
        ended_at=ended_at,
        request_count=tracker.request_count,
        sandbox_operations=tracker.operation_ids_confirmed,
        sandbox_elapsed_seconds=(
            outcome.timeout.duration_seconds
            + outcome.cancellation.duration_seconds
        ),
        retries=0,
    )
    return {
        "probe_id": PROBE_ID,
        "provider": Provider.SANDBOX.value,
        "status": OperationStatus.SUCCEEDED.value,
        "base_image": PROBE_IMAGE,
        "stop_on_first_failure": True,
        "retry_policy_max_attempts": 1,
        "max_stale_connection_resends_per_idempotent_call": 1,
        "request_count_unit": "application_client_calls",
        "provider_reported_cost_available": False,
        "spawn_calls_attempted": tracker.spawn_calls_attempted,
        "operation_ids_confirmed": tracker.operation_ids_confirmed,
        "timeout": {
            "terminal_status": outcome.timeout.terminal_status,
            "timed_out": outcome.timeout.timed_out,
            "evaluation_verdict": timeout_evaluation.verdict.value,
            "disposable": outcome.timeout.disposable,
            "no_result_image": outcome.timeout.no_result_image,
            "status_reads": outcome.timeout.status_reads,
            "cancel_requests": outcome.timeout.cancel_requests,
            "cleanup_cancel_requests": (
                outcome.timeout.cleanup_cancel_requests
            ),
        },
        "cancellation": {
            "terminal_status": outcome.cancellation.terminal_status,
            "timed_out": outcome.cancellation.timed_out,
            "evaluation_verdict": cancellation_evaluation.verdict.value,
            "disposable": outcome.cancellation.disposable,
            "no_result_image": outcome.cancellation.no_result_image,
            "status_reads": outcome.cancellation.status_reads,
            "cancel_requests": outcome.cancellation.cancel_requests,
            "cleanup_cancel_requests": (
                outcome.cancellation.cleanup_cancel_requests
            ),
        },
        "measurement": _measurement_record(measurement),
    }


def _failure_record(
    error: Exception,
    tracker: TerminationTracker,
    started_at: datetime,
    ended_at: datetime,
) -> dict[str, object]:
    is_timeout = isinstance(error, TimeoutError)
    status = (
        OperationStatus.TIMED_OUT if is_timeout else OperationStatus.FAILED
    )
    measurement = Measurement(
        investigation_id=PROBE_ID,
        provider=Provider.SANDBOX,
        operation="termination_verification",
        status=status,
        started_at=started_at,
        ended_at=ended_at,
        request_count=tracker.request_count,
        sandbox_operations=tracker.operation_ids_confirmed,
        retries=0,
    )
    return {
        "probe_id": PROBE_ID,
        "provider": Provider.SANDBOX.value,
        "status": status.value,
        "failure_path": tracker.current_path,
        "error_type": type(error).__name__,
        "spawn_calls_attempted": tracker.spawn_calls_attempted,
        "operation_ids_confirmed": tracker.operation_ids_confirmed,
        "status_reads": tracker.status_reads,
        "primary_cancel_requests": tracker.primary_cancel_requests,
        "cleanup_cancel_requests": tracker.cleanup_cancel_requests,
        "provider_reported_cost_available": False,
        "measurement": _measurement_record(measurement),
    }


def _measurement_record(measurement: Measurement) -> dict[str, str | int | float]:
    """Remove the unavailable direct-client cost field from the record."""

    record = measurement.to_record()
    del record["sandbox_reported_cost"]
    return record


if __name__ == "__main__":
    raise SystemExit(main())
