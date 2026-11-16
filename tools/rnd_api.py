# -*- coding: utf-8 -*-
"""연구 허브 연동(v117) — 규격: adminv41/docs/RESEARCH-HUB.md (research-hub/1)

1) r=rnd : 연구행정관리시스템(admin) 연결기. FlowBoard 연결과 같은 방식.
     토큰(mgm_…)은 계정별로 서버에 암호화 보관하고 브라우저로 내려보내지 않는다.
     users/<uid>/rndadmin.json  {base, token:{암호문}, token_hint, connected}
     op: status · projects · bundle(&pid=) · connect · disconnect · import_local · link · unlink · output

2) /v1/* : 다른 시스템을 위한 서비스 API. slc_ 서비스 토큰으로만.
     GET  /v1/models                OpenAI 호환 — 토큰 주인의 지금 AI 연결
     POST /v1/chat/completions      OpenAI 호환 — 스트리밍 포함
     GET  /v1/projects              연구 프로젝트 목록(pid·이름·rndId·바로 가기)
     GET  /v1/search?pid=&q=&k=     자료 검색(근거 문장·출처·쪽). 읽기 전용
   ※ 이 PC 안에서 온 요청만 받는다. 18162 는 Cloudflare 터널이 같은 포트로 들어오므로 접속 주소만으로는 구분되지 않아
     Cf-*·X-Forwarded-For 가 붙은 요청을 거절한다(auth_api.is_remote). 게이트웨이는 기본 꺼짐 — 관리자가 화면에서 켠다.
   토큰은 해시만 저장한다: system/hub.json {enabled, tokens:[{id, hash, hint, owner, name, created, last_used, calls}]}
   발급한 토큰 원문은 공용 폴더의 slc.json (규격 9장, tools/hubdir.py — 새 위치 행정관리시스템 hub/secrets, 없으면 옛 %USERPROFILE%/.research-hub) 에만 쓴다 — 화면·대화·로그에 나오지 않는다.
"""
import safeio   # (v140) 정전 대비 쓰기(임시 파일 → fsync → 바꾸기)
import vfs      # noqa: E402  (v151) SQLite 엔진이면 데이터 폴더의 .json·.jsonl 은 DB — 아래 open·exists 등은 vfs 판
open = vfs.open  # noqa: A001
import hashlib
import hmac
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
import llm_api

DEFAULT_BASE = "http://127.0.0.1:8195/api.php/v1"
SLC_BASE = "http://127.0.0.1:%d/v1"
UA = "StudyCenter/1.0 (+local)"
import hubdir  # noqa: E402  (v175) 규격 9장 공용 폴더 이동 — STUDY_HUB_DIR → 새 위치 → 옛 위치
HUB_DIR = hubdir.path()
MAX_CHAT = 2 * 1024 * 1024


def _now():
    return int(time.time() * 1000)


