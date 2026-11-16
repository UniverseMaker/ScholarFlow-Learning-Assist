# -*- coding: utf-8 -*-
"""통합로그인 연동 (ulogin-link/1, RESEARCH-HUB.md 16장).

  GET  /sso/start[?link=1]            state·PKCE 를 서버에 두고 ulogin 로그인 화면(늘 공개 도메인)으로 보낸다
  GET  /sso/callback?code&state        state 대조 → 서버끼리 code 교환 → 연결된 계정으로 세션
  POST /sso/pick                       연결이 없을 때: 기존 로컬 계정에 연결 또는 새 계정
  GET  api.php?r=sso&op=status         로그인 화면용(모드만)
  GET  api.php?r=sso&op=conf           관리자: 모드·주소·연결 목록·ulogin 상태
  POST api.php?r=sso&op=mode           관리자: off|choice|only (잠김 방지 조건)
  POST api.php?r=sso&op=to_local       본인: 통합로그인 → 로컬(새 비밀번호)
  POST api.php?r=sso&op=unlink         관리자: 다른 사용자의 연결 풀기
  POST api.php?r=sso&op=handoff        관리자: ulogin 이 둔 비밀값 파일을 읽어 넣고 지운다

원칙
· service_secret 과 ulogin 토큰은 서버에만 둔다(SecretBox 로 암호화). 브라우저 응답·로그에 넣지 않는다.
· 모드가 off 가 아니면 관리자 권한은 ulogin role_rank 20(admin) 이상에게만 준다. 저장된 로컬 역할은 지우지 않는다.
· 모드 되돌리기 비상 명령은 서버 PC 에서만: python tools/sso_off.py
"""
import safeio   # (v140) 정전 대비 쓰기(임시 파일 → fsync → 바꾸기)
import sitever  # (v152, G18) 공용 새 버전 알림
import vfs      # noqa: E402  (v151) SQLite 엔진이면 데이터 폴더의 .json·.jsonl 은 DB — 아래 open·exists 등은 vfs 판
open = vfs.open  # noqa: A001
import base64
import hashlib
import html
import json
import os
import re
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

import auth_api
import portreg
import logkit

SERVICE_ID = "alc"
MODES = ("off", "choice", "only")
ADMIN_RANK = 20                 # ulogin role_rank: user 0, manager 10, admin 20, superadmin 30
TTL = 600                       # state·고르기 대기 10분
TIMEOUT = 3
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 slc-sso"
COOKIE = "slc_sso"              # 로그인 도중 이 브라우저를 묶는 값. 다른 사이트에서 돌아올 때도 오도록 Lax
def _handoff_dir():
    """통합로그인 서비스가 연결 정보(handoff)를 두는 폴더 — 기본 ~/.research-hub/handoff (STUDY_SSO_HANDOFF 로 파일 직접 지정 가능)."""
    return os.path.join(os.path.expanduser("~"), ".research-hub", "handoff")


HANDOFF = os.environ.get("STUDY_SSO_HANDOFF") or os.path.join(_handoff_dir(), SERVICE_ID + ".json")
# (v150) 서비스 id 전환(ulogin v1.8.6, alc→learning). ulogin 이 handoff 폴더에 <새 id>.json(format "ulogin-link/1 rename", service_secret 없음)을 둔다.
#   관리자가 확인한 뒤 버튼으로만 반영한다(자동 반영 없음). 비밀값은 그대로 — 봉인 묶음 값은 늘 상수 SERVICE_ID("sso|alc")라 id 를 바꿔도 풀린다.
#   다른 서비스의 handoff 파일(비밀값이 들어 있다)은 열지 않도록, 읽는 이름은 RENAME_IDS 에 적힌 것만.
RENAME_IDS = ("learning",)
RENAME_FORMAT = "ulogin-link/1 rename"


def handoff_file(cur):
    """지금 쓰는 서비스 id 의 비밀값 파일. 시험은 STUDY_SSO_HANDOFF 하나."""
    if os.environ.get("STUDY_SSO_HANDOFF") or cur == SERVICE_ID:
        return HANDOFF
    return os.path.join(os.path.dirname(HANDOFF), cur + ".json")


def rename_offer(cur):
    """받을 수 있는 서비스 id 전환 파일 → (경로, 내용) 또는 (None, None). format 이 rename 이고 former_service_id 가 지금 id 일 때만."""
    for n in RENAME_IDS:
        if n == cur:
            continue
        p = os.path.join(os.path.dirname(HANDOFF), n + ".json")
        h = _read(p)
        if isinstance(h, dict) and h.get("format") == RENAME_FORMAT and str(h.get("service_id") or "") == n and str(h.get("former_service_id") or "") == cur:
            return p, h
    return None, None
# (v141) 16.9.1 계정별 접근 시스템 — 로그인 뒤 세션 확인 간격(5분을 넘기지 않게)·ulogin 이 응답하지 않을 때 다시 부르지 않는 시간
CHECK_SEC = int(os.environ.get("STUDY_SSO_CHECK_SEC") or 240)
BACKOFF_SEC = int(os.environ.get("STUDY_SSO_BACKOFF_SEC") or 60)
DENY = {"SERVICE_ACCESS_DENIED": "이 시스템을 쓸 권한이 없습니다. 통합로그인 관리자에게 권한을 요청하세요.",
        "FORBIDDEN": "이 시스템에서 사용이 차단된 통합로그인 계정입니다."}
LOOP = re.compile(r"^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$")
_lock = threading.RLock()


def _read(p, d=None):
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return d


def _write(p, obj):
    safeio.atomic_json(p, obj, indent=2)


def _b64url(b):
    return base64.urlsafe_b64encode(b).decode("ascii").rstrip("=")


def conf_path(data_dir):
    return os.path.join(data_dir, "system", "sso.json")


def set_mode_file(data_dir, mode, by):
    """비상 복구 명령과 화면이 같이 쓴다."""
    vfs.ensure(data_dir)        # (v151) 비상 복구(sso_off.py)도 DB 의 설정을 바꾼다
    with _lock:
        c = _read(conf_path(data_dir), {}) or {}
        c.update(mode=mode, updated=int(time.time()), by=by)
        _write(conf_path(data_dir), c)
    return c


