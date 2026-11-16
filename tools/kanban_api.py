# -*- coding: utf-8 -*-
"""FlowBoard(칸반 업무관리) 연동(v93) — serve.py 가 api.php?r=kb&op=… 로 넘겨준다.

FlowBoard REST v1 (https://service.example.com/tcc/api.php/v1/…)
  인증 = 개인 API 토큰 'fbt_…' (FlowBoard 설정 › 계정 › API 토큰에서 발급, 한 번만 보임) → Authorization: Bearer / X-API-Key
  에픽 = type:"Epic" 카드, 하위 작업 = parentId 가 그 에픽 id 인 카드. 보드 = project(KEY).
이 서버가 대신 호출한다(토큰은 계정별로 서버에 암호화 보관 — 브라우저로 내려가지 않음).
  users/<uid>/kanban.json  {base, token:{암호문}, token_hint, me:{username,name}, connected}
op: status · connect(POST {base, token}) · disconnect(POST) · boards · epics(&project=) · epic(&ref=) · comment(POST {ref, text})
"""
import safeio   # (v140) 정전 대비 쓰기(임시 파일 → fsync → 바꾸기)
import vfs      # noqa: E402  (v151) SQLite 엔진이면 데이터 폴더의 .json·.jsonl 은 DB — 아래 open·exists 등은 vfs 판
open = vfs.open  # noqa: A001
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_BASE = "https://service.example.com/tcc/api.php/v1"
UA = "StudyCenter/1.0 (+local)"


def _read(p):
    try:
        with open(p, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def _atomic(p, obj):
    safeio.atomic_json(p, obj, indent=1)


class Kanban:
    def __init__(self, data_dir, box):
        self.dir = data_dir
        self.box = box                      # llm_api.SecretBox (system/secret.key)
        self._cache = {}

    def path(self, uid):
        return os.path.join(self.dir, "users", uid, "kanban.json")

    def conf(self, uid):
        return _read(self.path(uid)) or {}

    def _token(self, uid, c=None):
        c = c or self.conf(uid)
        return self.box.open(c["token"], "kanban|" + uid) if c.get("token") else ""

    def call(self, uid, method, path, body=None, query=None, conf=None, token=None):
        c = conf or self.conf(uid)
        base = (c.get("base") or DEFAULT_BASE).rstrip("/")
        url = base + path + (("?" + urllib.parse.urlencode({k: v for k, v in (query or {}).items() if v not in (None, "")})) if query else "")
        tok = token if token is not None else self._token(uid, c)
        h = {"Accept": "application/json", "User-Agent": UA, "Authorization": "Bearer " + tok, "X-API-Key": tok}
        data = None
        if body is not None:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8"); h["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, headers=h, method=method)
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except urllib.error.HTTPError as e:
            try:
                d = json.loads(e.read().decode("utf-8", "replace"))
            except ValueError:
                d = {}
            err = (d.get("error") or {}) if isinstance(d, dict) else {}
            return {"ok": False, "status": e.code, "error": {"code": err.get("code") or ("http_%d" % e.code), "message": err.get("message") or ("HTTP %d" % e.code)}}
        except Exception as e:
            return {"ok": False, "error": {"code": "unreachable", "message": "FlowBoard 에 연결하지 못했어요: " + str(e)[:140]}}

    def connect(self, uid, base, token):
        base = (base or DEFAULT_BASE).strip().rstrip("/")
        if not base.startswith("https://") and not base.startswith("http://"):
            return None, "주소는 https://… 로 넣어 주세요."
        token = re.sub(r"^(?i:bearer)\s+", "", token.strip().strip('"').strip("'")).strip()   # 'Bearer fbt_…'·따옴표·공백 붙여 넣기 허용
        if not re.match(r"^fbt_[a-f0-9]{48}$", token):
            hint = ("fbt_ 로 시작하지 않아요" if not token.startswith("fbt_") else "fbt_ 뒤가 16진수 48자가 아니에요(지금 %d자)" % (len(token) - 4))
            return None, ("FlowBoard API 토큰이 아니에요 — %s. 토큰은 'fbt_' + 16진수 48자(모두 52자)예요. FlowBoard › 설정 › 계정 › API 토큰에서 [새 토큰]을 만들면 "
                          "한 번만 보여 주는 값을 그대로 복사해 넣으세요(목록에 보이는 앞자리·다른 화면의 값은 안 돼요). 지금 넣은 값: %d자." % (hint, len(token)))
        me = self.call(uid, "GET", "/me", conf={"base": base}, token=token)
        if not me.get("ok"):
            return None, "토큰을 확인하지 못했어요: " + ((me.get("error") or {}).get("message") or "")
        d = me.get("data") or {}
        u = d.get("user") or d
        c = {"base": base, "token": self.box.seal(token, "kanban|" + uid), "token_hint": token[:6] + "…" + token[-4:],
             "me": {"username": u.get("username"), "name": u.get("name")}, "connected": int(time.time() * 1000)}
        _atomic(self.path(uid), c)
        return self.public(c), None

    @staticmethod
    def public(c):
        if not c or not c.get("token"):
            return {"connected": False, "base": DEFAULT_BASE}
        return {"connected": True, "base": c.get("base"), "token_hint": c.get("token_hint"), "me": c.get("me"), "since": c.get("connected")}

    def issues(self, uid, query, cap=1000):
        out, off = [], 0
        while len(out) < cap:
            q = dict(query, limit=200, offset=off, compact=1)
            r = self.call(uid, "GET", "/issues", query=q)
            if not r.get("ok"):
                return None, r
            out += r.get("data") or []
            nxt = (r.get("meta") or {}).get("nextOffset")
            if nxt is None:
                break
            off = nxt
        return out, None


