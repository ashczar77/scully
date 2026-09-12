from __future__ import annotations

import unittest
from datetime import UTC, datetime

from pydantic import ValidationError

from scully.domain.contracts import (
    InvestigationEvent,
    InvestigationStatus,
    ReproductionResult,
    ReproductionVerdict,
)


class DomainContractTests(unittest.TestCase):
    def test_terminal_investigation_states_fail_closed(self) -> None:
        self.assertFalse(InvestigationStatus.RUNNING.is_terminal())
        self.assertTrue(InvestigationStatus.TIMED_OUT.is_terminal())
        self.assertTrue(
            InvestigationStatus.TERMINATION_UNCONFIRMED.is_terminal()
        )

    def test_event_requires_timezone_and_rejects_unknown_fields(self) -> None:
        values = {
            "investigation_id": "investigation-1",
            "sequence": 1,
            "event_type": "investigation.created",
            "occurred_at": datetime(2026, 9, 11, 12, 0),
            "payload": {},
        }
        with self.assertRaises(ValidationError):
            InvestigationEvent.model_validate(values)

        values["occurred_at"] = datetime(2026, 9, 11, 12, 0, tzinfo=UTC)
        values["unexpected"] = True
        with self.assertRaises(ValidationError):
            InvestigationEvent.model_validate(values)

    def test_result_serializes_as_a_versioned_contract(self) -> None:
        result = ReproductionResult(
            investigation_id="investigation-1",
            verdict=ReproductionVerdict.INCONCLUSIVE,
            signature_id="signature-1",
            limitations=("Execution did not reach a terminal state",),
        )

        self.assertEqual(result.schema_version, "1.0")
        self.assertEqual(result.model_dump(mode="json")["verdict"], "inconclusive")

    def test_audit_events_require_allowlisted_types_and_exact_payloads(self) -> None:
        values = {
            "investigation_id": "investigation-1",
            "sequence": 1,
            "event_type": "execution.blocked",
            "occurred_at": datetime(2026, 9, 11, 12, 0, tzinfo=UTC),
            "payload": {
                "reason_code": "command_policy_violation",
                "retryable": False,
            },
        }
        event = InvestigationEvent.model_validate(values)
        self.assertEqual(event.payload["retryable"], False)

        with self.assertRaises(ValidationError):
            InvestigationEvent.model_validate(
                {**values, "payload": {**values["payload"], "detail": "unsafe"}}
            )
        with self.assertRaises(ValidationError):
            InvestigationEvent.model_validate(
                {**values, "event_type": "provider.raw_output"}
            )
        with self.assertRaises(ValidationError):
            InvestigationEvent.model_validate(
                {
                    **values,
                    "payload": {
                        "reason_code": "provider detail",
                        "retryable": True,
                    },
                }
            )
        with self.assertRaises(ValidationError):
            InvestigationEvent.model_validate(
                {
                    **values,
                    "payload": {
                        "reason_code": "x" * 5_000,
                        "retryable": False,
                    },
                }
            )


if __name__ == "__main__":
    unittest.main()
