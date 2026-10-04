from uuid import UUID

from sqlalchemy import BigInteger, Boolean, CheckConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class FamilyRevision(Base):
    __tablename__ = "family_revision"
    family_id: Mapped[UUID] = mapped_column(primary_key=True)
    value: Mapped[int] = mapped_column(
        BigInteger(), nullable=False, server_default=text("0")
    )


class ServerMeta(Base):
    __tablename__ = "server_meta"
    __table_args__ = (CheckConstraint("id", name="server_meta_check_0"),)
    id: Mapped[bool] = mapped_column(
        Boolean(), primary_key=True, server_default=text("true")
    )
    sync_epoch: Mapped[UUID] = mapped_column(nullable=False)
