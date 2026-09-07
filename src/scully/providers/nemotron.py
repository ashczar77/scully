"""Bounded Nemotron tool-call contract over an injected completion client."""

from __future__ import annotations

import json
import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol

from scully.config import ConfigurationError, Provider, Settings
from scully.measurement import Measurement, OperationStatus

from . import ProviderContractError
from ._contracts import (
    read_field,
    read_optional,
    require_investigation_id,
    require_nonnegative_int,
)


class CompletionClient(Protocol):
    """Subset of the OpenAI-compatible chat completions client used here."""

    def create(self, **kwargs: object) -> object:
        """Create one chat completion."""


@dataclass(frozen=True, slots=True)
class ToolDefinition:
    """One function tool described by an object-shaped JSON Schema."""

    name: str
    description: str
    parameters: Mapping[str, object]

    def __post_init__(self) -> None:
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", self.name):
            raise ValueError("Tool name must contain 1 to 64 safe characters")
        if not self.description.strip():
            raise ValueError("Tool description cannot be empty")
        if self.parameters.get("type") != "object":
            raise ValueError("Tool parameters must use an object JSON Schema")
        if self.parameters.get("additionalProperties") is not False:
            raise ValueError("Tool parameters must prohibit additional properties")
        properties = self.parameters.get("properties")
        if not isinstance(properties, Mapping):
            raise ValueError("Tool parameters must define object properties")
        required = self.parameters.get("required")
        if not isinstance(required, Sequence) or isinstance(required, (str, bytes)):
            raise ValueError("Tool parameters must define required field names")
        if any(not isinstance(name, str) for name in required):
            raise ValueError("Tool required field names must be strings")
        if any(name not in properties for name in required):
            raise ValueError("Every required tool field must define a property")
        supported_types = {
            "string",
            "integer",
            "number",
            "boolean",
            "array",
            "object",
            "null",
        }
        for property_schema in properties.values():
            if not isinstance(property_schema, Mapping):
                raise ValueError("Tool property schemas must be objects")
            if property_schema.get("type") not in supported_types:
                raise ValueError("Tool property schema type is unsupported")
        try:
            json.dumps(self.parameters, allow_nan=False)
        except (TypeError, ValueError) as error:
            raise ValueError("Tool parameters must be JSON serializable") from error

    def to_api(self) -> dict[str, object]:
        """Return the OpenAI-compatible function tool shape."""

        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": dict(self.parameters),
                "strict": True,
            },
        }


@dataclass(frozen=True, slots=True)
class ToolCallOutcome:
    """Validated tool instructions and their redacted usage measurement."""

    tool_name: str
    arguments: Mapping[str, object]
    finish_reason: str
    measurement: Measurement


