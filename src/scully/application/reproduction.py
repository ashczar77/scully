"""Deterministic downloadable reproduction-package builder."""

from __future__ import annotations

import hashlib
import io
import json
import zipfile
from pathlib import Path, PurePosixPath

from scully.domain.contracts import InvestigationDetail, InvestigationStatus


PACKAGE_ROOT = "scully-proxy-identity-collapse"
MAX_PACKAGE_BYTES = 2 * 1024 * 1024
REPRODUCTION_FILES = (
    "README.md",
    "package.json",
    "package-lock.json",
    "scripts/observe.mjs",
    "scripts/verify-reproduction.mjs",
    "src/reproduction.mjs",
    "test/proxy-identity-collapse.test.mjs",
)


class ReproductionPackageError(ValueError):
    """Bounded package-generation failure safe for an API response."""

    def __init__(self, code: str, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


class ReproductionPackager:
    """Build one deterministic ZIP from the reviewed reproduction template."""

    def __init__(self, templates_dir: Path) -> None:
        self.templates_dir = templates_dir

    def build(self, detail: InvestigationDetail) -> bytes:
        """Return a bounded package for one completed local investigation."""

        if detail.status is not InvestigationStatus.COMPLETED or detail.execution is None:
            raise ReproductionPackageError(
                "investigation_not_completed",
                "Investigation must complete before packaging",
                status_code=409,
            )
        supported_id = detail.execution.supported_hypothesis_id
        if supported_id is None:
            raise ReproductionPackageError(
                "cause_not_selected",
                "Investigation did not select one supported cause",
                status_code=409,
            )
        supported = next(
            (item for item in detail.hypotheses if item.hypothesis_id == supported_id),
            None,
        )
        if supported is None:
            raise ReproductionPackageError(
                "cause_not_found",
                "Supported cause is not part of the investigation",
                status_code=409,
            )
        if detail.capsule_id != "proxy-identity-collapse-v1":
            raise ReproductionPackageError(
                "capsule_not_supported",
                "Reproduction packaging supports the seeded proxy incident only",
            )

        template = self.templates_dir / "proxy-identity-collapse"
        files = []
        total_size = 0
        for relative_name in REPRODUCTION_FILES:
            relative = PurePosixPath(relative_name)
            source = template.joinpath(*relative.parts)
            if source.is_symlink() or not source.is_file():
                raise ReproductionPackageError(
                    "template_invalid",
                    "Reproduction template is incomplete",
                    status_code=500,
                )
            content = source.read_bytes()
            total_size += len(content)
            if total_size > MAX_PACKAGE_BYTES:
                raise ReproductionPackageError(
                    "package_too_large",
                    "Reproduction package exceeds the size limit",
                    status_code=500,
                )
            files.append((relative.as_posix(), content))

        metadata = {
            "schema_version": "1.0",
            "investigation_id": detail.investigation_id,
            "capsule_id": detail.capsule_id,
            "signature_id": detail.execution.signature_id,
            "supported_hypothesis_id": supported.hypothesis_id,
            "supported_cause": supported.title,
            "execution": {
                "source": detail.execution.execution_source,
                "isolation_verified": detail.execution.isolation_verified,
                "operation_count": detail.execution.operation_count,
                "retry_count": detail.execution.retry_count,
            },
            "files": [
                {
                    "path": name,
                    "sha256": hashlib.sha256(content).hexdigest(),
                    "byte_size": len(content),
                }
                for name, content in files
            ],
        }
        metadata_bytes = (
            json.dumps(
                metadata,
                ensure_ascii=True,
                indent=2,
                sort_keys=True,
            )
            + "\n"
        ).encode("utf-8")
        archive = io.BytesIO()
        with zipfile.ZipFile(
            archive,
            mode="w",
            compression=zipfile.ZIP_DEFLATED,
            compresslevel=9,
        ) as output:
            _write_file(output, "reproduction.json", metadata_bytes)
            for name, content in files:
                _write_file(output, name, content)
        value = archive.getvalue()
        if len(value) > MAX_PACKAGE_BYTES:
            raise ReproductionPackageError(
                "package_too_large",
                "Reproduction package exceeds the size limit",
                status_code=500,
            )
        return value


def _write_file(archive: zipfile.ZipFile, relative_name: str, content: bytes) -> None:
    info = zipfile.ZipInfo(
        filename=f"{PACKAGE_ROOT}/{relative_name}",
        date_time=(2026, 9, 11, 0, 0, 0),
    )
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o100644 << 16
    archive.writestr(info, content)
