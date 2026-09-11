"""Small SQLite foundation for local product state."""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path


SCHEMA_VERSION = 1
EXPECTED_TABLES = frozenset(
    {
        "schema_metadata",
        "capsules",
        "evidence",
        "investigations",
        "hypotheses",
        "experiments",
        "events",
        "results",
    }
)

SCHEMA_SQL = """
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_metadata (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS capsules (
    capsule_id TEXT PRIMARY KEY,
    schema_version TEXT NOT NULL,
    title TEXT NOT NULL,
    observed_summary TEXT NOT NULL,
    signature_id TEXT NOT NULL,
    imported_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence (
    evidence_id TEXT PRIMARY KEY,
    capsule_id TEXT NOT NULL REFERENCES capsules(capsule_id),
    relative_path TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    media_type TEXT NOT NULL,
    provenance TEXT NOT NULL,
    redaction_status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS investigations (
    investigation_id TEXT PRIMARY KEY,
    capsule_id TEXT NOT NULL REFERENCES capsules(capsule_id),
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hypotheses (
    hypothesis_id TEXT PRIMARY KEY,
    investigation_id TEXT NOT NULL REFERENCES investigations(investigation_id),
    payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS experiments (
    experiment_id TEXT PRIMARY KEY,
    investigation_id TEXT NOT NULL REFERENCES investigations(investigation_id),
    hypothesis_id TEXT NOT NULL REFERENCES hypotheses(hypothesis_id),
    status TEXT NOT NULL,
    checkpoint_id TEXT NOT NULL,
    payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
    investigation_id TEXT NOT NULL REFERENCES investigations(investigation_id),
    sequence INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    PRIMARY KEY (investigation_id, sequence)
);

CREATE TABLE IF NOT EXISTS results (
    investigation_id TEXT PRIMARY KEY REFERENCES investigations(investigation_id),
    verdict TEXT NOT NULL,
    signature_id TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    payload_json TEXT NOT NULL
);
"""


class Database:
    """Own SQLite initialization and short-lived connections."""

    def __init__(self, path: Path) -> None:
        self.path = path

    def initialize(self) -> None:
        """Create the local schema idempotently."""

        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as connection:
            connection.executescript(SCHEMA_SQL)
            connection.execute(
                """
                INSERT OR IGNORE INTO schema_metadata(version, applied_at)
                VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                """,
                (SCHEMA_VERSION,),
            )

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        """Yield a configured connection and close it after use."""

        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def is_ready(self) -> bool:
        """Return whether the expected schema is present and readable."""

        if not self.path.is_file():
            return False
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
            versions = connection.execute(
                "SELECT version FROM schema_metadata"
            ).fetchall()
        tables = {str(row["name"]) for row in rows}
        return EXPECTED_TABLES <= tables and [row["version"] for row in versions] == [
            SCHEMA_VERSION
        ]
