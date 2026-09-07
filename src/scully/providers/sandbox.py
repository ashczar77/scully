"""ConTree branching contract over an injected synchronous SDK client."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
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
    stdout: str
    stderr: str
    exit_code: int
    cpu_seconds: float


@dataclass(frozen=True, slots=True)
class SandboxOutcome:
    """One prepared parent, independent child results, and measurement."""

    parent_image_id: str
    branches: tuple[BranchResult, ...]
    measurement: Measurement


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
            )
            results.append(_read_result(command.label, pending.wait()))
        ended_at = self._clock()
        cpu_seconds = parent_result.cpu_seconds + sum(
            result.cpu_seconds for result in results
        )

        return SandboxOutcome(
            parent_image_id=parent_result.image_id,
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
                sandbox_cpu_seconds=cpu_seconds,
            ),
        )


def _read_result(label: str, result: object) -> BranchResult:
    image_id = read_field(result, "uuid")
    stdout = read_field(result, "stdout")
    stderr = read_field(result, "stderr")
    exit_code = read_field(result, "exit_code")
    cpu_seconds = read_optional(result, "cpu_seconds", 0.0)
    if not isinstance(image_id, str) or not image_id:
        raise ProviderContractError("Sandbox result UUID cannot be empty")
    if not isinstance(stdout, str) or not isinstance(stderr, str):
        raise ProviderContractError("Sandbox output must be text")
    if len(stdout) > MAX_OUTPUT_CHARS or len(stderr) > MAX_OUTPUT_CHARS:
        raise ProviderContractError("Sandbox output exceeds the size cap")
    if isinstance(exit_code, bool) or not isinstance(exit_code, int):
        raise ProviderContractError("Sandbox exit code must be an integer")
    if isinstance(cpu_seconds, bool) or not isinstance(cpu_seconds, (int, float)):
        raise ProviderContractError("Sandbox CPU time must be numeric")
    normalized_cpu_seconds = float(cpu_seconds)
    if not isfinite(normalized_cpu_seconds) or normalized_cpu_seconds < 0:
        raise ProviderContractError("Sandbox CPU time must be finite and non-negative")
    return BranchResult(
        label=label,
        image_id=image_id,
        stdout=stdout,
        stderr=stderr,
        exit_code=exit_code,
        cpu_seconds=normalized_cpu_seconds,
    )
