# -*- coding: utf-8 -*-
"""(v140, G10) 저장소 커넥터 — 계정 데이터(kv) 접근은 여기 한 곳을 지난다. 화면·API 코드는 엔진을 모른다.

엔진(설정 값 하나):  <데이터 폴더>/system/storage.json  {"engine": "files" | "sqlite" | "mysql" | "postgresql", ...}
                    (시험·임시: 환경변수 STUDY_DB_ENGINE 이 먼저)
  files       지금 기본. 항목 하나 = 파일 하나(users/<계정>/**/*.kv.json). 폴더 복사 = 이사.
  sqlite      파일 DB  <데이터 폴더>/db/slc.sqlite3  (journal_mode=DELETE · synchronous=FULL · 쓰기마다 트랜잭션)
              폴더 안에 있어 폴더 복사로 같이 간다(서버를 끈 뒤). 백업은 sqlite 백업 API 로 뜬 사본만.
  mysql / postgresql   서버 DB — 지금은 쓰지 않는다(덤프가 필요해서). 스키마·마이그레이션·내보내기/가져오기만 준비.
              연결: storage.json {"engine":"mysql","url":"mysql://user@host:3306/slc"} · 비밀번호는 환경변수 STUDY_DB_PASSWORD
              드라이버: pymysql / psycopg(설치는 사용자가 고를 때).

kv 말고 나머지(프로젝트 자료·문서 버전·업로드 파일·설정 JSON)는 지금 파일이다. 서버 DB 로 옮길 때는 files 표(경로·내용)에 함께 담는다
(export_dir / import_dir — 폴더 ↔ DB 왕복이 같은 내용인지 compare_dirs 로 맞춰 본다).

명령:
  python tools/dbconn.py status
  python tools/dbconn.py schema mysql|postgresql|sqlite                SQL 스키마 출력
  python tools/dbconn.py export --to <sqlite 파일 | mysql://… | postgresql://…> [--data <데이터 폴더>]   폴더 → DB(전체)
  python tools/dbconn.py import --from <같은 형식> --to <빈 폴더>                                         DB → 폴더(전체)
  python tools/dbconn.py compare <폴더 A> <폴더 B>
  python tools/dbconn.py switch sqlite|files [--data <데이터 폴더>]     서버를 끈 뒤: 계정 데이터(kv)를 옮기고 엔진을 바꾼다
"""
import hashlib
import json
import os
import re
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import safeio      # noqa: E402

SCHEMA_VERSION = 1
SKIP_DIRS = {"cli-sandbox", "hub-run", "fcache", ".cache", "_trash", "_backups", "logs", "__pycache__", "backup", "db"}
SKIP_FILES = {"server-run.json"}
JSON_EXT = (".json", ".kv.json", ".kv.prev")


def _now():
    return int(time.time() * 1000)


def _read_json(p, d=None):
    try:
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return d


# ================================================================== 설정
def conf_path(data_dir):
    return os.path.join(data_dir, "system", "storage.json")


def load_conf(data_dir):
    c = _read_json(conf_path(data_dir), {}) or {}
    if os.environ.get("STUDY_DB_ENGINE"):
        c["engine"] = os.environ["STUDY_DB_ENGINE"]
    c.setdefault("engine", "files")
    return c


def save_conf(data_dir, c):
    c = {k: v for k, v in c.items() if k != "password"}           # 비밀번호는 파일에 두지 않는다
    safeio.atomic_json(conf_path(data_dir), c, indent=1)


# ================================================================== 스키마(방언별)
TYPES = {
    "sqlite": {"id": "TEXT", "key": "TEXT", "path": "TEXT", "text": "TEXT", "int": "INTEGER", "blob": "BLOB", "serial": "INTEGER PRIMARY KEY AUTOINCREMENT", "tail": ""},
    "mysql": {"id": "VARCHAR(64)", "key": "VARCHAR(255)", "path": "VARCHAR(700)", "text": "LONGTEXT", "int": "BIGINT", "blob": "LONGBLOB", "serial": "BIGINT PRIMARY KEY AUTO_INCREMENT",
              "tail": " ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin"},
    "postgresql": {"id": "TEXT", "key": "TEXT", "path": "TEXT", "text": "TEXT", "int": "BIGINT", "blob": "BYTEA", "serial": "BIGSERIAL PRIMARY KEY", "tail": ""},
}


