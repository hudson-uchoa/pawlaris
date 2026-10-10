import secrets
from collections import Counter
from datetime import timedelta
from uuid import UUID, uuid4

from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.cli import IDENTITY_KEYS
from app.clock import Clock
from app.db import transactional
from app.errors import ApiError
from app.locks import lock_family
from app.models import (
    AppUser,
    Family,
    InviteCode,
    PushDevice,
    RefreshToken,
    TaskTemplate,
)
from app.schemas.auth import Redeem, Session
from app.schemas.family import FamilyPatch, Invite, RoleChange
from app.security.passwords import hash_password
from app.services.auth import _issue_session
from app.settings import Settings


async def patch_family(
    session: AsyncSession, actor: AppUser, body: FamilyPatch
) -> Family:
    require_leader(actor)
    row = await session.get(Family, actor.family_id, populate_existing=True)
    if row is None:
        raise ApiError(404, "not_found", "Family not found.")
    for field in body.model_fields_set:
        setattr(row, field, getattr(body, field))
    return row


async def change_role(
    session: AsyncSession, actor: AppUser, user_id: UUID, body: RoleChange
) -> AppUser:
    require_leader(actor)
    target = await _member(session, actor, user_id)
    if target.disabled_at is not None:
        raise ApiError(404, "not_found", "Member not found.")
    if body.role != "leader":
        await _keep_leader(session, target)
    target.role = body.role
    return target


async def remove_member(
    session: AsyncSession, actor: AppUser, user_id: UUID, clock: Clock
) -> AppUser:
    require_leader(actor)
    target = await _member(session, actor, user_id)
    if target.disabled_at is not None:
        return target
    await _keep_leader(session, target)
    target.disabled_at = clock.now()
    target.email = f"removed+{target.id}@pawlaris.invalid"
    await session.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == target.id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=clock.now())
    )
    await session.execute(delete(PushDevice).where(PushDevice.user_id == target.id))
    await session.execute(
        update(TaskTemplate)
        .where(
            TaskTemplate.family_id == actor.family_id,
            TaskTemplate.assigned_to == target.id,
        )
        .values(assigned_to=None)
    )
    return target


async def create_invite(
    session: AsyncSession, actor: AppUser, body: RoleChange, clock: Clock
) -> Invite:
    async def write() -> Invite:
        await _locked_leader(session, actor)
        while True:
            code = "".join(
                secrets.choice("0123456789ABCDEFGHJKMNPQRSTVWXYZ") for _ in range(10)
            )
            expires_at = clock.now() + timedelta(hours=24)
            claimed = await session.scalar(
                insert(InviteCode)
                .values(
                    code=code,
                    family_id=actor.family_id,
                    role=body.role,
                    created_by=actor.id,
                    expires_at=expires_at,
                )
                .on_conflict_do_nothing()
                .returning(InviteCode.code)
            )
            if claimed is not None:
                return Invite(code=code, role=body.role, expires_at=expires_at)

    return await transactional(session, write)


async def redeem(
    session: AsyncSession, body: Redeem, clock: Clock, settings: Settings
) -> Session:
    async def write() -> Session:
        now = clock.now()
        claimed = (
            await session.execute(
                update(InviteCode)
                .where(
                    InviteCode.code == body.code,
                    InviteCode.used_at.is_(None),
                    InviteCode.expires_at > now,
                )
                .values(used_at=now)
                .returning(InviteCode.family_id, InviteCode.role)
            )
        ).one_or_none()
        if claimed is None:
            raise ApiError(410, "invite_invalid", "Invite is unknown, expired or used.")
        encoded = await hash_password(body.password.get_secret_value())
        family_id, role = claimed
        await lock_family(session, family_id)
        used_colors = Counter(
            await session.scalars(
                select(AppUser.color).where(AppUser.family_id == family_id)
            )
        )
        color = min(IDENTITY_KEYS, key=lambda key: used_colors[key])
        user = AppUser(
            id=uuid4(),
            family_id=family_id,
            role=role,
            email=body.email,
            password_hash=encoded,
            display_name=body.display_name,
            color=color,
            created_at=clock.now(),
        )
        session.add(user)
        await session.flush()
        await session.execute(
            update(InviteCode)
            .where(InviteCode.code == body.code)
            .values(used_by=user.id)
        )
        return await _issue_session(session, user, clock, settings, uuid4(), None)

    try:
        return await transactional(session, write)
    except IntegrityError as exc:
        if (
            getattr(exc.orig, "sqlstate", None) == "23505"
            and getattr(getattr(exc.orig, "__cause__", None), "constraint_name", None)
            == "app_user_email_key"
        ):
            raise ApiError(409, "email_taken", "Email is already registered.") from None
        raise


def require_leader(actor: AppUser) -> None:
    if actor.role != "leader":
        raise ApiError(403, "forbidden", "Only a leader may administer the family.")


async def _locked_leader(session: AsyncSession, actor: AppUser) -> None:
    await lock_family(session, actor.family_id)
    current = await session.get(AppUser, actor.id, populate_existing=True)
    if current is None or current.disabled_at is not None:
        raise ApiError(401, "token_invalid", "Invalid or expired access token.")
    require_leader(current)


async def _member(session: AsyncSession, actor: AppUser, user_id: UUID) -> AppUser:
    target = await session.scalar(
        select(AppUser)
        .where(AppUser.family_id == actor.family_id, AppUser.id == user_id)
        .execution_options(populate_existing=True)
    )
    if target is None:
        raise ApiError(404, "not_found", "Member not found.")
    return target


async def _keep_leader(session: AsyncSession, target: AppUser) -> None:
    if target.role != "leader" or target.disabled_at is not None:
        return
    count = await session.scalar(
        select(func.count())
        .select_from(AppUser)
        .where(
            AppUser.family_id == target.family_id,
            AppUser.role == "leader",
            AppUser.disabled_at.is_(None),
        )
    )
    if count == 1:
        raise ApiError(409, "last_leader", "A family must keep an enabled leader.")
