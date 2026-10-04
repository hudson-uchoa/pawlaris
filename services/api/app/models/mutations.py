from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    DateTime,
    Text,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class AppliedMutation(Base):
    __tablename__ = "applied_mutation"
    client_mutation_id: Mapped[UUID] = mapped_column(primary_key=True)
    family_id: Mapped[UUID] = mapped_column(nullable=False)
    user_id: Mapped[UUID] = mapped_column(nullable=False)
    entity: Mapped[str] = mapped_column(Text(), nullable=False)
    entity_id: Mapped[UUID] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
