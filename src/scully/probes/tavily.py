"""One bounded Tavily source-discovery capability probe."""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from math import isfinite
from typing import Protocol

from scully.config import ConfigurationError, Provider, Settings
from scully.measurement import Measurement, OperationStatus
from scully.preflight import build_preflight_report
from scully.providers import ProviderContractError
from scully.providers.clients import create_tavily_client
from scully.providers.tavily import TavilyAdapter


PROBE_ID = "g1.2-tavily-001"
PROBE_QUERY = (
    "Express trust proxy X-Forwarded-For req.ip behavior official documentation"
)
PROBE_DOMAINS = ("expressjs.com",)


class ClosableTavilyClient(Protocol):
    """Official Tavily client surface needed by the probe."""

    def search(self, query: str, **kwargs: object) -> Mapping[str, object]:
        """Run one search request."""

    def close(self) -> None:
        """Release local transport resources."""


@dataclass(slots=True)
class TrackingSearchBridge:
    """Track safe response structure without retaining returned text."""

    endpoint: ClosableTavilyClient
    attempted: bool = False
    response_received: bool = False
    request_id_observed: bool = False
    response_time_seconds: float | None = None
    result_count: int | None = None
    credits: int = 0
    usage_observed: bool = False

    def search(self, query: str, **kwargs: object) -> Mapping[str, object]:
        """Make one search and capture only bounded structural metadata."""

        self.attempted = True
        response = self.endpoint.search(query, **kwargs)
        self.response_received = True
        if not isinstance(response, Mapping):
            return response

        request_id = response.get("request_id")
        self.request_id_observed = isinstance(request_id, str) and bool(
            request_id.strip()
        )
        response_time = response.get("response_time")
        if (
            isinstance(response_time, (int, float))
            and not isinstance(response_time, bool)
            and isfinite(float(response_time))
            and response_time >= 0
        ):
            self.response_time_seconds = float(response_time)
        results = response.get("results")
        if isinstance(results, Sequence) and not isinstance(results, (str, bytes)):
            self.result_count = len(results)
        credits = _safe_credits(response.get("usage"))
        if credits is not None:
            self.credits = credits
            self.usage_observed = True
        return response


def run_probe(
    settings: Settings,
    *,
    client_factory: Callable[[Settings], ClosableTavilyClient] | None = None,
    clock: Callable[[], datetime] | None = None,
) -> dict[str, object]:
    """Execute one reviewed search and return a redacted evidence record."""

    readiness = build_preflight_report(settings).providers["tavily"]
    if not readiness.live_gate_open:
        raise ConfigurationError("Tavily execution preflight is not ready")

    create_client = client_factory or create_tavily_client
    client = create_client(settings)
    bridge = TrackingSearchBridge(client)
    now = clock or (lambda: datetime.now(UTC))
    started_at = now()
    try:
        outcome = TavilyAdapter(bridge, settings, clock=now).search(
            investigation_id=PROBE_ID,
            query=PROBE_QUERY,
            include_domains=PROBE_DOMAINS,
        )
        if not outcome.sources:
            raise ProviderContractError("Tavily probe returned no sources")
    except Exception as error:
        ended_at = now()
        return _failure_record(error, bridge, started_at, ended_at)
    finally:
        client.close()

    return {
        "probe_id": PROBE_ID,
        "provider": Provider.TAVILY.value,
        "status": OperationStatus.SUCCEEDED.value,
        "source_count": len(outcome.sources),
        "source_urls": [source.url for source in outcome.sources],
        "request_id_observed": bridge.request_id_observed,
        "provider_response_time_seconds": bridge.response_time_seconds,
        "measurement": outcome.measurement.to_record(),
    }


def main() -> int:
    """Run once, print a redacted JSON record, and return its status."""

    record = run_probe(Settings.from_environment())
    print(json.dumps(record, indent=2, sort_keys=True))
    return 0 if record["status"] == OperationStatus.SUCCEEDED.value else 1


def _failure_record(
    error: Exception,
    bridge: TrackingSearchBridge,
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
        provider=Provider.TAVILY,
        operation="search",
        status=status,
        started_at=started_at,
        ended_at=ended_at,
        request_count=int(bridge.attempted),
        tavily_credits=bridge.credits,
        rate_limit_count=int(is_rate_limited),
    )
    return {
        "probe_id": PROBE_ID,
        "provider": Provider.TAVILY.value,
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
        "result_count": bridge.result_count,
        "request_id_observed": bridge.request_id_observed,
        "provider_response_time_seconds": bridge.response_time_seconds,
        "measurement": measurement.to_record(),
    }


def _safe_credits(value: object) -> int | None:
    if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
        return value
    if not isinstance(value, Mapping):
        return None
    for name in ("credits", "total_credits", "search_credits"):
        credits = value.get(name)
        if (
            isinstance(credits, int)
            and not isinstance(credits, bool)
            and credits >= 0
        ):
            return credits
    return None


if __name__ == "__main__":
    raise SystemExit(main())
