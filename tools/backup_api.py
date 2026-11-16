# -*- coding: utf-8 -*-
"""(v140, G10) 정기 백업·무결성 점검 — 폴더 안 backup/ 에 시간별·일별·월별 스냅숏.

구조  backup/                      (기본 = 프로젝트 폴더/backup, 데이터 폴더를 따로 쓰면 <데이터 폴더>/backup — STUDY_BACKUP_DIR 로 바꿈)
  objects/<sha 앞 2자>/<sha256>.z   파일 내용(zlib). 같은 내용은 한 번만 — 스냅숏이 많아도 바뀐 파일만큼만 늘어난다
  hourly/<YYYYMMDD-HHMMSS>.json     스냅숏 목록(경로 → [sha256, 크기, mtime_ns]) — 24개
  daily/<YYYYMMDD>.json             그날 첫 정상 스냅숏 — 14개
  monthly/<YYYYMM>.json             그달 첫 정상 스냅숏 — 6개
  state.json                        마지막 결과(시각·지문·실패 사유)
담는 것  data/users/** · data/system/** (세션·CLI 작업 폴더·연결 문서 캐시 fcache·.cache·*.tmp 제외), vault/**(AI 연결 보관함 암호문),
        conf/userdata/*.txt|*.json(데이터 폴더 위치 등), 파일 DB 를 쓰면 db/<이름>(sqlite 백업 API 로 뜬 사본 — 실행 중 파일을 그대로 복사하지 않는다)
무결성  .json·.kv.json·.kv.prev 는 JSON 으로 읽혀야 하고, .jsonl 은 줄마다 읽혀야 한다(끊긴 마지막 줄은 경고), sqlite 는 PRAGMA integrity_check = ok.
        하나라도 깨졌으면 그 스냅숏은 남기지 않는다(이전 정상 스냅숏이 그대로 남는다). 새로 쓴 조각은 다시 읽어 sha256 을 맞춰 본다.
되살리기  python tools/restore.py --list | --check | --to <빈 폴더> [--snapshot id] | --file <경로> | --all  (자세히는 docs/DATA-STORAGE.md)
"""
import hashlib
import json
import os
import re
import shutil
import threading
import time
import zlib
from datetime import datetime

import safeio

FORMAT = "slc-backup/1"
KEEP = {"hourly": 24, "daily": 14, "monthly": 6}
SKIP_DIRS = {"cli-sandbox", "hub-run", "fcache", ".cache", "_trash", "_backups", "logs", "__pycache__", "backup"}
SKIP_FILES = {"sessions.json", "server-run.json"}
JSON_EXT = (".json", ".kv.json", ".kv.prev")


def _now():
    return int(time.time() * 1000)


def _sha(b):
    return hashlib.sha256(b).hexdigest()


def _read_json(p, d=None):
    try:
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return d


# ------------------------------------------------------------------ 무결성
def check_bytes(rel, data):
    """→ (상태, 설명)  상태: ok | warn | bad"""
    low = rel.lower()
    if low.endswith(JSON_EXT):
        try:
            json.loads(data.decode("utf-8-sig"))
            return "ok", ""
        except (UnicodeDecodeError, ValueError) as e:
            return "bad", "JSON 으로 읽히지 않음(%s)" % str(e)[:80]
    if low.endswith(".jsonl"):
        txt = data.decode("utf-8", "replace")
        lines = txt.split("\n")
        tail_cut = not txt.endswith("\n") and txt != ""
        bad = 0
        for i, ln in enumerate(lines):
            if not ln.strip():
                continue
            try:
                json.loads(ln)
            except ValueError:
                if i == len(lines) - 1 and tail_cut:
                    return "warn", "마지막 줄이 끊김(쓰는 도중 멈춤) — 앞 줄은 정상"
                bad += 1
        return ("warn", "읽히지 않는 줄 %d개(추가만 하는 기록이라 나머지는 정상)" % bad) if bad else ("ok", "")
    if low.endswith((".sqlite3", ".sqlite", ".db")):
        return "ok", ""      # DB 파일은 sqlite_check 로 따로 본다
    return "ok", ""


