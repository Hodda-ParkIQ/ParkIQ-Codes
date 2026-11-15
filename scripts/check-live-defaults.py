"""Verify the default live build and upgrades using responses from the configured API."""

import json
import os
import threading
from datetime import UTC, datetime
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import httpx
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
BACKEND = "https://testhyundai.devmultid.org"
ORIGIN = {"lat": 37.5446, "lng": 127.0542}


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def run():
    with httpx.Client(base_url=BACKEND, timeout=30) as client:
        health = client.get("/api/health")
        health.raise_for_status()
        assert health.json()["mode"] == "live"
        places = client.get("/api/places")
        places.raise_for_status()
        destination = places.json()["places"][0]
        recommendation = client.post(
            "/api/recommendations", json={"origin": ORIGIN, "destination": destination}
        )
        recommendation.raise_for_status()
        result = recommendation.json()
        assert result["mode"] == "live" and result["candidates"]
        assert all(c["lot"]["demo"] is False for c in result["candidates"])
        fixtures = {
            "/health": health.json(),
            "/places": places.json(),
            "/recommendations": result,
        }
    print(f"PASS live HTTPS API: {len(result['candidates'])} actual parking facilities")

    server = ThreadingHTTPServer(
        ("127.0.0.1", 0), partial(QuietHandler, directory=str(ROOT / "frontend/dist"))
    )
    threading.Thread(target=server.serve_forever, daemon=True).start()
    target = f"http://127.0.0.1:{server.server_port}"
    errors = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                executable_path=os.getenv("CHROME_PATH", "/usr/bin/google-chrome"),
                headless=True,
                args=["--no-sandbox"],
            )
            native = browser.new_page(viewport={"width": 1280, "height": 720})
            native.clock.install(time=datetime(2026, 11, 15, 12, 0, 15, tzinfo=UTC))
            native.on("pageerror", lambda error: errors.append(str(error)))
            native.route("https://tile.openstreetmap.org/**", lambda route: route.abort())
            native.add_init_script(
                """
                const fixtures=FIXTURES, origin=ORIGIN;
                localStorage.setItem('parkiq-backend-url','');
                localStorage.setItem('parkiq-test-location',JSON.stringify({lat:35.1,lng:129.1}));
                window.nativeCalls=[];window.responseMode='live';window.serverStatus=200;
                window.omitParking=false;
                window.ParkIQNative={isDebugBuild(){return true;},
                  getDefaultBackendUrl(){return BACKEND;},
                  postMessage(raw){
                    const req=JSON.parse(raw);window.nativeCalls.push(req);
                    setTimeout(()=>{
                      let data=null;
                      if(req.method==='backend.request'){
                        const path=req.params.path.split('?')[0];
                        const body=path==='/recommendations'
                          ? {...fixtures[path],mode:window.responseMode,
                            candidates:window.omitParking?[]:fixtures[path].candidates}
                          :fixtures[path];
                        data={status:window.serverStatus,body:JSON.stringify(body)};
                      }
                      if(req.method==='vehicle.state')window.dispatchEvent(new CustomEvent(
                        'parkiq:vehicle',{detail:{moving:false}}));
                      window.dispatchEvent(new CustomEvent('parkiq:native-reply',
                        {detail:{id:req.id,ok:true,data}}));
                    },0);
                  }};
                """.replace("FIXTURES", json.dumps(fixtures))
                .replace("ORIGIN", json.dumps(ORIGIN))
                .replace("BACKEND", json.dumps(BACKEND))
            )
            native.goto(target, wait_until="networkidle")
            expect(native.get_by_text("현재 위치를 확인하고 있습니다", exact=True)).to_be_visible()
            expect(native.locator(".osm-origin")).to_have_count(0)
            assert not native.evaluate(
                "window.nativeCalls.some(c=>c.params?.path==='/recommendations')"
            )
            print("PASS saved test position/blank server ignored; no fabricated GPS request")

            native.evaluate(
                "origin=>window.dispatchEvent(new CustomEvent('parkiq:vehicle',"
                "{detail:{moving:false,origin}}))",
                ORIGIN,
            )
            expect(native.locator(".parking-card").first).to_be_visible()
            expect(native.locator(".data-mode")).to_have_text("실시간 주차 정보")
            expect(native.locator(".map-location")).to_contain_text("차량 GPS 위치")
            before = native.evaluate(
                "window.nativeCalls.filter(c=>c.params?.path==='/recommendations').length"
            )
            native.evaluate(
                "origin=>{for(let i=0;i<10;i++)window.dispatchEvent(new CustomEvent("
                "'parkiq:vehicle',{detail:{moving:false,origin}}));}",
                ORIGIN,
            )
            native.wait_for_timeout(200)
            assert before == native.evaluate(
                "window.nativeCalls.filter(c=>c.params?.path==='/recommendations').length"
            )
            assert native.evaluate(
                "url=>window.nativeCalls.filter(c=>c.method==='backend.request')"
                ".every(c=>c.params.baseUrl===url)",
                BACKEND,
            )
            native.get_by_role("button", name="설정", exact=True).click()
            expect(native.get_by_role("textbox", name="백엔드 서버 주소")).to_have_value(BACKEND)
            expect(native.get_by_role("textbox", name="백엔드 서버 주소")).to_have_attribute(
                "readonly", ""
            )
            expect(native.get_by_role("region", name="테스트 위치 설정")).to_have_count(0)
            expect(native.get_by_role("button", name="주소 저장", exact=True)).to_have_count(0)
            expect(native.locator(".connection-local")).to_have_count(0)
            native.get_by_role("dialog").get_by_role("button", name="닫기", exact=True).click()
            native.get_by_role("button", name="목적지 검색", exact=True).click()
            expect(native.get_by_text("성수 다이닝", exact=True)).to_have_count(0)
            native.get_by_role("textbox", name="목적지 이름").fill("성수")
            native.wait_for_function(
                "window.nativeCalls.some(c=>c.params?.path?.startsWith('/places?q='))"
            )
            native.get_by_role("dialog").get_by_role("button", name="닫기", exact=True).click()
            (ROOT / "artifacts").mkdir(exist_ok=True)
            native.screenshot(path=str(ROOT / "artifacts/vehicle-live.png"))
            print("PASS live Debug: fixed API, stable GPS, search and no test menus")
            assert not native.evaluate(
                "performance.getEntriesByType('resource').some(r=>r.name.includes('/local-api-'))"
            )
            before = native.locator("time").get_attribute("datetime")
            native.clock.run_for(2000)
            expect(native.locator("time")).to_have_attribute("datetime", before)
            native.clock.fast_forward(60000)
            expect(native.locator("time")).not_to_have_attribute("datetime", before)
            print("PASS live startup does not load demo module; clock updates at minute boundaries")

            before = native.evaluate("window.nativeCalls.length")
            native.locator(".route-start").click()
            expect(native.locator(".route-start")).to_contain_text("안내 종료")
            methods = native.evaluate(
                "start=>window.nativeCalls.slice(start).map(c=>c.params?.path||c.method)", before
            )
            assert methods.index("/recommendations") < methods.index("navigation.start")
            native.locator(".route-start").click()
            expect(native.locator(".route-start")).to_contain_text("안내 시작")
            native.evaluate(
                "window.dispatchEvent(new CustomEvent('parkiq:gleo',{detail:{"
                "id:'route-shared',action:'START_PARKING_ROUTE',parameters:{rank:1}}}))"
            )
            native.wait_for_function(
                "window.nativeCalls.some(c=>c.method==='gleo.respond'&&"
                "c.params.id==='route-shared'&&c.params.status==='success')"
            )
            expect(native.locator(".route-start")).to_contain_text("안내 종료")
            native.locator(".route-start").click()
            expect(native.locator(".route-start")).to_contain_text("안내 시작")
            print("PASS button and Gleo routing both recheck parking and update navigation state")

            before = native.evaluate(
                "window.nativeCalls.filter(c=>c.method==='navigation.start').length"
            )
            native.evaluate("window.omitParking=true")
            native.locator(".route-start").click()
            expect(native.locator(".toast")).to_contain_text("주차장 상태가 변경")
            assert before == native.evaluate(
                "window.nativeCalls.filter(c=>c.method==='navigation.start').length"
            )
            native.evaluate("window.omitParking=false")
            native.get_by_role("button", name="주차 정보 새로고침", exact=True).click()
            expect(native.locator(".parking-card").first).to_be_visible()
            print("PASS parking removed during confirmation never reaches vehicle navigation")

            native.evaluate("window.responseMode='demo'")
            native.get_by_role("button", name="주차 정보 새로고침", exact=True).click()
            expect(native.locator(".empty.error")).to_contain_text("실데이터 모드")
            expect(native.locator(".parking-card")).to_have_count(0)
            native.evaluate("window.responseMode='live';window.serverStatus=503")
            native.get_by_role("button", name="다시 시도", exact=True).click()
            expect(native.locator(".empty.error")).to_contain_text("503")
            expect(native.locator(".parking-card")).to_have_count(0)
            native.evaluate("window.serverStatus=200")
            native.get_by_role("button", name="다시 시도", exact=True).click()
            expect(native.locator(".parking-card").first).to_be_visible()
            print("PASS demo server rejected; HTTP error has no fictional fallback; retry recovers")

            web = browser.new_page(viewport={"width": 1280, "height": 720})
            web.on("pageerror", lambda error: errors.append(str(error)))
            web.context.grant_permissions(["geolocation"])
            web.context.set_geolocation({"latitude": ORIGIN["lat"], "longitude": ORIGIN["lng"]})
            web.add_init_script("localStorage.setItem('parkiq-backend-url','http://old-server.test')")
            web.route("https://tile.openstreetmap.org/**", lambda route: route.abort())
            requests = []

            def remote(route):
                requests.append(route.request.url)
                path = route.request.url.split("/api", 1)[1].split("?", 1)[0]
                route.fulfill(status=200, json=fixtures[path])

            web.route(BACKEND + "/api/**", remote)
            web.goto(target, wait_until="networkidle")
            expect(web.locator(".parking-card").first).to_be_visible()
            expect(web.locator(".data-mode")).to_have_text("실시간 주차 정보")
            assert any(url.endswith("/recommendations") for url in requests)
            print("PASS web uses live API and geolocation; old custom server ignored")
            assert not errors, errors
            browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    run()
