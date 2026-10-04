"""PostgreSQL models; importing this package registers every table."""

from app.models.assets import Asset
from app.models.base import Base
from app.models.identity import AppUser, Family, InviteCode, PushDevice, RefreshToken
from app.models.mutations import AppliedMutation
from app.models.pets import HealthEvent, Pet, WeightEntry
from app.models.primitives import FamilyRevision, ServerMeta
from app.models.tasks import TaskCompletion, TaskTemplate, TaskTimer
from app.models.walks import WalkRoute, WalkSession

__all__ = [
    "Base",
    "FamilyRevision",
    "ServerMeta",
    "Family",
    "AppUser",
    "RefreshToken",
    "InviteCode",
    "PushDevice",
    "Pet",
    "WeightEntry",
    "HealthEvent",
    "TaskTemplate",
    "TaskCompletion",
    "TaskTimer",
    "WalkSession",
    "WalkRoute",
    "Asset",
    "AppliedMutation",
]
