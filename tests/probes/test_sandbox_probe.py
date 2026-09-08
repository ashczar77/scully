from __future__ import annotations

import json
import unittest
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import Mock

from scully.config import ConfigurationError, Settings
from scully.probes.sandbox import (
    BRANCH_OUTPUTS,
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
        elapsed_seconds: float = 0.1,
        reported_cost: float = 0.01,
        children: list[object | Exception] | None = None,
    ) -> None:
        self.uuid = uuid
        self.tag = None
        self.result = SimpleNamespace(
            stdout=stdout,
            stderr=stderr,
            exit_code=exit_code,
            elapsed_time=timedelta(seconds=elapsed_seconds),
            cost=reported_cost,
        )
        self.children = children or []
        self.calls: list[dict[str, object]] = []

    def run(self, command: str, **kwargs: object) -> FakePending:
        self.calls.append({"command": command, **kwargs})
        if not self.children:
            raise AssertionError("No fake result remains")
        return FakePending(self.children.pop(0))


class FakeImages:
    def __init__(self, result: object | Exception) -> None:
        self.result = result
        self.calls: list[tuple[str, bool]] = []

    def use(self, image: str, *, strict: bool) -> object:
        self.calls.append((image, strict))
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


class FakeClient:
    def __init__(self, result: object | Exception) -> None:
        self.images = FakeImages(result)


def successful_client() -> tuple[FakeClient, FakeImage, FakeImage]:
    branch_a = FakeImage("sensitive-branch-a-uuid", stdout=BRANCH_OUTPUTS[0])
    branch_b = FakeImage("sensitive-branch-b-uuid", stdout=BRANCH_OUTPUTS[1])
    parent = FakeImage(
        "sensitive-parent-uuid",
        stdout=PARENT_OUTPUT,
        children=[branch_a, branch_b],
    )
    base = FakeImage("base", children=[parent])
    return FakeClient(base), base, parent


def live_settings(**overrides: str) -> Settings:
    values = {
        "SCULLY_ENABLE_LIVE": "true",
        "SCULLY_LIVE_PROVIDER": "sandbox",
        "SCULLY_MAX_SANDBOX_OPERATIONS": "4",
        "NEBIUS_API_KEY": "test-nebius-key",
        "NEBIUS_PROJECT_ID": "test-project",
    }
    values.update(overrides)
    return Settings.from_environment(values)


def clock() -> object:
    started = datetime(2026, 9, 8, 8, 0, tzinfo=UTC)
    return iter(
        started + timedelta(seconds=value)
        for value in (0, 0.1, 0.4, 0.5, 0.6)
    ).__next__


class SandboxProbeTests(unittest.TestCase):
    def test_success_record_proves_branching_without_retaining_output(self) -> None:
        client, base, parent = successful_client()

        record = run_probe(
            live_settings(),
            client_factory=lambda settings: client,
            clock=clock(),
        )
        encoded = json.dumps(record)

        self.assertEqual(record["status"], "succeeded")
        self.assertEqual(record["base_image"], PROBE_IMAGE)
        self.assertTrue(record["parent_output_match"])
        self.assertEqual(record["branch_output_matches"], [True, True])
        self.assertTrue(record["resulting_images_distinct"])
        self.assertEqual(record["untagged_resulting_images"], 3)
        self.assertEqual(record["measurement"]["sandbox_operations"], 4)
        self.assertAlmostEqual(
            record["measurement"]["sandbox_elapsed_seconds"], 0.3
        )
        self.assertAlmostEqual(record["measurement"]["sandbox_reported_cost"], 0.03)
        self.assertEqual(client.images.calls, [(PROBE_IMAGE, True)])
        self.assertEqual(len(base.calls), 1)
        self.assertEqual(len(parent.calls), 2)
        self.assertTrue(all(call["disposable"] is False for call in parent.calls))
        self.assertTrue(all(call["timeout"] == 60 for call in parent.calls))
        self.assertNotIn(PARENT_OUTPUT.strip(), encoded)
        self.assertNotIn(BRANCH_OUTPUTS[0].strip(), encoded)
        self.assertNotIn("sensitive-parent-uuid", encoded)
        self.assertNotIn("sensitive-branch-a-uuid", encoded)

    def test_closed_preflight_blocks_before_client_construction(self) -> None:
        factory = Mock()

        with self.assertRaisesRegex(ConfigurationError, "preflight"):
            run_probe(Settings.from_environment({}), client_factory=factory)

        factory.assert_not_called()

    def test_wrong_provider_target_blocks_before_client_construction(self) -> None:
        factory = Mock()

        with self.assertRaisesRegex(ConfigurationError, "preflight"):
            run_probe(
                live_settings(SCULLY_LIVE_PROVIDER="tavily"),
                client_factory=factory,
            )

        factory.assert_not_called()

    def test_image_selection_failure_is_redacted(self) -> None:
        client = FakeClient(RuntimeError("sensitive provider message"))

        record = run_probe(
            live_settings(),
            client_factory=lambda settings: client,
            clock=clock(),
        )
        encoded = json.dumps(record)

        self.assertEqual(record["status"], "failed")
        self.assertEqual(record["failure_stage"], "image_selection")
        self.assertEqual(record["measurement"]["sandbox_operations"], 1)
        self.assertEqual(record["operations_completed"], 0)
        self.assertNotIn("sensitive provider message", encoded)

    def test_branch_mismatch_is_a_redacted_contract_failure(self) -> None:
        client, _, parent = successful_client()
        parent.children[1].result.stdout = "unexpected sensitive output"

        record = run_probe(
            live_settings(),
            client_factory=lambda settings: client,
            clock=clock(),
        )
        encoded = json.dumps(record)

        self.assertEqual(record["status"], "failed")
        self.assertEqual(record["failure_stage"], "contract_validation")
        self.assertEqual(record["measurement"]["sandbox_operations"], 4)
        self.assertEqual(record["operations_completed"], 4)
        self.assertNotIn("unexpected sensitive output", encoded)


if __name__ == "__main__":
    unittest.main()
