# -*- coding: utf-8 -*-
"""포트 등록부(port-registry/1, RESEARCH-HUB 17장) — 서버 지킴이(127.0.0.1:17000)가 주인.

  내 포트:   SK_PORT(서버 지킴이가 띄웠을 때) → 명령줄 포트 → GET /api/ports/learning-center(1초) → 기본 18162
  남의 포트: HUB_WEB_<시스템> 환경값(시험 사본) → GET /api/ports(60초 보관, 실패하면 마지막 값) → 기본값
  서버 지킴이가 꺼져 있어도 기본값으로 혼자 돈다. 브라우저 주소는 공개 도메인이라 여기와 무관하다.
  SK_REGISTRY=off 면 등록부를 읽지 않는다(시험 사본).
"""
import json
import os
import threading
import time
import urllib.request

KEEPER = (os.environ.get("SK_URL") or "http://127.0.0.1:17000").rstrip("/")
SELF = "learning-center"
# 이 시스템 안의 이름 → 등록부 이름, 기본 포트(17.1 표와 같아야 한다)
NAMES = {"slc": "learning-center", "admin": "admin", "kanban": "kanban", "aioffice": "ai-office", "aim": "ai-mgmt", "ulogin": "ulogin-web"}
DEFAULTS = {"learning-center": 18162, "admin": 8195, "kanban": 8194, "ai-office": 17777, "ai-mgmt": 17778, "ulogin-web": 8197}
TTL = 60
UA = "StudyCenter/1.0 (+local)"
_lock = threading.Lock()
_cache = {"t": 0.0, "ports": {}, "ok": False, "fail_t": 0.0}


def enabled():
    return (os.environ.get("SK_REGISTRY") or "").lower() not in ("off", "0", "false")


def _get(path, timeout):
    rq = urllib.request.Request(KEEPER + path, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(rq, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8") or "{}")


def _valid(p):
    try:
        p = int(p)
    except (TypeError, ValueError):
        return 0
    return p if 1 <= p <= 65535 else 0


def own_port(argv_port=None):
    """(포트, 출처). 출처는 sk_port·argv·registry·default."""
    p = _valid(os.environ.get("SK_PORT"))
    if p:
        return p, "sk_port"
    p = _valid(argv_port)
    if p:
        return p, "argv"
    if enabled():
        try:
            j = _get("/api/ports/" + SELF, 1.0)
            p = _valid(((j or {}).get("data") or {}).get("port"))
            if j.get("ok") and p:
                return p, "registry"
        except Exception:
            pass
    return DEFAULTS[SELF], "default"


def ports():
    """등록부 전체 {이름: 포트}. 60초 보관, 실패하면 마지막 값(실패 뒤 10초는 다시 묻지 않음)."""
    if not enabled():
        return {}
    now = time.time()
    with _lock:
        if _cache["ok"] and now - _cache["t"] < TTL:
            return dict(_cache["ports"])
        if now - _cache["fail_t"] < 10:
            return dict(_cache["ports"])
    try:
        j = _get("/api/ports", 1.0)
        raw = (((j or {}).get("data") or {}).get("ports") or {}) if j.get("ok") else None
        if raw is None:
            raise ValueError("bad")
        got = {}
        for k, v in raw.items():
            pp = _valid((v or {}).get("port") if isinstance(v, dict) else v)
            if pp:
                got[str(k)] = pp
        with _lock:
            _cache.update(t=now, ports=got, ok=True)
    except Exception:
        with _lock:
            _cache["fail_t"] = now
    with _lock:
        return dict(_cache["ports"])


def port_of(sys_):
    """다른 시스템(이 앱 안 이름: admin·kanban·aioffice·slc·ulogin)의 내부 포트."""
    name = NAMES.get(sys_, sys_)
    return ports().get(name) or DEFAULTS.get(name) or 0


def local_url(sys_):
    p = port_of(sys_)
    return "http://127.0.0.1:%d" % p if p else ""


def status():
    c = ports()
    return {"format": "port-registry/1", "keeper": KEEPER, "enabled": enabled(), "reachable": _cache["ok"] and time.time() - _cache["t"] < TTL,
            "ports": {k: c.get(NAMES[k]) or DEFAULTS[NAMES[k]] for k in NAMES}}


SELF_PORT = {"port": 0, "src": ""}


def fix_loopback(u, sys_):
    """저장해 둔 내부 주소가 이 PC(127.0.0.1·localhost)의 그 시스템 기본 포트면 등록부 포트로 바꿔 준다.
    (포트를 서버 지킴이에서 바꿔도 설정을 다시 넣지 않게. 다른 포트·다른 호스트는 그대로)"""
    import re
    m = re.match(r"^(https?://)(127\.0\.0\.1|localhost|\[::1\]):(\d+)(.*)$", str(u or ""))
    if not m:
        return u
    name = NAMES.get(sys_, sys_)
    if int(m.group(3)) != DEFAULTS.get(name):
        return u
    p = SELF_PORT["port"] if name == SELF and SELF_PORT["port"] else port_of(sys_)
    return "%s%s:%d%s" % (m.group(1), m.group(2), p, m.group(4)) if p else u
