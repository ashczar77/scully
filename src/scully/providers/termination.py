"""Bounded direct-client contract for Sandbox termination verification."""

from __future__ import annotations

import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from math import isfinite
from types import EllipsisType
from typing import Protocol

from scully.config import ConfigurationError, Provider, Settings

from . import ProviderContractError
from ._contracts import read_field, read_optional


TIMEOUT_COMMAND_SECONDS = 1
TIMEOUT_SLEEP_SECONDS = 10
CANCELLATION_COMMAND_SECONDS = 30
CANCELLATION_SLEEP_SECONDS = 30
PATH_DEADLINE_SECONDS = 15.0
POLL_INTERVAL_SECONDS = 0.5
MAX_STATUS_READS_PER_PATH = 10
MAX_OUTPUT_BYTES = 1_024
REQUIRED_SANDBOX_OPERATIONS = 2
ACTIVE_STATUSES = frozenset({"PENDING", "ASSIGNED", "EXECUTING"})
TERMINAL_STATUSES = frozenset({"SUCCESS", "FAILED", "CANCELLED"})


class TerminationClient(Protocol):
    """Direct client methods needed by the termination probe."""

    def spawn_instance(
        self,
        command: str,
        image: str,
        *,
        disposable: bool,
        args: Sequence[str],
        shell: bool,
        timeout: int,
        truncate_output_at: int,
    ) -> object:
        """Start one disposable Sandbox operation."""

    def get_operation_status(
        self, operation_id: str, *, inflight: bool = False
    ) -> object:
        """Read the status of one exact operation."""

    def cancel_operation(self, operation_id: str) -> None:
        """Cancel one exact operation."""

    def close(self) -> None:
        """Release transport resources."""


@dataclass(slots=True)
class TerminationTracker:
    """Application-level call counts that survive a failed probe."""

    current_path: str = "preflight"
    operations_spawned: int = 0
    status_reads: int = 0
    primary_cancel_requests: int = 0
    cleanup_cancel_requests: int = 0

    @property
    def request_count(self) -> int:
        """Return the total number of direct application client calls."""

        return (
            self.operations_spawned
            + self.status_reads
            + self.primary_cancel_requests
            + self.cleanup_cancel_requests
        )


@dataclass(frozen=True, slots=True)
class TerminationObservation:
    """Redacted terminal facts for one remote operation."""

    path: str
    terminal_status: str
    timed_out: bool
    disposable: bool
    no_result_image: bool
    duration_seconds: float
    status_reads: int
    cancel_requests: int
    cleanup_cancel_requests: int


@dataclass(frozen=True, slots=True)
class TerminationOutcome:
    """Timeout and cancellation observations from one bounded probe."""

    timeout: TerminationObservation
    cancellation: TerminationObservation