def schema(dialect):
    t = TYPES[dialect]
    return [s.format(**t) for s in [
        "CREATE TABLE IF NOT EXISTS meta (k {key} PRIMARY KEY, v {text}){tail}",
        "CREATE TABLE IF NOT EXISTS kv (uid {id} NOT NULL, k {key} NOT NULL, v {text}, t {int} NOT NULL, dev {key}, path {path}, PRIMARY KEY (uid, k)){tail}",
        "CREATE INDEX kv_since ON kv (uid, t)",
        "CREATE TABLE IF NOT EXISTS kv_prev (uid {id} NOT NULL, k {key} NOT NULL, v {text}, t {int}, dev {key}, path {path}, PRIMARY KEY (uid, k)){tail}",
        "CREATE TABLE IF NOT EXISTS kv_journal (id {serial}, uid {id} NOT NULL, t {int}, op {key}, k {key}, n {int}, dev {key}, at {path}){tail}",
        "CREATE TABLE IF NOT EXISTS kv_snap (uid {id} NOT NULL, name {key} NOT NULL, saved {int}, kind {key}, dev {key}, items {text}, PRIMARY KEY (uid, name)){tail}",
        "CREATE TABLE IF NOT EXISTS files (path {path} PRIMARY KEY, size {int}, sha256 {key}, mtime_ns {int}, data {blob}){tail}",
    ]]


# 마이그레이션: 버전 → 문장 목록(방언별). 스키마를 바꿀 때 여기 한 줄씩 더한다
MIGRATIONS = {1: schema}


def upsert(dialect, table, cols, keys):
    ph = ", ".join("?" for _ in cols)
    upd = [c for c in cols if c not in keys]
    if dialect == "mysql":
        return "INSERT INTO %s (%s) VALUES (%s) ON DUPLICATE KEY UPDATE %s" % (table, ", ".join(cols), ph, ", ".join("%s=VALUES(%s)" % (c, c) for c in upd))
    return "INSERT INTO %s (%s) VALUES (%s) ON CONFLICT (%s) DO UPDATE SET %s" % (table, ", ".join(cols), ph, ", ".join(keys), ", ".join("%s=excluded.%s" % (c, c) for c in upd))


