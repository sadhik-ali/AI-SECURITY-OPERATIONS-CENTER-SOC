"""Request/response models for authentication and users."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.core.security import MAX_PASSWORD_BYTES
from app.models.enums import Role

TIMEZONE_PATTERN = "UTC or an IANA name such as Asia/Kolkata"


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)

    @field_validator("password")
    @classmethod
    def _within_hasher_limit(cls, value: str) -> str:
        if len(value.encode("utf-8")) > MAX_PASSWORD_BYTES:
            raise ValueError(f"Password must not exceed {MAX_PASSWORD_BYTES} bytes.")
        return value


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: EmailStr
    full_name: str
    role: Role
    is_active: bool
    preferred_timezone: str
    last_login_at: datetime | None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime
    user: UserOut


class LogoutResponse(BaseModel):
    logged_out: bool
    message: str


class UserCreateRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=10, max_length=128)
    full_name: str = Field(min_length=1, max_length=200)
    role: Role = Role.ANALYST
    preferred_timezone: str = Field(default="UTC", max_length=64)

    @field_validator("preferred_timezone")
    @classmethod
    def _valid_timezone(cls, value: str) -> str:
        from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError(f"preferred_timezone must be an IANA zone name ({TIMEZONE_PATTERN}).") from exc
        return value

    @field_validator("password")
    @classmethod
    def _within_hasher_limit(cls, value: str) -> str:
        if len(value.encode("utf-8")) > MAX_PASSWORD_BYTES:
            raise ValueError(f"Password must not exceed {MAX_PASSWORD_BYTES} bytes.")
        return value


class RoleChangeRequest(BaseModel):
    role: Role


class ActiveChangeRequest(BaseModel):
    is_active: bool


class TimezoneChangeRequest(BaseModel):
    preferred_timezone: str = Field(min_length=1, max_length=64)

    @field_validator("preferred_timezone")
    @classmethod
    def _valid_timezone(cls, value: str) -> str:
        from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("preferred_timezone must be an IANA zone name.") from exc
        return value


class PasswordChangeRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=10, max_length=128)

    @field_validator("new_password")
    @classmethod
    def _within_hasher_limit(cls, value: str) -> str:
        if len(value.encode("utf-8")) > MAX_PASSWORD_BYTES:
            raise ValueError(f"Password must not exceed {MAX_PASSWORD_BYTES} bytes.")
        return value


class UserPage(BaseModel):
    items: list[UserOut]
    total: int
    page: int
    pages: int
