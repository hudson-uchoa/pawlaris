from app.clock import Clock


class LoginRateLimiter:
    def __init__(self, clock: Clock) -> None:
        self.clock = clock

    def check(self, email: str) -> None:
        raise NotImplementedError

    def failure(self, email: str) -> None:
        raise NotImplementedError

    def success(self, email: str) -> None:
        raise NotImplementedError

    @property
    def tracked_emails(self) -> int:
        raise NotImplementedError
