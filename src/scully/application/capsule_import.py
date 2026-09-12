"""Fail-closed capsule ingestion and content-addressed storage."""

from __future__ import annotations

import hashlib
import json
import os
import stat
import tempfile
import zipfile
from pathlib import Path, PurePosixPath
from typing import BinaryIO

from pydantic import ValidationError

from scully.application.safety import contains_sensitive_text
from scully.domain.capsules import CapsuleManifest
from scully.domain.contracts import CapsuleSummary
from scully.infrastructure.capsules import CapsuleConflictError, CapsuleRepository


MAX_ARCHIVE_BYTES = 2_097_152
MAX_EVIDENCE_BYTES = 524_288
MAX_MANIFEST_BYTES = 131_072
MAX_FILES = 32
READ_CHUNK_BYTES = 65_536

SUPPORTED_MEDIA_TYPES = {
    ".json": frozenset({"application/json"}),
    ".log": frozenset({"text/plain"}),
    ".txt": frozenset({"text/plain"}),
    ".md": frozenset({"text/markdown"}),
    ".js": frozenset({"text/javascript", "application/javascript"}),
    ".mjs": frozenset({"text/javascript", "application/javascript"}),
}

class CapsuleImportError(ValueError):
    """Bounded public import error without untrusted content."""

    def __init__(self, code: str, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


class _DuplicateKeyError(ValueError):
    pass


class CapsuleImporter:
    """Validate a complete capsule before storing any accepted evidence."""

    def __init__(self, artifact_dir: Path, repository: CapsuleRepository) -> None:
        self.artifact_dir = artifact_dir
        self.repository = repository

    def import_path(self, source: Path) -> CapsuleSummary:
        """Import a local directory or ZIP through the same safety controls."""

        if source.is_symlink():
            raise CapsuleImportError("unsafe_source", "Capsule source cannot be a symlink")
        if source.is_dir():
            files = _read_directory(source)
        elif source.is_file() and source.suffix.lower() == ".zip":
            if source.stat().st_size > MAX_ARCHIVE_BYTES:
                raise CapsuleImportError("archive_too_large", "Capsule archive exceeds the size limit")
            with source.open("rb") as handle:
                files = _read_zip(handle)
        else:
            raise CapsuleImportError("unsupported_source", "Capsule must be a directory or ZIP archive")
        return self._accept(files)

    def import_zip_bytes(self, content: bytes) -> CapsuleSummary:
        """Import a bounded ZIP supplied by the HTTP boundary."""

        if len(content) > MAX_ARCHIVE_BYTES:
            raise CapsuleImportError("archive_too_large", "Capsule archive exceeds the size limit")
        with tempfile.SpooledTemporaryFile(max_size=MAX_ARCHIVE_BYTES) as handle:
            handle.write(content)
            handle.seek(0)
            files = _read_zip(handle)
        return self._accept(files)

    def _accept(self, files: dict[str, bytes]) -> CapsuleSummary:
        if "capsule.json" not in files:
            raise CapsuleImportError("manifest_missing", "Capsule must contain capsule.json at its root")
        manifest_bytes = files["capsule.json"]
        if len(manifest_bytes) > MAX_MANIFEST_BYTES:
            raise CapsuleImportError("manifest_too_large", "Capsule manifest exceeds the size limit")
        if contains_sensitive_text(_decode_text(manifest_bytes)):
            raise CapsuleImportError(
                "secret_detected",
                "Manifest failed the credential and local-path scan",
            )
        manifest_data = _load_json(manifest_bytes, code="manifest_invalid")
        try:
            manifest = CapsuleManifest.model_validate(manifest_data)
        except ValidationError as error:
            raise CapsuleImportError(
                "manifest_invalid",
                "Capsule manifest does not match schema version 1.0",
            ) from error

        declared_paths = {item.path for item in manifest.evidence}
        actual_paths = set(files) - {"capsule.json"}
        if actual_paths != declared_paths:
            if actual_paths - declared_paths:
                raise CapsuleImportError("file_undeclared", "Capsule contains an undeclared file")
            raise CapsuleImportError("file_missing", "Capsule is missing declared evidence")

        for evidence in manifest.evidence:
            _validate_member_name(evidence.path)
            content = files[evidence.path]
            if len(content) != evidence.byte_size:
                raise CapsuleImportError("size_mismatch", "Evidence size does not match the manifest")
            if len(content) > MAX_EVIDENCE_BYTES:
                raise CapsuleImportError("file_too_large", "Evidence file exceeds the size limit")
            digest = hashlib.sha256(content).hexdigest()
            if digest != evidence.sha256:
                raise CapsuleImportError("hash_mismatch", "Evidence hash does not match the manifest")
            _validate_media_type(evidence.path, evidence.media_type)
            text = _decode_text(content)
            if evidence.media_type == "application/json":
                _load_json(content, code="evidence_malformed")
            if contains_sensitive_text(text):
                raise CapsuleImportError(
                    "secret_detected",
                    "Evidence failed the credential and local-path scan",
                )

        self._store_artifacts(manifest, files)
        try:
            return self.repository.save(manifest)
        except CapsuleConflictError as error:
            raise CapsuleImportError(
                "capsule_conflict",
                "Capsule ID already exists with different content",
                status_code=409,
            ) from error

    def _store_artifacts(
        self,
        manifest: CapsuleManifest,
        files: dict[str, bytes],
    ) -> None:
        self.artifact_dir.mkdir(parents=True, exist_ok=True)
        for evidence in manifest.evidence:
            content = files[evidence.path]
            destination_dir = self.artifact_dir / evidence.sha256[:2]
            destination = destination_dir / evidence.sha256
            destination_dir.mkdir(parents=True, exist_ok=True)
            if destination.exists():
                if (
                    destination.is_file()
                    and destination.stat().st_size == len(content)
                    and hashlib.sha256(destination.read_bytes()).hexdigest()
                    == evidence.sha256
                ):
                    continue
                raise CapsuleImportError("artifact_conflict", "Artifact storage failed integrity checks")
            temporary = destination.with_name(f".{evidence.sha256}.{os.getpid()}.tmp")
            try:
                temporary.write_bytes(content)
                os.chmod(temporary, 0o600)
                os.replace(temporary, destination)
            finally:
                temporary.unlink(missing_ok=True)


def _read_directory(source: Path) -> dict[str, bytes]:
    files: dict[str, bytes] = {}
    total_bytes = 0
    for candidate in sorted(source.rglob("*")):
        if candidate.is_symlink():
            raise CapsuleImportError("unsafe_entry", "Capsule cannot contain symlinks")
        if candidate.is_dir():
            continue
        if not candidate.is_file():
            raise CapsuleImportError("unsafe_entry", "Capsule contains an unsupported entry")
        relative = candidate.relative_to(source).as_posix()
        _validate_member_name(relative)
        if len(files) >= MAX_FILES:
            raise CapsuleImportError("too_many_files", "Capsule exceeds the file-count limit")
        size_limit = MAX_MANIFEST_BYTES if relative == "capsule.json" else MAX_EVIDENCE_BYTES
        content = _read_bounded(candidate.open("rb"), size_limit)
        total_bytes += len(content)
        if total_bytes > MAX_ARCHIVE_BYTES:
            raise CapsuleImportError("archive_too_large", "Capsule contents exceed the size limit")
        files[relative] = content
    return files


def _read_zip(handle: BinaryIO) -> dict[str, bytes]:
    try:
        with zipfile.ZipFile(handle) as archive:
            files: dict[str, bytes] = {}
            total_bytes = 0
            for entry in archive.infolist():
                if entry.is_dir():
                    directory_name = entry.filename.rstrip("/")
                    if directory_name:
                        _validate_member_name(directory_name)
                    continue
                name = _validate_member_name(entry.filename)
                if name in files:
                    raise CapsuleImportError("duplicate_path", "Capsule contains a duplicate path")
                if len(files) >= MAX_FILES:
                    raise CapsuleImportError("too_many_files", "Capsule exceeds the file-count limit")
                if entry.flag_bits & 0x1:
                    raise CapsuleImportError("unsafe_entry", "Encrypted ZIP entries are not supported")
                file_type = (entry.external_attr >> 16) & 0o170000
                if file_type == stat.S_IFLNK:
                    raise CapsuleImportError("unsafe_entry", "Capsule cannot contain symlinks")
                if file_type not in {0, stat.S_IFREG}:
                    raise CapsuleImportError("unsafe_entry", "Capsule contains an unsupported entry")
                size_limit = MAX_MANIFEST_BYTES if name == "capsule.json" else MAX_EVIDENCE_BYTES
                if entry.file_size > size_limit:
                    raise CapsuleImportError("file_too_large", "Capsule file exceeds the size limit")
                with archive.open(entry, "r") as member:
                    content = _read_bounded(member, size_limit)
                total_bytes += len(content)
                if total_bytes > MAX_ARCHIVE_BYTES:
                    raise CapsuleImportError("archive_too_large", "Capsule contents exceed the size limit")
                files[name] = content
            return files
    except CapsuleImportError:
        raise
    except (OSError, zipfile.BadZipFile, zipfile.LargeZipFile) as error:
        raise CapsuleImportError("archive_invalid", "Capsule ZIP cannot be read") from error


def _read_bounded(handle: BinaryIO, limit: int) -> bytes:
    chunks: list[bytes] = []
    size = 0
    try:
        while chunk := handle.read(READ_CHUNK_BYTES):
            size += len(chunk)
            if size > limit:
                raise CapsuleImportError("file_too_large", "Capsule file exceeds the size limit")
            chunks.append(chunk)
    finally:
        handle.close()
    return b"".join(chunks)


def _validate_member_name(name: str) -> str:
    if not name or "\\" in name or any(ord(character) < 32 for character in name):
        raise CapsuleImportError("unsafe_path", "Capsule contains an unsafe path")
    path = PurePosixPath(name)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise CapsuleImportError("unsafe_path", "Capsule contains an unsafe path")
    if path.as_posix() != name or ":" in path.parts[0]:
        raise CapsuleImportError("unsafe_path", "Capsule contains an unsafe path")
    return name


def _load_json(content: bytes, *, code: str) -> object:
    text = _decode_text(content)

    def reject_duplicates(pairs: list[tuple[str, object]]) -> dict[str, object]:
        result: dict[str, object] = {}
        for key, value in pairs:
            if key in result:
                raise _DuplicateKeyError
            result[key] = value
        return result

    def reject_constant(unused_value: str) -> None:
        raise ValueError("Non-finite JSON numbers are not supported")

    try:
        return json.loads(
            text,
            object_pairs_hook=reject_duplicates,
            parse_constant=reject_constant,
        )
    except (json.JSONDecodeError, _DuplicateKeyError, ValueError) as error:
        raise CapsuleImportError(code, "Capsule contains malformed JSON") from error


def _decode_text(content: bytes) -> str:
    if b"\x00" in content:
        raise CapsuleImportError("content_invalid", "Evidence must be text without null bytes")
    try:
        return content.decode("utf-8")
    except UnicodeDecodeError as error:
        raise CapsuleImportError("content_invalid", "Evidence must use UTF-8 text") from error


def _validate_media_type(path: str, media_type: str) -> None:
    suffix = PurePosixPath(path).suffix.lower()
    if media_type not in SUPPORTED_MEDIA_TYPES.get(suffix, frozenset()):
        raise CapsuleImportError(
            "media_type_unsupported",
            "Evidence extension and media type are not supported",
        )
