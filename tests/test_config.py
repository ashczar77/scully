from __future__ import annotations

import unittest
from decimal import Decimal

from scully.config import ConfigurationError, ModelPricing, Provider, Settings


class SettingsTests(unittest.TestCase):
    def test_offline_defaults_are_bounded(self) -> None:
        settings = Settings.from_environment({})

        self.assertFalse(settings.live_enabled)
        self.assertIsNone(settings.live_provider)
        self.assertEqual(settings.budget.max_model_calls, 1)
        self.assertEqual(settings.budget.max_model_cost_usd, Decimal("0.01"))
        self.assertEqual(settings.budget.max_tavily_credits, 1)
        self.assertEqual(settings.budget.max_sandbox_operations, 1)
        self.assertEqual(
            settings.nemotron_pricing.cost(1_000_000, 1_000_000),
            Decimal("0.30"),
        )

    def test_secrets_are_redacted_from_representations(self) -> None:
        marker = "sensitive-token-marker"
        settings = Settings.from_environment(
            {
                "NEBIUS_API_KEY": marker,
                "NEBIUS_PROJECT_ID": "sensitive-project-marker",
                "TAVILY_API_KEY": "sensitive-tavily-marker",
                "TAVILY_PROJECT": "sensitive-tavily-project-marker",
            }
        )

        self.assertNotIn(marker, repr(settings))
        self.assertEqual(str(settings.nebius_api_key), "<redacted>")
        self.assertNotIn(marker, repr(settings.nebius_api_key))
        self.assertNotIn("sensitive-tavily-project-marker", repr(settings))

    def test_live_provider_access_is_disabled_by_default(self) -> None:
        settings = Settings.from_environment({"NEBIUS_API_KEY": "test-value"})

        with self.assertRaisesRegex(ConfigurationError, "SCULLY_ENABLE_LIVE"):
            settings.assert_live_ready(Provider.NEMOTRON)

    def test_live_provider_requires_its_own_credentials(self) -> None:
        nemotron_settings = Settings.from_environment(
            {
                "SCULLY_ENABLE_LIVE": "true",
                "SCULLY_LIVE_PROVIDER": "nemotron",
                "NEBIUS_API_KEY": "test-value",
            }
        )
        tavily_settings = Settings.from_environment(
            {
                "SCULLY_ENABLE_LIVE": "true",
                "SCULLY_LIVE_PROVIDER": "tavily",
                "NEBIUS_API_KEY": "test-value",
            }
        )

        nemotron_settings.assert_live_ready(Provider.NEMOTRON)
        with self.assertRaisesRegex(ConfigurationError, "TAVILY_API_KEY"):
            tavily_settings.assert_live_ready(Provider.TAVILY)

    def test_sandbox_accepts_legacy_project_environment_name(self) -> None:
        settings = Settings.from_environment(
            {
                "SCULLY_ENABLE_LIVE": "true",
                "SCULLY_LIVE_PROVIDER": "sandbox",
                "NEBIUS_API_KEY": "test-value",
                "CONTREE_PROJECT": "test-project",
            }
        )

        settings.assert_live_ready(Provider.SANDBOX)

    def test_blank_primary_project_name_uses_legacy_name(self) -> None:
        settings = Settings.from_environment(
            {
                "SCULLY_ENABLE_LIVE": "true",
                "SCULLY_LIVE_PROVIDER": "sandbox",
                "NEBIUS_API_KEY": "test-value",
                "NEBIUS_PROJECT_ID": "   ",
                "CONTREE_PROJECT": "test-project",
            }
        )

        settings.assert_live_ready(Provider.SANDBOX)

    def test_conflicting_project_names_fail_closed(self) -> None:
        with self.assertRaisesRegex(ConfigurationError, "same project"):
            Settings.from_environment(
                {
                    "NEBIUS_PROJECT_ID": "project-one",
                    "CONTREE_PROJECT": "project-two",
                }
            )

    def test_invalid_boolean_fails_closed(self) -> None:
        with self.assertRaisesRegex(ConfigurationError, "true or false"):
            Settings.from_environment({"SCULLY_ENABLE_LIVE": "sometimes"})

    def test_live_provider_target_is_required(self) -> None:
        settings = Settings.from_environment(
            {"SCULLY_ENABLE_LIVE": "true", "NEBIUS_API_KEY": "test-value"}
        )

        with self.assertRaisesRegex(ConfigurationError, "Live provider target"):
            settings.assert_live_ready(Provider.NEMOTRON)

    def test_other_live_provider_target_fails_closed(self) -> None:
        settings = Settings.from_environment(
            {
                "SCULLY_ENABLE_LIVE": "true",
                "SCULLY_LIVE_PROVIDER": "tavily",
                "NEBIUS_API_KEY": "test-value",
            }
        )

        with self.assertRaisesRegex(ConfigurationError, "not nemotron"):
            settings.assert_live_ready(Provider.NEMOTRON)

    def test_invalid_live_provider_target_fails_closed(self) -> None:
        with self.assertRaisesRegex(ConfigurationError, "must be one of"):
            Settings.from_environment({"SCULLY_LIVE_PROVIDER": "unknown"})

    def test_non_positive_budget_fails_closed(self) -> None:
        with self.assertRaisesRegex(ConfigurationError, "greater than zero"):
            Settings.from_environment({"SCULLY_MAX_MODEL_CALLS": "0"})

    def test_unknown_provider_fails_closed(self) -> None:
        settings = Settings.from_environment({"SCULLY_ENABLE_LIVE": "true"})

        with self.assertRaisesRegex(ConfigurationError, "Unsupported provider"):
            settings.assert_live_ready("unknown")  # type: ignore[arg-type]

    def test_negative_model_price_fails_closed(self) -> None:
        with self.assertRaisesRegex(ConfigurationError, "non-negative"):
            ModelPricing(input_per_million_usd=Decimal("-1"))


if __name__ == "__main__":
    unittest.main()
