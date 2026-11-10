from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class Point(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class Place(Point):
    id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=120)
    address: str = Field(default="", max_length=300)
    category: str = "목적지"


class ParkingLot(Place):
    capacity: int = Field(gt=0)
    available: int | None = Field(default=None, ge=0)
    base_fee: int | None = Field(default=None, ge=0)
    base_minutes: int = Field(default=30, gt=0)
    extra_fee: int | None = Field(default=None, ge=0)
    extra_minutes: int = Field(default=10, gt=0)
    daily_max: int | None = Field(default=None, ge=0)
    ev: bool | None = None
    accessible: bool | None = None
    is_open: bool | None = None
    source: str
    source_id: str
    coordinate_source: str | None = None
    observed_at: datetime | None = None
    fetched_at: datetime
    demo: bool = False

    @field_validator("observed_at", "fetched_at")
    @classmethod
    def timezone_required(cls, v: datetime | None) -> datetime | None:
        if v is not None and v.tzinfo is None:
            raise ValueError("timestamp must include a timezone")
        return v


Preference = Literal["balanced", "less_walking", "fastest", "cheapest"]


class RecommendationRequest(BaseModel):
    origin: Point
    destination: Place
    preference: Preference = "balanced"
    radius_m: int = Field(default=2000, ge=100, le=2000)
    stay_minutes: int = Field(default=60, ge=1, le=1440)
    ev_only: bool = False
    accessible_only: bool = False
    limit: int = Field(default=6, ge=1, le=20)


class Recommendation(BaseModel):
    lot: ParkingLot
    drive_minutes: float
    walk_minutes: float
    walk_meters: int
    search_minutes: float
    total_minutes: float
    estimated_fee: int | None
    risk: Literal["low", "medium", "high", "unknown"]
    stale: bool
    score: float
    reasons: list[str]
    routing_source: str
    drive_path: list[Point]
    walk_path: list[Point]


class RecommendationResponse(BaseModel):
    mode: Literal["demo", "live"]
    generated_at: datetime
    destination: Place
    preference: Preference
    candidates: list[Recommendation]
    excluded_full: int
    warnings: list[str]


class VoiceRequest(BaseModel):
    text: str = Field(min_length=1, max_length=300)


class VoiceIntent(BaseModel):
    action: Literal["search", "preference", "select", "navigate", "cancel", "unknown"]
    preference: Preference | None = None
    rank: int | None = None
    query: str | None = None
    reply: str
