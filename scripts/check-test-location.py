"""Test relocatable positions against the built UI, with deterministic API/vehicle fixtures."""

import asyncio
import json
import os
import sys
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402
from app.providers.seongdong import enrich_coordinates  # noqa: E402
from app.providers.seoul import normalize  # noqa: E402
from app.repository import MemoryRepository  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def settings(page):
    page.get_by_role("button", name="설정", exact=True).click()
    return page.get_by_role("region", name="테스트 위치 설정", exact=True)


def close_settings(page):
    page.get_by_role("dialog", name="주차 설정").get_by_role(
        "button", name="닫기", exact=True
    ).click()


def saved(page):
    return page.evaluate("JSON.parse(localStorage.getItem('parkiq-test-location'))")


def run():
    repo = MemoryRepository()
    # Published facility coordinates; availability is deliberately unknown.
    metadata, _ = enrich_coordinates(
        [
            {
                "PKLT_CD": "172130",
                "PKLT_NM": "성수2가3동(건물) 공영주차장(구)",
                "ADDR": "성동구 성수동2가 299-19",
                "TPKCT": 192,
                "LAT": 0,
                "LOT": 0,
            }
        ],
        [
            {
                "주차장명": "성수2가3동(건물)",
                "소재지지번주소": "서울특별시 성동구 성수동2가 299-19",
                "위도_WGS84좌표": 37.5490127,
                "경도_WGS84좌표": 127.0549305,
            }
        ],
    )
    asyncio.run(repo.upsert(normalize(metadata, [])))
    app = create_app(Settings(_env_file=None, data_mode="live", repository="memory"), repo)
    server = ThreadingHTTPServer(
        ("127.0.0.1", 0), partial(QuietHandler, directory=str(ROOT / "frontend/dist"))
    )
    threading.Thread(target=server.serve_forever, daemon=True).start()
    target = f"http://127.0.0.1:{server.server_port}"
    checks, errors, requests = [], [], []
    try:
        with TestClient(app) as client, sync_playwright() as p:
            browser = p.chromium.launch(
                executable_path=os.getenv("CHROME_PATH", "/usr/bin/google-chrome"),
                headless=True,
                args=["--no-sandbox"],
            )

            def prepare(page):
                page.on("pageerror", lambda error: errors.append(str(error)))
                # Tile loading is outside these interaction checks.
                page.route("https://tile.openstreetmap.org/**", lambda route: route.abort())

            page = browser.new_page(viewport={"width": 1440, "height": 1080})
            prepare(page)
            page.goto(target, wait_until="networkidle")
            expect(page.locator(".parking-card")).to_have_count(3)
            panel = settings(page)
            panel.get_by_label("위도", exact=True).fill("91")
            panel.get_by_role("button", name="차량 위치 적용", exact=True).click()
            expect(panel.get_by_role("alert")).to_contain_text("-90~90")
            assert saved(page) is None
            panel.get_by_role("button", name="서울숲", exact=True).click()
            panel.get_by_role("button", name="차량 위치 적용", exact=True).click()
            close_settings(page)
            expect(page.locator(".map-location")).to_contain_text("테스트 위치")
            expect(page.locator(".destination-copy strong")).to_have_text("성수 카페거리")
            assert saved(page) == {"lat": 37.5445, "lng": 127.0374}
            page.reload(wait_until="networkidle")
            expect(page.locator(".app-shell")).to_have_attribute("data-test-location", "true")
            assert saved(page)["lat"] == 37.5445
            checks.append(
                "coordinate validation, preset selection and saved test position survive reload"
            )

            page.set_viewport_size({"width": 1280, "height": 720})
            marker = page.locator(".osm-origin.leaflet-marker-draggable")
            page.wait_for_function("""()=>{
                const e=document.querySelector('.osm-origin.leaflet-marker-draggable');
                if(!e)return false;const r=e.getBoundingClientRect();
                const target=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
                return target===e||e.contains(target);
            }""")
            panel = settings(page)
            panel.get_by_role("button", name="지도에서 위치 선택", exact=True).click()
            expect(page.locator(".map-test-toolbar")).to_contain_text("지점을 누르세요")
            old = saved(page)
            canvas = page.locator(".map-leaflet")
            box = canvas.bounding_box()
            canvas.click(position={"x": box["width"] * 0.6, "y": box["height"] * 0.45})
            page.wait_for_function(
                "old => JSON.stringify(JSON.parse(localStorage.getItem('parkiq-test-location')))"
                " !== JSON.stringify(old)",
                arg=old,
            )
            expect(page.locator(".picking-test-location")).to_have_count(0)
            old = saved(page)
            marker = page.locator(".osm-origin.leaflet-marker-draggable")
            marker.scroll_into_view_if_needed()
            box = marker.bounding_box()
            page.mouse.move(box["x"] + 26, box["y"] + 26)
            page.mouse.down()
            page.wait_for_timeout(1200)  # The clock tick must not replace the marker mid-drag.
            page.mouse.move(box["x"] + 90, box["y"] + 50, steps=10)
            page.mouse.up()
            page.wait_for_function(
                "old => JSON.stringify(JSON.parse(localStorage.getItem('parkiq-test-location')))"
                " !== JSON.stringify(old)",
                arg=old,
            )
            checks.append("map picking and marker dragging remain usable across clock updates")

            page.get_by_role("region", name="지도 테스트 위치 조작").get_by_role(
                "button", name="이 위치 주변 찾기", exact=True
            ).click()
            expect(page.locator(".destination-copy strong")).to_have_text("테스트 위치 주변")
            page.set_viewport_size({"width": 390, "height": 844})
            panel = settings(page)
            assert page.evaluate("document.documentElement.scrollWidth<=innerWidth")
            panel.screenshot(path=str(ROOT / "artifacts/test-location-settings.png"))
            close_settings(page)
            checks.append("nearby search updates destination; portrait settings fit the viewport")

            def make_native(debug):
                native = browser.new_page(viewport={"width": 1440, "height": 1080})
                prepare(native)

                def backend(params):
                    response = client.request(
                        params["method"],
                        "/api" + params["path"],
                        content=params.get("body"),
                        headers={"Content-Type": "application/json"} if params.get("body") else {},
                    )
                    if params["path"] == "/recommendations":
                        requests.append(json.loads(params["body"]))
                    return {"status": response.status_code, "body": response.text}

                native.expose_function("mockBackend", backend)
                native.add_init_script(
                    """
                    window.nativeCalls=[];
                    window.ParkIQNative={isDebugBuild(){return DEBUG;},
                      getDefaultBackendUrl(){return 'https://backend.test';},
                      postMessage(raw){
                        const request=JSON.parse(raw);window.nativeCalls.push(request);
                        const reply=data=>window.dispatchEvent(new CustomEvent(
                          'parkiq:native-reply',
                          {detail:{id:request.id,ok:true,data}}));
                        if(request.method==='backend.request')window.mockBackend(request.params).then(reply);
                        else setTimeout(()=>{
                          if(request.method==='vehicle.state')window.dispatchEvent(new CustomEvent(
                            'parkiq:vehicle',{detail:{moving:false,origin:{lat:37.5385,lng:127.0602}}}));
                          reply(null);
                        },0);
                      }};
                """.replace("DEBUG", json.dumps(debug))
                )
                return native

            native = make_native(True)
            native.goto(target, wait_until="networkidle")
            expect(native.locator(".parking-card")).to_have_count(1)
            panel = settings(native)
            panel.get_by_label("위도", exact=True).fill("37.549")
            panel.get_by_label("경도", exact=True).fill("127.055")
            panel.get_by_role("button", name="이 위치 주변 찾기", exact=True).click()
            close_settings(native)
            expect(native.locator(".parking-card")).to_have_count(1)
            native.evaluate(
                "window.dispatchEvent(new CustomEvent('parkiq:vehicle',"
                "{detail:{moving:false,origin:{lat:37.5,lng:127}}}))"
            )
            native.get_by_role("button", name="주차 정보 새로고침", exact=True).click()
            expect(native.locator(".parking-list")).to_have_attribute("aria-busy", "false")
            assert requests[-1]["origin"] == {"lat": 37.549, "lng": 127.055}
            assert requests[-1]["destination"]["lat"] == 37.549
            assert saved(native) == {"lat": 37.549, "lng": 127.055}
            native.locator(".route-start").click()
            expect(native.locator(".toast")).to_contain_text("테스트 위치에서는 실제 차량 안내")
            assert not native.evaluate("window.nativeCalls.some(c=>c.method==='navigation.start')")
            checks.append(
                "native GPS preserves test origin; API uses it; real navigation stays blocked"
            )

            native.get_by_role("button", name="위치 옮기기", exact=True).click()
            native.evaluate(
                "window.dispatchEvent(new CustomEvent('parkiq:vehicle',"
                "{detail:{moving:true,origin:{lat:37.5,lng:127}}}))"
            )
            expect(native.locator(".map-test-toolbar")).to_have_count(0)
            expect(native.locator(".picking-test-location")).to_have_count(0)
            expect(native.get_by_role("button", name="설정", exact=True)).to_be_disabled()
            native.evaluate(
                "window.dispatchEvent(new CustomEvent('parkiq:vehicle',{detail:{moving:false}}))"
            )
            native.get_by_role("button", name="GPS 위치로 복귀", exact=True).click()
            expect(native.locator(".app-shell")).to_have_attribute("data-test-location", "false")
            expect(native.locator(".map-location")).to_contain_text("차량 GPS 위치")
            assert saved(native) is None
            checks.append(
                "driving restrictions cancel picking; explicit GPS restore clears saved override"
            )

            release = make_native(False)
            release.add_init_script(
                "localStorage.setItem('parkiq-test-location',JSON.stringify({lat:37.549,lng:127.055}))"
            )
            release.goto(target, wait_until="networkidle")
            expect(release.locator(".app-shell")).to_have_attribute("data-test-location", "false")
            settings_button = release.get_by_role("button", name="설정", exact=True)
            expect(settings_button).to_be_enabled()
            settings_button.click()
            expect(
                release.get_by_role("region", name="테스트 위치 설정", exact=True)
            ).to_have_count(0)
            assert not errors, errors
            checks.append(
                "release host disables test coordinates and controls; no unhandled JS errors"
            )
            for check in checks:
                print("PASS", check)
            print(f"{len(checks)} test-location groups passed")
            browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    run()
