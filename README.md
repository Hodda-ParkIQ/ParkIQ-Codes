# ParkIQ

목적지까지의 **차량 이동 + 주차 탐색 + 도보 이동**을 함께 고려하는 차량용 주차 추천 프로젝트입니다. 첨부 기획서와 원본 ZIP의 요구사항을 바탕으로 React/TypeScript UI, FastAPI API, PostGIS 저장소, 데이터 수집 파이프라인, Pleos Android 호스트를 구현했습니다.

UI 1.3은 현대차 ccNC와 Pleos 공식 가이드를 참고한 지도·목록 중심 구성입니다. 주간/야간 전환, 화면 높이에 따른 1~3곳 페이지 표시, 고정 안내 버튼, 주행 중 부분 음성 패널을 제공합니다. [화면 설계와 참고 자료](docs/UI_DESIGN.md)에 변경 근거와 검증 범위를 기록했습니다.

## Android Studio에서 바로 빌드

Android Studio에서 **`android` 폴더**를 열고 Gradle Sync 후 **Build APK(s)** 또는 **Run ▶**을 누릅니다. Android SDK 35가 필요하며 Gradle은 JDK 21을 사용합니다. 첫 빌드에 인터넷 연결이 필요합니다.

- 기본 API: **https://testhyundai.devmultid.org**. 별도 `.env` 생성이나 서버 주소 입력 없이 연결합니다.
- Gradle이 Node.js 22.22.1과 pnpm 10.20.0을 프로젝트에 자동으로 준비하고, 의존성 설치 → 웹 빌드 → assets 포함 → APK 생성을 수행합니다. 시스템 Node/Corepack/pnpm을 설치할 필요가 없습니다.
- 기본 Debug와 Release 모두 실데이터를 사용합니다. 테스트 위치, 내부 시연 전환, 서버 주소 편집은 노출하지 않습니다. 이전 APK에서 저장한 빈 주소·다른 서버 주소·테스트 좌표는 적용하지 않습니다.
- GPS 수신 전에는 위치 확인 화면을 표시합니다. 실제 위치를 받은 뒤 주변 주차장을 조회합니다. API 오류나 서버 시연 응답을 가상 데이터로 대체하지 않습니다.
- 생성 APK: `android/app/build/outputs/apk/debug/app-debug.apk`. 배포용 사본: `release/ParkIQ-debug.apk`.

명령줄에서도 동일한 기본값으로 빌드합니다.

```bash
cd android
./gradlew :app:assembleDebug
```

웹만 실행할 때는 Node.js 22와 Corepack으로 다음을 실행합니다. 기본 API는 APK와 같습니다.

```bash
cd frontend
corepack pnpm@10.20.0 install --frozen-lockfile
corepack pnpm@10.20.0 build
corepack pnpm@10.20.0 preview
```

웹의 다른 API 주소는 `VITE_API_BASE_URL`로 빌드 시 지정할 수 있습니다. 브라우저로 연결하려면 서버의 CORS 허용 목록에 웹 origin을 추가합니다. APK는 내장 UI와 네이티브 HTTP 전송기를 사용합니다. 공공·민간 API 키는 백엔드 `.env`에만 보관합니다.

## 개발용 시연을 명시적으로 실행

기본 빌드에는 적용되지 않습니다. API 키 없이 가상 시설·잔여 대수를 확인하는 개발용 명령입니다.

```bash
./scripts/run-demo.sh
# 앱/API: http://localhost:8000
```

웹에서는 `VITE_ENABLE_TEST_TOOLS=true VITE_API_BASE_URL= corepack pnpm@10.20.0 build`, Android에서는 `./gradlew :app:assembleDebug -PenableTestTools=true`로 테스트 도구를 명시적으로 켭니다. Release에서는 이 옵션을 지정해도 테스트 도구가 꺼집니다.

이 모드에서만 **설정 → 데이터 연결**로 서버 주소를 저장하거나 비워서 내부 시연으로 전환할 수 있습니다. 개발용 서버는 `-PbackendApiUrl=http://10.0.2.2:8000 -PenableTestTools=true`로 지정합니다. 실제 차량 안내에 가상 주차장·테스트 위치를 사용하지 않습니다.

## 테스트 중 차량 위치 옮기기 (1.3)

정차 상태에서 **설정 → 테스트 위치**를 엽니다. `VITE_ENABLE_TEST_TOOLS=true`인 웹과 `-PenableTestTools=true`로 빌드한 디버그 APK에서만 제공합니다. 기본 빌드와 릴리스 APK에는 노출하지 않습니다.

