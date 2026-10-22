# Project report scaffold

A chapter-by-chapter outline for the final-year report, with what each section must
argue, roughly how long it should run, and which files in this repository already
contain the evidence. Written so that filling it in is transcription, not invention.

Target: 8,000–12,000 words excluding appendices. Figures numbered per chapter.

---

## Abstract — 250 words

State the problem, the approach, what was built, and what was verified. One sentence
on the ethical position (indicators, not verdicts; no automated response). No
citations, no forward references.

Write this last. If it reads like a list of features, it is too short on the problem.

---

## 1. Introduction — 800–1,200 words

1.1 **Context** — SOC analyst workload, alert fatigue, and the volume problem:
telemetry grows faster than the people reading it.
1.2 **Problem statement** — two failure modes of existing tooling: alerts so noisy
that signal drowns, and scores so opaque that no analyst can defend or tune them.
1.3 **Aims and objectives** — ingest, detect, correlate, score transparently, assist
investigation without automating response.
1.4 **Scope** — what the system observes and what it refuses to do. Be explicit that
detection, correlation and the AI path are specified and phased, not yet executing.
1.5 **Contributions** — the decomposable risk model, the session-group logout
mechanism, the untrusted-telemetry handling, and the documentation-as-contract
approach.
1.6 **Report structure** — one line per chapter.

