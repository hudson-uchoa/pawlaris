from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
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
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Pet(Base):
    __tablename__ = "pet"
    __mapper_args__ = {"eager_defaults": True}
    __table_args__ = (
        CheckConstraint("length(name) BETWEEN 1 AND 40", name="pet_check_0"),
        Index("pet_family_rev", "family_id", "revision"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True)
    family_id: Mapped[UUID] = mapped_column(ForeignKey("family.id"), nullable=False)
    name: Mapped[str] = mapped_column(Text(), nullable=False)
    species: Mapped[str] = mapped_column(
        Enum("cat", "dog", name="species"), nullable=False
    )
    sex: Mapped[str] = mapped_column(
        Enum("female", "male", "unknown", name="pet_sex"),
        nullable=False,
        server_default=text("'unknown'"),
    )
    breed: Mapped[str | None] = mapped_column(Text(), nullable=True)
    color: Mapped[str | None] = mapped_column(Text(), nullable=True)
    birthdate: Mapped[date | None] = mapped_column(Date(), nullable=True)
    microchip_id: Mapped[str | None] = mapped_column(Text(), nullable=True)
    avatar_asset_id: Mapped[UUID | None] = mapped_column(nullable=True)
    notes: Mapped[str | None] = mapped_column(Text(), nullable=True)
    sort_order: Mapped[int] = mapped_column(
        Integer(), nullable=False, server_default=text("0")
    )
    archived_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_by: Mapped[UUID] = mapped_column(ForeignKey("app_user.id"), nullable=False)
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


class WeightEntry(Base):
    __tablename__ = "weight_entry"
    __mapper_args__ = {"eager_defaults": True}
    __table_args__ = (
        CheckConstraint(
            "weight_kg > 0 AND weight_kg < 120", name="weight_entry_check_0"
        ),
        Index("weight_entry_family_rev", "family_id", "revision"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True)
    family_id: Mapped[UUID] = mapped_column(ForeignKey("family.id"), nullable=False)
    pet_id: Mapped[UUID] = mapped_column(ForeignKey("pet.id"), nullable=False)
    weight_kg: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    measured_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    note: Mapped[str | None] = mapped_column(Text(), nullable=True)
    created_by: Mapped[UUID] = mapped_column(ForeignKey("app_user.id"), nullable=False)
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


class HealthEvent(Base):
    __tablename__ = "health_event"
    __mapper_args__ = {"eager_defaults": True}
    __table_args__ = (
        CheckConstraint("length(title) BETWEEN 1 AND 80", name="health_event_check_0"),
        Index("health_event_family_rev", "family_id", "revision"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True)
    family_id: Mapped[UUID] = mapped_column(ForeignKey("family.id"), nullable=False)
    pet_id: Mapped[UUID] = mapped_column(ForeignKey("pet.id"), nullable=False)
    type: Mapped[str] = mapped_column(
        Enum(
            "vaccine",
            "medication",
            "vet_visit",
            "symptom",
            "procedure",
            "other",
            name="health_event_type",
        ),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(Text(), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text(), nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    next_due_on: Mapped[date | None] = mapped_column(Date(), nullable=True)
    attachment_asset_id: Mapped[UUID | None] = mapped_column(nullable=True)
    created_by: Mapped[UUID] = mapped_column(ForeignKey("app_user.id"), nullable=False)
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
