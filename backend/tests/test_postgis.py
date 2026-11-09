"""Run with TEST_DATABASE_URL against an isolated PostGIS test database."""

import os
from pathlib import Path

import psycopg
import pytest
from app.demo import demo_lots
from app.models import Point
from app.repository import PostgisRepository


@pytest.mark.skipif(not os.getenv("TEST_DATABASE_URL"), reason="isolated PostGIS URL required")
async def test_postgis_spatial_query_upsert_and_demo_isolation():
    dsn = os.environ["TEST_DATABASE_URL"]
    async with await psycopg.AsyncConnection.connect(dsn) as conn:
        await conn.execute(Path("db/001_init.sql").read_text())
        await conn.execute("TRUNCATE parking_lots")
    repo = PostgisRepository(dsn, demo=True)
    lots = demo_lots()
    await repo.upsert(lots)
    near = await repo.nearby(Point(lat=37.5446, lng=127.0542), 200)
    assert near and all(lot.id in {"demo:01", "demo:04", "demo:06"} for lot in near)
    assert (
        await PostgisRepository(dsn, demo=False).nearby(Point(lat=37.5446, lng=127.0542), 2000)
        == []
    )
    lots[0].available = 19
    await repo.upsert([lots[0]])
    updated = await repo.nearby(Point(lat=37.545, lng=127.0527), 10)
    assert updated[0].available == 19
