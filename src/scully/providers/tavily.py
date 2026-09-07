"""Cost-bounded Tavily search contract over an injected SDK client."""

from __future__ import annotations

import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from math import isfinite
from typing import Protocol
from urllib.parse import urlparse

from scully.config import Provider, Settings
from scully.measurement import Measurement, OperationStatus

from . import ProviderContractError
from ._contracts import require_investigation_id, require_nonnegative_int


MAX_RESULT_CONTENT_CHARS = 5_000
DOMAIN_PATTERN = re.compile(
    r"(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+"
    r"[a-z]{2,63}"
)


class TavilyClient(Protocol):
    """Subset of the Tavily Python client used by the search probe."""

    def search(self, query: str, **kwargs: object) -> Mapping[str, object]:
        """Run one search request."""


@dataclass(frozen=True, slots=True)
class SearchSource:
    """One normalized Tavily result with required source provenance."""

    title: str
    url: str
    content: str
    score: float


@dataclass(frozen=True, slots=True)
class SearchOutcome:
    """Normalized search results and their redacted usage measurement."""

    query: str
    sources: tuple[SearchSource, ...]
    measurement: Measurement


class TavilyAdapter:
    """Run a basic search with fixed cost and response-size controls."""

    def __init__(
        self,
        client: TavilyClient,
        settings: Settings,
        *,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._client = client
        self._settings = settings
        self._clock = clock or (lambda: datetime.now(UTC))

    def search(
        self,
        *,
        investigation_id: str,
        query: str,
        include_domains: Sequence[str] = (),
    ) -> SearchOutcome:
        """Search once and reject missing provenance or usage metadata."""

        self._settings.assert_live_ready(Provider.TAVILY)
        investigation_id = require_investigation_id(investigation_id)
        normalized_query = query.strip()
        if not normalized_query:
            raise ValueError("Search query cannot be empty")
        if len(normalized_query) > 400:
            raise ValueError("Search query cannot exceed 400 characters")
        normalized_domains = _validate_domains(include_domains)

        started_at = self._clock()
        response = self._client.search(
            normalized_query,
            search_depth="basic",
            topic="general",
            max_results=5,
            include_domains=normalized_domains,
            include_answer=False,
            include_raw_content=False,
            include_images=False,
            auto_parameters=False,
            include_usage=True,
            timeout=self._settings.budget.timeout_seconds,
        )
        ended_at = self._clock()
        if not isinstance(response, Mapping):
            raise ProviderContractError("Tavily response must be an object")

        credits = _read_credits(response)
        if credits > self._settings.budget.max_tavily_credits:
            raise ProviderContractError("Reported Tavily usage exceeds the credit cap")
        sources = _read_sources(response)
        _require_allowed_source_domains(sources, normalized_domains)

        return SearchOutcome(
            query=normalized_query,
            sources=sources,
            measurement=Measurement(
                investigation_id=investigation_id,
                provider=Provider.TAVILY,
                operation="search",
                status=OperationStatus.SUCCEEDED,
                started_at=started_at,
                ended_at=ended_at,
                tavily_credits=credits,
            ),
        )


def _validate_domains(domains: Sequence[str]) -> list[str]:
    if isinstance(domains, (str, bytes)):
        raise ValueError("Tavily include domains must be a sequence")
    if len(domains) > 10:
        raise ValueError("Tavily include domains cannot exceed ten entries")
    normalized: list[str] = []
    for domain in domains:
        if not isinstance(domain, str):
            raise ValueError("Tavily include domains must be text")
        value = domain.strip().lower()
        if (
            not value
            or len(value) > 253
            or DOMAIN_PATTERN.fullmatch(value) is None
        ):
            raise ValueError("Tavily include domain is invalid")
        normalized.append(value)
    return normalized


def _require_allowed_source_domains(
    sources: Sequence[SearchSource], domains: Sequence[str]
) -> None:
    if not domains:
        return
    bases = tuple(domain.removeprefix("*.") for domain in domains)
    for source in sources:
        hostname = urlparse(source.url).hostname
        if hostname is None or not any(
            hostname == base or hostname.endswith(f".{base}") for base in bases
        ):
            raise ProviderContractError(
                "Tavily result URL is outside the requested domains"
            )


def _read_credits(response: Mapping[str, object]) -> int:
    if "usage" not in response:
        raise ProviderContractError("Tavily response is missing usage metadata")
    usage = response["usage"]
    if isinstance(usage, int) and not isinstance(usage, bool):
        return require_nonnegative_int(usage, "usage")
    if not isinstance(usage, Mapping):
        raise ProviderContractError("Tavily usage metadata must be numeric or an object")
    for name in ("credits", "total_credits", "search_credits"):
        if name in usage:
            return require_nonnegative_int(usage[name], name)
    raise ProviderContractError("Tavily usage metadata has no credit count")


def _read_sources(response: Mapping[str, object]) -> tuple[SearchSource, ...]:
    raw_results = response.get("results")
    if not isinstance(raw_results, Sequence) or isinstance(raw_results, (str, bytes)):
        raise ProviderContractError("Tavily results must be a sequence")
    if len(raw_results) > 5:
        raise ProviderContractError("Tavily returned more than five results")

    sources: list[SearchSource] = []
    for result in raw_results:
        if not isinstance(result, Mapping):
            raise ProviderContractError("Each Tavily result must be an object")
        title = result.get("title")
        url = result.get("url")
        content = result.get("content")
        score = result.get("score")
        if not isinstance(title, str) or not title.strip():
            raise ProviderContractError("Tavily result title cannot be empty")
        parsed_url = urlparse(url) if isinstance(url, str) else None
        if (
            parsed_url is None
            or parsed_url.scheme not in {"http", "https"}
            or not parsed_url.netloc
        ):
            raise ProviderContractError("Tavily result URL must use HTTP or HTTPS")
        if not isinstance(content, str):
            raise ProviderContractError("Tavily result content must be text")
        if len(content) > MAX_RESULT_CONTENT_CHARS:
            raise ProviderContractError("Tavily result content exceeds the size cap")
        if isinstance(score, bool) or not isinstance(score, (int, float)):
            raise ProviderContractError("Tavily result score must be numeric")
        normalized_score = float(score)
        if not isfinite(normalized_score) or not 0 <= normalized_score <= 1:
            raise ProviderContractError("Tavily result score must be between zero and one")
        sources.append(
            SearchSource(
                title=title.strip(),
                url=url,
                content=content,
                score=normalized_score,
            )
        )
    return tuple(sources)
