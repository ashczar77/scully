from __future__ import annotations

import unittest
from types import SimpleNamespace

from scully.config import ConfigurationError, Settings
from scully.providers import ProviderContractError
from scully.providers.termination import (
    CANCELLATION_COMMAND_SECONDS,
    MAX_OUTPUT_BYTES,
    MAX_STATUS_READS_PER_PATH,
    REQUIRED_SANDBOX_OPERATIONS,
    TIMEOUT_COMMAND_SECONDS,
    TerminationAdapter,
    TerminationTracker,
    require_image_source,
)


def response(
    operation_id: str,
    status: str,
    *,
    timed_out: bool = False,
    disposable: bool = True,
    result_image_uuid: str | None = None,
    duration: float = 0.1,
) -> object:
    return SimpleNamespace(
        uuid=operation_id,
        status=status,
        duration=duration,
        result_image_uuid=result_image_uuid,
        metadata=SimpleNamespace(
            disposable=disposable,
            result=SimpleNamespace(
                state=SimpleNamespace(timed_out=timed_out)
            ),
        ),
    )


class FakeTime:
    def __init__(self) -> None:
        self.value = 0.0
        self.sleeps: list[float] = []

    def monotonic(self) -> float:
        return self.value

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.value += seconds


class FakeClient:
    def __init__(
        self,
        statuses: dict[str, list[object]],
        *,
        cancel_error: Exception | None = None,
        spawn_error: Exception | None = None,
    ) -> None:
        self.statuses = statuses
        self.cancel_error = cancel_error
        self.spawn_error = spawn_error
        self.spawn_ids = iter(statuses)
        self.spawn_calls: list[tuple[str, str, dict[str, object]]] = []
        self.status_calls: list[tuple[str, bool]] = []
        self.cancel_calls: list[str] = []
        self.closed = False

    def spawn_instance(
        self, command: str, image: str, **kwargs: object
    ) -> object:
        self.spawn_calls.append((command, image, kwargs))
        if self.spawn_error is not None:
            raise self.spawn_error
        operation_id = next(self.spawn_ids)
        return SimpleNamespace(uuid=operation_id)

    def get_operation_status(
        self, operation_id: str, *, inflight: bool = False
    ) -> object:
        self.status_calls.append((operation_id, inflight))
        values = self.statuses[operation_id]
        if len(values) > 1:
            return values.pop(0)
        return values[0]

    def cancel_operation(self, operation_id: str) -> None:
        self.cancel_calls.append(operation_id)
        if self.cancel_error is not None and len(self.cancel_calls) == 1:
            raise self.cancel_error

    def close(self) -> None:
        self.closed = True


def live_settings(max_operations: int = REQUIRED_SANDBOX_OPERATIONS) -> Settings:
    return Settings.from_environment(
        {
            "SCULLY_ENABLE_LIVE": "true",
            "SCULLY_LIVE_PROVIDER": "sandbox",
            "SCULLY_MAX_SANDBOX_OPERATIONS": str(max_operations),
            "SCULLY_TIMEOUT_SECONDS": "15",
            "NEBIUS_API_KEY": "test-key",
            "NEBIUS_PROJECT_ID": "test-project",
        }
    )


def successful_client() -> FakeClient:
    return FakeClient(
        {
            "sensitive-timeout-id": [
                response("sensitive-timeout-id", "EXECUTING"),
                response(
                    "sensitive-timeout-id",
                    "SUCCESS",
                    timed_out=True,
                    duration=1.0,
                ),
            ],
            "sensitive-cancel-id": [
                response("sensitive-cancel-id", "EXECUTING"),
                response(
                    "sensitive-cancel-id",
                    "CANCELLED",
                    duration=0.2,
                ),
            ],
        }
    )


