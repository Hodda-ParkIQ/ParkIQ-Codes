import { DEFAULT_BACKEND_URL, testToolsEnabled } from "./runtime-config";

const KEY = "parkiq-backend-url";
const EVENT = "parkiq:backend-config";

export function normalizeBackendUrl(value: string): string {
  const text = value.trim();
  if (!text) return "";
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error("http:// 또는 https://로 시작하는 서버 주소를 입력하세요.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "인증 정보·쿼리 없이 HTTP 또는 HTTPS 서버 주소를 입력하세요.",
    );
  }
  const path = url.pathname.replace(/\/+$/, "").replace(/\/api$/, "");
  return `${url.origin}${path}`;
}

export function getBackendUrl(): string {
  const allowTestTools = testToolsEnabled();
  if (allowTestTools) {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved !== null) return saved.trim();
    } catch {
      /* Storage may be unavailable; use the packaged default. */
    }
  }
  const fallback = allowTestTools ? "" : DEFAULT_BACKEND_URL;
  const configured =
    window.ParkIQNative?.getDefaultBackendUrl?.() ??
    import.meta.env.VITE_API_BASE_URL ??
    fallback;
  return configured.trim() || fallback;
}

export function saveBackendUrl(value: string): string {
  if (!testToolsEnabled()) throw new Error("이 앱은 기본 서버에 연결됩니다.");
  const normalized = normalizeBackendUrl(value);
  // Empty is a saved choice, so it overrides a build-time default as well.
  localStorage.setItem(KEY, normalized);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: normalized }));
  return normalized;
}

export function subscribeBackendUrl(listener: (value: string) => void) {
  const update = () => listener(getBackendUrl());
  const storage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) update();
  };
  window.addEventListener(EVENT, update);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(EVENT, update);
    window.removeEventListener("storage", storage);
  };
}
