import asyncio

import httpx
from pydantic import BaseModel, Field

from .config import Settings
from .geo import distance_m
from .models import Point


class Leg(BaseModel):
    minutes: float = Field(gt=0, allow_inf_nan=False)
    meters: int = Field(ge=0)
    path: list[Point] = Field(min_length=2)


class RoutePair(BaseModel):
    drive: Leg
    walk: Leg
    source: str


def estimate(origin: Point, parking: Point, destination: Point) -> RoutePair:
    drive_m = round(distance_m(origin, parking) * 1.35)
    walk_m = round(distance_m(parking, destination) * 1.2)
    # Display geometry is illustrative; no claim of a navigable road route.
    corner = Point(lat=origin.lat, lng=parking.lng)
    walk_corner = Point(lat=parking.lat, lng=destination.lng)
    return RoutePair(
        drive=Leg(
            minutes=round(max(1.0, drive_m / 250 + 1.5), 1),
            meters=drive_m,
            path=[origin, corner, parking],
        ),
        walk=Leg(
            minutes=round(max(0.5, walk_m / 75), 1),
            meters=walk_m,
            path=[parking, walk_corner, destination],
        ),
        source="distance_estimate",
    )


class Router:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.semaphore = asyncio.Semaphore(8)

    async def route(self, origin: Point, parking: Point, destination: Point) -> RoutePair:
        if self.settings.routing_api_url:
            try:
                async with (
                    asyncio.timeout(4),
                    self.semaphore,
                    httpx.AsyncClient(timeout=3) as client,
                ):
                    token = self.settings.routing_api_key.get_secret_value()
                    response = await client.post(
                        self.settings.routing_api_url,
                        headers={"Authorization": f"Bearer {token}"},
                        json={
                            "origin": origin.model_dump(),
                            "parking": parking.model_dump(),
                            "destination": destination.model_dump(),
                        },
                    )
                    response.raise_for_status()
                    pair = RoutePair.model_validate(response.json())
                    pair.source = "routing_provider"
                    return pair
            except (httpx.HTTPError, ValueError, TimeoutError):
                pass
        return estimate(origin, parking, destination)
