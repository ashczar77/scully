from __future__ import annotations

import json
import unittest
from datetime import UTC, datetime, timedelta

from scully.config import ConfigurationError, Settings
from scully.dependencies import LOCKED_PROVIDER_VERSIONS
from scully.probes.termination import (
    CLIENT_PACKAGE,
    build_termination_preflight,
    run_probe,
)
from tests.providers.test_termination import (
    FakeClient,
    FakeTime,
    live_settings,
    response,
    successful_client,
)


def exact_version(package: str) -> str:
    return LOCKED_PROVIDER_VERSIONS[package]


def clock() -> object:
    started = datetime(2026, 9, 8, 12, 0, tzinfo=UTC)
    return iter([started, started + timedelta(seconds=2)]).__next__


class TerminationProbeTests(unittest.TestCase):
    def test_success_is_redacted_and_both_results_are_inconclusive(self) -> None:
        client = successful_client()
        fake_time = FakeTime()
        record = run_probe(
            live_settings(),
            client_factory=lambda settings: client,
            version_lookup=exact_version,
            clock=clock(),
            monotonic=fake_time.monotonic,
            sleeper=fake_time.sleep,
        )
        encoded = json.dumps(record)

        self.assertEqual(record["status"], "succeeded")
        self.assertEqual(record["probe_id"], "g1.3-termination-003")
        self.assertEqual(record["base_image"], "tag:python:3.12-slim")
        self.assertEqual(record["timeout"]["evaluation_verdict"], "inconclusive")
        self.assertEqual(
            record["cancellation"]["evaluation_verdict"],
            "inconclusive",
        )
        self.assertEqual(record["measurement"]["sandbox_operations"], 2)
        self.assertEqual(record["spawn_calls_attempted"], 2)
        self.assertEqual(record["operation_ids_confirmed"], 2)
        self.assertEqual(record["measurement"]["request_count"], 7)
        self.assertEqual(record["measurement"]["retries"], 0)
        self.assertFalse(record["provider_reported_cost_available"])
        self.assertNotIn("sandbox_reported_cost", record["measurement"])
        self.assertNotIn("sensitive-timeout-id", encoded)
        self.assertNotIn("sensitive-cancel-id", encoded)
        self.assertTrue(client.closed)

    def test_failure_record_excludes_provider_message_and_stops(self) -> None:
        operation_id = "sensitive-timeout-id"
        client = FakeClient(
            {
                operation_id: [response(operation_id, "EXECUTING")],
                "must-not-spawn": [response("must-not-spawn", "EXECUTING")],
            }
        )
        fake_time = FakeTime()
        record = run_probe(
            live_settings(),
            client_factory=lambda settings: client,
            version_lookup=exact_version,
            clock=clock(),
            monotonic=fake_time.monotonic,
            sleeper=fake_time.sleep,
        )

        self.assertEqual(record["status"], "timed_out")
        self.assertEqual(record["failure_path"], "timeout")
        self.assertEqual(record["spawn_calls_attempted"], 1)
        self.assertEqual(record["operation_ids_confirmed"], 1)
        self.assertFalse(record["provider_reported_cost_available"])
        self.assertNotIn("sandbox_reported_cost", record["measurement"])
        self.assertNotIn(operation_id, json.dumps(record))
        self.assertTrue(client.closed)

    def test_rejected_spawn_is_attempted_but_not_confirmed(self) -> None:
        client = FakeClient(
            {"unused-id": [response("unused-id", "EXECUTING")]},
            spawn_error=RuntimeError("sensitive provider message"),
        )
        record = run_probe(
            live_settings(),
            client_factory=lambda settings: client,
            version_lookup=exact_version,
            clock=clock(),
        )

        self.assertEqual(record["status"], "failed")
        self.assertEqual(record["spawn_calls_attempted"], 1)
        self.assertEqual(record["operation_ids_confirmed"], 0)
        self.assertEqual(record["measurement"]["sandbox_operations"], 0)
        self.assertNotIn("sensitive provider message", json.dumps(record))
        self.assertTrue(client.closed)

    def test_cancellation_reason_is_bounded_and_redacted(self) -> None:
        terminal = response("sensitive-cancel-id", "FAILED")
        terminal.error = "sensitive provider message"
        client = FakeClient(
            {
                "sensitive-timeout-id": [
                    response(
                        "sensitive-timeout-id",
                        "SUCCESS",
                        timed_out=True,
                    )
                ],
                "sensitive-cancel-id": [
                    response("sensitive-cancel-id", "EXECUTING"),
                    terminal,
                ],
            }
        )
        record = run_probe(
            live_settings(),
            client_factory=lambda settings: client,
            version_lookup=exact_version,
            clock=clock(),
        )
        encoded = json.dumps(record)

        self.assertEqual(record["status"], "failed")
        self.assertEqual(
            record["failure_reason"],
            "cancellation_status_mismatch",
        )
        self.assertNotIn("sensitive-timeout-id", encoded)
        self.assertNotIn("sensitive-cancel-id", encoded)
        self.assertNotIn("sensitive provider message", encoded)
        self.assertTrue(client.closed)

    def test_preflight_is_closed_for_wrong_package_or_budget(self) -> None:
        wrong_package = build_termination_preflight(
            live_settings(),
            version_lookup=lambda package: "0.0.0",
        )
        wrong_budget = build_termination_preflight(
            live_settings(max_operations=3),
            version_lookup=exact_version,
        )
        wrong_timeout = build_termination_preflight(
            Settings.from_environment(
                {
                    "SCULLY_ENABLE_LIVE": "true",
                    "SCULLY_LIVE_PROVIDER": "sandbox",
                    "SCULLY_MAX_SANDBOX_OPERATIONS": "2",
                    "SCULLY_TIMEOUT_SECONDS": "16",
                    "NEBIUS_API_KEY": "test-key",
                    "NEBIUS_PROJECT_ID": "test-project",
                }
            ),
            version_lookup=exact_version,
        )

        self.assertEqual(wrong_package["package"], CLIENT_PACKAGE)
        self.assertFalse(wrong_package["live_gate_open"])
        self.assertFalse(wrong_budget["live_gate_open"])
        self.assertFalse(wrong_timeout["live_gate_open"])

    def test_runner_refuses_closed_preflight_before_client_construction(self) -> None:
        constructed = False

        def factory(settings: object) -> FakeClient:
            nonlocal constructed
            constructed = True
            return successful_client()

        with self.assertRaisesRegex(ConfigurationError, "preflight"):
            run_probe(
                live_settings(),
                client_factory=factory,
                version_lookup=lambda package: None,
            )
        self.assertFalse(constructed)


if __name__ == "__main__":
    unittest.main()
