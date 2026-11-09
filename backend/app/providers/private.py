"""Contract adapter for an authorized private platform; no undocumented vendor API."""

import httpx
from pydantic import BaseModel, Field

from ..models import ParkingLot
from .seoul import ProviderError


class PrivateSnapshot(BaseModel):
    lots: list[ParkingLot] = Field(max_length=20000)


class PrivateProvider:
    name = "private"

    def __init__(self, url: str, key: str):
        self.url, self.key = url, key

    async def fetch(self) -> list[ParkingLot]:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(self.url, headers={"Authorization": f"Bearer {self.key}"})
            response.raise_for_status()
            snapshot = PrivateSnapshot.model_validate(response.json())
        if not snapshot.lots or any(lot.demo for lot in snapshot.lots):
            raise ProviderError("private returned empty or demo snapshot")
        # Provider namespaces cannot overwrite public records.
        return [
            lot.model_copy(update={"id": f"private:{lot.source_id}", "source": "private"})
            for lot in snapshot.lots
        ]
