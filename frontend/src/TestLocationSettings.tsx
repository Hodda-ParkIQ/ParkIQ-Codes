import { useEffect, useState } from "react";
import type { Point } from "./types";
import { validLocation } from "./test-location";

const presets = [
  { name: "성수", lat: 37.5385, lng: 127.0602 },
  { name: "서울숲", lat: 37.5445, lng: 127.0374 },
  { name: "종로", lat: 37.5725, lng: 126.9753 },
];

export default function TestLocationSettings({
  origin,
  active,
  disabled,
  onApply,
  onPick,
  onRestore,
}: {
  origin: Point;
  active: boolean;
  disabled: boolean;
  onApply: (point: Point, searchNearby: boolean) => void;
  onPick: () => void;
  onRestore: () => void;
}) {
  const [lat, setLat] = useState(origin.lat.toFixed(6));
  const [lng, setLng] = useState(origin.lng.toFixed(6));
  const [error, setError] = useState("");
  useEffect(() => {
    setLat(origin.lat.toFixed(6));
    setLng(origin.lng.toFixed(6));
    setError("");
  }, [origin.lat, origin.lng]);
  function apply(searchNearby: boolean) {
    const point = { lat: Number(lat), lng: Number(lng) };
    if (!lat.trim() || !lng.trim() || !validLocation(point)) {
      setError("위도는 -90~90, 경도는 -180~180 사이의 숫자를 입력하세요.");
      return;
    }
    setError("");
    onApply(point, searchNearby);
  }
  return (
    <section className="test-location-settings" aria-label="테스트 위치 설정">
      <h3>테스트 위치</h3>
      <p>
        {active
          ? "지정한 좌표를 사용 중입니다. 차량 GPS는 적용하지 않습니다."
          : "지도에서 지점을 선택하거나 좌표를 입력해 차량 위치를 옮깁니다."}
      </p>
      <fieldset disabled={disabled}>
        <legend className="sr-only">테스트 차량 좌표</legend>
        <div className="test-coordinate-fields">
          <label>
            위도
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min="-90"
              max="90"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
            />
          </label>
          <label>
            경도
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min="-180"
              max="180"
              value={lng}
              onChange={(e) => setLng(e.target.value)}
            />
          </label>
        </div>
        <div
          className="test-location-presets"
          aria-label="테스트 위치 바로 선택"
        >
          {presets.map((p) => (
            <button
              key={p.name}
              className="secondary"
              onClick={() => {
                setLat(String(p.lat));
                setLng(String(p.lng));
                setError("");
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
        <div className="test-location-actions">
          <button className="secondary" onClick={() => apply(false)}>
            차량 위치 적용
          </button>
          <button className="primary" onClick={() => apply(true)}>
            이 위치 주변 찾기
          </button>
          <button className="secondary" onClick={onPick}>
            지도에서 위치 선택
          </button>
          {active && (
            <button className="secondary" onClick={onRestore}>
              GPS 위치로 복귀
            </button>
          )}
        </div>
      </fieldset>
      {error && (
        <p className="test-location-error" role="alert">
          {error}
        </p>
      )}
      <p className="test-location-help">
        테스트 중에는 차량 마커를 끌어서 옮길 수도 있습니다. 테스트 위치로 실제
        차량 내비게이션을 시작할 수는 없습니다.
      </p>
      {disabled && (
        <p role="status">안내를 종료한 뒤 테스트 위치를 변경하세요.</p>
      )}
    </section>
  );
}
