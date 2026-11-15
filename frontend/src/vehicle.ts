import type { Candidate, GleoCall, Place, VehicleState } from "./types";

declare global {
  interface Window {
    ParkIQNative?: {
      postMessage: (message: string) => void;
      getDefaultBackendUrl?: () => string;
      isDebugBuild?: () => boolean;
      isTestBuild?: () => boolean;
    };
  }
}
type Reply = { id: string; ok: boolean; error?: string; data?: unknown };

// ParkIQ's own host contract, not a fictional Pleos JavaScript SDK.
export function nativeRequest(
  method: string,
  params: unknown,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new DOMException("요청을 취소했습니다.", "AbortError"));
      return;
    }
    if (!window.ParkIQNative) {
      reject(new Error("차량 호스트가 연결되지 않았습니다."));
      return;
    }
    const id =
      globalThis.crypto?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("차량 응답 시간이 초과되었습니다."));
    }, options.timeoutMs ?? 6000);
    function abort() {
      cleanup();
      reject(new DOMException("요청을 취소했습니다.", "AbortError"));
    }
    function cleanup() {
      clearTimeout(timer);
      window.removeEventListener("parkiq:native-reply", listener);
      options.signal?.removeEventListener("abort", abort);
    }
    function listener(event: Event) {
      const reply = (event as CustomEvent<Reply>).detail;
      if (reply.id !== id) return;
      cleanup();
      if (reply.ok) resolve(reply.data);
      else reject(new Error(reply.error || "차량 요청에 실패했습니다."));
    }
    window.addEventListener("parkiq:native-reply", listener);
    options.signal?.addEventListener("abort", abort, { once: true });
    window.ParkIQNative.postMessage(JSON.stringify({ id, method, params }));
  });
}

export async function navigate(
  candidate: Candidate,
  destination: Place,
  asWaypoint = false,
  testLocation = false,
) {
  if (window.ParkIQNative) {
    if (testLocation)
      throw new Error(
        "테스트 위치에서는 실제 차량 안내를 시작할 수 없습니다. GPS 위치로 복귀해 주세요.",
      );
    if (candidate.lot.demo)
      throw new Error(
        "시연 주차장을 실제 차량으로 안내할 수 없습니다. 실데이터 모드를 연결해 주세요.",
      );
    await nativeRequest(
      asWaypoint ? "navigation.addWaypoint" : "navigation.start",
      {
        parking: candidate.lot,
        destination,
      },
    );
    return asWaypoint
      ? "차량 내비게이션에 주차장 경유지를 추가했어요."
      : "차량 내비게이션에서 경로 요청을 수락했습니다.";
  }
  return "시연 경로를 시작했어요. 실제 차량에는 전송되지 않습니다.";
}
export async function cancelNavigation() {
  if (window.ParkIQNative) await nativeRequest("navigation.cancel", {});
}
export function subscribeVehicle(listener: (state: VehicleState) => void) {
  const handler = (event: Event) =>
    listener((event as CustomEvent<VehicleState>).detail);
  window.addEventListener("parkiq:vehicle", handler);
  return () => window.removeEventListener("parkiq:vehicle", handler);
}
export function subscribeGleo(listener: (call: GleoCall) => void) {
  const handler = (event: Event) =>
    listener((event as CustomEvent<GleoCall>).detail);
  window.addEventListener("parkiq:gleo", handler);
  return () => window.removeEventListener("parkiq:gleo", handler);
}

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  abort(): void;
  onresult:
    | ((e: {
        results: { [key: number]: { [key: number]: { transcript: string } } };
      }) => void)
    | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
let activeRecognition: Recognition | null = null;
export function stopListening() {
  activeRecognition?.abort();
  activeRecognition = null;
  if (window.ParkIQNative)
    void nativeRequest("voice.cancel", {}).catch(() => {});
}
export async function listen(
  onText: (text: string) => void,
  onEnd: () => void,
  onError: (message: string) => void,
) {
  if (window.ParkIQNative) {
    try {
      const text = await nativeRequest("voice.listen", {});
      onText(String(text));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      onEnd();
    }
    return;
  }
  const scope = window as unknown as {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  const Constructor = scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
  if (!Constructor) {
    onError(
      "이 브라우저에서는 음성 인식을 지원하지 않습니다. 아래 예시 명령을 선택해 주세요.",
    );
    onEnd();
    return;
  }
  stopListening();
  const recognition = new Constructor();
  activeRecognition = recognition;
  recognition.lang = "ko-KR";
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.onresult = (e) => onText(e.results[0][0].transcript);
  recognition.onerror = () =>
    onError(
      "음성을 인식하지 못했어요. 마이크 권한을 확인하거나 예시 명령을 선택해 주세요.",
    );
  recognition.onend = () => {
    activeRecognition = null;
    onEnd();
  };
  try {
    recognition.start();
  } catch {
    onError("마이크를 시작할 수 없습니다.");
    onEnd();
  }
}
export function speak(text: string) {
  if (window.ParkIQNative) {
    void nativeRequest("voice.speak", { text }).catch(() => {});
    return;
  }
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ko-KR";
    window.speechSynthesis.speak(utterance);
  }
}
