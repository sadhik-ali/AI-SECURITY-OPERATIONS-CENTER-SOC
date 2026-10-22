"""Liveness and capability probes. Never returns a secret value."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.core.config import get_settings
from app.database.session import get_db
from app.models.models import User

router = APIRouter(tags=["system"])


class HealthOut(BaseModel):
    status: str
    version: str
    mode: str
    database: str
    server_time: datetime


class CapabilitiesOut(BaseModel):
    mode: str
    wazuh_enabled: bool
    opensearch_enabled: bool
    ollama_enabled: bool
    ollama_model: str
    ai_available: bool
    demo_seed_available: bool
    access_token_expire_minutes: int


@router.get("/api/health", response_model=HealthOut, summary="Liveness and database check")
def health(db: Session = Depends(get_db)) -> HealthOut:
    settings = get_settings()
    try:
        db.execute(text("SELECT 1"))
        db_status = "up"
    except Exception:
        db_status = "down"
    return HealthOut(
        status="ok" if db_status == "up" else "degraded",
        version=settings.version,
        mode=settings.mode,
        database=db_status,
        server_time=datetime.now(timezone.utc),
    )


@router.get("/api/system/capabilities", response_model=CapabilitiesOut, summary="Optional integrations in use")
def capabilities(_: User = Depends(get_current_user)) -> CapabilitiesOut:
    settings = get_settings()
    return CapabilitiesOut(
        mode=settings.mode,
        wazuh_enabled=settings.wazuh_enabled,
        opensearch_enabled=settings.opensearch_enabled,
        ollama_enabled=settings.ollama_enabled,
        ollama_model=settings.ollama_model,
        # Phase 6 performs the live probe; until then this reports configuration.
        ai_available=settings.ollama_enabled,
        demo_seed_available=settings.mode == "demo",
        access_token_expire_minutes=settings.access_token_expire_minutes,
    )
