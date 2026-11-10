from typing import Literal

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    data_mode: Literal["demo", "live"] = "demo"
    repository: Literal["memory", "postgres"] = "memory"
    database_url: SecretStr = SecretStr("postgresql://parkiq:parkiq@localhost:5432/parkiq")
    seoul_api_key: SecretStr = SecretStr("")
    seoul_base_url: str = "http://openapi.seoul.go.kr:8088"
    private_api_url: str = ""
    private_api_key: SecretStr = SecretStr("")
    routing_api_url: str = ""
    routing_api_key: SecretStr = SecretStr("")
    # Self-hosted Valhalla (OSM) base URL, e.g. http://valhalla:8002
    valhalla_url: str = ""
    admin_api_key: SecretStr = SecretStr("")
    sync_interval_seconds: int = 300
    sync_enabled: bool = False
    stale_after_seconds: int = 600
    # false = API-only hosting: never mount the built frontend, even if present.
    serve_frontend: bool = True
    # Comma-separated origins added to cors_origins, e.g. where the separately
    # hosted frontend lives: https://app.example.com,https://other.example.com
    cors_extra_origins: str = ""
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "https://appassets.androidplatform.net",
    ]
