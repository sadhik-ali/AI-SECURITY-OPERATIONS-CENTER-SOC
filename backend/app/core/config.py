"""Runtime configuration, loaded from environment variables only."""
from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "AI SOC"
    version: str = "0.1.0"
    environment: Literal["dev", "prod"] = "dev"
    mode: Literal["demo", "integrated"] = "demo"

    secret_key: str = Field(min_length=16)
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 480

    database_url: str = "sqlite:///./ai_soc.db"
    db_echo: bool = False

    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    max_request_bytes: int = 1_048_576
    login_rate_limit_attempts: int = 10
    login_rate_limit_window_seconds: int = 300
    ingestion_rate_limit_per_minute: int = 600

    demo_seed_on_startup: bool = True
    bootstrap_admin_email: str = "admin@aisoc.dev"
    bootstrap_admin_password: str = "SocDemo!23"

    ollama_enabled: bool = True
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "llama3.1:8b-instruct"
    ollama_timeout_seconds: float = 60.0

    opensearch_enabled: bool = False
    opensearch_url: str = "https://localhost:9200"
    opensearch_username: str = ""
    opensearch_password: str = ""
    opensearch_index: str = "ai-soc-events-*"
    opensearch_verify_tls: bool = True
    opensearch_timeout_seconds: float = 10.0

    wazuh_enabled: bool = False
    wazuh_api_url: str = ""
    wazuh_api_user: str = ""
    wazuh_api_password: str = ""
    # Shared secret the Wazuh integration must send in X-AI-SOC-Ingest-Token.
    wazuh_ingest_token: str = ""

    @field_validator("cors_origins")
    @classmethod
    def _origins_not_empty(cls, value: str) -> str:
        return value or ""

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


_DEV_SECRET = "dev-only-insecure-secret-change-me"


@lru_cache
def get_settings() -> Settings:
    settings = Settings()  # type: ignore[call-arg]
    if settings.environment == "prod" and settings.secret_key == _DEV_SECRET:
        raise RuntimeError("SECRET_KEY is the development placeholder; refusing to start.")
    if settings.environment == "prod" and not settings.opensearch_verify_tls:
        raise RuntimeError("TLS verification cannot be disabled in production.")
    return settings