def _issue(x):
    """칸반 이슈 한 건을 화면이 쓰는 모양으로. status·assignee 는 객체로 온다."""
    st, who = x.get("status"), x.get("assignee")
    return {"key": x.get("key"), "title": x.get("title"), "webUrl": x.get("webUrl") or "", "publicUrl": x.get("publicUrl") or "",
            "status": (st.get("name") if isinstance(st, dict) else st) or "", "assignee": (who.get("name") if isinstance(who, dict) else who) or ""}


def _sync(kb, uid, svc):
    link = getattr(kb, "link", None)
    if not link:
        return {"added": 0}
    f = os.path.join(kb.dir, "users", uid, "issue-since.json")
    since, added = int((_read(f) or {}).get("since") or 0), 0
    for _ in range(20):      # 한 번에 너무 오래 끌지 않는다. 남은 것은 다음에 이어서
        r = kb.call(uid, "GET", "/hub/issue-events", query={"system": "slc", "since": since}, **svc)
        if not r.get("ok"):
            return {"added": added, "message": ((r.get("error") or {}).get("message") or "")}
        rows, nxt = r.get("data") or [], (r.get("meta") or {}).get("nextSince")
        for ev in rows:
            if isinstance(ev, dict) and link.issue_event(uid, ev)[0] == 201:
                added += 1
        if nxt is None or int(nxt) <= since:
            break
        since = int(nxt)
        _atomic(f, {"since": since})
        if not rows:
            break
    return {"added": added}


def _service(kb, uid):
    """이슈 연결에 쓸 연결: 계정 연동으로 받은 토큰이 먼저, 없으면 직접 넣은 FlowBoard 토큰.
    직접 넣은 주소는 예전 서버일 수 있어 이슈 연결 API 가 없을 수 있다."""
    link = getattr(kb, "link", None)
    tok = link.token_for(uid, "kanban") if link else ""
    if tok:
        return {"conf": {"base": __import__("hublink_api").web("kanban") + "/api.php/v1"}, "token": tok}
    return {} if kb.conf(uid).get("token") else None