- 위도·경도를 입력하거나 성수/서울숲/종로 프리셋 선택 후 **차량 위치 적용**: 출발 위치만 변경하고 기존 목적지는 유지합니다.
- **이 위치 주변 찾기**: 출발 위치와 검색 목적지를 함께 바꿔 해당 지역 반경 2km의 주차장을 조회합니다.
- **지도에서 위치 선택** 후 지도 클릭: 차량 테스트 위치를 지정합니다. 적용 후 파란 차량 마커를 끌어서도 옮길 수 있습니다.
- **GPS 위치로 복귀**: 저장된 테스트 좌표를 해제하고 차량 GPS 또는 브라우저 위치를 사용합니다.

테스트 위치는 재실행 후에도 유지되며 지도에 **테스트 위치**로 표시합니다. 활성화 중 수신한 차량 GPS가 지정 좌표를 덮어쓰지 않습니다. 주행 제한 중에는 위치 편집을 막고 지도 선택을 취소합니다. 테스트 좌표로 실제 차량 내비게이션을 시작하지 않으며, 경로 연동을 시험하려면 GPS로 복귀해야 합니다.

내부 시연 데이터는 성수 지역에만 있으므로 종로 등으로 옮긴 뒤 그 주변을 찾으면 결과가 없을 수 있습니다. 다른 지역의 실제 시설 조회에는 해당 지역 데이터가 수집된 백엔드를 연결하세요.

## PostgreSQL + PostGIS 실행

Docker Desktop 또는 Docker Engine을 실행한 뒤:

```bash
cp .env.example .env
docker compose up --build -d
```

로컬 <http://localhost:8000>에서 앱과 API를 제공합니다. 백엔드 기본값은 `DATA_MODE=live`, `SYNC_ENABLED=true`입니다. 기존 서버의 API 키를 `.env`에 유지하세요. 키가 없거나 수집되지 않은 지역은 빈 결과로 표시합니다. 웹 기본 API는 위의 원격 주소이며 로컬 API를 사용할 때는 `VITE_API_BASE_URL`을 지정해 빌드합니다. 컨테이너 앱은 PostgreSQL 저장소를 사용하고, DB는 외부 포트를 열지 않습니다. `db/001_init.sql`이 최초 볼륨 생성 시 PostGIS 확장, geography(Point,4326), GiST 공간 인덱스를 생성합니다. 기존 DB에 적용할 때는 해당 SQL을 직접 실행하세요.

이미 8000 포트에서 로컬 서버가 실행 중이면 먼저 종료하세요. `docker compose down`으로 종료하며, DB 볼륨은 유지합니다.

### 백엔드만 호스팅

프론트엔드를 다른 곳(정적 호스팅, 차량 앱 내장 등)에서 제공하고 서버는 API만 띄울 때 사용합니다. `.env`에 다음을 지정합니다.

```bash
APP_TARGET=api          # Docker 이미지에서 프론트엔드 빌드(Node)를 생략
SERVE_FRONTEND=false    # 빌드된 화면이 있어도 / 에 마운트하지 않음
CORS_EXTRA_ORIGINS=https://web.example.com   # 프론트엔드 주소(쉼표로 여러 개)
```

```bash
docker compose up -d --build app
```

`/`는 API 안내 JSON을 반환하고, API는 그대로 `/api/*`에서 제공합니다. 이미지만 빌드할 때는 `docker build --target api -t parkiq-api .`를 사용합니다. Docker 없이 실행할 때는 `SERVE_FRONTEND=false`만 지정하면 됩니다. 웹은 빌드 시 `VITE_API_BASE_URL`, APK는 `-PbackendApiUrl=https://...`로 이 서버 주소를 지정합니다. 기본값(`APP_TARGET=full`, `SERVE_FRONTEND=true`)은 기존처럼 앱과 API를 함께 제공합니다.

## 구현 기능

- 목적지 반경 최대 2km의 주차장 탐색: PostGIS `ST_DWithin`, GiST, KNN 정렬
- 스마트 추천 / 도보 최소 / 시간 우선 / 요금 우선 기준 전환
- 차량·탐색·도보 시간, 예상 주차 요금, 만차 위험도, 추천 이유 제공
- 만차·폐쇄 제외, 전기차·접근성 API 필터, 잔여 정보 미제공·노후화 구분
- 주차 시간별 기본/추가 요금과 일 최대 요금 계산
- 목적지 선택, 주차장 지도 선택, 즐겨찾기, 최근 안내 기록
- 30초마다 UI 재조회, 수동 새로고침, 요청 취소 및 오류·빈 결과 상태
- 음성 명령 해석, 브라우저 STT/TTS, Gleo 함수 호출 브리지
- 큰 목록과 주요 터치 영역, 키보드 접근, 주행 중 검색·설정·지도 확대 입력 제한
- Pleos NaviHelper 3.0.5로 주차장 경로 요청·취소·기존 경로의 첫 경유지 추가
- AAOS UX 제한·차량 속도·GPS 이벤트를 웹 UI로 전달. UX 제한과 속도 미확인 시 입력 잠금 유지
- 공급자별 페이지 수집, 데이터 정규화·업서트, 실패 시 이전 관측 데이터 보존

