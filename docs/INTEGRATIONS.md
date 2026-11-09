# 서버와 차량 연동 규격

## API

앱 서버 주소가 비어 있으면 API 호출 없이 `frontend/src/local-api.ts`의 가상 엔진을 사용합니다. URL이 지정되면 그 주소에 `/api`를 붙여 통신합니다. 설정은 localStorage → 네이티브 `getDefaultBackendUrl()` 또는 웹 `VITE_API_BASE_URL` → 빈 주소 순으로 선택하며, 저장된 빈 주소도 유효한 선택입니다. 연결 실패 시 가상 데이터로 자동 전환하지 않습니다. 내부 시연 데이터 원본은 `backend/app/demo.py`이며 `scripts/export-demo-fixture.py`로 JSON을 재생성합니다.

브라우저는 fetch/CORS, Android는 아래의 `backend.request` 계약을 사용합니다. 동일한 HTTP 상태·JSON 형식 검사를 거치고 요청 시간 제한과 이전 요청 취소를 적용합니다.

`POST /api/recommendations`:

```json
{
  "origin": {"lat": 37.5385, "lng": 127.0602},
  "destination": {"id": "venue", "name": "성수 카페거리", "address": "서울 성동구", "lat": 37.5446, "lng": 127.0542},
  "preference": "balanced",
  "radius_m": 2000,
  "stay_minutes": 60,
  "ev_only": false,
  "accessible_only": false,
  "limit": 6
}
```

응답은 `mode`, `generated_at`, `candidates`, `excluded_full`, `warnings`를 포함합니다. 후보별 `lot.observed_at`은 원본 관측 시각, `fetched_at`은 수집 시각입니다. `generated_at`은 API 계산 시각이며 잔여 데이터의 갱신 시각을 의미하지 않습니다. `available=null`은 미제공이며 0은 만차입니다. `stale=true` 또는 `risk=unknown`이면 미확인으로 표시하세요.

`POST /api/voice/interpret`는 `{"text":"덜 걷는 곳으로 찾아줘"}`를 받고 구조화된 `action`, `preference`, `rank`, `query`, `reply`를 반환합니다. 브라우저 음성 전사를 위한 결정적 의도 해석기이며 Gleo LLM 서비스 호출이 아닙니다.

## 서울시 공급자

- 기본정보: `/{KEY}/json/GetParkInfo/{START}/{END}/`
- 실시간: `/{KEY}/json/GetParkingInfo/{START}/{END}/`
- 키: `PKLT_CD`, 기본 좌표 `LAT`/`LOT`
- 대수: `TPKCT - NOW_PRK_VHCL_CNT`
- 원본시각: `NOW_PRK_VHCL_UPDT_TM` (시차 없으면 Asia/Seoul)
- 상태: `PRK_STTS_YN=1`일 때만 대수 활용, 그 외 미확인
- 최대 1000행씩 페이지 처리. 상한 50,000행이며 상한 초과·오류 응답은 실패 처리

서울시 기본 공개 endpoint가 HTTP여서 서버 측에서만 호출합니다. 공급자가 HTTPS 서비스를 제공하면 `SEOUL_BASE_URL`을 변경할 수 있습니다. 인증키는 프런트엔드에 포함하지 않습니다.

기본정보와 실시간 목록이 성공한 뒤 provider snapshot을 한 트랜잭션으로 업서트합니다. 오류 시 이전 데이터를 보존하고 원본 관측 시각을 바꾸지 않습니다. 응답에서 사라진 시설은 삭제하지 않으므로 공급자 계약에 따라 장기 미관측 시설의 폐쇄/삭제 상태를 별도 수집해야 합니다. 현재 오래된 자료는 미확인·불확실성 패널티로 처리합니다. 서로 다른 공급자의 동일 물리 시설 자동 중복 제거는 구현하지 않았습니다.

## 민간 주차 플랫폼 어댑터

`GET PRIVATE_API_URL` + `Authorization: Bearer PRIVATE_API_KEY`

```json
{
  "lots": [{
    "id": "partner-42", "source_id": "42", "source": "partner",
    "name": "제휴 주차장", "address": "서울 성동구", "lat": 37.5446, "lng": 127.0542,
    "capacity": 100, "available": 25,
    "base_fee": 1500, "base_minutes": 30, "extra_fee": 500, "extra_minutes": 10,
    "daily_max": 30000, "ev": true, "accessible": true, "is_open": true,
    "observed_at": "2026-11-09T08:00:00Z", "fetched_at": "2026-11-09T08:00:05Z",
    "demo": false
  }]
}
```

불명 값은 `null`로 전달합니다. 시각은 반드시 시간대를 포함해야 합니다. 실제 민간 사업자의 응답을 위 형식으로 바꾸는 서버는 사업자 계약에 맞게 별도 배포합니다. 저장 시 ID를 `private:{source_id}`로 강제하여 서울시 레코드와 충돌하지 않게 합니다. 여러 민간 사업자를 동시에 추가하려면 각 사업자의 이름공간을 구분하도록 Provider를 확장하세요.

## 교통·경로 제공자 어댑터

`POST ROUTING_API_URL` + `Authorization: Bearer ROUTING_API_KEY`

