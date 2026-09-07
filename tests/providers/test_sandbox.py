from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta

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
        cpu_seconds: float = 0.1,
        children: list[FakeResult] | None = None,
    ) -> None:
        self.uuid = uuid
        self.stdout = stdout
        self.stderr = stderr
        self.exit_code = exit_code
        self.cpu_seconds = cpu_seconds
        self.children = children or []
        self.calls: list[tuple[str, tuple[str, ...], bool]] = []

    def run(
        self,
        command: str,
        *,
        args: tuple[str, ...],
        disposable: bool,
    ) -> FakePending:
        self.calls.append((command, args, disposable))
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
            "NEBIUS_API_KEY": "fake-nebius-key",
            "NEBIUS_PROJECT_ID": "fake-project-id",
            "SCULLY_MAX_SANDBOX_OPERATIONS": str(max_operations),
        }
    )


def fake_client(parent_exit_code: int = 0) -> tuple[FakeSandboxClient, FakeResult]:
    branches = [
        FakeResult("branch-a", stdout="A\n", cpu_seconds=0.2),
        FakeResult("branch-b", stdout="B\n", cpu_seconds=0.3),
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
        self.assertEqual(outcome.measurement.sandbox_operations, 4)
        self.assertAlmostEqual(outcome.measurement.sandbox_cpu_seconds, 0.6)

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
        parent.children[0].stdout = "x" * 20_001
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
