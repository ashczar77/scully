from __future__ import annotations

import json
import unittest
from datetime import UTC, datetime, timedelta
from unittest.mock import Mock

from scully.config import ConfigurationError, Settings
from scully.probes.tavily import PROBE_DOMAINS, PROBE_QUERY, run_probe


class FakeTavilyClient:
    def __init__(self, response: object | Exception) -> None:
        self.response = response
        self.requests: list[tuple[str, dict[str, object]]] = []
        self.closed = False

    def search(self, query: str, **kwargs: object) -> object:
        self.requests.append((query, kwargs))
        if isinstance(self.response, Exception):
            raise self.response
        return self.response

    def close(self) -> None:
        self.closed = True


def search_response() -> dict[str, object]:
    return {
        "query": PROBE_QUERY,
        "results": [
            {
                "title": "Express behind proxies",
                "url": "https://expressjs.com/en/guide/behind-proxies.html",
                "content": "Sensitive returned snippet not for the record.",
                "score": 0.94,
            }
        ],
        "usage": {"credits": 1},
        "response_time": 0.31,
        "request_id": "sensitive-request-identifier",
    }


def live_settings(**overrides: str) -> Settings:
    values = {
        "SCULLY_ENABLE_LIVE": "true",
        "TAVILY_API_KEY": "test-tavily-key",
    }
    values.update(overrides)
    return Settings.from_environment(values)


def clock() -> object:
    started = datetime(2026, 9, 7, 19, 0, tzinfo=UTC)
    return iter(
        [
            started,
            started + timedelta(seconds=0.1),
            started + timedelta(seconds=0.4),
            started + timedelta(seconds=0.5),
        ]
    ).__next__


class TavilyProbeTests(unittest.TestCase):
    def test_success_record_retains_provenance_without_returned_text(self) -> None:
        client = FakeTavilyClient(search_response())

        record = run_probe(
            live_settings(),
            client_factory=lambda settings: client,
            clock=clock(),
        )
        encoded = json.dumps(record)

        self.assertEqual(record["status"], "succeeded")
        self.assertEqual(record["source_count"], 1)
        self.assertEqual(record["measurement"]["tavily_credits"], 1)
        self.assertTrue(record["request_id_observed"])
        self.assertEqual(record["provider_response_time_seconds"], 0.31)
        self.assertEqual(len(client.requests), 1)
        query, options = client.requests[0]
        self.assertEqual(query, PROBE_QUERY)
        self.assertEqual(options["include_domains"], list(PROBE_DOMAINS))
        self.assertEqual(options["search_depth"], "basic")
        self.assertEqual(options["max_results"], 5)
        self.assertFalse(options["auto_parameters"])
        self.assertFalse(options["include_answer"])
        self.assertFalse(options["include_raw_content"])
        self.assertFalse(options["include_images"])
        self.assertTrue(options["include_usage"])
        self.assertNotIn("Sensitive returned snippet", encoded)
        self.assertNotIn("sensitive-request-identifier", encoded)
        self.assertNotIn(PROBE_QUERY, encoded)
        self.assertTrue(client.closed)

    def test_closed_preflight_blocks_before_client_construction(self) -> None:
        factory = Mock()

        with self.assertRaisesRegex(ConfigurationError, "preflight"):
            run_probe(Settings.from_environment({}), client_factory=factory)

        factory.assert_not_called()

    def test_request_failure_is_redacted_and_client_is_closed(self) -> None:
        client = FakeTavilyClient(RuntimeError("sensitive provider message"))

        record = run_probe(
            live_settings(),
            client_factory=lambda settings: client,
            clock=clock(),
        )
        encoded = json.dumps(record)

        self.assertEqual(record["status"], "failed")
        self.assertEqual(record["failure_stage"], "request")
        self.assertEqual(record["measurement"]["request_count"], 1)
        self.assertNotIn("sensitive provider message", encoded)
        self.assertTrue(client.closed)

    def test_contract_failure_preserves_safe_structure_and_usage(self) -> None:
        response = search_response()
        response["results"][0]["url"] = "file:///private/result"
        client = FakeTavilyClient(response)

        record = run_probe(
            live_settings(),
            client_factory=lambda settings: client,
            clock=clock(),
        )

        self.assertEqual(record["status"], "failed")
        self.assertEqual(record["failure_stage"], "contract_validation")
        self.assertEqual(record["result_count"], 1)
        self.assertTrue(record["usage_observed"])
        self.assertEqual(record["measurement"]["tavily_credits"], 1)
        self.assertTrue(client.closed)

    def test_empty_result_is_a_redacted_contract_failure(self) -> None:
        response = search_response()
        response["results"] = []
        client = FakeTavilyClient(response)

        record = run_probe(
            live_settings(),
            client_factory=lambda settings: client,
            clock=clock(),
        )

        self.assertEqual(record["status"], "failed")
        self.assertEqual(record["failure_stage"], "contract_validation")
        self.assertEqual(record["result_count"], 0)
        self.assertTrue(record["usage_observed"])
        self.assertEqual(record["measurement"]["tavily_credits"], 1)
        self.assertTrue(client.closed)


if __name__ == "__main__":
    unittest.main()
