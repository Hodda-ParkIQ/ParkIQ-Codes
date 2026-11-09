import { LocateFixed, Minus, Navigation2, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
};
export default function ParkingMap({
  candidates,
  ranks,
  selected,
  destination,
  origin,
  onSelect,
  navigating,
  moving,
}: Props) {
  const element = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1000, height: 600 });
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box?.width && box.height)
        setSize({ width: box.width, height: box.height });
    });
    if (element.current) observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  const project = useMemo(() => {
    const points = [origin, destination, ...candidates.map((c) => c.lot)];
    const minLng = Math.min(...points.map((p) => p.lng)),
      maxLng = Math.max(...points.map((p) => p.lng));
    const minLat = Math.min(...points.map((p) => p.lat)),
      maxLat = Math.max(...points.map((p) => p.lat));
    const centerLng = (minLng + maxLng) / 2,
      centerLat = (minLat + maxLat) / 2;
    const horizontal = 111000 * Math.cos((centerLat * Math.PI) / 180);
    const scale = Math.max(
      0.01,
      Math.min(
        (size.width - 150) / Math.max(1800, (maxLng - minLng) * horizontal),
        (size.height - 145) / Math.max(1200, (maxLat - minLat) * 111000),
      ),
    );
    return (p: Point) => [
      size.width / 2 + (p.lng - centerLng) * horizontal * scale,
      size.height / 2 - (p.lat - centerLat) * 111000 * scale,
    ];
  }, [origin, destination, candidates, size]);
  const path = (points: Point[]) =>
    points.map((p, i) => `${i ? "L" : "M"}${project(p).join(" ")}`).join(" ");
  const road = (coords: number[][]) =>
    path(coords.map(([lat, lng]) => ({ lat, lng })));
  const [dx, dy] = project(destination),
    [ox, oy] = project(origin);
  const markers = useMemo(() => {
    type Rect = { x: number; y: number; width: number; height: number };
    const occupied: Rect[] = [
      { x: 12, y: 10, width: 230, height: 52 },
      { x: 12, y: 73, width: 215, height: 53 },
      { x: size.width - 80, y: 10, width: 70, height: 72 },
      { x: size.width - 220, y: size.height - 88, width: 210, height: 80 },
      { x: dx + 15, y: dy - 56, width: 82, height: 40 },
      { x: ox - 25, y: oy - 25, width: 50, height: 50 },
    ];
    const intersects = (a: Rect, b: Rect) =>
      a.x < b.x + b.width + 7 &&
      a.x + a.width + 7 > b.x &&
      a.y < b.y + b.height + 7 &&
      a.y + a.height + 7 > b.y;
    const placements: Record<
      string,
      { x: number; y: number; ax: number; ay: number }
    > = {};
    const ordered = [...candidates].sort(
      (a, b) =>
        Number(b.lot.id === selected?.lot.id) -
        Number(a.lot.id === selected?.lot.id),
    );
    const offsets = [
      [0, 0],
      [0, -82],
      [82, 0],
      [-82, 0],
      [0, 82],
      [-82, -82],
      [82, -82],
      [-82, 82],
      [82, 82],
      [0, -164],
      [164, 0],
      [-164, 0],
      [0, 164],
      [-164, -82],
      [164, -82],
      [-164, 82],
      [164, 82],
    ];
    for (const candidate of ordered) {
      const [ax, ay] = project(candidate.lot);
      let position = { x: ax, y: ay };
      for (const [offsetX, offsetY] of offsets) {
        const x = Math.max(40, Math.min(size.width - 40, ax + offsetX));
        const y = Math.max(40, Math.min(size.height - 45, ay + offsetY));
        const bounds = { x: x - 32, y: y - 32, width: 64, height: 72 };
        if (!occupied.some((rect) => intersects(bounds, rect))) {
          position = { x, y };
          occupied.push(bounds);
          break;
        }
      }
      placements[candidate.lot.id] = { ...position, ax, ay };
    }
    return placements;
  }, [candidates, selected?.lot.id, project, size, dx, dy, ox, oy]);
  const roads = [
    [
      [37.552, 127.027],
      [37.5446, 127.0559],
      [37.541, 127.07],
    ],
    [
      [37.5467, 127.028],
      [37.5405, 127.0559],
      [37.5374, 127.07],
    ],
    [
      [37.556, 127.0415],
      [37.534, 127.0415],
    ],
    [
      [37.556, 127.0528],
      [37.534, 127.0528],
    ],
    [
      [37.556, 127.0602],
      [37.534, 127.0602],
    ],
    [
      [37.5451, 127.04],
      [37.5449, 127.053],
      [37.5435, 127.067],
    ],
    [
      [37.55, 127.047],
      [37.534, 127.047],
    ],
    [
      [37.55, 127.056],
      [37.534, 127.056],
    ],
  ];
  return (
    <div className="map" ref={element}>
      <div className="map-top">
        <span className="map-area-name">목적지 주변</span>
        <span className="map-type">예시 지도</span>
      </div>
      <svg
        className="map-svg"
        viewBox={`${(size.width - size.width / zoom) / 2} ${(size.height - size.height / zoom) / 2} ${size.width / zoom} ${size.height / zoom}`}
        aria-label="주차장 위치 개략도. 파란색은 차량 이동, 점선은 도보 이동 예시입니다."
        role="img"
      >
        <defs>
          <pattern
            id="city-blocks"
            width="112"
            height="96"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(13)"
          >
            <path d="M0 0H112V96H0Z" fill="var(--map-land)" />
            <rect
              x="12"
              y="13"
              width="38"
              height="27"
              rx="2"
              fill="var(--map-building)"
            />
            <rect
              x="58"
              y="13"
              width="40"
              height="27"
              rx="2"
              fill="var(--map-building)"
            />
            <rect
              x="12"
              y="48"
              width="55"
              height="34"
              rx="2"
              fill="var(--map-building)"
            />
            <rect
              x="75"
              y="48"
              width="23"
              height="34"
              rx="2"
              fill="var(--map-building)"
            />
            <path
              d="M0 0H112M0 0V96"
              fill="none"
              stroke="var(--map-small-road)"
              strokeWidth="8"
            />
          </pattern>
        </defs>
        <rect
          x="-2500"
          y="-2500"
          width="6000"
          height="6000"
          fill="url(#city-blocks)"
        />
        <path
          d={road([
            [37.5407, 127.025],
            [37.5412, 127.035],
            [37.5365, 127.045],
            [37.531, 127.07],
          ])}
          fill="none"
          stroke="var(--map-river)"
          strokeWidth="100"
        />
        <path
          d={
            road([
              [37.548, 127.032],
              [37.547, 127.039],
              [37.541, 127.04],
              [37.54, 127.033],
            ]) + " Z"
          }
          fill="var(--map-park)"
        />
        {roads.map((coords, index) => (
          <g key={index}>
            <path
              d={road(coords)}
              fill="none"
              stroke="var(--map-road-edge)"
              strokeWidth={index < 2 ? 25 : 14}
            />
            <path
              d={road(coords)}
              fill="none"
              stroke="var(--map-road)"
              strokeWidth={index < 2 ? 21 : 11}
            />
            {index < 2 && (
              <path
                d={road(coords)}
                fill="none"
                stroke="var(--map-road-center)"
                strokeWidth="1.5"
              />
            )}
          </g>
        ))}
        <text
          {...label(project({ lat: 37.547, lng: 127.049 }))}
          className="district-label"
        >
          성수동
        </text>
        <text
          {...label(project({ lat: 37.545, lng: 127.0368 }))}
          className="park-label"
        >
          서울숲
        </text>
        <text
          {...label(project({ lat: 37.5462, lng: 127.057 }))}
          className="road-label"
        >
          성수역
        </text>
        <text
          {...label(project({ lat: 37.55, lng: 127.0408 }))}
          className="road-label"
        >
          아차산로
        </text>
        <text
          {...label(project({ lat: 37.5389, lng: 127.053 }))}
          className="road-label"
        >
          뚝섬로
        </text>
        {selected && (
          <g className="route-lines" data-active={navigating}>
            <path
              d={path(selected.drive_path)}
              fill="none"
              stroke="var(--map-route-casing)"
              strokeWidth="12"
              strokeLinejoin="round"
            />
            <path
              d={path(selected.drive_path)}
              fill="none"
              stroke="var(--map-route)"
              strokeWidth="7"
              strokeLinejoin="round"
            />
            <path
              d={path(selected.walk_path)}
              fill="none"
              stroke="var(--map-walk)"
              strokeWidth="5"
              strokeDasharray="3 9"
              strokeLinecap="round"
            />
          </g>
        )}
        <g transform={`translate(${dx} ${dy})`}>
          <circle
            r="9"
            fill="var(--map-destination)"
            stroke="var(--map-road)"
            strokeWidth="3"
          />
          <rect
            x="18"
            y="-54"
            width="79"
            height="36"
            rx="4"
            fill="var(--map-label-background)"
          />
          <text x="30" y="-29" className="destination-map-label">
            목적지
          </text>
        </g>
        {candidates.map((candidate) => {
          const { x, y, ax, ay } = markers[candidate.lot.id],
            active = selected?.lot.id === candidate.lot.id;
          return (
            <g key={candidate.lot.id}>
              {(Math.abs(x - ax) > 5 || Math.abs(y - ay) > 5) && (
                <g pointerEvents="none">
                  <path
                    d={`M${ax} ${ay}L${x} ${y}`}
                    fill="none"
                    stroke="var(--map-pin-border)"
                    strokeWidth="1.5"
                  />
                  <circle cx={ax} cy={ay} r="4" fill="var(--map-pin-active)" />
                </g>
              )}
              <g
                className={`map-pin ${active ? "active" : ""}`}
                transform={`translate(${x} ${y})`}
                role="button"
                tabIndex={0}
                aria-label={`${ranks[candidate.lot.id]}번 ${candidate.lot.name} 선택`}
                aria-pressed={active}
                onClick={() => onSelect(candidate.lot.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(candidate.lot.id);
                  }
                }}
              >
                <rect
                  x="-36"
                  y="-36"
                  width="72"
                  height="76"
                  fill="transparent"
                  stroke="none"
                />
                <rect
                  x="-32"
                  y="-32"
                  width="64"
                  height="64"
                  rx="8"
                  fill={
                    active
                      ? "var(--map-pin-active)"
                      : "var(--map-pin-background)"
                  }
                  stroke={
                    active ? "var(--map-pin-active)" : "var(--map-pin-border)"
                  }
                  strokeWidth="2"
                />
                <text
                  y="9"
                  textAnchor="middle"
                  fontSize="24"
                  fontWeight="650"
                  fill={active ? "#fff" : "var(--map-pin-text)"}
                >
                  P
                  <tspan dx="3" fontSize="20">
                    {ranks[candidate.lot.id]}
                  </tspan>
                </text>
                {active && (
                  <path d="M-7 32L0 40L7 32" fill="var(--map-pin-active)" />
                )}
              </g>
            </g>
          );
        })}
        <g transform={`translate(${ox} ${oy})`}>
          <circle r="26" fill="var(--map-location-halo)" />
          <circle
            r="17"
            fill="var(--map-route)"
            stroke="#fff"
            strokeWidth="3"
          />
          <path d="M0 -10L8 8L0 4L-8 8Z" fill="#fff" />
        </g>
      </svg>
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
          disabled={moving || zoom >= 1.7}
          onClick={() => setZoom(Math.min(1.7, zoom + 0.2))}
        >
          <Plus size={27} />
        </button>
        <button
          className="map-control"
          aria-label="지도 축소"
          disabled={moving || zoom <= 0.7}
          onClick={() => setZoom(Math.max(0.7, zoom - 0.2))}
        >
          <Minus size={27} />
        </button>
        <button
          className="map-control"
          aria-label="지도 중심으로"
          onClick={() => setZoom(1)}
        >
          <LocateFixed size={27} />
        </button>
      </div>
    </div>
  );
}
function label([x, y]: number[]) {
  return { x, y, textAnchor: "middle" as const };
}
