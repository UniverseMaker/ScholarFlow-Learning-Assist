# -*- coding: utf-8 -*-
"""계정 데이터 실시간 저장소(v93) — serve.py 가 api.php?r=kv&op=… 로 넘겨준다.

왜: 예전(v90~v92)에는 앱 상태가 브라우저(localStorage)에 먼저 쌓이고, 몇 초 뒤 통째로 서버에 '거울'·'상태 사본'을 올렸다.
    백엔드가 있는데 저장이 늦고 통째로 덮는 구조라, 이제는 **바뀌는 순간 그 항목 하나만 서버에 바로 저장**한다.
    서버가 기준이고 브라우저는 캐시다 — 로그인하면 서버 것을 받아 화면을 그린다.

저장 구조  <DATA_DIR>/users/<uid>/kv/
  <h>.json        항목 하나 {k, v, t, dev}  (h = sha1(키) 앞 24자) — 원자적 교체, 지우면 v:null 묘비(다른 기기가 지운 걸 알 수 있게)
  <h>.prev.json   바로 이전 값(한 단계 되돌리기용)
  (v93) 위치는 영역별 폴더(ROUTES) — study/ · library/<문서>/ · projects/<pid>/ · tools/ · ui/ (README.md 참고)
  _journal.jsonl  추가만 하는 변경 일지 {t, op, k, n(바이트), dev} — 값은 담지 않는다(감사·추적용)
  ../kvsnap/YYYYMMDD.json   하루 첫 쓰기 직전의 전체 사본(그 전날 마지막 상태) — 60개 보관, [계정·보안]에서 되돌리기
키 형식: "u:<접미사>" = 내 계정 데이터(study.user.<id>.<접미사>), "g:<키>" = 화면 상태 등 전역 키. 값은 브라우저 문자열 그대로.
op: all(GET) · since(GET &t=) · put(POST {dev, ops:[{k, v|null}]}) · info · snaps · restore(POST {name}) · archive(POST {dev, items})
"""
import safeio   # (v140) 정전 대비 쓰기(임시 파일 → fsync → 바꾸기)
import hashlib
import json
import os
import re
import threading
import time
from datetime import datetime

KEY_RE = re.compile(r"^[ug]:[^\x00-\x1f]{1,200}$")
MAX_VALUE = 8 * 1024 * 1024
MAX_BATCH = 24 * 1024 * 1024
KEEP_SNAPS = 60
_locks = {}
_glock = threading.Lock()


def _now():
    return int(time.time() * 1000)


def _lock_for(uid):
    with _glock:
        return _locks.setdefault(uid, threading.RLock())


def _atomic(path, obj):
    safeio.atomic_json(path, obj)


def _read(path):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


