"""FastAPI application factory for the offline product foundation."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import APIRouter, FastAPI, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict

from scully import __version__
from scully.application.capsule_import import (
    MAX_ARCHIVE_BYTES,
    CapsuleImporter,
    CapsuleImportError,
)
from scully.application.investigations import InvestigationError, InvestigationService
from scully.application.planning import LocalPlanningAdapter
from scully.application.settings import ProductSettings
from scully.domain.capsules import CapsuleIdentifier
from scully.domain.contracts import CapsuleSummary, InvestigationDetail
from scully.infrastructure.capsules import CapsuleRepository
from scully.infrastructure.database import Database
from scully.infrastructure.investigations import InvestigationRepository


SEED_CAPSULES = frozenset({"proxy-identity-collapse"})


class HealthResponse(BaseModel):
    """Public readiness response with no environment details."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    status: str
    service: str
    version: str
    database: str
    live_providers_enabled: bool


class CreateInvestigationRequest(BaseModel):
    """Strict request to plan one accepted capsule."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    capsule_id: CapsuleIdentifier


def create_app(settings: ProductSettings | None = None) -> FastAPI:
    """Construct an application without contacting a provider."""

    product_settings = settings or ProductSettings.from_environment()
    database = Database(product_settings.database_path)
    capsules = CapsuleRepository(database)
    capsule_importer = CapsuleImporter(product_settings.artifact_dir, capsules)
    investigations = InvestigationRepository(database)
    investigation_service = InvestigationService(
        capsules,
        investigations,
        LocalPlanningAdapter(),
    )

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

    @application.exception_handler(CapsuleImportError)
    async def capsule_import_error(
        unused_request: Request,
        error: CapsuleImportError,
    ) -> JSONResponse:
        return JSONResponse(
            status_code=error.status_code,
            content={"detail": {"code": error.code, "message": error.message}},
        )

    @application.exception_handler(InvestigationError)
    async def investigation_error(
        unused_request: Request,
        error: InvestigationError,
    ) -> JSONResponse:
        return JSONResponse(
            status_code=error.status_code,
            content={"detail": {"code": error.code, "message": error.message}},
        )

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

    @router.post(
        "/capsules/import",
        response_model=CapsuleSummary,
        status_code=status.HTTP_201_CREATED,
    )
    async def import_capsule(
        request: Request,
        seed: str | None = Query(default=None, max_length=64),
    ) -> CapsuleSummary:
        if seed is not None:
            if seed not in SEED_CAPSULES:
                raise CapsuleImportError("seed_unknown", "Requested seed capsule is not available")
            return capsule_importer.import_path(product_settings.seed_capsules_dir / seed)

        media_type = request.headers.get("content-type", "").split(";", 1)[0].strip()
        if media_type not in {"application/zip", "application/x-zip-compressed"}:
            raise CapsuleImportError(
                "import_type_unsupported",
                "Upload a ZIP archive with application/zip content type",
            )
        declared_length = request.headers.get("content-length")
        if declared_length is not None:
            try:
                parsed_length = int(declared_length)
            except ValueError as error:
                raise CapsuleImportError(
                    "content_length_invalid",
                    "Content-Length must be a non-negative integer",
                ) from error
            if parsed_length < 0:
                raise CapsuleImportError(
                    "content_length_invalid",
                    "Content-Length must be a non-negative integer",
                )
            if parsed_length > MAX_ARCHIVE_BYTES:
                raise CapsuleImportError(
                    "archive_too_large",
                    "Capsule archive exceeds the size limit",
                )

        content = bytearray()
        async for chunk in request.stream():
            content.extend(chunk)
            if len(content) > MAX_ARCHIVE_BYTES:
                raise CapsuleImportError(
                    "archive_too_large",
                    "Capsule archive exceeds the size limit",
                )
        return capsule_importer.import_zip_bytes(bytes(content))

    @router.get("/capsules/{capsule_id}", response_model=CapsuleSummary)
    def get_capsule(capsule_id: str) -> CapsuleSummary:
        capsule = capsules.get(capsule_id)
        if capsule is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"code": "capsule_not_found", "message": "Capsule was not found"},
            )
        return capsule

    @router.post(
        "/investigations",
        response_model=InvestigationDetail,
        status_code=status.HTTP_201_CREATED,
    )
    def create_investigation(
        request: CreateInvestigationRequest,
    ) -> InvestigationDetail:
        return investigation_service.create(request.capsule_id)

    @router.get(
        "/investigations/{investigation_id}",
        response_model=InvestigationDetail,
    )
    def get_investigation(investigation_id: str) -> InvestigationDetail:
        return investigation_service.get(investigation_id)

    application.include_router(router)
    application.state.product_settings = product_settings
    application.state.database = database
    application.state.capsules = capsules
    application.state.capsule_importer = capsule_importer
    application.state.investigations = investigations
    application.state.investigation_service = investigation_service

    if (product_settings.web_dist / "index.html").is_file():
        application.mount(
            "/",
            StaticFiles(directory=product_settings.web_dist, html=True),
            name="web",
        )
    return application


app = create_app()
