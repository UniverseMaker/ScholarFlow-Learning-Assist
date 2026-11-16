# -*- coding: utf-8 -*-
"""계정 연동·자동 로그인·통합 메뉴 — 규격 hub-link/1 (adminv46/docs/RESEARCH-HUB.md 11장).

/hub/<op> 하나로 받는다.
  누구나      info
  세션+CSRF   links · start · unlink · tickets · menus     (CSRF = X-Study-Vault 머리글 + 같은 출처)
  승인 화면   authorize · approve · callback               (approve 는 세션에서 만든 csrf 칸)
  서버끼리    exchange(코드) · revoke · logout · menu(서명)
  브라우저    enter(표)
  토큰        events(slc_)

연동은 사용자가 양쪽에서 승인해야 만들어진다. 비밀번호는 주고받지 않는다. 연동이 없으면 이 파일은 아무 일도 하지 않는다.
비밀값·상대 토큰은 서버 비밀 상자로 암호화해 두고 브라우저에 내리지 않는다.
도메인 접속(11.9): 서버끼리는 언제나 내부 주소, 브라우저 이동은 접속한 쪽에 맞춘다. 터널로는 exchange·revoke·logout·menu·events·issue-event 를 받지 않는다.
"""
import safeio   # (v140) 정전 대비 쓰기(임시 파일 → fsync → 바꾸기)
import vfs      # noqa: E402  (v151) SQLite 엔진이면 데이터 폴더의 .json·.jsonl 은 DB — 아래 open·exists 등은 vfs 판
open = vfs.open  # noqa: A001
import base64
import hashlib
import hmac
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
import logkit
import portreg

SYSTEMS = {
    "admin": {"label": "연구행정관리시스템", "web": "http://127.0.0.1:8195", "public": "https://admin.example.com"},
    "kanban": {"label": "업무관리시스템", "web": "http://127.0.0.1:8194", "public": "https://task.example.com"},
    "slc": {"label": "ScholarFlow", "web": "http://127.0.0.1:18162", "public": "https://learning.example.com"},
    "aioffice": {"label": "AI 오피스", "web": "http://127.0.0.1:17777", "public": "https://office.example.com", "noToken": True},   # 공개 API 를 쓰지 않아 서비스 토큰을 만들지 않는다
}
SELF = "slc"
TICKET_SEC = 60
SIG_SEC = 60
DOWN_SEC = 20
UA = "StudyCenter/1.0 (+local)"
RE_STATE = re.compile(r"^[a-f0-9]{32}$")
RE_TO = re.compile(r"^#/[A-Za-z0-9/_.\-]{0,200}$")
RE_RUI = re.compile(r"^[A-Za-z0-9_-]{1,200}$")
RE_HOST = re.compile(r"^(127\.0\.0\.1|localhost|\[::1\]):\d{2,5}$")
_down = {}
# (v176) 11.10 자동 연동 — 같은 통합로그인 uuid 에 묶인 계정끼리. 제안(offer) → 확정(claim), 통합로그인 토큰은 주고받지 않는다
AUTOLINK_SEC = 7 * 86400
AUTOLINK_MEMO = "통합로그인 계정 자동 연동"
AUTOLINK_MAX_PENDING = 500
RE_OFFER = re.compile(r"^[a-f0-9]{64}$")
RE_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
ULOGIN_ID = {"admin": "admin", "kanban": "task", "slc": "learning", "aioffice": "office"}   # 연동 시스템 id → 통합로그인 서비스 id(userinfo services 키)


def others():
    return [s for s in SYSTEMS if s != SELF]


def web(sys_):
    e = os.environ.get("HUB_WEB_" + sys_.upper())
    if e:
        return e.rstrip("/")
    # (v137) 서버끼리 부르는 포트는 서버 지킴이 등록부(port-registry/1)에서. 못 읽으면 마지막 값·기본값
    return portreg.fix_loopback(SYSTEMS[sys_]["web"], sys_).rstrip("/")


def public_clean(u):
    u = str(u or "").strip().rstrip("/")
    return u.lower() if re.match(r"^https://[a-z0-9.-]+(:\d+)?$", u, re.I) else ""


def host_of(handler):
    h = (handler.headers.get("X-Forwarded-Host") or handler.headers.get("Host") or "").split(",")[0].strip().lower()
    return re.sub(r":\d+$", "", h)


def url(sys_, op, q=None, base=None):
    b = (base or web(sys_)).rstrip("/")
    u = b + "/hub/" + op if sys_ == "slc" else b + "/api.php?action=hublink&op=" + op
    if q:
        u += ("&" if "?" in u else "?") + urllib.parse.urlencode(q)
    return u


def sig(secret, op, lid, ts):
    return hmac.new(secret.encode("utf-8"), ("%s\n%s\n%s" % (op, lid, ts)).encode("utf-8"), hashlib.sha256).hexdigest()


