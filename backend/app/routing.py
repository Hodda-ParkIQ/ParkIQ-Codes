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


def decode_polyline(encoded: str, precision: int = 6) -> list[Point]:
    """Decode a Google-style encoded polyline (Valhalla uses precision 6)."""
    factor = 10**precision
    points: list[Point] = []
    index = lat = lng = 0
    while index < len(encoded):
        deltas = []
        for _ in range(2):
            shift = result = 0
            while True:
                byte = ord(encoded[index]) - 63
                index += 1
                result |= (byte & 0x1F) << shift
                shift += 5
                if byte < 0x20:
                    break
            deltas.append(~(result >> 1) if result & 1 else result >> 1)
        lat += deltas[0]
        lng += deltas[1]
        points.append(Point(lat=lat / factor, lng=lng / factor))
    return points


async def valhalla_leg(
    client: httpx.AsyncClient, base_url: str, start: Point, end: Point, costing: str
) -> Leg:
    response = await client.post(
        f"{base_url.rstrip('/')}/route",
        json={
            "locations": [
                {"lat": start.lat, "lon": start.lng},
                {"lat": end.lat, "lon": end.lng},
            ],
            "costing": costing,
            "units": "kilometers",
            "directions_type": "none",
        },
    )
    response.raise_for_status()
    trip = response.json()["trip"]
    path = [p for leg in trip["legs"] for p in decode_polyline(leg["shape"])]
    if len(path) < 2:
        # Start and end snapped to the same point; keep a drawable segment.
        path = [start, end]
    return Leg(
        minutes=round(max(0.1, trip["summary"]["time"] / 60), 1),
        meters=round(trip["summary"]["length"] * 1000),
        path=path,
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
        if self.settings.valhalla_url:
            try:
                async with (
                    asyncio.timeout(4),
                    self.semaphore,
                    httpx.AsyncClient(timeout=3) as client,
                ):
                    drive, walk = await asyncio.gather(
                        valhalla_leg(client, self.settings.valhalla_url, origin, parking, "auto"),
                        valhalla_leg(
                            client, self.settings.valhalla_url, parking, destination, "pedestrian"
                        ),
                    )
                    return RoutePair(drive=drive, walk=walk, source="valhalla")
            except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError, TimeoutError):
                pass
        return estimate(origin, parking, destination)
