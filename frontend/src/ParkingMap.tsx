import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { LocateFixed, Minus, Navigation2, Plus } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Candidate, Place, Point } from "./types";

type Props = {
  candidates: Candidate[];
  ranks: Record<string, number>;
  selected?: Candidate;
  destination: Place;
  origin: Point;
  onSelect: (id: string) => void;
  navigating: boolean;
  moving: boolean;
  testLocationActive: boolean;
  pickingTestLocation: boolean;
  onOriginChange: (point: Point) => void;
};

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';

const toLatLng = (p: Point): L.LatLngTuple => [p.lat, p.lng];

export default function ParkingMap({
  candidates,
  ranks,
  selected,
  destination,
  origin,
  onSelect,
  navigating,
  moving,
  testLocationActive,
  pickingTestLocation,
  onOriginChange,
}: Props) {
  const element = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const overlayRef = useRef<L.LayerGroup | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const originChangeRef = useRef(onOriginChange);
  originChangeRef.current = onOriginChange;
  const pickingRef = useRef(false);
  pickingRef.current = pickingTestLocation && !moving && !navigating;
  const fitAllRef = useRef<() => void>(() => {});

  // 지도 인스턴스는 한 번만 생성
  useEffect(() => {
    if (!element.current) return;
    const map = L.map(element.current, {
      zoomControl: false,
      attributionControl: true,
      center: toLatLng(destination),
      zoom: 15,
      maxZoom: 19,
      minZoom: 11,
    });
    map.attributionControl.setPrefix(false);
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);
    overlayRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    map.on("click", (event: L.LeafletMouseEvent) => {
      if (pickingRef.current) {
        const point = event.latlng.wrap();
        originChangeRef.current({ lat: point.lat, lng: point.lng });
      }
    });
    const observer = new ResizeObserver(() => {
      map.invalidateSize({ pan: false });
      fitAllRef.current();
    });
    observer.observe(element.current);
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fitAll = () => {
    const map = mapRef.current;
    if (!map) return;
    const bounds = L.latLngBounds([
      toLatLng(origin),
      toLatLng(destination),
      ...candidates.map((c) => toLatLng(c.lot)),
    ]);
    map.fitBounds(bounds, {
      paddingTopLeft: [
        90,
        testLocationActive || pickingTestLocation ? 80 : 140,
      ],
      paddingBottomRight: [
        90,
        testLocationActive || pickingTestLocation ? 80 : 100,
      ],
      maxZoom: 17,
      animate: false,
    });
  };
  fitAllRef.current = fitAll;

  // 후보·목적지·출발지가 바뀌면 화면 맞춤
  const boundsKey = [
    origin.lat,
    origin.lng,
    destination.id,
    destination.lat,
    destination.lng,
    testLocationActive,
    pickingTestLocation,
    ...candidates.map((c) => c.lot.id),
  ].join("|");
  useEffect(() => {
    fitAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundsKey]);

  // 주행 중에는 지도 조작 잠금
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const handlers = [
      map.dragging,
      map.scrollWheelZoom,
      map.doubleClickZoom,
      map.touchZoom,
      map.boxZoom,
      map.keyboard,
    ];
    handlers.forEach((h) => (moving ? h.disable() : h.enable()));
  }, [moving]);

  // 경로·마커 다시 그리기
  useEffect(() => {
    const group = overlayRef.current;
    if (!group) return;
    group.clearLayers();

    if (selected) {
      const drive = selected.drive_path.map(toLatLng);
      const walk = selected.walk_path.map(toLatLng);
      const state = navigating ? " active" : "";
      L.polyline(drive, {
        weight: 12,
        lineJoin: "round",
        interactive: false,
        className: `osm-drive-casing${state}`,
      }).addTo(group);
      L.polyline(drive, {
        weight: 7,
        lineJoin: "round",
        interactive: false,
        className: `osm-drive${state}`,
      }).addTo(group);
      L.polyline(walk, {
        className: "osm-walk",
        weight: 5,
        dashArray: "3 9",
        lineCap: "round",
        interactive: false,
      }).addTo(group);
    }

    L.marker(toLatLng(destination), {
      icon: L.divIcon({
        className: "osm-destination",
        html: '<span class="osm-destination-dot"></span><span class="osm-destination-label">목적지</span>',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      }),
      keyboard: false,
      interactive: false,
      zIndexOffset: 500,
    }).addTo(group);

    for (const candidate of candidates) {
      const active = selected?.lot.id === candidate.lot.id;
      const rank = ranks[candidate.lot.id];
      const marker = L.marker(toLatLng(candidate.lot), {
        icon: L.divIcon({
          className: `osm-pin ${active ? "active" : ""}`,
          html: `<span class="osm-pin-box">P<small>${rank ?? ""}</small></span>${active ? '<span class="osm-pin-tail"></span>' : ""}`,
          iconSize: [56, 64],
          iconAnchor: [28, 64],
        }),
        title: `${rank}번 ${candidate.lot.name} 선택`,
        alt: `${rank}번 ${candidate.lot.name}`,
        riseOnHover: true,
        zIndexOffset: active ? 1000 : 0,
      });
      marker.on("click", () => {
        if (!pickingRef.current) onSelectRef.current(candidate.lot.id);
      });
      marker.addTo(group);
      const el = marker.getElement();
      if (el) {
        el.setAttribute("role", "button");
        el.setAttribute("aria-label", `${rank}번 ${candidate.lot.name} 선택`);
        el.setAttribute("aria-pressed", String(active));
      }
    }

    const movable = testLocationActive && !moving && !navigating;
    const vehicleMarker = L.marker(toLatLng(origin), {
      icon: L.divIcon({
        className: "osm-origin",
        html: '<span class="osm-origin-halo"></span><span class="osm-origin-dot"><svg viewBox="-10 -10 20 20" width="20" height="20"><path d="M0 -10L8 8L0 4L-8 8Z" fill="#fff"/></svg></span>',
        iconSize: [52, 52],
        iconAnchor: [26, 26],
      }),
      keyboard: movable,
      interactive: movable,
      draggable: movable,
      title: movable ? "테스트 차량 위치: 끌어서 이동" : "차량 위치",
      alt: movable ? "테스트 차량 위치: 끌어서 이동" : "차량 위치",
      zIndexOffset: 2000,
    }).addTo(group);
    vehicleMarker.on("dragend", () => {
      const position = vehicleMarker.getLatLng().wrap();
      originChangeRef.current({ lat: position.lat, lng: position.lng });
    });
  }, [
    candidates,
    ranks,
    selected,
    destination,
    origin,
    navigating,
    testLocationActive,
    moving,
  ]);

  return (
    <div
      className={`map${pickingTestLocation ? " picking-test-location" : ""}`}
    >
      <div
        className="map-leaflet"
        ref={element}
        aria-label="OpenStreetMap 주차장 위치 지도. 파란색은 차량 이동, 점선은 도보 이동 예시입니다."
        role="region"
      />
      <div className="map-top">
        <span className="map-area-name">목적지 주변</span>
        <span className="map-type">OpenStreetMap</span>
      </div>
      <div className="map-legend">
        <span>
          <i className="drive-line" />
          차량
        </span>
        <span>
          <i className="walk-line" />
          도보
        </span>
      </div>
      <div className="compass" aria-label="북쪽">
        <span>N</span>
        <Navigation2 size={21} />
      </div>
      <div className="map-controls">
        <button
          className="map-control"
          aria-label="지도 확대"
          disabled={moving}
          onClick={() => mapRef.current?.zoomIn()}
        >
          <Plus size={27} />
        </button>
        <button
          className="map-control"
          aria-label="지도 축소"
          disabled={moving}
          onClick={() => mapRef.current?.zoomOut()}
        >
          <Minus size={27} />
        </button>
        <button
          className="map-control"
          aria-label="지도 중심으로"
          onClick={fitAll}
        >
          <LocateFixed size={27} />
        </button>
      </div>
    </div>
  );
}
