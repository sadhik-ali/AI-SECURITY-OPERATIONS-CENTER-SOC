# Contributing

Thanks for taking an interest. This is a security tool with an explicit ethical
position, so a few of the rules below are about what this project will **not**
accept as much as how to send a patch.

Reading time ≈ 6 minutes. Start with
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) to get a running stack.

---

## Ground rules

1. **No placeholders.** Never replace core functionality with a stub button or a
   fake API call. An unimplemented feature is a documented gap in
   [CHANGELOG.md](CHANGELOG.md), not a control that pretends to work.
2. **Indicators, not verdicts.** Detections report suspicious activity that
   requires investigation. Do not word an alert, doc or UI string as though a
   pattern proved malicious intent.
3. **Telemetry is untrusted input.** Log content is never evaluated, never
   interpolated into a shell command or SQL string, and never treated as an
   instruction by the AI assistant — including instructions embedded in a log line.
4. **The AI stays advisory.** No change may create a path from model output to a
   shell, a firewall, an account, or host isolation. AI-generated notes keep
   `ai_generated = true`.
5. **Secrets stay in the environment.** Nothing that looks like a credential goes
   into the browser, a log line, an audit `detail`, a fixture, a screenshot, or a
   commit message. Validation errors name fields, never values.
6. **No plaintext passwords, no disabled TLS verification.** bcrypt at cost 12;
   `OPENSEARCH_VERIFY_TLS=false` is a local development choice and refuses to boot
   under `ENVIRONMENT=prod`.
7. **Explainability is a feature.** If a change makes a risk score harder to
   decompose, it is a regression even when the number improves.

---

## Getting set up

```bash
git clone https://github.com/sadhik-ali/AI-Security-Operations-Center-SOC.git
cd AI-Security-Operations-Center-SOC
cp .env.example backend/.env

cd backend  && python -m venv .venv && .venv/Scripts/python.exe -m pip install -r requirements.txt
cd ../frontend && npm install
```

Verify before you change anything:

```bash
cd backend && .venv/Scripts/python.exe -m pytest      # 37 passed
cd frontend && npm run typecheck && npm run build     # clean
```

If an install fails on a certificate error, read
[the TLS interception note](docs/DEVELOPMENT.md#tls-interception-avast-and-similar).
Trust the intercepting root additionally; do not disable verification.

---

## Where to work

| If you want to… | Look at |
| --- | --- |
| Fix a UI bug | `frontend/src/pages/`, `components/` |
| Add an endpoint | `backend/app/api/routes/`, `app/schemas/` |
| Change the schema | `backend/app/models/models.py` → then a migration |
| Tune a threshold | `application_settings` (Settings page), not code |
| Work on detection | [docs/DETECTION_RULES.md](docs/DETECTION_RULES.md) — Phase 4 |
| Improve docs | `docs/`, and the README sections they expand |

Good first issues are labelled `good-first-issue`. If none are open, pick a
documentation gap or a missing test — both are always real work here.

---

## The workflow

1. **Open an issue first** for anything larger than a typo. Design disagreement is
   cheaper before the code than after the PR.
2. Branch from `master` — `feat/…`, `fix/…`, `docs/…`, `refactor/…`, `test/…`.
3. Make small, focused commits. Imperative subject, no period:
   `fix: redact password from validation errors`
4. Model change → `alembic revision --autogenerate`, **read the generated file**,
   `alembic upgrade head`, `alembic check`.
5. Add or extend a test that would have caught the bug. Boundary values get tested
   on both sides.
6. Run the gates: `pytest`, `alembic check`, `npm run typecheck`, `npm run build`.
7. Update docs in the same commit when behaviour, a setting, or an endpoint moves.
8. Open a PR against the template and tick what you actually verified.

CI must be green before review. If a check fails for a reason unrelated to your
change, say so in the PR rather than re-running until it passes.

---

## Style

**Python** — 4 spaces, 100-column soft limit, `from __future__ import annotations`,
type hints on public functions, Pydantic v2 models at every boundary, SQLAlchemy 2.0
`Mapped[]` style. Keyword-only arguments (`*,`) where a boolean would otherwise sit
in the middle of a call.

**TypeScript** — 2 spaces, explicit types in `src/types/api.ts` mirroring the
backend, no `any` without a comment explaining why, one axios instance, page
components keep data fetching in `services/` and `hooks/`.

**Both** — comments explain *why*, never *what*. A line saying what the next line
does is noise; a line saying why the constraint exists is the reason it survives the
next refactor. No emoji in code, comments, or commit messages.

Naming: `snake_case` in Python, `camelCase` in TS, `PascalCase` for classes and
React components, `SCREAMING_SNAKE` for module constants, and **`snake_case` on the
wire** for every JSON field.

---

## Testing expectations

| Change | Must add or update |
| --- | --- |
| New endpoint | happy path, auth rejection, validation failure, and the audit row it writes |
| Auth or RBAC change | a test that the *wrong* role is refused, and one for each lockout guard |
| Detection rule | boundary pairs: just below and just at threshold |
| Scoring change | the assertion that weights still sum to 100 and bands match config |
| Schema change | a migration, plus `alembic check` passing |
| Bug fix | a test that fails without the fix |

A test that cannot fail is worse than no test — it buys false confidence. Say out
loud in the PR description which behaviours you did **not** verify.

---

## Reporting a vulnerability

Do **not** open a public issue. Follow [SECURITY.md](SECURITY.md). A missing
`await`, a permissive CORS origin, or a token in a log line is a security bug here,
not a good-first-issue.

---

## Review

- Every ticked box in the PR template should be reproducible by the reviewer.
- Feedback is about the code. "This makes the score harder to decompose" beats
  "this is wrong".
- Reviewers check the invariants list at the top before looking at style. Style is
  the cheapest thing to fix; a violated invariant is not.
- Once approved, the author rebases or merges — not the reviewer.

## Licensing

By submitting a patch you confirm you have the right to contribute it and license
it under the project's [MIT License](LICENSE).

---

## Credit

Contributions land in [CHANGELOG.md](CHANGELOG.md). If you helped with something
that does not touch code — a threat-model review, a demo dry-run, a doc fix — say
so on the PR and it will be noted.
