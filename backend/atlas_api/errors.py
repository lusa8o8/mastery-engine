"""Typed, content-safe API errors backed by the frozen S2A contract."""

from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from contracts.s2a.models import ErrorCode, ErrorEnvelope


class AtlasError(Exception):
    def __init__(
        self,
        code: ErrorCode,
        message: str,
        http_status: int,
        *,
        retryable: bool = False,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = http_status
        self.retryable = retryable
        self.details = details or {}


def request_id_for(request: Request) -> UUID:
    value = getattr(request.state, "request_id", None)
    return value if isinstance(value, UUID) else uuid4()


def render_error(request: Request, error: AtlasError) -> JSONResponse:
    envelope = ErrorEnvelope(
        schema_version="error.v1",
        request_id=request_id_for(request),
        code=error.code,
        message=error.message,
        http_status=error.http_status,
        retryable=error.retryable,
        details=error.details,
    )
    return JSONResponse(
        status_code=error.http_status,
        content=envelope.model_dump(mode="json"),
    )


async def atlas_error_handler(request: Request, error: AtlasError) -> JSONResponse:
    return render_error(request, error)


async def validation_error_handler(
    request: Request, error: RequestValidationError
) -> JSONResponse:
    # FastAPI's raw validation payload can include submitted values and even
    # attacker-chosen object keys. Expose only the fixed request area.
    locations = sorted(
        {
            str(item["loc"][0]) if item.get("loc") else "request"
            for item in error.errors()
        }
    )
    return render_error(
        request,
        AtlasError(
            ErrorCode.INVALID_INPUT,
            "Request validation failed",
            422,
            details={"locations": locations},
        ),
    )


async def http_error_handler(
    request: Request, error: StarletteHTTPException
) -> JSONResponse:
    if error.status_code == 404:
        return render_error(
            request, AtlasError(ErrorCode.NOT_FOUND, "Route not found", 404)
        )
    return render_error(
        request, AtlasError(ErrorCode.INVALID_INPUT, "Request is not allowed", 400)
    )


async def unexpected_error_handler(request: Request, _error: Exception) -> JSONResponse:
    # Do not serialize exception text: provider, database, and parser errors may
    # contain credentials or student content.
    return render_error(
        request,
        AtlasError(ErrorCode.INTERNAL_ERROR, "Unexpected server error", 500),
    )
