import math
from collections import OrderedDict, deque
from dataclasses import dataclass

from app.clock import Clock
from app.errors import ApiError


@dataclass(eq=False)
class LoginAttempt:
    email: str
    started: float


class LoginRateLimiter:
    def __init__(self, clock: Clock) -> None:
        self.clock = clock
        self._failures: OrderedDict[str, deque[LoginAttempt]] = OrderedDict()
        self._attempts: deque[LoginAttempt] = deque()

    def check(self, email: str) -> LoginAttempt:
        now = self.clock.monotonic()
        self._prune(self._attempts, now - 60)
        failures = self._failures.get(email.lower(), deque())
        self._prune(failures, now - 900)
        waits = []
        if len(self._attempts) >= 30:
            waits.append(self._attempts[0].started + 60 - now)
        if len(failures) >= 5:
            waits.append(failures[0].started + 900 - now)
        if waits:
            raise ApiError(
                429,
                "rate_limited",
                "Too many login attempts.",
                headers={"Retry-After": str(max(1, math.ceil(max(waits))))},
            )
        email = email.lower()
        if email not in self._failures:
            if len(self._failures) == 10000:
                self._failures.popitem(last=False)
            self._failures[email] = deque()
        attempt = LoginAttempt(email, now)
        self._failures[email].append(attempt)
        self._attempts.append(attempt)
        return attempt

    def release(self, attempt: LoginAttempt) -> None:
        failures = self._failures.get(attempt.email)
        if failures is not None and attempt in failures:
            failures.remove(attempt)
            if not failures:
                del self._failures[attempt.email]
        if attempt in self._attempts:
            self._attempts.remove(attempt)

    def success(self, email: str) -> None:
        self._failures.pop(email.lower(), None)

    @property
    def tracked_emails(self) -> int:
        return len(self._failures)

    @staticmethod
    def _prune(values: deque[LoginAttempt], cutoff: float) -> None:
        while values and values[0].started <= cutoff:
            values.popleft()