# ================================================================== 엔진(연결)
class Engine:
    def __init__(self, data_dir, conf=None, target=None):
        """target: 'sqlite 파일 경로' 또는 'mysql://…' · 'postgresql://…' (내보내기·시험용). 없으면 설정."""
        self.data = data_dir
        self.c = dict(conf or load_conf(data_dir))
        if target:
            if re.match(r"^(mysql|postgresql|postgres)://", target):
                self.c.update(engine="postgresql" if target.startswith("postgres") else "mysql", url=target)
            else:
                self.c.update(engine="sqlite", file=os.path.abspath(target))
        self.engine = self.c.get("engine", "files")
        self._tl = threading.local()
        self._all = []
        self._lk = threading.Lock()

    @property
    def dialect(self):
        return self.engine

    def sqlite_path(self):
        f = self.c.get("file") or os.path.join("db", "slc.sqlite3")
        return f if os.path.isabs(f) else os.path.join(self.data, f)    # 폴더 기준 상대 경로 — 폴더째 옮겨도 그대로

    def connect(self):
        cn = getattr(self._tl, "cn", None)
        if cn is not None:
            return cn
        if self.engine == "sqlite":
            import sqlite3
            p = self.sqlite_path()
            os.makedirs(os.path.dirname(p), exist_ok=True)
            cn = sqlite3.connect(p, timeout=10, isolation_level=None, check_same_thread=False)
            cn.execute("PRAGMA journal_mode=DELETE")        # -wal 파일이 따로 남지 않게(폴더 복사가 단순)
            cn.execute("PRAGMA synchronous=FULL")
            cn.execute("PRAGMA busy_timeout=10000")
        elif self.engine == "mysql":
            try:
                import pymysql
            except ImportError:
                raise RuntimeError("mysql 드라이버(pymysql)가 없습니다. 쓰기로 정하면: python -m pip install pymysql")
            u = _parse_url(self.c["url"])
            cn = pymysql.connect(host=u["host"], port=u["port"] or 3306, user=u["user"], password=os.environ.get("STUDY_DB_PASSWORD", ""), database=u["db"], charset="utf8mb4", autocommit=True)
        elif self.engine == "postgresql":
            try:
                import psycopg
            except ImportError:
                raise RuntimeError("postgresql 드라이버(psycopg)가 없습니다. 쓰기로 정하면: python -m pip install psycopg")
            u = _parse_url(self.c["url"])
            cn = psycopg.connect(host=u["host"], port=u["port"] or 5432, user=u["user"], password=os.environ.get("STUDY_DB_PASSWORD", ""), dbname=u["db"], autocommit=True)
        else:
            raise RuntimeError("파일 엔진은 연결이 없습니다")
        self._tl.cn = cn
        with self._lk:
            self._all.append(cn)
        return cn

    def q(self, sql):
        return sql if self.engine == "sqlite" else sql.replace("?", "%s")

    def exec(self, sql, args=()):
        cur = self.connect().cursor()
        cur.execute(self.q(sql), args)
        return cur

    def rows(self, sql, args=()):
        return self.exec(sql, args).fetchall()

    def tx(self):
        return _Tx(self)

    def migrate(self):
        self.exec("CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL)")
        r = self.rows("SELECT MAX(v) FROM schema_version")
        cur = (r[0][0] if r and r[0][0] is not None else 0)
        for v in sorted(MIGRATIONS):
            if v <= cur:
                continue
            with self.tx():
                for s in MIGRATIONS[v](self.dialect):
                    try:
                        self.exec(s)
                    except Exception as e:          # 이미 있는 색인 등
                        if "exist" not in str(e).lower() and "duplicate" not in str(e).lower():
                            raise
                self.exec("INSERT INTO schema_version (v) VALUES (?)", (v,))
        return max([cur] + list(MIGRATIONS))

    def backup_to(self, dst):
        """(v151) VACUUM INTO 로 한 파일 사본을 뜬다(실행 중 파일을 그대로 복사하지 않는다. 사본은 빈 곳 없이 다시 쓴 깨끗한 DB)."""
        import sqlite3
        if os.path.exists(dst):
            os.remove(dst)
        src = sqlite3.connect(self.sqlite_path(), timeout=30, isolation_level=None)
        try:
            src.execute("PRAGMA busy_timeout=30000")
            src.execute("VACUUM INTO ?", (dst,))
        finally:
            src.close()

    def close(self):
        with self._lk:
            for cn in self._all:
                try:
                    cn.close()
                except Exception:
                    pass
            self._all = []
        self._tl = threading.local()


class _Tx:
    def __init__(self, eng):
        self.e = eng

    def __enter__(self):
        if self.e.engine == "sqlite":
            self.e.exec("BEGIN IMMEDIATE")
        elif self.e.engine == "mysql":
            self.e.exec("START TRANSACTION")
        else:
            self.e.exec("BEGIN")
        return self.e

    def __exit__(self, et, ev, tb):
        self.e.exec("ROLLBACK" if et else "COMMIT")
        return False


def _parse_url(url):
    m = re.match(r"^\w+://(?:([^:@/]+)(?::[^@/]*)?@)?([^:/]+)(?::(\d+))?/(.+)$", url)
    if not m:
        raise ValueError("DB 주소 형식: mysql://사용자@호스트:포트/DB이름")
    if re.match(r"^\w+://[^:@/]+:[^@/]+@", url):
        raise ValueError("비밀번호를 주소에 쓰지 마세요 — 환경변수 STUDY_DB_PASSWORD 로")
    return {"user": m.group(1) or "", "host": m.group(2), "port": int(m.group(3)) if m.group(3) else None, "db": m.group(4)}


