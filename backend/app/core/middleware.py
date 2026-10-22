"""HTTP middleware: request-size cap, request ids, access log."""
from __future__ import annotations

import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.core.config import get_settings
from app.core.logging import get_logger

access_log = get_logger("ai_soc.access")

# Paths that must never be logged verbosely (credential material in transit).
_SENSITIVE_PATHS = ("/api/auth/login",)


class RequestContext:
    def __init__(self, request_id: str, client_ip: str, started: float) -> None:
        self.request_id = request_id
        self.client_ip = client_ip
        self.started = started


class SecurityMiddleware(BaseHTTPMiddleware):
    """Enforces the request-size ceiling and emits one access record per call."""

    async def dispatch(self, request: Request, call_next) -> Response:  # noqa: ANN001
        settings = get_settings()
        started = time.perf_counter()
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]

        length = request.headers.get("content-length")
        if length is not None:
            try:
                if int(length) > settings.max_request_bytes:
                    return JSONResponse(
                        status_code=413,
                        content={
                            "detail": "Request body exceeds the configured size limit.",
                            "request_id": request_id,
                        },
                        headers={"X-Request-Id": request_id},
                    )
            except ValueError:
                return JSONResponse(
                    status_code=400,
                    content={"detail": "Invalid Content-Length header.", "request_id": request_id},
                    headers={"X-Request-Id": request_id},
                )

        client_ip = request.client.host if request.client else "unknown"
        request.state.request_id = request_id
        request.state.client_ip = client_ip

        try:
            response = await call_next(request)
        except Exception:
            access_log.exception(
                "request failed",
                extra={"request_id": request_id, "client_ip": client_ip, "action": request.url.path},
            )
            raise

        response.headers["X-Request-Id"] = request_id
        # Defense-in-depth CSP for the JSON API; the SPA ships its own policy.
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"

        if request.url.path not in _SENSITIVE_PATHS:
            access_log.info(
                "request",
                extra={
                    "request_id": request_id,
                    "client_ip": client_ip,
                    "action": f"{request.method} {request.url.path}",
                    "status_code": response.status_code,
                    "duration_ms": round((time.perf_counter() - started) * 1000, 2),
                },
            )
        return response
