# -*- coding: utf-8 -*-
"""계정·세션·보안 정책(v92) — serve.py 가 api.php?r=auth&op=… 로 넘겨준다. DB 없음, 파일만.

<DATA_DIR>/system/
  users.json      계정 {schema, users:[User]}  — 비밀번호는 PBKDF2-SHA256(60만 회)+솔트 해시만
  sessions.json   세션 {schema, sessions:{sha256(토큰): Session}} — 토큰 원문은 어디에도 저장하지 않는다
  policy.json     보안 정책(관리자가 화면에서 바꿈)
  secret.key      저장 암호화용 마스터 키(32바이트) — AI 연결 키를 암호화해 둘 때 쓴다(llm_api)

User    = {id, username, display, role: admin|user, plan, status: active|locked,
           pw:{alg:"pbkdf2-sha256", iter, salt, hash}, default_pw, must_change,
           created, updated, last_login, last_ip, fails, lock_until, lock_level}
Session = {uid, created, expires, last_seen, ip, ua, remote}

보안 규칙
  · 세션 = HttpOnly + SameSite=Strict 쿠키(study_sid). 터널(https)로 오면 Secure 도 붙인다. 30일, 쓰면 연장.
  · 모든 쓰기(POST)는 X-Study-Vault: 1 헤더 + (있으면) Origin 이 같은 호스트여야 한다 → 다른 사이트가 몰래 보내는 요청(CSRF) 차단.
  · 비밀번호 5번 틀리면 5분 잠김(다시 틀리면 15분 → 1시간). IP 당 10분에 30번 시도까지.
  · 없는 아이디도 같은 시간만큼 해시를 계산해 '있는 아이디인지' 알 수 없게 한다.
  · 기본 비밀번호(초기 관리자) 계정은 **이 PC(127.0.0.1)에서만** 로그인된다 — 터널·LAN 으로는 비밀번호를 바꾼 뒤에만.
  · 새 비밀번호는 8자 이상, 아이디와 달라야 한다. 관리자가 정해 준 임시 비밀번호는 다음 로그인 때 바꾸게 한다.
"""
import safeio   # (v140) 정전 대비 쓰기(임시 파일 → fsync → 바꾸기)
import vfs      # noqa: E402  (v151) SQLite 엔진이면 데이터 폴더의 .json·.jsonl 은 DB — 아래 open·exists 등은 vfs 판
open = vfs.open  # noqa: A001
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import time

import logkit

PBKDF2_ITER = 600_000
SESSION_TTL = 30 * 24 * 3600
MAX_SESSIONS_PER_USER = 12
LOCK_STEPS = [5 * 60, 15 * 60, 60 * 60]
FAILS_BEFORE_LOCK = 5
IP_WINDOW, IP_MAX = 600, 30
COOKIE = "study_sid"
USERNAME_RE = re.compile(r"^[A-Za-z0-9가-힣_.\-]{2,24}$")
DEFAULT_POLICY = {
    "schema": 1,
    "allow_signup": False,            # 스스로 가입(끄면 관리자가 만들어 준 계정만)
    "remote_default_pw": False,       # 기본 비밀번호 계정의 원격(터널·LAN) 로그인 허용 — 권장: 끔
    "min_password": 8,
    "session_days": 30,
    "user_llm_private_hosts": False,  # 일반 사용자가 사설망·localhost 주소의 AI 서버를 등록할 수 있나(SSRF 방지) — 관리자는 늘 가능
    "user_llm_profiles": True,        # 일반 사용자가 자기 AI 연결을 등록할 수 있나(끄면 관리자가 공유한 것만)
}
_lock = threading.RLock()


LOGIN_GUARD = []        # (v135) 통합로그인 모드: fn(user) → None | (코드, 메시지). 로컬 비밀번호 로그인 전에 묻는다
ON_LOGOUT_SESSION = []  # (v135) 로그아웃한 세션 기록을 받는다(통합로그인 토큰 정리)


# (v143) 계정별 기능(모드) 권한 — 연구지원·자료 학습. 관리자는 전부.
#   통합로그인 계정은 ulogin 이 보낸 값(sso.modes)이 먼저, 없으면 이 시스템 관리자가 정한 값(modes), 둘 다 없으면 전부.
FEATURES = ("research", "library")
FEATURE_ALIAS = {"research": "research", "연구지원": "research", "library": "library", "자료학습": "library", "자료 학습": "library"}


def features_of(u):
    if not u:
        return []
    if u.get("role") == "admin":
        return list(FEATURES)
    s = u.get("sso") or {}
    src = s.get("modes") if s.get("uuid") and isinstance(s.get("modes"), list) else u.get("modes") if isinstance(u.get("modes"), list) else None
    return list(FEATURES) if src is None else [m for m in FEATURES if m in src]


def features_source(u):
    s = (u or {}).get("sso") or {}
    if (u or {}).get("role") == "admin":
        return "admin"
    return "ulogin" if s.get("uuid") and isinstance(s.get("modes"), list) else "local"


def parse_features(v):
    """ulogin 등에서 받은 값 → 기능 목록 | None(값 없음). ['research', …] · {research:true,…} · '연구지원,자료학습' 모두 받는다."""
    if v is None:
        return None
    if isinstance(v, str):
        v = [x.strip() for x in v.split(",")]
    if isinstance(v, dict):
        v = [k for k, on in v.items() if on]
    if not isinstance(v, list):
        return None
    out = []
    for x in v:
        m = FEATURE_ALIAS.get(str(x).strip().lower()) or FEATURE_ALIAS.get(str(x).strip())
        if m and m not in out:
            out.append(m)
    return [m for m in FEATURES if m in out]