# ================================================================== kv 저장소(SQL)
class SqlKvStore:
    """kv_api.KvStore 와 같은 공개 동작(all·since·info·put·replace_all·snaps·archive·restore·get) — 엔진만 다르다."""
    KEEP_SNAPS = 60

    def __init__(self, data_dir, eng):
        import kv_api
        self.kvm = kv_api
        self.dir = data_dir
        self.e = eng
        self.e.migrate()
        self._last_t = {}
        self._snap_day = {}
        self._lk = threading.RLock()

    def udir(self, uid):
        return os.path.join(self.dir, "users", uid)

    def path_for(self, uid, k):           # 파일 엔진과 같은 상대 경로(내보내기·되돌리기 때 그 자리에 쓴다)
        return self.kvm.KvStore(self.dir).path_for(uid, k)

    def _rel(self, uid, k):
        return os.path.relpath(self.path_for(uid, k), self.udir(uid)).replace("\\", "/")

    def _tick(self, uid):
        t = max(_now(), self._last_t.get(uid, 0) + 1)
        self._last_t[uid] = t
        return t

    def get(self, uid, k):
        r = self.e.rows("SELECT k, v, t, dev FROM kv WHERE uid=? AND k=?", (uid, k))
        return {"k": r[0][0], "v": r[0][1], "t": r[0][2], "dev": r[0][3]} if r else None

    def _items(self, uid, since=None, tomb=False):
        sql, a = "SELECT k, v, t, dev FROM kv WHERE uid=?", [uid]
        if since is not None:
            sql += " AND t>?"
            a.append(since)
        out = {}
        for k, v, t, dev in self.e.rows(sql, tuple(a)):
            if v is None and not tomb:
                continue
            out[k] = {"k": k, "v": v, "t": t, "dev": dev}
        return out

    def all(self, uid):
        recs = self._items(uid, tomb=True)
        return {k: r["v"] for k, r in recs.items() if r.get("v") is not None}, [k for k, r in recs.items() if r.get("v") is None]

    def since(self, uid, t):
        return {k: {"v": r.get("v"), "t": r.get("t"), "dev": r.get("dev")} for k, r in self._items(uid, since=t, tomb=True).items()}

    def info(self, uid):
        items = self._items(uid)
        areas = {}
        for k in items:
            a = self._rel(uid, k).split("/")[0]
            areas[a] = areas.get(a, 0) + 1
        return {"keys": len(items), "bytes": sum(len(r.get("v") or "") for r in items.values()), "areas": areas,
                "last": max([r.get("t", 0) for r in items.values()] or [0]), "snaps": len(self.snaps(uid)), "folder": self.e.sqlite_path() if self.e.engine == "sqlite" else self.e.engine}

    def _snapshot_if_new_day(self, uid):
        from datetime import datetime
        day = datetime.now().strftime("%Y%m%d")
        if self._snap_day.get(uid) == day:
            return
        self._snap_day[uid] = day
        if self.e.rows("SELECT 1 FROM kv_snap WHERE uid=? AND name=?", (uid, day + ".json")):
            return
        cur = {k: r["v"] for k, r in self._items(uid).items()}
        if cur:
            self._snap_put(uid, day + ".json", "daily", "", cur)

    def _snap_put(self, uid, name, kind, dev, items):
        self.e.exec(upsert(self.e.dialect, "kv_snap", ["uid", "name", "saved", "kind", "dev", "items"], ["uid", "name"]),
                    (uid, name, _now(), kind, dev, json.dumps(items, ensure_ascii=False)))
        names = [r[0] for r in self.e.rows("SELECT name FROM kv_snap WHERE uid=? ORDER BY name", (uid,))]
        for n in names[:-self.KEEP_SNAPS]:
            self.e.exec("DELETE FROM kv_snap WHERE uid=? AND name=?", (uid, n))

    def put(self, uid, ops, dev=""):
        safeio.check_write()
        n_ok, t = 0, 0
        with self._lk:
            self._snapshot_if_new_day(uid)
            with self.e.tx():
                for op in ops:
                    k = str(op.get("k") or "")
                    v = op.get("v")
                    if not self.kvm.KEY_RE.match(k) or (v is not None and not isinstance(v, str)) or (v is not None and len(v) > self.kvm.MAX_VALUE):
                        continue
                    old = self.get(uid, k)
                    if old is not None and old.get("v") == v:
                        continue
                    path = self._rel(uid, k)
                    if old is not None and old.get("v") is not None:
                        self.e.exec(upsert(self.e.dialect, "kv_prev", ["uid", "k", "v", "t", "dev", "path"], ["uid", "k"]), (uid, k, old["v"], old["t"], old.get("dev"), path))
                    t = self._tick(uid)
                    self.e.exec(upsert(self.e.dialect, "kv", ["uid", "k", "v", "t", "dev", "path"], ["uid", "k"]), (uid, k, v, t, str(dev)[:60], path))
                    self.e.exec("INSERT INTO kv_journal (uid, t, op, k, n, dev, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                                (uid, t, "del" if v is None else "set", k[:200], len(v or ""), str(dev)[:60], path))
                    n_ok += 1
        return {"ok": True, "n": n_ok, "t": t or self._last_t.get(uid, _now())}

    def replace_all(self, uid, items, dev="restore"):
        cur = self._items(uid)
        ops = [{"k": k, "v": v} for k, v in items.items()] + [{"k": k, "v": None} for k in cur if k not in items]
        return self.put(uid, ops, dev)

    def snaps(self, uid):
        return [{"name": n, "saved": s, "kind": kd, "dev": d, "keys": len(json.loads(it or "{}")), "size": len(it or "")}
                for n, s, kd, d, it in self.e.rows("SELECT name, saved, kind, dev, items FROM kv_snap WHERE uid=? ORDER BY name DESC", (uid,))]

    def archive(self, uid, items, dev="", kind="browser"):
        from datetime import datetime
        name = datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + kind + ".json"
        self._snap_put(uid, name, kind, str(dev)[:60], items)
        return name

    def restore(self, uid, name):
        if not re.match(r"^[0-9]{8}(-[0-9]{6}-[a-z]+)?\.json$", name or ""):
            return None
        r = self.e.rows("SELECT items FROM kv_snap WHERE uid=? AND name=?", (uid, name))
        if not r:
            return None
        items = json.loads(r[0][0] or "{}")
        with self._lk:
            self.archive(uid, {k: x["v"] for k, x in self._items(uid).items()}, "되돌리기 직전", kind="before")
            return self.replace_all(uid, {k: v for k, v in items.items() if isinstance(v, str) and self.kvm.KEY_RE.match(k)}, dev="restore " + name[:15])

    def latest_path_t(self, uid, path_prefix, skip_prefix=None):
        """(v151) 경로(파일 엔진의 *.kv.json 자리)가 path_prefix 로 시작하는 계정 데이터 중 마지막 쓴 시각(ms). 대시보드 '마지막 손댄 때'."""
        sql, a = "SELECT MAX(t) FROM kv WHERE uid=? AND path LIKE ? AND v IS NOT NULL", [uid, path_prefix.replace("%", "") + "%"]
        if skip_prefix:
            sql += " AND path NOT LIKE ?"
            a.append(skip_prefix + "%")
        r = self.e.rows(sql, tuple(a))
        return (r[0][0] or 0) if r else 0

    def latest_t(self, uid, prefix):
        r = self.e.rows("SELECT MAX(t) FROM kv WHERE uid=? AND k LIKE ?", (uid, prefix + "%"))
        return (r[0][0] or 0) if r else 0


def open_kv(data_dir):
    """설정에 따라 계정 데이터 저장소를 연다. 파일 엔진이면 지금 그대로(kv_api.KvStore)."""
    import kv_api
    c = load_conf(data_dir)
    if c.get("engine", "files") == "files":
        return kv_api.KvStore(data_dir), None
    eng = Engine(data_dir, c)
    return SqlKvStore(data_dir, eng), eng


# ================================================================== 폴더 ↔ DB (전체)
def walk_data(data_dir):
    out = []
    for top in ("users", "system"):
        base = os.path.join(data_dir, top)
        for b, dirs, files in os.walk(base):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.endswith(".pg")]
            for f in files:
                if f in SKIP_FILES or f.endswith(".tmp"):
                    continue
                full = os.path.join(b, f)
                out.append((os.path.relpath(full, data_dir).replace("\\", "/"), full))
    out.sort()
    return out


