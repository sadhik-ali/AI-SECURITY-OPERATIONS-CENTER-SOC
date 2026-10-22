"""Authentication, authorization and session invalidation."""
from __future__ import annotations

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from tests.conftest import ADMIN_EMAIL, ANALYST_EMAIL, DEMO_PASSWORD, bearer


def test_login_returns_token_and_user(client: TestClient) -> None:
    response = client.post("/api/auth/login", json={"email": ADMIN_EMAIL, "password": DEMO_PASSWORD})
    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"].count(".") == 2
    assert body["user"]["role"] == "admin"
    assert "hashed_password" not in body["user"]
    assert "session_group" not in body["user"]


def test_login_is_case_insensitive_on_email(client: TestClient) -> None:
    response = client.post("/api/auth/login", json={"email": ADMIN_EMAIL.upper(), "password": DEMO_PASSWORD})
    assert response.status_code == 200


def test_wrong_password_and_unknown_account_share_one_message(client: TestClient) -> None:
    bad = client.post("/api/auth/login", json={"email": ADMIN_EMAIL, "password": "wrong-password"})
    missing = client.post("/api/auth/login", json={"email": "ghost@aisoc.dev", "password": DEMO_PASSWORD})
    assert bad.status_code == missing.status_code == 401
    assert bad.json()["detail"] == missing.json()["detail"] == "Invalid email or password."


def test_me_requires_a_valid_token(client: TestClient, admin_token: str) -> None:
    assert client.get("/api/auth/me").status_code == 401
    response = client.get("/api/auth/me", headers=bearer(admin_token))
    assert response.status_code == 200
    assert response.json()["email"] == ADMIN_EMAIL


def test_tampered_token_is_rejected(client: TestClient, admin_token: str) -> None:
    header, payload, _ = admin_token.split(".")
    response = client.get("/api/auth/me", headers=bearer(f"{header}.{payload}aaa."))
    assert response.status_code == 401
    assert response.json()["detail"] == "Token is invalid."


def test_logout_invalidates_that_sessions_tokens_only(
    client: TestClient, admin_token: str
) -> None:
    """Uses a throwaway account: logging out rotates the group for *every* token
    of that user, which would otherwise invalidate the shared admin fixture."""
    email = "logout-probe@aisoc.dev"
    password = "LogoutProbe!123"
    created = client.post(
        "/api/users",
        headers=bearer(admin_token),
        json={"email": email, "password": password, "full_name": "Logout Probe"},
    )
    assert created.status_code == 201, created.text

    first = client.post("/api/auth/login", json={"email": email, "password": password})
    assert first.status_code == 200
    token = first.json()["access_token"]
    assert client.get("/api/auth/me", headers=bearer(token)).status_code == 200

    assert client.post("/api/auth/logout", headers=bearer(token)).status_code == 200
    assert client.get("/api/auth/me", headers=bearer(token)).status_code == 401

    # The account itself is still usable; only that session's tokens are dead.
    fresh = client.post("/api/auth/login", json={"email": email, "password": password})
    assert fresh.status_code == 200
    assert client.get("/api/auth/me", headers=bearer(fresh.json()["access_token"])).status_code == 200

    client.patch(
        f"/api/users/{created.json()['id']}/active", headers=bearer(admin_token), json={"is_active": False}
    )


def test_analyst_cannot_reach_admin_user_management(client: TestClient, analyst_token: str) -> None:
    assert client.get("/api/users", headers=bearer(analyst_token)).status_code == 403
    assert client.get("/api/users", headers=bearer(analyst_token)).json()["detail"].startswith("Insufficient")


def test_admin_can_list_users_without_exposing_hashes(client: TestClient, admin_token: str) -> None:
    response = client.get("/api/users", headers=bearer(admin_token))
    assert response.status_code == 200
    body = response.json()
    assert {item["email"] for item in body["items"]} >= {ADMIN_EMAIL, ANALYST_EMAIL}
    assert all("hashed_password" not in item for item in body["items"])


