"""ParkIQ acceptance checks against an already running demo server."""

import os
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


def assert_uncovered(page, selector):
    assert page.locator(selector).evaluate("""element => {
        const r=element.getBoundingClientRect();
        const target=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
        return target===element || element.contains(target);
    }"""), f"{selector} is covered"


def run():
    target = os.getenv("PARKIQ_URL", "http://127.0.0.1:8000")
    output = Path("artifacts")
    output.mkdir(exist_ok=True)
    checks = []
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=os.getenv("CHROME_PATH", "/usr/bin/google-chrome"),
            headless=True,
            args=["--no-sandbox"],
        )
        page = browser.new_page(viewport={"width": 1440, "height": 1080})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.add_init_script("""
            localStorage.setItem('parkiq-backend-url', location.origin);
            class TestRecognition {
                start(){queueMicrotask(()=>this.onend?.());}
                abort(){this.onend?.();}
            }
            window.SpeechRecognition=TestRecognition;
        """)
        page.goto(target, wait_until="networkidle")
        expect(page.locator(".parking-card")).to_have_count(3)
        expect(page.locator(".osm-pin")).to_have_count(3)
        first_page = page.locator(".parking-card h3").all_inner_texts()
        page.get_by_role("button", name="다음 주차장", exact=True).click()
        expect(page.locator(".list-pagination")).to_contain_text("2 / 2")
        assert not set(first_page).intersection(page.locator(".parking-card h3").all_inner_texts())
        expect(page.locator(".route-summary h2")).to_have_text(
            page.locator(".parking-card h3").first.inner_text()
        )
        page.get_by_role("button", name="이전 주차장", exact=True).click()
        first = page.locator(".parking-card h3").first.inner_text()
        page.get_by_role("button", name="저렴한순", exact=True).click()
        expect(page.locator(".parking-card h3").first).not_to_have_text(first)
        expect(page.locator(".parking-card.active h3")).to_have_text(
            page.locator(".parking-card h3").first.inner_text()
        )
        checks.append("paged results and ranking update map, selection and route preview")

        page.locator(".parking-card .favorite").first.click()
        page.get_by_role("button", name="즐겨찾기", exact=True).click()
        expect(page.locator(".parking-card")).to_have_count(1)
        page.reload(wait_until="networkidle")
        page.get_by_role("button", name="즐겨찾기", exact=True).click()
        expect(page.locator(".parking-card")).to_have_count(1)
        page.get_by_role("button", name="주변 주차장", exact=True).click()
        checks.append("favorites persist across reload and tabs preserve valid selection")

        page.get_by_role("button", name="전기차 충전", exact=True).click()
        expect(page.locator(".list-pagination")).to_contain_text("1 / 1")
        expect(page.get_by_role("button", name="다음 주차장", exact=True)).to_be_disabled()
        expect(page.locator(".parking-card")).to_have_count(3)
        page.get_by_role("button", name="전기차 충전", exact=True).click()
        expect(page.get_by_role("button", name="다음 주차장", exact=True)).to_be_enabled()
        page.get_by_role("button", name="목적지 검색", exact=True).click()
        page.get_by_role("textbox", name="목적지 이름").fill("서울숲")
        page.get_by_role("button", name="서울숲 서울 성동구 뚝섬로 273", exact=True).click()
        expect(page.locator(".destination-copy strong")).to_have_text("서울숲")
        expect(page.locator(".parking-list")).to_have_attribute("aria-busy", "false")
        page.get_by_role("combobox", name="예상 주차 시간").select_option("120")
        expect(page.locator(".fee-metric")).to_contain_text("2시간 요금")
        checks.append("EV filter, destination search and parking duration use API results")

        page.get_by_role("button", name="야간 화면", exact=True).click()
        expect(page.locator(".app-shell")).to_have_attribute("data-theme", "dark")
        page.reload(wait_until="networkidle")
        expect(page.locator(".app-shell")).to_have_attribute("data-theme", "dark")
        page.get_by_role("button", name="주간 화면", exact=True).click()
        page.get_by_role("button", name="정차 중", exact=True).click()
        for name in ["목적지 검색", "설정", "최근 안내", "지도 확대"]:
            expect(page.get_by_role("button", name=name, exact=True)).to_be_disabled()
        assert page.locator(".parking-list").evaluate("e=>e.scrollHeight<=e.clientHeight+1")
        page.get_by_role("button", name="음성 검색", exact=True).click()
        expect(page.get_by_role("region", name="음성 검색", exact=True)).to_be_visible()
        expect(page.get_by_role("dialog")).to_have_count(0)
        expect(page.locator(".voice-examples")).to_have_count(0)
        assert_uncovered(page, ".route-start")
        page.get_by_role("button", name="음성 검색 닫기", exact=True).click()
        page.get_by_role("button", name="주행 중 · 간편 모드", exact=True).click()
        checks.append("day/night persistence and driving restrictions with modeless voice panel")

        page.get_by_role("button", name="음성 검색", exact=True).click()
        page.get_by_role("button", name="덜 걷는 곳으로 찾아줘", exact=True).click()
        expect(page.locator(".voice-status")).to_contain_text("덜 걷는 주차장")
        expect(page.get_by_role("button", name="도보 짧은순", exact=True)).to_have_attribute(
            "aria-pressed", "true"
        )
        page.get_by_role("button", name="2번 주차장 선택", exact=True).click()
        expect(page.locator(".voice-status")).to_contain_text("주차장을 선택했어요")
        page.get_by_role("button", name="안내 시작", exact=True).last.click()
        expect(page.locator(".route-start")).to_have_text("안내 종료", timeout=15000)
        page.get_by_role("button", name="음성 검색 닫기", exact=True).click()
        page.locator(".route-start").click()
        expect(page.locator(".route-start")).to_have_text("안내 시작")
        page.get_by_role("button", name="최근 안내", exact=True).click()
        expect(page.locator(".history-item")).to_have_count(1)
        page.get_by_role("button", name="주변 주차장", exact=True).click()
        checks.append("voice examples select, navigate, cancel and record history")

        page.route(
            "**/api/recommendations",
            lambda route: route.fulfill(
                status=503, content_type="application/json", body='{"detail":"테스트 연결 오류"}'
            ),
        )
        page.get_by_role("button", name="주차 정보 새로고침", exact=True).click()
        expect(page.locator(".empty.error")).to_contain_text("테스트 연결 오류")
        page.unroute("**/api/recommendations")
        page.get_by_role("button", name="다시 시도", exact=True).click()
        expect(page.locator(".parking-card")).to_have_count(3)
        checks.append("network error and retry recovery")

        page.evaluate("localStorage.clear()")
        page.reload(wait_until="networkidle")
        page.evaluate("document.fonts.ready")
        page.screenshot(path=str(output / "desktop.png"), full_page=True)
        page.set_viewport_size({"width": 1280, "height": 720})
        expect(page.locator(".parking-card")).to_have_count(2)
        assert page.evaluate("document.documentElement.scrollHeight<=innerHeight")
        expect(page.locator(".bottom-bar")).to_be_in_viewport()
        assert page.locator(".parking-list").evaluate("e=>e.scrollHeight<=e.clientHeight+1")
        assert_uncovered(page, ".route-start")
        assert page.locator(
            ".route-start,.voice-button,.list-tabs button,.parking-select,.map-control,.favorite"
        ).evaluate_all(
            "els=>els.every(e=>{const r=e.getBoundingClientRect();"
            "return r.width>=48&&r.height>=48;})"
        )
        page.screenshot(path=str(output / "vehicle.png"), full_page=True)
        page.get_by_role("button", name="야간 화면", exact=True).click()
        page.screenshot(path=str(output / "night.png"), full_page=True)
        page.get_by_role("button", name="주간 화면", exact=True).click()
        page.get_by_role("button", name="정차 중", exact=True).click()
        page.screenshot(path=str(output / "driving.png"), full_page=True)
        page.get_by_role("button", name="주행 중 · 간편 모드", exact=True).click()
        page.set_viewport_size({"width": 390, "height": 844})
        expect(page.locator(".parking-card")).to_have_count(3)
        assert page.evaluate("document.documentElement.scrollWidth<=innerWidth")
        page.screenshot(path=str(output / "mobile.png"), full_page=True)
        page.get_by_role("button", name="정차 중", exact=True).click()
        expect(page.locator(".parking-card")).to_have_count(2)
        assert page.evaluate("document.documentElement.scrollHeight<=innerHeight")
        page.get_by_role("button", name="음성 검색", exact=True).click()
        assert_uncovered(page, ".route-start")
        page.get_by_role("button", name="음성 검색 닫기", exact=True).click()
        page.screenshot(path=str(output / "portrait-driving.png"), full_page=True)
        checks.append(
            "vehicle and portrait layouts keep primary controls visible, touch targets >=48px"
        )

        native = browser.new_page(viewport={"width": 1440, "height": 900})
        native.add_init_script("""
            window.nativeCalls=[];
            window.ParkIQNative={isTestBuild(){return true;},postMessage(raw){
                const request=JSON.parse(raw);window.nativeCalls.push(request);
                setTimeout(()=>{
                    if(request.method==='vehicle.state')window.dispatchEvent(new CustomEvent(
                        'parkiq:vehicle',{detail:{moving:false,origin:{lat:37.5385,lng:127.0602}}}));
                    window.dispatchEvent(new CustomEvent('parkiq:native-reply',
                        {detail:{id:request.id,ok:true,data:null}}));
                },0);
            }};
        """)
        native.goto(target, wait_until="networkidle")
        expect(native.locator(".parking-card")).to_have_count(3)
        native.locator(".route-start").click()
        expect(native.locator(".toast")).to_contain_text(
            "시연 주차장을 실제 차량으로 안내할 수 없습니다"
        )
        assert not native.evaluate("window.nativeCalls.some(c=>c.method==='navigation.start')")
        native.evaluate("""window.dispatchEvent(new CustomEvent('parkiq:gleo',{detail:{
            id:'gleo-test',action:'SEARCH_PARKING',parameters:{query:'서울숲',preference:'less_walking'}
        }}));""")
        expect(native.locator(".destination-copy strong")).to_have_text("서울숲")
        native.wait_for_function(
            "window.nativeCalls.some(c=>c.method==='gleo.respond'&&c.params.id==='gleo-test'&&c.params.status==='success')"
        )
        native.get_by_role("button", name="음성 검색", exact=True).click()
        native.get_by_role("button", name="음성 검색 닫기", exact=True).click()
        native.wait_for_function("window.nativeCalls.some(c=>c.method==='voice.cancel')")
        checks.append("native contract blocks demo routes and returns Gleo search callback")
        assert errors == [], errors
        checks.append("no uncaught browser errors")
        browser.close()
    print("\n".join(f"PASS {check}" for check in checks))


if __name__ == "__main__":
    run()