## 실데이터 연결

API 키를 발급받기 전에는 공개 샘플로 실제 응답과 추천 API를 점검할 수 있습니다.

```bash
.venv/bin/python scripts/check-seoul-sample.py
```

이 명령은 서울시 실시간 공개 샘플 5건 중 좌표가 유효한 시설 1곳을 조회하고 `live` 모드 추천까지 검사합니다. 실행 중인 앱의 설정이나 DB를 변경하지 않습니다. 전체 목록 수집은 다음의 개인 인증키 설정이 필요합니다.

`.env`에서 다음을 설정하고 앱을 재시작합니다.

```dotenv
DATA_MODE=live
REPOSITORY=postgres
SEOUL_API_KEY=발급받은_서울_열린데이터광장_인증키
SYNC_ENABLED=true
ADMIN_API_KEY=임의의_충분히_긴_관리자키
```

서울시 공개 스키마의 `GetParkInfo` 기본정보와 `GetParkingInfo` 실시간 대수를 `PKLT_CD`로 결합합니다. 실시간 응답에 좌표가 없으므로 기본정보의 `LAT`/`LOT`을 사용합니다. 잔여 대수는 총 면수에서 현재 주차 차량 수를 뺍니다. 미연계·잘못된 관측 시각은 잔여 미확인으로 보존합니다. 기본 수집 주기는 300초이며 관측 후 600초 이상 지난 데이터는 추천에서 확인 필요로 표시합니다.

공공데이터포털의 전국 주차장 표준데이터는 시설 기본정보와 실제 실시간 대수 제공 범위가 다릅니다. 이 구현은 실시간 데이터가 공개된 서울시 제공 API를 사용합니다. 다른 지자체 API는 해당 공급자의 승인된 스키마에 맞는 Provider를 추가해야 합니다.

인증키가 없거나 수집에 실패해도 `live` 모드에서 데모 데이터를 섞지 않습니다. `/api/health`의 `configured_providers`와 `providers`를 확인하세요. 강제 수집은 `POST /api/admin/sync`에 `Authorization: Bearer <ADMIN_API_KEY>`를 보내 실행합니다. 원본 URL에 포함된 키나 공급자 응답 본문은 오류 로그에 남기지 않습니다.

민간 플랫폼은 계약·허가된 서버 측 어댑터 URL을 `PRIVATE_API_URL`, 토큰을 `PRIVATE_API_KEY`로 지정합니다. 특정 민간 서비스의 비공개 API를 추측해 호출하지 않습니다. 공급자와 경로 제공자 계약은 [연동 규격](docs/INTEGRATIONS.md)에 있습니다.

### 성수 지역 주차장이 나오지 않을 때