# ---- (v93) 키 → 사람이 읽을 수 있는 폴더 경로(영역별 정리) ----
#   users/<uid>/study/…            설정·표시·학습 자료 읽기 상태
#   users/<uid>/library/<문서id>/  학습 자료 하나의 내 데이터(노트·형광펜·북마크·읽은 시간·문답) + library/_folders(학습 폴더)
#   users/<uid>/projects/<pid>/    연구 프로젝트 폴더 안에 메모·할 일·참고문헌(자료·문서·이력과 같은 폴더)
#   users/<uid>/tools/ · ui/       공용 도구(뽀모도로 등) · 화면 상태
ROUTES = [
    (re.compile(r"^g:study\.reader\.hl\.(.+)$"), "library/{0}/highlights"),
    (re.compile(r"^g:study\.reader\.time\.(.+)$"), "library/{0}/reading-time"),
    (re.compile(r"^u:tk\.lib\.(notes|bm|socr|meta)\.(.+)$"), "library/{1}/{0}"),
    (re.compile(r"^u:tk\.lib\.(folders|settings|typo)$"), "library/_{0}"),
    (re.compile(r"^u:(libmeta|lib_last)$"), "library/_{0}"),
    (re.compile(r"^u:tk\.rnd\.(notes|todo|bib|paper|paperv|report|reportv|litmx|lit|review|slides|deep|meet|pinfo)\.(.+)$"), "projects/{1}/{0}"),   # (v104) paper = 논문(LaTeX) 원고 · (v105) paperv = 원고 버전 · report(v) = 보고서
    (re.compile(r"^u:tk\.rnd\.(.+)$"), "projects/_{0}"),
    (re.compile(r"^u:(rnd|rnd_draft|rnd_q)$"), "projects/_resume-{0}"),
    (re.compile(r"^u:tk\.(.+)$"), "tools/{0}"),
    (re.compile(r"^u:(.+)$"), "study/{0}"),
    (re.compile(r"^g:(.+)$"), "ui/{0}"),
]
NAMES = {"pinfo": "project-info", "paperv": "paper-versions", "reportv": "report-versions", "bm": "bookmarks", "socr": "socratic", "bib": "references", "meta": "_document", "libmeta": "reading-progress", "lib_last": "last-opened"}  # 파일 이름을 읽기 쉽게
README = """# 내 데이터 폴더(계정 하나)

이 폴더는 ScholarFlow 서버가 계정별로 관리하는 데이터예요. 파일 하나 = 항목 하나({k, v, t, dev}), 이름 뒤 .kv.json.
바로 이전 값은 같은 이름의 .kv.prev 로 하나 남아요. 하루 첫 저장 직전 전체 사본은 kvsnap/ 에 60일.

- study/                 ⚙ 설정·표시·학습 자료 읽기 상태(이름은 예전 그대로)
- library/<문서 id>/     📚 학습 자료 하나의 내 데이터 — notes(노트)·highlights(형광펜)·bookmarks·reading-time·socratic·_document(제목)
- library/_folders       📁 내 학습 폴더(문서 묶음)    · library/_reading-progress  읽은 위치·즐겨찾기
- projects/<pid>/        🔬 연구 프로젝트 — project.json·files/(자료)·docs/(문서 버전)·out/(내보낸 파일)·log.jsonl(이력)
                            + notes(메모)·todo(할 일)·references(참고문헌)  ← 한 폴더에 프로젝트의 모든 것
- projects/_*            연구지원 공통(표준 문단 보관함·설정·이어서 하기 위치)
- tools/ · ui/           공용 도구(뽀모도로 기록 등) · 화면 상태
- llm.json · kanban.json · masters.json   AI 연결(키 암호화) · FlowBoard 연결(토큰 암호화) · 마스터 폴더
- kvsnap/                하루 사본 · 되돌리기 직전 사본

옮기기: 데이터 폴더 전체를 복사하면 끝(system/secret.key 가 함께 있어야 암호화된 키를 풀 수 있어요).
"""


def _safe(c):
    t = re.sub(r"[^0-9A-Za-z가-힣._\-]+", "_", c)[:80].strip(".") or "_"
    return t if t == c else t + "~" + hashlib.sha1(c.encode("utf-8")).hexdigest()[:6]


