# backend — FastAPI service

The control plane: authentication, RBAC, the domain model, audit trail, and the
live alert channel. Phases 3–7 add ingestion, detection, correlation, scoring and
the AI client to this package.

```bash
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt   # .venv/bin/ on Linux
cp ../.env.example .env                                        # set SECRET_KEY
.venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000
```

First start creates `ai_soc.db`, applies the schema, and seeds two analysts plus
16 configuration rows — no database server required.

| Path | Owns |
| --- | --- |
| `app/core/` | config, security primitives, rate limiting, logging, middleware |
| `app/api/routes/` | HTTP and WebSocket shape: `auth`, `users`, `system`, `ws` |
| `app/auth/` | bearer decode, session-group check, role guards |
| `app/database/` | engine, session scope, `EnumString`, seeding |
| `app/models/` | the nine tables and the domain enums |
| `app/schemas/` | Pydantic request/response contracts |
| `app/services/` | audit writer, WebSocket broadcaster |
| `alembic/` | migrations; `0001_initial_schema` matches the models |
| `tests/` | 37 tests — auth, RBAC, limits, tokens, banding, FK graph, audit |

```bash
.venv/Scripts/python.exe -m pytest      # tests
.venv/Scripts/alembic.exe check         # models == migration
```

OpenAPI: <http://localhost:8000/docs> · Details:
[docs/API.md](../docs/API.md),
[docs/DATA_MODEL.md](../docs/DATA_MODEL.md),
[docs/DETECTION_RULES.md](../docs/DETECTION_RULES.md)
