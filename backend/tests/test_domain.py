"""Domain layer: enum round-trip, severity bands, seeded configuration, audit trail."""
from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.security import create_access_token, hash_password, verify_password
from app.database.session import SessionLocal
from app.models.enums import (
    INCIDENT_STATUS_TRANSITIONS,
    AlertStatus,
    AuditAction,
    EventCategory,
    EventSource,
    IncidentStatus,
    Role,
    Severity,
    severity_from_score,
)
from app.models.models import (
    Alert,
    ApplicationSetting,
    AuditLog,
    DetectionRule,
    Incident,
    IncidentEvent,
    IncidentNote,
    SecurityEvent,
    User,
)


@pytest.mark.parametrize(
    ("score", "expected"),
    [
        (0, Severity.INFORMATIONAL),
        (24.99, Severity.INFORMATIONAL),
        (25, Severity.LOW),
        (49.9, Severity.LOW),
        (50, Severity.HIGH),
        (74.9, Severity.HIGH),
        (75, Severity.CRITICAL),
        (100, Severity.CRITICAL),
    ],
)
def test_severity_bands_match_the_documented_boundaries(score: float, expected: Severity) -> None:
    assert severity_from_score(score) is expected


def test_severity_thresholds_are_configurable() -> None:
    assert severity_from_score(60, critical_min=55) is Severity.CRITICAL
    assert severity_from_score(20, low_min=15) is Severity.LOW


def test_closed_incidents_accept_no_transitions() -> None:
    assert INCIDENT_STATUS_TRANSITIONS[IncidentStatus.CLOSED] == set()
    assert IncidentStatus.RESOLVED in INCIDENT_STATUS_TRANSITIONS[IncidentStatus.INVESTIGATING]


def test_password_hashing_is_salted_and_verifiable() -> None:
    password = "Correct-Horse-Battery!9"
    first = hash_password(password)
    second = hash_password(password)
    assert first != second, "bcrypt must use a fresh salt per hash"
    assert verify_password(password, first)
    assert not verify_password(password + "x", first)


def test_hasher_rejects_input_beyond_the_bcrypt_limit() -> None:
    with pytest.raises(ValueError):
        hash_password("u" * 73)


def test_token_carries_role_and_session_group() -> None:
    from app.core.security import decode_access_token

    group = uuid.uuid4().hex
    token, expires_at = create_access_token(
        subject="7", role="analyst", timezone_name="Asia/Kolkata", session_group=group
    )
    payload = decode_access_token(token)
    assert payload["sub"] == "7"
    assert payload["role"] == "analyst"
    assert payload["sg"] == group
    assert payload["use"] == "access"
    assert expires_at > datetime.now(timezone.utc)


def test_decode_rejects_a_token_signed_with_another_key() -> None:
    import jwt
    from app.core.security import TokenError, decode_access_token

    forged = jwt.encode({"sub": "1", "use": "access"}, "someone-elses-key", algorithm="HS256")
    with pytest.raises(TokenError):
        decode_access_token(forged)


def test_expired_token_is_rejected() -> None:
    from app.core.security import TokenError, decode_access_token

    token, _ = create_access_token(
        subject="1", role="analyst", timezone_name="UTC", session_group="x", expires_minutes=-1
    )
    with pytest.raises(TokenError):
        decode_access_token(token)


def test_every_documented_table_exists_in_the_development_schema() -> None:
    from app.database.base import Base

    expected = {
        "users",
        "security_events",
        "alerts",
        "detection_rules",
        "incidents",
        "incident_events",
        "incident_notes",
        "audit_logs",
        "application_settings",
    }
    assert expected <= set(Base.metadata.tables)


