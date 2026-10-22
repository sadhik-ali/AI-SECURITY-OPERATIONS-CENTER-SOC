"""Admin-only user and role management."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth.dependencies import require_admin
from app.core.ratelimit import Limit, enforce
from app.core.security import hash_password
from app.database.session import get_db
from app.models.enums import AuditAction, Role
from app.models.models import User
from app.schemas.auth import (
    ActiveChangeRequest,
    RoleChangeRequest,
    UserCreateRequest,
    UserOut,
    UserPage,
)
from app.services.audit import record

router = APIRouter(prefix="/api/users", tags=["users"], dependencies=[Depends(require_admin)])


def _get(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    return user


@router.get("", response_model=UserPage, summary="List users")
def list_users(
    db: Session = Depends(get_db),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    role: Role | None = None,
    is_active: bool | None = None,
) -> UserPage:
    stmt = select(User)
    if role is not None:
        stmt = stmt.where(User.role == role)
    if is_active is not None:
        stmt = stmt.where(User.is_active.is_(is_active))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(User.email).offset((page - 1) * limit).limit(limit)).all()
    return UserPage(
        items=[UserOut.model_validate(u) for u in rows],
        total=total,
        page=page,
        pages=max(1, -(-total // limit)),
    )


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED, summary="Create a user")
def create_user(
    payload: UserCreateRequest,
    request: Request,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> UserOut:
    enforce("user-create", admin.email, Limit(30, 60))
    email = payload.email.lower()
    if db.scalar(select(User).where(User.email == email)) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with that email already exists.",
        )
    user = User(
        email=email,
        hashed_password=hash_password(payload.password),
        full_name=payload.full_name.strip(),
        role=payload.role,
        is_active=True,
        preferred_timezone=payload.preferred_timezone,
        session_group=uuid.uuid4().hex,
    )
    db.add(user)
    db.flush()
    record(
        action=AuditAction.USER_CREATED,
        actor_email=admin.email,
        actor_id=admin.id,
        target=f"user:{user.id}",
        detail={"role": user.role.value},
        source_ip=getattr(request.state, "client_ip", None),
    )
    return UserOut.model_validate(user)


@router.patch("/{user_id}/role", response_model=UserOut, summary="Change a user's role")
def change_role(
    user_id: int,
    payload: RoleChangeRequest,
    request: Request,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> UserOut:
    user = _get(db, user_id)
    if user.id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot change your own role.",
        )
    if user.role is Role.ADMIN and payload.role is not Role.ADMIN:
        remaining = db.scalar(
            select(func.count()).where(User.role == Role.ADMIN, User.is_active.is_(True), User.id != user.id)
        )
        if not remaining:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Refusing to remove the last active administrator.",
            )
    user.role = payload.role
    # A role change must not survive in an already-issued token.
    user.session_group = uuid.uuid4().hex
    db.commit()
    record(
        action=AuditAction.USER_ROLE_CHANGED,
        actor_email=admin.email,
        actor_id=admin.id,
        target=f"user:{user.id}",
        detail={"role": payload.role.value},
        source_ip=getattr(request.state, "client_ip", None),
    )
    return UserOut.model_validate(user)


@router.patch("/{user_id}/active", response_model=UserOut, summary="Enable or disable a user")
def change_active(
    user_id: int,
    payload: ActiveChangeRequest,
    request: Request,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> UserOut:
    user = _get(db, user_id)
    if user.id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot disable your own account.",
        )
    if not payload.is_active and user.role is Role.ADMIN:
        remaining = db.scalar(
            select(func.count()).where(User.role == Role.ADMIN, User.is_active.is_(True), User.id != user.id)
        )
        if not remaining:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Refusing to disable the last active administrator.",
            )
    user.is_active = payload.is_active
    if not payload.is_active:
        user.session_group = uuid.uuid4().hex
    record(
        action=AuditAction.USER_DISABLED if not payload.is_active else AuditAction.USER_ENABLED,
        actor_email=admin.email,
        actor_id=admin.id,
        target=f"user:{user.id}",
        detail={"is_active": payload.is_active},
        source_ip=getattr(request.state, "client_ip", None),
    )
    return UserOut.model_validate(user)
