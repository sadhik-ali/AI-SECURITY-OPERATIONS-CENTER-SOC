"""Password hashing and JWT issuance/verification."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import jwt

from app.core.config import get_settings

MAX_PASSWORD_BYTES = 72


def hash_password(password: str) -> str:
    if len(password.encode("utf-8")) > MAX_PASSWORD_BYTES:
        raise ValueError("Password exceeds the maximum supported length.")
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode())
    except ValueError:
        return False


def create_access_token(
    *,
    subject: str,
    role: str,
    timezone_name: str,
    session_group: str,
    expires_minutes: int | None = None,
    token_use: str = "access",
) -> tuple[str, datetime]:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    minutes = expires_minutes if expires_minutes is not None else settings.access_token_expire_minutes
    expires_at = now + timedelta(minutes=minutes)
    payload: dict[str, Any] = {
        "sub": subject,
        "role": role,
        "tz": timezone_name,
        "sg": session_group,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
        "jti": uuid.uuid4().hex,
        "use": token_use,
    }
    token = jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)
    return token, expires_at


class TokenError(Exception):
    """Raised for any invalid, expired or malformed token."""


def decode_access_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.secret_key,
            algorithms=[settings.jwt_algorithm],
            options={"require": ["exp", "sub", "iat"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise TokenError("Token has expired.") from exc
    except jwt.InvalidTokenError as exc:
        raise TokenError("Token is invalid.") from exc
    if payload.get("use") != "access":
        raise TokenError("Token is not an access token.")
    return payload
