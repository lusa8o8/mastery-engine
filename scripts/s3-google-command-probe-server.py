"""Loopback-only API used for the browser-assisted Google JWT gate."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import os
from pathlib import Path
import sys
from urllib.parse import urlsplit
from uuid import UUID

from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field
import psycopg
import uvicorn

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.atlas_api.app import create_app  # noqa: E402
from backend.atlas_api.commands import (  # noqa: E402
    CommandRegistry,
    CommandRoute,
    RegisteredCommandService,
)
from backend.atlas_api.config import RuntimeMode, Settings  # noqa: E402
from backend.atlas_api.jobs import JobRuntime  # noqa: E402
from backend.atlas_api.postgres_jobs import PostgresJobRepository  # noqa: E402


class ProbePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    probe_id: UUID
    sequence: int = Field(ge=1, le=2)


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def required(name: str, fallback: str | None = None) -> str:
    value = os.environ.get(name) or (os.environ.get(fallback, "") if fallback else "")
    if not value or "YOUR_" in value.upper() or "PLACEHOLDER" in value.upper():
        raise RuntimeError(f"missing required environment variable: {name}")
    return value


def connection_factory(password: str):
    pooler = urlsplit(
        (ROOT / "supabase" / ".temp" / "pooler-url")
        .read_text(encoding="utf-8")
        .strip()
    )
    if not pooler.hostname or not pooler.username or not pooler.port:
        raise RuntimeError("linked Supabase pooler URL is incomplete")

    def connect():
        return psycopg.connect(
            host=pooler.hostname,
            port=pooler.port,
            dbname=pooler.path.lstrip("/") or "postgres",
            user=pooler.username,
            password=password,
            sslmode="require",
            connect_timeout=15,
        )

    return connect


def checked_project_url(project_ref: str) -> str:
    url = required("SUPABASE_URL", "VITE_SUPABASE_URL").rstrip("/")
    hostname = urlsplit(url).hostname
    actual_ref = hostname.split(".")[0] if hostname else ""
    if actual_ref != project_ref:
        raise RuntimeError("confirmed project ref does not match SUPABASE_URL")
    return url


def build_app(project_ref: str):
    load_env(ROOT / ".env.local")
    load_env(ROOT / ".env")
    url = checked_project_url(project_ref)
    repository = PostgresJobRepository(
        connection_factory(required("SUPABASE_DB_PASSWORD"))
    )
    runtime = JobRuntime(repository, clock=lambda: datetime.now(timezone.utc))
    service = RegisteredCommandService(
        runtime,
        CommandRegistry(
            [
                CommandRoute(
                    command_type="platform.integration_probe",
                    payload_schema_version="platform_probe.v1",
                    payload_model=ProbePayload,
                    workflow_name="platform.integration_probe",
                    workflow_version="v1",
                    max_attempts=1,
                )
            ]
        ),
        clock=lambda: datetime.now(timezone.utc),
    )
    app = create_app(
        Settings(runtime_mode=RuntimeMode.PRODUCTION, supabase_url=url),
        command_service=service,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173"],
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
        max_age=60,
    )
    return app


def cleanup_job(project_ref: str, job_id: UUID) -> None:
    load_env(ROOT / ".env.local")
    load_env(ROOT / ".env")
    checked_project_url(project_ref)
    connect = connection_factory(required("SUPABASE_DB_PASSWORD"))
    with connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                delete from public.platform_commands
                where command_id = (
                  select command_id from public.workflow_jobs where job_id = %s
                )
                returning command_id
                """,
                (job_id,),
            )
            if cursor.fetchone() is None:
                raise RuntimeError("probe job was not found for cleanup")
            cursor.execute(
                "select count(*) from public.workflow_jobs where job_id = %s",
                (job_id,),
            )
            if cursor.fetchone()[0] != 0:
                raise RuntimeError("probe cleanup postcondition failed")
    print("Google command probe row removed and verified")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--confirm-project-ref", required=True)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--serve", action="store_true")
    action.add_argument("--cleanup-job", type=UUID)
    args = parser.parse_args()
    if args.cleanup_job:
        cleanup_job(args.confirm_project_ref, args.cleanup_job)
        return
    uvicorn.run(
        build_app(args.confirm_project_ref),
        host="127.0.0.1",
        port=8000,
        access_log=False,
        log_level="warning",
    )


if __name__ == "__main__":
    main()
