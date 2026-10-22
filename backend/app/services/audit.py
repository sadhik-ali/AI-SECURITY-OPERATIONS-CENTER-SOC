"""Security audit trail.

Audit rows are committed on their own session so that the event which *failed*
(stale token, bad password, rejected payload) is still recorded even though the
request's own transaction is rolled back.
"""
from __future__ import annotations

from typing import Any

from app.core.logging import get_logger
from app.database.session import SessionLocal
from app.models.enums import AuditAction
from app.models.models import AuditLog

audit_log = get_logger("ai_soc.audit")

# Never persist these keys in the detail blob, even hashed.
_REDACT = {
    "password",
    "current_password",
    "new_password",
    "token",
    "access_token",
    "secret",
    "api_key",
    "authorization",
    "hashed_password",
}


def _scrub(detail: dict[str, Any] | None) -> dict[str, Any]:
    if not detail:
        return {}
    return {
        key: ("***redacted***" if key.lower() in _REDACT else value)
        for key, value in detail.items()
    }


def record(
    *,
    action: AuditAction | str,
    actor_email: str = "anonymous",
    actor_id: int | None = None,
    target: str | None = None,
    detail: dict[str, Any] | None = None,
    source_ip: str | None = None,
) -> None:
    action_value = action.value if isinstance(action, AuditAction) else str(action)
    session = SessionLocal()
    try:
        session.add(
            AuditLog(
                action=action_value,
                actor_email=actor_email,
                actor_id=actor_id,
                target=target,
                detail=_scrub(detail),
                source_ip=source_ip,
            )
        )
        session.commit()
    except Exception:
        session.rollback()
        audit_log.exception("failed to write audit record", extra={"action": action_value})
    finally:
        session.close()

    audit_log.info(
        "audit",
        extra={"action": action_value, "actor": actor_email, "client_ip": source_ip},
    )
