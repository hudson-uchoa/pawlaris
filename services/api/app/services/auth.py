import hashlib
import secrets
from datetime import timedelta
from uuid import UUID, uuid4

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import Clock
from app.db import transactional
from app.errors import ApiError
from app.models import AppUser, FamilyRevision, RefreshToken
from app.schemas.auth import Login, Me, MePatch, PasswordChange, Refresh, Session
from app.security.passwords import hash_password, verify_password
from app.security.ratelimit import LoginRateLimiter
from app.security.tokens import issue_access, new_refresh_token
from app.settings import Settings


async def login(
    session: AsyncSession,
    body: Login,
    clock: Clock,
    settings: Settings,
    limiter: LoginRateLimiter,
) -> Session:
    attempt = limiter.check(body.email)

    async def write() -> Session:
        # Discover the family without locking another row; all checks follow its lock.
        family_id = await session.scalar(
            select(AppUser.family_id).where(AppUser.email == body.email)
        )
        user = None
        if family_id is not None:
            await _lock_family(session, family_id)
            user = await session.scalar(
                select(AppUser).where(
                    AppUser.family_id == family_id,
                    AppUser.email == body.email,
                )
            )
        if user is None:
            # Unknown accounts still incur one Argon2 operation off the event loop.
            await hash_password(secrets.token_urlsafe(24))
            valid = False
        else:
            valid = await verify_password(
                body.password.get_secret_value(), user.password_hash
            )
        if user is None or not valid or user.disabled_at is not None:
            raise ApiError(401, "invalid_credentials", "Invalid email or password.")
        return await _issue_session(session, user, clock, settings, uuid4(), None)

    try:
        result = await transactional(session, write)
    except BaseException as exc:
        if not isinstance(exc, ApiError) or exc.code != "invalid_credentials":
            limiter.release(attempt)
        raise
    limiter.success(body.email)
    return result


async def refresh(
    session: AsyncSession, body: Refresh, clock: Clock, settings: Settings
) -> Session:
    async def write() -> Session | ApiError:
        located = await _locate_refresh(session, body)
        if located is None:
            raise _invalid_refresh()
        family_id, digest = located
        await _lock_family(session, family_id)
        pair = (
            await session.execute(
                select(RefreshToken, AppUser)
                .join(AppUser)
                .where(
                    RefreshToken.token_hash == digest,
                    AppUser.family_id == family_id,
                )
            )
        ).one_or_none()
        if pair is None:
            raise _invalid_refresh()
        token, user = pair
        now = clock.now()
        if (
            token.revoked_at is not None
            or token.expires_at <= now
            or user.disabled_at is not None
        ):
            raise _invalid_refresh()
        if token.rotated_at is not None:
            used_child = await session.scalar(
                select(RefreshToken.id)
                .where(
                    RefreshToken.parent_id == token.id,
                    RefreshToken.chain_id == token.chain_id,
                    RefreshToken.rotated_at.is_not(None),
                )
                .limit(1)
            )
            if used_child is not None:
                await session.execute(
                    update(RefreshToken)
                    .where(
                        RefreshToken.chain_id == token.chain_id,
                        RefreshToken.user_id == user.id,
                    )
                    .values(revoked_at=now)
                )
                # Return the error as data so transactional commits the revocation.
                return _invalid_refresh()
        else:
            token.rotated_at = now
        return await _issue_session(
            session, user, clock, settings, token.chain_id, token.id
        )

    result = await transactional(session, write)
    if isinstance(result, ApiError):
        raise result
    return result


async def logout(session: AsyncSession, body: Refresh, clock: Clock) -> None:
    async def write() -> None:
        located = await _locate_refresh(session, body)
        if located is None:
            return
        family_id, digest = located
        await _lock_family(session, family_id)
        pair = (
            await session.execute(
                select(
                    RefreshToken.chain_id,
                    RefreshToken.user_id,
                )
                .join(AppUser)
                .where(
                    RefreshToken.token_hash == digest,
                    AppUser.family_id == family_id,
                )
            )
        ).one_or_none()
        if pair is not None:
            chain_id, user_id = pair
            await session.execute(
                update(RefreshToken)
                .where(
                    RefreshToken.chain_id == chain_id,
                    RefreshToken.user_id == user_id,
                    RefreshToken.revoked_at.is_(None),
                )
                .values(revoked_at=clock.now())
            )

    await transactional(session, write)


async def patch_me(session: AsyncSession, user: AppUser, body: MePatch) -> Me:
    async def write() -> Me:
        enabled = await _locked_user(session, user)
        enabled.display_name = body.display_name
        await session.flush()
        return Me.model_validate(enabled)

    return await transactional(session, write)


async def change_password(
    session: AsyncSession, user: AppUser, body: PasswordChange, clock: Clock
) -> None:
    async def write() -> None:
        enabled = await _locked_user(session, user)
        if not await verify_password(
            body.current_password.get_secret_value(), enabled.password_hash
        ):
            raise ApiError(401, "invalid_credentials", "Invalid email or password.")
        enabled.password_hash = await hash_password(
            body.new_password.get_secret_value()
        )
        await session.execute(
            update(RefreshToken)
            .where(
                RefreshToken.user_id == enabled.id,
                RefreshToken.revoked_at.is_(None),
            )
            .values(revoked_at=clock.now())
        )

    await transactional(session, write)


async def _lock_family(session: AsyncSession, family_id: UUID) -> None:
    # P2-4 extracts the common lock; auth already follows the specified lock order.
    await session.execute(
        select(FamilyRevision.value)
        .where(FamilyRevision.family_id == family_id)
        .with_for_update()
    )


async def _locked_user(session: AsyncSession, user: AppUser) -> AppUser:
    await _lock_family(session, user.family_id)
    enabled = await session.scalar(
        select(AppUser)
        .where(
            AppUser.id == user.id,
            AppUser.family_id == user.family_id,
        )
        .execution_options(populate_existing=True)
    )
    if enabled is None or enabled.disabled_at is not None:
        raise ApiError(401, "token_invalid", "Invalid or expired access token.")
    return enabled


async def _locate_refresh(
    session: AsyncSession, body: Refresh
) -> tuple[UUID, str] | None:
    digest = hashlib.sha256(body.refresh_token.get_secret_value().encode()).hexdigest()
    family_id = await session.scalar(
        select(AppUser.family_id)
        .join(RefreshToken, RefreshToken.user_id == AppUser.id)
        .where(RefreshToken.token_hash == digest)
    )
    return None if family_id is None else (family_id, digest)


def _invalid_refresh() -> ApiError:
    return ApiError(401, "token_invalid", "Invalid or expired refresh token.")


async def _issue_session(
    session: AsyncSession,
    user: AppUser,
    clock: Clock,
    settings: Settings,
    chain_id: UUID,
    parent_id: UUID | None,
) -> Session:
    token, digest = new_refresh_token()
    session.add(
        RefreshToken(
            id=uuid4(),
            user_id=user.id,
            chain_id=chain_id,
            parent_id=parent_id,
            token_hash=digest,
            expires_at=clock.now() + timedelta(days=30),
        )
    )
    await session.flush()
    return Session(
        access_token=issue_access(user, clock, settings),
        refresh_token=token,
        access_expires_at=clock.now() + timedelta(minutes=15),
        user=Me.model_validate(user),
    )
