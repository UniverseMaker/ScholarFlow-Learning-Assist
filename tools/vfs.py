# -*- coding: utf-8 -*-
"""(v151) 데이터 폴더 저장 층 — SQLite 엔진이면 데이터 폴더 안의 .json·.jsonl 을 SQLite 표에 둔다. 나머지 파일은 그대로 파일.


  엔진 files  : 여기 함수는 os·open 과 똑같이 동작한다(지나가기만).
  엔진 sqlite : <데이터>/db/slc.sqlite3 의 표
                  docs(path, parent, kind, data, size, mtime_ns)   — .json 한 파일 = 한 줄(data = 글)
                  doc_lines(path, seq, line)                         — .jsonl 한 줄 = 한 줄(추가만 하는 기록)
                path = 데이터 폴더 기준 상대 경로('/' 구분). 폴더 구조·이름은 파일 때와 같다(코드는 경로만 안다).
  DB 에 두지 않는 것: PDF·문서·그림 등 .json/.jsonl 이 아닌 파일, logs/·backup/·db/·hub-run/·cli-sandbox/·fcache/·.cache/·_backups/,
                     system/storage.json(엔진 설정 — 처음 읽는 파일), server-run.json, 계정 데이터 *.kv.json(kv 표 — dbconn.SqlKvStore).
  찾는 순서: DB → (없으면) 옛 파일. 옮기기(tools/to_sqlite.py) 뒤에는 옛 파일이 backup/pre-sqlite-*/ 로 가 있어 DB 만 본다.

모듈 쪽 사용: `import vfs` 뒤 `open = vfs.open` 그리고 os.path.exists → vfs.exists 처럼 같은 이름 함수로 바꿔 부른다.
데이터 폴더 밖 경로(사용자 PC 폴더·허브 폴더·보관함)는 늘 그대로 os 로 간다.
"""
import io
import json
import os
import shutil
import threading
import time

import safeio

_st = {"root": None, "eng": None, "norm": None}
_lk = threading.RLock()
_builtin_open = open
SKIP_DIRS = {"logs", "backup", "db", "hub-run", "cli-sandbox", "fcache", ".cache", "_backups", "__pycache__", "kvsnap", "spool"}   # kvsnap = 계정 데이터 스냅숏(kv_snap 표)
SKIP_REL = {"system/storage.json"}
SKIP_NAMES = {"server-run.json"}

SCHEMA = [
    "CREATE TABLE IF NOT EXISTS docs (path TEXT PRIMARY KEY, parent TEXT NOT NULL, kind TEXT NOT NULL, data TEXT, size INTEGER NOT NULL, mtime_ns INTEGER NOT NULL)",
    "CREATE INDEX IF NOT EXISTS docs_parent ON docs (parent)",
    "CREATE TABLE IF NOT EXISTS doc_lines (path TEXT NOT NULL, seq INTEGER NOT NULL, line TEXT NOT NULL, PRIMARY KEY (path, seq))",
]


# ------------------------------------------------------------------ 켜기
def init(data_dir, eng, tables=True):
    """serve.py·도구가 부른다. eng = dbconn.Engine(sqlite) 또는 None(파일 엔진). tables=False: 점검에서 깨진 DB — 표를 만들지 않는다."""
    with _lk:
        _st["root"] = os.path.abspath(data_dir)
        _st["norm"] = os.path.normcase(_st["root"])
        _st["eng"] = eng if (eng is not None and eng.engine == "sqlite") else None
        if _st["eng"] is not None and tables:
            for s in SCHEMA:
                _st["eng"].exec(s)


def ensure(data_dir):
    """아직 안 켰으면 storage.json 을 보고 켠다(런처 계정 복구·sso_off 같은 명령 도구용). 이미 켰으면 그대로."""
    if _st["root"] is not None:
        return _st["eng"]
    import dbconn
    c = dbconn.load_conf(data_dir)
    eng = dbconn.Engine(data_dir, c) if c.get("engine") == "sqlite" else None
    init(data_dir, eng)
    return eng


def on():
    return _st["eng"] is not None


def engine():
    return _st["eng"]


def root():
    return _st["root"]


def rel(path):
    """데이터 폴더 안이면 상대 경로('/'), 밖이면 None."""
    r = _st["norm"]
    if r is None:
        return None
    a = os.path.abspath(path)
    n = os.path.normcase(a)
    if n == r:
        return ""
    if not n.startswith(r + os.sep):
        return None
    return a[len(_st["root"]) + 1:].replace("\\", "/")


def _skipped(r):
    if r in SKIP_REL:
        return True
    parts = r.split("/")
    return any(p in SKIP_DIRS for p in parts[:-1]) or parts[-1] in SKIP_NAMES


