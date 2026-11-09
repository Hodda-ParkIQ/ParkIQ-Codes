"""Verify internal/backend switching using a static-only UI and the demo API on :8000."""

import json
import os
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import httpx
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
BACKEND = os.getenv("PARKIQ_BACKEND_URL", "http://127.0.0.1:8000")


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def settings(page):
    page.get_by_role("button", name="설정", exact=True).click()
    return page.get_by_role("textbox", name="백엔드 서버 주소", exact=True)


def close_settings(page):
    page.get_by_role("dialog", name="주차 설정").get_by_role(
        "button", name="닫기", exact=True
    ).click()


def run():
    # A static server has no /api routes: internal mode must work without a backend.
    server = ThreadingHTTPServer(
        ("127.0.0.1", 4173), partial(QuietHandler, directory=str(ROOT / "frontend/dist"))
    )
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with httpx.Client(base_url=BACKEND, timeout=10) as client:
            health = client.get("/api/health").json()
            assert health["mode"] == "demo", "Run against a fictional demo backend only."
            places = client.get("/api/places").json()
            recommendation = client.post(
                "/api/recommendations",
                json={
                    "origin": {"lat": 37.5385, "lng": 127.0602},
                    "destination": places["places"][0],
                },
            ).json()
            assert recommendation["candidates"]
        with sync_playwright() as p:
            browser = p.chromium.launch(
                executable_path=os.getenv("CHROME_PATH", "/usr/bin/google-chrome"),
                headless=True,
                args=["--no-sandbox"],
            )
            page = browser.new_page(viewport={"width": 1280, "height": 720})
            errors, requests, checks = [], [], []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("request", lambda req: requests.append(req.url) if "/api/" in req.url else None)
            page.goto("http://127.0.0.1:4173", wait_until="networkidle")
            expect(page.locator(".parking-card")).to_have_count(2)
            expect(page.locator(".data-mode")).to_have_text("내부 시연")
            first = page.locator(".parking-card h3").first.inner_text()
            page.get_by_role("button", name="저렴한순", exact=True).click()
            expect(page.locator(".parking-card h3").first).not_to_have_text(first)
            page.get_by_role("button", name="전기차 충전", exact=True).click()
            expect(page.locator(".list-pagination")).to_contain_text("2")
            page.get_by_role("button", name="음성 검색", exact=True).click()
            page.get_by_role("button", name="덜 걷는 곳으로 찾아줘", exact=True).click()
            expect(page.locator(".voice-status")).to_contain_text("덜 걷는 주차장")
            page.get_by_role("button", name="음성 검색 닫기", exact=True).click()
            assert not requests, requests
            page.screenshot(path=str(ROOT / "artifacts/internal-demo.png"))
            checks.append(
                "static-only UI: internal ranking, filters and voice work with zero API requests"
            )

            field = settings(page)
            field.fill("javascript:alert(1)")
            page.get_by_role("button", name="주소 저장", exact=True).click()
            expect(page.locator(".connection-message")).to_contain_text("HTTP 또는 HTTPS")
            expect(page.locator(".app-shell")).to_have_attribute("data-api-source", "internal")
            checks.append("invalid URL rejected without changing source")

            field.fill(BACKEND + "/api/")
            page.get_by_role("button", name="연결 확인", exact=True).click()
            expect(page.locator(".connection-message")).to_contain_text("연결 확인: 서버 시연")
            expect(page.locator(".app-shell")).to_have_attribute("data-api-source", "internal")
            page.screenshot(path=str(ROOT / "artifacts/connection-settings.png"))
            page.get_by_role("button", name="주소 저장", exact=True).click()
            expect(page.locator(".app-shell")).to_have_attribute("data-api-source", "backend")
            expect(page.locator(".data-mode")).to_have_text("서버 시연")
            close_settings(page)
            expect(page.locator(".parking-card")).to_have_count(2)
            page.reload(wait_until="networkidle")
            expect(page.locator(".data-mode")).to_have_text("서버 시연")
            assert page.evaluate("localStorage.getItem('parkiq-backend-url')") == BACKEND
            assert any(url == BACKEND + "/api/recommendations" for url in requests)
            assert not any("/api/api/" in url for url in requests)
            checks.append("connection test, suffix normalization, CORS and persistence")

            page.route(
                "**/api/recommendations",
                lambda route: route.fulfill(
                    status=503, content_type="application/json", body='{"detail":"서버 점검 중"}'
                ),
            )
            page.get_by_role("button", name="주차 정보 새로고침", exact=True).click()
            expect(page.locator(".empty.error")).to_contain_text("서버 점검 중")
            expect(page.locator(".parking-card")).to_have_count(0)
            expect(page.locator(".app-shell")).to_have_attribute("data-api-source", "backend")
            page.unroute("**/api/recommendations")
            page.route(
                "**/api/recommendations",
                lambda route: route.fulfill(
                    status=200, content_type="text/html", body="<html>not an API</html>"
                ),
            )
            page.get_by_role("button", name="다시 시도", exact=True).click()
            expect(page.locator(".empty.error")).to_contain_text("JSON API 응답")
            page.unroute("**/api/recommendations")
            page.route("**/api/recommendations", lambda route: route.abort("connectionrefused"))
            page.get_by_role("button", name="다시 시도", exact=True).click()
            expect(page.locator(".empty.error")).to_contain_text("서버에 연결할 수 없습니다")
            expect(page.locator(".parking-card")).to_have_count(0)
            page.unroute("**/api/recommendations")
            checks.append(
                "HTTP errors, invalid JSON and offline backend show errors without demo fallback"
            )

            mixed = dict(recommendation, mode="live")
            page.route(
                "**/api/recommendations",
                lambda route: route.fulfill(
                    status=200, content_type="application/json", body=json.dumps(mixed)
                ),
            )
            page.get_by_role("button", name="다시 시도", exact=True).click()
            expect(page.locator(".empty.error")).to_contain_text("응답 형식이 올바르지")
            page.unroute("**/api/recommendations")
            checks.append("server cannot label fictional lots as live data")

            settings(page)
            page.get_by_role("button", name="서버 주소 지우고 내부 시연 사용", exact=True).click()
            close_settings(page)
            expect(page.locator(".data-mode")).to_have_text("내부 시연")
            expect(page.locator(".parking-card")).to_have_count(2)
            assert page.evaluate("localStorage.getItem('parkiq-backend-url')") == ""
            count = len(requests)
            page.reload(wait_until="networkidle")
            expect(page.locator(".parking-card")).to_have_count(2)
            assert len(requests) == count
            checks.append(
                "explicit clear restores internal mode and overrides saved backend on reload"
            )

            native = browser.new_page(viewport={"width": 1280, "height": 720})
            native.on("pageerror", lambda error: errors.append(str(error)))
            fixtures = {"/health": health, "/places": places, "/recommendations": recommendation}
            native.add_init_script(
                """
                const fixtures=FIXTURES;
                window.nativeCalls=[];window.heldReplies=[];window.holdRecommendations=false;
                window.ParkIQNative={getDefaultBackendUrl(){return 'http://native-server.test:8000';},
                  postMessage(raw){
                    const request=JSON.parse(raw);window.nativeCalls.push(request);
                    setTimeout(()=>{
                      if(request.method==='vehicle.state') window.dispatchEvent(new CustomEvent(
                        'parkiq:vehicle',{detail:{moving:false,origin:{lat:37.5385,lng:127.0602}}}));
                      const data=request.method==='backend.request'
                        ? {status:200,body:JSON.stringify(fixtures[request.params.path])}:null;
                      const reply=()=>window.dispatchEvent(new CustomEvent('parkiq:native-reply',
                        {detail:{id:request.id,ok:true,data}}));
                      if(request.method==='backend.request'&&request.params.path==='/recommendations'
                          &&window.holdRecommendations)window.heldReplies.push(reply);
                      else reply();
                    },0);
                  }};
            """.replace("FIXTURES", json.dumps(fixtures))
            )
            network = []
            native.on(
                "request", lambda req: network.append(req.url) if "/api/" in req.url else None
            )
            native.goto("http://127.0.0.1:4173", wait_until="networkidle")
            expect(native.locator(".data-mode")).to_have_text("서버 시연")
            assert not network
            assert native.evaluate(
                "window.nativeCalls.some(c=>c.method==='backend.request'&&c.params.baseUrl==='http://native-server.test:8000'&&c.params.path==='/recommendations'&&c.params.method==='POST'&&JSON.parse(c.params.body).destination)"
            )
            checks.append(
                "native configured URL and payload use host transport without browser fetch"
            )

            native.evaluate("window.holdRecommendations=true")
            native.get_by_role("button", name="주차 정보 새로고침", exact=True).click()
            native.wait_for_function("window.heldReplies.length>0")
            settings(native)
            native.get_by_role("button", name="서버 주소 지우고 내부 시연 사용", exact=True).click()
            close_settings(native)
            expect(native.locator(".data-mode")).to_have_text("내부 시연")
            native.evaluate("window.heldReplies.forEach(reply=>reply());window.heldReplies=[]")
            expect(native.locator(".data-mode")).to_have_text("내부 시연")
            native.reload(wait_until="networkidle")
            expect(native.locator(".data-mode")).to_have_text("내부 시연")
            assert not native.evaluate("window.nativeCalls.some(c=>c.method==='backend.request')")
            assert not errors, errors
            checks.append(
                "late reply ignored after source change; empty choice overrides native default"
            )
            for item in checks:
                print("PASS", item)
            print(f"{len(checks)} connection-mode groups passed; no unhandled browser errors")
            browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    run()
