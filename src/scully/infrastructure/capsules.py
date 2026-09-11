"""SQLite persistence for accepted capsule manifests."""

from __future__ import annotations

import json

from scully.domain.capsules import CapsuleManifest
from scully.domain.contracts import CapsuleSummary
from scully.infrastructure.database import Database


class CapsuleConflictError(ValueError):
    """Raised when one capsule ID is reused for different content."""


class CapsuleRepository:
    """Persist accepted capsule metadata in one transaction."""

    def __init__(self, database: Database) -> None:
        self.database = database

    def save(self, manifest: CapsuleManifest) -> CapsuleSummary:
        """Save a new manifest or return an identical existing capsule."""

        manifest_json = json.dumps(
            manifest.model_dump(mode="json"),
            ensure_ascii=True,
            separators=(",", ":"),
            sort_keys=True,
        )
        with self.database.connect() as connection:
            existing = connection.execute(
                "SELECT manifest_json FROM capsules WHERE capsule_id = ?",
                (manifest.capsule_id,),
            ).fetchone()
            if existing is not None:
                if str(existing["manifest_json"]) != manifest_json:
                    raise CapsuleConflictError("Capsule ID already has different content")
                return manifest.to_summary()

            connection.execute(
                """
                INSERT INTO capsules(
                    capsule_id,
                    schema_version,
                    title,
                    observed_summary,
                    signature_id,
                    imported_at,
                    manifest_json
                ) VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?)
                """,
                (
                    manifest.capsule_id,
                    manifest.schema_version,
                    manifest.title,
                    manifest.observed_summary,
                    manifest.failure_signature.signature_id,
                    manifest_json,
                ),
            )
            connection.executemany(
                """
                INSERT INTO evidence(
                    evidence_id,
                    capsule_id,
                    relative_path,
                    sha256,
                    byte_size,
                    media_type,
                    provenance,
                    redaction_status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        item.evidence_id,
                        manifest.capsule_id,
                        item.path,
                        item.sha256,
                        item.byte_size,
                        item.media_type,
                        item.provenance,
                        item.redaction_status,
                    )
                    for item in manifest.evidence
                ],
            )
        return manifest.to_summary()

    def get(self, capsule_id: str) -> CapsuleSummary | None:
        """Load a normalized capsule summary by ID."""

        with self.database.connect() as connection:
            row = connection.execute(
                "SELECT manifest_json FROM capsules WHERE capsule_id = ?",
                (capsule_id,),
            ).fetchone()
        if row is None or row["manifest_json"] is None:
            return None
        manifest = CapsuleManifest.model_validate_json(str(row["manifest_json"]))
        return manifest.to_summary()

    def get_manifest(self, capsule_id: str) -> CapsuleManifest | None:
        """Load the validated canonical manifest for application services."""

        with self.database.connect() as connection:
            row = connection.execute(
                "SELECT manifest_json FROM capsules WHERE capsule_id = ?",
                (capsule_id,),
            ).fetchone()
        if row is None or row["manifest_json"] is None:
            return None
        return CapsuleManifest.model_validate_json(str(row["manifest_json"]))