class NemotronAdapter:
    """Create and validate one bounded Nemotron function call."""

    def __init__(
        self,
        client: CompletionClient,
        settings: Settings,
        *,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._client = client
        self._settings = settings
        self._clock = clock or (lambda: datetime.now(UTC))

    def invoke_tool(
        self,
        *,
        investigation_id: str,
        prompt: str,
        tool: ToolDefinition,
    ) -> ToolCallOutcome:
        """Request exactly one tool call and reject malformed model output."""

        self._settings.assert_live_ready(Provider.NEMOTRON)
        investigation_id = require_investigation_id(investigation_id)
        if not prompt.strip():
            raise ValueError("Prompt cannot be empty")

        request = {
            "model": self._settings.nemotron_model,
            "messages": [{"role": "user", "content": prompt}],
            "tools": [tool.to_api()],
            "tool_choice": {
                "type": "function",
                "function": {"name": tool.name},
            },
            "max_tokens": self._settings.budget.max_output_tokens,
            "n": 1,
            "stream": False,
            "store": False,
            "service_tier": "default",
        }
        estimated_input_tokens = len(
            json.dumps(request, separators=(",", ":")).encode("utf-8")
        )
        if estimated_input_tokens > self._settings.budget.max_input_tokens:
            raise ConfigurationError("Estimated input exceeds the configured token cap")

        worst_case_cost = self._settings.nemotron_pricing.cost(
            self._settings.budget.max_input_tokens,
            self._settings.budget.max_output_tokens,
        )
        if worst_case_cost > self._settings.budget.max_model_cost_usd:
            raise ConfigurationError("Worst-case model cost exceeds the configured cap")

        started_at = self._clock()
        response = self._client.create(**request)
        ended_at = self._clock()
        choice = _single_choice(response)
        tool_name, arguments = _single_tool_call(choice, tool)
        input_tokens, output_tokens = _usage(response)
        if input_tokens > self._settings.budget.max_input_tokens:
            raise ProviderContractError("Reported input tokens exceed the configured cap")
        if output_tokens > self._settings.budget.max_output_tokens:
            raise ProviderContractError("Reported output tokens exceed the configured cap")

        cost = self._settings.nemotron_pricing.cost(input_tokens, output_tokens)
        if cost > self._settings.budget.max_model_cost_usd:
            raise ProviderContractError("Reported model cost exceeds the configured cap")

        finish_reason = read_optional(choice, "finish_reason", "")
        if not isinstance(finish_reason, str):
            raise ProviderContractError("finish_reason must be a string")

        return ToolCallOutcome(
            tool_name=tool_name,
            arguments=arguments,
            finish_reason=finish_reason,
            measurement=Measurement(
                investigation_id=investigation_id,
                provider=Provider.NEMOTRON,
                operation="tool_call",
                status=OperationStatus.SUCCEEDED,
                started_at=started_at,
                ended_at=ended_at,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                model_cost_usd=cost,
            ),
        )


def _single_choice(response: object) -> object:
    choices = read_field(response, "choices")
    if not isinstance(choices, Sequence) or isinstance(choices, (str, bytes)):
        raise ProviderContractError("choices must be a sequence")
    if len(choices) != 1:
        raise ProviderContractError("Exactly one completion choice is required")
    return choices[0]


def _single_tool_call(
    choice: object, tool: ToolDefinition
) -> tuple[str, Mapping[str, object]]:
    message = read_field(choice, "message")
    calls = read_field(message, "tool_calls")
    if not isinstance(calls, Sequence) or isinstance(calls, (str, bytes)):
        raise ProviderContractError("tool_calls must be a sequence")
    if len(calls) != 1:
        raise ProviderContractError("Exactly one tool call is required")

    function = read_field(calls[0], "function")
    name = read_field(function, "name")
    raw_arguments = read_field(function, "arguments")
    if name != tool.name:
        raise ProviderContractError("Model selected an unexpected tool")
    if not isinstance(raw_arguments, str):
        raise ProviderContractError("Tool arguments must be encoded as JSON")
    try:
        arguments = json.loads(
            raw_arguments,
            parse_constant=_reject_json_constant,
        )
    except (json.JSONDecodeError, ValueError) as error:
        raise ProviderContractError("Tool arguments are not valid JSON") from error
    if not isinstance(arguments, dict):
        raise ProviderContractError("Tool arguments must be a JSON object")
    _validate_arguments(arguments, tool.parameters)
    return name, arguments


def _reject_json_constant(value: str) -> None:
    raise ValueError(f"Unsupported JSON constant: {value}")


def _validate_arguments(
    arguments: Mapping[str, object], schema: Mapping[str, object]
) -> None:
    required = schema.get("required", [])
    if not isinstance(required, Sequence) or isinstance(required, (str, bytes)):
        raise ProviderContractError("Tool schema required must be a sequence")
    if any(not isinstance(name, str) for name in required):
        raise ProviderContractError("Tool schema required names must be strings")
    missing = [name for name in required if name not in arguments]
    if missing:
        raise ProviderContractError("Tool arguments are missing required fields")

    properties = schema.get("properties", {})
    if not isinstance(properties, Mapping):
        raise ProviderContractError("Tool schema properties must be an object")
    for name, value in arguments.items():
        property_schema = properties.get(name)
        if property_schema is not None:
            _validate_argument_type(name, value, property_schema)
    if schema.get("additionalProperties") is False:
        unexpected = set(arguments).difference(properties)
        if unexpected:
            raise ProviderContractError("Tool arguments contain unexpected fields")


def _validate_argument_type(name: str, value: object, schema: object) -> None:
    if not isinstance(schema, Mapping):
        raise ProviderContractError("Tool property schemas must be objects")
    expected = schema.get("type")
    validators = {
        "string": lambda candidate: isinstance(candidate, str),
        "integer": lambda candidate: isinstance(candidate, int)
        and not isinstance(candidate, bool),
        "number": lambda candidate: isinstance(candidate, (int, float))
        and not isinstance(candidate, bool),
        "boolean": lambda candidate: isinstance(candidate, bool),
        "array": lambda candidate: isinstance(candidate, list),
        "object": lambda candidate: isinstance(candidate, dict),
        "null": lambda candidate: candidate is None,
    }
    if not isinstance(expected, str) or expected not in validators:
        raise ProviderContractError(f"Tool argument {name} has an unsupported type")
    if expected in validators and not validators[expected](value):
        raise ProviderContractError(f"Tool argument {name} has the wrong type")
    allowed = schema.get("enum")
    if allowed is not None:
        if not isinstance(allowed, Sequence) or isinstance(allowed, (str, bytes)):
            raise ProviderContractError("Tool property enum must be a sequence")
        if value not in allowed:
            raise ProviderContractError(f"Tool argument {name} is outside its enum")


def _usage(response: object) -> tuple[int, int]:
    usage = read_field(response, "usage")
    input_tokens = require_nonnegative_int(
        read_field(usage, "prompt_tokens"), "prompt_tokens"
    )
    output_tokens = require_nonnegative_int(
        read_field(usage, "completion_tokens"), "completion_tokens"
    )
    return input_tokens, output_tokens
