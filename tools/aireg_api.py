# -*- coding: utf-8 -*-
"""AI 관리시스템 연동 (ai-registry/1, RESEARCH-HUB 18장).

AI(LLM) 정보의 주인은 AI 관리시스템(aim)이다. 이 시스템은
  · 지금처럼 계정마다 등록한 자기 연결(u:·s:)로도 LLM 을 쓰고
  · AI 관리시스템이 그 사용자에게 허용한 프로필(a:<id>)로도 쓴다 — 호출은 AI 관리시스템 중계(POST /api/ai-registry/chat/{id}).
    키는 AI 관리시스템 밖으로 나오지 않는다(secret 경로는 쓰지 않는다).
권한 판정은 AI 관리시스템이 ulogin uuid 로 한다. 통합로그인과 연결되지 않은 로컬 계정은 받지 못한다.
AI 관리시스템이 꺼져 있으면(503·연결 안 됨) 자기 연결로 계속 동작한다.

설정: system/aireg.json {internal, token(암호화), updated}. 환경값 STUDY_AIM_INTERNAL·STUDY_AIM_TOKEN 이 먼저(시험 사본).
서비스 토큰은 handoff 파일로 받아 암호화해 두고 파일을 지운다. 브라우저·로그·화면에 내지 않는다.
"""
import safeio   # (v140) 정전 대비 쓰기(임시 파일 → fsync → 바꾸기)
import vfs      # noqa: E402  (v151) SQLite 엔진이면 데이터 폴더의 .json·.jsonl 은 DB — 아래 open·exists 등은 vfs 판
open = vfs.open  # noqa: A001
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request

import logkit
import portreg

SYSTEM = "slc"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
LIST_TIMEOUT = 3
LIST_TTL = 30
DOWN_SEC = 15
_lock = threading.RLock()
# 서비스 토큰 전달 파일(18.4): {"format":"aim-token/1","system":"slc","token":…,"aim":"http://127.0.0.1:17778","public":…,"issuedAt":…}
import hubdir  # noqa: E402  (v175) 규격 9장 공용 폴더 이동
HANDOFF = os.environ.get("STUDY_AIM_HANDOFF") or hubdir.file("aim-slc.json")


def _read(p, d=None):
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return d


def _write(p, obj):
    safeio.atomic_json(p, obj, indent=1)


class Unavailable(Exception):
    """AI 관리시스템이 꺼져 있거나 닿지 않음(연결 실패·시간 초과·5xx) — 비상 묶음(18.6) 또는 자기 연결로 계속 동작한다."""
    def __init__(self, msg="", status=0):
        Exception.__init__(self, msg)
        self.status = status


# (v169) 비상 AI emergency/1 2-2 — AI 관리시스템이 죽어도 이전에 쓰던 사람은 저장된 연결로 계속
EMG_EVERY = int(os.environ.get("STUDY_AIM_EMG_EVERY") or 3600)      # 묶음 받기 간격
EMG_TICK = int(os.environ.get("STUDY_AIM_EMG_TICK") or 300)
EMG_DELAY = int(os.environ.get("STUDY_AIM_EMG_DELAY") or 20)
EMG_RECENT = 30 * 86400                                              # 최근 30일 안에 쓴 사람만
EMG_NOTE = "비상 모드(AI 관리시스템 접속 불가) · 저장된 연결로 응답"


class Denied(Exception):
    """401·403·404 — 토큰·권한·프로필 문제. code = AI 관리가 준 error.code(있으면)."""
    def __init__(self, status, msg, code=""):
        Exception.__init__(self, msg)
        self.status = status
        self.code = str(code or "")


def user_unverified(e):
    """(v169, 계약 2-2 ⑥) 비상 로그인 세션에서 AI 관리가 '사람을 확인할 수 없다'고 준 403 인가.
    user_unknown·user_mismatch·사용자 토큰 검증 실패만 — 권한 거부(forbidden·그 프로필 권한 없음)는 아니다."""
    if not isinstance(e, Denied) or e.status != 403:
        return False
    c = e.code.lower()
    if c in ("user_unknown", "user_mismatch", "ulogin_user_not_found", "ulogin_user_unknown"):
        return True
    return "token" in c and "service" not in c and any(w in c for w in ("invalid", "expired", "verify", "verification", "unverified", "mismatch"))


