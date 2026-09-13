"""Read-only execution preflight with no provider call path."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from decimal import Decimal

from scully.config import Provider, Settings
from scully.dependencies import LOCKED_PROVIDER_VERSIONS, installed_version


SANDBOX_PROBE_OPERATIONS = 4
SANDBOX_PRODUCT_OPERATIONS = 5
NEMOTRON_PROBE_MAX_INPUT_TOKENS = 8_192
NEMOTRON_PROBE_MAX_OUTPUT_TOKENS = 10_000
NEMOTRON_PROBE_MAX_COST_USD = Decimal("0.01")
NEMOTRON_PROBE_TIMEOUT_SECONDS = 60
TAVILY_PROBE_MAX_CREDITS = 1
TAVILY_PROBE_TIMEOUT_SECONDS = 60


@dataclass(frozen=True, slots=True)
class ProviderPreflight:
    """Non-sensitive readiness facts for one provider boundary."""

    package: str
    installed_version: str | None
    package_matches_lock: bool
    credentials_configured: bool
    budget_valid: bool
    live_gate_open: bool


@dataclass(frozen=True, slots=True)
class PreflightReport:
    """Serializable facts used by the human execution review."""

    performs_provider_calls: bool
    review_required: bool
    live_enabled: bool
    live_provider: str | None
    worst_case_model_cost_usd: str
    providers: dict[str, ProviderPreflight]

    def to_dict(self) -> dict[str, object]:
        """Return a JSON-compatible report without credential values."""

        return asdict(self)


def build_preflight_report(settings: Settings) -> PreflightReport:
    """Evaluate package, credential, budget, and live-gate state locally."""

    package_versions = {
        package: installed_version(package) for package in LOCKED_PROVIDER_VERSIONS
    }
    worst_case_cost = settings.nemotron_pricing.cost(
        settings.budget.max_input_tokens,
        settings.budget.max_output_tokens,
    )

    nemotron_credentials = (
        settings.nebius_api_key is not None and bool(settings.nemotron_model)
    )
    tavily_credentials = settings.tavily_api_key is not None
    sandbox_credentials = (
        settings.nebius_api_key is not None
        and settings.nebius_project_id is not None
    )
    nemotron_budget = (
        settings.budget.max_model_calls == 1
        and settings.budget.max_input_tokens
        == NEMOTRON_PROBE_MAX_INPUT_TOKENS
        and settings.budget.max_output_tokens
        == NEMOTRON_PROBE_MAX_OUTPUT_TOKENS
        and settings.budget.max_model_cost_usd
        == NEMOTRON_PROBE_MAX_COST_USD
        and settings.budget.timeout_seconds
        == NEMOTRON_PROBE_TIMEOUT_SECONDS
        and worst_case_cost <= settings.budget.max_model_cost_usd
    )
    tavily_budget = (
        settings.budget.max_tavily_credits == TAVILY_PROBE_MAX_CREDITS
        and settings.budget.timeout_seconds == TAVILY_PROBE_TIMEOUT_SECONDS
    )
    sandbox_budget = settings.budget.max_sandbox_operations in {
        SANDBOX_PROBE_OPERATIONS,
        SANDBOX_PRODUCT_OPERATIONS,
    }

    providers = {
        "nemotron": _provider_preflight(
            "openai",
            package_versions,
            nemotron_credentials,
            nemotron_budget,
            settings.live_enabled,
            settings.live_provider is Provider.NEMOTRON,
        ),
        "tavily": _provider_preflight(
            "tavily-python",
            package_versions,
            tavily_credentials,
            tavily_budget,
            settings.live_enabled,
            settings.live_provider is Provider.TAVILY,
        ),
        "sandbox": _provider_preflight(
            "contree-sdk",
            package_versions,
            sandbox_credentials,
            sandbox_budget,
            settings.live_enabled,
            settings.live_provider is Provider.SANDBOX,
        ),
    }
    return PreflightReport(
        performs_provider_calls=False,
        review_required=True,
        live_enabled=settings.live_enabled,
        live_provider=(
            settings.live_provider.value
            if settings.live_provider is not None
            else None
        ),
        worst_case_model_cost_usd=_decimal_text(worst_case_cost),
        providers=providers,
    )


def main() -> int:
    """Print the local preflight report and perform no external request."""

    report = build_preflight_report(Settings.from_environment())
    print(json.dumps(report.to_dict(), indent=2, sort_keys=True))
    return 0


def _provider_preflight(
    package: str,
    installed_versions: dict[str, str | None],
    credentials_configured: bool,
    budget_valid: bool,
    live_enabled: bool,
    provider_targeted: bool,
) -> ProviderPreflight:
    installed = installed_versions[package]
    package_matches = installed == LOCKED_PROVIDER_VERSIONS[package]
    return ProviderPreflight(
        package=package,
        installed_version=installed,
        package_matches_lock=package_matches,
        credentials_configured=credentials_configured,
        budget_valid=budget_valid,
        live_gate_open=(
            live_enabled
            and provider_targeted
            and package_matches
            and credentials_configured
            and budget_valid
        ),
    )
def _decimal_text(value: Decimal) -> str:
    return format(value, "f")


if __name__ == "__main__":
    raise SystemExit(main())
