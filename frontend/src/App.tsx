import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownUp,
  CarFront,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Footprints,
  Heart,
  History,
  Info,
  MapPin,
  Mic,
  Moon,
  Navigation,
  ParkingSquare,
  PlugZap,
  RefreshCw,
  Search,
  Settings2,
  Sun,
  Volume2,
  VolumeX,
  WifiOff,
  X,
} from "lucide-react";
import { api, checkBackend } from "./api";
import {
  getBackendUrl,
  saveBackendUrl,
  subscribeBackendUrl,
} from "./backend-config";
import { distance } from "./local-api";
import ParkingMap from "./ParkingMap";
import Modal from "./Modal";
import TestLocationSettings from "./TestLocationSettings";
import {
  readTestLocation,
  saveTestLocation,
  testLocationAvailable,
  validLocation,
} from "./test-location";
import type {
  Candidate,
  GleoCall,
  Place,
  Point,
  Preference,
  Result,
} from "./types";
import {
  cancelNavigation,
  listen,
  nativeRequest,
  navigate,
  speak,
  stopListening,
  subscribeGleo,
  subscribeVehicle,
} from "./vehicle";

const DEFAULT_ORIGIN: Point = { lat: 37.5385, lng: 127.0602 };
// Without an explicit destination, search around the current position and
// re-center once the vehicle has moved this far (GPS ticks every ~5s/10m).
const NEARBY_RECENTER_M = 150;
function nearbyPlace({ lat, lng }: Point): Place {
  return {
    lat,
    lng,
    id: `nearby:${lat.toFixed(5)},${lng.toFixed(5)}`,
    name: "내 위치 주변",
    address: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
    category: "현재 위치",
  };
}
const preferences: {
  id: Preference;
  name: string;
  icon: typeof ArrowDownUp;
}[] = [
  { id: "balanced", name: "추천순", icon: ArrowDownUp },
  { id: "less_walking", name: "도보 짧은순", icon: Footprints },
  { id: "fastest", name: "빠른순", icon: Clock3 },
  { id: "cheapest", name: "저렴한순", icon: ParkingSquare },
];
type HistoryItem = {
  id: string;
  name: string;
  destination: string;
  at: string;
};
function readLocal<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}
const money = (n: number | null) =>
  n === null ? "요금 미확인" : `${n.toLocaleString("ko-KR")}원`;
const minute = (n: number) => Math.ceil(n);

