from typing import Annotated, cast
from uuid import UUID

from fastapi import APIRouter, Depends

from app.deps import current_user, require_primary
from app.errors import RESERVE_READ_ONLY_RESPONSE
from app.idempotency import IdempotentMutation, idempotent
from app.routers.auth import Database, RequestClock, User
from app.schemas.family import FamilyPatch, Invite, RoleChange
from app.schemas.rows import Family, Member
from app.services import family

router = APIRouter()
FamilyMutation = Annotated[IdempotentMutation, Depends(idempotent("family"))]
MemberMutation = Annotated[IdempotentMutation, Depends(idempotent("members"))]


@router.patch("/family", response_model=Family)
async def patch_family(body: FamilyPatch, mutation: FamilyMutation) -> Family:
    family.require_leader(mutation.user)
    return cast(
        Family,
        await mutation(
            lambda: family.patch_family(mutation.session, mutation.user, body)
        ),
    )


@router.post(
    "/invites",
    response_model=Invite,
    dependencies=[Depends(current_user), Depends(require_primary)],
    responses={409: RESERVE_READ_ONLY_RESPONSE},
)
async def invite(
    body: RoleChange, user: User, session: Database, clock: RequestClock
) -> Invite:
    family.require_leader(user)
    return await family.create_invite(session, user, body, clock)


@router.patch(
    "/family/members/{user_id}",
    response_model=Member,
    dependencies=[Depends(current_user), Depends(require_primary)],
    responses={409: RESERVE_READ_ONLY_RESPONSE},
)
async def patch_member(
    user_id: UUID, body: RoleChange, mutation: MemberMutation
) -> Member:
    family.require_leader(mutation.user)
    return cast(
        Member,
        await mutation(
            lambda: family.change_role(mutation.session, mutation.user, user_id, body)
        ),
    )


@router.delete(
    "/family/members/{user_id}",
    response_model=Member,
    dependencies=[Depends(current_user), Depends(require_primary)],
    responses={409: RESERVE_READ_ONLY_RESPONSE},
)
async def remove_member(
    user_id: UUID, mutation: MemberMutation, clock: RequestClock
) -> Member:
    family.require_leader(mutation.user)
    return cast(
        Member,
        await mutation(
            lambda: family.remove_member(
                mutation.session, mutation.user, user_id, clock
            )
        ),
    )