def _read(p):
    try:
        with open(p, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def _atomic(p, obj):
    safeio.atomic_json(p, obj, indent=1)


# =============================================================== 연구행정 연결기
class RndAdmin:
    def __init__(self, data_dir, box):
        self.dir = data_dir
        self.box = box

    def path(self, uid):
        return os.path.join(self.dir, "users", uid, "rndadmin.json")

    def conf(self, uid):
        return _read(self.path(uid)) or {}

    def call(self, uid, method, path, body=None, query=None, conf=None, token=None):
        c = conf or self.conf(uid)
        base = __import__("portreg").fix_loopback((c.get("base") or DEFAULT_BASE).rstrip("/"), "admin")   # (v137) 포트 등록부
        url = base + path + (("?" + urllib.parse.urlencode({k: v for k, v in (query or {}).items() if v not in (None, "")})) if query else "")
        tok = token if token is not None else (self.box.open(c["token"], "rndadmin|" + uid) if c.get("token") else "")
        h = {"Accept": "application/json", "User-Agent": UA, "Authorization": "Bearer " + tok, "X-API-Key": tok}
        data = None
        if body is not None:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            h["Content-Type"] = "application/json"
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=h, method=method), timeout=20) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except urllib.error.HTTPError as e:
            try:
                d = json.loads(e.read().decode("utf-8", "replace"))
            except ValueError:
                d = {}
            err = (d.get("error") or {}) if isinstance(d, dict) else {}
            return {"ok": False, "status": e.code, "error": {"code": err.get("code") or ("http_%d" % e.code), "message": err.get("message") or ("HTTP %d" % e.code)}}
        except Exception as e:
            return {"ok": False, "error": {"code": "unreachable", "message": "연구행정관리시스템에 연결하지 못했어요: " + str(e)[:140]}}

    def connect(self, uid, base, token):
        base = (base or DEFAULT_BASE).strip().rstrip("/")
        if not re.match(r"^https?://", base):
            return None, "주소는 http://… 로 넣어 주세요."
        token = re.sub(r"^(?i:bearer)\s+", "", str(token or "").strip().strip('"').strip("'")).strip()
        if not re.match(r"^mgm_[a-f0-9]{48}$", token):
            return None, "연구행정 API 토큰이 아니에요 — 'mgm_' + 16진수 48자를 그대로 넣으세요(지금 %d자)." % len(token)
        r = self.call(uid, "GET", "/me", conf={"base": base}, token=token)
        if not r.get("ok"):
            return None, "토큰을 확인하지 못했어요: " + ((r.get("error") or {}).get("message") or "")
        c = {"base": base, "token": self.box.seal(token, "rndadmin|" + uid), "token_hint": token[:6] + "…" + token[-4:], "connected": _now()}
        _atomic(self.path(uid), c)
        return self.public(c), None

    @staticmethod
    def public(c):
        if not c or not c.get("token"):
            return {"connected": False, "base": DEFAULT_BASE}
        return {"connected": True, "base": c.get("base"), "token_hint": c.get("token_hint"), "since": c.get("connected")}