class Sso:
    def __init__(self, data_dir, auth, box, link):
        vfs.ensure(data_dir)        # (v151)
        self.dir, self.auth, self.box, self.link = data_dir, auth, box, link
        self.f = conf_path(data_dir)
        self.pend, self.picks = {}, {}
        self.platlog = None        # (v157) platlog.Platlog — 로그·감사 이원화
        self.emg = None            # (v169) emergency_api.Emergency — 비상복구모드
        self.ulink = None          # (v145) ulink_api.ULink — 통합로그인 중앙 계정 연결(account_link·계정 목록)
        self.svc = {}              # (v178) uuid → (시각, services) — 「다른 시스템」 목록용 2분 보관
        self.watch = {}            # (v141) 세션 해시 → {next, stop, busy} — 통합로그인 세션 확인 상태(메모리)

    # ---- 설정 ----
    def conf(self):
        c = _read(self.f, {}) or {}
        return {"mode": c.get("mode") if c.get("mode") in MODES else "off",
                "internal": (os.environ.get("STUDY_ULOGIN_INTERNAL") or portreg.fix_loopback(c.get("internal") or "http://127.0.0.1:8197", "ulogin")).rstrip("/"),
                "public": (os.environ.get("STUDY_ULOGIN_PUBLIC") or c.get("public") or "https://login.example.com").rstrip("/"),
                "service_id": c.get("service_id") or SERVICE_ID, "secret": c.get("secret"), "updated": c.get("updated"), "by": c.get("by")}

    def mode(self):
        return self.conf()["mode"]

    def _save(self, patch):
        with _lock:
            c = _read(self.f, {}) or {}
            c.update(patch)
            _write(self.f, c)

    def secret(self):
        s = self.conf()["secret"]
        try:
            return self.box.open(s, "sso|" + SERVICE_ID) if s else ""
        except Exception:
            return ""

    # ---- ulogin 호출(서버끼리, 3초) ----
    def call(self, method, path, body=None, token=None):
        h = {"Accept": "application/json", "User-Agent": UA}
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            h["Content-Type"] = "application/json"
        if token:
            h["Authorization"] = "Bearer " + token
        req = urllib.request.Request(self.conf()["internal"] + path, data=data, headers=h, method=method)
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return r.status, json.loads(r.read().decode("utf-8", "replace") or "{}")
        except urllib.error.HTTPError as e:
            try:
                return e.code, json.loads(e.read().decode("utf-8", "replace") or "{}")
            except ValueError:
                return e.code, {}
        except Exception:
            return 0, None

    def userinfo(self, uuid):
        """(v176) 11.10 자동 연동 확정 전 확인 — 계정 상태·서비스별 접근 맵. 서비스 비밀값으로(서버끼리). 실패면 None."""
        sec = self.secret()
        if not sec:
            return None
        st, j = self.call("POST", "/server/api/sso/userinfo.php", {"uuid": uuid, "service_id": self.conf()["service_id"], "service_secret": sec})
        d = j.get("data") if isinstance(j, dict) and j.get("ok") else None
        return d if st == 200 and isinstance(d, dict) else None

    def services_of(self, u):
        """(v178) 통합로그인 계정이면 {서비스 id: bool}(2분 보관), 아니면 None(그 계정 기준 제한 없음 — 화면은 지금처럼)."""
        uuid = str(((u or {}).get("sso") or {}).get("uuid") or "")
        if not uuid:
            return None
        c = self.svc.get(uuid)
        if c and time.time() - c[0] < 120:
            return c[1]
        d = self.userinfo(uuid)
        sv = d.get("services") if isinstance(d, dict) and isinstance(d.get("services"), dict) else None
        if sv is not None:
            sv = {str(k): bool(v) for k, v in sv.items()} if d.get("status") == "active" else {str(k): False for k in sv}
            self.svc[uuid] = (time.time(), sv)
        elif c:
            return c[1]          # 통합로그인이 응답하지 않으면 마지막 값
        return sv

    def health(self):
        st, j = self.call("GET", "/server/api/health.php")
        return st == 200 and isinstance(j, dict) and j.get("ok") is True

    # ---- 계정 ----
    def find_uuid(self, uuid):
        for u in self.auth._users()["users"]:
            if (u.get("sso") or {}).get("uuid") == uuid:
                return u
        return None

    def bridge(self):
        """(v144) choice 모드인데 통합로그인 관리자 계정에 연결된 관리자가 아직 없다 → 로컬 관리자를 그대로 둔다(잠김 방지).
        연결된 통합로그인 관리자(ulogin admin 이상)가 하나라도 생기면 False — 그때부터 관리자는 통합로그인으로만."""
        if self.mode() != "choice":
            return False
        for x in self.auth._users()["users"]:
            s = x.get("sso") or {}
            if x.get("role") == "admin" and s.get("uuid") and int(s.get("rank") or 0) >= ADMIN_RANK and x.get("status") != "locked":
                return False
        return True

    def effective(self, u):
        """세션의 사용자 → 이번 요청에서 쓸 역할. off 가 아니면 관리자는 ulogin 관리자만(잠김 방지 다리 기간은 제외)."""
        if not u or self.mode() == "off" or self.bridge() or auth_api.is_breakglass(u):   # (v179) 비상용 관리자는 관리자 그대로
            return u
        s = u.get("sso") or {}
        role = "admin" if s.get("uuid") and int(s.get("rank") or 0) >= ADMIN_RANK else ("user" if u.get("role") == "admin" else u.get("role", "user"))
        return u if role == u.get("role") else dict(u, role=role, role_local=u.get("role"))

    def login_guard(self, u):
        """로컬 아이디·비밀번호 로그인 허용 여부. None 이면 허용."""
        m = self.mode()
        if m == "off":
            return None
        if m == "only":
            return ("sso_only", "통합로그인으로만 로그인할 수 있습니다.")
        if u.get("role") == "admin" and self.bridge():
            return None                 # (v144) 아직 통합로그인 관리자로 전환한 관리자가 없다 — 잠기지 않게 로컬 관리자 허용
        if u.get("role") == "admin":
            return ("sso_admin", "관리자는 통합로그인으로 로그인합니다.")
        if u.get("local_login") is False:
            return ("sso_user", "통합로그인 계정으로 바꾼 계정입니다. 통합로그인으로 로그인하세요.")
        return None

    def sweep_migrate(self):
        """(v156) 이미 묶인 계정 정리 — 통합로그인 uuid 가 있는데 아직 로컬 비밀번호가 남은 계정을 이관한다. 서버 시작·주기마다."""
        n = 0
        for x in self.auth._users()["users"]:
            if (x.get("sso") or {}).get("uuid") and not auth_api.is_migrated(x):
                self._set(x["id"], auth_api.migrate_local)
                self.auth.revoke_local_sessions(x["id"])
                logkit.audit("sso_migrate", user=x["id"], via="sweep")
                n += 1
        return n

    def _set(self, uid, fn):
        with auth_api._lock:
            st = self.auth._users()
            u = next((x for x in st["users"] if x["id"] == uid), None)
            if not u:
                return None
            fn(u)
            u["updated"] = int(time.time())
            self.auth._save_users(st)
            return u

    @staticmethod
    def _sso_rec(uu, d=None):
        r = {"uuid": uu["uuid"], "username": str(uu.get("username") or "")[:60], "name": str(uu.get("name") or uu.get("nickname") or "")[:60],
             "rank": int(uu.get("role_rank") or 0), "linked_at": int(time.time()), "seen": int(time.time())}
        ms = ulogin_features(d, uu)
        if ms is None and isinstance(uu.get("slc_features"), list):
            ms = uu["slc_features"]
        if ms is not None:
            r["modes"] = ms
        return r

    # ---- 흐름 ----
    def redirect_uri(self, handler):
        """복귀 주소는 늘 공개 도메인(16.1·16.2 정정). 시험 사본만 HUB_PUB_SLC 로 시험 주소를 준다."""
        return (self.link.public("slc") if self.link else "https://learning.example.com") + "/sso/callback"

    def origin(self, handler):
        """로그인을 시작한 곳. 복귀가 다른 이름(공개 도메인)으로 오면 여기로 한 번 더 넘겨 그 브라우저 쿠키로 확인한다."""
        host = (handler.headers.get("X-Forwarded-Host") or handler.headers.get("Host") or "").split(",")[0].strip().lower()
        pub = urllib.parse.urlsplit(self.redirect_uri(handler)).netloc.lower()
        if LOOP.match(host):
            return "http://" + host
        if host and host == pub:
            return urllib.parse.urlsplit(self.redirect_uri(handler)).scheme + "://" + host
        return ""

    def start(self, handler, q):
        g = lambda k: (q.get(k) or [""])[0]
        purpose = "link" if g("link") == "1" else "login"
        u = handler.auth_user
        if purpose != "login" and not u:
            return _page(handler, "로그인 필요", "<p>먼저 이 시스템에 로그인한 뒤 다시 누르세요.</p>", 401)
        if purpose == "login" and self.mode() == "off":
            return _page(handler, "통합로그인 미사용", "<p>관리자가 통합로그인을 켜지 않았습니다.</p>", 403)
        c = self.conf()
        state, nonce, verifier = secrets.token_hex(32), secrets.token_urlsafe(24), secrets.token_hex(32)
        challenge = _b64url(hashlib.sha256(verifier.encode("ascii")).digest())
        ru = self.redirect_uri(handler)
        with _lock:
            now = time.time()
            for k in [k for k, v in self.pend.items() if now - v["t"] > TTL]:
                self.pend.pop(k, None)
            self.pend[state] = {"t": now, "nonce": nonce, "verifier": verifier, "ru": ru, "purpose": purpose, "uid": (u or {}).get("id"), "sess": handler.auth_hash, "origin": self.origin(handler)}
        base = c["public"]      # 브라우저 이동은 늘 공개 도메인(같은 PC 시험 사본만 시험 주소)
        loc = base + "/public/login.html?" + urllib.parse.urlencode({"service_id": c["service_id"], "redirect_uri": ru, "state": state, "code_challenge": challenge})
        return _redirect(handler, loc, [("Set-Cookie", _cookie(handler, nonce, TTL)), ("Cache-Control", "no-store")])

    def callback(self, handler, q):
        g = lambda k: (q.get(k) or [""])[0]
        state, code, nonce = g("state"), g("code"), auth_api.read_cookie(handler, COOKIE) or ""
        with _lock:
            p = self.pend.pop(state, None) if re.match(r"^[0-9a-f]{64}$", state or "") else None
        here = self.origin(handler)
        if p and p.get("origin") and here and p["origin"] != here and not p.get("hop"):
            # 127.0.0.1 등에서 시작했는데 공개 복귀 주소로 돌아왔다 → 시작한 곳으로 한 번 더 넘긴다(그곳에 이 브라우저의 쿠키가 있다). 한 번만
            with _lock:
                self.pend[state] = dict(p, hop=1)
            return _redirect(handler, p["origin"] + "/sso/callback?" + urllib.parse.urlencode({"code": code, "state": state}), [("Cache-Control", "no-store")])
        clear = [("Set-Cookie", _cookie(handler, "", 0)), ("Cache-Control", "no-store")]
        if not p or time.time() - p["t"] > TTL or not nonce or not secrets.compare_digest(nonce, p["nonce"]):
            logkit.audit("sso_fail", ok=False, ip=auth_api.client_ip(handler), reason="state")
            return _page(handler, "재로그인 필요", "<p>로그인 요청을 확인하지 못했습니다. 처음부터 다시 시작하세요.</p>" + _back(), 400, clear)
        if not code:
            return _page(handler, "로그인 미완료", "<p>통합로그인을 끝내지 않고 돌아왔습니다.</p>" + _back(), 400, clear)
        c = self.conf()
        st, j = self.call("POST", "/server/api/auth/exchange.php", {"code": code, "service_id": c["service_id"], "redirect_uri": p["ru"], "code_verifier": p["verifier"],
                                                                    "service_secret": self.secret() or None, "device_label": "ScholarFlow 서버"})
        if st == 0 or st >= 500:
            return _page(handler, "통합로그인 서버 연결 불가", "<p>잠시 뒤 다시 시도하세요." + (" 로컬 계정으로도 로그인할 수 있습니다." if self.mode() == "choice" else "") + "</p>" + _back(), 502, clear)
        ecode = str(((j or {}).get("error") or {}).get("code") or "") if isinstance(j, dict) and isinstance((j or {}).get("error"), dict) else ""
        if st == 403 and ecode in DENY:       # (v141) 16.9.1 ① 권한 없음·차단 — 로컬 계정으로 넘기지 않는다
            logkit.audit("sso_denied", ok=False, ip=auth_api.client_ip(handler), reason=ecode, stage="exchange")
            return _page(handler, "접속 불가", "<p>" + html.escape(DENY[ecode]) + "</p>" + _back(), 403, clear)
        d = (j or {}).get("data") if isinstance(j, dict) and j.get("ok") else None
        uu = (d or {}).get("user") or {}
        if not uu.get("uuid") or uu.get("status") not in (None, "active"):
            logkit.audit("sso_fail", ok=False, ip=auth_api.client_ip(handler), reason=((j or {}).get("error") or {}).get("code") if isinstance(j, dict) else "exchange")
            return _page(handler, "재로그인 필요", "<p>통합로그인 확인에 실패했습니다. 처음부터 다시 시작하세요.</p>" + _back(), 400, clear)
        # (v145) S-5 통합로그인 관리자가 정한 계정 연결(account_link) — 객체면 그 로컬 계정으로, null 이면 ulogin 이 만든 묶음을 푼다, 키 없으면 지금 그대로
        if isinstance(d, dict) and "account_link" in d and self.ulink:
            al = d.get("account_link")
            if isinstance(al, dict) and al.get("external_id"):
                st_, tgt = self.ulink.apply_link(uu["uuid"], str(al["external_id"]), why="login")
                if st_ == "missing":
                    return _page(handler, "연결 계정 없음", "<p>연결된 계정 없음, 관리자 문의</p>" + _back(), 403, clear)
                if p["purpose"] == "link" and tgt and tgt["id"] != p["uid"]:
                    return _page(handler, "전환 실패", "<p>통합로그인 관리자가 이 통합로그인 계정을 다른 계정에 연결해 두었습니다.</p>" + _back("/#/security"), 409, clear)
            elif al is None:
                self.ulink.apply_link(uu["uuid"], None, why="login")
        tok = str((d or {}).get("access_token") or "")
        rtok = str((d or {}).get("refresh_token") or "")     # (v141) 16.9.1 access_token 이 만료되면 갱신해 확인을 이어 간다
        ip = auth_api.client_ip(handler)
        if p["purpose"] == "link":
            me = self.auth.find(uid=p["uid"]) or {}
            if auth_api.is_breakglass(me):     # (v179) 비상용 관리자는 통합로그인과 묶지 않는다
                return _page(handler, "전환 불가", "<p>비상용 관리자 계정(admin)은 통합로그인에 연결하지 않습니다.</p>" + _back("/#/security"), 403, clear)
            if me.get("role") == "admin" and int(uu.get("role_rank") or 0) < ADMIN_RANK:
                return _page(handler, "전환 실패", "<p>관리자 계정은 통합로그인 관리자(admin 이상) 계정에만 연결합니다.</p>" + _back("/#/security"), 403, clear)
            other = self.find_uuid(uu["uuid"])
            if other and other["id"] != p["uid"]:
                return _page(handler, "이미 다른 계정에 연결됨", "<p>이 통합로그인 계정은 다른 로컬 계정에 연결되어 있습니다.</p>" + _back("/#/security"), 409, clear)
            u = self._set(p["uid"], lambda x: (x.update(sso=self._sso_rec(uu, d), local_login=False), auth_api.migrate_local(x)))   # (v156) 완전 이관
            self.auth.revoke_local_sessions(p["uid"])
            logkit.audit("sso_link", ip=ip, user=p["uid"], via="convert", migrated=True)
            return self._signin(handler, u, tok, clear, "/#/srvadmin" if u.get("role") == "admin" else "/#/security", rtok)
        u = self.find_uuid(uu["uuid"])
        if u:
            fm = ulogin_features(d, uu)       # (v143) 통합로그인이 이 시스템 기능 권한을 보냈으면 그 값으로(로그인마다)
            mig = not auth_api.is_migrated(u)
            u = self._set(u["id"], lambda x: (x["sso"].update(rank=int(uu.get("role_rank") or 0), seen=int(time.time()), name=str(uu.get("name") or x["sso"].get("name") or "")[:60]),
                                              x["sso"].update(modes=fm) if fm is not None else None, auth_api.migrate_local(x)))   # (v156) 이미 묶인 계정도 이관
            if mig:
                self.auth.revoke_local_sessions(u["id"])
                logkit.audit("sso_migrate", ip=ip, user=u["id"], via="login")
            if u.get("status") == "locked":
                return _page(handler, "잠긴 계정", "<p>관리자 문의</p>", 403, clear)
            return self._signin(handler, u, tok, clear, "/", rtok)
        # 연결이 없다 → 고르기
        pick, csrf = secrets.token_urlsafe(24), secrets.token_urlsafe(18)
        fm0 = ulogin_features(d, uu)
        with _lock:
            self.picks[pick] = {"t": time.time(), "uu": dict({k: uu.get(k) for k in ("uuid", "username", "name", "nickname", "email", "role_rank")}, **({"slc_features": fm0} if fm0 is not None else {})), "tok": self.box.seal(tok, "sso-pick") if tok else None,
                              "rtok": self.box.seal(rtok, "sso-pick-r") if rtok else None, "csrf": csrf}
        return self.pick_page(handler, pick, csrf, uu, [("Set-Cookie", _cookie(handler, pick, TTL)), ("Cache-Control", "no-store")])

    def pick_page(self, handler, pick, csrf, uu, hdr, msg=""):
        e = html.escape
        who = e(str(uu.get("name") or uu.get("username") or "통합로그인 계정"))
        body = ('<p>' + who + ' 님의 통합로그인 계정이 이 시스템의 계정과 아직 연결되지 않았습니다.</p>' + ('<p class="bad">' + e(msg) + "</p>" if msg else "") +
                '<form method="post" action="/sso/pick" class="sso-f"><input type="hidden" name="csrf" value="' + e(csrf) + '"><input type="hidden" name="act" value="link">'
                '<h3>기존 계정에 연결</h3><label>아이디<input class="input" name="username" autocomplete="username" required></label><label>비밀번호<input class="input" type="password" name="password" autocomplete="current-password" required></label>'
                '<button class="btn primary" type="submit">이 계정에 연결</button></form>'
                '<form method="post" action="/sso/pick" class="sso-f"><input type="hidden" name="csrf" value="' + e(csrf) + '"><input type="hidden" name="act" value="new">'
                '<h3>새 계정으로 시작</h3><p class="muted">이름은 통합로그인 계정 값을 씁니다. 권한은 통합로그인의 역할을 따릅니다.</p><button class="btn" type="submit">새 계정 만들기</button></form>')
        return _page(handler, "계정 연결", body, 200, hdr)

    def do_pick(self, handler):
        f = _form(handler)
        nonce = auth_api.read_cookie(handler, COOKIE) or ""
        with _lock:
            now = time.time()
            for k in [k for k, v in self.picks.items() if now - v["t"] > TTL]:
                self.picks.pop(k, None)
            p = self.picks.get(nonce)
        if not p or not secrets.compare_digest(str(f.get("csrf") or ""), p["csrf"]) or not auth_api.same_origin_ok(handler):
            return _page(handler, "재로그인 필요", "<p>연결 요청을 확인하지 못했습니다.</p>" + _back(), 400, [("Set-Cookie", _cookie(handler, "", 0))])
        uu, ip = p["uu"], auth_api.client_ip(handler)
        if self.find_uuid(uu["uuid"]):
            return _page(handler, "이미 연결됨", "<p>다시 통합로그인으로 들어오세요.</p>" + _back(), 409, [("Set-Cookie", _cookie(handler, "", 0))])
        if f.get("act") == "link":
            u = self.auth.find(username=f.get("username") or "")
            ok = bool(u) and auth_api.verify_password(f.get("password") or "", u.get("pw") or {})
            if not ok:
                logkit.audit("sso_pick_fail", ok=False, ip=ip, username=f.get("username"))
                return self.pick_page(handler, nonce, p["csrf"], uu, [], "아이디 또는 비밀번호가 맞지 않습니다.")
            if auth_api.is_breakglass(u):
                return self.pick_page(handler, nonce, p["csrf"], uu, [], "비상용 관리자 계정(admin)은 통합로그인에 연결하지 않습니다.")
            if u.get("role") == "admin" and int(uu.get("role_rank") or 0) < ADMIN_RANK:
                return self.pick_page(handler, nonce, p["csrf"], uu, [], "관리자 계정은 통합로그인 관리자(admin 이상) 계정에만 연결합니다.")
            if (u.get("sso") or {}).get("uuid"):
                return self.pick_page(handler, nonce, p["csrf"], uu, [], "그 계정은 이미 다른 통합로그인 계정에 연결되어 있습니다.")
            u = self._set(u["id"], lambda x: (x.update(sso=self._sso_rec(uu), local_login=False), auth_api.migrate_local(x)))   # (v156) 완전 이관
            self.auth.revoke_local_sessions(u["id"])
            logkit.audit("sso_link", ip=ip, user=u["id"], via="pick", migrated=True)
        else:
            base = re.sub(r"[^A-Za-z0-9_.-]", "", str(uu.get("username") or "user"))[:18] or "user"
            name, n = base, 1
            while self.auth.find(username=name):
                n += 1
                name = (base[:15] + str(n))
            with auth_api._lock:
                st = self.auth._users()
                u = self.auth._new_user(name, secrets.token_urlsafe(24), role="user")
                u.update(display=str(uu.get("name") or uu.get("nickname") or name)[:40], sso=self._sso_rec(uu), local_login=False)
                auth_api.migrate_local(u)        # (v156) 처음 온 계정도 로컬 비밀번호 없이
                st["users"].append(u)
                self.auth._save_users(st)
            logkit.audit("sso_new_user", ip=ip, user=u["id"], username=name)
        with _lock:
            self.picks.pop(nonce, None)
        tok = rtok = ""
        try:
            tok = self.box.open(p["tok"], "sso-pick") if p.get("tok") else ""
            rtok = self.box.open(p["rtok"], "sso-pick-r") if p.get("rtok") else ""
        except Exception:
            tok = rtok = ""
        return self._signin(handler, u, tok, [("Set-Cookie", _cookie(handler, "", 0))], "/", rtok)

    def _signin(self, handler, u, ul_tok, hdr, to, ul_ref=""):
        ip = auth_api.client_ip(handler)
        old = auth_api.read_cookie(handler)
        if old:
            self.auth.logout(old)
        tok, days = self.auth.issue_session(u, ip, handler.headers.get("User-Agent"), auth_api.is_remote(handler),
                                            extra={"ul": self.box.seal(ul_tok, "sso-ul") if ul_tok else None, "ulr": self.box.seal(ul_ref, "sso-ulr") if ul_ref else None, "via": "sso"})
        self._set(u["id"], lambda x: x.update(last_login=int(time.time()), last_ip=ip))
        logkit.audit("login", ip=ip, user=u["id"], username=u.get("username"), via="sso", admin=self.effective(u).get("role") == "admin")
        if self.link and hasattr(self.link, "autolink_bg"):
            self.link.autolink_bg(u["id"])     # (v176) 11.10 같은 통합로그인 계정이면 다른 시스템과 자동 연동(뒤에서, 로그인을 막지 않음)
        # 다른 사이트에서 돌아온 탐색이라 Strict 쿠키가 다음 요청에 안 붙는다 → 한 번 더 같은 사이트 안에서 옮긴다
        return _page(handler, "로그인 완료", '<p>이동하는 중입니다.</p><script>location.replace(' + json.dumps(to) + ')</script>', 200,
                     list(hdr) + [("Set-Cookie", auth_api.cookie_header(handler, tok, days * 86400))])

    def access_token_of(self, uid):
        """(v167) 그 계정의 가장 최근 통합로그인 세션 access_token(봉인 해제, 서버 메모리에서만). 없으면 ''."""
        try:
            ss = self.auth._sessions()["sessions"]
        except Exception:
            return ""
        now = time.time()
        rows = sorted((v for v in ss.values() if v.get("uid") == uid and v.get("via") == "sso" and v.get("ul") and v.get("expires", 0) > now),
                      key=lambda v: v.get("last_seen", 0), reverse=True)
        for v in rows:
            try:
                return self.box.open(v["ul"], "sso-ul")
            except Exception:
                continue
        return ""

    def check_session(self, h, ip=None):
        """(v141) 16.9.1 ② 통합로그인으로 들어온 세션만 CHECK_SEC 마다 ulogin session.php 로 확인한다.
        → False 면 이 요청부터 로그아웃 상태(세션을 지웠다). 연결 실패·5xx 는 유지하고 BACKOFF_SEC 동안 다시 부르지 않는다. 401 은 확인을 멈춘다."""
        if not h:
            return True
        now = time.time()
        with _lock:
            w = self.watch.get(h)
            if w and (w.get("stop") or w.get("busy") or now < w.get("next", 0)):
                return True
            if len(self.watch) > 5000:
                for k in [k for k, v in self.watch.items() if v.get("stop") or now - v.get("next", 0) > 86400][:2500]:
                    self.watch.pop(k, None)
            s = self.auth.session_rec(h)
            if not s or s.get("via") != "sso" or not s.get("ul"):
                self.watch[h] = {"stop": True, "next": now}       # 로컬 계정 세션은 부르지 않는다
                return True
            self.watch[h] = dict(w or {}, busy=True)
        try:
            tok = self.box.open(s["ul"], "sso-ul")
        except Exception:
            tok = ""
        if not tok:
            with _lock:
                self.watch[h] = {"stop": True, "next": now}
            return True
        st, j = self.call("GET", "/server/api/auth/session.php", token=tok)
        code = _ecode(j)
        nxt, stop, alive, why = now + CHECK_SEC, False, True, ""
        if st == 401:                       # access_token 만료 → refresh 로 갱신해 다시 확인(확인을 멈추면 권한을 빼도 안 끊긴다)
            rt = ""
            try:
                rt = self.box.open(s["ulr"], "sso-ulr") if s.get("ulr") else ""
            except Exception:
                rt = ""
            if not rt:
                st, why = 403, "no_refresh"     # 갱신할 수 없다(옛 세션) → 끝내고 다시 로그인하게
            else:
                rs, rj = self.call("POST", "/server/api/auth/refresh.php", {"refresh_token": rt, "device_label": "ScholarFlow 서버"})
                rd = (rj or {}).get("data") if isinstance(rj, dict) and rj.get("ok") else None
                if rs == 200 and rd and rd.get("access_token"):
                    tok = str(rd["access_token"])
                    nr = str(rd.get("refresh_token") or "")
                    self.auth.update_session(h, {"ul": self.box.seal(tok, "sso-ul"), "ulr": self.box.seal(nr, "sso-ulr") if nr else None})   # 회전된 값은 바로 저장
                    logkit.info("sso", "통합로그인 토큰 갱신", user=s.get("uid"))
                    st, j = self.call("GET", "/server/api/auth/session.php", token=tok)
                    code = _ecode(j)
                elif rs in (401, 403) or (400 <= rs < 500 and rs != 429):
                    st, code, why = 403, _ecode(rj) or "REFRESH_%d" % rs, "refresh"
                else:                           # 5xx·429·연결 실패 → 유지, 억제
                    st = rs if rs else 0
        if st == 200 and isinstance(j, dict) and j.get("ok") and self.ulink and isinstance(j.get("data"), dict) and "account_link" in j["data"]:
            al = j["data"].get("account_link")         # (v145) 세션 확인에서도 연결 결정을 따른다
            me = self.auth.find(uid=s.get("uid")) or {}
            uuid_ = (me.get("sso") or {}).get("uuid")
            if isinstance(al, dict) and al.get("external_id") and str(al["external_id"]) != str(s.get("uid")):
                st, code, why = 403, "ACCOUNT_RELINKED", "relinked"
                if uuid_:
                    self.ulink.apply_link(uuid_, str(al["external_id"]), why="session")
            elif al is None and (me.get("sso") or {}).get("origin") == "ulogin" and uuid_:
                self.ulink.apply_link(uuid_, None, why="session")
                st, code, why = 403, "ACCOUNT_UNLINKED", "unlinked"
        if st == 200 and isinstance(j, dict) and j.get("ok"):
            fm = ulogin_features((j or {}).get("data"), ((j or {}).get("data") or {}).get("user"))
            if fm is not None and s.get("uid"):
                try:
                    self._set(s["uid"], lambda x: x.setdefault("sso", {}).update(modes=fm))
                except Exception:
                    pass
        if st == 403 and (code in DENY or why):
            alive = False
            self.auth.drop_session(h)
            logkit.audit("sso_session_end", ok=False, ip=ip, user=s.get("uid"), reason=code or why, stage=why or "session")
        elif st == 401:
            alive = False                       # 새 토큰으로도 401 — 확인할 수 없는 세션은 끝낸다
            self.auth.drop_session(h)
            logkit.audit("sso_session_end", ok=False, ip=ip, user=s.get("uid"), reason="UNAUTHORIZED_AFTER_REFRESH")
        elif st == 0 or st >= 500 or st == 429:
            nxt = now + BACKOFF_SEC        # ulogin 이 꺼져도 일은 계속
            logkit.warn("sso", "통합로그인 세션 확인 실패 — %d초 뒤 다시" % BACKOFF_SEC, status=st, user=s.get("uid"))
        with _lock:
            if alive:
                self.watch[h] = {"next": nxt, "stop": stop}
            else:
                self.watch.pop(h, None)
        return alive

    def on_logout(self, sess):
        """내 로그아웃 뒤 ulogin 도 끝낸다. 실패해도 내 로그아웃은 이미 끝났다."""
        s = (sess or {}).get("ul")
        if not s:
            return
        try:
            tok = self.box.open(s, "sso-ul")
        except Exception:
            return
        threading.Thread(target=lambda: self.call("POST", "/server/api/auth/logout.php", {"all_devices": False}, tok), daemon=True).start()


