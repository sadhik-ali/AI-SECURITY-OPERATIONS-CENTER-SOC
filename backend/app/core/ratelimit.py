"""In-process sliding-window rate limiter for sensitive endpoints."""
from __future__ import annotations

import time
from collections import defaultdict, deque
from dataclasses import dataclass

from fastapi import HTTPException, Request, status


@dataclass(frozen=True)
class Limit:
    attempts: int
    window_seconds: int


class SlidingWindowLimiter:
    """Fixed-memory limiter: one deque per key, pruned on access.

    Per-process by design. Put a reverse proxy or gateway limiter in front when
    the API runs with multiple workers.
    """

    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str, limit: Limit) -> None:
        now = time.monotonic()
        window = limit.window_seconds
        hits = self._hits[key]
        while hits and now - hits[0] > window:
            hits.popleft()
        if len(hits) >= limit.attempts:
            retry_after = int(window - (now - hits[0])) + 1
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests. Try again shortly.",
                headers={"Retry-After": str(max(retry_after, 1))},
            )
        hits.append(now)

    def reset(self) -> None:
        self._hits.clear()


limiter = SlidingWindowLimiter()


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def enforce(scope: str, key: str, limit: Limit) -> None:
    limiter.check(f"{scope}:{key}", limit)