export default function App() {
  const [backendUrl, setBackendUrlState] = useState(getBackendUrl);
  const [backendDraft, setBackendDraft] = useState(getBackendUrl);
  const [connectionRevision, setConnectionRevision] = useState(0);
  const [connectionMessage, setConnectionMessage] = useState("");
  const [checkingConnection, setCheckingConnection] = useState(false);
  const connectionCheck = useRef<AbortController | null>(null);
  const [nearby, setNearby] = useState(true);
  const [destination, setDestination] = useState<Place>(() =>
    nearbyPlace(readTestLocation() ?? DEFAULT_ORIGIN),
  );
  const [viewport, setViewport] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const [page, setPage] = useState(0);
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    readLocal("parkiq-theme", "light"),
  );
  const [places, setPlaces] = useState<Place[]>([]);
  const [searchResults, setSearchResults] = useState<Place[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [testOrigin, setTestOrigin] = useState<Point | null>(readTestLocation);
  const testOriginRef = useRef(testOrigin);
  testOriginRef.current = testOrigin;
  const realOrigin = useRef<Point | null>(null);
  const [pickingTestLocation, setPickingTestLocation] = useState(false);
  const [origin, setOrigin] = useState<Point>(
    () => testOrigin ?? DEFAULT_ORIGIN,
  );
  const [preference, setPreference] = useState<Preference>(() =>
    readLocal("parkiq-preference", "balanced"),
  );
  const [stay, setStay] = useState(60),
    [evOnly, setEvOnly] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0),
    [toast, setToast] = useState("");
  const [tab, setTab] = useState<"explore" | "saved" | "history">("explore");
  const [favorites, setFavorites] = useState<string[]>(() =>
    readLocal("parkiq-favorites", []),
  );
  const [history, setHistory] = useState<HistoryItem[]>(() =>
    readLocal("parkiq-history", []),
  );
  const [query, setQuery] = useState(""),
    [destinationOpen, setDestinationOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false),
    [listening, setListening] = useState(false);
  const [voiceText, setVoiceText] = useState(""),
    [voiceReply, setVoiceReply] = useState("");
  const [voiceBusy, setVoiceBusy] = useState(false),
    [muted, setMuted] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false),
    [infoOpen, setInfoOpen] = useState(false);
  const [moving, setMoving] = useState(!!window.ParkIQNative);
  const [navigating, setNavigating] = useState(false),
    [starting, setStarting] = useState(false);
  const [activeRouteId, setActiveRouteId] = useState("");
  const [mode, setMode] = useState<"demo" | "live">("demo");
  const [now, setNow] = useState(new Date());
  const [locationLabel, setLocationLabel] = useState(
    testOrigin ? "테스트 위치" : "성수동 시연 위치",
  );
  const selected = result?.candidates.find((c) => c.lot.id === selectedId);
  const selectedIsNavigating = navigating && selectedId === activeRouteId;
  const visible = useMemo(
    () =>
      result?.candidates.filter(
        (c) => tab !== "saved" || favorites.includes(c.lot.id),
      ) ?? [],
    [result, tab, favorites],
  );
  const hasNative = !!window.ParkIQNative;
  const gleoHandler = useRef<(call: GleoCall) => void>(() => {});
  const generation = useRef(0);

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 1000);
    const poll = setInterval(() => {
      if (!document.hidden) setRefresh((x) => x + 1);
    }, 30000);
    const cleanup = subscribeVehicle((state) => {
      setMoving(state.moving);
      if (validLocation(state.origin)) {
        realOrigin.current = state.origin;
        if (!testOriginRef.current) {
          setOrigin(state.origin);
          setLocationLabel("차량 GPS 위치");
        }
      }
    });
    if (window.ParkIQNative)
      void nativeRequest("vehicle.state", {}).catch(() => {});
    const offGleo = subscribeGleo((call) => gleoHandler.current(call));
    return () => {
      clearInterval(tick);
      clearInterval(poll);
      cleanup();
      offGleo();
      stopListening();
    };
  }, []);
  useEffect(() => saveTestLocation(testOrigin), [testOrigin]);
  useEffect(() => {
    if (moving) setPickingTestLocation(false);
  }, [moving]);
  useEffect(
    () =>
      subscribeBackendUrl((value) => {
        setBackendUrlState(value);
        setBackendDraft(value);
        setConnectionRevision((x) => x + 1);
        setResult(null);
        setSelectedId("");
        setPlaces([]);
        setError("");
      }),
    [],
  );
  useEffect(() => {
    const controller = new AbortController();
    api
      .places("", controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setPlaces(data.places);
      })
      .catch(() => {});
    api
      .health(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setMode(data.mode);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [backendUrl, connectionRevision]);
  useEffect(() => () => connectionCheck.current?.abort(), []);
  // Destination search: match curated places and every stored parking lot.
  useEffect(() => {
    if (!destinationOpen || !query.trim()) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    const timer = setTimeout(() => {
      api
        .places(query, controller.signal)
        .then((data) => {
          if (!controller.signal.aborted) setSearchResults(data.places);
        })
        .catch(() => {
          if (!controller.signal.aborted) setSearchResults([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, destinationOpen, backendUrl, connectionRevision]);
  const shownPlaces = query.trim() ? (searchResults ?? []) : places;
  useEffect(() => {
    try {
      localStorage.setItem("parkiq-favorites", JSON.stringify(favorites));
    } catch {
      /* optional persistence */
    }
  }, [favorites]);
  useEffect(() => {
    try {
      localStorage.setItem("parkiq-preference", JSON.stringify(preference));
    } catch {
      /* optional persistence */
    }
  }, [preference]);
  useEffect(() => {
    try {
      localStorage.setItem("parkiq-history", JSON.stringify(history));
    } catch {
      /* optional persistence */
    }
  }, [history]);
  useEffect(() => {
    const controller = new AbortController(),
      request = ++generation.current;
    setLoading(true);
    setError("");
    api
      .recommend(
        origin,
        destination,
        preference,
        stay,
        evOnly,
        controller.signal,
      )
      .then((data) => {
        if (request !== generation.current || controller.signal.aborted) return;
        setResult(data);
        setMode(data.mode);
        setSelectedId((old) =>
          data.candidates.some((c) => c.lot.id === old)
            ? old
            : (data.candidates[0]?.lot.id ?? ""),
        );
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(e.message);
          setResult(null);
        }
      })
      .finally(() => {
        if (request === generation.current) setLoading(false);
      });
    return () => controller.abort();
  }, [
    destination,
    origin,
    preference,
    stay,
    evOnly,
    refresh,
    backendUrl,
    connectionRevision,
  ]);
  useEffect(() => {
    // Keep an active route's target stable; re-center only while browsing.
    if (!nearby || navigating) return;
    setDestination((current) =>
      current.id.startsWith("nearby:") &&
      distance(current, origin) < NEARBY_RECENTER_M
        ? current
        : nearbyPlace(origin),
    );
  }, [nearby, navigating, origin]);
  useEffect(() => {
    setSelectedId("");
  }, [destination, preference, stay, evOnly]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 5000);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(() => {
    if (moving) {
      setDestinationOpen(false);
      setSettingsOpen(false);
      setInfoOpen(false);
      setTab((current) => (current === "history" ? "explore" : current));
    }
  }, [moving]);

  function resetPreview() {
    if (!hasNative) {
      setNavigating(false);
      setActiveRouteId("");
    }
  }
  const notify = (text: string) => {
    setToast(text);
    if (!muted) speak(text);
  };
  const toggleFavorite = (id: string) =>
    setFavorites((old) =>
      old.includes(id) ? old.filter((x) => x !== id) : [...old, id],
    );
  async function stopRoute() {
    try {
      await cancelNavigation();
      setNavigating(false);
      setActiveRouteId("");
      notify("경로 안내를 종료했어요.");
    } catch (e) {
      setToast((e as Error).message);
    }
  }
  async function startRoute(candidate = selected, asWaypoint = false) {
    if (hasNative && testOriginRef.current) {
      const message =
        "테스트 위치에서는 실제 차량 안내를 시작할 수 없습니다. GPS 위치로 복귀해 주세요.";
      setToast(message);
      return message;
    }
    if (!candidate || starting || loading)
      return "경로를 확인하고 있어요. 잠시 후 다시 시도해 주세요.";
    setStarting(true);
    const source = getBackendUrl();
    try {
      // Recheck occupancy immediately before handing a route to the vehicle.
      const latest = await api.recommend(
        origin,
        destination,
        preference,
        stay,
        evOnly,
      );
      const checked = latest.candidates.find(
        (c) => c.lot.id === candidate.lot.id,
      );
      if (getBackendUrl() !== source)
        throw new Error(
          "데이터 연결이 변경되었습니다. 주차장을 다시 선택하세요.",
        );
      setResult(latest);
      if (!checked)
        throw new Error(
          "주차장 상태가 변경되었습니다. 다른 주차장을 선택해 주세요.",
        );
      const message = await navigate(
        checked,
        destination,
        asWaypoint,
        testOriginRef.current !== null,
      );
      setSelectedId(checked.lot.id);
      setNavigating(true);
      setActiveRouteId(checked.lot.id);
      notify(message);
      setHistory((old) =>
        [
          {
            id: checked.lot.id,
            name: checked.lot.name,
            destination: destination.name,
            at: new Date().toISOString(),
          },
          ...old,
        ].slice(0, 12),
      );
      return message;
    } catch (e) {
      setToast((e as Error).message);
      return (e as Error).message;
    } finally {
      setStarting(false);
    }
  }
  async function handleVoice(text: string) {
    if (voiceBusy) return;
    setVoiceBusy(true);
    setVoiceText(text);
    const source = getBackendUrl();
    try {
      const intent = await api.voice(text);
      if (getBackendUrl() !== source)
        throw new Error("데이터 연결이 변경되었습니다. 다시 말씀해 주세요.");
      let reply = intent.reply;
      if (intent.action === "preference" && intent.preference) {
        setPreference(intent.preference);
        setTab("explore");
      }
      if (intent.action === "search" && intent.query) {
        const place = places.find((p) => p.name.includes(intent.query!));
        if (place) {
          setNearby(false);
          setDestination(place);
          resetPreview();
          setTab("explore");
        } else reply = "등록된 목적지를 찾지 못했어요.";
      }
      if (intent.action === "select" && intent.rank) {
        const candidate = result?.candidates[intent.rank - 1];
        if (candidate) setSelectedId(candidate.lot.id);
        else reply = "해당 번호의 주차장이 없어요.";
      }
      if (intent.action === "navigate") {
        if (selected) reply = await startRoute();
        else reply = "먼저 주차장을 선택해 주세요.";
      }
      if (intent.action === "cancel") await stopRoute();
      setVoiceReply(reply);
      if (!muted) speak(reply);
    } catch (e) {
      setVoiceReply((e as Error).message);
    } finally {
      setVoiceBusy(false);
    }
  }
  gleoHandler.current = async (call) => {
    const source = getBackendUrl();
    let status = "success",
      message = "The requested parking action was completed.",
      data = "[]";
    try {
      if (call.action === "SEARCH_PARKING") {
        const query = String(call.parameters.query ?? "");
        const place = places.find((p) => p.name.includes(query));
        if (!place || !query) {
          status = "asking";
          message = "A supported destination is required.";
        } else {
          const pref = preferences.some(
            (p) => p.id === call.parameters.preference,
          )
            ? (call.parameters.preference as Preference)
            : preference;
          const response = await api.recommend(
            origin,
            place,
            pref,
            stay,
            evOnly,
          );
          if (getBackendUrl() !== source)
            throw new Error("Connection changed.");
          setNearby(false);
          setDestination(place);
          setPreference(pref);
          setResult(response);
          setSelectedId(response.candidates[0]?.lot.id ?? "");
          setTab("explore");
          data = JSON.stringify(
            response.candidates.slice(0, 3).map((c, i) => ({
              rank: i + 1,
              name: c.lot.name,
              walk_meters: c.walk_meters,
              total_minutes: c.total_minutes,
              demo: c.lot.demo,
            })),
          );
        }
      } else if (call.action === "START_PARKING_ROUTE") {
        if (hasNative && testOriginRef.current)
          throw new Error("Test location is active.");
        const rank = Number(call.parameters.rank);
        const candidate = result?.candidates[rank - 1];
        if (!Number.isInteger(rank) || !candidate) {
          status = "asking";
          message = "A valid parking rank is required.";
        } else {
          const latest = await api.recommend(
            origin,
            destination,
            preference,
            stay,
            evOnly,
          );
          const checked = latest.candidates.find(
            (c) => c.lot.id === candidate.lot.id,
          );
          if (getBackendUrl() !== source)
            throw new Error("Connection changed.");
          if (!checked) throw new Error("Parking availability changed.");
          await navigate(
            checked,
            destination,
            false,
            testOriginRef.current !== null,
          );
          setActiveRouteId(checked.lot.id);
          setSelectedId(checked.lot.id);
          setNavigating(true);
          message =
            "The vehicle navigation accepted the parking route request.";
        }
      } else if (call.action === "CANCEL_PARKING_ROUTE") {
        await cancelNavigation();
        setNavigating(false);
        setActiveRouteId("");
      } else {
        status = "fail";
        message = "The action is unsupported.";
      }
    } catch {
      status = "fail";
      message = "The parking action could not be completed.";
    }
    void nativeRequest("gleo.respond", {
      id: call.id,
      functionName: call.action,
      status,
      message,
      data,
    }).catch(() => {});
  };
  function beginListening() {
    setListening(true);
    setVoiceReply("듣고 있어요. 편하게 말씀해 주세요.");
    void listen(
      (text) => void handleVoice(text),
      () => setListening(false),
      (message) => setVoiceReply(message),
    );
  }
  function chooseDestination(place: Place) {
    setNearby(false);
    setDestination(place);
    setDestinationOpen(false);
    resetPreview();
    setQuery("");
    setTab("explore");
  }
  function searchNearMe() {
    setNearby(true);
    setDestinationOpen(false);
    resetPreview();
    setQuery("");
    setTab("explore");
  }
  async function useLocation() {
    testOriginRef.current = null;
    setTestOrigin(null);
    saveTestLocation(null);
    setPickingTestLocation(false);
    setOrigin(realOrigin.current ?? DEFAULT_ORIGIN);
    setLocationLabel(
      realOrigin.current
        ? hasNative
          ? "차량 GPS 위치"
          : "브라우저 현재 위치"
        : "성수동 시연 위치",
    );
    if (hasNative) {
      try {
        await nativeRequest("vehicle.state", {});
      } catch (e) {
        setToast((e as Error).message);
      }
      return;
    }
    if (!navigator.geolocation) {
      setToast("위치 정보를 지원하지 않는 브라우저입니다.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const point = { lat: p.coords.latitude, lng: p.coords.longitude };
        realOrigin.current = point;
        if (!testOriginRef.current) {
          setOrigin(point);
          setLocationLabel("브라우저 현재 위치");
          resetPreview();
        }
      },
      () => setToast("위치 권한을 확인해 주세요. 시연 위치를 유지합니다."),
      { timeout: 8000 },
    );
  }
  function applyTestLocation(point: Point, searchNearby = false) {
    if (
      !testLocationAvailable() ||
      moving ||
      navigating ||
      !validLocation(point)
    )
      return;
    testOriginRef.current = point;
    setTestOrigin(point);
    saveTestLocation(point);
    setOrigin(point);
    setLocationLabel("테스트 위치");
    setPickingTestLocation(false);
    resetPreview();
    if (searchNearby) {
      setNearby(true);
      setTab("explore");
    }
    setToast(
      searchNearby
        ? "테스트 위치 주변의 주차장을 찾습니다."
        : "차량 테스트 위치를 변경했습니다.",
    );
  }
  function pickTestLocation() {
    if (moving || navigating || !testLocationAvailable()) return;
    setSettingsOpen(false);
    setPickingTestLocation(true);
  }
  function applyBackend(value: string) {
    connectionCheck.current?.abort();
    setCheckingConnection(false);
    try {
      const saved = saveBackendUrl(value);
      setConnectionMessage(
        saved
          ? "서버 주소를 저장했습니다."
          : "서버 없이 내부 시연 데이터를 사용합니다.",
      );
      setToast(
        saved ? "서버 주소를 저장했습니다." : "내부 시연으로 변경했습니다.",
      );
    } catch (error) {
      setConnectionMessage((error as Error).message);
    }
  }
  async function testBackendConnection() {
    connectionCheck.current?.abort();
    const controller = new AbortController();
    connectionCheck.current = controller;
    setCheckingConnection(true);
    setConnectionMessage("서버 연결을 확인하고 있습니다.");
    try {
      const health = await checkBackend(backendDraft, controller.signal);
      if (!controller.signal.aborted)
        setConnectionMessage(
          `연결 확인: ${health.mode === "live" ? "실데이터" : "서버 시연"} · ${health.repository}`,
        );
    } catch (error) {
      if (!controller.signal.aborted)
        setConnectionMessage((error as Error).message);
    } finally {
      if (connectionCheck.current === controller) setCheckingConnection(false);
    }
  }

  const pageSize =
    viewport.height < 680
      ? 1
      : viewport.height < 780 || (moving && viewport.width < 800)
        ? 2
        : 3;
  useEffect(() => {
    const resize = () =>
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const pageCandidates = useMemo(
    () =>
      visible.slice(currentPage * pageSize, currentPage * pageSize + pageSize),
    [visible, currentPage, pageSize],
  );
  const ranks = useMemo(
    () =>
      Object.fromEntries(
        (result?.candidates ?? []).map((c, i) => [c.lot.id, i + 1]),
      ),
    [result],
  );
  useEffect(() => {
    setPage(0);
  }, [destination, preference, stay, evOnly, tab]);
  useEffect(() => {
    const index = visible.findIndex((c) => c.lot.id === selectedId);
    if (index >= 0) setPage(Math.floor(index / pageSize));
  }, [selectedId, tab, result, favorites, pageSize]);
  useEffect(() => {
    if (!visible.some((c) => c.lot.id === selectedId)) {
      setSelectedId(visible[0]?.lot.id ?? "");
    }
  }, [tab, favorites]);
  useEffect(() => {
    try {
      localStorage.setItem("parkiq-theme", JSON.stringify(theme));
    } catch {
      /* optional */
    }
  }, [theme]);
  const selectCandidate = (id: string) => {
    setSelectedId(id);
    resetPreview();
  };
  const changePage = (nextPage: number) => {
    const candidate = visible[nextPage * pageSize];
    if (candidate) {
      setPage(nextPage);
      selectCandidate(candidate.lot.id);
    }
  };
  const closeVoice = () => {
    setVoiceOpen(false);
    stopListening();
    setListening(false);
  };
  const openVoice = () => {
    setVoiceOpen(true);
    setVoiceText("");
    beginListening();
  };
  const observed = selected?.lot.observed_at
    ? new Date(selected.lot.observed_at).toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "Asia/Seoul",
      })
    : null;
  const availability = selected ? parkingStatus(selected) : null;
  return (
    <div
      className="app-shell"
      data-theme={theme}
      data-driving={moving}
      data-api-source={backendUrl ? "backend" : "internal"}
      data-test-location={testOrigin !== null}
    >
      <div id="app-content" className="app-content">
        <header className="topbar">
          <div className="app-title">
            <ParkingSquare size={31} strokeWidth={1.7} />
            <span>ParkIQ</span>
            <i />
            <h1>주차</h1>
          </div>
          <time dateTime={now.toISOString()}>
            {now.toLocaleTimeString("ko-KR", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
              timeZone: "Asia/Seoul",
            })}
          </time>
          <div className="topbar-actions">
            <span className="data-mode">
              {!backendUrl
                ? "내부 시연"
                : !result
                  ? "서버 연결"
                  : result.mode === "demo"
                    ? "서버 시연"
                    : "실시간 주차 정보"}
            </span>
            <button
              className={`driving-badge ${moving ? "moving" : ""}`}
              disabled={hasNative}
              onClick={() => setMoving(!moving)}
              aria-label={moving ? "주행 중 · 간편 모드" : "정차 중"}
              title={hasNative ? "차량 상태" : "주행 모드 시연"}
            >
              <CarFront size={22} />
              <span>{moving ? "주행 중" : "정차 중"}</span>
            </button>
            <button
              className="icon-button theme-button"
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
              aria-label={theme === "light" ? "야간 화면" : "주간 화면"}
            >
              {theme === "light" ? <Moon size={26} /> : <Sun size={26} />}
            </button>
            <button
              className="icon-button"
              aria-label="설정"
              disabled={moving}
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 size={27} />
            </button>
          </div>
        </header>
        <main className="workspace" data-tab={tab}>
          <section className="results-panel" aria-label="주차장 검색 결과">
            <div className="destination-bar">
              <button
                className="destination-search"
                aria-label="목적지 검색"
                disabled={moving}
                onClick={() => setDestinationOpen(true)}
              >
                <Search size={27} />
                <span className="destination-copy">
                  <small>
                    {nearby ? "현재 위치 기준 주차장" : "목적지 주변 주차장"}
                  </small>
                  <strong>{destination.name}</strong>
                </span>
                <ChevronRight size={25} />
              </button>
            </div>
            <nav className="list-tabs" aria-label="주차장 목록">
              <button
                className={tab === "explore" ? "active" : ""}
                aria-current={tab === "explore" ? "page" : undefined}
                onClick={() => setTab("explore")}
              >
                주변 주차장
              </button>
              <button
                className={tab === "saved" ? "active" : ""}
                aria-current={tab === "saved" ? "page" : undefined}
                onClick={() => setTab("saved")}
              >
                즐겨찾기
              </button>
              <button
                className={tab === "history" ? "active" : ""}
                aria-current={tab === "history" ? "page" : undefined}
                disabled={moving}
                onClick={() => setTab("history")}
              >
                최근 안내
              </button>
            </nav>
            {tab === "history" ? (
              <div className="history-panel">
                <div className="section-label">
                  최근 안내 <span>{history.length}</span>
                </div>
                {history.length ? (
                  history.map((item, index) => (
                    <article className="history-item" key={item.at + index}>
                      <History size={25} />
                      <div>
                        <h3>{item.name}</h3>
                        <p>{item.destination}</p>
                        <time>
                          {new Date(item.at).toLocaleString("ko-KR", {
                            timeZone: "Asia/Seoul",
                          })}
                        </time>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="empty">
                    <History size={40} />
                    <h3>최근 안내 기록이 없습니다</h3>
                    <button
                      className="secondary"
                      onClick={() => setTab("explore")}
                    >
                      주변 주차장 보기
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div
                  className="preferences"
                  role="group"
                  aria-label="정렬 기준"
                >
                  {preferences.map((pref) => (
                    <button
                      key={pref.id}
                      className={preference === pref.id ? "selected" : ""}
                      aria-pressed={preference === pref.id}
                      onClick={() => {
                        setPreference(pref.id);
                        resetPreview();
                      }}
                    >
                      {pref.name}
                    </button>
                  ))}
                </div>
                <div className="filter-row">
                  <button
                    className={`filter-chip ${evOnly ? "active" : ""}`}
                    aria-label="전기차 충전"
                    aria-pressed={evOnly}
                    onClick={() => {
                      setEvOnly(!evOnly);
                      resetPreview();
                    }}
                  >
                    <PlugZap size={21} />
                    충전 가능{evOnly && <Check size={18} />}
                  </button>
                  <label className="stay-select">
                    <Clock3 size={21} />
                    <select
                      aria-label="예상 주차 시간"
                      value={stay}
                      disabled={moving}
                      onChange={(event) => {
                        setStay(Number(event.target.value));
                        resetPreview();
                      }}
                    >
                      <option value={30}>30분 주차</option>
                      <option value={60}>1시간 주차</option>
                      <option value={120}>2시간 주차</option>
                      <option value={180}>3시간 주차</option>
                    </select>
                    <ChevronDown size={18} />
                  </label>
                </div>
                <div className="result-tools">
                  <span>
                    {tab === "saved" ? "저장한 주차장" : "주변 주차장"}{" "}
                    <b>{visible.length}</b>
                    <span className="result-radius"> · 반경 2km</span>
                  </span>
                  <button
                    className="icon-button"
                    aria-label="주차 정보 새로고침"
                    disabled={loading}
                    onClick={() => setRefresh((x) => x + 1)}
                  >
                    <RefreshCw size={23} />
                  </button>
                </div>
                <div
                  className={`parking-list ${loading ? "is-loading" : ""}`}
                  aria-busy={loading}
                >
                  {error ? (
                    <div className="empty error">
                      <WifiOff size={36} />
                      <h3>주차 정보를 불러올 수 없습니다</h3>
                      <p>{error}</p>
                      <button
                        className="secondary"
                        onClick={() => setRefresh((x) => x + 1)}
                      >
                        다시 시도
                      </button>
                    </div>
                  ) : loading && !result ? (
                    <div className="empty loading-state" role="status">
                      <ParkingSquare size={42} />
                      <h3>주차장을 찾고 있습니다</h3>
                    </div>
                  ) : !loading && !visible.length ? (
                    <div className="empty">
                      <ParkingSquare size={40} />
                      <h3>
                        {tab === "saved"
                          ? "저장한 주차장이 없습니다"
                          : "조회된 주차장이 없습니다"}
                      </h3>
                      <p>
                        {tab === "saved"
                          ? "목록에서 하트를 눌러 저장하세요."
                          : result?.mode === "live"
                            ? "연결된 데이터에서 목적지 반경 2km의 주차장을 찾지 못했습니다. 목적지나 충전 조건을 변경하세요."
                            : "목적지 또는 충전 조건을 확인하세요."}
                      </p>
                      <button
                        className="secondary"
                        onClick={() => {
                          if (tab === "saved" || evOnly) {
                            setEvOnly(false);
                            setTab("explore");
                          } else if (moving) {
                            setVoiceOpen(true);
                          } else {
                            setDestinationOpen(true);
                          }
                        }}
                      >
                        {tab === "saved"
                          ? "주변 주차장 보기"
                          : evOnly
                            ? "충전 조건 해제"
                            : moving
                              ? "음성으로 다시 찾기"
                              : "목적지 변경"}
                      </button>
                    </div>
                  ) : (
                    pageCandidates.map((c) => (
                      <ParkingCard
                        key={c.lot.id}
                        candidate={c}
                        rank={ranks[c.lot.id]}
                        active={selectedId === c.lot.id}
                        favorite={favorites.includes(c.lot.id)}
                        moving={moving}
                        onSelect={() => selectCandidate(c.lot.id)}
                        onFavorite={() => toggleFavorite(c.lot.id)}
                      />
                    ))
                  )}
                </div>
                <div
                  className="list-pagination"
                  aria-label="주차장 목록 페이지"
                >
                  <button
                    aria-label="이전 주차장"
                    disabled={currentPage === 0 || loading}
                    onClick={() => changePage(Math.max(0, currentPage - 1))}
                  >
                    <ChevronLeft size={25} />
                    <span>이전</span>
                  </button>
                  <span>
                    {currentPage + 1} / {pageCount}
                  </span>
                  <button
                    aria-label="다음 주차장"
                    disabled={currentPage + 1 >= pageCount || loading}
                    onClick={() => changePage(currentPage + 1)}
                  >
                    <span>다음</span>
                    <ChevronRight size={25} />
                  </button>
                </div>
                <p className="data-note">
                  {moving
                    ? `주행 중에는 ${pageSize}곳씩 표시합니다.`
                    : result?.mode === "demo"
                      ? backendUrl
                        ? "서버의 시연용 주차장 정보입니다."
                        : "앱 내부의 가상 주차장 정보입니다."
                      : "현장 주차 상황과 다를 수 있습니다."}
                  {result?.excluded_full
                    ? ` 만차 ${result.excluded_full}곳 제외`
                    : ""}
                </p>
              </>
            )}
          </section>
          <section className="map-panel" aria-label="선택한 주차장">
            <div
              className={`map-canvas${testOrigin || pickingTestLocation ? " test-location-canvas" : ""}`}
            >
              <ParkingMap
                candidates={pageCandidates}
                ranks={ranks}
                selected={selected}
                destination={destination}
                origin={origin}
                onSelect={selectCandidate}
                navigating={selectedIsNavigating}
                moving={moving}
                testLocationActive={testOrigin !== null}
                pickingTestLocation={pickingTestLocation}
                onOriginChange={applyTestLocation}
              />
              <button
                className="map-location"
                onClick={() => void useLocation()}
                aria-label="현재 위치 사용"
              >
                <span className="location-dot" />
                {locationLabel}
                <Navigation size={17} />
              </button>
            </div>
            {(testOrigin || pickingTestLocation) && !moving && (
              <div
                className="map-test-toolbar"
                role="region"
                aria-label="지도 테스트 위치 조작"
              >
                <p role="status">
                  {pickingTestLocation
                    ? "지도에서 차량을 놓을 지점을 누르세요."
                    : `테스트 위치 · ${origin.lat.toFixed(5)}, ${origin.lng.toFixed(5)}`}
                </p>
                <div>
                  {pickingTestLocation ? (
                    <button
                      className="secondary"
                      onClick={() => setPickingTestLocation(false)}
                    >
                      위치 선택 취소
                    </button>
                  ) : (
                    <>
                      <button
                        className="secondary"
                        disabled={navigating}
                        onClick={pickTestLocation}
                      >
                        위치 옮기기
                      </button>
                      <button
                        className="primary"
                        disabled={navigating}
                        onClick={() => applyTestLocation(origin, true)}
                      >
                        이 위치 주변 찾기
                      </button>
                      <button
                        className="secondary"
                        onClick={() => void useLocation()}
                      >
                        GPS 위치로 복귀
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
            <section
              className={`route-summary ${!selected ? "no-selection" : ""}`}
              aria-label="선택한 주차 경로"
            >
              {selected && !error ? (
                <>
                  <div className="route-summary-top">
                    <div className="selected-parking-name">
                      <span className="selected-rank">
                        {ranks[selected.lot.id]}
                      </span>
                      <h2>{selected.lot.name}</h2>
                    </div>
                    <button
                      className={`icon-button detail-favorite ${favorites.includes(selected.lot.id) ? "saved" : ""}`}
                      aria-label="선택한 주차장 즐겨찾기"
                      disabled={moving}
                      onClick={() => toggleFavorite(selected.lot.id)}
                    >
                      <Heart
                        size={26}
                        fill={
                          favorites.includes(selected.lot.id)
                            ? "currentColor"
                            : "none"
                        }
                      />
                    </button>
                  </div>
                  <div className="route-summary-main">
                    <div className="arrival-time">
                      <span>목적지 도착까지</span>
                      <strong>
                        <small>약</small> {minute(selected.total_minutes)}
                        <small>분</small>
                      </strong>
                    </div>
                    <div className="route-metrics">
                      <div>
                        <CarFront size={22} />
                        <span>차량</span>
                        <b>{minute(selected.drive_minutes)}분</b>
                      </div>
                      <div>
                        <Footprints size={22} />
                        <span>도보</span>
                        <b>{selected.walk_meters}m</b>
                      </div>
                      <div className="fee-metric">
                        <ParkingSquare size={22} />
                        <span>
                          {stay < 60 ? `${stay}분` : `${stay / 60}시간`} 요금
                        </span>
                        <b>{money(selected.estimated_fee)}</b>
                      </div>
                    </div>
                  </div>
                  <div className="route-status-row">
                    <span className={`availability ${availability?.tone}`}>
                      <i />
                      {availability?.label}
                      {availability?.known && <b>{selected.lot.available}면</b>}
                    </span>
                    <span>
                      {observed ? `${observed} 기준` : "갱신 시각 미제공"}
                    </span>
                    <span className="estimate-label">
                      {selected.routing_source === "distance_estimate"
                        ? "이동 시간 추정"
                        : "경로 제공자 기준"}
                    </span>
                  </div>
                  <div className="route-bottom">
                    {hasNative && (
                      <button
                        className="secondary waypoint-button"
                        disabled={starting || loading}
                        onClick={() => void startRoute(selected, true)}
                      >
                        경유지 추가
                      </button>
                    )}
                    <button
                      className={`${selectedIsNavigating ? "secondary" : "primary"} route-start`}
                      disabled={starting || loading}
                      onClick={() =>
                        void (selectedIsNavigating ? stopRoute() : startRoute())
                      }
                    >
                      {starting
                        ? "경로 확인 중"
                        : selectedIsNavigating
                          ? "안내 종료"
                          : "안내 시작"}
                      {selectedIsNavigating ? (
                        <X size={27} />
                      ) : (
                        <Navigation size={26} />
                      )}
                    </button>
                  </div>
                </>
              ) : (
                <div className="selection-placeholder">
                  <ParkingSquare size={36} />
                  <span>
                    {error ? "연결 상태를 확인하세요" : "주차장을 선택하세요"}
                  </span>
                </div>
              )}
            </section>
          </section>
        </main>
        <footer className="bottom-bar">
          <button
            className={`voice-button ${voiceOpen ? "active" : ""}`}
            aria-label="음성 검색"
            onClick={() => (voiceOpen ? closeVoice() : openVoice())}
          >
            <Mic size={27} />
            음성 검색
          </button>
          <p className="footer-instruction">
            {selectedIsNavigating
              ? "차량 내비게이션에서 경로를 확인하세요."
              : moving
                ? "목적지 변경은 음성으로 이용하세요."
                : "주차장을 선택한 뒤 안내를 시작하세요."}
          </p>
          {navigating && !selectedIsNavigating && (
            <button
              className="stop-active-route"
              onClick={() => void stopRoute()}
            >
              <X size={22} />
              안내 종료
            </button>
          )}
          <button
            className="mute-button"
            aria-label={muted ? "음성 안내 켜기" : "음성 안내 끄기"}
            aria-pressed={!muted}
            onClick={() => {
              setMuted(!muted);
              window.speechSynthesis?.cancel();
            }}
          >
            {muted ? <VolumeX size={25} /> : <Volume2 size={25} />}
            <span>음성 안내 {muted ? "끔" : "켬"}</span>
          </button>
          <button
            className="info-button"
            aria-label="주차 정보 안내"
            disabled={moving}
            onClick={() => setInfoOpen(true)}
          >
            <Info size={25} />
            <span>이용 안내</span>
          </button>
        </footer>
        {voiceOpen && (
          <section className="voice-panel" role="region" aria-label="음성 검색">
            <div className="voice-panel-header">
              <h2>{listening ? "말씀해 주세요" : "음성 검색"}</h2>
              <button
                className="icon-button"
                aria-label="음성 검색 닫기"
                onClick={closeVoice}
              >
                <X size={26} />
              </button>
            </div>
            <div className="voice-status" role="status">
              {voiceText && <p>“{voiceText}”</p>}
              <b>{voiceReply || "목적지나 주차 조건을 말씀해 주세요."}</b>
            </div>
            <button
              className="mic-control"
              aria-label="마이크로 명령하기"
              disabled={listening || voiceBusy}
              onClick={beginListening}
            >
              <Mic size={26} />
              {listening ? "듣는 중" : "다시 말하기"}
            </button>
            {!moving && (
              <div className="voice-examples">
                {[
                  "덜 걷는 곳으로 찾아줘",
                  "가장 저렴한 곳",
                  "2번 주차장 선택",
                  "안내 시작",
                  "서울숲 주차장 찾아줘",
                  "안내 취소",
                ].map((text) => (
                  <button
                    key={text}
                    disabled={voiceBusy || loading}
                    onClick={() => void handleVoice(text)}
                  >
                    {text}
                    <ChevronRight size={18} />
                  </button>
                ))}
              </div>
            )}
          </section>
        )}
        {toast && (
          <div className="toast" role="status">
            <Check size={22} />
            <span>{toast}</span>
            <button
              className="icon-button"
              aria-label="알림 닫기"
              onClick={() => setToast("")}
            >
              <X size={22} />
            </button>
          </div>
        )}
      </div>
      {destinationOpen && !moving && (
        <Modal title="목적지 검색" onClose={() => setDestinationOpen(false)}>
          <div className="search-field">
            <Search size={26} />
            <input
              autoFocus
              data-autofocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="목적지를 입력하세요"
              aria-label="목적지 이름"
            />
          </div>
          <button className="place-option" onClick={searchNearMe}>
            <Navigation size={26} />
            <span>
              <b>내 위치 주변</b>
              <small>현재 위치 기준으로 주차장을 찾고 이동하면 갱신합니다</small>
            </span>
            <ChevronRight size={24} />
          </button>
          <p className="modal-label">
            {query.trim() ? "검색 결과 · 장소·주차장" : "추천 장소"}
          </p>
          {shownPlaces.map((place) => (
              <button
                className="place-option"
                key={place.id}
                onClick={() => chooseDestination(place)}
              >
                {place.category === "주차장" ? (
                  <ParkingSquare size={26} />
                ) : (
                  <MapPin size={26} />
                )}
                <span>
                  <b>{place.name}</b>
                  <small>
                    {place.category === "주차장" ? "주차장 · " : ""}
                    {place.address}
                  </small>
                </span>
                <ChevronRight size={24} />
              </button>
            ))}
          {searching && shownPlaces.length === 0 && (
            <p className="empty-text">검색 중…</p>
          )}
          {!searching && shownPlaces.length === 0 && (
            <p className="empty-text">검색 결과가 없습니다.</p>
          )}
        </Modal>
      )}
      {settingsOpen && !moving && (
        <Modal title="주차 설정" onClose={() => setSettingsOpen(false)}>
          <section
            className="connection-settings"
            aria-label="데이터 연결 설정"
          >
            <h3>데이터 연결</h3>
            <p>
              {backendUrl
                ? "지정한 백엔드 API와 통신합니다."
                : "서버 없이 앱 내부 데이터로 시연합니다."}
            </p>
            <label htmlFor="backend-url">백엔드 서버 주소</label>
            <input
              id="backend-url"
              type="url"
              inputMode="url"
              value={backendDraft}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="http://10.0.2.2:8000"
              onChange={(event) => {
                connectionCheck.current?.abort();
                setCheckingConnection(false);
                setConnectionMessage("");
                setBackendDraft(event.target.value);
              }}
            />
            <div className="connection-actions">
              <button
                className="secondary"
                disabled={checkingConnection || !backendDraft.trim()}
                onClick={() => void testBackendConnection()}
              >
                {checkingConnection ? "확인 중" : "연결 확인"}
              </button>
              <button
                className="primary"
                onClick={() => applyBackend(backendDraft)}
              >
                주소 저장
              </button>
            </div>
            <button
              className="connection-local"
              onClick={() => applyBackend("")}
            >
              서버 주소 지우고 내부 시연 사용
            </button>
            <p className="connection-message" role="status">
              {connectionMessage ||
                "주소가 없으면 내부 시연, 주소가 있으면 서버 모드로 동작합니다."}
            </p>
          </section>
          {testLocationAvailable() && (
            <TestLocationSettings
              origin={origin}
              active={testOrigin !== null}
              disabled={navigating}
              onApply={applyTestLocation}
              onPick={pickTestLocation}
              onRestore={() => void useLocation()}
            />
          )}
          <div className="settings-option">
            <div>
              <b>음성 안내</b>
              <p>선택 결과와 안내 상태를 읽어줍니다.</p>
            </div>
            <button
              className={`toggle ${!muted ? "on" : ""}`}
              role="switch"
              aria-label="음성 안내 설정"
              aria-checked={!muted}
              onClick={() => setMuted(!muted)}
            >
              <span />
            </button>
          </div>
          <div className="settings-option">
            <div>
              <b>충전 가능한 주차장</b>
              <p>전기차 충전 시설이 있는 곳만 표시합니다.</p>
            </div>
            <button
              className={`toggle ${evOnly ? "on" : ""}`}
              role="switch"
              aria-label="전기차 필터 설정"
              aria-checked={evOnly}
              onClick={() => setEvOnly(!evOnly)}
            >
              <span />
            </button>
          </div>
          <p className="modal-label">화면 밝기</p>
          <div className="theme-options">
            <button
              aria-pressed={theme === "light"}
              onClick={() => setTheme("light")}
            >
              <Sun size={24} />
              주간
            </button>
            <button
              aria-pressed={theme === "dark"}
              onClick={() => setTheme("dark")}
            >
              <Moon size={24} />
              야간
            </button>
          </div>
          <p className="modal-label">기본 정렬</p>
          <div className="settings-preferences">
            {preferences.map((pref) => (
              <button
                key={pref.id}
                aria-pressed={preference === pref.id}
                onClick={() => setPreference(pref.id)}
              >
                {pref.name}
                {preference === pref.id && <Check size={22} />}
              </button>
            ))}
          </div>
        </Modal>
      )}
      {infoOpen && !moving && (
        <Modal title="주차 정보 안내" onClose={() => setInfoOpen(false)}>
          <div className="info-block">
            <h3>주차 정보</h3>
            <p>
              {!backendUrl
                ? "앱 내부의 가상 주차장과 잔여 대수로 시연 중입니다."
                : (result?.mode ?? mode) === "demo"
                  ? "연결된 서버의 가상 주차장과 잔여 대수로 시연 중입니다."
                  : "공급자가 제공한 시각 기준이며 현장 상황과 다를 수 있습니다."}
            </p>
          </div>
          <div className="info-block">
            <h3>이동 시간</h3>
            <p>
              차량 이동, 주차 탐색, 도보 시간을 합산합니다. 경로 제공자가
              연결되지 않은 경우 거리로 추정합니다.
            </p>
          </div>
          <div className="info-block">
            <h3>지도</h3>
            <p>
              현재 지도는 위치 비교를 위한 개략도입니다. 실제 경로 안내는 차량
              내비게이션에서 확인하세요.
            </p>
          </div>
          <div className="info-block">
            <h3>음성 검색</h3>
            <p>
              {hasNative
                ? "차량 음성 호스트 및 등록된 Gleo 명령을 사용합니다."
                : "브라우저 음성 인식으로 시연합니다. Gleo 서비스와 별도의 기능입니다."}
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}

function parkingStatus(candidate: Candidate) {
  const known = !candidate.stale && candidate.lot.available !== null;
  return {
    known,
    tone: !known ? "unknown" : candidate.risk,
    label: !known
      ? "잔여 확인 필요"
      : candidate.risk === "high"
        ? "혼잡"
        : candidate.risk === "medium"
          ? "보통"
          : "여유",
  };
}
function ParkingCard({
  candidate,
  rank,
  active,
  favorite,
  moving,
  onSelect,
  onFavorite,
}: {
  candidate: Candidate;
  rank: number;
  active: boolean;
  favorite: boolean;
  moving: boolean;
  onSelect: () => void;
  onFavorite: () => void;
}) {
  const status = parkingStatus(candidate);
  return (
    <article className={`parking-card ${active ? "active" : ""}`}>
      <button
        className="parking-select"
        aria-label={`${rank}번 ${candidate.lot.name}`}
        aria-pressed={active}
        onClick={onSelect}
      >
        <span className="parking-rank">{rank}</span>
        <div className="parking-card-content">
          <h3>{candidate.lot.name}</h3>
          <div className="card-stats">
            <span>
              차량 <b>{minute(candidate.drive_minutes)}분</b>
            </span>
            <i />
            <span>
              도보 <b>{candidate.walk_meters}m</b>
            </span>
          </div>
          <div className="card-bottom">
            <span className={`availability ${status.tone}`}>
              <i />
              {status.label}
              {status.known && <b>{candidate.lot.available}면</b>}
            </span>
            <span className="card-fee">{money(candidate.estimated_fee)}</span>
          </div>
        </div>
      </button>
      <button
        className={`favorite ${favorite ? "saved" : ""}`}
        aria-label={`${candidate.lot.name} ${favorite ? "즐겨찾기 해제" : "즐겨찾기 저장"}`}
        disabled={moving}
        onClick={onFavorite}
      >
        <Heart size={23} fill={favorite ? "currentColor" : "none"} />
      </button>
    </article>
  );
}
