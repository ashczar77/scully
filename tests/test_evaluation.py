from __future__ import annotations

import unittest

from scully.evaluation import (
    EVALUATOR_VERSION,
    EvaluationVerdict,
    ExecutionResult,
    ExecutionStatus,
    FailureSignature,
    MatcherKind,
    SignatureMatcher,
    evaluate_signature,
)


def proxy_signature() -> FailureSignature:
    return FailureSignature(
        signature_id="proxy-identity-collapse-v1",
        matchers=(
            SignatureMatcher(
                matcher_id="process-exit",
                kind=MatcherKind.EQUALS,
                path=("exit_code",),
                expected=0,
            ),
            SignatureMatcher(
                matcher_id="response-sequence",
                kind=MatcherKind.EQUALS,
                path=("payload", "statuses"),
                expected=[200, 429],
            ),
            SignatureMatcher(
                matcher_id="rejection-event",
                kind=MatcherKind.EQUALS,
                path=("payload", "records", 1, "event"),
                expected="rate_limit_rejected",
            ),
            SignatureMatcher(
                matcher_id="identity-collapse",
                kind=MatcherKind.SAME_VALUE,
                path=("payload", "identities", 0),
                comparison_path=("payload", "identities", 1),
            ),
            SignatureMatcher(
                matcher_id="forwarded-client",
                kind=MatcherKind.EQUALS,
                path=("payload", "records", 1, "forwardedClient"),
                expected="198.51.100.11",
            ),
        ),
    )


def completed(payload: dict[str, object]) -> ExecutionResult:
    return ExecutionResult(
        experiment_id="experiment-a",
        checkpoint_id="checkpoint-001",
        status=ExecutionStatus.COMPLETED,
        exit_code=0,
        payload=payload,
    )


class DeterministicEvaluationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.matching_payload = {
            "statuses": [200, 429],
            "identities": ["same-digest", "same-digest"],
            "records": [
                {
                    "event": "request_allowed",
                    "forwardedClient": "198.51.100.10",
                },
                {
                    "event": "rate_limit_rejected",
                    "forwardedClient": "198.51.100.11",
                },
            ],
        }

    def test_matching_observation_passes_every_required_matcher(self) -> None:
        report = evaluate_signature(proxy_signature(), completed(self.matching_payload))

        self.assertEqual(report.verdict, EvaluationVerdict.MATCHED)
        self.assertEqual(report.evaluator_version, EVALUATOR_VERSION)
        self.assertTrue(all(item.passed for item in report.matcher_results))

    def test_known_good_observation_does_not_match_incident_signature(self) -> None:
        payload = dict(self.matching_payload)
        payload["statuses"] = [200, 200]
        payload["identities"] = ["first-digest", "second-digest"]
        payload["records"] = [
            self.matching_payload["records"][0],
            {
                "event": "request_allowed",
                "forwardedClient": "198.51.100.11",
            },
        ]

        report = evaluate_signature(proxy_signature(), completed(payload))

        self.assertEqual(report.verdict, EvaluationVerdict.NOT_MATCHED)
        self.assertEqual(
            {item.matcher_id for item in report.matcher_results if not item.passed},
            {"response-sequence", "rejection-event", "identity-collapse"},
        )

    def test_digest_and_report_are_repeatable_for_reordered_object_keys(self) -> None:
        first = evaluate_signature(
            proxy_signature(),
            completed(self.matching_payload),
        )
        reordered = {
            "records": self.matching_payload["records"],
            "identities": self.matching_payload["identities"],
            "statuses": self.matching_payload["statuses"],
        }
        second = evaluate_signature(proxy_signature(), completed(reordered))

        self.assertEqual(first, second)

    def test_failed_timeout_and_cancelled_results_are_inconclusive(self) -> None:
        for status, error_code in (
            (ExecutionStatus.FAILED, "sandbox_operation_failed"),
            (ExecutionStatus.TIMED_OUT, "execution_timeout"),
            (ExecutionStatus.CANCELLED, "user_cancelled"),
        ):
            with self.subTest(status=status):
                report = evaluate_signature(
                    proxy_signature(),
                    ExecutionResult(
                        experiment_id="experiment-a",
                        checkpoint_id="checkpoint-001",
                        status=status,
                        error_code=error_code,
                    ),
                )
                self.assertEqual(report.verdict, EvaluationVerdict.INCONCLUSIVE)
                self.assertEqual(report.matcher_results, ())

    def test_model_style_matches_field_cannot_override_evaluator(self) -> None:
        payload = dict(self.matching_payload)
        payload["statuses"] = [500]
        payload["matches"] = True

        report = evaluate_signature(proxy_signature(), completed(payload))

        self.assertEqual(report.verdict, EvaluationVerdict.NOT_MATCHED)

    def test_missing_required_path_is_a_non_match(self) -> None:
        payload = dict(self.matching_payload)
        del payload["statuses"]

        report = evaluate_signature(proxy_signature(), completed(payload))

        result = next(
            item for item in report.matcher_results
            if item.matcher_id == "response-sequence"
        )
        self.assertFalse(result.passed)
        self.assertEqual(result.reason, "path_missing")

    def test_signature_requires_unique_matcher_ids(self) -> None:
        duplicate = SignatureMatcher(
            matcher_id="duplicate",
            kind=MatcherKind.EQUALS,
            path=("exit_code",),
            expected=0,
        )
        with self.assertRaisesRegex(ValueError, "unique"):
            FailureSignature(
                signature_id="invalid-v1",
                matchers=(duplicate, duplicate),
            )

    def test_non_finite_observation_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "finite"):
            completed({"value": float("nan")})


if __name__ == "__main__":
    unittest.main()