> Evidence lives in: [README.md](../README.md#why-this-project),
> [ROADMAP.md](ROADMAP.md).

---

## 2. Literature review — 1,200–1,800 words

Cover, with citations:

- **SOC operations and alert triage** — MITRE ATT&CK as a vocabulary; the
  detect/investigate/respond loop; why triage ordering matters more than triage
  count.
- **Signature vs behavioural vs statistical detection** — where deterministic rules
  win (explainability, tunability) and where they lose (novel patterns).
- **Risk scoring in practice** — CVSS as a precedent for a decomposable score;
  why weighted-sum models are auditable and classifier outputs are not.
- **Correlation and case grouping** — correlation keys, sliding windows, the
  false-detection problem in SIEM rules (note the classic research showing most
  production SIEM rules never fire, and most that fire are noise).
- **LLMs in security operations** — summarisation and triage assistance as the
  evidence-backed wins; autonomous response as the contested part; prompt
  injection through untrusted input as the specific risk for this design.
- **Adjacent tools** — Wazuh, TheHive, Elastic SIEM, Splunk. What each does well,
  and the gap this project targets: an open, explainable, academic-scale console
  rather than an enterprise platform.

Close with the gap the project fills. Do not claim novelty you cannot defend;
"combines these properties in one small system that runs without infrastructure" is
a real and defensible claim.

---

## 3. Requirements and analysis — 800–1,200 words

**Functional**, per page and per endpoint — the eight screens, the nine rules,
correlation, scoring, live updates, audit.

**Non-functional**, each with the mechanism that satisfies it:

| Property | Mechanism in this build |
| --- | --- |
| Explainability | `score_breakdown` and `evidence` persisted per alert and incident |
| Security | bcrypt, RBAC, rate limits, session-group revocation, size caps, audit |
| Reliability | polling fallback; idempotent ingestion via `ingest_key` |
| Usability | dark console theme, severity colour semantics, one-glance KPIs |
| Portability | SQLite ↔ PostgreSQL through one model set; demo ↔ integrated mode |
| Maintainability | typed models at every boundary; `alembic check` in CI |
| Testability | 37 backend tests; types mirrored in `src/types/api.ts` |
| Ethics | no automated response; AI advisory and labelled |

Include a use-case or user-story diagram: analyst, admin, and — usefully — the
adversary who writes a log line.

---

## 4. System design — 1,500–2,200 words, the longest chapter

4.1 **Architecture overview** — reproduce the diagram from
[ARCHITECTURE.md](ARCHITECTURE.md#system-overview) as a figure.
4.2 **Two modes, one code path** — why demo and integrated share the detection
logic, and what that buys for validation.
4.3 **Data model** — the ERD from [DATA_MODEL.md](DATA_MODEL.md), plus the reasoning
for unique `correlation_key`, `ingest_key`, and `incident_events.reason`.
4.4 **Detection design** — the nine rules from [DETECTION_RULES.md](DETECTION_RULES.md),
with the sliding-window approach and why thresholds are configuration.
4.5 **Correlation design** — key construction, windows, and re-runnability.
4.6 **Risk scoring design** — the weight table, the bands, and the argument for
arithmetic over classifier output. **Include a worked example**: take one incident
and show each factor's contribution summing to its score.
4.7 **AI integration design** — evidence-pack construction, structured output,
prompt hardening against injection, the deterministic fallback, and the advisory
boundary.
4.8 **Live update design** — WebSocket authentication choice and its consequence
(token in a query string), plus the polling fallback.
4.9 **Security design** — the threat model table from
[ARCHITECTURE.md](ARCHITECTURE.md#threat-model-in-one-screen).

The decisions-and-trade-offs table is the most examinable part of the report. Do not
cut it: "I chose X over Y; the cost is Z; I accept it because of W" is what
distinguishes an engineering report from a feature list.

---

## Chapter 5. Implementation — 1,500–2,000 words

Structure by phase, not by file. For each: the problem, the approach, the one
non-obvious decision, and how it was verified.

Highlights worth their own subsections:

- **`EnumString`** — why `sa.Enum` and bare `String` both fail, and the
  `TypeDecorator` that fixes it. A good small example of a subtle correctness bug.
- **Session-group logout** — revocation across workers without shared state, and
  what it costs (a token carries its role until expiry).
- **Enumeration resistance** — byte-identical 401s and the dummy bcrypt comparison
  for timing parity.
- **Audit on its own session** — why a record of a failure must survive the
  failure's rollback.
- **`render_as_batch`** — making one migration work on both SQLite and PostgreSQL.
- **The synthetic world** — a seeded RNG producing a corpus where incidents, alerts
  and events reference each other consistently, and why that mattered for the UI to
  be honest.
- **Refusing to fake it** — the AI Assistant page as a labelled deterministic
  responder. This is a design decision with an ethics argument attached; give it
  the space.

Code excerpts: 10–25 lines each, no more. A page of pasted code is filler; a
twelve-line excerpt that shows the invariant is evidence.

---

## 6. Testing and evaluation — 1,000–1,500 words

6.1 **Strategy** — unit for primitives, integration over real HTTP, schema drift via
`alembic check`, UI via typecheck plus manual walkthrough.
6.2 **Coverage table** — take the "What the tests protect" table from
[DEVELOPMENT.md](DEVELOPMENT.md#testing).
6.3 **Boundary testing** — the severity band tests at 24.99 / 25 / 49.9 / 50 /
74.9 / 75 / 100; explain why off-by-one bugs in a security score are user-visible.
6.4 **Negative testing** — tampered tokens, foreign-key-signed tokens, expired
tokens, wrong roles, self-lockout, duplicate ingest. Argue that for a security tool
the rejection paths *are* the product.
6.5 **Results** — 37 passed; `alembic check` clean; `tsc --noEmit` clean; CI matrix
on two Python and two Node versions.
6.6 **Evaluation against objectives** — revisit §1.3 and score each honestly,
including the ones Phase 3–7 will satisfy later. A "not yet met, here is the
contract" line is stronger than a vague claim.

If you have time for one measurement, make it a replay: run the nine rules over
`sample_logs/` in Phase 4 and report detections, false positives, and the time each
rule took. Quantitative results are what separate a good grade from a solid one.

---

## 7. Limitations — 500–800 words

Write this chapter; do not let the examiner find the gaps first.

- Phases 3–7 unimplemented: no live detection, no incident endpoints, no Ollama, no
  Wazuh/OpenSearch adapters.
- Per-process rate limiter and WebSocket registry ⇒ single worker supported.
- HS256 with one shared secret; no key rotation without a restart.
- A token carries its role until expiry.
- No MFA; no audit-log tamper-evidence; retention pruning not implemented.
- Demo data is synthetic, so detection quality is unmeasured against real traffic.
- Local-model quality bounds AI usefulness.
- No frontend test suite yet.

For each: why it is a limitation, what it would take to fix, and whether it is
deliberate. The [SECURITY.md](../SECURITY.md#known-limitations-stated-plainly) table
is the source.

---

## 8. Ethical and societal considerations — 400–600 words

Genuinely required for security coursework, and this project has something real to
say:

- **Why no automated response.** A false positive that pages an analyst is an
  annoyance; one that isolates a production host is an outage. Response authority is
  deferred to humans by design, and future playbooks will require an approval gate.
- **Telemetry as untrusted input.** The privacy argument (log content is
  observed-and-not-obeyed) and the security argument (prompt injection through a
  log line) are the same control.
- **Labelling machine text.** `ai_generated` on the note row, surviving into
  exports, because an audit trail cannot distinguish author after the fact.
- **Data hygiene.** RFC 5737 documentation ranges, synthetic personnel names, no
  real telemetry, no credentials in fixtures.
- **Dual use.** Detection logic is defensive; the repository contains no exploit
  code, no credential harvesting, no evasion aids.

---

## 9. Conclusion and future work — 500–700 words

Restate what was built and what was verified. Then the future work list from
[ROADMAP.md](ROADMAP.md#beyond-the-brief), each item with the reason it is next or
the reason it is deliberately deferred.

End with the through-line: an analyst should be able to check every claim the tool
makes. That constraint shaped the score, the wording, the AI boundary, and the
honesty of the gaps.

---

## Appendices

- **A. Installation and demonstration** — condense
  [DEMO.md](DEMO.md); include the nine-step verification checklist.
- **B. API reference** — from [API.md](API.md).
- **C. Detection rule catalogue** — from [DETECTION_RULES.md](DETECTION_RULES.md).
- **D. Database schema** — the ERD plus the generated DDL for both engines.
- **E. Test listing** — test names grouped by what each protects.
- **F. Screenshots** — the eight in `docs/assets/screenshots/`, each with a caption
  naming the route.
- **G. Configuration reference** — from [DEVELOPMENT.md](DEVELOPMENT.md#configuration).

---

## Production notes

**Figures to prepare** (all derivable from what exists): architecture diagram, ERD,
detection pipeline sequence diagram, risk-score decomposition bar chart for one
incident, severity band chart, the eight UI screenshots, CI run screenshot, test
results screenshot.

**Before submission**

- [ ] Every claim in the abstract is either implemented or marked as planned.
- [ ] Every figure is referenced in the text and has a caption.
- [ ] The limitations chapter exists and is not buried at the end of another.
- [ ] `pytest`, `alembic check`, `npm run typecheck`, `npm run build` all pass on
      the machine used for the demo, immediately after the last edit.
- [ ] The demo database is regenerated from a clean clone, so no screenshot in the
      report comes from a state a reviewer cannot reproduce.
- [ ] Repository link works, and the README's status table matches the report.
