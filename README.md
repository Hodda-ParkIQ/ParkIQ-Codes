# ParkIQ

목적지까지의 **차량 이동 + 주차 탐색 + 도보 이동**을 함께 고려하는 차량용 주차 추천 프로젝트입니다. 첨부 기획서와 원본 ZIP의 요구사항을 바탕으로 React/TypeScript UI, FastAPI API, PostGIS 저장소, 데이터 수집 파이프라인, Pleos Android 호스트를 구현했습니다.

UI 1.2는 현대차 ccNC와 Pleos 공식 가이드를 참고한 지도·목록 중심 구성입니다. 주간/야간 전환, 화면 높이에 따른 1~3곳 페이지 표시, 고정 안내 버튼, 주행 중 부분 음성 패널을 제공합니다. [화면 설계와 참고 자료](docs/UI_DESIGN.md)에 변경 근거와 검증 범위를 기록했습니다.

## 바로 실행

Python 3.12 이상, Node.js 22, Corepack이 필요합니다.

```bash
./scripts/run-demo.sh
```

- 앱: <http://localhost:8000>
- API 문서: <http://localhost:8000/docs>
- 상태: <http://localhost:8000/api/health>

화면은 기본적으로 **앱 내부 가상 데이터**를 사용합니다. 서버 주소를 지정하면 백엔드 API로 전환됩니다. 위 명령으로 함께 실행하는 백엔드는 기본적으로 가상 데이터와 메모리 저장소를 사용합니다. API 키나 Docker 없이 성수 지역 시나리오를 실행합니다. 가상 시설·주차 대수와 거리 기반 추정 경로임을 화면과 API 응답에 표시합니다. 주차장 명칭·요금·대수는 실제 시설 정보가 아닙니다.

## 앱의 데이터 연결 설정

정차 상태에서 **설정 → 데이터 연결**을 엽니다.

| 서버 주소 | 앱 동작 |
| --- | --- |
| 비어 있음 (기본값) | 앱에 포함된 가상 주차장 8곳, 목적지 4곳으로 추천·요금·음성 의도 해석을 수행. API 요청 없음 |
| URL 저장됨 | 해당 서버의 `/api/health`, `/api/places`, `/api/recommendations`, `/api/voice/interpret`로 통신 |
| URL이 있지만 연결 실패 | 오류와 재시도 표시. 내부 가상 데이터로 자동 전환하지 않음 |

예: 웹 브라우저는 `http://localhost:8000`, 같은 PC의 Android 에뮬레이터는 `http://10.0.2.2:8000`, 다른 기기는 PC의 LAN 주소를 입력합니다. `/api` 접미사는 입력해도 한 번만 붙습니다. **연결 확인**은 저장 전 상태 점검이고 **주소 저장**이 실제 전환입니다. **서버 주소 지우고 내부 시연 사용**으로 서버 없이 돌아갑니다. 설정은 기기별로 보존되며 검색·설정은 주행 제한 중 잠깁니다.

서버에 연결했다고 곧바로 실데이터가 되는 것은 아닙니다. 서버의 `DATA_MODE=demo`는 **서버 시연**, `DATA_MODE=live`는 실제 공급자 데이터입니다. 내부 시연은 항상 `demo=true`이고 실제 차량 내비게이션으로 안내하지 않습니다. 공공·민간 API 키는 백엔드 `.env`에만 보관합니다.

서버 없이 웹만 실행하려면:

```bash
cd frontend
corepack pnpm@10.20.0 install --frozen-lockfile
corepack pnpm@10.20.0 build
corepack pnpm@10.20.0 preview
# http://localhost:4173
```

웹 빌드 기본 URL은 `frontend/.env.example`을 `frontend/.env.local`로 복사해 `VITE_API_BASE_URL`에 지정할 수도 있습니다. 브라우저에서 다른 origin의 서버에 연결할 때는 백엔드 `CORS_ORIGINS`에 웹 origin을 허용해야 합니다. HTTPS 웹 페이지에서는 HTTPS API를 사용하세요. 기기에서 저장한 설정(빈 주소 포함)이 빌드 기본값보다 우선합니다.

## PostgreSQL + PostGIS 실행

Docker Desktop 또는 Docker Engine을 실행한 뒤:

```bash
cp .env.example .env
docker compose up --build -d
```

같은 <http://localhost:8000>에서 앱과 API를 제공합니다. 컨테이너 앱은 PostgreSQL 저장소를 사용하고, DB는 외부 포트를 열지 않습니다. `db/001_init.sql`이 최초 볼륨 생성 시 PostGIS 확장, geography(Point,4326), GiST 공간 인덱스를 생성합니다. 기존 DB에 적용할 때는 해당 SQL을 직접 실행하세요.

이미 8000 포트에서 로컬 서버가 실행 중이면 먼저 종료하세요. `docker compose down`으로 종료하며, DB 볼륨은 유지합니다.

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

`ROUTING_API_URL` 미설정 시 주행 거리는 직선거리 × 1.35, 도보 거리는 직선거리 × 1.2로 추정합니다. 주행 속도 15km/h, 도보 속도 4.5km/h 가정이며 **실시간 교통·실제 보행로를 반영하지 않습니다**. 지도는 시연용 SVG 개략도이며 실제 길 안내 지도가 아닙니다. 계약된 교통/경로 제공자를 연결하면 API의 시간·geometry를 사용할 수 있지만 화면 배경은 계속 개략도입니다.

