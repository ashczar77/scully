"""Internal validation helpers for provider response contracts."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from . import ProviderContractError


def read_field(value: object, name: str) -> Any:
    """Read one required field from an SDK object or JSON-style mapping."""

    if isinstance(value, Mapping):
        if name not in value:
            raise ProviderContractError(f"Provider response is missing {name}")
        return value[name]
    if not hasattr(value, name):
        raise ProviderContractError(f"Provider response is missing {name}")
    return getattr(value, name)


def read_optional(value: object, name: str, default: Any = None) -> Any:
    """Read one optional field from an SDK object or JSON-style mapping."""

    if isinstance(value, Mapping):
        return value.get(name, default)
    return getattr(value, name, default)


def require_sequence(value: object, name: str) -> Sequence[object]:
    """Require a list-like value while rejecting strings and byte sequences."""

    if not isinstance(value, Sequence) or isinstance(value, (str, bytes, bytearray)):
        raise ProviderContractError(f"{name} must be a sequence")
    return value


def require_nonnegative_int(value: object, name: str) -> int:
    """Require a non-negative integer, excluding booleans."""

    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ProviderContractError(f"{name} must be a non-negative integer")
    return value


def require_investigation_id(value: str) -> str:
    """Require a non-empty local identifier before any provider interaction."""

    if not isinstance(value, str) or not value.strip():
        raise ValueError("investigation_id cannot be empty")
    return value.strip()
