"""FastAPI application factory for the offline product foundation."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import APIRouter, FastAPI
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict

from scully import __version__
from scully.application.settings import ProductSettings
from scully.infrastructure.database import Database


class HealthResponse(BaseModel):
    """Public readiness response with no environment details."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    status: str
    service: str
    version: str
    database: str
    live_providers_enabled: bool


def create_app(settings: ProductSettings | None = None) -> FastAPI:
    """Construct an application without contacting a provider."""

    product_settings = settings or ProductSettings.from_environment()
    database = Database(product_settings.database_path)

    @asynccontextmanager
    async def lifespan(unused_app: FastAPI) -> AsyncIterator[None]:
        database.initialize()
        product_settings.artifact_dir.mkdir(parents=True, exist_ok=True)
        yield

    application = FastAPI(
        title="Scully",
        version=__version__,
        lifespan=lifespan,
    )
    router = APIRouter(prefix="/api")

    @router.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        ready = database.is_ready()
        return HealthResponse(
            status="ok" if ready else "degraded",
            service="scully",
            version=__version__,
            database="ready" if ready else "unavailable",
            live_providers_enabled=False,
        )

    application.include_router(router)
    application.state.product_settings = product_settings
    application.state.database = database

    if (product_settings.web_dist / "index.html").is_file():
        application.mount(
            "/",
            StaticFiles(directory=product_settings.web_dist, html=True),
            name="web",
        )
    return application


app = create_app()
