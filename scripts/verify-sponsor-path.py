"""Preflight or execute one explicitly approved sponsor-backed product run."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from scully.sponsor_path import (
    SponsorPathError,
    run_live_sponsor_path,
    sponsor_preflight,
)


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--execute-once", metavar="RUN_ID")
    arguments = parser.parse_args()
    if arguments.execute_once is None:
        result = sponsor_preflight()
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0
    try:
        result = run_live_sponsor_path(
            REPOSITORY_ROOT,
            run_id=arguments.execute_once,
        )
    except SponsorPathError as error:
        print(
            json.dumps(
                {"status": "blocked", "reason_code": error.code},
                indent=2,
                sort_keys=True,
            )
        )
        return 1
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
