"""FastAPI application entry point."""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.router import api_router
from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger
from app.core.middleware import SecurityMiddleware
from app.database.init_db import bootstrap

log = get_logger("ai_soc.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    configure_logging("WARNING" if settings.environment == "prod" else "INFO")
    log.info(
        "starting AI SOC API",
        extra={"action": "startup", "mode": settings.mode, "database": "sqlite" if settings.is_sqlite else "postgresql"},
    )
    bootstrap()
    yield
    log.info("shutting down AI SOC API", extra={"action": "shutdown"})


settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    version=settings.version,
    description=(
        "AI-Powered Security Operations Center API. Detects suspicious activity in security logs, "
        "correlates alerts into incidents, scores risk transparently, and assists analysts with "
        "evidence-grounded AI explanations. All detections are indicators requiring investigation; "
        "nothing here executes defensive actions."
    ),
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)

app.add_middleware(SecurityMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    # Tokens travel in the Authorization header, so cookie credentials stay off.
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-Id", "X-AI-SOC-Ingest-Token"],
    max_age=600,
)

app.include_router(api_router)


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    """Return field-level problems without echoing submitted values back."""
    return JSONResponse(
        status_code=422,
        content={
            "detail": "Request validation failed.",
            "request_id": getattr(request.state, "request_id", None),
            "errors": [
                {"field": ".".join(str(part) for part in err.get("loc", [])), "message": err.get("msg")}
                for err in exc.errors()
            ],
        },
    )


@app.exception_handler(StarletteHTTPException)
async def http_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "detail": exc.detail,
            "request_id": getattr(request.state, "request_id", None),
        },
        headers=dict(exc.headers or {}),
    )


@app.exception_handler(Exception)
async def unhandled_handler(request: Request, exc: Exception) -> JSONResponse:
    request_id = getattr(request.state, "request_id", None)
    log.exception("unhandled server error", extra={"request_id": request_id, "action": "unhandled"})
    return JSONResponse(
        status_code=500,
        content={
            "detail": "Internal server error. Reference the request id when contacting an administrator.",
            "request_id": request_id,
        },
    )


@app.get("/", tags=["system"], summary="Service banner")
def root() -> dict[str, str]:
    return {
        "service": settings.app_name,
        "version": settings.version,
        "mode": settings.mode,
        "docs": "/docs",
    }
