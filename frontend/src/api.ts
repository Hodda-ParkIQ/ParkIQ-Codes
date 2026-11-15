import type { Intent, Place, Point, Preference, Result } from "./types";
import { getBackendUrl, normalizeBackendUrl } from "./backend-config";
import { isPoint } from "./geo";
import { nativeRequest } from "./vehicle";
import { testToolsEnabled } from "./runtime-config";

export type Health = {
  mode: "demo" | "live";
  repository: string;
  configured_providers: string[];
};
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
function isPlace(v: unknown): v is Place & Record<string, unknown> {
  return (
    isPoint(v) &&
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.address === "string"
  );
}
function isRecommendationResult(v: unknown): v is Result {
  if (
    !isRecord(v) ||
    !["demo", "live"].includes(String(v.mode)) ||
    !Array.isArray(v.candidates) ||
    !isPlace(v.destination) ||
    !Array.isArray(v.warnings)
  )
    return false;
  return v.candidates.every(
    (c) =>
      isRecord(c) &&
      isPlace(c.lot) &&
      typeof c.lot.demo === "boolean" &&
      (v.mode !== "live" || c.lot.demo === false) &&
      isFiniteNumber(c.lot.capacity) &&
      (c.lot.available === null || isFiniteNumber(c.lot.available)) &&
      [
        "drive_minutes",
        "walk_minutes",
        "walk_meters",
        "search_minutes",
        "total_minutes",
        "score",
      ].every((key) => isFiniteNumber(c[key])) &&
      (c.estimated_fee === null || isFiniteNumber(c.estimated_fee)) &&
      ["low", "medium", "high", "unknown"].includes(String(c.risk)) &&
      typeof c.stale === "boolean" &&
      Array.isArray(c.reasons) &&
      typeof c.routing_source === "string" &&
      Array.isArray(c.drive_path) &&
      c.drive_path.every(isPoint) &&
      Array.isArray(c.walk_path) &&
      c.walk_path.every(isPoint),
  );
}
function isBackendHealth(v: unknown): v is Health {
  return (
    isRecord(v) &&
    ["demo", "live"].includes(String(v.mode)) &&
    typeof v.repository === "string" &&
    Array.isArray(v.configured_providers)
  );
}
function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted)
    throw new DOMException("요청을 취소했습니다.", "AbortError");
}

async function requestBackend(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  baseUrl = normalizeBackendUrl(baseUrl);
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  throwIfAborted(init.signal ?? undefined);
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
        !isRecord(response) ||
        !isFiniteNumber(response.status) ||
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
        isRecord(data) && typeof data.detail === "string"
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
  const data = await requestBackend(baseUrl, "/health", { signal });
  if (!isBackendHealth(data))
    throw new Error("ParkIQ 백엔드의 상태 API 형식이 올바르지 않습니다.");
  if (!testToolsEnabled() && data.mode !== "live")
    throw new Error("서버가 실데이터 모드로 설정되어 있지 않습니다.");
  return data;
}
export const api = {
  async places(query = "", signal?: AbortSignal): Promise<{ places: Place[] }> {
    throwIfAborted(signal);
    const baseUrl = getBackendUrl();
    if (!baseUrl) {
      const { localPlaces } = await import("./local-api");
      throwIfAborted(signal);
      return localPlaces(query);
    }
    const q = query.trim();
    const data = await requestBackend(
      baseUrl,
      q ? `/places?q=${encodeURIComponent(q)}` : "/places",
      { signal },
    );
    if (
      !isRecord(data) ||
      !Array.isArray(data.places) ||
      !data.places.every(isPlace)
    )
      throw new Error("서버의 목적지 목록 형식이 올바르지 않습니다.");
    return {
      places: testToolsEnabled()
        ? data.places
        : data.places.filter((place) => !place.category?.includes("시연")),
    };
  },
  async health(signal?: AbortSignal): Promise<Health> {
    throwIfAborted(signal);
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
    throwIfAborted(signal);
    const baseUrl = getBackendUrl();
    if (!baseUrl) {
      const { localRecommendations } = await import("./local-api");
      throwIfAborted(signal);
      return localRecommendations(
        origin,
        destination,
        preference,
        stay_minutes,
        ev_only,
      );
    }
    const data = await requestBackend(baseUrl, "/recommendations", {
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
    if (!isRecommendationResult(data))
      throw new Error("서버의 주차 추천 응답 형식이 올바르지 않습니다.");
    if (!testToolsEnabled() && data.mode !== "live")
      throw new Error("서버가 실데이터 모드로 설정되어 있지 않습니다.");
    return data;
  },
  async voice(text: string): Promise<Intent> {
    const baseUrl = getBackendUrl();
    if (!baseUrl) {
      const { localVoice } = await import("./local-api");
      return localVoice(text);
    }
    const data = await requestBackend(baseUrl, "/voice/interpret", {
      method: "POST",
      body: JSON.stringify({ text }),
    });
    if (
      !isRecord(data) ||
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
