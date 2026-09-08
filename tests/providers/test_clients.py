from __future__ import annotations

import unittest
from unittest.mock import patch

from scully.config import ConfigurationError, Settings
from scully.providers.clients import (
    TOKEN_FACTORY_BASE_URL,
    create_nemotron_client,
    create_sandbox_client,
    create_tavily_client,
)


def settings_for_clients(provider: str = "nemotron") -> Settings:
    return Settings.from_environment(
        {
            "SCULLY_ENABLE_LIVE": "true",
            "SCULLY_LIVE_PROVIDER": provider,
            "NEBIUS_API_KEY": "test-nebius-key",
            "NEBIUS_PROJECT_ID": "test-nebius-project",
            "TAVILY_API_KEY": "test-tavily-key",
            "TAVILY_PROJECT": "test-tavily-project",
        }
    )


class ProviderClientTests(unittest.TestCase):
    def test_live_gate_blocks_client_construction(self) -> None:
        settings = Settings.from_environment({"NEBIUS_API_KEY": "test-key"})

        with self.assertRaisesRegex(ConfigurationError, "SCULLY_ENABLE_LIVE"):
            create_nemotron_client(settings)

    def test_dependency_mismatch_blocks_client_construction(self) -> None:
        with (
            patch(
                "scully.dependencies.installed_version",
                return_value="unexpected-version",
            ),
            self.assertRaisesRegex(ConfigurationError, "reviewed version"),
        ):
            create_nemotron_client(settings_for_clients("nemotron"))

    def test_constructs_nemotron_client_without_request(self) -> None:
        client = create_nemotron_client(settings_for_clients("nemotron"))
        self.addCleanup(client.close)

        self.assertEqual(str(client.base_url), TOKEN_FACTORY_BASE_URL)
        self.assertEqual(client.max_retries, 0)

    def test_constructs_tavily_client_without_request(self) -> None:
        client = create_tavily_client(settings_for_clients("tavily"))

        self.assertEqual(client.base_url, "https://api.tavily.com")
        self.assertIn("X-Project-ID", client.headers)
        self.assertEqual(client.headers["X-Client-Source"], "scully")

    def test_constructs_sandbox_client_without_request(self) -> None:
        client = create_sandbox_client(settings_for_clients("sandbox"))

        self.assertEqual(client.config.transport_timeout, 60.0)
        self.assertEqual(client.config.operation_timeout, 60.0)
        self.assertEqual(type(client.config.auth).__name__, "IAMAuth")


if __name__ == "__main__":
    unittest.main()
