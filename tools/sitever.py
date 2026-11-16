# -*- coding: utf-8 -*-
"""(v152, G18 6장) 지금 운영 중인 화면 버전 — /version.json 과 모든 화면의 RUI.updates({version}) 가 같은 값을 쓴다.

값 = app-html/index.html 의 app.js?v=<값> (bump-assets.py 가 배포 때마다 바꾼다 — 손으로 고치지 않는다). 예: v152.335
index.html 이 바뀌면 다음 요청부터 새 값(파일 시각으로 확인).
"""
import json
import os
import re
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FALLBACK = ""          # serve.py 가 APP_VERSION 을 넣는다(index.html 을 못 읽을 때만)
_c = {"mt": None, "v": ""}
_lk = threading.Lock()


def get():
    p = os.path.join(ROOT, "app-html", "index.html")
    try:
        mt = os.stat(p).st_mtime_ns
    except OSError:
        return FALLBACK
    with _lk:
        if _c["mt"] != mt:
            try:
                with open(p, encoding="utf-8") as fh:
                    t = fh.read()
                # (v177) 빌드 값은 <meta name="app-version"> — 파일 ?v= 는 내용 해시라 빌드가 아니다. 예전 index.html 이면 app.js?v=
                m = re.search(r'<meta name="app-version" content="([A-Za-z0-9._-]+)"', t) or re.search(r'app\.js\?v=([A-Za-z0-9._-]+)', t)
                _c["v"] = m.group(1) if m else FALLBACK
            except OSError:
                _c["v"] = FALLBACK
            _c["mt"] = mt
        return _c["v"] or FALLBACK


def assets():
    """서버가 만드는 화면(통합로그인·계정 연동 페이지)의 공용 테마 연결 — 같은 버전 값으로 캐시를 나눈다."""
    v = get()
    q = ("?v=" + v) if v else ""
    return ('<script src="/ui/rui-theme.js%s"></script><link rel="stylesheet" href="/ui/rui-tokens.css%s"><link rel="stylesheet" href="/ui/rui.css%s">' % (q, q, q))


def script():
    """화면을 처음 그릴 때 한 번 — 공용 새 버전 알림(G18)."""
    return "<script>window.RUI&&RUI.updates&&RUI.updates({version:%s})</script>" % json.dumps(get())
