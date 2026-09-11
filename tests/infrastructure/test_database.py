from __future__ import annotations

import tempfile
import unittest
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

            self.assertTrue(EXPECTED_TABLES <= names)
            self.assertEqual(foreign_keys, 1)


if __name__ == "__main__":
    unittest.main()
