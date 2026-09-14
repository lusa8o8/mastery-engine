"""FastAPI shell for the trusted Atlas application boundary."""

from collections.abc import Mapping
from typing import Annotated, Protocol
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ConfigDict
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.concurrency import run_in_threadpool

from contracts.s2a.models import ErrorCode, ErrorEnvelope, Principal

from .auth import (
    Authenticator,
    FixtureAuthenticator,
    LockedAuthenticator,
    build_production_authenticator,
    parse_bearer_token,
)
from .config import RuntimeMode, Settings
from .commands import (
    CommandRequest,
    CommandService,
    CommandSubmission,
    LockedCommandService,
)
from .errors import (
    AtlasError,
    atlas_error_handler,
    http_error_handler,
    request_id_for,
    unexpected_error_handler,
    validation_error_handler,
)
from .job_queries import (
    JobQueryService,
    JobSnapshot,
    LockedJobQueryService,
)


class StrictResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")


class HealthResponse(StrictResponse):
    status: str
    service: str
    version: str


class ReadinessResponse(StrictResponse):
    status: str
    checks: dict[str, bool]


class ReadinessProbe(Protocol):
    def checks(self) -> Mapping[str, bool]: ...


class StaticReadinessProbe:
    def __init__(self, checks: Mapping[str, bool] | None = None) -> None:
        self._checks = dict(
            checks
            or {
                "authentication": False,
                "database": False,
                "job_store": False,
                "model_gateway": False,
            }
        )

    def checks(self) -> Mapping[str, bool]:
        return dict(self._checks)


ERROR_RESPONSES = {
    400: {"model": ErrorEnvelope},
    401: {"model": ErrorEnvelope},
    404: {"model": ErrorEnvelope},
    422: {"model": ErrorEnvelope},
    500: {"model": ErrorEnvelope},
    503: {"model": ErrorEnvelope},
}


def create_app(
    settings: Settings | None = None,
    *,
    authenticator: Authenticator | None = None,
    readiness_probe: ReadinessProbe | None = None,
    command_service: CommandService | None = None,
    job_query_service: JobQueryService | None = None,
) -> FastAPI:
    resolved_settings = settings or Settings.from_environment()
    if resolved_settings.runtime_mode == RuntimeMode.FIXTURE and authenticator is None:
        raise ValueError("fixture mode requires an explicitly injected authenticator")
    if (
        resolved_settings.runtime_mode == RuntimeMode.PRODUCTION
        and isinstance(authenticator, FixtureAuthenticator)
    ):
        raise ValueError("FixtureAuthenticator is forbidden in production mode")

    if authenticator is not None:
        resolved_authenticator = authenticator
    elif resolved_settings.runtime_mode == RuntimeMode.PRODUCTION:
        resolved_authenticator = build_production_authenticator(resolved_settings)
    else:
        resolved_authenticator = LockedAuthenticator()
    resolved_readiness = readiness_probe or StaticReadinessProbe()
    resolved_command_service = command_service or LockedCommandService()
    resolved_job_query_service = job_query_service or LockedJobQueryService()
    docs_url = "/docs" if resolved_settings.docs_enabled else None
    app = FastAPI(
        title="Atlas API",
        version=resolved_settings.service_version,
        docs_url=docs_url,
        redoc_url=None,
    )
    app.state.settings = resolved_settings
    app.state.authenticator = resolved_authenticator
    app.state.readiness_probe = resolved_readiness
    app.state.command_service = resolved_command_service
    app.state.job_query_service = resolved_job_query_service

    @app.middleware("http")
    async def request_id_middleware(request: Request, call_next):
        supplied = request.headers.get("x-request-id")
        try:
            request.state.request_id = UUID(supplied) if supplied else uuid4()
        except ValueError:
            request.state.request_id = uuid4()
        response = await call_next(request)
        response.headers["x-request-id"] = str(request.state.request_id)
        return response

    app.add_exception_handler(AtlasError, atlas_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.add_exception_handler(StarletteHTTPException, http_error_handler)
    app.add_exception_handler(Exception, unexpected_error_handler)

    async def current_principal(
        request: Request,
        authorization: Annotated[str | None, Header()] = None,
    ) -> Principal:
        token = parse_bearer_token(authorization)
        return await request.app.state.authenticator.authenticate(
            token, request_id_for(request)
        )

    @app.get("/health/live", response_model=HealthResponse)
    async def liveness() -> HealthResponse:
        return HealthResponse(
            status="ok",
            service=resolved_settings.service_name,
            version=resolved_settings.service_version,
        )

    @app.get(
        "/health/ready",
        response_model=ReadinessResponse,
        responses={503: {"model": ErrorEnvelope}},
    )
    async def readiness() -> ReadinessResponse:
        checks = dict(app.state.readiness_probe.checks())
        if isinstance(app.state.authenticator, LockedAuthenticator):
            # A caller-supplied readiness probe cannot accidentally declare an
            # application ready while its auth boundary still rejects all work.
            checks["authentication"] = False
        if isinstance(app.state.command_service, LockedCommandService):
            # Readiness covers the public write path as well as process health.
            checks["job_store"] = False
        if isinstance(app.state.job_query_service, LockedJobQueryService):
            checks["job_store"] = False
        if not checks or not all(checks.values()):
            raise AtlasError(
                code=ErrorCode.DEPENDENCY_FAILED,
                message="Atlas API is not ready",
                http_status=503,
                retryable=True,
                details={"unready": sorted(name for name, ready in checks.items() if not ready)},
            )
        return ReadinessResponse(status="ready", checks=checks)

    @app.get("/v1/whoami", response_model=Principal, responses=ERROR_RESPONSES)
    async def whoami(
        principal: Annotated[Principal, Depends(current_principal)],
    ) -> Principal:
        return principal

    @app.post(
        "/v1/commands",
        response_model=CommandSubmission,
        status_code=202,
        responses=ERROR_RESPONSES | {409: {"model": ErrorEnvelope}},
    )
    async def submit_command(
        request: Request,
        body: CommandRequest,
        principal: Annotated[Principal, Depends(current_principal)],
        idempotency_key: Annotated[
            str,
            Header(
                alias="Idempotency-Key",
                min_length=8,
                max_length=128,
                pattern=r"^[A-Za-z0-9._:-]+$",
            ),
        ],
    ) -> CommandSubmission:
        # Database adapters are synchronous today; keep their bounded work off
        # the event loop until the measured load justifies an async repository.
        return await run_in_threadpool(
            request.app.state.command_service.submit,
            principal,
            request_id_for(request),
            idempotency_key,
            body,
        )

    @app.get(
        "/v1/jobs/{job_id}",
        response_model=JobSnapshot,
        responses=ERROR_RESPONSES,
    )
    async def get_job(
        request: Request,
        job_id: UUID,
        principal: Annotated[Principal, Depends(current_principal)],
    ) -> JobSnapshot:
        return await run_in_threadpool(
            request.app.state.job_query_service.get,
            principal,
            job_id,
        )

    return app
