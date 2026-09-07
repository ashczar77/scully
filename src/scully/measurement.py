"""Redacted measurement records for bounded provider probes."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from enum import StrEnum
from math import isfinite

from .config import Provider


class OperationStatus(StrEnum):
    """Terminal outcomes recorded for a provider operation."""

    SUCCEEDED = "succeeded"
    FAILED = "failed"
    TIMED_OUT = "timed_out"
    CANCELLED = "cancelled"
    RATE_LIMITED = "rate_limited"


@dataclass(frozen=True, slots=True)
class Measurement:
    """A bounded, serializable record that cannot carry request content."""

    investigation_id: str
    provider: Provider
    operation: str
    status: OperationStatus
    started_at: datetime
    ended_at: datetime
    request_count: int = 1
    input_tokens: int = 0
    output_tokens: int = 0
    model_cost_usd: Decimal = Decimal("0")
    tavily_credits: int = 0
    sandbox_operations: int = 0
    sandbox_cpu_seconds: float = 0.0
    retries: int = 0
    rate_limit_count: int = 0

    def __post_init__(self) -> None:
        if not self.investigation_id.strip():
            raise ValueError("investigation_id cannot be empty")
        if not self.operation.strip():
            raise ValueError("operation cannot be empty")
        _require_utc(self.started_at, "started_at")
        _require_utc(self.ended_at, "ended_at")
        if self.ended_at < self.started_at:
            raise ValueError("ended_at cannot precede started_at")

        counters = {
            "request_count": self.request_count,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "tavily_credits": self.tavily_credits,
            "sandbox_operations": self.sandbox_operations,
            "sandbox_cpu_seconds": self.sandbox_cpu_seconds,
            "retries": self.retries,
            "rate_limit_count": self.rate_limit_count,
        }
        for name, value in counters.items():
            if value < 0:
                raise ValueError(f"{name} cannot be negative")

        if not isfinite(self.sandbox_cpu_seconds):
            raise ValueError("sandbox_cpu_seconds must be finite")

        if not self.model_cost_usd.is_finite() or self.model_cost_usd < 0:
            raise ValueError("model_cost_usd must be finite and non-negative")

    @property
    def duration_seconds(self) -> float:
        """Return wall-clock duration without retaining raw provider output."""

        return (self.ended_at - self.started_at).total_seconds()

    def to_record(self) -> dict[str, str | int | float]:
        """Return a JSON-compatible record containing only approved fields."""

        return {
            "investigation_id": self.investigation_id,
            "provider": self.provider.value,
            "operation": self.operation,
            "status": self.status.value,
            "started_at": self.started_at.isoformat(),
            "ended_at": self.ended_at.isoformat(),
            "duration_seconds": self.duration_seconds,
            "request_count": self.request_count,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "model_cost_usd": format(self.model_cost_usd, "f"),
            "tavily_credits": self.tavily_credits,
            "sandbox_operations": self.sandbox_operations,
            "sandbox_cpu_seconds": self.sandbox_cpu_seconds,
            "retries": self.retries,
            "rate_limit_count": self.rate_limit_count,
        }


def _require_utc(value: datetime, name: str) -> None:
    if value.tzinfo is None or value.utcoffset() != timedelta(0):
        raise ValueError(f"{name} must be timezone-aware UTC")