서울시 `GetParkInfo`의 성수 지역 일부 시설은 위도·경도가 `0, 0`으로 제공됩니다. 1.3 백엔드는 [성동구도시관리공단 공식 공개 API](https://www.happysd.or.kr/c_75/cnt/m_108/view.do)의 좌표로 보완합니다. 시설명과 지번 주소가 모두 일치하고 좌표 후보가 하나인 경우만 사용하며, 기존의 유효한 서울시 좌표는 유지합니다. 별도 인증키는 필요하지 않습니다. 좌표 원본은 `lot.coordinate_source`, 보완 건수는 `/api/health`의 `providers.seoul.diagnostics.coordinate_enriched`로 확인합니다. 잔여 대수를 제공하지 않는 시설은 `available=null`(미확인)로 표시합니다.

```bash
# 공개 샘플 검증. 실행 중인 서버와 DB는 수정하지 않음
.venv/bin/python scripts/check-seongsu-live.py

# 변경한 소스를 실제 서버에 복사한 뒤, 기존 인증키 설정을 유지하며 앱 재빌드
# .env의 DATA_MODE=live, SYNC_ENABLED=true 확인
docker compose up -d --build app
```

기존 원격 서버에는 변경 소스를 반영하고 재시작해야 적용됩니다. Python으로 직접 실행하는 서버는 Uvicorn을 재시작합니다. 재시작 후 첫 수집이 완료되면 보완된 시설을 조회할 수 있습니다. 이 수정은 가상 시설을 live 데이터에 섞지 않습니다.

## 추천 계산과 현재 한계

```text
score = 주행분 + 탐색분 + (도보분 × 보행가중치)
        + (예상요금/1000 × 요금가중치) + 정보불확실성패널티
```

| 기준 | 보행 가중치 | 요금 가중치 |
| --- | ---: | ---: |
| 스마트 추천 | 1.25 | 0.15 |
| 도보 최소 | 3.5 | 0.1 |
| 시간 우선 | 1.0 | 0 |
| 요금 우선 | 1.0 | 4.0 |

주차 탐색 시간은 현재 점유율 기반 휴리스틱입니다. 이는 **학습된 AI 예측이나 검증된 만차 확률이 아닙니다**. 운전자 선호도에 따라 설명 가능한 가중치를 적용합니다.

경로 계산 우선순위는 `ROUTING_API_URL`(계약 공급자) → `VALHALLA_URL`(셀프호스팅 OSM 경로 엔진) → 거리 추정입니다. 둘 다 없거나 실패하면 주행 거리는 직선거리 × 1.35, 도보 거리는 직선거리 × 1.2로 추정합니다. 주행 속도 15km/h, 도보 속도 4.5km/h 가정이며 **실시간 교통·실제 보행로를 반영하지 않습니다**. 지도 배경은 OpenStreetMap 타일입니다.

Valhalla는 무료 오픈소스 경로 엔진으로, OSM 한국 데이터로 실제 도로·보행로를 따라가는 차량·도보 경로를 계산합니다(실시간 교통 미반영).

```bash
VALHALLA_URL=http://valhalla:8002 docker compose --profile routing up -d
```

첫 실행 때 Geofabrik에서 `south-korea-latest.osm.pbf`를 받아 타일을 생성하므로 수십 분과 RAM 4GB 이상이 필요합니다. 결과는 `valhalla-data` 볼륨에 보존되어 다음 실행부터는 바로 뜹니다. 진행 상황은 `docker compose logs -f valhalla`, 준비 여부는 `curl localhost:8002/status`로 확인합니다. Docker 없이 백엔드를 실행할 때는 `VALHALLA_URL=http://localhost:8002`를 사용합니다. `/api/health`의 `routing` 값이 `valhalla`로, 추천 응답의 `routing_source`가 `valhalla`로 표시됩니다.

목적지 검색은 사전 등록된 성수 지역 4곳입니다. 전국 장소 검색/지오코딩, 예약·결제, EV 충전 잔여 상태 예측, 학습 모델, 전국 지자체 수집은 현재 범위에 포함되지 않습니다. 추천 API 자체는 임의의 목적지 좌표를 받습니다.

## Pleos / Gleo Android

Pleos Connect는 AAOS 기반 네이티브 SDK를 제공합니다. 웹 UI는 `window.ParkIQNative`라는 **이 프로젝트의 자체 호스트 계약**으로 Kotlin과 통신하며, 공식 JavaScript SDK라고 가정하지 않습니다.

빌드는 위의 **Android Studio에서 바로 빌드** 절차를 따릅니다. 별도 프런트엔드 준비 명령 없이 Gradle이 필요한 도구와 웹 assets를 준비합니다. Gradle 8.11.1 / AGP 8.9.2 / JDK 21 조합을 사용합니다.

UI는 `https://appassets.androidplatform.net/index.html`에서 `WebViewAssetLoader`로 로드하고 네이티브 HTTP 전송기가 기본 API 요청을 처리합니다. Android 호스트에는 브라우저 CORS가 적용되지 않습니다. `-PbackendApiUrl=https://...`로 빌드 기본 API를 명시적으로 바꿀 수 있으며 이전 `-PparkiqUrl` 별칭도 지원합니다.

릴리스는 HTTPS 서버가 필요합니다. 프로젝트는 release 서명 키를 포함하지 않습니다. Gleo App Schema는 [android/gleo-app-schema.json](android/gleo-app-schema.json)에 있으며 빌드 시 APK의 `assets/schema.json`으로 자동 복사합니다. 공식 규격의 함수 3개와 콜백을 구현했습니다. 실제 Gleo 사용에는 Pleos 프로젝트 등록, 스키마 심사/승인, 해당 환경의 권한과 서비스가 필요합니다. 웹 음성 시연은 Gleo 서비스와 별도의 브라우저 기능입니다. 호스트 마이크 버튼은 Android SpeechRecognizer/TTS를 사용하며, Gleo 호출은 등록된 Intent 경로로 별도 처리합니다.

가상 시설을 차량으로 안내하는 요청은 차단합니다. 실제 차량 경로 요청은 `DATA_MODE=live`로 공급자 데이터를 연결한 후 사용하세요. 내비게이션 성공 표시는 SDK 호출 시점이 아니라 `onRoutingCompleted`/`onWaypointChanged`/`onRouteCancelled` 콜백에 따릅니다. 기획서의 기존 내비 경유지 시나리오는 차량 호스트 화면의 **기존 내비 경로에 경유지로 추가**로 제공합니다. 일반 안내는 주차장을 차량 목적지로 설정하고, 원래 목적지는 도보 도착지로 유지합니다.

이전 버전의 에뮬레이터 검증과 이번 버전의 검증 범위는 [검증 결과](docs/VALIDATION.md)에 기록합니다.

이미 빌드된 APK는 실행 중인 에뮬레이터 창으로 `release/ParkIQ-debug.apk`를 끌어 놓거나 아래 명령으로 업데이트합니다.

```bash
# 프로젝트 루트에서 실행
"$HOME/Android/Sdk/platform-tools/adb" install -r release/ParkIQ-debug.apk
"$HOME/Android/Sdk/platform-tools/adb" shell am start -n ai.parkiq.vehicle/.MainActivity
```

소스 수정 후에는 `android` 폴더에서 `./gradlew :app:installDebug`를 실행하면 웹·APK 빌드와 연결된 기기 설치를 함께 수행합니다. 첫 실행에서 위치·마이크 권한 창이 나올 수 있습니다. 실제 기기는 GPS를 사용합니다. 에뮬레이터에서 위치를 검증할 때는 Extended Controls → Location으로 GPS를 전달하세요.


## 개발 및 검증

```bash
.venv/bin/pip install -r backend/requirements-dev.txt
.venv/bin/ruff check backend
.venv/bin/pytest -q
# 전용 테스트 DB만 지정: 테스트가 parking_lots를 TRUNCATE합니다.
TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/parkiq_test .venv/bin/pytest -q
cd frontend
corepack pnpm@10.20.0 build
```

PostGIS URL이 없으면 DB 통합 테스트 1개만 건너뜁니다. [검증 결과](docs/VALIDATION.md)에 실제 실행 환경과 결과를 기록합니다. UI 기능 점검 스크립트는 `scripts/check-ui.py`이며 실행 중인 앱과 Chrome이 필요합니다.

개발 서버를 분리할 때는 백엔드 `uvicorn ... --port 8000`, 프런트엔드에서 `VITE_API_BASE_URL=http://localhost:8000 corepack pnpm dev`를 실행합니다. 테스트 도구가 필요한 경우에만 `VITE_ENABLE_TEST_TOOLS=true`를 추가합니다.

`scripts/check-api-modes.py`는 4173 포트의 정적 전용 웹 서버를 직접 띄워 내부/서버 모드 전환, CORS 통신, 오류 시 가상 데이터로 전환하지 않는 동작, 네이티브 전송 계약을 검사합니다. 테스트 도구를 켜고 API 주소를 비운 웹 빌드와 데모 API(8000 포트)가 필요합니다. 기본 실데이터 빌드는 `scripts/check-live-defaults.py`로 검증합니다.

웹과 APK 빌드 후 `.venv/bin/python scripts/package-project.py`로 소스·빌드된 웹 UI·디버그 APK를 `release/ParkIQ-project.zip`에 묶을 수 있습니다. 로컬 환경 파일·캐시·DB·가상환경은 포함하지 않습니다.

## 구조

```text
frontend/src/       차량용 React UI, 내부 시연 엔진, API 전환, 음성·차량 브리지
backend/app/        API, 추천, 공간 저장소, 경로 어댑터, 수집 파이프라인
backend/tests/      API·추천·수집·PostGIS 통합 검증
db/                PostGIS 초기 스키마
android/           AAOS WebView 호스트, NaviHelper 연동, Gleo App Schema
docs/              연동 규격, 요구사항 매핑, 검증 기록, 원본 README
scripts/           로컬 실행 및 브라우저 검증
```

연동 근거는 [Pleos 공식 SDK 문서](https://document.pleos.ai/en/docs/pleos-only/connect-sdk-pleos/NaviHelper/intro), [Gleo 공식 인터페이스 문서](https://document.pleos.ai/en/docs/pleos-only/app-integration-guide/guide/core-concepts), [서울시 실시간 주차대수](https://data.seoul.go.kr/dataList/OA-21709/A/1/datasetView.do), [서울시 주차장 기본정보 스키마](https://data.seoul.go.kr/dataList/openApiView.do?infId=OA-13122&srvType=A)입니다. 2026-11-09에 확인했습니다.