def test_enum_columns_round_trip_their_lowercase_values() -> None:
    """`role == "admin"` in SQL and `user.role is Role.ADMIN` in Python both work."""
    with SessionLocal() as session:
        user = User(
            email=f"roundtrip.{uuid.uuid4().hex[:8]}@aisoc.dev",
            hashed_password=hash_password("RoundTrip!12345"),
            full_name="Round Trip",
            role=Role.ANALYST,
            preferred_timezone="UTC",
            session_group=uuid.uuid4().hex,
        )
        event = SecurityEvent(
            event_time=datetime.now(timezone.utc),
            source=EventSource.DEMO_GENERATOR,
            event_type="test_roundtrip",
            category=EventCategory.AUTHENTICATION,
            severity=Severity.HIGH,
            message="round trip",
            ingest_key=uuid.uuid4().hex,
            raw={},
            normalized={},
            demo=True,
        )
        session.add_all([user, event])
        session.commit()
        user_id, event_id = user.id, event.id

    with SessionLocal() as session:
        loaded_user = session.get(User, user_id)
        loaded_event = session.get(SecurityEvent, event_id)
        assert loaded_user.role is Role.ANALYST
        assert loaded_event.severity is Severity.HIGH
        assert loaded_event.source is EventSource.DEMO_GENERATOR

        by_string = session.scalar(select(User).where(User.email == loaded_user.email))
        assert by_string is not None

        raw_role = session.execute(
            select(User.role).where(User.id == user_id)
        ).scalar_one()
        assert isinstance(raw_role, Role)

        session.delete(loaded_user)
        session.delete(loaded_event)
        session.commit()


def test_default_detection_and_scoring_settings_are_seeded(client: TestClient) -> None:
    with SessionLocal() as session:
        rows = session.scalars(select(ApplicationSetting)).all()
    keys = {row.key for row in rows}
    assert {
        "detection.ssh_brute_force",
        "detection.password_spraying",
        "detection.port_scan",
        "scoring.weights",
        "scoring.bands",
        "correlation.window_seconds",
        "ai.provider",
    } <= keys
    weights = next(row for row in rows if row.key == "scoring.weights").value
    assert sum(weights.values()) == 100, "factor weights must account for the whole score"
    assert all(row.value_digest is None or row.is_secret for row in rows)


def test_secret_bearing_settings_never_store_the_value(client: TestClient) -> None:
    with SessionLocal() as session:
        wazuh = session.scalar(select(ApplicationSetting).where(ApplicationSetting.key == "integrations.wazuh"))
    assert wazuh is not None
    assert wazuh.is_secret is True
    assert "password" not in str(wazuh.value).lower()


def test_login_and_rejection_are_written_to_the_audit_trail(client: TestClient, admin_token: str) -> None:
    with SessionLocal() as session:
        actions = set(session.scalars(select(AuditLog.action)).all())
    assert AuditAction.LOGIN_SUCCESS.value in actions
    assert AuditAction.LOGIN_FAILURE.value in actions

    client.get("/api/auth/me", headers={"Authorization": "Bearer nope.nope.nope"})
    with SessionLocal() as session:
        recent = session.scalars(
            select(AuditLog).order_by(AuditLog.id.desc()).limit(5)
        ).all()
    assert any(row.action == AuditAction.TOKEN_REJECTED.value for row in recent)


def test_audit_detail_redacts_password_shaped_keys() -> None:
    from app.services.audit import _scrub

    scrubbed = _scrub({"password": "hunter2", "reason": "invalid", "token": "abc"})
    assert scrubbed["password"] == "***redacted***"
    assert scrubbed["token"] == "***redacted***"
    assert scrubbed["reason"] == "invalid"