def handle_rnd(rnd, ws, handler, q, method, logkit):
    g = lambda k, d="": (q.get(k) or [d])[0]
    op = g("op")
    u = getattr(handler, "auth_user", None)
    if not u:
        return handler._json(401, {"ok": False, "error": "no_session", "message": "로그인이 필요해요."})
    uid = u["id"]
    ip = auth_api.client_ip(handler)
    fail = lambda r: handler._json(502, {"ok": False, "message": ((r or {}).get("error") or {}).get("message") or "연구행정관리시스템 오류", "code": ((r or {}).get("error") or {}).get("code")})
    need = lambda: handler._json(409, {"ok": False, "error": "not_connected", "message": "연구행정관리시스템이 연결되지 않았어요."})
    pid = g("pid")
    if pid and not re.match(r"^[A-Za-z0-9_\-]{1,64}$", pid):
        return handler._json(400, {"ok": False, "message": "잘못된 프로젝트 id"})
    if method == "GET":
        if op == "status":
            return handler._json(200, dict(RndAdmin.public(rnd.conf(uid)), ok=True, localToken=vfs.isfile(os.path.join(HUB_DIR, "admin.json"))))
        if not rnd.conf(uid).get("token"):
            return need()
        if op == "projects":
            r = rnd.call(uid, "GET", "/rnd/projects", query={"limit": 200, "q": g("q") or None})
            return handler._json(200, {"ok": True, "list": r.get("data") or []}) if r.get("ok") else fail(r)
        if op == "schema":          # GET /rnd — 항목 정의(허용값은 여기서 읽는다)
            r = rnd.call(uid, "GET", "/rnd")
            return handler._json(200, {"ok": True, "data": r.get("data") or {}}) if r.get("ok") else fail(r)
        if op == "check":           # 규정 점검 결과 — 과제 진단이 근거로 쓴다
            rid = ((ws.project_meta(uid, pid) or {}).get("rnd") or {}).get("id")
            if not rid:
                return handler._json(409, {"ok": False, "error": "not_linked", "message": "이 프로젝트가 연구행정 과제와 연결되지 않았어요."})
            r = rnd.call(uid, "GET", "/rnd/projects/" + rid + "/check")
            return handler._json(200, {"ok": True, "data": r.get("data") or {}}) if r.get("ok") else fail(r)
        if op == "bundle":
            meta = (ws.project_meta(uid, pid) or {}) if pid else {}
            rid = g("rid") or ((meta.get("rnd") or {}).get("id"))
            if not rid or not re.match(r"^[A-Za-z0-9_\-]{1,64}$", rid):
                return handler._json(409, {"ok": False, "error": "not_linked", "message": "이 프로젝트가 연구행정 과제와 연결되지 않았어요."})
            r = rnd.call(uid, "GET", "/rnd/projects/" + rid + "/bundle")
            logkit.activity("rnd.bundle", user=uid, ip=ip, src="server", pid=pid or None, ok=bool(r.get("ok")))
            return handler._json(200, {"ok": True, "bundle": r.get("data") or {}}) if r.get("ok") else fail(r)
        return handler._json(404, {"ok": False, "message": "없는 동작"})
    if method != "POST" or handler.headers.get("X-Study-Vault") != "1":
        return handler._json(403, {"ok": False, "message": "헤더 없음"})
    b = auth_api.body_json(handler, 256 * 1024) or {}
    if op == "connect":
        pub, err = rnd.connect(uid, b.get("base"), b.get("token"))
        logkit.audit("rndadmin_connect", ok=not err, user=uid, ip=ip, base=b.get("base"), reason=err)
        return handler._json(200 if pub else 400, dict(pub or {}, ok=bool(pub), message=err))
    if op == "import_local":      # 규격 9장 — 같은 PC 공용 폴더(hubdir)의 admin.json 을 읽어 암호화 보관한 뒤 파일을 지운다
        if u.get("role") != "admin":
            return handler._json(403, {"ok": False, "message": "관리자만 할 수 있어요."})
        p = os.path.join(HUB_DIR, "admin.json")
        d = _read(p)
        if not d or not d.get("token"):
            return handler._json(404, {"ok": False, "message": "토큰 파일이 없어요(" + p + ")."})
        pub, err = rnd.connect(uid, d.get("base"), d.get("token"))
        logkit.audit("rndadmin_import", ok=not err, user=uid, ip=ip, reason=err)
        if pub:
            try:
                vfs.remove(p)
            except OSError:
                pass
        return handler._json(200 if pub else 400, dict(pub or {}, ok=bool(pub), message=err))
    if op == "disconnect":
        try:
            vfs.remove(rnd.path(uid))
        except OSError:
            pass
        logkit.audit("rndadmin_disconnect", user=uid, ip=ip)
        return handler._json(200, {"ok": True})
    if not rnd.conf(uid).get("token"):
        return need()
    if op == "link":
        meta = ws.project_meta(uid, pid)
        rid = str(b.get("rndId") or "")
        if not meta or not re.match(r"^[A-Za-z0-9_\-]{1,64}$", rid):
            return handler._json(400, {"ok": False, "message": "프로젝트 또는 과제 id 가 잘못됐어요."})
        rr = rnd.call(uid, "GET", "/rnd/projects/" + rid)
        if not rr.get("ok"):
            return fail(rr)
        pr = rr.get("data") or {}
        ws.save_project(uid, dict(meta, id=pid, rnd={"id": rid, "code": pr.get("code"), "name": pr.get("name")}))
        # 연결 정보의 주인은 admin(규격 2장) — 쓰기 권한이 없거나 실패해도 이쪽 연결은 유지하고 화면에 알린다
        w = rnd.call(uid, "PATCH", "/rnd/projects/" + rid, body={"links": {"slc": {"pid": pid, "name": meta.get("name")}}})
        logkit.activity("rnd.link", user=uid, ip=ip, src="server", pid=pid, rid=rid, back=bool(w.get("ok")))
        return handler._json(200, {"ok": True, "project": pr, "linkedBack": bool(w.get("ok")), "linkMessage": None if w.get("ok") else ((w.get("error") or {}).get("message"))})
    if op == "unlink":
        meta = ws.project_meta(uid, pid)
        if not meta:
            return handler._json(404, {"ok": False, "message": "프로젝트 없음"})
        ws.save_project(uid, dict(meta, id=pid, rnd=None))
        logkit.activity("rnd.unlink", user=uid, ip=ip, src="server", pid=pid)
        return handler._json(200, {"ok": True})
    if op == "planput":           # 과제 정보의 주인은 연구행정 — 사용자가 화면에서 확인한 뒤에만 온다
        meta = ws.project_meta(uid, pid)
        rid = ((meta or {}).get("rnd") or {}).get("id")
        if not rid:
            return handler._json(409, {"ok": False, "error": "not_linked", "message": "이 프로젝트가 연구행정 과제와 연결되지 않았어요."})
        plan = b.get("plan")
        if not isinstance(plan, dict):
            return handler._json(400, {"ok": False, "message": "과제 정보 형식이 아니에요."})
        body = {"plan": plan, "note": str(b.get("note") or "ScholarFlow에서 수정")[:200]}
        if b.get("ifUpdatedAt"):      # 그사이 연구행정에서 바뀌었으면 덮어쓰지 않는다
            body["ifUpdatedAt"] = str(b["ifUpdatedAt"])[:40]
        r = rnd.call(uid, "PUT", "/rnd/projects/" + rid + "/plan", body=body)
        logkit.activity("rnd.planput", user=uid, ip=ip, src="server", pid=pid, rid=rid, ok=bool(r.get("ok")))
        return handler._json(200, {"ok": True}) if r.get("ok") else fail(r)
    if op == "meeting":           # 회의록 등록 — 사용자가 확인한 뒤에만 온다. extRef 가 같으면 고친다
        meta = ws.project_meta(uid, pid)
        rid = ((meta or {}).get("rnd") or {}).get("id")
        if not rid:
            return handler._json(409, {"ok": False, "error": "not_linked", "message": "이 프로젝트가 연구행정 과제와 연결되지 않았어요."})
        mid = str(b.get("meetingId") or "")
        if not re.match(r"^[A-Za-z0-9_\-]{1,64}$", mid):
            return handler._json(400, {"ok": False, "message": "회의 id 가 잘못됐어요."})
        body = {"projectId": rid, "title": str(b.get("title") or "회의")[:300], "date": str(b.get("date") or time.strftime("%Y-%m-%d"))[:10], "attendees": str(b.get("attendees") or "")[:500],
                "minutes": str(b.get("minutes") or "")[:20000], "actions": str(b.get("actions") or "")[:8000], "extRef": "slc:%s:meet-%s" % (pid, mid)}
        r = rnd.call(uid, "POST", "/rnd/meetings", body=body)
        logkit.activity("rnd.meeting", user=uid, ip=ip, src="server", pid=pid, ok=bool(r.get("ok")))
        return handler._json(200, {"ok": True, "meta": r.get("meta") or {}}) if r.get("ok") else fail(r)
    if op == "output":            # 규격 4.2 — 사용자가 화면에서 확인한 뒤에만 온다. extRef 가 같으면 admin 이 새로 만들지 않고 고친다
        meta = ws.project_meta(uid, pid)
        rid = ((meta or {}).get("rnd") or {}).get("id")
        if not rid:
            return handler._json(409, {"ok": False, "error": "not_linked", "message": "이 프로젝트가 연구행정 과제와 연결되지 않았어요."})
        doc = str(b.get("docId") or "")
        if not re.match(r"^[A-Za-z0-9_\-]{1,64}$", doc):
            return handler._json(400, {"ok": False, "message": "문서 id 가 잘못됐어요."})
        body = {"projectId": rid, "type": str(b.get("type") or "보고서")[:30], "title": str(b.get("title") or "")[:300], "date": str(b.get("date") or time.strftime("%Y-%m-%d"))[:10],
                "status": str(b.get("status") or "작성중")[:30], "extRef": "slc:%s:%s" % (pid, doc), "source": {"system": "slc", "url": str(b.get("url") or "")[:500]}}
        r = rnd.call(uid, "POST", "/rnd/outputs", body=body)
        logkit.activity("rnd.output", user=uid, ip=ip, src="server", pid=pid, doc=doc, ok=bool(r.get("ok")))
        return handler._json(200, {"ok": True, "output": r.get("data"), "meta": r.get("meta") or {}, "extRef": body["extRef"]}) if r.get("ok") else fail(r)
    return handler._json(404, {"ok": False, "message": "없는 동작"})