def kind_of(r):
    low = r.lower()
    if low.endswith((".kv.json", ".kv.prev")):
        return None
    if low.endswith(".jsonl"):
        return "jsonl"
    if low.endswith(".json"):
        return "json"
    return None


def claimed(path):
    """DB 에 두는 파일이면 (상대 경로, 종류). 아니면 None."""
    if _st["eng"] is None:
        return None
    r = rel(path)
    if not r or _skipped(r):
        return None
    k = kind_of(r)
    return (r, k) if k else None


def claimed_dir(path):
    """데이터 폴더 안 폴더면 상대 경로('' = 뿌리). DB 를 안 쓰면 None."""
    if _st["eng"] is None:
        return None
    r = rel(path)
    if r is None or (r and _skipped(r + "/x")):
        return None
    return r


def _abs(r):
    return os.path.join(_st["root"], *r.split("/"))


def _parent(r):
    return r.rsplit("/", 1)[0] if "/" in r else ""


def _q(sql, args=()):
    return _st["eng"].rows(sql, args)


def _x(sql, args=()):
    return _st["eng"].exec(sql, args)


# ------------------------------------------------------------------ 읽기
def _doc(r):
    rows = _q("SELECT kind, data, size, mtime_ns FROM docs WHERE path=?", (r,))
    return rows[0] if rows else None


def _lines_text(r):
    return "".join(x[0] for x in _q("SELECT line FROM doc_lines WHERE path=? ORDER BY seq", (r,)))


def _db_text(r):
    d = _doc(r)
    if d is None:
        return None
    return _lines_text(r) if d[0] == "jsonl" else (d[1] or "")


def read_bytes(path):
    c = claimed(path)
    if c:
        t = _db_text(c[0])
        if t is not None:
            return t.encode("utf-8")
    with _builtin_open(path, "rb") as fh:
        return fh.read()


def read_text(path, encoding="utf-8", errors="strict"):
    c = claimed(path)
    if c:
        t = _db_text(c[0])
        if t is not None:
            return t[1:] if t.startswith("﻿") else t
    with _builtin_open(path, "r", encoding=encoding, errors=errors) as fh:
        return fh.read()


def read_json(path, default=None):
    try:
        return json.loads(read_text(path, "utf-8-sig"))
    except (OSError, ValueError):
        return default


# ------------------------------------------------------------------ 쓰기
def _now_ns():
    return time.time_ns()


def _mkdir_for(r):
    d = os.path.dirname(_abs(r))
    if d:
        os.makedirs(d, exist_ok=True)      # 폴더 모양은 파일 때와 같게 둔다(README·문서 파일이 함께 산다)


def write_text(path, text, mkdir=True):
    c = claimed(path)
    if not c:
        return safeio.atomic_text(path, text, mkdir)
    safeio.check_write(path)
    r, k = c
    if mkdir:
        _mkdir_for(r)
    eng = _st["eng"]
    with _lk, eng.tx():
        if k == "jsonl":
            _x("DELETE FROM doc_lines WHERE path=?", (r,))
            parts = text.splitlines(True)
            for i, ln in enumerate(parts):
                _x("INSERT INTO doc_lines (path, seq, line) VALUES (?, ?, ?)", (r, i + 1, ln))
            _x("INSERT INTO docs (path, parent, kind, data, size, mtime_ns) VALUES (?, ?, 'jsonl', NULL, ?, ?) ON CONFLICT (path) DO UPDATE SET kind='jsonl', data=NULL, size=excluded.size, mtime_ns=excluded.mtime_ns",
               (r, _parent(r), len(text.encode("utf-8")), _now_ns()))
        else:
            _x("INSERT INTO docs (path, parent, kind, data, size, mtime_ns) VALUES (?, ?, 'json', ?, ?, ?) ON CONFLICT (path) DO UPDATE SET kind='json', data=excluded.data, size=excluded.size, mtime_ns=excluded.mtime_ns",
               (r, _parent(r), text, len(text.encode("utf-8")), _now_ns()))
            _x("DELETE FROM doc_lines WHERE path=?", (r,))


def write_bytes(path, data, mkdir=True):
    if not claimed(path):
        return safeio.atomic_bytes(path, data, mkdir)
    return write_text(path, data.decode("utf-8"), mkdir)