class KvStore:
    def __init__(self, data_dir):
        self.dir = data_dir
        self._last_t = {}
        self._snap_day = {}
        self._index = {}                     # uid → {키: 파일 경로}

    def udir(self, uid):
        return os.path.join(self.dir, "users", uid)

    def kdir(self, uid):                     # v93 이전(해시 이름) — 읽어서 옮기기만
        return os.path.join(self.udir(uid), "kv")

    def path_for(self, uid, k):
        for rx, tpl in ROUTES:
            m = rx.match(k)
            if m:
                parts = [NAMES.get(g, g) for g in m.groups()]
                rel = tpl.format(*[_safe(x) for x in parts])
                return os.path.join(self.udir(uid), *rel.split("/")) + ".kv.json"
        return os.path.join(self.udir(uid), "misc", _safe(k)) + ".kv.json"

    def _tick(self, uid):
        t = max(_now(), self._last_t.get(uid, 0) + 1)       # 같은 ms 안 여러 쓰기도 순서가 서도록
        self._last_t[uid] = t
        return t

    def _ensure_index(self, uid):
        if uid in self._index:
            return self._index[uid]
        idx = {}
        ud = self.udir(uid)
        with _lock_for(uid):
            old = self.kdir(uid)                                  # 예전 해시 이름 파일 → 새 폴더 구조로 옮긴다(한 번)
            if os.path.isdir(old):
                for f in os.listdir(old):
                    if not f.endswith(".json") or f.endswith(".prev.json"):
                        continue
                    rec = _read(os.path.join(old, f))
                    if not rec or "k" not in rec:
                        continue
                    dst = self.path_for(uid, rec["k"])
                    os.makedirs(os.path.dirname(dst), exist_ok=True)
                    if not os.path.exists(dst):
                        os.replace(os.path.join(old, f), dst)
                    pv = os.path.join(old, f[:-5] + ".prev.json")
                    if os.path.exists(pv):
                        try: os.replace(pv, dst[:-8] + ".kv.prev")
                        except OSError: pass
                oj = os.path.join(old, "_journal.jsonl")          # 예전 변경 일지는 새 위치 일지 앞에 이어 붙인다
                if os.path.exists(oj):
                    with open(oj, "rb") as a_, open(os.path.join(ud, "_journal.jsonl"), "ab") as b_:
                        b_.write(a_.read())
                    os.remove(oj)
                try:
                    if not os.listdir(old):
                        os.rmdir(old)
                except OSError:
                    pass
            for base, dirs, files in os.walk(ud):
                dirs[:] = [d for d in dirs if d not in ("kvsnap", "files", "docs", "out", "fcache", "state", "mirror", "kv")]
                for f in files:
                    if f.endswith(".kv.json"):
                        full = os.path.join(base, f)
                        rec = _read(full)
                        if rec and "k" in rec:
                            idx[rec["k"]] = full
            if idx and not os.path.exists(os.path.join(ud, "README.md")):
                with open(os.path.join(ud, "README.md"), "w", encoding="utf-8") as fh:
                    fh.write(README)
        self._index[uid] = idx
        return idx

    def _items(self, uid, since=None, tomb=False):
        out = {}
        for k, full in list(self._ensure_index(uid).items()):
            if since is not None:
                try:
                    if os.path.getmtime(full) * 1000 < since - 5000:   # 바뀐 지 오래된 파일은 열어 보지도 않는다(폴링 가볍게)
                        continue
                except OSError:
                    continue
            rec = _read(full)
            if not rec or "k" not in rec:
                continue
            if since is not None and rec.get("t", 0) <= since:
                continue
            if rec.get("v") is None and not tomb:
                continue
            out[rec["k"]] = rec
        return out

    def get(self, uid, k):
        """항목 하나 {k, v, t, dev} | None — (v140) 커넥터 공통 동작"""
        return _read(self._ensure_index(uid).get(k) or self.path_for(uid, k))

    def all(self, uid):
        """→ (값 있는 항목 {키: 값}, 지워진 키 목록) — 지워진 키는 다른 기기의 브라우저 캐시에서도 지우라고 알려 준다."""
        self._migrate_state(uid)
        recs = self._items(uid, tomb=True)
        return {k: r["v"] for k, r in recs.items() if r.get("v") is not None}, [k for k, r in recs.items() if r.get("v") is None]

    def since(self, uid, t):
        return {k: {"v": r.get("v"), "t": r.get("t"), "dev": r.get("dev")} for k, r in self._items(uid, since=t, tomb=True).items()}

    def info(self, uid):
        items = self._items(uid)
        areas = {}
        for k in items:
            rel = os.path.relpath(self._index[uid][k], self.udir(uid)).replace("\\", "/").split("/")[0]
            areas[rel] = areas.get(rel, 0) + 1
        return {"keys": len(items), "bytes": sum(len(r.get("v") or "") for r in items.values()), "areas": areas,
                "last": max([r.get("t", 0) for r in items.values()] or [0]), "snaps": len(self.snaps(uid)), "folder": self.udir(uid)}

    def _snapshot_if_new_day(self, uid):
        day = datetime.now().strftime("%Y%m%d")
        if self._snap_day.get(uid) == day:
            return
        self._snap_day[uid] = day
        sd = os.path.join(self.dir, "users", uid, "kvsnap")
        target = os.path.join(sd, day + ".json")
        if os.path.exists(target):
            return
        cur = {k: r["v"] for k, r in self._items(uid).items()}
        if not cur:  # 아직 아무것도 없으면 사본도 없다
            return
        os.makedirs(sd, exist_ok=True)
        _atomic(target, {"saved": _now(), "kind": "daily", "items": cur})
        olds = sorted(f for f in os.listdir(sd) if f.endswith(".json"))
        for f in olds[:-KEEP_SNAPS]:
            try: os.remove(os.path.join(sd, f))
            except OSError: pass

    def put(self, uid, ops, dev=""):
        idx = self._ensure_index(uid)
        lines, n_ok, t = [], 0, 0
        with _lock_for(uid):
            self._snapshot_if_new_day(uid)
            for op in ops:
                k = str(op.get("k") or "")
                v = op.get("v")
                if not KEY_RE.match(k) or (v is not None and not isinstance(v, str)) or (v is not None and len(v) > MAX_VALUE):
                    continue
                p = idx.get(k) or self.path_for(uid, k)
                old = _read(p)
                if old is not None and old.get("v") == v:
                    continue                                   # 같은 값 — 쓰지 않음
                os.makedirs(os.path.dirname(p), exist_ok=True)
                if old is not None and old.get("v") is not None:
                    try: os.replace(p, p[:-8] + ".kv.prev")
                    except OSError: pass
                t = self._tick(uid)
                _atomic(p, {"k": k, "v": v, "t": t, "dev": str(dev)[:60]})
                idx[k] = p
                lines.append(json.dumps({"t": t, "op": "del" if v is None else "set", "k": k[:200], "n": len(v or ""), "dev": str(dev)[:60],
                                         "at": os.path.relpath(p, self.udir(uid)).replace("\\", "/")}, ensure_ascii=False))
                n_ok += 1
            if lines:
                with open(os.path.join(self.udir(uid), "_journal.jsonl"), "a", encoding="utf-8") as fh:
                    fh.write("\n".join(lines) + "\n"); fh.flush(); os.fsync(fh.fileno())
                if not os.path.exists(os.path.join(self.udir(uid), "README.md")):
                    with open(os.path.join(self.udir(uid), "README.md"), "w", encoding="utf-8") as fh:
                        fh.write(README)
        return {"ok": True, "n": n_ok, "t": t or self._last_t.get(uid, _now())}

    def replace_all(self, uid, items, dev="restore"):
        cur = self._items(uid)
        ops = [{"k": k, "v": v} for k, v in items.items()] + [{"k": k, "v": None} for k in cur if k not in items]
        return self.put(uid, ops, dev)

    # ---- 사본 ----
    def snaps(self, uid):
        sd = os.path.join(self.dir, "users", uid, "kvsnap")
        if not os.path.isdir(sd):
            return []
        out = []
        for f in sorted(os.listdir(sd), reverse=True):
            if f.endswith(".json"):
                s = _read(os.path.join(sd, f)) or {}
                out.append({"name": f, "saved": s.get("saved"), "kind": s.get("kind"), "dev": s.get("dev"), "keys": len(s.get("items") or {}), "size": os.path.getsize(os.path.join(sd, f))})
        return out

    def archive(self, uid, items, dev="", kind="browser"):
        """브라우저에만 있던 값(서버로 덮이기 전)이나 되돌리기 직전 상태를 사본으로 남긴다."""
        sd = os.path.join(self.dir, "users", uid, "kvsnap")
        os.makedirs(sd, exist_ok=True)
        name = datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + kind + ".json"
        _atomic(os.path.join(sd, name), {"saved": _now(), "kind": kind, "dev": str(dev)[:60], "items": items})
        return name

    def restore(self, uid, name):
        if not re.match(r"^[0-9]{8}(-[0-9]{6}-[a-z]+)?\.json$", name or ""):
            return None
        s = _read(os.path.join(self.dir, "users", uid, "kvsnap", name))
        if not s or not isinstance(s.get("items"), dict):
            return None
        with _lock_for(uid):
            self.archive(uid, {k: r["v"] for k, r in self._items(uid).items()}, "되돌리기 직전", kind="before")
            return self.replace_all(uid, {k: v for k, v in s["items"].items() if isinstance(v, str) and KEY_RE.match(k)}, dev="restore " + name[:15])

    # v92 의 상태 사본(state/current.json)이 있고 kv 가 비어 있으면 한 번 옮겨 온다(유실 방지)
    def _migrate_state(self, uid):
        if self._ensure_index(uid):
            return
        st = _read(os.path.join(self.dir, "users", uid, "state", "current.json"))
        if not st:
            return
        ops = [{"k": "u:" + s, "v": v} for s, v in (st.get("user") or {}).items() if isinstance(v, str)]
        ops += [{"k": "g:" + k, "v": v} for k, v in (st.get("global") or {}).items() if isinstance(v, str)]
        if ops:
            self.put(uid, ops, dev="v92 상태 사본에서 옮김")


