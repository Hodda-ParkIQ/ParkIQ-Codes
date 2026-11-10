import asyncio
import logging
from datetime import UTC, datetime

from .config import Settings
from .providers.private import PrivateProvider
from .providers.seoul import SeoulProvider
from .repository import Repository

logger = logging.getLogger(__name__)


class Pipeline:
    def __init__(self, settings: Settings, repo: Repository):
        self.settings, self.repo = settings, repo
        self.status: dict[str, dict] = {}
        self.lock = asyncio.Lock()
        self.providers = []
        if settings.seoul_api_key.get_secret_value():
            self.providers.append(
                SeoulProvider(settings.seoul_api_key.get_secret_value(), settings.seoul_base_url)
            )
        if settings.private_api_url:
            self.providers.append(
                PrivateProvider(
                    settings.private_api_url, settings.private_api_key.get_secret_value()
                )
            )

    async def sync(self):
        async with self.lock:
            for provider in self.providers:
                previous = self.status.get(provider.name, {})
                try:
                    lots = await provider.fetch()
                    await self.repo.upsert(lots)
                    self.status[provider.name] = {
                        "state": "ok",
                        "count": len(lots),
                        "last_success": datetime.now(UTC).isoformat(),
                        "diagnostics": getattr(provider, "diagnostics", {}),
                    }
                except Exception:
                    # Upstream URLs may contain credentials. Never log exceptions/response bodies.
                    logger.warning("Provider sync failed: %s", provider.name)
                    self.status[provider.name] = {
                        **previous,
                        "state": "error",
                        "message": "수집 실패: 기존 데이터를 유지합니다.",
                    }
        return self.status

    async def run(self):
        while True:
            await self.sync()
            await asyncio.sleep(max(30, self.settings.sync_interval_seconds))
