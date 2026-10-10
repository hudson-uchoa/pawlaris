import json

import pytest
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.schemas.rows import (
    Asset,
    Completion,
    Family,
    HealthEvent,
    Member,
    Pet,
    TaskTemplate,
    Timer,
    Walk,
    WeightEntry,
)
from tests.factories import MakeFamily

SHAPES: tuple[tuple[str, type[BaseModel], str], ...] = (
    ("family", Family, "id name timezone revision updated_at deleted_at"),
    (
        "app_user",
        Member,
        "id display_name role color disabled_at revision updated_at deleted_at",
    ),
    (
        "pet",
        Pet,
        "id name species sex breed color birthdate microchip_id "
        "avatar_asset_id notes sort_order archived_at created_by "
        "revision updated_at deleted_at",
    ),
    (
        "weight_entry",
        WeightEntry,
        "id pet_id weight_kg measured_at note created_by revision "
        "updated_at deleted_at",
    ),
    (
        "health_event",
        HealthEvent,
        "id pet_id type title notes occurred_at next_due_on "
        "attachment_asset_id created_by revision updated_at "
        "deleted_at",
    ),
    (
        "task_template",
        TaskTemplate,
        "id title description category assigned_to requires_photo "
        "timer_seconds reminder_class sort_order recurrence "
        "times_of_day starts_on pet_ids completion_mode ends_on "
        "replaces_task_id created_by revision updated_at "
        "deleted_at",
    ),
    (
        "task_completion",
        Completion,
        "id task_id occurrence_key pet_id completed_by "
        "completed_at title_snapshot photo_asset_id note "
        "undone_at undone_by duplicate_of revision updated_at",
    ),
    (
        "task_timer",
        Timer,
        "id task_id occurrence_key pet_id started_by started_at "
        "ends_at cancelled_at revision updated_at",
    ),
    (
        "walk_session",
        Walk,
        "id pet_id user_id status started_at ended_at paused_ms "
        "distance_m duration_s avg_pace_s_per_km point_count "
        "has_route preview note revision updated_at deleted_at",
    ),
    (
        "asset",
        Asset,
        "id kind mime bytes width height uploaded_by created_at "
        "revision updated_at deleted_at",
    ),
)


@pytest.mark.parametrize("table_name,schema,keys", SHAPES, ids=[s[0] for s in SHAPES])
async def test_row_schema_exact_contract_keys(
    make_family: MakeFamily, table_name: str, schema: type[BaseModel], keys: str
) -> None:
    fam = await make_family()
    engine = create_async_engine(fam.database_url)
    try:
        async with AsyncSession(engine, expire_on_commit=False) as session:
            rows = await fam.make_rows(session)
            await session.commit()
            row = rows[table_name]
            output = json.loads(schema.model_validate(row).model_dump_json())
            assert set(output) == set(keys.split())
            assert output["id"] == str(row.id)
            assert output["revision"] == row.revision
            assert output["updated_at"].endswith("Z")
            assert output.get("deleted_at") is None
            for key in ("weight_kg", "distance_m"):
                if key in output:
                    assert isinstance(output[key], (int, float))
                    assert output[key] == float(getattr(row, key))
            assert not {
                "family_id",
                "email",
                "password_hash",
                "storage_key",
                "sha256",
                "points",
            } & set(output)
    finally:
        await engine.dispose()
