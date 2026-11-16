# -*- coding: utf-8 -*-
"""(v151) 저장 엔진을 파일(JSON) → SQLite 로 옮긴다. 서버를 끈 뒤에만.

  python tools/to_sqlite.py --check   [--data <데이터 폴더>]     옮길 것만 센다(아무것도 바꾸지 않음)
  python tools/to_sqlite.py --go      [--data <데이터 폴더>]     옮기고 대조한 뒤 엔진을 sqlite 로
  python tools/to_sqlite.py --back    [--data <데이터 폴더>]     되돌리기: DB 내용을 파일로 쓰고 엔진을 files 로(DB 파일은 남김)

옮기는 것  데이터 폴더의 .json·.jsonl(계정·세션·설정·연동·프로젝트 메타·대화·기록)  → docs·doc_lines 표
           계정 데이터 *.kv.json·*.kv.prev·kvsnap/*.json                              → kv·kv_prev·kv_snap 표
그대로 두는 것  PDF·문서·그림·tex 등 다른 파일, logs/(jsonl 로그), backup/, 보관함(llm-vault, 데이터 폴더 밖), system/storage.json, secret.key
원본  하나도 지우지 않는다. 대조가 끝나면 <데이터 폴더>/backup/pre-sqlite-<시각>/ 로 같은 경로째 옮기고 읽기 전용으로 둔다.
대조  표마다 건수, 그리고 파일마다 내용(글자 그대로) — 하나라도 다르면 엔진을 바꾸지 않고 DB 파일을 지운다.
"""
import argparse
import json
import os
import re
import shutil
import socket
import stat as _stat
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import dbconn   # noqa: E402
import vfs      # noqa: E402
import ws_api   # noqa: E402


def _server_up(ports):
    for p in ports:
        try:
            s = socket.create_connection(("127.0.0.1", int(p)), timeout=0.5)
            s.close()
            return p
        except (OSError, ValueError):
            pass
    return None


def scan(data):
    """→ (문서 [(rel, full, kind)], 계정 데이터 [(rel, full)])"""
    vfs.init(data, None)                 # 경로 판정만(엔진 없이)
    docs, kvs = [], []
    for b, dirs, files in os.walk(data):
        r0 = os.path.relpath(b, data).replace("\\", "/")
        r0 = "" if r0 == "." else r0
        dirs[:] = [d for d in dirs if (d not in vfs.SKIP_DIRS or d == "kvsnap") and not d.endswith(".pg")]
        for f in files:
            if f.endswith(".tmp"):
                continue
            rel = (r0 + "/" + f) if r0 else f
            full = os.path.join(b, f)
            low = rel.lower()
            if re.match(r"^users/[^/]+/", rel) and (low.endswith((".kv.json", ".kv.prev")) or re.match(r"^users/[^/]+/kvsnap/[^/]+\.json$", rel)):
                kvs.append((rel, full))
                continue
            if vfs._skipped(rel) or "/kvsnap/" in rel:
                continue
            k = vfs.kind_of(rel)
            if k:
                docs.append((rel, full, k))
    docs.sort()
    kvs.sort()
    return docs, kvs


def _text(full):
    with open(full, "rb") as fh:
        return fh.read().decode("utf-8")


