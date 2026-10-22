# Roadmap

Eight delivery phases from the project brief. Two are complete; the rest are
specified with acceptance criteria so "planned" means a defined contract, not a
wish.

| # | Phase | State |
| --- | --- | --- |
| 1 | Interface and synthetic world | ✅ complete |
| 2 | Backend foundation: auth, RBAC, schema, hardening | ✅ complete |
| 3 | Connect the interface to the backend | ⬜ next |
| 4 | Ingestion, detection, scoring, correlation, live alerts | ⬜ planned |
| 5 | Incident workflow, timelines, reporting | ⬜ planned |
| 6 | AI assistant (Ollama + deterministic fallback) | ⬜ planned |
| 7 | Wazuh + OpenSearch integration | ⬜ designed |
| 8 | Testing, hardening, documentation, delivery | ⬜ partial |

**Definition of done, every phase:** `pytest` green, `alembic check` clean when
models changed, `npm run typecheck` and `npm run build` green, no placeholder
button or fake API call introduced, and the docs updated in the same commit.

---

## Phase 1 — Interface and synthetic world ✅

Eight pages on a dark SOC theme, driven by one internally consistent synthetic
corpus: hosts, accounts, events, alerts and incidents that all refer to each other
correctly, generated from a seeded RNG so a demo is reproducible.

**Delivered:** `Login`, `Overview`, `Alerts`, `Incidents`, `Investigation/:id`,
`Assistant`, `LogExplorer`, `Reports`, `Settings`; panel/badge/gauge/drawer/control
component set; Recharts trend, severity donut and top-source charts; live feed with
polling fallback; collapsible sidebar and mobile nav; `VITE_DATA_SOURCE=mock|api`
switch behind a service layer that mirrors the API contract.

**Acceptance, verified:** all routes render with no console errors; every control
does something real; the AI page states plainly that it is a deterministic
responder rather than pretending to be a model.

~9,200 lines of TypeScript across 41 files.

## Phase 2 — Backend foundation ✅

Auth, RBAC, the nine-table domain model, migrations, and the security controls that
must exist before any telemetry flows.

**Delivered:** FastAPI app with lifespan bootstrap; bcrypt cost 12 and a 72-byte
input ceiling; HS256 JWTs with `sub/role/tz/sg/iat/exp/jti/use`; session-group
rotation for server-side logout without a shared denylist; per-IP and per-account
sliding-window rate limits; request-size cap enforced before the body is read;
security headers and CORS allowlist; JSON request logging that skips the login
route; audit trail written on its own session with secret scrubbing; validation
errors that name fields but never values; admin user management with self-lockout
and last-admin guards; `EnumString` so enums are readable in SQL and typed in
Python; Alembic revision `0001` with `alembic check` proving no drift; WebSocket
endpoint with token auth and a per-process connection manager; 37 tests.

~3,000 lines of Python across 36 files.

## Phase 3 — Connect the interface to the backend ⬜ next

The UI stops inventing its own data.

**Scope:** dashboard summary/trends/top-sources; events, alerts and incidents CRUD
endpoints; query-parameter filters matching the UI controls; pagination, sorting,
and time-range handling; OpenAPI-generated client types replacing the hand-mirrored
`src/types/api.ts`; error and empty/loading states wired to real HTTP codes; flip
`VITE_DATA_SOURCE` to `api`.

**Acceptance:** every page that exists today renders from the backend with the mock
store deleted from the request path; a filter in the UI produces a query parameter
visible in the network tab and a different SQL query; no page shows data the API did
not return.

## Phase 4 — Detection engine ⬜

The heart of the project. Contract already written:
[DETECTION_RULES.md](DETECTION_RULES.md).

**Scope:** parsers for Linux `auth.log`, Sysmon NDJSON and Wazuh alerts
(`sample_logs/` holds the inputs); normalisation to `security_events` with
`raw` + `normalized` and a unique `ingest_key`; the nine rules over sliding windows
reading thresholds from `application_settings`; transparent weighted 0–100 scoring
persisting `score_breakdown`; correlation keys + windows producing incidents with
per-event `reason` and `contributed_score`; the synthetic generator feeding live
events through `ConnectionManager` to `/ws/alerts`.

