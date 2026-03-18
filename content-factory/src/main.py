from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import os
import logging
import json
from datetime import datetime

import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

from src.core.database import init_db
from src.core.redis import init_redis
from src.api import content, templates, niches, health, auth, scheduling, hashtags, alerts, users, reports, analytics

from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

limiter = Limiter(key_func=get_remote_address)

# Configure structured JSON logging
class JSONFormatter(logging.Formatter):
    def format(self, record):
        log_data = {
            "timestamp": datetime.utcnow().isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            log_data["exception"] = self.formatException(record.exc_info)
        return json.dumps(log_data)

# Set up root logger
root_logger = logging.getLogger()
root_logger.setLevel(logging.INFO)
handler = logging.StreamHandler()
handler.setFormatter(JSONFormatter())
root_logger.addHandler(handler)

# Get logger for this module
logger = logging.getLogger(__name__)

# Sentry — init before app creation
_sentry_dsn = os.getenv("SENTRY_DSN", "")
if _sentry_dsn:
    sentry_sdk.init(
        dsn=_sentry_dsn,
        integrations=[FastApiIntegration(), SqlalchemyIntegration()],
        traces_sample_rate=0.2,
        environment=os.getenv("ENVIRONMENT", "development"),
        send_default_pii=False,
    )
    print("✅ Sentry initialisé (Content Factory)")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await init_db()
    await init_redis()
    print("✅ Content Factory démarré")
    yield
    # Shutdown
    print("🛑 Content Factory arrêté")


app = FastAPI(
    title="Influence Platform — Content Factory",
    description="Génération de contenu par IA pour Instagram",
    version="1.0.0",
    lifespan=lifespan
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

@app.middleware("http")
async def recovery_and_logging_middleware(request, call_next):
    """Global middleware for error recovery and request logging."""
    start_time = datetime.utcnow()
    try:
        response = await call_next(request)
        process_time = (datetime.utcnow() - start_time).total_seconds()
        logger.info(f"Method: {request.method} Path: {request.url.path} Status: {response.status_code} Duration: {process_time}s")
        return response
    except Exception as exc:
        logger.error(f"FATAL ERROR on {request.url.path}: {str(exc)}", exc_info=True)
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=500,
            content={"error": "An internal server error occurred. The system is recovering."}
        )

from src.core.config import settings

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.ALLOWED_ORIGINS.split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(auth.router, prefix="/auth", tags=["Auth"])
app.include_router(health.router, prefix="/health", tags=["Health"])
app.include_router(niches.router, prefix="/niches", tags=["Niches"])
app.include_router(templates.router, prefix="/templates", tags=["Templates"])
app.include_router(content.router, prefix="/content", tags=["Content"])
app.include_router(scheduling.router, prefix="/scheduling", tags=["Scheduling"])
app.include_router(hashtags.router, prefix="/hashtags", tags=["Hashtags"])
app.include_router(alerts.router, prefix="/alerts", tags=["Alerts"])
app.include_router(users.router, prefix="/users", tags=["Users"])
app.include_router(reports.router, prefix="/reports", tags=["Reports"])
app.include_router(analytics.router, prefix="/analytics", tags=["Analytics"])


@app.get("/")
async def root():
    return {
        "service": "Content Factory",
        "version": "1.0.0",
        "status": "running"
    }

# Prometheus metrics endpoint (auto-instrumented)
from prometheus_fastapi_instrumentator import Instrumentator
Instrumentator().instrument(app).expose(app)
