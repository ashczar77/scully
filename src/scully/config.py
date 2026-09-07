"""Fail-closed configuration for offline tests and bounded live probes."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from enum import StrEnum


class ConfigurationError(ValueError):
    """Raised when configuration is missing, ambiguous, or unsafe."""


class Provider(StrEnum):
    """External providers used by the Phase 1 feasibility harness."""

    NEMOTRON = "nemotron"
    TAVILY = "tavily"
    SANDBOX = "sandbox"


@dataclass(frozen=True, slots=True)
class SecretValue:
    """A value that stays redacted in string and representation output."""

    _value: str = field(repr=False)

    def __post_init__(self) -> None:
        if not self._value.strip():
            raise ConfigurationError("Secret values cannot be empty")

    def reveal(self) -> str:
        """Return the value for a provider client at the final call boundary."""

        return self._value

    def __bool__(self) -> bool:
        return True

    def __repr__(self) -> str:
        return "SecretValue(<redacted>)"

    def __str__(self) -> str:
        return "<redacted>"


@dataclass(frozen=True, slots=True)
class RunBudget:
    """Hard limits applied to a single explicitly enabled probe."""

    max_model_calls: int = 1
    max_input_tokens: int = 8_192
    max_output_tokens: int = 1_024
    max_model_cost_usd: Decimal = Decimal("0.01")
    max_tavily_credits: int = 1
    max_sandbox_operations: int = 1
    timeout_seconds: int = 60

    def __post_init__(self) -> None:
        integer_limits = {
            "max_model_calls": self.max_model_calls,
            "max_input_tokens": self.max_input_tokens,
            "max_output_tokens": self.max_output_tokens,
            "max_tavily_credits": self.max_tavily_credits,
            "max_sandbox_operations": self.max_sandbox_operations,
            "timeout_seconds": self.timeout_seconds,
        }
        for name, value in integer_limits.items():
            if value <= 0:
                raise ConfigurationError(f"{name} must be greater than zero")

        if not self.max_model_cost_usd.is_finite():
            raise ConfigurationError("max_model_cost_usd must be finite")
        if self.max_model_cost_usd <= 0:
            raise ConfigurationError("max_model_cost_usd must be greater than zero")


@dataclass(frozen=True, slots=True)
class ModelPricing:
    """Published model prices used for preflight and measured-cost checks."""

    input_per_million_usd: Decimal = Decimal("0.06")
    output_per_million_usd: Decimal = Decimal("0.24")

    def __post_init__(self) -> None:
        prices = {
            "input_per_million_usd": self.input_per_million_usd,
            "output_per_million_usd": self.output_per_million_usd,
        }
        for name, value in prices.items():
            if not value.is_finite() or value < 0:
                raise ConfigurationError(f"{name} must be finite and non-negative")

    def cost(self, input_tokens: int, output_tokens: int) -> Decimal:
        """Calculate token cost without converting currency values to floats."""

        if input_tokens < 0 or output_tokens < 0:
            raise ConfigurationError("Token counts cannot be negative")
        million = Decimal(1_000_000)
        return (
            Decimal(input_tokens) * self.input_per_million_usd
            + Decimal(output_tokens) * self.output_per_million_usd
        ) / million


@dataclass(frozen=True, slots=True)
class Settings:
    """Runtime settings with live access disabled unless explicitly enabled."""

    live_enabled: bool
    budget: RunBudget
    nemotron_pricing: ModelPricing
    nebius_api_key: SecretValue | None = field(default=None, repr=False)
    nebius_project_id: SecretValue | None = field(default=None, repr=False)
    tavily_api_key: SecretValue | None = field(default=None, repr=False)
    tavily_project_id: SecretValue | None = field(default=None, repr=False)
    nemotron_model: str = "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B"

    @classmethod
    def from_environment(
        cls, environ: Mapping[str, str] | None = None
    ) -> Settings:
        """Load settings from a supplied mapping or the process environment."""

        source = os.environ if environ is None else environ
        project_id = _resolve_project_id(source)

        return cls(
            live_enabled=_parse_bool(
                source.get("SCULLY_ENABLE_LIVE", "false"),
                "SCULLY_ENABLE_LIVE",
            ),
            budget=RunBudget(
                max_model_calls=_parse_positive_int(
                    source.get("SCULLY_MAX_MODEL_CALLS", "1"),
                    "SCULLY_MAX_MODEL_CALLS",
                ),
                max_input_tokens=_parse_positive_int(
                    source.get("SCULLY_MAX_INPUT_TOKENS", "8192"),
                    "SCULLY_MAX_INPUT_TOKENS",
                ),
                max_output_tokens=_parse_positive_int(
                    source.get("SCULLY_MAX_OUTPUT_TOKENS", "1024"),
                    "SCULLY_MAX_OUTPUT_TOKENS",
                ),
                max_model_cost_usd=_parse_positive_decimal(
                    source.get("SCULLY_MAX_MODEL_COST_USD", "0.01"),
                    "SCULLY_MAX_MODEL_COST_USD",
                ),
                max_tavily_credits=_parse_positive_int(
                    source.get("SCULLY_MAX_TAVILY_CREDITS", "1"),
                    "SCULLY_MAX_TAVILY_CREDITS",
                ),
                max_sandbox_operations=_parse_positive_int(
                    source.get("SCULLY_MAX_SANDBOX_OPERATIONS", "1"),
                    "SCULLY_MAX_SANDBOX_OPERATIONS",
                ),
                timeout_seconds=_parse_positive_int(
                    source.get("SCULLY_TIMEOUT_SECONDS", "60"),
                    "SCULLY_TIMEOUT_SECONDS",
                ),
            ),
            nemotron_pricing=ModelPricing(
                input_per_million_usd=_parse_nonnegative_decimal(
                    source.get("NEBIUS_INPUT_PRICE_PER_MILLION_USD", "0.06"),
                    "NEBIUS_INPUT_PRICE_PER_MILLION_USD",
                ),
                output_per_million_usd=_parse_nonnegative_decimal(
                    source.get("NEBIUS_OUTPUT_PRICE_PER_MILLION_USD", "0.24"),
                    "NEBIUS_OUTPUT_PRICE_PER_MILLION_USD",
                ),
            ),
            nebius_api_key=_optional_secret(source.get("NEBIUS_API_KEY")),
            nebius_project_id=_optional_secret(project_id),
            tavily_api_key=_optional_secret(source.get("TAVILY_API_KEY")),
            tavily_project_id=_optional_secret(source.get("TAVILY_PROJECT")),
            nemotron_model=source.get(
                "NEBIUS_MODEL", "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B"
            ).strip(),
        )

    def assert_live_ready(self, provider: Provider) -> None:
        """Reject a provider call unless live mode and credentials are ready."""

        if not isinstance(provider, Provider):
            raise ConfigurationError("Unsupported provider")

        if not self.live_enabled:
            raise ConfigurationError(
                "Live provider access is disabled; set SCULLY_ENABLE_LIVE=true "
                "only after the execution preflight is approved"
            )

        missing: list[str] = []
        if provider in {Provider.NEMOTRON, Provider.SANDBOX}:
            if self.nebius_api_key is None:
                missing.append("NEBIUS_API_KEY")
        if provider is Provider.SANDBOX and self.nebius_project_id is None:
            missing.append("NEBIUS_PROJECT_ID")
        if provider is Provider.TAVILY and self.tavily_api_key is None:
            missing.append("TAVILY_API_KEY")

        if missing:
            names = ", ".join(missing)
            raise ConfigurationError(
                f"Missing required environment variable names: {names}"
            )

        if provider is Provider.NEMOTRON and not self.nemotron_model:
            raise ConfigurationError("NEBIUS_MODEL cannot be empty")


def _optional_secret(value: str | None) -> SecretValue | None:
    if value is None or not value.strip():
        return None
    return SecretValue(value)


def _resolve_project_id(environ: Mapping[str, str]) -> str | None:
    project_id = _nonempty(environ.get("NEBIUS_PROJECT_ID"))
    legacy_project_id = _nonempty(environ.get("CONTREE_PROJECT"))

    if (
        project_id
        and legacy_project_id
        and project_id != legacy_project_id
    ):
        raise ConfigurationError(
            "NEBIUS_PROJECT_ID and CONTREE_PROJECT must identify the same project"
        )

    return project_id or legacy_project_id


def _nonempty(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    return value


def _parse_bool(value: str, name: str) -> bool:
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ConfigurationError(f"{name} must be true or false")


def _parse_positive_int(value: str, name: str) -> int:
    try:
        parsed = int(value)
    except ValueError as error:
        raise ConfigurationError(f"{name} must be an integer") from error
    if parsed <= 0:
        raise ConfigurationError(f"{name} must be greater than zero")
    return parsed


def _parse_positive_decimal(value: str, name: str) -> Decimal:
    try:
        parsed = Decimal(value)
    except InvalidOperation as error:
        raise ConfigurationError(f"{name} must be a decimal number") from error
    if not parsed.is_finite() or parsed <= 0:
        raise ConfigurationError(f"{name} must be a finite value above zero")
    return parsed


def _parse_nonnegative_decimal(value: str, name: str) -> Decimal:
    try:
        parsed = Decimal(value)
    except InvalidOperation as error:
        raise ConfigurationError(f"{name} must be a decimal number") from error
    if not parsed.is_finite() or parsed < 0:
        raise ConfigurationError(f"{name} must be finite and non-negative")
    return parsed
