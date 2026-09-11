"""FastAPI application factory for the offline product foundation."""

from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import asynccontextmanager
from queue import Queue
from threading import Thread
from typing import AsyncIterator

from fastapi import APIRouter, FastAPI, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict

from scully import __version__
from scully.application.capsule_import import (
    MAX_ARCHIVE_BYTES,
    CapsuleImporter,
    CapsuleImportError,
)
from scully.application.execution import LocalExecutionAdapter
from scully.application.investigations import InvestigationError, InvestigationService
from scully.application.planning import LocalPlanningAdapter
from scully.application.reproduction import (
    ReproductionPackageError,
    ReproductionPackager,
)
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
        LocalExecutionAdapter(product_settings.artifact_dir),
    )
    reproduction_packager = ReproductionPackager(
        product_settings.seed_capsules_dir.parent / "reproductions"
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

    @application.exception_handler(ReproductionPackageError)
    async def reproduction_package_error(
        unused_request: Request,
        error: ReproductionPackageError,
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

    @router.post(
        "/investigations/{investigation_id}/execute",
        response_model=InvestigationDetail,
    )
    def execute_investigation(investigation_id: str) -> InvestigationDetail:
        return investigation_service.execute(investigation_id)

    @router.post("/investigations/{investigation_id}/execute/stream")
    def execute_investigation_stream(investigation_id: str) -> StreamingResponse:
        messages: Queue[tuple[str, object]] = Queue()

        def progress(event_type: str, payload: dict[str, object]) -> None:
            messages.put((event_type, payload))

        def run() -> None:
            try:
                completed = investigation_service.execute(
                    investigation_id,
                    progress=progress,
                )
            except InvestigationError as error:
                messages.put(
                    (
                        "error",
                        {"code": error.code, "message": error.message},
                    )
                )
            except Exception:
                messages.put(
                    (
                        "error",
                        {
                            "code": "execution_failed",
                            "message": "Branch execution failed",
                        },
                    )
                )
            else:
                messages.put(("complete", completed.model_dump(mode="json")))

        worker = Thread(target=run, name="scully-local-execution", daemon=True)
        worker.start()

        def stream() -> Iterator[str]:
            sequence = 0
            while True:
                event_type, payload = messages.get()
                sequence += 1
                yield _sse_message(sequence, event_type, payload)
                if event_type in {"complete", "error"}:
                    break

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-store",
                "X-Accel-Buffering": "no",
            },
        )

    @router.get("/investigations/{investigation_id}/events")
    def investigation_events(investigation_id: str) -> StreamingResponse:
        detail = investigation_service.get(investigation_id)

        def replay() -> Iterator[str]:
            for event in detail.events:
                payload = json.dumps(
                    event.model_dump(mode="json"),
                    ensure_ascii=True,
                    separators=(",", ":"),
                    sort_keys=True,
                )
                yield f"id: {event.sequence}\nevent: {event.event_type}\ndata: {payload}\n\n"

        return StreamingResponse(replay(), media_type="text/event-stream")

    @router.get("/investigations/{investigation_id}/reproduction.zip")
    def download_reproduction(investigation_id: str) -> Response:
        detail = investigation_service.get(investigation_id)
        content = reproduction_packager.build(detail)
        return Response(
            content=content,
            media_type="application/zip",
            headers={
                "Content-Disposition": (
                    "attachment; filename=scully-proxy-identity-collapse.zip"
                ),
                "Cache-Control": "no-store",
            },
        )

    application.include_router(router)
    application.state.product_settings = product_settings
    application.state.database = database
    application.state.capsules = capsules
    application.state.capsule_importer = capsule_importer
    application.state.investigations = investigations
    application.state.investigation_service = investigation_service
    application.state.reproduction_packager = reproduction_packager

    if (product_settings.web_dist / "index.html").is_file():
        application.mount(
            "/",
            StaticFiles(directory=product_settings.web_dist, html=True),
            name="web",
        )
    return application


app = create_app()


def _sse_message(sequence: int, event_type: str, payload: object) -> str:
    encoded = json.dumps(
        payload,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    )
    return f"id: {sequence}\nevent: {event_type}\ndata: {encoded}\n\n"
