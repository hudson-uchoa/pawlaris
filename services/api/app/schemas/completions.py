from uuid import UUID

from pydantic import UUID4, AwareDatetime, Field

from app.schemas.body import RequestBody


class CompletionCreate(RequestBody):
    id: UUID4
    task_id: UUID
    occurrence_key: str = Field(
        pattern=r"^[0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9]{2}:[0-9]{2})?\z"
    )
    pet_id: UUID | None = None
    completed_at: AwareDatetime
    photo_asset_id: UUID | None = None
    note: str | None = None
