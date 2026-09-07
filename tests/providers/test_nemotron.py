from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from scully.config import ConfigurationError, Settings
from scully.providers import ProviderContractError
from scully.providers.nemotron import NemotronAdapter, ToolDefinition


class FakeCompletions:
    def __init__(self, response: object) -> None:
        self.response = response
        self.requests: list[dict[str, object]] = []

    def create(self, **kwargs: object) -> object:
        self.requests.append(kwargs)
        return self.response


def tool_definition() -> ToolDefinition:
    return ToolDefinition(
        name="search_documentation",
        description="Search version-specific technical documentation.",
        parameters={
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"],
            "additionalProperties": False,
        },
    )


def completion(arguments: str = '{"query":"proxy trust setting"}') -> object:
    function = SimpleNamespace(name="search_documentation", arguments=arguments)
    tool_call = SimpleNamespace(function=function)
    message = SimpleNamespace(tool_calls=[tool_call])
    choice = SimpleNamespace(message=message, finish_reason="tool_calls")
    usage = SimpleNamespace(prompt_tokens=120, completion_tokens=30)
    return SimpleNamespace(choices=[choice], usage=usage)


def live_settings(**overrides: str) -> Settings:
    values = {
        "SCULLY_ENABLE_LIVE": "true",
        "NEBIUS_API_KEY": "fake-nebius-key",
    }
    values.update(overrides)
    return Settings.from_environment(values)


class NemotronAdapterTests(unittest.TestCase):
    def setUp(self) -> None:
        started = datetime(2026, 9, 7, 9, 0, tzinfo=UTC)
        self.times = iter([started, started + timedelta(seconds=0.5)])

    def test_builds_bounded_request_and_normalizes_tool_call(self) -> None:
        client = FakeCompletions(completion())
        adapter = NemotronAdapter(client, live_settings(), clock=self.times.__next__)

        outcome = adapter.invoke_tool(
            investigation_id="provider-contract-001",
            prompt="Find the relevant proxy documentation.",
            tool=tool_definition(),
        )

        self.assertEqual(outcome.tool_name, "search_documentation")
        self.assertEqual(outcome.arguments, {"query": "proxy trust setting"})
        self.assertEqual(outcome.measurement.input_tokens, 120)
        self.assertEqual(outcome.measurement.output_tokens, 30)
        request = client.requests[0]
        self.assertEqual(request["service_tier"], "default")
        self.assertEqual(request["max_tokens"], 1_024)
        self.assertEqual(request["n"], 1)
        self.assertFalse(request["parallel_tool_calls"])
        self.assertFalse(request["stream"])
        self.assertFalse(request["store"])

    def test_tool_schema_must_prohibit_additional_properties(self) -> None:
        with self.assertRaisesRegex(ValueError, "additional properties"):
            ToolDefinition(
                name="search_documentation",
                description="Search documentation.",
                parameters={"type": "object", "properties": {}},
            )

    def test_tool_schema_must_define_every_required_property(self) -> None:
        with self.assertRaisesRegex(ValueError, "required tool field"):
            ToolDefinition(
                name="search_documentation",
                description="Search documentation.",
                parameters={
                    "type": "object",
                    "properties": {},
                    "required": ["query"],
                    "additionalProperties": False,
                },
            )

    def test_rejects_invalid_tool_argument_json(self) -> None:
        adapter = NemotronAdapter(
            FakeCompletions(completion("not-json")),
            live_settings(),
            clock=self.times.__next__,
        )

        with self.assertRaisesRegex(ProviderContractError, "not valid JSON"):
            adapter.invoke_tool(
                investigation_id="provider-contract-001",
                prompt="Find documentation.",
                tool=tool_definition(),
            )

    def test_rejects_non_finite_json_constant(self) -> None:
        adapter = NemotronAdapter(
            FakeCompletions(completion('{"query":NaN}')),
            live_settings(),
            clock=self.times.__next__,
        )

        with self.assertRaisesRegex(ProviderContractError, "not valid JSON"):
            adapter.invoke_tool(
                investigation_id="provider-contract-001",
                prompt="Find documentation.",
                tool=tool_definition(),
            )

    def test_rejects_unexpected_tool_arguments(self) -> None:
        adapter = NemotronAdapter(
            FakeCompletions(
                completion('{"query":"proxy","unapproved":"value"}')
            ),
            live_settings(),
            clock=self.times.__next__,
        )

        with self.assertRaisesRegex(ProviderContractError, "unexpected fields"):
            adapter.invoke_tool(
                investigation_id="provider-contract-001",
                prompt="Find documentation.",
                tool=tool_definition(),
            )

    def test_rejects_tool_argument_with_wrong_type(self) -> None:
        adapter = NemotronAdapter(
            FakeCompletions(completion('{"query":42}')),
            live_settings(),
            clock=self.times.__next__,
        )

        with self.assertRaisesRegex(ProviderContractError, "wrong type"):
            adapter.invoke_tool(
                investigation_id="provider-contract-001",
                prompt="Find documentation.",
                tool=tool_definition(),
            )

    def test_rejects_multiple_completion_choices(self) -> None:
        response = completion()
        response.choices.append(response.choices[0])
        adapter = NemotronAdapter(
            FakeCompletions(response), live_settings(), clock=self.times.__next__
        )

        with self.assertRaisesRegex(ProviderContractError, "one completion choice"):
            adapter.invoke_tool(
                investigation_id="provider-contract-001",
                prompt="Find documentation.",
                tool=tool_definition(),
            )

    def test_blocks_request_when_worst_case_cost_exceeds_cap(self) -> None:
        client = FakeCompletions(completion())
        adapter = NemotronAdapter(
            client,
            live_settings(SCULLY_MAX_MODEL_COST_USD="0.000001"),
            clock=self.times.__next__,
        )

        with self.assertRaisesRegex(ConfigurationError, "Worst-case model cost"):
            adapter.invoke_tool(
                investigation_id="provider-contract-001",
                prompt="Find documentation.",
                tool=tool_definition(),
            )
        self.assertEqual(client.requests, [])

    def test_rejects_missing_investigation_id_before_request(self) -> None:
        client = FakeCompletions(completion())
        adapter = NemotronAdapter(client, live_settings(), clock=self.times.__next__)

        with self.assertRaisesRegex(ValueError, "investigation_id"):
            adapter.invoke_tool(
                investigation_id=" ",
                prompt="Find documentation.",
                tool=tool_definition(),
            )
        self.assertEqual(client.requests, [])


if __name__ == "__main__":
    unittest.main()