def test_admin_can_create_disable_and_re_enable_a_user(client: TestClient, admin_token: str) -> None:
    email = "second.analyst@aisoc.dev"
    created = client.post(
        "/api/users",
        headers=bearer(admin_token),
        json={
            "email": email,
            "password": "AnotherDemo!2345",
            "full_name": "Second Analyst",
            "role": "analyst",
            "preferred_timezone": "Asia/Kolkata",
        },
    )
    assert created.status_code == 201, created.text
    user_id = created.json()["id"]
    assert created.json()["preferred_timezone"] == "Asia/Kolkata"

    duplicate = client.post(
        "/api/users",
        headers=bearer(admin_token),
        json={"email": email, "password": "AnotherDemo!2345", "full_name": "Dup"},
    )
    assert duplicate.status_code == 409

    disabled = client.patch(f"/api/users/{user_id}/active", headers=bearer(admin_token), json={"is_active": False})
    assert disabled.status_code == 200 and disabled.json()["is_active"] is False

    login = client.post("/api/auth/login", json={"email": email, "password": "AnotherDemo!2345"})
    assert login.status_code == 403

    client.patch(f"/api/users/{user_id}/active", headers=bearer(admin_token), json={"is_active": True})
    relogin = client.post("/api/auth/login", json={"email": email, "password": "AnotherDemo!2345"})
    assert relogin.status_code == 200


def test_changing_a_role_invalidates_the_targets_session(client: TestClient, admin_token: str) -> None:
    created = client.post(
        "/api/users",
        headers=bearer(admin_token),
        json={"email": "rotate@aisoc.dev", "password": "RotateMe!12345", "full_name": "Rotate Me"},
    )
    user_id = created.json()["id"]
    token = client.post(
        "/api/auth/login", json={"email": "rotate@aisoc.dev", "password": "RotateMe!12345"}
    ).json()["access_token"]
    assert client.get("/api/auth/me", headers=bearer(token)).status_code == 200

    client.patch(f"/api/users/{user_id}/role", headers=bearer(admin_token), json={"role": "admin"})
    assert client.get("/api/auth/me", headers=bearer(token)).status_code == 401


def test_admin_cannot_lock_itself_out_of_the_instance(client: TestClient, admin_token: str) -> None:
    me = client.get("/api/auth/me", headers=bearer(admin_token)).json()
    demote = client.patch(f"/api/users/{me['id']}/role", headers=bearer(admin_token), json={"role": "analyst"})
    disable = client.patch(f"/api/users/{me['id']}/active", headers=bearer(admin_token), json={"is_active": False})
    assert demote.status_code == 400
    assert disable.status_code == 400


def test_invalid_timezone_and_short_password_are_rejected(client: TestClient, admin_token: str) -> None:
    bad_tz = client.post(
        "/api/users",
        headers=bearer(admin_token),
        json={"email": "tz@aisoc.dev", "password": "ValidPass!2345", "full_name": "TZ", "preferred_timezone": "Mars/Borealis"},
    )
    assert bad_tz.status_code == 422
    assert bad_tz.json()["detail"] == "Request validation failed."
    assert "errors" in bad_tz.json()

    short = client.post(
        "/api/users",
        headers=bearer(admin_token),
        json={"email": "short@aisoc.dev", "password": "tiny", "full_name": "Short"},
    )
    assert short.status_code == 422
    # The echoed validation payload must not contain the submitted secret.
    assert "tiny" not in short.text


def test_login_is_rate_limited_per_account(client: TestClient) -> None:
    from app.core.ratelimit import limiter

    limiter.reset()
    responses = [
        client.post("/api/auth/login", json={"email": "spray@aisoc.dev", "password": "not-the-password"})
        for _ in range(8)
    ]
    statuses = [response.status_code for response in responses]
    assert statuses[:5] == [401] * 5, statuses
    assert 429 in statuses, statuses
    first_block = next(response for response in responses if response.status_code == 429)
    assert "Retry-After" in first_block.headers
    limiter.reset()


def test_sliding_window_limiter_prunes_older_hits() -> None:
    from app.core.ratelimit import Limit, SlidingWindowLimiter

    window = SlidingWindowLimiter()
    limit = Limit(attempts=2, window_seconds=60)
    window.check("k", limit)
    window.check("k", limit)
    with pytest.raises(HTTPException) as raised:
        window.check("k", limit)
    assert raised.value.status_code == 429
