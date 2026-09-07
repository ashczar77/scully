"""Inert construction of the real provider clients used by Scully."""

from __future__ import annotations

from typing import TYPE_CHECKING

from scully.config import Provider, Settings
from scully.dependencies import assert_locked_provider

if TYPE_CHECKING:
    from contree_sdk import ContreeSync
    from openai.resources.chat.completions import Completions
    from tavily import TavilyClient


TOKEN_FACTORY_BASE_URL = "https://api.tokenfactory.nebius.com/v1/"


def create_nemotron_client(settings: Settings) -> Completions:
    """Construct a non-retrying Token Factory completion client."""

    settings.assert_live_ready(Provider.NEMOTRON)
    assert_locked_provider("openai")
    from openai import OpenAI

    assert settings.nebius_api_key is not None
    client = OpenAI(
        api_key=settings.nebius_api_key.reveal(),
        base_url=TOKEN_FACTORY_BASE_URL,
        timeout=settings.budget.timeout_seconds,
        max_retries=0,
    )
    return client.chat.completions


def create_tavily_client(settings: Settings) -> TavilyClient:
    """Construct the official Tavily client with explicit credentials."""

    settings.assert_live_ready(Provider.TAVILY)
    assert_locked_provider("tavily-python")
    from tavily import TavilyClient

    assert settings.tavily_api_key is not None
    project_id = (
        settings.tavily_project_id.reveal()
        if settings.tavily_project_id is not None
        else None
    )
    return TavilyClient(
        api_key=settings.tavily_api_key.reveal(),
        project_id=project_id,
        client_source="scully",
    )


def create_sandbox_client(settings: Settings) -> ContreeSync:
    """Construct ConTree with explicit auth and bounded transport timeouts."""

    settings.assert_live_ready(Provider.SANDBOX)
    assert_locked_provider("contree-sdk")
    from contree_sdk import ContreeSync
    from contree_sdk.auth import IAMAuth
    from contree_sdk.config import ContreeConfig

    assert settings.nebius_api_key is not None
    assert settings.nebius_project_id is not None
    timeout = float(settings.budget.timeout_seconds)
    config = ContreeConfig(
        auth=IAMAuth(
            token=settings.nebius_api_key.reveal(),
            project_id=settings.nebius_project_id.reveal(),
        ),
        transport_timeout=timeout,
        operation_import_timeout=timeout,
        operation_run_timeout=timeout,
        operation_timeout=timeout,
    )
    return ContreeSync(config=config)