def append_line(path, line):
    c = claimed(path)
    if not c:
        return safeio.append_line(path, line)
    safeio.check_write(path)
    r, k = c
    ln = line if line.endswith("\n") else line + "\n"
    _mkdir_for(r)
    eng = _st["eng"]
    with _lk, eng.tx():
        d = _doc(r)
        if d is not None and d[0] != "jsonl":                # .json 에 줄 추가(드묾) — 글 끝에 붙인다
            t = (d[1] or "") + ln
            _x("UPDATE docs SET data=?, size=?, mtime_ns=? WHERE path=?", (t, len(t.encode("utf-8")), _now_ns(), r))
            return
        if d is None and os.path.isfile(_abs(r)):           # 옛 파일이 남아 있으면 먼저 가져온다
            old = _builtin_open(_abs(r), "r", encoding="utf-8", errors="replace").read()
            for i, x in enumerate(old.splitlines(True)):
                _x("INSERT INTO doc_lines (path, seq, line) VALUES (?, ?, ?)", (r, i + 1, x))
            _x("INSERT INTO docs (path, parent, kind, data, size, mtime_ns) VALUES (?, ?, 'jsonl', NULL, ?, ?)", (r, _parent(r), len(old.encode("utf-8")), _now_ns()))
            d = ("jsonl", None, len(old.encode("utf-8")), 0)
        seq = (_q("SELECT MAX(seq) FROM doc_lines WHERE path=?", (r,))[0][0] or 0) + 1
        _x("INSERT INTO doc_lines (path, seq, line) VALUES (?, ?, ?)", (r, seq, ln))
        n = len(ln.encode("utf-8"))
        if d is None:
            _x("INSERT INTO docs (path, parent, kind, data, size, mtime_ns) VALUES (?, ?, 'jsonl', NULL, ?, ?)", (r, _parent(r), n, _now_ns()))
        else:
            _x("UPDATE docs SET size=size+?, mtime_ns=? WHERE path=?", (n, _now_ns(), r))


class _Writer(object):
    """open(경로, 'w'·'wb'·'a') 의 DB 판 — 닫을 때 한 번에 저장한다."""

    def __init__(self, path, mode, encoding):
        self.path, self.mode, self.enc = path, mode, encoding or "utf-8"
        self.binary = "b" in mode
        self.buf = io.BytesIO() if self.binary else io.StringIO()
        self.closed = False

    def write(self, s):
        return self.buf.write(s)

    def writelines(self, xs):
        for x in xs:
            self.write(x)

    def flush(self):
        pass

    def fileno(self):
        raise io.UnsupportedOperation("fileno")

    def close(self):
        if self.closed:
            return
        self.closed = True
        v = self.buf.getvalue()
        text = v.decode("utf-8") if self.binary else v
        if "a" in self.mode:
            for ln in text.splitlines(True):
                append_line(self.path, ln)
        else:
            write_text(self.path, text)

    def __enter__(self):
        return self

    def __exit__(self, et, ev, tb):
        if et is None:
            self.close()
        else:
            self.closed = True             # 도중에 실패하면 저장하지 않는다(옛 내용 그대로)
        return False

    def __del__(self):
        try:
            if not self.closed:
                self.close()
        except Exception:
            pass


def open(path, mode="r", buffering=-1, encoding=None, errors=None, newline=None, closefd=True, opener=None):   # noqa: A001
    c = claimed(path) if isinstance(path, (str, bytes, os.PathLike)) else None
    if not c:
        return _builtin_open(path, mode, buffering, encoding, errors, newline, closefd, opener)
    if any(m in mode for m in ("w", "a", "x")):
        if "x" in mode and exists(path):
            raise FileExistsError(path)
        return _Writer(path, mode, encoding)
    if "+" in mode:
        raise io.UnsupportedOperation("DB 파일은 읽기·쓰기를 함께 열 수 없습니다: " + c[0])
    t = _db_text(c[0])
    if t is None:
        return _builtin_open(path, mode, buffering, encoding, errors, newline, closefd, opener)
    if "b" in mode:
        return io.BytesIO(t.encode("utf-8"))
    if (encoding or "").lower().replace("_", "-") == "utf-8-sig" and t.startswith("﻿"):
        t = t[1:]
    return io.StringIO(t, newline=None if newline is None else newline)


# ------------------------------------------------------------------ 살펴보기
def _db_children(rd):
    """폴더 rd(상대) 바로 아래 DB 파일 이름과 DB 에만 있는 하위 폴더 이름."""
    files = [x[0].rsplit("/", 1)[-1] for x in _q("SELECT path FROM docs WHERE parent=?", (rd,))]
    pre = (rd + "/") if rd else ""
    subs = set()
    for (p,) in _q("SELECT DISTINCT parent FROM docs WHERE parent LIKE ? ESCAPE '\\'", (_like(pre) + "%",)):
        if p == rd:
            continue
        rest = p[len(pre):]
        if rest:
            subs.add(rest.split("/", 1)[0])
    return files, subs


