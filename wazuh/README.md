# Wazuh integration

Status: **optional, integrated mode only** (`MODE=integrated`, `WAZUH_ENABLED=true`).
The application is fully usable in demo mode without any of this.

> **Not implemented yet - Phase 7.** This document is the agreed design and the
> acceptance checklist for that phase. `POST /api/events/ingest` does not exist
> in the current build; do not configure a Wazuh `<integration>` block until it
> ships.

## Data flow

```
endpoint agent -> Wazuh manager (alerts.json) -> this API  POST /api/events/ingest
                                                     |-> normalized SecurityEvent row
                                                     |-> OpenSearch index (if enabled)
```

Wazuh never talks to the browser. The API is the only ingress point, and it is
the only component that holds Wazuh credentials.

## Recommended procedure

1. **Do not expose the Wazuh API to the analyst network.** The AI SOC ingests
   *alerts*, so it does not need manager API access at all; leave
   `WAZUH_API_URL` unset unless you intend to poll the manager.
2. **Ship alerts with a file or stream integration**, not by sharing credentials.
   On the Wazuh manager, edit `/var/ossec/etc/ossec.conf`:

   ```xml
   <integration>
     <name>custom-ai-soc</name>
     <hook_url>https://aisoc-backend.internal/api/events/ingest</hook_url>
     <level>5</level>
     <api_key>SHARED_SECRET_FROM_WAZUH_INGEST_TOKEN</api_key>
     <alert_format>json</alert_format>
   </integration>
   ```

3. **Put TLS in front of the endpoint.** Terminate HTTPS on the reverse proxy
   with a real certificate. `X-AI-SOC-Ingest-Token` is sent over that channel;
   it is never accepted over plaintext in production.
4. **Set the shared secret** in the backend environment (`WAZUH_INGEST_TOKEN`).
   Generate it with `openssl rand -hex 32` and keep it out of the repository.
5. **Restart the manager** (`systemctl restart wazuh-manager`) and confirm the
   first delivery with `GET /api/events?page=1&limit=5&source=wazuh`.

## Guarantees the ingestion path enforces

| Requirement | Mechanism |
| --- | --- |
| Authenticate integration requests | Shared-secret header comparison, constant time |
| Validate payloads | Pydantic model per alert shape; malformed bodies are rejected, not stored |
| Normalise fields | `parsers/` maps Wazuh `data.*` onto `src_ip`, `username`, `hostname`, `category` |
| Prevent duplicate ingestion | `ingest_key` is a sha256 over source + timestamp + rule + host + user and is `UNIQUE` |
| Record ingestion errors | Rejected payloads are counted and written to `audit_logs` as `event.ingest_rejected` |
| Rate limiting | `INGESTION_RATE_LIMIT_PER_MINUTE` per source |
| Request-size ceiling | `MAX_REQUEST_BYTES`, enforced before the body is read |

## Trust boundary

`full_log` and every other Wazuh field are **untrusted input**. They are stored
for display, never evaluated, and never interpolated into a shell command, SQL
statement or AI instruction. The AI assistant quotes them as data and is
instructed to ignore any directive that appears inside a log line.
