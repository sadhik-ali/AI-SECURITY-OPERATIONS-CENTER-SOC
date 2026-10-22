"""Schema bootstrap and seeding of non-negotiable rows.

Two ways the schema comes into existence, deliberately:

* `alembic upgrade head` - authoritative, required for PostgreSQL.
* `Base.metadata.create_all` when running on SQLite with no `alembic_version`
  table - keeps local development to one command. The Alembic migration stays
  the source of truth; this path exists so `uvicorn app.main:app` just works.
"""
from __future__ import annotations

import hashlib
import uuid
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.logging import get_logger
from app.core.security import hash_password
from app.database.base import Base
from app.database.session import SessionLocal, engine
from app.models.enums import Role
from app.models.models import ApplicationSetting, User

log = get_logger("ai_soc.init")

# Secret material is intentionally absent: credentials live only in the
# environment, so nothing sensitive can ever be read back through the API.
DEFAULT_SETTINGS: list[dict[str, Any]] = [
    {
        "key": "detection.ssh_brute_force",
        "value": {"failed_threshold": 5, "window_seconds": 300},
        "description": "Failed SSH authentications from one source IP before an alert.",
    },
    {
        "key": "detection.password_spraying",
        "value": {"distinct_accounts_threshold": 4, "window_seconds": 600},
        "description": "Distinct accounts touched by failures from one source IP.",
    },
    {
        "key": "detection.login_after_failures",
        "value": {"window_seconds": 600, "min_failures": 3},
        "description": "Successful authentication following a suspicious failure run.",
    },
    {
        "key": "detection.unusual_login",
        "value": {"baseline_days": 14, "min_baseline_events": 5, "off_hours": ["23:00", "06:00"]},
        "description": "Login outside the per-user baseline; needs enough history to compare.",
    },
    {
        "key": "detection.port_scan",
        "value": {"distinct_ports_threshold": 12, "window_seconds": 120},
        "description": "Distinct destination ports contacted by one source IP.",
    },
    {
        "key": "detection.privilege_escalation",
        "value": {"enabled": True},
        "description": "Privilege or administrator group changes reported by the endpoint source.",
    },
    {
        "key": "detection.suspicious_process",
        "value": {
            "indicators": ["mimikatz", "lsass.exe dump", "psexesvc", "whoami /priv", "certutil -decode"]
        },
        "description": "Process indicators matched against endpoint telemetry.",
    },
    {
        "key": "detection.repeated_rule_triggers",
        "value": {"alert_threshold": 3, "window_seconds": 900},
        "description": "Host or source IP accumulating several related alerts.",
    },
    {
        "key": "scoring.weights",
        "value": {
            "severity": 35,
            "event_volume": 15,
            "frequency": 12,
            "success_after_failure": 18,
            "breadth": 12,
            "recency": 8,
        },
        "description": "Share of the 0-100 score contributed by each factor.",
    },
    {
        "key": "scoring.bands",
        "value": {"low_min": 25, "high_min": 50, "critical_min": 75},
        "description": "Risk score boundaries for informational, low, high and critical.",
    },
    {
        "key": "correlation.window_seconds",
        "value": 900,
        "description": "Events further apart than this open a new incident.",
    },
    {
        "key": "retention.days",
        "value": {"events": 90, "alerts": 180, "incidents": 365},
        "description": "How long each record type is kept before pruning.",
    },
    {
        "key": "ai.provider",
        "value": {"enabled": True, "provider": "ollama", "model": "llama3.1:8b-instruct"},
        "description": "AI assistant provider. Analysis stays advisory, never automated.",
    },
    {
        "key": "integrations.wazuh",
        "value": {"enabled": False, "credentials": "environment"},
        "description": "Wazuh ingestion. API credentials are read from environment variables only.",
        "is_secret_reference": True,
    },
    {
        "key": "integrations.opensearch",
        "value": {"enabled": False, "credentials": "environment"},
        "description": "OpenSearch search backend. Credentials are read from environment variables only.",
        "is_secret_reference": True,
    },
    {
        "key": "demo.event_generation",
        "value": {"enabled": True, "events_per_minute": 20, "scenario": "mixed"},
        "description": "Synthetic event generator for demonstrations without infrastructure.",
    },
]


def _schema_is_current(session: Session) -> bool:
    try:
        session.execute(text("SELECT 1 FROM alembic_version LIMIT 1"))
        return True
    except OperationalError:
        session.rollback()
        return False
    except Exception:
        session.rollback()
        return False


def ensure_schema() -> None:
    settings = get_settings()
    if not settings.is_sqlite:
        return
    with engine.begin() as connection:
        has_users = bool(
            connection.exec_driver_sql(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
            ).first()
        )
    if has_users:
        return
    log.info("creating SQLite schema", extra={"action": "schema_create"})
    Base.metadata.create_all(engine)


def bootstrap() -> None:
    """Create tables (SQLite only), demo users and default settings."""
    settings = get_settings()
    ensure_schema()
    with SessionLocal() as session:
        _seed_users(session, settings.bootstrap_admin_email, settings.bootstrap_admin_password)
        _seed_settings(session)
        session.commit()
        if not _schema_is_current(session):
            log.warning(
                "alembic_version table is absent; run `alembic stamp head` to record the schema",
                extra={"action": "alembic_unstamped"},
            )


def _seed_users(session: Session, admin_email: str, admin_password: str) -> None:
    for email, full_name, role in (
        (admin_email, "SOC Administrator", Role.ADMIN),
        ("analyst@aisoc.dev", "Demo Analyst", Role.ANALYST),
    ):
        existing = session.scalar(select(User).where(User.email == email.lower()))
        if existing is not None:
            continue
        session.add(
            User(
                email=email.lower(),
                hashed_password=hash_password(admin_password),
                full_name=full_name,
                role=role,
                is_active=True,
                preferred_timezone="UTC",
                session_group=uuid.uuid4().hex,
            )
        )
        log.info("seeded user", extra={"action": "user_seed", "actor": email})


def _seed_settings(session: Session) -> None:
    for spec in DEFAULT_SETTINGS:
        key = spec["key"]
        if session.scalar(select(ApplicationSetting).where(ApplicationSetting.key == key)) is not None:
            continue
        session.add(
            ApplicationSetting(
                key=key,
                value=spec["value"],
                description=spec["description"],
                is_secret=bool(spec.get("is_secret_reference", False)),
                value_digest=None,
            )
        )