class TerminationAdapterTests(unittest.TestCase):
    def test_runs_bounded_timeout_then_exact_cancellation(self) -> None:
        client = successful_client()
        tracker = TerminationTracker()
        fake_time = FakeTime()
        outcome = TerminationAdapter(
            client,
            live_settings(),
            tracker=tracker,
            monotonic=fake_time.monotonic,
            sleeper=fake_time.sleep,
        ).run(base_image="tag:python:3.12-slim")

        self.assertEqual(outcome.timeout.terminal_status, "SUCCESS")
        self.assertTrue(outcome.timeout.timed_out)
        self.assertEqual(outcome.cancellation.terminal_status, "CANCELLED")
        self.assertEqual(client.cancel_calls, ["sensitive-cancel-id"])
        self.assertEqual(tracker.spawn_calls_attempted, 2)
        self.assertEqual(tracker.operation_ids_confirmed, 2)
        self.assertEqual(tracker.status_reads, 4)
        self.assertEqual(tracker.primary_cancel_requests, 1)
        self.assertEqual(tracker.cleanup_cancel_requests, 0)
        self.assertEqual(tracker.request_count, 7)
        self.assertTrue(all(call[2]["disposable"] for call in client.spawn_calls))
        self.assertEqual(
            [call[1] for call in client.spawn_calls],
            ["tag:python:3.12-slim", "tag:python:3.12-slim"],
        )
        self.assertTrue(all(not call[2]["shell"] for call in client.spawn_calls))
        self.assertTrue(
            all(
                call[2]["truncate_output_at"] == MAX_OUTPUT_BYTES
                for call in client.spawn_calls
            )
        )
        self.assertEqual(
            [call[2]["timeout"] for call in client.spawn_calls],
            [TIMEOUT_COMMAND_SECONDS, CANCELLATION_COMMAND_SECONDS],
        )

    def test_stops_after_timeout_failure_and_cleans_exact_operation(self) -> None:
        operation_id = "sensitive-timeout-id"
        client = FakeClient(
            {
                operation_id: [response(operation_id, "EXECUTING")],
                "must-not-spawn": [response("must-not-spawn", "EXECUTING")],
            }
        )
        tracker = TerminationTracker()
        fake_time = FakeTime()
        adapter = TerminationAdapter(
            client,
            live_settings(),
            tracker=tracker,
            monotonic=fake_time.monotonic,
            sleeper=fake_time.sleep,
        )

        with self.assertRaises(TimeoutError):
            adapter.run(base_image="tag:python:3.12-slim")

        self.assertEqual(tracker.spawn_calls_attempted, 1)
        self.assertEqual(tracker.operation_ids_confirmed, 1)
        self.assertEqual(tracker.status_reads, MAX_STATUS_READS_PER_PATH)
        self.assertEqual(tracker.cleanup_cancel_requests, 1)
        self.assertEqual(client.cancel_calls, [operation_id])

    def test_failed_primary_cancel_gets_one_cleanup_attempt(self) -> None:
        client = successful_client()
        client.cancel_error = RuntimeError("sensitive provider detail")
        tracker = TerminationTracker()
        fake_time = FakeTime()
        adapter = TerminationAdapter(
            client,
            live_settings(),
            tracker=tracker,
            monotonic=fake_time.monotonic,
            sleeper=fake_time.sleep,
        )

        with self.assertRaises(RuntimeError):
            adapter.run(base_image="tag:python:3.12-slim")

        self.assertEqual(tracker.primary_cancel_requests, 1)
        self.assertEqual(tracker.cleanup_cancel_requests, 1)
        self.assertEqual(
            client.cancel_calls,
            ["sensitive-cancel-id", "sensitive-cancel-id"],
        )

    def test_cancellation_status_limit_gets_one_cleanup_attempt(self) -> None:
        cancel_id = "sensitive-cancel-id"
        client = FakeClient(
            {
                "sensitive-timeout-id": [
                    response(
                        "sensitive-timeout-id",
                        "SUCCESS",
                        timed_out=True,
                    )
                ],
                cancel_id: [response(cancel_id, "EXECUTING")],
            }
        )
        tracker = TerminationTracker()
        fake_time = FakeTime()
        adapter = TerminationAdapter(
            client,
            live_settings(),
            tracker=tracker,
            monotonic=fake_time.monotonic,
            sleeper=fake_time.sleep,
        )

        with self.assertRaises(TimeoutError):
            adapter.run(base_image="tag:python:3.12-slim")

        self.assertEqual(tracker.spawn_calls_attempted, 2)
        self.assertEqual(tracker.operation_ids_confirmed, 2)
        self.assertEqual(
            tracker.status_reads,
            1 + MAX_STATUS_READS_PER_PATH,
        )
        self.assertEqual(tracker.primary_cancel_requests, 1)
        self.assertEqual(tracker.cleanup_cancel_requests, 1)
        self.assertEqual(client.cancel_calls, [cancel_id, cancel_id])

    def test_rejects_status_for_another_operation(self) -> None:
        client = FakeClient(
            {
                "expected-id": [response("other-id", "SUCCESS", timed_out=True)],
            }
        )
        fake_time = FakeTime()

        with self.assertRaisesRegex(ProviderContractError, "another operation"):
            TerminationAdapter(
                client,
                live_settings(),
                monotonic=fake_time.monotonic,
                sleeper=fake_time.sleep,
            ).run(base_image="tag:python:3.12-slim")
        self.assertEqual(client.cancel_calls, ["expected-id"])

    def test_rejects_retained_timeout_state(self) -> None:
        for terminal in (
            response(
                "timeout-id",
                "SUCCESS",
                timed_out=True,
                disposable=False,
            ),
            response(
                "timeout-id",
                "SUCCESS",
                timed_out=True,
                result_image_uuid="unexpected-image-id",
            ),
        ):
            with self.subTest(terminal=terminal):
                client = FakeClient({"timeout-id": [terminal]})
                fake_time = FakeTime()
                with self.assertRaisesRegex(
                    ProviderContractError,
                    "retained Sandbox state",
                ):
                    TerminationAdapter(
                        client,
                        live_settings(),
                        monotonic=fake_time.monotonic,
                        sleeper=fake_time.sleep,
                    ).run(base_image="tag:python:3.12-slim")
                self.assertEqual(len(client.spawn_calls), 1)
                self.assertEqual(client.cancel_calls, [])

    def test_rejects_retained_cancellation_state(self) -> None:
        client = FakeClient(
            {
                "timeout-id": [
                    response("timeout-id", "SUCCESS", timed_out=True)
                ],
                "cancel-id": [
                    response("cancel-id", "EXECUTING"),
                    response(
                        "cancel-id",
                        "CANCELLED",
                        result_image_uuid="unexpected-image-id",
                    ),
                ],
            }
        )
        fake_time = FakeTime()

        with self.assertRaisesRegex(
            ProviderContractError,
            "retained Sandbox state",
        ):
            TerminationAdapter(
                client,
                live_settings(),
                monotonic=fake_time.monotonic,
                sleeper=fake_time.sleep,
            ).run(base_image="tag:python:3.12-slim")
        self.assertEqual(client.cancel_calls, ["cancel-id"])

    def test_requires_exact_reviewed_operation_budget(self) -> None:
        client = successful_client()
        with self.assertRaisesRegex(ConfigurationError, "exactly two"):
            TerminationAdapter(client, live_settings(max_operations=3)).run(
                base_image="tag:python:3.12-slim"
            )
        self.assertEqual(client.spawn_calls, [])

    def test_accepts_direct_api_tag_and_canonical_uuid(self) -> None:
        self.assertEqual(
            require_image_source("tag:python:3.12-slim"),
            "tag:python:3.12-slim",
        )
        self.assertEqual(
            require_image_source("12345678-9abc-baba-deda-0123456789ab"),
            "12345678-9abc-baba-deda-0123456789ab",
        )

    def test_rejects_unprefixed_tag_before_spawn(self) -> None:
        client = successful_client()

        with self.assertRaisesRegex(ValueError, "tag: prefix"):
            TerminationAdapter(client, live_settings()).run(
                base_image="python:3.12-slim"
            )

        self.assertEqual(client.spawn_calls, [])

    def test_rejects_noncanonical_uuid_before_spawn(self) -> None:
        client = successful_client()

        with self.assertRaisesRegex(ValueError, "canonical"):
            TerminationAdapter(client, live_settings()).run(
                base_image="123456789abcbabadeda0123456789ab"
            )

        self.assertEqual(client.spawn_calls, [])


if __name__ == "__main__":
    unittest.main()
