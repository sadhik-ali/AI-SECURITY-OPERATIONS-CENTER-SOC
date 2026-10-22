"""Aggregate API router."""
from __future__ import annotations

from fastapi import APIRouter

from app.api.routes import auth, system, users, ws

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(system.router)
api_router.include_router(ws.router)
