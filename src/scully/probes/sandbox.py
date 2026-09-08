"""One bounded ConTree branching capability probe."""

from __future__ import annotations

import json
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from math import isfinite
from typing import Protocol

from scully.config import ConfigurationError, Provider, Settings
from scully.measurement import Measurement, OperationStatus
from scully.preflight import build_preflight_report
from scully.providers import ProviderContractError
from scully.providers.clients import create_sandbox_client
from scully.providers.sandbox import SandboxAdapter, SandboxCommand


PROBE_ID = "g1.2-sandbox-001"
PROBE_IMAGE = "python:3.12-slim"
PARENT_OUTPUT = "parent-ready\n"
BRANCH_OUTPUTS = ("branch-a-ok\n", "branch-b-isolated-ok\n")

PARENT_PROGRAM = """from pathlib import Path
Path("/tmp/scully-parent.txt").write_text("shared-parent\\n", encoding="utf-8")
print("parent-ready")
"""
BRANCH_A_PROGRAM = """from pathlib import Path
assert Path("/tmp/scully-parent.txt").read_text(encoding="utf-8") == "shared-parent\\n"
Path("/tmp/scully-branch-a.txt").write_text("branch-a\\n", encoding="utf-8")
print("branch-a-ok")
"""
BRANCH_B_PROGRAM = """from pathlib import Path
assert Path("/tmp/scully-parent.txt").read_text(encoding="utf-8") == "shared-parent\\n"
assert not Path("/tmp/scully-branch-a.txt").exists()
Path("/tmp/scully-branch-b.txt").write_text("branch-b\\n", encoding="utf-8")
print("branch-b-isolated-ok")
"""


class SandboxClient(Protocol):
    """ConTree client surface needed by the probe."""

    images: object


@dataclass(slots=True)
class SandboxExecutionTracker:
    """Track safe lifecycle facts without retaining command output."""

    operations_attempted: int = 0
    operations_completed: int = 0
    current_stage: str = "not_started"
    elapsed_seconds: float = 0.0
    reported_cost: float = 0.0

    def capture_result(self, image: object) -> None:
        """Aggregate public timing and cost fields from a completed image."""

        result = getattr(image, "result", None)
        elapsed = getattr(result, "elapsed_time", None)
        if isinstance(elapsed, timedelta):
            elapsed_value = elapsed.total_seconds()
        elif isinstance(elapsed, (int, float)) and not isinstance(elapsed, bool):
            elapsed_value = float(elapsed)
        else:
            return
        cost = getattr(result, "cost", 0.0)
        if (
            isinstance(cost, (int, float))
            and not isinstance(cost, bool)
            and isfinite(float(cost))
            and cost >= 0
            and isfinite(elapsed_value)
            and elapsed_value >= 0
        ):
            self.elapsed_seconds += elapsed_value
            self.reported_cost += float(cost)


class TrackingPending:
    """Count one execution when its ConTree operation is awaited."""

    def __init__(
        self,
        endpoint: object,
        tracker: SandboxExecutionTracker,
        stage: str,
    ) -> None:
        self._endpoint = endpoint
        self._tracker = tracker
        self._stage = stage

    def wait(self) -> TrackingImage:
        """Wait once and wrap the resulting runnable image."""

        self._tracker.operations_attempted += 1
        self._tracker.current_stage = self._stage
        wait = getattr(self._endpoint, "wait", None)
        if not callable(wait):
            raise TypeError("Sandbox pending operation is not awaitable")
        image = wait()
        self._tracker.operations_completed += 1
        self._tracker.capture_result(image)
        return TrackingImage(image, self._tracker)


class TrackingImage:
    """Wrap a ConTree image while preserving its public result surface."""

    def __init__(self, endpoint: object, tracker: SandboxExecutionTracker) -> None:
        self._endpoint = endpoint
        self._tracker = tracker

    def __getattr__(self, name: str) -> object:
        return getattr(self._endpoint, name)

    def run(
        self,
        command: str,
        *,
        args: Sequence[str],
        disposable: bool,
        timeout: int,
        truncate_output_at: int,
    ) -> TrackingPending:
        """Prepare one direct command and defer counting until wait."""

        run = getattr(self._endpoint, "run", None)
        if not callable(run):
            raise TypeError("Sandbox image is not runnable")
        pending = run(
            command,
            args=args,
            disposable=disposable,
            timeout=timeout,
            truncate_output_at=truncate_output_at,
        )
        stage = {
            1: "parent_execution",
            2: "branch_a_execution",
            3: "branch_b_execution",
        }.get(self._tracker.operations_attempted, "unexpected_execution")
        return TrackingPending(pending, self._tracker, stage)