def _kv_dump(rec):
    return json.dumps(rec, ensure_ascii=False)


def export_dir(data_dir, eng, log=print):
    """폴더 → DB. *.kv.json → kv, *.kv.prev → kv_prev, kvsnap/*.json → kv_snap, 나머지 → files(경로·내용)."""
    eng.migrate()
    n = {"kv": 0, "kv_prev": 0, "kv_snap": 0, "files": 0}
    with eng.tx():
        for t in ("kv", "kv_prev", "kv_snap", "files"):
            eng.exec("DELETE FROM " + t)
        for rel, full in walk_data(data_dir):
            with open(full, "rb") as f:
                data = f.read()
            m = re.match(r"^users/([^/]+)/(.+)$", rel)
            if m and rel.endswith((".kv.json", ".kv.prev")):
                rec = json.loads(data.decode("utf-8"))
                uid, sub = m.group(1), m.group(2)
                if rel.endswith(".kv.json"):
                    eng.exec("INSERT INTO kv (uid, k, v, t, dev, path) VALUES (?, ?, ?, ?, ?, ?)", (uid, rec["k"], rec.get("v"), rec.get("t") or 0, rec.get("dev"), sub))
                    n["kv"] += 1
                else:
                    eng.exec(upsert(eng.dialect, "kv_prev", ["uid", "k", "v", "t", "dev", "path"], ["uid", "k"]), (uid, rec["k"], rec.get("v"), rec.get("t"), rec.get("dev"), sub[:-8] + ".kv.json"))
                    n["kv_prev"] += 1
                continue
            m2 = re.match(r"^users/([^/]+)/kvsnap/([^/]+\.json)$", rel)
            if m2:
                s = json.loads(data.decode("utf-8"))
                eng.exec("INSERT INTO kv_snap (uid, name, saved, kind, dev, items) VALUES (?, ?, ?, ?, ?, ?)",
                         (m2.group(1), m2.group(2), s.get("saved"), s.get("kind"), s.get("dev"), json.dumps(s.get("items") or {}, ensure_ascii=False)))
                n["kv_snap"] += 1
                continue
            eng.exec("INSERT INTO files (path, size, sha256, mtime_ns, data) VALUES (?, ?, ?, ?, ?)",
                     (rel, len(data), hashlib.sha256(data).hexdigest(), os.stat(full).st_mtime_ns, data))
            n["files"] += 1
        eng.exec(upsert(eng.dialect, "meta", ["k", "v"], ["k"]), ("exported", json.dumps({"at": _now(), "from": "folder", "counts": n})))
    log("내보냄: " + json.dumps(n, ensure_ascii=False))
    return n


