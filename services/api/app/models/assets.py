from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    DateTime,
    Enum,
    FetchedValue,
    ForeignKey,
    Index,
    Integer,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Asset(Base):
    __tablename__ = "asset"
    __mapper_args__ = {"eager_defaults": True}
    __table_args__ = (Index("asset_family_rev", "family_id", "revision"),)
    id: Mapped[UUID] = mapped_column(primary_key=True)
    family_id: Mapped[UUID] = mapped_column(ForeignKey("family.id"), nullable=False)
    kind: Mapped[str] = mapped_column(
        Enum("pet_avatar", "task_proof", "health_attachment", name="asset_kind"),
        nullable=False,
    )
    storage_key: Mapped[str] = mapped_column(Text(), nullable=False)
    mime: Mapped[str] = mapped_column(Text(), nullable=False)
    bytes: Mapped[int] = mapped_column(Integer(), nullable=False)
    width: Mapped[int] = mapped_column(Integer(), nullable=False)
    height: Mapped[int] = mapped_column(Integer(), nullable=False)
    sha256: Mapped[str] = mapped_column(Text(), nullable=False)
    uploaded_by: Mapped[UUID] = mapped_column(ForeignKey("app_user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
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