def _guard(u):
    for fn in LOGIN_GUARD:
        r = fn(u)
        if r:
            return r
    return None


def _now():
    return int(time.time())


def _b64(b):
    return base64.b64encode(b).decode("ascii")


def _unb64(s):
    return base64.b64decode(s.encode("ascii"))


def _atomic_json(path, obj):
    safeio.atomic_json(path, obj, indent=1)


def _read_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


def hash_password(pw, salt=None, iter_=PBKDF2_ITER):
    salt = salt or secrets.token_bytes(16)
    h = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt, iter_)
    return {"alg": "pbkdf2-sha256", "iter": iter_, "salt": _b64(salt), "hash": _b64(h)}


def verify_password(pw, rec):
    if isinstance(rec, dict) and rec.get("alg") == "bcrypt":      # (v179) 비상용 관리자 — bcrypt
        try:
            import bcrypt
            return bcrypt.checkpw(_bc_pre(pw), str(rec.get("hash") or "").encode("ascii"))
        except Exception:
            return False
    try:
        h = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), _unb64(rec["salt"]), int(rec["iter"]))
        return hmac.compare_digest(h, _unb64(rec["hash"]))
    except Exception:
        return False


_DUMMY = hash_password("timing-equalizer")

# (v179) 비상용 관리자 계정 local-admin/1(사용자 지시 2026-11-16) — 아이디 admin, 이 시스템 로컬 계정, 통합로그인과 묶지 않음.
#   통합로그인 모드와 상관없이 언제나 로컬 로그인(이 계정만 예외), 서버 PC·공개 도메인 어디서나.
#   비밀번호는 사용자가 서버 PC 에서만 정한다(127.0.0.1 화면 /local-admin 또는 python tools/local_admin.py). 처음은 미설정 = 로그인 불가.
#   해시는 bcrypt(sha256 먼저 — bcrypt 72바이트 한계). 실패 횟수 제한·잠금은 그대로. 값은 코드·문서·로그에 남기지 않는다.
BG_USER = "admin"
BG_UNSET = "!bg-unset"
BG_MIN = 12


def _bc_pre(pw):
    return base64.b64encode(hashlib.sha256(str(pw).encode("utf-8")).digest())


def hash_bcrypt(pw):
    import bcrypt
    return {"alg": "bcrypt", "hash": bcrypt.hashpw(_bc_pre(pw), bcrypt.gensalt(12)).decode("ascii")}


def is_breakglass(u):
    return bool(u) and u.get("breakglass") is True and str(u.get("username") or "").lower() == BG_USER


def bg_state(u):
    return "set" if isinstance((u or {}).get("pw"), dict) and u["pw"].get("alg") == "bcrypt" else "unset"


BG_DENY = "비상용 관리자 계정(admin)은 서버 PC 에서만 바꿀 수 있어요: http://127.0.0.1:<포트>/local-admin 또는 python tools/local_admin.py"

# (v156) 통합로그인 완전 이관(사용자 지시 2026-11-11) — 묶인 계정은 로컬 비밀번호·로그인 경로를 지운다.
#   비밀번호 칸을 비우지 않고 검증되지 않는 표식을 넣는다(빈 값을 '첫 로그인 기본 비밀번호'처럼 읽는 경로가 생기지 않게).
#   verify_password 는 salt·hash 가 없어 늘 False. 해제(unlinked)돼도 비밀번호는 되살리지 않는다 — 관리자 [비번 초기화]나 서버 PC 비상 복구로만.
MIGRATED = "!sso-migrated"
MSG_MIGRATED = "통합로그인으로 이관된 계정입니다. 통합로그인으로 로그인하세요."
MSG_UNLINKED = "통합로그인 연결이 해제된 계정입니다. 관리자에게 비밀번호 재설정을 요청하세요."


def is_migrated(u):
    return isinstance((u or {}).get("pw"), dict) and u["pw"].get("alg") == MIGRATED


def migrate_local(u):
    """로컬 계정 dict 를 이관 상태로(제자리 수정). 이미 이관됐으면 False. (v179) 비상용 관리자는 이관하지 않는다."""
    if is_migrated(u) or is_breakglass(u):
        return False
    u["pw"] = {"alg": MIGRATED, "at": _now()}
    u.update(local_login=False, default_pw=False, must_change=False, migrated=_now(), fails=0, lock_until=0, lock_level=0)
    return True


# ---------------------------------------------------------------------------
# 요청 정보(원격 여부·실제 IP)
# ---------------------------------------------------------------------------
def _loopback(ip):
    return ip in ("127.0.0.1", "::1", "localhost") or ip.startswith("127.")


