import json

import httpx
import pytest
from app import routing
from app.config import Settings
from app.models import Point
from app.routing import Router, decode_polyline

ORIGIN = Point(lat=37.5385, lng=127.0602)
PARKING = Point(lat=37.5446, lng=127.0542)
DESTINATION = Point(lat=37.5448, lng=127.0552)


def encode(points: list[tuple[float, float]], precision: int = 6) -> str:
    factor, out, prev = 10**precision, [], (0, 0)
    for lat, lng in points:
        cur = (round(lat * factor), round(lng * factor))
        for delta in (cur[0] - prev[0], cur[1] - prev[1]):
            value = ~(delta << 1) if delta < 0 else delta << 1
            while value >= 0x20:
                out.append(chr((0x20 | (value & 0x1F)) + 63))
                value >>= 5
            out.append(chr(value + 63))
        prev = cur
    return "".join(out)


def test_decode_polyline_reference_vector():
    points = decode_polyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@", precision=5)
    assert [(p.lat, p.lng) for p in points] == [
        (38.5, -120.2),
        (40.7, -120.95),
        (43.252, -126.453),
    ]


def use_transport(monkeypatch, handler):
    real = httpx.AsyncClient
    monkeypatch.setattr(
        routing.httpx,
        "AsyncClient",
        lambda **kwargs: real(transport=httpx.MockTransport(handler), **kwargs),
    )


@pytest.mark.asyncio
async def test_valhalla_routes_drive_and_walk(monkeypatch):
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        seen.append(body["costing"])
        assert request.url.path == "/route"
        start, end = body["locations"]
        shape = encode([(start["lat"], start["lon"]), (37.541, 127.057), (end["lat"], end["lon"])])
        return httpx.Response(
            200,
            json={"trip": {"summary": {"time": 300, "length": 1.234}, "legs": [{"shape": shape}]}},
        )

    use_transport(monkeypatch, handler)
    settings = Settings(_env_file=None, valhalla_url="http://valhalla:8002/")
    pair = await Router(settings).route(ORIGIN, PARKING, DESTINATION)

    assert sorted(seen) == ["auto", "pedestrian"]
    assert pair.source == "valhalla"
    assert pair.drive.minutes == 5.0 and pair.drive.meters == 1234
    assert len(pair.drive.path) == 3
    assert pair.drive.path[0] == ORIGIN and pair.drive.path[-1] == PARKING
    assert pair.walk.path[0] == PARKING and pair.walk.path[-1] == DESTINATION


@pytest.mark.asyncio
async def test_valhalla_failure_falls_back_to_estimate(monkeypatch):
    use_transport(monkeypatch, lambda request: httpx.Response(400, json={"error": "no route"}))
    settings = Settings(_env_file=None, valhalla_url="http://valhalla:8002")
    pair = await Router(settings).route(ORIGIN, PARKING, DESTINATION)
    assert pair.source == "distance_estimate"
