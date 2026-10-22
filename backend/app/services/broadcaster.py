"""WebSocket fan-out for live alert delivery."""
from __future__ import annotations

import asyncio
from typing import Any

from fastapi import WebSocket

from app.core.logging import get_logger

log = get_logger("ai_soc.ws")


class ConnectionManager:
    """Per-process broadcast registry.

    A single uvicorn worker owns these sockets. Scale past one worker by putting
    a pub/sub fan-out (Redis) in front, not by sharing this object.
    """

    def __init__(self) -> None:
        self._connections: dict[str, WebSocket] = {}
        self._lock = asyncio.Lock()

    @property
    def count(self) -> int:
        return len(self._connections)

    async def connect(self, connection_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections[connection_id] = websocket

    async def disconnect(self, connection_id: str) -> None:
        async with self._lock:
            self._connections.pop(connection_id, None)

    async def publish(self, payload: dict[str, Any]) -> None:
        """Best-effort delivery: a dead socket must never stall detection."""
        async with self._lock:
            targets = list(self._connections.items())
        stale: list[str] = []
        for connection_id, websocket in targets:
            try:
                await websocket.send_json(payload)
            except Exception:
                stale.append(connection_id)
        if stale:
            log.info("dropping stale sockets", extra={"action": "ws_stale", "count": len(stale)})
        for connection_id in stale:
            await self.disconnect(connection_id)


manager = ConnectionManager()


async def publish_event(payload: dict[str, Any]) -> None:
    """Called by the detection engine (Phase 4) whenever it mints an alert."""
    await manager.publish(payload)
