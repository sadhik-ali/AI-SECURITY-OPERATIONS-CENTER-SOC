"""Real-time alert socket.

Browsers cannot attach an Authorization header to a WebSocket handshake, so the
same JWT is supplied as a `token` query parameter and verified with the identical
code path used by the REST layer. An unauthenticated socket is closed before any
event data is sent.
"""
from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect, status
from sqlalchemy.orm import Session

from app.auth.dependencies import resolve_user_from_token
from app.core.config import get_settings
from app.core.logging import get_logger
from app.database.session import get_db
from app.models.models import User
from app.services.broadcaster import manager

router = APIRouter(tags=["realtime"])
log = get_logger("ai_soc.ws")

MAX_MESSAGE_BYTES = 8192


@router.websocket("/ws/alerts")
async def alerts_socket(
    websocket: WebSocket,
    token: str | None = Query(default=None, description="Access token from POST /api/auth/login"),
    db: Session = Depends(get_db),
) -> None:
    user = resolve_user_from_token(token, db)
    if user is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Authentication required.")
        return

    connection_id = uuid.uuid4().hex
    await manager.connect(connection_id, websocket)
    log.info(
        "socket opened",
        extra={"action": "ws_connect", "actor": user.email, "client_ip": websocket.client.host},
    )
    await websocket.send_json(
        {
            "type": "connected",
            "data": {
                "connection_id": connection_id,
                "user": user.email,
                "mode": get_settings().mode,
                "listeners": manager.count,
            },
        }
    )
    try:
        while True:
            message: dict[str, Any] = await websocket.receive_json()
            if len(str(message)) > MAX_MESSAGE_BYTES:
                await websocket.send_json({"type": "error", "data": {"detail": "Message too large."}})
                continue
            if message.get("type") == "ping":
                await websocket.send_json({"type": "pong", "data": {}})
            else:
                await websocket.send_json(
                    {"type": "error", "data": {"detail": "Unsupported client message type."}}
                )
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(connection_id)
        log.info("socket closed", extra={"action": "ws_disconnect", "actor": user.email})
