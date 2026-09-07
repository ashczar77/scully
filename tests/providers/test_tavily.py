from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta

from scully.config import Settings
from scully.providers import ProviderContractError
from scully.providers.tavily import TavilyAdapter


class FakeTavilyClient:
    def __init__(self, response: object) -> None:
        self.response = response
        self.requests: list[tuple[str, dict[str, object]]] = []

    def search(self, query: str, **kwargs: object) -> object:
        self.requests.append((query, kwargs))
        return self.response


def search_response() -> dict[str, object]:
    return {
        "query": "Express trust proxy documentation",
        "results": [
            {
                "title": "Express behind proxies",
                "url": "https://expressjs.com/en/guide/behind-proxies.html",
                "content": "Configure the trust proxy application setting.",
                "score": 0.94,
            }
        ],
        "usage": {"credits": 1},
        "response_time": 0.2,
        "request_id": "fake-request-id",
    }


def live_settings() -> Settings:
    return Settings.from_environment(
        {
            "SCULLY_ENABLE_LIVE": "true",
            "TAVILY_API_KEY": "fake-tavily-key",
        }
    )


class TavilyAdapterTests(unittest.TestCase):
    def setUp(self) -> None:
        started = datetime(2026, 9, 7, 9, 0, tzinfo=UTC)
        self.times = iter([started, started + timedelta(seconds=0.25)])

    def test_uses_basic_search_and_preserves_source_provenance(self) -> None:
        client = FakeTavilyClient(search_response())
        adapter = TavilyAdapter(client, live_settings(), clock=self.times.__next__)

        outcome = adapter.search(
            investigation_id="provider-contract-001",
            query=" Express trust proxy documentation ",
            include_domains=("ExpressJS.com",),
        )

        self.assertEqual(outcome.query, "Express trust proxy documentation")
        self.assertEqual(
            outcome.sources[0].url,
            "https://expressjs.com/en/guide/behind-proxies.html",
        )
        self.assertEqual(outcome.measurement.tavily_credits, 1)
        query, options = client.requests[0]
        self.assertEqual(query, outcome.query)
        self.assertEqual(options["search_depth"], "basic")
        self.assertEqual(options["include_domains"], ["expressjs.com"])
        self.assertFalse(options["auto_parameters"])
        self.assertFalse(options["include_answer"])
        self.assertFalse(options["include_raw_content"])
        self.assertTrue(options["include_usage"])

    def test_rejects_missing_usage_metadata(self) -> None:
        response = search_response()
        del response["usage"]
        adapter = TavilyAdapter(
            FakeTavilyClient(response),
            live_settings(),
            clock=self.times.__next__,
        )

        with self.assertRaisesRegex(ProviderContractError, "missing usage"):
            adapter.search(
                investigation_id="provider-contract-001",
                query="Express proxy documentation",
            )

    def test_rejects_result_without_web_provenance(self) -> None:
        response = search_response()
        response["results"][0]["url"] = "file:///private/result"
        adapter = TavilyAdapter(
            FakeTavilyClient(response),
            live_settings(),
            clock=self.times.__next__,
        )

        with self.assertRaisesRegex(ProviderContractError, "HTTP or HTTPS"):
            adapter.search(
                investigation_id="provider-contract-001",
                query="Express proxy documentation",
            )

    def test_rejects_web_scheme_without_network_location(self) -> None:
        response = search_response()
        response["results"][0]["url"] = "https:local-result"
        adapter = TavilyAdapter(
            FakeTavilyClient(response),
            live_settings(),
            clock=self.times.__next__,
        )

        with self.assertRaisesRegex(ProviderContractError, "HTTP or HTTPS"):
            adapter.search(
                investigation_id="provider-contract-001",
                query="Express proxy documentation",
            )

    def test_rejects_query_over_400_characters_before_request(self) -> None:
        client = FakeTavilyClient(search_response())
        adapter = TavilyAdapter(client, live_settings(), clock=self.times.__next__)

        with self.assertRaisesRegex(ValueError, "400"):
            adapter.search(
                investigation_id="provider-contract-001",
                query="q" * 401,
            )
        self.assertEqual(client.requests, [])

    def test_rejects_invalid_include_domain_before_request(self) -> None:
        client = FakeTavilyClient(search_response())
        adapter = TavilyAdapter(client, live_settings(), clock=self.times.__next__)

        with self.assertRaisesRegex(ValueError, "include domain"):
            adapter.search(
                investigation_id="provider-contract-001",
                query="Express proxy documentation",
                include_domains=("https://expressjs.com",),
            )
        self.assertEqual(client.requests, [])

    def test_rejects_result_outside_requested_domains(self) -> None:
        response = search_response()
        response["results"][0]["url"] = "https://example.com/proxy"
        adapter = TavilyAdapter(
            FakeTavilyClient(response),
            live_settings(),
            clock=self.times.__next__,
        )

        with self.assertRaisesRegex(ProviderContractError, "requested domains"):
            adapter.search(
                investigation_id="provider-contract-001",
                query="Express proxy documentation",
                include_domains=("expressjs.com",),
            )

    def test_rejects_missing_investigation_id_before_request(self) -> None:
        client = FakeTavilyClient(search_response())
        adapter = TavilyAdapter(client, live_settings(), clock=self.times.__next__)

        with self.assertRaisesRegex(ValueError, "investigation_id"):
            adapter.search(investigation_id="", query="Express documentation")
        self.assertEqual(client.requests, [])

    def test_rejects_oversized_result_content(self) -> None:
        response = search_response()
        response["results"][0]["content"] = "x" * 5_001
        adapter = TavilyAdapter(
            FakeTavilyClient(response),
            live_settings(),
            clock=self.times.__next__,
        )

        with self.assertRaisesRegex(ProviderContractError, "size cap"):
            adapter.search(
                investigation_id="provider-contract-001",
                query="Express proxy documentation",
            )


if __name__ == "__main__":
    unittest.main()
