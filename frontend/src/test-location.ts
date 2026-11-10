import type { Point } from "./types";

const KEY = "parkiq-test-location";
export function testLocationAvailable(): boolean {
  return !window.ParkIQNative || window.ParkIQNative.isDebugBuild?.() === true;
}
export function validLocation(value: unknown): value is Point {
  if (typeof value !== "object" || value === null) return false;
  const point = value as Point;
  return (
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    Math.abs(point.lat) <= 90 &&
    Math.abs(point.lng) <= 180
  );
}
export function readTestLocation(): Point | null {
  if (!testLocationAvailable()) return null;
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) || "null");
    return validLocation(value) ? { lat: value.lat, lng: value.lng } : null;
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
