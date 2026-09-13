"""Explicitly gated sponsor-backed product path."""

from __future__ import annotations

import os
import re
import tempfile
from collections.abc import Callable, Mapping
from contextlib import ExitStack
from decimal import Decimal, InvalidOperation
from pathlib import Path

from scully.application.capsule_import import CapsuleImporter
from scully.application.execution import ExecutionAdapter, SandboxExecutionAdapter
from scully.application.investigations import InvestigationService
from scully.application.planning import (
    NemotronPlanningAdapter,
    PlanningAdapter,
    ResearchContextSource,
)
from scully.application.reproduction import ReproductionPackager
from scully.config import Provider, Settings
from scully.infrastructure.capsules import CapsuleRepository
from scully.infrastructure.database import Database
from scully.infrastructure.investigations import InvestigationRepository
from scully.preflight import build_preflight_report
from scully.providers.clients import (
    create_nemotron_client,
    create_sandbox_client,
    create_tavily_client,
)
from scully.providers.nemotron import NemotronAdapter
from scully.providers.sandbox import SandboxAdapter
from scully.providers.tavily import SearchOutcome, TavilyAdapter
from scully.reliability import proof_fingerprint


SPONSOR_QUERY = (
    "Express trust proxy X-Forwarded-For req.ip behavior official documentation"
)
SPONSOR_DOMAINS = ("expressjs.com",)
SPONSOR_RUN_PATTERN = re.compile(r"g4\.4-sponsor-[0-9]{3}")
MINIMUM_CONFIRMED_BALANCE_USD = Decimal("0.02")
NEMOTRON_MAX_COST_USD = Decimal("0.01")
NEMOTRON_WORST_CASE_COST_USD = Decimal("0.00289152")


