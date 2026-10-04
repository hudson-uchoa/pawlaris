from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Enum,
    FetchedValue,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class WalkSession(Base):
    __tablename__ = "walk_session"
    __mapper_args__ = {"eager_defaults": True}
    __table_args__ = (Index("walk_session_family_rev", "family_id", "revision"),)
    id: Mapped[UUID] = mapped_column(primary_key=True)
    family_id: Mapped[UUID] = mapped_column(ForeignKey("family.id"), nullable=False)
    pet_id: Mapped[UUID] = mapped_column(ForeignKey("pet.id"), nullable=False)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("app_user.id"), nullable=False)
    status: Mapped[str] = mapped_column(
        Enum("active", "finished", "discarded", name="walk_status"),
        nullable=False,
        server_default=text("'active'"),
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    ended_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    paused_ms: Mapped[int] = mapped_column(
        BigInteger(), nullable=False, server_default=text("0")
    )
    distance_m: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, server_default=text("0")
    )
    duration_s: Mapped[int] = mapped_column(
        Integer(), nullable=False, server_default=text("0")
    )
    avg_pace_s_per_km: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    point_count: Mapped[int] = mapped_column(
        Integer(), nullable=False, server_default=text("0")
    )
    preview: Mapped[list[list[float]]] = mapped_column(
        JSONB(), nullable=False, server_default=text("'[]'")
    )
    has_route: Mapped[bool] = mapped_column(
        Boolean(), nullable=False, server_default=text("false")
    )
    note: Mapped[str | None] = mapped_column(Text(), nullable=True)
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


class WalkRoute(Base):
    __tablename__ = "walk_route"
    walk_id: Mapped[UUID] = mapped_column(
        ForeignKey("walk_session.id"), primary_key=True
    )
    points: Mapped[list[list[float]]] = mapped_column(JSONB(), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
