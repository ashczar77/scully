from __future__ import annotations

import json
import unittest
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import Mock

from scully.config import ConfigurationError, Settings
from scully.probes.nemotron import EXPECTED_ARGUMENT_FIELDS, run_probe


class FakeRawResponse:
    def __init__(self, parsed: object) -> None:
        self.headers = {
            "content-type": "application/json",
            "x-ratelimit-remaining-requests": "9",
        }
        self._parsed = parsed

    def parse(self) -> object:
        return self._parsed


class FakeRawEndpoint:
    def __init__(self, response: object | Exception) -> None:
        self.response = response
        self.requests: list[dict[str, object]] = []

    def create(self, **kwargs: object) -> object:
        self.requests.append(kwargs)
        if isinstance(self.response, Exception):
            raise self.response
        return FakeRawResponse(self.response)


class FakeRootClient:
    def __init__(self, endpoint: FakeRawEndpoint) -> None:
        self.chat = SimpleNamespace(
            completions=SimpleNamespace(with_raw_response=endpoint)
        )
        self.closed = False

    def close(self) -> None:
        self.closed = True


def completion() -> object:
    arguments = {
        "hypothesis": "untrusted forwarding data controls the client identity",
        "mechanism": "the direct path accepts a caller-supplied address",
        "next_check": "compare direct and trusted-proxy requests",
        "confidence": "high",
    }
    function = SimpleNamespace(
        name="record_incident_hypothesis",
        arguments=json.dumps(arguments),
    )
    choice = SimpleNamespace(
        message=SimpleNamespace(
            tool_calls=[SimpleNamespace(function=function)]
        ),
        finish_reason="tool_calls",
    )
    return SimpleNamespace(
        choices=[choice],
        usage=SimpleNamespace(prompt_tokens=180, completion_tokens=45),
    )


def live_settings() -> Settings:
    return Settings.from_environment(
        {
            "SCULLY_ENABLE_LIVE": "true",
            "SCULLY_LIVE_PROVIDER": "nemotron",
            "SCULLY_MAX_OUTPUT_TOKENS": "10000",
            "NEBIUS_API_KEY": "test-nebius-key",
        }
    )


def clock() -> object:
    started = datetime(2026, 9, 7, 10, 0, tzinfo=UTC)
    return iter(
        [
            started,
            started + timedelta(seconds=0.1),
            started + timedelta(seconds=0.4),
            started + timedelta(seconds=0.5),
        ]
    ).__next__


class NemotronProbeTests(unittest.TestCase):
    def test_success_record_excludes_generated_values(self) -> None:
        endpoint = FakeRawEndpoint(completion())
        client = FakeRootClient(endpoint)

        record = run_probe(
            live_settings(),
            client_factory=lambda settings: client,
            clock=clock(),
        )
        encoded = json.dumps(record)

        self.assertEqual(record["status"], "succeeded")
        self.assertEqual(record["argument_fields"], list(EXPECTED_ARGUMENT_FIELDS))
        self.assertEqual(len(endpoint.requests), 1)
        self.assertEqual(endpoint.requests[0]["max_tokens"], 10_000)
        self.assertEqual(endpoint.requests[0]["temperature"], 0.6)
        self.assertEqual(endpoint.requests[0]["top_p"], 0.95)
        self.assertFalse(endpoint.requests[0]["parallel_tool_calls"])
        self.assertTrue(client.closed)
        self.assertIn("x-ratelimit-remaining-requests", encoded)
        self.assertNotIn("untrusted forwarding data", encoded)
        self.assertEqual(record["measurement"]["retries"], 0)

    def test_closed_preflight_blocks_before_client_construction(self) -> None:
        factory = Mock()

        with self.assertRaisesRegex(ConfigurationError, "preflight"):
            run_probe(
                Settings.from_environment({"NEBIUS_API_KEY": "test-key"}),
                client_factory=factory,
            )

        factory.assert_not_called()

    def test_failure_record_is_redacted_and_client_is_closed(self) -> None:
        endpoint = FakeRawEndpoint(RuntimeError("sensitive provider message"))
        client = FakeRootClient(endpoint)

        record = run_probe(
            live_settings(),
            client_factory=lambda settings: client,
            clock=clock(),
        )
        encoded = json.dumps(record)

        self.assertEqual(record["status"], "failed")
        self.assertEqual(record["error_type"], "RuntimeError")
        self.assertEqual(record["measurement"]["request_count"], 1)
        self.assertNotIn("sensitive provider message", encoded)
        self.assertTrue(client.closed)

    def test_contract_failure_preserves_usage_and_safe_reason(self) -> None:
        parsed = completion()
        parsed.choices[0].message.tool_calls = []
        endpoint = FakeRawEndpoint(parsed)
        client = FakeRootClient(endpoint)

        record = run_probe(
            live_settings(),
            client_factory=lambda settings: client,
            clock=clock(),
        )

        self.assertEqual(record["status"], "failed")
        self.assertEqual(record["failure_stage"], "contract_validation")
        self.assertEqual(record["contract_failure"], "tool_call_count")
        self.assertEqual(record["finish_reason"], "tool_calls")
        self.assertEqual(record["tool_call_count"], 0)
        self.assertTrue(record["usage_observed"])
        self.assertEqual(record["measurement"]["input_tokens"], 180)
        self.assertEqual(record["measurement"]["output_tokens"], 45)
        self.assertEqual(record["measurement"]["model_cost_usd"], "0.0000216")


if __name__ == "__main__":
    unittest.main()
