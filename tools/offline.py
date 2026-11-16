# -*- coding: utf-8 -*-
"""복사본 시험용 외부 호출 차단. STUDY_OFFLINE=1 이면 파이썬에서 나가는 모든 HTTP 호출을 막는다.

복사본은 원본의 토큰과 연결 정보를 그대로 갖고 있어, 그냥 띄우면 실제 서버에 호출을 보낼 수 있다.
AI 작업, 연구행정·업무관리 호출, 계정 연동, 다른 시스템 알림이 모두 urllib 을 지나므로 여기서 한 번에 막는다.
"""
import os
import urllib.error
import urllib.request

BLOCKED = []


def on():
    return os.environ.get("STUDY_OFFLINE") == "1"


def install():
    if not on():
        return False
    real = urllib.request.OpenerDirector.open

    def guard(self, fullurl, data=None, timeout=None):
        url = fullurl if isinstance(fullurl, str) else fullurl.full_url
        BLOCKED.append(url.split("?")[0])
        del BLOCKED[:-200]
        raise urllib.error.URLError("STUDY_OFFLINE: 외부 호출을 막았습니다")
    urllib.request.OpenerDirector.open = guard
    return real is not None