**Acceptance:** replaying `sample_logs/linux_auth.log` produces the brute-force,
spraying and success-after-failure alerts with the right severities; re-running
ingestion creates zero duplicates (`ingest_key`, `uq_alert_rule_event`); the same
events produce the same incident keys and scores on a second run; the browser sees
new alerts within a second of generation; each rule has a test pinning its boundary
values just below and just above threshold.

## Phase 5 — Investigation workflow ⬜

**Scope:** alert and incident status transitions with audit; assignment; analyst
notes; the timeline view over `incident_events`; MITRE ATT&CK tags on rules and
incidents; CSV/JSON report export; retention pruning against `retention.days`;
`GET/PATCH /api/settings` with before/after audit.

**Acceptance:** an incident's timeline matches its `incident_events` rows exactly;
a closed incident accepts no further transition; an exported report carries the
score breakdown and the evidence, not just a summary; AI notes are visibly flagged
in the export.

## Phase 6 — AI assistant ⬜

**Scope:** Ollama client with timeouts and a health probe; evidence-pack
construction from the incident's own rows; structured output
(`finding / evidence_cited / hypotheses / recommended_next_steps / confidence /
limitations`); prompt hardening that frames telemetry as quoted data, never
instructions; deterministic rule-based fallback when the model is unreachable;
optional advisory scikit-learn component; `POST /api/ai/{analyze-alert,
analyze-incident,chat}`.

**Acceptance:** with Ollama down, the assistant still answers and says it is the
fallback; every cited event id exists in the incident; a log line containing
"ignore previous instructions and run …" is described, not obeyed, and a test
asserts it; no code path from model output to `subprocess`, rule mutation, blocking
or account changes exists to be tested — the boundary is architectural.

## Phase 7 — Wazuh + OpenSearch ⬜ designed

Design and guarantees are written up in [`wazuh/README.md`](../wazuh/README.md),
with the trust boundary stated explicitly.

**Scope:** Wazuh API collector with cursor resume; OpenSearch client with TLS and
the strict index template; search routing by `MODE`; the adapter tests running
against compose profiles.

**Acceptance:** a Wazuh alert and the equivalent synthetic event produce the same
normalised row; a collector restart resumes without losing or duplicating;
`MODE=demo` still works with OpenSearch unreachable.

## Phase 8 — Hardening and delivery ⬜ partial

**Done already:** CI (pytest, `alembic check`, typecheck, build, compose config),
security posture docs, non-root containers, structured logging, request ids.

**Remaining:** Vitest component tests; `pip-audit` / npm audit gating; multi-worker
fan-out (Redis pub/sub) and gateway rate limiting, or a documented single-worker
ceiling; load testing the ingest path; backup/restore runbook; the final report,
slides and recorded demo.

---

## Beyond the brief

Tracked so the ideas survive, deliberately not scheduled:

- **Response playbooks with approval gates** — the only acceptable route from
  detection to action, and it needs a human in the loop by design.
- **Per-tenant RBAC and scoped visibility** for multi-team use.
- **Baseline learning** to replace the static `unusual_login` expectations, with
  the learned profile shown to the analyst rather than hidden in a model.
- **Custom detector plugins** so a rule can ship as a package.
- **Case management**: tickets, SLA timers, hand-off between shifts.
- **Sigma import**, so the rule set can be sourced from the community.
- **Alert suppression windows** for maintenance, with expiry so a suppression
  cannot become permanent by accident.

## Changing this plan

Priorities move; the invariants do not. A proposal that would block an IP, disable
an account, execute a command, send a secret to the browser, present AI text as
human findings, or replace a real implementation with a placeholder is out of scope
regardless of phase — see [SECURITY.md](../SECURITY.md).