# ---- 작은 도우미 ----
def ulogin_features(d, uu=None):
    """(v144) 통합로그인 응답에서 이 시스템(alc) 기능 권한을 읽는다 — 정본: exchange·session·refresh 응답 data.features(ulogin v1.9.0).
    키 없음 = None(ulogin 이 관리하지 않음 → 이 시스템 설정), [] = 쓸 수 있는 기능 없음, ["research","library"] 등."""
    if not isinstance(d, dict) or "features" not in d:
        return None
    return auth_api.parse_features(d.get("features") if d.get("features") is not None else [])


def _ecode(j):
    return str(((j or {}).get("error") or {}).get("code") or "") if isinstance(j, dict) and isinstance((j or {}).get("error"), dict) else ""


def _web_slc():
    return (os.environ.get("HUB_WEB_SLC") or "http://127.0.0.1:%d" % (portreg.SELF_PORT["port"] or 18162)).rstrip("/")


def _cookie(handler, v, age):
    c = "%s=%s; Path=/sso; HttpOnly; SameSite=Lax; Max-Age=%d" % (COOKIE, v, age)
    return c + ("; Secure" if auth_api.is_https(handler) else "")


def _send(handler, code, body, hdr=()):
    b = body.encode("utf-8")
    handler.send_response(code)
    handler.send_header("Content-Type", "text/html; charset=utf-8")
    handler.send_header("Content-Length", str(len(b)))
    handler.send_header("Cache-Control", "no-store")
    for k, v in hdr:
        if k != "Cache-Control":
            handler.send_header(k, v)
    handler.end_headers()
    handler.wfile.write(b)


