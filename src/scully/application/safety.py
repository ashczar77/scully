"""Shared sensitive-content checks for accepted and exported text."""

from __future__ import annotations

import re


SENSITIVE_PATTERNS = (
    re.compile(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9_]{20,}\b"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b"),
    re.compile(r"\bAIza[A-Za-z0-9_-]{20,}\b"),
    re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b"),
    re.compile(
        r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"
        r"\.[A-Za-z0-9_-]{10,}\b"
    ),
    re.compile(
        r"(?i)(?<![A-Za-z0-9])(?:[A-Za-z0-9]+[_-])*"
        r"(?:api[_-]?key|access[_-]?token|password|secret)\b"
        r"[\"']?\s*[:=]\s*[\"']?[^\s\"',}{]{8,}"
    ),
    re.compile(r"(?i)https?://[^\s/:]+:[^\s/@]+@"),
    re.compile(r"(?:/Users/|/home/|[A-Za-z]:\\Users\\)[^\s\"']+"),
)


def contains_sensitive_text(text: str) -> bool:
    """Return whether bounded text matches a credential or local-path pattern."""

    return any(pattern.search(text) for pattern in SENSITIVE_PATTERNS)
