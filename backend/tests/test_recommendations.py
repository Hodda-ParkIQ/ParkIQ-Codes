from datetime import UTC, datetime, timedelta

import pytest
from app.config import Settings
from app.demo import PLACES, demo_lots
from app.geo import distance_m
from app.main import create_app
from app.models import Point, RecommendationRequest
from app.recommendation import fee, recommend
from app.repository import MemoryRepository
from app.routing import Router
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    with TestClient(create_app(Settings(_env_file=None))) as client:
        yield client


def request_body(**overrides):
    return {
        "origin": {"lat": 37.5385, "lng": 127.0602},
        "destination": PLACES[0].model_dump(),
        **overrides,
    }


def test_recommendation_contract_full_exclusion_and_radius(client):
    response = client.post("/api/recommendations", json=request_body())
    assert response.status_code == 200
    data = response.json()
    assert data["mode"] == "demo"
    assert data["excluded_full"] == 1
    assert data["candidates"]
    for candidate in data["candidates"]:
        assert candidate["lot"]["available"] != 0
        assert distance_m(PLACES[0], Point.model_validate(candidate["lot"])) <= 2000
        assert candidate["total_minutes"] == pytest.approx(
            candidate["drive_minutes"] + candidate["walk_minutes"] + candidate["search_minutes"],
            abs=0.11,
        )
        assert candidate["routing_source"] == "distance_estimate"


def test_preferences_change_ranking_and_ev_filter(client):
    walking = client.post(
        "/api/recommendations", json=request_body(preference="less_walking")
    ).json()
    cheap = client.post("/api/recommendations", json=request_body(preference="cheapest")).json()
    assert walking["candidates"][0]["lot"]["id"] != cheap["candidates"][0]["lot"]["id"]
    ev = client.post("/api/recommendations", json=request_body(ev_only=True)).json()
    assert ev["candidates"] and all(c["lot"]["ev"] is True for c in ev["candidates"])


def test_invalid_coordinates_and_radius_are_rejected(client):
    for body in [request_body(radius_m=2001), request_body(origin={"lat": 91, "lng": 127})]:
        assert client.post("/api/recommendations", json=body).status_code == 422


def test_empty_region_is_honest(client):
    body = request_body(destination={**PLACES[0].model_dump(), "lat": 35.16, "lng": 129.06})
    data = client.post("/api/recommendations", json=body).json()
    assert data["candidates"] == []
    assert data["warnings"]


async def test_stale_and_unknown_are_not_reported_as_low_risk():
    repo = MemoryRepository()
    lots = demo_lots()[:2]
    lots[0].observed_at = datetime.now(UTC) - timedelta(hours=2)
    lots[1].available = None
    await repo.upsert(lots)
    settings = Settings(_env_file=None)
    result = await recommend(
        RecommendationRequest.model_validate(request_body()), repo, Router(settings), settings
    )
    assert all(c.risk == "unknown" for c in result.candidates)
    assert any(c.stale for c in result.candidates)


def test_fee_uses_increment_rounding_and_daily_cap():
    lot = demo_lots()[0]
    assert fee(lot, 30) == 1500
    assert fee(lot, 31) == 2000
    assert fee(lot, 60) == 3000
    assert fee(lot, 1440) == 30000
    lot.extra_fee = None
    assert fee(lot, 60) is None


def test_live_mode_never_seeds_demo():
    with TestClient(create_app(Settings(_env_file=None, data_mode="live"))) as client:
        data = client.post("/api/recommendations", json=request_body()).json()
        assert data["mode"] == "live" and data["candidates"] == []


def test_sync_requires_configured_credentials(client):
    assert client.post("/api/admin/sync").status_code == 503
    with TestClient(create_app(Settings(_env_file=None, admin_api_key="test-key"))) as protected:
        assert protected.post("/api/admin/sync").status_code == 401
        assert (
            protected.post(
                "/api/admin/sync", headers={"Authorization": "Bearer test-key"}
            ).status_code
            == 409
        )


@pytest.mark.parametrize(
    "text,action,preference",
    [
        ("목적지까지 덜 걷는 곳으로 찾아줘", "preference", "less_walking"),
        ("가장 저렴한 곳", "preference", "cheapest"),
        ("2번 주차장 선택", "select", None),
        ("안내 시작", "navigate", None),
        ("서울숲 주차장 찾아줘", "search", None),
        ("안내 취소", "cancel", None),
        ("알 수 없는 문장", "unknown", None),
    ],
)
def test_voice_actions(client, text, action, preference):
    data = client.post("/api/voice/interpret", json={"text": text}).json()
    assert data["action"] == action and data["preference"] == preference


def test_places_search_includes_parking_lots(client):
    assert all(p["category"] != "주차장" for p in client.get("/api/places").json()["places"])
    hits = client.get("/api/places", params={"q": "공영"}).json()["places"]
    assert hits and all(p["category"] == "주차장" and p["id"].startswith("lot:") for p in hits)
    assert client.get("/api/places", params={"q": "%_"}).json()["places"] == []


def test_backend_only_mode_serves_api_without_frontend():
    settings = Settings(
        _env_file=None,
        serve_frontend=False,
        cors_extra_origins="https://web.example.com/, ",
    )
    with TestClient(create_app(settings)) as api_only:
        assert api_only.get("/").json()["service"] == "ParkIQ API"
        assert api_only.get("/api/health").status_code == 200
        preflight = api_only.options(
            "/api/places",
            headers={
                "Origin": "https://web.example.com",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert preflight.headers["access-control-allow-origin"] == "https://web.example.com"
