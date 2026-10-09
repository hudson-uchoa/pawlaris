from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends

from app.idempotency import IdempotentMutation, idempotent
from app.routers.auth import Database, RequestClock, User
from app.schemas.family import FamilyPatch, Invite, RoleChange
from app.schemas.rows import Family, Member

router = APIRouter()
FamilyMutation = Annotated[IdempotentMutation, Depends(idempotent("family"))]
MemberMutation = Annotated[IdempotentMutation, Depends(idempotent("members"))]


@router.patch("/family", response_model=Family)
async def patch_family(body: FamilyPatch, mutation: FamilyMutation) -> Family:
    raise NotImplementedError


@router.post("/invites", response_model=Invite)
async def invite(
    body: RoleChange, user: User, session: Database, clock: RequestClock
) -> Invite:
    raise NotImplementedError


@router.patch("/family/members/{user_id}", response_model=Member)
async def patch_member(
    user_id: UUID, body: RoleChange, mutation: MemberMutation
) -> Member:
    raise NotImplementedError


@router.delete("/family/members/{user_id}", response_model=Member)
async def remove_member(
    user_id: UUID, mutation: MemberMutation, clock: RequestClock
) -> Member:
    raise NotImplementedError
