"""ConTree branching contract over an injected synchronous SDK client."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from math import isfinite
from typing import Protocol

from scully.config import ConfigurationError, Provider, Settings
from scully.measurement import Measurement, OperationStatus

from . import ProviderContractError
from ._contracts import read_field, read_optional, require_investigation_id


MAX_OUTPUT_CHARS = 20_000


class PendingRun(Protocol):
    """Pending ConTree operation that can be awaited synchronously."""

    def wait(self) -> object:
        """Wait for the operation result."""


class RunnableImage(Protocol):
    """Image state that can execute a direct command."""

    def run(
        self,
        command: str,
        *,
        args: Sequence[str],
        disposable: bool,
        timeout: int,
        truncate_output_at: int,
    ) -> PendingRun:
        """Start a command from this image state."""


class ImageManager(Protocol):
    """Subset of the ConTree image manager used by the probe."""

    def use(self, image: str, *, strict: bool) -> RunnableImage:
        """Select one public image."""


class SandboxClient(Protocol):
    """Subset of the synchronous ConTree SDK client used by the probe."""

    images: ImageManager


@dataclass(frozen=True, slots=True)
class SandboxCommand:
    """An explicit executable and argument vector without implicit shell mode."""

    label: str
    executable: str
    args: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if not self.label.strip():
            raise ValueError("Command label cannot be empty")
        if not self.executable.startswith("/"):
            raise ValueError("Sandbox executable must use an absolute path")
        values = (self.executable, *self.args)
        if any(not isinstance(value, str) or "\x00" in value for value in values):
            raise ValueError("Sandbox command values must be safe strings")


@dataclass(frozen=True, slots=True)
class BranchResult:
    """Normalized result for one child branch."""

    label: str
    image_id: str
    tagged: bool
    stdout: str
    stderr: str
    exit_code: int
    elapsed_seconds: float
    reported_cost: float


@dataclass(frozen=True, slots=True)
class SandboxOutcome:
    """One prepared parent, independent child results, and measurement."""

    parent: BranchResult
    branches: tuple[BranchResult, ...]
    measurement: Measurement

    @property
    def parent_image_id(self) -> str:
        """Return the prepared parent identifier."""

        return self.parent.image_id


class SandboxAdapter:
    """Create a common parent and execute bounded branches from it."""

    def __init__(
        self,
        client: SandboxClient,
        settings: Settings,
        *,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._client = client
        self._settings = settings
        self._clock = clock or (lambda: datetime.now(UTC))

    def run_branches(
        self,
        *,
        investigation_id: str,
        base_image: str,
        prepare: SandboxCommand,
        branches: Sequence[SandboxCommand],
    ) -> SandboxOutcome:
        """Run at least two child commands from one persisted parent state."""

        self._settings.assert_live_ready(Provider.SANDBOX)
        investigation_id = require_investigation_id(investigation_id)
        if not base_image.strip():
            raise ValueError("Base image cannot be empty")
        if not isinstance(prepare, SandboxCommand):
            raise ValueError("Prepare command must be a SandboxCommand")
        if not isinstance(branches, Sequence) or isinstance(branches, (str, bytes)):
            raise ValueError("Branches must be a sequence of SandboxCommand values")
        if any(not isinstance(command, SandboxCommand) for command in branches):
            raise ValueError("Branches must be a sequence of SandboxCommand values")
        if len(branches) < 2:
            raise ValueError("At least two branches are required")

        operation_count = 2 + len(branches)
        if operation_count > self._settings.budget.max_sandbox_operations:
            raise ConfigurationError("Sandbox lifecycle exceeds the operation cap")

        started_at = self._clock()
        base = self._client.images.use(base_image, strict=True)
        parent = base.run(
            prepare.executable,
            args=prepare.args,
            disposable=False,
            timeout=self._settings.budget.timeout_seconds,
            truncate_output_at=MAX_OUTPUT_CHARS,
        ).wait()
        parent_result = _read_result("prepare", parent)
        if parent_result.exit_code != 0:
            raise ProviderContractError("Sandbox preparation command failed")
        run_child = getattr(parent, "run", None)
        if not callable(run_child):
            raise ProviderContractError("Persisted parent image is not runnable")

        results: list[BranchResult] = []
        for command in branches:
            pending = run_child(
                command.executable,
                args=command.args,
                disposable=False,
                timeout=self._settings.budget.timeout_seconds,
                truncate_output_at=MAX_OUTPUT_CHARS,
            )
            results.append(_read_result(command.label, pending.wait()))
        ended_at = self._clock()
        elapsed_seconds = parent_result.elapsed_seconds + sum(
            result.elapsed_seconds for result in results
        )
        reported_cost = parent_result.reported_cost + sum(
            result.reported_cost for result in results
        )

        return SandboxOutcome(
            parent=parent_result,
            branches=tuple(results),
            measurement=Measurement(
                investigation_id=investigation_id,
                provider=Provider.SANDBOX,
                operation="branch_lifecycle",
                status=OperationStatus.SUCCEEDED,
                started_at=started_at,
                ended_at=ended_at,
                request_count=operation_count,
                sandbox_operations=operation_count,
                sandbox_elapsed_seconds=elapsed_seconds,
                sandbox_reported_cost=reported_cost,
            ),
        )


def _read_result(label: str, result: object) -> BranchResult:
    image_id = read_field(result, "uuid")
    tag = read_optional(result, "tag", None)
    execution = read_field(result, "result")
    stdout = read_field(execution, "stdout")
    stderr = read_field(execution, "stderr")
    exit_code = read_field(execution, "exit_code")
    elapsed = read_field(execution, "elapsed_time")
    reported_cost = read_optional(execution, "cost", 0.0)
    if image_id is None:
        raise ProviderContractError("Sandbox result UUID cannot be empty")
    normalized_image_id = str(image_id)
    if not normalized_image_id:
        raise ProviderContractError("Sandbox result UUID cannot be empty")
    if tag is not None and (not isinstance(tag, str) or not tag.strip()):
        raise ProviderContractError("Sandbox result tag must be non-empty text")
    if not isinstance(stdout, str) or not isinstance(stderr, str):
        raise ProviderContractError("Sandbox output must be text")
    if len(stdout) > MAX_OUTPUT_CHARS or len(stderr) > MAX_OUTPUT_CHARS:
        raise ProviderContractError("Sandbox output exceeds the size cap")
    if isinstance(exit_code, bool) or not isinstance(exit_code, int):
        raise ProviderContractError("Sandbox exit code must be an integer")
    if isinstance(elapsed, timedelta):
        elapsed_seconds = elapsed.total_seconds()
    elif isinstance(elapsed, (int, float)) and not isinstance(elapsed, bool):
        elapsed_seconds = float(elapsed)
    else:
        raise ProviderContractError("Sandbox elapsed time must be numeric")
    if not isfinite(elapsed_seconds) or elapsed_seconds < 0:
        raise ProviderContractError(
            "Sandbox elapsed time must be finite and non-negative"
        )
    if isinstance(reported_cost, bool) or not isinstance(
        reported_cost, (int, float)
    ):
        raise ProviderContractError("Sandbox reported cost must be numeric")
    normalized_cost = float(reported_cost)
    if not isfinite(normalized_cost) or normalized_cost < 0:
        raise ProviderContractError(
            "Sandbox reported cost must be finite and non-negative"
        )
    return BranchResult(
        label=label,
        image_id=normalized_image_id,
        tagged=tag is not None,
        stdout=stdout,
        stderr=stderr,
        exit_code=exit_code,
        elapsed_seconds=elapsed_seconds,
        reported_cost=normalized_cost,
    )
