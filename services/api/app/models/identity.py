from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    Enum,
    FetchedValue,
    ForeignKey,
    Index,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import CITEXT
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Family(Base):
    __tablename__ = "family"
    __mapper_args__ = {"eager_defaults": True}
    __table_args__ = (
        CheckConstraint("length(name) BETWEEN 1 AND 60", name="family_check_0"),
        Index("family_rev", "id", "revision"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text(), nullable=False)
    timezone: Mapped[str] = mapped_column(
        Text(), nullable=False, server_default=text("'America/Sao_Paulo'")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    revision: Mapped[int] = mapped_column(
        BigInteger(),
        nullable=False,
        server_default=FetchedValue(),
        server_onupdate=FetchedValue(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=FetchedValue(),
        server_onupdate=FetchedValue(),
    )
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class AppUser(Base):
    __tablename__ = "app_user"
    __mapper_args__ = {"eager_defaults": True}
    __table_args__ = (
        CheckConstraint(
            "length(display_name) BETWEEN 1 AND 40", name="app_user_check_0"
        ),
        Index("app_user_family", "family_id"),
        Index("app_user_family_rev", "family_id", "revision"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True)
    family_id: Mapped[UUID] = mapped_column(ForeignKey("family.id"), nullable=False)
    role: Mapped[str] = mapped_column(
        Enum("leader", "member", name="family_role"),
        nullable=False,
        server_default=text("'member'"),
    )
    email: Mapped[str] = mapped_column(CITEXT(), nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(Text(), nullable=False)
    display_name: Mapped[str] = mapped_column(Text(), nullable=False)
    color: Mapped[str] = mapped_column(Text(), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    disabled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    revision: Mapped[int] = mapped_column(
        BigInteger(),
        nullable=False,
        server_default=FetchedValue(),
        server_onupdate=FetchedValue(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=FetchedValue(),
        server_onupdate=FetchedValue(),
    )
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class RefreshToken(Base):
    __tablename__ = "refresh_token"
    __table_args__ = (Index("refresh_token_chain", "chain_id"),)
    id: Mapped[UUID] = mapped_column(primary_key=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("app_user.id"), nullable=False)
    chain_id: Mapped[UUID] = mapped_column(nullable=False)
    parent_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("refresh_token.id"), nullable=True
    )
    token_hash: Mapped[str] = mapped_column(Text(), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    rotated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )


class InviteCode(Base):
    __tablename__ = "invite_code"
    code: Mapped[str] = mapped_column(Text(), primary_key=True)
    family_id: Mapped[UUID] = mapped_column(ForeignKey("family.id"), nullable=False)
    role: Mapped[str] = mapped_column(
        Enum("leader", "member", name="family_role"), nullable=False
    )
    created_by: Mapped[UUID] = mapped_column(ForeignKey("app_user.id"), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    used_by: Mapped[UUID | None] = mapped_column(
        ForeignKey("app_user.id"), nullable=True
    )


class PushDevice(Base):
    __tablename__ = "push_device"
    __table_args__ = (Index("push_device_user", "user_id"),)
    token: Mapped[str] = mapped_column(Text(), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("app_user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
