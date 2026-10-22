"""Authentication endpoints: login, logout, current identity."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.core.config import get_settings
from app.core.ratelimit import Limit, client_ip, enforce
from app.core.security import create_access_token, hash_password, verify_password
from app.database.session import get_db
from app.models.enums import AuditAction
from app.models.models import User
from app.schemas.auth import LoginRequest, LogoutResponse, TokenResponse, UserOut
from app.services.audit import record

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Compared when the account does not exist so a missing user costs the same as
# a wrong password and cannot be distinguished by response time.
_DUMMY_HASH = hash_password(uuid.uuid4().hex)


@router.post("/login", response_model=TokenResponse, summary="Exchange credentials for a JWT")
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)) -> TokenResponse:
    settings = get_settings()
    ip = client_ip(request)
    enforce("login-ip", ip, Limit(settings.login_rate_limit_attempts, settings.login_rate_limit_window_seconds))
    enforce("login-account", payload.email.lower(), Limit(5, settings.login_rate_limit_window_seconds))

    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    password_ok = verify_password(payload.password, user.hashed_password if user else _DUMMY_HASH)

    if user is None or not password_ok:
        record(
            action=AuditAction.LOGIN_FAILURE,
            actor_email=payload.email.lower(),
            target="session",
            detail={"reason": "invalid" if user else "unknown_account"},
            source_ip=ip,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )

    if not user.is_active:
        record(
            action=AuditAction.LOGIN_FAILURE,
            actor_email=payload.email.lower(),
            target="session",
            detail={"reason": "disabled_account"},
            source_ip=ip,
        )
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is disabled.")

    user.last_login_at = datetime.now(timezone.utc)
    token, expires_at = create_access_token(
        subject=str(user.id),
        role=user.role.value,
        timezone_name=user.preferred_timezone,
        session_group=user.session_group,
    )
    record(
        action=AuditAction.LOGIN_SUCCESS,
        actor_email=user.email,
        actor_id=user.id,
        target="session",
        source_ip=ip,
    )
    return TokenResponse(
        access_token=token,
        expires_at=expires_at,
        user=UserOut.model_validate(user),
    )


@router.post("/logout", response_model=LogoutResponse, summary="Sign out and invalidate the session")
def logout(
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LogoutResponse:
    # Rotating the group invalidates every token minted for this user before now.
    user.session_group = uuid.uuid4().hex
    record(
        action=AuditAction.LOGOUT,
        actor_email=user.email,
        actor_id=user.id,
        target="session",
        source_ip=getattr(request.state, "client_ip", None),
    )
    return LogoutResponse(
        logged_out=True,
        message="Access token invalidated. Discard it on the client.",
    )


@router.get("/me", response_model=UserOut, summary="Current authenticated user")
def me(user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(user)