def sqlite_check(path, recover=False, quick=False):
    """recover=True(시작 점검): 보통 모드로 열어 강제 종료 뒤 남은 저널을 sqlite 가 되돌리게 한다(sqlite 의 정상 복구 절차 — 데이터를 덮어쓰지 않는다).
    False(백업 사본 확인): 읽기 전용."""
    import sqlite3
    try:
        c = sqlite3.connect(path, timeout=10) if recover else sqlite3.connect("file:%s?mode=ro" % path.replace("\\", "/"), uri=True)
        try:
            r = c.execute("PRAGMA quick_check" if quick else "PRAGMA integrity_check").fetchone()[0]
        finally:
            c.close()
        return ("ok", "") if r == "ok" else ("bad", ("quick_check: " if quick else "integrity_check: ") + str(r)[:120])
    except Exception as e:
        return "bad", "sqlite 열기 실패: " + str(e)[:120]


class Backup:
    def __init__(self, root, data_dir, vault_dir=None, bdir=None, app_version="", log=None, db=None):
        self.root, self.data, self.vault = root, data_dir, vault_dir
        default_data = os.path.normcase(os.path.abspath(os.path.join(root, "userdata", "workspace")))
        self.dir = bdir or os.environ.get("STUDY_BACKUP_DIR") or (
            os.path.join(root, "backup") if os.path.normcase(os.path.abspath(data_dir)) == default_data else os.path.join(data_dir, "backup"))
        self.app = app_version
        self.log = log or (lambda *a, **k: None)
        self.db = db                 # dbconn.Engine — 파일 DB(sqlite)를 쓸 때만
        self.lock = threading.Lock()
        self._th = None
        self._stop = threading.Event()
        self.health = {"checked": None, "bad": [], "warn": []}

    # -- 설정(다른 디스크 사본) --
    def conf(self):
        return _read_json(os.path.join(self.dir, "config.json"), {}) or {}

    def set_conf(self, patch):
        c = self.conf()
        c.update(patch)
        safeio.atomic_json(os.path.join(self.dir, "config.json"), c, indent=1)
        return c

    # -- 무엇을 담나 --
    def sources(self):
        out = []
        for top in ("users", "system"):
            out.append(("data/" + top, os.path.join(self.data, top)))
        if self.vault and os.path.isdir(self.vault) and not os.path.normcase(os.path.abspath(self.vault)).startswith(os.path.normcase(os.path.abspath(self.data))):
            out.append(("vault", self.vault))
        return out

    def walk(self):
        """→ [(rel, full, size, mtime_ns)]"""
        items = []
        for pre, base in self.sources():
            if not os.path.isdir(base):
                continue
            for b, dirs, files in os.walk(base):
                dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.endswith(".pg")]
                for f in files:
                    if f in SKIP_FILES or f.endswith(".tmp") or f.endswith((".sqlite3-journal", ".sqlite3-wal", ".sqlite3-shm")):
                        continue
                    if f.endswith((".sqlite3", ".sqlite")):
                        continue        # DB 는 백업 API 로 따로
                    full = os.path.join(b, f)
                    try:
                        st = os.stat(full)
                    except OSError:
                        continue
                    items.append((pre + "/" + os.path.relpath(full, base).replace("\\", "/"), full, st.st_size, st.st_mtime_ns))
        ud = os.path.join(self.root, "userdata")
        if os.path.isdir(ud):
            for f in os.listdir(ud):
                full = os.path.join(ud, f)
                if os.path.isfile(full) and f.endswith((".txt", ".json")):
                    st = os.stat(full)
                    items.append(("conf/userdata/" + f, full, st.st_size, st.st_mtime_ns))
        items.sort()
        return items

    # -- 시작 점검 --
    def startup_check(self):
        """깨진 파일 목록. 고치지 않는다 — 사람이 백업에서 되살린다."""
        bad, warn = [], []
        for rel, full, size, _ in self.walk():
            low = rel.lower()
            if not low.endswith(JSON_EXT + (".jsonl",)):
                continue
            try:
                with open(full, "rb") as f:
                    data = f.read()
            except OSError as e:
                bad.append({"path": rel, "why": "읽기 실패: " + str(e)[:80]})
                continue
            st, why = check_bytes(rel, data)
            if st == "bad":
                bad.append({"path": rel, "why": why})
            elif st == "warn":
                warn.append({"path": rel, "why": why})
        if self.db and self.db.engine == "sqlite" and os.path.exists(self.db.sqlite_path()):
            st, why = sqlite_check(self.db.sqlite_path(), recover=not safeio.READONLY, quick=True)    # (v151) 시작은 quick_check, 백업 사본은 integrity_check
            if st == "bad":
                bad.append({"path": "db/" + os.path.basename(self.db.sqlite_path()), "why": why})
        sysd = os.path.join(self.data, "system")
        import vfs as _v       # (v151) SQLite 엔진이면 users.json 은 DB 안
        try:
            has_users = _v.isfile(os.path.join(sysd, "users.json")) if not bad else os.path.isfile(os.path.join(sysd, "users.json"))
        except Exception:
            has_users = False
        if has_users and not os.path.exists(os.path.join(sysd, "secret.key")):
            bad.append({"path": "data/system/secret.key", "why": "계정은 있는데 암호화 키가 없습니다(폴더 일부만 옮겨진 것 같습니다) — 새 키를 만들면 보관한 키·토큰을 못 읽습니다"})
        self.health = {"checked": _now(), "bad": bad, "warn": warn[:50], "warn_n": len(warn)}
        return self.health

    # -- 조각 저장 --
    def _obj(self, sha):
        return os.path.join(self.dir, "objects", sha[:2], sha + ".z")

    def _put_obj(self, sha, data):
        p = self._obj(sha)
        if os.path.exists(p):
            return False
        z = zlib.compress(data, 6)
        safeio.atomic_bytes(p, z)
        with open(p, "rb") as f:                       # 다시 읽어 맞춰 본다
            if _sha(zlib.decompress(f.read())) != sha:
                raise IOError("백업 조각 확인 실패: " + sha)
        return True

    def read_obj(self, sha):
        with open(self._obj(sha), "rb") as f:
            data = zlib.decompress(f.read())
        if _sha(data) != sha:
            raise IOError("백업 조각이 손상됨: " + sha)
        return data

    # -- 목록 --
    def manifests(self, kind=None):
        out = []
        for k in ([kind] if kind else ("hourly", "daily", "monthly")):
            d = os.path.join(self.dir, k)
            if os.path.isdir(d):
                for f in sorted(os.listdir(d), reverse=True):
                    if f.endswith(".json"):
                        out.append((k, f[:-5], os.path.join(d, f)))
        return out

    def list(self):
        rows = []
        for k, sid, p in self.manifests():
            m = _read_json(p, {}) or {}
            rows.append({"name": k[0] + "-" + sid, "kind": k, "id": sid, "created": m.get("created"), "files": len(m.get("files") or {}),
                         "bytes": sum(v[1] for v in (m.get("files") or {}).values()), "warn": len(m.get("warn") or []), "app": m.get("app"), "engine": m.get("engine")})
        rows.sort(key=lambda r: -(r["created"] or 0))
        return rows

    def find(self, name):
        """'h-20261110-150000' · 'd-20261110' · 'm-202611' · 'latest' → (manifest, 경로)"""
        if name in (None, "", "latest"):
            ms = self.list()
            if not ms:
                return None, None
            name = ms[0]["name"]
        m = re.match(r"^([hdm])-([0-9\-]{6,15})$", str(name))
        if not m:
            return None, None
        kind = {"h": "hourly", "d": "daily", "m": "monthly"}[m.group(1)]
        p = os.path.join(self.dir, kind, m.group(2) + ".json")
        mf = _read_json(p)
        return (mf, p) if mf else (None, None)

    # -- 만들기 --
    def state(self):
        return _read_json(os.path.join(self.dir, "state.json"), {}) or {}

    def make(self, force=False, now=None):
        if not self.lock.acquire(blocking=False):
            return {"ok": False, "skipped": "busy"}
        try:
            return self._make(force, now or datetime.now())
        finally:
            self.lock.release()

    def _make(self, force, now):
        st = self.state()
        items = self.walk()
        fp = _sha(json.dumps([(r, s, m) for r, _, s, m in items]).encode("utf-8"))
        db_note = None
        dbfile = None
        if self.db and self.db.engine == "sqlite" and os.path.exists(self.db.sqlite_path()):
            dbfile = self.db.sqlite_path()
            dst = os.stat(dbfile)
            fp = _sha((fp + "|%d|%d" % (dst.st_size, dst.st_mtime_ns)).encode("utf-8"))
        if not force and fp == st.get("fp") and st.get("last"):
            self._promote(st["last"], now)
            return {"ok": True, "skipped": "unchanged", "last": st["last"]}
        prev = {}
        last = self.find("h-" + st["last"])[0] if st.get("last") else None
        if last:
            prev = last.get("files") or {}
        files, bad, warn, new = {}, [], [], 0
        for rel, full, size, mt in items:
            pv = prev.get(rel)
            if pv and pv[1] == size and pv[2] == mt and os.path.exists(self._obj(pv[0])):
                files[rel] = pv                  # 바뀌지 않은 파일 — 지난번에 점검·저장한 조각을 그대로
                continue
            try:
                with open(full, "rb") as f:
                    data = f.read()
            except OSError:
                continue                          # 그사이 지워진 파일
            s, why = check_bytes(rel, data)
            if s == "bad":
                bad.append({"path": rel, "why": why})
                continue
            if s == "warn":
                warn.append({"path": rel, "why": why})
            sha = _sha(data)
            new += self._put_obj(sha, data)
            files[rel] = [sha, len(data), mt]
        if dbfile:
            tmp = os.path.join(self.dir, "db-snap.tmp")
            try:
                self.db.backup_to(tmp)           # (v151) VACUUM INTO 스냅숏 — 실행 중 파일을 그대로 복사하지 않는다
                s, why = sqlite_check(tmp)
                if s == "bad":
                    bad.append({"path": "db/" + os.path.basename(dbfile), "why": why})
                else:
                    with open(tmp, "rb") as f:
                        data = f.read()
                    sha = _sha(data)
                    new += self._put_obj(sha, data)
                    files["db/" + os.path.basename(dbfile)] = [sha, len(data), 0]
                    db_note = "sqlite integrity_check ok"
            finally:
                if os.path.exists(tmp):
                    os.remove(tmp)
        if bad:
            st.update(failed=_now(), fail=bad[:20])
            safeio.atomic_json(os.path.join(self.dir, "state.json"), st, indent=1)
            self.log("ERROR", "백업 중단 — 깨진 파일", bad=bad[:5])
            return {"ok": False, "bad": bad}
        sid = now.strftime("%Y%m%d-%H%M%S")
        mf = {"format": FORMAT, "kind": "hourly", "id": sid, "created": _now(), "app": self.app, "engine": self.db.engine if self.db else "files",
              "fp": fp, "files": files, "warn": warn[:50], "check": {"files": len(files), "new_objects": new, "db": db_note}}
        safeio.atomic_json(os.path.join(self.dir, "hourly", sid + ".json"), mf)
        st.update(last=sid, fp=fp, made=_now(), fail=None)
        safeio.atomic_json(os.path.join(self.dir, "state.json"), st, indent=1)
        self._promote(sid, now)
        self.prune()
        self.mirror()
        self.log("INFO", "백업 스냅숏", id=sid, files=len(files), new=new, warn=len(warn))
        return {"ok": True, "id": sid, "files": len(files), "new_objects": new, "warn": warn}

    def _promote(self, sid, now):
        """그날·그달 첫 정상 스냅숏을 일별·월별 보관본으로(목록 복사 — 조각은 같이 쓴다)."""
        src = os.path.join(self.dir, "hourly", sid + ".json")
        if not os.path.exists(src):
            return
        for kind, key in (("daily", now.strftime("%Y%m%d")), ("monthly", now.strftime("%Y%m"))):
            dst = os.path.join(self.dir, kind, key + ".json")
            if not os.path.exists(dst):
                m = _read_json(src)
                if m:
                    m.update(kind=kind, id=key, from_hourly=sid)
                    safeio.atomic_json(dst, m)

    def prune(self):
        for kind, n in KEEP.items():
            d = os.path.join(self.dir, kind)
            if not os.path.isdir(d):
                continue
            fs = sorted(f for f in os.listdir(d) if f.endswith(".json"))
            for f in fs[:-n]:
                try:
                    os.remove(os.path.join(d, f))
                except OSError:
                    pass
        self.gc()

    def gc(self):
        keep = set()
        for _, _, p in self.manifests():
            for v in ((_read_json(p, {}) or {}).get("files") or {}).values():
                keep.add(v[0])
        od = os.path.join(self.dir, "objects")
        n = 0
        if os.path.isdir(od):
            for sub in os.listdir(od):
                sd = os.path.join(od, sub)
                if not os.path.isdir(sd):
                    continue
                for f in os.listdir(sd):
                    if f.endswith(".z") and f[:-2] not in keep:
                        try:
                            os.remove(os.path.join(sd, f)); n += 1
                        except OSError:
                            pass
        return n

    # -- 다른 디스크 사본(선택) --
    def mirror(self):
        m = (self.conf().get("mirror") or "").strip()
        if not m:
            return None
        try:
            os.makedirs(m, exist_ok=True)
            keep = set()
            names = set()
            for kind, sid, p in self.manifests():
                mf = _read_json(p, {}) or {}
                for v in (mf.get("files") or {}).values():
                    keep.add(v[0])
                    dst = os.path.join(m, "objects", v[0][:2], v[0] + ".z")
                    if not os.path.exists(dst):
                        os.makedirs(os.path.dirname(dst), exist_ok=True)
                        shutil.copyfile(self._obj(v[0]), dst + ".tmp")
                        os.replace(dst + ".tmp", dst)
                dst = os.path.join(m, kind, sid + ".json")
                names.add(os.path.normcase(dst))
                if not os.path.exists(dst):
                    os.makedirs(os.path.dirname(dst), exist_ok=True)
                    shutil.copyfile(p, dst + ".tmp")
                    os.replace(dst + ".tmp", dst)
            for kind in KEEP:
                d = os.path.join(m, kind)
                if os.path.isdir(d):
                    for f in os.listdir(d):
                        if f.endswith(".json") and os.path.normcase(os.path.join(d, f)) not in names:
                            os.remove(os.path.join(d, f))
            od = os.path.join(m, "objects")
            for sub in (os.listdir(od) if os.path.isdir(od) else []):
                for f in os.listdir(os.path.join(od, sub)):
                    if f.endswith(".z") and f[:-2] not in keep:
                        os.remove(os.path.join(od, sub, f))
            return True
        except OSError as e:
            self.log("WARNING", "다른 디스크 사본 실패", err=str(e)[:160])
            return False

    # -- 되살리기(서버를 끈 뒤 restore.py 가 부른다) --
    def db_docs(self, mf):
        """(v151) 스냅숏 안 SQLite 사본의 문서(.json·.jsonl) → {"data/<경로>": bytes}. 파일 스냅숏이면 {}."""
        ent = next(((r, v) for r, v in (mf.get("files") or {}).items() if r.startswith("db/")), None)
        if not ent:
            return {}
        cache = getattr(self, "_dbdocs", None)
        if cache and cache[0] == ent[1][0]:
            return cache[1]
        import sqlite3
        import tempfile
        fd, tmp = tempfile.mkstemp(suffix=".sqlite3")
        os.close(fd)
        out = {}
        try:
            with open(tmp, "wb") as f:
                f.write(self.read_obj(ent[1][0]))
            c = sqlite3.connect("file:%s?mode=ro" % tmp.replace("\\", "/"), uri=True)
            try:
                has = c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='docs'").fetchone()
                if has:
                    for p, kind, data in c.execute("SELECT path, kind, data FROM docs"):
                        t = "".join(x[0] for x in c.execute("SELECT line FROM doc_lines WHERE path=? ORDER BY seq", (p,))) if kind == "jsonl" else (data or "")
                        out["data/" + p] = t.encode("utf-8")
            finally:
                c.close()
        finally:
            try:
                os.remove(tmp)
            except OSError:
                pass
        self._dbdocs = (ent[1][0], out)
        return out

    def entries(self, mf):
        """(v151) 스냅숏 안 모든 파일 → {rel: 읽는 함수}. SQLite 스냅숏이면 DB 안 문서도 data/<경로> 로 함께."""
        out = {r: (lambda sha=v[0]: self.read_obj(sha)) for r, v in (mf.get("files") or {}).items() if not r.startswith("db/")}
        for r, b in self.db_docs(mf).items():
            out[r] = (lambda b=b: b)
        return out

    def verify(self, mf):
        bad = []
        for rel, v in (mf.get("files") or {}).items():
            try:
                self.read_obj(v[0])
            except Exception as e:
                bad.append({"path": rel, "why": str(e)[:80]})
        return bad

    def target_of(self, rel):
        if rel.startswith("data/"):
            return os.path.join(self.data, *rel[5:].split("/"))
        if rel.startswith("vault/") and self.vault:
            return os.path.join(self.vault, *rel[6:].split("/"))
        if rel.startswith("conf/userdata/"):
            return os.path.join(self.root, "userdata", rel[14:])
        if rel.startswith("db/") and self.db:
            return self.db.sqlite_path()
        return None

    def extract(self, mf, out_dir, only=None):
        n = 0
        for rel, v in (mf.get("files") or {}).items():
            if only and rel not in only:
                continue
            dst = os.path.join(out_dir, *rel.split("/"))
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            with open(dst, "wb") as f:
                f.write(self.read_obj(v[0]))
            n += 1
        return n

    def restore(self, mf, only=None):
        """지금 파일은 <데이터 폴더>/_trash/restore-<시각>/ 로 옮긴 뒤(지우지 않는다) 백업 내용을 쓴다. only=None 이면 전체."""
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        trash = os.path.join(self.data, "_trash", "restore-" + stamp)
        want = mf.get("files") or {}
        moved = written = 0
        if only is None:                         # 전체 되살리기: 백업에 없는 지금 파일도 휴지통으로
            for rel, full, _, _ in self.walk():
                if rel not in want:
                    dst = os.path.join(trash, *rel.split("/"))
                    os.makedirs(os.path.dirname(dst), exist_ok=True)
                    shutil.move(full, dst); moved += 1
        for rel, v in want.items():
            if only and rel not in only:
                continue
            tgt = self.target_of(rel)
            if not tgt:
                continue
            data = self.read_obj(v[0])
            if os.path.exists(tgt):
                with open(tgt, "rb") as f:
                    if _sha(f.read()) == v[0]:
                        continue
                dst = os.path.join(trash, *rel.split("/"))
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.copy2(tgt, dst); moved += 1
            was = safeio.READONLY
            safeio.READONLY = None
            try:
                safeio.atomic_bytes(tgt, data)
            finally:
                safeio.READONLY = was
            written += 1
        return {"written": written, "moved": moved, "trash": trash if moved else None}

    # -- 주기 실행 --
    def start(self, every=60):
        def loop():
            last_hour = None
            self._stop.wait(20)                   # 서버가 다 뜬 뒤
            while not self._stop.is_set():
                now = datetime.now()
                hour = now.strftime("%Y%m%d%H")
                if hour != last_hour and not safeio.READONLY:
                    try:
                        r = self.make(now=now)
                        if r.get("ok") or r.get("bad"):
                            last_hour = hour
                    except Exception as e:
                        self.log("ERROR", "백업 실패", err=str(e)[:200])
                        last_hour = hour
                self._stop.wait(every)
        self._th = threading.Thread(target=loop, daemon=True, name="backup")
        self._th.start()

    def stop(self):
        self._stop.set()

    def info(self):
        st = self.state()
        ls = self.list()
        return {"dir": self.dir, "last": st.get("last"), "made": st.get("made"), "failed": st.get("failed"), "fail": st.get("fail"),
                "counts": {k: sum(1 for r in ls if r["kind"] == k) for k in KEEP}, "keep": KEEP, "mirror": self.conf().get("mirror") or "",
                "health": self.health, "readonly": safeio.READONLY}
