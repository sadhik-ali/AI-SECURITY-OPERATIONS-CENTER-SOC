"""SQLAlchemy domain model for the AI SOC."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, TimestampMixin, utcnow
from app.database.types import EnumString
from app.models.enums import (
    AlertStatus,
    EventCategory,
    EventSource,
    IncidentStatus,
    Role,
    Severity,
)


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(128), nullable=False)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    role: Mapped[Role] = mapped_column(EnumString(Role), default=Role.ANALYST, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    preferred_timezone: Mapped[str] = mapped_column(String(64), default="UTC", nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Opaque id used by the server-side logout denylist; rotated on every logout.
    session_group: Mapped[str] = mapped_column(String(64), nullable=False)

    notes: Mapped[list[IncidentNote]] = relationship(back_populates="author")
    assigned_incidents: Mapped[list[Incident]] = relationship(back_populates="assignee")

    @property
    def is_admin(self) -> bool:
        return self.role is Role.ADMIN


class SecurityEvent(Base):
    """A normalised security event, from any source. `raw` is untrusted content."""

    __tablename__ = "security_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)
    ingested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    source: Mapped[EventSource] = mapped_column(EnumString(EventSource), index=True, nullable=False)
    event_type: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    category: Mapped[EventCategory] = mapped_column(
        EnumString(EventCategory), default=EventCategory.OTHER, nullable=False
    )
    severity: Mapped[Severity] = mapped_column(
        EnumString(Severity), default=Severity.INFORMATIONAL, nullable=False
    )
    message: Mapped[str] = mapped_column(Text, nullable=False)
    hostname: Mapped[str | None] = mapped_column(String(128), index=True, nullable=True)
    username: Mapped[str | None] = mapped_column(String(128), index=True, nullable=True)
    src_ip: Mapped[str | None] = mapped_column(String(45), index=True, nullable=True)
    dst_ip: Mapped[str | None] = mapped_column(String(45), nullable=True)
    process_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    rule_ref: Mapped[str | None] = mapped_column(String(64), nullable=True)
    external_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # sha256 over the dedupe key; unique so a retried ingestion cannot double-count.
    ingest_key: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    raw: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    normalized: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    demo: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)

    alerts: Mapped[list[Alert]] = relationship(back_populates="event")

    __table_args__ = (
        Index("ix_events_time_src", "event_time", "source"),
        Index("ix_events_host_time", "hostname", "event_time"),
    )


class DetectionRule(Base, TimestampMixin):
    """Configurable detection rule definition. The engine reads `params` at run time."""

    __tablename__ = "detection_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    rule_id: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[EventCategory] = mapped_column(EnumString(EventCategory), nullable=False)
    default_severity: Mapped[Severity] = mapped_column(EnumString(Severity), nullable=False)
    score_contribution: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False)
    investigation_steps: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    params: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    alerts: Mapped[list[Alert]] = relationship(back_populates="detection_rule")


class Alert(Base):
    """A detection triggered by the engine. Always an indicator, never a verdict."""

    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    alert_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)
    rule_ref: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    detection_rule_id: Mapped[int | None] = mapped_column(
        ForeignKey("detection_rules.id", ondelete="SET NULL"), nullable=True
    )
    event_id: Mapped[int | None] = mapped_column(ForeignKey("security_events.id", ondelete="SET NULL"), nullable=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[EventCategory] = mapped_column(EnumString(EventCategory), nullable=False)
    severity: Mapped[Severity] = mapped_column(EnumString(Severity), index=True, nullable=False)
    risk_score: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False)
    score_breakdown: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    src_ip: Mapped[str | None] = mapped_column(String(45), index=True, nullable=True)
    dst_ip: Mapped[str | None] = mapped_column(String(45), nullable=True)
    username: Mapped[str | None] = mapped_column(String(128), index=True, nullable=True)
    hostname: Mapped[str | None] = mapped_column(String(128), index=True, nullable=True)
    status: Mapped[AlertStatus] = mapped_column(
        EnumString(AlertStatus), default=AlertStatus.NEW, index=True, nullable=False
    )
    evidence: Mapped[list[Any]] = mapped_column(JSON, default=list, nullable=False)
    incident_id: Mapped[int | None] = mapped_column(ForeignKey("incidents.id", ondelete="SET NULL"), nullable=True)
    demo: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    event: Mapped[SecurityEvent | None] = relationship(back_populates="alerts")
    detection_rule: Mapped[DetectionRule | None] = relationship(back_populates="alerts")
    incident: Mapped[Incident | None] = relationship(back_populates="alerts")

    __table_args__ = (
        UniqueConstraint("rule_ref", "event_id", name="uq_alert_rule_event"),
        Index("ix_alerts_time_severity", "alert_time", "severity"),
    )


class Incident(Base):
    """A group of correlated alerts/events sharing a correlation key."""

    __tablename__ = "incidents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    public_id: Mapped[str] = mapped_column(String(24), unique=True, index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    correlation_key: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    creation_reason: Mapped[str] = mapped_column(Text, default="", nullable=False)
    severity: Mapped[Severity] = mapped_column(EnumString(Severity), index=True, nullable=False)
    risk_score: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False)
    score_breakdown: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    status: Mapped[IncidentStatus] = mapped_column(
        EnumString(IncidentStatus), default=IncidentStatus.NEW, index=True, nullable=False
    )
    assignee_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    first_event_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_event_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    window_seconds: Mapped[int] = mapped_column(Integer, default=900, nullable=False)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    demo: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )

    assignee: Mapped[User | None] = relationship(back_populates="assigned_incidents")
    alerts: Mapped[list[Alert]] = relationship(back_populates="incident")
    links: Mapped[list[IncidentEvent]] = relationship(
        back_populates="incident", cascade="all, delete-orphan"
    )
    notes: Mapped[list[IncidentNote]] = relationship(
        back_populates="incident", cascade="all, delete-orphan"
    )


class IncidentEvent(Base):
    """Junction recording *which* events fed an incident and *why*."""

    __tablename__ = "incident_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    incident_id: Mapped[int] = mapped_column(
        ForeignKey("incidents.id", ondelete="CASCADE"), index=True, nullable=False
    )
    event_id: Mapped[int] = mapped_column(
        ForeignKey("security_events.id", ondelete="CASCADE"), index=True, nullable=False
    )
    alert_id: Mapped[int | None] = mapped_column(ForeignKey("alerts.id", ondelete="SET NULL"), nullable=True)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    contributed_score: Mapped[float] = mapped_column(Numeric(5, 2), default=0, nullable=False)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    incident: Mapped[Incident] = relationship(back_populates="links")
    event: Mapped[SecurityEvent] = relationship()

    __table_args__ = (UniqueConstraint("incident_id", "event_id", name="uq_incident_event"),)


class IncidentNote(Base):
    __tablename__ = "incident_notes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    incident_id: Mapped[int] = mapped_column(
        ForeignKey("incidents.id", ondelete="CASCADE"), index=True, nullable=False
    )
    author_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    # AI-generated notes are always labelled so they cannot masquerade as analyst findings.
    ai_generated: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    incident: Mapped[Incident] = relationship(back_populates="notes")
    author: Mapped[User | None] = relationship(back_populates="notes")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True, nullable=False)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    actor_email: Mapped[str] = mapped_column(String(320), default="anonymous", nullable=False)
    action: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    target: Mapped[str | None] = mapped_column(String(200), nullable=True)
    detail: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    source_ip: Mapped[str | None] = mapped_column(String(45), nullable=True)


class ApplicationSetting(Base, TimestampMixin):
    __tablename__ = "application_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(96), unique=True, index=True, nullable=False)
    value: Mapped[Any] = mapped_column(JSON, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    is_secret: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Secret values store only this non-reversible digest so the UI can prove
    # something is configured without ever being able to read it back.
    value_digest: Mapped[str | None] = mapped_column(String(64), nullable=True)
