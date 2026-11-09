import re

from .models import VoiceIntent


def parse_voice(text: str) -> VoiceIntent:
    text = text.strip()
    compact = re.sub(r"\s+", "", text)
    if any(word in compact for word in ["취소", "그만", "중지"]):
        return VoiceIntent(action="cancel", reply="경로 안내를 취소할게요.")
    if any(word in compact for word in ["안내시작", "경로안내", "여기로", "출발", "안내해"]):
        return VoiceIntent(action="navigate", reply="선택한 주차장으로 안내를 요청할게요.")
    rank = re.search(r"([1-6])(?:번|번째)", compact)
    word_rank = next(
        (i for i, word in enumerate(["첫번째", "두번째", "세번째"], 1) if word in compact), None
    )
    if rank or word_rank:
        return VoiceIntent(
            action="select",
            rank=int(rank[1]) if rank else word_rank,
            reply="주차장을 선택했어요. 안내 시작이라고 말해 주세요.",
        )
    for words, preference, reply in [
        (
            ["덜걷", "적게걷", "걷기싫", "도보최소", "가까운"],
            "less_walking",
            "목적지까지 덜 걷는 주차장을 찾아볼게요.",
        ),
        (["저렴", "싼", "요금우선", "무료"], "cheapest", "예상 요금이 낮은 주차장을 우선할게요."),
        (["빠른", "빨리", "최단시간"], "fastest", "전체 이동 시간이 짧은 주차장을 찾아볼게요."),
        (["균형", "추천순", "스마트추천"], "balanced", "이동 시간과 도보 거리를 함께 고려할게요."),
    ]:
        if any(word in compact for word in words):
            return VoiceIntent(action="preference", preference=preference, reply=reply)
    for name in ["서울숲", "성수역", "카페거리", "다이닝"]:
        if name in compact:
            return VoiceIntent(
                action="search", query=name, reply=f"{name} 주변 주차장을 찾아볼게요."
            )
    return VoiceIntent(
        action="unknown", reply="덜 걷는 곳, 저렴한 곳, 2번 선택, 안내 시작이라고 말해 보세요."
    )
