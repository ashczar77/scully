"""Exact provider dependency versions approved for the feasibility harness."""

from __future__ import annotations

from importlib.metadata import PackageNotFoundError, version

from scully.config import ConfigurationError


LOCKED_PROVIDER_VERSIONS = {
    "contree-client": "0.4.0",
    "contree-sdk": "0.3.3",
    "openai": "3.8.0",
    "tavily-python": "0.8.1",
}


def installed_version(package: str) -> str | None:
    """Return an installed version without importing the provider package."""

    try:
        return version(package)
    except PackageNotFoundError:
        return None


def assert_locked_provider(package: str) -> None:
    """Fail closed when a provider package differs from the reviewed lock."""

    expected = LOCKED_PROVIDER_VERSIONS.get(package)
    if expected is None:
        raise ConfigurationError("Provider package is not in the reviewed lock")
    installed = installed_version(package)
    if installed != expected:
        raise ConfigurationError(
            f"{package} must be installed at the reviewed version {expected}"
        )
