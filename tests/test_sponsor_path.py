from __future__ import annotations

import json
import unittest
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from scully.application.execution import SandboxExecutionAdapter
from scully.application.planning import EXPERIMENT_VARIANTS, NemotronPlanningAdapter
from scully.config import Provider
from scully.dependencies import LOCKED_PROVIDER_VERSIONS
from scully.measurement import Measurement, OperationStatus
from scully.providers.nemotron import ToolCallOutcome
from scully.providers.tavily import SearchOutcome, SearchSource
from scully.sponsor_path import (
    SponsorPathError,
    run_live_sponsor_path,
    run_sponsor_path,
    sponsor_preflight,
)


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
STARTED = datetime(2026, 9, 12, 10, 0, tzinfo=UTC)
ENDED = STARTED + timedelta(seconds=1)


class SponsorPathTests(unittest.TestCase):
    def test_preflight_is_redacted_and_requires_manual_cost_confirmations(self) -> None:
        environment = _ready_environment()
        del environment["SCULLY_TAVILY_OVERAGE_STATUS_CONFIRMED"]
        secret = environment["NEBIUS_API_KEY"]

        with patch(
            "scully.preflight.installed_version",
            side_effect=lambda package: LOCKED_PROVIDER_VERSIONS[package],
        ):
            report = sponsor_preflight(environment)

        self.assertEqual(report["status"], "blocked")
        self.assertFalse(report["performs_provider_calls"])
        self.assertFalse(report["tavily_overage_status_confirmed"])
        self.assertNotIn(secret, json.dumps(report))

    def test_ready_preflight_opens_each_exact_provider_budget(self) -> None:
        with patch(
            "scully.preflight.installed_version",
            side_effect=lambda package: LOCKED_PROVIDER_VERSIONS[package],
        ):
            report = sponsor_preflight(_ready_environment())

        self.assertEqual(report["status"], "ready")
        self.assertTrue(
            all(
                provider["live_gate_open"]
                for provider in report["providers"].values()
            )
        )
        self.assertEqual(report["one_run_budget"]["nemotron_requests"], 1)
        self.assertEqual(
            report["one_run_budget"]["nemotron_calculated_worst_case_cost_usd"],
            "0.00289152",
        )
        self.assertEqual(
            report["one_run_budget"]["nemotron_hard_cost_cap_usd"],
            "0.01",
        )
        self.assertEqual(report["one_run_budget"]["tavily_credits"], 1)
        self.assertEqual(report["one_run_budget"]["sandbox_operations"], 5)

    def test_unapproved_live_run_stops_before_client_construction(self) -> None:
        with (
            patch("scully.sponsor_path.create_tavily_client") as tavily,
            patch("scully.sponsor_path.create_nemotron_client") as nemotron,
            patch("scully.sponsor_path.create_sandbox_client") as sandbox,
        ):
            with self.assertRaises(SponsorPathError) as blocked:
                run_live_sponsor_path(
                    REPOSITORY_ROOT,
                    run_id="g4.4-sponsor-001",
                    environ=_ready_environment(),
                )

        self.assertEqual(blocked.exception.code, "sponsor_run_not_approved")
        tavily.assert_not_called()
        nemotron.assert_not_called()
        sandbox.assert_not_called()

    def test_offline_boundaries_complete_one_sponsor_product_path(self) -> None:
        searcher = FakeSearcher()
        executor = SandboxExecutionAdapter(FakeSandboxRunner())

        result = run_sponsor_path(
            REPOSITORY_ROOT,
            run_id="g4.4-sponsor-001",
            searcher=searcher,
            planner_factory=lambda sources: NemotronPlanningAdapter(
                FakeStructuredPlanner(),
                research_sources=sources,
            ),
            executor=executor,
        )

        self.assertEqual(result["status"], "verified")
        self.assertEqual(result["source_count"], 1)
        self.assertEqual(result["deterministic_evaluation"], "one_supported_cause")
        self.assertEqual(len(result["proof_fingerprint"]), 64)
        self.assertEqual(result["measurements"]["tavily"]["tavily_credits"], 1)
        self.assertEqual(result["measurements"]["nemotron"]["request_count"], 1)
        self.assertEqual(result["measurements"]["sandbox"]["sandbox_operations"], 5)


