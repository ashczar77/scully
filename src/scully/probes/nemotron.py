"""One bounded Nemotron structured-output capability probe."""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol

from scully.config import ConfigurationError, Provider, Settings
from scully.measurement import Measurement, OperationStatus
from scully.preflight import build_preflight_report
from scully.providers import ProviderContractError
from scully.providers.clients import create_nemotron_client
from scully.providers.nemotron import NemotronAdapter, ToolDefinition


PROBE_ID = "g1.2-nemotron-001"
EXPECTED_ARGUMENT_FIELDS = (
    "confidence",
    "hypothesis",
    "mechanism",
    "next_check",
)
CONTRACT_FAILURE_RULES = (
    ("choices must be a sequence", "choices_shape"),
    ("Exactly one completion choice", "choice_count"),
    ("tool_calls must be a sequence", "tool_calls_shape"),
    ("Exactly one tool call", "tool_call_count"),
    ("Model selected an unexpected tool", "tool_name"),
    ("Tool arguments must be encoded", "arguments_encoding"),
    ("Tool arguments are not valid JSON", "arguments_json"),
    ("Tool arguments must be a JSON object", "arguments_shape"),
    ("Tool arguments are missing", "arguments_missing"),
    ("Tool arguments contain unexpected", "arguments_extra"),
    ("Tool argument", "argument_schema"),
    ("Reported input tokens", "input_token_cap"),
    ("Reported output tokens", "output_token_cap"),
    ("Reported model cost", "model_cost_cap"),
    ("finish_reason", "finish_reason_shape"),
)

SYNTHETIC_INCIDENT = """Analyze this fully synthetic incident:
- An Express service sets trust proxy to true.
- The service is reachable through a trusted reverse proxy and a direct path.
- A direct client can supply X-Forwarded-For.
- A rate limiter keys requests by req.ip.

Return one concise causal hypothesis and the next deterministic validation
check by calling record_incident_hypothesis. Do not request more evidence.
"""


class ClosableNemotronClient(Protocol):
    """Root OpenAI-compatible client surface needed by the probe."""

    chat: object

    def close(self) -> None:
        """Release local transport resources."""


class RawCompletionEndpoint(Protocol):
    """Raw-response completion endpoint used for one request."""

    def create(self, **kwargs: object) -> object:
        """Create one raw chat completion response."""


@dataclass(slots=True)
class ParsedCompletionBridge:
    """Parse one raw response while retaining only safe header names."""

    endpoint: RawCompletionEndpoint
    attempted: bool = False
    response_received: bool = False
    rate_limit_header_names: tuple[str, ...] = ()
    input_tokens: int = 0
    output_tokens: int = 0
    usage_observed: bool = False

    def create(self, **kwargs: object) -> object:
        """Make one request and return its parsed completion object."""

        self.attempted = True
        raw_response = self.endpoint.create(**kwargs)
        headers = getattr(raw_response, "headers", {})
        if isinstance(headers, Mapping):
            self.rate_limit_header_names = tuple(
                sorted(
                    str(name).lower()
                    for name in headers
                    if str(name).lower().startswith("x-ratelimit-")
                )
            )
        parse = getattr(raw_response, "parse", None)
        if not callable(parse):
            raise TypeError("Raw completion response is not parseable")
        parsed = parse()
        self.response_received = True
        usage = _optional_field(parsed, "usage")
        input_tokens = _optional_nonnegative_int(usage, "prompt_tokens")
        output_tokens = _optional_nonnegative_int(usage, "completion_tokens")
        if input_tokens is not None and output_tokens is not None:
            self.input_tokens = input_tokens
            self.output_tokens = output_tokens
            self.usage_observed = True
        return parsed


def hypothesis_tool() -> ToolDefinition:
    """Return the fixed structured-output schema for this probe."""

    return ToolDefinition(
        name="record_incident_hypothesis",
        description=(
            "Record one causal hypothesis and a deterministic next check for "
            "the supplied synthetic incident."
        ),
        parameters={
            "type": "object",
            "properties": {
                "hypothesis": {"type": "string"},
                "mechanism": {"type": "string"},
                "next_check": {"type": "string"},
                "confidence": {
                    "type": "string",
                    "enum": ["low", "medium", "high"],
                },
            },
            "required": list(EXPECTED_ARGUMENT_FIELDS),
            "additionalProperties": False,
        },
    )


