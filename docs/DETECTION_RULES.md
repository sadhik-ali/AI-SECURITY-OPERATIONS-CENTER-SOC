# Detection rules

> **Status: specified, engine lands in Phase 4.** The nine rules below are the
> contract the detection engine will implement. Their *parameters* already exist
> today — they are seeded into `application_settings` at first start, so the
> thresholds documented here are live configuration rather than a design sketch.

Every rule produces an **alert**, and an alert is an *indicator that requires
investigation*. Nothing in this table blocks an IP, disables an account, isolates
a host, or kills a process. A rule firing is a prompt for a human, not an action.

Each alert carries the fields the spec requires: rule ID, rule name, description,
the matching evidence, event timestamp, the relevant IPs / users / hosts,
severity, risk-score contribution, and recommended investigation steps.

---

## Configuration model

Rules read their parameters from `application_settings`, keyed by rule, so an
admin can retune a threshold in the Settings page without a redeploy.

| Key | Default value | Meaning |
| --- | --- | --- |
| `detection.ssh_brute_force` | `failed_threshold: 5`, `window_seconds: 300` | Failures from one source IP before alerting |
| `detection.password_spraying` | `distinct_accounts_threshold: 4`, `window_seconds: 600` | Distinct accounts touched by one source |
| `detection.login_after_failures` | `min_failures: 3`, `window_seconds: 600` | Success that follows a failure run |
| `detection.unusual_login` | `baseline_days: 14`, `min_baseline_events: 5`, `off_hours: 23:00–06:00` | Deviation from a per-user baseline |
| `detection.port_scan` | `distinct_ports_threshold: 12`, `window_seconds: 120` | Distinct destination ports from one source |
| `detection.privilege_escalation` | `enabled: true` | Privilege / admin-group changes reported by the source |
| `detection.suspicious_process` | 5 indicators (see R8) | Process strings matched against endpoint telemetry |
| `detection.repeated_rule_triggers` | `alert_threshold: 3`, `window_seconds: 900` | Entity accumulating several related alerts |
| `correlation.window_seconds` | `900` | Gap that closes a correlation key |
| `scoring.weights` | sums to exactly 100 | Share of the score per factor |
| `scoring.bands` | `25 / 50 / 75` | Severity boundaries |

A test asserts the weight table still sums to 100, so retuning cannot silently
produce a scoring function that maxes out at 83.

---

## R1 — SSH brute force

**Rule ID:** `detection.ssh_brute_force` · **Severity at default:** high

**Detects:** ≥ `failed_threshold` failed authentications for the same
`source → target host` pair inside `window_seconds`.

**Evidence emitted:** the ordered failure events, distinct usernames attempted,
first and last timestamp, attempt rate, destination port.

**Investigate:** is the source IP ours, a partner's, or noise from the internet?
Did any attempt succeed (that is R3, and it outranks this)? Were the usernames
real? Check whether the same source appears in other incidents.

**False positives:** misconfigured CI runners, a user fat-fingering passwords,
VPN egress IPs shared by many people, vulnerability scanners your own team runs.

---

## R2 — Password spraying

**Rule ID:** `detection.password_spraying` · **Severity:** high

**Detects:** failures from one source IP spanning ≥ `distinct_accounts_threshold`
*different* accounts inside `window_seconds`. Low-and-slow by design: one
password, many users, which is exactly how spraying evades per-account lockouts.

**Evidence emitted:** the account list, per-account attempt counts, the time
span, the user-agent / protocol observed.

**Investigate:** are those accounts in one department or one pattern (first.last)?
Any successes among them? Is the source internal?

**False positives:** help-desk resets, onboarding batches, SSO connectors retrying
a stale credential for many users at once.

---

## R3 — Successful login after failures

**Rule ID:** `detection.login_after_failures` · **Severity:** critical

**Detects:** a success for an account that recorded ≥ `min_failures` failures from
a comparable source within `window_seconds`. This is the highest-priority signal
in the set: the preceding rules describe attempts, this one describes arrival.

**Evidence emitted:** the failure run, the successful event, the session that
opened, and everything that followed it in the next few minutes.

**Investigate:** confirm with the account owner through an out-of-band channel.
Look for post-authentication activity that is unusual for that user (R4, R6, R8).
Check for persistence: new keys, new tokens, scheduled tasks, group membership.

**False positives:** a user who gave up and then remembered the password; MFA
prompts logged as failures before the success.

---

## R4 — Unusual login activity

**Rule ID:** `detection.unusual_login` · **Severity:** medium → high

**Detects:** a login that deviates from the account's own baseline — new source
geolocation or ASN, new device, or activity inside the configured `off_hours`
window — **only when at least `min_baseline_events` observations exist across
`baseline_days`**.

The guard is the point. With thin history there is no baseline, so the rule stays
silent rather than inventing an anomaly. The UI says "insufficient baseline data"
instead of pretending to know.

**Investigate:** travel, a new laptop, a shift change, or a delegated login
service. Compare against the account's historical working hours.

**False positives:** everything a legitimate human does differently this week.
This rule exists to be read alongside others, not to page anyone alone.

---

## R5 — Port scan indicators

