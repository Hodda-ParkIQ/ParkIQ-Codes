import copy
from datetime import UTC, datetime

import httpx
import pytest
from app.providers.seongdong import PUBLIC_PARKING_URL, enrich_coordinates, needs_coordinates
from app.providers.seoul import SeoulProvider, normalize

METADATA = {
    "PKLT_CD": "172130",
    "PKLT_NM": "성수2가3동(건물) 공영주차장(구)",
    "ADDR": "성동구 성수동2가 299-19",
    "TPKCT": 192,
    "LAT": 0,
    "LOT": 0,
}
REFERENCE = {
    "주차장명": "성수2가3동(건물)",
    "소재지지번주소": "서울특별시 성동구 성수동2가 299-19 성수2가 공영주차장",
    "소재지도로명주소": "서울특별시 성동구 광나루로4가길 23",
    "위도_WGS84좌표": "37.5490127",
    "경도_WGS84좌표": "127.0549305",
}


def test_exact_name_and_parcel_repair_coordinates_without_fabricating_availability():
    original = copy.deepcopy(METADATA)
    rows, count = enrich_coordinates([METADATA], [REFERENCE])
    assert count == 1 and METADATA == original
    lot = normalize(rows, [])[0]
    assert lot.lat == 37.5490127 and lot.lng == 127.0549305
    assert lot.id == "seoul:172130" and lot.demo is False
    assert lot.coordinate_source == "seongdong_public_parking"
    assert lot.available is None and lot.observed_at is None


@pytest.mark.parametrize(
    "reference",
    [
        {**REFERENCE, "주차장명": "거주자우선주차 성수2가3동(건물)"},
        {**REFERENCE, "소재지지번주소": "서울특별시 성동구 성수동2가 299-20"},
        {**REFERENCE, "위도_WGS84좌표": "0"},
        {**REFERENCE, "위도_WGS84좌표": "nan"},
    ],
)
def test_wrong_name_address_or_invalid_reference_is_not_used(reference):
    assert enrich_coordinates([METADATA], [reference]) == ([METADATA], 0)


def test_ambiguous_references_and_valid_primary_coordinates_are_not_overridden():
    assert enrich_coordinates(
        [METADATA], [REFERENCE, {**REFERENCE, "위도_WGS84좌표": "37.55"}]
    ) == ([METADATA], 0)
    valid = {**METADATA, "LAT": 37.54, "LOT": 127.05}
    assert not needs_coordinates([valid])
    assert enrich_coordinates([valid], [REFERENCE]) == ([valid], 0)


def test_repair_preserves_actual_occupancy_and_original_observation_time():
    rows, _ = enrich_coordinates([METADATA], [REFERENCE])
    lot = normalize(
        rows,
        [
            {
                "PKLT_CD": "172130",
                "TPKCT": 192,
                "NOW_PRK_VHCL_CNT": 180,
                "NOW_PRK_VHCL_UPDT_TM": "2026-11-10 18:00:00",
                "PRK_STTS_YN": "1",
            }
        ],
    )[0]
    assert lot.available == 12
    assert lot.observed_at == datetime(2026, 11, 10, 9, tzinfo=UTC)


@pytest.mark.parametrize("reference_available", [True, False])
async def test_provider_fetch_repairs_or_keeps_primary_data_if_reference_fails(
    monkeypatch, reference_available
):
    calls = []
    valid = {**METADATA, "PKLT_CD": "valid", "LAT": 37.54, "LOT": 127.05}

    def handler(request):
        calls.append(str(request.url))
        if str(request.url) == PUBLIC_PARKING_URL:
            return (
                httpx.Response(200, json=[REFERENCE])
                if reference_available
                else httpx.Response(503)
            )
        service = "GetParkingInfo" if "GetParkingInfo" in request.url.path else "GetParkInfo"
        rows = [] if service == "GetParkingInfo" else [METADATA, valid]
        return httpx.Response(
            200,
            json={
                service: {
                    "RESULT": {"CODE": "INFO-000"},
                    "list_total_count": len(rows),
                    "row": rows,
                }
            },
        )

    original_client = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kwargs: original_client(**kwargs, transport=httpx.MockTransport(handler)),
    )
    provider = SeoulProvider("test-key", "https://primary.test")
    lots = await provider.fetch()
    assert PUBLIC_PARKING_URL in calls
    assert len(lots) == (2 if reference_available else 1)
    assert provider.diagnostics["coordinate_enriched"] == (1 if reference_available else 0)
    assert provider.diagnostics["coordinate_reference"] == (
        "seongdong_public_parking" if reference_available else "unavailable"
    )
