"""Repair missing Seoul coordinates using the district's published public parking API.

Only an exact facility name AND land-lot address match is accepted. The district
feed is a coordinate reference, never a source of invented live availability.
"""

import math
import re
import unicodedata
from collections import defaultdict

PUBLIC_PARKING_URL = "https://parking.happysd.or.kr/OpenApi/sdPublicParkingList"


def valid_coordinates(lat, lng) -> bool:
    try:
        lat, lng = float(lat), float(lng)
        return math.isfinite(lat) and math.isfinite(lng) and 33 <= lat <= 39 and 124 <= lng <= 132
    except (ValueError, TypeError):
        return False


def _name(value: str) -> str:
    if not isinstance(value, str):
        return ""
    value = unicodedata.normalize("NFKC", value)
    value = re.sub(r"\((?:구|시)\)$", "", value.strip())
    return re.sub(r"\s+", "", value.replace("공영주차장", ""))


def _parcel(value: str) -> tuple[str, str] | None:
    if not isinstance(value, str):
        return None
    match = re.search(r"성동구\s+([가-힣0-9]+(?:동|가))\s+(\d+(?:-\d+)?)", value)
    return (match[1], match[2]) if match else None


def needs_coordinates(metadata: list[dict]) -> bool:
    return any(
        _parcel(row.get("ADDR", "")) and not valid_coordinates(row.get("LAT"), row.get("LOT"))
        for row in metadata
    )


def enrich_coordinates(metadata: list[dict], references: list[dict]) -> tuple[list[dict], int]:
    index: dict[tuple, set[tuple[float, float]]] = defaultdict(set)
    for reference in references:
        lat, lng = reference.get("위도_WGS84좌표"), reference.get("경도_WGS84좌표")
        if not valid_coordinates(lat, lng):
            continue
        name = _name(reference.get("주차장명", ""))
        if not name:
            continue
        for field in ("소재지지번주소", "소재지도로명주소"):
            parcel = _parcel(reference.get(field, ""))
            if parcel:
                index[(name, parcel)].add((float(lat), float(lng)))
    result, enriched = [], 0
    for row in metadata:
        parcel = _parcel(row.get("ADDR", ""))
        coordinates = index.get((_name(row.get("PKLT_NM", "")), parcel), set())
        if not valid_coordinates(row.get("LAT"), row.get("LOT")) and len(coordinates) == 1:
            lat, lng = next(iter(coordinates))
            row = {**row, "LAT": lat, "LOT": lng, "_coordinate_source": "seongdong_public_parking"}
            enriched += 1
        result.append(row)
    return result, enriched
