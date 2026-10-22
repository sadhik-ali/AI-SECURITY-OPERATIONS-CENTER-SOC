# AI-Powered Security Operations Center (AI SOC)

A SOC dashboard that ingests security events, detects suspicious activity with
deterministic rules, correlates alerts into incidents, scores risk on a
transparent 0-100 scale, and helps an analyst investigate with an AI assistant
that is grounded in the incident's own evidence.

Everything the tool produces is an **indicator that requires investigation**. It
never blocks an IP, never disables an account, and never executes a command -
least of all one suggested by the model.

---

## Current status

| Phase | Scope | State |
| --- | --- | --- |
| 1 | React UI, dark SOC theme, all eight pages on realistic sample data | **complete** |
| 2 | FastAPI, JWT auth + RBAC, nine SQLAlchemy models, Alembic migration, 37 tests | **complete** |
| 3 | Connect the UI to the backend, dashboard APIs | planned |
| 4 | Ingestion, normalisation, nine detection rules, risk scoring, correlation, live WebSocket alerts | planned |
| 5 | Incident workflow, timelines, report export | planned |
| 6 | Ollama assistant with rule-based fallback | planned |
| 7 | Wazuh + OpenSearch adapters | designed, see [`wazuh/README.md`](wazuh/README.md) |
| 8 | Docker Compose, hardening, documentation | compose provided, hardening ongoing |

Phase 1 and Phase 2 run independently today: the UI works fully against its
bundled sample store, and the API works fully against SQLite with no server
infrastructure.

---

## Architecture

```
Browser  (React 18 + Vite + TypeScript + Tailwind + Recharts)
   |  Axios REST  +  WebSocket /ws/alerts (polling fallback)
   v
FastAPI  -------------------------------  JWT auth, RBAC, rate limiting,
   |                                      request-size cap, audit trail
   +-- detection/    deterministic rules (Phase 4)
   +-- correlation/  grouping keys + windows -> incidents (Phase 4)
   +-- scoring/      transparent weighted 0-100 (Phase 4)
   +-- ai_assistant/ Ollama, advisory only (Phase 6)
   +-- collectors/   Wazuh alert ingestion (Phase 7)
   +-- integrations/ OpenSearch client (Phase 7)
   v
SQLAlchemy 2 -> SQLite (local dev) | PostgreSQL (Docker / production)
                                  -> OpenSearch (event search, integrated mode)
```

**Two modes, one code path.** `MODE=demo` uses the synthetic generator and
SQL-backed log search. `MODE=integrated` accepts Wazuh alerts and searches
OpenSearch. Optional services (Ollama, OpenSearch, Wazuh) degrade to a visible
"unavailable" state; the rest of the application keeps working.

---

## Prerequisites (Windows)

| Tool | Version checked | Notes |
| --- | --- | --- |
| Python | 3.13 | 3.11+ works |
| Node.js | 22 LTS | 18+ works |
| Git Bash | any | commands below are bash; PowerShell equivalents noted |
| Docker Desktop | optional | only for PostgreSQL / OpenSearch / Ollama |

### If npm or pip fails with a certificate error

