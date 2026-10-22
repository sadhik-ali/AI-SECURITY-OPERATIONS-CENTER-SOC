"""Shared enumerations for the SOC domain model."""
from __future__ import annotations

import enum


class Role(str, enum.Enum):
    ADMIN = "admin"
    ANALYST = "analyst"


class Severity(str, enum.Enum):
    INFORMATIONAL = "informational"
    LOW = "low"
    HIGH = "high"
    CRITICAL = "critical"

    @property
    def weight(self) -> int:
        return _SEVERITY_WEIGHT[self]


SEVERITY_ORDER = [
    Severity.INFORMATIONAL,
    Severity.LOW,
    Severity.HIGH,
    Severity.CRITICAL,
]

_SEVERITY_WEIGHT: dict[Severity, int] = {
    Severity.INFORMATIONAL: 1,
    Severity.LOW: 2,
    Severity.HIGH: 3,
    Severity.CRITICAL: 4,
}


class AlertStatus(str, enum.Enum):
    NEW = "new"
    ACKNOWLEDGED = "acknowledged"
    INVESTIGATING = "investigating"
    FALSE_POSITIVE = "false_positive"
    RESOLVED = "resolved"


class IncidentStatus(str, enum.Enum):
    NEW = "new"
    INVESTIGATING = "investigating"
    RESOLVED = "resolved"
    CLOSED = "closed"


INCIDENT_STATUS_TRANSITIONS: dict[IncidentStatus, set[IncidentStatus]] = {
    IncidentStatus.NEW: {IncidentStatus.INVESTIGATING, IncidentStatus.CLOSED},
    IncidentStatus.INVESTIGATING: {IncidentStatus.RESOLVED, IncidentStatus.CLOSED},
    IncidentStatus.RESOLVED: {IncidentStatus.INVESTIGATING, IncidentStatus.CLOSED},
    IncidentStatus.CLOSED: set(),
}


class EventSource(str, enum.Enum):
    WAZUH = "wazuh"
    LINUX_AUTH = "linux_auth"
    SYSMON = "sysmon"
    DEMO_GENERATOR = "demo_generator"


class EventCategory(str, enum.Enum):
    AUTHENTICATION = "authentication"
    NETWORK = "network"
    PROCESS = "process"
    PRIVILEGE = "privilege"
    FILE_INTEGRITY = "file_integrity"
    SYSTEM = "system"
    OTHER = "other"


class AuditAction(str, enum.Enum):
    LOGIN_SUCCESS = "login.success"
    LOGIN_FAILURE = "login.failure"
    LOGOUT = "auth.logout"
    TOKEN_REJECTED = "auth.token_rejected"
    USER_CREATED = "user.created"
    USER_ROLE_CHANGED = "user.role_changed"
    USER_DISABLED = "user.disabled"
    USER_ENABLED = "user.enabled"
    SETTINGS_CHANGED = "settings.changed"
    INCIDENT_STATUS_CHANGED = "incident.status_changed"
    INCIDENT_ASSIGNED = "incident.assigned"
    INCIDENT_NOTE_ADDED = "incident.note_added"
    ALERT_STATUS_CHANGED = "alert.status_changed"
    EVENT_INGESTED = "event.ingested"
    EVENT_INGEST_REJECTED = "event.ingest_rejected"
    DEMO_DATA_GENERATED = "demo.data_generated"
    REPORT_EXPORTED = "report.exported"
    AI_REQUEST = "ai.request"
    AI_UNAVAILABLE = "ai.unavailable"


def severity_from_score(
    score: float,
    *,
    low_min: int = 25,
    high_min: int = 50,
    critical_min: int = 75,
) -> Severity:
    """Map a 0-100 risk score onto a severity band using configurable thresholds."""
    if score >= critical_min:
        return Severity.CRITICAL
    if score >= high_min:
        return Severity.HIGH
    if score >= low_min:
        return Severity.LOW
    return Severity.INFORMATIONAL