# =============================================================== 서비스 토큰
class Hub:
    def __init__(self, data_dir, auth, llm, ws, port):
        self.path = os.path.join(data_dir, "system", "hub.json")
        self.auth, self.llm, self.ws, self.port = auth, llm, ws, port
        self.lock = threading.Lock()

    def load(self):
        d = _read(self.path) or {}
        d.setdefault("enabled", False)
        d.setdefault("tokens", [])
        return d

    def save(self, d):
        _atomic(self.path, d)

    def public(self):
        d = self.load()
        return {"enabled": bool(d["enabled"]), "base": SLC_BASE % self.port, "file": os.path.join(HUB_DIR, "slc.json"),
                "tokens": [{k: t.get(k) for k in ("id", "hint", "owner", "name", "created", "last_used", "calls")} for t in d["tokens"]]}

    def mint(self, owner, name, scope="read"):
        """토큰을 만들어 값을 돌려준다(계정 연동용 — 파일에 쓰지 않는다). 해시만 저장한다."""
        tok = "slc_" + secrets.token_hex(24)
        tid = "t" + secrets.token_hex(4)
        with self.lock:
            d = self.load()
            d["tokens"].append({"id": tid, "hash": hashlib.sha256(tok.encode()).hexdigest(), "hint": tok[:8] + "…" + tok[-4:], "owner": owner, "scope": scope, "name": str(name or "연구 허브")[:60],
                                "created": _now(), "last_used": 0, "calls": 0})
            self.save(d)
        return tok, tid

    def issue(self, owner, name):
        tok, tid = self.mint(owner, name)
        _atomic(os.path.join(HUB_DIR, "slc.json"), {"system": "slc", "base": SLC_BASE % self.port, "token": tok, "scope": "read", "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S")})
        return tid

    def revoke(self, tid):
        with self.lock:
            d = self.load()
            n = len(d["tokens"])
            d["tokens"] = [t for t in d["tokens"] if t["id"] != tid]
            self.save(d)
            return len(d["tokens"]) < n

    def check(self, tok):
        if not tok or not tok.startswith("slc_"):
            return None
        h = hashlib.sha256(tok.encode()).hexdigest()
        with self.lock:
            d = self.load()
            for t in d["tokens"]:
                if hmac.compare_digest(t["hash"], h):
                    t["last_used"] = _now()
                    t["calls"] = int(t.get("calls") or 0) + 1
                    self.save(d)
                    return dict(t)
        return None

    def user(self, uid):
        for u in self.auth._users()["users"]:
            if u.get("id") == uid and u.get("status") != "locked":
                return u
        return None


