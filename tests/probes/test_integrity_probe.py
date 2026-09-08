from __future__ import annotations

import json
import unittest
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from scully.config import Settings
from scully.probes.integrity import (
    INCIDENT_PAYLOAD,
    KNOWN_GOOD_PAYLOAD,
    PARENT_OUTPUT,
    PROBE_IMAGE,
    run_probe,
)


class FakePending:
    def __init__(self, result: object | Exception) -> None:
        self.result = result

    def wait(self) -> object:
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


class FakeImage:
    def __init__(
        self,
        uuid: str,
        *,
        stdout: str = "",
        stderr: str = "",
        exit_code: int = 0,
        children: list[object | Exception] | None = None,
    ) -> None:
        self.uuid = uuid
        self.tag = None
        self.result = SimpleNamespace(
            stdout=stdout,
            stderr=stderr,
            exit_code=exit_code,
            elapsed_time=timedelta(seconds=0.1),
            cost=0.01,
        )
        self.children = children or []

    def run(self, command: str, **kwargs: object) -> FakePending:
        if not self.children:
            raise AssertionError("No fake result remains")
        return FakePending(self.children.pop(0))


class FakeImages:
    def __init__(self, base: FakeImage) -> None:
        self.base = base
        self.calls: list[tuple[str, bool]] = []

    def use(self, image: str, *, strict: bool) -> FakeImage:
        self.calls.append((image, strict))
        return self.base


class FakeClient:
    def __init__(self, base: FakeImage) -> None:
        self.images = FakeImages(base)


def live_settings() -> Settings:
    return Settings.from_environment(
        {
            "SCULLY_ENABLE_LIVE": "true",
            "SCULLY_LIVE_PROVIDER": "sandbox",
            "SCULLY_MAX_SANDBOX_OPERATIONS": "4",
            "NEBIUS_API_KEY": "test-nebius-key",
            "NEBIUS_PROJECT_ID": "test-project",
        }
    )


def clock() -> object:
    started = datetime(2026, 9, 8, 12, 0, tzinfo=UTC)
    return iter(
        started + timedelta(seconds=value)
        for value in (0, 0.1, 0.4, 0.5, 0.6)
    ).__next__


def successful_client() -> FakeClient:
    incident = FakeImage(
        "sensitive-incident-uuid",
        stdout=json.dumps(INCIDENT_PAYLOAD, sort_keys=True) + "\n",
    )
    known_good = FakeImage(
        "sensitive-known-good-uuid",
        stdout=json.dumps(KNOWN_GOOD_PAYLOAD, sort_keys=True) + "\n",
    )
    parent = FakeImage(
        "sensitive-parent-uuid",
        stdout=PARENT_OUTPUT,
        children=[incident, known_good],
    )
    return FakeClient(FakeImage("base", children=[parent]))


class IntegrityProbeTests(unittest.TestCase):
    def test_success_is_redacted_and_requires_incident_and_known_good(self) -> None:
        client = successful_client()

        record = run_probe(
            live_settings(),
            client_factory=lambda settings: client,
            clock=clock(),
        )
        encoded = json.dumps(record)

        self.assertEqual(record["status"], "succeeded")
        self.assertEqual(record["base_image"], PROBE_IMAGE)
        self.assertTrue(record["common_checkpoint"])
        self.assertTrue(record["isolation_passed"])
        self.assertEqual(record["incident_verdict"], "matched")
        self.assertEqual(record["known_good_verdict"], "not_matched")
        self.assertEqual(record["incident_matcher_count"], 5)
        self.assertEqual(record["known_good_failed_matcher_count"], 3)
        self.assertEqual(record["measurement"]["sandbox_operations"], 4)
        self.assertNotIn("same-digest", encoded)
        self.assertNotIn("sensitive-incident-uuid", encoded)

    def test_sibling_leak_is_a_redacted_contract_failure(self) -> None:
        client = successful_client()
        parent = client.images.base.children[0]
        payload = dict(INCIDENT_PAYLOAD)
        payload["visible_markers"] = ["baseline", "branch-a", "branch-b"]
        parent.children[0].result.stdout = json.dumps(payload) + "\n"

        record = run_probe(
            live_settings(),
            client_factory=lambda settings: client,
            clock=clock(),
        )

        self.assertEqual(record["status"], "failed")
        self.assertEqual(record["failure_stage"], "contract_validation")
        self.assertNotIn("same-digest", json.dumps(record))

    def test_timeout_maps_to_terminal_timeout_without_provider_message(self) -> None:
        client = successful_client()
        parent = client.images.base.children[0]

        class OperationTimedOutError(Exception):
            pass

        parent.children[0] = OperationTimedOutError("sensitive provider message")
        record = run_probe(
            live_settings(),
            client_factory=lambda settings: client,
            clock=clock(),
        )

        self.assertEqual(record["status"], "timed_out")
        self.assertEqual(record["operations_completed"], 2)
        self.assertNotIn("sensitive provider message", json.dumps(record))

    def test_cancellation_maps_to_terminal_cancelled(self) -> None:
        client = successful_client()
        parent = client.images.base.children[0]

        class CancelledOperationError(Exception):
            pass

        parent.children[0] = CancelledOperationError("sensitive provider message")
        record = run_probe(
            live_settings(),
            client_factory=lambda settings: client,
            clock=clock(),
        )

        self.assertEqual(record["status"], "cancelled")
        self.assertEqual(record["operations_completed"], 2)
        self.assertNotIn("sensitive provider message", json.dumps(record))


if __name__ == "__main__":
    unittest.main()