def go(data, log=print):
    c = dbconn.load_conf(data)
    if c.get("engine", "files") != "files":
        raise SystemExit("이미 엔진이 %s 입니다." % c.get("engine"))
    docs, kvs = scan(data)
    eng = dbconn.Engine(data, dict(c, engine="sqlite"))
    dbp = eng.sqlite_path()
    if os.path.exists(dbp):
        raise SystemExit("DB 파일이 이미 있습니다: %s — 옮겨 둔 뒤 다시 하세요" % dbp)
    t0 = time.time()
    eng.migrate()
    vfs.init(data, eng)
    want = {"docs_json": 0, "docs_jsonl": 0, "jsonl_lines": 0, "kv": 0, "kv_prev": 0, "kv_snap": 0}
    texts = {}
    try:
        with eng.tx():
            for rel, full, k in docs:
                t = _text(full)
                texts[rel] = t
                if k == "jsonl":
                    lines = t.splitlines(True)
                    for i, ln in enumerate(lines):
                        eng.exec("INSERT INTO doc_lines (path, seq, line) VALUES (?, ?, ?)", (rel, i + 1, ln))
                    eng.exec("INSERT INTO docs (path, parent, kind, data, size, mtime_ns) VALUES (?, ?, 'jsonl', NULL, ?, ?)", (rel, vfs._parent(rel), len(t.encode("utf-8")), os.stat(full).st_mtime_ns))
                    want["docs_jsonl"] += 1
                    want["jsonl_lines"] += len(lines)
                else:
                    eng.exec("INSERT INTO docs (path, parent, kind, data, size, mtime_ns) VALUES (?, ?, 'json', ?, ?, ?)", (rel, vfs._parent(rel), t, len(t.encode("utf-8")), os.stat(full).st_mtime_ns))
                    want["docs_json"] += 1
            for rel, full in kvs:
                m = re.match(r"^users/([^/]+)/(.+)$", rel)
                uid, sub = m.group(1), m.group(2)
                rec = json.loads(_text(full))
                if rel.endswith(".kv.json"):
                    eng.exec("INSERT INTO kv (uid, k, v, t, dev, path) VALUES (?, ?, ?, ?, ?, ?)", (uid, rec["k"], rec.get("v"), rec.get("t") or 0, rec.get("dev"), sub))
                    want["kv"] += 1
                elif rel.endswith(".kv.prev"):
                    eng.exec(dbconn.upsert("sqlite", "kv_prev", ["uid", "k", "v", "t", "dev", "path"], ["uid", "k"]), (uid, rec["k"], rec.get("v"), rec.get("t"), rec.get("dev"), sub[:-8] + ".kv.json"))
                    want["kv_prev"] += 1
                else:
                    eng.exec("INSERT INTO kv_snap (uid, name, saved, kind, dev, items) VALUES (?, ?, ?, ?, ?, ?)",
                             (uid, rel.rsplit("/", 1)[1], rec.get("saved"), rec.get("kind"), rec.get("dev"), json.dumps(rec.get("items") or {}, ensure_ascii=False)))
                    want["kv_snap"] += 1
            eng.exec(dbconn.upsert("sqlite", "meta", ["k", "v"], ["k"]), ("migrated", json.dumps({"at": int(time.time() * 1000), "from": "files", "counts": want}, ensure_ascii=False)))
        # ---- 대조 ----
        got = {"docs_json": eng.rows("SELECT COUNT(*) FROM docs WHERE kind='json'")[0][0], "docs_jsonl": eng.rows("SELECT COUNT(*) FROM docs WHERE kind='jsonl'")[0][0],
               "jsonl_lines": eng.rows("SELECT COUNT(*) FROM doc_lines")[0][0], "kv": eng.rows("SELECT COUNT(*) FROM kv")[0][0],
               "kv_prev": eng.rows("SELECT COUNT(*) FROM kv_prev")[0][0], "kv_snap": eng.rows("SELECT COUNT(*) FROM kv_snap")[0][0]}
        diff = [k for k in want if want[k] != got[k]]
        for rel, t in texts.items():
            if vfs.read_text(os.path.join(data, *rel.split("/"))) != (t[1:] if t.startswith("﻿") else t):
                diff.append("내용 다름: " + rel)
        for rel, full in kvs:
            m = re.match(r"^users/([^/]+)/(.+)$", rel)
            rec = json.loads(_text(full))
            if rel.endswith(".kv.json"):
                r = eng.rows("SELECT v, t FROM kv WHERE uid=? AND k=?", (m.group(1), rec["k"]))
                if not r or r[0][0] != rec.get("v") or r[0][1] != (rec.get("t") or 0):
                    diff.append("내용 다름(kv): " + rel)
        ok = eng.rows("PRAGMA integrity_check")[0][0]
        if ok != "ok":
            diff.append("integrity_check: " + ok)
        if diff:
            raise RuntimeError("대조 실패: " + "; ".join(diff[:10]))
    except BaseException:
        eng.close()
        vfs.init(data, None)
        try:
            os.remove(dbp)
        except OSError:
            pass
        log("옮기지 못했습니다 — DB 파일을 지우고 파일 엔진 그대로 둡니다.")
        raise
    eng.close()
    vfs.init(data, None)
    # ---- 원본을 읽기 전용 백업으로(지우지 않는다) ----
    stamp = time.strftime("%Y%m%d-%H%M%S")
    keep = os.path.join(data, "backup", "pre-sqlite-" + stamp)
    for rel, full in [(r, f) for r, f, _ in docs] + kvs:
        dst = os.path.join(keep, *rel.split("/"))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.move(full, dst)
        os.chmod(dst, _stat.S_IREAD)
    for b, dirs, files in os.walk(os.path.join(data, "users")):    # 비게 된 kvsnap 폴더만 정리(다른 빈 폴더는 그대로)
        if os.path.basename(b) == "kvsnap" and not files and not dirs:
            try:
                os.rmdir(b)
            except OSError:
                pass
    dbconn.save_conf(data, dict(c, engine="sqlite", switched=int(time.time() * 1000), migrated_from="files", originals=os.path.relpath(keep, data).replace("\\", "/")))
    rep = {"ok": True, "db": dbp, "db_bytes": os.path.getsize(dbp), "counts": got, "originals": keep, "seconds": round(time.time() - t0, 2)}
    log(json.dumps(rep, ensure_ascii=False, indent=1))
    return rep


