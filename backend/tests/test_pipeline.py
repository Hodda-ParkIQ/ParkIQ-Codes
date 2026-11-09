from datetime import UTC, datetime

import httpx
import pytest
from app.config import Settings
from app.demo import demo_lots
from app.pipeline import Pipeline
from app.providers.seoul import ProviderError, SeoulProvider, normalize
from app.repository import MemoryRepository

METADATA = [
    {
        "PKLT_CD": "42",
        "PKLT_NM": "공영주차장",
        "ADDR": "서울시 성동구",
        "TPKCT": "100",
        "LAT": "37.544",
        "LOT": "127.05",
        "PRK_CRG": "1000",
        "PRK_HM": "30",
        "ADD_CRG": "500",
        "ADD_UNIT_TM_MNT": "10",
    }
]
OCCUPANCY = [
    {
        "PKLT_CD": "42",
        "TPKCT": 100,
        "NOW_PRK_VHCL_CNT": 70,
        "NOW_PRK_VHCL_UPDT_TM": "2026-11-09 17:00:00",
        "PRK_STTS_YN": "1",
    }
]


def test_seoul_joins_by_code_and_retains_observation_time():
    lot = normalize(METADATA, OCCUPANCY)[0]
    assert lot.id == "seoul:42" and lot.available == 30
    assert lot.observed_at == datetime(2026, 11, 9, 8, tzinfo=UTC)
    assert lot.base_fee == 1000 and lot.demo is False


def test_seoul_missing_timestamp_and_unlinked_status_are_unknown():
    for current in [
        {**OCCUPANCY[0], "NOW_PRK_VHCL_UPDT_TM": ""},
        {**OCCUPANCY[0], "PRK_STTS_YN": "0"},
    ]:
        assert normalize(METADATA, [current])[0].available is None
    assert normalize(METADATA, [])[0].available is None
    assert normalize([{**METADATA[0], "LAT": "0"}], OCCUPANCY) == []


async def test_seoul_pagination_and_provider_errors():
    def handler(request):
        start = request.url.path.split("/")[-3]
        return httpx.Response(
            200,
            json={
                "GetParkInfo": {
                    "RESULT": {"CODE": "INFO-000"},
                    "list_total_count": 1001,
                    "row": METADATA * 1000 if start == "1" else METADATA,
                }
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        assert (
            len(await SeoulProvider("key", "https://example.test").rows(client, "GetParkInfo"))
            == 1001
        )
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(200, json={"RESULT": {"CODE": "INFO-100"}})
        )
    ) as client:
        with pytest.raises(ProviderError):
            await SeoulProvider("key", "https://example.test").rows(client, "GetParkInfo")


async def test_failed_sync_keeps_previous_snapshot_and_timestamp():
    repo = MemoryRepository()
    lot = demo_lots()[0]
    await repo.upsert([lot])

    class BrokenProvider:
        name = "broken"

        async def fetch(self):
            raise RuntimeError("secret must not reach API responses")

    pipeline = Pipeline(Settings(_env_file=None), repo)
    pipeline.providers = [BrokenProvider()]
    status = await pipeline.sync()
    assert status["broken"]["state"] == "error"
    assert repo.lots[lot.id].observed_at == lot.observed_at
    assert "secret" not in str(status)
