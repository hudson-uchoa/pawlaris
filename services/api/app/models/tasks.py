from datetime import date, datetime
from uuid import UUID

from pydantic import JsonValue
from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    FetchedValue,
    ForeignKey,
    Index,
    Integer,
    Text,
    Uuid,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class TaskTemplate(Base):
    __tablename__ = "task_template"
    __mapper_args__ = {"eager_defaults": True}
    __table_args__ = (
        CheckConstraint("length(title) BETWEEN 1 AND 80", name="task_template_check_0"),
        CheckConstraint(
            "timer_seconds IS NULL OR timer_seconds BETWEEN 1 AND 86400",
            name="task_template_check_1",
        ),
        CheckConstraint("cardinality(pet_ids) >= 1", name="task_template_check_2"),
        Index("task_template_family_rev", "family_id", "revision"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True)
    family_id: Mapped[UUID] = mapped_column(ForeignKey("family.id"), nullable=False)
    title: Mapped[str] = mapped_column(Text(), nullable=False)
    description: Mapped[str | None] = mapped_column(Text(), nullable=True)
    category: Mapped[str] = mapped_column(
        Enum(
            "feeding",
            "medication",
            "hygiene",
            "litter",
            "play",
            "vet",
            "other",
            name="task_category",
        ),
        nullable=False,
        server_default=text("'other'"),
    )
    assigned_to: Mapped[UUID | None] = mapped_column(
        ForeignKey("app_user.id"), nullable=True
    )
    requires_photo: Mapped[bool] = mapped_column(
        Boolean(), nullable=False, server_default=text("false")
    )
    timer_seconds: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    reminder_class: Mapped[str] = mapped_column(
        Enum("critical", "routine", name="reminder_class"),
        nullable=False,
        server_default=text("'routine'"),
    )
    sort_order: Mapped[int] = mapped_column(
        Integer(), nullable=False, server_default=text("0")
    )
    recurrence: Mapped[dict[str, JsonValue]] = mapped_column(JSONB(), nullable=False)
    times_of_day: Mapped[list[str]] = mapped_column(
        ARRAY(Text()), nullable=False, server_default=text("'{}'")
    )
    starts_on: Mapped[date] = mapped_column(Date(), nullable=False)
    pet_ids: Mapped[list[UUID]] = mapped_column(ARRAY(Uuid()), nullable=False)
    completion_mode: Mapped[str] = mapped_column(
        Enum("together", "per_pet", name="completion_mode"),
        nullable=False,
        server_default=text("'together'"),
    )
    ends_on: Mapped[date | None] = mapped_column(Date(), nullable=True)
    replaces_task_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("task_template.id"), nullable=True
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


class TaskCompletion(Base):
    __tablename__ = "task_completion"
    __mapper_args__ = {"eager_defaults": True}
    __table_args__ = (
        CheckConstraint(
            "occurrence_key ~ '^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2})?$'",
            name="task_completion_check_0",
        ),
        Index(
            "task_completion_live",
            "task_id",
            "occurrence_key",
            "pet_id",
            unique=True,
            postgresql_nulls_not_distinct=True,
            postgresql_where=text("undone_at IS NULL"),
        ),
        Index("task_completion_family_rev", "family_id", "revision"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True)
    family_id: Mapped[UUID] = mapped_column(ForeignKey("family.id"), nullable=False)
    task_id: Mapped[UUID] = mapped_column(
        ForeignKey("task_template.id"), nullable=False
    )
    occurrence_key: Mapped[str] = mapped_column(Text(), nullable=False)
    pet_id: Mapped[UUID | None] = mapped_column(ForeignKey("pet.id"), nullable=True)
    completed_by: Mapped[UUID] = mapped_column(
        ForeignKey("app_user.id"), nullable=False
    )
    completed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    title_snapshot: Mapped[str] = mapped_column(Text(), nullable=False)
    photo_asset_id: Mapped[UUID | None] = mapped_column(nullable=True)
    note: Mapped[str | None] = mapped_column(Text(), nullable=True)
    undone_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    undone_by: Mapped[UUID | None] = mapped_column(
        ForeignKey("app_user.id"), nullable=True
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


class TaskTimer(Base):
    __tablename__ = "task_timer"
    __mapper_args__ = {"eager_defaults": True}
    __table_args__ = (
        CheckConstraint(
            "occurrence_key ~ '^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2})?$'",
            name="task_timer_check_0",
        ),
        CheckConstraint("ends_at > started_at", name="task_timer_check_1"),
        Index("task_timer_family_rev", "family_id", "revision"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True)
    family_id: Mapped[UUID] = mapped_column(ForeignKey("family.id"), nullable=False)
    task_id: Mapped[UUID] = mapped_column(
        ForeignKey("task_template.id"), nullable=False
    )
    occurrence_key: Mapped[str] = mapped_column(Text(), nullable=False)
    pet_id: Mapped[UUID | None] = mapped_column(ForeignKey("pet.id"), nullable=True)
    started_by: Mapped[UUID] = mapped_column(ForeignKey("app_user.id"), nullable=False)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    cancelled_at: Mapped[datetime | None] = mapped_column(
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
