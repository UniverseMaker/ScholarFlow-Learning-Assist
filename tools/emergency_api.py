# -*- coding: utf-8 -*-
"""(v169) 비상복구모드 emergency/1 v1.2 — 통합로그인이 죽었을 때의 비상 로그인(계약 1-2·1-2a).

평소에는 아무것도 바뀌지 않는다. 서버가 통합로그인 health 를 확인해 연결 실패·시간 초과·5xx 일 때만 열린다.
  · 받아 두기: 계정 연결 사건 피드의 emergency_verifier 를 uuid 별로 봉인 저장(로컬 계정과 묶인 uuid 만),
    emergency_revoke·unlinked 면 지운다. 저장 위치 <데이터>/system/emergency.json(SQLite 엔진이면 DB 안).
  · ev 는 비밀번호 해시와 같은 등급(1-2a ①) — 화면·응답·로그·감사·내보내기에 내지 않는다. 봉인 묶음 값 emg|<uuid>.
  · 비상 로그인: 그 순간 health 를 다시 확인(정상이면 409) → 저장본 찾기 → ev 다시 계산·상수 시간 비교.
    실패 제한: 아이디·IP·저장본(uuid) 별 15분 5회, 넘으면 15분 잠금(1-2a ③). 실패 이유는 밝히지 않는다(같은 문구 401).
  · 비상 세션: via=emergency·emergency=1·최대 8시간(cap), 역할은 저장본의 role_rank(≥20 관리자), 보안 설정 변경은 409,
    통합로그인이 다시 응답하면(확인 간격 30초) 다음 요청에서 끝난다.
  · 성공하면 관리자 화면에 「비상 로그인 발생」 강조(관리자가 확인할 때까지, 1-2a ④).
  · 기록: auth.emergency_login(성공·실패·잠금)·auth.emergency_end — 감사 기록이라 116s0 스풀로 통합로그인에 간다.
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from datetime import datetime, timezone

import auth_api
import logkit
import safeio
import vfs      # noqa: E402  (v151) SQLite 엔진이면 데이터 폴더의 .json 은 DB
open = vfs.open  # noqa: A001

SESSION_SEC = int(os.environ.get("STUDY_EMG_SESSION_SEC") or 8 * 3600)
HEALTH_TTL = int(os.environ.get("STUDY_EMG_HEALTH_TTL") or 30)
WINDOW, MAX_FAIL, LOCK_SEC = 900, 5, 900
ITER_MIN, ITER_MAX = 100000, 2000000
ADMIN_RANK = 20
ALERTS_KEEP = 50

MSG_UP = "통합로그인이 정상입니다. 통합로그인으로 로그인하세요."
MSG_NO = "비상 로그인을 할 수 없습니다. 통합로그인 복구 후 다시 시도하세요."
MSG_LOCK = "시도가 너무 많습니다. 15분 뒤 다시 시도하세요."
MSG_BLOCK = "비상복구모드에서는 할 수 없습니다"
MSG_END = "통합로그인이 복구되었습니다. 다시 로그인하세요."
BAR = "비상복구모드 · 통합로그인 접속 불가 중 · 복구되면 다시 로그인"

# 비상 세션에서 막는 쓰기(1-2 ④): 통합로그인 설정·모드, 계정 연결·해제·전환, 역할·권한, API 토큰, 비밀 설정(AI 키 등)
BLOCK = {
    "auth": {"password", "user_create", "user_update", "user_delete", "policy", "signup"},
    "llm": {"save", "remove", "import", "export", "aim_handoff", "aim_addr"},
    "hublink": {"start", "unlink", "approve", "authorize", "domains"},
    "rnd": {"connect", "disconnect", "import_local"},
    "kb": {"connect", "disconnect"},
}
SSO_ALLOW = {"emergency_ack"}        # 비상 세션에서도 되는 통합로그인 경로(관리자 강조 확인)


def _b64d(s):
    s = str(s or "")
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _ts(v):
    """ISO8601(…Z) 또는 숫자 → 초. 못 읽으면 0."""
    if v is None or v == "":
        return 0
    if isinstance(v, (int, float)):
        return float(v) / 1000 if v > 10 ** 11 else float(v)
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00")).astimezone(timezone.utc).timestamp()
    except ValueError:
        return 0


def check_ev(ev, password, service_id, uuid):
    """ev1$pbkdf2-sha256$<iter>$<salt>$<mac> 를 다시 계산해 상수 시간 비교."""
    try:
        p = str(ev or "").split("$")
        if len(p) != 5 or p[0] != "ev1" or p[1] != "pbkdf2-sha256":
            return False
        it = int(p[2])
        if not ITER_MIN <= it <= ITER_MAX:
            return False
        salt, mac = _b64d(p[3]), _b64d(p[4])
        dk = hashlib.pbkdf2_hmac("sha256", str(password).encode("utf-8"), salt, it, 32)
        calc = hmac.new(dk, ("emergency/1|" + service_id + "|" + uuid).encode("utf-8"), hashlib.sha256).digest()
        return hmac.compare_digest(calc, mac)
    except Exception:
        return False


def _dummy(password):
    hashlib.pbkdf2_hmac("sha256", str(password).encode("utf-8"), b"emergency-dummy!", 310000, 32)   # 시간 맞추기


class Emergency:
    def __init__(self, data_dir, auth, sso, box):
        self.dir, self.auth, self.sso, self.box = data_dir, auth, sso, box
        self.f = os.path.join(data_dir, "system", "emergency.json")
        self.lock = threading.RLock()
        self._h = {"t": 0.0, "up": True, "busy": False}
        self._fails = {}           # 키(id:/ip:/uuid:) → [시각]
        self._locked = {}          # 키 → 잠금 끝 시각

    # ---- 저장 ----
    def _load(self):
        try:
            with open(self.f, encoding="utf-8") as fh:
                d = json.load(fh)
            return d if isinstance(d, dict) else {}
        except (OSError, ValueError):
            return {}

    def _save(self, d):
        safeio.atomic_json(self.f, d, indent=1)

    def _rows(self):
        """봉인을 풀어 저장본 목록(서버 메모리에서만)."""
        out = []
        for uu, r in (self._load().get("users") or {}).items():
            try:
                rec = json.loads(self.box.open(r.get("s"), "emg|" + uu))
            except Exception:
                continue
            if isinstance(rec, dict) and rec.get("uuid") == uu:
                out.append(rec)
        return out

    def count(self):
        return len((self._load().get("users") or {}))

    # ---- 피드 사건 ----
    def on_event(self, e):
        t = str(e.get("type") or "")
        d = e.get("data") if isinstance(e.get("data"), dict) else e
        uu = str(d.get("uuid") or e.get("uuid") or "")
        if not uu:
            return False
        if t == "emergency_verifier":
            return self.store(uu, d)
        if t in ("emergency_revoke", "unlinked"):
            return self.drop(uu, d.get("reason") or t)
        return False

    def store(self, uu, d):
        local = self.sso.find_uuid(uu)
        if not local:                              # 묶이지 않은 uuid 는 저장하지 않는다
            return False
        ev = str(d.get("ev") or "")
        if not ev.startswith("ev1$"):
            return False
        rec = {"uuid": uu, "username": str(d.get("username") or "")[:128], "name": str(d.get("name") or "")[:128], "role": str(d.get("role") or "")[:40],
               "role_rank": int(d.get("role_rank") or 0), "status": str(d.get("status") or ""), "ev": ev,
               "issued_at": d.get("issued_at"), "expires_at": d.get("expires_at"), "local": local["id"], "got": int(time.time())}
        with self.lock:
            st = self._load()
            st.setdefault("users", {})[uu] = {"s": self.box.seal(json.dumps(rec, ensure_ascii=False), "emg|" + uu), "at": int(time.time())}
            self._save(st)
        logkit.info("sso", "비상 확인값 받음", user=local["id"], uuid=uu)
        return True

    def drop(self, uu, why=""):
        with self.lock:
            st = self._load()
            if uu not in (st.get("users") or {}):
                return False
            st["users"].pop(uu, None)
            self._save(st)
        logkit.info("sso", "비상 확인값 지움", uuid=uu, reason=str(why)[:40])
        return True

    # ---- 통합로그인 상태 ----
    def _probe(self):
        st, _j = self.sso.call("GET", "/server/api/health.php")
        return not (st == 0 or st >= 500)        # 연결 실패·시간 초과·5xx 만 '죽음'

    def up(self, fresh=False):
        now = time.time()
        with self.lock:
            h = self._h
            if not fresh and h["t"] and (now - h["t"] < HEALTH_TTL or h["busy"]):
                return h["up"]
            h["busy"] = True
        u = True
        try:
            u = self._probe()
        finally:
            with self.lock:
                self._h = {"t": time.time(), "up": u, "busy": False}
        return u

    def available(self):
        return self.sso.mode() != "off" and not self.up()

    # ---- 실패 제한(아이디·IP·저장본) ----
    def _is_locked(self, keys):
        now = time.time()
        with self.lock:
            return any(self._locked.get(k, 0) > now for k in keys)

    def _fail(self, keys):
        now = time.time()
        hit = False
        with self.lock:
            for k in keys:
                lst = [t for t in self._fails.get(k, []) if now - t < WINDOW] + [now]
                self._fails[k] = lst
                if len(lst) >= MAX_FAIL:
                    self._locked[k] = now + LOCK_SEC
                    self._fails[k] = []
                    hit = True
            if len(self._fails) > 5000:
                for k in [k for k, v in self._fails.items() if not v or now - v[-1] > WINDOW][:2500]:
                    self._fails.pop(k, None)
        return hit

    def _clear(self, keys):
        with self.lock:
            for k in keys:
                self._fails.pop(k, None)

    # ---- 비상 로그인 ----
    def login(self, handler, username, password):
        """→ (http 상태, 응답 객체, 머리글 목록)"""
        ip = auth_api.client_ip(handler)
        ul = str(username or "").strip().lower()[:128]
        if self.sso.mode() == "off":
            return 409, {"ok": False, "error": "off", "message": MSG_NO}, []
        if self.up(fresh=True):
            logkit.audit("auth.emergency_login", ok=False, ip=ip, username=ul, result="refused", reason="ulogin_up")
            return 409, {"ok": False, "error": "ulogin_up", "message": MSG_UP}, []
        rec = next((r for r in self._rows() if str(r.get("username") or "").lower() == ul), None) if ul else None
        keys = ["id:" + ul, "ip:" + ip] + (["uuid:" + rec["uuid"]] if rec else [])
        if self._is_locked(keys):
            logkit.audit("auth.emergency_login", ok=False, ip=ip, username=ul, result="locked")
            return 429, {"ok": False, "error": "locked", "message": MSG_LOCK}, []
        why, u = "", None
        if not rec:
            _dummy(password)
            why = "no_record"
        else:
            u = self.auth.find(uid=rec.get("local"))
            ok_ev = check_ev(rec.get("ev"), password or "", self.sso.conf()["service_id"], rec["uuid"])
            exp = _ts(rec.get("expires_at"))
            if not ok_ev:
                why = "bad_password"
            elif not exp or exp < time.time():
                why = "expired"
            elif rec.get("status") != "active":
                why = "status"
            elif not u or u.get("status") == "locked" or (u.get("sso") or {}).get("uuid") != rec["uuid"]:
                why = "local"
        if why:
            locked = self._fail(keys)
            logkit.audit("auth.emergency_login", ok=False, ip=ip, user=(u or {}).get("id"), username=ul, result="locked" if locked else "fail", reason=why)
            return 401, {"ok": False, "error": "emergency_denied", "message": MSG_NO}, []
        self._clear(keys)
        rank = int(rec.get("role_rank") or 0)
        cap = int(time.time()) + SESSION_SEC
        old = auth_api.read_cookie(handler)
        if old:
            self.auth.logout(old)
        tok, _days = self.auth.issue_session(u, ip, handler.headers.get("User-Agent"), auth_api.is_remote(handler),
                                             extra={"via": "emergency", "emergency": 1, "emg_uuid": rec["uuid"], "emg_rank": rank, "cap": cap})
        self.sso._set(u["id"], lambda x: x.update(last_login=int(time.time()), last_ip=ip))
        self._alert(u, rec, ip)
        logkit.audit("auth.emergency_login", ip=ip, user=u["id"], username=ul, result="success", admin=rank >= ADMIN_RANK, until=cap)
        pu = self.auth.public(self.effective(u, {"emg_rank": rank, "cap": cap}))
        return 200, {"ok": True, "user": pu, "emergency": True, "until": cap}, [("Set-Cookie", auth_api.cookie_header(handler, tok, SESSION_SEC))]

    # ---- 비상 세션 ----
    @staticmethod
    def effective(u, emg):
        rank = int((emg or {}).get("emg_rank") or 0)
        role = "admin" if rank >= ADMIN_RANK else ("user" if u.get("role") == "admin" else u.get("role", "user"))
        return dict(u, role=role, role_local=u.get("role"), emergency=True, emergency_until=(emg or {}).get("cap"))

    def session(self, h, u, ip=None):
        """비상 세션 요청마다. 통합로그인이 살아났거나 모드가 off 면 세션을 끝내고 None."""
        emg = u.get("_emg") or {}
        why = "off" if self.sso.mode() == "off" else ("recovered" if self.up() else "")
        if not why and (u.get("sso") or {}).get("uuid") != emg.get("emg_uuid"):
            why = "unlinked"
        if why:
            self.auth.drop_session(h)
            logkit.audit("auth.emergency_end", ip=ip, user=u.get("id"), reason=why)
            return None
        return self.effective({k: v for k, v in u.items() if k != "_emg"}, emg)

    @staticmethod
    def blocked(kind, q, method):
        if method not in ("POST", "PUT", "DELETE"):
            return False
        if kind == "vault":
            return True
        op = q if isinstance(q, str) else ((q or {}).get("op") or [""])[0] if isinstance(q, dict) else ""
        if kind == "sso":
            return op not in SSO_ALLOW
        if kind == "admin":
            return str(op).startswith("hub_")
        return op in BLOCK.get(kind, ())

    # ---- 관리자 강조(1-2a ④) ----
    def _alert(self, u, rec, ip):
        with self.lock:
            st = self._load()
            al = st.get("alerts") or []
            al.append({"id": secrets.token_hex(6), "at": int(time.time()), "user": u["id"], "username": u.get("username"), "ulogin": rec.get("username"), "ip": ip, "ack": None})
            st["alerts"] = al[-ALERTS_KEEP:]
            self._save(st)

    def alerts(self, all_=False):
        al = self._load().get("alerts") or []
        return [a for a in al if all_ or not a.get("ack")][::-1]

    def ack(self, by, aid=None):
        n = 0
        with self.lock:
            st = self._load()
            for a in st.get("alerts") or []:
                if not a.get("ack") and (not aid or a.get("id") == aid):
                    a["ack"] = {"by": by, "at": int(time.time())}
                    n += 1
            if n:
                self._save(st)
        return n

    def status(self):
        return {"available": self.available(), "bar": BAR}


def handle(E, handler, op, method):
    """api.php?r=sso&op=emergency_* — sso_api.handle_api 가 먼저 넘긴다."""
    u = handler.auth_user
    if op == "emergency_status" and method == "GET":
        return handler._json(200, {"ok": True, "available": E.available(), "mode": E.sso.mode()})
    if op == "emergency_login":
        if method != "POST":
            return handler._json(405, {"ok": False, "message": "허용 안 됨"})
        if not auth_api.csrf_ok(handler):
            return handler._json(403, {"ok": False, "message": "요청 출처를 확인할 수 없습니다."})
        b = auth_api.body_json(handler)
        code, obj, hdr = E.login(handler, b.get("username"), b.get("password") or "")
        return handler._json(code, obj, headers=hdr)
    if not u:
        return handler._json(401, {"ok": False, "error": "no_session", "message": "로그인이 필요합니다."})
    if u.get("role") != "admin":
        return handler._json(403, {"ok": False, "message": "관리자만 할 수 있습니다."})
    if op == "emergency_alerts" and method == "GET":
        return handler._json(200, {"ok": True, "list": E.alerts(), "stored": E.count()})
    if op == "emergency_ack" and method == "POST":
        if not auth_api.csrf_ok(handler):
            return handler._json(403, {"ok": False, "message": "요청 출처를 확인할 수 없습니다."})
        b = auth_api.body_json(handler)
        n = E.ack(u["id"], str(b.get("id") or "") or None)
        logkit.audit("auth.emergency_ack", user=u["id"], count=n)
        return handler._json(200, {"ok": True, "acked": n})
    return handler._json(404, {"ok": False, "message": "없는 동작"})
