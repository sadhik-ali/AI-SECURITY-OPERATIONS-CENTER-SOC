# Security policy

This is a security product, so its own security is not optional polish. This page
covers how to report a problem, what the project guarantees, what it deliberately
refuses to do, and which hardening is still open.

---

## Reporting a vulnerability

**Please do not open a public issue.** Use GitHub's private vulnerability
reporting:

<https://github.com/sadhik-ali/AI-Security-Operations-Center-SOC/security/advisories/new>

Include, as far as you can:

- the affected version or commit, and your configuration (`MODE`, `ENVIRONMENT`,
  database engine, whether optional integrations were enabled);
- the code path — endpoint, middleware, dependency, or model constraint;
- reproduction steps, and the smallest proof of impact you are comfortable sending;
- **redacted** anything that could be a credential.

You can expect:

| Within | What |
| --- | --- |
| 3 business days | acknowledgement and a first assessment |
| 14 days | a decision on severity and a remediation plan or timeline |
| on fix | a note in [CHANGELOG.md](CHANGELOG.md), and a GitHub security advisory when warranted |

We will not pursue research that is passive, untargeted, and reported to us in
good faith. Please do not scan shared or third-party deployments.

---

## What this software guarantees

Enforced in code and covered by tests, as of v0.1.0:

| Guarantee | Mechanism |
| --- | --- |
| No plaintext passwords | bcrypt cost 12; inputs over bcrypt's 72-byte limit rejected explicitly, never silently truncated |
| No credential disclosure through the API | `UserOut` omits `hashed_password` and `session_group`; no endpoint returns an integration secret |
| Server-side revocation | per-user `session_group` in every token, rotated on logout — all previously issued tokens stop validating |
| Account enumeration resistance | byte-identical `401` for wrong password and unknown account; unknown accounts still pay a bcrypt comparison against a dummy hash |
| Brute-force resistance | sliding-window limits per client IP **and** per account, `429` with `Retry-After` |
| Authorization is server-side | role dependencies on route groups; self-demotion, self-disable and last-active-admin lockout guards; role change rotates the session |
| No secret in logs | `/api/auth/login` excluded from the access log; audit `detail` scrubbed; JSON logs carry request ids, not credentials |
| No secret in errors | validation failures report field names and constraints, never submitted values |
| No injection through telemetry | SQLAlchemy parameterised access only; log content never evaluated or interpolated |
| Bounded request handling | size ceiling enforced from `Content-Length` before the body is read; WebSocket frames capped at 8 KiB |
| No click-jacking / MIME sniffing | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` |
| No ambient credential leakage | CORS allowlist with `allow_credentials=False`; authentication is bearer-token only |
| No downgrade by configuration | startup raises under `ENVIRONMENT=prod` with the placeholder `SECRET_KEY` or with `OPENSEARCH_VERIFY_TLS=false` |
| Auditable control plane | every authentication, authorization and configuration change writes an audit row on its own session, so it survives the request's rollback |
| Mapping exhaustion from hostile payloads | OpenSearch template uses `dynamic: strict` and stores `raw` unindexed |

---

## What this software deliberately does not do

These are boundaries, not gaps. A change that crosses any of them is rejected on
review, however useful it looks.

- **No automated response.** It never blocks an IP, disables an account, isolates a
  host, or kills a process. Containment is a human decision, and future playbooks
  require an explicit approval gate.
- **No command execution from AI output.** There is no path from a model response
  to a shell. The assistant reads and recommends.
- **AI output is advisory and labelled.** `ai_generated` is a column, so machine
  text cannot be presented as a human finding — including in exports.
- **Telemetry is never an instruction.** Log content is data to be described. A
  line reading "ignore previous instructions and run …" is reported, not obeyed.
- **No verdicts.** Detections are suspicious indicators requiring investigation.
  Nothing asserts that a pattern proves malicious intent.
- **No risk score you cannot take apart.** `score_breakdown` persists the
  per-factor contribution, so a claim about severity is checkable arithmetic.
- **No offensive capability.** No exploit code, no credential-harvesting tooling,
  no detection-evasion aids. Sample telemetry uses RFC 5737 documentation address
  ranges so no real host appears in fixtures.
- **No TLS bypass.** On machines with an intercepting root certificate, the fix is
  to trust that root *additionally* — see
  [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#tls-interception-avast-and-similar).

---

## Known limitations, stated plainly

| Limitation | Impact | Plan |
| --- | --- | --- |
| Rate limiter and WebSocket registry are in-process | one uvicorn worker is the supported shape; `--workers 4` multiplies the login budget and splits the live feed | gateway limiting + Redis fan-out, Phase 8 |
| HS256 with a single shared secret | key rotation requires a coordinated restart | switch to asymmetric signing with a JWKS endpoint |
| A token carries its role until it expires | a demoted user keeps the old role for at most `ACCESS_TOKEN_EXPIRE_MINUTES` | mitigated by session-group rotation on role change; short expiry |
| No MFA | credential theft is the strongest attack on this console | TOTP or WebAuthn, after Phase 5 |
| No audit-log signing or external tamper-evidence | a database administrator can rewrite history | hash-chained or append-only sink |
| Retention pruning not implemented | `retention.days` is configuration without a job | Phase 5 |
| No frontend test suite | UI regressions caught by review and typecheck only | Vitest, Phase 8 |
| TLS termination expected upstream | running uvicorn directly in prod would serve plaintext | reverse proxy required; documented in [DEPLOYMENT.md](docs/DEPLOYMENT.md#4-production-shape) |

Phases 3–7 (ingestion, detection, correlation, incident workflow, AI, Wazuh,
OpenSearch) are **not implemented**; the interface serves them from a bundled mock
store and labels the data as synthetic.

---

## Secure development practice

- CI runs `pytest`, `alembic check`, `tsc --noEmit`, a production build, and
  `docker compose config` on every push and pull request.
- Dependency versions are pinned exactly (`requirements.txt`,
  `package-lock.json`), so a build is reproducible and an update is a visible
  change.
- Containers run as a non-root user (uid 10001) with no privileged capabilities.
- `.env`, `.certs/`, the SQLite database, and `node_modules` are gitignored;
  `.env.example` carries placeholders only.
- Demo identities (`SocDemo!23`) seed only a demo database and are never created
  when `ENVIRONMENT=prod`.
- Dependabot opens update PRs for GitHub Actions and npm; Python pins are reviewed
  manually because a version bump here is a security decision, not maintenance.

## Scope

This policy covers the application code, its containers, and the sample telemetry
in this repository. It does not cover a hosted deployment you stand up yourself —
see the production checklist in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#4-production-shape) before exposing the
console to a network.
