# Architecture

How the pieces fit, which layer owns what, and why the boundary lines are drawn
where they are. For the domain schema see [DATA_MODEL.md](DATA_MODEL.md); for the
detection contract see [DETECTION_RULES.md](DETECTION_RULES.md).

---

## System overview

```
                        ┌──────────────────────────────────────────────┐
   telemetry feeds      │              COLLECTION (Phase 4/7)          │
 ┌───────────────┐      │  ┌────────────┐  ┌──────────┐  ┌──────────┐  │
 │ Wazuh alerts  │─────▶│  │  Wazuh     │  │ Linux    │  │ Sysmon   │  │
 │ Linux auth.log│─────▶│  │  collector │  │ parser   │  │ NDJSON   │  │
 │ Sysmon NDJSON │      │  └─────┬──────┘  └────┬─────┘  └────┬─────┘  │
 │ demo generator│─────▶│        └──────────────┼─────────────┘        │
 └───────────────┘      │              normalise ▼ + dedupe (ingest_key)│
                        └───────────────┬──────────────────────────────┘
                                        ▼
                        ┌──────────────────────────────────────────────┐
                        │            DETECTION  (Phase 4)              │
                        │  nine rules over sliding windows             │
                        │        ▼            ▼             ▼          │
                        │   alerts       risk score    correlation     │
                        │  (0–100,       (weights)     (keys + window) │
                        │   breakdown)                       ▼         │
                        │                             incidents        │
                        └───────────────┬──────────────────────────────┘
                                        ▼
     ┌─────────────────────────────────────────────────────────────────┐
     │                        FASTAPI  (Phase 2 ✓)                     │
     │  SecurityMiddleware → CORS → router → dependency guards → DB    │
     │  request-size cap · X-Request-Id · security headers · access log │
     │  JWT auth · RBAC · rate limiting · audit trail · WS broadcast    │
     └───────────────┬───────────────────────────────┬─────────────────┘
              REST   │                               │  WS /ws/alerts
                     ▼                               ▼
     ┌─────────────────────────────────────────────────────────────────┐
     │                 React 18 SPA  (Phase 1 ✓)                       │
     │  8 pages · dark SOC theme · Recharts · live feed + poll fallback │
     │  VITE_DATA_SOURCE=mock ──▶ bundled synthetic world               │
     │  VITE_DATA_SOURCE=api  ──▶ this backend                          │
     └─────────────────────────────────────────────────────────────────┘

  persistence:  SQLite (dev) | PostgreSQL (compose / prod)
  event search: OpenSearch (optional, MODE=integrated)
  reasoning:    Ollama (optional, advisory only)
```

---

## Layer ownership

| Layer | Owns | Must not |
| --- | --- | --- |
| `frontend/src/pages` | layout, filters, what to show | compute risk, decide severity |
| `frontend/src/services` | transport, caching, the mock/api switch | hold secrets, trust its own optimistic state |
| `app/api/routes` | HTTP shape, status codes, pagination, validation binding | business rules |
| `app/auth` | token validation, role checks, session-group test | issue tokens for another role |
| `app/core` | config, security primitives, limits, logging | domain semantics |
| `app/models` | schema, constraints, enum truth | query logic |
| `app/services` | audit, broadcasting, later ingestion/detection/correlation | — |
| `app/database` | engine, session scope, `EnumString`, seeding | per-request state |

The rule that keeps this honest: **severity and risk are computed on the server
and only displayed on the client.** A UI that recalculated the score would drift
from the API the moment a threshold changed.

---

## Request lifecycle

```
TCP → CORS (allowlist) → SecurityMiddleware
        ├─ Content-Length > max_request_bytes ? 413 before the body is read
        ├─ assign X-Request-Id (echoed in errors and logs)
        ├─ set nosniff / X-Frame-Options DENY / no-referrer
        └─ structured access log (skips /api/auth/login)
      → route match → Pydantic validation
        └─ 422: field names + constraints only, never the submitted value
      → dependency chain
        ├─ Bearer decode (signature, exp, use, jti)
        ├─ user active?
        ├─ payload["sg"] == user.session_group ?   ← server-side logout
        └─ role satisfied?  else 401/403, both audited
      → handler → SQLAlchemy (parameterised only) → commit
      → response + request_id
```

Failures are audited on a separate session, so a rolled-back request still leaves
a trail. Unexpected exceptions become a generic 500 carrying the `request_id` —
the stack trace goes to the log, never to the client.

---

## Two modes, one code path

`MODE=demo` and `MODE=integrated` differ only at the edges:

| Concern | `demo` | `integrated` |
| --- | --- | --- |
| Event origin | synthetic generator (`demo=true`) | Wazuh / Sysmon / auth logs |
| Log search | SQL over `security_events` | OpenSearch, SQL as fallback |
| Detection, scoring, correlation, UI | identical | identical |

Detection never asks where an event came from — it reads normalised rows. So a
rule proven on generated traffic behaves the same on real traffic, and the demo
mode used for a viva is the same software as the integrated mode.

Optional services are **probeable, not assumed**. `/api/system/capabilities`
reports what is configured; anything unavailable renders as a visible
"unavailable" state with a reason. The application degrades, it does not lie.

---

## Live channel

`WS /ws/alerts?token=<jwt>` — browsers cannot set headers during a WebSocket
upgrade, so the JWT travels as a query parameter. Consequences taken seriously:

- query strings get logged, so the access log skips this path's token and the
  token itself is short-lived and read-only;
- unauthenticated sockets are closed with policy violation `1008`, not silently
  ignored;
