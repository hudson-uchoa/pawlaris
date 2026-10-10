import asyncio
from datetime import timedelta

from sqlalchemy import delete, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import Clock
from app.db import transactional
from app.locks import lock_family
from app.models import (
    Asset,
    Family,
    HealthEvent,
    InviteCode,
    Pet,
    RefreshToken,
    TaskCompletion,
)
from app.storage.base import StorageAdapter


async def run_maintenance(
    session: AsyncSession, clock: Clock, storage: StorageAdapter
) -> None:
    async def prune() -> list[str]:
        for family_id in await session.scalars(select(Family.id).order_by(Family.id)):
            await lock_family(session, family_id)
        now = clock.now()
        cutoff = now - timedelta(days=30)
        keys = list(
            await session.scalars(
                update(Asset)
                .where(
                    Asset.deleted_at.is_(None),
                    Asset.created_at < cutoff,
                    ~select(Pet.id).where(Pet.avatar_asset_id == Asset.id).exists(),
                    ~select(HealthEvent.id)
                    .where(HealthEvent.attachment_asset_id == Asset.id)
                    .exists(),
                    ~select(TaskCompletion.id)
                    .where(TaskCompletion.photo_asset_id == Asset.id)
                    .exists(),
                )
                .values(deleted_at=now)
                .returning(Asset.storage_key)
            )
        )
        await _prune_refresh_tokens(session, clock)
        await session.execute(
            delete(InviteCode).where(
                or_(InviteCode.used_at < cutoff, InviteCode.expires_at < cutoff)
            )
        )
        return keys

    keys = await transactional(session, prune)
    # A rolled-back sweep must leave the files available to live rows.
    for key in keys:
        await asyncio.to_thread(storage.delete, key)


async def _prune_refresh_tokens(session: AsyncSession, clock: Clock) -> None:
    # Q-19: detach retained children before pruning their expired parents.
    cutoff = clock.now() - timedelta(days=30)
    expired = select(RefreshToken.id).where(RefreshToken.expires_at < cutoff)
    await session.execute(
        update(RefreshToken)
        .where(RefreshToken.parent_id.in_(expired))
        .values(parent_id=None)
    )
    await session.execute(delete(RefreshToken).where(RefreshToken.expires_at < cutoff))
