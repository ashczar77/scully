from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from scully.config import ConfigurationError, Settings
from scully.providers import ProviderContractError
from scully.providers.sandbox import SandboxAdapter, SandboxCommand


class FakePending:
    def __init__(self, result: object) -> None:
        self.result = result

    def wait(self) -> object:
        return self.result


class FakeResult:
    def __init__(
        self,
        uuid: str,
        *,
        stdout: str = "",
        stderr: str = "",
        exit_code: int = 0,
        elapsed_seconds: float = 0.1,
        reported_cost: float = 0.01,
        children: list[FakeResult] | None = None,
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
        self.calls: list[
            tuple[str, tuple[str, ...], bool, int, int]
        ] = []

    def run(
        self,
        command: str,
        *,
        args: tuple[str, ...],
        disposable: bool,
        timeout: int,
        truncate_output_at: int,
    ) -> FakePending:
        self.calls.append(
            (command, args, disposable, timeout, truncate_output_at)
        )
        if not self.children:
            raise AssertionError("No fake child result remains")
        return FakePending(self.children.pop(0))


class FakeImages:
    def __init__(self, base: FakeResult) -> None:
        self.base = base
        self.calls: list[tuple[str, bool]] = []

    def use(self, image: str, *, strict: bool) -> FakeResult:
        self.calls.append((image, strict))
        return self.base


class FakeSandboxClient:
    def __init__(self, base: FakeResult) -> None:
        self.images = FakeImages(base)


def live_settings(max_operations: int = 4) -> Settings:
    return Settings.from_environment(
        {
            "SCULLY_ENABLE_LIVE": "true",
            "SCULLY_LIVE_PROVIDER": "sandbox",
            "NEBIUS_API_KEY": "fake-nebius-key",
            "NEBIUS_PROJECT_ID": "fake-project-id",
            "SCULLY_MAX_SANDBOX_OPERATIONS": str(max_operations),
        }
    )


def fake_client(parent_exit_code: int = 0) -> tuple[FakeSandboxClient, FakeResult]:
    branches = [
        FakeResult("branch-a", stdout="A\n", elapsed_seconds=0.2),
        FakeResult("branch-b", stdout="B\n", elapsed_seconds=0.3),
    ]
    parent = FakeResult("parent", exit_code=parent_exit_code, children=branches)
    base = FakeResult("base", children=[parent])
    return FakeSandboxClient(base), parent


class SandboxAdapterTests(unittest.TestCase):
    def setUp(self) -> None:
        started = datetime(2026, 9, 7, 9, 0, tzinfo=UTC)
        self.times = iter([started, started + timedelta(seconds=1)])
        self.prepare = SandboxCommand(
            label="prepare",
            executable="/bin/sh",
            args=("-c", "printf base > /tmp/state"),
        )
        self.branches = (
            SandboxCommand(label="branch-a", executable="/bin/echo", args=("A",)),
            SandboxCommand(label="branch-b", executable="/bin/echo", args=("B",)),
        )

    def test_runs_independent_children_from_one_persisted_parent(self) -> None:
        client, parent = fake_client()
        adapter = SandboxAdapter(
            client,
            live_settings(),
            clock=self.times.__next__,
        )

        outcome = adapter.run_branches(
            investigation_id="provider-contract-001",
            base_image="python:3.12-slim",
            prepare=self.prepare,
            branches=self.branches,
        )

        self.assertEqual(client.images.calls, [("python:3.12-slim", True)])
        self.assertEqual(outcome.parent_image_id, "parent")
        self.assertEqual([result.label for result in outcome.branches], ["branch-a", "branch-b"])
        self.assertEqual(len(parent.calls), 2)
        self.assertTrue(all(call[2] is False for call in parent.calls))
        self.assertTrue(all(call[3] == 60 for call in parent.calls))
        self.assertTrue(all(call[4] == 20_000 for call in parent.calls))
        self.assertEqual(outcome.measurement.sandbox_operations, 4)
        self.assertAlmostEqual(outcome.measurement.sandbox_elapsed_seconds, 0.6)
        self.assertAlmostEqual(outcome.measurement.sandbox_reported_cost, 0.03)

    def test_blocks_lifecycle_that_exceeds_operation_cap(self) -> None:
        client, _ = fake_client()
        adapter = SandboxAdapter(
            client,
            live_settings(max_operations=3),
            clock=self.times.__next__,
        )

        with self.assertRaisesRegex(ConfigurationError, "operation cap"):
            adapter.run_branches(
                investigation_id="provider-contract-001",
                base_image="python:3.12-slim",
                prepare=self.prepare,
                branches=self.branches,
            )
        self.assertEqual(client.images.calls, [])

    def test_stops_when_parent_preparation_fails(self) -> None:
        client, parent = fake_client(parent_exit_code=1)
        adapter = SandboxAdapter(
            client,
            live_settings(),
            clock=self.times.__next__,
        )

        with self.assertRaisesRegex(ProviderContractError, "preparation command failed"):
            adapter.run_branches(
                investigation_id="provider-contract-001",
                base_image="python:3.12-slim",
                prepare=self.prepare,
                branches=self.branches,
            )
        self.assertEqual(parent.calls, [])

    def test_rejects_shell_name_as_executable(self) -> None:
        with self.assertRaisesRegex(ValueError, "absolute path"):
            SandboxCommand(label="unsafe", executable="sh", args=("-c", "echo hi"))

    def test_rejects_missing_investigation_id_before_image_selection(self) -> None:
        client, _ = fake_client()
        adapter = SandboxAdapter(
            client,
            live_settings(),
            clock=self.times.__next__,
        )

        with self.assertRaisesRegex(ValueError, "investigation_id"):
            adapter.run_branches(
                investigation_id="",
                base_image="python:3.12-slim",
                prepare=self.prepare,
                branches=self.branches,
            )
        self.assertEqual(client.images.calls, [])

    def test_rejects_oversized_command_output(self) -> None:
        client, parent = fake_client()
        parent.children[0].result.stdout = "x" * 20_001
        adapter = SandboxAdapter(
            client,
            live_settings(),
            clock=self.times.__next__,
        )

        with self.assertRaisesRegex(ProviderContractError, "size cap"):
            adapter.run_branches(
                investigation_id="provider-contract-001",
                base_image="python:3.12-slim",
                prepare=self.prepare,
                branches=self.branches,
            )


if __name__ == "__main__":
    unittest.main()
