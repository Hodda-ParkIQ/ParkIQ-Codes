import asyncio
import math
from datetime import UTC, datetime

from .config import Settings
from .models import ParkingLot, Recommendation, RecommendationRequest, RecommendationResponse
from .repository import Repository
from .routing import Router


def fee(lot: ParkingLot, stay: int) -> int | None:
    if lot.base_fee is None:
        return None
    remaining = max(0, stay - lot.base_minutes)
    if remaining and lot.extra_fee is None:
        return None
    amount = lot.base_fee + math.ceil(remaining / lot.extra_minutes) * (lot.extra_fee or 0)
    return min(amount, lot.daily_max) if lot.daily_max is not None else amount


async def recommend(
    req: RecommendationRequest, repo: Repository, router: Router, settings: Settings
) -> RecommendationResponse:
    now = datetime.now(UTC)
    lots = await repo.nearby(req.destination, req.radius_m)
    full_count = sum(lot.available == 0 for lot in lots)
    lots = [
        lot
        for lot in lots
        if lot.available != 0
        and lot.is_open is not False
        and (not req.ev_only or lot.ev is True)
        and (not req.accessible_only or lot.accessible is True)
    ]
    walk_weight, cost_weight = {
        "balanced": (1.25, 0.15),
        "less_walking": (3.5, 0.1),
        "fastest": (1.0, 0.0),
        "cheapest": (1.0, 4.0),
    }[req.preference]

    async def evaluate(lot: ParkingLot) -> Recommendation:
        route = await router.route(req.origin, lot, req.destination)
        age = (now - lot.observed_at).total_seconds() if lot.observed_at else float("inf")
        stale = age > settings.stale_after_seconds or age < -60
        # Unknown/stale counts are never interpreted as confirmed free spaces.
        unknown = stale or lot.available is None
        occupancy = 1 - (min(lot.available, lot.capacity) / lot.capacity) if not unknown else 0.75
        risk = (
            "unknown"
            if unknown
            else "high"
            if occupancy >= 0.9
            else "medium"
            if occupancy >= 0.7
            else "low"
        )
        search = round(5.0 if unknown else 0.8 + 5 * occupancy**3, 1)
        cost = fee(lot, req.stay_minutes)
        score = route.drive.minutes + search + route.walk.minutes * walk_weight
        score += (cost / 1000 if cost is not None else 8) * cost_weight
        score += 3 if unknown else 2 if risk == "high" else 0
        reasons = [f"목적지까지 도보 {route.walk.meters}m"]
        reasons.append("잔여 정보 확인 필요" if unknown else f"현재 {lot.available}면 여유")
        if req.preference == "less_walking":
            reasons.append("보행 부담을 우선 반영했어요")
        elif req.preference == "cheapest":
            reasons.append("예상 주차 요금을 우선 반영했어요")
        elif req.preference == "fastest":
            reasons.append("주행·탐색·도보 합계 시간을 우선 반영했어요")
        return Recommendation(
            lot=lot,
            drive_minutes=route.drive.minutes,
            walk_minutes=route.walk.minutes,
            walk_meters=route.walk.meters,
            search_minutes=search,
            total_minutes=round(route.drive.minutes + route.walk.minutes + search, 1),
            estimated_fee=cost,
            risk=risk,
            stale=stale,
            score=round(score, 3),
            reasons=reasons,
            routing_source=route.source,
            drive_path=route.drive.path,
            walk_path=route.walk.path,
        )

    candidates = await asyncio.gather(*(evaluate(lot) for lot in lots))
    candidates.sort(key=lambda item: (item.score, item.lot.id))
    candidates = candidates[: req.limit]
    warnings = []
    if settings.data_mode == "demo":
        warnings.append("가상 주차장·잔여 대수로 구성된 시연 데이터입니다.")
    if any(c.routing_source == "distance_estimate" for c in candidates):
        warnings.append(
            "이동 시간과 지도 경로는 거리 기반 추정이며 실시간 교통을 반영하지 않습니다."
        )
    if any(c.stale or c.lot.available is None for c in candidates):
        warnings.append("일부 주차장의 잔여 정보가 오래되었거나 제공되지 않습니다.")
    if not candidates:
        warnings.append("조건에 맞는 주차장이 없습니다. 필터나 목적지를 변경해 주세요.")
    return RecommendationResponse(
        mode=settings.data_mode,
        generated_at=now,
        destination=req.destination,
        preference=req.preference,
        candidates=candidates,
        excluded_full=full_count,
        warnings=warnings,
    )
