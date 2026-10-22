# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Phase 3 groundwork: the frontend service layer and `src/types/api.ts` already
  mirror the backend contract, so switching `VITE_DATA_SOURCE` to `api` is a
  transport change rather than a page rewrite.

### Planned
- Detection engine, correlation and risk scoring (Phase 4) — contract in
  [`docs/DETECTION_RULES.md`](docs/DETECTION_RULES.md).
- Dashboard, event, alert and incident endpoints (Phase 3) — contract in
  [`docs/API.md`](docs/API.md#planned).

## [0.1.0] - 2026-10-22

Phases 1 and 2: a working interface on realistic synthetic data, and a working,
tested, hardened backend foundation. Both halves run today with no infrastructure.

### Added — interface (Phase 1)

- Eight pages on a dark SOC theme: **SOC Overview**, **Live Alerts**, **Incident
  Investigation** (list), **Investigation detail**, **AI Assistant**, **Log
  Explorer**, **Reports**, **Settings**, plus **Login**.
- One internally consistent synthetic corpus: hosts, accounts, events, alerts and
  incidents that reference each other correctly, produced by a seeded RNG so a
  demonstration is reproducible across reloads.
- Recharts visualisations: events-and-alerts trend with 12 h / 24 h / 48 h / 3 d
  ranges, severity distribution donut, top external sources, most-affected hosts.
- Component set: `Panel`, `Badge`/`SeverityBadge`/`StatusBadge`, `RiskGauge`,
  `Drawer`, `Input`/`Select`/`Button`/`Toggle`, `Spinner`/`SkeletonRows`/
  `EmptyState`/`ErrorState`/`SplashState`, `ActivityFeed`.
- Live feed abstraction with an automatic polling fallback, so a dropped WebSocket
  degrades to refresh instead of going silently stale.
- Collapsible sidebar, mobile navigation, global search bar, per-user timezone
  display, and a `DEMO MODE` indicator that never hides which data source is
  active.
- `VITE_DATA_SOURCE=mock|api` switch behind a single service layer.
- AI Assistant page implemented as an honest deterministic responder over the
  incident's own evidence, separating *evidence observed* from *possible
  explanations* — no fabricated model calls.
- nginx deployment image with `/api` and `/ws` proxying, SPA fallback, and
  `no-store` on HTML.

### Added — backend (Phase 2)

- FastAPI application with lifespan bootstrap: creates the SQLite schema and seeds
  demo identities and 16 configuration rows on first start, so a clone runs with
  one command.
- Nine SQLAlchemy 2.0 models: `users`, `security_events`, `detection_rules`,
  `alerts`, `incidents`, `incident_events`, `incident_notes`, `audit_logs`,
  `application_settings`, with composite indexes matching the queries the UI runs.
- Alembic revision `0001_initial_schema`; `alembic check` proves models and
  migration cannot drift, and runs in CI.
- Authentication: bcrypt at cost 12 with an explicit 72-byte input ceiling; HS256
  JWTs carrying `sub`, `role`, `tz`, `sg`, `iat`, `exp`, `jti`, `use`.
- **Server-side logout without a shared denylist**: a per-user `session_group`
  baked into every token and rotated on logout, so revocation works across workers
  with one comparison.
- Identical `401` bodies and comparable timing for wrong-password versus
  unknown-account, using a dummy bcrypt comparison for the unknown account.
- RBAC via route dependencies (`require_admin`, `require_analyst`), with
  self-demotion, self-disable and last-active-admin lockout guards; a role change
  rotates the affected user's session group.
- Sliding-window rate limiting per client IP **and** per account, returning `429`
  with `Retry-After`.
- Request-size ceiling enforced from `Content-Length` before the body is read;
  security headers (`nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`);
  CORS allowlist with `allow_credentials=False`.
- Structured JSON logging with `request_id` propagation; `/api/auth/login`
  deliberately excluded from the access log so credentials never reach a log file.
- Security audit trail written on its **own database session**, so a record for a
  failed request survives that request's rollback; secret-shaped keys scrubbed.
- Validation errors that report field names and constraints, never submitted
  values.
- WebSocket `/ws/alerts` authenticated by token, inbound frames capped, only
  `ping` accepted, unauthenticated sockets closed with policy violation `1008`,
  per-process connection manager with stale-socket pruning.
- Startup guards that refuse `ENVIRONMENT=prod` with the placeholder `SECRET_KEY`
  or with TLS verification disabled.
- `GET /api/health` (with a database round-trip), `GET /api/system/capabilities`
  (booleans and names only — no secrets).
- 37 tests across authentication, RBAC, rate limiting, password handling, token
  validation, severity banding, enum persistence, seeded configuration, the full
  foreign-key graph, and duplicate-ingest protection.

### Added — infrastructure and documentation

- `docker-compose.yml`: PostgreSQL 16 with a healthcheck, OpenSearch 2.11.1 behind
  a `search` profile, Ollama behind an `ai` profile, migrations applied before the
  API serves.
- Non-root backend container image (uid 10001) with a healthcheck; multi-stage
  frontend build.
- OpenSearch index template with `dynamic: strict` and `raw` stored unindexed, so
  untrusted telemetry payloads cannot exhaust the mapping budget; `src_ip` /
  `dst_ip` typed as `ip`.
- Synthetic sample telemetry in the three formats the Phase 4 parsers will accept:
  `sample_logs/linux_auth.log`, `sysmon_events.ndjson`, `wazuh_alerts.ndjson`,
  using RFC 5737 documentation address ranges so no real IP appears anywhere.
- Wazuh integration design with an explicit trust boundary
  ([`wazuh/README.md`](wazuh/README.md)), marked not-yet-implemented.
- Documentation set: [architecture](docs/ARCHITECTURE.md),
  [API reference](docs/API.md), [detection rules](docs/DETECTION_RULES.md),
  [data model](docs/DATA_MODEL.md), [development guide](docs/DEVELOPMENT.md),
  [deployment](docs/DEPLOYMENT.md), [roadmap](docs/ROADMAP.md),
  [demonstration guide](docs/DEMO.md),
  [security policy](SECURITY.md), [contributing guide](CONTRIBUTING.md).
- CI: `pytest`, `alembic check`, `tsc --noEmit`, production build, and
  `docker compose config` validation, on Python 3.11/3.13 and Node 20/22.
- `.env.example` documenting the full configuration surface with placeholders only.

### Known limitations

Stated rather than hidden:

- Phases 3–7 are not implemented: no ingestion, no live detection engine, no
  incident workflow endpoints, no Ollama client, no Wazuh or OpenSearch adapters.
  The UI serves these from its bundled mock store and says so.
- The rate limiter and WebSocket registry are per-process, so one uvicorn worker
  is the supported shape; multi-worker deployment needs gateway-level limiting and
  Redis fan-out.
- No frontend test suite yet — Vitest is Phase 8; `npm run typecheck` is the
  current gate.
- Retention pruning is configuration only; the job lands in Phase 5.
- Demo credentials (`SocDemo!23`) seed a demo database and are never created under
  `ENVIRONMENT=prod`.

### Security posture for this release

No endpoint returns a password hash, session group, or integration secret. No code
path executes a command, blocks an address, disables an account, or isolates a
host. Log and telemetry contents are treated as untrusted data throughout: never
evaluated, never interpolated into a shell command or SQL string, never an
instruction to a model. ORM access is parameterised only.

[Unreleased]: https://github.com/sadhik-ali/AI-Security-Operations-Center-SOC/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/sadhik-ali/AI-Security-Operations-Center-SOC/releases/tag/v0.1.0