def handle_issue(kb, ws, handler, q, method, logkit):
    """이슈 연결(13.1). 이슈 내용의 주인은 칸반이고, 여기는 연결과 기록만 맡는다."""
    g = lambda k, d="": (q.get(k) or [d])[0]
    op, pid = g("op"), g("pid")
    u = handler.auth_user
    uid = u["id"]
    svc = _service(kb, uid)
    if svc is None:
        return handler._json(409, {"ok": False, "error": "not_connected", "message": "업무관리가 연결되지 않았어요. 시스템 연동이나 연구지원 설정에서 연결하세요."})
    fail = lambda r: handler._json(502, {"ok": False, "message": ((r or {}).get("error") or {}).get("message") or "업무관리 오류"})
    meta = ws.project_meta(uid, pid)
    if not meta:
        return handler._json(404, {"ok": False, "message": "프로젝트 없음"})
    if method == "GET" and op == "issues":
        r = kb.call(uid, "GET", "/issues", query={"q": g("q") or None, "project": g("project") or None, "limit": 20}, **svc)
        return handler._json(200, {"ok": True, "list": [_issue(x) for x in (r.get("data") or []) if isinstance(x, dict)]}) if r.get("ok") else fail(r)
    if method == "GET" and op == "issue_sync":   # 13.5 받지 못한 변화를 가져온다. seq 로 거르므로 두 번 받아도 한 번만 남는다
        return handler._json(200, dict(_sync(kb, uid, svc), ok=True))
    if method != "POST" or handler.headers.get("X-Study-Vault") != "1":
        return handler._json(403, {"ok": False, "message": "헤더 없음"})
    n = int(handler.headers.get("Content-Length") or 0)
    b = json.loads(handler.rfile.read(n).decode("utf-8", "replace") or "{}") if 0 < n < 262144 else {}
    link = getattr(kb, "link", None)   # 칸반은 http(s) 주소만 받는다. 어디서 열어도 되도록 공개 주소로
    url_ = (link.public("slc") if link else "http://127.0.0.1:18162") + "/#/p/" + pid
    def attach(key, title, web, pub=""):
        r = kb.call(uid, "POST", "/hub/issue-links", body={"key": key, "system": "slc", "ref": pid, "title": str(meta.get("name") or ""), "url": url_}, **svc)
        if not r.get("ok"):
            return None, r
        d = r.get("data") or {}
        items = [x for x in (meta.get("issues") or []) if x.get("key") != key] + [{"id": d.get("id"), "key": key, "title": title, "url": web, "publicUrl": pub}]
        ws.save_project(uid, dict(meta, id=pid, issues=items))
        ws._log(uid, pid, {"kind": "issue", "action": "link", "key": key, "title": (key + " " + str(title))[:200]})
        return items, None
    if op == "issue_link":
        key = str(b.get("key") or "")[:40]
        if not re.match(r"^[A-Za-z0-9_\-]{1,40}$", key):
            return handler._json(400, {"ok": False, "message": "이슈 키가 잘못됐어요."})
        items, err = attach(key, str(b.get("title") or "")[:200], str(b.get("url") or "")[:300], str(b.get("publicUrl") or "")[:300])
        return handler._json(200, {"ok": True, "issues": items}) if not err else fail(err)
    if op == "issue_new":
        title = str(b.get("title") or "").strip()[:200]
        if not title:
            return handler._json(400, {"ok": False, "message": "이슈 제목을 넣어 주세요."})
        r = kb.call(uid, "POST", "/issues", body={"project": str(b.get("project") or "")[:40], "title": title, "description": str(b.get("description") or "")[:4000], "extRef": "slc:%s:%s" % (pid, re.sub(r"\W+", "-", title)[:40])}, **svc)
        if not r.get("ok"):
            return fail(r)
        d = r.get("data") or {}
        items, err = attach(str(d.get("key") or ""), title, str(d.get("webUrl") or ""), str(d.get("publicUrl") or ""))
        return handler._json(200, {"ok": True, "issues": items, "key": d.get("key")}) if not err else fail(err)
    if op == "issue_unlink":
        lid = str(b.get("id") or "")
        if lid:
            r = kb.call(uid, "DELETE", "/hub/issue-links/" + urllib.parse.quote(lid), **svc)
            if not r.get("ok") and r.get("status") != 404:
                return fail(r)
        items = [x for x in (meta.get("issues") or []) if x.get("id") != lid]
        ws.save_project(uid, dict(meta, id=pid, issues=items))
        return handler._json(200, {"ok": True, "issues": items})
    return handler._json(404, {"ok": False, "message": "없는 동작"})


