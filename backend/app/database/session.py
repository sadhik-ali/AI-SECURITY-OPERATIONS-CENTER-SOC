"""Engine/session lifecycle. SQLite locally, PostgreSQL under Docker."""
from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings

_settings = get_settings()

_connect_args: dict[str, object] = {}
_engine_kwargs: dict[str, object] = {"pool_pre_ping": True, "echo": _settings.db_echo}

if _settings.is_sqlite:
    _connect_args["check_same_thread"] = False
else:
    _engine_kwargs.update({"pool_size": 10, "max_overflow": 20})

engine: Engine = create_engine(
    _settings.database_url,
    connect_args=_connect_args,  # type: ignore[arg-type]
    **_engine_kwargs,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


if _settings.is_sqlite:

    @event.listens_for(engine, "connect")
    def _enable_sqlite_fk(dbapi_connection, connection_record):  # noqa: ANN001, ARG001
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()


def get_db() -> Iterator[Session]:
    """FastAPI dependency: one session per request, always closed."""
    with session_scope() as session:
        yield session


@contextmanager
def session_scope() -> Iterator[Session]:
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