def _like(s):
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def exists(path):
    c = claimed(path)
    if c and _doc(c[0]) is not None:
        return True
    if os.path.exists(path):
        return True
    return isdir(path)


def isfile(path):
    c = claimed(path)
    if c and _doc(c[0]) is not None:
        return True
    return os.path.isfile(path)


def isdir(path):
    if os.path.isdir(path):
        return True
    rd = claimed_dir(path)
    if rd is None or rd == "":
        return False
    return bool(_q("SELECT 1 FROM docs WHERE parent=? OR parent LIKE ? ESCAPE '\\' LIMIT 1", (rd, _like(rd + "/") + "%")))


def listdir(path):
    rd = claimed_dir(path)
    real = []
    try:
        real = os.listdir(path)
    except OSError:
        if rd is None or not isdir(path):
            raise
    if rd is None:
        return real
    files, subs = _db_children(rd)
    seen = set(real)
    return real + [x for x in files + sorted(subs) if x not in seen and not seen.add(x)]


def walk(top, topdown=True, onerror=None, followlinks=False):
    """os.walk 와 같은 모양. DB 파일은 그 폴더의 files 에 들어간다(위→아래 순서만 지원)."""
    if claimed_dir(top) is None:
        yield from os.walk(top, topdown, onerror, followlinks)
        return
    stack = [top]
    while stack:
        d = stack.pop()
        try:
            names = listdir(d)
        except OSError as e:
            if onerror:
                onerror(e)
            continue
        dirs, files = [], []
        for n in names:
            (dirs if isdir(os.path.join(d, n)) else files).append(n)
        yield d, dirs, files
        for n in reversed(dirs):
            stack.append(os.path.join(d, n))


class _Stat(object):
    def __init__(self, size, mtime_ns):
        self.st_size = size
        self.st_mtime_ns = mtime_ns
        self.st_mtime = mtime_ns / 1e9
        self.st_ctime = self.st_mtime
        self.st_atime = self.st_mtime
        self.st_mode = 0o100644


def stat(path):
    c = claimed(path)
    if c:
        d = _doc(c[0])
        if d is not None:
            return _Stat(d[2], d[3])
    return os.stat(path)


def getsize(path):
    return stat(path).st_size


def getmtime(path):
    return stat(path).st_mtime


# ------------------------------------------------------------------ 지우기·옮기기
def remove(path):
    c = claimed(path)
    hit = False
    if c:
        safeio.check_write(path)
        with _lk, _st["eng"].tx():
            hit = bool(_q("SELECT 1 FROM docs WHERE path=?", (c[0],)))
            _x("DELETE FROM docs WHERE path=?", (c[0],))
            _x("DELETE FROM doc_lines WHERE path=?", (c[0],))
    if os.path.lexists(path):
        os.remove(path)
        hit = True
    if not hit:
        raise FileNotFoundError(path)


unlink = remove


def _db_prefix_rows(rd):
    return _q("SELECT path FROM docs WHERE path LIKE ? ESCAPE '\\'", (_like(rd + "/") + "%",))


def rmtree(path, ignore_errors=False, onerror=None):
    rd = claimed_dir(path)
    if rd:
        safeio.check_write(path)
        with _lk, _st["eng"].tx():
            for (p,) in _db_prefix_rows(rd):
                _x("DELETE FROM doc_lines WHERE path=?", (p,))
            _x("DELETE FROM docs WHERE path LIKE ? ESCAPE '\\'", (_like(rd + "/") + "%",))
    if os.path.isdir(path):
        shutil.rmtree(path, ignore_errors=ignore_errors, onerror=onerror)
    elif not rd and not ignore_errors:
        raise FileNotFoundError(path)


def _move_rows(src_r, dst_r, prefix):
    """DB 경로를 옮긴다. prefix=True 면 폴더(아래 전부)."""
    rows = _db_prefix_rows(src_r) if prefix else _q("SELECT path FROM docs WHERE path=?", (src_r,))
    for (p,) in rows:
        np = dst_r + p[len(src_r):]
        _x("DELETE FROM docs WHERE path=?", (np,))
        _x("DELETE FROM doc_lines WHERE path=?", (np,))
        _x("UPDATE docs SET path=?, parent=? WHERE path=?", (np, _parent(np), p))
        _x("UPDATE doc_lines SET path=? WHERE path=?", (np, p))
    return len(rows)


def _export(r, dst):
    """DB 파일 → 진짜 파일(데이터 폴더 밖으로 옮길 때)."""
    t = _db_text(r)
    os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
    with _builtin_open(dst, "wb") as fh:
        fh.write((t or "").encode("utf-8"))


