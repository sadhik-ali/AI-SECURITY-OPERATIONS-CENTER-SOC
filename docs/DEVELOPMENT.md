# Development guide

Everything needed to go from a clone to a running, tested, debuggable stack.

- [Prerequisites](#prerequisites)
- [First run](#first-run)
- [Repository layout](#repository-layout)
- [Configuration](#configuration)
- [Database and migrations](#database-and-migrations)
- [Testing](#testing)
- [Linting and formatting](#linting-and-formatting)
- [Debugging](#debugging)
- [TLS interception (Avast and similar)](#tls-interception-avast-and-similar)
- [Making a change](#making-a-change)

---

## Prerequisites

| Tool | Version checked | Minimum | Needed for |
| --- | --- | --- | --- |
| Python | 3.13 | 3.11 | backend |
| Node.js | 22 LTS | 18 | frontend |
| Git Bash | any | — | the commands below are bash |
| Docker Desktop | any | — | optional: PostgreSQL, OpenSearch, Ollama |

Nothing else. No database server, no OpenSearch, no GPU. The backend creates and
seeds a SQLite file on first start; the frontend ships with a synthetic data
store, so each half runs standalone.

Windows-specific notes: PowerShell 5.1 chokes on some of the quoting below, so
either use Git Bash or write a `.ps1` and run it with `-File`. Git Bash `/tmp` is
not visible to Windows-built Python — use a path under the repo for scratch files.

---

## First run

### Backend

```bash
cd backend
python -m venv .venv
.venv/Scripts/python.exe -m pip install --upgrade pip
.venv/Scripts/python.exe -m pip install -r requirements.txt

cp ../.env.example .env
# give it a real secret:
echo "SECRET_KEY=$(python -c 'import secrets;print(secrets.token_hex(32))')" >> .env

.venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000
```

On Linux/macOS replace `.venv/Scripts/` with `.venv/bin/`.

First start creates `backend/ai_soc.db`, applies the schema, and seeds:

| Identity | Password | Role |
| --- | --- | --- |
| `admin@aisoc.dev` | `SocDemo!23` | admin |
| `analyst@aisoc.dev` | `SocDemo!23` | analyst |

These are demo accounts for a demo database, created only when the environment is
not `prod`. Change them the moment you point the app at anything real.

Open <http://localhost:8000/docs>.

### Frontend

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

The UI defaults to `VITE_DATA_SOURCE=mock`, so it needs no backend. Sign in with
either seeded identity above — mock auth accepts them locally, and the same
credentials work against the API in `api` mode.

### Both halves together

```bash
# frontend/.env
VITE_DATA_SOURCE=api
VITE_API_BASE_URL=http://localhost:8000
```

Vite proxies `/api` and `/ws` to `http://localhost:8000` (see
[`frontend/vite.config.ts`](../frontend/vite.config.ts)). If port 8000 is taken on
your machine, run uvicorn elsewhere and mirror the port in that proxy config.

**Check the port is actually yours before debugging an app that "will not start":**

```bash
netstat -ano | grep ':8000' | grep LISTENING
```

A different project's server answering on 8000 produces baffling 404s against
your routes.

---

## Repository layout

```
ai-soc/
├─ backend/
│  ├─ app/
│  │  ├─ api/            router.py, routes/{auth,users,system,ws}.py
│  │  ├─ auth/           dependencies.py — bearer decode, RBAC guards
│  │  ├─ core/           config, security, ratelimit, logging, middleware
│  │  ├─ database/       base, session, types (EnumString), init_db (seeds)
│  │  ├─ models/         enums.py, models.py — the nine tables
│  │  ├─ schemas/        Pydantic request/response contracts
│  │  └─ services/       audit.py, broadcaster.py
│  ├─ alembic/           env.py, versions/0001_initial_schema.py
│  ├─ tests/             conftest.py, test_auth.py, test_domain.py
│  └─ requirements.txt
├─ frontend/
│  └─ src/
│     ├─ components/     layout/, ui/, charts/, ActivityFeed
│     ├─ pages/          8 route components
│     ├─ services/       api, auth, ws, mockStore, aiLocal
│     ├─ context/        AuthContext, LiveContext
│     ├─ data/           world, fixtures, logs — the synthetic corpus
│     ├─ hooks/ lib/     useAsync, format, rng
│     └─ types/          api.ts — mirrors the backend contract
├─ docs/                 this guide, plus architecture, API, rules, model
├─ sample_logs/          synthetic auth.log / Sysmon / Wazuh inputs
├─ opensearch/           index template
├─ wazuh/                integration design (Phase 7)
└─ docker-compose.yml
```

---

## Configuration

Every setting comes from environment variables (or `backend/.env`), defined once
in [`backend/app/core/config.py`](../backend/app/core/config.py). `.env.example`
documents the whole surface with placeholders and no real values.

| Variable | Default | Notes |
| --- | --- | --- |
| `SECRET_KEY` | — | required, ≥16 chars; prod refuses the dev placeholder |
| `ENVIRONMENT` | `dev` | `prod` turns on the startup guards |
| `MODE` | `demo` | `demo` or `integrated` |
| `DATABASE_URL` | `sqlite:///./ai_soc.db` | PostgreSQL in compose |
| `CORS_ORIGINS` | localhost dev origins | allowlist, comma separated |
| `MAX_REQUEST_BYTES` | 1 MiB | enforced before the body is read |
| `LOGIN_RATE_LIMIT_ATTEMPTS` / `_WINDOW_SECONDS` | 10 / 300 | per client IP; the per-account budget is a fixed 5 in the same window |
| `INGESTION_RATE_LIMIT_PER_MINUTE` | 600 | collector path |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | 480 | |
| `BOOTSTRAP_ADMIN_EMAIL` / `_PASSWORD` | demo values | ignored in `prod` |
| `OLLAMA_ENABLED` / `_BASE_URL` / `_MODEL` / `_TIMEOUT_SECONDS` | `true` · `localhost:11434` · `llama3.1:8b-instruct` · 60 | enabled by default; the client is Phase 6, so it reports unavailable until then |
| `OPENSEARCH_*` | disabled | Phase 7; `VERIFY_TLS=false` is dev-only |
| `WAZUH_*` | disabled | Phase 7 |

Secrets never enter the browser. The frontend receives booleans and model names
from `/api/system/capabilities`, never URLs with embedded credentials.

---

## Database and migrations

```bash
cd backend
.venv/Scripts/alembic.exe upgrade head                       # apply
.venv/Scripts/alembic.exe check                              # models == migration?
.venv/Scripts/alembic.exe revision -m "add x" --autogenerate # new revision
```

`alembic check` is the important one: it fails in CI if a model changed without a
revision. On SQLite the app also runs `create_all` at startup so a fresh clone
needs no migration step; on PostgreSQL Alembic is the only path.

After `--autogenerate`, **read the generated file before applying it**. Two known
manual touches: enum columns render as `sa.Enum(...)` and must become
`sa.String(length=32)` to match `EnumString`, and SQLite revisions must be wrapped
in `batch_alter_table` (`env.py` sets `render_as_batch` automatically).

Resetting local state is a file delete:

```bash
rm -f backend/ai_soc.db backend/ai_soc.db-wal backend/ai_soc.db-shm
```

---

## Testing

```bash
cd backend && .venv/Scripts/python.exe -m pytest            # 37 tests
cd backend && .venv/Scripts/python.exe -m pytest -k auth -v  # one area
cd frontend && npm run typecheck                            # tsc --noEmit
cd frontend && npm run build                                # production build
```

`tests/conftest.py` sets its own environment (temp-file SQLite, generous rate
limits) **before** importing `app.main`, so the suite never touches your dev
database and never inherits a stray `.env`.

What the tests protect:

| Area | Examples |
| --- | --- |
| Authentication | login shape, case-insensitive email, byte-identical 401 for wrong password vs unknown account, tampered / expired / foreign-key-signed tokens, logout invalidation |
| RBAC | analyst blocked from `/api/users`, role change kills the session, self-demotion and last-admin guards |
| Validation | invalid timezone and short password rejected without echoing the submitted value |
| Rate limiting | per-account 429 with `Retry-After`, plus a direct `SlidingWindowLimiter` unit test |
| Passwords | bcrypt salt uniqueness, verification, 73-byte input rejected |
| Domain | severity band boundaries at 24.99 / 25 / 49.9 / 50 / 74.9 / 75 / 100, configurable thresholds, closed-incident has no exit |
| Schema | all nine tables present, `EnumString` round-trip, seeded settings with weights summing to 100, secret-bearing rows store no value |
| Integrity | full incident → alert → event → link → note graph, duplicate `correlation_key` and `ingest_key` rejected |
| Audit | login/logout/rejection rows written, `_scrub()` redaction |

Frontend tests (Vitest) are Phase 8; `npm run typecheck` is the current gate, and
`src/types/api.ts` is written to match the backend schemas so drift shows up as a
compile error rather than a runtime surprise.

---

## Linting and formatting

No linter is enforced yet — the deliberate choice is that `tsc --noEmit`,
`alembic check` and `pytest` are the three gates that actually catch regressions.
Line lengths follow `.editorconfig` (4-space Python, 2-space TS, 100-column
Python soft limit). If you add Ruff or ESLint, land it as its own commit so the
diff stays reviewable.

---

## Debugging

**Logs are JSON on stdout**, one object per request, with `request_id`, `actor`,
`action`, `status_code`, `duration_ms`. `uvicorn.access` is disabled because the
application's own access log replaces it — and it deliberately skips
`/api/auth/login`, so credentials never reach a log file.

```bash
.venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000 --log-level debug
```

- Every error response carries `request_id`; grep the log for it.
- 401 with an unexpected reason? The `audit_logs` table records `TOKEN_REJECTED`
  with the subject hint and why.
- "Works on SQLite, fails on PostgreSQL" is nearly always a JSON or
  `Numeric`/`DateTime` behaviour difference — check the column types first.
- A route returning 404 on a port you believe is yours: `netstat -ano`.

---

## TLS interception (Avast and similar)

If `npm install` or `pip install` fails with `UNABLE_TO_VERIFY_LEAF_SIGNATURE` or
`SSLCertVerificationError`, an antivirus or corporate proxy is re-signing TLS with
a locally installed root. Node and pip use their own CA bundles and do not look in
the OS store, so they reject it.

**Do not disable verification.** Trust the intercepting root additionally:

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File .certs/export-avast.ps1
openssl x509 -inform der -in .certs/avast-root.cer -outform pem -out .certs/avast-root.pem

export NODE_EXTRA_CA_CERTS="$PWD/.certs/avast-root.pem"   # npm
export PIP_CERT="$PWD/.certs/avast-root.pem"              # pip
```

`.certs/` is gitignored — it is a machine workaround, not project configuration,
and must never become a shipped trust anchor. If your machine has no interception,
skip this whole section.

The same rule applies to the application: `OPENSEARCH_VERIFY_TLS=false` is a local
development choice, and starting with `ENVIRONMENT=prod` and verification disabled
raises at boot.

---

## Making a change

1. Branch from `master`: `feat/…`, `fix/…`, `docs/…`.
2. Backend change → model change → `alembic revision --autogenerate`, review it,
   `alembic upgrade head`, `alembic check`.
3. Add or extend a test that would have caught the bug you are fixing.
4. `pytest`, `npm run typecheck`, `npm run build`.
5. Update docs in the same commit when behaviour, a setting, or an endpoint moves.
6. Open a PR against the template checklist in
   [`.github/PULL_REQUEST_TEMPLATE.md`](../.github/PULL_REQUEST_TEMPLATE.md).

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the fuller version, including the
security review items specific to this project.