- inbound frames are capped at 8192 bytes; the only accepted client message is
  `{"type":"ping"}`.

Server side, `ConnectionManager` keeps per-process sockets, prunes stale ones,
and publishes typed frames (`connected`, `pong`, and from Phase 4 `alert`,
`incident`, `event`). The client keeps a polling fallback: if the socket drops,
the dashboard degrades to refresh instead of going stale in silence.

**Known limit, stated plainly:** the registry and the rate limiter are in-memory
and per-process, so this is a single-worker deployment. Multi-worker needs a
gateway-level limiter and a Redis fan-out. That is a deliberate Phase-8 item, not
an oversight — see [DEPLOYMENT.md](DEPLOYMENT.md#scaling).

---

## AI boundary

The assistant is grounded, advisory, and labelled:

1. Context is the incident's own evidence — events, alerts, score breakdown,
   analyst notes — assembled server-side, not a free-floating prompt.
2. Log content inside that context is **data**. Instructions embedded in a log
   line are the most obvious attack on an AI SOC, so the prompt frames telemetry
   as quoted material the model must describe, never obey.
3. Output is structured: `finding`, `evidence_cited`, `hypotheses`,
   `recommended_next_steps`, `confidence`, `limitations`, split into
   evidence / hypothesis / recommendation so an unsupported inference cannot hide
   inside a paragraph of facts.
4. Recommendations are never executed. No command from the model reaches a shell.
   No IP is blocked, no account disabled, no host isolated.
5. AI notes persist with `ai_generated = true`.
6. When Ollama is unreachable, a deterministic rule-based responder answers from
   the same evidence and says it is the fallback. A degraded assistant is useful;
   an unlabelled one is dangerous.

---

## Frontend architecture

```
main.tsx → BrowserRouter → App (route table + auth guards)
                              └── AppShell (Sidebar · Topbar · MobileNav · footer)
                                    └── page routes
AuthContext  → token + user in localStorage via services/auth
LiveContext  → WS subscription + polling fallback, shared by every live view
services/api → one axios instance, request/response interceptors, error normalising
services/mockStore → the synthetic world behind VITE_DATA_SOURCE=mock
hooks/useAsync → loading / error / retry, so no page invents its own state machine
components/ui  → Panel · Badges · RiskGauge · Drawer · Controls · States
```

The mock store is a real module with the same shape as the API client, not
hardcoded JSX. Flipping `VITE_DATA_SOURCE` to `api` in Phase 3 changes transport,
not pages — which is why `src/types/api.ts` mirrors the backend schemas exactly.

---

## Decisions and their trade-offs

| Decision | Why | Cost |
| --- | --- | --- |
| SQLite by default, PostgreSQL via compose | a clone runs with one command, no infrastructure | two engines, so `render_as_batch` and `EnumString` are needed |
| `session_group` rotation instead of a token denylist | logout invalidation without shared state or a growing blocklist | a token still carries a role until it expires (mitigated by short expiry) |
| Deterministic rules, not ML, in the alert path | every alert must explain itself to an analyst and a marker | no novel-pattern detection; scikit-learn stays advisory |
| Transparent weighted score | "78 because severity gave 31/35" is checkable; "the model said high" is not | weights need tuning per environment |
| Unique `correlation_key` | grouping is re-runnable and idempotent | one key per narrative; overlapping stories need explicit choice |
| `raw` kept verbatim as JSON | re-parsing after a parser fix must be possible | storage growth; untrusted content in the DB, so never evaluated |
| Per-process WS + limiter | zero extra infrastructure | single worker only |
| Pydantic v2 everywhere | one validation source for HTTP, ORM and settings | strict schemas mean deliberate effort to keep them current |

---

## Deployment shapes

**Local development** — `uvicorn` on SQLite + `vite dev` on the mock store. No
Docker, no servers to start.

**Single host** — `docker compose up`: nginx serves the built SPA and proxies
`/api` and `/ws` (with `Upgrade` headers) to uvicorn; PostgreSQL holds state.

**With search** — add `--profile search` for OpenSearch and set `MODE=integrated`;
the index template in [`opensearch/`](../opensearch/index-template.json) pins the
mapping (`dynamic: strict`, `raw` stored but not indexed) so untrusted payloads
cannot explode the mapping.

**With AI** — add `--profile ai` for Ollama and pull a model once. Absent either,
the UI shows the integration as unavailable and everything else keeps working.

Details in [DEPLOYMENT.md](DEPLOYMENT.md).

---

## Threat model in one screen

| Threat | Control |
| --- | --- |
| Credential guessing | per-IP **and** per-account sliding-window limits, identical 401 bodies, dummy-hash timing parity |
| Token theft / replay | short expiry, `use` claim, session-group revocation, no token in any response body |
| Privilege creep | role dependency per route, last-active-admin guard, self-demotion guard, role change rotates sessions |
| Prompt injection via logs | telemetry framed as quoted data; model output advisory; no execution path from model to shell |
| Log payload abuse | size cap before body read, `dynamic: strict` mapping, `raw` never indexed |
| Secret leakage | env-only credentials, `is_secret` settings store a digest not a value, audit `_scrub()`, 422 echoes field names only, login excluded from access logs |
| SQLi / injection | parameterised ORM only; no string-built queries anywhere |
| Downgrade of TLS | startup guard refuses `ENVIRONMENT=prod` with verification disabled or the placeholder secret |
| Silent misbehaviour | structured logs with request ids, audit trail on its own session, honest "unavailable" states |

Out of scope by design: automated response, active hunting, and any destructive
action. See [SECURITY.md](../SECURITY.md).
