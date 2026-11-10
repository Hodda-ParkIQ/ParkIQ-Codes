# 검증 기록

최종 확인일: 2026-11-10 (Asia/Seoul)

## 통과한 검증

| 검증 | 결과 |
| --- | --- |
| Python 정적 검사 | Ruff 통과 |
| 백엔드·DB 테스트 | **20 passed**, skip 없음 |
| 프런트엔드 | TypeScript 검사 + Vite production build 통과 |
| Android | `:app:assembleDebug` 성공, NaviHelper 3.0.5 실제 Maven 의존성 사용 |
| Docker 구성 | `docker compose config --quiet` 통과 |
| 브라우저 사용자 흐름 | 기존 9개 + 연결 모드 8개 검증 묶음 통과, 미처리 JavaScript 오류 없음 |
| PostGIS 실행 계획 | `ST_DWithin`에 `parking_lots_location_gist` Index Scan 확인 |

## 실제 DB 테스트

시스템 서비스·기존 DB를 수정하지 않고 작업 디렉터리에 PostgreSQL 18.6 / PostGIS 3.6.2를 별도로 풀어 임시 인스턴스로 실행했습니다. 전용 `parkiq_test` DB에서 테스트를 수행했습니다.

- geography 거리 필터와 반경 200m 조회
- 공간 레코드 업서트와 최신 잔여 대수 반영
- demo/live 쿼리 분리
- PostGIS 확장·스키마 생성

실행 중인 앱은 별도 `parkiq_demo` DB를 사용하며 가상 주차장 8개를 저장합니다. `/api/health` 응답의 `mode=demo`, `repository=postgres`, `routing=distance_estimate`로 확인합니다. `EXPLAIN`은 작은 테스트 테이블의 순차 스캔 비용 효과를 배제하기 위해 해당 세션에서 `enable_seqscan=off`를 사용해 인덱스 적용 가능성을 확인한 것입니다. 대용량 성능 벤치마크는 수행하지 않았습니다.

## 브라우저 검증

Playwright + Chrome headless로 다음을 점검했습니다.

1. 추천 기준 변경 시 API 순위와 선택된 최상위 추천 변경
2. 즐겨찾기 저장과 페이지 재로딩 후 유지
3. EV 필터에 따른 후보 6개 → 3개 → 6개 변화
4. 목적지 검색과 주행 중 검색·설정 비활성화
5. 음성 예시로 선호 변경, 2번 선택, 안내 시작·종료, 기록 생성
6. API 오류 노출 및 재시도 복구
7. 1440×1080 데스크톱, 1280×720 차량 가로 화면, 390×844 모바일 배치 확인
8. 모의 차량 브리지에서 가상 주차장 실제 안내 차단 및 Gleo 검색 결과 콜백 확인
9. 미처리 브라우저 오류 없음

차량 가로 화면에서는 전체 페이지 스크롤 없이 하단 음성 조작부가 뷰포트 안에 표시됩니다. 목록은 화면 높이에 맞춰 페이지로 표시합니다. 모바일 정차 상태에서는 가로 넘침 없이 세로 배치로 전환하고, 주행 상태에서는 간편 모드로 주요 조작부를 화면 안에 유지합니다.

### UI 1.1 후속 검증

현대차 ccNC/Pleos 참고 디자인으로 교체한 뒤 브라우저 9개 검증 묶음을 다시 통과했습니다. 목록은 자체 스크롤에서 페이지 방식으로 변경했습니다. 1440×1080은 3곳, 1280×720은 2곳을 표시하며, 720px 화면에서도 목록 내용이 잘리지 않는 것을 확인합니다. 주간/야간 설정 유지, 정렬·페이지 변경에 따른 선택/지도 일치, 48px 이상 주요 터치 영역, 주행 중 검색·최근 기록·지도 확대 제한을 추가 검증했습니다.

음성 패널은 모달로 화면을 막지 않으며 390×844 주행 상태에서도 안내 버튼이 가려지지 않습니다. 마이크 하드웨어 대신 시험용 전사 인터페이스와 예시 명령으로 동작을 검증합니다. Android 1.1.0 APK에서 새 앱 아이콘, Gleo 스키마 버전, `CarUxRestrictionsManager` 연동 및 음성 취소 코드의 컴파일을 확인했습니다. 해당 시점에는 연결된 에뮬레이터가 없어 새 네이티브 이벤트 동작은 미검증입니다.

### 앱 내부 시연 / 백엔드 전환 1.2

- `scripts/check-api-modes.py`: API가 없는 정적 서버(4173)에서 내부 추천·필터·음성 의도 해석을 실행하고 **API 요청 0건** 확인
- 저장 전 연결 확인, `/api` 접미사 정규화, 다른 origin의 실제 백엔드 요청, 설정 재로딩 유지
- 503 오류·잘못된 JSON·접속 거부에서 오류 표시, 내부 가상 데이터로 자동 대체하지 않음
- `mode=live` 응답에 `demo=true` 시설이 섞인 경우 거부
- 주소 삭제 시 내부 시연 복원. 저장된 빈 주소가 네이티브 빌드 기본 URL보다 우선
- 모의 네이티브 호스트에서 URL·경로·POST 본문 전달, 브라우저 API fetch 없음, 설정 변경 후 늦은 응답 무시
- 기존 UI 9개 검증 묶음과 PostGIS 포함 백엔드 20개 테스트 재통과
- Android 1.2.0 컴파일 성공. APK 안의 UI·폰트 파일 6개와 Gleo 스키마가 소스/production build와 바이트 단위로 일치

