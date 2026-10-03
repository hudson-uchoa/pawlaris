from fastapi import FastAPI


class ApiError(Exception):
    def __init__(self, status: int, code: str, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.code = code
        self.detail = detail


def register_handlers(app: FastAPI) -> None:
    raise NotImplementedError("not implemented")