class SponsorPathError(RuntimeError):
    """Bounded sponsor-path failure without provider detail."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def sponsor_preflight(environ: Mapping[str, str] | None = None) -> dict[str, object]:
    """Return redacted readiness for one three-provider product run."""

    source = dict(os.environ if environ is None else environ)
    settings = {
        provider: _provider_settings(source, provider) for provider in Provider
    }
    reports = {
        provider.value: build_preflight_report(value).providers[provider.value]
        for provider, value in settings.items()
    }
    balance = _confirmed_balance(source.get("SCULLY_CONFIRMED_NEBIUS_BALANCE_USD"))
    tavily_overage_confirmed = _confirmed(
        source.get("SCULLY_TAVILY_OVERAGE_STATUS_CONFIRMED")
    )
    sandbox_unknown_cost_accepted = _confirmed(
        source.get("SCULLY_SANDBOX_UNKNOWN_COST_UNIT_ACCEPTED")
    )
    providers_ready = all(report.live_gate_open for report in reports.values())
    ready = (
        providers_ready
        and balance is not None
        and balance >= MINIMUM_CONFIRMED_BALANCE_USD
        and tavily_overage_confirmed
        and sandbox_unknown_cost_accepted
    )
    return {
        "status": "ready" if ready else "blocked",
        "performs_provider_calls": False,
        "review_required": True,
        "providers": {
            name: {
                "package": report.package,
                "installed_version": report.installed_version,
                "package_matches_lock": report.package_matches_lock,
                "credentials_configured": report.credentials_configured,
                "budget_valid": report.budget_valid,
                "live_gate_open": report.live_gate_open,
            }
            for name, report in reports.items()
        },
        "one_run_budget": {
            "nemotron_requests": 1,
            "nemotron_calculated_worst_case_cost_usd": format(
                NEMOTRON_WORST_CASE_COST_USD,
                "f",
            ),
            "nemotron_hard_cost_cap_usd": format(NEMOTRON_MAX_COST_USD, "f"),
            "tavily_searches": 1,
            "tavily_credits": 1,
            "sandbox_operations": 5,
            "automatic_retries": 0,
            "timeout_seconds_per_provider_operation": 60,
        },
        "confirmed_nebius_balance_sufficient": (
            balance is not None and balance >= MINIMUM_CONFIRMED_BALANCE_USD
        ),
        "tavily_overage_status_confirmed": tavily_overage_confirmed,
        "sandbox_reported_cost_unit": "unknown",
        "sandbox_unknown_cost_unit_accepted_for_one_run": (
            sandbox_unknown_cost_accepted
        ),
        "sandbox_retention_policy": (
            "single-use untagged states, fixed synthetic data, no reuse, "
            "no production or customer data"
        ),
    }


def run_sponsor_path(
    repository_root: Path,
    *,
    run_id: str,
    searcher: TavilyAdapter,
    planner_factory: Callable[
        [tuple[ResearchContextSource, ...]], PlanningAdapter
    ],
    executor: ExecutionAdapter,
) -> dict[str, object]:
    """Run search, planning, execution, evaluation, and export once."""

    if SPONSOR_RUN_PATTERN.fullmatch(run_id) is None:
        raise SponsorPathError("sponsor_run_id_invalid")

    try:
        research = searcher.search(
            investigation_id=run_id,
            query=SPONSOR_QUERY,
            include_domains=SPONSOR_DOMAINS,
        )
    except Exception as error:
        raise SponsorPathError("tavily_stage_failed") from error
    if not research.sources:
        raise SponsorPathError("tavily_sources_empty")
    try:
        sources = tuple(
            ResearchContextSource(
                title=source.title,
                canonical_url=source.canonical_url,
            )
            for source in research.sources
        )
    except Exception as error:
        raise SponsorPathError("tavily_context_invalid") from error
    planner = planner_factory(sources)

    with tempfile.TemporaryDirectory() as temporary:
        database = Database(Path(temporary) / "scully.db")
        database.initialize()
        capsules = CapsuleRepository(database)
        artifact_dir = Path(temporary) / "artifacts"
        try:
            CapsuleImporter(artifact_dir, capsules).import_path(
                repository_root / "fixtures" / "capsules" / "proxy-identity-collapse"
            )
            service = InvestigationService(
                capsules,
                InvestigationRepository(database),
                planner,
                executor,
                id_factory=lambda: run_id,
            )
            planned = service.create("proxy-identity-collapse-v2")
        except Exception as error:
            raise SponsorPathError("nemotron_stage_failed") from error
        try:
            completed = service.execute(planned.investigation_id)
        except Exception as error:
            raise SponsorPathError("sandbox_stage_failed") from error
        if completed.execution is None or completed.execution.supported_hypothesis_id is None:
            raise SponsorPathError("deterministic_evaluation_inconclusive")
        try:
            package = ReproductionPackager(
                repository_root / "fixtures" / "reproductions"
            ).build(completed)
            fingerprint = proof_fingerprint(
                package,
                expected_investigation_id=run_id,
                expected_signature_id=completed.execution.signature_id,
                expected_hypothesis_id=completed.execution.supported_hypothesis_id,
            )
        except Exception as error:
            raise SponsorPathError("export_stage_failed") from error

    planning_measurement = getattr(planner, "last_measurement", None)
    execution_measurement = getattr(executor, "last_measurement", None)
    if planning_measurement is None or execution_measurement is None:
        raise SponsorPathError("provider_measurement_missing")
    return _result_record(
        run_id,
        research,
        planning_measurement.to_record(),
        execution_measurement.to_record(),
        fingerprint,
        len(package),
    )


def run_live_sponsor_path(
    repository_root: Path,
    *,
    run_id: str,
    environ: Mapping[str, str] | None = None,
) -> dict[str, object]:
    """Construct the three reviewed live adapters and run once."""

    source = dict(os.environ if environ is None else environ)
    if source.get("SCULLY_APPROVED_SPONSOR_RUN_ID") != run_id:
        raise SponsorPathError("sponsor_run_not_approved")
    if sponsor_preflight(source)["status"] != "ready":
        raise SponsorPathError("sponsor_preflight_blocked")

    tavily_settings = _provider_settings(source, Provider.TAVILY)
    nemotron_settings = _provider_settings(source, Provider.NEMOTRON)
    sandbox_settings = _provider_settings(source, Provider.SANDBOX)
    with ExitStack() as stack:
        tavily_client = create_tavily_client(tavily_settings)
        stack.callback(tavily_client.close)
        nemotron_client = create_nemotron_client(nemotron_settings)
        stack.callback(nemotron_client.close)
        sandbox_client = create_sandbox_client(sandbox_settings)
        model_adapter = NemotronAdapter(
            nemotron_client.chat.completions,
            nemotron_settings,
        )
        executor = SandboxExecutionAdapter(
            SandboxAdapter(sandbox_client, sandbox_settings)
        )
        return run_sponsor_path(
            repository_root,
            run_id=run_id,
            searcher=TavilyAdapter(tavily_client, tavily_settings),
            planner_factory=lambda sources: NemotronPlanningAdapter(
                model_adapter,
                research_sources=sources,
            ),
            executor=executor,
        )


def _provider_settings(source: Mapping[str, str], provider: Provider) -> Settings:
    values = dict(source)
    values.update(
        {
            "SCULLY_ENABLE_LIVE": "true",
            "SCULLY_LIVE_PROVIDER": provider.value,
            "SCULLY_MAX_MODEL_CALLS": "1",
            "SCULLY_MAX_INPUT_TOKENS": "8192",
            "SCULLY_MAX_OUTPUT_TOKENS": "10000",
            "SCULLY_MAX_MODEL_COST_USD": "0.01",
            "SCULLY_MAX_TAVILY_CREDITS": "1",
            "SCULLY_MAX_SANDBOX_OPERATIONS": "5",
            "SCULLY_TIMEOUT_SECONDS": "60",
        }
    )
    return Settings.from_environment(values)


def _confirmed(value: str | None) -> bool:
    return value is not None and value.strip().lower() == "true"


def _confirmed_balance(value: str | None) -> Decimal | None:
    if value is None:
        return None
    try:
        balance = Decimal(value.strip())
    except InvalidOperation:
        return None
    return balance if balance.is_finite() and balance >= 0 else None


def _result_record(
    run_id: str,
    research: SearchOutcome,
    planning_measurement: dict[str, object],
    execution_measurement: dict[str, object],
    fingerprint: str,
    package_bytes: int,
) -> dict[str, object]:
    return {
        "run_id": run_id,
        "status": "verified",
        "source_count": len(research.sources),
        "canonical_source_urls": [
            source.canonical_url for source in research.sources
        ],
        "proof_fingerprint": fingerprint,
        "package_bytes": package_bytes,
        "measurements": {
            "tavily": research.measurement.to_record(),
            "nemotron": planning_measurement,
            "sandbox": execution_measurement,
        },
        "deterministic_evaluation": "one_supported_cause",
        "automatic_retries": 0,
    }