def move(src, dst):
    """shutil.move 와 같다(dst 가 있는 폴더면 그 안으로). 폴더는 진짜 파일과 DB 파일을 함께 옮긴다."""
    if isdir(dst) and not isfile(dst):
        dst = os.path.join(dst, os.path.basename(src.rstrip("/\\")))
    if isfile(src) and not os.path.isdir(src):
        return replace(src, dst) or dst
    rs, rdst = claimed_dir(src), claimed_dir(dst)
    if os.path.isdir(src):
        os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
        shutil.move(src, dst)
    if rs:
        safeio.check_write(dst)
        if rdst is not None:
            with _lk, _st["eng"].tx():
                _move_rows(rs, rdst, True)
        else:                                       # 데이터 폴더 밖으로 — 파일로 꺼내고 DB 에서 뺀다
            for (p,) in _db_prefix_rows(rs):
                _export(p, os.path.join(dst, *p[len(rs) + 1:].split("/")))
            with _lk, _st["eng"].tx():
                for (p,) in _db_prefix_rows(rs):
                    _x("DELETE FROM doc_lines WHERE path=?", (p,))
                _x("DELETE FROM docs WHERE path LIKE ? ESCAPE '\\'", (_like(rs + "/") + "%",))
    return dst


def replace(src, dst):
    """os.replace — 파일 하나. 한쪽만 DB 면 내용을 옮겨 쓴다."""
    cs, cd = claimed(src), claimed(dst)
    in_db = bool(cs and _doc(cs[0]) is not None)
    if not cs and not cd:
        return os.replace(src, dst)
    if cs and cd and in_db:
        safeio.check_write(dst)
        with _lk, _st["eng"].tx():
            _move_rows(cs[0], cd[0], False)
        _mkdir_for(cd[0])
        return None
    data = read_bytes(src)
    if cd:
        write_bytes(dst, data)
    else:
        safeio.atomic_bytes(dst, data)
    remove(src)
    return None


rename = replace


def copy(src, dst, follow_symlinks=True):
    """shutil.copy2/copyfile — 파일 하나."""
    if isdir(dst):
        dst = os.path.join(dst, os.path.basename(src))
    cs, cd = claimed(src), claimed(dst)
    if not (cs and _doc(cs[0]) is not None) and not cd:
        return shutil.copy2(src, dst)
    data = read_bytes(src)
    if cd:
        write_bytes(dst, data)
    else:
        safeio.atomic_bytes(dst, data)
    return dst


copy2 = copyfile = copy


def copytree(src, dst, dirs_exist_ok=False, ignore=None):
    if exists(dst) and not dirs_exist_ok:
        raise FileExistsError(dst)
    for b, dirs, files in walk(src):
        names = set(ignore(b, dirs + files)) if ignore else set()
        dirs[:] = [d for d in dirs if d not in names]
        tgt = os.path.join(dst, os.path.relpath(b, src))
        os.makedirs(tgt, exist_ok=True)
        for f in files:
            if f not in names:
                copy(os.path.join(b, f), os.path.join(tgt, f))
    return dst


# ------------------------------------------------------------------ 점검·옮기기 도우미
def all_docs():
    """→ [(상대 경로, 종류, 크기)]"""
    return [tuple(x) for x in _q("SELECT path, kind, size FROM docs ORDER BY path")] if on() else []


def check_docs():
    """DB 안 JSON 이 읽히는지(시작 점검). → (깨진 것 목록, 경고 목록)"""
    bad, warn = [], []
    for p, k, _ in all_docs():
        if k == "json":
            try:
                json.loads((_db_text(p) or "").lstrip("﻿") or "null")
            except ValueError as e:
                bad.append({"path": "db:" + p, "why": "JSON 읽기 실패: " + str(e)[:80]})
        else:
            rows = _q("SELECT seq, line FROM doc_lines WHERE path=? ORDER BY seq", (p,))
            for i, (seq, ln) in enumerate(rows):
                if not ln.strip():
                    continue
                try:
                    json.loads(ln)
                except ValueError:
                    (warn if i == len(rows) - 1 else bad).append({"path": "db:%s#%d" % (p, seq), "why": "줄 읽기 실패"})
    return bad, warn


def zwrite(z, full, arc):
    """zipfile 에 넣기 — DB 파일은 내용으로, 나머지는 z.write 그대로."""
    c = claimed(full)
    if c and _doc(c[0]) is not None:
        return z.writestr(arc, _db_text(c[0]).encode("utf-8"))
    return z.write(full, arc)
