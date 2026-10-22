# Demonstration guide

A ten-minute walkthrough that exercises what is actually built, plus the
verification checklist for a viva or a reviewer. Nothing here asks you to claim
something the software does not do — the honest framing is stronger than the
inflated one, and this project's whole argument is that an analyst should be able
to check a claim.

---

## Before the room arrives

```bash
# terminal 1
cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app --port 8000
# terminal 2
cd frontend && npm run dev
```

Open <http://localhost:5173>, sign in as `analyst@aisoc.dev` / `SocDemo!23`, and
click through Overview → an incident → AI Assistant once. Then sign out and back
in as `admin@aisoc.dev` so the role difference is already familiar.

Have a terminal open at `backend/` with `httpie` or `curl` ready. Close anything
else on port 8000 — check with `netstat -ano | grep 8000` if the API docs do not
appear.

---

## The ten-minute narrative

**1 · The premise (30 s).** "This is a SOC console. It takes security telemetry,
finds patterns in it, groups those patterns into incidents, scores them on a scale
you can take apart, and helps an analyst investigate. The design constraint I held
myself to is that every output is an indicator to be checked, not a verdict to be
trusted."

**2 · Overview (1 min)** — <http://localhost:5173/>. Point at the KPI tiles, then
the events-and-alerts area chart, the severity donut, the top external sources and
most-affected-hosts panels. "Eight monitored assets, 831 events, 22 alerts. The
`DEMO MODE` badge in the top bar is not decoration — it is a standing statement
that this telemetry is synthetic. When it is bound to a backend, the footer says
so instead."

**3 · Live alerts (1 min)** — `/alerts`. Filter by severity, open the detection
queue. "Each row is one rule matching one event, and it carries the reason it
fired, the evidence, and its score breakdown. `false positive` is a first-class
status, because a rule that is always right is a rule nobody can tune."

**4 · Incidents (1 min)** — `/incidents`. Eight cases. "An incident is a group of
alerts and events sharing a correlation key inside a time window. The key is unique
in the database, which is what makes grouping reproducible — I can re-run
correlation over the same events and get the same incidents."

**5 · One investigation (2 min)** — open `INC-2026-0484`, *Credential dumping via
Mimikatz on L-TP-0221*. Walk the header: reference, opened, last update, signals
(1 alert · 3 events). Then the risk gauge: 88/100, severe.

"Composite risk, weighted from severity, blast radius, evidence volume and asset
criticality. The important part is that the weights are configuration —
`scoring.weights` in the settings table, and they sum to exactly 100, which a test
asserts. So this number is arithmetic I can show you, not a model's opinion."

Then the two columns: **Evidence (observed)** versus **Possible explanations**.
"Left is what the telemetry says happened: Sysmon EventID 10, memory access to
lsass.exe with `VM_READ | QUERY_INFORMATION` from an unsigned binary in a
user-writable Downloads path. Right is inference. They are physically separated in
the UI because an analyst reading a merged paragraph cannot tell which sentences
they are supposed to doubt."

Note the analyst note about 802.1x quarantine — "that is a human note. AI notes get
an `ai_generated` flag on the row, so machine text cannot pose as a human finding,
even in an exported report."

**6 · AI assistant (1.5 min)** — `/assistant`. Ask "what should I investigate
first?" "This is a deterministic responder, and the page says so. It reads the
incident's own events and answers with evidence, hypotheses and next steps. When
Ollama is wired up in Phase 6 the same structure comes from the model — but the
boundary does not move: no AI output can change a rule, block an address, disable
an account, or execute a command. Log contents are data to be described, never
instructions to be followed, which matters because prompt injection through a log
line is the obvious attack on an AI SOC."

**7 · Log explorer (1 min)** — `/logs`. Filter by feed, host, account, IP, time.
"Same nine tables the detections read. `raw` holds the original payload verbatim
and `normalized` holds the parser's view, so when a parser changes I can re-run it
and audit the difference."

**8 · Settings (30 s)** — `/settings` as admin. Detection thresholds, scoring
bands, retention, AI provider, integrations. "Retuning brute-force from 5 failures
to 8 is a form field, not a redeploy."

**9 · The backend, live (2 min).** Switch to the terminal:

