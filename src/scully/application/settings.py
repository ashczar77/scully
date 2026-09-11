"""Local product settings that contain no provider credentials."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class ProductSettings:
    """Filesystem settings for the offline-first application."""

    data_dir: Path
    web_dist: Path
    seed_capsules_dir: Path

    @property
    def database_path(self) -> Path:
        """Return the local SQLite database path."""

        return self.data_dir / "scully.db"

    @property
    def artifact_dir(self) -> Path:
        """Return the content-addressed artifact root."""

        return self.data_dir / "artifacts"

    @classmethod
    def from_environment(
        cls,
        environ: Mapping[str, str] | None = None,
        *,
        working_directory: Path | None = None,
    ) -> ProductSettings:
        """Load paths without reading or exposing provider credentials."""

        values = os.environ if environ is None else environ
        root = (working_directory or Path.cwd()).resolve()
        data_dir = _resolve_path(values.get("SCULLY_DATA_DIR", ".scully"), root)
        web_dist = _resolve_path(values.get("SCULLY_WEB_DIST", "web/dist"), root)
        seed_capsules_dir = _resolve_path(
            values.get("SCULLY_SEED_CAPSULES_DIR", "fixtures/capsules"),
            root,
        )
        return cls(
            data_dir=data_dir,
            web_dist=web_dist,
            seed_capsules_dir=seed_capsules_dir,
        )


def _resolve_path(value: str, root: Path) -> Path:
    if not value.strip():
        raise ValueError("Application paths must not be blank")
    path = Path(value)
    return (root / path).resolve() if not path.is_absolute() else path.resolve()