목적지 검색은 사전 등록된 성수 지역 4곳입니다. 전국 장소 검색/지오코딩, 예약·결제, EV 충전 잔여 상태 예측, 학습 모델, 전국 지자체 수집은 현재 범위에 포함되지 않습니다. 추천 API 자체는 임의의 목적지 좌표를 받습니다.

## Pleos / Gleo Android

Pleos Connect는 AAOS 기반 네이티브 SDK를 제공합니다. 웹 UI는 `window.ParkIQNative`라는 **이 프로젝트의 자체 호스트 계약**으로 Kotlin과 통신하며, 공식 JavaScript SDK라고 가정하지 않습니다.

Android SDK 35, JDK 17/21, Node.js 22, Corepack이 필요합니다. 먼저 프런트엔드 의존성을 설치합니다.

```bash
cd frontend
corepack pnpm@10.20.0 install --frozen-lockfile
cd ../android
./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

생성 APK: `android/app/build/outputs/apk/debug/app-debug.apk`. **UI·폰트·시연 데이터가 APK 안에 포함되어 백엔드 없이 시작합니다.** Gradle이 웹 production build와 assets 복사를 수행합니다. 화면 파일을 변경한 경우 APK를 다시 빌드·설치해야 합니다.

서버 연결은 앱의 데이터 연결 설정에서 지정합니다. 빌드 기본값으로 지정하려면:

```bash
./gradlew :app:assembleDebug -PbackendApiUrl=http://10.0.2.2:8000
```

이 값은 API 서버 주소이며 화면을 내려받는 URL이 아닙니다. 미지정이면 내부 시연입니다. 이전 `-PparkiqUrl` 이름도 API 기본값의 별칭으로 지원합니다. UI는 `https://appassets.androidplatform.net/index.html`에서 `WebViewAssetLoader`로 로드하고 네이티브 HTTP 전송기가 API 요청을 처리하므로 Android 호스트에는 브라우저 CORS가 적용되지 않습니다.

릴리스는 HTTPS 서버가 필요합니다. 프로젝트는 release 서명 키를 포함하지 않습니다. Gleo App Schema는 [android/gleo-app-schema.json](android/gleo-app-schema.json)에 있으며 빌드 시 APK의 `assets/schema.json`으로 자동 복사합니다. 공식 규격의 함수 3개와 콜백을 구현했습니다. 실제 Gleo 사용에는 Pleos 프로젝트 등록, 스키마 심사/승인, 해당 환경의 권한과 서비스가 필요합니다. 웹 음성 시연은 Gleo 서비스와 별도의 브라우저 기능입니다. 호스트 마이크 버튼은 Android SpeechRecognizer/TTS를 사용하며, Gleo 호출은 등록된 Intent 경로로 별도 처리합니다.

가상 시설을 차량으로 안내하는 요청은 차단합니다. 실제 차량 경로 요청은 `DATA_MODE=live`로 공급자 데이터를 연결한 후 사용하세요. 내비게이션 성공 표시는 SDK 호출 시점이 아니라 `onRoutingCompleted`/`onWaypointChanged`/`onRouteCancelled` 콜백에 따릅니다. 기획서의 기존 내비 경유지 시나리오는 차량 호스트 화면의 **기존 내비 경로에 경유지로 추가**로 제공합니다. 일반 안내는 주차장을 차량 목적지로 설정하고, 원래 목적지는 도보 도착지로 유지합니다.

**1.2.0 APK 컴파일, 브라우저 전환 검증, 서울시 공개 샘플 호출은 통과했습니다.** 기존 APK를 설치했던 Pleos 에뮬레이터에서는 차량 서비스 오류와 흰 화면이 관측되었고, 이번 1.2.0 설치 시도는 패키지 서비스 및 시스템 `settings` provider 오류로 실패했습니다. 에뮬레이터를 정상 기동한 뒤 새 APK의 내부 화면 로드·네이티브 API 통신·내비 연동을 확인해야 합니다. 실차 실행, Gleo 스키마 심사/승인, 공급자 실계정 전체 수집은 미검증입니다. 웹뷰 기반 UI의 차량 배포 적합성 및 주행 중 사용 가능 범위는 실제 Pleos 앱 심사에서 추가 확인이 필요합니다.

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

개발 서버를 분리할 때는 백엔드 `uvicorn ... --port 8000`, 프런트엔드에서 `corepack pnpm dev`를 실행합니다. 앱 설정에 `http://localhost:8000`을 저장하면 백엔드에 직접 연결합니다. Vite의 `/api` 프록시도 유지하지만 주소를 비워두면 내부 시연을 사용합니다.

`scripts/check-api-modes.py`는 4173 포트의 정적 전용 웹 서버를 직접 띄워 내부/서버 모드 전환, CORS 통신, 오류 시 가상 데이터로 전환하지 않는 동작, 네이티브 전송 계약을 검사합니다. 데모 API가 8000 포트에서 실행 중이어야 합니다.

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