class _OpenAiOut:
    """llm_api.chat 의 응답을 OpenAI 모양으로 — 오류는 {error:{message}}, 성공은 그대로(필요한 칸만 채움)."""

    def __init__(self, h):
        self._h = h

    def __getattr__(self, k):
        return getattr(self._h, k)

    def _json(self, code, obj, headers=None):
        if code >= 400 or (isinstance(obj, dict) and obj.get("ok") is False):
            return self._h._json(code if code >= 400 else 502, {"error": {"message": str((obj or {}).get("message") or "AI 호출 실패"), "type": "gateway_error", "code": (obj or {}).get("error")}})
        if isinstance(obj, dict) and "choices" in obj:
            obj.setdefault("id", "chatcmpl-" + secrets.token_hex(8))
            obj.setdefault("object", "chat.completion")
            obj.setdefault("created", int(time.time()))
        return self._h._json(code, obj, headers)


TOK_RE = re.compile(r"[0-9A-Za-z가-힣]{2,}")


def _terms(q):
    out = set()
    for w in TOK_RE.findall(q.lower()):
        out.add(w)
        if re.search(r"[가-힣]", w) and len(w) > 2:
            out.update(w[i:i + 2] for i in range(len(w) - 1))
    return out


def search_project(ws, uid, pid, q, k=8, budget_s=8.0):
    """프로젝트 자료에서 쪽 단위로 찾아 근거 문장·출처·쪽을 돌려준다. 파일을 고치지 않는다."""
    terms = _terms(q)
    if not terms:
        return []
    meta = ws.project_meta(uid, pid) or {}
    docs = [(f["id"], f.get("name") or f["id"]) for f in ws.files(uid, pid) if f.get("chars")]
    if meta.get("source"):
        hide = (meta.get("hidden") or []) + (meta.get("removed") or [])
        try:
            for x in ws.tree(uid, pid).get("list") or []:
                if x.get("doc") and not any(x["rel"] == h or x["rel"].startswith(h + "/") for h in hide):
                    docs.append((x["id"], x["rel"]))
        except Exception:
            pass
    t0 = time.time()
    hits = []
    for fid, name in docs[:300]:
        if time.time() - t0 > budget_s:
            break
        try:
            text = ws.file_text(uid, pid, fid) or ""
        except Exception:
            continue
        for pg, body in _pages(text):
            for sent in re.split(r"(?<=[.!?。])\s+|\n{1,}", body):
                s = sent.strip()
                if len(s) < 12:
                    continue
                low = s.lower()
                score = sum((2 if len(t) > 2 else 1) for t in terms if t in low)
                if score >= max(2, min(4, len(terms))):
                    hits.append({"score": score, "text": s[:400], "source": name, "fid": fid, "page": pg})
    hits.sort(key=lambda h: -h["score"])
    seen, out = set(), []
    for h in hits:
        key = (h["fid"], h["text"][:80])
        if key in seen:
            continue
        seen.add(key)
        out.append(h)
        if len(out) >= k:
            break
    return out