def b64u(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def clean_to(to):
    return to if isinstance(to, str) and RE_TO.match(to) else "#/"


def _read(p):
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _write(p, obj):
    safeio.atomic_json(p, obj)


class HubLink:
    def __init__(self, data_dir, auth, box, hub, ws, app_dir):
        self.dir, self.auth, self.box, self.hub, self.ws, self.app_dir = data_dir, auth, box, hub, ws, app_dir
        self.run = os.path.join(data_dir, "system", "hub-run")
        self.f_ids = os.path.join(data_dir, "system", "hub-linkids.json")
        self.f_public = os.path.join(data_dir, "system", "hub-public.json")
        self.f_al_sent = os.path.join(data_dir, "system", "hub-autolink-sent.json")      # (v176) 내가 보낸 제안: sha256(offer) → {user, system, uuid, exp}
        self.f_al_pend = os.path.join(data_dir, "system", "hub-autolink-pending.json")   # (v176) 받은 제안: "<from>|<uuid>" → {offer 봉인, exp}
        self.sso = None   # (v176) serve.py 가 sso_api.Sso 를 넣는다 — 확정 전 userinfo 확인
        self.lock = threading.Lock()

    # ---- 공개 주소(11.9) ----
    def public(self, sys_):
        return ((_read(self.f_public) or {}).get(sys_) or os.environ.get("HUB_PUB_" + sys_.upper()) or SYSTEMS[sys_]["public"]).rstrip("/")

    def via_public(self, handler):
        h = host_of(handler)
        return bool(h) and h not in ("127.0.0.1", "localhost", "[::1]") and h == urllib.parse.urlsplit(self.public(SELF)).hostname

    def browser(self, handler, sys_):
        """브라우저를 보낼 주소. 공통 규칙 G5: 브라우저 이동은 늘 공개 도메인, 127.0.0.1 은 서버끼리만."""
        return self.public(sys_)

    # ---- 짧게 쓰는 값(state·code·jti) ----
    def _tmp(self, kind, id_):
        return os.path.join(self.run, kind + "-" + re.sub(r"[^a-zA-Z0-9_-]", "", str(id_))[:80] + ".json")

    def tmp_put(self, kind, id_, v, ttl):
        _write(self._tmp(kind, id_), dict(v, _exp=time.time() + ttl))

    def tmp_take(self, kind, id_):
        p = self._tmp(kind, id_)
        v = _read(p)
        try:
            vfs.remove(p)
        except OSError:
            pass
        return v if isinstance(v, dict) and v.get("_exp", 0) >= time.time() else None

    def once(self, jti):
        os.makedirs(self.run, exist_ok=True)
        try:
            os.close(os.open(self._tmp("jti", jti), os.O_CREAT | os.O_EXCL | os.O_WRONLY))
        except OSError:
            return False
        try:
            now = time.time()
            for n in vfs.listdir(self.run):
                if n.startswith("jti-") and now - vfs.getmtime(os.path.join(self.run, n)) > 300:
                    vfs.remove(os.path.join(self.run, n))
        except OSError:
            pass
        return True

    # ---- 연동 기록 ----
    def _f(self, uid):
        return os.path.join(self.dir, "users", uid, "hub-links.json")

    def get(self, uid, sys_):
        return (_read(self._f(uid)) or {}).get(sys_)

    def by_id(self, lid):
        i = (_read(self.f_ids) or {}).get(lid)
        if not i:
            return None
        r = self.get(i["user"], i["system"])
        return r if r and r.get("linkId") == lid else None

    def secret(self, rec):
        return self.box.open(rec["secret"], "link-secret|" + rec["linkId"])

    def token_for(self, uid, sys_):
        """상대 시스템 API 를 이 사용자 권한으로 부를 토큰(서버 코드 전용)."""
        r = self.get(uid, sys_)
        return self.box.open(r["token"], "link-token|" + r["linkId"]) if r else ""

    def save(self, uid, sys_, x):
        old = self.get(uid, sys_)
        if old:
            self.drop(old)
        rec = {"linkId": x["linkId"], "user": uid, "system": sys_, "remoteId": str(x.get("remoteId") or ""), "remoteName": str(x.get("remoteName") or ""),
               "secret": self.box.seal(x["secret"], "link-secret|" + x["linkId"]), "token": self.box.seal(str(x.get("token") or ""), "link-token|" + x["linkId"]),
               "localToken": x["localToken"], "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        if x.get("via"):
            rec["via"] = x["via"]          # (v176) "autolink" = 통합로그인 계정 자동 연동
        with self.lock:
            d = _read(self._f(uid)) or {}
            d[sys_] = rec
            _write(self._f(uid), d)
            ids = _read(self.f_ids) or {}
            ids[x["linkId"]] = {"user": uid, "system": sys_}
            _write(self.f_ids, ids)

    def drop(self, rec):
        with self.lock:
            d = _read(self._f(rec["user"])) or {}
            if d.get(rec["system"], {}).get("linkId") == rec["linkId"]:
                d.pop(rec["system"], None)
                _write(self._f(rec["user"]), d)
            ids = _read(self.f_ids) or {}
            if ids.pop(rec["linkId"], None):
                _write(self.f_ids, ids)
        if rec.get("localToken"):
            self.hub.revoke(rec["localToken"])

    # ---- 자동 연동(11.10) ----
    def _f_off(self, uid):
        return os.path.join(self.dir, "users", uid, "hub-autolink-off.json")

    def al_off(self, uid, sys_):
        """사람이 해제한 쌍 — 다시 자동으로 묶지 않는다(수동 연결하면 풀림)."""
        return bool((_read(self._f_off(uid)) or {}).get(sys_))

    def al_set_off(self, uid, sys_, on):
        with self.lock:
            d = _read(self._f_off(uid)) or {}
            if bool(d.get(sys_)) == bool(on):
                return
            if on:
                d[sys_] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            else:
                d.pop(sys_, None)
            _write(self._f_off(uid), d)

    def _uuid_of(self, u):
        v = str(((u or {}).get("sso") or {}).get("uuid") or "").lower()
        return v if RE_UUID.match(v) else ""

    def al_offer(self, uid):
        """A 쪽: 연동 안 된 시스템마다 제안을 보낸다. sha256(offer) 만 남긴다. 결과 {시스템: 'sent'|'down'}."""
        u = self.active(uid)
        uuid = self._uuid_of(u)
        out = {}
        if not uuid:
            return out
        for s in others():
            if self.get(uid, s) or self.al_off(uid, s):
                continue
            offer = secrets.token_hex(32)
            now = time.time()
            with self.lock:
                d = {k: v for k, v in (_read(self.f_al_sent) or {}).items() if v.get("exp", 0) > now and not (v.get("user") == uid and v.get("system") == s)}
                d[hashlib.sha256(offer.encode("ascii")).hexdigest()] = {"user": uid, "system": s, "uuid": uuid, "exp": now + AUTOLINK_SEC}
                _write(self.f_al_sent, d)
            code, _j = self.http(s, "autolink-offer", {"v": 1, "from": SELF, "uuid": uuid, "offer": offer}, None, 3)
            out[s] = "sent" if code == 202 else "down"
        return out

    def al_take_offer(self, b):
        """X 쪽: 받은 제안을 보류 목록에 둔다(7일, 같은 from+uuid 는 덮어씀). 응답은 늘 202 — 여기서는 결과를 알리지 않는다."""
        frm, uuid, offer = str(b.get("from") or ""), str(b.get("uuid") or "").lower(), str(b.get("offer") or "")
        if b.get("v") != 1 or frm not in SYSTEMS or frm == SELF or not RE_UUID.match(uuid) or not RE_OFFER.match(offer):
            return
        key, now = frm + "|" + uuid, time.time()
        with self.lock:
            d = {k: v for k, v in (_read(self.f_al_pend) or {}).items() if v.get("exp", 0) > now}
            if key not in d and len(d) >= AUTOLINK_MAX_PENDING:
                return
            d[key] = {"from": frm, "uuid": uuid, "offer": self.box.seal(offer, "autolink|" + key), "exp": now + AUTOLINK_SEC}
            _write(self.f_al_pend, d)

    def _pend_drop(self, key):
        with self.lock:
            d = _read(self.f_al_pend) or {}
            if d.pop(key, None) is not None:
                _write(self.f_al_pend, d)

    def al_claim(self, uid):
        """X 쪽: 이 계정 uuid 로 온 제안을 확정한다. 통합로그인 userinfo 로 양쪽 서비스 권한을 확인하고, 등록부의 A 주소로만 보낸다.
        결과 {시스템: 'linked'|'refused'|'denied'|'down'}."""
        u = self.active(uid)
        uuid = self._uuid_of(u)
        out = {}
        if not uuid or not self.sso:
            return out
        now = time.time()
        mine = [(k, v) for k, v in (_read(self.f_al_pend) or {}).items() if v.get("uuid") == uuid and v.get("exp", 0) > now]
        info = None
        for key, p in mine:
            s = p.get("from")
            if s not in SYSTEMS or s == SELF or self.get(uid, s) or self.al_off(uid, s):
                self._pend_drop(key)
                continue
            if info is None:
                info = self.sso.userinfo(uuid) or {}
            sv = info.get("services") if isinstance(info.get("services"), dict) else {}
            me = self.sso.find_uuid(uuid)
            if info.get("status") != "active" or sv.get(ULOGIN_ID.get(s, s)) is not True or sv.get(ULOGIN_ID[SELF]) is not True or not me or me["id"] != uid:
                out[s] = "denied"
                continue
            try:
                offer = self.box.open(p["offer"], "autolink|" + key)
            except Exception:
                self._pend_drop(key)
                continue
            tok, tid = ("", None) if SYSTEMS[s].get("noToken") else self.hub.mint(uid, "link:" + s)
            code, j = self.http(s, "autolink-claim", {"v": 1, "from": SELF, "uuid": uuid, "offer": offer, "user": {"id": uid, "name": u.get("username")}, "token": tok}, None, 3)
            d = (j or {}).get("data") if isinstance(j, dict) and j.get("ok") else None
            if code == 0:
                self.hub.revoke(tid)
                out[s] = "down"          # 다음 로그인 때 다시
                continue
            self._pend_drop(key)         # 제안은 한 번만
            if code != 200 or not isinstance(d, dict) or not d.get("linkId") or not d.get("secret"):
                self.hub.revoke(tid)
                out[s] = "refused"
                continue
            self.save(uid, s, {"linkId": d["linkId"], "remoteId": (d.get("user") or {}).get("id"), "remoteName": (d.get("user") or {}).get("name"), "secret": d["secret"], "token": d.get("token"), "localToken": tid, "via": "autolink"})
            logkit.audit("link_create", user=uid, system=s, via="autolink", note=AUTOLINK_MEMO)
            out[s] = "linked"
        return out

    def al_claim_in(self, b):
        """A 쪽: 확정 요청. 내가 낸 제안(sha256)·만료·시스템·uuid·1회·계정 활성·해제 표시를 확인한다. 상대를 다시 부르지 않는다."""
        frm, uuid, offer = str(b.get("from") or ""), str(b.get("uuid") or "").lower(), str(b.get("offer") or "")
        if b.get("v") != 1 or frm not in SYSTEMS or frm == SELF or not RE_UUID.match(uuid) or not RE_OFFER.match(offer):
            return None
        h = hashlib.sha256(offer.encode("ascii")).hexdigest()
        with self.lock:
            d = _read(self.f_al_sent) or {}
            rec = d.pop(h, None)
            if rec is not None:
                _write(self.f_al_sent, d)
        if not rec or rec.get("exp", 0) < time.time() or rec.get("system") != frm or rec.get("uuid") != uuid:
            return None
        u = self.active(rec.get("user"))
        if not u or self._uuid_of(u) != uuid or self.al_off(u["id"], frm):
            return None
        sec, lid = secrets.token_hex(32), "lnk_" + secrets.token_hex(10)
        tok, tid = ("", None) if SYSTEMS[frm].get("noToken") else self.hub.mint(u["id"], "link:" + frm)
        who = b.get("user") if isinstance(b.get("user"), dict) else {}
        self.save(u["id"], frm, {"linkId": lid, "remoteId": who.get("id"), "remoteName": who.get("name"), "secret": sec, "token": b.get("token"), "localToken": tid, "via": "autolink"})
        logkit.audit("link_create", user=u["id"], system=frm, via="autolink", note=AUTOLINK_MEMO)
        return {"linkId": lid, "secret": sec, "token": tok, "user": {"id": u["id"], "name": u.get("username")}}

    def autolink(self, uid):
        """통합로그인으로 들어온 직후(또는 「지금 맞추기」): 받은 제안을 먼저 확정하고, 남은 시스템에 제안을 보낸다."""
        c = self.al_claim(uid)
        o = self.al_offer(uid)
        return {"claimed": c, "offered": o}

    def autolink_bg(self, uid):
        def run():
            try:
                self.autolink(uid)
            except Exception:
                logkit.error("app", "자동 연동 처리 중 예외", exc=True)
        threading.Thread(target=run, daemon=True).start()

    # ---- 서버끼리 ----
    def http(self, sys_, op, body=None, rec=None, timeout=3):
        """상대 호출. 시간 제한 3초 이하, 실패하면 20초간 건너뛴다."""
        if time.time() - _down.get(sys_, 0) < DOWN_SEC:
            return 0, None
        h = {"Accept": "application/json", "User-Agent": UA}
        if rec:
            ts = str(int(time.time()))
            h.update({"X-Hub-Link": rec["linkId"], "X-Hub-Ts": ts, "X-Hub-Sig": sig(self.secret(rec), op, rec["linkId"], ts)})
        data = None
        if body is not None:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            h["Content-Type"] = "application/json"
        try:
            with urllib.request.urlopen(urllib.request.Request(url(sys_, op), data=data, headers=h, method="POST" if data is not None else "GET"), timeout=timeout) as r:
                raw, code = r.read(), r.status
        except urllib.error.HTTPError as e:
            raw, code = e.read(), e.code
        except Exception:
            _down[sys_] = time.time()
            return 0, None
        _down.pop(sys_, None)
        try:
            return code, json.loads(raw.decode("utf-8", "replace"))
        except ValueError:
            return code, None

    def verify(self, handler, op):
        lid = handler.headers.get("X-Hub-Link") or ""
        ts = handler.headers.get("X-Hub-Ts") or ""
        s = handler.headers.get("X-Hub-Sig") or ""
        rec = self.by_id(lid) if lid else None
        if not rec or not ts.isdigit() or abs(time.time() - int(ts)) > SIG_SEC or not hmac.compare_digest(sig(self.secret(rec), op, lid, ts), s):
            return None
        return rec

    def active(self, uid):
        u = self.auth.find(uid=uid)
        return u if u and u.get("status") != "locked" else None

    def logout_all(self, uid):
        """이 시스템 로그아웃을 막지 않게 뒤에서 보낸다. 상대가 꺼져 있어도 상관없다."""
        recs = [r for r in ((_read(self._f(uid)) or {}).values())]
        if not recs:
            return

        def run():
            for r in recs:
                try:
                    self.http(r["system"], "logout", {}, r, 2)
                except Exception:
                    pass
        threading.Thread(target=run, daemon=True).start()

    def ticket(self, rec, to):
        p = b64u(json.dumps({"v": 1, "iss": SELF, "aud": rec["system"], "lid": rec["linkId"], "jti": secrets.token_hex(12), "exp": int(time.time()) + TICKET_SEC, "to": to}, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
        return p + "." + hmac.new(self.secret(rec).encode("utf-8"), p.encode("ascii"), hashlib.sha256).hexdigest()

    def menu(self):
        return _read(os.path.join(self.app_dir, "ui", "menu.json")) or {}

    def _project_owner(self, uid, pid):
        """(v178) data-owner/1 — 토큰 주인의 프로젝트, 아니면 토큰 주인이 '편집'으로 공유받은 프로젝트만.
        예전에는 모든 계정 폴더를 뒤져 남의 프로젝트 이력에도 썼다."""
        if self.ws.project_meta(uid, pid):
            return uid
        for (ow, spid, perm) in self.ws.shared_with(uid):
            if spid == pid and perm == "edit":
                return ow
        return None

    # ---- 이슈 변화 기록(13.3): 프로젝트 작업 이력에 쌓는다. 내용은 데이터로만 다룬다 ----
    def issue_event(self, uid, b):
        pid = str(b.get("ref") or "")
        if not re.match(r"^[A-Za-z0-9_\-]{1,64}$", pid):
            return 404, "프로젝트를 찾지 못했어요."
        uid = self._project_owner(uid, pid)   # 토큰은 관리자 것이어도 프로젝트는 다른 계정 것일 수 있다
        if not uid:
            return 404, "프로젝트를 찾지 못했어요."
        seq = str(b.get("seq") or "")
        with self.lock:
            f = os.path.join(self.dir, "users", uid, "issue-seq.json")
            seen = _read(f) or []
            if seq and seq in seen:
                return 200, "이미 받았어요."
            if seq:
                _write(f, (seen + [seq])[-5000:])
        iss = b.get("issue") if isinstance(b.get("issue"), dict) else {}
        ch = [{k: str(c.get(k) or "")[:200] for k in ("field", "from", "to")} for c in (b.get("changes") or []) if isinstance(c, dict)][:12]
        text = " · ".join("%s: %s → %s" % (c["field"], c["from"], c["to"]) for c in ch)
        self.ws._log(uid, pid, {"kind": "issue", "action": str(b.get("kind") or "change")[:20], "key": str(b.get("key") or "")[:40], "title": (str(b.get("key") or "") + " " + str(iss.get("title") or ""))[:200], "note": text[:400], "actor": str(b.get("actor") or "")[:60], "url": str(iss.get("webUrl") or "")[:300], "at": str(b.get("at") or "")[:40]})
        return 201, None

    # ---- 변경 알림 ----
    def events(self, uid, since, limit=200):
        p = os.path.join(self.dir, "users", uid, "hub-events.jsonl")
        out, n = [], 0
        try:
            with open(p, encoding="utf-8") as f:
                for line in f:
                    n += 1
                    if n <= since or len(out) >= limit:
                        continue
                    try:
                        e = dict(json.loads(line), seq=n)
                    except ValueError:
                        continue
                    if isinstance(e.get("at"), (int, float)):   # 저장은 밀리초, 내보낼 때는 다른 시스템처럼 ISO
                        e["at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(e["at"] / 1000))
                    out.append(e)
        except OSError:
            pass
        return out, (out[-1]["seq"] if out else max(since, n if since >= n else since))


# ---- 화면 ----
def _send(handler, code, body, ctype="text/html; charset=utf-8", headers=None):
    b = body.encode("utf-8")
    handler.send_response(code)
    handler.send_header("Content-Type", ctype)
    handler.send_header("Content-Length", str(len(b)))
    for k, v in (headers or []):
        handler.send_header(k, v)
    handler.end_headers()
    handler.wfile.write(b)


def _redirect(handler, loc, headers=None):
    handler.send_response(303)
    handler.send_header("Location", loc)
    handler.send_header("Content-Length", "0")
    for k, v in (headers or []):
        handler.send_header(k, v)
    handler.end_headers()


def _page(handler, title, body, code=200):
    """(v152) G16 공통 로그인 화면 배치·G18 공용 새 버전 알림 — 통합로그인 페이지와 같은 틀(sso_api._page)."""
    import sso_api
    return sso_api._page(handler, title, body, code)


def _form(handler, limit=16 * 1024):
    n = int(handler.headers.get("Content-Length") or 0)
    if n <= 0 or n > limit:
        return {}
    return {k: v[0] for k, v in urllib.parse.parse_qs(handler.rfile.read(n).decode("utf-8", "replace"), keep_blank_values=True).items()}


def _approve_csrf(handler):
    return hashlib.sha256(("hub-approve|" + str(handler.auth_hash or "")).encode("utf-8")).hexdigest()


def _home(st):
    b = (st or {}).get("back") or ""
    return (b if b.startswith("http") else "http://" + b if b else "") + "/#/links"


def _authorize(L, handler, op, method):
    src = _form(handler) if op == "approve" else {k: v[0] for k, v in urllib.parse.parse_qs(urllib.parse.urlsplit(handler.path).query).items()}
    frm, state = str(src.get("from") or ""), str(src.get("state") or "")
    if frm not in SYSTEMS or frm == SELF or not RE_STATE.match(state):
        return _page(handler, "연결 불가", '<p class="muted">요청이 올바르지 않습니다.</p>', 400)
    u = handler.auth_user
    back = lambda q: _redirect(handler, url(frm, "callback", dict(state=state, **q), L.browser(handler, frm)))   # 돌아갈 주소는 등록된 시스템 주소로만
    if op == "approve":
        if method != "POST" or not u or not hmac.compare_digest(_approve_csrf(handler), str(src.get("csrf") or "")):
            return _page(handler, "연결 불가", '<p class="muted">다시 시도해 주세요.</p>', 403)
        if not src.get("ok"):
            return back({"error": "denied"})
        code = secrets.token_hex(16)
        L.tmp_put("code", code, {"user": u["id"], "from": frm}, 60)
        return back({"code": code})
    e = html.escape
    label, here = e(SYSTEMS[frm]["label"]), e(SYSTEMS[SELF]["label"])
    if not u:
        return _page(handler, here + " 로그인", '<p class="muted">' + label + " 계정과 연결할 " + here + ' 계정으로 로그인하세요.</p><form id="f" style="display:grid;gap:10px"><input class="input" name="u" placeholder="아이디" autocomplete="username" required><input class="input" name="p" type="password" placeholder="비밀번호" autocomplete="current-password" required><div class="err" role="alert"></div><button class="btn primary">로그인</button></form><script>document.getElementById("f").onsubmit=async function(e){e.preventDefault();var f=e.target,r=await fetch("/api.php?r=auth&op=login",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json","X-Study-Vault":"1"},body:JSON.stringify({username:f.u.value,password:f.p.value})}),j=await r.json();if(j.ok)location.reload();else f.querySelector(".err").textContent=j.message||"로그인하지 못했습니다."}</script>')
    name = e(str(u.get("name") or u.get("display_name") or u.get("username") or ""))
    hid = '<input type="hidden" name="from" value="' + e(frm) + '"><input type="hidden" name="state" value="' + state + '"><input type="hidden" name="csrf" value="' + _approve_csrf(handler) + '">'
    return _page(handler, "계정 연결 확인", '<p class="muted">' + label + "의 현재 계정과 " + here + "의 <b>" + name + '</b> 계정을 연결합니다. 한쪽에서 로그인하면 다른 쪽도 로그인되고, 두 시스템이 이 계정의 권한으로 데이터를 주고받습니다. 언제든 해제할 수 있습니다.</p><form method="post" action="/hub/approve" style="display:flex;gap:8px">' + hid + '<button class="btn primary" name="ok" value="1">연결</button><button class="btn">취소</button></form>')


def _callback(L, handler):
    q = {k: v[0] for k, v in urllib.parse.parse_qs(urllib.parse.urlsplit(handler.path).query).items()}
    st = L.tmp_take("state", str(q.get("state") or ""))
    if not st:
        return _page(handler, "연결 실패", '<p class="muted">요청이 만료되었습니다. 다시 시도해 주세요.</p><a class="btn" href="/#/links">돌아가기</a>', 400)
    if q.get("error"):
        return _redirect(handler, _home(st))
    uid, sys_ = st["user"], st["system"]
    u = L.active(uid)
    if not u:
        return _page(handler, "연결 실패", '<p class="muted">계정을 확인할 수 없습니다.</p>', 400)
    tok, tid = ("", None) if SYSTEMS[sys_].get("noToken") else L.hub.mint(uid, "link:" + sys_)
    code, j = L.http(sys_, "exchange", {"code": str(q.get("code") or ""), "from": SELF, "token": tok, "user": {"id": uid, "name": u.get("username")}}, None, 5)
    d = (j or {}).get("data") if isinstance(j, dict) else None
    if not isinstance(d, dict) or not d.get("linkId") or not d.get("secret"):
        L.hub.revoke(tid)
        return _page(handler, "연결 실패", '<p class="muted">상대 시스템이 응답하지 않습니다. 잠시 뒤 다시 시도해 주세요.</p><a class="btn" href="/#/links">돌아가기</a>', 502)
    L.save(uid, sys_, {"linkId": d["linkId"], "remoteId": (d.get("user") or {}).get("id"), "remoteName": (d.get("user") or {}).get("name"), "secret": d["secret"], "token": d.get("token"), "localToken": tid})
    L.al_set_off(uid, sys_, False)       # (v176) 수동 연결하면 자동 연동 해제 표시가 풀린다
    logkit.audit("link_create", user=uid, system=sys_)
    return _redirect(handler, _home(st))


def _enter(L, handler, method):
    def bad(m):
        return _page(handler, "자동 로그인 실패", '<p class="muted">' + html.escape(m) + '</p><a class="btn primary" href="/">이 시스템 로그인으로 이동</a>', 403)
    if method != "POST":
        return bad("요청이 올바르지 않습니다.")
    f = _form(handler)
    p = str(f.get("ticket") or "").split(".")
    if len(p) != 2:
        return bad("표를 읽을 수 없습니다.")
    try:
        j = json.loads(base64.urlsafe_b64decode(p[0] + "=" * (-len(p[0]) % 4)).decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return bad("표를 읽을 수 없습니다.")
    if not isinstance(j, dict) or j.get("aud") != SELF or j.get("iss") not in SYSTEMS:
        return bad("표가 이 시스템용이 아닙니다.")
    rec = L.by_id(str(j.get("lid") or ""))
    if not rec or rec["system"] != j["iss"] or not hmac.compare_digest(hmac.new(L.secret(rec).encode("utf-8"), p[0].encode("utf-8"), hashlib.sha256).hexdigest(), p[1]):
        return bad("연동 정보가 맞지 않습니다. 다시 연결해 주세요.")
    if int(j.get("exp") or 0) < time.time():
        return bad("표가 만료되었습니다.")
    if not L.once(str(j.get("jti") or "")):
        return bad("이미 사용한 표입니다.")
    u = L.active(rec["user"])
    if not u:
        return bad("계정이 비활성입니다.")
    if auth_api.is_remote(handler) and u.get("default_pw") and not L.auth.policy()["remote_default_pw"]:
        return bad("초기 비밀번호 계정은 이 PC 에서만 로그인할 수 있어요.")
    hdr = [("Content-Security-Policy", "frame-ancestors 'self' " + " ".join(x for s in others() for x in (web(s), L.public(s))))]
    handler._no_xfo = True
    if not handler.auth_user or handler.auth_user["id"] != u["id"]:
        if handler.auth_hash:
            L.auth.logout(auth_api.read_cookie(handler))
        tok, days = L.auth.issue_session(u, auth_api.client_ip(handler), handler.headers.get("User-Agent"), extra={"via": "hub"})   # (v156) 비밀번호 세션과 구분
        hdr.append(("Set-Cookie", auth_api.cookie_header(handler, tok, days * 86400)))
        logkit.audit("login", user=u["id"], username=u.get("username"), via="hub-link:" + j["iss"])
    if f.get("silent"):
        return _send(handler, 200, "ok", "text/plain; charset=utf-8", hdr)
    rui = str(f.get("rui") or "")
    return _redirect(handler, "/" + ("?rui=" + rui if RE_RUI.match(rui) else "") + clean_to(j.get("to")), hdr)


def _session_op(L, handler, op, method):
    u = handler.auth_user
    if not u:
        return handler._json(401, {"ok": False, "error": {"code": "no_session", "message": "로그인이 필요해요."}})
    if method != "GET" and (handler.headers.get("X-Study-Vault") != "1" or not auth_api.same_origin_ok(handler)):
        return handler._json(403, {"ok": False, "error": {"code": "csrf", "message": "요청을 확인할 수 없어요."}})
    uid = u["id"]
    if op == "domains":
        admin = u.get("role") == "admin"
        if method == "POST":
            if not admin:
                return handler._json(403, {"ok": False, "error": {"code": "forbidden", "message": "관리자만 바꿀 수 있어요."}})
            b = auth_api.body_json(handler)
            save = _read(L.f_public) or {}
            if b.get("sync"):
                for s in others():
                    _c, j = L.http(s, "info", None, None, 2)
                    v = public_clean(((j or {}).get("data") or {}).get("public"))
                    if v:
                        save[s] = v
            else:
                for s, v in (b.get("domains") or {}).items():
                    if s not in SYSTEMS:
                        continue
                    c = public_clean(v)
                    if not c and str(v or "").strip():
                        return handler._json(422, {"ok": False, "error": {"code": "invalid_field", "message": "공개 주소는 https://도메인 형식이어야 해요."}})
                    if c:
                        save[s] = c
                    else:
                        save.pop(s, None)
            _write(L.f_public, save)
        return handler._json(200, {"ok": True, "data": {"rows": [{"system": s, "label": SYSTEMS[s]["label"], "local": web(s), "public": L.public(s)} for s in SYSTEMS], "canEdit": admin, "viaPublic": L.via_public(handler)}})
    if op == "autolink":           # (v176) 11.10 「지금 맞추기」 — 받은 제안 확정 + 남은 시스템에 제안
        if method != "POST":
            return handler._json(405, {"ok": False, "error": {"code": "method", "message": "POST 로 보내 주세요."}})
        if not L._uuid_of(L.active(uid)):
            return handler._json(200, {"ok": True, "data": {"claimed": {}, "offered": {}, "sso": False}})
        return handler._json(200, {"ok": True, "data": dict(L.autolink(uid), sso=True)})
    if op == "mylinks":            # (v142, G11) 이 계정이 연결된 시스템만 — 바로 가기 자동 로그인용(상대를 부르지 않아 빠르다). 다른 계정 연결은 보지 않는다
        return handler._json(200, {"ok": True, "data": {s: True for s in others() if L.get(uid, s)}})
    if op == "links":
        out, seen = [], {}

        def probe(x):
            seen[x] = L.http(x, "info", None, None, 1.5)[0] == 200
        ths = [threading.Thread(target=probe, args=(x,), daemon=True) for x in others()]
        for t in ths:
            t.start()
        for t in ths:
            t.join(2)
        now = time.strftime("%Y-%m-%d %H:%M")
        for s in others():
            r = L.get(uid, s)
            out.append({"system": s, "label": SYSTEMS[s]["label"], "web": web(s), "public": L.public(s), "linked": bool(r), "remoteName": (r or {}).get("remoteName", ""), "createdAt": (r or {}).get("createdAt", ""), "reachable": bool(seen.get(s)), "checkedAt": now,
                        "auto": (r or {}).get("via") == "autolink", "autoOff": L.al_off(uid, s), "sso": bool(L._uuid_of(u))})
        return handler._json(200, {"ok": True, "data": out})
    b = auth_api.body_json(handler) if method == "POST" else {}
    s = str(b.get("system") or "")
    if op == "start":
        if s not in others():
            return handler._json(422, {"ok": False, "error": {"code": "bad_system", "message": "알 수 없는 시스템입니다."}})
        state = secrets.token_hex(16)
        host = handler.headers.get("Host") or ""
        L.tmp_put("state", state, {"user": uid, "system": s, "back": L.public(SELF) if L.via_public(handler) else host if RE_HOST.match(host) else ""}, 600)
        return handler._json(200, {"ok": True, "data": {"url": url(s, "authorize", {"from": SELF, "state": state}, L.browser(handler, s))}})
    if op == "unlink":
        r = L.get(uid, s)
        if r:
            L.http(s, "revoke", {}, r, 2)
            L.drop(r)
            L.al_set_off(uid, s, True)   # (v176) 사람이 해제한 쌍은 다시 자동으로 묶지 않는다
            logkit.audit("link_remove", user=uid, system=s)
        return handler._json(200, {"ok": True})
    if op == "tickets":
        out = []
        for x in others():
            if s and x != s:
                continue
            r = L.get(uid, x)
            if r:
                out.append({"system": x, "url": url(x, "enter", None, L.browser(handler, x)), "ticket": L.ticket(r, clean_to(b.get("to") or "#/"))})
        return handler._json(200, {"ok": True, "data": out})
    # menus — 꺼져 있으면 마지막 값
    out = []
    for x in others():
        r = L.get(uid, x)
        if not r:
            continue
        code, j = L.http(x, "menu", None, r, 2)
        f = L._tmp("menu", uid + "_" + x)
        m = (j or {}).get("data") if isinstance(j, dict) else None
        if isinstance(m, dict):
            _write(f, m)
        else:
            m = _read(f)
        out.append({"system": x, "label": SYSTEMS[x]["label"], "reachable": code == 200, "menu": m})
    return handler._json(200, {"ok": True, "data": out})


def handle(L, handler, op, method):
    fail = lambda code, msg, http=400: handler._json(http, {"ok": False, "error": {"code": code, "message": msg}})
    if op == "info":
        return handler._json(200, {"ok": True, "data": {"format": "hub-link/1", "system": SELF, "label": SYSTEMS[SELF]["label"], "web": web(SELF), "public": L.public(SELF)}})
    if op == "autolink-offer":     # (v176) 11.10 ① 제안 받기 — 늘 202, 인증 머리글 없음. 터널로 온 것은 담지 않는다
        if method == "POST" and not auth_api.is_remote(handler):
            L.al_take_offer(auth_api.body_json(handler))
        return handler._json(202, {"ok": True})
    if op == "autolink-claim":     # (v176) 11.10 ② 확정 받기 — 실패는 모두 같은 403
        d = L.al_claim_in(auth_api.body_json(handler)) if method == "POST" and not auth_api.is_remote(handler) else None
        if not d:
            return fail("autolink_refused", "자동 연동을 할 수 없습니다.", 403)
        return handler._json(200, {"ok": True, "data": d})
    if op in ("exchange", "revoke", "logout", "menu", "events", "issue-event") and auth_api.is_remote(handler):
        logkit.warn("security", "서버끼리 경로 외부 접근 거절", ip=auth_api.client_ip(handler), path="/hub/" + op)
        return fail("local_only", "이 경로는 서버 PC 안에서만 받아요.", 403)
    if op in ("links", "mylinks", "start", "unlink", "tickets", "menus", "domains", "autolink"):
        return _session_op(L, handler, op, method)
    if op in ("authorize", "approve"):
        return _authorize(L, handler, op, method)
    if op == "callback":
        return _callback(L, handler)
    if op == "exchange":
        if method != "POST":
            return fail("method", "POST 로 보내 주세요.", 405)
        b = auth_api.body_json(handler)
        c = L.tmp_take("code", str(b.get("code") or ""))
        frm = str(b.get("from") or "")
        if not c or c.get("from") != frm or frm not in SYSTEMS:
            return fail("bad_code", "연동 코드가 맞지 않거나 만료되었습니다.")
        u = L.active(c["user"])
        if not u:
            return fail("bad_code", "계정을 찾을 수 없습니다.")
        sec, lid = secrets.token_hex(32), "lnk_" + secrets.token_hex(10)
        tok, tid = ("", None) if SYSTEMS[frm].get("noToken") else L.hub.mint(u["id"], "link:" + frm)
        who = b.get("user") if isinstance(b.get("user"), dict) else {}
        L.save(u["id"], frm, {"linkId": lid, "remoteId": who.get("id"), "remoteName": who.get("name"), "secret": sec, "token": b.get("token"), "localToken": tid})
        L.al_set_off(u["id"], frm, False)   # (v176) 수동 연결하면 자동 연동 해제 표시가 풀린다
        logkit.audit("link_create", user=u["id"], system=frm)
        return handler._json(200, {"ok": True, "data": {"linkId": lid, "secret": sec, "token": tok, "user": {"id": u["id"], "name": u.get("username")}}})
    if op in ("revoke", "logout", "menu"):
        r = L.verify(handler, op)
        if not r:
            return fail("bad_signature", "서명을 확인할 수 없습니다.", 401)
        if op == "revoke":
            L.drop(r)
            L.al_set_off(r["user"], r["system"], True)   # (v176) 상대 쪽에서 사람이 해제 — 다시 자동으로 묶지 않는다
            return handler._json(200, {"ok": True})
        if op == "logout":
            L.auth.revoke_user_sessions(r["user"])   # 다시 전파하지 않는다
            return handler._json(200, {"ok": True})
        if not L.active(r["user"]):
            return fail("bad_user", "계정이 비활성입니다.", 403)
        return handler._json(200, {"ok": True, "data": L.menu()})
    if op == "enter":
        return _enter(L, handler, method)
    if op == "issue-event":      # 13.2 칸반이 이슈 변화를 보낸다. 쓰기 서비스 토큰, ref = 프로젝트 id
        if method != "POST":
            return fail("method", "POST 로 보내 주세요.", 405)
        tok = re.sub(r"^(?i:bearer)\s+", "", (handler.headers.get("Authorization") or "").strip())
        t = L.hub.check(tok)
        if not t or t.get("scope") != "write" or not L.active(t["owner"]):
            return fail("bad_token", "쓰기 서비스 토큰이 필요해요.", 401)
        b = auth_api.body_json(handler)
        st, msg = L.issue_event(t["owner"], b)
        return handler._json(st, {"ok": st < 400, "message": msg})
    if op == "events":
        tok = re.sub(r"^(?i:bearer)\s+", "", (handler.headers.get("Authorization") or handler.headers.get("X-API-Key") or "").strip())
        t = L.hub.check(tok)
        if not t or not L.active(t["owner"]):
            return fail("bad_token", "서비스 토큰이 맞지 않아요.", 401)
        q = urllib.parse.parse_qs(urllib.parse.urlsplit(handler.path).query)
        try:
            since = max(0, int((q.get("since") or ["0"])[0]))
        except ValueError:
            since = 0
        ev, nxt = L.events(t["owner"], since)
        return handler._json(200, {"ok": True, "data": ev, "meta": {"nextSince": nxt}})
    return fail("not_found", "알 수 없는 연동 경로입니다.", 404)
