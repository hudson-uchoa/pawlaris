from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import Clock
from app.models import AppUser, Family
from app.schemas.auth import Redeem, Session
from app.schemas.family import FamilyPatch, Invite, RoleChange
from app.security.passwords import hash_password as hash_password
from app.settings import Settings


async def patch_family(
    session: AsyncSession, actor: AppUser, body: FamilyPatch
) -> Family:
    raise NotImplementedError


async def change_role(
    session: AsyncSession, actor: AppUser, user_id: UUID, body: RoleChange
) -> AppUser:
    raise NotImplementedError


async def remove_member(
    session: AsyncSession, actor: AppUser, user_id: UUID, clock: Clock
) -> AppUser:
    raise NotImplementedError


async def create_invite(
    session: AsyncSession, actor: AppUser, body: RoleChange, clock: Clock
) -> Invite:
    raise NotImplementedError


async def redeem(
    session: AsyncSession, body: Redeem, clock: Clock, settings: Settings
) -> Session:
    raise NotImplementedError