입력: `origin`, `parking`, `destination` 각각 `{lat,lng}`.

```json
{
  "drive": {"minutes": 6.5, "meters": 1700, "path": [{"lat":37.5385,"lng":127.0602},{"lat":37.5446,"lng":127.0542}]},
  "walk": {"minutes": 2.1, "meters": 158, "path": [{"lat":37.5446,"lng":127.0542},{"lat":37.5448,"lng":127.0552}]},
  "source": "contracted_provider"
}
```

`path`는 실제 경로 점들을 순서대로 전달합니다. 주행 leg는 현재 위치→주차장, 도보 leg는 주차장→최종 장소입니다. 유효성 오류/통신 실패/4초 전체 예산 초과 시 거리 추정으로 전환하고 `routing_source=distance_estimate` 경고를 표시합니다. 동시 호출은 최대 8개입니다. 공급자별 traffic 적용 여부는 계약된 어댑터에서 보장해야 합니다. 이 프로젝트만으로 실시간 교통정보를 생성하지 않습니다.

## 차량 브리지

웹→호스트:

```json
{"id":"request-id","method":"navigation.start","params":{"parking":{"id":"seoul:42","name":"주차장","lat":37.54,"lng":127.05,"demo":false},"destination":{"name":"방문 장소","lat":37.54,"lng":127.05}}}
```

`window.ParkIQNative.postMessage(JSON.stringify(request))`를 사용합니다.

호스트→웹: `window.dispatchEvent(new CustomEvent('parkiq:native-reply',{detail:{id,ok,data,error}}))`.

| method | 동작 |
| --- | --- |
| `backend.request` | `{baseUrl,path,method,body}`를 받아 `{status,body}` 반환. health/places GET, recommendations/voice POST만 허용 |
| `vehicle.state` | `parkiq:vehicle`로 `{moving,origin?}` 전달 |
| `navigation.start` | 주차장을 차량 목적지로 요청, 성공 콜백 대기 |
| `navigation.addWaypoint` | 기존 내비 경로의 첫 경유지에 주차장 추가 |
| `navigation.cancel` | 취소 성공 콜백 대기 |
| `voice.listen` | Android SpeechRecognizer 전사 반환 |
| `voice.cancel` | 진행 중인 Android 음성 인식 취소 및 종료 |
| `voice.speak` | Android TTS로 `text` 재생 |
| `gleo.respond` | 대기 Gleo 호출에 공식 응답 Broadcast 전송 |

UI는 APK assets의 `index.html`, JS/CSS, 폰트를 `WebViewAssetLoader`로 로드합니다. `https://appassets.androidplatform.net/index.html`만 브리지 호출을 허용하며 외부 문서 탐색·네트워크 리소스를 차단합니다. 파일 접근은 비활성화합니다. `window.ParkIQNative.getDefaultBackendUrl()`은 빌드 기본 API 주소만 반환합니다.

`backend.request`는 네이티브 작업 스레드에서 명시한 서버에 HTTP 요청합니다. 인증 정보·쿼리·fragment가 있는 URL, 미허용 경로/메서드, redirect는 거부합니다. HTTP는 디버그만, 릴리스는 HTTPS만 허용합니다. API 주소를 바꾸더라도 브리지 권한을 가진 화면의 origin은 바뀌지 않습니다. 소스 프로젝트에는 비밀키·릴리스 서명 키가 없습니다.

`moving`은 UI의 간편 모드 여부를 뜻합니다. 호스트가 AAOS `CarUxRestrictionsManager`의 주의 분산 제한을 우선 반영하고, 값이 없으면 차량 속도를 사용합니다. 둘 다 미확인일 때는 제한 상태를 전달합니다. UI의 검색/설정/최근 기록은 이를 기준으로 잠깁니다.

## Gleo

[App Schema](../android/gleo-app-schema.json)는 공식 [App Schema 가이드](https://document.pleos.ai/en/docs/pleos-only/app-integration-guide/guide/app-capability)에 맞춰 최대 3개 대문자 함수, 영어 설명, 지원하는 parameter 타입만 사용합니다.

Gleo Intent의 `ACTION_PARAM` JSON 또는 개별 extras를 파싱해 `parkiq:gleo` 이벤트로 전달합니다. 웹에서 처리 결과를 반환하면 `ai.pleos.playground.intent.action.APP_ACTION_RESPONSE`에 `packageName`, `response`를 담아 전송합니다. 응답 상태는 success/asking/fail이고, Gleo의 7초 제한보다 짧은 6.2초에 호스트 timeout을 처리합니다.

Gradle의 `generateGleoSchema` 작업이 원본 스키마를 APK의 `assets/schema.json`으로 포함합니다. Gleo는 앱 설치 또는 부팅 시 이 파일을 읽습니다. [스키마 전달 절차](https://document.pleos.ai/en/docs/pleos-only/app-integration-guide/guide/deliver-schema)의 심사/승인 및 해당 에뮬레이터의 Gleo 서비스 가용성을 확인해야 합니다. 프로젝트에는 서명된 Gleo 서비스나 승인 계정을 포함하지 않습니다.
