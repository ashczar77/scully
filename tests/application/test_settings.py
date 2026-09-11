from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scully.application.settings import ProductSettings


class ProductSettingsTests(unittest.TestCase):
    def test_relative_paths_resolve_from_the_working_directory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            settings = ProductSettings.from_environment(
                {
                    "SCULLY_DATA_DIR": "state",
                    "SCULLY_WEB_DIST": "ui",
                },
                working_directory=root,
            )

            self.assertEqual(settings.data_dir, (root / "state").resolve())
            self.assertEqual(settings.web_dist, (root / "ui").resolve())
            self.assertEqual(
                settings.seed_capsules_dir,
                (root / "fixtures/capsules").resolve(),
            )

    def test_blank_path_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "must not be blank"):
            ProductSettings.from_environment(
                {"SCULLY_DATA_DIR": "", "SCULLY_WEB_DIST": "web/dist"}
            )


if __name__ == "__main__":
    unittest.main()