def _redirect(handler, loc, hdr=()):
    handler.send_response(303)
    handler.send_header("Location", loc)
    handler.send_header("Content-Length", "0")
    for k, v in hdr:
        handler.send_header(k, v)
    handler.end_headers()


APP_VERSION = ""      # (v148) serve.py 가 넣는다 — 로그인 쪽 페이지의 버전 뱃지
# (v148) G16 공통 로그인 화면의 왼쪽 시스템 면 — app.js LOGIN_PITCH 와 같은 문구
LOGIN_PITCH = {"tagline": "연구·학습을 한 계정으로 연속 이용",
               "desc": "연구 프로젝트 자료·문서 정리, 학습 자료 읽기, AI 도우미",
               "points": ["연구 자료 정리와 보고서·논문·발표자료 작성", "학습 자료 읽기와 AI 도우미", "계정·AI 연결·백업을 서버 한 곳에서 관리"]}


def _page(handler, title, body, code=200, hdr=()):
    """(v148) G16 — 통합로그인 고르기·거절·오류 페이지도 공통 로그인 화면(RUI.login)과 같은 배치: 왼쪽 시스템 면 + 오른쪽 칸."""
    e = html.escape
    name = "ScholarFlow"
    pts = "".join('<li><i data-ic="check"></i><span>' + e(t) + "</span></li>" for t in LOGIN_PITCH["points"])
    _send(handler, code, '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + e(title) + ' · ' + name + '</title>'
          + sitever.assets() +
          '<style>.sso-f{display:grid;gap:12px;padding-top:14px;border-top:1px solid var(--rui-line)}.sso-f h3{margin:0;font-size:14px;font-weight:600;color:var(--rui-ink)}'
          '.rui-login-form p{margin:0;color:var(--rui-ink-2);font-size:13.5px;line-height:1.6}.rui-login-form p.bad{color:var(--rui-bad)}.rui-login-form p.muted{color:var(--rui-ink-3);font-size:12.5px}</style>'
          '</head><body class="rui"><div class="rui-login">'
          '<aside class="rui-login-brand"><div class="rui-login-id"><span class="logo" aria-hidden="true"><i data-ic="cap"></i></span><b>' + name + '</b>' + ('<span class="ver">' + e(APP_VERSION) + '</span>' if APP_VERSION else "") + '</div>'
          '<div class="rui-login-pitch"><h2>' + e(LOGIN_PITCH["tagline"]) + '</h2><p>' + e(LOGIN_PITCH["desc"]) + '</p><ul class="rui-login-pts">' + pts + '</ul></div>'
          '<p class="rui-login-foot">연구 허브 · ' + name + '</p></aside>'
          '<main class="rui-login-main"><div class="rui-login-tools"><button type="button" class="icon-btn" data-rui-login-mode aria-label="밝기 바꾸기" title="밝기 바꾸기"></button></div>'
          '<div class="rui-login-form"><h1>' + e(title) + "</h1>" + body + '<p class="rui-login-help">계정 없음·비밀번호 분실 시 관리자 문의</p></div></main></div>'
          '<script>(function(){var q=function(s){return document.querySelectorAll(s)};Array.prototype.forEach.call(q("i[data-ic]"),function(x){x.outerHTML=RUI.icon(x.getAttribute("data-ic"))});'
          'var b=document.querySelector("[data-rui-login-mode]"),p=function(){b.innerHTML=RUI.icon(RUI.mode()==="dark"?"sun":"moon")};b.onclick=function(){RUI.set({mode:RUI.mode()==="dark"?"light":"dark"});p()};p()})()</script>'
          + sitever.script() + "</body></html>", hdr)


