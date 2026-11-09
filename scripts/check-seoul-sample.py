"""Check real Seoul public sample responses through ParkIQ without an API key."""

import asyncio
import json
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import Place, Point  # noqa: E402
from app.providers.seoul import normalize  # noqa: E402
from app.repository import MemoryRepository  # noqa: E402

BASE = "http://openapi.seoul.go.kr:8088/sample/json"


def unpack(payload: dict, service: str) -> list[dict]:
    block = payload.get(service, payload)
    if block.get("RESULT", {}).get("CODE") != "INFO-000":
        raise RuntimeError(f"{service}: public sample request failed")
    return block.get("row", [])


async def main():
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.get(f"{BASE}/GetParkingInfo/1/5/")
        response.raise_for_status()
        occupancy = unpack(response.json(), "GetParkingInfo")
        lots = []
        # The public sample key accepts only rows 1–5. Query metadata by facility code.
        for row in occupancy:
            code = str(row.get("PKLT_CD", ""))
            if not code.isdigit():
                continue
            response = await client.get(f"{BASE}/GetParkInfo/1/5/%20/{code}")
            response.raise_for_status()
            lots.extend(normalize(unpack(response.json(), "GetParkInfo"), [row]))
            if lots:
                break
    if not lots:
        raise RuntimeError("No public sample facility with valid coordinates was returned")
    lot = lots[0]
    repository = MemoryRepository()
    await repository.upsert(lots)
    settings = Settings(_env_file=None, data_mode="live", repository="memory", sync_enabled=False)
    app = create_app(settings, repository=repository)
    destination = Place(
        id="live-sample", name="실제 주차장 주변 테스트 목적지", lat=lot.lat + 0.0005, lng=lot.lng
    )
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://parkiq.test"
        ) as client:
            response = await client.post(
                "/api/recommendations",
                json={
                    "origin": Point(lat=lot.lat - 0.005, lng=lot.lng).model_dump(),
                    "destination": destination.model_dump(),
                },
            )
            response.raise_for_status()
            result = response.json()
    assert result["mode"] == "live"
    # A full lot may correctly produce no recommendations.
    assert all(c["lot"]["demo"] is False for c in result["candidates"])
    if lot.available != 0:
        assert result["candidates"]
    print(
        json.dumps(
            {
                "status": "PASS",
                "scope": "public sample only; does not change the running app",
                "name": lot.name,
                "id": lot.id,
                "available": lot.available,
                "observed_at": lot.observed_at.isoformat() if lot.observed_at else None,
                "mode": result["mode"],
                "recommendations": len(result["candidates"]),
                "routing": "distance_estimate",
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    asyncio.run(main())
