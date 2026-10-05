from collections.abc import AsyncIterator

import pytest
from fastapi import FastAPI

from app.clock import FrozenClock
from app.main import create_app
from app.settings import Settings


@pytest.fixture
async def production_app(
    settings: Settings, frozen_clock: FrozenClock
) -> AsyncIterator[FastAPI]:
    application = create_app(settings, frozen_clock)
    yield application
    await application.state.engine.dispose()