class FakeSearcher:
    def search(self, **unused_kwargs) -> SearchOutcome:
        return SearchOutcome(
            query="Express trust proxy documentation",
            sources=(
                SearchSource(
                    title="Express behind proxies",
                    url="https://expressjs.com/en/guide/behind-proxies.html",
                    canonical_url=(
                        "https://expressjs.com/en/guide/behind-proxies.html"
                    ),
                    content="Trust only the configured proxy boundary.",
                    score=0.95,
                ),
            ),
            measurement=_measurement(Provider.TAVILY, tavily_credits=1),
        )


class FakeStructuredPlanner:
    def invoke_tool(self, **unused_kwargs) -> ToolCallOutcome:
        hypotheses = []
        for index, variant in enumerate(EXPERIMENT_VARIANTS, start=1):
            hypotheses.append(
                {
                    "title": f"Alternative {index}",
                    "mechanism": f"Mechanism {index}",
                    "rationale": f"Rationale {index}",
                    "testable_prediction": f"Prediction {index}",
                    "evidence_ids": ["environment", "incident-observation"],
                    "confidence": [0.7, 0.2, 0.1][index - 1],
                    "experiment_variant": variant,
                }
            )
        return ToolCallOutcome(
            tool_name="record_investigation_plan",
            arguments={"hypotheses": hypotheses},
            finish_reason="stop",
            measurement=_measurement(
                Provider.NEMOTRON,
                input_tokens=500,
                output_tokens=900,
                model_cost_usd=Decimal("0.000246"),
            ),
        )


class FakeSandboxRunner:
    def run_branches(self, *, branches, **unused_kwargs):
        results = []
        for index, branch in enumerate(branches):
            fixed = branch.label == "trust-loopback"
            payload = {
                "responses": [200, 200] if fixed else [200, 429],
                "events": (
                    ["request_accepted", "request_accepted"]
                    if fixed
                    else ["request_accepted", "rate_limit_rejected"]
                ),
                "identity_digests": (
                    ["identity:test-net-client-a", "identity:test-net-client-b"]
                    if fixed
                    else ["identity:loopback-proxy", "identity:loopback-proxy"]
                ),
                "forwarded_clients": ["198.51.100.10", "198.51.100.11"],
            }
            results.append(
                SimpleNamespace(
                    label=branch.label,
                    image_id=f"branch-{index}",
                    stdout=json.dumps(payload),
                    exit_code=0,
                    elapsed_seconds=0.1,
                )
            )
        return SimpleNamespace(
            branches=tuple(results),
            parent_image_id="parent",
            measurement=_measurement(Provider.SANDBOX, sandbox_operations=5),
        )


def _measurement(
    provider: Provider,
    *,
    input_tokens: int = 0,
    output_tokens: int = 0,
    model_cost_usd: Decimal = Decimal("0"),
    tavily_credits: int = 0,
    sandbox_operations: int = 0,
) -> Measurement:
    return Measurement(
        investigation_id="g4.4-sponsor-001",
        provider=provider,
        operation="test",
        status=OperationStatus.SUCCEEDED,
        started_at=STARTED,
        ended_at=ENDED,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        model_cost_usd=model_cost_usd,
        tavily_credits=tavily_credits,
        sandbox_operations=sandbox_operations,
    )


def _ready_environment() -> dict[str, str]:
    return {
        "NEBIUS_API_KEY": "synthetic-nebius-secret",
        "NEBIUS_PROJECT_ID": "synthetic-project",
        "TAVILY_API_KEY": "synthetic-tavily-secret",
        "SCULLY_CONFIRMED_NEBIUS_BALANCE_USD": "25",
        "SCULLY_TAVILY_OVERAGE_STATUS_CONFIRMED": "true",
        "SCULLY_SANDBOX_UNKNOWN_COST_UNIT_ACCEPTED": "true",
    }


if __name__ == "__main__":
    unittest.main()