def test_alert_and_incident_relationships_persist(client: TestClient) -> None:
    """Exercises the FK graph the detection and correlation engines rely on."""
    now = datetime.now(timezone.utc)
    with SessionLocal() as session:
        analyst = session.scalar(select(User).where(User.email == "analyst@aisoc.dev"))
        rule = DetectionRule(
            rule_id="soc-synthetic-bruteforce",
            name="Synthetic SSH brute force",
            description="Repeated failed logins from one source.",
            category=EventCategory.AUTHENTICATION,
            default_severity=Severity.HIGH,
            score_contribution=30,
            investigation_steps=["Confirm the source is not a managed scanner."],
            params={"failed_threshold": 5},
            enabled=True,
        )
        event = SecurityEvent(
            event_time=now,
            source=EventSource.DEMO_GENERATOR,
            event_type="ssh_failed_login",
            category=EventCategory.AUTHENTICATION,
            severity=Severity.HIGH,
            message="Failed password for invalid user admin from 203.0.113.44 port 51234 ssh2",
            hostname="web-01",
            username="admin",
            src_ip="203.0.113.44",
            ingest_key=uuid.uuid4().hex,
            raw={"demo": True},
            normalized={"reason": "authentication failure"},
            demo=True,
        )
        session.add_all([rule, event])
        session.flush()

        incident = Incident(
            public_id="INC-synthetic01",
            title="SSH brute force against web-01",
            correlation_key=f"src_ip:203.0.113.44|category:authentication|window:{now:%Y%m%d%H}",
            creation_reason="5 failed authentications from one source inside 300s.",
            severity=Severity.HIGH,
            risk_score=62,
            status=IncidentStatus.INVESTIGATING,
            assignee_id=analyst.id,
            first_event_at=now,
            last_event_at=now,
            window_seconds=900,
            demo=True,
        )
        session.add(incident)
        session.flush()

        alert = Alert(
            alert_time=now,
            rule_ref=rule.rule_id,
            detection_rule_id=rule.id,
            event_id=event.id,
            title="Repeated SSH authentication failures",
            reason="5 failures from 203.0.113.44 within 300s.",
            category=EventCategory.AUTHENTICATION,
            severity=Severity.HIGH,
            risk_score=62,
            score_breakdown={"severity": 22, "frequency": 18, "recency": 22},
            src_ip="203.0.113.44",
            hostname="web-01",
            username="admin",
            status=AlertStatus.INVESTIGATING,
            evidence=[{"event_id": event.id, "detail": "failed password"}],
            incident_id=incident.id,
            demo=True,
        )
        session.add(alert)
        session.flush()

        session.add_all(
            [
                IncidentEvent(
                    incident_id=incident.id,
                    event_id=event.id,
                    alert_id=alert.id,
                    reason="matched correlation key src_ip",
                    contributed_score=12,
                ),
                IncidentNote(incident_id=incident.id, author_id=analyst.id, body="Blocking pending approval."),
                IncidentNote(
                    incident_id=incident.id,
                    author_id=None,
                    body="AI summary placeholder persisted as machine-authored.",
                    ai_generated=True,
                ),
            ]
        )
        session.commit()
        incident_id = incident.id

    with SessionLocal() as session:
        loaded = session.get(Incident, incident_id)
        assert loaded is not None
        assert loaded.assignee is not None and loaded.assignee.role is Role.ANALYST
        assert len(loaded.alerts) == 1
        assert len(loaded.links) == 1
        assert loaded.links[0].event.hostname == "web-01"
        notes = {note.ai_generated for note in loaded.notes}
        assert notes == {False, True}

        # A duplicate correlation key must not be creatable.
        session.add(
            Incident(
                public_id="INC-duplicate",
                title="duplicate",
                correlation_key=loaded.correlation_key,
                severity=Severity.LOW,
                risk_score=10,
                first_event_at=now,
                last_event_at=now,
            )
        )
        with pytest.raises(Exception):
            session.commit()
        session.rollback()

        cleanup = session.scalars(select(Incident).where(Incident.id.in_([incident_id]))).all()
        for row in cleanup:
            session.delete(row)
        session.commit()


def test_ingest_key_is_unique(client: TestClient) -> None:
    now = datetime.now(timezone.utc)
    key = hashlib.sha256(b"synthetic-dedupe").hexdigest()
    with SessionLocal() as session:
        first = SecurityEvent(
            event_time=now,
            source=EventSource.DEMO_GENERATOR,
            event_type="dedupe_probe",
            message="first",
            ingest_key=key,
            raw={},
            normalized={},
            demo=True,
        )
        session.add(first)
        session.commit()
        first_id = first.id

        second = SecurityEvent(
            event_time=now,
            source=EventSource.DEMO_GENERATOR,
            event_type="dedupe_probe",
            message="retry",
            ingest_key=key,
            raw={},
            normalized={},
            demo=True,
        )
        session.add(second)
        with pytest.raises(Exception):
            session.commit()
        session.rollback()

        stored = session.get(SecurityEvent, first_id)
        session.delete(stored)
        session.commit()
