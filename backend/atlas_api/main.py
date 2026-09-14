"""Default locked application for Uvicorn and deployment probes."""

from .app import create_app

app = create_app()