def _pages(text):
    parts = re.split(r"\[p\.(\d+)\]", text)
    if len(parts) < 3:
        return [(None, text)]
    return [(int(parts[i]), parts[i + 1]) for i in range(1, len(parts) - 1, 2)]


def handle_hub(hub, handler, path, method, logkit):
    """/v1/* — slc_ 토큰 + 이 PC 안에서 온 요청만."""
    err = lambda code, msg, typ="invalid_request_error": handler._json(code, {"error": {"message": msg, "type": typ}})
    ip = handler.client_address[0]
    if auth_api.is_remote(handler):
        logkit.warn("security", "연구 허브 API 외부 접근 거절", ip=auth_api.client_ip(handler), path=path)
        return err(403, "이 API 는 서버 PC 안에서만 쓸 수 있어요.", "forbidden")
    if handler.headers.get("Origin"):
        return err(403, "브라우저에서는 쓸 수 없어요.", "forbidden")
    tok = re.sub(r"^(?i:bearer)\s+", "", (handler.headers.get("Authorization") or handler.headers.get("X-API-Key") or "").strip())
    t = hub.check(tok)
    if not t:
        logkit.warn("security", "연구 허브 토큰 거절", ip=ip, path=path)
        return err(401, "서비스 토큰이 맞지 않아요.", "invalid_api_key")
    if not hub.load()["enabled"]:
        return err(503, "AI 게이트웨이가 꺼져 있어요. ScholarFlow [연구지원 관리]에서 켜 주세요.", "gateway_disabled")
    u = hub.user(t["owner"])
    if not u:
        return err(403, "토큰 주인 계정을 쓸 수 없어요.", "forbidden")
    from urllib.parse import urlsplit, parse_qs
    qs = parse_qs(urlsplit(handler.path).query)
    g = lambda k, d="": (qs.get(k) or [d])[0]
    log = lambda what, **kw: logkit.activity("hub." + what, user=u["id"], ip=ip, src="server", token=t["id"], **kw)
    if path == "/v1/models" and method == "GET":
        sc, p = hub.llm.active(u)
        return handler._json(200, {"object": "list", "data": ([{"id": p.get("model") or p["id"], "object": "model", "owned_by": "slc"}] if p else [])})
    if path == "/v1/chat/completions" and method == "POST":
        b = auth_api.body_json(handler, llm_api.MAX_BODY)
        if not isinstance(b, dict) or not isinstance(b.get("messages"), list) or not b["messages"]:
            return err(400, "messages 가 없어요.")
        opts = {"stream": bool(b.get("stream")), "temperature": b.get("temperature"), "maxTokens": b.get("max_tokens") or b.get("max_completion_tokens")}
        log("chat", n=len(b["messages"]), stream=opts["stream"])
        return llm_api.chat(hub.llm, _OpenAiOut(handler), u, {"messages": b["messages"], "opts": opts}, "hub:" + t["id"])
    if path == "/v1/projects" and method == "GET":
        lst = hub.ws.projects(u["id"])
        return handler._json(200, {"ok": True, "data": [{"pid": p["id"], "name": p.get("name"), "rndId": (p.get("rnd") or {}).get("id"), "url": "http://127.0.0.1:%d/#/p/%s" % (hub.port, p["id"])} for p in lst if not p.get("archived")]})
    if path == "/v1/search" and method == "GET":
        pid, q = g("pid"), g("q")[:300]
        if not re.match(r"^[A-Za-z0-9_\-]{1,64}$", pid or "") or not q.strip():
            return err(400, "pid 와 q 가 필요해요.")
        if not hub.ws.project_meta(u["id"], pid):
            return err(404, "프로젝트가 없어요.")
        try:
            k = max(1, min(30, int(g("k") or 8)))
        except ValueError:
            k = 8
        hits = search_project(hub.ws, u["id"], pid, q, k)
        log("search", pid=pid, n=len(hits))
        return handler._json(200, {"ok": True, "data": [{"text": h["text"], "source": h["source"], "page": h["page"], "url": "http://127.0.0.1:%d/#/p/%s/src/%s%s" % (hub.port, pid, h["fid"], ("/" + str(h["page"])) if h["page"] else "")} for h in hits]})
    return err(404, "없는 경로예요.")


def handle_hubadmin(hub, handler, op, b, logkit, ip):
    """관리자 화면용(r=rnd 와 달리 slc_ 토큰이 아니라 로그인 세션). serve.py _admin 쪽에서 부른다."""
    u = handler.auth_user
    if op == "status":
        return handler._json(200, dict(hub.public(), ok=True))
    if op == "enable":
        with hub.lock:
            d = hub.load()
            d["enabled"] = bool(b.get("on"))
            hub.save(d)
        logkit.audit("hub_gateway", user=u["id"], ip=ip, on=bool(b.get("on")))
        return handler._json(200, dict(hub.public(), ok=True))
    if op == "issue":
        tid = hub.issue(u["id"], b.get("name"))
        logkit.audit("hub_token_issue", user=u["id"], ip=ip, token=tid)
        return handler._json(200, dict(hub.public(), ok=True))
    if op == "revoke":
        ok = hub.revoke(str(b.get("id") or ""))
        logkit.audit("hub_token_revoke", user=u["id"], ip=ip, token=b.get("id"), ok=ok)
        return handler._json(200, dict(hub.public(), ok=ok))
    return handler._json(404, {"ok": False, "message": "없는 동작"})
