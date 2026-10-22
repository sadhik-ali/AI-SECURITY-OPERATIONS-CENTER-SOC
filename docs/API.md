# API reference

Base URL in development: `http://localhost:8000`. Interactive OpenAPI at
[`/docs`](http://localhost:8000/docs), ReDoc at `/redoc`, schema JSON at
`/openapi.json`.

Responses are **snake_case** throughout. Timestamps are ISO-8601 UTC. Errors are:

```json
{ "detail": "Insufficient role for this operation.", "request_id": "b83f1c9a" }
```

Validation failures (422) add a field-level array that names the field and the
constraint violated — **never the value submitted**, because the field might be a
password:

```json
{
  "detail": "Request validation failed.",
  "request_id": "8ad3f1c2",
  "errors": [{ "field": "password", "message": "String should have at least 10 characters" }]
}
```

Authentication is `Authorization: Bearer <access_token>`, except the WebSocket,
where browsers cannot set headers on an upgrade so the token is a query parameter.

---

## Implemented (Phase 2)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/auth/login` | — (rate limited) | Exchange credentials for a JWT |
| `GET` | `/api/auth/me` | bearer | Current user |
| `POST` | `/api/auth/logout` | bearer | Rotate the session group, invalidating issued tokens |
| `GET` | `/api/users` | admin | List users, paged and filterable |
| `POST` | `/api/users` | admin | Create a user |
| `PATCH` | `/api/users/{id}/role` | admin | Change role; forces re-authentication |
| `PATCH` | `/api/users/{id}/active` | admin | Enable or disable an account |
| `GET` | `/api/health` | — | Liveness plus a database round-trip |
| `GET` | `/api/system/capabilities` | bearer | Which optional integrations are configured |
| `WS` | `/ws/alerts?token=` | JWT query param | Live alert channel |

### `POST /api/auth/login`

```json
{ "email": "analyst@aisoc.dev", "password": "SocDemo!23" }
```

→ `200`

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…",
  "token_type": "bearer",
  "expires_at": "2026-10-22T18:48:24.233123Z",
  "user": {
    "id": 2, "email": "analyst@aisoc.dev", "full_name": "Demo Analyst",
    "role": "analyst", "is_active": true, "preferred_timezone": "UTC",
    "last_login_at": "2026-10-22T10:48:24.233123Z"
  }
}
```

Failures are deliberately indistinguishable: wrong password and unknown account
return byte-identical `401 {"detail": "Invalid email or password."}`, and an
unknown account still pays a bcrypt comparison so response time does not leak
existence. Disabled accounts get `403`. Both IP-level and account-level limits can
return `429` with `Retry-After`.

JWT claims: `sub` (user id), `role`, `tz`, `sg` (session group), `iat`, `exp`,
`jti`, `use`. A token minted for another purpose, signed by another key, or
carrying a rotated `sg` is rejected and the rejection is audited.

### `GET /api/users`

Query: `page` (≥1, default 1) · `limit` (1–200, default 50) · `role` · `is_active`.

→ `{ "items": [UserOut], "total": 2, "page": 1, "pages": 1 }`

### `POST /api/users`

```json
{
  "email": "new.analyst@aisoc.dev",
  "password": "at-least-ten-chars",
  "full_name": "New Analyst",
  "role": "analyst",
  "preferred_timezone": "Asia/Kolkata"
}
```

`201` on success, `409` on duplicate email, `422` for a short password or a
timezone `zoneinfo` cannot resolve. Passwords are capped at 72 bytes because that
is bcrypt's input limit — rejected explicitly rather than silently truncated.

### `PATCH /api/users/{id}/role` · `/active`

Two lockout guards, both tested:

- an admin cannot demote or disable **themselves** → `400`;
- an action that would leave the system with **no active admin** → `409`.

Changing a role rotates `session_group`, so the affected user's existing tokens
stop validating immediately.

### `GET /api/health`

```json
{ "status": "ok", "version": "0.1.0", "mode": "demo",
  "database": "connected", "server_time": "2026-10-22T11:52:07.4fZ" }
```

### `GET /api/system/capabilities`

Reports `mode`, `wazuh_enabled`, `opensearch_enabled`, `ollama_enabled`,
`ollama_model`, `ai_available`, `demo_seed_available`,
`access_token_expire_minutes`. Booleans and names only — no URLs with embedded
credentials, no keys.

### `WS /ws/alerts?token=<jwt>`

Server frames: `{"type":"connected",…}`, `{"type":"pong"}`, and from Phase 4
`alert`, `incident`, `event`. The only client message accepted is
`{"type":"ping"}`; anything else gets an error frame, and inbound messages are
capped at 8192 bytes. Unauthenticated sockets close with policy violation `1008`.

```python
import asyncio, json, websockets

async def watch(token: str) -> None:
    async with websockets.connect(f"ws://localhost:8000/ws/alerts?token={token}") as ws:
        print(json.loads(await ws.recv()))          # connected
        await ws.send(json.dumps({"type": "ping"}))
        print(json.loads(await ws.recv()))          # pong
```

---

## Planned

Names below are the contract from the project brief. They land in the phase noted;
until then they do not exist, and the UI serves them from its bundled mock store.

### Dashboard — Phase 3
| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/dashboard/summary` | Counts, severity mix, open incidents |
| `GET` | `/api/dashboard/trends` | Time-bucketed series for the charts |
| `GET` | `/api/dashboard/top-sources` | Ranked source IPs / hosts / users |

### Events — Phase 4
| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/events` | Search with time range, source, host, user, IP, text filters |
| `GET` | `/api/events/{id}` | One event, `raw` and `normalized` side by side |
| `POST` | `/api/events/ingest` | Collector entry point; dedupes on `ingest_key` |

### Alerts — Phase 4
| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/alerts` | Filter by severity, status, rule, entity, time |
| `GET` | `/api/alerts/{id}` | Alert with evidence and score breakdown |
| `PATCH` | `/api/alerts/{id}` | Status transitions only; audited |

### Incidents — Phase 5
| Method | Path | Purpose |
| --- | --- | --- |
| `GET` / `POST` | `/api/incidents` | List, and manual creation |
| `GET` / `PATCH` | `/api/incidents/{id}` | Detail, and status / assignee changes |
| `POST` | `/api/incidents/{id}/notes` | Analyst note (`ai_generated` set by the server) |
| `GET` | `/api/incidents/{id}/timeline` | Ordered events with per-event contribution |
| `GET` | `/api/incidents/{id}/report` | Exportable investigation report |

### AI — Phase 6
| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/ai/analyze-alert` | Structured, evidence-cited analysis |
| `POST` | `/api/ai/analyze-incident` | Narrative over the incident's own events |
| `POST` | `/api/ai/chat` | Grounded free-text questions |

All three are advisory. None can mutate rules, block an IP, disable an account,
isolate a host, or execute a command.

### Configuration — Phase 5
| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/settings` | Current settings; secret rows show configured, not value |
| `PATCH` | `/api/settings` | Admin-only retuning; audited before and after |

---

## Conventions every endpoint keeps

- Pagination: `page` / `limit` in, `items` / `total` / `page` / `pages` out.
- Filtering by inclusive `from` / `to` ISO-8601 parameters; UTC on the wire.
- Status codes: `200` read, `201` create, `400` semantically invalid, `401`
  unauthenticated, `403` forbidden, `404` absent, `409` conflict, `413` too large,
  `422` schema invalid, `429` limited, `500` unexpected (with `request_id`).
- Every state change writes an `audit_logs` row on its own session.
- No endpoint returns a password hash, a session group, or an integration secret.
