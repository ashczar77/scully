from __future__ import annotations

import io
import json
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

from scully.config import Settings
from scully.dependencies import LOCKED_PROVIDER_VERSIONS
from scully.preflight import build_preflight_report, main


class PreflightTests(unittest.TestCase):
    def test_default_report_is_closed_and_contains_no_secrets(self) -> None:
        secret = "secret-value-that-must-not-appear"
        settings = Settings.from_environment(
            {
                "NEBIUS_API_KEY": secret,
                "NEBIUS_PROJECT_ID": secret,
                "TAVILY_API_KEY": secret,
            }
        )

        report = build_preflight_report(settings).to_dict()
        encoded = json.dumps(report)

        self.assertFalse(report["performs_provider_calls"])
        self.assertFalse(report["live_enabled"])
        self.assertNotIn(secret, encoded)
        self.assertFalse(report["providers"]["nemotron"]["live_gate_open"])

    def test_ready_configuration_reports_each_open_gate(self) -> None:
        settings = Settings.from_environment(
            {
                "SCULLY_ENABLE_LIVE": "true",
                "SCULLY_MAX_SANDBOX_OPERATIONS": "4",
                "NEBIUS_API_KEY": "test-key",
                "NEBIUS_PROJECT_ID": "test-project",
                "TAVILY_API_KEY": "test-key",
            }
        )

        with patch(
            "scully.preflight.installed_version",
            side_effect=lambda package: LOCKED_PROVIDER_VERSIONS[package],
        ):
            report = build_preflight_report(settings)

        self.assertTrue(
            all(item.live_gate_open for item in report.providers.values())
        )
        self.assertEqual(report.worst_case_model_cost_usd, "0.00073728")

    def test_sandbox_budget_is_closed_at_offline_default(self) -> None:
        settings = Settings.from_environment(
            {
                "SCULLY_ENABLE_LIVE": "true",
                "NEBIUS_API_KEY": "test-key",
                "NEBIUS_PROJECT_ID": "test-project",
            }
        )

        report = build_preflight_report(settings)

        self.assertFalse(report.providers["sandbox"].budget_valid)
        self.assertFalse(report.providers["sandbox"].live_gate_open)

    def test_cli_prints_json_without_constructing_a_client(self) -> None:
        output = io.StringIO()
        with (
            patch.dict("os.environ", {}, clear=True),
            patch(
                "scully.providers.clients.create_nemotron_client"
            ) as nemotron_client,
            patch("scully.providers.clients.create_tavily_client") as tavily_client,
            patch(
                "scully.providers.clients.create_sandbox_client"
            ) as sandbox_client,
            redirect_stdout(output),
        ):
            result = main()

        self.assertEqual(result, 0)
        self.assertFalse(json.loads(output.getvalue())["performs_provider_calls"])
        nemotron_client.assert_not_called()
        tavily_client.assert_not_called()
        sandbox_client.assert_not_called()


if __name__ == "__main__":
    unittest.main()
