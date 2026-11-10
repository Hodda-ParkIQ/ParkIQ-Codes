import type { Intent, Place, Point, Preference, Result } from "./types";
import { getBackendUrl, normalizeBackendUrl } from "./backend-config";
import { localPlaces, localRecommendations, localVoice } from "./local-api";
import { nativeRequest } from "./vehicle";

export type Health = {
  mode: "demo" | "live";
  repository: string;
  configured_providers: string[];
};
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const validPoint = (v: unknown): v is Point & Record<string, unknown> =>
  object(v) &&
  finite(v.lat) &&
  finite(v.lng) &&
  Math.abs(v.lat) <= 90 &&
  Math.abs(v.lng) <= 180;
function validPlace(v: unknown): v is Place & Record<string, unknown> {
  return (
    validPoint(v) &&
    object(v) &&
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.address === "string"
  );
}
function validResult(v: unknown): v is Result {
  if (
    !object(v) ||
    !["demo", "live"].includes(String(v.mode)) ||
    !Array.isArray(v.candidates) ||
    !validPlace(v.destination) ||
    !Array.isArray(v.warnings)
  )
    return false;
  return v.candidates.every(
    (c) =>
      object(c) &&
      object(c.lot) &&
      validPlace(c.lot) &&
      typeof c.lot.demo === "boolean" &&
      (v.mode !== "live" || c.lot.demo === false) &&
      finite(c.lot.capacity) &&
      (c.lot.available === null || finite(c.lot.available)) &&
      [
        "drive_minutes",
        "walk_minutes",
        "walk_meters",
        "search_minutes",
        "total_minutes",
        "score",
      ].every((key) => finite(c[key])) &&
      (c.estimated_fee === null || finite(c.estimated_fee)) &&
      ["low", "medium", "high", "unknown"].includes(String(c.risk)) &&
      typeof c.stale === "boolean" &&
      Array.isArray(c.reasons) &&
      typeof c.routing_source === "string" &&
      Array.isArray(c.drive_path) &&
      c.drive_path.every(validPoint) &&
      Array.isArray(c.walk_path) &&
      c.walk_path.every(validPoint),
  );
}
function validHealth(v: unknown): v is Health {
  return (
    object(v) &&
    ["demo", "live"].includes(String(v.mode)) &&
    typeof v.repository === "string" &&
    Array.isArray(v.configured_providers)
  );
}
function aborted(signal?: AbortSignal) {
  if (signal?.aborted)
    throw new DOMException("요청을 취소했습니다.", "AbortError");
}

async function remote(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  baseUrl = normalizeBackendUrl(baseUrl);
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  aborted(init.signal ?? undefined);
  init.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 12000);
  try {
    let status: number, body: string;
    if (window.ParkIQNative) {
      const response = await nativeRequest(
        "backend.request",
        {
          baseUrl,
          path,
          method: init.method ?? "GET",
          body: typeof init.body === "string" ? init.body : null,
        },
        { signal: controller.signal, timeoutMs: 13000 },
      );
      if (
        !object(response) ||
        !finite(response.status) ||
        typeof response.body !== "string"
      )
        throw new Error("차량 호스트의 서버 응답을 확인할 수 없습니다.");
      status = response.status;
      body = response.body;
    } else {
      const response = await fetch(`${baseUrl}/api${path}`, {
        ...init,
        signal: controller.signal,
        headers: init.body
          ? { "Content-Type": "application/json", ...init.headers }
          : init.headers,
      });
      status = response.status;
      body = await response.text();
    }
    let data: unknown;
    try {
      data = JSON.parse(body);
    } catch {
      throw new Error("서버가 올바른 JSON API 응답을 반환하지 않았습니다.");
    }
    if (status < 200 || status >= 300)
      throw new Error(
        object(data) && typeof data.detail === "string"
          ? data.detail
          : `서버 요청에 실패했습니다. (${status})`,
      );
    return data;
  } catch (error) {
    if (timedOut)
      throw new Error(
        "서버 연결 시간이 초과되었습니다. 서버 주소와 연결 상태를 확인하세요.",
      );
    if (controller.signal.aborted)
      throw new DOMException("요청을 취소했습니다.", "AbortError");
    if (error instanceof TypeError)
      throw new Error(
        "서버에 연결할 수 없습니다. 서버 주소·네트워크·CORS 설정을 확인하세요.",
      );
    throw error;
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", abort);
  }
}

export async function checkBackend(
  value: string,
  signal?: AbortSignal,
): Promise<Health> {
  const baseUrl = normalizeBackendUrl(value);
  if (!baseUrl) throw new Error("연결할 서버 주소를 입력하세요.");
  const data = await remote(baseUrl, "/health", { signal });
  if (!validHealth(data))
    throw new Error("ParkIQ 백엔드의 상태 API 형식이 올바르지 않습니다.");
  return data;
}
export const api = {
  async places(query = "", signal?: AbortSignal): Promise<{ places: Place[] }> {
    aborted(signal);
    const baseUrl = getBackendUrl();
    if (!baseUrl) return localPlaces(query);
    const q = query.trim();
    const data = await remote(
      baseUrl,
      q ? `/places?q=${encodeURIComponent(q)}` : "/places",
      { signal },
    );
    if (
      !object(data) ||
      !Array.isArray(data.places) ||
      !data.places.every(validPlace)
    )
      throw new Error("서버의 목적지 목록 형식이 올바르지 않습니다.");
    return { places: data.places };
  },
  async health(signal?: AbortSignal): Promise<Health> {
    aborted(signal);
    const baseUrl = getBackendUrl();
    return baseUrl
      ? checkBackend(baseUrl, signal)
      : { mode: "demo", repository: "internal", configured_providers: [] };
  },
  async recommend(
    origin: Point,
    destination: Place,
    preference: Preference,
    stay_minutes: number,
    ev_only: boolean,
    signal?: AbortSignal,
  ): Promise<Result> {
    aborted(signal);
    const baseUrl = getBackendUrl();
    if (!baseUrl)
      return localRecommendations(
        origin,
        destination,
        preference,
        stay_minutes,
        ev_only,
      );
    const data = await remote(baseUrl, "/recommendations", {
      method: "POST",
      signal,
      body: JSON.stringify({
        origin,
        destination,
        preference,
        stay_minutes,
        ev_only,
      }),
    });
    if (!validResult(data))
      throw new Error("서버의 주차 추천 응답 형식이 올바르지 않습니다.");
    return data;
  },
  async voice(text: string): Promise<Intent> {
    const baseUrl = getBackendUrl();
    if (!baseUrl) return localVoice(text);
    const data = await remote(baseUrl, "/voice/interpret", {
      method: "POST",
      body: JSON.stringify({ text }),
    });
    if (
      !object(data) ||
      ![
        "search",
        "preference",
        "select",
        "navigate",
        "cancel",
        "unknown",
      ].includes(String(data.action)) ||
      typeof data.reply !== "string"
    )
      throw new Error("서버의 음성 명령 응답 형식이 올바르지 않습니다.");
    return data as Intent;
  },
};