def back(data, log=print):
    """DB → 파일(원래 자리). 엔진을 files 로. DB 파일은 지우지 않는다."""
    c = dbconn.load_conf(data)
    if c.get("engine") != "sqlite":
        raise SystemExit("엔진이 sqlite 가 아닙니다.")
    eng = dbconn.Engine(data, c)
    vfs.init(data, eng)
    n = 0
    for p, k, _ in vfs.all_docs():
        t = vfs._db_text(p)
        dst = os.path.join(data, *p.split("/"))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if os.path.exists(dst):
            os.chmod(dst, _stat.S_IREAD | _stat.S_IWRITE)
        with open(dst, "wb") as fh:
            fh.write(t.encode("utf-8"))
        n += 1
    r = dbconn.import_dir(eng, data, log, only_kv=True)
    eng.close()
    vfs.init(data, None)
    dbconn.save_conf(data, dict(c, engine="files", switched=int(time.time() * 1000)))
    log("DB 의 문서 %d개·계정 데이터 %d개를 파일로 썼습니다. 엔진 = files. DB 파일은 남겨 둡니다." % (n, r["kv"]))


def main(argv):
    for st in (sys.stdout, sys.stderr):
        try:
            st.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    ap = argparse.ArgumentParser(description="저장 엔진 파일 → SQLite")
    ap.add_argument("--data")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--check", action="store_true")
    g.add_argument("--go", action="store_true")
    g.add_argument("--back", action="store_true")
    ap.add_argument("--port", action="append")
    a = ap.parse_args(argv)
    data = os.path.abspath(a.data) if a.data else ws_api.resolve_data_dir(ROOT, [], os.environ)
    print("데이터 폴더:", data)
    if a.check:
        docs, kvs = scan(data)
        print(json.dumps({"docs_json": sum(1 for d in docs if d[2] == "json"), "docs_jsonl": sum(1 for d in docs if d[2] == "jsonl"), "kv_files": len(kvs),
                          "bytes": sum(os.path.getsize(d[1]) for d in docs) + sum(os.path.getsize(k[1]) for k in kvs)}, ensure_ascii=False))
        return 0
    up = _server_up(a.port or [os.environ.get("SK_PORT") or "18162"])
    if up:
        print("서버가 켜져 있습니다(포트 %s). 서버를 끈 뒤 다시 하세요." % up)
        return 3
    if a.go:
        go(data)
    else:
        back(data)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