class TrackingImages:
    """Count strict image resolution as the first lifecycle operation."""

    def __init__(self, endpoint: object, tracker: SandboxExecutionTracker) -> None:
        self._endpoint = endpoint
        self._tracker = tracker

    def use(self, image: str, *, strict: bool) -> TrackingImage:
        """Resolve exactly one base image."""

        self._tracker.operations_attempted += 1
        self._tracker.current_stage = "image_selection"
        use = getattr(self._endpoint, "use", None)
        if not callable(use):
            raise TypeError("Sandbox image manager cannot select an image")
        selected = use(image, strict=strict)
        self._tracker.operations_completed += 1
        return TrackingImage(selected, self._tracker)


class TrackingSandboxClient:
    """Expose the tracked image manager expected by the adapter."""

    def __init__(
        self,
        endpoint: SandboxClient,
        tracker: SandboxExecutionTracker,
    ) -> None:
        self.images = TrackingImages(endpoint.images, tracker)


def probe_commands() -> tuple[SandboxCommand, tuple[SandboxCommand, ...]]:
    """Return the fixed parent and child commands for the reviewed probe."""

    executable = "/usr/local/bin/python"
    return (
        SandboxCommand(
            label="prepare",
            executable=executable,
            args=("-c", PARENT_PROGRAM),
        ),
        (
            SandboxCommand(
                label="branch-a",
                executable=executable,
                args=("-c", BRANCH_A_PROGRAM),
            ),
            SandboxCommand(
                label="branch-b",
                executable=executable,
                args=("-c", BRANCH_B_PROGRAM),
            ),
        ),
    )


def run_probe(
    settings: Settings,
    *,
    client_factory: Callable[[Settings], SandboxClient] | None = None,
    clock: Callable[[], datetime] | None = None,
) -> dict[str, object]:
    """Execute one reviewed branch lifecycle and return redacted evidence."""

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
        _validate_outcome(outcome)
    except Exception as error:
        ended_at = now()
        return _failure_record(error, tracker, started_at, ended_at)

    image_ids = [
        outcome.parent.image_id,
        *(branch.image_id for branch in outcome.branches),
    ]
    resulting_images = (outcome.parent, *outcome.branches)
    return {
        "probe_id": PROBE_ID,
        "provider": Provider.SANDBOX.value,
        "status": OperationStatus.SUCCEEDED.value,
        "base_image": PROBE_IMAGE,
        "parent_output_match": outcome.parent.stdout == PARENT_OUTPUT,
        "branch_output_matches": [
            branch.stdout == expected
            for branch, expected in zip(outcome.branches, BRANCH_OUTPUTS, strict=True)
        ],
        "branch_stderr_empty": [not branch.stderr for branch in outcome.branches],
        "branch_exit_codes": [branch.exit_code for branch in outcome.branches],
        "image_identifiers_observed": all(image_ids),
        "resulting_images_distinct": len(set(image_ids)) == len(image_ids),
        "untagged_resulting_images": sum(
            not result.tagged for result in resulting_images
        ),
        "measurement": outcome.measurement.to_record(),
    }


def main() -> int:
    """Run once, print a redacted JSON record, and return its status."""

    record = run_probe(Settings.from_environment())
    print(json.dumps(record, indent=2, sort_keys=True))
    return 0 if record["status"] == OperationStatus.SUCCEEDED.value else 1


def _validate_outcome(outcome: object) -> None:
    parent = getattr(outcome, "parent")
    branches = getattr(outcome, "branches")
    if parent.exit_code != 0 or parent.stdout != PARENT_OUTPUT or parent.stderr:
        raise ProviderContractError("Sandbox parent result did not match")
    if len(branches) != len(BRANCH_OUTPUTS):
        raise ProviderContractError("Sandbox branch count did not match")
    for branch, expected in zip(branches, BRANCH_OUTPUTS, strict=True):
        if branch.exit_code != 0 or branch.stdout != expected or branch.stderr:
            raise ProviderContractError("Sandbox branch result did not match")
    image_ids = [parent.image_id, *(branch.image_id for branch in branches)]
    if len(set(image_ids)) != len(image_ids):
        raise ProviderContractError("Sandbox resulting images are not distinct")
    if parent.tagged or any(branch.tagged for branch in branches):
        raise ProviderContractError("Sandbox resulting images must remain untagged")


def _failure_record(
    error: Exception,
    tracker: SandboxExecutionTracker,
    started_at: datetime,
    ended_at: datetime,
) -> dict[str, object]:
    status_code = getattr(error, "status_code", None)
    is_rate_limited = status_code == 429
    is_timeout = "timeout" in type(error).__name__.lower()
    status = (
        OperationStatus.RATE_LIMITED
        if is_rate_limited
        else OperationStatus.TIMED_OUT
        if is_timeout
        else OperationStatus.FAILED
    )
    measurement = Measurement(
        investigation_id=PROBE_ID,
        provider=Provider.SANDBOX,
        operation="branch_lifecycle",
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
