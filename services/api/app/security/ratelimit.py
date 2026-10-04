import math
from collections import OrderedDict, deque

from app.clock import Clock
from app.errors import ApiError


class LoginRateLimiter:
    def __init__(self, clock: Clock) -> None:
        self.clock = clock
        self._failures: OrderedDict[str, deque[float]] = OrderedDict()
        self._attempts: deque[float] = deque()

    def check(self, email: str) -> None:
        now = self.clock.monotonic()
        self._prune(self._attempts, now - 60)
        failures = self._failures.get(email.lower(), deque())
        self._prune(failures, now - 900)
        waits = []
        if len(self._attempts) >= 30:
            waits.append(self._attempts[0] + 60 - now)
        if len(failures) >= 5:
            waits.append(failures[0] + 900 - now)
        if waits:
            raise ApiError(
                429,
                "rate_limited",
                "Too many login attempts.",
                headers={"Retry-After": str(max(1, math.ceil(max(waits))))},
            )
        self._attempts.append(now)

    def failure(self, email: str) -> None:
        email = email.lower()
        if email not in self._failures:
            if len(self._failures) == 10000:
                self._failures.popitem(last=False)
            self._failures[email] = deque()
        failures = self._failures[email]
        now = self.clock.monotonic()
        self._prune(failures, now - 900)
        failures.append(now)

    def success(self, email: str) -> None:
        self._failures.pop(email.lower(), None)

    @property
    def tracked_emails(self) -> int:
        return len(self._failures)

    @staticmethod
    def _prune(values: deque[float], cutoff: float) -> None:
        while values and values[0] <= cutoff:
            values.popleft()
