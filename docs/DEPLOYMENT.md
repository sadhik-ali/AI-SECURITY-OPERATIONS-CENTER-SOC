# Deployment

Four shapes, from a laptop to a hardened host. Pick the smallest one that answers
the question you are asking.

| Shape | Use for | Infra needed |
| --- | --- | --- |
| [Local split](#1-local-split-dev) | development, a viva demo | none |
| [Compose, core](#2-compose-core) | a realistic single-host run | Docker |
| [Compose, full](#3-compose-full-search--ai) | OpenSearch + Ollama | Docker, ~6 GB RAM |
| [Behind a reverse proxy](#4-production-shape) | anything reachable from a network | TLS termination |

---

## 1. Local split (dev)

Backend on SQLite, frontend on its mock store. No containers, no servers to
provision. See [DEVELOPMENT.md](DEVELOPMENT.md#first-run).

```bash
cd backend  && .venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000
cd frontend && npm run dev
```

---

## 2. Compose, core

PostgreSQL + API + nginx-served SPA.

```bash
cp .env.example .env
python -c "import secrets; print('SECRET_KEY=' + secrets.token_hex(32))" >> .env
python -c "import secrets; print('POSTGRES_PASSWORD=' + secrets.token_urlsafe(24))" >> .env
docker compose up --build
```

| Service | URL |
| --- | --- |
| UI | <http://localhost:5173> |
| API + OpenAPI | <http://localhost:8000/docs> |
| PostgreSQL | `localhost:5432` |

The backend container runs `alembic upgrade head` before uvicorn starts, so the
schema is applied exactly once and by one process.

---

## 3. Compose, full (`search` + `ai`)

```bash
docker compose --profile search --profile ai up --build
docker compose exec ollama ollama pull llama3.1:8b-instruct
```

Adds OpenSearch on `localhost:9200` and Ollama on `localhost:11434`. Set
`MODE=integrated` to route log search through OpenSearch.

**OpenSearch needs a real VM map count.** The first start often fails on
`max virtual memory areas vm.max_map_count [64] is too low`:

```bash
sudo sysctl -w vm.max_map_count=262144      # session
# or persist: vm.max_map_count=262144 in /etc/sysctl.d/99-opensearch.conf
```

Give the container `discovery.type: single-node` and `DISABLE_SECURITY_PLUGIN=true`
only for local development. For anything else, follow the OpenSearch security
documentation; the index template in [`opensearch/`](../opensearch/index-template.json)
is written to work with the security plugin on.

### Index mapping discipline

`ai-soc-events-*` uses `dynamic: strict` with `raw` stored but **not** indexed
(`enabled: false`), and `src_ip` / `dst_ip` typed as `ip`. This is not a
performance tweak — it is a guard. Telemetry is untrusted input, and a permissive
mapping lets a hostile or merely odd payload field create new mapped fields
without limit until the cluster's mapping budget is exhausted.

If you change the template, create a new version and roll the alias. Do not edit
the mapping of a live index in place.

### Ollama

`OLLAMA_MODEL` and `OLLAMA_BASE_URL` point the assistant at the container. If
Ollama is unreachable the assistant falls back to a deterministic responder that
answers from the same incident evidence and **labels itself as the fallback**.
Nothing in the AI path can mutate a rule, block an address, or execute a command.

---

## 4. Production shape

```
Internet ──▶ TLS terminator (Caddy / nginx / ALB)
              ├─ /            → frontend container (nginx, static SPA)
              ├─ /api/        → backend container (uvicorn, 1 worker)
              └─ /ws/alerts   → backend container, Upgrade + Connection headers
                              → PostgreSQL (private network)
```

Required before `ENVIRONMENT=prod`:

- [ ] `SECRET_KEY` is a fresh 32+ byte random value, not the placeholder — the app
      **refuses to start** otherwise.
- [ ] `OPENSEARCH_VERIFY_TLS=true`. Setting it to `false` in prod also raises at
      boot; this is enforced in code, not in a README.
- [ ] Bootstrap admin credentials changed or the seeding disabled. The demo
      accounts are not created in `prod`, but confirm your `.env` carries no
      `BOOTSTRAP_ADMIN_PASSWORD`.
- [ ] `CORS_ORIGINS` lists only your real origins. `allow_credentials` stays
      `false`; the app authenticates with a bearer token, not cookies.
- [ ] PostgreSQL on a private network, password from the environment, backups
      tested by restoring them.
- [ ] Log transport encrypted; the app emits JSON to stdout, so ship it to
      somewhere with retention and access control.
- [ ] Reverse proxy passes `X-Forwarded-For` and uvicorn trusts it, otherwise the
      per-IP login limiter counts the proxy, not the client.
- [ ] `/ws` proxied with `proxy_http_version 1.1`, `Upgrade`/`Connection` headers,
      and a read timeout longer than the ping interval.
- [ ] Retention job (Phase 5) running against `retention.days`.

### Scaling

The rate limiter and the WebSocket registry are **in-process**. That is a real
constraint, not a footnote:

- Run **one** uvicorn worker per container. `--workers 4` gives four independent
  limiters (so a login budget four times the configured size) and each socket
  receives only the alerts published by its own process.
- Scale by adding replicas behind a proxy that supports WebSocket, and move the
  two pieces of shared state out of the process:
  - **rate limiting** → the gateway/edge, or Redis-backed counters;
  - **alert fan-out** → Redis pub/sub or NATS, with each replica subscribing and
    publishing into its own local registry.
- PostgreSQL needs no change; the SQLAlchemy session scope is already per-request.

The honest sequencing is: get detection, correlation and the AI path finished
(Phases 4–6), then do the fan-out work as part of Phase 8. Until then, one worker
is the supported shape, and saying so is better than a config that appears to
scale and quietly drops alerts.

### Health and observability

- Liveness: `GET /api/health` — includes a `SELECT 1`, so it detects a dead
  database, not just a dead event loop.
- Integration state: `GET /api/system/capabilities` (bearer; returns booleans and
  names, never secrets).
- The backend image carries a `HEALTHCHECK`; compose and Swarm will restart a
  container that stops passing it.
- Every request logs one JSON line with `request_id`, `status_code`,
  `duration_ms`. `/api/auth/login` is skipped so credentials never reach a log.
- Every authentication, authorisation and configuration change writes an
  `audit_logs` row on its own database session, so it survives the rollback of the
  request that failed.

### Rollback

Migrations are forward-only in CI, but every revision ships a working
`downgrade` (batch-mode on SQLite). To roll back: stop the app, `alembic upgrade
-1`, redeploy the previous image. Never hand-edit a schema in a running database —
that is how `alembic check` starts failing for reasons nobody can explain.