class TerminationAdapter:
    """Run one timeout path, then one explicit cancellation path."""

    def __init__(
        self,
        client: TerminationClient,
        settings: Settings,
        *,
        tracker: TerminationTracker | None = None,
        monotonic: Callable[[], float] | None = None,
        sleeper: Callable[[float], None] | None = None,
    ) -> None:
        self._client = client
        self._settings = settings
        self.tracker = tracker or TerminationTracker()
        self._monotonic = monotonic or time.monotonic
        self._sleep = sleeper or time.sleep

    def run(self, *, base_image: str) -> TerminationOutcome:
        """Run both paths, stopping before cancellation if timeout fails."""

        self._settings.assert_live_ready(Provider.SANDBOX)
        if self._settings.budget.max_sandbox_operations != REQUIRED_SANDBOX_OPERATIONS:
            raise ConfigurationError(
                "Termination probe requires exactly two Sandbox operations"
            )
        if not base_image.strip():
            raise ValueError("Base image cannot be empty")

        timeout = self._run_timeout(base_image)
        cancellation = self._run_cancellation(base_image)
        return TerminationOutcome(timeout=timeout, cancellation=cancellation)

    def _run_timeout(self, base_image: str) -> TerminationObservation:
        self.tracker.current_path = "timeout"
        deadline = self._monotonic() + PATH_DEADLINE_SECONDS
        operation_id: str | None = None
        terminal_observed = False
        path_status_start = self.tracker.status_reads
        path_cleanup_start = self.tracker.cleanup_cancel_requests
        try:
            operation_id = self._spawn(
                base_image,
                sleep_seconds=TIMEOUT_SLEEP_SECONDS,
                command_timeout=TIMEOUT_COMMAND_SECONDS,
            )
            response = self._poll_terminal(
                operation_id,
                deadline,
                MAX_STATUS_READS_PER_PATH,
            )
            terminal_observed = True
            return self._timeout_observation(
                operation_id,
                response,
                status_reads=self.tracker.status_reads - path_status_start,
                cleanup_requests=(
                    self.tracker.cleanup_cancel_requests - path_cleanup_start
                ),
            )
        except Exception:
            if operation_id is not None and not terminal_observed:
                self._cleanup(operation_id)
            raise

    def _run_cancellation(self, base_image: str) -> TerminationObservation:
        self.tracker.current_path = "cancellation"
        deadline = self._monotonic() + PATH_DEADLINE_SECONDS
        operation_id: str | None = None
        terminal_observed = False
        path_status_start = self.tracker.status_reads
        path_cancel_start = self.tracker.primary_cancel_requests
        path_cleanup_start = self.tracker.cleanup_cancel_requests
        try:
            operation_id = self._spawn(
                base_image,
                sleep_seconds=CANCELLATION_SLEEP_SECONDS,
                command_timeout=CANCELLATION_COMMAND_SECONDS,
            )
            initial = self._read_status(operation_id)
            initial_status = _operation_status(initial, operation_id)
            if initial_status in TERMINAL_STATUSES:
                terminal_observed = True
                raise ProviderContractError(
                    "Cancellation operation became terminal before cancellation"
                )
            if initial_status not in ACTIVE_STATUSES:
                raise ProviderContractError(
                    "Cancellation operation returned an unknown active status"
                )

            self.tracker.primary_cancel_requests += 1
            self._client.cancel_operation(operation_id)
            remaining_reads = MAX_STATUS_READS_PER_PATH - 1
            response = self._poll_terminal(
                operation_id,
                deadline,
                remaining_reads,
            )
            terminal_observed = True
            return self._cancellation_observation(
                operation_id,
                response,
                status_reads=self.tracker.status_reads - path_status_start,
                cancel_requests=(
                    self.tracker.primary_cancel_requests - path_cancel_start
                ),
                cleanup_requests=(
                    self.tracker.cleanup_cancel_requests - path_cleanup_start
                ),
            )
        except Exception:
            if operation_id is not None and not terminal_observed:
                self._cleanup(operation_id)
            raise

    def _spawn(
        self,
        base_image: str,
        *,
        sleep_seconds: int,
        command_timeout: int,
    ) -> str:
        if self.tracker.operations_spawned >= REQUIRED_SANDBOX_OPERATIONS:
            raise ConfigurationError("Termination operation cap reached")
        self.tracker.operations_spawned += 1
        response = self._client.spawn_instance(
            "/usr/bin/sleep",
            base_image,
            disposable=True,
            args=[str(sleep_seconds)],
            shell=False,
            timeout=command_timeout,
            truncate_output_at=MAX_OUTPUT_BYTES,
        )
        operation_id = read_field(response, "uuid")
        if not isinstance(operation_id, str) or not operation_id.strip():
            raise ProviderContractError("Spawn response has no operation identifier")
        return operation_id

    def _poll_terminal(
        self,
        operation_id: str,
        deadline: float,
        max_reads: int,
    ) -> object:
        for index in range(max_reads):
            if self._monotonic() >= deadline:
                break
            response = self._read_status(operation_id)
            status = _operation_status(response, operation_id)
            if status in TERMINAL_STATUSES:
                return response
            if status not in ACTIVE_STATUSES:
                raise ProviderContractError("Operation returned an unknown status")
            if index + 1 < max_reads:
                remaining = deadline - self._monotonic()
                if remaining <= 0:
                    break
                self._sleep(min(POLL_INTERVAL_SECONDS, remaining))
        raise TimeoutError("Terminal status was not observed within the reviewed bound")

    def _read_status(self, operation_id: str) -> object:
        self.tracker.status_reads += 1
        return self._client.get_operation_status(operation_id, inflight=False)

    def _cleanup(self, operation_id: str) -> None:
        if self.tracker.cleanup_cancel_requests >= 1:
            return
        self.tracker.cleanup_cancel_requests += 1
        try:
            self._client.cancel_operation(operation_id)
        except Exception:
            return

    def _timeout_observation(
        self,
        operation_id: str,
        response: object,
        *,
        status_reads: int,
        cleanup_requests: int,
    ) -> TerminationObservation:
        status = _operation_status(response, operation_id)
        if status != "SUCCESS":
            raise ProviderContractError("Timeout path did not finish successfully")
        timed_out = _timed_out(response)
        if timed_out is not True:
            raise ProviderContractError("Timeout path was not marked timed out")
        disposable, no_result_image = _retention_facts(response)
        if not disposable or not no_result_image:
            raise ProviderContractError("Timeout path retained Sandbox state")
        return TerminationObservation(
            path="timeout",
            terminal_status=status,
            timed_out=True,
            disposable=disposable,
            no_result_image=no_result_image,
            duration_seconds=_duration(response),
            status_reads=status_reads,
            cancel_requests=0,
            cleanup_cancel_requests=cleanup_requests,
        )

    def _cancellation_observation(
        self,
        operation_id: str,
        response: object,
        *,
        status_reads: int,
        cancel_requests: int,
        cleanup_requests: int,
    ) -> TerminationObservation:
        status = _operation_status(response, operation_id)
        if status != "CANCELLED":
            raise ProviderContractError("Cancellation was not confirmed remotely")
        disposable, no_result_image = _retention_facts(response)
        if not disposable or not no_result_image:
            raise ProviderContractError("Cancellation path retained Sandbox state")
        return TerminationObservation(
            path="cancellation",
            terminal_status=status,
            timed_out=False,
            disposable=disposable,
            no_result_image=no_result_image,
            duration_seconds=_duration(response),
            status_reads=status_reads,
            cancel_requests=cancel_requests,
            cleanup_cancel_requests=cleanup_requests,
        )


