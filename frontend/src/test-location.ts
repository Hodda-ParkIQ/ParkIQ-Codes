import type { Point } from "./types";
import { testToolsEnabled } from "./runtime-config";
import { isPoint } from "./geo";

const KEY = "parkiq-test-location";
export function readTestLocation(): Point | null {
  if (!testToolsEnabled()) return null;
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) || "null");
    return isPoint(value) ? { lat: value.lat, lng: value.lng } : null;
  } catch {
    return null;
  }
}
export function saveTestLocation(point: Point | null) {
  try {
    if (point) localStorage.setItem(KEY, JSON.stringify(point));
    else localStorage.removeItem(KEY);
  } catch {
    /* The session can still use a test position without storage. */
  }
}