def run_probe(
    settings: Settings,
    *,
    client_factory: Callable[[Settings], ClosableNemotronClient]
    | None = None,
    clock: Callable[[], datetime] | None = None,
) -> dict[str, object]:
    """Execute the single reviewed model request and return a redacted record."""

    readiness = build_preflight_report(settings).providers["nemotron"]
    if not readiness.live_gate_open:
        raise ConfigurationError("Nemotron execution preflight is not ready")

    create_client = client_factory or create_nemotron_client
    client = create_client(settings)
    raw_endpoint = client.chat.completions.with_raw_response
    bridge = ParsedCompletionBridge(raw_endpoint)
    now = clock or (lambda: datetime.now(UTC))
    started_at = now()
    try:
        outcome = NemotronAdapter(bridge, settings, clock=now).invoke_tool(
            investigation_id=PROBE_ID,
            prompt=SYNTHETIC_INCIDENT,
            tool=hypothesis_tool(),
        )
    except Exception as error:
        ended_at = now()
        return _failure_record(error, bridge, settings, started_at, ended_at)
    finally:
        client.close()

    argument_fields = tuple(sorted(outcome.arguments))
    if argument_fields != EXPECTED_ARGUMENT_FIELDS:
        raise RuntimeError("Validated argument fields do not match the probe schema")
    return {
        "probe_id": PROBE_ID,
        "provider": Provider.NEMOTRON.value,
        "model": settings.nemotron_model,
        "status": OperationStatus.SUCCEEDED.value,
        "tool_name": outcome.tool_name,
        "argument_fields": list(argument_fields),
        "finish_reason": outcome.finish_reason,
        "rate_limit_header_names": list(bridge.rate_limit_header_names),
        "measurement": outcome.measurement.to_record(),
    }


def main() -> int:
    """Run once, print a redacted JSON record, and return its status."""

    record = run_probe(Settings.from_environment())
    print(json.dumps(record, indent=2, sort_keys=True))
    return 0 if record["status"] == OperationStatus.SUCCEEDED.value else 1


def _failure_record(
    error: Exception,
    bridge: ParsedCompletionBridge,
    settings: Settings,
    started_at: datetime,
    ended_at: datetime,
) -> dict[str, object]:
    status_code = getattr(error, "status_code", None)
    is_rate_limited = status_code == 429
    is_timeout = "timeout" in type(error).__name__.lower()
    status = (
        OperationStatus.RATE_LIMITED
        if is_rate_limited
        else OperationStatus.TIMED_OUT
        if is_timeout
        else OperationStatus.FAILED
    )
    measurement = Measurement(
        investigation_id=PROBE_ID,
        provider=Provider.NEMOTRON,
        operation="tool_call",
        status=status,
        started_at=started_at,
        ended_at=ended_at,
        request_count=int(bridge.attempted),
        input_tokens=bridge.input_tokens,
        output_tokens=bridge.output_tokens,
        model_cost_usd=settings.nemotron_pricing.cost(
            bridge.input_tokens,
            bridge.output_tokens,
        ),
        rate_limit_count=int(is_rate_limited),
    )
    record: dict[str, object] = {
        "probe_id": PROBE_ID,
        "provider": Provider.NEMOTRON.value,
        "status": status.value,
        "error_type": type(error).__name__,
        "failure_stage": (
            "contract_validation"
            if isinstance(error, ProviderContractError)
            else "response_processing"
            if bridge.response_received
            else "request"
        ),
        "http_status": status_code if isinstance(status_code, int) else None,
        "usage_observed": bridge.usage_observed,
        "rate_limit_header_names": list(bridge.rate_limit_header_names),
        "measurement": measurement.to_record(),
    }
    if isinstance(error, ProviderContractError):
        record["contract_failure"] = _contract_failure_code(str(error))
    return record


def _contract_failure_code(message: str) -> str:
    for prefix, code in CONTRACT_FAILURE_RULES:
        if message.startswith(prefix):
            return code
    return "unclassified_contract_failure"


def _optional_field(value: object, name: str) -> object | None:
    if isinstance(value, Mapping):
        return value.get(name)
    return getattr(value, name, None)


def _optional_nonnegative_int(value: object, name: str) -> int | None:
    result = _optional_field(value, name)
    if isinstance(result, int) and not isinstance(result, bool) and result >= 0:
        return result
    return None


if __name__ == "__main__":
    raise SystemExit(main())
