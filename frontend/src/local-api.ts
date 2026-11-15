import fixture from "./data/demo.json";
import { distance } from "./geo";
import type {
  Candidate,
  Intent,
  Lot,
  Place,
  Point,
  Preference,
  Result,
} from "./types";

type Fixture = {
  places: Place[];
  lots: (Omit<Lot, "observed_at" | "fetched_at"> & {
    observed_age_seconds: number | null;
  })[];
};
const data = fixture as Fixture;
const loadedAt = Date.now();
const lots: Lot[] = data.lots.map(({ observed_age_seconds, ...lot }) => ({
  ...lot,
  observed_at:
    observed_age_seconds === null
      ? null
      : new Date(loadedAt - observed_age_seconds * 1000).toISOString(),
  fetched_at: new Date(loadedAt).toISOString(),
  demo: true,
}));
const round = (value: number, digits = 0) => Number(value.toFixed(digits));
const point = ({ lat, lng }: Point): Point => ({ lat, lng });
function fee(lot: Lot, stay: number): number | null {
  if (lot.base_fee === null) return null;
  const remaining = Math.max(0, stay - lot.base_minutes);
  if (remaining && lot.extra_fee === null) return null;
  const value =
    lot.base_fee +
    Math.ceil(remaining / lot.extra_minutes) * (lot.extra_fee ?? 0);
  return lot.daily_max === null ? value : Math.min(value, lot.daily_max);
}

export function localRecommendations(
  origin: Point,
  destination: Place,
  preference: Preference,
  stay: number,
  evOnly: boolean,
): Result {
  const now = Date.now();
  const [walkingWeight, feeWeight] = {
    balanced: [1.25, 0.15],
    less_walking: [3.5, 0.1],
    fastest: [1, 0],
    cheapest: [1, 4],
  }[preference];
  const nearby = lots.filter((lot) => distance(destination, lot) <= 2000);
  const candidates: Candidate[] = nearby
    .filter(
      (lot) =>
        lot.available !== 0 &&
        lot.is_open !== false &&
        (!evOnly || lot.ev === true),
    )
    .map((lot) => {
      const driveMeters = round(distance(origin, lot) * 1.35),
        walkMeters = round(distance(lot, destination) * 1.2);
      const drive = round(Math.max(1, driveMeters / 250 + 1.5), 1),
        walk = round(Math.max(0.5, walkMeters / 75), 1);
      const age = lot.observed_at
        ? (now - Date.parse(lot.observed_at)) / 1000
        : Infinity;
      const stale = age > 600 || age < -60,
        unknown = stale || lot.available === null;
      const occupancy = unknown
        ? 0.75
        : 1 - Math.min(lot.available!, lot.capacity) / lot.capacity;
      const risk = unknown
        ? "unknown"
        : occupancy >= 0.9
          ? "high"
          : occupancy >= 0.7
            ? "medium"
            : "low";
      const search = round(unknown ? 5 : 0.8 + 5 * occupancy ** 3, 1),
        cost = fee(lot, stay);
      const score =
        drive +
        search +
        walk * walkingWeight +
        (cost === null ? 8 : cost / 1000) * feeWeight +
        (unknown ? 3 : risk === "high" ? 2 : 0);
      return {
        lot: { ...lot },
        drive_minutes: drive,
        walk_minutes: walk,
        walk_meters: walkMeters,
        search_minutes: search,
        total_minutes: round(drive + walk + search, 1),
        estimated_fee: cost,
        risk,
        stale,
        score: round(score, 3),
        reasons: [
          `목적지까지 도보 ${walkMeters}m`,
          unknown ? "잔여 정보 확인 필요" : `현재 ${lot.available}면 여유`,
        ],
        routing_source: "distance_estimate",
        drive_path: [
          point(origin),
          { lat: origin.lat, lng: lot.lng },
          point(lot),
        ],
        walk_path: [
          point(lot),
          { lat: lot.lat, lng: destination.lng },
          point(destination),
        ],
      };
    });
  candidates.sort(
    (a, b) => a.score - b.score || a.lot.id.localeCompare(b.lot.id),
  );
  const warnings = [
    "앱 내부의 가상 시연 데이터입니다.",
    "이동 시간과 경로는 거리 기반 추정입니다.",
  ];
  if (!candidates.length) warnings.push("조건에 맞는 주차장이 없습니다.");
  return {
    mode: "demo",
    generated_at: new Date().toISOString(),
    destination,
    preference,
    candidates: candidates.slice(0, 6),
    excluded_full: nearby.filter((lot) => lot.available === 0).length,
    warnings,
  };
}

export function localVoice(text: string): Intent {
  const value = text.replace(/\s+/g, "");
  const make = (
    action: Intent["action"],
    reply: string,
    extra: Partial<Intent> = {},
  ): Intent => ({
    action,
    reply,
    preference: null,
    rank: null,
    query: null,
    ...extra,
  });
  if (["취소", "그만", "중지"].some((w) => value.includes(w)))
    return make("cancel", "경로 안내를 취소할게요.");
  if (
    ["안내시작", "경로안내", "여기로", "출발", "안내해"].some((w) =>
      value.includes(w),
    )
  )
    return make("navigate", "선택한 주차장으로 안내를 요청할게요.");
  const rank = value.match(/([1-6])(?:번|번째)/)?.[1];
  const wordRank = ["첫번째", "두번째", "세번째"].findIndex((w) =>
    value.includes(w),
  );
  if (rank || wordRank >= 0)
    return make("select", "주차장을 선택했어요. 안내 시작이라고 말해 주세요.", {
      rank: rank ? Number(rank) : wordRank + 1,
    });
  const preferences: [string[], Preference, string][] = [
    [
      ["덜걷", "적게걷", "걷기싫", "도보최소", "가까운"],
      "less_walking",
      "목적지까지 덜 걷는 주차장을 찾아볼게요.",
    ],
    [
      ["저렴", "싼", "요금우선", "무료"],
      "cheapest",
      "예상 요금이 낮은 주차장을 우선할게요.",
    ],
    [
      ["빠른", "빨리", "최단시간"],
      "fastest",
      "전체 이동 시간이 짧은 주차장을 찾아볼게요.",
    ],
    [
      ["균형", "추천순", "스마트추천"],
      "balanced",
      "이동 시간과 도보 거리를 함께 고려할게요.",
    ],
  ];
  for (const [words, preference, reply] of preferences)
    if (words.some((w) => value.includes(w)))
      return make("preference", reply, { preference });
  for (const query of ["서울숲", "성수역", "카페거리", "다이닝"])
    if (value.includes(query))
      return make("search", `${query} 주변 주차장을 찾아볼게요.`, { query });
  return make(
    "unknown",
    "덜 걷는 곳, 저렴한 곳, 2번 선택, 안내 시작이라고 말해 보세요.",
  );
}
export const localPlaces = (query = "") => {
  const q = query.trim().toLowerCase();
  const match = (p: Place) => (p.name + p.address).toLowerCase().includes(q);
  const lotHits: Place[] = q
    ? lots.filter(match).map((lot) => ({
        id: `lot:${lot.id}`,
        name: lot.name,
        address: lot.address,
        lat: lot.lat,
        lng: lot.lng,
        category: "주차장",
      }))
    : [];
  return {
    places: [
      ...data.places.filter(match).map((place) => ({ ...place })),
      ...lotHits,
    ],
  };
};
