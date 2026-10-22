"""Authentication and authorization dependencies."""
from __future__ import annotations

import jwt as pyjwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.logging import get_logger
from app.core.security import TokenError, decode_access_token
from app.database.session import get_db
from app.models.enums import AuditAction, Role
from app.models.models import User
from app.services.audit import record

bearer_scheme = HTTPBearer(auto_error=False, description="JWT access token")
auth_log = get_logger("ai_soc.auth")


def _subject_hint(token: str | None) -> str:
    """Best-effort subject for the audit trail; signature is deliberately not checked."""
    if not token:
        return "anonymous"
    try:
        payload = pyjwt.decode(token, options={"verify_signature": False})
    except pyjwt.InvalidTokenError:
        return "anonymous"
    sub = payload.get("sub")
    return f"user:{sub}" if sub else "anonymous"


def _reject(detail: str, request: Request, token: str | None, code: int) -> None:
    record(
        action=AuditAction.TOKEN_REJECTED,
        detail={"reason": detail},
        source_ip=getattr(request.state, "client_ip", None),
        actor_email=_subject_hint(token),
    )
    auth_log.warning("token rejected", extra={"action": "token_rejected", "reason": detail})
    raise HTTPException(
        status_code=code,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def _resolve_user(token: str, request: Request, db: Session) -> User:
    try:
        payload = decode_access_token(token)
    except TokenError as exc:
        _reject(str(exc), request, token, status.HTTP_401_UNAUTHORIZED)
        raise

    subject = str(payload["sub"])
    user = db.get(User, int(subject)) if subject.isdigit() else None
    if user is None:
        _reject("Account no longer exists.", request, token, status.HTTP_401_UNAUTHORIZED)
        raise
    if not user.is_active:
        _reject("Account is disabled.", request, token, status.HTTP_403_FORBIDDEN)
        raise
    if payload.get("sg") != user.session_group:
        _reject("Session has been signed out.", request, token, status.HTTP_401_UNAUTHORIZED)
        raise
    request.state.actor = user.email
    return user


def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return _resolve_user(credentials.credentials, request, db)


def require_roles(*roles: Role):
    def dependency(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient role for this operation.",
            )
        return user

    return dependency


require_admin = require_roles(Role.ADMIN)
require_analyst = require_roles(Role.ADMIN, Role.ANALYST)


def resolve_user_from_token(token: str | None, db: Session) -> User | None:
    """WebSocket authentication.

    Browsers cannot set an Authorization header on `new WebSocket(url)`, so the
    client passes the same JWT as a `token` query parameter. It is verified
    identically to the header form, is never written to the access log, and
    cookies are not accepted.
    """
    if not token:
        return None
    try:
        payload = decode_access_token(token)
    except TokenError:
        return None
    subject = str(payload["sub"])
    user = db.get(User, int(subject)) if subject.isdigit() else None
    if user is None or not user.is_active or payload.get("sg") != user.session_group:
        return None
    return user