class AiReg:
    def __init__(self, data_dir, box):
        self.ul_token = None      # (v167) fn(user) → 그 사용자의 통합로그인 access_token(serve 가 넣는다)
        self.f = os.path.join(data_dir, "system", "aireg.json")
        self.box = box
        self._cache = {}          # uuid -> (t, [profile])
        self._down = 0.0
        self.dir = data_dir
        self.f_emg = os.path.join(data_dir, "system", "aim_emergency.json")       # 봉인한 비상 AI 묶음(키 포함 — 봉인 해제는 서버 메모리에서만)
        self.f_use = os.path.join(data_dir, "system", "aim_emergency_use.json")   # (uuid, profileId, lastUsedAt)
        self._use_mem = {}
        self.auto = False          # start() 뒤에만 중계 성공 때 묶음을 다시 받는다
        self._fetching = False

    # ---- 설정 ----
    def conf(self):
        c = _read(self.f, {}) or {}
        ins = os.environ.get("STUDY_AIM_INTERNAL") or portreg.fix_loopback(c.get("internal") or "http://127.0.0.1:17778", "aim")
        return {"internal": ins.rstrip("/"), "token": c.get("token"), "updated": c.get("updated"), "by": c.get("by")}

    def token(self):
        e = os.environ.get("STUDY_AIM_TOKEN")
        if e:
            return e
        t = self.conf().get("token")
        if not t:
            return ""
        try:
            return self.box.open(t, "aim|" + SYSTEM)
        except Exception:
            return ""

    def save(self, patch, uid=None):
        with _lock:
            c = _read(self.f, {}) or {}
            if "token" in patch:
                patch = dict(patch, token=self.box.seal(patch["token"], "aim|" + SYSTEM) if patch["token"] else None)
            c.update(patch, updated=int(time.time()), by=uid)
            _write(self.f, c)
        self._cache.clear()

    def ready(self):
        return bool(self.token())

    @staticmethod
    def uuid_of(user):
        return str(((user or {}).get("sso") or {}).get("uuid") or "")

    # ---- 호출 ----
    def _req(self, method, path, user, body=None, timeout=LIST_TIMEOUT, stream=False):
        tok, uuid = self.token(), self.uuid_of(user)
        if not tok:
            raise Unavailable("AI 관리시스템 연결 토큰이 없습니다.")
        if not uuid:
            raise Denied(403, "통합로그인과 연결된 계정만 AI 관리시스템 프로필을 쓸 수 있습니다.")
        h = {"User-Agent": UA, "Accept": "text/event-stream" if stream else "application/json", "X-AI-Service": SYSTEM,
             "Authorization": "Bearer " + tok, "X-ULogin-User": uuid}
        if self.ul_token:                 # (v167) 그 사용자의 통합로그인 access_token — AI 관리가 session.php 로 역할을 확인(서버끼리만)
            try:
                ut = self.ul_token(user)
            except Exception:
                ut = ""
            if ut:
                h["X-ULogin-Token"] = ut
        data = None
        if body is not None:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            h["Content-Type"] = "application/json"
        rq = urllib.request.Request(self.conf()["internal"] + path, data=data, headers=h, method=method)
        try:
            r = urllib.request.urlopen(rq, timeout=timeout)
        except urllib.error.HTTPError as e:
            msg, code = "", ""
            try:
                j = json.loads(e.read(4000).decode("utf-8", "replace") or "{}")
                msg = str((j.get("error") or {}).get("message") if isinstance(j.get("error"), dict) else j.get("error") or j.get("message") or "")
                code = str((j.get("error") or {}).get("code") or "") if isinstance(j.get("error"), dict) else str(j.get("code") or "")
            except ValueError:
                pass
            if e.code >= 500:             # (v169) 5xx 전부 — 비상 사유(18.6). 401·403·404 는 아님
                self._down = time.time()
                raise Unavailable("AI 관리시스템이 응답하지 않습니다(HTTP %d)." % e.code, e.code)
            raise Denied(e.code, msg or {401: "AI 관리시스템 연결 토큰이 맞지 않습니다.", 403: "AI 관리시스템에서 이 프로필을 쓸 권한이 없습니다.",
                                         404: "AI 관리시스템에 없거나 꺼진 프로필입니다.", 502: "AI 관리시스템이 LLM 응답을 받지 못했습니다."}.get(e.code, "AI 관리시스템 오류(HTTP %d)" % e.code), code)
        except Exception as e:
            self._down = time.time()
            raise Unavailable("AI 관리시스템에 연결하지 못했습니다: " + str(e)[:120])
        self._down = 0.0
        return r

    def profiles(self, user, fresh=False):
        """그 사용자가 쓸 수 있는 프로필(키 없음). 실패하면 예외."""
        uuid = self.uuid_of(user)
        now = time.time()
        with _lock:
            c = self._cache.get(uuid)
            if c and not fresh and now - c[0] < LIST_TTL:
                return list(c[1])
        if not fresh and self._down and now - self._down < DOWN_SEC:
            raise Unavailable("AI 관리시스템이 응답하지 않습니다.")
        with self._req("GET", "/api/ai-registry/profiles", user) as r:
            j = json.loads(r.read(2 * 1024 * 1024).decode("utf-8", "replace") or "{}")
        raw = j.get("data") if isinstance(j.get("data"), (list, dict)) else j.get("profiles")
        if isinstance(raw, dict):
            raw = raw.get("profiles") or raw.get("items") or []
        out = []
        for p in raw or []:
            if not isinstance(p, dict) or not re.match(r"^[A-Za-z0-9_.:\-]{1,80}$", str(p.get("id") or "")) or p.get("enabled") is False:
                continue
            out.append({"id": str(p["id"]), "name": str(p.get("name") or p.get("model") or p["id"])[:80], "provider": str(p.get("provider") or "openai")[:30],
                        "model": str(p.get("model") or "")[:120], "temperature": p.get("temperature"), "maxTokens": p.get("maxTokens"),
                        "timeoutSec": p.get("timeoutSec"), "tags": [str(t)[:30] for t in (p.get("tags") or [])][:10], "keyHint": str(p.get("keyHint") or "")[:12],
                        "default": bool(p.get("default"))})
        with _lock:
            self._cache[uuid] = (now, out)
        return list(out)

    def default_of(self, user):
        """(v167, 18.5 확정) 그 사용자가 받는 목록 중 default:true, 없으면 첫 번째. 목록이 비면 None. 실패는 예외."""
        ps = self.profiles(user)
        return next((p for p in ps if p.get("default")), ps[0] if ps else None)

    def find(self, user, pid):
        for p in self.profiles(user):
            if p["id"] == pid:
                return p
        return None

    def chat(self, user, pid, messages, opts, stream):
        """OpenAI 호환 중계. 성공하면 열린 응답(스트림이면 SSE 줄)을 돌려준다."""
        p = self.find(user, pid)
        if not p:
            raise Denied(404, "AI 관리시스템에 없거나 쓸 수 없는 프로필입니다.")
        body = {"messages": messages, "stream": bool(stream)}
        if opts.get("temperature") is not None:
            body["temperature"] = opts["temperature"]
        if opts.get("maxTokens") is not None:
            body["max_tokens"] = opts["maxTokens"]
        timeout = max(5, int(p.get("timeoutSec") or 120))
        r = self._req("POST", "/api/ai-registry/chat/" + p["id"], user, body, timeout=timeout, stream=stream)
        self.record_use(user, p["id"])
        return p, r

    # ---- (v169) 비상 AI 묶음 emergency/1 2-2 ----
    def record_use(self, user, pid):
        """중계가 성공할 때마다 (uuid, profileId, lastUsedAt). 같은 사람·프로필은 1시간에 한 번만 저장."""
        uu, now = self.uuid_of(user), int(time.time())
        if not uu:
            return
        k = uu + "|" + pid
        if now - self._use_mem.get(k, 0) < 3600:
            return
        with _lock:
            d = _read(self.f_use, {}) or {}
            d.setdefault(uu, {})[pid] = now
            try:
                _write(self.f_use, d)
            except Exception:
                return
            self._use_mem[k] = now
        if self.auto and now - int((_read(self.f_emg, {}) or {}).get("fetched") or 0) >= EMG_EVERY and not self._fetching:
            threading.Thread(target=self.fetch_emergency, args=("relay",), daemon=True).start()

    def fetch_emergency(self, by="auto"):
        """GET /api/ai-registry/emergency(서비스 토큰) → 통째로 봉인 저장. 실패하면 이전 묶음을 둔다. → (ok, 메시지)"""
        tok = self.token()
        if not tok:
            return False, "AI 관리시스템 연결 토큰이 없습니다."
        self._fetching = True
        try:
            rq = urllib.request.Request(self.conf()["internal"] + "/api/ai-registry/emergency", headers={"User-Agent": UA, "Accept": "application/json", "X-AI-Service": SYSTEM, "Authorization": "Bearer " + tok})
            try:
                with urllib.request.urlopen(rq, timeout=LIST_TIMEOUT) as r:
                    j = json.loads(r.read(4 * 1024 * 1024).decode("utf-8", "replace") or "{}")
            except urllib.error.HTTPError as e:
                self._emg_err("HTTP %d" % e.code)
                return False, "비상 묶음을 받지 못했습니다(HTTP %d)." % e.code
            except Exception as e:
                self._emg_err("연결 안 됨")
                return False, "비상 묶음을 받지 못했습니다: " + str(e)[:80]
            d = j.get("data") if isinstance(j, dict) else None
            if not isinstance(d, dict) or d.get("format") != "ai-emergency/1" or (d.get("system") and d.get("system") != SYSTEM):
                self._emg_err("형식 다름")
                return False, "비상 묶음 형식이 맞지 않습니다."
            profs = [p for p in (d.get("profiles") or []) if isinstance(p, dict) and re.match(r"^[A-Za-z0-9_.:\-]{1,80}$", str(p.get("id") or ""))]
            grants = {str(k): [str(x) for x in v if isinstance(x, str)] for k, v in (d.get("grants") or {}).items() if isinstance(v, list)}
            body = json.dumps({"profiles": profs, "grants": grants}, ensure_ascii=False)
            with _lock:
                _write(self.f_emg, {"format": "ai-emergency/1", "sealed": self.box.seal(body, "aim-emg|" + SYSTEM), "issuedAt": d.get("issuedAt"), "expiresAt": d.get("expiresAt"),
                                    "fetched": int(time.time()), "profiles": len(profs), "people": len(grants), "error": None})
            logkit.audit("ai.emergency_bundle", user=by, profiles=len(profs), people=len(grants), expires=d.get("expiresAt"))
            return True, "비상 묶음 %d개 프로필을 받았습니다." % len(profs)
        finally:
            self._fetching = False

    def _emg_err(self, why):
        with _lock:
            d = _read(self.f_emg, {}) or {}
            d.update(error={"at": int(time.time()), "why": why}, tried=int(time.time()))
            _write(self.f_emg, d)
        logkit.warn("llm", "AI 관리 비상 묶음 받기 실패 — 이전 묶음 유지", why=why)

    def _bundle(self):
        d = _read(self.f_emg, {}) or {}
        if not d.get("sealed"):
            return None
        exp = d.get("expiresAt")
        try:
            from datetime import datetime
            if exp and datetime.fromisoformat(str(exp).replace("Z", "+00:00")).timestamp() < time.time():
                return None
        except ValueError:
            return None
        try:
            return json.loads(self.box.open(d["sealed"], "aim-emg|" + SYSTEM))
        except Exception:
            return None

    def _eligible(self, user):
        """이 사람이 비상으로 쓸 수 있는 프로필 id → (프로필, 마지막 사용). 만료·권한 없음·30일 안 사용 없음은 뺀다."""
        uu = self.uuid_of(user)
        b = self._bundle() if uu else None
        if not b:
            return {}
        used = (_read(self.f_use, {}) or {}).get(uu) or {}
        now = time.time()
        out = {}
        for pid in (b.get("grants") or {}).get(uu) or []:
            p = next((x for x in b.get("profiles") or [] if x.get("id") == pid), None)
            if p and now - int(used.get(pid) or 0) <= EMG_RECENT:
                out[pid] = (p, int(used.get(pid) or 0))
        return out

    def emergency_for(self, user, pid):
        """비상 호출용 프로필(키는 _k — 서버 메모리에서만). 조건이 안 맞으면 None."""
        hit = self._eligible(user).get(pid)
        if not hit:
            return None
        p = hit[0]
        return {"id": p["id"], "name": str(p.get("name") or p["id"]), "provider": str(p.get("provider") or "openai"), "base_url": str(p.get("baseUrl") or "").rstrip("/"),
                "model": str(p.get("model") or ""), "params": {"temperature": p.get("temperature") if p.get("temperature") is not None else 0.7,
                                                               "max_tokens": p.get("maxTokens") or 2048, "top_p": 1, "timeout_ms": int(p.get("timeoutSec") or 120) * 1000},
                "_k": str(p.get("key") or ""), "emergency": True}

    def emergency_default(self, user):
        """고른 적 없는 사람: 비상 묶음에서 default, 없으면 가장 최근에 쓴 것(키 없이)."""
        el = self._eligible(user)
        if not el:
            return None
        pid = next((k for k, v in el.items() if v[0].get("default")), None) or max(el, key=lambda k: el[k][1])
        p = el[pid][0]
        return {"id": pid, "name": str(p.get("name") or pid), "provider": str(p.get("provider") or "openai"), "model": str(p.get("model") or ""), "default": bool(p.get("default"))}

    def emergency_info(self):
        d = _read(self.f_emg, {}) or {}
        return {"fetched": d.get("fetched"), "expiresAt": d.get("expiresAt"), "profiles": d.get("profiles"), "people": d.get("people"), "error": d.get("error"),
                "valid": self._bundle() is not None}

    def start(self):
        self.auto = True

        def loop():
            time.sleep(EMG_DELAY)
            while True:
                try:
                    d = _read(self.f_emg, {}) or {}
                    last = max(int(d.get("fetched") or 0), int(d.get("tried") or 0) - EMG_EVERY + 600)   # 실패하면 10분 뒤 다시
                    if self.ready() and time.time() - last >= EMG_EVERY:
                        self.fetch_emergency("auto")
                except Exception as e:
                    logkit.warn("llm", "비상 묶음 작업 오류", err=str(e)[:160])
                time.sleep(EMG_TICK)
        threading.Thread(target=loop, daemon=True, name="aim-emg").start()

    def status(self, user):
        """화면용: 연결 토큰이 있는지, 이 계정이 받을 수 있는지, 지금 닿는지."""
        st = {"ready": self.ready(), "linked": bool(self.uuid_of(user)), "up": None, "profiles": [], "message": ""}
        if not st["ready"]:
            st["message"] = "AI 관리시스템 연결 토큰이 아직 없습니다."
            return st
        if not st["linked"]:
            st["message"] = "통합로그인과 연결된 계정만 받을 수 있습니다."
            return st
        try:
            st["profiles"] = self.profiles(user, fresh=True)
            st["up"] = True
            if not st["profiles"]:
                st["message"] = "AI 관리시스템에서 이 계정에 허용한 프로필이 없습니다."
        except Unavailable as e:
            st["up"], st["message"] = False, str(e)
        except Denied as e:
            st["up"], st["message"] = True, str(e)
        return st

    @staticmethod
    def has_handoff():
        return vfs.isfile(HANDOFF)

    def handoff(self, uid):
        """AI 관리시스템이 둔 토큰 파일(aim-token/1)을 읽어 암호화해 두고 지운다. 값은 어디에도 쓰지 않는다."""
        path = HANDOFF
        if not vfs.isfile(path):
            return "토큰 파일이 없습니다."
        j = _read(path, {}) or {}
        if j.get("format") not in (None, "aim-token/1") or (j.get("system") and j.get("system") != SYSTEM):
            return "이 시스템(slc)용 토큰 파일이 아닙니다."
        tok = str(j.get("token") or "").strip()
        if not re.match(r"^[A-Za-z0-9_.\-]{16,400}$", tok):
            return "파일에 토큰이 없습니다."
        patch = {"token": tok}
        aim = str(j.get("aim") or "").strip().rstrip("/")
        if re.match(r"^https?://[A-Za-z0-9.\-\[\]:]+$", aim):
            patch["internal"] = aim
        self.save(patch, uid)
        try:
            vfs.remove(path)
        except OSError:
            logkit.warn("security", "AI 관리시스템 토큰 파일을 지우지 못했습니다", file=os.path.basename(path))
        logkit.audit("aim_token", user=uid)
        return None