def _back(to="/"):
    return '<p><a class="btn" href="' + html.escape(to) + '">돌아가기</a></p>'


def _form(handler, limit=8 * 1024):
    n = int(handler.headers.get("Content-Length") or 0)
    if n <= 0 or n > limit:
        return {}
    return {k: v[0] for k, v in urllib.parse.parse_qs(handler.rfile.read(n).decode("utf-8", "replace"), keep_blank_values=True).items()}


# ---- 경로 ----
def handle_web(s, handler, path, method):
    q = urllib.parse.parse_qs(urllib.parse.urlsplit(handler.path).query)
    if path == "start" and method == "GET":
        return s.start(handler, q)
    if path == "callback" and method == "GET":
        return s.callback(handler, q)
    if path == "pick" and method == "POST":
        return s.do_pick(handler)
    return _page(handler, "없는 주소", _back(), 404)


def handle_api(s, handler, q, method):
    g = lambda k, d="": (q.get(k) or [d])[0]
    op, u, ip = g("op"), handler.auth_user, auth_api.client_ip(handler)
    if op.startswith("emergency_") and s.emg:      # (v169) 비상복구모드 — 로그인 전에도 부르는 경로
        import emergency_api
        return emergency_api.handle(s.emg, handler, op, method)
    c = s.conf()
    if method == "GET" and op == "status":
        up = s.health() if c["mode"] != "off" else None
        return handler._json(200, {"ok": True, "mode": c["mode"], "up": up, "ready": bool(c["secret"]), "linked": bool(u and (u.get("sso") or {}).get("uuid")), "localLogin": bool(u) and u.get("local_login") is not False})
    if not u:
        return handler._json(401, {"ok": False, "error": "no_session", "message": "로그인이 필요합니다."})
    if method == "GET" and op == "services":       # (v178) 이 계정이 들어갈 수 있는 서비스(통합로그인 userinfo services) — 「다른 시스템」 목록용
        return handler._json(200, {"ok": True, "services": s.services_of(u)})
    if method == "POST" and not auth_api.csrf_ok(handler):
        return handler._json(403, {"ok": False, "message": "요청 출처를 확인할 수 없습니다."})
    if method == "POST" and op == "to_local":
        b = auth_api.body_json(handler)
        if c["mode"] == "only":
            return handler._json(403, {"ok": False, "message": "통합로그인 전용 모드에서는 로컬 계정으로 바꿀 수 없습니다."})
        if u.get("role") == "admin" and c["mode"] != "off":
            return handler._json(403, {"ok": False, "message": "통합로그인을 켠 동안에는 관리자 계정을 로컬로 바꿀 수 없습니다."})
        if not (u.get("sso") or {}).get("uuid"):
            return handler._json(400, {"ok": False, "message": "통합로그인 계정에 연결되어 있지 않습니다."})
        err = s.auth.check_new_password(u["username"], str(b.get("password") or ""))
        if err:
            return handler._json(400, {"ok": False, "message": err})
        pw = auth_api.hash_password(str(b.get("password")))
        s._set(u["id"], lambda x: (x.pop("sso", None), x.update(local_login=True, pw=pw, must_change=False, default_pw=False)))
        logkit.audit("sso_unlink", ip=ip, user=u["id"], via="to_local")
        return handler._json(200, {"ok": True})
    if u.get("role") != "admin":
        return handler._json(403, {"ok": False, "message": "관리자만 할 수 있습니다."})
    if method == "GET" and op == "conf":
        links = [{"id": x["id"], "username": x["username"], "display": x.get("display") or x["username"], "ulogin": (x.get("sso") or {}).get("username"), "admin": int((x.get("sso") or {}).get("rank") or 0) >= ADMIN_RANK,
                  "seen": (x.get("sso") or {}).get("seen")} for x in s.auth._users()["users"] if (x.get("sso") or {}).get("uuid")]
        return handler._json(200, {"ok": True, "mode": c["mode"], "internal": c["internal"], "public": c["public"], "service_id": c["service_id"], "hasSecret": bool(c["secret"]),
                                   "up": s.health(), "linkedAdmin": bool((u.get("sso") or {}).get("uuid")) and int(u["sso"].get("rank") or 0) >= ADMIN_RANK,
                                   "links": links, "handoff": vfs.isfile(handoff_file(c["service_id"])), "updated": c["updated"], "ulink": s.ulink.info() if s.ulink else None, "platlog": s.platlog.status() if s.platlog else None,
                                   "rename": (lambda h: {"from": c["service_id"], "to": h["service_id"], "issued_at": h.get("issued_at")} if h else None)(rename_offer(c["service_id"])[1])})
    if method != "POST":
        return handler._json(405, {"ok": False, "message": "허용 안 됨"})
    b = auth_api.body_json(handler)
    if op == "mode":
        m = str(b.get("mode") or "")
        if m not in MODES:
            return handler._json(400, {"ok": False, "message": "모드 값이 맞지 않습니다."})
        if m != "off" and (c["mode"] == "off" or m == "only"):
            if not s.health():
                return handler._json(409, {"ok": False, "error": "down", "message": "통합로그인 서버가 응답하지 않아 켤 수 없습니다."})
            linked_admin = bool((u.get("sso") or {}).get("uuid")) and int(u["sso"].get("rank") or 0) >= ADMIN_RANK
            if not linked_admin and m == "only":       # (v144) choice 는 전환 전에도 켠다(로컬 관리자는 전환할 때까지 그대로)
                return handler._json(409, {"ok": False, "error": "lockout", "message": "먼저 내 계정을 통합로그인 관리자 계정으로 전환하세요. 켜는 순간 로컬 관리자 로그인은 막힙니다."})
        set_mode_file(s.dir, m, u["id"])
        n = 0
        if m != "off" and not s.bridge():      # 로컬 관리자 세션은 끝낸다. 통합로그인으로 다시 들어온다(다리 기간은 그대로)
            for x in s.auth._users()["users"]:
                if x.get("role") == "admin" and not (x.get("sso") or {}).get("uuid"):
                    n += s.auth.revoke_user_sessions(x["id"])
        logkit.audit("sso_mode", ip=ip, user=u["id"], mode=m, revoked=n)
        return handler._json(200, {"ok": True, "mode": m, "relogin": n > 0})
    if op == "addr":      # code 교환 주소(같은 PC 면 http://127.0.0.1:8197)와 브라우저용 로그인 주소(공개 도메인)
        ins, pub = str(b.get("internal") or "").strip().rstrip("/"), str(b.get("public") or "").strip().rstrip("/")
        if not re.match(r"^https?://[A-Za-z0-9.\-\[\]:]+(/[\w./-]*)?$", ins) or not re.match(r"^https?://[A-Za-z0-9.\-\[\]:]+(/[\w./-]*)?$", pub):
            return handler._json(400, {"ok": False, "message": "주소 형식이 맞지 않습니다(http(s)://…)."})
        s._save({"internal": ins, "public": pub})
        logkit.audit("sso_addr", ip=ip, user=u["id"], internal=ins, public=pub)
        return handler._json(200, {"ok": True})
    if op == "unlink":
        uid = str(b.get("id") or "")
        x = s.auth.find(uid=uid)
        if not x or not (x.get("sso") or {}).get("uuid"):
            return handler._json(404, {"ok": False, "message": "연결된 계정이 아닙니다."})
        s._set(uid, lambda y: (y.pop("sso", None), y.update(local_login=True, must_change=True)))
        s.auth.revoke_user_sessions(uid)
        logkit.audit("sso_unlink", ip=ip, user=u["id"], target=uid, via="admin")
        return handler._json(200, {"ok": True, "message": "연결을 풀었습니다. 로컬 로그인을 쓰려면 [비번 초기화]로 임시 비밀번호를 주세요."})
    if op == "platlog_send":          # (v157) 관리자: 로그·감사 지금 보내기(멈춤·미지원 대기를 무시하고 한 번)
        if not s.platlog:
            return handler._json(404, {"ok": False, "message": "로그·감사 보내기 기능이 없습니다."})
        s.platlog.tick(force=True)
        return handler._json(200, {"ok": True, "platlog": s.platlog.status()})
    if op in ("ulink_push", "ulink_feed"):          # (v145) 계정 목록 보내기(S-2 전체) · 연결 사건 받기(S-4)
        if not s.ulink:
            return handler._json(404, {"ok": False, "message": "계정 연결 기능이 없습니다."})
        r = s.ulink.push(True, by=u["id"]) if op == "ulink_push" else s.ulink.feed()
        return handler._json(200 if r.get("ok") else 502, dict(r, ok=bool(r.get("ok")), message=r.get("message") or (None if r.get("ok") else "통합로그인에 보내지 못했습니다: " + str(r.get("error")))))
    if op == "rename":      # (v150) 서비스 id 전환 — 관리자가 확인한 뒤에만. 비밀값은 그대로
        p, h = rename_offer(c["service_id"])
        to = str(b.get("to") or "")
        if not h:
            return handler._json(404, {"ok": False, "message": "받을 수 있는 서비스 id 전환 파일이 없습니다."})
        if to != h["service_id"]:
            return handler._json(409, {"ok": False, "message": "파일 내용이 바뀌었습니다. 화면을 새로 고친 뒤 다시 확인하세요."})
        if not c["secret"] or not s.secret():
            return handler._json(409, {"ok": False, "message": "지금 비밀값이 없어 바꿀 수 없습니다. 비밀값을 먼저 넣으세요."})
        s._save({"service_id": to})
        try:
            vfs.remove(p)
        except OSError:
            pass
        logkit.audit("sso_service_rename", ip=ip, user=u["id"], former=c["service_id"], to=to)
        return handler._json(200, {"ok": True, "service_id": to, "message": "서비스 id 를 " + to + " 로 바꿨습니다. 비밀값은 그대로입니다."})
    if op == "handoff":
        hf = handoff_file(c["service_id"])
        h = _read(hf)
        if not isinstance(h, dict) or not h.get("service_secret"):
            return handler._json(404, {"ok": False, "message": "ulogin 이 둔 비밀값 파일이 없습니다."})
        if str(h.get("service_id") or c["service_id"]) != c["service_id"]:
            return handler._json(400, {"ok": False, "message": "다른 서비스의 파일입니다."})
        patch = {"secret": s.box.seal(str(h["service_secret"]), "sso|" + SERVICE_ID), "service_id": c["service_id"]}
        s._save(patch)
        try:
            vfs.remove(hf)
        except OSError:
            pass
        logkit.audit("sso_secret_import", ip=ip, user=u["id"])
        return handler._json(200, {"ok": True, "message": "비밀값을 넣고 파일을 지웠습니다."})
    return handler._json(404, {"ok": False, "message": "없는 동작"})