def client_ip(handler):
    """프록시(클라우드플레어 터널)는 이 PC 의 cloudflared 가 127.0.0.1 로 붙는다 → 그때만 전달 헤더를 믿는다."""
    peer = handler.client_address[0]
    if _loopback(peer):
        fwd = handler.headers.get("Cf-Connecting-Ip") or (handler.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
        if fwd:
            return fwd[:64]
    return peer


def is_remote(handler):
    peer = handler.client_address[0]
    if not _loopback(peer):
        return True
    return bool(handler.headers.get("Cf-Connecting-Ip") or handler.headers.get("Cf-Ray") or handler.headers.get("X-Forwarded-For"))


def is_https(handler):
    return (handler.headers.get("X-Forwarded-Proto") or "").lower() == "https" or '"https"' in (handler.headers.get("Cf-Visitor") or "")


def same_origin_ok(handler):
    """POST 의 Origin/Referer 가 있으면 Host 와 같아야 한다(없으면 커스텀 헤더 검사로 충분)."""
    host = (handler.headers.get("X-Forwarded-Host") or handler.headers.get("Host") or "").lower()
    o = handler.headers.get("Origin") or ""
    if not o or o == "null":
        return True
    o = re.sub(r"^https?://", "", o.lower()).rstrip("/")
    return o == host


def csrf_ok(handler):
    return handler.headers.get("X-Study-Vault") == "1" and same_origin_ok(handler)


# ---------------------------------------------------------------------------
# 저장소
# ---------------------------------------------------------------------------
class AuthStore:
    def __init__(self, data_dir, seed_admin=("admin", "1234")):
        vfs.ensure(data_dir)        # (v151) 명령 도구(런처 계정 복구 등)도 같은 저장 엔진
        self.sysdir = os.path.join(data_dir, "system")
        os.makedirs(self.sysdir, exist_ok=True)
        self.f_users = os.path.join(self.sysdir, "users.json")
        self.f_sess = os.path.join(self.sysdir, "sessions.json")
        self.f_policy = os.path.join(self.sysdir, "policy.json")
        self._ip_hits = {}
        self._sess_dirty = 0
        with _lock:
            st = self._users()
            if not st["users"] and seed_admin:
                u = self._new_user(seed_admin[0], seed_admin[1], role="admin", plan="ultra")
                u["default_pw"] = True
                st["users"].append(u)
                self._save_users(st)
                logkit.audit("seed_admin", user=u["id"], username=u["username"], note="초기 관리자 — 기본 비밀번호는 이 PC 에서만 로그인")

    # ---- 파일 ----
    def _users(self):
        st = _read_json(self.f_users, None)
        if not isinstance(st, dict) or not isinstance(st.get("users"), list):
            st = {"schema": 1, "users": []}
        return st

    def _save_users(self, st):
        _atomic_json(self.f_users, st)

    def _sessions(self):
        st = _read_json(self.f_sess, None)
        if not isinstance(st, dict) or not isinstance(st.get("sessions"), dict):
            st = {"schema": 1, "sessions": {}}
        return st

    def _save_sessions(self, st):
        now = _now()
        st["sessions"] = {k: v for k, v in st["sessions"].items() if v.get("expires", 0) > now}
        _atomic_json(self.f_sess, st)

    def policy(self):
        p = dict(DEFAULT_POLICY)
        p.update({k: v for k, v in (_read_json(self.f_policy, {}) or {}).items() if k in DEFAULT_POLICY})
        return p

    def set_policy(self, patch):
        p = self.policy()
        for k, v in (patch or {}).items():
            if k in DEFAULT_POLICY and k != "schema" and type(v) is type(DEFAULT_POLICY[k]):
                p[k] = v
        p["min_password"] = max(6, min(64, int(p["min_password"])))
        p["session_days"] = max(1, min(365, int(p["session_days"])))
        _atomic_json(self.f_policy, p)
        return p

    # ---- 계정 ----
    @staticmethod
    def public(u):
        if not u:
            return None
        return {"id": u["id"], "username": u["username"], "display": u.get("display") or u["username"], "role": u.get("role", "user"),
                "sso": bool((u.get("sso") or {}).get("uuid")), "sso_name": (u.get("sso") or {}).get("username") or "", "local_login": u.get("local_login") is not False,
                "plan": u.get("plan", "free"), "status": u.get("status", "active"), "default_pw": bool(u.get("default_pw")), "migrated": is_migrated(u),
                "must_change": bool(u.get("must_change")), "created": u.get("created"), "last_login": u.get("last_login"),
                "last_ip": u.get("last_ip"), "locked_until": u.get("lock_until") if (u.get("lock_until") or 0) > _now() else None,
                "modes": features_of(u), "modes_src": features_source(u), "modes_local": u.get("modes") if isinstance(u.get("modes"), list) else None,
                **({"emergency": True, "emergency_until": u.get("emergency_until")} if u.get("emergency") else {})}

    def _new_user(self, username, password, role="user", plan="free"):
        t = _now()
        return {"id": "u" + secrets.token_hex(6), "username": username, "display": username, "role": role, "plan": plan, "status": "active",
                "pw": hash_password(password), "default_pw": False, "must_change": False, "created": t, "updated": t,
                "last_login": None, "last_ip": None, "fails": 0, "lock_until": 0, "lock_level": 0}

    def find(self, username=None, uid=None):
        st = self._users()
        for u in st["users"]:
            if uid and u["id"] == uid:
                return u
            if username and u["username"].lower() == str(username).strip().lower():
                return u
        return None

    def list_users(self):
        return [self.public(u) for u in self._users()["users"]]

    def check_new_password(self, username, pw):
        p = self.policy()
        if len(pw) < p["min_password"]:
            return "비밀번호는 %d자 이상으로 해 주세요." % p["min_password"]
        if pw.lower() == str(username).lower():
            return "아이디와 같은 비밀번호는 쓸 수 없어요."
        if pw in ("12345678", "password", "11111111", "00000000", "qwerty12", "123456789"):
            return "너무 흔한 비밀번호예요."
        return None

    def create_user(self, username, password, role="user", plan="free", by=None, temp=True):
        username = str(username or "").strip()
        if not USERNAME_RE.match(username):
            return None, "아이디는 2~24자(한글·영문·숫자·_ . -)로 해 주세요."
        err = self.check_new_password(username, password)
        if err:
            return None, err
        with _lock:
            st = self._users()
            if any(u["username"].lower() == username.lower() for u in st["users"]):
                return None, "이미 있는 아이디예요."
            u = self._new_user(username, password, role="admin" if role == "admin" else "user", plan=plan or "free")
            u["must_change"] = bool(temp and by)
            st["users"].append(u)
            self._save_users(st)
        return self.public(u), None

    def update_user(self, uid, patch, by=None):
        """관리자용: role · plan · status(active/locked) · display · 비밀번호 초기화(reset_password)."""
        with _lock:
            st = self._users()
            u = next((x for x in st["users"] if x["id"] == uid), None)
            if not u:
                return None, "없는 계정이에요."
            if is_breakglass(u) and (patch.get("reset_password") or patch.get("role", "admin") != "admin"):
                return None, BG_DENY
            if "role" in patch and patch["role"] in ("admin", "user"):
                if u.get("role") == "admin" and patch["role"] != "admin" and sum(1 for x in st["users"] if x.get("role") == "admin" and x.get("status") != "locked") <= 1:
                    return None, "마지막 관리자는 일반 사용자로 바꿀 수 없어요."
                u["role"] = patch["role"]
            if "plan" in patch and patch["plan"] in ("free", "pro", "ultra"):
                u["plan"] = patch["plan"]
            if "display" in patch:
                u["display"] = str(patch["display"] or "")[:40] or u["username"]
            if "modes" in patch:            # (v143) 기능 권한 — 하나 이상
                ms = parse_features(patch["modes"])
                if not ms:
                    return None, "기능을 하나 이상 골라 주세요."
                u["modes"] = ms
            if "status" in patch and patch["status"] in ("active", "locked"):
                if uid == by and patch["status"] == "locked":
                    return None, "자기 계정은 잠글 수 없어요."
                u["status"] = patch["status"]
                if patch["status"] == "active":
                    u["fails"] = 0; u["lock_until"] = 0; u["lock_level"] = 0
            if patch.get("reset_password") and is_migrated(u) and (u.get("sso") or {}).get("uuid"):
                return None, "통합로그인으로 이관된 계정은 비밀번호를 통합로그인에서 관리합니다. 비상 복구는 서버 PC 에서 python tools/sso_release.py <아이디>"
            if patch.get("reset_password"):
                err = self.check_new_password(u["username"], patch["reset_password"])
                if err:
                    return None, err
                u["pw"] = hash_password(patch["reset_password"]); u["default_pw"] = False; u["must_change"] = True; u["local_login"] = True; u.pop("migrated", None)
                u["fails"] = 0; u["lock_until"] = 0
            u["updated"] = _now()
            self._save_users(st)
        if patch.get("reset_password") or patch.get("status") == "locked":
            self.revoke_user_sessions(uid)
        return self.public(u), None

    def delete_user(self, uid, by=None):
        with _lock:
            st = self._users()
            u = next((x for x in st["users"] if x["id"] == uid), None)
            if not u:
                return False, "없는 계정이에요."
            if uid == by:
                return False, "자기 계정은 지울 수 없어요."
            if is_breakglass(u):
                return False, BG_DENY
            if u.get("role") == "admin" and sum(1 for x in st["users"] if x.get("role") == "admin") <= 1:
                return False, "마지막 관리자는 지울 수 없어요."
            st["users"] = [x for x in st["users"] if x["id"] != uid]
            self._save_users(st)
        self.revoke_user_sessions(uid)
        return True, None   # 사용자 폴더(users/<id>)는 지우지 않는다 — 데이터 보존(관리자가 직접 정리)

    # ---- (v179) 비상용 관리자 local-admin/1 — 서버 PC 에서만 부른다(화면 /local-admin 은 serve.py 가 터널·외부 요청을 막는다) ----
    def ensure_breakglass(self):
        """admin 계정을 비상용으로 맞춘다. 없으면 만들고(미설정), 있으면 그 계정을 쓴다.
        처음 비상용으로 바꿀 때 예전 비밀번호는 쓰지 않게 미설정으로 두고(사용자가 서버 PC 에서 새로 정함) 통합로그인 묶음을 푼다."""
        with _lock:
            st = self._users()
            u = next((x for x in st["users"] if x["username"].lower() == BG_USER), None)
            created = changed = False
            if not u:
                t = _now()
                u = {"id": "u" + secrets.token_hex(6), "username": BG_USER, "display": BG_USER, "role": "admin", "plan": "ultra", "status": "active",
                     "pw": {"alg": BG_UNSET, "at": t}, "default_pw": False, "must_change": False, "created": t, "updated": t,
                     "last_login": None, "last_ip": None, "fails": 0, "lock_until": 0, "lock_level": 0}
                st["users"].append(u)
                created = True
            if not u.get("breakglass"):
                u["breakglass"] = True
                if bg_state(u) != "set":
                    u["pw"] = {"alg": BG_UNSET, "at": _now()}
                changed = True
            if u.get("role") != "admin" or u.get("sso") or u.get("local_login") is False or u.get("migrated") or u.get("default_pw") or u.get("must_change"):
                u["role"] = "admin"
                u.pop("sso", None); u.pop("migrated", None)
                u.update(local_login=True, default_pw=False, must_change=False)
                changed = True
            if created or changed:
                u["updated"] = _now()
                self._save_users(st)
        if changed and not created:
            self.revoke_user_sessions(u["id"])
        if created or changed:
            logkit.audit("breakglass_init", user=u["id"], created=created, state=bg_state(u))
        return u

    def bg_status(self):
        u = self.find(username=BG_USER)
        return {"exists": bool(u), "breakglass": is_breakglass(u), "state": bg_state(u) if u else "none",
                "locked": bool(u and ((u.get("lock_until") or 0) > _now() or u.get("status") == "locked"))}

    def bg_set(self, new, via):
        """비밀번호를 정한다(또는 바꾼다). → None | 오류 문구. 값은 어디에도 남기지 않는다."""
        if len(str(new or "")) < BG_MIN:
            return "비상용 관리자 비밀번호는 %d자 이상으로 해 주세요." % BG_MIN
        err = self.check_new_password(BG_USER, new)
        if err:
            return err
        with _lock:
            st = self._users()
            u = next((x for x in st["users"] if x["username"].lower() == BG_USER), None)
            if not is_breakglass(u):
                return "비상용 관리자 계정이 아직 없어요. 서버를 다시 시작하세요."
            u["pw"] = hash_bcrypt(new)
            u.update(fails=0, lock_until=0, lock_level=0, status="active", default_pw=False, must_change=False, local_login=True, updated=_now(), bg_set=_now())
            self._save_users(st)
        self.revoke_user_sessions(u["id"])
        logkit.audit("breakglass_password_set", user=u["id"], via=via)
        logkit.warn("security", "비상용 관리자(admin) 비밀번호를 정함", via=via)
        return None

    def bg_reset(self, via):
        """미설정으로 되돌린다(로그인 불가). 세션도 끝낸다."""
        with _lock:
            st = self._users()
            u = next((x for x in st["users"] if x["username"].lower() == BG_USER), None)
            if not is_breakglass(u):
                return "비상용 관리자 계정이 아직 없어요."
            u["pw"] = {"alg": BG_UNSET, "at": _now()}
            u.update(fails=0, lock_until=0, lock_level=0, updated=_now())
            self._save_users(st)
        self.revoke_user_sessions(u["id"])
        logkit.audit("breakglass_password_reset", user=u["id"], via=via)
        logkit.warn("security", "비상용 관리자(admin) 비밀번호를 미설정으로 되돌림", via=via)
        return None

    def change_password(self, uid, current, new):
        with _lock:
            st = self._users()
            u = next((x for x in st["users"] if x["id"] == uid), None)
            if not u:
                return "없는 계정이에요."
            if is_breakglass(u):
                return BG_DENY
            if not verify_password(current, u["pw"]):
                return "지금 비밀번호가 맞지 않아요."
            if current == new:
                return "지금과 다른 비밀번호로 해 주세요."
            err = self.check_new_password(u["username"], new)
            if err:
                return err
            u["pw"] = hash_password(new); u["default_pw"] = False; u["must_change"] = False; u["updated"] = _now()
            self._save_users(st)
        return None

    # ---- 로그인 ----
    def _ip_limited(self, ip):
        now = time.time()
        with _lock:
            lst = [t for t in self._ip_hits.get(ip, []) if now - t < IP_WINDOW]
            lst.append(now)
            self._ip_hits[ip] = lst
            return len(lst) > IP_MAX

    def login(self, username, password, ip, ua, remote):
        """→ (토큰, public user, None) | (None, None, (코드, 메시지))"""
        if self._ip_limited(ip):
            logkit.audit("login_rate_limited", ok=False, ip=ip, username=username)
            return None, None, ("rate", "시도가 너무 많아요. 10분 뒤에 다시 해 주세요.")
        with _lock:
            st = self._users()
            u = next((x for x in st["users"] if x["username"].lower() == str(username).strip().lower()), None)
            if not u:
                verify_password(password, _DUMMY)          # 시간 맞추기
                logkit.audit("login_fail", ok=False, ip=ip, username=username, reason="no_user")
                return None, None, ("bad", "아이디 또는 비밀번호가 올바르지 않습니다.")
            now = _now()
            if is_migrated(u):                              # (v156) 모드(off 포함)와 상관없이 로컬 로그인 거절
                verify_password(password, _DUMMY)          # 시간 맞추기
                linked = bool((u.get("sso") or {}).get("uuid"))
                logkit.audit("login_fail", ok=False, ip=ip, user=u["id"], reason="sso_migrated" if linked else "sso_unlinked")
                return None, None, ("sso_migrated", MSG_MIGRATED) if linked else ("sso_unlinked", MSG_UNLINKED)
            bg = is_breakglass(u)
            g = None if bg else _guard(u)                  # (v179) 비상용 관리자는 통합로그인 모드와 상관없이
            if g:
                logkit.audit("login_fail", ok=False, ip=ip, user=u["id"], reason=g[0])
                return None, None, g
            if bg and bg_state(u) != "set":                # 비밀번호 미설정 — 로그인 불가(같은 문구)
                verify_password(password, _DUMMY)
                logkit.audit("login_fail", ok=False, ip=ip, user=u["id"], reason="breakglass_unset", breakglass=True)
                return None, None, ("bad", "아이디 또는 비밀번호가 올바르지 않습니다.")
            if u.get("status") == "locked":
                logkit.audit("login_fail", ok=False, ip=ip, user=u["id"], reason="account_locked")
                return None, None, ("locked", "관리자가 잠근 계정이에요. 관리자에게 문의하세요.")
            if (u.get("lock_until") or 0) > now:
                left = (u["lock_until"] - now + 59) // 60
                logkit.audit("login_fail", ok=False, ip=ip, user=u["id"], reason="temp_locked")
                return None, None, ("locked", "비밀번호를 여러 번 틀려 잠겼어요. %d분 뒤에 다시 해 주세요." % left)
            if not verify_password(password, u["pw"]):
                u["fails"] = int(u.get("fails") or 0) + 1
                msg = "아이디 또는 비밀번호가 올바르지 않습니다."
                if u["fails"] >= FAILS_BEFORE_LOCK:
                    lvl = min(int(u.get("lock_level") or 0), len(LOCK_STEPS) - 1)
                    u["lock_until"] = now + LOCK_STEPS[lvl]; u["lock_level"] = lvl + 1; u["fails"] = 0
                    msg = "비밀번호를 %d번 틀려 %d분 동안 잠겼어요." % (FAILS_BEFORE_LOCK, LOCK_STEPS[lvl] // 60)
                    logkit.audit("lockout", ok=False, ip=ip, user=u["id"], minutes=LOCK_STEPS[lvl] // 60)
                try:
                    self._save_users(st)
                except safeio.ReadOnly:      # (v140) 데이터 점검으로 저장이 멈춘 동안에도 로그인은 된다(기록만 못 남김)
                    pass
                logkit.audit("login_fail", ok=False, ip=ip, user=u["id"], reason="bad_password", fails=u["fails"])
                return None, None, ("bad", msg)
            if remote and u.get("default_pw") and not self.policy()["remote_default_pw"]:
                logkit.audit("login_fail", ok=False, ip=ip, user=u["id"], reason="default_pw_remote")
                return None, None, ("default_pw", "초기 비밀번호 계정은 이 PC 에서만 로그인할 수 있어요. 서버 PC 에서 로그인해 [계정·보안]에서 비밀번호를 바꾼 뒤 다시 오세요.")
            if u.get("pw", {}).get("alg") != "bcrypt" and u.get("pw", {}).get("iter", 0) < PBKDF2_ITER:      # 예전 반복 수 → 로그인할 때 강화
                u["pw"] = hash_password(password)
            u["fails"] = 0; u["lock_until"] = 0; u["lock_level"] = 0
            u["last_login"] = now; u["last_ip"] = ip
            try:
                self._save_users(st)
            except safeio.ReadOnly:
                pass
        tok, _days = self.issue_session(u, ip, ua, remote)
        logkit.audit("login", ip=ip, user=u["id"], username=u["username"], remote=bool(remote), **({"breakglass": True} if is_breakglass(u) else {}))
        if is_breakglass(u):     # (v179) 관리자 경보 — 경고 이상은 통합로그인 로그로도 간다
            logkit.warn("security", "비상용 관리자(admin) 로그인", ip=ip, remote=bool(remote))
        return tok, self.public(u), None

    def issue_session(self, u, ip, ua, remote=False, extra=None):
        """세션을 새로 만든다 → (토큰, 일수). 로그인과 계정 연동 자동 로그인이 함께 쓴다."""
        now = _now()
        tok = secrets.token_urlsafe(32)
        days = self.policy()["session_days"]
        with _lock:
            ss = self._sessions()
            mine = sorted(((k, v) for k, v in ss["sessions"].items() if v.get("uid") == u["id"]), key=lambda kv: kv[1].get("last_seen", 0))
            for k, _v in mine[:max(0, len(mine) - MAX_SESSIONS_PER_USER + 1)]:
                ss["sessions"].pop(k, None)
            ss["sessions"][self._h(tok)] = {"uid": u["id"], "created": now, "expires": now + days * 86400, "last_seen": now, "ip": ip, "ua": (ua or "")[:160], "remote": bool(remote)}
            if extra:
                ss["sessions"][self._h(tok)].update({k: v for k, v in extra.items() if v is not None})
                if extra.get("cap"):          # (v169) 비상 세션: 최대 8시간 — 늘리지 않는다
                    ss["sessions"][self._h(tok)]["expires"] = min(ss["sessions"][self._h(tok)]["expires"], int(extra["cap"]))
            self._save_sessions(ss)
        return tok, days

    @staticmethod
    def _h(tok):
        return hashlib.sha256(tok.encode("utf-8")).hexdigest()

    def session_user(self, tok, ip=None):
        """쿠키 토큰 → User(dict, 내부용) | None. 하루에 한 번 정도 last_seen·만료를 늘린다."""
        if not tok or len(tok) > 200:
            return None, None
        h = self._h(tok)
        with _lock:
            ss = self._sessions()
            s = ss["sessions"].get(h)
            now = _now()
            if not s or s.get("expires", 0) < now:
                return None, None
            u = self.find(uid=s["uid"])
            if not u or u.get("status") == "locked":
                return None, None
            if now - s.get("last_seen", 0) > 3600:
                s["last_seen"] = now; s["expires"] = min(now + self.policy()["session_days"] * 86400, s.get("cap") or 10 ** 12)
                if ip:
                    s["ip"] = ip
                self._save_sessions(ss)
            if s.get("emergency"):           # (v169) 비상 세션 표시 — serve 가 역할·복구 확인에 쓴다(사본에만)
                u = dict(u, _emg={"emg_uuid": s.get("emg_uuid"), "emg_rank": s.get("emg_rank"), "cap": s.get("cap")})
            return u, h

    def session_rec(self, h):
        """(v141) 세션 해시 → 세션 기록 사본 | None"""
        s = self._sessions()["sessions"].get(h or "")
        return dict(s) if isinstance(s, dict) else None

    def update_session(self, h, patch):
        """(v141) 세션 기록 일부를 바꾼다(통합로그인 토큰 회전). None 값은 지운다"""
        with _lock:
            ss = self._sessions()
            s = ss["sessions"].get(h or "")
            if not isinstance(s, dict):
                return False
            for k, v in patch.items():
                if v is None:
                    s.pop(k, None)
                else:
                    s[k] = v
            self._save_sessions(ss)
        return True

    def drop_session(self, h):
        """(v141) 세션 하나를 끊는다(통합로그인에서 권한이 빠졌을 때). 다음 요청은 401"""
        with _lock:
            ss = self._sessions()
            s = ss["sessions"].pop(h or "", None)
            if s is not None:
                self._save_sessions(ss)
        return s

    def logout(self, tok):
        with _lock:
            ss = self._sessions()
            s = ss["sessions"].pop(self._h(tok or ""), None)
            self._save_sessions(ss)
        return s

    def user_sessions(self, uid, cur_h=None):
        ss = self._sessions()
        out = []
        for k, v in ss["sessions"].items():
            if v.get("uid") == uid and v.get("expires", 0) > _now():
                out.append({"key": k[:12], "current": k == cur_h, "created": v.get("created"), "last_seen": v.get("last_seen"), "ip": v.get("ip"), "ua": v.get("ua"), "remote": v.get("remote")})
        return sorted(out, key=lambda x: -(x["last_seen"] or 0))

    def revoke_session(self, uid, key_prefix):
        with _lock:
            ss = self._sessions()
            ks = [k for k, v in ss["sessions"].items() if v.get("uid") == uid and k.startswith(key_prefix or "-")]
            for k in ks:
                ss["sessions"].pop(k, None)
            self._save_sessions(ss)
        return len(ks)

    def revoke_local_sessions(self, uid):
        """(v156) 이관할 때 — 비밀번호로 들어온 세션만 끝낸다(통합로그인 세션 via=sso·계정 연동 세션은 둔다)."""
        with _lock:
            ss = self._sessions()
            ks = [k for k, v in ss["sessions"].items() if v.get("uid") == uid and not v.get("via")]
            for k in ks:
                ss["sessions"].pop(k, None)
            if ks:
                self._save_sessions(ss)
        return len(ks)

    def revoke_user_sessions(self, uid, except_h=None):
        with _lock:
            ss = self._sessions()
            ks = [k for k, v in ss["sessions"].items() if v.get("uid") == uid and k != except_h]
            for k in ks:
                ss["sessions"].pop(k, None)
            self._save_sessions(ss)
        return len(ks)

    def stats(self):
        st = self._users()
        ss = self._sessions()
        now = _now()
        return {"users": len(st["users"]), "admins": sum(1 for u in st["users"] if u.get("role") == "admin"),
                "sessions": sum(1 for v in ss["sessions"].values() if v.get("expires", 0) > now),
                "default_pw": any(u.get("default_pw") for u in st["users"])}


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------
ON_LOGOUT = []


def read_cookie(handler, name=COOKIE):
    raw = handler.headers.get("Cookie") or ""
    for part in raw.split(";"):
        k, _, v = part.strip().partition("=")
        if k == name:
            return v
    return None


def cookie_header(handler, tok, max_age):
    c = "%s=%s; Path=/; HttpOnly; SameSite=Strict; Max-Age=%d" % (COOKIE, tok, max_age)
    if is_https(handler):
        c += "; Secure"
    return c


def body_json(handler, limit=64 * 1024):
    n = int(handler.headers.get("Content-Length") or 0)
    if n <= 0 or n > limit:
        return {}
    try:
        v = json.loads(handler.rfile.read(n).decode("utf-8", "replace"))
        return v if isinstance(v, dict) else {}
    except ValueError:
        return {}


def handle(store, handler, q, method):
    g = lambda k, d="": (q.get(k) or [d])[0]
    op = g("op")
    ip = client_ip(handler)
    remote = is_remote(handler)
    user = getattr(handler, "auth_user", None)
    cur_h = getattr(handler, "auth_hash", None)

    if method == "GET":
        if op == "status":
            pol = store.policy()
            if getattr(handler, "_emg_notice", None):      # (v169) 통합로그인이 복구돼 비상 세션이 끝났다
                return handler._json(200, {"ok": True, "auth": True, "user": None, "remote": remote, "notice": handler._emg_notice,
                                           "policy": {"allow_signup": False, "min_password": store.policy()["min_password"], "user_llm_profiles": store.policy()["user_llm_profiles"]}})
            return handler._json(200, {"ok": True, "auth": True, "user": store.public(user), "remote": remote,
                                       "policy": {"allow_signup": pol["allow_signup"], "min_password": pol["min_password"], "user_llm_profiles": pol["user_llm_profiles"]}})
        if not user:
            return handler._json(401, {"ok": False, "error": "no_session", "message": "로그인이 필요해요."})
        if op == "sessions":
            return handler._json(200, {"ok": True, "list": store.user_sessions(user["id"], cur_h)})
        if op == "myaudit":
            rows = [r for r in logkit.tail("audit", 400) if r.get("user") == user["id"]][:80]
            return handler._json(200, {"ok": True, "list": rows})
        if user.get("role") != "admin":
            return handler._json(403, {"ok": False, "message": "관리자만 볼 수 있어요."})
        if op == "users":
            return handler._json(200, {"ok": True, "list": store.list_users(), "stats": store.stats()})
        if op == "policy":
            return handler._json(200, {"ok": True, "policy": store.policy()})
        if op == "logs":
            name = g("file", "server")
            return handler._json(200, {"ok": True, "list": logkit.tail(name, min(1000, int(g("lines", "200") or 200)), g("level") or None, g("q") or None, user=g("user") or None, day=g("day") or None)})
        return handler._json(404, {"ok": False, "message": "없는 동작"})

    if method != "POST":
        return handler._json(405, {"ok": False, "message": "허용 안 됨"})
    if not csrf_ok(handler):
        logkit.warn("security", "CSRF 차단(헤더/출처 불일치)", ip=ip, op=op, origin=handler.headers.get("Origin"))
        return handler._json(403, {"ok": False, "message": "요청 출처를 확인할 수 없어요."})
    b = body_json(handler)

    if op == "login":
        tok, pu, err = store.login(b.get("username") or "", b.get("password") or "", ip, handler.headers.get("User-Agent"), remote)
        if err:
            return handler._json(429 if err[0] == "rate" else 401, {"ok": False, "error": err[0], "message": err[1]})
        days = store.policy()["session_days"]
        return handler._json(200, {"ok": True, "user": pu}, headers=[("Set-Cookie", cookie_header(handler, tok, days * 86400))])
    if op == "logout":
        tok = read_cookie(handler)
        s = store.logout(tok) if tok else None
        if s:
            logkit.audit("logout", ip=ip, user=s.get("uid"))
            for fn in ON_LOGOUT:      # (v120) 연동된 시스템도 끝낸다. 실패해도 로그아웃은 막지 않는다
                try:
                    fn(s.get("uid"))
                except Exception:
                    pass
            for fn in ON_LOGOUT_SESSION:
                try:
                    fn(s)
                except Exception:
                    pass
        return handler._json(200, {"ok": True}, headers=[("Set-Cookie", cookie_header(handler, "", 0))])
    if op == "signup":
        if not store.policy()["allow_signup"] or _guard({"role": "user"}):
            return handler._json(403, {"ok": False, "error": "signup_disabled", "message": "지금은 스스로 가입할 수 없어요. 관리자에게 계정을 요청하세요."})
        pu, err = store.create_user(b.get("username"), b.get("password") or "", by=None, temp=False)
        if err:
            return handler._json(400, {"ok": False, "message": err})
        logkit.audit("signup", ip=ip, user=pu["id"], username=pu["username"])
        tok, pu, err = store.login(pu["username"], b.get("password") or "", ip, handler.headers.get("User-Agent"), remote)
        return handler._json(200, {"ok": True, "user": pu}, headers=[("Set-Cookie", cookie_header(handler, tok, store.policy()["session_days"] * 86400))])

    if not user:
        return handler._json(401, {"ok": False, "error": "no_session", "message": "로그인이 필요해요."})
    if op == "password":
        err = store.change_password(user["id"], b.get("current") or "", b.get("new") or "")
        logkit.audit("password_change", ok=not err, ip=ip, user=user["id"], reason=err)
        if err:
            return handler._json(400, {"ok": False, "message": err})
        n = store.revoke_user_sessions(user["id"], except_h=cur_h)
        return handler._json(200, {"ok": True, "revoked": n, "user": store.public(store.find(uid=user["id"]))})
    if op == "revoke":
        if b.get("all"):
            n = store.revoke_user_sessions(user["id"], except_h=cur_h)
        else:
            n = store.revoke_session(user["id"], str(b.get("key") or ""))
        logkit.audit("session_revoke", ip=ip, user=user["id"], count=n)
        return handler._json(200, {"ok": True, "revoked": n})

    if user.get("role") != "admin":
        logkit.audit("admin_denied", ok=False, ip=ip, user=user["id"], op=op)
        return handler._json(403, {"ok": False, "message": "관리자만 할 수 있어요."})
    if op == "user_create":
        pu, err = store.create_user(b.get("username"), b.get("password") or "", role=b.get("role") or "user", plan=b.get("plan") or "free", by=user["id"])
        logkit.audit("user_create", ok=not err, ip=ip, user=user["id"], target=(pu or {}).get("id"), username=b.get("username"), role=b.get("role"), reason=err)
        return handler._json(200 if pu else 400, {"ok": bool(pu), "user": pu, "message": err})
    if op == "user_update":
        patch = {k: b[k] for k in ("role", "plan", "status", "display", "reset_password", "modes") if k in b}
        pu, err = store.update_user(str(b.get("id") or ""), patch, by=user["id"])
        logkit.audit("user_update", ok=not err, ip=ip, user=user["id"], target=b.get("id"), changed=sorted(k for k in patch if k != "reset_password") + (["password_reset"] if "reset_password" in patch else []), reason=err)
        return handler._json(200 if pu else 400, {"ok": bool(pu), "user": pu, "message": err})
    if op == "user_delete":
        ok, err = store.delete_user(str(b.get("id") or ""), by=user["id"])
        logkit.audit("user_delete", ok=ok, ip=ip, user=user["id"], target=b.get("id"), reason=err)
        return handler._json(200 if ok else 400, {"ok": ok, "message": err})
    if op == "policy":
        p = store.set_policy(b.get("policy") or {})
        logkit.audit("policy_change", ip=ip, user=user["id"], policy=p)
        return handler._json(200, {"ok": True, "policy": p})
    return handler._json(404, {"ok": False, "message": "없는 동작"})
