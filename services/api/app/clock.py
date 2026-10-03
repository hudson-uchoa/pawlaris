from datetime import UTC, datetime, timedelta
from time import perf_counter
from typing import Protocol


class Clock(Protocol):
    def now(self) -> datetime: ...

    def monotonic(self) -> float: ...


class SystemClock:
    def now(self) -> datetime:
        return datetime.now(UTC)

    def monotonic(self) -> float:
        return perf_counter()


class FrozenClock:
    def __init__(self, instant: datetime) -> None:
        if instant.tzinfo is None or instant.utcoffset() != timedelta(0):
            raise ValueError("FrozenClock requires a UTC instant")
        self.instant = instant
        self.elapsed = 0.0

    def now(self) -> datetime:
        return self.instant

    def monotonic(self) -> float:
        return self.elapsed

    def advance(self, delta: timedelta) -> None:
        self.instant += delta
        self.elapsed += delta.total_seconds()