**Rule ID:** `detection.port_scan` · **Severity:** medium

**Detects:** ≥ `distinct_ports_threshold` distinct destination ports contacted by
one source IP within `window_seconds`. Sequential, spread, and randomised
port-ordering patterns are all reported; none is required to fire.

**Evidence emitted:** the port list, per-port response state, targets touched,
the rate.

**Investigate:** who owns the source, whether it is an authorised scanner, and
whether anything in the environment responded.

**False positives:** service discovery in container platforms, monitoring probes,
package mirrors fetching many ports, security-vendor research traffic.

---

## R6 — Suspicious privilege escalation

**Rule ID:** `detection.privilege_escalation` · **Severity:** critical

**Detects:** privilege or administrator-group changes *when the event source
reports them* — Linux `sudo` / `usermod` / group membership edits, Windows
`4672` special-privilege logons, `net localgroup` / `net group … /add`, Sysmon
EventID 1 process creation carrying those commands.

**Evidence emitted:** the principal, the privilege or group gained, the parent
process, the timestamp, and the preceding events on that host.

**Investigate:** was there a change ticket? Does this principal normally
administrate anything? What ran as that principal immediately afterwards?

**False positives:** routine IT administration — which is why the alert asks about
authorisation rather than asserting malice.

---

## R7 — Suspicious process activity

**Rule ID:** `detection.suspicious_process` · **Severity:** high

**Detects:** configured process indicators in endpoint telemetry. Defaults:

| Indicator | Why it is on the list |
| --- | --- |
| `mimikatz` | credential extraction tool name |
| `lsass.exe dump` | memory access to the Local Security Authority subsystem |
| `psexesvc` | remote service execution artefact |
| `whoami /priv` | post-compromise privilege reconnaissance |
| `certutil -decode` | living-off-the-land file decoding |

The list is configuration, not code. Adding an indicator is a Settings change.

**Evidence emitted:** process path and command line, parent process, the account
that ran it, the host, and Sysmon identifiers where present.

**False positives:** administration and security tooling use the same binaries.
`certutil` ships with Windows. This rule reports a match; it does not conclude.

---

## R8 — Repeated security rule triggers

**Rule ID:** `detection.repeated_rule_triggers` · **Severity:** high

**Detects:** a single host or source IP accumulating ≥ `alert_threshold` distinct
related alerts within `window_seconds`. This is the meta-rule: any one of R1–R7
can be noise, but several different signals converging on one entity is a
pattern, and it is the pattern that correlation (Phase 4) turns into an incident.

**Evidence emitted:** the contributing alerts with their rules, the entity, and
the timeline.

**Investigate:** read the earliest alert chronologically — that is usually the
entry point — then forward to see what the activity became.

---

## R9 — Configurable custom rules

The ninth requirement is a mechanism rather than a detection. A rule is data:
`DetectionRule` rows carry `rule_id`, name, description, severity, enabled flag,
score contribution, MITRE reference, and investigation steps, and the engine
evaluates the enabled set. Thresholds live in `application_settings`.

That means the eight behavioural detections above can be retuned per environment,
and a new indicator can be added without shipping code — while every alert still
explains which rule produced it and with what evidence.

---

## How alerts become incidents

Correlation runs after detection. Alerts sharing a `correlation_key` — built from
the entities involved, e.g. `src_ip` + `username` + rule family — and falling
within `correlation.window_seconds` of each other are grouped under one incident,
which records `first_event_at` / `last_event_at` and stores, per contributing
event, *why* it was included and what it contributed to the score
(`incident_events.reason`, `incident_events.contributed_score`).

An incident is therefore never an unexplained aggregate: open it and the reasoning
is the data.

---

## Risk scoring, transparently

`risk_score` is 0–100, computed as a weighted sum, never a model's opinion.

| Factor | Weight | What it measures |
| --- | --- | --- |
| Severity of the strongest signal | 35 | highest rule severity in the group |
| Event volume | 15 | how much telemetry backs it |
| Frequency | 12 | how tightly the events cluster in time |
| Success after failure | 18 | did the attempt turn into access |
| Breadth | 12 | distinct hosts / accounts / ports touched |
| Recency | 8 | how close the activity is to now |

Bands, configurable through `scoring.bands`:

| Score | Severity |
| --- | --- |
| 0 – 24 | informational |
| 25 – 49 | low |
| 50 – 74 | high |
| 75 – 100 | critical |

`Alert.score_breakdown` and `Incident.score_breakdown` persist the per-factor
numbers, so the gauge in the UI can be taken apart. "The score is 78 because
severity contributed 31 of 35 and success-after-failure 18 of 18" is a claim you
can check; "the model says high risk" is not.

---

## Deliberate omissions

- **No automated response.** Containment requires a human and, later, an approval
  gate (Phase 5+).
- **No ML classifier in the alert path.** The optional scikit-learn component is
  advisory and can never raise, close, or re-severity an alert.
- **No rule asserts malicious intent.** Wording is "suspicious indicator", always
  paired with evidence and next steps.
- **Log contents are untrusted input.** A command line inside an event is data to
  display. It is never evaluated, never interpolated into a query or shell string,
  and never treated as an instruction by the AI assistant.
