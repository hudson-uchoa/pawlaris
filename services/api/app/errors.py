from http import HTTPStatus
from typing import cast

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse


class ApiError(Exception):
    def __init__(self, status: int, code: str, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.code = code
        self.detail = detail


def register_handlers(app: FastAPI) -> None:
    app.add_exception_handler(ApiError, handle_api_error)
    app.add_exception_handler(HTTPException, handle_http_error)
    app.add_exception_handler(RequestValidationError, handle_validation_error)


def problem_response(status: int, code: str, detail: str) -> JSONResponse:
    return JSONResponse(
        {
            "type": "about:blank",
            "title": HTTPStatus(status).phrase,
            "status": status,
            "code": code,
            "detail": detail,
        },
        status_code=status,
        media_type="application/problem+json",
    )


async def handle_api_error(request: Request, exc: Exception) -> JSONResponse:
    error = cast(ApiError, exc)
    return problem_response(error.status, error.code, error.detail)


async def handle_http_error(request: Request, exc: Exception) -> JSONResponse:
    error = cast(HTTPException, exc)
    code = (
        "not_found"
        if error.status_code == 404
        else HTTPStatus(error.status_code).name.lower()
    )
    response = problem_response(error.status_code, code, str(error.detail))
    if error.headers:
        response.headers.update(error.headers)
    return response


async def handle_validation_error(request: Request, exc: Exception) -> JSONResponse:
    error = cast(RequestValidationError, exc)
    return JSONResponse(
        {
            "type": "about:blank",
            "title": "Unprocessable Entity",
            "status": 422,
            "code": "validation_error",
            "detail": "Request validation failed.",
            "errors": [
                {"loc": item["loc"], "msg": item["msg"]} for item in error.errors()
            ],
        },
        status_code=422,
        media_type="application/problem+json",
    )
