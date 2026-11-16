# -*- coding: utf-8 -*-
"""(v140, G10) 백업에서 되살리기 — 서버를 끈 뒤에 쓴다. 지금 파일은 지우지 않고 <데이터 폴더>/_trash/restore-<시각>/ 로 옮긴다.

  python tools/restore.py --list                              스냅숏 목록(시간별·일별·월별)
  python tools/restore.py --check                             지금 데이터 점검(서버 시작 점검과 같음)
  python tools/restore.py --verify [--snapshot 이름]          백업 조각이 온전한지(sha256)
  python tools/restore.py --to <빈 폴더> [--snapshot 이름]    백업을 다른 폴더에 풀어 보기(지금 데이터는 그대로) ← 먼저 이걸로 확인
  python tools/restore.py --file <경로> [--snapshot 이름]     파일 하나만 되살리기(경로는 --check 가 알려 준 그대로, 예: data/users/u1/study/progress.kv.json)
  python tools/restore.py --all --snapshot 이름 --yes         데이터 전체를 그 시점으로(백업에 없는 지금 파일도 _trash 로)
  --data <데이터 폴더>  (기본: 서버와 같은 규칙 — --data-dir / STUDY_DATA_DIR / userdata/data-dir.txt / userdata/workspace)
스냅숏 이름: h-YYYYMMDD-HHMMSS(시간별) · d-YYYYMMDD(일별) · m-YYYYMM(월별) · latest(가장 최근, 기본)
"""
import argparse
import json
import os
import socket
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import backup_api   # noqa: E402
import dbconn       # noqa: E402
import ws_api       # noqa: E402


def _server_up(ports):
    for p in ports:
        try:
            s = socket.create_connection(("127.0.0.1", int(p)), timeout=0.5)
            s.close()
            return p
        except (OSError, ValueError):
            pass
    return None