def import_dir(eng, out_dir, log=print, only_kv=False):
    """DB → 폴더. 빈 폴더에 푼다(지금 데이터 폴더에 바로 풀지 않는다 — 확인 뒤 사람이 바꾼다)."""
    n = {"kv": 0, "kv_prev": 0, "kv_snap": 0, "files": 0}
    w = lambda p, b: safeio.atomic_bytes(os.path.join(out_dir, *p.split("/")), b)
    for uid, k, v, t, dev, path in eng.rows("SELECT uid, k, v, t, dev, path FROM kv"):
        w("users/%s/%s" % (uid, path), _kv_dump({"k": k, "v": v, "t": t, "dev": dev}).encode("utf-8")); n["kv"] += 1
    for uid, k, v, t, dev, path in eng.rows("SELECT uid, k, v, t, dev, path FROM kv_prev"):
        w("users/%s/%s" % (uid, path[:-8] + ".kv.prev"), _kv_dump({"k": k, "v": v, "t": t, "dev": dev}).encode("utf-8")); n["kv_prev"] += 1
    for uid, name, saved, kind, dev, items in eng.rows("SELECT uid, name, saved, kind, dev, items FROM kv_snap"):
        s = {"saved": saved, "kind": kind}
        if dev is not None:
            s["dev"] = dev
        s["items"] = json.loads(items or "{}")
        w("users/%s/kvsnap/%s" % (uid, name), json.dumps(s, ensure_ascii=False).encode("utf-8")); n["kv_snap"] += 1
    if not only_kv:
        for path, data in eng.rows("SELECT path, data FROM files"):
            w(path, bytes(data)); n["files"] += 1
    log("가져옴: " + json.dumps(n, ensure_ascii=False))
    return n


def compare_dirs(a, b, only_kv=False):
    """→ 다른 점 목록. JSON 은 읽은 값으로, 나머지는 바이트로 비교한다."""
    fa = {r: f for r, f in walk_data(a)}
    fb = {r: f for r, f in walk_data(b)}
    if only_kv:
        isk = lambda r: r.endswith((".kv.json", ".kv.prev")) or "/kvsnap/" in r
        fa = {r: f for r, f in fa.items() if isk(r)}
        fb = {r: f for r, f in fb.items() if isk(r)}
    diff = ["없음(B): " + r for r in sorted(set(fa) - set(fb))] + ["더 있음(B): " + r for r in sorted(set(fb) - set(fa))]
    for r in sorted(set(fa) & set(fb)):
        x, y = open(fa[r], "rb").read(), open(fb[r], "rb").read()
        if r.endswith(JSON_EXT):
            try:
                if json.loads(x.decode("utf-8-sig")) == json.loads(y.decode("utf-8-sig")):
                    continue
            except ValueError:
                pass
        elif x == y:
            continue
        diff.append("내용 다름: " + r)
    return diff