def handle(store, handler, q, method, logkit):
    g = lambda k, d="": (q.get(k) or [d])[0]
    op = g("op")
    u = getattr(handler, "auth_user", None)
    if not u:
        return handler._json(401, {"ok": False, "error": "no_session", "message": "로그인이 필요해요."})
    uid = u["id"]
    if method == "GET":
        if op == "all":
            items, gone = store.all(uid)
            return handler._json(200, {"ok": True, "t": _now(), "items": items, "gone": gone})
        if op == "since":
            try: t = int(g("t", "0"))
            except ValueError: t = 0
            return handler._json(200, {"ok": True, "t": _now(), "items": store.since(uid, t)})
        if op == "info":
            return handler._json(200, dict(store.info(uid), ok=True))
        if op == "snaps":
            return handler._json(200, {"ok": True, "list": store.snaps(uid)})
        return handler._json(404, {"ok": False, "message": "없는 동작"})
    if method != "POST" or handler.headers.get("X-Study-Vault") != "1":
        return handler._json(403, {"ok": False, "message": "헤더 없음"})
    n = int(handler.headers.get("Content-Length") or 0)
    if n <= 0 or n > MAX_BATCH:
        return handler._json(413, {"ok": False, "message": "너무 커요"})
    try:
        b = json.loads(handler.rfile.read(n).decode("utf-8", "replace"))
    except ValueError:
        return handler._json(400, {"ok": False, "message": "JSON 아님"})
    ip = handler.client_address[0]
    if op == "put":
        r = store.put(uid, b.get("ops") or [], b.get("dev") or "")
        return handler._json(200, r)
    if op == "archive":
        name = store.archive(uid, {k: v for k, v in (b.get("items") or {}).items() if isinstance(v, str)}, b.get("dev") or "", kind="browser")
        logkit.activity("kv.archive", user=uid, ip=ip, src="server", name=name, device=str(b.get("dev") or "")[:40])
        return handler._json(200, {"ok": True, "name": name})
    if op == "restore":
        r = store.restore(uid, str(b.get("name") or ""))
        logkit.activity("kv.restore", user=uid, ip=ip, src="server", name=b.get("name"), ok=bool(r))
        return handler._json(200 if r else 404, {"ok": bool(r), "message": None if r else "사본을 찾지 못했어요."})
    return handler._json(404, {"ok": False, "message": "없는 동작"})