def main(argv):
    for st in (sys.stdout, sys.stderr):
        try:
            st.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    ap = argparse.ArgumentParser(description="ScholarFlow 백업 되살리기")
    ap.add_argument("--data")
    ap.add_argument("--vault")
    ap.add_argument("--backup-dir")
    ap.add_argument("--snapshot", default="latest")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--list", action="store_true")
    g.add_argument("--check", action="store_true")
    g.add_argument("--verify", action="store_true")
    g.add_argument("--to")
    g.add_argument("--file", action="append")
    g.add_argument("--doc", action="append", help="(v151) SQLite 엔진: DB 안 문서 하나(예: system/users.json)를 스냅숏의 DB 사본에서 되살림")
    g.add_argument("--all", action="store_true")
    ap.add_argument("--yes", action="store_true")
    ap.add_argument("--port", action="append", help="서버가 켜져 있는지 볼 포트(기본 18162·SK_PORT)")
    a = ap.parse_args(argv)
    data = os.path.abspath(a.data) if a.data else ws_api.resolve_data_dir(ROOT, [], os.environ)
    vault = a.vault or os.path.join(ROOT, "userdata", "llm-vault")
    c = dbconn.load_conf(data)
    eng = dbconn.Engine(data, c) if c.get("engine", "files") != "files" else None
    b = backup_api.Backup(ROOT, data, vault, bdir=a.backup_dir, db=eng)
    import vfs                       # (v151) SQLite 엔진이면 .json·.jsonl 은 DB 안(표는 만들지 않는다)
    vfs.init(data, eng, tables=False)
    print("데이터 폴더:", data)
    print("백업 폴더:  ", b.dir)
    if a.list:
        ls = b.list()
        if not ls:
            print("스냅숏이 없습니다.")
        for r in ls:
            print("  %-20s %-8s 파일 %5d  %8.1f MB  경고 %d  %s" % (r["name"], r["kind"], r["files"], r["bytes"] / 1e6, r["warn"], r.get("app") or ""))
        st = b.state()
        if st.get("fail"):
            print("마지막 실패:", json.dumps(st["fail"][:3], ensure_ascii=False))
        return 0
    if a.check:
        h = b.startup_check()
        if eng is not None and not h["bad"]:
            try:
                db_bad, db_warn = vfs.check_docs()        # (v151) DB 안 문서도 읽혀야 한다
                h["bad"] += db_bad
                h["warn"] = (h.get("warn") or []) + db_warn
            except Exception as e:
                h["bad"].append({"path": "db", "why": str(e)[:120]})
        print("깨진 파일 %d개 · 경고 %d개" % (len(h["bad"]), h.get("warn_n", 0)))
        for x in h["bad"]:
            print("  ✗ %s — %s" % (x["path"], x["why"]))
        for x in h["warn"][:10]:
            print("  ! %s — %s" % (x["path"], x["why"]))
        if h["bad"]:
            print("\n되살리기: 서버를 끈 뒤  python tools/restore.py --file %s --snapshot %s" % (h["bad"][0]["path"], (b.list() or [{}])[0].get("name") or "<이름>"))
        return 1 if h["bad"] else 0
    mf, path = b.find(a.snapshot)
    if not mf:
        print("스냅숏을 찾지 못했습니다:", a.snapshot)
        return 2
    print("스냅숏:      %s (%s, 파일 %d개)" % (os.path.basename(path), mf.get("kind"), len(mf.get("files") or {})))
    if a.verify:
        bad = b.verify(mf)
        print("조각 확인: " + ("모두 정상" if not bad else "%d개 손상" % len(bad)))
        for x in bad[:20]:
            print("  ✗", x["path"], x["why"])
        return 1 if bad else 0
    if a.to:
        if os.path.exists(a.to) and os.listdir(a.to):
            print("빈 폴더에만 풉니다:", a.to)
            return 2
        n = b.extract(mf, a.to)
        dd = b.db_docs(mf)                              # (v151) DB 사본 안 문서도 읽을 수 있는 파일로 함께 푼다
        for rel, data_b in dd.items():
            dst = os.path.join(a.to, *rel.split("/"))
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            with open(dst, "wb") as f:
                f.write(data_b)
        print("%d개 파일%s을 풀었습니다: %s" % (n, (" + DB 안 문서 %d개" % len(dd)) if dd else "", a.to))
        return 0
    ports = a.port or [os.environ.get("SK_PORT") or "18162"]
    up = _server_up(ports)
    if up:
        print("서버가 켜져 있습니다(포트 %s). 먼저 끄세요: server-keeper 의 sk.cmd stop learning-center  (또는 런처에서 중지)" % up)
        return 3
    if a.doc:                             # (v151) DB 안 문서 하나씩
        dd = b.db_docs(mf)
        want = [(x if x.startswith("data/") else "data/" + x.lstrip("/")) for x in a.doc]
        missing = [x for x in want if x not in dd]
        if missing:
            print("이 스냅숏의 DB 사본에 없는 문서:", ", ".join(missing))
            return 2
        import time as _t
        trash = os.path.join(data, "_trash", "restore-" + _t.strftime("%Y%m%d-%H%M%S"))
        import safeio as _s
        was, _s.READONLY = _s.READONLY, None
        try:
            if eng is not None:
                vfs.init(data, eng)
            for rel in want:
                tgt = os.path.join(data, *rel[5:].split("/"))
                if vfs.exists(tgt):
                    keep = os.path.join(trash, *rel.split("/"))
                    os.makedirs(os.path.dirname(keep), exist_ok=True)
                    with open(keep, "wb") as f:
                        f.write(vfs.read_bytes(tgt))
                vfs.write_bytes(tgt, dd[rel])
        finally:
            _s.READONLY = was
        print("되살림: DB 문서 %d개%s" % (len(want), (" · 지금 내용은 " + trash) if os.path.isdir(trash) else ""))
        return 0
    if a.all:
        if not a.yes:
            print("데이터 전체를 이 시점으로 되돌립니다. 지금 파일은 _trash 로 옮깁니다. 계속하려면 --yes 를 붙이세요.")
            return 2
        r = b.restore(mf)
    else:
        missing = [f for f in a.file if f not in (mf.get("files") or {})]
        if missing:
            print("이 스냅숏에 없는 경로:", ", ".join(missing))
            return 2
        r = b.restore(mf, only=set(a.file))
    print("되살림: 파일 %d개 · 옮겨 둔 지금 파일 %d개%s" % (r["written"], r["moved"], (" → " + r["trash"]) if r["trash"] else ""))
    h = b.startup_check()
    print("다시 점검: 깨진 파일 %d개" % len(h["bad"]) + (" — 이제 서버를 켜면 됩니다." if not h["bad"] else ""))
    return 0 if not h["bad"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