def switch(data_dir, to, log=print):
    """서버를 끈 뒤에만. 계정 데이터(kv)를 옮기고 엔진 설정을 바꾼다. 옛 쪽은 지우지 않는다."""
    c = load_conf(data_dir)
    cur = c.get("engine", "files")
    if to == cur:
        return log("이미 " + to)
    if to == "sqlite" and cur == "files":
        eng = Engine(data_dir, dict(c, engine="sqlite"))
        if os.path.exists(eng.sqlite_path()):
            raise SystemExit("이미 DB 파일이 있습니다: " + eng.sqlite_path() + " — 옮겨 둔 뒤 다시 하세요")
        eng.migrate()
        n = 0
        with eng.tx():
            for rel, full in walk_data(data_dir):
                m = re.match(r"^users/([^/]+)/(.+)$", rel)
                if not m:
                    continue
                if rel.endswith(".kv.json"):
                    rec = _read_json(full)
                    eng.exec("INSERT INTO kv (uid, k, v, t, dev, path) VALUES (?, ?, ?, ?, ?, ?)", (m.group(1), rec["k"], rec.get("v"), rec.get("t") or 0, rec.get("dev"), m.group(2))); n += 1
                elif rel.endswith(".kv.prev"):
                    rec = _read_json(full)
                    eng.exec(upsert(eng.dialect, "kv_prev", ["uid", "k", "v", "t", "dev", "path"], ["uid", "k"]), (m.group(1), rec["k"], rec.get("v"), rec.get("t"), rec.get("dev"), m.group(2)[:-8] + ".kv.json"))
                elif re.match(r"^users/[^/]+/kvsnap/[^/]+\.json$", rel):
                    s = _read_json(full) or {}
                    eng.exec("INSERT INTO kv_snap (uid, name, saved, kind, dev, items) VALUES (?, ?, ?, ?, ?, ?)", (m.group(1), rel.rsplit("/", 1)[1], s.get("saved"), s.get("kind"), s.get("dev"), json.dumps(s.get("items") or {}, ensure_ascii=False)))
        eng.close()
        save_conf(data_dir, dict(c, engine="sqlite", switched=_now()))
        log("계정 데이터 %d개를 %s 로 옮겼습니다. 파일(*.kv.json)은 그대로 남아 있습니다(되돌리기용)." % (n, eng.sqlite_path()))
    elif to == "files" and cur == "sqlite":
        eng = Engine(data_dir, c)
        r = import_dir(eng, data_dir, log, only_kv=True)
        eng.close()
        save_conf(data_dir, dict(c, engine="files", switched=_now()))
        log("DB 의 계정 데이터 %d개를 파일로 썼습니다. DB 파일은 그대로 남아 있습니다." % r["kv"])
    else:
        raise SystemExit("지원하지 않는 전환: %s → %s (서버 DB 는 export/import 로)" % (cur, to))


def _main(argv):
    import argparse
    ap = argparse.ArgumentParser(description="ScholarFlow 저장소 커넥터")
    ap.add_argument("cmd", choices=["status", "schema", "export", "import", "compare", "switch"])
    ap.add_argument("arg", nargs="*")
    ap.add_argument("--data")
    ap.add_argument("--to")
    ap.add_argument("--from", dest="src")
    a = ap.parse_args(argv)
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if not a.data:
        import ws_api
        a.data = ws_api.resolve_data_dir(root, [], os.environ)
    if a.cmd == "status":
        c = load_conf(a.data)
        print(json.dumps({"data": a.data, "engine": c.get("engine"), "sqlite": Engine(a.data, c).sqlite_path() if c.get("engine") == "sqlite" else None, "schema": SCHEMA_VERSION}, ensure_ascii=False, indent=1))
    elif a.cmd == "schema":
        for s in schema((a.arg or ["sqlite"])[0]):
            print(s + ";")
    elif a.cmd == "export":
        eng = Engine(a.data, {}, target=a.to)
        export_dir(a.data, eng)
        eng.close()
    elif a.cmd == "import":
        if os.path.exists(a.to) and os.listdir(a.to):
            raise SystemExit("빈 폴더에만 풉니다: " + a.to)
        eng = Engine(a.data, {}, target=a.src)
        import_dir(eng, a.to)
        eng.close()
    elif a.cmd == "compare":
        d = compare_dirs(a.arg[0], a.arg[1])
        print("같음" if not d else "\n".join(d[:200]))
        return 0 if not d else 1
    elif a.cmd == "switch":
        switch(a.data, a.arg[0])
    return 0


if __name__ == "__main__":
    sys.exit(_main(sys.argv[1:]))
