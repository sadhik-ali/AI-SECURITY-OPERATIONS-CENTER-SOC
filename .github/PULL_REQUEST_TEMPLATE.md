## What changes

<!-- One or two sentences: what does this do, and why does it need to exist? -->

Closes #

## How it was verified

<!-- Delete what does not apply. Anything unverified should be said out loud here. -->

- [ ] `cd backend && python -m pytest` — all tests pass
- [ ] `cd backend && alembic check` — no drift between models and migration
- [ ] `cd frontend && npm run typecheck`
- [ ] `cd frontend && npm run build`
- [ ] Exercised in the browser (note which pages/routes)

## Detection / scoring changes?

If this touches `detection/`, `scoring/` or `correlation/`:

- [ ] Thresholds and weights come from `application_settings`, not constants
- [ ] A new or changed rule has a test that pins its boundary values
- [ ] Alerts still show **why** they fired (reason, evidence, score breakdown)
- [ ] Severity bands still match the configured `scoring.bands`

## Security review

- [ ] No secret, token or password appears in code, logs, fixtures or screenshots
- [ ] Log/telemetry content is treated as untrusted data: never evaluated, never
      interpolated into a shell command or SQL string, never an instruction to the model
- [ ] Validation errors report field names, never submitted values
- [ ] Nothing here blocks an IP, disables an account, isolates a host or executes a
      command — including anything an AI model suggested
- [ ] TLS verification is not disabled; `OPENSEARCH_VERIFY_TLS=false` is only ever a
      local development choice

## Notes for the reviewer

<!-- Known limitations, follow-up work, screenshots of UI changes. -->
