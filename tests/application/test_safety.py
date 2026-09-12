from __future__ import annotations

import unittest

from scully.application.safety import contains_sensitive_text


class SensitiveContentTests(unittest.TestCase):
    def test_credential_and_local_path_families_are_detected(self) -> None:
        values = (
            "-----BEGIN " + "PRIVATE KEY-----",
            "AKIA" + "A" * 16,
            "ghp_" + "a" * 24,
            "sk-" + "a" * 24,
            "AIza" + "a" * 24,
            "xoxb-" + "1" * 20,
            "eyJ" + "a" * 12 + "." + "b" * 12 + "." + "c" * 12,
            "password=" + "synthetic-value-12345",
            "https://user:" + "synthetic-value@example.invalid/path",
            "/Users/" + "builder/private/project.txt",
        )

        for value in values:
            with self.subTest(value=value[:12]):
                self.assertTrue(contains_sensitive_text(value))

    def test_safe_product_text_is_not_flagged(self) -> None:
        self.assertFalse(
            contains_sensitive_text(
                "Two TEST-NET-2 clients cross one loopback proxy and return 200,429."
            )
        )


if __name__ == "__main__":
    unittest.main()
