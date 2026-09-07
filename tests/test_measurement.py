from __future__ import annotations

import json
import unittest
from datetime import UTC, datetime, timedelta, timezone
from decimal import Decimal

from scully.config import Provider
from scully.measurement import Measurement, OperationStatus


class MeasurementTests(unittest.TestCase):
    def setUp(self) -> None:
        self.started_at = datetime(2026, 9, 7, 8, 0, tzinfo=UTC)
        self.ended_at = self.started_at + timedelta(seconds=1.25)

    def test_record_is_bounded_and_json_serializable(self) -> None:
        measurement = Measurement(
            investigation_id="probe-001",
            provider=Provider.NEMOTRON,
            operation="structured_tool_call",
            status=OperationStatus.SUCCEEDED,
            started_at=self.started_at,
            ended_at=self.ended_at,
            input_tokens=120,
            output_tokens=40,
            model_cost_usd=Decimal("0.0000168"),
        )

        record = measurement.to_record()

        self.assertEqual(record["duration_seconds"], 1.25)
        self.assertEqual(record["model_cost_usd"], "0.0000168")
        self.assertNotIn("prompt", record)
        self.assertNotIn("response", record)
        json.dumps(record)

    def test_non_utc_timestamp_is_rejected(self) -> None:
        non_utc = datetime(2026, 9, 7, 10, 0, tzinfo=timezone(timedelta(hours=2)))

        with self.assertRaisesRegex(ValueError, "timezone-aware UTC"):
            Measurement(
                investigation_id="probe-001",
                provider=Provider.TAVILY,
                operation="search",
                status=OperationStatus.SUCCEEDED,
                started_at=non_utc,
                ended_at=non_utc + timedelta(seconds=1),
            )

    def test_end_before_start_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "cannot precede"):
            Measurement(
                investigation_id="probe-001",
                provider=Provider.SANDBOX,
                operation="execute",
                status=OperationStatus.FAILED,
                started_at=self.started_at,
                ended_at=self.started_at - timedelta(seconds=1),
            )

    def test_negative_usage_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "input_tokens"):
            Measurement(
                investigation_id="probe-001",
                provider=Provider.NEMOTRON,
                operation="structured_tool_call",
                status=OperationStatus.FAILED,
                started_at=self.started_at,
                ended_at=self.ended_at,
                input_tokens=-1,
            )

    def test_non_finite_cpu_measurement_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "must be finite"):
            Measurement(
                investigation_id="probe-001",
                provider=Provider.SANDBOX,
                operation="execute",
                status=OperationStatus.FAILED,
                started_at=self.started_at,
                ended_at=self.ended_at,
                sandbox_cpu_seconds=float("nan"),
            )


if __name__ == "__main__":
    unittest.main()
