"""Shared pytest fixtures.

Environment is configured at module import time, before `app` is imported,
because the engine and settings objects are built at import.
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

_TMP = Path(tempfile.mkdtemp(prefix="ai-soc-test-"))
_DB = _TMP / "test.db"

os.environ.update(
    {
        "SECRET_KEY": "test-secret-key-not-used-in-production-0123456789",
        "DATABASE_URL": f"sqlite:///{_DB.as_posix()}",
        "MODE": "demo",
        "ENVIRONMENT": "dev",
        "DEMO_SEED_ON_STARTUP": "true",
        "BOOTSTRAP_ADMIN_EMAIL": "admin@aisoc.dev",
        "BOOTSTRAP_ADMIN_PASSWORD": "SocDemo!23",
        "OPENSEARCH_ENABLED": "false",
        "WAZUH_ENABLED": "false",
        "OLLAMA_ENABLED": "false",
        "CORS_ORIGINS": "http://localhost:5173",
        "LOGIN_RATE_LIMIT_ATTEMPTS": "1000",
    }
)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

ADMIN_EMAIL = "admin@aisoc.dev"
ANALYST_EMAIL = "analyst@aisoc.dev"
DEMO_PASSWORD = "SocDemo!23"


@pytest.fixture(scope="session")
def client():
    # The context manager runs the lifespan, which creates the schema and seeds.
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="session")
def admin_token(client: TestClient) -> str:
    response = client.post(
        "/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": DEMO_PASSWORD},
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


@pytest.fixture(scope="session")
def analyst_token(client: TestClient) -> str:
    response = client.post(
        "/api/auth/login",
        json={"email": ANALYST_EMAIL, "password": DEMO_PASSWORD},
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}
