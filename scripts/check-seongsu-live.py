"""Verify the Seongsu coordinate repair using public APIs, without touching the running server."""

import asyncio
import json
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.config import Settings  # noqa: E402
from app.demo import PLACES  # noqa: E402
from app.main import create_app  # noqa: E402
from app.providers.seongdong import PUBLIC_PARKING_URL, enrich_coordinates  # noqa: E402
from app.providers.seoul import normalize  # noqa: E402
from app.repository import MemoryRepository  # noqa: E402


async def main():
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get(
            "http://openapi.seoul.go.kr:8088/sample/json/GetParkInfo/1/5/성수/"
        )
        response.raise_for_status()
        block = response.json()["GetParkInfo"]
        assert block["RESULT"]["CODE"] == "INFO-000"
        metadata = block["row"]
        response = await client.get(PUBLIC_PARKING_URL)
        response.raise_for_status()
        references = response.json()
    before = normalize(metadata, [])
    enriched, count = enrich_coordinates(metadata, references)
    lots = normalize(enriched, [])
    assert lots and count > 0
    repo = MemoryRepository()
    await repo.upsert(lots)
    app = create_app(Settings(_env_file=None, data_mode="live", repository="memory"), repo)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://parkiq.test"
        ) as client:
            response = await client.post(
                "/api/recommendations",
                json={
                    "origin": {"lat": 37.5385, "lng": 127.0602},
                    "destination": PLACES[0].model_dump(),
                },
            )
            response.raise_for_status()
            result = response.json()
    assert result["candidates"] and result["mode"] == "live"
    assert all(
        c["lot"]["demo"] is False and c["lot"]["available"] is None for c in result["candidates"]
    )
    print(
        json.dumps(
            {
                "status": "PASS",
                "scope": "public sample + local memory API; running server unchanged",
                "before_normalized": len(before),
                "coordinate_enriched": count,
                "recommendations": len(result["candidates"]),
                "lots": [
                    {
                        "id": c["lot"]["id"],
                        "name": c["lot"]["name"],
                        "lat": c["lot"]["lat"],
                        "lng": c["lot"]["lng"],
                        "coordinate_source": c["lot"]["coordinate_source"],
                        "available": c["lot"]["available"],
                    }
                    for c in result["candidates"]
                ],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    asyncio.run(main())
