import asyncio
import contextlib
import hmac
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import Settings
from .demo import PLACES, demo_lots
from .models import RecommendationRequest, RecommendationResponse, VoiceIntent, VoiceRequest
from .pipeline import Pipeline
from .recommendation import recommend
from .repository import MemoryRepository, PostgisRepository, Repository
from .routing import Router
from .voice import parse_voice


def create_app(settings: Settings | None = None, repository: Repository | None = None) -> FastAPI:
    settings = settings or Settings()
    repo = repository or (
        PostgisRepository(settings.database_url.get_secret_value(), settings.data_mode == "demo")
        if settings.repository == "postgres"
        else MemoryRepository()
    )
    router = Router(settings)
    pipeline = Pipeline(settings, repo)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if settings.data_mode == "demo":
            await repo.upsert(demo_lots())
        task = None
        if settings.sync_enabled and settings.data_mode == "live":
            task = asyncio.create_task(pipeline.run())
        yield
        if task:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    app = FastAPI(
        title="ParkIQ API",
        version="1.0.0",
        lifespan=lifespan,
        description="차량 이동 + 주차 탐색 + 도보 시간을 고려한 주차 추천",
    )
    app.state.repo, app.state.pipeline = repo, pipeline
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "Authorization"],
    )

    @app.get("/api/health")
    async def health():
        ready = await repo.health()
        return JSONResponse(
            status_code=200 if ready else 503,
            content={
                "status": "ok" if ready else "unavailable",
                "mode": settings.data_mode,
                "repository": settings.repository,
                "providers": pipeline.status,
                "routing": "provider" if settings.routing_api_url else "distance_estimate",
                "configured_providers": [p.name for p in pipeline.providers],
            },
        )

    @app.get("/api/places")
    async def places(q: str = Query(default="", max_length=100)):
        # Curated geocoded destinations. Arbitrary coordinates are accepted by /recommendations.
        return {
            "places": [p for p in PLACES if q.lower() in (p.name + p.address).lower()],
            "source": "curated_demo_destinations",
        }

    @app.post("/api/recommendations", response_model=RecommendationResponse)
    async def recommendations(req: RecommendationRequest):
        try:
            return await recommend(req, repo, router, settings)
        except Exception as exc:
            raise HTTPException(
                503, "주차 정보를 조회할 수 없습니다. 잠시 후 다시 시도해 주세요."
            ) from exc

    @app.post("/api/voice/interpret", response_model=VoiceIntent)
    async def voice(req: VoiceRequest):
        return parse_voice(req.text)

    @app.post("/api/admin/sync")
    async def sync(authorization: str = Header(default="")):
        key = settings.admin_api_key.get_secret_value()
        if not key:
            raise HTTPException(503, "관리자 동기화 키가 설정되지 않았습니다.")
        if not hmac.compare_digest(authorization, f"Bearer {key}"):
            raise HTTPException(401, "인증이 필요합니다.")
        if settings.data_mode != "live":
            raise HTTPException(409, "실데이터 모드에서만 수집할 수 있습니다.")
        if not pipeline.providers:
            raise HTTPException(409, "수집 제공자가 설정되지 않았습니다.")
        return {"providers": await pipeline.sync(), "at": datetime.now(UTC)}

    dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
    # In the source checkout frontend is alongside backend; in Docker it is /app/frontend/dist.
    dist = dist if dist.exists() else Path(__file__).resolve().parents[3] / "frontend" / "dist"
    if dist.is_dir():
        app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
    return app


app = create_app()
