from __future__ import annotations

import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from scully.infrastructure.database import Database, EXPECTED_TABLES


class DatabaseTests(unittest.TestCase):
    def test_initialization_is_complete_and_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database = Database(Path(directory) / "state" / "scully.db")

            self.assertFalse(database.is_ready())
            database.initialize()
            database.initialize()

            self.assertTrue(database.is_ready())
            with database.connect() as connection:
                names = {
                    str(row["name"])
                    for row in connection.execute(
                        "SELECT name FROM sqlite_master WHERE type = 'table'"
                    ).fetchall()
                }
                foreign_keys = connection.execute(
                    "PRAGMA foreign_keys"
                ).fetchone()[0]
                versions = [
                    row["version"]
                    for row in connection.execute(
                        "SELECT version FROM schema_metadata ORDER BY version"
                    ).fetchall()
                ]
                capsule_columns = {
                    row["name"]
                    for row in connection.execute("PRAGMA table_info(capsules)").fetchall()
                }

            self.assertTrue(EXPECTED_TABLES <= names)
            self.assertEqual(foreign_keys, 1)
            self.assertEqual(versions, [1, 2, 3])
            self.assertIn("manifest_json", capsule_columns)

    def test_version_one_schema_migrates_without_losing_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "scully.db"
            with closing(sqlite3.connect(path)) as connection, connection:
                connection.executescript(
                    """
                    CREATE TABLE schema_metadata (
                        version INTEGER PRIMARY KEY,
                        applied_at TEXT NOT NULL
                    );
                    INSERT INTO schema_metadata VALUES (1, '2026-09-11T00:00:00Z');
                    CREATE TABLE capsules (
                        capsule_id TEXT PRIMARY KEY,
                        schema_version TEXT NOT NULL,
                        title TEXT NOT NULL,
                        observed_summary TEXT NOT NULL,
                        signature_id TEXT NOT NULL,
                        imported_at TEXT NOT NULL
                    );
                    CREATE TABLE evidence (
                        evidence_id TEXT PRIMARY KEY,
                        capsule_id TEXT NOT NULL REFERENCES capsules(capsule_id),
                        relative_path TEXT NOT NULL,
                        sha256 TEXT NOT NULL,
                        byte_size INTEGER NOT NULL,
                        media_type TEXT NOT NULL,
                        provenance TEXT NOT NULL,
                        redaction_status TEXT NOT NULL
                    );
                    INSERT INTO capsules VALUES (
                        'old-capsule', '1.0', 'Old', 'Summary', 'signature',
                        '2026-09-11T00:00:00Z'
                    );
                    INSERT INTO evidence VALUES (
                        'item', 'old-capsule', 'evidence/item.json',
                        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                        2, 'application/json', 'Synthetic', 'clean'
                    );
                    """
                )

            database = Database(path)
            database.initialize()

            with database.connect() as connection:
                evidence_count = connection.execute("SELECT COUNT(*) FROM evidence").fetchone()[0]
                primary_key = [
                    row["name"]
                    for row in sorted(
                        (row for row in connection.execute("PRAGMA table_info(evidence)") if row["pk"]),
                        key=lambda row: row["pk"],
                    )
                ]
            self.assertTrue(database.is_ready())
            self.assertEqual(evidence_count, 1)
            self.assertEqual(primary_key, ["capsule_id", "evidence_id"])


if __name__ == "__main__":
    unittest.main()