이번 연결 모드 검증은 Playwright 브라우저 및 모의 네이티브 전송 계약 검증입니다. 연결된 `emulator-5554`에서 1.2.0 설치를 시도했으나 `cmd: Can't find service: package`로 실패했고 재시도도 `Cannot access system provider: settings before system providers are installed` 오류로 실패했습니다. 에뮬레이터 시스템 서비스가 정상화되지 않아 실제 Android WebView의 내부 assets 로드와 네이티브 HTTP 통신 실행은 아직 확인하지 못했습니다. APK 빌드 성공을 실차 실행 성공으로 해석하지 않습니다.

### 2026-11-10 에뮬레이터 실행 확인

연결된 Pleos Connect v2.1.0 `emulator-5554`에서 기존 앱의 `versionName=1.0.0`, `versionCode=1`을 확인했습니다. `adb install -r release/ParkIQ-debug.apk`는 `Success`를 반환했고 설치 후 `versionName=1.2.0`, `versionCode=3`을 확인했습니다.

`am start -W -n ai.parkiq.vehicle/.MainActivity` 실행 후 실제 화면과 UIAutomator에서 ParkIQ, 내부 시연, 정차 중, 주차장 6개, 설정 등 UI 표시를 확인했습니다. 이때 백엔드 서버는 실행하지 않았습니다. 따라서 APK 내장 프런트의 Android WebView 로드와 내부 시연 실행은 확인한 상태입니다. 앱 시작 직후에는 권한 창과 렌더링 대기가 있어 에뮬레이터 홈 화면이 잠시 남았습니다.

기본 에뮬레이터 GPS가 시연 지역 밖에 있어 이동 시간이 약 49,000분으로 계산되어, 테스트 위치를 `adb emu geo fix 127.0602 37.5385`로 성수에 맞췄습니다. 화면 캡처는 `artifacts/emulator-current.png`입니다. 네이티브 HTTP 실서버 통신, 실제 내비 경로 요청, Gleo 실제 음성 호출, 실차 검증까지 통과한 것은 아닙니다.

## 환경과 남은 검증

- Python 3.14.4, Node.js 22.22.1, pnpm 10.20.0
- Android compile/target SDK 35, min SDK 31, Gradle 8.11.1, JDK 21
- Starlette TestClient의 httpx 마이그레이션 deprecation warning 1개가 있으며 테스트 실패는 아닙니다.
- Android CarPropertyManager 구형 콜백 API에 deprecation 경고가 있으나 SDK 35에서 컴파일됩니다.
- Docker daemon이 실행되지 않아 이미지 빌드·컨테이너 기동은 검증하지 않았습니다. 실제 DB는 위의 별도 PostGIS 인스턴스로 검증했습니다.
- 후속 라이브 점검에서 연결된 Pleos 에뮬레이터(`emulator-5554`, Android 14, automotive feature)에 APK 설치가 성공했습니다. `am start -W`는 20초 내 완료되지 않았고 화면은 흰색이었습니다. 동시점 에뮬레이터 crash log에서 `com.android.car: CarServiceHelper did not connect`와 기본 차량 앱의 Car 서비스 접근 오류가 관측되었습니다. ParkIQ 실행 완료나 내비 연동 성공을 확인한 결과는 아닙니다. Cold Boot 후 차량 서비스 상태 확인이 필요하며 실차는 미검증입니다.
- 후속 점검에서 서울시 `sample` 키로 `GetParkingInfo`와 코드별 `GetParkInfo`를 실제 호출해 HTTP 200/INFO-000을 확인했습니다. 세종로 공영주차장의 실제 좌표·잔여 대수·관측 시각을 정규화하고 임시 `live` 모드 API 추천 1건이 반환되는 것을 검증했습니다. 명령은 `scripts/check-seoul-sample.py`입니다. 운영 인증키를 통한 전체 수집·민간 플랫폼·교통 경로 실계정 호출은 미검증입니다.
- APK의 `assets/schema.json`이 원본 Gleo 스키마와 일치하고 함수 3개를 포함하는 것을 ZIP 엔트리로 확인했습니다. Gleo 서비스의 스키마 승인/실제 음성 호출·콜백은 미검증입니다.
- 마이크 실제 음성 인식과 오디오 재생은 하드웨어로 검증하지 않았으며, UI의 예시 명령과 의도 해석 흐름을 검증했습니다.
- 심사 승인, 앱 등록, 실차 배포, 운영 인증·관측, 대규모 부하 테스트는 별도 단계입니다.

실제 주차 가능성, 실제 도로 경로, 주차 시간 30% 단축 또는 예측 정확도를 실증한 결과로 해석하면 안 됩니다.
