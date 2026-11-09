from typing import Protocol

import psycopg
from psycopg.types.json import Jsonb

from .geo import distance_m
from .models import ParkingLot, Point


class Repository(Protocol):
    async def upsert(self, lots: list[ParkingLot]) -> None: ...
    async def nearby(self, point: Point, radius_m: int) -> list[ParkingLot]: ...
    async def health(self) -> bool: ...


class MemoryRepository:
    def __init__(self):
        self.lots: dict[str, ParkingLot] = {}

    async def upsert(self, lots: list[ParkingLot]) -> None:
        for lot in lots:
            self.lots[lot.id] = lot.model_copy(deep=True)

    async def nearby(self, point: Point, radius_m: int) -> list[ParkingLot]:
        return [lot for lot in self.lots.values() if distance_m(point, lot) <= radius_m]

    async def health(self) -> bool:
        return True


class PostgisRepository:
    def __init__(self, dsn: str, demo: bool):
        self.dsn = dsn
        self.demo = demo

    async def upsert(self, lots: list[ParkingLot]) -> None:
        # An entire provider snapshot is committed atomically; a failed request never erases data.
        async with await psycopg.AsyncConnection.connect(self.dsn) as conn:
            async with conn.cursor() as cur:
                for lot in lots:
                    await cur.execute(
                        """
                        INSERT INTO parking_lots (id, location, payload, demo, fetched_at)
                        VALUES (%s, ST_SetSRID(ST_MakePoint(%s,%s),4326)::geography,%s,%s,%s)
                        ON CONFLICT (id) DO UPDATE SET location=EXCLUDED.location,
                            payload=EXCLUDED.payload, demo=EXCLUDED.demo,
                            fetched_at=EXCLUDED.fetched_at
                        WHERE parking_lots.fetched_at <= EXCLUDED.fetched_at
                    """,
                        (
                            lot.id,
                            lot.lng,
                            lot.lat,
                            Jsonb(lot.model_dump(mode="json")),
                            lot.demo,
                            lot.fetched_at,
                        ),
                    )

    async def nearby(self, point: Point, radius_m: int) -> list[ParkingLot]:
        async with await psycopg.AsyncConnection.connect(self.dsn) as conn:
            result = await conn.execute(
                """
                SELECT payload FROM parking_lots
                WHERE demo=%s AND ST_DWithin(location,
                    ST_SetSRID(ST_MakePoint(%s,%s),4326)::geography,%s)
                ORDER BY location <-> ST_SetSRID(ST_MakePoint(%s,%s),4326)::geography
            """,
                (self.demo, point.lng, point.lat, radius_m, point.lng, point.lat),
            )
            return [ParkingLot.model_validate(row[0]) for row in await result.fetchall()]

    async def health(self) -> bool:
        try:
            async with await psycopg.AsyncConnection.connect(self.dsn, connect_timeout=3) as conn:
                await conn.execute("SELECT 1 FROM parking_lots LIMIT 1")
            return True
        except psycopg.Error:
            return False
