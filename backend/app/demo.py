"""Fictional facilities and counts for the Seongsu presentation scenario."""

from datetime import UTC, datetime, timedelta

from .models import ParkingLot, Place

PLACES = [
    Place(
        id="seongsu-cafe",
        name="성수 카페거리",
        address="서울 성동구 연무장길",
        category="카페 · 거리",
        lat=37.5446,
        lng=127.0542,
    ),
    Place(
        id="seoul-forest",
        name="서울숲",
        address="서울 성동구 뚝섬로 273",
        category="공원",
        lat=37.5445,
        lng=127.0374,
    ),
    Place(
        id="seongsu-station",
        name="성수역",
        address="서울 성동구 아차산로 100",
        category="지하철역",
        lat=37.5446,
        lng=127.0559,
    ),
    Place(
        id="seongsu-dining",
        name="성수 다이닝",
        address="서울 성동구 연무장길 일대 · 시연 장소",
        category="식당 · 시연",
        lat=37.5431,
        lng=127.0521,
    ),
]


def demo_lots() -> list[ParkingLot]:
    now = datetime.now(UTC)
    rows = [
        ("01", "연무장길 공영주차장", 37.5450, 127.0527, 120, 32, 1500, True, True, 40),
        ("02", "성수역 공유주차장", 37.5466, 127.0568, 80, 18, 1000, False, True, 75),
        ("03", "서울숲 스퀘어 주차장", 37.5412, 127.0472, 240, 86, 2000, True, True, 25),
        ("04", "성수 아틀리에 주차장", 37.5437, 127.0550, 42, 2, 2500, False, False, 90),
        ("05", "뚝섬 공영주차장", 37.5483, 127.0461, 160, 54, 600, False, True, 150),
        ("06", "연무장 타워 주차장", 37.5444, 127.0536, 60, 0, 1500, True, True, 30),
        ("07", "서울숲 서측 주차장", 37.5455, 127.0364, 180, 40, 1200, True, True, 80),
        ("08", "성수 동측 주차장", 37.5453, 127.0610, 50, None, 800, None, None, 1200),
    ]
    return [
        ParkingLot(
            id=f"demo:{id_}",
            name=name,
            lat=lat,
            lng=lng,
            address="서울 성동구 성수동 · 가상 시연 주차장",
            capacity=capacity,
            available=available,
            base_fee=fee,
            base_minutes=30,
            extra_fee=round(fee / 300) * 100,
            extra_minutes=10,
            daily_max=30000,
            ev=ev,
            accessible=accessible,
            is_open=True,
            source="demo",
            source_id=id_,
            observed_at=now - timedelta(seconds=age),
            fetched_at=now,
            demo=True,
        )
        for id_, name, lat, lng, capacity, available, fee, ev, accessible, age in rows
    ]