This machine runs Avast HTTPS inspection, which re-signs TLS. Node and pip use
their own CA bundles and reject it (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`). Do not
disable verification - trust the Avast root additionally instead:

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File .certs/export-avast.ps1
openssl x509 -inform der -in .certs/avast-root.cer -outform pem -out .certs/avast-root.pem
```

Then prefix installs with the trust:

```bash
export NODE_EXTRA_CA_CERTS="$PWD/.certs/avast-root.pem"   # npm
export PIP_CERT="$PWD/.certs/avast-root.pem"              # pip
```

If your machine has no interception, skip this entirely.

---

## Run the backend (Phase 2)

```bash
cd backend
python -m venv .venv
.venv/Scripts/python.exe -m pip install --upgrade pip
PIP_CERT="../.certs/avast-root.pem" .venv/Scripts/python.exe -m pip install -r requirements.txt

cp ../.env.example .env       # then set SECRET_KEY: python -c "import secrets;print(secrets.token_hex(32))"

.venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000
```

First start creates `ai_soc.db`, applies the schema, and seeds two analysts.
Open the interactive API at <http://localhost:8000/docs>.

Use a different `--port` if 8000 is busy on your machine, and mirror it in
`frontend/vite.config.ts` when you switch the UI to `api` mode in Phase 3.

### Migrations

```bash
.venv/Scripts/alembic.exe upgrade head          # apply
.venv/Scripts/alembic.exe check                 # assert models == migration
.venv/Scripts/alembic.exe revision -m "x" --autogenerate
```

On SQLite the app also calls `create_all` at startup so a fresh clone runs with
one command; `alembic check` passing proves the migration and the models cannot
drift apart. Point `DATABASE_URL` at PostgreSQL and Alembic is the only path.

### Tests

```bash
cd backend && .venv/Scripts/python.exe -m pytest
```

37 tests cover login, wrong-password and unknown-account parity, token
tampering, expiry, logout invalidation, role enforcement, the last-admin
safeguards, validation redaction, rate limiting, bcrypt behaviour, enum
round-tripping, the full FK graph (incident -> alerts -> events -> notes),
duplicate-ingest protection, and severity banding.

---

## Run the frontend (Phase 1)

```bash
cd frontend
npm install          # add NODE_EXTRA_CA_CERTS=... if npm is blocked
npm run dev          # http://localhost:5173
```

Sign in with either seeded identity - `analyst@aisoc.dev` or `admin@aisoc.dev`,
password `SocDemo!23`. The UI ships in `mock` mode (`frontend/.env` ->
`VITE_DATA_SOURCE=mock`), so it needs no backend today; Phase 3 flips that
switch to `api`.

```bash
npm run typecheck    # tsc --noEmit
```

---

## Run the whole stack with Docker

```bash
cp .env.example .env      # set SECRET_KEY and POSTGRES_PASSWORD
docker compose --profile search --profile ai up --build
```

| Service | URL |
| --- | --- |
| UI | http://localhost:5173 |
| API + docs | http://localhost:8000/docs |
| PostgreSQL | localhost:5432 |
| OpenSearch | localhost:9200 (`search` profile) |
| Ollama | localhost:11434 (`ai` profile) |

Pull a model once the `ollama` container is up:

```bash
docker compose exec ollama ollama pull llama3.1:8b-instruct
```

---

## API reference (what exists today)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/auth/login` | none (rate limited) | Exchange credentials for a JWT |
| `GET` | `/api/auth/me` | bearer | Current user |
| `POST` | `/api/auth/logout` | bearer | Rotate the session group, invalidating issued tokens |
| `GET` | `/api/users` | admin | List users (paged, filterable) |
| `POST` | `/api/users` | admin | Create a user |
| `PATCH` | `/api/users/{id}/role` | admin | Change role (forces re-authentication) |
| `PATCH` | `/api/users/{id}/active` | admin | Enable or disable an account |
| `GET` | `/api/health` | none | Liveness plus a database round-trip |
| `GET` | `/api/system/capabilities` | bearer | Which optional integrations are configured |
| `WS` | `/ws/alerts?token=` | JWT query param | Live alert channel (server side ready) |

### Examples

```bash
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"analyst@aisoc.dev","password":"SocDemo!23"}' | jq -r .access_token)

curl -s http://localhost:8000/api/auth/me -H "Authorization: Bearer $TOKEN"
# {"id":2,"email":"analyst@aisoc.dev","full_name":"Demo Analyst","role":"analyst",
#  "is_active":true,"preferred_timezone":"UTC","last_login_at":"2026-10-22T10:48:24.233123Z"}

curl -s "http://localhost:8000/api/users?page=1&limit=50" -H "Authorization: Bearer $TOKEN"
# 403 {"detail":"Insufficient role for this operation."}   <- analysts are not admins

curl -s -X POST http://localhost:8000/api/auth/logout -H "Authorization: Bearer $TOKEN"
curl -s http://localhost:8000/api/auth/me -H "Authorization: Bearer $TOKEN"
# 401 {"detail":"Session has been signed out."}
```

Responses are snake_case throughout. Errors are
`{"detail": "...", "request_id": "..."}`; validation failures add a field-level
`errors` array that never echoes the submitted value.

---

## Data model

Nine tables, all timestamps stored timezone-aware in UTC and converted to the
viewer's `preferred_timezone` in the UI.

| Table | Role |
| --- | --- |
| `users` | Analysts and admins, bcrypt hashes, per-user timezone, `session_group` for logout |
| `security_events` | Normalised telemetry with `raw` + `normalized` JSON, unique `ingest_key` |
| `alerts` | One rule match: reason, evidence, score breakdown, status |
| `detection_rules` | Configurable parameters, severity, score contribution, investigation steps |
| `incidents` | Correlated group with unique `correlation_key`, score, status, assignee |
| `incident_events` | Which events fed an incident, *why*, and what each contributed |
| `incident_notes` | Analyst notes; `ai_generated` is flagged so machine text can never pose as human findings |
| `audit_logs` | Every authentication, authorisation and configuration change |
| `application_settings` | JSON config, seeded with detection and scoring defaults |

Enum columns persist lowercase values through `EnumString`, so `role = "admin"`
works in SQL while `user.role is Role.ADMIN` works in Python.

---

## Security posture

Implemented now: bcrypt (cost 12), HS256 JWTs with expiry and a `use` claim,
role-based route guards, logout that invalidates every previously issued token
for that user, per-IP **and** per-account login rate limits, a request-size
ceiling enforced before the body is read, a CORS allowlist, parameterized ORM
queries only, audit logging that survives a rolled-back request, validation
errors that redact submitted secrets, and a startup guard that refuses to run
`ENVIRONMENT=prod` with the placeholder secret or with TLS verification disabled.

Deliberate limits: the rate limiter and WebSocket registry are per-process
(single worker). Multi-worker deployment needs a gateway limiter and a Redis
fan-out. Log payloads are untrusted data - never evaluated, never interpolated
into a command, and never an instruction to the model.

---

## Demonstration checklist

Run through this to exercise the delivered scope:

1. `uvicorn` starts with no database present -> schema created, two users seeded.
2. Sign in at `http://localhost:5173` as the analyst -> dashboard renders.
3. Visit `/incidents`, open `INC-2026-0478` -> timeline, evidence, risk gauge.
4. Ask the AI Assistant "what evidence supports this?" -> answers cite the
   incident's own events, labelled evidence vs hypothesis vs recommendation.
5. Try the analyst account on `/api/users` -> 403; sign in as admin -> 200.
6. Log out -> replay the old token -> 401 "Session has been signed out."
7. Wrong password twice vs unknown user twice -> byte-identical 401 bodies.
8. `alembic check` -> "No new upgrade operations detected."
9. `pytest` -> 37 passed.

---

## Project report outline

1. **Objectives** - analyst workload, alert fatigue, explainability.
2. **Threat model and scope** - what the system observes, what it must never do.
3. **Architecture** - the diagram above; why demo and integrated modes share a path.
4. **Detection engineering** - the nine rules, thresholds, false-positive posture.
5. **Correlation and risk scoring** - keys, windows, the weight table, worked example.
6. **AI assistance** - Ollama integration, evidence grounding, structured output,
   the fallback responder, and why recommendations stay advisory.
7. **Implementation** - phases, notable decisions (`EnumString`, session-group
   logout, untrusted-log handling).
8. **Testing** - unit and integration coverage, what each test protects.
9. **Limitations** - per-process state, no real telemetry sources in demo mode,
   model quality bounded by the local model, no automated response.
10. **Future work** - response playbooks with approval gates, MITRE ATT&CK
    mapping, RBAC granularity, horizontal scaling, case management.

---

## Layout

```
ai-soc/
  backend/    app/{core,api,auth,database,models,schemas,services}
              alembic/  tests/  requirements.txt  Dockerfile
  frontend/   src/{components,pages,services,context,data,hooks,types,lib}
              Dockerfile  nginx.conf
  sample_logs/  linux_auth.log  sysmon_events.ndjson  wazuh_alerts.ndjson
  opensearch/   index-template.json
  wazuh/        README.md  (integration design, Phase 7)
  docker-compose.yml  .env.example
```

`sample_logs/` holds synthetic telemetry in the three formats the parsers will
accept in Phase 4. It is demo input, not evidence from a real network.