def handle(kb, handler, q, method, logkit):
    g = lambda k, d="": (q.get(k) or [d])[0]
    op = g("op")
    u = getattr(handler, "auth_user", None)
    if not u:
        return handler._json(401, {"ok": False, "error": "no_session", "message": "로그인이 필요해요."})
    uid = u["id"]
    ip = handler.client_address[0]
    fail = lambda r: handler._json(502, {"ok": False, "message": ((r or {}).get("error") or {}).get("message") or "FlowBoard 오류", "code": ((r or {}).get("error") or {}).get("code")})
    if method == "GET":
        if op == "status":
            return handler._json(200, dict(Kanban.public(kb.conf(uid)), ok=True))
        if not kb.conf(uid).get("token"):
            return handler._json(409, {"ok": False, "error": "not_connected", "message": "FlowBoard 가 연결되지 않았어요."})
        if op == "boards":
            r = kb.call(uid, "GET", "/projects")
            return handler._json(200, {"ok": True, "list": r.get("data") or []}) if r.get("ok") else fail(r)
        if op == "epics":
            lst, err = kb.issues(uid, {"project": g("project"), "type": "Epic", "sort": g("sort") or None})
            if err:
                return fail(err)
            return handler._json(200, {"ok": True, "list": lst})
        if op == "epic":
            ref = g("ref")
            r = kb.call(uid, "GET", "/issues/" + urllib.parse.quote(ref))
            if not r.get("ok"):
                return fail(r)
            ep = r.get("data") or {}
            kids, err = kb.issues(uid, {"project": ep.get("projectKey")}, cap=2000)
            kids = [k for k in (kids or []) if str(k.get("parentId")) == str(ep.get("id"))]
            return handler._json(200, {"ok": True, "epic": ep, "children": kids})
        return handler._json(404, {"ok": False, "message": "없는 동작"})
    if method != "POST" or handler.headers.get("X-Study-Vault") != "1":
        return handler._json(403, {"ok": False, "message": "헤더 없음"})
    n = int(handler.headers.get("Content-Length") or 0)
    try:
        b = json.loads(handler.rfile.read(n).decode("utf-8", "replace")) if 0 < n < 256 * 1024 else {}
    except ValueError:
        b = {}
    if op == "connect":
        pub, err = kb.connect(uid, b.get("base"), str(b.get("token") or "").strip())
        logkit.audit("kanban_connect", ok=not err, user=uid, ip=ip, base=b.get("base"), reason=err)
        return handler._json(200 if pub else 400, dict(pub or {}, ok=bool(pub), message=err))
    if op == "disconnect":
        try:
            vfs.remove(kb.path(uid))
        except OSError:
            pass
        logkit.audit("kanban_disconnect", user=uid, ip=ip)
        return handler._json(200, {"ok": True})
    if op == "comment":
        r = kb.call(uid, "POST", "/issues/" + urllib.parse.quote(str(b.get("ref") or "")) + "/comments", body={"text": str(b.get("text") or "")[:20000]})
        logkit.activity("kanban.comment", user=uid, ip=ip, src="server", ref=b.get("ref"), ok=bool(r.get("ok")))
        return handler._json(200, {"ok": True, "comment": r.get("data")}) if r.get("ok") else fail(r)
    return handler._json(404, {"ok": False, "message": "없는 동작"})