def _operation_status(response: object, operation_id: str) -> str:
    response_id = read_field(response, "uuid")
    if response_id != operation_id:
        raise ProviderContractError("Status response identifies another operation")
    value = read_field(response, "status")
    normalized = getattr(value, "value", value)
    if not isinstance(normalized, str):
        raise ProviderContractError("Operation status must be text")
    return normalized.upper()


def _timed_out(response: object) -> bool:
    metadata = read_field(response, "metadata")
    result = read_field(metadata, "result")
    state = read_field(result, "state")
    value = read_field(state, "timed_out")
    if not isinstance(value, bool):
        raise ProviderContractError("Timed-out state must be boolean")
    return value


def _retention_facts(response: object) -> tuple[bool, bool]:
    metadata = read_field(response, "metadata")
    disposable = read_field(metadata, "disposable")
    if not isinstance(disposable, bool):
        raise ProviderContractError("Disposable state must be boolean")
    result_image = read_optional(response, "result_image_uuid", None)
    if isinstance(result_image, EllipsisType):
        result_image = None
    return disposable, result_image is None


def _duration(response: object) -> float:
    value = read_optional(response, "duration", 0.0)
    if value is None or isinstance(value, EllipsisType):
        return 0.0
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ProviderContractError("Operation duration must be numeric")
    normalized = float(value)
    if not isfinite(normalized) or normalized < 0:
        raise ProviderContractError(
            "Operation duration must be finite and non-negative"
        )
    return normalized