```bash
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"analyst@aisoc.dev","password":"SocDemo!23"}' | jq -r .access_token)

curl -s http://localhost:8000/api/auth/me -H "Authorization: Bearer $TOKEN"
curl -s "http://localhost:8000/api/users" -H "Authorization: Bearer $TOKEN"
```

"Analyst gets a 403 on `/api/users`. Sign in as admin and it is a 200 — that is
role-based access control enforced server-side in a dependency, not a hidden menu."

```bash
curl -s -X POST http://localhost:8000/api/auth/logout -H "Authorization: Bearer $TOKEN"
curl -s http://localhost:8000/api/auth/me -H "Authorization: Bearer $TOKEN"
```

"401, session signed out. Logout rotates a session group stored on the user, and
every token carries which group minted it — so one query revokes all of a user's
previously issued tokens, across workers, without a denylist that has to be
shared."

```bash
curl -si -X POST http://localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"nobody@aisoc.dev","password":"wrong-password-here"}' | head -1
```

"Identical body and timing whether the account exists or not — unknown users still
pay a bcrypt comparison against a dummy hash, so response time does not leak which
emails are valid."

---

## Verification checklist

Nine checks. Run them in this order; each one is a claim from the README.

| # | Command / action | Expected |
| --- | --- | --- |
| 1 | Delete `ai_soc.db`, start uvicorn | schema created, two users seeded, no error |
| 2 | Sign in as analyst at `:5173` | dashboard renders, no console errors |
| 3 | Open `/incidents/INC-2026-0484` | timeline, evidence, risk gauge with breakdown |
| 4 | Ask the assistant a question | answer cites the incident's own events, evidence separated from hypothesis |
| 5 | Analyst `GET /api/users` → admin same | `403` then `200` |
| 6 | `POST /api/auth/logout`, replay the token | `401 "Session has been signed out."` |
| 7 | Wrong password vs unknown account | byte-identical `401` bodies |
| 8 | `alembic check` | `No new upgrade operations detected.` |
| 9 | `python -m pytest` | `37 passed` |

Then, if the reviewer wants depth:

```bash
grep -c "Invalid user\|authentication failure" ../sample_logs/linux_auth.log
.venv/Scripts/python.exe -m pytest -k "band or weight" -v   # scoring boundaries
```

---

## Questions you will be asked

**"Why is the AI not real yet?"** — Because the phases are ordered so the
deterministic core is finished first. An LLM bolted onto an engine that cannot
explain itself produces confident nonsense. The assistant's contract — evidence,
hypothesis, recommendation, confidence, limitations — is already fixed, so Phase 6
swaps the generator, not the design. And the fallback responder is a feature: the
console still works with no model available.

**"Is the data real?"** — No, and the UI says so in the top bar and the footer.
`sample_logs/` is synthetic in the three formats the Phase 4 parsers will accept,
using RFC 5737 documentation ranges (`203.0.113.x`, `198.51.100.x`) so no real
address appears anywhere.

**"Why SQLite?"** — So a reviewer can clone and run it with no infrastructure.
PostgreSQL is one `docker compose up` away, the same models and the same migration
serve both, and `render_as_batch` plus `EnumString` are what make that possible.

**"How does it scale?"** — One worker per container today, because the rate limiter
and the WebSocket registry are in-process. Getting that wrong would mean silently
dropping alerts, so it is documented instead of hand-waved: gateway limiting and
Redis fan-out are Phase 8. See [DEPLOYMENT.md](DEPLOYMENT.md#scaling).

**"What stops the AI doing something dangerous?"** — Architecture, not prompting.
There is no code path from model output to a shell, a firewall, or a user account.
`ai_generated` marks machine notes; the AI endpoints can read and recommend only.

**"Which rule is most likely to be wrong?"** — `unusual_login`. It needs a
baseline, which is why it stays silent below `min_baseline_events` rather than
inventing an anomaly. The most reliably useful is
`login_after_failures`: a success after a failure run is hard to explain away.

**"Why nine rules?"** — Eight behavioural detections plus configurability as a
rule in its own right. Thresholds live in `application_settings`, so tuning is
data, and a new indicator is a Settings change rather than a deploy.

---

## What to say about what is not built

Do not present Phase 3–7 work as done. The strongest version of this demo is
precise: "the interface and the backend foundation are complete and tested; the
detection engine is next and its contract is written — here is the document." A
reviewer can check that claim in thirty seconds, which is exactly the property the
tool itself is built around.
