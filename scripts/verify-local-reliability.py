"""Verify two independent local product runs and print bounded JSON."""

from __future__ import annotations

import json
from pathlib import Path

from scully.reliability import verify_local_reliability


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    """Print the local reliability report for review or automation."""

    print(
        json.dumps(
            verify_local_reliability(REPOSITORY_ROOT),
            separators=(",", ":"),
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
