"""Seoul GetParkInfo metadata joined to GetParkingInfo occupancy (2026 schema)."""

from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import httpx

from ..models import ParkingLot


class ProviderError(Exception):
    pass


def number(value, default=None):
    if value is None or str(value).strip() == "":
        return default
    try:
        return int(float(str(value).replace(",", "")))
    except (ValueError, TypeError, OverflowError):
        return default


def timestamp(value) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value))
        return (
            parsed.replace(tzinfo=ZoneInfo("Asia/Seoul")) if parsed.tzinfo is None else parsed
        ).astimezone(UTC)
    except ValueError:
        return None


def normalize(metadata: list[dict], occupancy: list[dict]) -> list[ParkingLot]:
    live = {str(row.get("PKLT_CD")): row for row in occupancy}
    now = datetime.now(UTC)
    lots = []
    for row in metadata:
        id_ = str(row.get("PKLT_CD", ""))
        if not id_:
            continue
        current = live.get(id_, {})
        capacity = number(current.get("TPKCT"), number(row.get("TPKCT"), 0))
        if not capacity or capacity <= 0:
            continue
        occupied = number(current.get("NOW_PRK_VHCL_CNT"))
        available = (
            max(0, min(capacity, capacity - occupied))
            if occupied is not None and occupied >= 0
            else None
        )
        # Missing/invalid timestamps stay unknown rather than acquiring the fetch time.
        observed = timestamp(current.get("NOW_PRK_VHCL_UPDT_TM"))
        if str(current.get("PRK_STTS_YN", "")) != "1" or observed is None:
            available = None
        try:
            lat, lng = float(row["LAT"]), float(row["LOT"])
            if not (33 <= lat <= 39 and 124 <= lng <= 132):
                continue
            lots.append(
                ParkingLot(
                    id=f"seoul:{id_}",
                    source="seoul",
                    source_id=id_,
                    name=row["PKLT_NM"],
                    address=row.get("ADDR", ""),
                    lat=lat,
                    lng=lng,
                    capacity=capacity,
                    available=available,
                    observed_at=observed,
                    fetched_at=now,
                    base_fee=number(current.get("BSC_PRK_CRG"), number(row.get("PRK_CRG"))),
                    base_minutes=max(
                        1, number(current.get("BSC_PRK_HR"), number(row.get("PRK_HM"), 30))
                    ),
                    extra_fee=number(current.get("ADD_PRK_CRG"), number(row.get("ADD_CRG"))),
                    extra_minutes=max(
                        1, number(current.get("ADD_PRK_HR"), number(row.get("ADD_UNIT_TM_MNT"), 10))
                    ),
                    daily_max=number(current.get("DAY_MAX_CRG")) or None,
                )
            )
        except (KeyError, ValueError, TypeError):
            continue
    return lots


class SeoulProvider:
    name = "seoul"

    def __init__(self, key: str, base_url: str):
        self.key, self.base_url = key, base_url.rstrip("/")

    async def rows(self, client: httpx.AsyncClient, service: str) -> list[dict]:
        all_rows = []
        for start in range(1, 50001, 1000):
            response = await client.get(
                f"{self.base_url}/{self.key}/json/{service}/{start}/{start + 999}/"
            )
            response.raise_for_status()
            payload = response.json()
            block = payload.get(service, payload)
            code = block.get("RESULT", {}).get("CODE")
            if code == "INFO-200":
                break
            if code != "INFO-000":
                raise ProviderError(f"seoul/{service}: invalid response code")
            rows = block.get("row", [])
            all_rows.extend(rows)
            if len(all_rows) >= int(block.get("list_total_count", 0)) or not rows:
                return all_rows
        else:
            raise ProviderError("seoul pagination limit exceeded")
        return all_rows

    async def fetch(self) -> list[ParkingLot]:
        if not self.key:
            raise ProviderError("seoul credentials missing")
        async with httpx.AsyncClient(timeout=15) as client:
            metadata = await self.rows(client, "GetParkInfo")
            occupancy = await self.rows(client, "GetParkingInfo")
        lots = normalize(metadata, occupancy)
        if not lots:
            raise ProviderError("seoul returned no usable facilities")
        return lots
